"use strict";
// Pathfinding integration test: pentagon-shaped floor spanning two map sections.
//
// Layout (top-down view):
//
//   Section "0,0" (left)          Section "1,0" (right)
//   ground: (0,2)–(4,2)           ground: (5,2)–(7,2)
//
//   Pentagon floor (level 1, "pentagon_surface"):
//        (4,1)
//   (3,2)(4,2)(5,2)               ← seam at x=4.5
//        (4,3)
//
//   Transitions:
//     stairs_up   : G(3,2) → F_pentagon(3,2)   [ground → floor, unidirectional]
//     zipline_down: F_pentagon(5,2) → F_ground(6,2) [floor → ground, unidirectional]
//
//   Pathfinding test: BFS from G(0,2) to F_ground(7,2)
//   Expected route:
//     G(0,2) → G(1,2) → G(2,2) → G(3,2)
//       → [stairs] → F_pentagon(3,2) → F_pentagon(4,2) → F_pentagon(5,2)
//       → [zipline] → F_ground(6,2) → F_ground(7,2)

const test = require("node:test");
const assert = require("node:assert/strict");

const { attachPrototypeApis, createPrototypeState } =
    require("../public/assets/javascript/prototypes/sectionWorld.js");

// ── Minimal hex-grid test node ─────────────────────────────────────────────
// Identical shape to the one used in sectionWorld.test.js so that
// buildSparsePrototypeNodes can use it as a NodeCtor.

class TestNode {
    constructor(xindex, yindex) {
        this.xindex = xindex;
        this.yindex = yindex;
        this.x = xindex * 0.866;
        this.y = yindex + (xindex % 2 === 0 ? 0.5 : 0);
        this.objects = [];
        this.visibilityObjects = [];
        this.blockedNeighbors = new Map();
        this.neighbors = new Array(12).fill(null);
    }
    addObject(obj) { this.objects.push(obj); }
    removeObject(obj) {
        const i = this.objects.indexOf(obj);
        if (i >= 0) this.objects.splice(i, 1);
    }
    recountBlockingObjects() {}
    isBlocked() { return false; }
}

// ── Global state helpers ───────────────────────────────────────────────────

const PROTOTYPE_GLOBAL_KEYS = [
    "Animal", "Powerup", "Road", "StaticObject", "WallSectionUnit",
    "animals", "powerups", "objectLayer", "map", "roof", "roofs"
];
const savedGlobals = new Map();
for (const key of PROTOTYPE_GLOBAL_KEYS) savedGlobals.set(key, globalThis[key]);

function restorePrototypeGlobals() {
    for (const [key, value] of savedGlobals.entries()) {
        if (typeof value === "undefined") delete globalThis[key];
        else globalThis[key] = value;
    }
}

// ── Mock map (contains all floor runtime APIs) ─────────────────────────────
// Mirrors the mock in sectionWorld.test.js.  The real floor-rebuild logic in
// sectionWorld.js calls these methods via the passed-in map object.

