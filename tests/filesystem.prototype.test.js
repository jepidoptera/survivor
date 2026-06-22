const test = require("node:test");
const assert = require("node:assert/strict");

const filesystem = require("../public/assets/javascript/filesystem.js");
const sectionWorldApiInstallers = require("../public/assets/javascript/prototypes/sectionWorldApiInstallers.js");

const GLOBAL_KEYS = [
    "wizard",
    "map",
    "animals",
    "powerups",
    "roofs",
    "roof",
    "viewport",
    "paused",
    "projectiles",
    "Road",
    "WallSectionUnit",
    "StaticObject",
    "Roof",
    "Powerup",
    "Animal",
    "Scripting",
    "LOSVisualSettings",
    "setLosMazeModeEnabled",
    "presentGameFrame",
    "invalidateMinimap",
    "fetch",
    "__sectionGeometry",
    "lastLoadGameStateError"
];

const savedGlobals = new Map();
for (const key of GLOBAL_KEYS) {
    savedGlobals.set(key, globalThis[key]);
}

function restoreGlobals() {
    for (const [key, value] of savedGlobals.entries()) {
        if (typeof value === "undefined") {
            delete globalThis[key];
        } else {
            globalThis[key] = value;
        }
    }
}

function createRectNode(textureId = 0) {
    return {
        groundTextureId: textureId,
        objects: [],
        recountBlockingObjects() {},
        isBlocked() {
            return false;
        }
    };
}

function createRectMap() {
    return {
        width: 1,
        height: 1,
        nodes: [[createRectNode(0)]],
        serializeClearance() {
            return null;
        },
        deserializeClearance() {
            return true;
        },
        computeClearance() {},
        rebuildGameObjectRegistry() {},
        getAllPrototypeNodes() {
            return [];
        },
        getLoadedPrototypeNodes() {
            return [];
        }
    };
}

test.afterEach(() => {
    restoreGlobals();
});

test("saveGameState persists prototype animals in section data without duplicating runtime records", () => {
    const prototypeSectionAsset = {
        id: "section-0",
        key: "0,0",
        coord: { q: 0, r: 0 },
        centerAxial: { q: 0, r: 0 },
        centerOffset: { x: 0, y: 0 },
        neighborKeys: [],
        tileCoordKeys: ["0,0"],
        groundTextureId: 0,
        walls: [],
        objects: [],
        animals: [],
        powerups: []
    };

    const map = createRectMap();
    map._prototypeSectionState = {
        radius: 3,
        sectionGraphRadius: 1,
        anchorCenter: { q: 0, r: 0 },
        activeCenterKey: "0,0",
        activeSectionKeys: new Set(["0,0"]),
        nodesBySectionKey: new Map([["0,0", [map.nodes[0][0]]]])
    };
    map.getPrototypeActiveSectionKeys = () => new Set(["0,0"]);
    map.getPrototypeSectionAsset = () => prototypeSectionAsset;
    map.syncPrototypeWalls = () => false;
    map.syncPrototypeObjects = () => false;
    map.syncPrototypeAnimals = () => {
        prototypeSectionAsset.animals = [
            { id: 101, type: "goat", x: 7, y: 9 }
        ];
        return true;
    };
    map.syncPrototypePowerups = () => false;

    globalThis.map = map;
    globalThis.wizard = {
        saveJson() {
            return { name: "Merlin" };
        }
    };
    globalThis.animals = [
        {
            _prototypeRuntimeRecord: true,
            gone: false,
            vanishing: false,
            saveJson() {
                return { type: "goat", x: 7, y: 9 };
            }
        },
        {
            gone: false,
            vanishing: false,
            saveJson() {
                return { type: "bear", x: 1, y: 2 };
            }
        }
    ];
    globalThis.powerups = [];
    globalThis.roofs = [];
    globalThis.LOSVisualSettings = { mazeMode: false };

    const saveData = filesystem.saveGameState();

    assert.ok(saveData);
    assert.deepEqual(saveData.animals, []);
    assert.equal(Object.prototype.hasOwnProperty.call(saveData, "staticObjects"), false);
    assert.equal(saveData.prototypeSectionWorld.sections.length, 1);
    assert.deepEqual(saveData.prototypeSectionWorld.sections[0].animals, [
        { id: 101, type: "goat", x: 7, y: 9 }
    ]);
});

