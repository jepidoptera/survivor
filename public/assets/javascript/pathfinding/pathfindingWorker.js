"use strict";

let activeSnapshot = null;
let edgeMap = new Map();
let nodeMap = new Map();
let adjacencyMap = new Map();
let obstacleMap = new Map();

function rebuildIndexes(snapshot) {
    nodeMap = new Map();
    edgeMap = new Map();
    adjacencyMap = new Map();
    obstacleMap = new Map();
    if (!snapshot) return;
    if (Array.isArray(snapshot.nodes)) {
        for (let i = 0; i < snapshot.nodes.length; i++) {
            const node = snapshot.nodes[i];
            if (!node || typeof node.key !== "string") continue;
            nodeMap.set(node.key, node);
        }
    }
    if (Array.isArray(snapshot.edges)) {
        for (let i = 0; i < snapshot.edges.length; i++) {
            const edge = snapshot.edges[i];
            if (!edge || typeof edge.id !== "string") continue;
            edgeMap.set(edge.id, edge);
            if (!adjacencyMap.has(edge.fromKey)) {
                adjacencyMap.set(edge.fromKey, []);
            }
            adjacencyMap.get(edge.fromKey).push(edge);
        }
    }
    if (Array.isArray(snapshot.obstacles)) {
        for (let i = 0; i < snapshot.obstacles.length; i++) {
            const obstacle = snapshot.obstacles[i];
            if (!obstacle || typeof obstacle.id !== "string") continue;
            obstacleMap.set(obstacle.id, obstacle);
        }
    }
}

// Binary min-heap priority queue
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

// Returns { allowed, penalty, interactions } for a list of obstacle ids.
// Actor profile controls which obstacles are knockable.
function evaluateObstacleIds(obstacleIds, actor) {
    if (!Array.isArray(obstacleIds) || obstacleIds.length === 0) {
        return { allowed: true, penalty: 0, interactions: [] };
    }
    let totalPenalty = 0;
    const interactions = [];
    for (let i = 0; i < obstacleIds.length; i++) {
        const id = obstacleIds[i];
        const obstacle = obstacleMap.get(id);
        if (!obstacle || obstacle.gone) continue;
        const state = obstacle.state;
        if (obstacle.kind === "door") {
            if (state === "open" || state === "fallen" || state === "gone") continue;
            // Closed door — knockable only when actor can break doors
            if (!actor.canBreakDoors) return { allowed: false, penalty: 0, interactions: [] };
            const hp = Number.isFinite(obstacle.hp) ? obstacle.hp : 1;
            const damage = Math.max(1, Number.isFinite(actor.damage) ? actor.damage : 1);
            const hits = Math.ceil(hp / damage);
            const addedCost = hits * 2;
            totalPenalty += addedCost;
            interactions.push({ obstacleId: id, action: "break", expectedHits: hits, addedCost });
        } else if (obstacle.kind === "tree") {
            if (state === "falling" || state === "down" || state === "gone") continue;
            // Standing tree — blocked if too large for actor
            const treeSize = Number.isFinite(obstacle.size) ? obstacle.size : 1;
            const actorSize = Number.isFinite(actor.size) ? actor.size : 1;
            if (!actor.canBreakTreesLargerThanSelf && treeSize > actorSize) {
                return { allowed: false, penalty: 0, interactions: [] };
            }
            const hp = Number.isFinite(obstacle.hp) ? obstacle.hp : 1;
            const damage = Math.max(1, Number.isFinite(actor.damage) ? actor.damage : 1);
            const hits = Math.ceil(hp / damage);
            const addedCost = hits * 2;
            totalPenalty += addedCost;
            interactions.push({ obstacleId: id, action: "break", expectedHits: hits, addedCost });
        }
    }
    return { allowed: true, penalty: totalPenalty, interactions };
}

