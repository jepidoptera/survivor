const test = require("node:test");
const assert = require("node:assert/strict");

const StairTraversal = require("../public/assets/javascript/shared/StairTraversal.js");

function assertApproxEqual(actual, expected, epsilon = 0.000001) {
    assert.ok(
        Math.abs(Number(actual) - Number(expected)) <= epsilon,
        `${actual} should be within ${epsilon} of ${expected}`
    );
}

function createStraightStair(height) {
    return {
        id: `straight-${height}`,
        lowerPoint: { x: 0, y: 0 },
        higherPoint: { x: 10, y: 0 },
        width: 2,
        lowerZ: 0,
        higherZ: height,
        stepCount: 10
    };
}

function createTreadPathStair(height) {
    return {
        id: `tread-path-${height}`,
        lowerZ: 0,
        higherZ: height,
        width: 2,
        stepCount: 10,
        treads: [
            {
                left: { x: 0, y: -1 },
                right: { x: 0, y: 1 }
            },
            {
                left: { x: 10, y: -1 },
                right: { x: 10, y: 1 }
            }
        ]
    };
}

test("straight stair movement spends along speed over the 3D stair surface", () => {
    const frame = StairTraversal.createStraightFrame(createStraightStair(10));
    const next = StairTraversal.moveStraightLocal(frame, { upDown: 0.5, leftRight: 0.5 }, { x: 1, y: 0 }, 1, 1);
    const deltaUpDown = next.upDown - 0.5;

    assertApproxEqual(deltaUpDown, 1 / Math.hypot(10, 10));
    assertApproxEqual(Math.hypot(10 * deltaUpDown, 10 * deltaUpDown), 1);
});

test("flat straight stair movement keeps the old planar speed", () => {
    const frame = StairTraversal.createStraightFrame(createStraightStair(0));
    const next = StairTraversal.moveStraightLocal(frame, { upDown: 0.5, leftRight: 0.5 }, { x: 1, y: 0 }, 1, 1);

    assertApproxEqual(next.upDown - 0.5, 1 / 10);
});

test("tread path stair movement spends along speed over the 3D stair surface", () => {
    const frame = StairTraversal.createTreadPathFrame(createTreadPathStair(10));
    const next = StairTraversal.movePathLocal(frame, { upDown: 0.5, leftRight: 0.5 }, { x: 1, y: 0 }, 1, 1);
    const deltaUpDown = next.upDown - 0.5;

    assertApproxEqual(deltaUpDown, 1 / Math.hypot(frame.pathLength, 10));
    assertApproxEqual(Math.hypot(frame.pathLength * deltaUpDown, 10 * deltaUpDown), 1);
});

test("tread path stair lateral movement does not pay vertical rise", () => {
    const frame = StairTraversal.createTreadPathFrame(createTreadPathStair(10));
    const next = StairTraversal.movePathLocal(frame, { upDown: 0.5, leftRight: 0.5 }, { x: 0, y: 1 }, 1, 1);

    assertApproxEqual(next.upDown, 0.5);
    assertApproxEqual(next.leftRight, 1);
});
