const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("screen picker mesh projection uses editor camera pitch", () => {
    const source = fs.readFileSync(
        path.join(__dirname, "../public/assets/javascript/rendering/ScenePicker.js"),
        "utf8"
    );

    assert.match(source, /uniform float uCameraPitch;/);
    assert.match(source, /float pitchFloor = cos\(uCameraPitch\) \/ \$\{PICK_CAMERA_PITCH_BASE\.toFixed\(16\)\};/);
    assert.match(source, /float pitchHeight = sin\(uCameraPitch\) \/ \$\{PICK_CAMERA_PITCH_BASE\.toFixed\(16\)\};/);
    assert.match(source, /float screenY = \(camDy \* pitchFloor - camDz \* pitchHeight\) \* uViewScale \* uXyRatio;/);
    assert.match(source, /float depthMetric = camDy \* pitchHeight \+ camDz \* pitchFloor;/);
    assert.match(source, /float screenY = \(anchorCamDy \* pitchFloor - anchorCamDz \* pitchHeight\) \* uViewScale \* uXyRatio \+ aVertexPosition\.y \* uViewScale;/);
    assert.match(source, /record\.shader\.uniforms\.uCameraPitch = pickerCameraPitch\(camera\);/);
});
