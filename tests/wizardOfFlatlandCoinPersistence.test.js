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

test("Wizard of Flatland rushing dropped coin follows its landing position across a section border", () => {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    const context = {
        getMazeOptions: () => ({}),
        validateCoin() {},
        worldToMazeSectionCoord: (x) => ({ q: x < 10 ? 0 : 1, r: 0 }),
        mazeSectionKey: (q, r) => `${q},${r}`
    };
    vm.createContext(context);
    vm.runInContext(
        `${extractFunction(source, "updateDroppedCoinSectionFromHomePosition")}
        this.updateSection = updateDroppedCoinSectionFromHomePosition;`,
        context
    );

    const coin = {
        key: "drop|9831",
        source: "enemy-drop",
        homeX: 10.01,
        homeY: 4,
        q: 0,
        r: 0,
        sectionKey: "0,0"
    };
    context.updateSection(coin);

    assert.equal(coin.q, 1);
    assert.equal(coin.r, 0);
    assert.equal(coin.sectionKey, "1,0");
});

test("Wizard of Flatland canonical coin layouts match only identical section spans", () => {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    const context = { Float32Array };
    vm.createContext(context);
    vm.runInContext(
        `const COIN_SPAN_STRIDE = 8;
        ${extractFunction(source, "mazeCoinLayoutCacheEntryMatches")}
        this.matches = mazeCoinLayoutCacheEntryMatches;`,
        context
    );

    const spans = Float32Array.from([
        10, 11, 12, 13, 14, 15, 2.5, 1,
        20, 21, 22, 23, 24, 25, 2, 2,
        30, 31, 32, 33, 34, 35, 2.5, 3
    ]);
    const entry = {
        configKey: "maze-config",
        spans: spans.slice(8, 24),
        coins: [{ key: "coin" }]
    };

    assert.equal(context.matches(entry, "maze-config", spans, 1, 2), true);
    assert.equal(context.matches(entry, "other-config", spans, 1, 2), false);
    spans[16] += 0.5;
    assert.equal(context.matches(entry, "maze-config", spans, 1, 2), false);
});

test("Wizard of Flatland canonical coin layouts generate once and return live copies", () => {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    let generations = 0;
    const context = {
        Float32Array,
        Map,
        state: {
            generatedMazeCoinLayoutsBySectionKey: new Map(),
            generatedMazeCoinSpans: Float32Array.from([0, 0, 4, 0, 0, 1, 2.5, 0]),
            generatedMazeCoinSpanSectionRanges: [{ sectionKey: "0,0", startSpanIndex: 0, spanCount: 1 }]
        },
        createMazeCoinsForSection() {
            generations++;
            return [{ key: "placed|0", x: 1, rushing: false }];
        }
    };
    vm.createContext(context);
    vm.runInContext(
        `const COIN_SPAN_STRIDE = 8;
        ${extractFunction(source, "mazeCoinLayoutCacheEntryMatches")}
        ${extractFunction(source, "getCachedOrCreateMazeCoinsForSection")}
        this.getCoins = getCachedOrCreateMazeCoinsForSection;`,
        context
    );
    const options = { seed: "seed", chunkSize: 44, roomScale: 0.56, twistiness: 0.62 };

    const first = context.getCoins("0,0", options);
    first[0].x = 99;
    const second = context.getCoins("0,0", options);

    assert.equal(generations, 1);
    assert.equal(second[0].x, 1);
    assert.notEqual(first[0], second[0]);
});
