/**
 * Regression tests for section-world persistence round-trips.
 *
 * These tests guard against the class of bugs where map data (static objects,
 * trigger areas) gets corrupted, misplaced, or silently dropped between save
 * and load cycles.  They operate entirely in Node with no browser APIs.
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    attachPrototypeApis,
    createPrototypeState,
    initializePrototypeRuntimeState,
} = require("../public/assets/javascript/prototypes/sectionWorld.js");

// ---------------------------------------------------------------------------
// Minimal test infrastructure (mirrors createPrototypeMap / createPrototypeBundle
// from sectionWorld.test.js so this file is self-contained)
// ---------------------------------------------------------------------------

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
                    ? fragment.surfaceId : fragmentId,
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
            for (const k of ["_prototypeSectionKey", "_prototypeSectionActive", "_prototypeVoid"]) {
                if (Object.prototype.hasOwnProperty.call(sourceNode, k)) floorNode[k] = sourceNode[k];
            }
            floorNode.surfaceId = (typeof fragment.surfaceId === "string") ? fragment.surfaceId : "";
            floorNode.fragmentId = (typeof fragment.fragmentId === "string") ? fragment.fragmentId : "";
            floorNode.ownerSectionKey = (typeof fragment.ownerSectionKey === "string") ? fragment.ownerSectionKey : "";
            floorNode.level = Number.isFinite(fragment.level) ? Number(fragment.level) : 0;
            floorNode.traversalLayer = Number.isFinite(options.traversalLayer) ? Number(options.traversalLayer) : floorNode.level;
            floorNode.baseZ = Number.isFinite(options.baseZ) ? Number(options.baseZ) : (Number.isFinite(fragment.nodeBaseZ) ? Number(fragment.nodeBaseZ) : 0);
            floorNode.portalEdges = [];
            floorNode.neighborOffsets = Array.isArray(sourceNode.neighborOffsets)
                ? sourceNode.neighborOffsets.slice() : new Array(12).fill(null);
            floorNode.clearance = Number.isFinite(sourceNode.clearance) ? Number(sourceNode.clearance) : Infinity;
            floorNode.blocked = false;
            floorNode.blockedByObjects = 0;
            return this.registerFloorNode(floorNode, fragment);
        },
        registerFloorTransition(transition) {
            if (!transition || typeof transition !== "object") return null;
            if (!(this.transitionsById instanceof Map)) this.resetFloorRuntimeState();
            const transitionId = (typeof transition.id === "string" && transition.id.length > 0) ? transition.id : "";
            if (!transitionId) return null;
            const normalized = {
                ...transition, id: transitionId,
                metadata: (transition.metadata && typeof transition.metadata === "object") ? { ...transition.metadata } : {}
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
        connectFloorNodeNeighbors() { return 0; },
        resolveFloorTransitionEndpoint(endpoint) {
            if (!endpoint || typeof endpoint !== "object") return null;
            const x = Number(endpoint.x);
            const y = Number(endpoint.y);
            if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
            const fragmentId = (typeof endpoint.fragmentId === "string" && endpoint.fragmentId.length > 0)
                ? endpoint.fragmentId
                : ((typeof endpoint.floorId === "string" && endpoint.floorId.length > 0) ? endpoint.floorId : "");
            if (fragmentId && this.floorsById instanceof Map) {
                const fragment = this.floorsById.get(fragmentId) || null;
                const surfaceId = fragment && typeof fragment.surfaceId === "string"
                    ? fragment.surfaceId
                    : ((typeof endpoint.surfaceId === "string" && endpoint.surfaceId.length > 0) ? endpoint.surfaceId : "");
                const directNode = this.floorNodeIndex.get(this.getFloorNodeKey(x, y, surfaceId, fragmentId)) || null;
                if (directNode) return directNode;
            }
            if (typeof endpoint.surfaceId === "string" && endpoint.surfaceId.length > 0) {
                return this.getFloorNodeBySurface(endpoint.surfaceId, x, y);
            }
            return null;
        },
        connectFloorTransitions() { return 0; },
        rebuildFloorRuntimeFromSectionState(sectionState, options = {}) {
            this.resetFloorRuntimeState();
            if (!sectionState || !(sectionState.sectionAssetsByKey instanceof Map) || !(sectionState.nodesBySectionKey instanceof Map)) {
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
            for (const [sectionKey, sectionNodes] of sectionState.nodesBySectionKey.entries()) {
                const asset = sectionState.sectionAssetsByKey.get(sectionKey) || null;
                if (!asset) continue;
                const authoredFragments = Array.isArray(asset.floors) ? asset.floors.slice() : [];
                const hasGroundFragment = authoredFragments.some(f => Number(f && f.level) === 0);
                if (!hasGroundFragment && synthesizeGroundFragment) {
                    const g = synthesizeGroundFragment(asset);
                    if (g) authoredFragments.unshift(g);
                }
                for (let i = 0; i < authoredFragments.length; i++) {
                    const reg = this.registerFloorFragment(authoredFragments[i]);
                    if (!reg) continue;
                    fragmentCount += 1;
                    for (let n = 0; n < sectionNodes.length; n++) {
                        const sourceNode = sectionNodes[n];
                        if (!doesNodeBelongToFragment(sourceNode, reg)) continue;
                        const floorNode = this.createFloorNodeFromSource(sourceNode, reg, {
                            baseZ: Number.isFinite(reg.nodeBaseZ) ? Number(reg.nodeBaseZ) : 0,
                            traversalLayer: Number.isFinite(reg.level) ? Number(reg.level) : 0
                        });
                        if (floorNode) nodeCount += 1;
                    }
                }
            }
            let transitionCount = 0;
            for (let i = 0; i < transitions.length; i++) {
                if (this.registerFloorTransition(transitions[i])) transitionCount += 1;
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

function createEmptyPrototypeState() {
    return createPrototypeState({
        radius: 3,
        sectionGraphRadius: 0,
        sectionCoords: [],
        sectionsByKey: new Map(),
        orderedSections: [],
        sectionAssetsByKey: new Map(),
        orderedSectionAssets: [],
        anchorCenter: { q: 0, r: 0 },
        nextRecordIds: { walls: 1, objects: 1, animals: 1, powerups: 1 }
    }, "0,0");
}

/** Minimal section descriptor shared by multiple tests. */
function makeSectionDescriptor(key, coord, centerAxial, centerOffset, tileCoordKey) {
    return {
        id: `section-${key}`,
        key,
        coord,
        centerAxial,
        centerOffset,
        neighborKeys: [],
        tileCoordKeys: [tileCoordKey],
        groundTextureId: 0,
        groundTiles: { [tileCoordKey]: 0 },
        walls: [],
        objects: [],
        animals: [],
        powerups: []
    };
}

