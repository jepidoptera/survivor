// IMPORTANT: This is a performance gate. No feature is considered complete unless
// this test passes. If you are adding a feature that makes the bubble shift slower,
// you must either optimize it or get explicit sign-off to raise the baseline.

const test = require("node:test");
const assert = require("node:assert/strict");
const { performance } = require("node:perf_hooks");

const {
    attachPrototypeApis,
    createPrototypeState,
} = require("../public/assets/javascript/prototypes/sectionWorld.js");

// Load real WallSectionUnit (sets globalThis.WallSectionUnit as side effect)
require("../public/assets/javascript/gameobjects/wallSectionUnit.js");

// ---------------------------------------------------------------------------
// TestNode — used as the NodeCtor for sparse node builds.
// The sparse build system picks up map.nodes[0][0].constructor.
// ---------------------------------------------------------------------------
class TestNode {
    constructor(xindex, yindex) {
        this.xindex = Number(xindex) || 0;
        this.yindex = Number(yindex) || 0;
        this.x = this.xindex * 0.866;
        this.y = this.yindex + (this.xindex % 2 === 0 ? 0.5 : 0);
        this.neighbors = new Array(12).fill(null);
        this.neighborOffsets = null;
        this.blockedNeighbors = new Map();
        this.objects = [];
        this.visibilityObjects = [];
        this.blockedByObjects = 0;
        this.blocked = false;
        this.clearance = Infinity;
    }
    addObject(obj) { this.objects.push(obj); }
    removeObject(obj) {
        const i = this.objects.indexOf(obj);
        if (i >= 0) this.objects.splice(i, 1);
    }
    recountBlockingObjects() {}
    isBlocked() { return false; }
}

