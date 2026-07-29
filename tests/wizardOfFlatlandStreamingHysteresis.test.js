const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const MODULE_PATH = path.join(__dirname, "../public/wizard-of-flatland/mazeStreaming.js");

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