/**
 * Extract the map's current state into a bundle that `loadPrototypeSectionWorld`
 * can consume.  This mirrors the logic in filesystem.js `capturePrototypeSaveData`.
 */
function extractSaveBundle(map) {
    const state = map._prototypeSectionState;
    const sections = [];
    for (const [key, asset] of state.sectionAssetsByKey.entries()) {
        sections.push({
            key,
            coord: asset.coord ? { ...asset.coord } : { q: 0, r: 0 },
            centerAxial: asset.centerAxial ? { ...asset.centerAxial } : { q: 0, r: 0 },
            centerOffset: asset.centerOffset ? { ...asset.centerOffset } : { x: 0, y: 0 },
            neighborKeys: Array.isArray(asset.neighborKeys) ? asset.neighborKeys.slice() : [],
            tileCoordKeys: Array.isArray(asset.tileCoordKeys) ? asset.tileCoordKeys.slice() : [],
            groundTextureId: Number.isFinite(asset.groundTextureId) ? Number(asset.groundTextureId) : 0,
            groundTiles: { ...(asset.groundTiles || {}) },
            walls: (asset.walls || []).map(w => ({ ...w })),
            objects: (asset.objects || []).map(o => ({ ...o })),
            animals: (asset.animals || []).map(a => ({ ...a })),
            powerups: (asset.powerups || []).map(p => ({ ...p }))
        });
    }
    return {
        version: 2,
        radius: state.radius,
        anchorCenter: state.anchorCenter ? { ...state.anchorCenter } : { q: 0, r: 0 },
        activeCenterKey: state.activeCenterKey || "0,0",
        sectionCoords: [...state.sectionsByKey.values()].map(s => ({ ...s.coord })),
        sections,
        triggers: (typeof map.exportPrototypeTriggerDefinitions === "function")
            ? map.exportPrototypeTriggerDefinitions()
            : []
    };
}

/** Boot a fresh map with the APIs attached and the given bundle loaded. */
function loadFreshMap(bundle) {
    const map = createPrototypeMap();
    attachPrototypeApis(map, createEmptyPrototypeState());
    globalThis.map = map;
    globalThis.animals = [];
    globalThis.powerups = [];
    globalThis.roofs = [];
    assert.equal(map.loadPrototypeSectionWorld(bundle), true);
    return map;
}

