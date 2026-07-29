const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const PATHFINDING_WORKER_PATH = path.join(__dirname, "../public/wizard-of-flatland/pathfindingWorker.js");
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

function loadPathfindingWorker() {
    const messages = [];
    const context = {
        Float32Array,
        Float64Array,
        Int32Array,
        Map,
        Number,
        Set,
        Uint8Array,
        console,
        self: {
            postMessage(message) {
                messages.push(message);
            },
            addEventListener(type, handler) {
                if (type === "message") context.__handler = handler;
            }
        }
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(PATHFINDING_WORKER_PATH, "utf8"), context, { filename: PATHFINDING_WORKER_PATH });
    return {
        messages,
        send(message) {
            context.__handler({ data: message });
        }
    };
}

function createSnapshot() {
    const nodeStride = 9;
    const edgeStride = 4;
    const nodes = new Float32Array(3 * nodeStride);
    writeNode(nodes, nodeStride, 0, 0, 0);
    writeNode(nodes, nodeStride, 1, 1, 0);
    writeNode(nodes, nodeStride, 2, 0, 3);
    return {
        format: "wizard-flatland-packed-v1",
        version: 7,
        nodeStride,
        edgeStride,
        nodes,
        edges: Int32Array.from([
            0, 1, 0, 1,
            0, 2, 0, 0,
            2, 1, 0, 0
        ])
    };
}

function writeNode(nodes, stride, index, x, y) {
    const base = index * stride;
    nodes[base] = x;
    nodes[base + 1] = y;
    nodes[base + 2] = 0;
    nodes[base + 3] = 10;
    nodes[base + 7] = 0;
    nodes[base + 8] = 0;
}

function requestPath(worker, requestId, options) {
    worker.send({
        type: "request_path",
        requestId,
        mapVersion: 7,
        startNodeIndex: 0,
        destinationNodeIndex: 1,
        options
    });
    return worker.messages.at(-1);
}

test("Wizard of Flatland damaged wall override lowers only that blocked path edge", () => {
    const worker = loadPathfindingWorker();
    worker.send({ type: "replace_snapshot", snapshot: createSnapshot() });

    const detour = requestPath(worker, 1, { wallBlockedConnectionCost: 100 });
    assert.equal(detour.ok, true);
    assert.deepEqual(Array.from(detour.pathNodeIndices), [2, 1]);
    assert.deepEqual(Array.from(detour.wallBlockedPathEdges), [0, 0]);

    const throughWall = requestPath(worker, 2, {
        wallBlockedConnectionCost: 100,
        wallBlockedConnectionCostOverrides: [{ from: 0, to: 1, cost: 0 }]
    });
    assert.equal(throughWall.ok, true);
    assert.deepEqual(Array.from(throughWall.pathNodeIndices), [1]);
    assert.deepEqual(Array.from(throughWall.wallBlockedPathEdges), [1]);
});

test("Wizard of Flatland blocked path edge wall lookup accepts reverse stored direction", () => {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    const context = {
        Int32Array,
        Number,
        state: {
            nodeLayer: {
                nodes: new Float32Array(3 * 9),
                blockedEdges: Int32Array.from([6449, 6547, 42, 0])
            }
        }
    };
    vm.createContext(context);
    vm.runInContext([
        "const PATH_SNAPSHOT_NODE_STRIDE = 9;",
        "const PATH_SNAPSHOT_EDGE_STRIDE = 4;",
        "const PATH_EDGE_FROM = 0;",
        "const PATH_EDGE_TO = 1;",
        "function getPathfindingNodeCount() { return 7000; }",
        extractFunction(source, "isValidPathfindingNodeIndex"),
        extractFunction(source, "findPathfindingBlockedEdgeWallIndex"),
        extractFunction(source, "getPathfindingBlockedEdgeWallIndex"),
        "globalThis.__lookup = getPathfindingBlockedEdgeWallIndex;"
    ].join("\n"), context, { filename: "wizard-of-flatland-wall-lookup.js" });

    assert.equal(context.__lookup(6547, 6449), 42);
});

test("Wizard of Flatland rejects stale solver results before applying movement or hits", () => {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    const handler = extractFunction(source, "handleWorkerMessage");
    const versionCheck = handler.indexOf("message.worldVersion");
    const applyResult = handler.indexOf("applySolverResult(message.agents)");
    const applyHits = handler.indexOf("handleEnemyWallHitsFromSolverStats(state.stats)");

    assert.ok(versionCheck >= 0, "worker handler checks the result world version");
    assert.ok(versionCheck < applyResult, "version check precedes movement application");
    assert.ok(versionCheck < applyHits, "version check precedes wall-hit application");
    assert.equal(source.includes("wall hit requires a target edge"), false);
});

test("Wizard of Flatland installs worker pathfinding after worker applies breach gaps", () => {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    const installer = extractFunction(source, "installGeneratedMazeWorkerResult");

    assert.match(installer, /message\.brokenWallGapCount/);
    assert.match(installer, /installPathfindingNodeLayerFromWorker\(message\.nodeLayer\)/);
    assert.doesNotMatch(installer, /rebuildPathfindingNodeLayer\(\)/);
    assert.doesNotMatch(installer, /applyBrokenWallGapsToBuffer/);
    assert.match(source, /function validatePathfindingWallIndices\(\)/);
});
