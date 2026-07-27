const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const EXPLORATION_PATH = path.join(__dirname, "../public/wizard-of-flatland/exploration.js");
const LOS_PATH = path.join(__dirname, "../public/wizard-of-flatland/los.js");
const LAYOUT = {
    stride: 8,
    x1: 0,
    y1: 1,
    x2: 2,
    y2: 3,
    labelCode: 4,
    sideCode: 5
};

function loadScript(file) {
    const context = {
        Float32Array,
        Int32Array,
        Map,
        Math,
        Number,
        Object,
        Uint32Array,
        performance: { now: () => 0 }
    };
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(file, "utf8"), context, { filename: file });
    return context;
}

function wall(ax, ay, bx, by, label = 1, side = 0) {
    return [ax, ay, bx, by, label, side, 0, 0];
}

function intervals(system) {
    const result = [];
    system.forEachActiveInterval((record, startT, endT) => {
        result.push({ ax: record.ax, ay: record.ay, bx: record.bx, by: record.by, startT, endT });
    });
    return result;
}

test("Wizard of Flatland LOS returns the wall and normalized position hit by each ray", () => {
    const context = loadScript(LOS_PATH);
    const api = context.getWizardFlatlandLosApi();
    const result = api.computeVisibilityPolygon({
        x: 0,
        y: 0,
        walls: Float32Array.from(wall(5, -10, 5, 10)),
        wallStride: 8,
        bins: 64,
        maxDistance: 20
    });

    const hits = Array.from(result.hitWallIndices).filter((index) => index >= 0);
    assert.ok(hits.length > 0);
    assert.ok(hits.every((index) => index === 0));
    for (let i = 0; i < result.hitWallIndices.length; i++) {
        if (result.hitWallIndices[i] < 0) continue;
        assert.ok(result.hitWallTs[i] >= 0 && result.hitWallTs[i] <= 1);
        assert.ok(result.depths[i] < result.maxDistance);
    }
});

test("Wizard of Flatland exploration fills adjacent LOS hits with one-cell padding", () => {
    const context = loadScript(EXPLORATION_PATH);
    const system = context.getWizardFlatlandExplorationApi().createExplorationSystem({ cellSize: 0.25 });
    system.syncWalls(Float32Array.from(wall(0, 0, 2, 0)), LAYOUT);
    system.applyVisibility(Int32Array.from([0, 0]), Float32Array.from([0.375, 0.625]));

    assert.deepEqual(intervals(system).map(({ startT, endT }) => [startT, endT]), [[0.25, 0.875]]);
});

test("Wizard of Flatland exploration survives wall buffer reorder through stable geometry keys", () => {
    const context = loadScript(EXPLORATION_PATH);
    const system = context.getWizardFlatlandExplorationApi().createExplorationSystem({ cellSize: 0.25 });
    const first = wall(0, 0, 2, 0, 1, 0);
    const second = wall(0, 2, 2, 2, 2, 1);
    system.syncWalls(Float32Array.from([...first, ...second]), LAYOUT);
    system.applyVisibility(Int32Array.from([0]), Float32Array.from([0.5]));

    system.syncWalls(Float32Array.from([...second, ...first]), LAYOUT);
    const explored = intervals(system);
    assert.equal(explored.length, 1);
    assert.equal(explored[0].ay, 0);
});

test("Wizard of Flatland exploration translates LOS positions when wall endpoints reverse", () => {
    const context = loadScript(EXPLORATION_PATH);
    const system = context.getWizardFlatlandExplorationApi().createExplorationSystem({ cellSize: 0.25 });
    system.syncWalls(Float32Array.from(wall(0, 0, 2, 0)), LAYOUT);
    system.syncWalls(Float32Array.from(wall(2, 0, 0, 0)), LAYOUT);
    system.applyVisibility(Int32Array.from([0]), Float32Array.from([0.125]));

    assert.deepEqual(intervals(system).map(({ startT, endT }) => [startT, endT]), [[0.75, 1]]);
});

test("Wizard of Flatland explored coverage is inherited by surviving wall pieces", () => {
    const context = loadScript(EXPLORATION_PATH);
    const system = context.getWizardFlatlandExplorationApi().createExplorationSystem({ cellSize: 0.25 });
    const parent = { ax: 0, ay: 0, bx: 4, by: 0, labelCode: 1, sideCode: 0 };
    system.syncWalls(Float32Array.from(wall(0, 0, 4, 0)), LAYOUT);
    system.applyVisibility(Int32Array.from([0, 0]), Float32Array.from([0.05, 0.95]));

    const children = [
        { ...parent, bx: 1.5 },
        { ...parent, ax: 2.5 }
    ];
    system.inheritSplit(parent, children);
    system.syncWalls(Float32Array.from([
        ...wall(0, 0, 1.5, 0),
        ...wall(2.5, 0, 4, 0)
    ]), LAYOUT);

    const explored = intervals(system);
    assert.equal(explored.length, 2);
    assert.ok(explored.every((entry) => entry.startT === 0 && entry.endT === 1));
});
