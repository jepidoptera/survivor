"use strict";

let activeSnapshot = null;
let adjacencyOffsets = new Int32Array(0);
let adjacencyEdges = new Int32Array(0);
let wallIndexByEdge = new Int32Array(0);
let wallCostScales = new Float32Array(0);

const SNAPSHOT_FORMAT = "wizard-flatland-packed-v1";
const NODE_X = 0;
const NODE_Y = 1;
const NODE_BLOCKED = 2;
const NODE_CLEARANCE = 3;
const NODE_BLOCKED_NEIGHBOR_COUNT = 7;
const NODE_TEMPORARY_COST = 8;
const EDGE_FROM = 0;
const EDGE_TO = 1;
const EDGE_WALL_BLOCKED = 3;
const EDGE_STRIDE_FALLBACK = 4;

self.postMessage({ type: "ready", version: null });

function MinPriorityQueue() {
    this.items = [];
}

MinPriorityQueue.prototype.push = function push(value, priority) {
    this.items.push({ value, priority });
    let i = this.items.length - 1;
    while (i > 0) {
        const parent = (i - 1) >> 1;
        if (this.items[parent].priority <= this.items[i].priority) break;
        const tmp = this.items[i];
        this.items[i] = this.items[parent];
        this.items[parent] = tmp;
        i = parent;
    }
};

MinPriorityQueue.prototype.pop = function pop() {
    if (this.items.length === 0) return null;
    const top = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0) {
        this.items[0] = last;
        let i = 0;
        const length = this.items.length;
        while (true) {
            const left = (i << 1) + 1;
            const right = left + 1;
            let smallest = i;
            if (left < length && this.items[left].priority < this.items[smallest].priority) smallest = left;
            if (right < length && this.items[right].priority < this.items[smallest].priority) smallest = right;
            if (smallest === i) break;
            const tmp = this.items[i];
            this.items[i] = this.items[smallest];
            this.items[smallest] = tmp;
            i = smallest;
        }
    }
    return top;
};

MinPriorityQueue.prototype.isEmpty = function isEmpty() {
    return this.items.length === 0;
};

function installSnapshot(snapshot) {
    if (!snapshot || snapshot.format !== SNAPSHOT_FORMAT) {
        throw new Error("Wizard of Flatland pathfinding worker requires a packed snapshot");
    }
    const nodeStride = getNodeStride(snapshot);
    const edgeStride = getEdgeStride(snapshot);
    if (!(snapshot.nodes instanceof Float32Array) || snapshot.nodes.length % nodeStride !== 0) {
        throw new Error("Wizard of Flatland packed pathfinding snapshot nodes are malformed");
    }
    if (!(snapshot.edges instanceof Int32Array) || snapshot.edges.length % edgeStride !== 0) {
        throw new Error("Wizard of Flatland packed pathfinding snapshot edges are malformed");
    }
    const edgeCount = snapshot.edges.length / edgeStride;
    if (!(snapshot.wallIndexByEdge instanceof Int32Array) || snapshot.wallIndexByEdge.length !== edgeCount) {
        throw new Error("Wizard of Flatland packed pathfinding snapshot edge wall indices are malformed");
    }
    if (!(snapshot.wallCostScales instanceof Float32Array)) {
        throw new Error("Wizard of Flatland packed pathfinding snapshot wall cost scales are malformed");
    }

    activeSnapshot = snapshot;
    wallIndexByEdge = snapshot.wallIndexByEdge;
    wallCostScales = snapshot.wallCostScales;
    validateWallCostState(snapshot.edges, edgeStride);
    rebuildAdjacency(snapshot);
    self.postMessage({ type: "ready", version: snapshot.version });
}

function validateWallCostState(edges, edgeStride) {
    for (let edgeIndex = 0; edgeIndex < wallIndexByEdge.length; edgeIndex++) {
        const edgeBase = edgeIndex * edgeStride;
        const wallIndex = wallIndexByEdge[edgeIndex];
        if (edgeIsWallBlocked(edges, edgeStride, edgeBase)) {
            if (!Number.isInteger(wallIndex) || wallIndex < 0 || wallIndex >= wallCostScales.length) {
                throw new Error(`Wizard of Flatland wall-blocked pathfinding edge ${edgeIndex} has invalid wall index ${wallIndex}`);
            }
        } else if (wallIndex !== -1) {
            throw new Error(`Wizard of Flatland open pathfinding edge ${edgeIndex} unexpectedly references wall ${wallIndex}`);
        }
    }
    for (let wallIndex = 0; wallIndex < wallCostScales.length; wallIndex++) {
        validateWallCostScale(wallCostScales[wallIndex], wallIndex);
    }
}