test("saveGameState stores prototype static objects only in section data", () => {
    const prototypeSectionAsset = {
        id: "section-0",
        key: "0,0",
        coord: { q: 0, r: 0 },
        centerAxial: { q: 0, r: 0 },
        centerOffset: { x: 0, y: 0 },
        neighborKeys: [],
        tileCoordKeys: ["0,0"],
        groundTextureId: 0,
        walls: [],
        objects: [],
        animals: [],
        powerups: []
    };

    const map = createRectMap();
    map._prototypeSectionState = {
        radius: 3,
        sectionGraphRadius: 1,
        anchorCenter: { q: 0, r: 0 },
        activeCenterKey: "0,0",
        activeSectionKeys: new Set(["0,0"]),
        nodesBySectionKey: new Map([["0,0", [map.nodes[0][0]]]])
    };
    map.nodes[0][0].objects.push({
        gone: false,
        vanishing: false,
        saveJson() {
            return { type: "placedObject", id: 500, x: 1, y: 2 };
        }
    });
    map.getPrototypeActiveSectionKeys = () => new Set(["0,0"]);
    map.getPrototypeSectionAsset = () => prototypeSectionAsset;
    map.syncPrototypeWalls = () => false;
    map.syncPrototypeObjects = () => {
        prototypeSectionAsset.objects = [
            { type: "placedObject", id: 500, x: 1, y: 2 }
        ];
        return true;
    };
    map.syncPrototypeAnimals = () => false;
    map.syncPrototypePowerups = () => false;

    globalThis.map = map;
    globalThis.wizard = {
        saveJson() {
            return { name: "Merlin" };
        }
    };
    globalThis.animals = [];
    globalThis.powerups = [];
    globalThis.roofs = [];
    globalThis.LOSVisualSettings = { mazeMode: false };

    const saveData = filesystem.saveGameState();

    assert.ok(saveData);
    assert.equal(Object.prototype.hasOwnProperty.call(saveData, "staticObjects"), false);
    assert.deepEqual(saveData.prototypeSectionWorld.sections[0].objects, [
        { type: "placedObject", id: 500, x: 1, y: 2 }
    ]);
});

test("saveGameState splits road paths on section edges", () => {
    const sectionA = {
        id: "section-a",
        key: "A",
        coord: { q: 0, r: 0 },
        centerAxial: { q: 0, r: 0 },
        centerOffset: { x: -5, y: 0 },
        neighborKeys: ["B"],
        tileCoordKeys: ["0,0"],
        groundTextureId: 0,
        walls: [],
        objects: [
            {
                type: "roadPath",
                id: 100,
                x: -5,
                y: 0,
                width: 4,
                textureId: "road",
                points: [
                    { x: -5, y: 0 },
                    { x: 5, y: 0 }
                ]
            }
        ],
        animals: [],
        powerups: []
    };
    const sectionB = {
        id: "section-b",
        key: "B",
        coord: { q: 1, r: 0 },
        centerAxial: { q: 1, r: 0 },
        centerOffset: { x: 5, y: 0 },
        neighborKeys: ["A"],
        tileCoordKeys: ["1,0"],
        groundTextureId: 0,
        walls: [],
        objects: [],
        animals: [],
        powerups: []
    };
    const assets = new Map([
        ["A", sectionA],
        ["B", sectionB]
    ]);
    const map = createRectMap();
    map._prototypeSectionState = {
        radius: 10,
        sectionGraphRadius: 1,
        anchorCenter: { q: 0, r: 0 },
        activeCenterKey: "A",
        activeSectionKeys: new Set(["A"]),
        basis: {},
        nodesBySectionKey: new Map([["A", [map.nodes[0][0]]]])
    };
    map.getPrototypeActiveSectionKeys = () => new Set(["A"]);
    map.getPrototypeSectionAsset = (key) => assets.get(key) || null;
    map.getPrototypeSectionKeyForWorldPoint = (x) => (x < 0 ? "A" : "B");
    map.syncPrototypeWalls = () => false;
    map.syncPrototypeObjects = () => false;
    map.syncPrototypeAnimals = () => false;
    map.syncPrototypePowerups = () => false;

    globalThis.__sectionGeometry = {
        getSectionHexagonCorners(centerAxial) {
            if (centerAxial.q === 0) {
                return [
                    { x: -10, y: -10 },
                    { x: 0, y: -10 },
                    { x: 0, y: 10 },
                    { x: -10, y: 10 }
                ];
            }
            return [
                { x: 0, y: -10 },
                { x: 10, y: -10 },
                { x: 10, y: 10 },
                { x: 0, y: 10 }
            ];
        }
    };
    globalThis.map = map;
    globalThis.wizard = {
        saveJson() {
            return { name: "Merlin" };
        }
    };
    globalThis.animals = [];
    globalThis.powerups = [];
    globalThis.roofs = [];
    globalThis.LOSVisualSettings = { mazeMode: false };

    const saveData = filesystem.saveGameState();
    const sectionsByKey = new Map(saveData.prototypeSectionWorld.sections.map((section) => [section.key, section]));

    assert.equal(saveData.prototypeSectionWorld.sections.length, 2);
    assert.equal(sectionsByKey.get("A").objects.length, 1);
    assert.equal(sectionsByKey.get("B").objects.length, 1);
    assert.deepEqual(sectionsByKey.get("A").objects[0].points, [
        { x: -5, y: 0 },
        { x: 0, y: 0 }
    ]);
    assert.deepEqual(sectionsByKey.get("B").objects[0].points, [
        { x: 0, y: 0 },
        { x: 5, y: 0 }
    ]);
});

