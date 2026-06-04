const test = require("node:test");
const assert = require("node:assert/strict");

const savedPlacement = globalThis.PlaceObjectPlacement;
require("../public/assets/javascript/placeObjectPlacement.js");
const placementApi = globalThis.PlaceObjectPlacement;

test.after(() => {
    if (typeof savedPlacement === "undefined") {
        delete globalThis.PlaceObjectPlacement;
    } else {
        globalThis.PlaceObjectPlacement = savedPlacement;
    }
});

function makeSection() {
    return {
        id: 7,
        startPoint: { x: 0, y: 0 },
        endPoint: { x: 4, y: 0 },
        height: 3,
        thickness: 0.2,
        bottomZ: 0,
        getWallProfile() {
            return {
                aLeft: { x: 0, y: 0.1 },
                bLeft: { x: 4, y: 0.1 },
                aRight: { x: 0, y: -0.1 },
                bRight: { x: 4, y: -0.1 }
            };
        }
    };
}

function toScreenPoint(point, z = 0) {
    return {
        x: Number(point.x) * 100,
        y: Number(point.y) * 100 - Number(z) * 100
    };
}

function placeAt(screenY, options = {}) {
    return placeAtPoint({ x: 200, y: screenY }, options);
}

function placeAtPoint(mouseScreen, options = {}) {
    return placementApi.resolveWallMountedPlacementCandidate({
        section: makeSection(),
        category: "windows",
        worldX: Number(mouseScreen.x) / 100,
        worldY: 0,
        mouseScreen,
        toScreenPoint,
        width: 1,
        height: 1,
        placeableScale: 1,
        anchorY: 0.5,
        centerSnapPx: 10,
        ...options
    });
}

test("window wall placement follows mouse y and clamps inside wall bounds", () => {
    const lower = placeAt(10);
    const upper = placeAt(-290);

    assert.equal(lower.valid, true);
    assert.equal(upper.valid, true);
    assert.equal(lower.snappedZ, 0.5);
    assert.equal(lower.wallAnchorZ, 0.5);
    assert.equal(upper.snappedZ, 2.5);
    assert.equal(upper.wallAnchorZ, 2.5);
});

test("window wall placement snaps vertically to wall center within ten pixels", () => {
    const centered = placeAt(-135);

    assert.equal(centered.valid, true);
    assert.equal(centered.verticalCenterSnapActive, true);
    assert.equal(centered.snappedZ, 1.5);
    assert.equal(centered.wallAnchorZ, 1.5);
});

test("window wall placement snaps vertically to another window height", () => {
    const aligned = placeAt(-195, {
        verticalSnapTargets: [{ id: "other-window", absoluteZ: 2 }]
    });

    assert.equal(aligned.valid, true);
    assert.equal(aligned.verticalCenterSnapActive, false);
    assert.equal(aligned.verticalPeerSnapActive, true);
    assert.equal(aligned.verticalSnapKind, "matchingWindow");
    assert.equal(aligned.verticalSnapTarget.id, "other-window");
    assert.equal(aligned.snappedZ, 2);
    assert.equal(aligned.wallAnchorZ, 2);
});

test("window wall placement uses snap points per wall section", () => {
    const snapped = placeAtPoint({ x: 345, y: -135 }, {
        snapPointsPerSection: 4
    });

    assert.equal(snapped.valid, true);
    assert.equal(snapped.centerSnapActive, true);
    assert.ok(Math.abs(snapped.wallT - 0.875) < 0.000001);
    assert.ok(Math.abs(snapped.wallCenterX - 3.5) < 0.000001);
});
