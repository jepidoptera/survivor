const test = require("node:test");
const assert = require("node:assert/strict");

const filesystem = require("../public/assets/javascript/filesystem.js");

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
    assert.deepEqual(saveData.animals, [{ type: "bear", x: 1, y: 2 }]);
    assert.equal(saveData.prototypeSectionWorld.sections.length, 1);
    assert.deepEqual(saveData.prototypeSectionWorld.sections[0].animals, [
        { id: 101, type: "goat", x: 7, y: 9 }
    ]);
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
            return { name: "Merlin", x: 0, y: 0 };
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
    assert.equal(postedBody.sections.length, 1);
    assert.deepEqual(postedBody.sections[0].animals, [{ id: 1 }]);
    assert.deepEqual(postedBody.sections[0].powerups, [{ id: 2 }]);
});