function createPrototypeMap() {
    return {
        width: 1,
        height: 1,
        nodes: [[new TestNode(0, 0)]],
        objects: [],
        gameObjects: [],
        groundTextures: [0],
        worldToNode() {
            return this._prototypeSectionState && this._prototypeSectionState.loadedNodes[0]
                ? this._prototypeSectionState.loadedNodes[0]
                : this.nodes[0][0];
        },
        resetFloorRuntimeState() {
            this.floorsById = new Map();
            this.floorFragmentsBySurfaceId = new Map();
            this.floorFragmentsBySectionKey = new Map();
            this.floorNodesById = new Map();
            this.floorNodeIndex = new Map();
            this.transitionsById = new Map();
        },
        getFloorNodeKey(nodeOrX, y = null, surfaceId = "", fragmentId = "") {
            if (nodeOrX && typeof nodeOrX === "object") {
                return `${Number(nodeOrX.xindex)},${Number(nodeOrX.yindex)},${String(nodeOrX.surfaceId || "")},${String(nodeOrX.fragmentId || "")}`;
            }
            return `${Number(nodeOrX)},${Number(y)},${String(surfaceId || "")},${String(fragmentId || "")}`;
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
                    ? fragment.surfaceId
                    : fragmentId,
                ownerSectionKey: (typeof fragment.ownerSectionKey === "string") ? fragment.ownerSectionKey : "",
                level: Number.isFinite(fragment.level) ? Number(fragment.level) : 0,
                nodeBaseZ: Number.isFinite(fragment.nodeBaseZ) ? Number(fragment.nodeBaseZ) : 0
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
            const fragmentId = (fragment && typeof fragment.fragmentId === "string" && fragment.fragmentId.length > 0)
                ? fragment.fragmentId
                : ((typeof node.fragmentId === "string" && node.fragmentId.length > 0) ? node.fragmentId : "");
            if (!fragmentId) return null;
            const surfaceId = (fragment && typeof fragment.surfaceId === "string" && fragment.surfaceId.length > 0)
                ? fragment.surfaceId
                : ((typeof node.surfaceId === "string") ? node.surfaceId : "");
            node.fragmentId = fragmentId;
            node.surfaceId = surfaceId;
            node.id = this.getFloorNodeKey(node);
            if (!this.floorNodesById.has(fragmentId)) this.floorNodesById.set(fragmentId, []);
            this.floorNodesById.get(fragmentId).push(node);
            this.floorNodeIndex.set(node.id, node);
            return node;
        },
        createFloorNodeFromSource(sourceNode, fragment, options = {}) {
            if (!sourceNode || !fragment) return null;
            const floorNode = new TestNode(sourceNode.xindex, sourceNode.yindex);
            floorNode.sourceNode = sourceNode;
            if (Object.prototype.hasOwnProperty.call(sourceNode, "_prototypeSectionKey"))
                floorNode._prototypeSectionKey = sourceNode._prototypeSectionKey;
            if (Object.prototype.hasOwnProperty.call(sourceNode, "_prototypeSectionActive"))
                floorNode._prototypeSectionActive = sourceNode._prototypeSectionActive;
            if (Object.prototype.hasOwnProperty.call(sourceNode, "_prototypeVoid"))
                floorNode._prototypeVoid = sourceNode._prototypeVoid;
            floorNode.surfaceId = (typeof fragment.surfaceId === "string") ? fragment.surfaceId : "";
            floorNode.fragmentId = (typeof fragment.fragmentId === "string") ? fragment.fragmentId : "";
            floorNode.ownerSectionKey = (typeof fragment.ownerSectionKey === "string") ? fragment.ownerSectionKey : "";
            floorNode.level = Number.isFinite(fragment.level) ? Number(fragment.level) : 0;
            floorNode.traversalLayer = Number.isFinite(options.traversalLayer)
                ? Number(options.traversalLayer)
                : floorNode.level;
            floorNode.baseZ = Number.isFinite(options.baseZ)
                ? Number(options.baseZ)
                : (Number.isFinite(fragment.nodeBaseZ) ? Number(fragment.nodeBaseZ) : 0);
            floorNode.portalEdges = Array.isArray(sourceNode.portalEdges) ? sourceNode.portalEdges.slice() : [];
            floorNode.neighborOffsets = Array.isArray(sourceNode.neighborOffsets)
                ? sourceNode.neighborOffsets.slice()
                : new Array(12).fill(null);
            floorNode.clearance = Number.isFinite(sourceNode.clearance) ? Number(sourceNode.clearance) : Infinity;
            floorNode.blocked = false;
            floorNode.blockedByObjects = 0;
            return this.registerFloorNode(floorNode, fragment);
        },
        registerFloorTransition(transition) {
            if (!transition || typeof transition !== "object") return null;
            if (!(this.transitionsById instanceof Map)) this.resetFloorRuntimeState();
            const transitionId = (typeof transition.id === "string" && transition.id.length > 0)
                ? transition.id : "";
            if (!transitionId) return null;
            const normalized = {
                ...transition,
                id: transitionId,
                metadata: (transition.metadata && typeof transition.metadata === "object")
                    ? { ...transition.metadata } : {}
            };
            this.transitionsById.set(transitionId, normalized);
            return normalized;
        },
        getFloorNodeBySurface(surfaceId, x, y) {
            if (!(this.floorFragmentsBySurfaceId instanceof Map) || !(this.floorNodeIndex instanceof Map)) return null;
            if (typeof surfaceId !== "string" || surfaceId.length === 0) return null;
            const fragmentIds = this.floorFragmentsBySurfaceId.get(surfaceId);
            if (!(fragmentIds instanceof Set)) return null;
            for (const fragmentId of fragmentIds) {
                const floorNode = this.floorNodeIndex.get(this.getFloorNodeKey(x, y, surfaceId, fragmentId)) || null;
                if (floorNode) return floorNode;
            }
            return null;
        },
        connectFloorNodeNeighbors() {
            let connectionCount = 0;
            for (const floorNodes of this.floorNodesById.values()) {
                if (!Array.isArray(floorNodes)) continue;
                for (const floorNode of floorNodes) {
                    if (!floorNode || !Array.isArray(floorNode.neighborOffsets) ||
                        !Array.isArray(floorNode.neighbors)) continue;
                    for (let d = 0; d < floorNode.neighborOffsets.length; d++) {
                        const offset = floorNode.neighborOffsets[d];
                        if (!offset) continue;
                        const neighborNode = this.getFloorNodeBySurface(
                            floorNode.surfaceId,
                            Number(floorNode.xindex) + Number(offset.x),
                            Number(floorNode.yindex) + Number(offset.y)
                        );
                        if (!neighborNode) continue;
                        floorNode.neighbors[d] = neighborNode;
                        connectionCount += 1;
                    }
                }
            }
            return connectionCount;
        },
        resolveFloorTransitionEndpoint(endpoint) {
            if (!endpoint || typeof endpoint !== "object") return null;
            const x = Number(endpoint.x);
            const y = Number(endpoint.y);
            if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
            const fragmentId = (typeof endpoint.fragmentId === "string" && endpoint.fragmentId.length > 0)
                ? endpoint.fragmentId
                : ((typeof endpoint.floorId === "string" && endpoint.floorId.length > 0)
                    ? endpoint.floorId : "");
            if (fragmentId && this.floorsById instanceof Map) {
                const fragment = this.floorsById.get(fragmentId) || null;
                const surfaceId = fragment && typeof fragment.surfaceId === "string"
                    ? fragment.surfaceId
                    : ((typeof endpoint.surfaceId === "string" && endpoint.surfaceId.length > 0)
                        ? endpoint.surfaceId : "");
                const directNode = this.floorNodeIndex.get(
                    this.getFloorNodeKey(x, y, surfaceId, fragmentId)
                ) || null;
                if (directNode) return directNode;
            }
            if (typeof endpoint.surfaceId === "string" && endpoint.surfaceId.length > 0) {
                return this.getFloorNodeBySurface(endpoint.surfaceId, x, y);
            }
            return null;
        },
        connectFloorTransitions() {
            let connectionCount = 0;
            for (const transition of this.transitionsById.values()) {
                const fromNode = this.resolveFloorTransitionEndpoint(transition.from);
                const toNode = this.resolveFloorTransitionEndpoint(transition.to);
                if (!fromNode || !toNode) continue;
                const attachEdge = (sourceNode, targetNode) => {
                    if (!Array.isArray(sourceNode.portalEdges)) sourceNode.portalEdges = [];
                    const exists = sourceNode.portalEdges.some(
                        (e) => e && e.toNode === targetNode &&
                            e.metadata && e.metadata.transitionId === transition.id
                    );
                    if (exists) return false;
                    sourceNode.portalEdges.push({
                        fromNode: sourceNode,
                        toNode: targetNode,
                        type: transition.type || "portal",
                        movementCost: Number.isFinite(transition.movementCost)
                            ? Number(transition.movementCost) : 1,
                        penalty: Number.isFinite(transition.penalty)
                            ? Number(transition.penalty) : 0,
                        zProfile: (typeof transition.zProfile === "string" && transition.zProfile.length > 0)
                            ? transition.zProfile : "linear",
                        metadata: {
                            ...(transition.metadata && typeof transition.metadata === "object"
                                ? transition.metadata : {}),
                            kind: transition.type || "portal",
                            transitionId: transition.id
                        }
                    });
                    return true;
                };
                const attachGroundSourceMirror = (endpointNode, targetNode) => {
                    if (!endpointNode || !targetNode || !endpointNode.sourceNode) return false;
                    if (Number(endpointNode.level) !== 0) return false;
                    return attachEdge(endpointNode.sourceNode, targetNode);
                };
                if (attachEdge(fromNode, toNode)) connectionCount += 1;
                if (attachGroundSourceMirror(fromNode, toNode)) connectionCount += 1;
                if (transition.bidirectional !== false && attachEdge(toNode, fromNode)) connectionCount += 1;
                if (transition.bidirectional !== false && attachGroundSourceMirror(toNode, fromNode)) connectionCount += 1;
            }
            return connectionCount;
        },
        rebuildFloorRuntimeFromSectionState(sectionState, options = {}) {
            this.resetFloorRuntimeState();
            if (!sectionState || !(sectionState.sectionAssetsByKey instanceof Map) ||
                !(sectionState.nodesBySectionKey instanceof Map)) {
                return { fragmentCount: 0, nodeCount: 0, transitionCount: 0 };
            }
            const synthesizeGroundFragment = (typeof options.synthesizeGroundFragment === "function")
                ? options.synthesizeGroundFragment : null;
            const doesNodeBelongToFragment = (typeof options.doesNodeBelongToFragment === "function")
                ? options.doesNodeBelongToFragment : (() => true);
            const transitions = Array.isArray(options.transitions)
                ? options.transitions
                : (Array.isArray(sectionState.floorTransitions) ? sectionState.floorTransitions : []);
            let fragmentCount = 0;
            let nodeCount = 0;
            for (const [, sectionNodes] of sectionState.nodesBySectionKey.entries()) {
                const asset = sectionState.sectionAssetsByKey.get(
                    sectionNodes.length > 0 ? sectionNodes[0]._prototypeSectionKey : ""
                ) || null;
                if (!asset) continue;
                const authoredFragments = Array.isArray(asset.floors) ? asset.floors.slice() : [];
                const hasGroundFragment = authoredFragments.some((f) => Number(f && f.level) === 0);
                if (!hasGroundFragment && synthesizeGroundFragment) {
                    const synthesized = synthesizeGroundFragment(asset);
                    if (synthesized) authoredFragments.unshift(synthesized);
                }
                for (const rawFrag of authoredFragments) {
                    const registeredFragment = this.registerFloorFragment(rawFrag);
                    if (!registeredFragment) continue;
                    fragmentCount += 1;
                    const materializedNodeKeys = [];
                    for (const sourceNode of sectionNodes) {
                        if (!doesNodeBelongToFragment(sourceNode, registeredFragment)) continue;
                        const floorNode = this.createFloorNodeFromSource(sourceNode, registeredFragment, {
                            baseZ: Number.isFinite(registeredFragment.nodeBaseZ)
                                ? Number(registeredFragment.nodeBaseZ) : 0,
                            traversalLayer: Number.isFinite(registeredFragment.level)
                                ? Number(registeredFragment.level) : 0
                        });
                        if (!floorNode) continue;
                        nodeCount += 1;
                        materializedNodeKeys.push(`${floorNode.xindex},${floorNode.yindex}`);
                    }
                    registeredFragment.materializedNodeKeys = materializedNodeKeys;
                }
            }
            let transitionCount = 0;
            for (const t of transitions) {
                if (this.registerFloorTransition(t)) transitionCount += 1;
            }
            this.connectFloorNodeNeighbors();
            this.connectFloorTransitions();
            const stats = { fragmentCount, nodeCount, transitionCount };
            sectionState.floorRuntimeStats = stats;
            return stats;
        },
        computeClearance() {},
        rebuildGameObjectRegistry() {}
    };
}

