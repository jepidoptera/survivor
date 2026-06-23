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

test("wizard.thoughtBubble forwards positional arguments to the rendering API", () => {
    const wizard = { x: 1, y: 2 };
    const calls = [];
    const scripting = loadScriptingWithRendering({
        thoughtBubble(wizardRef, text, duration) {
            calls.push({ wizardRef, text, duration });
            return true;
        }
    });

    const run = scripting.runScript("wizard.thoughtBubble(\"go north\", 2.5)", { wizard, player: wizard });

    assert.equal(run.changed, true);
    assert.deepEqual(calls, [{
        wizardRef: wizard,
        text: "go north",
        duration: 2.5
    }]);
});

test("wizard.thoughtBubble accepts named arguments", () => {
    const wizard = { x: 1, y: 2 };
    const calls = [];
    const scripting = loadScriptingWithRendering({
        thoughtBubble(wizardRef, text, duration) {
            calls.push({ wizardRef, text, duration });
            return true;
        }
    });

    const errors = scripting.validateScript("wizard.thoughtBubble(text=\"hmm\", duration=3)");
    const run = scripting.runScript("wizard.thoughtBubble(text=\"hmm\", duration=3)", { wizard, player: wizard });

    assert.deepEqual(errors, []);
    assert.equal(run.changed, true);
    assert.deepEqual(calls, [{
        wizardRef: wizard,
        text: "hmm",
        duration: 3
    }]);
});
