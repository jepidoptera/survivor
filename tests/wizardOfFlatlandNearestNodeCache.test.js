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

function loadNearestNodeApi(options = {}) {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    const nodes = new Map(options.nodes || []);
    let fallbackCalls = 0;
    const context = {
        Map,
        Set,
        Number,
        Error,
        performance: { now: () => 0 },
        state: { nodeLayer: { version: options.version || 1 } },
        isValidPathfindingNodeIndex(index) {
            return nodes.has(index);
        },
        getApproximatePathfindingGridCoord() {
            return { xindex: 0, yindex: 0 };
        },
        isEvenGridColumn(xindex) {
            return xindex % 2 === 0;
        },
        getPathfindingNodeIndexForGrid(xindex, yindex) {
            const entry = [...nodes].find(([, node]) => node.xindex === xindex && node.yindex === yindex);
            return entry ? entry[0] : null;
        },
        getPathfindingNodeX(index) {
            return nodes.get(index).x;
        },
        getPathfindingNodeY(index) {
            return nodes.get(index).y;
        },
        squareDistance(ax, ay, bx, by) {
            return (bx - ax) ** 2 + (by - ay) ** 2;
        },
        findNearestPathfindingNodeNearGrid() {
            fallbackCalls += 1;
            return options.fallbackIndex ?? null;
        }
    };
    vm.createContext(context);
    vm.runInContext(
        `${extractFunction(source, "nearestPathfindingNodeForAgent")}
globalThis.__testExports = { nearestPathfindingNodeForAgent };`,
        context,
        { filename: "wizard-of-flatland-nearest-node-cache.js" }
    );
    return {
        api: context.__testExports,
        state: context.state,
        fallbackCalls: () => fallbackCalls
    };
}

test("Wizard of Flatland enemy nearest-node lookup resolves from the local grid", () => {
    const harness = loadNearestNodeApi({
        nodes: [
            [4, { xindex: 0, yindex: 0, x: 0, y: 0 }],
            [5, { xindex: 1, yindex: 0, x: 1, y: 0 }]
        ]
    });
    const agent = {
        x: 0.2,
        y: 0,
        nearestPathNodeIndex: -1,
        nearestPathNodeLayerVersion: -1
    };
    const metrics = {
        nearestNodeLookups: 0,
        nearestNodeFastHits: 0,
        nearestNodeCacheHits: 0,
        nearestNodeMs: 0
    };

    assert.equal(harness.api.nearestPathfindingNodeForAgent(agent, metrics), 4);
    assert.equal(agent.nearestPathNodeIndex, 4);
    assert.equal(agent.nearestPathNodeLayerVersion, 1);
    assert.equal(metrics.nearestNodeCacheHits, 1);
    assert.equal(harness.fallbackCalls(), 0);
});

test("Wizard of Flatland enemy nearest-node lookup retains the full-search fallback", () => {
    const harness = loadNearestNodeApi({
        nodes: [[7, { xindex: 12, yindex: 12, x: 12, y: 12 }]],
        fallbackIndex: 7
    });
    const agent = {
        x: 0,
        y: 0,
        nearestPathNodeIndex: -1,
        nearestPathNodeLayerVersion: -1
    };

    assert.equal(harness.api.nearestPathfindingNodeForAgent(agent), 7);
    assert.equal(harness.fallbackCalls(), 1);
});
