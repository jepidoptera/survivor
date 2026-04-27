const test = require("node:test");
const assert = require("node:assert/strict");

const savedRoof = globalThis.Roof;
require("../public/assets/javascript/gameobjects/roof.js");
const Roof = globalThis.Roof;

test.after(() => {
    if (typeof savedRoof === "undefined") {
        delete globalThis.Roof;
    } else {
        globalThis.Roof = savedRoof;
    }
});

test("roof face UVs pin the eave edge to the bottom of the texture", () => {
    const repeatsPerUnit = 0.25;
    const uvs = Roof.computeFaceUvs([
        { x: 0, y: 0, z: 0 },
        { x: 4, y: 0, z: 0 },
        { x: 2, y: 0, z: 2 }
    ], repeatsPerUnit);

    assert.equal(uvs[1], 1);
    assert.equal(uvs[3], 1);
    assert.ok(uvs[5] < 1);
    assert.equal(uvs[1] - uvs[5], 0.5);
});

test("roof face UVs keep the eave edge pinned even when triangle winding flips", () => {
    const repeatsPerUnit = 0.25;
    const uvs = Roof.computeFaceUvs([
        { x: 0, y: 0, z: 0 },
        { x: 2, y: 0, z: 2 },
        { x: 4, y: 0, z: 0 }
    ], repeatsPerUnit);

    assert.equal(uvs[1], 1);
    assert.ok(uvs[3] < 1);
    assert.equal(uvs[5], 1);
    assert.equal(uvs[1] - uvs[3], 0.5);
});
