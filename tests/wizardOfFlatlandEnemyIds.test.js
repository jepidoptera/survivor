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
    for (let i = bodyStart; i < source.length; i++) {
        if (source[i] === "{") depth++;
        if (source[i] === "}") depth--;
        if (depth === 0) return source.slice(start, i + 1);
    }
    throw new Error(`Unterminated function ${name}`);
}

function loadEnemyIdApi(state) {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    const context = { state, Map, Number, Error };
    vm.createContext(context);
    vm.runInContext(
        `${extractFunction(source, "getNextAgentId")}
globalThis.__testExports = { getNextAgentId };`,
        context,
        { filename: "wizard-of-flatland-enemy-ids.js" }
    );
    return context.__testExports;
}

test("Wizard of Flatland enemy ids reserve unloaded section snapshot identities", () => {
    const state = {
        agents: [{ id: 12 }],
        sectionSnapshotsByKey: new Map([
            ["4,-2", { enemies: [{ id: 1700 }, { id: 1699 }] }]
        ])
    };
    const api = loadEnemyIdApi(state);

    assert.equal(api.getNextAgentId(), 1701);
});

test("Wizard of Flatland enemy id allocation rejects malformed saved identities", () => {
    const state = {
        agents: [],
        sectionSnapshotsByKey: new Map([
            ["4,-2", { enemies: [{ id: Number.NaN }] }]
        ])
    };
    const api = loadEnemyIdApi(state);

    assert.throws(
        () => api.getNextAgentId(),
        /invalid enemy in section 4,-2/
    );
});
