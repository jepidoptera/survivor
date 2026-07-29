const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const MODULE_PATH = path.join(__dirname, "../public/wizard-of-flatland/wallBreaking.js");

function createSystem() {
    const context = { Map, Math, Number, Object, Float32Array };
    context.globalThis = context;
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(MODULE_PATH, "utf8"), context, { filename: MODULE_PATH });
    return context.WizardFlatlandWallBreaking.createWallBreakingSystem({
        wallStride: 8,
        wallX1: 0,
        wallY1: 1,
        wallX2: 2,
        wallY2: 3,
        wallLabelCode: 4,
        wallLabelSide: 5,
        baseSegmentLength: 3,
        segmentLengthPerZone: 1,
        baseHitpoints: 150
    });
}

function wall(ax, ay, bx, by) {
    return Float32Array.from([ax, ay, bx, by, 10, 0, 0, 0]);
}

function ranges(wallCount, sectionKey = "0,0") {
    return [{ sectionKey, startWallIndex: 0, wallCount }];
}

test("Wizard of Flatland wall segments distribute wall length evenly", () => {
    const system = createSystem();
    const result = system.buildRegistry(wall(0, 0, 10, 0), ranges(1), new Map(), () => 0);
    const segments = Array.from(result.registry.values());

    assert.equal(segments.length, 4);
    assert.deepEqual(segments.map((segment) => segment.length), [2.5, 2.5, 2.5, 2.5]);
    assert.deepEqual(segments.map((segment) => [segment.ax, segment.bx]), [
        [0, 2.5],
        [2.5, 5],
        [5, 7.5],
        [7.5, 10]
    ]);
});

test("Wizard of Flatland higher-zone walls use larger break segments", () => {
    const system = createSystem();
    const low = system.buildRegistry(wall(0, 0, 10, 0), ranges(1), new Map(), () => 0);
    const high = system.buildRegistry(wall(0, 0, 10, 0), ranges(1, "14,0"), new Map(), () => 2);

    assert.equal(low.registry.size, 4);
    assert.equal(high.registry.size, 2);
    assert.deepEqual(Array.from(high.registry.values(), (segment) => segment.length), [5, 5]);
});

test("Wizard of Flatland shared segment damage survives regrouping around a breach", () => {
    const system = createSystem();
    const original = system.buildRegistry(wall(0, 0, 10, 0), ranges(1), new Map(), () => 0);
    const originalSegments = Array.from(original.registry.values());
    originalSegments[0].damage = 25;
    originalSegments[3].damage = 60;

    const regroupedWalls = Float32Array.from([
        0, 0, 5, 0, 10, 0, 0, 0,
        7.5, 0, 10, 0, 10, 0, 0, 0
    ]);
    const regrouped = system.buildRegistry(regroupedWalls, ranges(2), original.registry, () => 0);

    assert.equal(regrouped.registry.get(originalSegments[0].id).damage, 25);
    assert.equal(regrouped.registry.get(originalSegments[3].id).damage, 60);
    assert.equal(regrouped.registry.has(originalSegments[2].id), false);
});

test("Wizard of Flatland rebuilding without an unloaded wall drops its damage", () => {
    const system = createSystem();
    const original = system.buildRegistry(wall(0, 0, 6, 0), ranges(1), new Map(), () => 0);
    original.registry.values().next().value.damage = 40;

    const unloaded = system.buildRegistry(new Float32Array(0), [], original.registry, () => 0);
    assert.equal(unloaded.registry.size, 0);
});

test("Wizard of Flatland target selection favors an already-damaged nearby segment", () => {
    const system = createSystem();
    const result = system.buildRegistry(wall(0, 0, 9, 0), ranges(1), new Map(), () => 0);
    const segments = Array.from(result.registry.values());
    segments[1].damage = segments[1].hitpoints * 0.8;

    const target = system.chooseTarget(result.registry, result.segmentIdsByWallIndex, 0, 4.5, 0);
    assert.equal(target.id, segments[1].id);
});