function validateWallCostScale(value, wallIndex) {
    if (!Number.isFinite(value) || value < 0.05 || value > 1) {
        throw new Error(`Wizard of Flatland pathfinding wall ${wallIndex} has invalid cost scale ${value}`);
    }
}

function applyWallCostPatch(message) {
    if (!activeSnapshot) throw new Error("Wizard of Flatland pathfinding wall cost patch requires an active snapshot");
    if (Number(message.mapVersion) !== Number(activeSnapshot.version)) return;
    const wallIndices = message.wallIndices;
    const costScales = message.costScales;
    if (!(wallIndices instanceof Int32Array) || !(costScales instanceof Float32Array) || wallIndices.length !== costScales.length) {
        throw new Error("Wizard of Flatland pathfinding wall cost patch is malformed");
    }
    for (let i = 0; i < wallIndices.length; i++) {
        const wallIndex = wallIndices[i];
        if (!Number.isInteger(wallIndex) || wallIndex < 0 || wallIndex >= wallCostScales.length) {
            throw new Error(`Wizard of Flatland pathfinding wall cost patch references invalid wall ${wallIndex}`);
        }
        validateWallCostScale(costScales[i], wallIndex);
        wallCostScales[wallIndex] = costScales[i];
    }
}

function rebuildAdjacency(snapshot) {
    const nodeStride = getNodeStride(snapshot);
    const edgeStride = getEdgeStride(snapshot);
    const nodeCount = snapshot.nodes.length / nodeStride;
    const edgeCount = snapshot.edges.length / edgeStride;
    const counts = new Int32Array(nodeCount);
    for (let i = 0; i < snapshot.edges.length; i += edgeStride) {
        const from = snapshot.edges[i + EDGE_FROM];
        const to = snapshot.edges[i + EDGE_TO];
        if (from < 0 || from >= nodeCount || to < 0 || to >= nodeCount) {
            throw new Error("Wizard of Flatland packed pathfinding edge references invalid node indices");
        }
        counts[from] += 1;
    }

    adjacencyOffsets = new Int32Array(nodeCount + 1);
    for (let i = 0; i < nodeCount; i++) {
        adjacencyOffsets[i + 1] = adjacencyOffsets[i] + counts[i];
    }

    adjacencyEdges = new Int32Array(edgeCount);
    const writeOffsets = adjacencyOffsets.slice(0, nodeCount);
    for (let edgeIndex = 0; edgeIndex < edgeCount; edgeIndex++) {
        const base = edgeIndex * edgeStride;
        const from = snapshot.edges[base + EDGE_FROM];
        adjacencyEdges[writeOffsets[from]] = edgeIndex;
        writeOffsets[from] += 1;
    }
}

function getNodeStride(snapshot) {
    const stride = Number(snapshot && snapshot.nodeStride);
    if (!Number.isInteger(stride) || stride < 9) {
        throw new Error("Wizard of Flatland packed pathfinding snapshot requires node stride >= 9");
    }
    return stride;
}

function getEdgeStride(snapshot) {
    const stride = Number(snapshot && snapshot.edgeStride) || EDGE_STRIDE_FALLBACK;
    if (!Number.isInteger(stride) || stride < 4) {
        throw new Error("Wizard of Flatland packed pathfinding snapshot requires edge stride >= 4");
    }
    return stride;
}

function emptyPathResult(message, reason) {
    const empty = new Int32Array(0);
    const emptyWallBlockedEdges = new Uint8Array(0);
    const result = {
        type: "path_result",
        requestId: message.requestId,
        mapVersion: activeSnapshot ? activeSnapshot.version : message.mapVersion,
        ok: false,
        reason,
        pathNodeIndices: empty,
        wallBlockedPathEdges: emptyWallBlockedEdges,
        pathEdgeIds: [],
        plannedInteractions: [],
        stats: { iterations: 0, expanded: 0 }
    };
    self.postMessage(result, [empty.buffer, emptyWallBlockedEdges.buffer]);
}