function handleRequestPath(message) {
    if (!activeSnapshot) {
        self.postMessage({
            type: "path_result",
            requestId: message.requestId,
            mapVersion: message.mapVersion,
            ok: false,
            reason: "snapshot_missing",
            pathNodeKeys: [],
            pathEdgeIds: [],
            plannedInteractions: [],
            stats: { iterations: 0, expanded: 0 }
        });
        return;
    }
    if (Number(message.mapVersion) !== Number(activeSnapshot.version)) {
        self.postMessage({
            type: "path_result",
            requestId: message.requestId,
            mapVersion: activeSnapshot.version,
            ok: false,
            reason: "stale_snapshot",
            pathNodeKeys: [],
            pathEdgeIds: [],
            plannedInteractions: [],
            stats: { iterations: 0, expanded: 0 }
        });
        return;
    }

    const startKey = message.startNodeKey;
    const goalKey = message.destinationNodeKey;

    if (!nodeMap.has(startKey) || !nodeMap.has(goalKey)) {
        self.postMessage({
            type: "path_result",
            requestId: message.requestId,
            mapVersion: activeSnapshot.version,
            ok: false,
            reason: "unknown_node",
            pathNodeKeys: [],
            pathEdgeIds: [],
            plannedInteractions: [],
            stats: { iterations: 0, expanded: 0 }
        });
        return;
    }

    const actor = message.actor || {};
    const options = message.options || {};
    const allowBlockedDestination = options.allowBlockedDestination === true;
    const requiredClearance = Number.isFinite(options.clearance) ? Math.max(0, Math.floor(options.clearance)) : 0;
    const wallAvoidance = Number.isFinite(options.wallAvoidance) ? Math.max(0, options.wallAvoidance) : 0;
    const maxPathLength = Number.isFinite(options.maxPathLength) ? Math.max(0, options.maxPathLength) : Infinity;

    const startNode = nodeMap.get(startKey);
    const goalNode = nodeMap.get(goalKey);

    // Pre-validate destination reachability
    if (!allowBlockedDestination) {
        if (goalNode.blocked) {
            self.postMessage({
                type: "path_result",
                requestId: message.requestId,
                mapVersion: activeSnapshot.version,
                ok: false,
                reason: "destination_blocked",
                pathNodeKeys: [],
                pathEdgeIds: [],
                plannedInteractions: [],
                stats: { iterations: 0, expanded: 0 }
            });
            return;
        }
        const goalTileIds = (activeSnapshot.tileObstacleIdsByNodeKey && activeSnapshot.tileObstacleIdsByNodeKey[goalKey]) || [];
        if (!evaluateObstacleIds(goalTileIds, actor).allowed) {
            self.postMessage({
                type: "path_result",
                requestId: message.requestId,
                mapVersion: activeSnapshot.version,
                ok: false,
                reason: "destination_blocked",
                pathNodeKeys: [],
                pathEdgeIds: [],
                plannedInteractions: [],
                stats: { iterations: 0, expanded: 0 }
            });
            return;
        }
        if (requiredClearance > 0) {
            const cl = goalNode.clearance !== null ? goalNode.clearance : Infinity;
            if (cl < requiredClearance) {
                self.postMessage({
                    type: "path_result",
                    requestId: message.requestId,
                    mapVersion: activeSnapshot.version,
                    ok: false,
                    reason: "destination_blocked",
                    pathNodeKeys: [],
                    pathEdgeIds: [],
                    plannedInteractions: [],
                    stats: { iterations: 0, expanded: 0 }
                });
                return;
            }
        }
    }

    // Early out: same node
    if (startKey === goalKey) {
        self.postMessage({
            type: "path_result",
            requestId: message.requestId,
            mapVersion: activeSnapshot.version,
            ok: true,
            pathNodeKeys: [],
            pathEdgeIds: [],
            plannedInteractions: [],
            stats: { iterations: 0, expanded: 0 }
        });
        return;
    }

    const heuristic = function (node) {
        const dx = node.x - goalNode.x;
        const dy = node.y - goalNode.y;
        return Math.sqrt(dx * dx + dy * dy);
    };

    const openSet = new Set();
    const openQueue = new MinPriorityQueue();
    const cameFromKey = new Map();
    const cameFromEdgeId = new Map();
    const gScore = new Map();
    const distanceScore = new Map();
    const fScore = new Map();

    openSet.add(startKey);
    gScore.set(startKey, 0);
    distanceScore.set(startKey, 0);
    const startF = heuristic(startNode);
    fScore.set(startKey, startF);
    openQueue.push(startKey, startF);

    const maxIterations = Math.max(1000, nodeMap.size * 4);
    let iterations = 0;
    let expanded = 0;

    while (!openQueue.isEmpty() && openSet.size > 0 && iterations < maxIterations) {
        iterations += 1;

        // Pop the best candidate, skipping stale entries
        let currentEntry = null;
        while (!openQueue.isEmpty()) {
            const candidate = openQueue.pop();
            if (!candidate) break;
            if (!openSet.has(candidate.value)) continue;
            const liveF = fScore.get(candidate.value);
            if (liveF !== undefined && candidate.priority > liveF) continue;
            currentEntry = candidate;
            break;
        }
        if (!currentEntry) break;

        const currentKey = currentEntry.value;

        if (currentKey === goalKey) {
            // Reconstruct path backwards through cameFromKey
            const pathNodeKeys = [];
            const pathEdgeIds = [];
            let walkKey = currentKey;
            const seen = new Set();
            while (cameFromKey.has(walkKey)) {
                pathNodeKeys.unshift(walkKey);
                const edgeId = cameFromEdgeId.get(walkKey);
                if (edgeId) pathEdgeIds.unshift(edgeId);
                walkKey = cameFromKey.get(walkKey);
                if (seen.has(walkKey)) break;
                seen.add(walkKey);
            }

            // Collect planned interactions by replaying the path edges
            const plannedInteractions = [];
            const interactionsSeen = new Set();
            for (let pi = 0; pi < pathEdgeIds.length; pi++) {
                const edge = edgeMap.get(pathEdgeIds[pi]);
                const toKey = pathNodeKeys[pi];
                if (edge) {
                    const dirResult = evaluateObstacleIds(edge.directionalObstacleIds, actor);
                    for (let ii = 0; ii < dirResult.interactions.length; ii++) {
                        const ix = dirResult.interactions[ii];
                        if (!interactionsSeen.has(ix.obstacleId)) {
                            interactionsSeen.add(ix.obstacleId);
                            plannedInteractions.push(ix);
                        }
                    }
                }
                if (toKey) {
                    const tileIds = (activeSnapshot.tileObstacleIdsByNodeKey && activeSnapshot.tileObstacleIdsByNodeKey[toKey]) || [];
                    const tileResult = evaluateObstacleIds(tileIds, actor);
                    for (let ii = 0; ii < tileResult.interactions.length; ii++) {
                        const ix = tileResult.interactions[ii];
                        if (!interactionsSeen.has(ix.obstacleId)) {
                            interactionsSeen.add(ix.obstacleId);
                            plannedInteractions.push(ix);
                        }
                    }
                }
            }

            self.postMessage({
                type: "path_result",
                requestId: message.requestId,
                mapVersion: activeSnapshot.version,
                ok: true,
                pathNodeKeys,
                pathEdgeIds,
                plannedInteractions,
                stats: { iterations, expanded }
            });
            return;
        }

        openSet.delete(currentKey);
        expanded += 1;

        const currentG = gScore.get(currentKey) || 0;
        const currentDistance = distanceScore.get(currentKey) || 0;
        const currentNode = nodeMap.get(currentKey);
        if (!currentNode) continue;

        const outgoingEdges = adjacencyMap.get(currentKey) || [];
        for (let ei = 0; ei < outgoingEdges.length; ei++) {
            const edge = outgoingEdges[ei];
            const toKey = edge.toKey;
            const toNode = nodeMap.get(toKey);
            if (!toNode) continue;

            // Skip hard-blocked nodes (except when it's the goal and we allow it)
            if (toNode.blocked && (toKey !== goalKey || !allowBlockedDestination)) continue;

            // Clearance filter (skip non-goal nodes that don't meet clearance)
            if (requiredClearance > 0 && toKey !== goalKey) {
                const cl = toNode.clearance !== null ? toNode.clearance : Infinity;
                if (cl < requiredClearance) continue;
            }

            // Directional obstacle cost (edge blockers)
            const dirResult = evaluateObstacleIds(edge.directionalObstacleIds, actor);
            if (!dirResult.allowed) continue;

            // Tile obstacle cost on destination (skip for goal if allowBlockedDestination)
            let tilePenalty = 0;
            if (toKey !== goalKey || !allowBlockedDestination) {
                const tileIds = (activeSnapshot.tileObstacleIdsByNodeKey && activeSnapshot.tileObstacleIdsByNodeKey[toKey]) || [];
                const tileResult = evaluateObstacleIds(tileIds, actor);
                if (!tileResult.allowed) continue;
                tilePenalty = tileResult.penalty;
            }

            // Step distance
            const dx = toNode.x - currentNode.x;
            const dy = toNode.y - currentNode.y;
            const stepDist = Math.sqrt(dx * dx + dy * dy);
            const tentativeDistance = currentDistance + stepDist;
            if (tentativeDistance > maxPathLength) continue;

            // Movement cost with wall avoidance
            let stepCost = stepDist;
            if (wallAvoidance > 0) {
                const cl = toNode.clearance !== null ? toNode.clearance : 0;
                stepCost = stepDist * (1 + wallAvoidance / (1 + cl));
            }
            const tentativeG = currentG + stepCost + dirResult.penalty + tilePenalty;

            const existingG = gScore.has(toKey) ? gScore.get(toKey) : Infinity;
            if (tentativeG >= existingG) continue;

            cameFromKey.set(toKey, currentKey);
            cameFromEdgeId.set(toKey, edge.id);
            gScore.set(toKey, tentativeG);
            distanceScore.set(toKey, tentativeDistance);
            const neighborF = tentativeG + heuristic(toNode);
            fScore.set(toKey, neighborF);
            openSet.add(toKey);
            openQueue.push(toKey, neighborF);
        }
    }

    self.postMessage({
        type: "path_result",
        requestId: message.requestId,
        mapVersion: activeSnapshot.version,
        ok: false,
        reason: "no_path",
        pathNodeKeys: [],
        pathEdgeIds: [],
        plannedInteractions: [],
        stats: { iterations, expanded }
    });
}

self.addEventListener("message", (event) => {
    const message = event && event.data ? event.data : null;
    if (!message || typeof message.type !== "string") return;

    if (message.type === "init_snapshot" || message.type === "replace_snapshot") {
        activeSnapshot = message.snapshot || null;
        rebuildIndexes(activeSnapshot);
        self.postMessage({
            type: "ready",
            version: activeSnapshot ? activeSnapshot.version : null
        });
        return;
    }

    if (message.type === "request_path") {
        handleRequestPath(message);
    }
});
