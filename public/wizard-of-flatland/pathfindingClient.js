(function () {
    "use strict";

    const WALL_BLOCKED_CONNECTION_BASE_PATH_COST = 100;
    const WALL_BLOCKED_CONNECTION_ZONE_COST_DIVISOR = 1.1;

    function createPathfindingClientSystem(deps) {
        const state = deps && deps.state;
        const worker = deps && deps.worker;
        const callbacks = deps && deps.callbacks;
        if (!state || typeof state !== "object") {
            throw new Error("Wizard of Flatland pathfinding client requires state");
        }
        if (!worker || typeof worker.postMessage !== "function") {
            throw new Error("Wizard of Flatland pathfinding client requires a worker");
        }
        if (
            !callbacks ||
            typeof callbacks.getPathfindingNodeKey !== "function" ||
            typeof callbacks.getPathfindingNodeX !== "function" ||
            typeof callbacks.getPathfindingNodeY !== "function" ||
            typeof callbacks.isValidPathfindingNodeIndex !== "function" ||
            typeof callbacks.getPathfindingNodeIndexForKey !== "function" ||
            typeof callbacks.getPathfindingBlockedEdgeWallIndex !== "function" ||
            typeof callbacks.getWallBreakConnectionCostOverrides !== "function" ||
            typeof callbacks.advanceAgentPathCursor !== "function" ||
            typeof callbacks.getAgentPathWaypoint !== "function"
        ) {
            throw new Error("Wizard of Flatland pathfinding client requires path node callbacks");
        }

        function requestAgentPath(agent, rawStartNodeIndex, startNodeIndex, goalNodeIndex, now) {
            const requestId = state.pathfindingRequestId++;
            const wallBlockedConnectionCost = getAgentWallBlockedConnectionPathCost(agent);
            const wallBlockedConnectionCostOverrides = callbacks.getWallBreakConnectionCostOverrides(wallBlockedConnectionCost);
            const rawStartNodeKey = callbacks.getPathfindingNodeKey(rawStartNodeIndex);
            const startNodeKey = callbacks.getPathfindingNodeKey(startNodeIndex);
            const goalNodeKey = callbacks.getPathfindingNodeKey(goalNodeIndex);
            agent.pathRequestPending = true;
            agent.pathRequestId = requestId;
            agent.pathRequestedAt = now;
            agent.pathRequestedWorldVersion = state.pathfindingSnapshotVersion;
            agent.pathRequestedWallBreakRevision = state.wallBreakCostRevision;
            agent.pathRequestedRawStartKey = rawStartNodeKey;
            agent.pathRequestedStartKey = startNodeKey;
            agent.pathRequestedGoalKey = goalNodeKey;
            worker.postMessage({
                type: "request_path",
                requestId,
                mapVersion: state.pathfindingSnapshotVersion,
                actor: {
                    size: 1,
                    damage: 1,
                    canBreakDoors: false,
                    canBreakTreesLargerThanSelf: false
                },
                startNodeIndex,
                destinationNodeIndex: goalNodeIndex,
                options: {
                    allowBlockedDestination: false,
                    maxPathLength: null,
                    wallAvoidance: 0.4,
                    blockedNeighborAvoidance: 0.12,
                    wallBlockedConnectionCost,
                    wallBlockedConnectionCostOverrides,
                    includeBlockedPlan: false
                }
            });
        }

        function getAgentWallBlockedConnectionPathCost(agent) {
            const zoneLevel = Number(agent && agent.zoneLevel);
            if (!Number.isInteger(zoneLevel) || zoneLevel < 0) {
                throw new Error(`Wizard of Flatland pathfinding requires enemy ${agent && agent.id} to have a non-negative integer zone level`);
            }
            return WALL_BLOCKED_CONNECTION_BASE_PATH_COST / WALL_BLOCKED_CONNECTION_ZONE_COST_DIVISOR ** zoneLevel;
        }

        function handlePathfindingWorkerMessage(event) {
            const message = event && event.data ? event.data : null;
            if (!message || typeof message.type !== "string") return;
            if (message.type === "ready") return;
            if (message.type !== "path_result") return;
            const agent = state.agents.find((candidate) => candidate.pathRequestId === message.requestId);
            if (!agent) return;
            agent.pathRequestPending = false;
            if (Number(message.mapVersion) !== Number(state.pathfindingSnapshotVersion)) return;
            if (!message.ok) {
                agent.pathNodeKeys = [];
                agent.pathWaypoints = [];
                agent.pathCursor = 0;
                agent.pathGoalX = agent.x;
                agent.pathGoalY = agent.y;
                agent.pathGoalWallBlocked = false;
                agent.wallBreakTargetEdgeKey = "";
                agent.wallBreakTargetWallIndex = -1;
                agent.wallBreakTargetSegmentId = "";
                return;
            }
            if (!(message.pathNodeIndices instanceof Int32Array) && !Array.isArray(message.pathNodeIndices)) {
                throw new Error("Wizard of Flatland pathfinding worker returned a malformed path");
            }
            if (!(message.wallBlockedPathEdges instanceof Uint8Array) && !Array.isArray(message.wallBlockedPathEdges)) {
                throw new Error("Wizard of Flatland pathfinding worker returned malformed wall-blocked path edge flags");
            }
            if (message.wallBlockedPathEdges.length !== message.pathNodeIndices.length) {
                throw new Error("Wizard of Flatland pathfinding worker returned mismatched wall-blocked path edge flags");
            }
            const pathNodeKeys = [];
            const pathWaypoints = [];
            let previousPathIndex = callbacks.getPathfindingNodeIndexForKey(agent.pathRequestedStartKey);
            if (!Number.isInteger(previousPathIndex)) {
                throw new Error(`Wizard of Flatland pathfinding request start node is missing: ${agent.pathRequestedStartKey}`);
            }
            for (let i = 0; i < message.pathNodeIndices.length; i++) {
                const pathIndex = message.pathNodeIndices[i];
                if (!callbacks.isValidPathfindingNodeIndex(pathIndex)) {
                    throw new Error(`Wizard of Flatland pathfinding worker returned unknown node index ${pathIndex}`);
                }
                const wallBlockedFromPrevious = message.wallBlockedPathEdges[i] === 1;
                appendAgentPathWaypoint(
                    pathNodeKeys,
                    pathWaypoints,
                    pathIndex,
                    false,
                    wallBlockedFromPrevious,
                    previousPathIndex
                );
                previousPathIndex = pathIndex;
            }
            if (agent.pathRequestedStartKey !== agent.pathRequestedRawStartKey) {
                const requestedStartIndex = callbacks.getPathfindingNodeIndexForKey(agent.pathRequestedStartKey);
                if (Number.isInteger(requestedStartIndex) && pathNodeKeys[0] !== agent.pathRequestedStartKey) {
                    appendAgentPathWaypoint(pathNodeKeys, pathWaypoints, requestedStartIndex, true, false, null);
                }
            }
            agent.pathNodeKeys = pathNodeKeys;
            agent.pathWaypoints = pathWaypoints;
            agent.pathCursor = 0;
            callbacks.advanceAgentPathCursor(agent);
            const waypoint = callbacks.getAgentPathWaypoint(agent);
            if (waypoint) {
                agent.pathGoalX = waypoint.x;
                agent.pathGoalY = waypoint.y;
                agent.pathGoalWallBlocked = waypoint.wallBlockedFromPrevious === true;
                agent.wallBreakTargetEdgeKey = waypoint.wallBlockedFromPrevious === true ? waypoint.wallBlockedEdgeKey : "";
                agent.wallBreakTargetWallIndex = waypoint.wallBlockedFromPrevious === true ? waypoint.wallBlockedWallIndex : -1;
                agent.wallBreakTargetSegmentId = "";
            }
        }

        function appendAgentPathWaypoint(pathNodeKeys, pathWaypoints, pathIndex, prepend = false, wallBlockedFromPrevious = false, previousPathIndex = null) {
            if (!Array.isArray(pathNodeKeys) || !Array.isArray(pathWaypoints)) {
                throw new Error("Wizard of Flatland path waypoint append requires path arrays");
            }
            if (!callbacks.isValidPathfindingNodeIndex(pathIndex)) {
                throw new Error(`Wizard of Flatland path waypoint append received invalid node index ${pathIndex}`);
            }
            const waypoint = {
                key: callbacks.getPathfindingNodeKey(pathIndex),
                x: callbacks.getPathfindingNodeX(pathIndex),
                y: callbacks.getPathfindingNodeY(pathIndex),
                wallBlockedFromPrevious: wallBlockedFromPrevious === true,
                wallBlockedEdgeKey: "",
                wallBlockedWallIndex: -1
            };
            if (wallBlockedFromPrevious === true) {
                if (!Number.isInteger(previousPathIndex)) {
                    throw new Error("Wizard of Flatland wall-blocked waypoint requires a previous path node");
                }
                const wallIndex = callbacks.getPathfindingBlockedEdgeWallIndex(previousPathIndex, pathIndex);
                waypoint.wallBlockedEdgeKey = `${previousPathIndex}->${pathIndex}`;
                waypoint.wallBlockedWallIndex = wallIndex;
            }
            if (prepend) {
                pathNodeKeys.unshift(waypoint.key);
                pathWaypoints.unshift(waypoint);
                return;
            }
            pathNodeKeys.push(waypoint.key);
            pathWaypoints.push(waypoint);
        }

        return Object.freeze({
            requestAgentPath,
            handlePathfindingWorkerMessage
        });
    }

    window.WizardFlatlandPathfindingClient = Object.freeze({
        createPathfindingClientSystem
    });
}());
