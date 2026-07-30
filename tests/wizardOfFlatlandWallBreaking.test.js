const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const PATHFINDING_WORKER_PATH = path.join(__dirname, "../public/wizard-of-flatland/pathfindingWorker.js");
const MAIN_PATH = path.join(__dirname, "../public/wizard-of-flatland/main.js");

test("Wizard of Flatland wall damage revisions do not invalidate valid enemy routes", () => {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    const updateStart = source.indexOf("function updateAgentPathing(");
    const updateEnd = source.indexOf("function stopAgentForMissingPathNode(", updateStart);
    assert.notEqual(updateStart, -1, "updateAgentPathing exists");
    assert.notEqual(updateEnd, -1, "updateAgentPathing boundary exists");
    const updateSource = source.slice(updateStart, updateEnd);

    assert.doesNotMatch(updateSource, /wallBreakCostsChanged/);
    assert.doesNotMatch(updateSource, /pathRequestedWallBreakRevision\s*!==\s*state\.wallBreakCostRevision/);
});

test("Wizard of Flatland sends coalesced dynamic cost patches at 10 Hz instead of per-request overrides", () => {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    const clientSource = fs.readFileSync(
        path.join(__dirname, "../public/wizard-of-flatland/pathfindingClient.js"),
        "utf8"
    );
    assert.match(source, /const DYNAMIC_PATH_COST_PATCH_INTERVAL_MS = 100/);
    assert.match(source, /type: "dynamic_cost_patch"/);
    assert.match(source, /queueWallCostScalePatch\(segment\.wallIndex\)/);
    assert.doesNotMatch(source, /function getWallBreakConnectionCostOverrides/);
    assert.doesNotMatch(clientSource, /wallBlockedConnectionCostOverrides/);
});

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
        ]),
        wallIndexByEdge: Int32Array.from([0, -1, -1]),
        wallCostScales: Float32Array.from([1])
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

test("Wizard of Flatland worker dynamic cost patch lowers only that wall's blocked edge", () => {
    const worker = loadPathfindingWorker();
    worker.send({ type: "replace_snapshot", snapshot: createSnapshot() });

    const detour = requestPath(worker, 1, { wallBlockedConnectionCost: 100 });
    assert.equal(detour.ok, true);
    assert.deepEqual(Array.from(detour.pathNodeIndices), [2, 1]);
    assert.deepEqual(Array.from(detour.wallBlockedPathEdges), [0, 0]);

    worker.send({
        type: "dynamic_cost_patch",
        mapVersion: 7,
        wallIndices: Int32Array.from([0]),
        wallCostScales: Float32Array.from([0.05]),
        nodeIndices: new Int32Array(0),
        nodeCosts: new Float32Array(0)
    });
    const throughWall = requestPath(worker, 2, { wallBlockedConnectionCost: 100 });
    assert.equal(throughWall.ok, true);
    assert.deepEqual(Array.from(throughWall.pathNodeIndices), [1]);
    assert.deepEqual(Array.from(throughWall.wallBlockedPathEdges), [1]);
});

test("Wizard of Flatland worker dynamic cost patch updates node routing without replacing the snapshot", () => {
    const worker = loadPathfindingWorker();
    worker.send({ type: "replace_snapshot", snapshot: createSnapshot() });

    const detour = requestPath(worker, 1, { wallBlockedConnectionCost: 100 });
    assert.equal(detour.ok, true);
    assert.deepEqual(Array.from(detour.pathNodeIndices), [2, 1]);

    worker.send({
        type: "dynamic_cost_patch",
        mapVersion: 7,
        wallIndices: new Int32Array(0),
        wallCostScales: new Float32Array(0),
        nodeIndices: Int32Array.from([2]),
        nodeCosts: Float32Array.from([200])
    });
    const throughWall = requestPath(worker, 2, { wallBlockedConnectionCost: 100 });
    assert.equal(throughWall.ok, true);
    assert.deepEqual(Array.from(throughWall.pathNodeIndices), [1]);
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

test("Wizard of Flatland enemy hit damage survives removal of the attacking enemy", () => {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    const context = { Number };
    vm.createContext(context);
    vm.runInContext([
        extractFunction(source, "getEnemyHitDamageFromSolverStats"),
        "globalThis.__getDamage = getEnemyHitDamageFromSolverStats;"
    ].join("\n"), context, { filename: "wizard-of-flatland-enemy-hit-damage.js" });

    assert.equal(context.__getDamage({
        hits: 2,
        hitAgentIds: [2501, 2502],
        hitDamages: [7.5, 12]
    }), 19.5);
    assert.throws(
        () => context.__getDamage({ hits: 1, hitAgentIds: [2501], hitDamages: [] }),
        /requires matching damage values/
    );
});

test("Wizard of Flatland installs worker pathfinding after worker applies breach gaps", () => {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    const installer = extractFunction(source, "installGeneratedMazeWorkerResult");

    assert.match(installer, /message\.brokenWallGapCount/);
    assert.match(installer, /installPathfindingNodeLayerFromWorker\(message\.nodeLayer\)/);
    assert.doesNotMatch(installer, /clearAgentPathRequestsForMapRebuild\(\)/);
    assert.doesNotMatch(installer, /rebuildPathfindingNodeLayer\(\)/);
    assert.doesNotMatch(installer, /applyBrokenWallGapsToBuffer/);
    assert.match(source, /function validatePathfindingWallIndices\(\)/);
});

test("Wizard of Flatland procedural wall breaks rebuild pathfinding asynchronously", () => {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    const breakWall = extractFunction(source, "breakWallSegmentForAgent");

    assert.match(
        breakWall,
        /if \(isProceduralMazeScenario\(\)\) \{\s*if \(!refreshGeneratedMazeIfNeeded\(true\)\)/
    );
    assert.match(breakWall, /else \{\s*rebuildPathfindingNodeLayer\(\)/);
    assert.ok(
        breakWall.indexOf("clearAgentPathRequestsForMapRebuild()")
            < breakWall.indexOf("refreshGeneratedMazeIfNeeded(true)")
    );
});

test("Wizard of Flatland remaps preserved wall-blocked paths by stable node key", () => {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    const waypointLookup = extractFunction(source, "getAgentPathWaypoint");
    const updatePathing = extractFunction(source, "updateAgentPathing");
    const clientSource = fs.readFileSync(
        path.join(__dirname, "../public/wizard-of-flatland/pathfindingClient.js"),
        "utf8"
    );

    assert.match(clientSource, /wallBlockedFromKey = callbacks\.getPathfindingNodeKey\(previousPathIndex\)/);
    assert.match(waypointLookup, /getPathfindingNodeIndexForKey\(fromKey\)/);
    assert.match(waypointLookup, /wallBlockedEdgeKey = `\$\{fromIndex\}->\$\{currentPathIndex\}`/);
    assert.match(waypointLookup, /wallBlockedResolvedNodeLayerVersion === state\.nodeLayer\.version/);
    assert.match(updatePathing, /waypoint\.wallBlockedFromPrevious === true && waypoint\.stale !== true/);
});