// ── BFS path finder ────────────────────────────────────────────────────────
// Traverses node.neighbors (planar moves) and node.portalEdges (floor
// transitions, stairs, ziplines, etc.).  Returns { nodes, edges } or null.

function bfsPath(start, goal) {
    if (start === goal) return { nodes: [start], edges: [] };
    const queue = [{ path: [start], edges: [] }];
    const visited = new Set([start]);
    while (queue.length > 0) {
        const { path, edges } = queue.shift();
        const node = path[path.length - 1];
        const tryVisit = (target, edge) => {
            if (!target || visited.has(target)) return null;
            const newPath = [...path, target];
            const newEdges = [...edges, edge];
            if (target === goal) return { nodes: newPath, edges: newEdges };
            visited.add(target);
            queue.push({ path: newPath, edges: newEdges });
            return null;
        };
        if (Array.isArray(node.neighbors)) {
            for (const neighbor of node.neighbors) {
                if (!neighbor) continue;
                const result = tryVisit(neighbor,
                    { type: "planar", fromNode: node, toNode: neighbor });
                if (result) return result;
            }
        }
        if (Array.isArray(node.portalEdges)) {
            for (const edge of node.portalEdges) {
                if (!edge || !edge.toNode) continue;
                const result = tryVisit(edge.toNode, edge);
                if (result) return result;
            }
        }
    }
    return null;
}