test("saveGameState splits road paths into inactive neighbor sections", () => {
    const sectionA = {
        id: "section-a",
        key: "0,0",
        coord: { q: 0, r: 0 },
        centerAxial: { q: 0, r: 0 },
        centerOffset: { x: -5, y: 0 },
        neighborKeys: ["1,0"],
        tileCoordKeys: ["0,0"],
        groundTextureId: 0,
        walls: [],
        objects: [
            {
                type: "roadPath",
                id: 100,
                x: -5,
                y: 0,
                width: 4,
                textureId: "road",
                points: [
                    { x: -5, y: 0 },
                    { x: 5, y: 0 }
                ]
            }
        ],
        animals: [],
        powerups: []
    };
    const sectionB = {
        id: "section-b",
        key: "1,0",
        coord: { q: 1, r: 0 },
        centerAxial: { q: 1, r: 0 },
        centerOffset: { x: 5, y: 0 },
        neighborKeys: ["0,0"],
        tileCoordKeys: ["1,0"],
        groundTextureId: 0,
        walls: [],
        objects: [],
        animals: [],
        powerups: []
    };
    const assets = new Map([
        ["0,0", sectionA],
        ["1,0", sectionB]
    ]);
    const map = createRectMap();
    map._prototypeSectionState = {
        radius: 10,
        sectionGraphRadius: 1,
        anchorCenter: { q: 0, r: 0 },
        activeCenterKey: "0,0",
        activeSectionKeys: new Set(["0,0"]),
        basis: {},
        nodesBySectionKey: new Map([["0,0", [map.nodes[0][0]]]]),
        sectionAssetsByKey: assets,
        orderedSectionAssets: [sectionA, sectionB]
    };
    map.getPrototypeActiveSectionKeys = () => new Set(["0,0"]);
    map.getPrototypeSectionAsset = (key) => assets.get(key) || null;
    map.getPrototypeSectionKeyForWorldPoint = (x) => (x < 0 ? "0,0" : null);
    map.syncPrototypeWalls = () => false;
    map.syncPrototypeObjects = () => false;
    map.syncPrototypeAnimals = () => false;
    map.syncPrototypePowerups = () => false;

    globalThis.__sectionGeometry = {
        makeSectionKey(coord) {
            return `${Number(coord && coord.q) || 0},${Number(coord && coord.r) || 0}`;
        },
        resolvePrototypeSectionCoordForWorldPosition(_state, x) {
            return x < 0 ? { q: 0, r: 0 } : { q: 1, r: 0 };
        },
        getSectionHexagonCorners(centerAxial) {
            if (centerAxial.q === 0) {
                return [
                    { x: -10, y: -10 },
                    { x: 0, y: -10 },
                    { x: 0, y: 10 },
                    { x: -10, y: 10 }
                ];
            }
            return [
                { x: 0, y: -10 },
                { x: 10, y: -10 },
                { x: 10, y: 10 },
                { x: 0, y: 10 }
            ];
        }
    };
    globalThis.map = map;
    globalThis.wizard = {
        saveJson() {
            return { name: "Merlin" };
        }
    };
    globalThis.animals = [];
    globalThis.powerups = [];
    globalThis.roofs = [];
    globalThis.LOSVisualSettings = { mazeMode: false };

    const saveData = filesystem.saveGameState();
    const sectionsByKey = new Map(saveData.prototypeSectionWorld.sections.map((section) => [section.key, section]));

    assert.equal(saveData.prototypeSectionWorld.sections.length, 2);
    assert.deepEqual(sectionsByKey.get("0,0").objects[0].points, [
        { x: -5, y: 0 },
        { x: 0, y: 0 }
    ]);
    assert.deepEqual(sectionsByKey.get("1,0").objects[0].points, [
        { x: 0, y: 0 },
        { x: 5, y: 0 }
    ]);
});

