const test = require("node:test");
const assert = require("node:assert/strict");

const {
    attachPrototypeApis,
    canReusePrototypeParkedRuntimeObject,
    createPrototypeState,
    getPrototypeParkedObjectCacheLimit,
    initializePrototypeRuntimeState,
    shouldParkPrototypeRuntimeObject
} = require("../public/assets/javascript/prototypes/sectionWorld.js");

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

    addObject(obj) {
        this.objects.push(obj);
    }

    removeObject(obj) {
        const index = this.objects.indexOf(obj);
        if (index >= 0) this.objects.splice(index, 1);
    }

    recountBlockingObjects() {}

    isBlocked() {
        return false;
    }
}

const PROTOTYPE_GLOBAL_KEYS = [
    "Animal",
    "Powerup",
    "Road",
    "StaticObject",
    "WallSectionUnit",
    "animals",
    "powerups",
    "objectLayer",
    "map",
    "roof",
    "roofs"
];

const savedGlobals = new Map();
for (const key of PROTOTYPE_GLOBAL_KEYS) {
    savedGlobals.set(key, globalThis[key]);
}

function restorePrototypeGlobals() {
    for (const [key, value] of savedGlobals.entries()) {
        if (typeof value === "undefined") {
            delete globalThis[key];
        } else {
            globalThis[key] = value;
        }
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
                ? transition.id
                : "";
            if (!transitionId) return null;
            const normalized = {
                ...transition,
                id: transitionId,
                metadata: (transition.metadata && typeof transition.metadata === "object") ? { ...transition.metadata } : {}
            };
            this.transitionsById.set(transitionId, normalized);
            return normalized;
        },
        rebuildFloorRuntimeFromSectionState(sectionState, options = {}) {
            this.resetFloorRuntimeState();
            if (
                !sectionState ||
                !(sectionState.sectionAssetsByKey instanceof Map) ||
                !(sectionState.nodesBySectionKey instanceof Map)
            ) {
                return { fragmentCount: 0, nodeCount: 0, transitionCount: 0 };
            }

            const synthesizeGroundFragment = (typeof options.synthesizeGroundFragment === "function")
                ? options.synthesizeGroundFragment
                : null;
            const doesNodeBelongToFragment = (typeof options.doesNodeBelongToFragment === "function")
                ? options.doesNodeBelongToFragment
                : (() => true);
            const transitions = Array.isArray(options.transitions)
                ? options.transitions
                : (Array.isArray(sectionState.floorTransitions) ? sectionState.floorTransitions : []);

            let fragmentCount = 0;
            let nodeCount = 0;
            for (const [sectionKey, sectionNodes] of sectionState.nodesBySectionKey.entries()) {
                const asset = sectionState.sectionAssetsByKey.get(sectionKey) || null;
                if (!asset) continue;
                const authoredFragments = Array.isArray(asset.floors) ? asset.floors.slice() : [];
                const hasGroundFragment = authoredFragments.some((fragment) => Number(fragment && fragment.level) === 0);
                if (!hasGroundFragment && synthesizeGroundFragment) {
                    const synthesizedGround = synthesizeGroundFragment(asset);
                    if (synthesizedGround) authoredFragments.unshift(synthesizedGround);
                }
                for (let i = 0; i < authoredFragments.length; i++) {
                    const registeredFragment = this.registerFloorFragment(authoredFragments[i]);
                    if (!registeredFragment) continue;
                    fragmentCount += 1;
                    const materializedNodeKeys = [];
                    for (let n = 0; n < sectionNodes.length; n++) {
                        const sourceNode = sectionNodes[n];
                        if (!doesNodeBelongToFragment(sourceNode, registeredFragment)) continue;
                        const floorNode = this.createFloorNodeFromSource(sourceNode, registeredFragment, {
                            baseZ: Number.isFinite(registeredFragment.nodeBaseZ) ? Number(registeredFragment.nodeBaseZ) : 0,
                            traversalLayer: Number.isFinite(registeredFragment.level) ? Number(registeredFragment.level) : 0
                        });
                        if (!floorNode) continue;
                        nodeCount += 1;
                        materializedNodeKeys.push(`${floorNode.xindex},${floorNode.yindex}`);
                    }
                    registeredFragment.materializedNodeKeys = materializedNodeKeys;
                }
            }

            let transitionCount = 0;
            for (let i = 0; i < transitions.length; i++) {
                if (this.registerFloorTransition(transitions[i])) transitionCount += 1;
            }

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

function createPrototypeBundle(overrides = {}) {
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
                neighborKeys: [],
                tileCoordKeys: ["0,0"],
                groundTextureId: 0,
                groundTiles: { "0,0": 0 },
                walls: [],
                objects: [],
                animals: [],
                powerups: []
            }
        ],
        ...overrides
    };
}

