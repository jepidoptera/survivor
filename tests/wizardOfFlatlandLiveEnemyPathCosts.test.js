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

function extractConst(source, name) {
    const match = source.match(new RegExp(`const ${name} = [^;]+;`));
    assert.ok(match, `${name} exists in main.js`);
    return match[0];
}

function loadLiveEnemyPathCostExports() {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    const pieces = [
        extractConst(source, "PATH_SNAPSHOT_NODE_STRIDE"),
        extractConst(source, "PATH_NODE_BLOCKED"),
        extractConst(source, "PATH_NODE_TEMPORARY_COST"),
        extractConst(source, "LIVE_ENEMY_PATH_COST"),
        extractConst(source, "LIVE_ENEMY_PATH_COST_TILE_COUNT"),
        "const state = globalThis.state;",
        "function isAgentInInstalledMazeSection(agent) { return agent.installed !== false; }",
        "function isEvenGridColumn(xindex) { return xindex % 2 === 0; }",
        "function squareDistance(ax, ay, bx, by) { const dx = bx - ax; const dy = by - ay; return dx * dx + dy * dy; }",
        "function getApproximatePathfindingGridCoord(worldX, worldY) { return { xindex: Math.round(worldX), yindex: Math.round(worldY) }; }",
        "function getPathfindingNodeKey(pathIndex) { return `node-${pathIndex}`; }",
        "function getPathfindingNodeX(pathIndex) { return globalThis.nodesByIndex.get(pathIndex).x; }",
        "function getPathfindingNodeY(pathIndex) { return globalThis.nodesByIndex.get(pathIndex).y; }",
        "function isValidPathfindingNodeIndex(pathIndex) { return globalThis.nodesByIndex.has(pathIndex); }",
        "function isPathfindingNodePassable(pathIndex) { const node = globalThis.nodesByIndex.get(pathIndex); return !!node && node.passable !== false; }",
        "function getPathfindingNodeIndexForGrid(xindex, yindex) { const key = `${xindex},${yindex}`; return globalThis.indexByGrid.has(key) ? globalThis.indexByGrid.get(key) : null; }",
        "function getPathfindingNodeIndexForKey(nodeKey) { const match = /^node-(\\d+)$/.exec(nodeKey); return match ? Number(match[1]) : null; }",
        "function getPathfindingNodeBase(pathIndex) { return pathIndex * PATH_SNAPSHOT_NODE_STRIDE; }",
        "const PATH_NODE_FAST_SEARCH_RADIUS = 8;",
        extractFunction(source, "buildLiveEnemyPathfindingCosts"),
        extractFunction(source, "nearestLocalPassablePathfindingNodes"),
        extractFunction(source, "getLiveEnemyPathCostSignature"),
        extractFunction(source, "validateLiveEnemyPathCostPenalty"),
        extractFunction(source, "applyTemporaryPathfindingModifiersToNodes"),
        extractFunction(source, "validateTemporaryPathCostPenalty"),
        extractFunction(source, "getTemporaryPathCostEntryTotal"),
        "globalThis.__testExports = { buildLiveEnemyPathfindingCosts, getLiveEnemyPathCostSignature, applyTemporaryPathfindingModifiersToNodes };"
    ];
    const context = {
        Map,
        Number,
        Float32Array,
        RegExp,
        state: {
            agents: [],
            temporaryPathCostsByNodeKey: new Map(),
            liveEnemyPathCostsByNodeKey: new Map(),
            debug: {},
            nodeLayer: {
                nodes: new Float32Array(0),
                snapshotNodes: new Float32Array(0)
            }
        },
        nodesByIndex: new Map(),
        indexByGrid: new Map()
    };
    vm.createContext(context);
    vm.runInContext(pieces.join("\n"), context, { filename: "wizard-of-flatland-live-enemy-path-costs.js" });
    return { api: context.__testExports, state: context.state, nodesByIndex: context.nodesByIndex, indexByGrid: context.indexByGrid };
}

test("Wizard of Flatland live enemy path costs stack on overlapping nearest tiles", () => {
    const { api, state, nodesByIndex, indexByGrid } = loadLiveEnemyPathCostExports();
    state.agents = [
        { id: 1, x: 0, y: 0, health: 10 },
        { id: 2, x: 1, y: 0, health: 10 }
    ];
    let nextIndex = 1;
    for (let x = -2; x <= 3; x++) {
        for (let y = -2; y <= 2; y++) {
            const pathIndex = nextIndex++;
            nodesByIndex.set(pathIndex, { x, y, passable: true });
            indexByGrid.set(`${x},${y}`, pathIndex);
        }
    }

    const costs = api.buildLiveEnemyPathfindingCosts();

    const stackedCosts = [...costs.values()].filter((penalty) => penalty.cost === 6);
    const singleCosts = [...costs.values()].filter((penalty) => penalty.cost === 3);
    assert.ok(stackedCosts.length >= 3);
    assert.ok(singleCosts.length >= 1);
    assert.equal(api.getLiveEnemyPathCostSignature(costs).includes(":6"), true);
});

test("Wizard of Flatland live enemy path costs skip enemies outside the local path node window", () => {
    const { api, state } = loadLiveEnemyPathCostExports();
    state.agents = [
        { id: 99, x: 250, y: -250, health: 10 }
    ];

    const costs = api.buildLiveEnemyPathfindingCosts();

    assert.equal(costs.size, 0);
    assert.equal(state.debug.liveEnemyPathCostSkippedAgents, 1);
});

test("Wizard of Flatland path node modifier application combines temporary and live costs", () => {
    const { api, state } = loadLiveEnemyPathCostExports();
    state.nodeLayer.nodes = new Float32Array(12 * 9);
    state.nodeLayer.snapshotNodes = new Float32Array(12 * 9);
    state.temporaryPathCostsByNodeKey = new Map([
        ["node-5", {
            x: 50,
            y: -50,
            cost: 10,
            entries: [{ cost: 10, expiresAt: 100 }]
        }]
    ]);
    state.liveEnemyPathCostsByNodeKey = new Map([
        ["node-5", { x: 50, y: -50, cost: 6 }],
        ["node-6", { x: 60, y: -60, cost: 3 }]
    ]);

    api.applyTemporaryPathfindingModifiersToNodes();

    assert.equal(state.nodeLayer.nodes[5 * 9 + 8], 16);
    assert.equal(state.nodeLayer.nodes[6 * 9 + 8], 3);
});

test("Wizard of Flatland path cost publishing preserves active path versions", () => {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    const publishCostModifier = extractFunction(source, "publishPathfindingCostModifierChange");
    assert.doesNotMatch(publishCostModifier, /clearAgentPathRequestsForMapRebuild/);
    assert.doesNotMatch(publishCostModifier, /worldVersion\s*\+=/);
    assert.match(publishCostModifier, /publishPathfindingSnapshot\(\{\s*preserveVersion:\s*true\s*\}\)/);
});