// ---------------------------------------------------------------------------
// Test map factory — includes full floor-layer index so upper-floor nodes
// are correctly looked up by _resolveNodeForWallLayer.
// ---------------------------------------------------------------------------
function createPerfTestMap() {
    const map = {
        width: 1,
        height: 1,
        nodes: [[new TestNode(0, 0)]],
        objects: [],
        gameObjects: [],
        groundTextures: [0],

        worldToNode() { return this.nodes[0][0]; },

        resetFloorRuntimeState() {
            this.floorsById = new Map();
            this.floorFragmentsBySurfaceId = new Map();
            this.floorFragmentsBySectionKey = new Map();
            this.floorNodesById = new Map();
            this.floorNodeIndex = new Map();
            this.floorNodeLayerIndex = new Map();
            this.transitionsById = new Map();
        },

        getFloorNodeKey(nodeOrX, y = null, surfaceId = "", fragmentId = "") {
            if (nodeOrX && typeof nodeOrX === "object") {
                return `${nodeOrX.xindex},${nodeOrX.yindex},${nodeOrX.surfaceId || ""},${nodeOrX.fragmentId || ""}`;
            }
            return `${nodeOrX},${y},${surfaceId || ""},${fragmentId || ""}`;
        },

        getFloorLayerNodeKey(nodeOrX, y = null, traversalLayer = 0) {
            if (nodeOrX && typeof nodeOrX === "object") {
                const layer = Number.isFinite(nodeOrX.traversalLayer)
                    ? Math.round(nodeOrX.traversalLayer)
                    : (Number.isFinite(nodeOrX.level) ? Math.round(nodeOrX.level) : 0);
                return `${nodeOrX.xindex},${nodeOrX.yindex},${layer}`;
            }
            return `${nodeOrX},${y},${Math.round(Number(traversalLayer) || 0)}`;
        },

        _indexFloorNodeByLayer(node) {
            if (!node) return;
            if (!(this.floorNodeLayerIndex instanceof Map)) this.floorNodeLayerIndex = new Map();
            const key = this.getFloorLayerNodeKey(node);
            if (!this.floorNodeLayerIndex.has(key)) this.floorNodeLayerIndex.set(key, []);
            const arr = this.floorNodeLayerIndex.get(key);
            if (!arr.includes(node)) arr.push(node);
        },

        _unindexFloorNodeByLayer(node) {
            if (!node || !(this.floorNodeLayerIndex instanceof Map)) return;
            const key = this.getFloorLayerNodeKey(node);
            const arr = this.floorNodeLayerIndex.get(key);
            if (!Array.isArray(arr)) return;
            const i = arr.indexOf(node);
            if (i >= 0) arr.splice(i, 1);
            if (arr.length === 0) this.floorNodeLayerIndex.delete(key);
        },

        getFloorNodeAtLayer(x, y, layer = 0, options = {}) {
            const targetLayer = Number.isFinite(layer) ? Math.round(layer) : 0;
            const xi = Number(x), yi = Number(y);
            if (targetLayer === 0) {
                const state = this._prototypeSectionState;
                return (state && state.allNodesByCoordKey instanceof Map)
                    ? (state.allNodesByCoordKey.get(`${xi},${yi}`) || null)
                    : null;
            }
            if (!(this.floorNodeLayerIndex instanceof Map)) return null;
            if (options && options.allowScan === false) {
                const candidates = this.floorNodeLayerIndex.get(`${xi},${yi},${targetLayer}`) || [];
                return candidates[0] || null;
            }
            const candidates = this.floorNodeLayerIndex.get(`${xi},${yi},${targetLayer}`) || [];
            return candidates[0] || null;
        },

        registerFloorFragment(fragment) {
            if (!fragment || typeof fragment !== "object") return null;
            if (!(this.floorsById instanceof Map)) this.resetFloorRuntimeState();
            const fragmentId = (typeof fragment.fragmentId === "string" && fragment.fragmentId.length > 0)
                ? fragment.fragmentId
                : ((typeof fragment.id === "string" && fragment.id.length > 0) ? fragment.id : "");
            if (!fragmentId) return null;
            const normalized = {
                ...fragment,
                fragmentId,
                surfaceId: (typeof fragment.surfaceId === "string" && fragment.surfaceId.length > 0)
                    ? fragment.surfaceId : fragmentId,
                ownerSectionKey: (typeof fragment.ownerSectionKey === "string") ? fragment.ownerSectionKey : "",
                level: Number.isFinite(fragment.level) ? Number(fragment.level) : 0,
                nodeBaseZ: Number.isFinite(fragment.nodeBaseZ) ? Number(fragment.nodeBaseZ) : 0,
            };
            this.floorsById.set(fragmentId, normalized);
            if (!this.floorNodesById.has(fragmentId)) this.floorNodesById.set(fragmentId, []);
            if (!this.floorFragmentsBySurfaceId.has(normalized.surfaceId)) {
                this.floorFragmentsBySurfaceId.set(normalized.surfaceId, new Set());
            }
            this.floorFragmentsBySurfaceId.get(normalized.surfaceId).add(fragmentId);
            if (normalized.ownerSectionKey.length > 0) {
                if (!this.floorFragmentsBySectionKey.has(normalized.ownerSectionKey)) {
                    this.floorFragmentsBySectionKey.set(normalized.ownerSectionKey, new Set());
                }
                this.floorFragmentsBySectionKey.get(normalized.ownerSectionKey).add(fragmentId);
            }
            return normalized;
        },

        registerFloorNode(node, fragment = null) {
            if (!node || typeof node !== "object") return null;
            if (!(this.floorNodesById instanceof Map)) this.resetFloorRuntimeState();
            const fragmentId = (fragment && typeof fragment.fragmentId === "string")
                ? fragment.fragmentId
                : ((typeof node.fragmentId === "string") ? node.fragmentId : "");
            if (!fragmentId) return null;
            const surfaceId = (fragment && typeof fragment.surfaceId === "string")
                ? fragment.surfaceId
                : ((typeof node.surfaceId === "string") ? node.surfaceId : "");
            node.fragmentId = fragmentId;
            node.surfaceId = surfaceId;
            node.id = this.getFloorNodeKey(node);
            if (!this.floorNodesById.has(fragmentId)) this.floorNodesById.set(fragmentId, []);
            this.floorNodesById.get(fragmentId).push(node);
            this.floorNodeIndex.set(node.id, node);
            this._indexFloorNodeByLayer(node);
            return node;
        },

        createFloorNodeFromSource(sourceNode, fragment, options = {}) {
            if (!sourceNode || !fragment) return null;
            const floorNode = new TestNode(sourceNode.xindex, sourceNode.yindex);
            floorNode.sourceNode = sourceNode;
            floorNode._prototypeSectionKey = sourceNode._prototypeSectionKey || "";
            floorNode._prototypeSectionActive = sourceNode._prototypeSectionActive || false;
            floorNode._prototypeVoid = sourceNode._prototypeVoid || false;
            floorNode.surfaceId = (typeof fragment.surfaceId === "string") ? fragment.surfaceId : "";
            floorNode.fragmentId = (typeof fragment.fragmentId === "string") ? fragment.fragmentId : "";
            floorNode.ownerSectionKey = (typeof fragment.ownerSectionKey === "string") ? fragment.ownerSectionKey : "";
            floorNode.level = Number.isFinite(fragment.level) ? Number(fragment.level) : 0;
            floorNode.traversalLayer = Number.isFinite(options.traversalLayer)
                ? Number(options.traversalLayer) : floorNode.level;
            floorNode.baseZ = Number.isFinite(options.baseZ) ? Number(options.baseZ)
                : (Number.isFinite(fragment.nodeBaseZ) ? Number(fragment.nodeBaseZ) : 0);
            floorNode.portalEdges = Array.isArray(sourceNode.portalEdges) ? sourceNode.portalEdges.slice() : [];
            floorNode.neighborOffsets = Array.isArray(sourceNode.neighborOffsets)
                ? sourceNode.neighborOffsets.slice() : new Array(12).fill(null);
            floorNode.clearance = Number.isFinite(sourceNode.clearance) ? Number(sourceNode.clearance) : Infinity;
            floorNode.blocked = false;
            floorNode.blockedByObjects = 0;
            return this.registerFloorNode(floorNode, fragment);
        },

        getFloorNodeBySurface(surfaceId, x, y) {
            if (!(this.floorFragmentsBySurfaceId instanceof Map) || !(this.floorNodeIndex instanceof Map)) return null;
            if (typeof surfaceId !== "string" || surfaceId.length === 0) return null;
            const fragmentIds = this.floorFragmentsBySurfaceId.get(surfaceId);
            if (!(fragmentIds instanceof Set)) return null;
            for (const fragmentId of fragmentIds) {
                const node = this.floorNodeIndex.get(this.getFloorNodeKey(x, y, surfaceId, fragmentId)) || null;
                if (node) return node;
            }
            return null;
        },

        registerFloorTransition() { return null; },
        connectFloorNodeNeighbors() { return 0; },
        connectFloorTransitions() { return 0; },
        resolveFloorTransitionEndpoint() { return null; },
        rebuildFloorRuntimeFromSectionState() { return { fragmentCount: 0, nodeCount: 0, transitionCount: 0 }; },
        computeClearance() {},
        rebuildGameObjectRegistry() {},
    };

    map.resetFloorRuntimeState();
    return map;
}