// ── Bundle builder ─────────────────────────────────────────────────────────

function buildPentagonBundle() {
    return {
        version: 1,
        activeCenterKey: "0,0",
        sections: [
            {
                id: "section-0,0",
                key: "0,0",
                coord: { q: 0, r: 0 },
                centerAxial: { q: 0, r: 0 },
                centerOffset: { x: 0, y: 0 },
                neighborKeys: ["1,0"],
                // Ground row (0,2)–(4,2) plus the two off-axis pentagon tiles
                tileCoordKeys: ["0,2", "1,2", "2,2", "3,2", "4,2", "4,1", "4,3"],
                groundTextureId: 0,
                groundTiles: {
                    "0,2": 0, "1,2": 0, "2,2": 0,
                    "3,2": 0, "4,2": 0, "4,1": 0, "4,3": 0
                },
                floors: [
                    {
                        fragmentId: "pentagon_left",
                        surfaceId: "pentagon_surface",
                        ownerSectionKey: "0,0",
                        level: 1,
                        nodeBaseZ: 3,
                        tileCoordKeys: ["3,2", "4,1", "4,2", "4,3"]
                    }
                ],
                walls: [], objects: [], animals: [], powerups: []
            },
            {
                id: "section-1,0",
                key: "1,0",
                coord: { q: 1, r: 0 },
                centerAxial: { q: 1, r: 0 },
                centerOffset: { x: 5, y: 0 },
                neighborKeys: ["0,0"],
                tileCoordKeys: ["5,2", "6,2", "7,2"],
                groundTextureId: 0,
                groundTiles: { "5,2": 0, "6,2": 0, "7,2": 0 },
                floors: [
                    {
                        fragmentId: "pentagon_right",
                        surfaceId: "pentagon_surface",
                        ownerSectionKey: "1,0",
                        level: 1,
                        nodeBaseZ: 3,
                        tileCoordKeys: ["5,2"]
                    }
                ],
                walls: [], objects: [], animals: [], powerups: []
            }
        ],
        transitions: [
            {
                id: "stairs_up",
                type: "stairs",
                from: { x: 3, y: 2, floorId: "section:0,0:ground" },
                to:   { x: 3, y: 2, floorId: "pentagon_left" },
                bidirectional: false,
                movementCost: 2,
                zProfile: "linear"
            },
            {
                id: "zipline_down",
                type: "zipline",
                from: { x: 5, y: 2, floorId: "pentagon_right" },
                to:   { x: 6, y: 2, floorId: "section:1,0:ground" },
                bidirectional: false,
                movementCost: 1,
                zProfile: "linear"
            }
        ]
    };
}