test.afterEach(() => {
    restorePrototypeGlobals();
});

// ---------------------------------------------------------------------------
// Test 1: static objects survive a save → load round-trip in the correct section
// ---------------------------------------------------------------------------

test("persistence round-trip: static objects stay in their original section", () => {
    const initialBundle = {
        version: 2,
        activeCenterKey: "0,0",
        anchorCenter: { q: 0, r: 0 },
        sectionCoords: [{ q: 0, r: 0 }, { q: 1, r: 0 }],
        sections: [
            {
                ...makeSectionDescriptor("0,0", { q: 0, r: 0 }, { q: 0, r: 0 }, { x: 0, y: 0 }, "0,0"),
                objects: [{ id: 1, type: "flower", x: 0, y: 0, assetPath: "flowers/daisy.png" }]
            },
            {
                ...makeSectionDescriptor("1,0", { q: 1, r: 0 }, { q: 5, r: -2 }, { x: 5, y: 1 }, "1,0"),
                objects: []
            }
        ],
        triggers: []
    };

    // --- first load ---
    const map1 = loadFreshMap(initialBundle);

    const s00 = map1.getPrototypeSectionAsset("0,0");
    const s10 = map1.getPrototypeSectionAsset("1,0");
    assert.ok(s00, "section 0,0 should exist after initial load");
    assert.ok(s10, "section 1,0 should exist after initial load");
    assert.equal(s00.objects.length, 1, "section 0,0 should have 1 object after initial load");
    assert.equal(s00.objects[0].type, "flower", "object type should be flower");
    assert.equal(s10.objects.length, 0, "section 1,0 should have no objects");

    // --- extract bundle and reload ---
    const savedBundle = extractSaveBundle(map1);
    const map2 = loadFreshMap(savedBundle);

    const s00b = map2.getPrototypeSectionAsset("0,0");
    const s10b = map2.getPrototypeSectionAsset("1,0");
    assert.ok(s00b, "section 0,0 should exist after round-trip");
    assert.ok(s10b, "section 1,0 should exist after round-trip");
    assert.equal(s00b.objects.length, 1, "section 0,0 should still have 1 object after round-trip");
    assert.equal(s00b.objects[0].type, "flower", "object type should survive round-trip");
    assert.equal(s00b.objects[0].x, 0, "object x-position should survive round-trip");
    assert.equal(s10b.objects.length, 0, "section 1,0 should still have no objects after round-trip");
});

// ---------------------------------------------------------------------------
// Test 2: trigger areas survive a save → load round-trip via the triggers array
// ---------------------------------------------------------------------------

test("persistence round-trip: trigger area definitions survive via the triggers array", () => {
    const triggerPoints = [
        { x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }
    ];

    const initialBundle = {
        version: 2,
        activeCenterKey: "0,0",
        anchorCenter: { q: 0, r: 0 },
        sectionCoords: [{ q: 0, r: 0 }],
        sections: [
            makeSectionDescriptor("0,0", { q: 0, r: 0 }, { q: 0, r: 0 }, { x: 0, y: 0 }, "0,0")
        ],
        triggers: [
            {
                id: 42,
                type: "triggerArea",
                x: 0, y: 0,
                points: triggerPoints,
                coverageSectionKeys: ["0,0"],
                scriptingName: "myTrigger"
            }
        ]
    };

    // --- first load ---
    const map1 = loadFreshMap(initialBundle);

    const triggerState1 = map1._prototypeTriggerState;
    assert.ok(triggerState1, "trigger state should be initialized");
    assert.equal(triggerState1.triggerDefsById.size, 1, "one trigger should be registered after initial load");
    const def1 = triggerState1.triggerDefsById.get(42);
    assert.ok(def1, "trigger should be retrievable by id 42");
    assert.equal(def1.type, "triggerArea");
    assert.equal(def1.scriptingName, "myTrigger");
    assert.equal(def1.points.length, 4, "trigger points should be intact");

    // exportPrototypeTriggerDefinitions must include it
    const exported1 = map1.exportPrototypeTriggerDefinitions();
    assert.equal(exported1.length, 1, "exportPrototypeTriggerDefinitions should return 1 trigger");
    assert.equal(exported1[0].id, 42);
    assert.ok(Array.isArray(exported1[0].coverageSectionKeys), "exported trigger should have coverageSectionKeys");

    // --- extract bundle and reload ---
    const savedBundle = extractSaveBundle(map1);
    assert.equal(savedBundle.triggers.length, 1, "saved bundle should contain 1 trigger");

    const map2 = loadFreshMap(savedBundle);

    const triggerState2 = map2._prototypeTriggerState;
    assert.ok(triggerState2, "trigger state should be present after round-trip");
    assert.equal(triggerState2.triggerDefsById.size, 1, "trigger should survive round-trip");
    const def2 = triggerState2.triggerDefsById.get(42);
    assert.ok(def2, "trigger id 42 should survive round-trip");
    assert.equal(def2.type, "triggerArea");
    assert.equal(def2.scriptingName, "myTrigger", "scriptingName should survive round-trip");
    assert.equal(def2.points.length, 4, "points should survive round-trip");

    // trigger should be discoverable via getPrototypeTriggerDefsForSectionKeys
    const defsForSection = map2.getPrototypeTriggerDefsForSectionKeys(["0,0"]);
    assert.equal(defsForSection.length, 1, "trigger should be found by section key after round-trip");
    assert.equal(defsForSection[0].id, 42);
});