test("exportPrototypeSectionAssets splits road paths into inactive neighbor sections", () => {
    const sectionA = {
        id: "section-a",
        key: "0,0",
        coord: { q: 0, r: 0 },
        centerAxial: { q: 0, r: 0 },
        centerOffset: { x: -5, y: 0 },
        neighborKeys: ["1,0"],
        tileCoordKeys: ["0,0"],
        groundTextureId: 0,
        groundTiles: {},
        floors: [],
        floorHoles: [],
        floorVoids: [],
        walls: [],
        blockedEdges: [],
        clearanceByTile: {},
        objects: [
            {
                type: "roadPath",
                id: 100,
                x: -5,
                y: 0,
                width: 4,
                textureId: "road",
                points: [
                    { x: -5, y: 0 },
                    { x: 5, y: 0 }
                ]
            }
        ],
        animals: [],
        powerups: [],
        buildingRefs: []
    };
    const sectionB = {
        id: "section-b",
        key: "1,0",
        coord: { q: 1, r: 0 },
        centerAxial: { q: 1, r: 0 },
        centerOffset: { x: 5, y: 0 },
        neighborKeys: ["0,0"],
        tileCoordKeys: ["1,0"],
        groundTextureId: 0,
        groundTiles: {},
        floors: [],
        floorHoles: [],
        floorVoids: [],
        walls: [],
        blockedEdges: [],
        clearanceByTile: {},
        objects: [],
        animals: [],
        powerups: [],
        buildingRefs: []
    };
    const assets = new Map([
        ["0,0", sectionA],
        ["1,0", sectionB]
    ]);
    const map = {
        _prototypeSectionState: {
            radius: 10,
            basis: {},
            sectionAssetsByKey: assets,
            orderedSectionAssets: [sectionA, sectionB]
        },
        getPrototypeSectionKeyForWorldPoint(x) {
            return x < 0 ? "0,0" : null;
        }
    };
    sectionWorldApiInstallers.installSectionWorldSectionApis(map, {
        globalScope: globalThis,
        rebuildPrototypeAssetObjectNameRegistry: () => new Map(),
        ensurePrototypeBlockedEdges: () => {},
        rebuildPrototypeSectionClearance: () => {},
        clonePrototypeFloorRecords: (floors) => Array.isArray(floors) ? floors.map((floor) => ({ ...floor })) : [],
        clonePrototypeFloorHoleRecords: (holes) => Array.isArray(holes) ? holes.map((hole) => ({ ...hole })) : [],
        clonePrototypeFloorVoidRecords: (voids) => Array.isArray(voids) ? voids.map((record) => ({ ...record })) : [],
        clonePrototypeBlockedEdges: (edges) => Array.isArray(edges) ? edges.map((edge) => ({ ...edge })) : [],
        clonePrototypeClearanceByTile: (clearance) => clearance && typeof clearance === "object" ? { ...clearance } : {},
        clonePrototypeFloorTransitions: (transitions) => Array.isArray(transitions) ? transitions.map((transition) => ({ ...transition })) : []
    });
    globalThis.__sectionGeometry = {
        makeSectionKey(coord) {
            return `${Number(coord && coord.q) || 0},${Number(coord && coord.r) || 0}`;
        },
        resolvePrototypeSectionCoordForWorldPosition(_state, x) {
            return x < 0 ? { q: 0, r: 0 } : { q: 1, r: 0 };
        },
        getSectionHexagonCorners(centerAxial) {
            if (centerAxial.q === 0) {
                return [
                    { x: -10, y: -10 },
                    { x: 0, y: -10 },
                    { x: 0, y: 10 },
                    { x: -10, y: 10 }
                ];
            }
            return [
                { x: 0, y: -10 },
                { x: 10, y: -10 },
                { x: 10, y: 10 },
                { x: 0, y: 10 }
            ];
        }
    };

    const exported = map.exportPrototypeSectionAssets(["0,0"]);
    const sectionsByKey = new Map(exported.map((section) => [section.key, section]));

    assert.equal(exported.length, 2);
    assert.deepEqual(sectionsByKey.get("0,0").objects[0].points, [
        { x: -5, y: 0 },
        { x: 0, y: 0 }
    ]);
    assert.deepEqual(sectionsByKey.get("1,0").objects[0].points, [
        { x: 0, y: 0 },
        { x: 5, y: 0 }
    ]);
    assert.deepEqual(sectionA.objects.map((record) => record.points), [
        [
            { x: -5, y: 0 },
            { x: 5, y: 0 }
        ]
    ]);
    assert.deepEqual(sectionB.objects.map((record) => record.points), []);

    const exportedAgain = map.exportPrototypeSectionAssets(["0,0"]);
    const sectionsByKeyAgain = new Map(exportedAgain.map((section) => [section.key, section]));
    assert.equal(exportedAgain.length, 2);
    assert.equal(sectionsByKeyAgain.get("0,0").objects.length, 1);
    assert.equal(sectionsByKeyAgain.get("1,0").objects.length, 1);
});

test("saveGameState does not serialize unhydrated road neighbor placeholders", () => {
    const sectionA = {
        id: "section-a",
        key: "0,0",
        coord: { q: 0, r: 0 },
        centerAxial: { q: 0, r: 0 },
        centerOffset: { x: -5, y: 0 },
        neighborKeys: ["1,0"],
        tileCoordKeys: ["0,0"],
        groundTextureId: 0,
        walls: [],
        objects: [
            {
                type: "roadPath",
                id: 100,
                x: -8,
                y: 0,
                width: 4,
                textureId: "road",
                points: [
                    { x: -8, y: 0 },
                    { x: -2, y: 0 }
                ]
            }
        ],
        animals: [],
        powerups: []
    };
    const sectionB = {
        id: "section-b",
        key: "1,0",
        coord: { q: 1, r: 0 },
        centerAxial: { q: 1, r: 0 },
        centerOffset: { x: 5, y: 0 },
        neighborKeys: ["0,0"],
        tileCoordKeys: ["1,0"],
        groundTextureId: 0,
        walls: [],
        objects: [],
        animals: [],
        powerups: [],
        _prototypeSectionHydrated: false
    };
    const assets = new Map([
        ["0,0", sectionA],
        ["1,0", sectionB]
    ]);
    const map = createRectMap();
    map._prototypeSectionState = {
        radius: 10,
        sectionGraphRadius: 1,
        anchorCenter: { q: 0, r: 0 },
        activeCenterKey: "0,0",
        activeSectionKeys: new Set(["0,0"]),
        basis: {},
        nodesBySectionKey: new Map([["0,0", [map.nodes[0][0]]]]),
        sectionAssetsByKey: assets,
        orderedSectionAssets: [sectionA, sectionB]
    };
    map.getPrototypeActiveSectionKeys = () => new Set(["0,0"]);
    map.getPrototypeSectionAsset = (key) => assets.get(key) || null;
    map.getPrototypeSectionKeyForWorldPoint = (x) => (x < 0 ? "0,0" : "1,0");
    map.syncPrototypeWalls = () => false;
    map.syncPrototypeObjects = () => false;
    map.syncPrototypeAnimals = () => false;
    map.syncPrototypePowerups = () => false;

    globalThis.__sectionGeometry = {
        makeSectionKey(coord) {
            return `${Number(coord && coord.q) || 0},${Number(coord && coord.r) || 0}`;
        },
        resolvePrototypeSectionCoordForWorldPosition(_state, x) {
            return x < 0 ? { q: 0, r: 0 } : { q: 1, r: 0 };
        },
        getSectionHexagonCorners(centerAxial) {
            if (centerAxial.q === 0) {
                return [
                    { x: -10, y: -10 },
                    { x: 0, y: -10 },
                    { x: 0, y: 10 },
                    { x: -10, y: 10 }
                ];
            }
            return [
                { x: 0, y: -10 },
                { x: 10, y: -10 },
                { x: 10, y: 10 },
                { x: 0, y: 10 }
            ];
        }
    };
    globalThis.map = map;
    globalThis.wizard = {
        saveJson() {
            return { name: "Merlin" };
        }
    };
    globalThis.animals = [];
    globalThis.powerups = [];
    globalThis.roofs = [];
    globalThis.LOSVisualSettings = { mazeMode: false };

    const saveData = filesystem.saveGameState();
    const sectionKeys = saveData.prototypeSectionWorld.sections.map((section) => section.key);

    assert.deepEqual(sectionKeys, ["0,0"]);
    assert.equal(sectionB.objects.length, 0);
});