test.afterEach(() => {
    restorePrototypeGlobals();
});

test("prototype bubble object parking only keeps bounded high-cost static types", () => {
    assert.equal(getPrototypeParkedObjectCacheLimit("road"), 1536);
    assert.equal(getPrototypeParkedObjectCacheLimit("tree"), 768);
    assert.equal(getPrototypeParkedObjectCacheLimit("window"), 0);

    assert.equal(shouldParkPrototypeRuntimeObject({ type: "road" }), true);
    assert.equal(shouldParkPrototypeRuntimeObject({ type: "tree" }), true);
    assert.equal(shouldParkPrototypeRuntimeObject({ type: "tree", isOnFire: true }), false);
    assert.equal(shouldParkPrototypeRuntimeObject({ type: "tree", falling: true }), false);
    assert.equal(shouldParkPrototypeRuntimeObject({ type: "window" }), false);
});

test("prototype bubble parked object reuse requires parked state, type match, and signature match", () => {
    const parkedTree = {
        type: "tree",
        _prototypeParked: true,
        _prototypePersistenceSignature: "{\"id\":1}"
    };

    assert.equal(canReusePrototypeParkedRuntimeObject(parkedTree, "tree", "{\"id\":1}"), true);
    assert.equal(canReusePrototypeParkedRuntimeObject(parkedTree, "road", "{\"id\":1}"), false);
    assert.equal(canReusePrototypeParkedRuntimeObject(parkedTree, "tree", "{\"id\":2}"), false);
    assert.equal(canReusePrototypeParkedRuntimeObject({ ...parkedTree, _prototypeParked: false }, "tree", "{\"id\":1}"), false);
    assert.equal(canReusePrototypeParkedRuntimeObject({ ...parkedTree, gone: true }, "tree", "{\"id\":1}"), false);
});

test("prototype runtime state reset restores all reload-sensitive caches", () => {
    const map = {};
    initializePrototypeRuntimeState(map, {
        nextRecordIds: { walls: 4, objects: 5, animals: 6, powerups: 7 }
    });

    assert.equal(map._prototypeWallState.nextRecordId, 4);
    assert.equal(map._prototypeObjectState.nextRecordId, 5);
    assert.equal(map._prototypeAnimalState.nextRecordId, 6);
    assert.equal(map._prototypePowerupState.nextRecordId, 7);
    assert.ok(map._prototypeObjectState.parkedRuntimeObjectsByRecordId instanceof Map);
    assert.ok(map._prototypeObjectState.dirtyRuntimeObjects instanceof Set);
    assert.equal(map._prototypeAnimalState.activeRecordSignature, "");
    assert.equal(map._prototypePowerupState.activeRecordSignature, "");
});

test("loadPrototypeSectionWorld resets stale animal and powerup signatures so repeated loads repopulate runtimes", () => {
    const map = createPrototypeMap();
    attachPrototypeApis(map, createEmptyPrototypeState());
    globalThis.map = map;
    globalThis.animals = [];
    globalThis.powerups = [];
    globalThis.Animal = {
        loadJson(record, mapRef) {
            return {
                ...record,
                map: mapRef,
                removeFromGame() {
                    this.gone = true;
                }
            };
        }
    };
    globalThis.Powerup = {
        loadJson(record) {
            return { ...record };
        }
    };

    map._prototypeAnimalState.activeRecordSignature = "1";
    map._prototypePowerupState.activeRecordSignature = "2";

    const loaded = map.loadPrototypeSectionWorld(createPrototypeBundle({
        sections: [
            {
                id: "section-0,0",
                key: "0,0",
                coord: { q: 0, r: 0 },
                centerAxial: { q: 0, r: 0 },
                centerOffset: { x: 0, y: 0 },
                neighborKeys: [],
                tileCoordKeys: ["0,0"],
                groundTextureId: 0,
                groundTiles: { "0,0": 0 },
                walls: [],
                objects: [],
                animals: [{ id: 1, type: "goat", x: 0, y: 0 }],
                powerups: [{ id: 2, type: "gem", x: 0, y: 0 }]
            }
        ]
    }));

    assert.equal(loaded, true);
    assert.equal(map._prototypeAnimalState.activeRecordSignature, "");
    assert.equal(map._prototypePowerupState.activeRecordSignature, "");
    assert.equal(map.syncPrototypeAnimals(), true);
    assert.equal(map.syncPrototypePowerups(), true);
    assert.equal(globalThis.animals.length, 1);
    assert.equal(globalThis.powerups.length, 1);
});