// ---------------------------------------------------------------------------
// Section data builder — generates one section with walls, objects, animals,
// and an upper-floor fragment. Each section occupies a 5×5 tile block at
// xi ∈ [baseXi..baseXi+4], yi ∈ [0..4].
// ---------------------------------------------------------------------------
function tileXY(xi, yi) {
    return { kind: "node", xindex: xi, yindex: yi, x: xi * 0.866, y: yi + (xi % 2 === 0 ? 0.5 : 0) };
}

// Each section is W×H tiles; sections are spaced STRIDE apart in xi so they don't overlap.
// 30×30 = 900 tiles per section, 5 sections = 4500 loaded nodes —
// large enough that 1% threshold is above machine noise, and
// an O(N) scan regression would show a clear increase.
const SEC_W = 50, SEC_H = 50, SEC_STRIDE = 55;

function buildSection(key, q, baseXi, idBase) {
    const tiles = [];
    for (let xi = baseXi; xi < baseXi + SEC_W; xi++) {
        for (let yi = 0; yi < SEC_H; yi++) {
            tiles.push(`${xi},${yi}`);
        }
    }

    // Upper-floor fragment covers the middle 7×7 tiles
    const hw = 3, hh = 3;
    const cx0 = baseXi + Math.floor(SEC_W / 2);
    const cy0 = Math.floor(SEC_H / 2);
    const upperTiles = [];
    for (let xi = cx0 - hw; xi <= cx0 + hw; xi++) {
        for (let yi = cy0 - hh; yi <= cy0 + hh; yi++) {
            upperTiles.push(`${xi},${yi}`);
        }
    }

    const walls = [];
    let wallId = idBase * 1000;
    const W = SEC_W - 1, H = SEC_H - 1;
    // Outer perimeter
    walls.push({ id: ++wallId, startPoint: tileXY(baseXi,     0), endPoint: tileXY(baseXi + W, 0), height: 2, thickness: 0.35, bottomZ: 0 });
    walls.push({ id: ++wallId, startPoint: tileXY(baseXi,     H), endPoint: tileXY(baseXi + W, H), height: 2, thickness: 0.35, bottomZ: 0 });
    walls.push({ id: ++wallId, startPoint: tileXY(baseXi,     0), endPoint: tileXY(baseXi,     H), height: 2, thickness: 0.35, bottomZ: 0 });
    walls.push({ id: ++wallId, startPoint: tileXY(baseXi + W, 0), endPoint: tileXY(baseXi + W, H), height: 2, thickness: 0.35, bottomZ: 0 });
    // Interior room at 1/3 height
    const r1 = Math.floor(H / 3), r2 = Math.floor(2 * H / 3);
    const c1 = Math.floor(W / 3), c2 = Math.floor(2 * W / 3);
    walls.push({ id: ++wallId, startPoint: tileXY(baseXi + c1, r1), endPoint: tileXY(baseXi + c2, r1), height: 2, thickness: 0.35, bottomZ: 0 });
    walls.push({ id: ++wallId, startPoint: tileXY(baseXi + c1, r2), endPoint: tileXY(baseXi + c2, r2), height: 2, thickness: 0.35, bottomZ: 0 });
    walls.push({ id: ++wallId, startPoint: tileXY(baseXi + c1, r1), endPoint: tileXY(baseXi + c1, r2), height: 2, thickness: 0.35, bottomZ: 0 });
    walls.push({ id: ++wallId, startPoint: tileXY(baseXi + c2, r1), endPoint: tileXY(baseXi + c2, r2), height: 2, thickness: 0.35, bottomZ: 0 });
    // Cross walls
    walls.push({ id: ++wallId, startPoint: tileXY(baseXi,         Math.floor(H / 2)), endPoint: tileXY(baseXi + W,         Math.floor(H / 2)), height: 2, thickness: 0.35, bottomZ: 0 });
    walls.push({ id: ++wallId, startPoint: tileXY(baseXi + Math.floor(W / 2), 0),     endPoint: tileXY(baseXi + Math.floor(W / 2), H),           height: 2, thickness: 0.35, bottomZ: 0 });
    // Upper-floor walls (layer 1) inside the upper fragment area
    walls.push({ id: ++wallId, startPoint: tileXY(cx0 - hw, cy0), endPoint: tileXY(cx0 + hw, cy0), height: 2, thickness: 0.35, bottomZ: 3, traversalLayer: 1, level: 1 });
    walls.push({ id: ++wallId, startPoint: tileXY(cx0, cy0 - hh), endPoint: tileXY(cx0, cy0 + hh), height: 2, thickness: 0.35, bottomZ: 3, traversalLayer: 1, level: 1 });
    // Extra ground walls to increase load
    walls.push({ id: ++wallId, startPoint: tileXY(baseXi + 1, 1), endPoint: tileXY(baseXi + W - 1, 1), height: 2, thickness: 0.35, bottomZ: 0 });
    walls.push({ id: ++wallId, startPoint: tileXY(baseXi + 1, H - 1), endPoint: tileXY(baseXi + W - 1, H - 1), height: 2, thickness: 0.35, bottomZ: 0 });
    walls.push({ id: ++wallId, startPoint: tileXY(baseXi + 1, 1), endPoint: tileXY(baseXi + 1, H - 1), height: 2, thickness: 0.35, bottomZ: 0 });
    walls.push({ id: ++wallId, startPoint: tileXY(baseXi + W - 1, 1), endPoint: tileXY(baseXi + W - 1, H - 1), height: 2, thickness: 0.35, bottomZ: 0 });
    walls.push({ id: ++wallId, startPoint: tileXY(baseXi + 3, 3), endPoint: tileXY(baseXi + W - 3, 3), height: 2, thickness: 0.35, bottomZ: 0 });
    walls.push({ id: ++wallId, startPoint: tileXY(baseXi + 3, H - 3), endPoint: tileXY(baseXi + W - 3, H - 3), height: 2, thickness: 0.35, bottomZ: 0 });
    walls.push({ id: ++wallId, startPoint: tileXY(baseXi + 3, 3), endPoint: tileXY(baseXi + 3, H - 3), height: 2, thickness: 0.35, bottomZ: 0 });
    walls.push({ id: ++wallId, startPoint: tileXY(baseXi + W - 3, 3), endPoint: tileXY(baseXi + W - 3, H - 3), height: 2, thickness: 0.35, bottomZ: 0 });

    const cx = (baseXi + Math.floor(SEC_W / 2)) * 0.866;
    const objects = [
        { id: idBase * 1000 + 500, type: "road",   x: (baseXi + 2) * 0.866, y: 2.5 },
        { id: idBase * 1000 + 501, type: "road",   x: (baseXi + 4) * 0.866, y: 4.5 },
        { id: idBase * 1000 + 502, type: "road",   x: (baseXi + 6) * 0.866, y: 6.5 },
        { id: idBase * 1000 + 503, type: "tree",   x: cx, y: 1.5 },
        { id: idBase * 1000 + 504, type: "tree",   x: cx, y: 3.5 },
        { id: idBase * 1000 + 505, type: "window", x: cx, y: 5.5 },
        { id: idBase * 1000 + 506, type: "crate",  x: cx, y: 7.5 },
        { id: idBase * 1000 + 507, type: "barrel", x: cx, y: 9.5 },
    ];

    const animals = [
        { id: idBase * 1000 + 700, type: "goat",     x: cx - 1.0, y: 2.0 },
        { id: idBase * 1000 + 701, type: "squirrel", x: cx,       y: 4.0 },
        { id: idBase * 1000 + 702, type: "goat",     x: cx + 1.0, y: 6.0 },
        { id: idBase * 1000 + 703, type: "squirrel", x: cx - 0.5, y: 8.0 },
        { id: idBase * 1000 + 704, type: "goat",     x: cx + 0.5, y: 10.0 },
    ];

    const groundTiles = {};
    for (const t of tiles) groundTiles[t] = 0;

    return {
        id: `section-${key}`,
        key,
        coord: { q, r: 0 },
        centerAxial: { q: q * SEC_STRIDE, r: 0 },
        centerOffset: { x: q * SEC_STRIDE, y: 0 },
        centerWorld: { x: (baseXi + Math.floor(SEC_W / 2)) * 0.866, y: Math.floor(SEC_H / 2) + 0.5 },
        neighborKeys: [],
        tileCoordKeys: tiles,
        groundTextureId: 0,
        groundTiles,
        floors: [
            {
                fragmentId: `section:${key}:upper`,
                surfaceId: `${key}:upper_surface`,
                ownerSectionKey: key,
                level: 1,
                nodeBaseZ: 3,
                tileCoordKeys: upperTiles,
            }
        ],
        walls,
        objects,
        animals,
        powerups: [],
    };
}