// ── Shared setup helper ────────────────────────────────────────────────────

function buildPentagonTestMap() {
    const map = createPrototypeMap();
    attachPrototypeApis(map, createPrototypeState({
        radius: 3,
        sectionGraphRadius: 0,
        sectionCoords: [],
        sectionsByKey: new Map(),
        orderedSections: [],
        sectionAssetsByKey: new Map(),
        orderedSectionAssets: [],
        anchorCenter: { q: 0, r: 0 },
        nextRecordIds: { walls: 1, objects: 1, animals: 1, powerups: 1 }
    }, "0,0"));
    globalThis.map = map;
    globalThis.animals = [];
    globalThis.powerups = [];
    globalThis.roofs = [];
    const ok = map.loadPrototypeSectionWorld(buildPentagonBundle());
    assert.ok(ok, "loadPrototypeSectionWorld should return true");
    return map;
}

test.afterEach(() => { restorePrototypeGlobals(); });

// ── Test 1: Pentagon floor is materialised across both sections ─────────────

test("pentagon floor: both section fragments share pentagon_surface with 5 nodes total", () => {
    const map = buildPentagonTestMap();

    // Both fragments registered under "pentagon_surface"
    const pentagonFragments = map.floorFragmentsBySurfaceId.get("pentagon_surface");
    assert.ok(pentagonFragments instanceof Set, "pentagon_surface fragments should exist");
    assert.deepEqual(
        Array.from(pentagonFragments).sort(),
        ["pentagon_left", "pentagon_right"]
    );

    // Left fragment: 4 tiles; right fragment: 1 tile
    const leftNodes  = map.floorNodesById.get("pentagon_left")  || [];
    const rightNodes = map.floorNodesById.get("pentagon_right") || [];
    assert.equal(leftNodes.length,  4, "left  pentagon fragment has 4 floor nodes");
    assert.equal(rightNodes.length, 1, "right pentagon fragment has 1 floor node");

    // All pentagon floor nodes are at level 1 with the correct surface
    for (const fn of [...leftNodes, ...rightNodes]) {
        assert.equal(fn.level, 1, `floor node (${fn.xindex},${fn.yindex}) should be level 1`);
        assert.equal(fn.surfaceId, "pentagon_surface");
    }

    // Right fragment's node is at (5,2)
    const rightNode = rightNodes[0];
    assert.equal(rightNode.xindex, 5);
    assert.equal(rightNode.yindex, 2);

    // The (4,2) floor node in the left fragment and the (5,2) node in the right
    // fragment must be connected as floor neighbours across the section seam.
    const leftNodeAt42 = leftNodes.find((n) => n.xindex === 4 && n.yindex === 2);
    assert.ok(leftNodeAt42, "left fragment should have a floor node at (4,2)");
    assert.ok(
        leftNodeAt42.neighbors.includes(rightNode) || rightNode.neighbors.includes(leftNodeAt42),
        "floor nodes at (4,2) and (5,2) are connected as neighbours across sections"
    );
});