test("loadPrototypeSectionWorld clears prior prototype runtime animals and powerups before reloading", () => {
    const map = createPrototypeMap();
    attachPrototypeApis(map, createEmptyPrototypeState());
    globalThis.map = map;
    globalThis.animals = [];
    globalThis.powerups = [];
    globalThis.roofs = [];
    globalThis.Animal = {
        loadJson(record, mapRef) {
            return {
                ...record,
                map: mapRef,
                removeFromGame() {
                    this.gone = true;
                }
            };
        }
    };
    globalThis.Powerup = {
        loadJson(record) {
            return {
                ...record,
                removeFromGame() {
                    this.gone = true;
                }
            };
        }
    };

    const bundle = createPrototypeBundle({
        sections: [
            {
                id: "section-0,0",
                key: "0,0",
                coord: { q: 0, r: 0 },
                centerAxial: { q: 0, r: 0 },
                centerOffset: { x: 0, y: 0 },
                neighborKeys: [],
                tileCoordKeys: ["0,0"],
                groundTextureId: 0,
                groundTiles: { "0,0": 0 },
                walls: [],
                objects: [],
                animals: [{ id: 1, type: "goat", x: 0, y: 0 }],
                powerups: [{ id: 2, type: "gem", x: 0, y: 0 }]
            }
        ]
    });

    assert.equal(map.loadPrototypeSectionWorld(bundle), true);
    assert.equal(map.syncPrototypeAnimals(), true);
    assert.equal(map.syncPrototypePowerups(), true);
    assert.equal(globalThis.animals.length, 1);
    assert.equal(globalThis.powerups.length, 1);

    assert.equal(map.loadPrototypeSectionWorld(bundle), true);
    assert.equal(map.syncPrototypeAnimals(), true);
    assert.equal(map.syncPrototypePowerups(), true);
    assert.equal(globalThis.animals.length, 1);
    assert.equal(globalThis.powerups.length, 1);
});

test("loadPrototypeSectionWorld rebuilds parked object caches before object unloads", () => {
    const map = createPrototypeMap();
    attachPrototypeApis(map, createEmptyPrototypeState());
    globalThis.map = map;
    globalThis.animals = [];
    globalThis.powerups = [];
    globalThis.roofs = [];
    globalThis.StaticObject = {
        loadJson(record, mapRef) {
            const runtimeObj = {
                ...record,
                map: mapRef,
                node: mapRef.worldToNode(record.x, record.y),
                pixiSprite: { visible: true, parent: null },
                removeFromNodes() {},
                removeFromGame() {
                    this.gone = true;
                },
                getNode() {
                    return this.node;
                }
            };
            if (Array.isArray(mapRef.objects) && mapRef.objects.indexOf(runtimeObj) < 0) {
                mapRef.objects.push(runtimeObj);
            }
            return runtimeObj;
        }
    };
    globalThis.Road = {
        collectRefreshNodesFromNode(_node, targetSet) {
            if (targetSet instanceof Set) targetSet.add("road-node");
        },
        refreshTexturesAroundNodes(nodes) {
            return nodes instanceof Set ? nodes.size : 0;
        }
    };

    const bundleWithRoad = createPrototypeBundle({
        sections: [
            {
                id: "section-0,0",
                key: "0,0",
                coord: { q: 0, r: 0 },
                centerAxial: { q: 0, r: 0 },
                centerOffset: { x: 0, y: 0 },
                neighborKeys: [],
                tileCoordKeys: ["0,0"],
                groundTextureId: 0,
                groundTiles: { "0,0": 0 },
                walls: [],
                objects: [{ id: 10, type: "road", x: 0, y: 0 }],
                animals: [],
                powerups: []
            }
        ]
    });

    assert.equal(map.loadPrototypeSectionWorld(bundleWithRoad), true);
    assert.equal(map.syncPrototypeObjects(), true);
    assert.equal(map._prototypeObjectState.activeRuntimeObjectsByRecordId.size, 1);

    const emptyBundle = createPrototypeBundle();
    assert.equal(map.loadPrototypeSectionWorld(emptyBundle), true);
    assert.doesNotThrow(() => map.syncPrototypeObjects());
    assert.ok(map._prototypeObjectState.parkedRuntimeObjectsByRecordId instanceof Map);
});

