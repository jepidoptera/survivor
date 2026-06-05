const test = require("node:test");
const assert = require("node:assert/strict");

test("stair arc metadata preserves sweeps beyond 180 degrees", async () => {
    const { BuildingRenderer } = await import("../public/building-editor/BuildingRenderer.js");
    const renderer = Object.create(BuildingRenderer.prototype);
    const angle = -3 * Math.PI / 4;
    const previous = {
        left: { x: 1, y: 0 },
        right: { x: 3, y: 0 }
    };
    const next = {
        left: { x: Math.cos(angle), y: Math.sin(angle) },
        right: { x: Math.cos(angle) * 3, y: Math.sin(angle) * 3 },
        arcDeltaAngle: 5 * Math.PI / 4,
        arcNearDeltaAngle: 5 * Math.PI / 4
    };

    const section = renderer.stairSectionBetweenTreads(previous, next, "test stair section");
    const midpoint = section.pointOuter(0.5);

    assert.equal(section.kind, "annular");
    assert.ok(midpoint.y > 0, "extended sweep should continue counterclockwise instead of flipping clockwise");
    assert.ok(Math.abs(section.area - 0.5 * (5 * Math.PI / 4) * (9 - 1)) < 0.000001);
});

test("stair arc metadata preserves sweeps beyond a full turn", async () => {
    const { BuildingRenderer } = await import("../public/building-editor/BuildingRenderer.js");
    const renderer = Object.create(BuildingRenderer.prototype);
    const angle = Math.PI / 2;
    const previous = {
        left: { x: 1, y: 0 },
        right: { x: 3, y: 0 }
    };
    const next = {
        left: { x: Math.cos(angle), y: Math.sin(angle) },
        right: { x: Math.cos(angle) * 3, y: Math.sin(angle) * 3 },
        arcDeltaAngle: 5 * Math.PI / 2,
        arcNearDeltaAngle: 5 * Math.PI / 2
    };

    const section = renderer.stairSectionBetweenTreads(previous, next, "test full-turn stair section");

    assert.equal(section.kind, "annular");
    assert.ok(Math.abs(section.area - 0.5 * (5 * Math.PI / 2) * (9 - 1)) < 0.000001);
    assert.deepEqual(
        {
            x: Math.round(section.pointOuter(1).x * 1000000) / 1000000,
            y: Math.round(section.pointOuter(1).y * 1000000) / 1000000
        },
        { x: 0, y: 3 }
    );
});

test("stair tool keeps pending drag winding beyond a full turn", async () => {
    const { StairTool } = await import("../public/building-editor/tools/StairTool.js");
    const tool = new StairTool({});
    const angle = Math.PI / 2;
    const previous = {
        left: { x: 1, y: 0 },
        right: { x: 3, y: 0 },
        center: { x: 2, y: 0 },
        angle: 0
    };
    const pending = {
        left: { x: Math.cos(angle), y: Math.sin(angle) },
        right: { x: Math.cos(angle) * 3, y: Math.sin(angle) * 3 },
        center: { x: Math.cos(angle) * 2, y: Math.sin(angle) * 2 },
        angle
    };
    const draft = {
        treads: [previous],
        pendingArcState: {
            treadIndex: 0,
            kind: "annular",
            deltaAngle: 2 * Math.PI
        }
    };

    const resolved = tool._pendingTreadWithArcMetadata(draft, previous, pending);

    assert.ok(Math.abs(resolved.arcDeltaAngle - 5 * Math.PI / 2) < 0.000001);
    assert.ok(Math.abs(resolved.arcNearDeltaAngle - 5 * Math.PI / 2) < 0.000001);
});

