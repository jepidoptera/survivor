const test = require("node:test");
const assert = require("node:assert/strict");

const {
    attachPrototypeApis,
    canReusePrototypeParkedRuntimeObject,
    createPrototypeState,
    getPrototypeParkedObjectCacheLimit,
    initializePrototypeRuntimeState,
    shouldParkPrototypeRuntimeObject
} = require("../public/assets/javascript/prototypes/twoSectionPrototype.js");

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
