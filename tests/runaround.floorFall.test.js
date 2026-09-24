const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("layer 0 generated outdoor ground does not trigger wizard floor fall", () => {
    const source = fs.readFileSync(
        path.join(__dirname, "../public/assets/javascript/runaround.js"),
        "utf8"
    );

    assert.match(source, /function isGeneratedOutdoorGroundFloorFragment\(fragment\)/);
    assert.match(source, /normalizedLayer === 0 && isGeneratedOutdoorGroundFloorFragment\(fragment\)/);
    assert.match(source, /if \(normalizedLayer === 0\) return true;/);
    assert.match(source, /wizardLayer === 0 && \(!currentSupport \|\| currentSupport\.type === "ground"\)/);
});
