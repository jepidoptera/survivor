const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, test } = require("node:test");

const SCRIPTING_PATH = path.join(__dirname, "../public/assets/javascript/spells/scripting.js");

function loadScriptingWithRendering(renderingApi) {
    delete require.cache[require.resolve(SCRIPTING_PATH)];
    delete global.Scripting;
    global.Rendering = renderingApi;
    require(SCRIPTING_PATH);
    return global.Scripting;
}

afterEach(() => {
    delete require.cache[require.resolve(SCRIPTING_PATH)];
    delete global.Scripting;
    delete global.Rendering;
});

test("screenColor forwards positional arguments to the rendering API", () => {
    const calls = [];
    const scripting = loadScriptingWithRendering({
        screenColor(color, opacity, duration, fade) {
            calls.push({ color, opacity, duration, fade });
            return true;
        }
    });

    const run = scripting.runScript("screenColor(\"#336699\", 0.75, 2, 0.5)");

    assert.equal(run.changed, true);
    assert.deepEqual(calls, [{
        color: "#336699",
        opacity: 0.75,
        duration: 2,
        fade: 0.5
    }]);
});

test("screenColor accepts named arguments", () => {
    const calls = [];
    const scripting = loadScriptingWithRendering({
        screenColor(color, opacity, duration, fade) {
            calls.push({ color, opacity, duration, fade });
            return true;
        }
    });

    const errors = scripting.validateScript("screenColor(color=\"#112233\", opacity=0.4, duration=1, fade=2)");
    const run = scripting.runScript("screenColor(color=\"#112233\", opacity=0.4, duration=1, fade=2)");

    assert.deepEqual(errors, []);
    assert.equal(run.changed, true);
    assert.deepEqual(calls, [{
        color: "#112233",
        opacity: 0.4,
        duration: 1,
        fade: 2
    }]);
});
