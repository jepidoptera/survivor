const test = require("node:test");
const assert = require("node:assert/strict");

test("regular polygon helper derives the polygon on the selected side of the edge", async () => {
    const { buildRegularPolygonFromSide } = await import("../public/building-editor/tools/PolygonEditTool.js");

    const left = buildRegularPolygonFromSide(
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        4,
        { x: 0.5, y: 1 }
    );
    const right = buildRegularPolygonFromSide(
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        4,
        { x: 0.5, y: -1 }
    );

    assert.deepEqual(roundPoints(left), [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 }
    ]);
    assert.deepEqual(roundPoints(right), [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: -1 },
        { x: 0, y: -1 }
    ]);
});

test("regular polygon tool previews after two clicks and completes on the third click", async () => {
    const { PolygonEditTool } = await import("../public/building-editor/tools/PolygonEditTool.js");
    const applied = [];
    const state = {
        polygonToolElevation: 2,
        polygonToolRegularPolygon: true,
        polygonToolSides: 5,
        draft: null,
        changeCount: 0,
        preparePoint(point) {
            return { x: Number(point.x), y: Number(point.y) };
        },
        prepareLinePoint(point) {
            return { x: Number(point.x), y: Number(point.y) };
        },
        emitChange() {
            this.changeCount += 1;
        },
        applyPolygonDraftAtElevation(points, operation, elevation) {
            applied.push({ points, operation, elevation });
        }
    };
    const tool = new PolygonEditTool(state, "add");

    tool.pointerDown({ x: 0, y: 0 });
    assert.equal(state.draft.points.length, 1);
    assert.equal(state.draft.completed, false);

    tool.pointerDown({ x: 1, y: 0 });
    assert.equal(state.draft.points.length, 2);
    assert.equal(state.draft.regularPolygon.phase, "sideChoice");

    tool.pointerMove({ x: 0.5, y: 1 });
    assert.equal(state.draft.previewPoints.length, 5);
    assert.equal(state.draft.completed, false);

    tool.pointerDown({ x: 0.5, y: 1 });
    assert.equal(state.draft.completed, true);
    assert.equal(state.draft.points.length, 5);

    tool.finish();
    assert.equal(applied.length, 1);
    assert.equal(applied[0].operation, "add");
    assert.equal(applied[0].elevation, 2);
    assert.equal(applied[0].points.length, 5);
    assert.equal(state.draft, null);
});

function roundPoints(points) {
    return points.map((point) => ({
        x: Math.round(point.x * 1000000) / 1000000,
        y: Math.round(point.y * 1000000) / 1000000
    }));
}
