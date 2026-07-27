(function () {
    "use strict";

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
            typeof callbacks.advanceAgentPathCursor !== "function" ||
            typeof callbacks.getAgentPathWaypoint !== "function"
        ) {
            throw new Error("Wizard of Flatland pathfinding client requires path node callbacks");
        }

        function requestAgentPath(agent, rawStartNodeIndex, startNodeIndex, goalNodeIndex, now) {
            const requestId = state.pathfindingRequestId++;
            const rawStartNodeKey = callbacks.getPathfindingNodeKey(rawStartNodeIndex);
            const startNodeKey = callbacks.getPathfindingNodeKey(startNodeIndex);
            const goalNodeKey = callbacks.getPathfindingNodeKey(goalNodeIndex);
            agent.pathRequestPending = true;
            agent.pathRequestId = requestId;
            agent.pathRequestedAt = now;
            agent.pathRequestedWorldVersion = state.pathfindingSnapshotVersion;
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
                    includeBlockedPlan: false
                }
            });
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
                return;
            }
            if (!(message.pathNodeIndices instanceof Int32Array) && !Array.isArray(message.pathNodeIndices)) {
                throw new Error("Wizard of Flatland pathfinding worker returned a malformed path");
            }
            const pathNodeKeys = [];
            const pathWaypoints = [];
            for (const pathIndex of message.pathNodeIndices) {
                if (!callbacks.isValidPathfindingNodeIndex(pathIndex)) {
                    throw new Error(`Wizard of Flatland pathfinding worker returned unknown node index ${pathIndex}`);
                }
                appendAgentPathWaypoint(pathNodeKeys, pathWaypoints, pathIndex);
            }
            if (agent.pathRequestedStartKey !== agent.pathRequestedRawStartKey) {
                const requestedStartIndex = callbacks.getPathfindingNodeIndexForKey(agent.pathRequestedStartKey);
                if (Number.isInteger(requestedStartIndex) && pathNodeKeys[0] !== agent.pathRequestedStartKey) {
                    appendAgentPathWaypoint(pathNodeKeys, pathWaypoints, requestedStartIndex, true);
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
            }
        }

        function appendAgentPathWaypoint(pathNodeKeys, pathWaypoints, pathIndex, prepend = false) {
            if (!Array.isArray(pathNodeKeys) || !Array.isArray(pathWaypoints)) {
                throw new Error("Wizard of Flatland path waypoint append requires path arrays");
            }
            if (!callbacks.isValidPathfindingNodeIndex(pathIndex)) {
                throw new Error(`Wizard of Flatland path waypoint append received invalid node index ${pathIndex}`);
            }
            const waypoint = {
                key: callbacks.getPathfindingNodeKey(pathIndex),
                x: callbacks.getPathfindingNodeX(pathIndex),
                y: callbacks.getPathfindingNodeY(pathIndex)
            };
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