test("stair tool snaps pending arcs to 90-degree turns after straight", async () => {
    const { StairTool } = await import("../public/building-editor/tools/StairTool.js");
    const { BuildingRenderer } = await import("../public/building-editor/BuildingRenderer.js");
    const tool = new StairTool({});
    const renderer = Object.create(BuildingRenderer.prototype);
    const previous = {
        left: { x: 1, y: 0 },
        right: { x: 3, y: 0 },
        center: { x: 2, y: 0 },
        angle: 0
    };
    const pendingAt = (angle) => ({
        left: { x: Math.cos(angle), y: Math.sin(angle) },
        right: { x: Math.cos(angle) * 3, y: Math.sin(angle) * 3 },
        center: { x: Math.cos(angle) * 2, y: Math.sin(angle) * 2 },
        angle
    });

    const quarterTurn = tool._pendingTreadWithArcMetadata(
        { treads: [previous], pendingArcState: null },
        previous,
        pendingAt(Math.PI / 2 - 0.03)
    );
    const halfTurn = tool._pendingTreadWithArcMetadata(
        { treads: [previous], pendingArcState: null },
        previous,
        pendingAt(Math.PI - 0.03)
    );
    const threeQuarterTurn = tool._pendingTreadWithArcMetadata(
        {
            treads: [previous],
            pendingArcState: {
                treadIndex: 0,
                kind: "annular",
                deltaAngle: 3 * Math.PI / 2 - 0.05
            }
        },
        previous,
        pendingAt(-Math.PI / 2 - 0.03)
    );
    const fullTurn = tool._pendingTreadWithArcMetadata(
        {
            treads: [previous],
            pendingArcState: {
                treadIndex: 0,
                kind: "annular",
                deltaAngle: 2 * Math.PI - 0.05
            }
        },
        previous,
        pendingAt(-0.03)
    );

    assert.ok(Math.abs(quarterTurn.arcDeltaAngle - Math.PI / 2) < 0.000001);
    assert.ok(Math.abs(quarterTurn.arcNearDeltaAngle - Math.PI / 2) < 0.000001);
    assert.ok(Math.abs(halfTurn.arcDeltaAngle - Math.PI) < 0.000001);
    assert.ok(Math.abs(halfTurn.arcNearDeltaAngle - Math.PI) < 0.000001);
    assert.ok(Math.abs(threeQuarterTurn.arcDeltaAngle - 3 * Math.PI / 2) < 0.000001);
    assert.ok(Math.abs(threeQuarterTurn.arcNearDeltaAngle - 3 * Math.PI / 2) < 0.000001);
    assert.ok(Math.abs(fullTurn.arcDeltaAngle - 2 * Math.PI) < 0.000001);
    assert.ok(Math.abs(fullTurn.arcNearDeltaAngle - 2 * Math.PI) < 0.000001);
    assert.ok(Math.abs(renderer.stairSectionBetweenTreads(previous, quarterTurn).area - 0.5 * (Math.PI / 2) * (9 - 1)) < 0.0001);
    assert.ok(Math.abs(renderer.stairSectionBetweenTreads(previous, halfTurn).area - 0.5 * Math.PI * (9 - 1)) < 0.0001);
    assert.ok(Math.abs(renderer.stairSectionBetweenTreads(previous, threeQuarterTurn).area - 0.5 * (3 * Math.PI / 2) * (9 - 1)) < 0.0001);
    assert.ok(Math.abs(renderer.stairSectionBetweenTreads(previous, fullTurn).area - 0.5 * (2 * Math.PI) * (9 - 1)) < 0.0001);
});

test("stair wall snap only moves pending tread position and keeps winding", async () => {
    const { StairTool } = await import("../public/building-editor/tools/StairTool.js");
    let changeCount = 0;
    const draft = {
        kind: "stair",
        started: true,
        completed: false,
        floorId: "floor",
        width: 2,
        treads: [{
            left: { x: 1, y: 0 },
            right: { x: 3, y: 0 },
            center: { x: 2, y: 0 },
            angle: 0
        }],
        pendingArcState: {
            treadIndex: 0,
            kind: "annular",
            deltaAngle: 2 * Math.PI
        }
    };
    const tool = new StairTool({
        building: {
            floorFragments: [{ fragmentId: "floor" }]
        },
        draft,
        emitChange() {
            changeCount++;
        }
    });
    tool._wallSnap = () => ({
        projection: { x: -1, y: 2 },
        normal: { x: 1, y: 0 }
    });

    tool._updatePendingTread({ x: -0.8, y: 2.1 });

    assert.equal(changeCount, 1);
    assert.ok(Math.abs(draft.pendingTread.center.x) < 0.000001);
    assert.ok(Math.abs(draft.pendingTread.center.y - 2) < 0.000001);
    assert.ok(Math.abs(draft.pendingTread.angle) > 0.1, "wall snap should not force the tread to the wall normal angle");
    assert.ok(Math.abs(draft.pendingTread.arcDeltaAngle - 5 * Math.PI / 2) < 0.000001);
    assert.ok(Math.abs(draft.pendingArcState.deltaAngle - 5 * Math.PI / 2) < 0.000001);
});

test("stair arc metadata fails loudly when it contradicts tread geometry", async () => {
    const { BuildingRenderer } = await import("../public/building-editor/BuildingRenderer.js");
    const renderer = Object.create(BuildingRenderer.prototype);
    const angle = -3 * Math.PI / 4;

    assert.throws(() => renderer.stairSectionBetweenTreads(
        {
            left: { x: 1, y: 0 },
            right: { x: 3, y: 0 }
        },
        {
            left: { x: Math.cos(angle), y: Math.sin(angle) },
            right: { x: Math.cos(angle) * 3, y: Math.sin(angle) * 3 },
            arcDeltaAngle: Math.PI / 2
        },
        "test stair section"
    ), /arcDeltaAngle does not match tread endpoint geometry/);
});