// ── Test 2: Stairs mirror a portal edge onto the ground grid node ───────────

test("stairs_up transition attaches a 'stairs' portal edge to G(3,2) pointing at the pentagon floor", () => {
    const map = buildPentagonTestMap();
    const state = map._prototypeSectionState;

    // The grid source node at (3,2) is the stair base
    const groundGridNode = state.allNodesByCoordKey.get("3,2");
    assert.ok(groundGridNode, "grid node at (3,2) should exist");

    assert.ok(Array.isArray(groundGridNode.portalEdges), "G(3,2) should have portalEdges");
    const stairEdge = groundGridNode.portalEdges.find(
        (e) => e && e.type === "stairs" && e.metadata && e.metadata.transitionId === "stairs_up"
    );
    assert.ok(stairEdge, "G(3,2) should have a 'stairs' portal edge for stairs_up");

    // Destination: pentagon floor node at (3,2) level 1
    const dest = stairEdge.toNode;
    assert.ok(dest, "stair edge must reference a toNode");
    assert.equal(dest.xindex,    3);
    assert.equal(dest.yindex,    2);
    assert.equal(dest.level,     1, "stair destination should be level 1");
    assert.equal(dest.fragmentId, "pentagon_left");
    assert.equal(dest.surfaceId,  "pentagon_surface");
});

// ── Test 3: Zipline portal edge goes from pentagon floor to ground floor ────

test("zipline_down transition attaches a 'zipline' portal edge from F_pentagon(5,2) to F_ground(6,2)", () => {
    const map = buildPentagonTestMap();

    // The single node in the right pentagon fragment is the zipline platform
    const platform = (map.floorNodesById.get("pentagon_right") || [])[0];
    assert.ok(platform, "pentagon_right should contain a floor node");
    assert.equal(platform.xindex, 5);
    assert.equal(platform.yindex, 2);

    assert.ok(Array.isArray(platform.portalEdges), "F_pentagon(5,2) should have portalEdges");
    const ziplineEdge = platform.portalEdges.find(
        (e) => e && e.type === "zipline" && e.metadata && e.metadata.transitionId === "zipline_down"
    );
    assert.ok(ziplineEdge, "F_pentagon(5,2) should have a 'zipline' portal edge for zipline_down");

    // Landing: level-0 ground floor node at (6,2)
    const landing = ziplineEdge.toNode;
    assert.ok(landing, "zipline edge must reference a toNode");
    assert.equal(landing.xindex, 6);
    assert.equal(landing.yindex, 2);
    assert.equal(landing.level, 0, "zipline landing should be at level 0");
    assert.equal(landing.surfaceId,  "overworld_ground_surface");
    assert.equal(landing.fragmentId, "section:1,0:ground");
});