test("saveGameState refuses to save without section-world runtime", () => {
    const map = createRectMap();
    map.nodes[0][0].objects.push({
        gone: false,
        vanishing: false,
        saveJson() {
            return { type: "placedObject", id: 77, x: 3, y: 4 };
        }
    });

    globalThis.map = map;
    globalThis.wizard = {
        saveJson() {
            return { name: "Merlin" };
        }
    };
    globalThis.animals = [];
    globalThis.powerups = [];
    globalThis.roofs = [];
    globalThis.LOSVisualSettings = { mazeMode: false };

    const errors = [];
    const originalError = console.error;
    console.error = (...args) => errors.push(args);
    let saveData = null;
    try {
        saveData = filesystem.saveGameState();
    } finally {
        console.error = originalError;
    }

    assert.equal(saveData, null);
    assert.match(errors[0][0], /section-world runtime/);
});

test("saveGameState strips generated outdoor ground support from wizard payload", () => {
    const map = createRectMap();
    map._prototypeSectionState = {
        radius: 3,
        sectionGraphRadius: 1,
        anchorCenter: { q: 0, r: 0 },
        activeCenterKey: "0,0",
        activeSectionKeys: new Set(["0,0"]),
        nodesBySectionKey: new Map([["0,0", [map.nodes[0][0]]]])
    };
    map.getPrototypeActiveSectionKeys = () => new Set(["0,0"]);
    map.getPrototypeSectionAsset = () => ({
        id: "section-0",
        key: "0,0",
        coord: { q: 0, r: 0 },
        centerAxial: { q: 0, r: 0 },
        centerOffset: { x: 0, y: 0 },
        neighborKeys: [],
        tileCoordKeys: ["0,0"],
        groundTextureId: 0,
        walls: [],
        objects: [],
        animals: [],
        powerups: []
    });
    map.syncPrototypeWalls = () => false;
    map.syncPrototypeObjects = () => false;
    map.syncPrototypeAnimals = () => false;
    map.syncPrototypePowerups = () => false;

    globalThis.map = map;
    globalThis.wizard = {
        saveJson() {
            return {
                name: "Merlin",
                x: -137,
                y: 213,
                currentLayer: 0,
                traversalLayer: 0,
                currentLayerBaseZ: 0,
                surfaceId: "overworld_ground_surface",
                fragmentId: "section:0,0:ground"
            };
        }
    };
    globalThis.animals = [];
    globalThis.powerups = [];
    globalThis.roofs = [];
    globalThis.LOSVisualSettings = { mazeMode: false };

    const saveData = filesystem.saveGameState();

    assert.ok(saveData);
    assert.equal(saveData.wizard.fragmentId, undefined);
    assert.equal(saveData.wizard.surfaceId, undefined);
    assert.equal(saveData.wizard.currentLayer, 0);
});

test("loadGameState strips generated outdoor ground support before wizard restore", () => {
    const map = createRectMap();
    map.loadPrototypeSectionWorld = () => true;
    map.syncPrototypeWalls = () => false;
    map.syncPrototypeObjects = () => false;
    map.syncPrototypeAnimals = () => false;
    map.syncPrototypePowerups = () => false;

    let loadedWizardData = null;
    globalThis.map = map;
    globalThis.wizard = {
        fragmentId: "section:0,0:ground",
        surfaceId: "overworld_ground_surface",
        loadJson(data) {
            loadedWizardData = data;
        }
    };
    globalThis.animals = [];
    globalThis.powerups = [];
    globalThis.roofs = [];
    globalThis.viewport = { x: 0, y: 0, width: 100, height: 100 };
    globalThis.paused = false;
    globalThis.projectiles = [];
    globalThis.Road = { clearRuntimeCaches() {} };
    globalThis.StaticObject = { loadJson() { return null; } };
    globalThis.Animal = { loadJson() { return null; } };
    globalThis.Powerup = { loadJson() { return null; } };

    const loaded = filesystem.loadGameState({
        wizard: {
            x: -135,
            y: 218,
            currentLayer: 0,
            traversalLayer: 0,
            currentLayerBaseZ: 0,
            surfaceId: "overworld_ground_surface",
            fragmentId: "section:0,0:ground"
        },
        animals: [],
        powerups: [],
        prototypeSectionWorld: {
            version: 1,
            activeCenterKey: "0,0",
            sections: []
        }
    });

    assert.equal(loaded, true);
    assert.ok(loadedWizardData);
    assert.equal(loadedWizardData.fragmentId, "");
    assert.equal(loadedWizardData.surfaceId, "");
});

