const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const MAIN_PATH = path.join(__dirname, "../public/wizard-of-flatland/main.js");

function extractFunction(source, name) {
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `${name} exists in main.js`);
    const bodyStart = source.indexOf("{", start);
    let depth = 0;
    for (let index = bodyStart; index < source.length; index++) {
        if (source[index] === "{") depth++;
        if (source[index] === "}") depth--;
        if (depth === 0) return source.slice(start, index + 1);
    }
    throw new Error(`Unterminated function ${name}`);
}

test("Wizard of Flatland section snapshots supersede matching live dropped coins", () => {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    const context = { Array, Error, Set };
    vm.createContext(context);
    vm.runInContext(
        `${extractFunction(source, "excludeDroppedCoinsRestoredBySectionSnapshots")}
        this.reconcile = excludeDroppedCoinsRestoredBySectionSnapshots;`,
        context
    );

    const drop = { key: "drop|1", value: 1 };
    const otherDrop = { key: "drop|2", value: 1 };
    const result = context.reconcile([drop, otherDrop], new Set(["placed|1", "drop|1"]));

    assert.deepEqual(result.map((coin) => coin.key), ["drop|2"]);
});