test("loadPrototypeSectionWorld synthesizes one implicit ground floor fragment per section", () => {
    const map = createPrototypeMap();
    attachPrototypeApis(map, createEmptyPrototypeState());

    assert.equal(map.loadPrototypeSectionWorld(createPrototypeBundle()), true);
    assert.ok(map.floorsById instanceof Map);
    assert.ok(map.floorNodesById instanceof Map);
    assert.ok(map.floorNodeIndex instanceof Map);

    const groundFragment = map.floorsById.get("section:0,0:ground");
    assert.ok(groundFragment);
    assert.equal(groundFragment.surfaceId, "overworld_ground_surface");
    assert.equal(groundFragment.ownerSectionKey, "0,0");

    const groundNodes = map.floorNodesById.get("section:0,0:ground") || [];
    assert.equal(groundNodes.length, 1);
    assert.equal(map.floorNodeIndex.size, 1);
    assert.deepEqual(map._prototypeSectionState.floorRuntimeStats, {
        fragmentCount: 1,
        nodeCount: 1,
        transitionCount: 0
    });
});

test("loadPrototypeSectionWorld materializes cross-seam floor fragments with a shared surface id", () => {
    const map = createPrototypeMap();
    attachPrototypeApis(map, createEmptyPrototypeState());

    const bundle = createPrototypeBundle({
        sections: [
            {
                id: "section-0,0",
                key: "0,0",
                coord: { q: 0, r: 0 },
                centerAxial: { q: 0, r: 0 },
                centerOffset: { x: 0, y: 0 },
                neighborKeys: ["1,0"],
                tileCoordKeys: ["0,0"],
                groundTextureId: 0,
                groundTiles: { "0,0": 0 },
                floors: [
                    {
                        fragmentId: "section:0,0:bridge_left",
                        surfaceId: "bridge_surface",
                        ownerSectionKey: "0,0",
                        level: 1,
                        nodeBaseZ: 2,
                        tileCoordKeys: ["0,0"]
                    }
                ],
                walls: [],
                objects: [],
                animals: [],
                powerups: []
            },
            {
                id: "section-1,0",
                key: "1,0",
                coord: { q: 1, r: 0 },
                centerAxial: { q: 5, r: -2 },
                centerOffset: { x: 5, y: 1 },
                neighborKeys: ["0,0"],
                tileCoordKeys: ["1,0"],
                groundTextureId: 0,
                groundTiles: { "1,0": 0 },
                floors: [
                    {
                        fragmentId: "section:1,0:bridge_right",
                        surfaceId: "bridge_surface",
                        ownerSectionKey: "1,0",
                        level: 1,
                        nodeBaseZ: 2,
                        tileCoordKeys: ["1,0"]
                    }
                ],
                walls: [],
                objects: [],
                animals: [],
                powerups: []
            }
        ]
    });

    assert.equal(map.loadPrototypeSectionWorld(bundle), true);
    const bridgeFragments = map.floorFragmentsBySurfaceId.get("bridge_surface");
    assert.ok(bridgeFragments instanceof Set);
    assert.deepEqual(Array.from(bridgeFragments).sort(), [
        "section:0,0:bridge_left",
        "section:1,0:bridge_right"
    ]);

    const leftNodes = map.floorNodesById.get("section:0,0:bridge_left") || [];
    const rightNodes = map.floorNodesById.get("section:1,0:bridge_right") || [];
    assert.equal(leftNodes.length, 1);
    assert.equal(rightNodes.length, 1);
    assert.equal(leftNodes[0].surfaceId, "bridge_surface");
    assert.equal(rightNodes[0].surfaceId, "bridge_surface");

    assert.deepEqual(map._prototypeSectionState.floorRuntimeStats, {
        fragmentCount: 4,
        nodeCount: 4,
        transitionCount: 0
    });
});