test("loadGameState re-syncs prototype animals and powerups after loading section world", () => {
    const counters = {
        walls: 0,
        objects: 0,
        animals: 0,
        powerups: 0,
        loadPrototypeSectionWorld: 0
    };

    const map = createRectMap();
    map.loadPrototypeSectionWorld = () => {
        counters.loadPrototypeSectionWorld += 1;
        return true;
    };
    map.syncPrototypeWalls = () => {
        counters.walls += 1;
        return false;
    };
    map.syncPrototypeObjects = () => {
        counters.objects += 1;
        return false;
    };
    map.syncPrototypeAnimals = () => {
        counters.animals += 1;
        return false;
    };
    map.syncPrototypePowerups = () => {
        counters.powerups += 1;
        return false;
    };

    globalThis.map = map;
    globalThis.wizard = {
        loadJson() {}
    };
    globalThis.animals = [];
    globalThis.powerups = [];
    globalThis.roofs = [];
    globalThis.viewport = { x: 0, y: 0, width: 100, height: 100 };
    globalThis.paused = false;
    globalThis.projectiles = [];
    globalThis.Road = {
        clearRuntimeCaches() {}
    };
    globalThis.StaticObject = {
        loadJson() {
            return null;
        }
    };
    globalThis.Animal = {
        loadJson() {
            return null;
        }
    };
    globalThis.Powerup = {
        loadJson() {
            return null;
        }
    };

    const loaded = filesystem.loadGameState({
        wizard: { x: 0, y: 0 },
        animals: [],
        powerups: [],
        staticObjects: [],
        prototypeSectionWorld: {
            version: 1,
            activeCenterKey: "0,0",
            sections: []
        }
    });

    assert.equal(loaded, true);
    assert.equal(counters.loadPrototypeSectionWorld, 1);
    assert.equal(counters.walls, 1);
    assert.equal(counters.objects, 1);
    assert.equal(counters.animals, 1);
    assert.equal(counters.powerups, 1);
});

test("loadGameState skips stale upper-floor placed objects from legacy static object payload", () => {
    const map = createRectMap();
    const calls = {
        ensureFloorBuildings: 0,
        staticObjects: []
    };
    const liveFragmentId = "floor_area:-4,0:4:0";
    const staleFragmentId = "floor_area:-4,0:7:0";
    map.objects = [];
    map.floorBuildingByFragmentId = new Map([[liveFragmentId, { placementId: "building:live" }]]);
    map.ensureFloorBuildings = () => {
        calls.ensureFloorBuildings += 1;
    };
    map.loadPrototypeSectionWorld = () => true;
    map.syncPrototypeWalls = () => false;
    map.syncPrototypeObjects = () => false;
    map.syncPrototypeAnimals = () => false;
    map.syncPrototypePowerups = () => false;

    globalThis.map = map;
    globalThis.wizard = { loadJson() {} };
    globalThis.animals = [];
    globalThis.powerups = [];
    globalThis.roofs = [];
    globalThis.viewport = { x: 0, y: 0, width: 100, height: 100 };
    globalThis.paused = false;
    globalThis.projectiles = [];
    globalThis.Road = { clearRuntimeCaches() {} };
    globalThis.StaticObject = {
        loadJson(data) {
            calls.staticObjects.push(data);
            return null;
        }
    };
    globalThis.Animal = { loadJson() { return null; } };
    globalThis.Powerup = { loadJson() { return null; } };

    const originalWarn = console.warn;
    const warnings = [];
    console.warn = (...args) => warnings.push(args);
    try {
        const loaded = filesystem.loadGameState({
            wizard: { x: 0, y: 0 },
            animals: [],
            powerups: [],
            staticObjects: [
                {
                    type: "placedObject",
                    category: "Rugs",
                    x: 12,
                    y: 34,
                    level: 1,
                    fragmentId: staleFragmentId,
                    surfaceId: staleFragmentId
                },
                {
                    type: "placedObject",
                    category: "Rugs",
                    x: 16,
                    y: 38,
                    level: 1,
                    fragmentId: liveFragmentId,
                    surfaceId: liveFragmentId
                }
            ],
            prototypeSectionWorld: {
                version: 1,
                activeCenterKey: "0,0",
                sections: []
            }
        });

        assert.equal(loaded, true);
        assert.equal(calls.ensureFloorBuildings > 0, true);
        assert.equal(calls.staticObjects.length, 1);
        assert.equal(calls.staticObjects[0].fragmentId, liveFragmentId);
        assert.equal(warnings.length, 1);
        assert.equal(warnings[0][0], "[static object restore] skipped orphaned upper-floor placed object records");
        assert.deepEqual(warnings[0][1], {
            count: 1,
            samples: [{
                type: "placedObject",
                fragmentId: staleFragmentId,
                surfaceId: staleFragmentId,
                level: 1,
                x: 12,
                y: 34
            }]
        });
    } finally {
        console.warn = originalWarn;
    }
});