// ---------------------------------------------------------------------------
// Global mocks — set once per test run, then restored.
// ---------------------------------------------------------------------------
const SAVED_GLOBALS = ["Animal", "Powerup", "Road", "StaticObject", "WallSectionUnit",
    "animals", "powerups", "objectLayer", "map", "roof", "roofs",
    "markPrototypeLevel0RoadSurfaceDirty", "flushPrototypeLevel0RoadSurfaceDirtyAsset"];
const savedValues = new Map();
for (const k of SAVED_GLOBALS) savedValues.set(k, globalThis[k]);

function setupGlobals(mapRef) {
    globalThis.map = mapRef;
    globalThis.animals = [];
    globalThis.powerups = [];
    globalThis.roofs = [];
    globalThis.roof = null;
    globalThis.objectLayer = { addChild() {} };
    globalThis.markPrototypeLevel0RoadSurfaceDirty = () => {};
    globalThis.flushPrototypeLevel0RoadSurfaceDirtyAsset = () => {};

    globalThis.Animal = {
        loadJson(record, mapRef) {
            return {
                ...record, map: mapRef, gone: false,
                removeFromGame() { this.gone = true; },
                remove() { this.removeFromGame(); },
            };
        }
    };

    globalThis.Powerup = {
        loadJson(record, mapRef) {
            return { ...record, map: mapRef, gone: false, removeFromGame() { this.gone = true; } };
        }
    };

    globalThis.StaticObject = {
        loadJson(record, mapRef) {
            const node = mapRef.worldToNode ? mapRef.worldToNode(record.x, record.y) : null;
            return {
                ...record, map: mapRef, node, gone: false,
                pixiSprite: { visible: true, parent: null },
                removeFromNodes() {},
                removeFromGame() { this.gone = true; },
                getNode() { return this.node; },
            };
        }
    };

    globalThis.Road = {
        _oddDirections: [1, 3, 5, 7, 9, 11],
        collectRefreshNodesFromNode(_node, targetSet) {
            if (targetSet instanceof Set) targetSet.add("road");
        },
        refreshTexturesAroundNodes() {},
    };
}