// ---------------------------------------------------------------------------
// Test 3: trigger areas must NOT appear in any section's objects array
// (they should only live in triggerDefsById / the triggers array of the bundle)
// ---------------------------------------------------------------------------

test("persistence round-trip: trigger areas are not double-saved in section objects arrays", () => {
    const triggerPoints = [
        { x: -1, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 1 }, { x: -1, y: 1 }
    ];

    const initialBundle = {
        version: 2,
        activeCenterKey: "0,0",
        anchorCenter: { q: 0, r: 0 },
        sectionCoords: [{ q: 0, r: 0 }],
        sections: [
            {
                ...makeSectionDescriptor("0,0", { q: 0, r: 0 }, { q: 0, r: 0 }, { x: 0, y: 0 }, "0,0"),
                // Simulate the legacy format where a trigger area was accidentally placed in objects
                objects: [
                    { id: 5, type: "flower", x: 0, y: 0, assetPath: "flowers/daisy.png" },
                    { id: 6, type: "triggerArea", x: 0, y: 0, points: triggerPoints, coverageSectionKeys: ["0,0"] }
                ]
            }
        ],
        triggers: []
    };

    const map1 = loadFreshMap(initialBundle);

    // The import layer strips trigger records out of section objects arrays and
    // routes them to triggerDefsById instead.
    const s00 = map1.getPrototypeSectionAsset("0,0");
    assert.equal(s00.objects.length, 1, "triggerArea should be stripped from section objects during import");
    assert.equal(s00.objects[0].type, "flower", "non-trigger object should remain");

    assert.equal(map1._prototypeTriggerState.triggerDefsById.size, 1, "trigger should be registered in triggerDefsById");

    // After round-trip the trigger still does not bleed into section objects
    const savedBundle = extractSaveBundle(map1);
    const map2 = loadFreshMap(savedBundle);

    const s00b = map2.getPrototypeSectionAsset("0,0");
    assert.equal(s00b.objects.length, 1, "section objects should still have only the flower after round-trip");
    assert.equal(s00b.objects[0].type, "flower");
    assert.equal(map2._prototypeTriggerState.triggerDefsById.size, 1, "trigger should still be in registry after round-trip");
});

// ---------------------------------------------------------------------------
// Test 4: capturePendingPrototypeObjects routes a new runtime object to the
//         correct section — the regression that caused the original corruption
// ---------------------------------------------------------------------------