function handleRequestPath(message) {
    if (!activeSnapshot) {
        emptyPathResult(message, "snapshot_missing");
        return;
    }
    if (Number(message.mapVersion) !== Number(activeSnapshot.version)) {
        emptyPathResult(message, "stale_snapshot");
        return;
    }

    const nodeStride = getNodeStride(activeSnapshot);
    const edgeStride = getEdgeStride(activeSnapshot);
    const nodes = activeSnapshot.nodes;
    const edges = activeSnapshot.edges;
    const nodeCount = nodes.length / nodeStride;
    const startIndex = Number(message.startNodeIndex);
    const goalIndex = Number(message.destinationNodeIndex);
    const options = message.options || {};
    const allowBlockedDestination = options.allowBlockedDestination === true;
    const requiredClearance = Number.isFinite(options.clearance) ? Math.max(0, Math.floor(options.clearance)) : 0;
    const wallAvoidance = Number.isFinite(options.wallAvoidance) ? Math.max(0, options.wallAvoidance) : 0;
    const blockedNeighborAvoidance = Number.isFinite(options.blockedNeighborAvoidance) ? Math.max(0, options.blockedNeighborAvoidance) : 0;
    const wallBlockedConnectionCost = Number(options.wallBlockedConnectionCost);
    const maxPathLength = Number.isFinite(options.maxPathLength) ? Math.max(0, options.maxPathLength) : Infinity;

    if (!Number.isInteger(startIndex) || !Number.isInteger(goalIndex) || startIndex < 0 || startIndex >= nodeCount || goalIndex < 0 || goalIndex >= nodeCount) {
        emptyPathResult(message, "unknown_node");
        return;
    }
    if (!allowBlockedDestination && getNodeBlocked(nodes, nodeStride, goalIndex)) {
        emptyPathResult(message, "destination_blocked");
        return;
    }
    if (startIndex === goalIndex) {
        const empty = new Int32Array(0);
        const emptyWallBlockedEdges = new Uint8Array(0);
        self.postMessage({
            type: "path_result",
            requestId: message.requestId,
            mapVersion: activeSnapshot.version,
            ok: true,
            pathNodeIndices: empty,
            wallBlockedPathEdges: emptyWallBlockedEdges,
            pathEdgeIds: [],
            plannedInteractions: [],
            stats: { iterations: 0, expanded: 0 }
        }, [empty.buffer, emptyWallBlockedEdges.buffer]);
        return;
    }

    const openSet = new Set();
    const openQueue = new MinPriorityQueue();
    const cameFrom = new Int32Array(nodeCount);
    const cameFromEdge = new Int32Array(nodeCount);
    const gScore = new Float64Array(nodeCount);
    const distanceScore = new Float64Array(nodeCount);
    const fScore = new Float64Array(nodeCount);
    cameFrom.fill(-1);
    cameFromEdge.fill(-1);
    gScore.fill(Infinity);
    distanceScore.fill(Infinity);
    fScore.fill(Infinity);

    openSet.add(startIndex);
    gScore[startIndex] = 0;
    distanceScore[startIndex] = 0;
    fScore[startIndex] = nodeDistance(nodes, nodeStride, startIndex, goalIndex);
    openQueue.push(startIndex, fScore[startIndex]);

    const maxIterations = Math.max(1000, nodeCount * 4);
    let iterations = 0;
    let expanded = 0;

    while (!openQueue.isEmpty() && openSet.size > 0 && iterations < maxIterations) {
        iterations += 1;
        const currentEntry = popCurrent(openQueue, openSet, fScore);
        if (!currentEntry) break;

        const currentIndex = currentEntry.value;
        if (currentIndex === goalIndex) {
            const path = reconstructPath(cameFrom, currentIndex);
            const wallBlockedPathEdges = reconstructWallBlockedPathEdges(cameFrom, cameFromEdge, edges, edgeStride, currentIndex);
            self.postMessage({
                type: "path_result",
                requestId: message.requestId,
                mapVersion: activeSnapshot.version,
                ok: true,
                pathNodeIndices: path,
                wallBlockedPathEdges,
                pathEdgeIds: [],
                plannedInteractions: [],
                stats: { iterations, expanded }
            }, [path.buffer, wallBlockedPathEdges.buffer]);
            return;
        }

        openSet.delete(currentIndex);
        expanded += 1;

        const currentG = gScore[currentIndex];
        const currentDistance = distanceScore[currentIndex];
        for (let adjacencyOffset = adjacencyOffsets[currentIndex]; adjacencyOffset < adjacencyOffsets[currentIndex + 1]; adjacencyOffset++) {
            const edgeIndex = adjacencyEdges[adjacencyOffset];
            const edgeBase = edgeIndex * edgeStride;
            const toIndex = edges[edgeBase + EDGE_TO];
            if (getNodeBlocked(nodes, nodeStride, toIndex) && (toIndex !== goalIndex || !allowBlockedDestination)) continue;

            const clearance = getNodeClearance(nodes, nodeStride, toIndex);
            if (clearance < 0 && toIndex !== goalIndex) continue;
            if (requiredClearance > 0 && toIndex !== goalIndex && clearance < requiredClearance) continue;

            const stepDist = nodeDistance(nodes, nodeStride, currentIndex, toIndex);
            const tentativeDistance = currentDistance + stepDist;
            if (tentativeDistance > maxPathLength) continue;

            const clearanceForCost = clearance >= 0 ? clearance : 0;
            let stepCost = wallAvoidance > 0
                ? stepDist * (1 + wallAvoidance / (1 + clearanceForCost))
                : stepDist;
            if (blockedNeighborAvoidance > 0) {
                stepCost *= 1 + getNodeBlockedNeighborCount(nodes, nodeStride, toIndex) * blockedNeighborAvoidance;
            }
            if (edgeIsWallBlocked(edges, edgeStride, edgeBase)) {
                stepCost += getWallBlockedConnectionCost(
                    wallBlockedConnectionCost,
                    edgeIndex
                );
            }
            stepCost += getNodeTemporaryCost(nodes, nodeStride, toIndex);
            const tentativeG = currentG + stepCost;
            if (tentativeG >= gScore[toIndex]) continue;

            cameFrom[toIndex] = currentIndex;
            cameFromEdge[toIndex] = edgeIndex;
            gScore[toIndex] = tentativeG;
            distanceScore[toIndex] = tentativeDistance;
            fScore[toIndex] = tentativeG + nodeDistance(nodes, nodeStride, toIndex, goalIndex);
            openSet.add(toIndex);
            openQueue.push(toIndex, fScore[toIndex]);
        }
    }

    const empty = new Int32Array(0);
    const emptyWallBlockedEdges = new Uint8Array(0);
    self.postMessage({
        type: "path_result",
        requestId: message.requestId,
        mapVersion: activeSnapshot.version,
        ok: false,
        reason: "no_path",
        pathNodeIndices: empty,
        wallBlockedPathEdges: emptyWallBlockedEdges,
        pathEdgeIds: [],
        plannedInteractions: [],
        stats: { iterations, expanded }
    }, [empty.buffer, emptyWallBlockedEdges.buffer]);
}