function restoreGlobals() {
    for (const [k, v] of savedValues.entries()) {
        if (typeof v === "undefined") delete globalThis[k];
        else globalThis[k] = v;
    }
}

// ---------------------------------------------------------------------------
// Bundle factory — 5 sections; initial center "1,0"; shift target "2,0".
// ---------------------------------------------------------------------------
const SECTIONS = [
    buildSection("0,0", 0, 0 * SEC_STRIDE, 0),
    buildSection("1,0", 1, 1 * SEC_STRIDE, 1),
    buildSection("2,0", 2, 2 * SEC_STRIDE, 2),
    buildSection("3,0", 3, 3 * SEC_STRIDE, 3),
    buildSection("4,0", 4, 4 * SEC_STRIDE, 4),
];

function buildInitialBundle() {
    return {
        version: 1,
        activeCenterKey: "1,0",
        sections: SECTIONS,
    };
}

function createEmptyState() {
    return createPrototypeState({
        radius: 3,
        sectionGraphRadius: 0,
        sectionCoords: [],
        sectionsByKey: new Map(),
        orderedSections: [],
        sectionAssetsByKey: new Map(),
        orderedSectionAssets: [],
        anchorCenter: { q: 1, r: 0 },
        nextRecordIds: { walls: 1, objects: 1, animals: 1, powerups: 1 },
    }, "1,0");
}

