const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const EXPLORATION_PATH = path.join(__dirname, "../public/wizard-of-flatland/exploration.js");
const LOS_PATH = path.join(__dirname, "../public/wizard-of-flatland/los.js");
const MAIN_SOURCE = fs.readFileSync(path.join(__dirname, "../public/wizard-of-flatland/main.js"), "utf8");
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

function bruteForceLos(walls, bins, maxDistance) {
    const depths = new Float32Array(bins);
    const hitWallIndices = new Int32Array(bins);
    hitWallIndices.fill(-1);
    for (let i = 0; i < bins; i++) {
        const theta = -Math.PI + ((i + 0.5) / bins) * Math.PI * 2;
        const dirX = Math.cos(theta);
        const dirY = Math.sin(theta);
        let best = maxDistance;
        for (let offset = 0; offset < walls.length; offset += LAYOUT.stride) {
            const ax = walls[offset + LAYOUT.x1];
            const ay = walls[offset + LAYOUT.y1];
            const sx = walls[offset + LAYOUT.x2] - ax;
            const sy = walls[offset + LAYOUT.y2] - ay;
            const denominator = dirX * sy - dirY * sx;
            if (Math.abs(denominator) < 1e-8) continue;
            const qpx = ax;
            const qpy = ay;
            const distance = (qpx * sy - qpy * sx) / denominator;
            const wallT = (qpx * dirY - qpy * dirX) / denominator;
            if (distance < 0 || wallT < 0 || wallT > 1) continue;
            if (distance < best || (hitWallIndices[i] < 0 && distance <= best)) {
                best = distance;
                hitWallIndices[i] = offset / LAYOUT.stride;
            }
        }
        depths[i] = best;
    }
    return { depths, hitWallIndices };
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

test("Wizard of Flatland LOS casts one silhouette for a solid tree polygon", () => {
    const context = loadScript(LOS_PATH);
    const api = context.getWizardFlatlandLosApi();
    const vertices = [
        [5, -3], [6, -1], [8, -2], [7, 0],
        [8, 2], [6, 1], [5, 3], [4, 0]
    ];
    const walls = [];
    for (let i = 0; i < vertices.length; i++) {
        const a = vertices[i];
        const b = vertices[(i + 1) % vertices.length];
        walls.push(...wall(a[0], a[1], b[0], b[1], 40, 0));
    }
    const result = api.computeVisibilityPolygon({
        x: 0,
        y: 0,
        walls: Float32Array.from(walls),
        wallStride: 8,
        wallLabelCode: 4,
        wallSideCode: 5,
        treeLabelCode: 40,
        bins: 360,
        maxDistance: 20
    });

    assert.equal(result.scannedWallCount, vertices.length);
    assert.equal(result.candidateWallCount, 1);
    const hitBins = [];
    for (let bin = 0; bin < result.hitWallIndices.length; bin++) {
        if (result.hitWallIndices[bin] >= 0) hitBins.push(bin);
    }
    assert.ok(hitBins.length > 0);
    assert.ok(hitBins.every((bin) => result.hitWallIndices[bin] === 0));
    assert.equal(hitBins.at(-1) - hitBins[0] + 1, hitBins.length);
});

test("Wizard of Flatland LOS retains crossing walls and rejects walls outside the sight circle", () => {
    const context = loadScript(LOS_PATH);
    const api = context.getWizardFlatlandLosApi();
    const bins = 3600;
    const result = api.computeVisibilityPolygon({
        x: 0,
        y: 0,
        walls: Float32Array.from([
            ...wall(5, -30, 5, 30),
            ...wall(15, 15, 25, 15)
        ]),
        wallStride: 8,
        bins,
        maxDistance: 20
    });

    assert.equal(result.candidateWallCount, 1);
    assert.ok(Array.from(result.hitWallIndices).some((index) => index === 0));
    assert.ok(Array.from(result.hitWallIndices).every((index) => index !== 1));
    assert.ok(result.raySegmentTests > 0);
    assert.ok(result.raySegmentTests < bins);
});

test("Wizard of Flatland LOS tests origin-crossing walls against every ray", () => {
    const context = loadScript(LOS_PATH);
    const api = context.getWizardFlatlandLosApi();
    const bins = 64;
    const result = api.computeVisibilityPolygon({
        x: 0,
        y: 0,
        walls: Float32Array.from(wall(-5, 0, 5, 0)),
        wallStride: 8,
        bins,
        maxDistance: 20
    });

    assert.equal(result.raySegmentTests, bins);
    assert.ok(Array.from(result.depths).every((depth) => depth === 0));
});

test("Wizard of Flatland optimized LOS matches brute-force ray intersections", () => {
    const context = loadScript(LOS_PATH);
    const api = context.getWizardFlatlandLosApi();
    const walls = Float32Array.from([
        ...wall(5, -30, 5, 30),
        ...wall(-14, -3, -7, 8),
        ...wall(-8, -0.2, -8, 0.2),
        ...wall(15, 15, 25, 15),
        ...wall(-30, -4, 30, -4)
    ]);
    const bins = 720;
    const maxDistance = 20;
    const optimized = api.computeVisibilityPolygon({ x: 0, y: 0, walls, wallStride: 8, bins, maxDistance });
    const brute = bruteForceLos(walls, bins, maxDistance);

    assert.deepEqual(Array.from(optimized.hitWallIndices), Array.from(brute.hitWallIndices));
    assert.deepEqual(Array.from(optimized.depths), Array.from(brute.depths));
    assert.ok(optimized.raySegmentTests < optimized.candidateWallCount * bins);
});

test("Wizard of Flatland LOS scans only supplied wall ranges while preserving global indices", () => {
    const context = loadScript(LOS_PATH);
    const api = context.getWizardFlatlandLosApi();
    const result = api.computeVisibilityPolygon({
        x: 0,
        y: 0,
        walls: Float32Array.from([
            ...wall(2, -5, 2, 5),
            ...wall(4, -5, 4, 5),
            ...wall(6, -5, 6, 5)
        ]),
        wallStride: 8,
        bins: 64,
        maxDistance: 20,
        wallRanges: [{ startWallIndex: 1, wallCount: 1 }]
    });

    assert.equal(result.scannedWallCount, 1);
    assert.equal(result.candidateWallCount, 1);
    assert.ok(Array.from(result.hitWallIndices).some((index) => index === 1));
    assert.ok(Array.from(result.hitWallIndices).every((index) => index === -1 || index === 1));
});

test("Wizard of Flatland exploration fills adjacent LOS hits with one-cell padding", () => {
    const context = loadScript(EXPLORATION_PATH);
    const system = context.getWizardFlatlandExplorationApi().createExplorationSystem({ cellSize: 0.25 });
    system.syncWalls(Float32Array.from(wall(0, 0, 2, 0)), LAYOUT);
    system.applyVisibility(Int32Array.from([0, 0]), Float32Array.from([0.375, 0.625]));

    assert.deepEqual(intervals(system).map(({ startT, endT }) => [startT, endT]), [[0.25, 0.875]]);
});

test("Wizard of Flatland tree discovery turns one silhouette hit into a binary reveal", () => {
    const context = loadScript(EXPLORATION_PATH);
    const system = context.getWizardFlatlandExplorationApi().createExplorationSystem({ cellSize: 0.25 });
    const treeWalls = Float32Array.from([
        ...wall(4, -1, 5, 0, 40, 0),
        ...wall(5, 0, 4, 1, 40, 0),
        ...wall(4, 1, 4, -1, 40, 0)
    ]);
    system.syncWalls(treeWalls, LAYOUT);
    system.revealActiveWall(0);
    system.revealActiveWall(1);
    system.revealActiveWall(2);

    assert.equal(intervals(system).length, 3);
    assert.ok(intervals(system).every(({ startT, endT }) => startT === 0 && endT === 1));
    assert.match(
        MAIN_SOURCE,
        /explorationSystem\.applyVisibility\(message\.hitWallIndices, message\.hitWallTs\);\s*discoverTreesHitByLosRays\(message\.hitWallIndices\)/
    );
    assert.match(
        MAIN_SOURCE,
        /function discoverTreesHitByLosRays[\s\S]*const hitBase = wallIndex \* WALL_STRIDE[\s\S]*explorationSystem\.revealActiveWall\(base \/ WALL_STRIDE\)/
    );
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

test("Wizard of Flatland exploration round-trips packed section wall state", () => {
    const context = loadScript(EXPLORATION_PATH);
    const source = context.getWizardFlatlandExplorationApi().createExplorationSystem({ cellSize: 0.25 });
    const walls = Float32Array.from([
        ...wall(0, 0, 2, 0),
        ...wall(0, 1, 2, 1)
    ]);
    source.syncWalls(walls, LAYOUT);
    source.applyVisibility(Int32Array.from([1]), Float32Array.from([0.5]));
    const saved = source.exportWalls(walls, LAYOUT);

    assert.equal(saved.length, 1);
    assert.ok(saved[0].bits instanceof Uint32Array);

    const restored = context.getWizardFlatlandExplorationApi().createExplorationSystem({ cellSize: 0.25 });
    restored.importWalls(saved);
    restored.syncWalls(walls, LAYOUT);
    const restoredIntervals = intervals(restored);
    assert.equal(restoredIntervals.length, 1);
    assert.equal(restoredIntervals[0].ay, 1);
    assert.deepEqual([restoredIntervals[0].startT, restoredIntervals[0].endT], [0.375, 0.75]);
});
