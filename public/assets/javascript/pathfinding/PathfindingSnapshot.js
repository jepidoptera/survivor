(function initPathfindingSnapshot(globalScope) {
    "use strict";

    function normalizeObstacleKind(obj) {
        if (!obj) return null;
        if (obj.type === "tree") return "tree";
        if (obj.type === "door") return "door";
        if (typeof obj.category === "string" && obj.category.trim().toLowerCase() === "doors") {
            return "door";
        }
        return null;
    }

    function buildObstacleId(obj) {
        if (!obj) return null;
        const kind = normalizeObstacleKind(obj);
        if (!kind) return null;
        if (typeof obj._pathfindingObstacleId === "string" && obj._pathfindingObstacleId.length > 0) {
            return obj._pathfindingObstacleId;
        }
        const runtimeId = obj.id || obj._id || obj.runtimeId || obj._doorRuntimeId || obj.uuid || null;
        if (runtimeId !== null && runtimeId !== undefined && String(runtimeId).length > 0) {
            obj._pathfindingObstacleId = kind + ":" + String(runtimeId);
            return obj._pathfindingObstacleId;
        }
        const x = Number.isFinite(obj.x) ? Number(obj.x).toFixed(3) : "na";
        const y = Number.isFinite(obj.y) ? Number(obj.y).toFixed(3) : "na";
        obj._pathfindingObstacleId = kind + ":" + x + ":" + y;
        return obj._pathfindingObstacleId;
    }

    function buildObstacleState(obj) {
        const kind = normalizeObstacleKind(obj);
        if (!kind) return null;
        if (kind === "door") {
            if (obj.gone) return "gone";
            if (obj.isFallenDoorEffect) return "fallen";
            if (obj.isOpen || obj._doorLockedOpen) return "open";
            return "closed";
        }
        if (kind === "tree") {
            if (obj.gone) return "gone";
            if (obj.falling) return "falling";
            if (!(Number.isFinite(obj.hp) && obj.hp > 0)) return "down";
            return "standing";
        }
        return null;
    }

    function buildObstacleRecord(obj) {
        const kind = normalizeObstacleKind(obj);
        if (!kind) return null;
        return {
            id: buildObstacleId(obj),
            kind,
            hp: Number.isFinite(obj.hp) ? Number(obj.hp) : null,
            size: Number.isFinite(obj.size)
                ? Number(obj.size)
                : Math.max(
                    Number.isFinite(obj.width) ? Number(obj.width) : 1,
                    Number.isFinite(obj.height) ? Number(obj.height) : 1
                ),
            gone: !!obj.gone,
            passableWhenDown: true,
            state: buildObstacleState(obj)
        };
    }

    function collectNodeObstacleIds(node, obstacleRecords, obstacleIdsSeen) {
        const ids = [];
        if (!node || !Array.isArray(node.objects)) return ids;
        for (let i = 0; i < node.objects.length; i++) {
            const obj = node.objects[i];
            const obstacle = buildObstacleRecord(obj);
            if (!obstacle) continue;
            if (!obstacleIdsSeen.has(obstacle.id)) {
                obstacleIdsSeen.add(obstacle.id);
                obstacleRecords.push(obstacle);
            }
            ids.push(obstacle.id);
        }
        return ids;
    }

    function collectDirectionalObstacleIds(node, directionIndex, obstacleRecords, obstacleIdsSeen) {
        const ids = [];
        if (!node || !node.blockedNeighbors || !(node.blockedNeighbors.get(directionIndex) instanceof Set)) {
            return ids;
        }
        node.blockedNeighbors.get(directionIndex).forEach((obj) => {
            const obstacle = buildObstacleRecord(obj);
            if (!obstacle) return;
            if (!obstacleIdsSeen.has(obstacle.id)) {
                obstacleIdsSeen.add(obstacle.id);
                obstacleRecords.push(obstacle);
            }
            ids.push(obstacle.id);
        });
        return ids;
    }

    // Stable key for a floor node: uses the composite id when present,
    // otherwise falls back to the standard traversalLayer key.
    function floorNodeKey(node, map) {
        if (node && typeof node.id === "string" && node.id.length > 0 && typeof node.fragmentId === "string") {
            return node.id;
        }
        return typeof map.getNodeKey === "function"
            ? map.getNodeKey(node)
            : [node.xindex, node.yindex, node.traversalLayer || 0].join(",");
    }

    function serializeGridNode(node, key, nodes, edges, tileObstacleIdsByNodeKey, obstacleRecords, obstacleIdsSeen, map) {
        nodes.push({
            key,
            xindex: Number(node.xindex),
            yindex: Number(node.yindex),
            traversalLayer: Number.isFinite(node.traversalLayer) ? Number(node.traversalLayer) : 0,
            x: Number(node.x),
            y: Number(node.y),
            blocked: !!node.blocked,
            clearance: Number.isFinite(node.clearance) ? Number(node.clearance) : null,
            surfaceId: (typeof node.surfaceId === "string" && node.surfaceId.length > 0) ? node.surfaceId : null,
            fragmentId: (typeof node.fragmentId === "string" && node.fragmentId.length > 0) ? node.fragmentId : null
        });

        const tileIds = collectNodeObstacleIds(node, obstacleRecords, obstacleIdsSeen);
        if (tileIds.length > 0) {
            tileObstacleIdsByNodeKey[key] = tileIds;
        }

        // Planar neighbor edges
        if (Array.isArray(node.neighbors)) {
            for (let directionIndex = 0; directionIndex < node.neighbors.length; directionIndex++) {
                const neighborNode = node.neighbors[directionIndex];
                if (!neighborNode) continue;
                const toKey = floorNodeKey(neighborNode, map);
                const edgeId = key + "->" + toKey + ":" + directionIndex;
                edges.push({
                    id: edgeId,
                    fromKey: key,
                    toKey,
                    directionIndex,
                    type: "planar",
                    baseCost: 1,
                    directionalObstacleIds: collectDirectionalObstacleIds(
                        node,
                        directionIndex,
                        obstacleRecords,
                        obstacleIdsSeen
                    )
                });
            }
        }

        // Portal edges (floor transitions and door traversal portals)
        if (Array.isArray(node.portalEdges)) {
            for (let pi = 0; pi < node.portalEdges.length; pi++) {
                const portalEdge = node.portalEdges[pi];
                if (!portalEdge || !portalEdge.toNode) continue;
                const toKey = floorNodeKey(portalEdge.toNode, map);
                const transitionId = (portalEdge.metadata && typeof portalEdge.metadata.transitionId === "string")
                    ? portalEdge.metadata.transitionId
                    : "";
                const edgeId = key + "->portal:" + toKey + (transitionId ? ":" + transitionId : "");
                edges.push({
                    id: edgeId,
                    fromKey: key,
                    toKey,
                    directionIndex: null,
                    type: (typeof portalEdge.type === "string" && portalEdge.type) ? portalEdge.type : "portal",
                    baseCost: Number.isFinite(portalEdge.movementCost) ? Number(portalEdge.movementCost) : 1,
                    directionalObstacleIds: [],
                    zProfile: (typeof portalEdge.zProfile === "string") ? portalEdge.zProfile : "linear",
                    metadata: (portalEdge.metadata && typeof portalEdge.metadata === "object")
                        ? { ...portalEdge.metadata }
                        : {}
                });
            }
        }
    }

    function buildMapSnapshot(map) {
        if (!map || !Array.isArray(map.nodes)) return null;
        const nodes = [];
        const edges = [];
        const tileObstacleIdsByNodeKey = {};
        const obstacleRecords = [];
        const obstacleIdsSeen = new Set();

        // Grid nodes (the flat 2D map array)
        for (let x = 0; x < map.nodes.length; x++) {
            const column = map.nodes[x];
            if (!Array.isArray(column)) continue;
            for (let y = 0; y < column.length; y++) {
                const node = column[y];
                if (!node) continue;
                const key = typeof map.getNodeKey === "function"
                    ? map.getNodeKey(node)
                    : [node.xindex, node.yindex, node.traversalLayer || 0].join(",");
                serializeGridNode(node, key, nodes, edges, tileObstacleIdsByNodeKey, obstacleRecords, obstacleIdsSeen, map);
            }
        }

        // Floor nodes — materialized by rebuildFloorRuntimeFromSectionState.
        // These live in map.floorNodesById (fragmentId → floorNode[]) and use
        // composite keys (xindex,yindex,surfaceId,fragmentId) to be unique
        // even when they overlap grid-node coordinates.
        if (map.floorNodesById instanceof Map) {
            for (const floorNodes of map.floorNodesById.values()) {
                if (!Array.isArray(floorNodes)) continue;
                for (let fi = 0; fi < floorNodes.length; fi++) {
                    const floorNode = floorNodes[fi];
                    if (!floorNode) continue;
                    const key = floorNodeKey(floorNode, map);
                    serializeGridNode(floorNode, key, nodes, edges, tileObstacleIdsByNodeKey, obstacleRecords, obstacleIdsSeen, map);
                }
            }
        }

        return {
            version: Number.isFinite(map.pathfindingSnapshotVersion)
                ? Number(map.pathfindingSnapshotVersion)
                : 0,
            width: Number(map.width) || 0,
            height: Number(map.height) || 0,
            wrapX: map.wrapX !== false,
            wrapY: map.wrapY !== false,
            nodes,
            edges,
            tileObstacleIdsByNodeKey,
            cornerObstacleIdsByEdgeId: {},
            obstacles: obstacleRecords
        };
    }

    function buildActorProfile(actor) {
        if (!actor) return null;
        return {
            actorId: actor.id || actor._id || actor.runtimeId || null,
            kind: actor.type || actor.constructor && actor.constructor.name || "actor",
            size: Number.isFinite(actor.size) ? Number(actor.size) : 1,
            damage: Number.isFinite(actor.damage) ? Number(actor.damage) : 0,
            clearance: Number.isFinite(actor.pathfindingClearance) ? Number(actor.pathfindingClearance) : 0,
            canBreakDoors: true,
            canBreakTreesLargerThanSelf: false
        };
    }

    globalScope.PathfindingSnapshot = {
        buildMapSnapshot,
        buildActorProfile,
        buildObstacleRecord,
        buildObstacleId,
        buildObstacleState,
        normalizeObstacleKind
    };
})(typeof window !== "undefined" ? window : globalThis);
