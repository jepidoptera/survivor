const test = require("node:test");
const assert = require("node:assert/strict");

const savedWallSectionUnit = globalThis.WallSectionUnit;
require("../public/assets/javascript/gameobjects/wallSectionUnit.js");
const WallSectionUnit = globalThis.WallSectionUnit;

test.after(() => {
    if (typeof savedWallSectionUnit === "undefined") {
        delete globalThis.WallSectionUnit;
    } else {
        globalThis.WallSectionUnit = savedWallSectionUnit;
    }
});

const testMap = {
    shortestDeltaX(fromX, toX) { return Number(toX) - Number(fromX); },
    shortestDeltaY(fromY, toY) { return Number(toY) - Number(fromY); }
};

function makeWall(id, startX, endX, options = {}) {
    return {
        type: "wallSection",
        id,
        map: testMap,
        gone: false,
        vanishing: false,
        startPoint: { x: startX, y: 0 },
        endPoint: { x: endX, y: 0 },
        height: 2,
        thickness: 0.375,
        bottomZ: Number.isFinite(options.bottomZ) ? Number(options.bottomZ) : 0,
        traversalLayer: Number.isFinite(options.traversalLayer) ? Number(options.traversalLayer) : 0,
        direction: 0,
        lineAxis: 0,
        wallTexturePath: "/assets/images/walls/stonewall.png",
        connections: new Map(),
        _isCollinearWallForVisibility: WallSectionUnit.prototype._isCollinearWallForVisibility,
        _isSameWallLineForVisibility: WallSectionUnit.prototype._isSameWallLineForVisibility
    };
}

test("maze visibility collinear wall check rejects separated runs on the same infinite line", () => {
    const visibleRun = makeWall(1, 0, 1);
    const distantRun = makeWall(2, 3, 4);

    assert.equal(visibleRun._isCollinearWallForVisibility(distantRun), false);
    assert.equal(visibleRun._isSameWallLineForVisibility(distantRun), false);
});

test("maze visibility collinear wall check keeps touching and overlapping runs grouped", () => {
    const visibleRun = makeWall(1, 0, 2);
    const touchingRun = makeWall(2, 2, 3);
    const overlappingRun = makeWall(3, 1, 3);

    assert.equal(visibleRun._isCollinearWallForVisibility(touchingRun), true);
    assert.equal(visibleRun._isCollinearWallForVisibility(overlappingRun), true);
});

test("maze visibility wall-line checks do not cross traversal layers", () => {
    const groundRun = makeWall(1, 0, 2, { traversalLayer: 0, bottomZ: 0 });
    const upperRun = makeWall(2, 1, 2, { traversalLayer: 1, bottomZ: 3 });

    assert.equal(groundRun._isCollinearWallForVisibility(upperRun), false);
    assert.equal(groundRun._isSameWallLineForVisibility(upperRun), false);
});
