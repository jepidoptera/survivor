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

test("building editor interior bitmap override keeps through-hole floor walls full height", async () => {
    const { BuildingRenderer } = await loadRenderer();
    const { renderer, lower, upper } = createRenderer(BuildingRenderer);
    renderer.state.selectedWallIds = () => [];
    renderer.playtestFloorRenderOverride = {
        floorIds: new Set(["floor-lower", "floor-upper"]),
        suppressFloorMeshIds: new Set(["floor-lower"]),
        fullHeightWallFloorIds: new Set(["floor-lower"]),
        suppressFade: true
    };
    renderer.wallIsInFrontOfFloor = () => true;
    renderer.floorOpenAreaScreenGeometry = () => [[[
        { X: 0, Y: 0 },
        { X: 10, Y: 0 },
        { X: 10, Y: 10 },
        { X: 0, Y: 10 }
    ]]];
    renderer.wallScreenImagePolygon = () => [[[
        { X: 0, Y: 0 },
        { X: 10, Y: 0 },
        { X: 10, Y: 10 },
        { X: 0, Y: 10 }
    ]]];

    assert.equal(renderer.shouldDrawWallCollapsed({ id: "lower-wall" }, lower), false);
});

test("building editor cutaway wall windows use tenth opacity", async () => {
    const { BuildingRenderer } = await loadRenderer();
    const renderer = Object.create(BuildingRenderer.prototype);

    assert.equal(renderer.collapsedWallMountedObjectAlpha({ category: "windows" }), 0.1);
    assert.equal(renderer.collapsedWallMountedObjectAlpha({ category: "doors" }), 0.5);
});

test("building editor visible-through floors keep mounted openings opaque", async () => {
    const { BuildingRenderer } = await loadRenderer();
    const { renderer, lower } = createRenderer(BuildingRenderer);
    renderer.lastWallPickEntries = [];
    renderer.shouldDrawWallCollapsed = () => true;
    renderer.playtestFloorRenderOverride = {
        floorIds: new Set(["floor-lower", "floor-upper"]),
        fullOpacityMountedObjectFloorIds: new Set(["floor-lower"]),
        suppressFade: true
    };

    const placement = { floor: lower, wall: { id: "lower-wall" } };

    assert.equal(renderer.mountedObjectAlphaMultiplier({ category: "windows" }, placement, 1), 1);
    assert.equal(renderer.mountedObjectAlphaMultiplier({ category: "doors" }, placement, 1), 1);
});

test("building editor interior bitmap override resolves lower-floor mounted openings", async () => {
    const { BuildingRenderer } = await loadRenderer();
    const { renderer, lower, upper } = createRenderer(BuildingRenderer);
    const wall = {
        id: 101,
        floorId: "floor-lower",
        fragmentId: "floor-lower",
        startPoint: { kind: "point", x: 0, y: 0 },
        endPoint: { kind: "point", x: 4, y: 0 },
        height: 3,
        thickness: 0.2
    };
    const windowObject = {
        id: 201,
        category: "windows",
        wallId: 101,
        wallT: 0.5,
        width: 1,
        height: 1,
        zOffset: 1,
        mountedWallFacingSign: 1
    };
    renderer.state.building.wallSections = [wall];
    renderer.state.building.mountedWallObjects = [windowObject];
    renderer.state.isFloorSelected = (floorId) => String(floorId) === "floor-upper";
    renderer.playtestFloorRenderOverride = {
        floorIds: new Set(["floor-lower", "floor-upper"]),
        suppressFade: true
    };

    const placement = renderer.mountedObjectPlacement(windowObject);

    assert.ok(placement);
    assert.equal(placement.floor, lower);
    assert.notEqual(placement.floor, upper);
});

test("building editor surface shader premultiplies tint alpha", async () => {
    const source = await require("node:fs/promises").readFile(
        require("node:path").join(__dirname, "../public/building-editor/BuildingRenderer.js"),
        "utf8"
    );

    assert.match(source, /outColor\.rgb \*= vLightFactor;\s+outColor\.rgb \*= uTint\.a;/);
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

test("building editor playtest wizard animation uses accumulated run phase", async () => {
    const { BuildingRenderer } = await loadRenderer();
    const renderer = Object.create(BuildingRenderer.prototype);
    const wizard = {
        lastDirectionRow: 6,
        moving: true,
        movementVector: { x: 4.5, y: 0 },
        speed: 4.5,
        animationSpeedMultiplier: 1,
        runAnimationPhase: 2.25,
        isMovingBackward: false,
        isJumping: false
    };

    const frameAtNormalSpeed = renderer.playtestWizardFrameIndex(wizard);
    wizard.movementVector = { x: 2.25, y: 0 };
    const frameAtDifferentSpeed = renderer.playtestWizardFrameIndex(wizard);

    assert.equal(frameAtNormalSpeed, 6 * 9 + 1 + 2);
    assert.equal(frameAtDifferentSpeed, frameAtNormalSpeed);
});

test("building editor playtest hides lower floor underlay guides", async () => {
    const { BuildingRenderer } = await loadRenderer();
    const renderer = Object.create(BuildingRenderer.prototype);
    renderer.worldToScreen = (point) => ({ x: Number(point.x), y: Number(point.y) });
    const lower = {
        outerPolygon: [
            { x: 0, y: 0 },
            { x: 2, y: 0 },
            { x: 2, y: 2 },
            { x: 0, y: 2 }
        ],
        holes: []
    };
    const selected = { elevation: 3 };
    const calls = [];
    const gfx = {
        lineStyle(...args) { calls.push(["lineStyle", ...args]); },
        moveTo(...args) { calls.push(["moveTo", ...args]); },
        lineTo(...args) { calls.push(["lineTo", ...args]); },
        beginFill(...args) { calls.push(["beginFill", ...args]); },
        drawCircle(...args) { calls.push(["drawCircle", ...args]); },
        endFill(...args) { calls.push(["endFill", ...args]); }
    };
    renderer.state = {
        floorUnderlay() {
            return lower;
        },
        selectedFloor() {
            return selected;
        },
        playtestWizard: null
    };

    renderer.drawFloorUnderlay(gfx);
    assert.equal(calls.some((call) => call[0] === "lineTo"), true);

    calls.length = 0;
    renderer.state.playtestWizard = { active: true };
    renderer.drawFloorUnderlay(gfx);

    assert.deepEqual(calls, []);
});