function getWallBlockedConnectionCost(defaultCost, edgeIndex) {
    if (!Number.isInteger(edgeIndex) || edgeIndex < 0 || edgeIndex >= wallIndexByEdge.length) {
        throw new Error(`pathfinding wall-blocked edge cost lookup received invalid edge ${edgeIndex}`);
    }
    const wallIndex = wallIndexByEdge[edgeIndex];
    if (!Number.isInteger(wallIndex) || wallIndex < 0 || wallIndex >= wallCostScales.length) {
        throw new Error(`pathfinding wall-blocked edge ${edgeIndex} is missing its wall cost scale`);
    }
    const cost = Number(defaultCost) * wallCostScales[wallIndex];
    if (!Number.isFinite(cost) || cost < 0) {
        throw new Error("pathfinding wall-blocked edge requires a finite non-negative wallBlockedConnectionCost");
    }
    return cost;
}

function popCurrent(openQueue, openSet, fScore) {
    while (!openQueue.isEmpty()) {
        const candidate = openQueue.pop();
        if (!candidate) break;
        if (!openSet.has(candidate.value)) continue;
        if (candidate.priority > fScore[candidate.value]) continue;
        return candidate;
    }
    return null;
}

function getNodeBlocked(nodes, stride, index) {
    return nodes[index * stride + NODE_BLOCKED] === 1;
}

function getNodeClearance(nodes, stride, index) {
    const clearance = nodes[index * stride + NODE_CLEARANCE];
    return Number.isFinite(clearance) ? clearance : Infinity;
}