// ---------------------------------------------------------------------------
// Core measurement helper — returns elapsed ms for one full bubble shift.
// ---------------------------------------------------------------------------
function measureOneShift() {
    const map = createPerfTestMap();
    attachPrototypeApis(map, createEmptyState());
    setupGlobals(map);

    const bundle = buildInitialBundle();
    map.loadPrototypeSectionWorld(bundle);
    map.syncPrototypeWalls();
    map.syncPrototypeObjects();
    map.syncPrototypeAnimals();

    const t0 = performance.now();
    map.setPrototypeActiveCenterKey("2,0");
    map.schedulePrototypeRuntimeSync({ frameBudgetMs: 99999 });
    map.flushPrototypeBubbleShiftSession();
    return performance.now() - t0;
}

// ---------------------------------------------------------------------------
// PERFORMANCE GATE
// Baseline measured 2026-05-25 on development machine.
// If this test fails, a recent change has significantly slowed bubble shifts.
// Investigate with the [prototype bubble shift] console output.
// ---------------------------------------------------------------------------
const RUNS = 10;
const WARMUP = 3;
// Baseline measured 2026-05-25: avg ~14.4ms in isolation, up to ~18ms under full
// test-suite load. Set to 22ms (≈1.5× observed max) so the test is stable in CI
// while still catching any regression that roughly doubles shift time.
// To re-baseline after legitimate speedups: run `npm test`, note the printed avg
// in the failure message, and update BASELINE_MS to ceil(observed_max × 1.25).
const BASELINE_MS = 22;

test("bubble shift load time stays within 1% of baseline", { timeout: 120000 }, () => {
    restoreGlobals(); // ensure clean state if prior test leaked globals

    for (let i = 0; i < WARMUP; i++) measureOneShift();

    let total = 0;
    for (let i = 0; i < RUNS; i++) total += measureOneShift();
    const avgMs = total / RUNS;

    restoreGlobals();

    assert.ok(
        avgMs <= BASELINE_MS * 1.01,
        `bubble shift avg ${avgMs.toFixed(2)}ms exceeds baseline ${BASELINE_MS}ms × 1.01 = ${(BASELINE_MS * 1.01).toFixed(2)}ms (measured 2026-05-25)`
    );
});