test("direct prototype runtime sync settles pending layout before syncing walls and objects", () => {
    const map = createPrototypeMap();
    attachPrototypeApis(map, createEmptyPrototypeState());
    globalThis.map = map;
    globalThis.animals = [];
    globalThis.powerups = [];
    globalThis.roofs = [];
    globalThis.roof = null;

    globalThis.WallSectionUnit = {
        loadJson(record, mapRef) {
            return {
                id: Number(record.id),
                type: "wallSection",
                map: mapRef,
                gone: false,
                addToMapNodes() {},
                removeFromGame() {
                    this.gone = true;
                },
                remove() {
                    this.gone = true;
                },
                _removeWallPreserving() {
                    this.gone = true;
                }
            };
        },
        batchHandleJoinery() {},
        _allSections: new Map()
    };

    globalThis.StaticObject = {
        loadJson(record, mapRef) {
            return {
                ...record,
                map: mapRef,
                gone: false,
                pixiSprite: { visible: true, parent: null },
                removeFromGame() {
                    this.gone = true;
                },
                remove() {
                    this.gone = true;
                },
                getNode() {
                    return mapRef.worldToNode(record.x, record.y);
                }
            };
        }
    };

    const makeSection = (key, q, r, wallId, objectId) => ({
        id: `section-${key}`,
        key,
        coord: { q, r },
        centerAxial: { q: q * 5, r: r * 5 },
        centerOffset: { x: q * 5, y: r * 5 },
        centerWorld: { x: q * 5 * 0.866, y: r * 5 },
        neighborKeys: [],
        tileCoordKeys: [key],
        groundTextureId: 0,
        groundTiles: { [key]: 0 },
        walls: [{ id: wallId, startPoint: { x: 0, y: 0 }, endPoint: { x: 1, y: 0 }, height: 1, thickness: 0.1 }],
        objects: [{ id: objectId, type: "placedObject", category: "doors", x: 0, y: 0 }],
        animals: [],
        powerups: []
    });

    const bundle = createPrototypeBundle({
        sections: [
            makeSection("-1,0", -1, 0, 101, 201),
            makeSection("0,0", 0, 0, 102, 202),
            makeSection("1,0", 1, 0, 103, 203),
            makeSection("2,0", 2, 0, 104, 204)
        ]
    });

    assert.equal(map.loadPrototypeSectionWorld(bundle), true);
    assert.equal(map._prototypeSectionState.activeCenterKey, "0,0");

    assert.equal(map.setPrototypeActiveCenterKey("1,0"), true);
    assert.ok(map._prototypeSectionState.pendingLayoutTransition);

    map.syncPrototypeWalls();
    map.syncPrototypeObjects();

    const activeWallIds = Array.from(map._prototypeWallState.activeRuntimeWallsByRecordId.keys()).sort((a, b) => a - b);
    const activeObjectIds = Array.from(map._prototypeObjectState.activeRuntimeObjectsByRecordId.keys()).sort((a, b) => a - b);

    assert.deepEqual(activeWallIds, [102, 103, 104]);
    assert.deepEqual(activeObjectIds, [202, 203, 204]);
    assert.equal(map._prototypeSectionState.pendingLayoutTransition, null);
});

test("schedulePrototypeRuntimeSync prunes animals from sections leaving the target bubble before async teardown completes", () => {
    const map = createPrototypeMap();
    attachPrototypeApis(map, createEmptyPrototypeState());
    globalThis.map = map;
    globalThis.animals = [];
    globalThis.powerups = [];
    globalThis.roofs = [];
    globalThis.roof = null;

    globalThis.Animal = {
        loadJson(record, mapRef) {
            return {
                ...record,
                map: mapRef,
                gone: false,
                removeFromGame() {
                    this.gone = true;
                    if (Array.isArray(globalThis.animals)) {
                        const index = globalThis.animals.indexOf(this);
                        if (index >= 0) globalThis.animals.splice(index, 1);
                    }
                },
                remove() {
                    this.removeFromGame();
                }
            };
        }
    };

    const makeSection = (key, q, r, animals = []) => ({
        id: `section-${key}`,
        key,
        coord: { q, r },
        centerAxial: { q: q * 5, r: r * 5 },
        centerOffset: { x: q * 5, y: r * 5 },
        centerWorld: { x: q * 5 * 0.866, y: r * 5 },
        neighborKeys: [],
        tileCoordKeys: [key],
        groundTextureId: 0,
        groundTiles: { [key]: 0 },
        walls: [],
        objects: [],
        animals,
        powerups: []
    });

    const bundle = createPrototypeBundle({
        sections: [
            makeSection("0,0", 0, 0, [{ id: 10, type: "goat", x: 0, y: 0 }]),
            makeSection("1,0", 1, 0),
            makeSection("2,0", 2, 0),
            makeSection("3,0", 3, 0)
        ]
    });

    assert.equal(map.loadPrototypeSectionWorld(bundle), true);
    assert.equal(map.syncPrototypeAnimals(), true);
    assert.equal(globalThis.animals.length, 1);
    assert.equal(map._prototypeAnimalState.activeRuntimeAnimalsByRecordId.size, 1);

    assert.equal(map.setPrototypeActiveCenterKey("2,0"), true);
    assert.ok(map._prototypeSectionState.pendingLayoutTransition);
    map.schedulePrototypeRuntimeSync({ frameBudgetMs: 0.25 });
    assert.equal(globalThis.animals.length, 0);
    assert.equal(map._prototypeAnimalState.activeRuntimeAnimalsByRecordId.size, 0);
    assert.equal(map._prototypeAnimalState.activeRecordSignature, "");
});

