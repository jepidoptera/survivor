const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const MODULE_PATH = path.join(__dirname, "../public/wizard-of-flatland/mazeStreaming.js");
const MAIN_PATH = path.join(__dirname, "../public/wizard-of-flatland/main.js");

function extractFunction(source, name) {
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `${name} exists in main.js`);
    const bodyStart = source.indexOf("{", start);
    let depth = 0;
    for (let i = bodyStart; i < source.length; i++) {
        if (source[i] === "{") depth++;
        if (source[i] === "}") depth--;
        if (depth === 0) return source.slice(start, i + 1);
    }
    throw new Error(`Unterminated function ${name}`);
}

function loadEvictionFunction(state, calls) {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    const context = {
        state,
        Set,
        Number,
        Error,
        Math,
        MAZE_SECTION_UNLOAD_HYSTERESIS_MS: 3000,
        isMazeSectionAnActiveWallBreakTarget: () => false,
        parseMazeSectionKey(key) {
            const [q, r] = key.split(",").map(Number);
            return { q, r };
        },
        mazeSectionCenter: (q, r) => ({ x: q, y: r }),
        captureMazeSectionSnapshot: (key) => calls.snapshots.push(key),
        freezeAgentsInMazeSection: (key) => calls.frozen.push(key)
    };
    vm.createContext(context);
    vm.runInContext(
        `${extractFunction(source, "removeFurthestGeneratedMazeSection")}
globalThis.__testExport = removeFurthestGeneratedMazeSection;`,
        context,
        { filename: "wizard-of-flatland-section-eviction.js" }
    );
    return context.__testExport;
}

function loadSystem(state, clock, getRequiredKeys) {
    const posted = [];
    const context = {
        Float32Array,
        Map,
        Number,
        Object,
        Set,
        performance: { now: () => clock.now },
        window: {}
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(MODULE_PATH, "utf8"), context, { filename: MODULE_PATH });
    const system = context.window.WizardFlatlandMazeStreaming.createMazeStreamingSystem({
        state,
        worker: { postMessage(message) { posted.push(message); } },
        constants: {
            MAZE_SECTION_CACHE_LIMIT: 15,
            MAZE_SECTION_CACHE_OVERFLOW_LIMIT: 18,
            MAZE_SECTION_UNLOAD_HYSTERESIS_MS: 3000,
            MAZE_WORKER_STATUS_PREFIX: "maze",
            TARGET_RADIUS: 0.42,
            WALL_STRIDE: 8
        },
        wallBuffer: { cloneWallBuffer: (walls) => walls.slice() },
        profiler: {
            beginLoad() {},
            span(_label, callback) { callback(); },
            mark() {}
        },
        callbacks: {
            isProceduralMazeScenario: () => true,
            getMazeOptions: () => ({ seed: "test", chunkSize: 28, roomScale: 0.5, twistiness: 0.5 }),
            getRequiredMazeSectionKeys: getRequiredKeys,
            removeFurthestGeneratedMazeSection(_options, protectedKeys, now, force) {
                for (const key of state.generatedMazeChunkKeys) {
                    if (protectedKeys.has(key)) continue;
                    const age = now - Number(state.generatedMazeSectionLastRequiredAt.get(key) || 0);
                    if (!force && age < 3000) continue;
                    state.generatedMazeChunkKeys.delete(key);
                    state.generatedMazeSectionLastRequiredAt.delete(key);
                    return true;
                }
                return false;
            },
            getPathfindingLayerBounds: () => ({ minX: 0, minY: 0, maxX: 1, maxY: 1 }),
            getSavedSectionWallOverrides: () => [],
            setWorkerStatus() {},
            installGeneratedMazeWorkerResult() {}
        }
    });
    return { system, posted };
}

test("Wizard of Flatland section cache retains recently required sections across boundary zigzags", () => {
    const clock = { now: 1000 };
    let required = ["new"];
    const existing = Array.from({ length: 15 }, (_, index) => `old-${index}`);
    const state = {
        generatedMazeChunkKeys: new Set(existing),
        generatedMazeSectionLastRequiredAt: new Map(existing.map((key) => [key, 900])),
        generatedMazeSignature: "",
        generatedMazePendingSignature: "",
        generatedMazeRequestId: 1,
        generatedMazeActiveRequestId: 0,
        generatedMazeLoading: false,
        brokenWallGaps: [],
        manualWalls: new Float32Array(0)
    };
    const { system } = loadSystem(state, clock, () => required);

    system.refreshGeneratedMazeIfNeeded();
    assert.equal(state.generatedMazeChunkKeys.size, 16);
    assert.equal(state.generatedMazeChunkKeys.has("old-0"), true);
    assert.equal(state.generatedMazeChunkKeys.has("new"), true);

    required = ["old-0"];
    clock.now = 1100;
    system.refreshGeneratedMazeIfNeeded();
    assert.equal(state.generatedMazeChunkKeys.size, 16);
    assert.equal(state.generatedMazeChunkKeys.has("new"), true);
});

test("Wizard of Flatland section cache bounds hysteresis overflow", () => {
    const clock = { now: 1000 };
    const existing = Array.from({ length: 18 }, (_, index) => `old-${index}`);
    const state = {
        generatedMazeChunkKeys: new Set(existing),
        generatedMazeSectionLastRequiredAt: new Map(existing.map((key) => [key, 900])),
        generatedMazeSignature: "",
        generatedMazePendingSignature: "",
        generatedMazeRequestId: 1,
        generatedMazeActiveRequestId: 0,
        generatedMazeLoading: false,
        brokenWallGaps: [],
        manualWalls: new Float32Array(0)
    };
    const { system } = loadSystem(state, clock, () => ["new"]);

    system.refreshGeneratedMazeIfNeeded();
    assert.equal(state.generatedMazeChunkKeys.size, 18);
    assert.equal(state.generatedMazeChunkKeys.has("new"), true);
});

test("Wizard of Flatland evicts an obsolete pending section without snapshotting unloaded state", () => {
    const state = {
        generatedMazeChunkKeys: new Set(["2,-44"]),
        generatedMazeInstalledChunkKeys: new Set(),
        generatedMazeSectionLastRequiredAt: new Map([["2,-44", 1000]]),
        target: { x: 0, y: 0 }
    };
    const calls = { snapshots: [], frozen: [] };
    const removeFurthestGeneratedMazeSection = loadEvictionFunction(state, calls);

    assert.equal(
        removeFurthestGeneratedMazeSection({}, new Set(), 5000),
        true
    );
    assert.equal(state.generatedMazeChunkKeys.has("2,-44"), false);
    assert.deepEqual(calls.snapshots, []);
    assert.deepEqual(calls.frozen, []);
});

test("Wizard of Flatland snapshots and freezes an installed section before eviction", () => {
    const state = {
        generatedMazeChunkKeys: new Set(["2,-44"]),
        generatedMazeInstalledChunkKeys: new Set(["2,-44"]),
        generatedMazeSectionLastRequiredAt: new Map([["2,-44", 1000]]),
        target: { x: 0, y: 0 }
    };
    const calls = { snapshots: [], frozen: [] };
    const removeFurthestGeneratedMazeSection = loadEvictionFunction(state, calls);

    assert.equal(
        removeFurthestGeneratedMazeSection({}, new Set(), 5000),
        true
    );
    assert.deepEqual(calls.snapshots, ["2,-44"]);
    assert.deepEqual(calls.frozen, ["2,-44"]);
});
