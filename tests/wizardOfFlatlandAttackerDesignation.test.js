const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const SOLVER_WORKER_PATH = path.join(__dirname, "../public/wizard-of-flatland/solverWorker.js");
const ORCA_SOLVER_PATH = path.join(__dirname, "../public/wizard-of-flatland/orcaSolver.js");

const PHASE_RECOVERING = 2;
const PHASE_ATTACKING = 1;
const PATH_MODE_DIRECT = 0;
const PATH_MODE_WORKER = 1;

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
globalThis.__testExports = { solveStep, buildPackedAgentSpatialIndex, queryPackedAgentSpatialIndex };`,
        context,
        { filename: SOLVER_WORKER_PATH }
    );
    return context.__testExports;
}

function combinePackedAgents(agents) {
    const packed = new Float32Array(agents.reduce((total, agent) => total + agent.length, 0));
    let offset = 0;
    for (const agent of agents) {
        packed.set(agent, offset);
        offset += agent.length;
    }
    return packed;
}

test("Wizard of Flatland per-step enemy index returns stable local candidates", () => {
    const { buildPackedAgentSpatialIndex, queryPackedAgentSpatialIndex } = loadSolverWorkerApi();
    const agents = combinePackedAgents([
        createPackedAgent({ id: 1, x: 0, y: 0 }),
        createPackedAgent({ id: 2, x: 1.5, y: 0 }),
        createPackedAgent({ id: 3, x: 80, y: 80 }),
        createPackedAgent({ id: 4, x: -1.5, y: 0 })
    ]);
    const index = buildPackedAgentSpatialIndex(agents, 4);

    assert.deepEqual(Array.from(queryPackedAgentSpatialIndex(index, 0, 0, 2)), [0, 1, 3]);
    assert.deepEqual(Array.from(queryPackedAgentSpatialIndex(index, 80, 80, 2)), [2]);
});

test("Wizard of Flatland per-step enemy index rejects malformed packed positions", () => {
    const { buildPackedAgentSpatialIndex } = loadSolverWorkerApi();
    const agent = createPackedAgent();
    agent[1] = Number.NaN;

    assert.throws(
        () => buildPackedAgentSpatialIndex(agent, 1),
        /finite position for enemy 101/
    );
});

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
        pathGoalWallBlocked: false,
        hitDamage: 10,
        targetX: 0,
        targetY: 0,
        targetRadius: 0.5,
        lockedOnTurret: false
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
        values.pathGoalWallBlocked ? 1 : 0,
        values.hitDamage,
        values.targetX,
        values.targetY,
        values.targetRadius,
        values.lockedOnTurret ? 1 : 0
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

test("Wizard of Flatland identifies an enemy that violates the wall invariant", () => {
    const { solveStep } = loadSolverWorkerApi();
    let caught = null;
    try {
        solveStep({
            type: "step",
            requestId: 9,
            worldVersion: 2,
            dt: 0.05,
            agents: createPackedAgent({ id: 7431, x: 6, y: 0 }),
            walls: Float32Array.from([6, -1, 6, 1, 0, 0, 0, 0]),
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
    } catch (error) {
        caught = error;
    }

    assert.ok(caught);
    assert.equal(caught.code, "agent_wall_invariant");
    assert.equal(caught.agentId, 7431);
    assert.match(caught.message, /wall invariant violated for agent 7431/);
});

test("Wizard of Flatland turret-locked enemies ram their turret without damaging the wizard", () => {
    const { solveStep } = loadSolverWorkerApi();
    const result = solveStep({
        type: "step",
        requestId: 3,
        worldVersion: 1,
        dt: 0.05,
        agents: createPackedAgent({
            x: 1.35,
            y: 0,
            speed: 8,
            phase: PHASE_ATTACKING,
            phaseTime: 0,
            heading: Math.PI,
            targetX: 0,
            targetY: 0,
            targetRadius: 0.8,
            lockedOnTurret: true
        }),
        walls: new Float32Array(0),
        params: {
            targetX: 20,
            targetY: 20,
            targetRadius: 0.5,
            ringRadius: 5,
            separationStrength: 1,
            speedScale: 1,
            targetMoved: false
        }
    });

    assert.equal(result.agents[7], PHASE_RECOVERING);
    assert.equal(result.stats.hits, 0);
    assert.deepEqual(Array.from(result.stats.hitAgentIds), []);
});

test("Wizard of Flatland wall hits retain the solver request target segment", () => {
    const { solveStep } = loadSolverWorkerApi();
    const result = solveStep({
        type: "step",
        requestId: 2,
        worldVersion: 4,
        dt: 0.05,
        agents: createPackedAgent({
            id: 202,
            x: 0,
            y: 0,
            radius: 0.5,
            speed: 8,
            phase: PHASE_ATTACKING,
            phaseTime: 0,
            heading: 0,
            pathMode: PATH_MODE_WORKER,
            pathGoalX: 0.7,
            pathGoalY: 0,
            pathGoalWallBlocked: true
        }),
        walls: Float32Array.from([0.7, -2, 0.7, 2, 10, 0, 0, 0]),
        wallBreakTargets: [{ agentId: 202, segmentId: "0,0|segment" }],
        params: {
            targetX: 20,
            targetY: 0,
            targetRadius: 0.5,
            ringRadius: 5,
            separationStrength: 1,
            speedScale: 1,
            targetMoved: false
        }
    });

    assert.equal(result.worldVersion, 4);
    assert.equal(result.stats.wallHits, 1);
    assert.deepEqual(Array.from(result.stats.wallHitAgentIds), [202]);
    assert.deepEqual(
        Array.from(result.stats.wallHitTargets, (entry) => ({ ...entry })),
        [{ agentId: 202, segmentId: "0,0|segment" }]
    );
});
