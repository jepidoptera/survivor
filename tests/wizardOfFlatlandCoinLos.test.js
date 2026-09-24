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

function createReachabilityHarness() {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    const bins = 3600;
    const depths = new Float32Array(bins);
    depths.fill(20);
    const context = {
        Float32Array,
        Math,
        Number,
        Error,
        state: {
            los: {
                lastResult: {
                    originX: 0,
                    originY: 0,
                    bins,
                    maxDistance: 20,
                    depths
                }
            }
        },
        validateCoin() {}
    };
    vm.createContext(context);
    vm.runInContext(
        `${extractFunction(source, "getLosDepthBinIndex")}
        ${extractFunction(source, "isMazeCoinReachableFromTarget")}
        this.binFor = getLosDepthBinIndex;
        this.reachable = isMazeCoinReachableFromTarget;`,
        context
    );
    return context;
}

test("Wizard of Flatland coin LOS lookup accepts an unobstructed coin", () => {
    const harness = createReachabilityHarness();
    assert.equal(harness.reachable({ x: 2, y: 0, radius: 0.16 }), true);
});

test("Wizard of Flatland coin LOS lookup catches a wall in the center bin", () => {
    const harness = createReachabilityHarness();
    harness.state.los.lastResult.depths[harness.binFor(0, 3600)] = 1;
    assert.equal(harness.reachable({ x: 2, y: 0, radius: 0.16 }), false);
});

test("Wizard of Flatland coin LOS lookup catches walls at either angular edge", () => {
    for (const side of [-1, 1]) {
        const harness = createReachabilityHarness();
        const angularRadius = Math.asin(0.16 / 2);
        harness.state.los.lastResult.depths[harness.binFor(side * angularRadius, 3600)] = 1;
        assert.equal(harness.reachable({ x: 2, y: 0, radius: 0.16 }), false);
    }
});

test("Wizard of Flatland coin LOS lookup waits for the first completed snapshot", () => {
    const harness = createReachabilityHarness();
    harness.state.los.lastResult = null;
    assert.equal(harness.reachable({ x: 2, y: 0, radius: 0.16 }), false);
});
