(function (globalScope) {
    "use strict";

    function sectionOwnsPrototypeNode(node, assetKey) {
        if (!node) return false;
        if (typeof node._prototypeSectionKey !== "string" || node._prototypeSectionKey.length === 0) {
            node._prototypeSectionKey = assetKey;
            return true;
        }
        return node._prototypeSectionKey === assetKey;
    }

    function refreshSparseNodesForSectionAsset(map, prototypeState, asset, deps) {
        const {
            getPrototypeGroundTextureCount,
            normalizePrototypeGroundTiles,
            pickPrototypeGroundTextureId
        } = deps;
        if (!map || !prototypeState || !asset) return 0;
        const sectionNodes = prototypeState.nodesBySectionKey instanceof Map
            ? (prototypeState.nodesBySectionKey.get(asset.key) || [])
            : [];
        if (sectionNodes.length === 0) return 0;
        const textureCount = getPrototypeGroundTextureCount(map);
        const groundTiles = (asset.groundTiles && typeof asset.groundTiles === "object")
            ? asset.groundTiles
            : normalizePrototypeGroundTiles(null, asset.tileCoordKeys, textureCount);
        asset.groundTiles = groundTiles;
        let updated = 0;
        for (let i = 0; i < sectionNodes.length; i++) {
            const node = sectionNodes[i];
            if (!node) continue;
            const coordKey = `${node.xindex},${node.yindex}`;
            if (sectionOwnsPrototypeNode(node, asset.key)) {
                node.groundTextureId = Number.isFinite(groundTiles[coordKey])
                    ? Number(groundTiles[coordKey])
                    : pickPrototypeGroundTextureId(node.xindex, node.yindex, textureCount);
                if (asset.clearanceByTile && Object.prototype.hasOwnProperty.call(asset.clearanceByTile, coordKey)) {
                    const rawClearance = asset.clearanceByTile[coordKey];
                    node.clearance = Number.isFinite(rawClearance) ? Number(rawClearance) : Infinity;
                } else {
                    node.clearance = Infinity;
                }
            }
            updated += 1;
        }
        return updated;
    }

    function addSparseNodesForSection(map, prototypeState, asset, deps) {
        const {
            globalScope: runtimeGlobalScope,
            getNeighborOffsetsForColumn,
            getPrototypeGroundTextureCount,
            normalizePrototypeGroundTiles,
            pickPrototypeGroundTextureId
        } = deps;
        const NodeCtor = runtimeGlobalScope.MapNode
            || (map && map.nodes && map.nodes[0] && map.nodes[0][0] && map.nodes[0][0].constructor);
        if (typeof NodeCtor !== "function" || !asset) return [];
        if (!(prototypeState.nodesBySectionKey instanceof Map)) prototypeState.nodesBySectionKey = new Map();
        if (!(prototypeState.allNodesByCoordKey instanceof Map)) prototypeState.allNodesByCoordKey = new Map();
        if (!Array.isArray(prototypeState.allNodes)) prototypeState.allNodes = [];
        if (prototypeState.nodesBySectionKey.has(asset.key)) {
            return prototypeState.nodesBySectionKey.get(asset.key) || [];
        }

        const sectionNodes = [];
        const tileCoordKeys = Array.isArray(asset.tileCoordKeys) ? asset.tileCoordKeys : [];
        const textureCount = getPrototypeGroundTextureCount(map);
        const groundTiles = (asset.groundTiles && typeof asset.groundTiles === "object")
            ? asset.groundTiles
            : normalizePrototypeGroundTiles(null, tileCoordKeys, textureCount);
        asset.groundTiles = groundTiles;

        for (let i = 0; i < tileCoordKeys.length; i++) {
            const coordKey = tileCoordKeys[i];
            if (typeof coordKey !== "string" || coordKey.length === 0) continue;
            const [xRaw, yRaw] = coordKey.split(",");
            const offset = {
                x: Number(xRaw),
                y: Number(yRaw)
            };
            let node = prototypeState.allNodesByCoordKey.get(coordKey);
            if (!node) {
                node = new NodeCtor(offset.x, offset.y, 1, 1);
                node.xindex = offset.x;
                node.yindex = offset.y;
                node.x = offset.x * 0.866;
                node.y = offset.y + (offset.x % 2 === 0 ? 0.5 : 0);
                node.neighbors = new Array(12).fill(null);
                node.neighborOffsets = getNeighborOffsetsForColumn(offset.x);
                node.blockedNeighbors = new Map();
                node.objects = [];
                node.visibilityObjects = [];
                node.blockedByObjects = 0;
                node.blocked = false;
                node.clearance = Infinity;
                node._prototypeVoid = false;
                prototypeState.allNodes.push(node);
                prototypeState.allNodesByCoordKey.set(coordKey, node);
            }
            const sectionOwnsNode = sectionOwnsPrototypeNode(node, asset.key);
            if (sectionOwnsNode) {
                node.groundTextureId = Number.isFinite(groundTiles[coordKey])
                    ? Number(groundTiles[coordKey])
                    : pickPrototypeGroundTextureId(offset.x, offset.y, textureCount);
            }
            node._prototypeSectionActive = false;
            if (sectionOwnsNode && asset.clearanceByTile && Object.prototype.hasOwnProperty.call(asset.clearanceByTile, coordKey)) {
                const rawClearance = asset.clearanceByTile[coordKey];
                node.clearance = Number.isFinite(rawClearance) ? Number(rawClearance) : Infinity;
            }
            sectionNodes.push(node);
        }

        prototypeState.nodesBySectionKey.set(asset.key, sectionNodes);

        for (let i = 0; i < sectionNodes.length; i++) {
            const node = sectionNodes[i];
            const offsets = getNeighborOffsetsForColumn(node.xindex);
            node.neighborOffsets = offsets;
            for (let d = 0; d < offsets.length; d++) {
                const offset = offsets[d];
                const neighborKey = `${node.xindex + offset.x},${node.yindex + offset.y}`;
                const neighbor = prototypeState.allNodesByCoordKey.get(neighborKey) || null;
                node.neighbors[d] = neighbor;
                if (!neighbor || !Array.isArray(neighbor.neighborOffsets)) continue;
                const reverseOffsets = getNeighborOffsetsForColumn(neighbor.xindex);
                neighbor.neighborOffsets = reverseOffsets;
                for (let rd = 0; rd < reverseOffsets.length; rd++) {
                    const reverseOffset = reverseOffsets[rd];
                    if ((neighbor.xindex + reverseOffset.x) === node.xindex && (neighbor.yindex + reverseOffset.y) === node.yindex) {
                        neighbor.neighbors[rd] = node;
                    }
                }
            }
        }

        return sectionNodes;
    }

    function ensurePrototypeSectionExists(map, prototypeState, sectionCoord, deps) {
        const { makeSectionKey, createPrototypeSectionAsset, addSparseNodesForSection: addSparseNodesForSectionFn } = deps;
        if (!prototypeState || !sectionCoord) return null;
        const key = makeSectionKey(sectionCoord);
        const existingSection = prototypeState.sectionsByKey instanceof Map
            ? prototypeState.sectionsByKey.get(key)
            : null;
        if (existingSection) {
            if (prototypeState.useSparseNodes === true) {
                const existingAsset = prototypeState.sectionAssetsByKey.get(key);
                if (
                    existingAsset &&
                    existingAsset._prototypeSectionHydrated === true &&
                    !prototypeState.nodesBySectionKey.has(key)
                ) {
                    addSparseNodesForSectionFn(map, prototypeState, existingAsset);
                }
            }
            return existingSection;
        }

        const asset = createPrototypeSectionAsset(prototypeState, sectionCoord, map);
        if (!asset) return null;
        if (prototypeState.useSparseNodes === true && asset._prototypeSectionHydrated === true) {
            addSparseNodesForSectionFn(map, prototypeState, asset);
        }
        return prototypeState.sectionsByKey.get(key) || null;
    }

    function buildSparsePrototypeNodes(map, prototypeState, sectionKeys = null, deps) {
        const {
            globalScope: runtimeGlobalScope,
            getNeighborOffsetsForColumn,
            getPrototypeGroundTextureCount,
            pickPrototypeGroundTextureId
        } = deps;
        const NodeCtor = runtimeGlobalScope.MapNode
            || (map && map.nodes && map.nodes[0] && map.nodes[0][0] && map.nodes[0][0].constructor);
        if (!(prototypeState.nodesBySectionKey instanceof Map)) prototypeState.nodesBySectionKey = new Map();
        if (!Array.isArray(prototypeState.allNodes)) prototypeState.allNodes = [];
        if (!(prototypeState.allNodesByCoordKey instanceof Map)) prototypeState.allNodesByCoordKey = new Map();
        if (typeof NodeCtor !== "function") return;

        const keyFilter = sectionKeys instanceof Set
            ? sectionKeys
            : (Array.isArray(sectionKeys) ? new Set(sectionKeys) : null);
        const sourceAssets = Array.isArray(prototypeState.orderedSectionAssets)
            ? prototypeState.orderedSectionAssets.filter((asset) => {
                if (!asset) return false;
                if (keyFilter && !keyFilter.has(asset.key)) return false;
                return true;
            })
            : [];
        const textureCount = getPrototypeGroundTextureCount(map);
        for (let i = 0; i < sourceAssets.length; i++) {
            const asset = sourceAssets[i];
            if (!asset) continue;
            if (prototypeState.nodesBySectionKey.has(asset.key)) continue;
            const sectionNodes = [];
            const tileCoordKeys = Array.isArray(asset.tileCoordKeys) ? asset.tileCoordKeys : [];
            for (let t = 0; t < tileCoordKeys.length; t++) {
                const coordKey = tileCoordKeys[t];
                if (typeof coordKey !== "string" || coordKey.length === 0) continue;
                const [xRaw, yRaw] = coordKey.split(",");
                const offset = {
                    x: Number(xRaw),
                    y: Number(yRaw)
                };
                let node = prototypeState.allNodesByCoordKey.get(coordKey);
                if (!node) {
                    node = new NodeCtor(offset.x, offset.y, 1, 1);
                    node.xindex = offset.x;
                    node.yindex = offset.y;
                    node.x = offset.x * 0.866;
                    node.y = offset.y + (offset.x % 2 === 0 ? 0.5 : 0);
                    node.neighbors = new Array(12).fill(null);
                    node.neighborOffsets = getNeighborOffsetsForColumn(offset.x);
                    node.blockedNeighbors = new Map();
                    node.objects = [];
                    node.visibilityObjects = [];
                    node.blockedByObjects = 0;
                    node.blocked = false;
                    node.clearance = Infinity;
                    const groundTiles = (asset.groundTiles && typeof asset.groundTiles === "object") ? asset.groundTiles : null;
                    const fallbackTextureId = pickPrototypeGroundTextureId(offset.x, offset.y, textureCount);
                    node.groundTextureId = groundTiles && Number.isFinite(groundTiles[coordKey])
                        ? Number(groundTiles[coordKey])
                        : fallbackTextureId;
                    node._prototypeVoid = false;
                    node._prototypeSectionKey = asset.key;
                    node._prototypeSectionActive = false;
                    if (asset.clearanceByTile && Object.prototype.hasOwnProperty.call(asset.clearanceByTile, coordKey)) {
                        const rawClearance = asset.clearanceByTile[coordKey];
                        node.clearance = Number.isFinite(rawClearance) ? Number(rawClearance) : Infinity;
                    }
                    prototypeState.allNodes.push(node);
                    prototypeState.allNodesByCoordKey.set(coordKey, node);
                }
                sectionOwnsPrototypeNode(node, asset.key);
                sectionNodes.push(node);
            }
            prototypeState.nodesBySectionKey.set(asset.key, sectionNodes);
        }

        for (let i = 0; i < prototypeState.allNodes.length; i++) {
            const node = prototypeState.allNodes[i];
            const offsets = getNeighborOffsetsForColumn(node.xindex);
            node.neighborOffsets = offsets;
            for (let d = 0; d < offsets.length; d++) {
                const offset = offsets[d];
                const neighborKey = `${node.xindex + offset.x},${node.yindex + offset.y}`;
                node.neighbors[d] = prototypeState.allNodesByCoordKey.get(neighborKey) || null;
            }
        }
    }

    function assignNodesToSections(map, prototypeState, deps) {
        const { getBubbleKeysForCenter, evenQOffsetToAxial, axialDistance, buildSparsePrototypeNodes } = deps;
        if (prototypeState.useSparseNodes === true) {
            const initialSectionKeys = getBubbleKeysForCenter(prototypeState, prototypeState.activeCenterKey);
            buildSparsePrototypeNodes(map, prototypeState, initialSectionKeys, deps);
            return;
        }
        prototypeState.nodesBySectionKey = new Map();
        for (let x = 0; x < map.width; x++) {
            for (let y = 0; y < map.height; y++) {
                const node = map.nodes[x] && map.nodes[x][y];
                if (!node) continue;
                const axial = evenQOffsetToAxial(x, y);
                let matchedSection = null;
                for (let i = 0; i < prototypeState.orderedSections.length; i++) {
                    const section = prototypeState.orderedSections[i];
                    if (axialDistance(axial, section.centerAxial) <= (prototypeState.radius - 1)) {
                        matchedSection = section;
                        break;
                    }
                }
                if (!matchedSection) continue;
                node.blocked = false;
                node.clearance = Infinity;
                node._prototypeVoid = false;
                node._prototypeSectionKey = matchedSection.key;
                const asset = prototypeState.sectionAssetsByKey instanceof Map
                    ? prototypeState.sectionAssetsByKey.get(matchedSection.key)
                    : null;
                const coordKey = `${node.xindex},${node.yindex}`;
                if (asset && asset.clearanceByTile && Object.prototype.hasOwnProperty.call(asset.clearanceByTile, coordKey)) {
                    const rawClearance = asset.clearanceByTile[coordKey];
                    node.clearance = Number.isFinite(rawClearance) ? Number(rawClearance) : Infinity;
                }
                if (!prototypeState.nodesBySectionKey.has(matchedSection.key)) {
                    prototypeState.nodesBySectionKey.set(matchedSection.key, []);
                }
                prototypeState.nodesBySectionKey.get(matchedSection.key).push(node);
            }
        }
    }

    function buildPrototypeSeamSegmentEntriesForSections(state, targetSectionKeys = null) {
        const nodesBySectionKey = (state && state.nodesBySectionKey instanceof Map) ? state.nodesBySectionKey : null;
        const targetKeys = targetSectionKeys instanceof Set ? targetSectionKeys : null;
        const segmentsByPairKey = new Map();
        const adjacentDirections = [1, 3, 5, 7, 9, 11];
        if (!nodesBySectionKey) return segmentsByPairKey;
        const sectionKeys = targetKeys ? Array.from(targetKeys) : Array.from(nodesBySectionKey.keys());

        for (let s = 0; s < sectionKeys.length; s++) {
            const sectionKey = sectionKeys[s];
            const sectionNodes = nodesBySectionKey.get(sectionKey) || [];
            for (let i = 0; i < sectionNodes.length; i++) {
                const node = sectionNodes[i];
                if (!node || node._prototypeSectionActive !== true || !Array.isArray(node.neighbors)) continue;
                for (let d = 0; d < adjacentDirections.length; d++) {
                    const directionIndex = adjacentDirections[d];
                    const neighbor = node.neighbors[directionIndex];
                    if (!neighbor || neighbor._prototypeSectionActive !== true) continue;
                    if (!neighbor._prototypeSectionKey || neighbor._prototypeSectionKey === node._prototypeSectionKey) continue;

                    const keyA = `${node.xindex},${node.yindex}`;
                    const keyB = `${neighbor.xindex},${neighbor.yindex}`;
                    const pairKey = keyA < keyB ? `${keyA}|${keyB}` : `${keyB}|${keyA}`;
                    if (segmentsByPairKey.has(pairKey)) continue;

                    const dx = Number(neighbor.x) - Number(node.x);
                    const dy = Number(neighbor.y) - Number(node.y);
                    const length = Math.hypot(dx, dy);
                    if (!(length > 1e-6)) continue;

                    const mx = (Number(node.x) + Number(neighbor.x)) * 0.5;
                    const my = (Number(node.y) + Number(neighbor.y)) * 0.5;
                    const nx = -dy / length;
                    const ny = dx / length;
                    const halfSegmentLength = 0.32;

                    segmentsByPairKey.set(pairKey, {
                        x1: mx - nx * halfSegmentLength,
                        y1: my - ny * halfSegmentLength,
                        x2: mx + nx * halfSegmentLength,
                        y2: my + ny * halfSegmentLength,
                        _sectionKeyA: node._prototypeSectionKey,
                        _sectionKeyB: neighbor._prototypeSectionKey
                    });
                }
            }
        }
        return segmentsByPairKey;
    }

    function buildPrototypeSeamSegments(state) {
        const segmentsByPairKey = buildPrototypeSeamSegmentEntriesForSections(state);
        return Array.from(segmentsByPairKey.values()).map((segment) => ({
            x1: segment.x1,
            y1: segment.y1,
            x2: segment.x2,
            y2: segment.y2
        }));
    }

    function updatePrototypeSeamSegmentsForSections(state, changedSectionKeys = null) {
        if (!state) return [];
        if (!(state.seamSegmentsByPairKey instanceof Map)) {
            state.seamSegmentsByPairKey = buildPrototypeSeamSegmentEntriesForSections(state);
        }
        const changedKeys = changedSectionKeys instanceof Set ? changedSectionKeys : new Set();
        if (changedKeys.size > 0) {
            for (const [pairKey, segment] of state.seamSegmentsByPairKey.entries()) {
                if (!segment) continue;
                if (changedKeys.has(segment._sectionKeyA) || changedKeys.has(segment._sectionKeyB)) {
                    state.seamSegmentsByPairKey.delete(pairKey);
                }
            }
            const recomputed = buildPrototypeSeamSegmentEntriesForSections(state, changedKeys);
            for (const [pairKey, segment] of recomputed.entries()) {
                state.seamSegmentsByPairKey.set(pairKey, segment);
            }
        }
        state.seamSegments = Array.from(state.seamSegmentsByPairKey.values()).map((segment) => ({
            x1: segment.x1,
            y1: segment.y1,
            x2: segment.x2,
            y2: segment.y2
        }));
        return state.seamSegments;
    }

    globalScope.__sectionWorldSectionRuntime = {
        refreshSparseNodesForSectionAsset,
        addSparseNodesForSection,
        ensurePrototypeSectionExists,
        buildSparsePrototypeNodes,
        assignNodesToSections,
        buildPrototypeSeamSegmentEntriesForSections,
        buildPrototypeSeamSegments,
        updatePrototypeSeamSegmentsForSections
    };
    globalScope.__twoSectionPrototypeSectionRuntime = globalScope.__sectionWorldSectionRuntime;
})(typeof globalThis !== "undefined" ? globalThis : window);

if (typeof module !== "undefined" && module.exports) {
    module.exports = globalThis.__sectionWorldSectionRuntime;
}