test("persistence round-trip: capturePendingPrototypeObjects saves object to owner section, not a sibling", () => {
    const initialBundle = {
        version: 2,
        activeCenterKey: "0,0",
        anchorCenter: { q: 0, r: 0 },
        sectionCoords: [{ q: 0, r: 0 }, { q: 1, r: 0 }],
        sections: [
            makeSectionDescriptor("0,0", { q: 0, r: 0 }, { q: 0, r: 0 }, { x: 0, y: 0 }, "0,0"),
            makeSectionDescriptor("1,0", { q: 1, r: 0 }, { q: 5, r: -2 }, { x: 5, y: 1 }, "1,0")
        ],
        triggers: []
    };

    const map = loadFreshMap(initialBundle);

    // After loadPrototypeSectionWorld the single test node (0,0) gets assigned to
    // section "0,0".  Use that node as the owner node for our mock runtime object.
    const loadedNode = map._prototypeSectionState.loadedNodes[0];
    assert.ok(loadedNode, "at least one node should be loaded");
    assert.equal(loadedNode._prototypeSectionKey, "0,0", "test node should be assigned to section 0,0");

    // Create a minimal runtime object that mimics what a freshly-placed StaticObject
    // looks like before it has been persisted.
    const mockRuntimeObj = {
        type: "flower",
        x: 0,
        y: 0,
        _prototypeDirty: true,
        _prototypeRuntimeRecord: false,
        getNode() { return loadedNode; },
        saveJson() {
            return { type: "flower", x: this.x, y: this.y, assetPath: "flowers/rose.png" };
        }
    };

    // Inject the object into the dirty-tracking state exactly as the dirty-tracking
    // hook does when an object is mutated.
    const objectState = map._prototypeObjectState;
    assert.ok(objectState, "objectState should exist");
    objectState.dirtyRuntimeObjects.add(mockRuntimeObj);
    objectState.captureScanNeeded = true;

    const captured = map.capturePendingPrototypeObjects();
    assert.equal(captured, true, "capturePendingPrototypeObjects should return true when objects were saved");

    // The object must have been routed to section "0,0", not "1,0".
    const s00 = map.getPrototypeSectionAsset("0,0");
    const s10 = map.getPrototypeSectionAsset("1,0");
    assert.equal(s00.objects.length, 1, "object should be saved into section 0,0");
    assert.equal(s00.objects[0].type, "flower", "saved record type should match");
    assert.equal(s10.objects.length, 0, "section 1,0 should have no objects");

    // Now verify the round-trip preserves this assignment.
    const savedBundle = extractSaveBundle(map);
    const map2 = loadFreshMap(savedBundle);

    const s00b = map2.getPrototypeSectionAsset("0,0");
    const s10b = map2.getPrototypeSectionAsset("1,0");
    assert.equal(s00b.objects.length, 1, "object should still be in section 0,0 after round-trip");
    assert.equal(s00b.objects[0].type, "flower");
    assert.equal(s10b.objects.length, 0, "section 1,0 should still be empty after round-trip");
});

// ---------------------------------------------------------------------------
// Test 5: multiple trigger areas with distinct ids all survive round-trip
// ---------------------------------------------------------------------------

test("persistence round-trip: multiple trigger areas all survive with distinct ids", () => {
    const makePoints = (ox, oy) => [
        { x: ox - 1, y: oy - 1 }, { x: ox + 1, y: oy - 1 },
        { x: ox + 1, y: oy + 1 }, { x: ox - 1, y: oy + 1 }
    ];

    const initialBundle = {
        version: 2,
        activeCenterKey: "0,0",
        anchorCenter: { q: 0, r: 0 },
        sectionCoords: [{ q: 0, r: 0 }],
        sections: [
            makeSectionDescriptor("0,0", { q: 0, r: 0 }, { q: 0, r: 0 }, { x: 0, y: 0 }, "0,0")
        ],
        triggers: [
            { id: 10, type: "triggerArea", x: 0, y: 0, points: makePoints(0, 0), coverageSectionKeys: ["0,0"], scriptingName: "entrance" },
            { id: 20, type: "triggerArea", x: 5, y: 5, points: makePoints(5, 5), coverageSectionKeys: ["0,0"], scriptingName: "exit" },
            { id: 30, type: "triggerArea", x: -3, y: 2, points: makePoints(-3, 2), coverageSectionKeys: ["0,0"] }
        ]
    };

    const map1 = loadFreshMap(initialBundle);
    assert.equal(map1._prototypeTriggerState.triggerDefsById.size, 3, "all 3 triggers should load");

    const savedBundle = extractSaveBundle(map1);
    assert.equal(savedBundle.triggers.length, 3, "all 3 triggers should be in saved bundle");

    const map2 = loadFreshMap(savedBundle);
    assert.equal(map2._prototypeTriggerState.triggerDefsById.size, 3, "all 3 triggers should survive round-trip");

    // All scripting names and ids must be preserved.
    const entrance = map2._prototypeTriggerState.triggerDefsById.get(10);
    const exit = map2._prototypeTriggerState.triggerDefsById.get(20);
    const unnamed = map2._prototypeTriggerState.triggerDefsById.get(30);
    assert.ok(entrance, "trigger id 10 should survive");
    assert.equal(entrance.scriptingName, "entrance");
    assert.ok(exit, "trigger id 20 should survive");
    assert.equal(exit.scriptingName, "exit");
    assert.ok(unnamed, "trigger id 30 should survive");
});
