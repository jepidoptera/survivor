(function (globalScope) {
    "use strict";

    function createSectionWorldBlockingHelpers(map, deps) {
        const { prototypeHasActiveDirectionalBlockers } = deps;

        function markPrototypeBlockedEdgesDirty(asset) {
            if (asset && typeof asset === "object") {
                asset._prototypeBlockedEdgesDirty = true;
            }
        }

        function markPrototypeClearanceDirty(asset) {
            if (asset && typeof asset === "object") {
                asset._prototypeClearanceDirty = true;
            }
        }

        function computePrototypeBlockedEdgesForAsset(mapRef, asset) {
            if (!mapRef || !asset || !globalScope.WallSectionUnit || typeof globalScope.WallSectionUnit.loadJson !== "function") {
                return [];
            }
            const wallRecords = Array.isArray(asset.walls) ? asset.walls : [];
            const blockedEdges = [];
            const seenEdgeKeys = new Set();
            const previousSuppress = !!mapRef._suppressClearanceUpdates;
            mapRef._suppressClearanceUpdates = true;
            try {
                for (let i = 0; i < wallRecords.length; i++) {
                    const record = wallRecords[i];
                    const recordId = Number(record && record.id);
                    if (!record || !Number.isInteger(recordId)) continue;
                    const runtimeWall = globalScope.WallSectionUnit.loadJson(record, mapRef, { deferSetup: true });
                    if (!runtimeWall) continue;
                    try {
                        if (typeof runtimeWall._applyDirectionalBlocking === "function") {
                            runtimeWall._applyDirectionalBlocking();
                        }
                        const blockedConnections = runtimeWall._directionalBlockingDebug && Array.isArray(runtimeWall._directionalBlockingDebug.blockedConnections)
                            ? runtimeWall._directionalBlockingDebug.blockedConnections
                            : [];
                        for (let j = 0; j < blockedConnections.length; j++) {
                            const connection = blockedConnections[j];
                            const nodeA = connection && connection.a;
                            const nodeB = connection && connection.b;
                            if (!nodeA || !nodeB) continue;
                            const aKey = `${Number(nodeA.xindex)},${Number(nodeA.yindex)}`;
                            const bKey = `${Number(nodeB.xindex)},${Number(nodeB.yindex)}`;
                            const edgeKey = aKey <= bKey
                                ? `${recordId}|${aKey}|${bKey}`
                                : `${recordId}|${bKey}|${aKey}`;
                            if (seenEdgeKeys.has(edgeKey)) continue;
                            seenEdgeKeys.add(edgeKey);
                            blockedEdges.push({
                                recordId,
                                a: { xindex: Number(nodeA.xindex), yindex: Number(nodeA.yindex) },
                                b: { xindex: Number(nodeB.xindex), yindex: Number(nodeB.yindex) }
                            });
                        }
                    } finally {
                        if (typeof runtimeWall.removeFromMapNodes === "function") {
                            runtimeWall.removeFromMapNodes();
                        }
                        if (globalScope.WallSectionUnit._allSections instanceof Map) {
                            globalScope.WallSectionUnit._allSections.delete(runtimeWall.id);
                        }
                        runtimeWall.gone = true;
                        if (typeof runtimeWall.destroy === "function") {
                            runtimeWall.destroy();
                        }
                    }
                }
            } finally {
                mapRef._suppressClearanceUpdates = previousSuppress;
            }
            asset.blockedEdges = blockedEdges;
            asset._prototypeBlockedEdgesDirty = false;
            return blockedEdges;
        }

        function ensurePrototypeBlockedEdges(mapRef, sectionKeys = null) {
            const state = mapRef && mapRef._prototypeSectionState;
            if (!state || !Array.isArray(state.orderedSectionAssets)) return 0;
            const targetKeys = sectionKeys instanceof Set ? sectionKeys : null;
            let computedCount = 0;
            for (let i = 0; i < state.orderedSectionAssets.length; i++) {
                const asset = state.orderedSectionAssets[i];
                if (!asset) continue;
                if (targetKeys && !targetKeys.has(asset.key)) continue;
                if (asset._prototypeBlockedEdgesDirty !== true && Array.isArray(asset.blockedEdges)) continue;
                computePrototypeBlockedEdgesForAsset(mapRef, asset);
                computedCount += 1;
            }
            return computedCount;
        }

        function applyPrototypeSectionClearanceToNodes(mapRef, sectionKeys = null) {
            const state = mapRef && mapRef._prototypeSectionState;
            if (!state || !(state.sectionAssetsByKey instanceof Map) || !(state.nodesBySectionKey instanceof Map)) return 0;
            const targetKeys = sectionKeys instanceof Set ? sectionKeys : null;
            let appliedCount = 0;
            for (const [sectionKey, asset] of state.sectionAssetsByKey.entries()) {
                if (targetKeys && !targetKeys.has(sectionKey)) continue;
                const nodes = state.nodesBySectionKey.get(sectionKey) || [];
                const clearanceByTile = (asset && asset.clearanceByTile && typeof asset.clearanceByTile === "object")
                    ? asset.clearanceByTile
                    : null;
                for (let i = 0; i < nodes.length; i++) {
                    const node = nodes[i];
                    if (!node) continue;
                    const coordKey = `${node.xindex},${node.yindex}`;
                    const rawClearance = clearanceByTile ? clearanceByTile[coordKey] : null;
                    node.clearance = Number.isFinite(rawClearance) ? Number(rawClearance) : Infinity;
                    appliedCount += 1;
                }
            }
            return appliedCount;
        }

        function applyPrototypeSectionClearanceChunk(mapRef, sectionKey, startIndex = 0, maxNodes = Infinity) {
            const state = mapRef && mapRef._prototypeSectionState;
            if (!state || !(state.sectionAssetsByKey instanceof Map) || !(state.nodesBySectionKey instanceof Map)) {
                return { appliedCount: 0, nextIndex: startIndex, done: true };
            }
            const asset = state.sectionAssetsByKey.get(sectionKey) || null;
            const nodes = state.nodesBySectionKey.get(sectionKey) || [];
            if (!asset || nodes.length === 0) {
                return { appliedCount: 0, nextIndex: startIndex, done: true };
            }
            const clearanceByTile = (asset.clearanceByTile && typeof asset.clearanceByTile === "object")
                ? asset.clearanceByTile
                : null;
            const safeStart = Math.max(0, Number(startIndex) || 0);
            const limit = Math.max(1, Number(maxNodes) || 1);
            const end = Math.min(nodes.length, safeStart + limit);
            let appliedCount = 0;
            for (let i = safeStart; i < end; i++) {
                const node = nodes[i];
                if (!node) continue;
                const coordKey = `${node.xindex},${node.yindex}`;
                const rawClearance = clearanceByTile ? clearanceByTile[coordKey] : null;
                node.clearance = Number.isFinite(rawClearance) ? Number(rawClearance) : Infinity;
                appliedCount += 1;
            }
            return {
                appliedCount,
                nextIndex: end,
                done: end >= nodes.length
            };
        }

        function computePrototypeSparseClearance(mapRef) {
            const state = mapRef && mapRef._prototypeSectionState;
            if (!state || !Array.isArray(state.allNodes)) return 0;
            const adjDirs = [1, 3, 5, 7, 9, 11];
            const queue = [];
            const nodes = state.allNodes;

            for (let i = 0; i < nodes.length; i++) {
                const node = nodes[i];
                if (!node) continue;
                if (typeof node.isBlocked === "function" ? node.isBlocked() : (node.blocked || node.blockedByObjects > 0)) {
                    node.clearance = 0;
                    queue.push([node, 0]);
                } else {
                    node.clearance = Infinity;
                }
            }

            for (let i = 0; i < nodes.length; i++) {
                const node = nodes[i];
                if (!node || node.clearance <= 0) continue;
                if (!(node.blockedNeighbors instanceof Map) || node.blockedNeighbors.size === 0) continue;

                let hasAdjacentBlocker = false;
                for (const dir of node.blockedNeighbors.keys()) {
                    const blockers = node.blockedNeighbors.get(dir);
                    if (dir % 2 === 1 && prototypeHasActiveDirectionalBlockers(blockers)) {
                        hasAdjacentBlocker = true;
                        break;
                    }
                }
                if (!hasAdjacentBlocker) {
                    let hasAnyDirectionalBlocker = false;
                    for (const blockers of node.blockedNeighbors.values()) {
                        if (prototypeHasActiveDirectionalBlockers(blockers)) {
                            hasAnyDirectionalBlocker = true;
                            break;
                        }
                    }
                    if (!hasAnyDirectionalBlocker) continue;
                }
                const seed = hasAdjacentBlocker ? 0 : 1;
                if (seed < node.clearance) {
                    node.clearance = seed;
                    queue.push([node, seed]);
                }
            }

            let head = 0;
            while (head < queue.length) {
                const [current, dist] = queue[head++];
                const nextDist = dist + 1;
                for (let i = 0; i < adjDirs.length; i++) {
                    const neighbor = current && current.neighbors ? current.neighbors[adjDirs[i]] : null;
                    if (!neighbor) continue;
                    if (nextDist < neighbor.clearance) {
                        neighbor.clearance = nextDist;
                        queue.push([neighbor, nextDist]);
                    }
                }
            }

            return nodes.length;
        }

        function persistPrototypeSparseClearance(mapRef, sectionKeys = null) {
            const state = mapRef && mapRef._prototypeSectionState;
            if (!state || !(state.sectionAssetsByKey instanceof Map) || !(state.nodesBySectionKey instanceof Map)) return 0;
            const targetKeys = sectionKeys instanceof Set ? sectionKeys : null;
            let persistedCount = 0;
            for (const [sectionKey, asset] of state.sectionAssetsByKey.entries()) {
                if (targetKeys && !targetKeys.has(sectionKey)) continue;
                const nodes = state.nodesBySectionKey.get(sectionKey) || [];
                const clearanceByTile = {};
                for (let i = 0; i < nodes.length; i++) {
                    const node = nodes[i];
                    if (!node) continue;
                    const coordKey = `${node.xindex},${node.yindex}`;
                    clearanceByTile[coordKey] = Number.isFinite(node.clearance) ? Number(node.clearance) : null;
                }
                asset.clearanceByTile = clearanceByTile;
                asset._prototypeClearanceDirty = false;
                persistedCount += 1;
            }
            return persistedCount;
        }

        function rebuildPrototypeSectionClearance(mapRef, sectionKeys = null) {
            const state = mapRef && mapRef._prototypeSectionState;
            if (!state || !Array.isArray(state.orderedSectionAssets)) return 0;
            const targetKeys = sectionKeys instanceof Set ? sectionKeys : null;
            let needsCompute = false;
            for (let i = 0; i < state.orderedSectionAssets.length; i++) {
                const asset = state.orderedSectionAssets[i];
                if (!asset) continue;
                if (targetKeys && !targetKeys.has(asset.key)) continue;
                if (asset._prototypeClearanceDirty === true) {
                    needsCompute = true;
                    break;
                }
            }
            if (needsCompute) {
                computePrototypeSparseClearance(mapRef);
                persistPrototypeSparseClearance(mapRef);
            } else {
                applyPrototypeSectionClearanceToNodes(mapRef, targetKeys);
            }
            return needsCompute ? 1 : 0;
        }

        function createPrototypeBlockedEdgeToken(recordId, sectionKey) {
            return {
                type: "wallSection",
                category: "walls",
                blocksTile: true,
                isPassable: false,
                gone: false,
                _prototypeSectionBlockedEdge: true,
                _prototypeSectionKey: sectionKey,
                _prototypeRecordId: recordId
            };
        }

        function ensurePrototypeBlockedEdgeState(mapRef) {
            if (!mapRef || !mapRef._prototypeBlockedEdgeState || !(mapRef._prototypeBlockedEdgeState.activeEntriesBySectionKey instanceof Map)) {
                mapRef._prototypeBlockedEdgeState = {
                    activeEntriesBySectionKey: new Map(),
                    blockerTokensByRecordId: new Map()
                };
            }
            return mapRef._prototypeBlockedEdgeState;
        }

        function getPrototypeBlockedEdgeToken(mapRef, recordId, sectionKey) {
            const blockedEdgeState = ensurePrototypeBlockedEdgeState(mapRef);
            if (!blockedEdgeState.blockerTokensByRecordId.has(recordId)) {
                blockedEdgeState.blockerTokensByRecordId.set(recordId, createPrototypeBlockedEdgeToken(recordId, sectionKey));
            }
            const token = blockedEdgeState.blockerTokensByRecordId.get(recordId);
            if (token) {
                token._prototypeSectionKey = sectionKey;
                token.gone = false;
            }
            return token;
        }

        function removePrototypeBlockedEdgesForSection(mapRef, sectionKey, changedNodesOut = null) {
            const blockedEdgeState = ensurePrototypeBlockedEdgeState(mapRef);
            const activeEntry = blockedEdgeState.activeEntriesBySectionKey.get(sectionKey);
            if (!activeEntry || !Array.isArray(activeEntry.links) || activeEntry.links.length === 0) {
                blockedEdgeState.activeEntriesBySectionKey.delete(sectionKey);
                return 0;
            }
            let removedCount = 0;
            for (let i = 0; i < activeEntry.links.length; i++) {
                const link = activeEntry.links[i];
                const node = link && link.node;
                const direction = Number(link && link.direction);
                const blocker = link && link.blocker;
                if (!node || !Number.isInteger(direction) || !blocker) continue;
                if (!(node.blockedNeighbors instanceof Map) || !node.blockedNeighbors.has(direction)) continue;
                const blockers = node.blockedNeighbors.get(direction);
                if (!(blockers instanceof Set) || !blockers.has(blocker)) continue;
                blockers.delete(blocker);
                if (blockers.size === 0) {
                    node.blockedNeighbors.delete(direction);
                }
                removedCount += 1;
                if (changedNodesOut instanceof Set) {
                    changedNodesOut.add(node);
                }
            }
            blockedEdgeState.activeEntriesBySectionKey.delete(sectionKey);
            return removedCount;
        }

        function applyPrototypeBlockedEdgesForSection(mapRef, sectionKey, changedNodesOut = null) {
            const asset = mapRef && typeof mapRef.getPrototypeSectionAsset === "function"
                ? mapRef.getPrototypeSectionAsset(sectionKey)
                : null;
            if (!asset || !Array.isArray(asset.blockedEdges) || asset.blockedEdges.length === 0) {
                ensurePrototypeBlockedEdgeState(mapRef).activeEntriesBySectionKey.delete(sectionKey);
                return 0;
            }

            const blockedEdgeState = ensurePrototypeBlockedEdgeState(mapRef);
            const links = [];
            let appliedCount = 0;
            for (let i = 0; i < asset.blockedEdges.length; i++) {
                const edge = asset.blockedEdges[i];
                const recordId = Number(edge && edge.recordId);
                if (!Number.isInteger(recordId)) continue;
                const nodeA = edge && edge.a ? mapRef.getNodeByIndex(edge.a.xindex, edge.a.yindex) : null;
                const nodeB = edge && edge.b ? mapRef.getNodeByIndex(edge.b.xindex, edge.b.yindex) : null;
                if (!nodeA || !nodeB || !Array.isArray(nodeA.neighbors) || !Array.isArray(nodeB.neighbors)) continue;
                const dirA = nodeA.neighbors.indexOf(nodeB);
                const dirB = nodeB.neighbors.indexOf(nodeA);
                if (dirA < 0 && dirB < 0) continue;

                const wallState = mapRef && mapRef._prototypeWallState;
                const runtimeWall = (wallState && wallState.activeRuntimeWallsByRecordId instanceof Map)
                    ? wallState.activeRuntimeWallsByRecordId.get(recordId)
                    : null;
                const blocker = (runtimeWall && typeof runtimeWall === "object")
                    ? runtimeWall
                    : getPrototypeBlockedEdgeToken(mapRef, recordId, sectionKey);
                if (dirA >= 0) {
                    if (!(nodeA.blockedNeighbors instanceof Map)) nodeA.blockedNeighbors = new Map();
                    if (!nodeA.blockedNeighbors.has(dirA)) nodeA.blockedNeighbors.set(dirA, new Set());
                    const blockersA = nodeA.blockedNeighbors.get(dirA);
                    if (!blockersA.has(blocker)) {
                        blockersA.add(blocker);
                        links.push({ node: nodeA, direction: dirA, blocker });
                        appliedCount += 1;
                        if (changedNodesOut instanceof Set) changedNodesOut.add(nodeA);
                    }
                }
                if (dirB >= 0) {
                    if (!(nodeB.blockedNeighbors instanceof Map)) nodeB.blockedNeighbors = new Map();
                    if (!nodeB.blockedNeighbors.has(dirB)) nodeB.blockedNeighbors.set(dirB, new Set());
                    const blockersB = nodeB.blockedNeighbors.get(dirB);
                    if (!blockersB.has(blocker)) {
                        blockersB.add(blocker);
                        links.push({ node: nodeB, direction: dirB, blocker });
                        appliedCount += 1;
                        if (changedNodesOut instanceof Set) changedNodesOut.add(nodeB);
                    }
                }
            }
            blockedEdgeState.activeEntriesBySectionKey.set(sectionKey, { links });
            return appliedCount;
        }

        function removePrototypeRuntimeWallVisual(runtimeWall) {
            if (!runtimeWall || runtimeWall.gone) return false;
            runtimeWall.gone = true;
            runtimeWall.vanishing = false;
            if (typeof runtimeWall.removeFromMapNodes === "function") {
                runtimeWall.removeFromMapNodes();
            }
            if (runtimeWall.connections instanceof Map) {
                runtimeWall.connections.clear();
            }
            if (Array.isArray(runtimeWall.attachedObjects)) {
                runtimeWall.attachedObjects.length = 0;
            }
            if (globalScope.WallSectionUnit && globalScope.WallSectionUnit._allSections instanceof Map) {
                globalScope.WallSectionUnit._allSections.delete(runtimeWall.id);
            }
            if (typeof runtimeWall.destroy === "function") {
                runtimeWall.destroy();
            }
            return true;
        }

        return {
            applyPrototypeBlockedEdgesForSection,
            applyPrototypeSectionClearanceChunk,
            applyPrototypeSectionClearanceToNodes,
            ensurePrototypeBlockedEdgeState,
            ensurePrototypeBlockedEdges,
            markPrototypeBlockedEdgesDirty,
            markPrototypeClearanceDirty,
            rebuildPrototypeSectionClearance,
            removePrototypeBlockedEdgesForSection,
            removePrototypeRuntimeWallVisual
        };
    }

    globalScope.__sectionWorldBlocking = {
        createSectionWorldBlockingHelpers,
        createPrototypeBlockingHelpers: createSectionWorldBlockingHelpers
    };
    globalScope.__twoSectionPrototypeBlocking = globalScope.__sectionWorldBlocking;
})(typeof globalThis !== "undefined" ? globalThis : window);

if (typeof module !== "undefined" && module.exports) {
    module.exports = globalThis.__sectionWorldBlocking;
}
