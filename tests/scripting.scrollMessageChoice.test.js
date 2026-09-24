const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const SCRIPTING_PATH = path.join(__dirname, "../public/assets/javascript/spells/scripting.js");

function loadScriptingWithScrollDialog(handler) {
    delete require.cache[require.resolve(SCRIPTING_PATH)];
    delete global.Scripting;
    global.showScrollDialog = handler;
    require(SCRIPTING_PATH);
    return global.Scripting;
}

test("scrollMessage can assign a choice result before the next statement runs", async () => {
    const scripting = loadScriptingWithScrollDialog(options => {
        assert.equal(options.content, "do you want a sandwich?");
        assert.deepEqual(options.buttons.map(button => button.text), ["yes", "no"]);
        return new Promise(resolve => setTimeout(() => resolve("yes"), 0));
    });

    const context = { locals: {} };
    const run = scripting.runScript(
        "yesno = scrollmessage(text=\"do you want a sandwich?\", options=[\"yes\", \"no\"])\n" +
        "if (yesno == \"yes\") { answer = \"sandwich\" }",
        context
    );

    assert.equal(run.changed, true);
    assert.ok(run.promise);
    await run.promise;
    assert.equal(context.locals.yesno, "yes");
    assert.equal(context.locals.answer, "sandwich");
});

test("validator accepts local variables assigned from scrollMessage choices", () => {
    const scripting = loadScriptingWithScrollDialog(() => {
        throw new Error("validation should not open a scroll dialog");
    });

    const errors = scripting.validateScript(
        "yesno = scrollmessage(text=\"do you want a sandwich?\", options=[\"yes\", \"no\"])\n" +
        "if (yesno == \"yes\") { answer = \"sandwich\" }"
    );

    assert.deepEqual(errors, []);
});

test("scrollMessage choice can drive an if else block", async () => {
    const scripting = loadScriptingWithScrollDialog(() => Promise.resolve("no"));

    const context = { locals: {} };
    const run = scripting.runScript(
        "yesno = scrollMessage(title=\"Decision Time\", text=\"Look, we don't have to do this. Do you want to go free or not?\", options=[\"yes\", \"no\"]);\n" +
        "if (yesno == \"yes\") {\n" +
        "  result = \"free\"\n" +
        "} else {\n" +
        "  result = \"not free\"\n" +
        "}",
        context
    );

    assert.ok(run.promise);
    await run.promise;
    assert.equal(context.locals.yesno, "no");
    assert.equal(context.locals.result, "not free");
});

test("validator accepts if else blocks after scrollMessage choices", () => {
    const scripting = loadScriptingWithScrollDialog(() => {
        throw new Error("validation should not open a scroll dialog");
    });

    const errors = scripting.validateScript(
        "yesno = scrollMessage(title=\"Decision Time\", text=\"Look, we don't have to do this. Do you want to go free or not?\", options=[\"yes\", \"no\"]);\n" +
        "if (yesno == \"yes\") {\n" +
        "  scrollMessage(\"Attaboy! Say goodbye to everything you ever knew!\")\n" +
        "} else {\n" +
        "  scrollMessage(\"Sorry, old chap. We tried to do this the easy way.\")\n" +
        "}"
    );

    assert.deepEqual(errors, []);
});