// ── Test 4: Full pathfinding integration ───────────────────────────────────
// BFS from the left-section ground entry point to the right-section ground
// exit.  The ONLY path forces the character through the pentagon floor via
// stairs up and zipline down.

test("BFS path from G(0,2) to F_ground(7,2) routes through stairs up and zipline down in the correct order", () => {
    const map = buildPentagonTestMap();
    const state = map._prototypeSectionState;

    // Start: grid node at (0,2) — the leftmost ground tile
    const startNode = state.allNodesByCoordKey.get("0,2");
    assert.ok(startNode, "start node G(0,2) should exist");

    // Goal: level-0 floor node at (7,2) — the far right ground tile.
    // Only reachable via the zipline because grid nodes are not connected to floor
    // nodes except through defined transitions.
    const goalNode = map.getFloorNodeBySurface("overworld_ground_surface", 7, 2);
    assert.ok(goalNode, "ground floor node F_ground(7,2) should exist");
    assert.equal(goalNode.level, 0);

    const result = bfsPath(startNode, goalNode);
    assert.ok(result, "BFS should find a path from G(0,2) to F_ground(7,2)");

    const { nodes: pathNodes, edges: pathEdges } = result;

    // ── Waypoint checks ───────────────────────────────────────────────────

    const stairBase = state.allNodesByCoordKey.get("3,2");
    assert.ok(pathNodes.includes(stairBase), "path visits the stair base G(3,2)");

    const stairTop = (map.floorNodesById.get("pentagon_left") || [])
        .find((n) => n.xindex === 3 && n.yindex === 2);
    assert.ok(stairTop, "floor node F_pentagon(3,2) should exist");
    assert.ok(pathNodes.includes(stairTop), "path visits the stair top F_pentagon(3,2)");

    const ziplinePlatform = (map.floorNodesById.get("pentagon_right") || [])[0];
    assert.ok(pathNodes.includes(ziplinePlatform), "path visits the zipline platform F_pentagon(5,2)");

    const ziplineLanding = map.getFloorNodeBySurface("overworld_ground_surface", 6, 2);
    assert.ok(ziplineLanding, "ground floor node F_ground(6,2) should exist");
    assert.ok(pathNodes.includes(ziplineLanding), "path visits the zipline landing F_ground(6,2)");

    assert.ok(pathNodes.includes(goalNode), "path reaches the goal F_ground(7,2)");

    // ── Edge-type checks ──────────────────────────────────────────────────

    const stairsEdge = pathEdges.find((e) => e && e.type === "stairs");
    assert.ok(stairsEdge, "path contains a stairs edge");
    assert.equal(
        stairsEdge.metadata && stairsEdge.metadata.transitionId,
        "stairs_up",
        "stairs edge has correct transitionId"
    );
    // The stairs edge lands on the level-1 pentagon floor
    assert.equal(stairsEdge.toNode.level, 1, "stairs edge arrives at level-1 floor node");

    const ziplineEdge = pathEdges.find((e) => e && e.type === "zipline");
    assert.ok(ziplineEdge, "path contains a zipline edge");
    assert.equal(
        ziplineEdge.metadata && ziplineEdge.metadata.transitionId,
        "zipline_down",
        "zipline edge has correct transitionId"
    );
    // The zipline departs from level-1 and arrives at level-0
    assert.equal(ziplineEdge.fromNode.level, 1, "zipline departs from level-1 floor node");
    assert.equal(ziplineEdge.toNode.level,   0, "zipline arrives at level-0 floor node");

    // ── Ordering checks ───────────────────────────────────────────────────
    // Verify that the waypoints appear in the expected sequence along the path.

    const idx = (node) => pathNodes.indexOf(node);
    assert.ok(idx(stairBase)       < idx(stairTop),        "stair base before stair top");
    assert.ok(idx(stairTop)        < idx(ziplinePlatform), "stair top before zipline platform");
    assert.ok(idx(ziplinePlatform) < idx(ziplineLanding),  "zipline platform before landing");
    assert.ok(idx(ziplineLanding)  < idx(goalNode),        "zipline landing before goal");
});
