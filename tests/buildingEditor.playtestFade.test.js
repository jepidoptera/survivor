const test = require("node:test");
const assert = require("node:assert/strict");

async function loadRenderer() {
    return import("../public/building-editor/BuildingRenderer.js");
}

function createRenderer(BuildingRenderer) {
    const lower = {
        fragmentId: "floor-lower",
        nodeBaseZ: 0,
        outerPolygon: [
            { x: 0, y: 0 },
            { x: 4, y: 0 },
            { x: 4, y: 4 },
            { x: 0, y: 4 }
        ]
    };
    const upper = {
        fragmentId: "floor-upper",
        nodeBaseZ: 3,
        outerPolygon: [
            { x: 0, y: 0 },
            { x: 4, y: 0 },
            { x: 4, y: 4 },
            { x: 0, y: 4 }
        ]
    };
    const renderer = Object.create(BuildingRenderer.prototype);
    renderer.app = { screen: { width: 800, height: 600 } };
    renderer.state = {
        building: { floorFragments: [lower, upper] },
        playtestFloorFade: {
            fromFloorId: "floor-lower",
            toFloorId: "floor-upper",
            progress: 0.5
        },
        renderStyle() {
            return "interior";
        },
        selectedFloor() {
            return lower;
        }
    };
    return { renderer, lower, upper };
}

test("building editor playtest fade renders only the destination floor live", async () => {
    const { BuildingRenderer } = await loadRenderer();
    const { renderer, upper } = createRenderer(BuildingRenderer);

    assert.deepEqual(renderer.renderedFloors(), [upper]);
});

test("building editor playtest fade keeps live destination floor opaque", async () => {
    const { BuildingRenderer } = await loadRenderer();
    const { renderer, upper } = createRenderer(BuildingRenderer);

    const alphaById = renderer.renderedFloorAlphaMap([upper], false);

    assert.equal(alphaById.get("floor-upper"), 1);
});

test("building editor playtest floor snapshot fades the outgoing image out", async () => {
    const { BuildingRenderer } = await loadRenderer();
    const { renderer } = createRenderer(BuildingRenderer);

    assert.equal(renderer.playtestFloorSnapshotAlpha(), 0.5);
    renderer.state.playtestFloorFade.progress = 1;
    assert.equal(renderer.playtestFloorSnapshotAlpha(), 0);
});

test("building editor playtest snapshot capture override renders the source floor opaque", async () => {
    const { BuildingRenderer } = await loadRenderer();
    const { renderer, lower } = createRenderer(BuildingRenderer);
    renderer.playtestFloorRenderOverride = {
        floorIds: new Set(["floor-lower"]),
        suppressFade: true
    };

    assert.deepEqual(renderer.renderedFloors(), [lower]);
    assert.equal(renderer.renderedFloorAlphaMap([lower], false).get("floor-lower"), 1);
});

test("building editor playtest floor snapshot sprite uses render-texture y flip", async () => {
    const { BuildingRenderer } = await loadRenderer();
    const { renderer } = createRenderer(BuildingRenderer);
    const sprite = {
        texture: { width: 800, height: 600 },
        anchor: { set(x, y) { this.x = x; this.y = y; } },
        position: { set(x, y) { this.x = x; this.y = y; } },
        scale: { set(x, y) { this.x = x; this.y = y; } }
    };

    renderer.applyPlaytestFloorSnapshotSpriteTransform(sprite, 800, 600, 12, -8);

    assert.equal(sprite.anchor.x, 0);
    assert.equal(sprite.anchor.y, 0);
    assert.equal(sprite.position.x, 12);
    assert.equal(sprite.position.y, 592);
    assert.equal(sprite.scale.x, 1);
    assert.equal(sprite.scale.y, -1);
});
