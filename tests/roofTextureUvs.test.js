const test = require("node:test");
const assert = require("node:assert/strict");

const savedRoof = globalThis.Roof;
const savedPolygonHitbox = globalThis.PolygonHitbox;
const savedScripting = globalThis.Scripting;
require("../public/assets/javascript/gameobjects/roof.js");
const Roof = globalThis.Roof;

test.after(() => {
    if (typeof savedRoof === "undefined") {
        delete globalThis.Roof;
    } else {
        globalThis.Roof = savedRoof;
    }
    if (typeof savedPolygonHitbox === "undefined") {
        delete globalThis.PolygonHitbox;
    } else {
        globalThis.PolygonHitbox = savedPolygonHitbox;
    }
    if (typeof savedScripting === "undefined") {
        delete globalThis.Scripting;
    } else {
        globalThis.Scripting = savedScripting;
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

test("roof loadJson can skip auto scripting-name generation during trusted restore", () => {
    let ensureCalls = 0;
    const setCalls = [];

    globalThis.PolygonHitbox = class PolygonHitbox {
        constructor(points) {
            this.points = points;
        }
    };
    globalThis.Scripting = {
        ensureObjectScriptingName() {
            ensureCalls += 1;
            return "generatedRoof";
        },
        setObjectScriptingName(target, name, options) {
            setCalls.push({ target, name, options });
            target.scriptingName = name;
            return true;
        }
    };

    const roof = Roof.loadJson({
        type: "roof",
        x: 4,
        y: 5,
        heightFromGround: 2,
        placed: true,
        vertices: [
            { x: -1, y: -1, z: 0 },
            { x: 1, y: -1, z: 0 },
            { x: 0, y: 1, z: 2 }
        ],
        triangles: [[0, 1, 2]],
        scriptingName: "roofAlpha"
    }, {
        suppressAutoScriptingName: true,
        trustLoadedScriptingName: true,
        targetSectionKey: "0,0"
    });

    assert.ok(roof);
    assert.equal(ensureCalls, 0);
    assert.equal(roof.scriptingName, "roofAlpha");
    assert.equal(setCalls.length, 1);
    assert.equal(setCalls[0].name, "roofAlpha");
    assert.equal(setCalls[0].options.restoreFromSave, true);
    assert.equal(setCalls[0].options.skipBubbleEnsureOnRestore, true);
    assert.equal(setCalls[0].options.targetSectionKey, "0,0");
});