function getNodeBlockedNeighborCount(nodes, stride, index) {
    const count = nodes[index * stride + NODE_BLOCKED_NEIGHBOR_COUNT];
    if (!Number.isFinite(count) || count < 0) throw new Error(`pathfinding node ${index} has invalid blocked neighbor count`);
    return count;
}

function getNodeTemporaryCost(nodes, stride, index) {
    const cost = nodes[index * stride + NODE_TEMPORARY_COST];
    if (!Number.isFinite(cost) || cost < 0) throw new Error(`pathfinding node ${index} has invalid temporary cost`);
    return cost;
}

function edgeIsWallBlocked(edges, stride, edgeBase) {
    if (!(edges instanceof Int32Array)) {
        throw new Error("pathfinding wall-blocked edge lookup requires packed edges");
    }
    if (!Number.isInteger(stride) || stride <= EDGE_WALL_BLOCKED) {
        throw new Error("pathfinding wall-blocked edge lookup requires edge flag data");
    }
    const value = edges[edgeBase + EDGE_WALL_BLOCKED];
    if (value !== 0 && value !== 1) throw new Error(`pathfinding edge at ${edgeBase} has invalid wall-blocked flag`);
    return value === 1;
}

function nodeDistance(nodes, stride, leftIndex, rightIndex) {
    const leftBase = leftIndex * stride;
    const rightBase = rightIndex * stride;
    const dx = nodes[rightBase + NODE_X] - nodes[leftBase + NODE_X];
    const dy = nodes[rightBase + NODE_Y] - nodes[leftBase + NODE_Y];
    return Math.sqrt(dx * dx + dy * dy);
}

function reconstructPath(cameFrom, currentIndex) {
    const reversed = [];
    let walkIndex = currentIndex;
    const seen = new Set();
    while (cameFrom[walkIndex] >= 0) {
        reversed.push(walkIndex);
        walkIndex = cameFrom[walkIndex];
        if (seen.has(walkIndex)) break;
        seen.add(walkIndex);
    }
    const path = new Int32Array(reversed.length);
    for (let i = 0; i < reversed.length; i++) {
        path[i] = reversed[reversed.length - 1 - i];
    }
    return path;
}

function reconstructWallBlockedPathEdges(cameFrom, cameFromEdge, edges, edgeStride, currentIndex) {
    const reversed = [];
    let walkIndex = currentIndex;
    const seen = new Set();
    while (cameFrom[walkIndex] >= 0) {
        const edgeIndex = cameFromEdge[walkIndex];
        if (!Number.isInteger(edgeIndex) || edgeIndex < 0) {
            throw new Error(`pathfinding node ${walkIndex} is missing its predecessor edge`);
        }
        reversed.push(edgeIsWallBlocked(edges, edgeStride, edgeIndex * edgeStride) ? 1 : 0);
        walkIndex = cameFrom[walkIndex];
        if (seen.has(walkIndex)) break;
        seen.add(walkIndex);
    }
    const flags = new Uint8Array(reversed.length);
    for (let i = 0; i < reversed.length; i++) {
        flags[i] = reversed[reversed.length - 1 - i];
    }
    return flags;
}

self.addEventListener("message", (event) => {
    const message = event && event.data ? event.data : null;
    if (!message || typeof message.type !== "string") return;
    try {
        if (message.type === "init_snapshot" || message.type === "replace_snapshot") {
            installSnapshot(message.snapshot || null);
            return;
        }
        if (message.type === "request_path") {
            handleRequestPath(message);
            return;
        }
        if (message.type === "wall_cost_patch") {
            applyWallCostPatch(message);
        }
    } catch (error) {
        if (message.type !== "request_path") {
            self.postMessage({
                type: "error",
                mapVersion: activeSnapshot ? activeSnapshot.version : message.mapVersion,
                message: error && error.message ? error.message : String(error)
            });
            return;
        }
        self.postMessage({
            type: "path_result",
            requestId: message.requestId,
            mapVersion: activeSnapshot ? activeSnapshot.version : message.mapVersion,
            ok: false,
            reason: "error",
            message: error && error.message ? error.message : String(error),
            pathNodeIndices: new Int32Array(0),
            pathEdgeIds: [],
            plannedInteractions: [],
            stats: { iterations: 0, expanded: 0 }
        });
    }
});