test("schedulePrototypeRuntimeSync loads walls before animals for newly active sections", () => {
    const map = createPrototypeMap();
    attachPrototypeApis(map, createEmptyPrototypeState());
    globalThis.map = map;
    globalThis.animals = [];
    globalThis.powerups = [];
    globalThis.roofs = [];
    globalThis.roof = null;

    const loadOrder = [];
    globalThis.WallSectionUnit = {
        loadJson(record, mapRef) {
            loadOrder.push(`wall:${Number(record.id)}`);
            return {
                id: Number(record.id),
                type: "wallSection",
                map: mapRef,
                gone: false,
                addToMapNodes() {},
                removeFromGame() {
                    this.gone = true;
                },
                remove() {
                    this.gone = true;
                },
                _removeWallPreserving() {
                    this.gone = true;
                }
            };
        },
        batchHandleJoinery() {},
        _allSections: new Map()
    };
    globalThis.Animal = {
        loadJson(record, mapRef) {
            loadOrder.push(`animal:${Number(record.id)}`);
            return {
                ...record,
                map: mapRef,
                gone: false,
                removeFromGame() {
                    this.gone = true;
                    if (Array.isArray(globalThis.animals)) {
                        const index = globalThis.animals.indexOf(this);
                        if (index >= 0) globalThis.animals.splice(index, 1);
                    }
                },
                remove() {
                    this.removeFromGame();
                }
            };
        }
    };

    const makeSection = (key, q, r, walls = [], animals = []) => ({
        id: `section-${key}`,
        key,
        coord: { q, r },
        centerAxial: { q: q * 5, r: r * 5 },
        centerOffset: { x: q * 5, y: r * 5 },
        centerWorld: { x: q * 5 * 0.866, y: r * 5 },
        neighborKeys: [],
        tileCoordKeys: [key],
        groundTextureId: 0,
        groundTiles: { [key]: 0 },
        walls,
        objects: [],
        animals,
        powerups: []
    });

    const bundle = createPrototypeBundle({
        sections: [
            makeSection("0,0", 0, 0),
            makeSection("1,0", 1, 0),
            makeSection("2,0", 2, 0, [
                { id: 101, startPoint: { x: 0, y: 0 }, endPoint: { x: 1, y: 0 }, height: 1, thickness: 0.1 }
            ], [
                { id: 201, type: "goat", x: 10 * 0.866, y: 0 }
            ]),
            makeSection("3,0", 3, 0)
        ]
    });

    assert.equal(map.loadPrototypeSectionWorld(bundle), true);
    assert.equal(map.setPrototypeActiveCenterKey("2,0"), true);
    map.schedulePrototypeRuntimeSync({ frameBudgetMs: 10 });
    assert.equal(map.flushPrototypeBubbleShiftSession(), true);
    const firstWallIndex = loadOrder.indexOf("wall:101");
    const firstAnimalIndex = loadOrder.indexOf("animal:201");
    assert.notEqual(firstWallIndex, -1);
    assert.notEqual(firstAnimalIndex, -1);
    assert.ok(firstWallIndex < firstAnimalIndex);
});