test("loaded wizard stair support waits for pending prototype building geometry", async () => {
    const counters = {
        ensureBuildings: 0,
        restore: 0,
        geometry: 0
    };
    const map = createRectMap();
    map.stairsById = new Map();
    map.loadPrototypeSectionWorld = () => true;
    map.syncPrototypeWalls = () => false;
    map.syncPrototypeObjects = () => false;
    map.syncPrototypeAnimals = () => false;
    map.syncPrototypePowerups = () => false;
    map.syncPrototypeBuildingPlacementRefs = () => true;
    map.getPrototypeActiveSectionKeys = () => new Set(["0,0"]);
    map.getPrototypeBubbleSectionKeys = () => ["0,0", "1,0"];
    map.getPrototypeSectionKeyForWorldPoint = () => "0,0";
    map.ensurePrototypeBuildingPlacementsForSectionKeys = async (sectionKeys) => {
        counters.ensureBuildings += 1;
        assert.equal(sectionKeys.has("0,0"), true);
        await Promise.resolve();
        map.stairsById.set("building:house:stair:floor-0:0", { id: "building:house:stair:floor-0:0" });
        return [{ id: "building:house" }];
    };
    map.syncPrototypeBuildingGeometryRuntime = () => {
        counters.geometry += 1;
        return { placements: 1, floors: 2, stairs: map.stairsById.size, pending: 0 };
    };
    map.updatePrototypeSectionBubble = () => true;

    const wizard = {
        x: 0,
        y: 0,
        loadJson(data) {
            this.x = data.x;
            this.y = data.y;
            this._pendingSavedStairSupport = { stairId: data.stairSupport.stairId };
        },
        hasPendingSavedMovementSupport() {
            return !!this._pendingSavedStairSupport;
        },
        restoreSavedMovementSupport(options = {}) {
            counters.restore += 1;
            const stairId = this._pendingSavedStairSupport && this._pendingSavedStairSupport.stairId;
            if (!map.stairsById.has(stairId)) {
                if (options.deferIfMissing === true) return null;
                throw new Error(`wizard save references missing stair ${stairId}`);
            }
            this._pendingSavedStairSupport = null;
            this._stairSupport = { stairId };
            return { type: "stair", stairId };
        }
    };

    globalThis.map = map;
    globalThis.wizard = wizard;
    globalThis.animals = [];
    globalThis.powerups = [];
    globalThis.roofs = [];
    globalThis.viewport = { x: 0, y: 0, width: 100, height: 100 };
    globalThis.paused = false;
    globalThis.projectiles = [];
    globalThis.Road = { clearRuntimeCaches() {} };
    globalThis.StaticObject = { loadJson() { return null; } };
    globalThis.Animal = { loadJson() { return null; } };
    globalThis.Powerup = { loadJson() { return null; } };

    const loaded = filesystem.loadGameState({
        wizard: {
            x: 12,
            y: 34,
            stairSupport: { stairId: "building:house:stair:floor-0:0" }
        },
        animals: [],
        powerups: [],
        staticObjects: [],
        prototypeSectionWorld: {
            version: 1,
            activeCenterKey: "0,0",
            sections: []
        }
    });

    assert.equal(loaded, true);
    assert.equal(wizard.hasPendingSavedMovementSupport(), true);
    assert.equal(counters.restore, 1, "core load should only try a deferrable restore");

    const finalized = await filesystem.finalizeLoadedGameStateAsync();

    assert.equal(finalized, true);
    assert.equal(counters.ensureBuildings, 1);
    assert.equal(counters.geometry, 1);
    assert.equal(wizard.hasPendingSavedMovementSupport(), false);
    assert.equal(wizard._stairSupport.stairId, "building:house:stair:floor-0:0");
});

test("savePrototypeSectionWorldToServerSlot syncs animals and powerups before export", async () => {
    const calls = [];

    globalThis.map = {
        syncPrototypeWalls() {
            calls.push("walls");
        },
        syncPrototypeObjects() {
            calls.push("objects");
        },
        syncPrototypeAnimals() {
            calls.push("animals");
        },
        syncPrototypePowerups() {
            calls.push("powerups");
        },
        exportPrototypeSectionAssets() {
            calls.push("export");
            return [{ key: "0,0", animals: [{ id: 1 }], powerups: [{ id: 2 }] }];
        },
        worldToNode() {
            return { _prototypeSectionKey: "0,0" };
        },
        _prototypeSectionState: {
            activeCenterKey: "0,0"
        }
    };
    globalThis.wizard = {
        x: 0,
        y: 0,
        saveJson() {
            return {
                name: "Merlin",
                x: 0,
                y: 0,
                currentLayer: 0,
                traversalLayer: 0,
                surfaceId: "overworld_ground_surface",
                fragmentId: "section:0,0:ground"
            };
        }
    };

    let postedBody = null;
    globalThis.fetch = async (_url, options) => {
        postedBody = JSON.parse(options.body);
        return {
            ok: true,
            async json() {
                return { ok: true, count: 1, path: "/tmp/sectionworld.json" };
            }
        };
    };

    const result = await filesystem.savePrototypeSectionWorldToServerSlot("slot-a");

    assert.deepEqual(calls, ["walls", "objects", "animals", "powerups", "export"]);
    assert.equal(result.ok, true);
    assert.equal(postedBody.manifest.wizard.fragmentId, undefined);
    assert.equal(postedBody.manifest.wizard.surfaceId, undefined);
    assert.equal(postedBody.sections.length, 1);
    assert.deepEqual(postedBody.sections[0].animals, [{ id: 1 }]);
    assert.deepEqual(postedBody.sections[0].powerups, [{ id: 2 }]);
});

