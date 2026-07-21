"use strict";

let activeSnapshot = null;
let adjacencyOffsets = new Int32Array(0);
let adjacencyEdges = new Int32Array(0);

const SNAPSHOT_FORMAT = "wizard-flatland-packed-v1";
const NODE_X = 0;
const NODE_Y = 1;
const NODE_BLOCKED = 2;
const NODE_CLEARANCE = 3;
const EDGE_FROM = 0;
const EDGE_TO = 1;
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

    activeSnapshot = snapshot;
    rebuildAdjacency(snapshot);
    self.postMessage({ type: "ready", version: snapshot.version });
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
    if (!Number.isInteger(stride) || stride < 8) {
        throw new Error("Wizard of Flatland packed pathfinding snapshot requires node stride >= 8");
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
    const result = {
        type: "path_result",
        requestId: message.requestId,
        mapVersion: activeSnapshot ? activeSnapshot.version : message.mapVersion,
        ok: false,
        reason,
        pathNodeIndices: empty,
        pathEdgeIds: [],
        plannedInteractions: [],
        stats: { iterations: 0, expanded: 0 }
    };
    self.postMessage(result, [empty.buffer]);
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
        self.postMessage({
            type: "path_result",
            requestId: message.requestId,
            mapVersion: activeSnapshot.version,
            ok: true,
            pathNodeIndices: empty,
            pathEdgeIds: [],
            plannedInteractions: [],
            stats: { iterations: 0, expanded: 0 }
        }, [empty.buffer]);
        return;
    }

    const openSet = new Set();
    const openQueue = new MinPriorityQueue();
    const cameFrom = new Int32Array(nodeCount);
    const gScore = new Float64Array(nodeCount);
    const distanceScore = new Float64Array(nodeCount);
    const fScore = new Float64Array(nodeCount);
    cameFrom.fill(-1);
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
            self.postMessage({
                type: "path_result",
                requestId: message.requestId,
                mapVersion: activeSnapshot.version,
                ok: true,
                pathNodeIndices: path,
                pathEdgeIds: [],
                plannedInteractions: [],
                stats: { iterations, expanded }
            }, [path.buffer]);
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
            const stepCost = wallAvoidance > 0
                ? stepDist * (1 + wallAvoidance / (1 + clearanceForCost))
                : stepDist;
            const tentativeG = currentG + stepCost;
            if (tentativeG >= gScore[toIndex]) continue;

            cameFrom[toIndex] = currentIndex;
            gScore[toIndex] = tentativeG;
            distanceScore[toIndex] = tentativeDistance;
            fScore[toIndex] = tentativeG + nodeDistance(nodes, nodeStride, toIndex, goalIndex);
            openSet.add(toIndex);
            openQueue.push(toIndex, fScore[toIndex]);
        }
    }

    const empty = new Int32Array(0);
    self.postMessage({
        type: "path_result",
        requestId: message.requestId,
        mapVersion: activeSnapshot.version,
        ok: false,
        reason: "no_path",
        pathNodeIndices: empty,
        pathEdgeIds: [],
        plannedInteractions: [],
        stats: { iterations, expanded }
    }, [empty.buffer]);
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
        }
    } catch (error) {
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