test("syncPrototypeObjects persists dirty placed objects using indexed section ownership when point lookup misses", () => {
    const map = createPrototypeMap();
    attachPrototypeApis(map, createEmptyPrototypeState());
    globalThis.map = map;
    globalThis.animals = [];
    globalThis.powerups = [];
    globalThis.roofs = [];

    assert.equal(map.loadPrototypeSectionWorld(createPrototypeBundle()), true);

    const sectionNode = map._prototypeSectionState.loadedNodes[0];
    assert.ok(sectionNode);
    assert.equal(sectionNode._prototypeSectionKey, "0,0");

    map.worldToNode = () => null;

    const runtimeDoor = {
        type: "placedObject",
        category: "doors",
        x: 0,
        y: 0,
        map,
        gone: false,
        vanishing: false,
        _indexedNodes: [sectionNode],
        getNode() {
            return sectionNode;
        },
        saveJson() {
            return {
                type: "placedObject",
                category: "doors",
                x: 0,
                y: 0,
                texturePath: "/assets/images/doors/door5.png"
            };
        }
    };

    map.objects.push(runtimeDoor);
    map._prototypeObjectState.dirtyRuntimeObjects.add(runtimeDoor);
    map._prototypeObjectState.captureScanNeeded = true;

    assert.equal(map.syncPrototypeObjects(), true);

    const sectionAsset = map.getPrototypeSectionAsset("0,0");
    assert.equal(sectionAsset.objects.length, 1);
    assert.equal(sectionAsset.objects[0].category, "doors");
    assert.equal(runtimeDoor._prototypeRuntimeRecord, true);
    assert.equal(runtimeDoor._prototypeOwnerSectionKey, "0,0");
    assert.equal(map._prototypeObjectState.activeRuntimeObjectsByRecordId.size, 1);
});

test("syncPrototypeObjects reloads untouched furniture records using their section when point lookup misses", () => {
    const map = createPrototypeMap();
    attachPrototypeApis(map, createEmptyPrototypeState());
    globalThis.map = map;
    globalThis.animals = [];
    globalThis.powerups = [];
    globalThis.roofs = [];

    assert.equal(map.loadPrototypeSectionWorld(createPrototypeBundle({
        sections: [
            {
                id: "section-0,0",
                key: "0,0",
                coord: { q: 0, r: 0 },
                centerAxial: { q: 0, r: 0 },
                centerOffset: { x: 0, y: 0 },
                neighborKeys: [],
                tileCoordKeys: ["0,0"],
                groundTextureId: 0,
                groundTiles: { "0,0": 0 },
                walls: [],
                objects: [
                    {
                        id: 500,
                        type: "placedObject",
                        category: "furniture",
                        texturePath: "/assets/images/furniture/chair.png",
                        x: 3,
                        y: 3
                    }
                ],
                animals: [],
                powerups: []
            }
        ]
    })), true);

    const sectionNode = map._prototypeSectionState.loadedNodes[0];
    assert.ok(sectionNode);
    map.worldToNode = () => null;

    let receivedSectionKey = null;
    globalThis.StaticObject = {
        loadJson(record, mapRef, options = {}) {
            receivedSectionKey = options.targetSectionKey || null;
            if (mapRef.worldToNode(record.x, record.y)) {
                return { ...record, map: mapRef, gone: false };
            }
            const fallbackNodes = mapRef._prototypeSectionState.nodesBySectionKey.get(options.targetSectionKey) || [];
            if (fallbackNodes.length === 0) return null;
            return {
                ...record,
                map: mapRef,
                gone: false,
                node: fallbackNodes[0],
                pixiSprite: { visible: true, parent: null },
                removeFromNodes() {},
                removeFromGame() {
                    this.gone = true;
                },
                getNode() {
                    return this.node;
                }
            };
        }
    };

    assert.equal(map.syncPrototypeObjects(), true);
    assert.equal(receivedSectionKey, "0,0");
    assert.equal(map._prototypeObjectState.activeRuntimeObjectsByRecordId.size, 1);
    const runtimeObj = map._prototypeObjectState.activeRuntimeObjectsByRecordId.get(500);
    assert.ok(runtimeObj);
    assert.equal(runtimeObj.category, "furniture");
    assert.equal(runtimeObj._prototypeOwnerSectionKey, "0,0");
    assert.equal(runtimeObj.getNode(), sectionNode);
});

