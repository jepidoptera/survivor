const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, test } = require("node:test");

const SCRIPTING_PATH = path.join(__dirname, "../public/assets/javascript/spells/scripting.js");

function loadScripting() {
    delete require.cache[require.resolve(SCRIPTING_PATH)];
    delete global.Scripting;
    require(SCRIPTING_PATH);
    return global.Scripting;
}

afterEach(() => {
    delete require.cache[require.resolve(SCRIPTING_PATH)];
    delete global.Scripting;
    delete global.message;
});

test("script editor terminal executes one-off commands", () => {
    const scripting = loadScripting();
    let ran = false;
    scripting.registerCommand("terminalTest", () => {
        ran = true;
        return true;
    });

    const result = scripting.runScriptEditorTerminalCommand("terminalTest()");

    assert.equal(result, true);
    assert.equal(ran, true);
});

test("script editor terminal rejects event blocks", () => {
    const messages = [];
    global.message = text => messages.push(text);
    const scripting = loadScripting();
    let ran = false;
    scripting.registerCommand("terminalTest", () => {
        ran = true;
        return true;
    });

    const result = scripting.runScriptEditorTerminalCommand("playerTouches {\n   terminalTest()\n}");

    assert.equal(result, false);
    assert.equal(ran, false);
    assert.deepEqual(messages, ["Terminal commands cannot use event blocks"]);
});
