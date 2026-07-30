const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

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

function loadSolverProfileApi() {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    let now = 0;
    let timer = null;
    const context = {
        state: { debug: { solverProfile: null, lastSolverProfile: null } },
        performance: { now: () => now },
        setTimeout(callback) {
            timer = callback;
            return 1;
        },
        clearTimeout() {
            timer = null;
        },
        console: {
            log() {},
            table() {},
            groupCollapsed() {},
            groupEnd() {}
        },
        Map,
        Number,
        Object,
        Error
    };
    vm.createContext(context);
    vm.runInContext(
        [
            extractFunction(source, "startSolverProfile"),
            extractFunction(source, "stopSolverProfile"),
            extractFunction(source, "solverProfileSpan"),
            extractFunction(source, "noteSolverProfileStep"),
            "globalThis.__testExports = { startSolverProfile, stopSolverProfile, solverProfileSpan, noteSolverProfileStep };"
        ].join("\n"),
        context,
        { filename: "wizard-of-flatland-solver-profile.js" }
    );
    return {
        api: context.__testExports,
        advance(ms) { now += ms; },
        finishTimer() {
            const callback = timer;
            timer = null;
            callback();
        }
    };
}

test("Wizard of Flatland solver profile normalizes spans by active enemy samples", () => {
    const harness = loadSolverProfileApi();
    harness.api.startSolverProfile(5);
    harness.api.solverProfileSpan("pack active agents", () => harness.advance(5));
    harness.api.noteSolverProfileStep(10, {
        agents: 10,
        direct: 7,
        worker: 3,
        lineOfSightChecks: 10,
        lineOfSightMs: 1
    });
    harness.advance(4995);
    const result = harness.api.stopSolverProfile();

    assert.equal(result.steps, 1);
    assert.equal(result.averageActiveEnemies, 10);
    assert.equal(result.rows[0].averageMsPerStep, 5);
    assert.equal(result.rows[0].averageMsPerActiveEnemy, 0.5);
    assert.equal(result.pathing.direct, 7);
    assert.equal(result.pathing.worker, 3);
});

test("Wizard of Flatland solver profile rejects invalid durations", () => {
    const harness = loadSolverProfileApi();
    assert.throws(
        () => harness.api.startSolverProfile(0),
        /positive number of seconds/
    );
});