test("loadPrototypeSectionWorld extracts trigger records into a registry and materializes them for active sections", () => {
    const map = createPrototypeMap();
    attachPrototypeApis(map, createEmptyPrototypeState());
    globalThis.map = map;
    globalThis.animals = [];
    globalThis.powerups = [];
    globalThis.roofs = [];
    globalThis.StaticObject = {
        loadJson(record, mapRef) {
            const runtimeObj = {
                ...record,
                map: mapRef,
                gone: false,
                node: mapRef.worldToNode(record.x, record.y),
                pixiSprite: { visible: true, parent: null },
                removeFromNodes() {},
                removeFromGame() {
                    this.gone = true;
                },
                getNode() {
                    return this.node;
                }
            };
            if (Array.isArray(mapRef.objects) && mapRef.objects.indexOf(runtimeObj) < 0) {
                mapRef.objects.push(runtimeObj);
            }
            return runtimeObj;
        }
    };

    const bundle = createPrototypeBundle({
        sections: [
            {
                id: "section-0,0",
                key: "0,0",
                coord: { q: 0, r: 0 },
                centerAxial: { q: 0, r: 0 },
                centerOffset: { x: 0, y: 0 },
                neighborKeys: [],
                tileCoordKeys: ["0,0"],
                groundTextureId: 0,
                groundTiles: { "0,0": 0 },
                walls: [],
                objects: [
                    {
                        id: 41,
                        type: "triggerArea",
                        x: 0,
                        y: 0.5,
                        points: [
                            { x: -0.4, y: 0.1 },
                            { x: 0.4, y: 0.1 },
                            { x: 0.4, y: 0.9 },
                            { x: -0.4, y: 0.9 }
                        ],
                        script: {
                            playerEnters: "mazeMode=true;"
                        }
                    },
                    {
                        id: 42,
                        type: "placedObject",
                        category: "signs",
                        texturePath: "/assets/images/signs/test.png",
                        x: 0,
                        y: 0.5
                    }
                ],
                animals: [],
                powerups: []
            }
        ]
    });

    assert.equal(map.loadPrototypeSectionWorld(bundle), true);

    const sectionAsset = map.getPrototypeSectionAsset("0,0");
    assert.deepEqual(sectionAsset.objects.map((record) => Number(record.id)), [42]);

    const exportedTriggers = map.exportPrototypeTriggerDefinitions();
    assert.equal(exportedTriggers.length, 1);
    assert.equal(exportedTriggers[0].id, 41);
    assert.deepEqual(exportedTriggers[0].coverageSectionKeys, ["0,0"]);

    const sectionTriggers = map.getPrototypeTriggerDefsForSectionKeys(["0,0"]);
    assert.equal(sectionTriggers.length, 1);
    assert.equal(sectionTriggers[0].id, 41);

    assert.equal(map.syncPrototypeObjects(), true);
    assert.equal(map._prototypeObjectState.activeRuntimeObjectsByRecordId.size, 2);
});

test("prototype trigger display objects come from the registry and keep a stable shell across updates", () => {
    const map = createPrototypeMap();
    attachPrototypeApis(map, createEmptyPrototypeState());

    const bundle = createPrototypeBundle({
        sections: [
            {
                id: "section-0,0",
                key: "0,0",
                coord: { q: 0, r: 0 },
                centerAxial: { q: 0, r: 0 },
                centerOffset: { x: 0, y: 0 },
                neighborKeys: [],
                tileCoordKeys: ["0,0"],
                groundTextureId: 0,
                groundTiles: { "0,0": 0 },
                walls: [],
                objects: [],
                animals: [],
                powerups: []
            }
        ],
        triggers: [
            {
                id: 77,
                type: "triggerArea",
                x: 0,
                y: 0.5,
                points: [
                    { x: -0.5, y: 0 },
                    { x: 0.5, y: 0 },
                    { x: 0.5, y: 1 },
                    { x: -0.5, y: 1 }
                ]
            }
        ]
    });

    assert.equal(map.loadPrototypeSectionWorld(bundle), true);
    assert.deepEqual(map.objects, []);

    const actor = { x: 0, y: 0.5 };
    const firstDisplayObjects = map.getPrototypeActiveTriggerDisplayObjectsForActor(actor);
    assert.equal(firstDisplayObjects.length, 1);
    assert.equal(firstDisplayObjects[0].type, "triggerArea");
    assert.equal(firstDisplayObjects[0]._prototypeRecordId, 77);

    const updated = firstDisplayObjects[0].setPolygonPoints([
        { x: -1, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: -1, y: 1 }
    ]);
    assert.equal(updated, true);

    const nextDef = map.getPrototypeTriggerDefById(77);
    assert.deepEqual(nextDef.points, [
        { x: -1, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: -1, y: 1 }
    ]);

    const secondDisplayObjects = map.getPrototypeActiveTriggerDisplayObjectsForActor(actor, { force: true });
    assert.equal(secondDisplayObjects.length, 1);
    assert.equal(secondDisplayObjects[0], firstDisplayObjects[0]);
    assert.deepEqual(secondDisplayObjects[0].polygonPoints, [
        { x: -1, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: -1, y: 1 }
    ]);
});
