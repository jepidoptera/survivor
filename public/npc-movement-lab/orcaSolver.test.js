"use strict";

const assert = require("assert");
const orca = require("../assets/javascript/pathfinding/orcaSolver.js");

const OPTIONS = {
    timeHorizon: 1,
    timeStep: 0.05,
    neighborDist: 6,
    maxNeighbors: 12,
    epsilon: 0.000001
};

function agent(overrides) {
    return Object.assign({
        id: 0,
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        prefVx: 0,
        prefVy: 0,
        radius: 0.5,
        maxSpeed: 1,
        responsibility: 0.5
    }, overrides);
}

function speed(v) {
    return Math.hypot(v.vx, v.vy);
}

function assertFiniteVelocity(v, label) {
    assert(Number.isFinite(v.vx), label + " vx should be finite");
    assert(Number.isFinite(v.vy), label + " vy should be finite");
    assert(Number.isFinite(v.maxConstraintViolation), label + " violation should be finite");
}

function testHeadOnSidestep() {
    const agents = [
        agent({ id: "a", x: -1, prefVx: 1, maxSpeed: 1 }),
        agent({ id: "b", x: 1, prefVx: -1, maxSpeed: 1 })
    ];
    const result = orca.computeAgentVelocities(agents, OPTIONS);
    assertFiniteVelocity(result[0], "agent a");
    assertFiniteVelocity(result[1], "agent b");
    assert(Math.abs(result[0].vy) > 0.0001 || Math.abs(result[1].vy) > 0.0001, "head-on agents should sidestep");
    assert(result[0].vx < 1, "agent a should adjust away from preferred velocity");
    assert(result[1].vx > -1, "agent b should adjust away from preferred velocity");
}

function testPreferredPreservedWithoutNeighbors() {
    const agents = [agent({ id: 1, prefVx: 0.35, prefVy: -0.25, maxSpeed: 1 })];
    const result = orca.computeAgentVelocities(agents, OPTIONS);
    assert(Math.abs(result[0].vx - 0.35) < 0.000001);
    assert(Math.abs(result[0].vy + 0.25) < 0.000001);
    assert.strictEqual(result[0].constraintCount, 0);
    assert.strictEqual(result[0].neighborCount, 0);
}

function testMaxSpeedClamp() {
    const agents = [agent({ id: 1, prefVx: 10, prefVy: 0, maxSpeed: 1.25 })];
    const result = orca.computeAgentVelocities(agents, OPTIONS);
    assert(speed(result[0]) <= 1.25 + 0.000001, "output speed should not exceed maxSpeed");
}

function testOverlappingAgentsFiniteSeparating() {
    const agents = [
        agent({ id: 1, x: 0, y: 0 }),
        agent({ id: 2, x: 0.2, y: 0 })
    ];
    const result = orca.computeAgentVelocities(agents, OPTIONS);
    assertFiniteVelocity(result[0], "overlap a");
    assertFiniteVelocity(result[1], "overlap b");
    const relativeVelocityX = result[1].vx - result[0].vx;
    assert(relativeVelocityX > 0, "overlap velocities should separate along the contact axis");
}

function testDeterministic() {
    const agents = [
        agent({ id: 1, x: -1, y: 0.2, prefVx: 1 }),
        agent({ id: 2, x: 1, y: -0.1, prefVx: -1 }),
        agent({ id: 3, x: 0, y: 1.2, prefVy: -1 })
    ];
    const first = orca.computeAgentVelocities(agents, OPTIONS);
    const second = orca.computeAgentVelocities(agents, OPTIONS);
    assert.deepStrictEqual(second, first);
}

function testInvalidInputsThrow() {
    assert.throws(
        () => orca.computeAgentVelocities([agent({ x: NaN })], OPTIONS),
        /agents\[0\]\.x must be finite/
    );
    assert.throws(
        () => orca.computeAgentVelocities([agent({ radius: 0 })], OPTIONS),
        /agents\[0\]\.radius must be greater than zero/
    );
    assert.throws(
        () => orca.computeAgentVelocities([agent({})], Object.assign({}, OPTIONS, { timeStep: 0 })),
        /options\.timeStep must be greater than zero/
    );
}

function testSmallCrowdFinite() {
    const agents = [];
    const count = 20;
    for (let i = 0; i < count; i++) {
        const angle = i / count * Math.PI * 2;
        const x = Math.cos(angle) * 3;
        const y = Math.sin(angle) * 3;
        agents.push(agent({
            id: i,
            x,
            y,
            prefVx: -Math.cos(angle),
            prefVy: -Math.sin(angle),
            maxSpeed: 1.4
        }));
    }
    const result = orca.computeAgentVelocities(agents, OPTIONS);
    assert.strictEqual(result.length, count);
    for (let i = 0; i < result.length; i++) {
        assertFiniteVelocity(result[i], "crowd " + i);
        assert(speed(result[i]) <= agents[i].maxSpeed + 0.000001, "crowd speed should be clamped");
    }
}

testHeadOnSidestep();
testPreferredPreservedWithoutNeighbors();
testMaxSpeedClamp();
testOverlappingAgentsFiniteSeparating();
testDeterministic();
testInvalidInputsThrow();
testSmallCrowdFinite();

console.log("orcaSolver tests passed");
