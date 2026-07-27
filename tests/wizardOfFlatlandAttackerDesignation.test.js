const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const SOLVER_WORKER_PATH = path.join(__dirname, "../public/wizard-of-flatland/solverWorker.js");
const ORCA_SOLVER_PATH = path.join(__dirname, "../public/wizard-of-flatland/orcaSolver.js");

const PHASE_RECOVERING = 2;
const PATH_MODE_DIRECT = 0;

function loadSolverWorkerApi() {
    const context = {
        Float32Array,
        Math,
        Number,
        Set,
        Map,
        String,
        Error,
        performance: { now: () => 0 },
        postMessage() {},
        addEventListener() {},
        importScripts(scriptPath) {
            if (scriptPath !== "/wizard-of-flatland/orcaSolver.js?v=wizard-of-flatland-1") {
                throw new Error(`Unexpected worker script import: ${scriptPath}`);
            }
            vm.runInContext(fs.readFileSync(ORCA_SOLVER_PATH, "utf8"), context, { filename: ORCA_SOLVER_PATH });
        }
    };
    context.self = context;
    vm.createContext(context);
    vm.runInContext(
        `${fs.readFileSync(SOLVER_WORKER_PATH, "utf8")}
globalThis.__testExports = { solveStep };`,
        context,
        { filename: SOLVER_WORKER_PATH }
    );
    return context.__testExports;
}

function createPackedAgent(overrides = {}) {
    const values = Object.assign({
        id: 101,
        x: 6,
        y: 0,
        radius: 0.5,
        speed: 2,
        priority: 0,
        waitTime: 0,
        phase: PHASE_RECOVERING,
        phaseTime: 0.2,
        homeAngle: 0,
        cooldown: -1.5,
        heading: Math.PI,
        millingDirection: 1,
        millingWallTurnLock: 0,
        pathMode: PATH_MODE_DIRECT,
        pathGoalX: 5,
        pathGoalY: 0,
        pathGoalWallBlocked: false
    }, overrides);
    return Float32Array.from([
        values.id,
        values.x,
        values.y,
        values.radius,
        values.speed,
        values.priority,
        values.waitTime,
        values.phase,
        values.phaseTime,
        values.homeAngle,
        values.cooldown,
        values.heading,
        values.millingDirection,
        values.millingWallTurnLock,
        values.pathMode,
        values.pathGoalX,
        values.pathGoalY,
        values.pathGoalWallBlocked ? 1 : 0
    ]);
}

test("Wizard of Flatland recovering attackers stay designated while backing away", () => {
    const { solveStep } = loadSolverWorkerApi();
    const result = solveStep({
        type: "step",
        requestId: 1,
        worldVersion: 1,
        dt: 0.05,
        agents: createPackedAgent(),
        walls: new Float32Array(0),
        params: {
            targetX: 0,
            targetY: 0,
            targetRadius: 0.5,
            ringRadius: 5,
            separationStrength: 1,
            speedScale: 1,
            targetMoved: false
        }
    });

    assert.equal(result.agents[14], 1);
    assert.equal(result.agents[7], PHASE_RECOVERING);
    assert.ok(result.agents[9] < 0, "designated recovery cooldown should keep its negative marker");
    assert.equal(result.stats.retreating, 1);
});