test("saveGameState stores prototype trigger definitions at the world level", () => {
    const prototypeSectionAsset = {
        id: "section-0",
        key: "0,0",
        coord: { q: 0, r: 0 },
        centerAxial: { q: 0, r: 0 },
        centerOffset: { x: 0, y: 0 },
        neighborKeys: [],
        tileCoordKeys: ["0,0"],
        groundTextureId: 0,
        walls: [],
        objects: [],
        animals: [],
        powerups: []
    };

    const map = createRectMap();
    map._prototypeSectionState = {
        radius: 3,
        sectionGraphRadius: 1,
        anchorCenter: { q: 0, r: 0 },
        activeCenterKey: "0,0",
        activeSectionKeys: new Set(["0,0"]),
        nodesBySectionKey: new Map([["0,0", [map.nodes[0][0]]]])
    };
    map.getPrototypeActiveSectionKeys = () => new Set(["0,0"]);
    map.getPrototypeSectionAsset = () => prototypeSectionAsset;
    map.exportPrototypeTriggerDefinitions = () => ([
        {
            id: 41,
            type: "triggerArea",
            x: 0,
            y: 0,
            points: [
                { x: -1, y: -1 },
                { x: 1, y: -1 },
                { x: 1, y: 1 },
                { x: -1, y: 1 }
            ],
            coverageSectionKeys: ["0,0"],
            script: { playerEnters: "mazeMode=true;" }
        }
    ]);
    map.syncPrototypeWalls = () => false;
    map.syncPrototypeObjects = () => false;
    map.syncPrototypeAnimals = () => false;
    map.syncPrototypePowerups = () => false;

    globalThis.map = map;
    globalThis.wizard = {
        saveJson() {
            return { name: "Merlin" };
        }
    };
    globalThis.animals = [];
    globalThis.powerups = [];
    globalThis.roofs = [];
    globalThis.LOSVisualSettings = { mazeMode: false };

    const saveData = filesystem.saveGameState();

    assert.ok(saveData);
    assert.deepEqual(saveData.prototypeSectionWorld.triggers, [
        {
            id: 41,
            type: "triggerArea",
            x: 0,
            y: 0,
            points: [
                { x: -1, y: -1 },
                { x: 1, y: -1 },
                { x: 1, y: 1 },
                { x: -1, y: 1 }
            ],
            coverageSectionKeys: ["0,0"],
            script: { playerEnters: "mazeMode=true;" }
        }
    ]);
    assert.deepEqual(saveData.prototypeSectionWorld.sections[0].objects, []);
});

test("saveGameState stores prototype building placements at the world level with section refs", () => {
    const buildingRecord = {
        schema: "survivor-building-placement-v1",
        id: "building:test-house",
        buildingSaveName: "test house",
        transform: { x: 10, y: 20, rotation: 0 },
        footprintPolygons: [[
            { x: 8, y: 18 },
            { x: 12, y: 18 },
            { x: 12, y: 22 },
            { x: 8, y: 22 }
        ]],
        overlappedSectionKeys: ["0,0"],
        loadState: "unloaded"
    };
    const prototypeSectionAsset = {
        id: "section-0",
        key: "0,0",
        coord: { q: 0, r: 0 },
        centerAxial: { q: 0, r: 0 },
        centerOffset: { x: 0, y: 0 },
        neighborKeys: [],
        tileCoordKeys: ["0,0"],
        groundTextureId: 0,
        walls: [],
        objects: [],
        animals: [],
        powerups: [],
        buildingRefs: [
            { id: "building:test-house", shell: true }
        ]
    };

    const map = createRectMap();
    map._prototypeSectionState = {
        radius: 3,
        sectionGraphRadius: 1,
        anchorCenter: { q: 0, r: 0 },
        activeCenterKey: "0,0",
        activeSectionKeys: new Set(["0,0"]),
        nodesBySectionKey: new Map([["0,0", [map.nodes[0][0]]]])
    };
    map.getPrototypeActiveSectionKeys = () => new Set(["0,0"]);
    map.getPrototypeSectionAsset = () => prototypeSectionAsset;
    map.exportPrototypeBuildingPlacements = () => [buildingRecord];
    map.syncPrototypeBuildingPlacementRefs = () => {
        prototypeSectionAsset.buildingRefs = [
            { id: "building:test-house", shell: true }
        ];
        return true;
    };
    map.syncPrototypeWalls = () => false;
    map.syncPrototypeObjects = () => false;
    map.syncPrototypeAnimals = () => false;
    map.syncPrototypePowerups = () => false;

    globalThis.map = map;
    globalThis.wizard = {
        saveJson() {
            return { name: "Merlin" };
        }
    };
    globalThis.animals = [];
    globalThis.powerups = [];
    globalThis.roofs = [];
    globalThis.LOSVisualSettings = { mazeMode: false };

    const saveData = filesystem.saveGameState();

    assert.deepEqual(saveData.prototypeSectionWorld.buildings, [buildingRecord]);
    assert.deepEqual(saveData.prototypeSectionWorld.sections[0].buildingRefs, [
        { id: "building:test-house", shell: true }
    ]);
});
