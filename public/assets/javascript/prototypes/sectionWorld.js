(function (globalScope) {
    "use strict";

    function resolveSectionWorldModule(globalKey, requirePath, displayName) {
        let resolvedModule = globalScope[globalKey] || null;
        if (!resolvedModule && typeof module !== "undefined" && module.exports && typeof require === "function") {
            resolvedModule = require(requirePath);
            globalScope[globalKey] = resolvedModule;
        }
        if (!resolvedModule) {
            throw new Error(`sectionWorld.js requires ${displayName} to be loaded first`);
        }
        return resolvedModule;
    }

    // sectionWorld.js is now primarily a composition root for the split runtime modules.
    const sectionWorldApiInstallers = resolveSectionWorldModule(
        "__sectionWorldApiInstallers",
        "./sectionWorldApiInstallers.js",
        "sectionWorldApiInstallers.js"
    );
    const {
        installSectionWorldSectionApis,
        installSectionWorldTraversalApis
    } = sectionWorldApiInstallers;

    const sectionWorldSectionRuntime = resolveSectionWorldModule(
        "__sectionWorldSectionRuntime",
        "./sectionWorldSectionRuntime.js",
        "sectionWorldSectionRuntime.js"
    );
    const {
        refreshSparseNodesForSectionAsset: sectionRuntimeRefreshSparseNodesForSectionAsset,
        addSparseNodesForSection: sectionRuntimeAddSparseNodesForSection,
        ensurePrototypeSectionExists: sectionRuntimeEnsurePrototypeSectionExists,
        buildSparsePrototypeNodes: sectionRuntimeBuildSparsePrototypeNodes,
        assignNodesToSections: sectionRuntimeAssignNodesToSections,
        buildPrototypeSeamSegmentEntriesForSections: sectionRuntimeBuildPrototypeSeamSegmentEntriesForSections,
        buildPrototypeSeamSegments: sectionRuntimeBuildPrototypeSeamSegments,
        updatePrototypeSeamSegmentsForSections: sectionRuntimeUpdatePrototypeSeamSegmentsForSections,
        startSparseNodeBuildStaging: sectionRuntimeStartSparseNodeBuildStaging,
        addSparseNodeBuildBatch: sectionRuntimeAddSparseNodeBuildBatch,
        commitSparseNodeBuildStaging: sectionRuntimeCommitSparseNodeBuildStaging,
        connectSparseNodesForSectionBatch: sectionRuntimeConnectSparseNodesForSectionBatch
    } = sectionWorldSectionRuntime;

    const sectionWorldLayout = resolveSectionWorldModule(
        "__sectionWorldLayout",
        "./sectionWorldLayout.js",
        "sectionWorldLayout.js"
    );
    const {
        setActiveCenter: prototypeLayoutSetActiveCenter,
        settlePendingPrototypeLayoutTransition: prototypeLayoutSettlePendingLayoutTransition,
        sortPrototypeLoadedNodes
    } = sectionWorldLayout;

    const sectionWorldBubbleSync = resolveSectionWorldModule(
        "__sectionWorldBubbleSync",
        "./sectionWorldBubbleSync.js",
        "sectionWorldBubbleSync.js"
    );
    const { createSectionWorldBubbleSyncHelpers } = sectionWorldBubbleSync;

    const sectionWorldEntitySync = resolveSectionWorldModule(
        "__sectionWorldEntitySync",
        "./sectionWorldEntitySync.js",
        "sectionWorldEntitySync.js"
    );
    const { installSectionWorldEntitySyncApis } = sectionWorldEntitySync;

    const sectionWorldRuntimeRecords = resolveSectionWorldModule(
        "__sectionWorldRuntimeRecords",
        "./sectionWorldRuntimeRecords.js",
        "sectionWorldRuntimeRecords.js"
    );
    const { installSectionWorldRuntimeRecordApis } = sectionWorldRuntimeRecords;

    const sectionWorldAsyncSync = resolveSectionWorldModule(
        "__sectionWorldAsyncSync",
        "./sectionWorldAsyncSync.js",
        "sectionWorldAsyncSync.js"
    );
    const { createSectionWorldAsyncSyncPlanners } = sectionWorldAsyncSync;

    const sectionWorldPersistence = resolveSectionWorldModule(
        "__sectionWorldPersistence",
        "./sectionWorldPersistence.js",
        "sectionWorldPersistence.js"
    );
    const { createSectionWorldPersistenceHelpers } = sectionWorldPersistence;

    const sectionWorldBlocking = resolveSectionWorldModule(
        "__sectionWorldBlocking",
        "./sectionWorldBlocking.js",
        "sectionWorldBlocking.js"
    );
    const { createSectionWorldBlockingHelpers } = sectionWorldBlocking;

    const sectionWorldAssets = resolveSectionWorldModule(
        "__sectionWorldAssets",
        "./sectionWorldAssets.js",
        "sectionWorldAssets.js"
    );
    const { createSectionWorldAssetHelpers } = sectionWorldAssets;

    const sectionWorldState = resolveSectionWorldModule(
        "__sectionWorldState",
        "./sectionWorldState.js",
        "sectionWorldState.js"
    );
    const { createSectionWorldStateHelpers } = sectionWorldState;

    const sectionWorldImport = resolveSectionWorldModule(
        "__sectionWorldImport",
        "./sectionWorldImport.js",
        "sectionWorldImport.js"
    );
    const { createSectionWorldImportHelpers } = sectionWorldImport;

    const sectionGeometry = resolveSectionWorldModule(
        "__sectionGeometry",
        "../map/sectionGeometry.js",
        "sectionGeometry.js"
    );
    const {
        SECTION_DIRECTIONS,
        evenQOffsetToAxial,
        axialToEvenQOffset,
        offsetToWorld,
        axialDistance,
        getSectionStride,
        getSectionBasisVectors,
        computeSectionCenterAxial,
        resolvePrototypeSectionCoordForWorldPosition,
        makeSectionKey,
        parseSectionKey,
        addSectionCoords,
        getBubbleKeysForCenter
    } = sectionGeometry;
    // Bubble shifts touch many records at once, but only a few object types are
    // expensive enough to justify keeping detached runtimes alive between shifts.
    const SECTION_WORLD_PARKED_OBJECT_LIMITS = Object.freeze({
        road: 1536,
        tree: 768
    });
    const SECTION_WORLD_SCRIPTING_NAME_PATTERN = /^[A-Za-z_$][\w$]*$/;

    function getSectionWorldParkedObjectCacheLimit(type) {
        const key = (typeof type === "string") ? type : "";
        return Number(SECTION_WORLD_PARKED_OBJECT_LIMITS[key]) || 0;
    }

    function shouldParkSectionWorldRuntimeObject(runtimeObj) {
        if (!runtimeObj || runtimeObj.gone || runtimeObj.vanishing) return false;
        if (runtimeObj._prototypeDirty === true) return false;
        if (runtimeObj.type === "road") return true;
        if (runtimeObj.type !== "tree") return false;
        if (runtimeObj.isOnFire || runtimeObj.falling || runtimeObj.isGrowing) return false;
        return true;
    }

    function canReuseSectionWorldParkedRuntimeObject(runtimeObj, expectedType, expectedSignature) {
        if (!runtimeObj || runtimeObj._prototypeParked !== true) return false;
        if (runtimeObj.gone || runtimeObj.vanishing) return false;
        if ((typeof expectedType === "string" && expectedType.length > 0) && runtimeObj.type !== expectedType) {
            return false;
        }
        const parkedSignature = (typeof runtimeObj._prototypePersistenceSignature === "string")
            ? runtimeObj._prototypePersistenceSignature
            : "";
        return parkedSignature === ((typeof expectedSignature === "string") ? expectedSignature : "");
    }

    function normalizeSectionWorldScriptingName(rawName) {
        const trimmed = String(rawName || "").trim();
        return SECTION_WORLD_SCRIPTING_NAME_PATTERN.test(trimmed) ? trimmed : "";
    }

    function getSectionWorldLookaheadKeysForCenter(state, centerSectionKey) {
        if (!state || typeof centerSectionKey !== "string" || centerSectionKey.length === 0) return new Set();
        const bubbleKeys = getBubbleKeysForCenter(state, centerSectionKey);
        const lookaheadKeys = new Set();
        bubbleKeys.forEach((sectionKey) => {
            const sectionBubble = getBubbleKeysForCenter(state, sectionKey);
            sectionBubble.forEach((candidateKey) => {
                if (!bubbleKeys.has(candidateKey)) {
                    lookaheadKeys.add(candidateKey);
                }
            });
        });
        return lookaheadKeys;
    }

    function hashCoordinatePair(x, y, seed) {
        let h = ((Number(x) || 0) * 374761393) + ((Number(y) || 0) * 668265263) + ((Number(seed) || 0) * 1442695041);
        h = (h ^ (h >>> 13)) >>> 0;
        h = Math.imul(h, 1274126177) >>> 0;
        return (h ^ (h >>> 16)) >>> 0;
    }

    function hashToUnitFloat(hash) {
        return (hash >>> 0) / 4294967295;
    }

    const assetHelpers = createSectionWorldAssetHelpers({
        hashCoordinatePair,
        hashToUnitFloat,
        offsetToWorld
    });
    const {
        applyRawPrototypeSectionAssetToStateAsset,
        comparePrototypeTileCoordKeys,
        clonePrototypeBlockedEdges,
        clonePrototypeClearanceByTile,
        clonePrototypeFloorRecords,
        clonePrototypeFloorHoleRecords,
        clonePrototypeFloorVoidRecords,
        clonePrototypeFloorTransitions,
        createPrototypeImplicitGroundFloorFragment,
        getPrototypeGroundTextureCount,
        normalizePrototypeGroundTiles,
        pickPrototypeGroundTextureId
    } = assetHelpers;
    const stateHelpers = createSectionWorldStateHelpers({
        SECTION_DIRECTIONS,
        addSectionCoords,
        axialDistance,
        axialToEvenQOffset,
        comparePrototypeTileCoordKeys,
        clonePrototypeFloorTransitions,
        computeSectionCenterAxial,
        createPrototypeImplicitGroundFloorFragment,
        evenQOffsetToAxial,
        getSectionBasisVectors,
        getSectionCoordsInRingRange,
        getPrototypeGroundTextureCount,
        makeSectionKey,
        normalizePrototypeGroundTiles,
        offsetToWorld
    });
    const {
        buildPrototypeSectionAssets,
        buildPrototypeSummary,
        buildSectionRecords,
        buildSectionRecordsFromCoords,
        createPrototypeSectionAsset,
        createPrototypeState,
        getPrototypeManifest
    } = stateHelpers;
    const importHelpers = createSectionWorldImportHelpers({
        applyRawPrototypeSectionAssetToStateAsset,
        axialToEvenQOffset,
        buildPrototypeSectionAssets,
        buildSectionRecordsFromCoords,
        clonePrototypeBlockedEdges,
        clonePrototypeFloorTransitions,
        clonePrototypeTriggerRecord,
        collectUsedPrototypeObjectRecordIds,
        evenQOffsetToAxial,
        getPrototypeGroundTextureCount,
        getSectionBasisVectors,
        isPrototypeTriggerRecord,
        makeSectionKey,
        normalizePrototypeGroundTiles,
        normalizePrototypeTriggerDefinitions,
        offsetToWorld
    });
    const {
        buildSectionStateFromAssetBundle,
        loadPrototypeSectionAssetBundle
    } = importHelpers;

    function sectionWorldHasActiveDirectionalBlockers(blockers) {
        if (!(blockers instanceof Set) || blockers.size === 0) return false;
        for (const blocker of blockers) {
            if (!blocker || blocker.gone) continue;
            const sinkState = (blocker && blocker._scriptSinkState && typeof blocker._scriptSinkState === "object")
                ? blocker._scriptSinkState
                : null;
            if (sinkState && sinkState.nonBlocking !== false) continue;
            return true;
        }
        return false;
    }

    function getSectionWorldConfig() {
        const startupConfig = (globalScope.RUNAROUND_STARTUP_CONFIG && typeof globalScope.RUNAROUND_STARTUP_CONFIG === "object")
            ? globalScope.RUNAROUND_STARTUP_CONFIG
            : {};
        return {
            sectionRadius: Number.isFinite(startupConfig.sectionRadius)
                ? Math.max(3, Math.floor(startupConfig.sectionRadius))
                : 10,
            sectionGraphRadius: Number.isFinite(startupConfig.sectionGraphRadius)
                ? Math.max(0, Math.floor(startupConfig.sectionGraphRadius))
                : 2,
            sectionAssetUrl: (typeof startupConfig.prototypeSectionAssetUrl === "string" && startupConfig.prototypeSectionAssetUrl.length > 0)
                ? startupConfig.prototypeSectionAssetUrl
                : "",
            fallbackSectionAssetUrl: (typeof startupConfig.prototypeSectionFallbackAssetUrl === "string" && startupConfig.prototypeSectionFallbackAssetUrl.length > 0)
                ? startupConfig.prototypeSectionFallbackAssetUrl
                : ""
        };
    }

    function getSectionCoordsInRingRange(graphRadius) {
        const coords = [];
        const limit = Math.max(0, Math.floor(Number(graphRadius)) || 0);
        for (let q = -limit; q <= limit; q++) {
            for (let r = -limit; r <= limit; r++) {
                const s = -q - r;
                if (Math.max(Math.abs(q), Math.abs(r), Math.abs(s)) > limit) continue;
                coords.push({ q, r });
            }
        }
        return coords;
    }

    function clearMapForSectionWorld(map) {
        if (!map || !Array.isArray(map.nodes)) return;

        if (typeof globalScope.animals !== "undefined" && Array.isArray(globalScope.animals)) {
            globalScope.animals.length = 0;
        }
        if (typeof globalScope.powerups !== "undefined" && Array.isArray(globalScope.powerups)) {
            globalScope.powerups.length = 0;
        }
        if (globalScope.WallSectionUnit && globalScope.WallSectionUnit._allSections instanceof Map) {
            globalScope.WallSectionUnit._allSections.clear();
        }

        map.objects = [];
        map.gameObjects = [];
        map._suppressClearanceUpdates = true;

        for (let x = 0; x < map.width; x++) {
            for (let y = 0; y < map.height; y++) {
                const node = map.nodes[x] && map.nodes[x][y];
                if (!node) continue;
                node.objects = [];
                node.visibilityObjects = [];
                node.blockedNeighbors = new Map();
                node.blockedByObjects = 0;
                node.blocked = true;
                node.clearance = 0;
                node.groundTextureId = 0;
                node._prototypeVoid = true;
                node._prototypeSectionKey = null;
                node._prototypeSectionActive = false;
            }
        }
    }

    function refreshSparseNodesForSectionAsset(map, prototypeState, asset) {
        return sectionRuntimeRefreshSparseNodesForSectionAsset(map, prototypeState, asset, {
            getPrototypeGroundTextureCount,
            normalizePrototypeGroundTiles,
            pickPrototypeGroundTextureId
        });
    }

    function addSparseNodesForSection(map, prototypeState, asset) {
        return sectionRuntimeAddSparseNodesForSection(map, prototypeState, asset, {
            globalScope,
            getNeighborOffsetsForColumn,
            getPrototypeGroundTextureCount,
            normalizePrototypeGroundTiles,
            pickPrototypeGroundTextureId
        });
    }

    const _sparseChunkDeps = () => ({
        globalScope,
        getNeighborOffsetsForColumn,
        getPrototypeGroundTextureCount,
        normalizePrototypeGroundTiles,
        pickPrototypeGroundTextureId
    });

    function startSparseNodeBuildForSection(state, sectionKey) {
        const asset = (state.sectionAssetsByKey instanceof Map) ? state.sectionAssetsByKey.get(sectionKey) : null;
        if (!asset) return false;
        return sectionRuntimeStartSparseNodeBuildStaging(state, asset);
    }

    function addSparseNodeBuildBatchForSection(map, state, sectionKey, start, count) {
        return sectionRuntimeAddSparseNodeBuildBatch(map, state, sectionKey, start, count, _sparseChunkDeps());
    }

    function commitSparseNodeBuildForSection(map, state, sectionKey) {
        return sectionRuntimeCommitSparseNodeBuildStaging(map, state, sectionKey, _sparseChunkDeps());
    }

    function connectSparseNodesForSectionBatch(state, sectionKey, start, count) {
        return sectionRuntimeConnectSparseNodesForSectionBatch(state, sectionKey, start, count);
    }

    function ensurePrototypeSectionExists(map, prototypeState, sectionCoord) {
        return sectionRuntimeEnsurePrototypeSectionExists(map, prototypeState, sectionCoord, {
            makeSectionKey,
            createPrototypeSectionAsset,
            addSparseNodesForSection
        });
    }

    function reassignHydratedPrototypeAssetRecordIds(map, asset) {
        if (!map || !asset || typeof asset !== "object") return false;
        const state = map._prototypeSectionState;
        if (!state || !(state.sectionAssetsByKey instanceof Map)) return false;
        let changed = false;
        const remapField = (fieldName, nextIdRef, options = {}) => {
            const records = Array.isArray(asset[fieldName]) ? asset[fieldName] : null;
            if (!records || !nextIdRef || typeof nextIdRef !== "object") return;
            const usedIds = new Set();
            for (const [sectionKey, otherAsset] of state.sectionAssetsByKey.entries()) {
                if (!otherAsset || sectionKey === asset.key) continue;
                const otherRecords = Array.isArray(otherAsset[fieldName]) ? otherAsset[fieldName] : null;
                if (!otherRecords) continue;
                for (let i = 0; i < otherRecords.length; i++) {
                    const otherId = Number(otherRecords[i] && otherRecords[i].id);
                    if (Number.isInteger(otherId)) usedIds.add(otherId);
                }
            }
            const remappedIds = new Map();
            for (let i = 0; i < records.length; i++) {
                const record = records[i];
                if (!record || typeof record !== "object") continue;
                let recordId = Number(record.id);
                if (!Number.isInteger(recordId) || usedIds.has(recordId) || remappedIds.has(recordId)) {
                    let nextId = Math.max(1, Number(nextIdRef.value) || 1);
                    while (usedIds.has(nextId) || remappedIds.has(nextId)) {
                        nextId += 1;
                    }
                    if (Number.isInteger(recordId)) {
                        remappedIds.set(recordId, nextId);
                    }
                    record.id = nextId;
                    nextIdRef.value = nextId + 1;
                    usedIds.add(nextId);
                    changed = true;
                    continue;
                }
                usedIds.add(recordId);
            }
            if (typeof options.afterRemap === "function" && remappedIds.size > 0) {
                options.afterRemap(remappedIds);
            }
        };

        const wallNextId = {
            value: map._prototypeWallState && Number.isInteger(map._prototypeWallState.nextRecordId)
                ? Number(map._prototypeWallState.nextRecordId)
                : 1
        };
        remapField("walls", wallNextId, {
            afterRemap: (remappedIds) => {
                if (!Array.isArray(asset.blockedEdges)) return;
                for (let i = 0; i < asset.blockedEdges.length; i++) {
                    const edge = asset.blockedEdges[i];
                    const recordId = Number(edge && edge.recordId);
                    if (!Number.isInteger(recordId) || !remappedIds.has(recordId)) continue;
                    edge.recordId = remappedIds.get(recordId);
                    changed = true;
                }
            }
        });
        if (map._prototypeWallState) {
            map._prototypeWallState.nextRecordId = wallNextId.value;
        }

        const objectNextId = {
            value: map._prototypeObjectState && Number.isInteger(map._prototypeObjectState.nextRecordId)
                ? Number(map._prototypeObjectState.nextRecordId)
                : 1
        };
        remapField("objects", objectNextId);
        if (map._prototypeObjectState) {
            map._prototypeObjectState.nextRecordId = objectNextId.value;
        }

        const animalNextId = {
            value: map._prototypeAnimalState && Number.isInteger(map._prototypeAnimalState.nextRecordId)
                ? Number(map._prototypeAnimalState.nextRecordId)
                : 1
        };
        remapField("animals", animalNextId);
        if (map._prototypeAnimalState) {
            map._prototypeAnimalState.nextRecordId = animalNextId.value;
        }

        const powerupNextId = {
            value: map._prototypePowerupState && Number.isInteger(map._prototypePowerupState.nextRecordId)
                ? Number(map._prototypePowerupState.nextRecordId)
                : 1
        };
        remapField("powerups", powerupNextId);
        if (map._prototypePowerupState) {
            map._prototypePowerupState.nextRecordId = powerupNextId.value;
        }

        return changed;
    }

    function pointInPrototypePolygon2D(x, y, points) {
        if (!Array.isArray(points) || points.length < 3) return false;
        let inside = false;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
            const xi = Number(points[i] && points[i].x) || 0;
            const yi = Number(points[i] && points[i].y) || 0;
            const xj = Number(points[j] && points[j].x) || 0;
            const yj = Number(points[j] && points[j].y) || 0;
            const intersect = ((yi > y) !== (yj > y))
                && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-7) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    function isPrototypeTriggerRecord(record) {
        if (!record || typeof record !== "object") return false;
        return record.type === "triggerArea" || record.objectType === "triggerArea" || record.isTriggerArea === true;
    }

    function clonePrototypeTriggerRecord(record) {
        if (!record || typeof record !== "object") return null;
        const points = Array.isArray(record.points)
            ? record.points
                .map((point) => ({
                    x: Number(point && point.x),
                    y: Number(point && point.y)
                }))
                .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
            : [];
        if (points.length < 3) return null;
        const cloned = {
            ...record,
            type: "triggerArea",
            objectType: "triggerArea",
            isTriggerArea: true,
            isPassable: true,
            castsLosShadows: false,
            points
        };
        if (record.script && typeof record.script === "object") {
            cloned.script = JSON.parse(JSON.stringify(record.script));
        }
        return cloned;
    }

    function getPrototypeTriggerBounds(points) {
        if (!Array.isArray(points) || points.length === 0) {
            return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
        }
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (let i = 0; i < points.length; i++) {
            const point = points[i];
            if (!point) continue;
            const x = Number(point.x);
            const y = Number(point.y);
            if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
        }
        if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
            return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
        }
        return { minX, minY, maxX, maxY };
    }

    function buildPrototypeTriggerTraversalHitbox(points) {
        const polygonPoints = Array.isArray(points) ? points : [];
        const bounds = getPrototypeTriggerBounds(polygonPoints);
        return {
            type: "prototypeTriggerPolygon",
            getBounds() {
                return {
                    x: Number(bounds.minX) || 0,
                    y: Number(bounds.minY) || 0,
                    width: Math.max(0, (Number(bounds.maxX) || 0) - (Number(bounds.minX) || 0)),
                    height: Math.max(0, (Number(bounds.maxY) || 0) - (Number(bounds.minY) || 0))
                };
            },
            containsPoint(x, y) {
                return pointInPrototypePolygon2D(Number(x) || 0, Number(y) || 0, polygonPoints);
            },
            intersects(probe) {
                if (!probe || probe.type !== "circle") return false;
                const px = Number(probe.x) || 0;
                const py = Number(probe.y) || 0;
                const radius = Math.max(0, Number(probe.radius) || 0);
                if (this.containsPoint(px, py)) return true;
                for (let i = 0; i < polygonPoints.length; i++) {
                    const start = polygonPoints[i];
                    const end = polygonPoints[(i + 1) % polygonPoints.length];
                    const abx = (Number(end.x) || 0) - (Number(start.x) || 0);
                    const aby = (Number(end.y) || 0) - (Number(start.y) || 0);
                    const apx = px - (Number(start.x) || 0);
                    const apy = py - (Number(start.y) || 0);
                    const abLen2 = (abx * abx) + (aby * aby);
                    const t = abLen2 <= 1e-7 ? 0 : Math.max(0, Math.min(1, ((apx * abx) + (apy * aby)) / abLen2));
                    const nearestX = (Number(start.x) || 0) + (abx * t);
                    const nearestY = (Number(start.y) || 0) + (aby * t);
                    const dx = px - nearestX;
                    const dy = py - nearestY;
                    if ((dx * dx) + (dy * dy) <= radius * radius) {
                        return true;
                    }
                }
                return false;
            }
        };
    }

    function createPrototypeTriggerDisplaySprite() {
        if (!globalScope.PIXI || typeof globalScope.PIXI.Sprite !== "function") return null;
        const texture = (globalScope.PIXI.Texture && globalScope.PIXI.Texture.WHITE)
            ? globalScope.PIXI.Texture.WHITE
            : null;
        if (!texture) return null;
        const sprite = new globalScope.PIXI.Sprite(texture);
        sprite.visible = false;
        sprite.alpha = 0;
        if (Object.prototype.hasOwnProperty.call(sprite, "renderable")) {
            sprite.renderable = false;
        }
        if (sprite.anchor && typeof sprite.anchor.set === "function") {
            sprite.anchor.set(0.5, 0.5);
        }
        return sprite;
    }

    function buildPrototypeTriggerDisplayHitbox(points) {
        const polygonPoints = Array.isArray(points)
            ? points.map((point) => ({ x: Number(point && point.x) || 0, y: Number(point && point.y) || 0 }))
            : [];
        if (typeof globalScope.PolygonHitbox === "function") {
            return new globalScope.PolygonHitbox(polygonPoints);
        }
        return {
            type: "prototypeTriggerDisplayPolygon",
            points: polygonPoints,
            getBounds() {
                const bounds = getPrototypeTriggerBounds(polygonPoints);
                return {
                    x: Number(bounds.minX) || 0,
                    y: Number(bounds.minY) || 0,
                    width: Math.max(0, (Number(bounds.maxX) || 0) - (Number(bounds.minX) || 0)),
                    height: Math.max(0, (Number(bounds.maxY) || 0) - (Number(bounds.minY) || 0))
                };
            }
        };
    }

    function syncPrototypeTriggerDisplayObject(map, displayObj, def) {
        if (!map || !displayObj || !def) return null;
        const points = Array.isArray(def.points)
            ? def.points.map((point) => ({ x: Number(point && point.x) || 0, y: Number(point && point.y) || 0 }))
            : [];
        const bounds = getPrototypeTriggerBounds(points);
        const width = Math.max(1e-4, (Number(bounds.maxX) || 0) - (Number(bounds.minX) || 0));
        const height = Math.max(1e-4, (Number(bounds.maxY) || 0) - (Number(bounds.minY) || 0));
        displayObj.map = map;
        displayObj.gone = false;
        displayObj.vanishing = false;
        displayObj.id = Number(def.id) || 0;
        displayObj._prototypeRecordId = Number(def.id) || 0;
        displayObj._prototypeTriggerDef = def;
        displayObj.type = "triggerArea";
        displayObj.objectType = "triggerArea";
        displayObj.isTriggerArea = true;
        displayObj.isPassable = true;
        displayObj.castsLosShadows = false;
        displayObj.blocksTile = false;
        displayObj.polygonPoints = points;
        displayObj.x = (Number(bounds.minX) || 0) + (width * 0.5);
        displayObj.y = (Number(bounds.minY) || 0) + (height * 0.5);
        displayObj.width = width;
        displayObj.height = height;
        displayObj.groundRadius = Math.max(width, height) * 0.5;
        displayObj.visualRadius = displayObj.groundRadius;
        const hitbox = buildPrototypeTriggerDisplayHitbox(points);
        displayObj.groundPlaneHitbox = hitbox;
        displayObj.visualHitbox = hitbox;
        if (displayObj.pixiSprite) {
            displayObj.pixiSprite.x = displayObj.x;
            displayObj.pixiSprite.y = displayObj.y;
            displayObj.pixiSprite.visible = false;
            if (Object.prototype.hasOwnProperty.call(displayObj.pixiSprite, "renderable")) {
                displayObj.pixiSprite.renderable = false;
            }
        }
        return displayObj;
    }

    function createPrototypeTriggerDisplayObject(map, def) {
        const displayObj = {
            map,
            type: "triggerArea",
            objectType: "triggerArea",
            isTriggerArea: true,
            isPassable: true,
            castsLosShadows: false,
            blocksTile: false,
            gone: false,
            vanishing: false,
            _prototypeTriggerDisplayShell: true,
            _prototypeRuntimeRecord: true,
            _prototypeObjectManaged: true,
            _prototypeOwnerSectionKey: "",
            _prototypeDirty: false,
            pixiSprite: createPrototypeTriggerDisplaySprite(),
            removeFromGame() {
                return removePrototypeTriggerDefinition(map, this._prototypeRecordId);
            },
            remove() {
                return removePrototypeTriggerDefinition(map, this._prototypeRecordId);
            },
            delete() {
                return removePrototypeTriggerDefinition(map, this._prototypeRecordId);
            },
            saveJson() {
                const currentDef = this._prototypeTriggerDef || null;
                const data = {
                    id: Number(this._prototypeRecordId) || 0,
                    type: "triggerArea",
                    x: Number(this.x) || 0,
                    y: Number(this.y) || 0,
                    points: Array.isArray(this.polygonPoints)
                        ? this.polygonPoints.map((point) => ({ x: Number(point.x) || 0, y: Number(point.y) || 0 }))
                        : [],
                    isPassable: true,
                    castsLosShadows: false
                };
                const scriptingName = (typeof this.scriptingName === "string")
                    ? this.scriptingName.trim()
                    : "";
                if (scriptingName.length > 0) {
                    data.scriptingName = scriptingName;
                }
                const playerEnters = (typeof this.playerEnters === "string")
                    ? this.playerEnters.trim()
                    : "";
                if (playerEnters.length > 0) {
                    data.playerEnters = playerEnters;
                }
                const playerExits = (typeof this.playerExits === "string")
                    ? this.playerExits.trim()
                    : "";
                if (playerExits.length > 0) {
                    data.playerExits = playerExits;
                }
                if (currentDef && currentDef.script && typeof currentDef.script === "object") {
                    data.script = JSON.parse(JSON.stringify(currentDef.script));
                }
                return data;
            },
            setPolygonPoints(rawPoints) {
                const mapRef = this.map || map;
                if (!mapRef || !mapRef._prototypeTriggerState || !(mapRef._prototypeTriggerState.triggerDefsById instanceof Map)) {
                    return false;
                }
                const recordId = Number(this._prototypeRecordId);
                if (!Number.isInteger(recordId)) return false;
                const currentDef = mapRef.getPrototypeTriggerDefById(recordId) || this._prototypeTriggerDef || {};
                const cloned = clonePrototypeTriggerRecord({
                    ...currentDef,
                    id: recordId,
                    points: rawPoints,
                    playerEnters: this.playerEnters,
                    playerExits: this.playerExits,
                    scriptingName: this.scriptingName
                });
                if (!cloned) return false;
                const nextDef = {
                    ...currentDef,
                    ...cloned,
                    id: recordId,
                    bounds: getPrototypeTriggerBounds(cloned.points),
                    coverageSectionKeys: buildPrototypeTriggerCoverageSectionKeys(mapRef._prototypeSectionState, cloned.points)
                };
                mapRef._prototypeTriggerState.triggerDefsById.set(recordId, nextDef);
                if (typeof mapRef.rebuildPrototypeTriggerRegistry === "function") {
                    mapRef.rebuildPrototypeTriggerRegistry();
                }
                const refreshedDef = mapRef.getPrototypeTriggerDefById(recordId) || nextDef;
                syncPrototypeTriggerDisplayObject(mapRef, this, refreshedDef);
                return true;
            }
        };

        const bindField = (fieldName, defaultValue = "") => {
            Object.defineProperty(displayObj, fieldName, {
                configurable: true,
                enumerable: true,
                get() {
                    const currentDef = this._prototypeTriggerDef || null;
                    const value = currentDef ? currentDef[fieldName] : defaultValue;
                    return typeof value === "undefined" ? defaultValue : value;
                },
                set(nextValue) {
                    const currentDef = this._prototypeTriggerDef || null;
                    if (!currentDef) return;
                    currentDef[fieldName] = nextValue;
                }
            });
        };

        bindField("scriptingName", "");
        bindField("playerEnters", "");
        bindField("playerExits", "");
        bindField("script", null);
        bindField("_scriptDeactivated", false);
        return syncPrototypeTriggerDisplayObject(map, displayObj, def);
    }

    function getPrototypeTriggerDisplayObject(map, triggerId) {
        if (!map || !map._prototypeTriggerState) return null;
        const triggerState = map._prototypeTriggerState;
        if (!(triggerState.displayObjectsById instanceof Map)) {
            triggerState.displayObjectsById = new Map();
        }
        const recordId = Number(triggerId);
        if (!Number.isInteger(recordId)) return null;
        const def = triggerState.triggerDefsById instanceof Map
            ? triggerState.triggerDefsById.get(recordId)
            : null;
        if (!def) {
            triggerState.displayObjectsById.delete(recordId);
            return null;
        }
        let displayObj = triggerState.displayObjectsById.get(recordId) || null;
        if (!displayObj) {
            displayObj = createPrototypeTriggerDisplayObject(map, def);
            triggerState.displayObjectsById.set(recordId, displayObj);
            return displayObj;
        }
        return syncPrototypeTriggerDisplayObject(map, displayObj, def);
    }

    function removePrototypeTriggerDefinition(map, triggerId) {
        if (!map || !map._prototypeTriggerState) return false;
        const triggerState = map._prototypeTriggerState;
        const recordId = Number(triggerId);
        if (!Number.isInteger(recordId)) return false;
        if (!(triggerState.triggerDefsById instanceof Map) || !triggerState.triggerDefsById.has(recordId)) {
            return false;
        }

        const def = triggerState.triggerDefsById.get(recordId);
        if (def && typeof def === "object") {
            def.gone = true;
            def._scriptDeactivated = true;
        }
        triggerState.triggerDefsById.delete(recordId);

        if (triggerState.displayObjectsById instanceof Map) {
            const displayObj = triggerState.displayObjectsById.get(recordId) || null;
            if (displayObj && typeof displayObj === "object") {
                displayObj.gone = true;
                displayObj._scriptDeactivated = true;
                if (displayObj.pixiSprite && displayObj.pixiSprite.parent) {
                    displayObj.pixiSprite.parent.removeChild(displayObj.pixiSprite);
                }
            }
            triggerState.displayObjectsById.delete(recordId);
        }

        if (typeof map.rebuildPrototypeTriggerRegistry === "function") {
            map.rebuildPrototypeTriggerRegistry();
        } else {
            rebuildPrototypeTriggerRegistryState(map);
        }
        return true;
    }

    function attachPrototypeTriggerDefinitionRemoval(map, def) {
        if (!map || !def || typeof def !== "object") return def;
        const removeSelf = function removeSelf() {
            return removePrototypeTriggerDefinition(map, this.id);
        };
        for (const methodName of ["delete", "remove", "removeFromGame"]) {
            Object.defineProperty(def, methodName, {
                configurable: true,
                enumerable: false,
                writable: true,
                value: removeSelf
            });
        }
        return def;
    }

    function collectUsedPrototypeObjectRecordIds(orderedSectionAssets) {
        const usedIds = new Set();
        const assets = Array.isArray(orderedSectionAssets) ? orderedSectionAssets : [];
        for (let i = 0; i < assets.length; i++) {
            const asset = assets[i];
            const records = Array.isArray(asset && asset.objects) ? asset.objects : [];
            for (let j = 0; j < records.length; j++) {
                const recordId = Number(records[j] && records[j].id);
                if (Number.isInteger(recordId)) {
                    usedIds.add(recordId);
                }
            }
        }
        return usedIds;
    }

    function buildPrototypeTriggerCoverageSectionKeys(sectionStateLike, points) {
        if (!sectionStateLike || !Array.isArray(points) || points.length < 3) return [];
        const sectionKeys = new Set();
        const addPoint = (x, y) => {
            const coord = resolvePrototypeSectionCoordForWorldPosition(sectionStateLike, x, y);
            if (!coord) return;
            sectionKeys.add(makeSectionKey(coord));
        };
        for (let i = 0; i < points.length; i++) {
            addPoint(points[i].x, points[i].y);
        }
        for (let i = 0; i < points.length; i++) {
            const start = points[i];
            const end = points[(i + 1) % points.length];
            const length = Math.hypot((Number(end.x) || 0) - (Number(start.x) || 0), (Number(end.y) || 0) - (Number(start.y) || 0));
            const steps = Math.max(1, Math.ceil(length / 2));
            for (let step = 0; step <= steps; step++) {
                const t = step / steps;
                addPoint(
                    (Number(start.x) || 0) + (((Number(end.x) || 0) - (Number(start.x) || 0)) * t),
                    (Number(start.y) || 0) + (((Number(end.y) || 0) - (Number(start.y) || 0)) * t)
                );
            }
        }
        const bounds = getPrototypeTriggerBounds(points);
        for (let y = bounds.minY; y <= bounds.maxY; y += 2) {
            for (let x = bounds.minX; x <= bounds.maxX; x += 2) {
                if (!pointInPrototypePolygon2D(x, y, points)) continue;
                addPoint(x, y);
            }
        }
        return Array.from(sectionKeys).sort();
    }

    function normalizePrototypeTriggerDefinitions(records, sectionStateLike, usedObjectIds = new Set(), nextObjectRecordId = 1) {
        const normalized = [];
        const seenIds = new Set();
        const seenSignatures = new Set();
        let nextId = Math.max(1, Number(nextObjectRecordId) || 1);
        const rawRecords = Array.isArray(records) ? records : [];
        for (let i = 0; i < rawRecords.length; i++) {
            const cloned = clonePrototypeTriggerRecord(rawRecords[i]);
            if (!cloned) continue;
            const signature = JSON.stringify({
                points: cloned.points,
                script: cloned.script || null,
                scriptingName: typeof cloned.scriptingName === "string" ? cloned.scriptingName : ""
            });
            let recordId = Number(cloned.id);
            if (!Number.isInteger(recordId) || usedObjectIds.has(recordId) || seenIds.has(recordId)) {
                while (usedObjectIds.has(nextId) || seenIds.has(nextId)) {
                    nextId += 1;
                }
                recordId = nextId;
                nextId += 1;
            }
            if (seenSignatures.has(signature)) continue;
            seenIds.add(recordId);
            usedObjectIds.add(recordId);
            if (recordId >= nextId) {
                nextId = recordId + 1;
            }
            seenSignatures.add(signature);
            const bounds = getPrototypeTriggerBounds(cloned.points);
            const coverageSectionKeys = buildPrototypeTriggerCoverageSectionKeys(sectionStateLike, cloned.points);
            normalized.push({
                ...cloned,
                id: recordId,
                bounds,
                coverageSectionKeys
            });
        }
        return { triggerDefinitions: normalized, nextRecordId: nextId };
    }

    function rebuildPrototypeTriggerRegistryState(map, triggerDefinitions = null) {
        if (!map) return null;
        if (!map._prototypeTriggerState || typeof map._prototypeTriggerState !== "object") {
            map._prototypeTriggerState = {
                triggerDefsById: new Map(),
                triggerIdsBySectionKey: new Map(),
                displayObjectsById: new Map(),
                registryVersion: 0
            };
        }
        const triggerState = map._prototypeTriggerState;
        const defs = Array.isArray(triggerDefinitions)
            ? triggerDefinitions
            : Array.from(triggerState.triggerDefsById.values());
        triggerState.triggerDefsById = new Map();
        triggerState.triggerIdsBySectionKey = new Map();
        for (let i = 0; i < defs.length; i++) {
            const def = clonePrototypeTriggerRecord(defs[i]);
            if (!def) continue;
            const recordId = Number(def.id);
            if (!Number.isInteger(recordId)) continue;
            def.id = recordId;
            def.objectType = "triggerArea";
            def.isTriggerArea = true;
            def.bounds = (def.bounds && typeof def.bounds === "object") ? { ...def.bounds } : getPrototypeTriggerBounds(def.points);
            def.coverageSectionKeys = Array.isArray(def.coverageSectionKeys) && def.coverageSectionKeys.length > 0
                ? Array.from(new Set(def.coverageSectionKeys.filter((key) => typeof key === "string" && key.length > 0))).sort()
                : buildPrototypeTriggerCoverageSectionKeys(map._prototypeSectionState, def.points);
            def._prototypeTriggerHitbox = buildPrototypeTriggerTraversalHitbox(def.points);
            attachPrototypeTriggerDefinitionRemoval(map, def);
            triggerState.triggerDefsById.set(recordId, def);
            for (let keyIndex = 0; keyIndex < def.coverageSectionKeys.length; keyIndex++) {
                const sectionKey = def.coverageSectionKeys[keyIndex];
                if (!triggerState.triggerIdsBySectionKey.has(sectionKey)) {
                    triggerState.triggerIdsBySectionKey.set(sectionKey, new Set());
                }
                triggerState.triggerIdsBySectionKey.get(sectionKey).add(recordId);
            }
        }
        if (triggerState.displayObjectsById instanceof Map) {
            for (const triggerId of Array.from(triggerState.displayObjectsById.keys())) {
                if (!triggerState.triggerDefsById.has(triggerId)) {
                    triggerState.displayObjectsById.delete(triggerId);
                }
            }
        }
        triggerState.registryVersion = (Number(triggerState.registryVersion) || 0) + 1;
        return triggerState;
    }

    function doesPrototypeNodeBelongToFloorFragment(node, fragment) {
        if (!node || !fragment) return false;
        if (fragment._prototypeSynthesizedGround === true) return true;
        if (Array.isArray(fragment.tileCoordKeys) && fragment.tileCoordKeys.length > 0) {
            if (!(fragment._prototypeTileCoordKeySet instanceof Set)) {
                fragment._prototypeTileCoordKeySet = new Set(fragment.tileCoordKeys);
            }
            return fragment._prototypeTileCoordKeySet.has(`${node.xindex},${node.yindex}`);
        }
        const outerPolygon = Array.isArray(fragment.outerPolygon) ? fragment.outerPolygon : [];
        if (outerPolygon.length < 3) return false;
        if (!pointInPrototypePolygon2D(node.x, node.y, outerPolygon)) return false;
        const holes = Array.isArray(fragment.holes) ? fragment.holes : [];
        for (let i = 0; i < holes.length; i++) {
            if (pointInPrototypePolygon2D(node.x, node.y, holes[i])) return false;
        }
        return true;
    }

    function rebuildPrototypeFloorRuntime(map, state) {
        if (map && typeof map.rebuildFloorRuntimeFromSectionState === "function") {
            return map.rebuildFloorRuntimeFromSectionState(state, {
                synthesizeGroundFragment: createPrototypeImplicitGroundFloorFragment,
                doesNodeBelongToFragment: doesPrototypeNodeBelongToFloorFragment,
                transitions: Array.isArray(state && state.floorTransitions) ? state.floorTransitions : []
            });
        }
        if (!map || !state || !(state.sectionAssetsByKey instanceof Map) || !(state.nodesBySectionKey instanceof Map)) {
            return { fragmentCount: 0, nodeCount: 0, transitionCount: 0 };
        }
        return state.floorRuntimeStats || { fragmentCount: 0, nodeCount: 0, transitionCount: 0 };
    }

    function getNeighborOffsetsForColumn(x) {
        const isEven = x % 2 === 0;
        if (isEven) {
            return [
                { x: -2, y: 0 },
                { x: -1, y: 0 },
                { x: -1, y: -1 },
                { x: 0, y: -1 },
                { x: 1, y: -1 },
                { x: 1, y: 0 },
                { x: 2, y: 0 },
                { x: 1, y: 1 },
                { x: 1, y: 2 },
                { x: 0, y: 1 },
                { x: -1, y: 2 },
                { x: -1, y: 1 }
            ];
        }
        return [
            { x: -2, y: 0 },
            { x: -1, y: -1 },
            { x: -1, y: -2 },
            { x: 0, y: -1 },
            { x: 1, y: -2 },
            { x: 1, y: -1 },
            { x: 2, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
            { x: 0, y: 1 },
            { x: -1, y: 1 },
            { x: -1, y: 0 }
        ];
    }

    function buildSparsePrototypeNodes(map, prototypeState, sectionKeys = null) {
        return sectionRuntimeBuildSparsePrototypeNodes(map, prototypeState, sectionKeys, {
            globalScope,
            getNeighborOffsetsForColumn,
            getPrototypeGroundTextureCount,
            pickPrototypeGroundTextureId
        });
    }

    function assignNodesToSections(map, prototypeState) {
        return sectionRuntimeAssignNodesToSections(map, prototypeState, {
            getBubbleKeysForCenter,
            evenQOffsetToAxial,
            axialDistance,
            buildSparsePrototypeNodes
        });
    }

    function rebuildPrototypeAssetObjectNameRegistry(asset) {
        if (!asset || !Array.isArray(asset.objects)) return new Map();
        const primary = new Map();
        const conflicts = new Map();
        for (let i = 0; i < asset.objects.length; i++) {
            const record = asset.objects[i];
            const name = normalizeSectionWorldScriptingName(record && record.scriptingName);
            const recordId = Number(record && record.id);
            if (!name || !Number.isInteger(recordId)) continue;
            if (!primary.has(name)) {
                primary.set(name, recordId);
                continue;
            }
            if (!conflicts.has(name)) {
                conflicts.set(name, [primary.get(name)]);
            }
            conflicts.get(name).push(recordId);
        }
        asset._prototypeNamedObjectRecordIdByName = primary;
        asset._prototypeNamedObjectConflictRecordIdsByName = conflicts;
        return primary;
    }

    function forEachPrototypeAssetNamedRecord(asset, visitor) {
        if (!asset || typeof visitor !== "function") return;
        const recordLists = [asset.objects, asset.animals, asset.powerups];
        for (let listIndex = 0; listIndex < recordLists.length; listIndex++) {
            const records = recordLists[listIndex];
            if (!Array.isArray(records)) continue;
            for (let i = 0; i < records.length; i++) {
                const record = records[i];
                const name = normalizeSectionWorldScriptingName(record && record.scriptingName);
                const recordId = Number(record && record.id);
                if (!name || !Number.isInteger(recordId)) continue;
                visitor(name, recordId, record);
            }
        }
    }

    function getPrototypeRuntimeTargetSectionKey(map, target) {
        if (!map || !target || typeof target !== "object") return "";
        if (typeof target._prototypeOwnerSectionKey === "string" && target._prototypeOwnerSectionKey.length > 0) {
            return target._prototypeOwnerSectionKey;
        }
        if (
            Number.isFinite(target.x) &&
            Number.isFinite(target.y) &&
            typeof map.getPrototypeSectionKeyForWorldPoint === "function"
        ) {
            return map.getPrototypeSectionKeyForWorldPoint(target.x, target.y) || "";
        }
        return "";
    }

    function forEachPrototypeBubbleRuntimeTarget(map, state, centerSectionKey, visitor, options = {}) {
        if (!map || !state || !centerSectionKey || typeof visitor !== "function") return;
        ensurePrototypeBubbleSectionsExist(map, state, centerSectionKey);
        const bubbleKeys = getBubbleKeysForCenter(state, centerSectionKey);
        const ignoreRuntimeObj = options && options.ignoreRuntimeObj ? options.ignoreRuntimeObj : null;
        const ignoreRecordId = Number.isInteger(options && options.ignoreRecordId)
            ? Number(options.ignoreRecordId)
            : null;
        const seen = new Set();

        const visitCandidate = (target) => {
            if (!target || typeof target !== "object" || target.gone || target.vanishing) return;
            if (target === ignoreRuntimeObj || seen.has(target)) return;
            const sectionKey = getPrototypeRuntimeTargetSectionKey(map, target);
            if (!sectionKey || !bubbleKeys.has(sectionKey)) return;
            const recordId = Number(target._prototypeRecordId);
            if (ignoreRecordId !== null && Number.isInteger(recordId) && recordId === ignoreRecordId) return;
            seen.add(target);
            visitor(target, sectionKey);
        };

        const objectState = map._prototypeObjectState;
        if (objectState && objectState.activeRuntimeObjectsByRecordId instanceof Map) {
            for (const runtimeObj of objectState.activeRuntimeObjectsByRecordId.values()) {
                visitCandidate(runtimeObj);
            }
        }

        const animalState = map._prototypeAnimalState;
        if (animalState && animalState.activeRuntimeAnimalsByRecordId instanceof Map) {
            for (const runtimeAnimal of animalState.activeRuntimeAnimalsByRecordId.values()) {
                visitCandidate(runtimeAnimal);
            }
        }

        const powerupState = map._prototypePowerupState;
        if (powerupState && powerupState.activeRuntimePowerupsByRecordId instanceof Map) {
            for (const runtimePowerup of powerupState.activeRuntimePowerupsByRecordId.values()) {
                visitCandidate(runtimePowerup);
            }
        }

        if (Array.isArray(globalScope.animals)) {
            for (let i = 0; i < globalScope.animals.length; i++) {
                visitCandidate(globalScope.animals[i]);
            }
        }

        if (Array.isArray(globalScope.powerups)) {
            for (let i = 0; i < globalScope.powerups.length; i++) {
                visitCandidate(globalScope.powerups[i]);
            }
        }

        if (state.nodesBySectionKey instanceof Map) {
            bubbleKeys.forEach((sectionKey) => {
                const nodes = state.nodesBySectionKey.get(sectionKey) || [];
                for (let i = 0; i < nodes.length; i++) {
                    const node = nodes[i];
                    if (!node || !Array.isArray(node.objects)) continue;
                    for (let j = 0; j < node.objects.length; j++) {
                        visitCandidate(node.objects[j]);
                    }
                }
            });
        }
    }

    function ensurePrototypeBubbleSectionsExist(map, state, centerSectionKey) {
        if (!map || !state || !centerSectionKey) return;
        if (!state.sectionsByKey.has(centerSectionKey)) {
            const [qRaw, rRaw] = String(centerSectionKey).split(",");
            ensurePrototypeSectionExists(map, state, {
                q: Number(qRaw) || 0,
                r: Number(rRaw) || 0
            });
        }
        const centerSection = state.sectionsByKey.get(centerSectionKey);
        if (!centerSection) return;
        for (let i = 0; i < SECTION_DIRECTIONS.length; i++) {
            ensurePrototypeSectionExists(map, state, addSectionCoords(centerSection.coord, SECTION_DIRECTIONS[i]));
        }
    }

    function collectPrototypeBubbleObjectNames(map, state, centerSectionKey, options = {}) {
        const usedNames = new Set();
        if (!map || !state || !centerSectionKey) return usedNames;
        const ignoreRuntimeObj = options && options.ignoreRuntimeObj ? options.ignoreRuntimeObj : null;
        const ignoreRecordId = Number.isInteger(options && options.ignoreRecordId)
            ? Number(options.ignoreRecordId)
            : null;

        ensurePrototypeBubbleSectionsExist(map, state, centerSectionKey);
        const bubbleKeys = getBubbleKeysForCenter(state, centerSectionKey);

        bubbleKeys.forEach((sectionKey) => {
            const asset = state.sectionAssetsByKey instanceof Map
                ? state.sectionAssetsByKey.get(sectionKey)
                : null;
            if (!asset) return;
            forEachPrototypeAssetNamedRecord(asset, (name, recordId) => {
                if (ignoreRecordId !== null && recordId === ignoreRecordId) return;
                usedNames.add(name);
            });
        });

        forEachPrototypeBubbleRuntimeTarget(map, state, centerSectionKey, (runtimeTarget) => {
            const runtimeName = normalizeSectionWorldScriptingName(runtimeTarget.scriptingName);
            if (!runtimeName) return;
            usedNames.add(runtimeName);
        }, {
            ignoreRuntimeObj,
            ignoreRecordId
        });

        return usedNames;
    }

    function generatePrototypeBubbleUniqueObjectName(map, state, centerSectionKey, baseName, options = {}) {
        const normalizedBase = normalizeSectionWorldScriptingName(baseName) || "object";
        const usedNames = collectPrototypeBubbleObjectNames(map, state, centerSectionKey, options);
        let index = 1;
        let candidate = `${normalizedBase}${index}`;
        while (usedNames.has(candidate)) {
            index += 1;
            candidate = `${normalizedBase}${index}`;
        }
        return candidate;
    }

    function resolvePrototypeActiveNamedObject(map, state, name, centerSectionKey = null) {
        const normalizedName = normalizeSectionWorldScriptingName(name);
        if (!normalizedName || !map || !state) return null;
        const scopeCenterKey = (typeof centerSectionKey === "string" && centerSectionKey.length > 0)
            ? centerSectionKey
            : state.activeCenterKey;
        let resolvedRuntimeObj = null;
        forEachPrototypeBubbleRuntimeTarget(map, state, scopeCenterKey, (candidate) => {
            if (resolvedRuntimeObj) return;
            if (normalizeSectionWorldScriptingName(candidate.scriptingName) !== normalizedName) return;
            resolvedRuntimeObj = candidate;
        });
        return resolvedRuntimeObj;
    }

    function setActiveCenter(map, nextCenterKey) {
        return prototypeLayoutSetActiveCenter(map, nextCenterKey, {
            SECTION_DIRECTIONS,
            addSectionCoords,
            ensurePrototypeSectionExists,
            getBubbleKeysForCenter,
            getPrototypeLookaheadKeysForCenter: getSectionWorldLookaheadKeysForCenter,
            addSparseNodesForSection,
            refreshSparseNodesForSectionAsset,
            rebuildPrototypeFloorRuntime,
            updatePrototypeSeamSegmentsForSections
        });
    }

    function settlePendingPrototypeLayoutTransition(map) {
        return prototypeLayoutSettlePendingLayoutTransition(map, {
            updatePrototypeSeamSegmentsForSections
        });
    }

    function buildPrototypeSeamSegmentEntriesForSections(state, targetSectionKeys = null) {
        return sectionRuntimeBuildPrototypeSeamSegmentEntriesForSections(state, targetSectionKeys);
    }

    function buildPrototypeSeamSegments(state) {
        return sectionRuntimeBuildPrototypeSeamSegments(state);
    }

    function updatePrototypeSeamSegmentsForSections(state, changedSectionKeys = null) {
        return sectionRuntimeUpdatePrototypeSeamSegmentsForSections(state, changedSectionKeys);
    }

    function updatePrototypeGpuDebugStats(map) {
        if (typeof globalThis === "undefined" || typeof globalThis.setGpuAssetGauge !== "function") return;
        const sectionState = map && map._prototypeSectionState;
        const wallState = map && map._prototypeWallState;
        const objectState = map && map._prototypeObjectState;
        const animalState = map && map._prototypeAnimalState;
        const activeObjects = (objectState && objectState.activeRuntimeObjectsByRecordId instanceof Map)
            ? Array.from(objectState.activeRuntimeObjectsByRecordId.values())
            : [];
        let runtimeRoads = 0;
        let runtimeTrees = 0;
        let runtimeRoofs = 0;
        for (let i = 0; i < activeObjects.length; i++) {
            const obj = activeObjects[i];
            if (!obj || obj.gone) continue;
            if (obj.type === "road") {
                runtimeRoads += 1;
            } else if (obj.type === "tree") {
                runtimeTrees += 1;
            } else if (obj.type === "roof") {
                runtimeRoofs += 1;
            }
        }
        globalThis.setGpuAssetGauge(
            "prototypeLoadedNodes",
            sectionState && Array.isArray(sectionState.loadedNodes) ? sectionState.loadedNodes.length : 0
        );
        globalThis.setGpuAssetGauge(
            "prototypeRuntimeWalls",
            wallState && wallState.activeRuntimeWallsByRecordId instanceof Map ? wallState.activeRuntimeWallsByRecordId.size : 0
        );
        globalThis.setGpuAssetGauge(
            "prototypeRuntimeObjects",
            objectState && objectState.activeRuntimeObjectsByRecordId instanceof Map ? objectState.activeRuntimeObjectsByRecordId.size : 0
        );
        globalThis.setGpuAssetGauge("prototypeRuntimeRoads", runtimeRoads);
        globalThis.setGpuAssetGauge("prototypeRuntimeTrees", runtimeTrees);
        globalThis.setGpuAssetGauge("prototypeRuntimeRoofs", runtimeRoofs);
        globalThis.setGpuAssetGauge(
            "prototypeRuntimeAnimals",
            animalState && animalState.activeRuntimeAnimalsByRecordId instanceof Map ? animalState.activeRuntimeAnimalsByRecordId.size : 0
        );
    }

    function initializePrototypeRuntimeState(map, prototypeState) {
        if (!map) return;
        map._prototypeWallState = {
            nextRecordId: Number.isInteger(prototypeState && prototypeState.nextRecordIds && prototypeState.nextRecordIds.walls)
                ? Number(prototypeState.nextRecordIds.walls)
                : 1,
            activeRuntimeWalls: [],
            activeRuntimeWallsByRecordId: new Map(),
            activeRecordSignature: ""
        };
        map._prototypeBlockedEdgeState = {
            activeEntriesBySectionKey: new Map(),
            blockerTokensByRecordId: new Map()
        };
        map._prototypeObjectState = {
            nextRecordId: Number.isInteger(prototypeState && prototypeState.nextRecordIds && prototypeState.nextRecordIds.objects)
                ? Number(prototypeState.nextRecordIds.objects)
                : 1,
            activeRuntimeObjects: [],
            activeRuntimeObjectsByRecordId: new Map(),
            parkedRuntimeObjectsByRecordId: new Map(),
            dirtyRuntimeObjects: new Set(),
            activeRecordSignature: "",
            captureScanNeeded: true
        };
        map._prototypeAnimalState = {
            nextRecordId: Number.isInteger(prototypeState && prototypeState.nextRecordIds && prototypeState.nextRecordIds.animals)
                ? Number(prototypeState.nextRecordIds.animals)
                : 1,
            activeRuntimeAnimals: [],
            activeRuntimeAnimalsByRecordId: new Map(),
            activeRecordSignature: ""
        };
        map._prototypePowerupState = {
            nextRecordId: Number.isInteger(prototypeState && prototypeState.nextRecordIds && prototypeState.nextRecordIds.powerups)
                ? Number(prototypeState.nextRecordIds.powerups)
                : 1,
            activeRuntimePowerups: [],
            activeRuntimePowerupsByRecordId: new Map(),
            activeRecordSignature: ""
        };
        map._prototypeTriggerState = {
            triggerDefsById: new Map(),
            triggerIdsBySectionKey: new Map(),
            registryVersion: 0
        };
        rebuildPrototypeTriggerRegistryState(
            map,
            Array.isArray(prototypeState && prototypeState.triggerDefinitions)
                ? prototypeState.triggerDefinitions
                : []
        );
        map._prototypeBubbleShiftSession = null;
    }

    function clearPrototypeRuntimeStateForReload(map) {
        if (!map) return;

        map._prototypeBubbleShiftSession = null;

        const wallState = map._prototypeWallState;
        if (wallState && wallState.activeRuntimeWallsByRecordId instanceof Map) {
            for (const runtimeWall of wallState.activeRuntimeWallsByRecordId.values()) {
                if (!runtimeWall || runtimeWall.gone) continue;
                if (typeof runtimeWall.removeFromGame === "function") {
                    runtimeWall.removeFromGame();
                } else if (typeof runtimeWall.destroy === "function") {
                    runtimeWall.destroy();
                } else {
                    runtimeWall.gone = true;
                }
            }
        }

        const objectState = map._prototypeObjectState;
        if (objectState && objectState.activeRuntimeObjectsByRecordId instanceof Map) {
            for (const runtimeObj of objectState.activeRuntimeObjectsByRecordId.values()) {
                if (!runtimeObj || runtimeObj.gone) continue;
                if (typeof runtimeObj.removeFromGame === "function") {
                    runtimeObj.removeFromGame();
                } else if (typeof runtimeObj.remove === "function") {
                    runtimeObj.remove();
                } else {
                    runtimeObj.gone = true;
                }
            }
        }
        if (objectState && objectState.parkedRuntimeObjectsByRecordId instanceof Map) {
            for (const runtimeObj of objectState.parkedRuntimeObjectsByRecordId.values()) {
                if (!runtimeObj || runtimeObj.gone) continue;
                if (typeof runtimeObj.removeFromGame === "function") {
                    runtimeObj.removeFromGame();
                } else if (typeof runtimeObj.remove === "function") {
                    runtimeObj.remove();
                } else {
                    runtimeObj.gone = true;
                }
            }
        }

        const animalState = map._prototypeAnimalState;
        if (animalState && animalState.activeRuntimeAnimalsByRecordId instanceof Map) {
            for (const runtimeAnimal of animalState.activeRuntimeAnimalsByRecordId.values()) {
                if (!runtimeAnimal || runtimeAnimal.gone) continue;
                if (typeof runtimeAnimal.removeFromGame === "function") {
                    runtimeAnimal.removeFromGame();
                } else if (typeof runtimeAnimal.remove === "function") {
                    runtimeAnimal.remove();
                } else {
                    runtimeAnimal.gone = true;
                }
            }
        }

        const powerupState = map._prototypePowerupState;
        if (powerupState && powerupState.activeRuntimePowerupsByRecordId instanceof Map) {
            for (const runtimePowerup of powerupState.activeRuntimePowerupsByRecordId.values()) {
                if (!runtimePowerup || runtimePowerup.gone) continue;
                runtimePowerup.collected = true;
                runtimePowerup.gone = true;
                if (runtimePowerup.pixiSprite && runtimePowerup.pixiSprite.parent) {
                    runtimePowerup.pixiSprite.parent.removeChild(runtimePowerup.pixiSprite);
                }
            }
        }

        if (Array.isArray(globalScope.animals)) {
            for (let i = globalScope.animals.length - 1; i >= 0; i--) {
                const animal = globalScope.animals[i];
                if (!animal || animal._prototypeRuntimeRecord !== true) continue;
                if (!animal.gone) {
                    if (typeof animal.removeFromGame === "function") {
                        animal.removeFromGame();
                    } else if (typeof animal.remove === "function") {
                        animal.remove();
                    } else {
                        animal.gone = true;
                    }
                }
                if (globalScope.animals[i] === animal || animal.gone) {
                    globalScope.animals.splice(i, 1);
                }
            }
        }

        if (Array.isArray(globalScope.powerups)) {
            for (let i = globalScope.powerups.length - 1; i >= 0; i--) {
                const powerup = globalScope.powerups[i];
                if (!powerup || powerup._prototypeRuntimeRecord !== true) continue;
                powerup.collected = true;
                powerup.gone = true;
                if (powerup.pixiSprite && powerup.pixiSprite.parent) {
                    powerup.pixiSprite.parent.removeChild(powerup.pixiSprite);
                }
                globalScope.powerups.splice(i, 1);
            }
        }
    }

    function markPrototypeObjectCaptureNeeded(map, obj = null) {
        if (!map || !map._prototypeObjectState) return;
        if (map._prototypeSuppressObjectDirtyTracking === true) return;
        if (obj && typeof obj.saveJson === "function" && obj.type !== "wallSection") {
            if (!(map._prototypeObjectState.dirtyRuntimeObjects instanceof Set)) {
                map._prototypeObjectState.dirtyRuntimeObjects = new Set();
            }
            map._prototypeObjectState.dirtyRuntimeObjects.add(obj);
        }
        if (obj && obj._prototypeObjectManaged === true && obj._prototypeRuntimeRecord === true) {
            obj._prototypeDirty = true;
        }
        map._prototypeObjectState.captureScanNeeded = true;
    }

    function installPrototypeObjectDirtyTracking(map) {
        if (!map || map._prototypeObjectDirtyTrackingInstalled === true) return;
        map._prototypeObjectDirtyTrackingInstalled = true;

        const NodeCtor = globalScope.MapNode
            || (map.nodes && map.nodes[0] && map.nodes[0][0] && map.nodes[0][0].constructor);
        if (NodeCtor && NodeCtor.prototype) {
            if (!NodeCtor.prototype._prototypeOriginalAddObject && typeof NodeCtor.prototype.addObject === "function") {
                NodeCtor.prototype._prototypeOriginalAddObject = NodeCtor.prototype.addObject;
                NodeCtor.prototype.addObject = function prototypeTrackedAddObject(obj) {
                    const result = NodeCtor.prototype._prototypeOriginalAddObject.call(this, obj);
                    const mapRef = (obj && obj.map) || globalScope.map || null;
                    if (mapRef && mapRef._prototypeSectionState && this && this._prototypeSectionKey) {
                        markPrototypeObjectCaptureNeeded(mapRef, obj);
                    }
                    return result;
                };
            }
            if (!NodeCtor.prototype._prototypeOriginalRemoveObject && typeof NodeCtor.prototype.removeObject === "function") {
                NodeCtor.prototype._prototypeOriginalRemoveObject = NodeCtor.prototype.removeObject;
                NodeCtor.prototype.removeObject = function prototypeTrackedRemoveObject(obj) {
                    const result = NodeCtor.prototype._prototypeOriginalRemoveObject.call(this, obj);
                    const mapRef = (obj && obj.map) || globalScope.map || null;
                    if (mapRef && mapRef._prototypeSectionState && this && this._prototypeSectionKey) {
                        markPrototypeObjectCaptureNeeded(mapRef, obj);
                    }
                    return result;
                };
            }
        }
    }

    function updateActiveBubbleForActor(map, actor, options = {}) {
        const state = map && map._prototypeSectionState;
        if (!state || !actor) return false;
        const force = options.force === true;
        const actorSectionCoord = resolvePrototypeSectionCoordForWorldPosition(state, actor.x, actor.y);
        if (!actorSectionCoord) return false;
        const actorSectionKey = makeSectionKey(actorSectionCoord);

        if (force || !state.activeSectionKeys.has(actorSectionKey)) {
            return setActiveCenter(map, actorSectionKey);
        }
        if (actorSectionKey !== state.activeCenterKey) {
            return setActiveCenter(map, actorSectionKey);
        }
        return false;
    }

    function attachSectionWorldApis(map, prototypeState) {
        map._prototypeSectionState = prototypeState;
        map._sectionWorld = buildPrototypeSummary(prototypeState);
        map._twoSectionPrototype = map._sectionWorld;
        if (Array.isArray(prototypeState && prototypeState.orderedSectionAssets)) {
            for (let i = 0; i < prototypeState.orderedSectionAssets.length; i++) {
                rebuildPrototypeAssetObjectNameRegistry(prototypeState.orderedSectionAssets[i]);
            }
        }
        installPrototypeObjectDirtyTracking(map);
        rebuildPrototypeFloorRuntime(map, prototypeState);
        const blockingHelpers = createSectionWorldBlockingHelpers(map, {
            prototypeHasActiveDirectionalBlockers: sectionWorldHasActiveDirectionalBlockers
        });
        const {
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
        } = blockingHelpers;
        installSectionWorldSectionApis(map, {
            globalScope,
            ensurePrototypeBubbleSectionsExist,
            getBubbleKeysForCenter,
            getPrototypeLookaheadKeysForCenter: getSectionWorldLookaheadKeysForCenter,
            makeSectionKey,
            parseSectionKey,
            ensurePrototypeSectionExists,
            applyRawPrototypeSectionAssetToStateAsset,
            reassignHydratedPrototypeAssetRecordIds,
            addSparseNodesForSection,
            refreshSparseNodesForSectionAsset,
            rebuildPrototypeAssetObjectNameRegistry,
            rebuildPrototypeFloorRuntime,
            createPrototypeImplicitGroundFloorFragment,
            doesPrototypeNodeBelongToFloorFragment,
            startSparseNodeBuildForSection,
            addSparseNodeBuildBatchForSection,
            commitSparseNodeBuildForSection,
            connectSparseNodesForSectionBatch,
            normalizePrototypeScriptingName: normalizeSectionWorldScriptingName,
            generatePrototypeBubbleUniqueObjectName,
            resolvePrototypeActiveNamedObject,
            collectPrototypeBubbleObjectNames,
            ensurePrototypeBlockedEdges,
            applyPrototypeSectionClearanceToNodes,
            rebuildPrototypeSectionClearance,
            clonePrototypeFloorRecords,
            clonePrototypeFloorHoleRecords,
            clonePrototypeFloorVoidRecords,
            clonePrototypeBlockedEdges,
            clonePrototypeClearanceByTile,
            clonePrototypeFloorTransitions,
            clearPrototypeRuntimeStateForReload,
            getPrototypeConfig: getSectionWorldConfig,
            buildSectionStateFromAssetBundle,
            createPrototypeState,
            assignNodesToSections,
            buildPrototypeSummary,
            initializePrototypeRuntimeState,
            setActiveCenter
        });
        installSectionWorldTraversalApis(map, { globalScope });
        map.rebuildPrototypeTriggerRegistry = function rebuildPrototypeTriggerRegistry(triggerDefinitions = null) {
            return rebuildPrototypeTriggerRegistryState(this, triggerDefinitions);
        };
        map.getPrototypeTriggerDefById = function getPrototypeTriggerDefById(triggerId) {
            const triggerState = this._prototypeTriggerState;
            if (!triggerState || !(triggerState.triggerDefsById instanceof Map)) return null;
            return triggerState.triggerDefsById.get(Number(triggerId)) || null;
        };
        map.getPrototypeTriggerDefsForSectionKeys = function getPrototypeTriggerDefsForSectionKeys(sectionKeys) {
            const triggerState = this._prototypeTriggerState;
            if (!triggerState || !(triggerState.triggerIdsBySectionKey instanceof Map)) return [];
            const keys = Array.isArray(sectionKeys)
                ? sectionKeys
                : (sectionKeys instanceof Set ? Array.from(sectionKeys) : []);
            const out = [];
            const seenIds = new Set();
            for (let i = 0; i < keys.length; i++) {
                const triggerIds = triggerState.triggerIdsBySectionKey.get(keys[i]);
                if (!(triggerIds instanceof Set)) continue;
                for (const triggerId of triggerIds.values()) {
                    if (seenIds.has(triggerId)) continue;
                    const def = triggerState.triggerDefsById.get(triggerId) || null;
                    if (!def) continue;
                    seenIds.add(triggerId);
                    out.push(def);
                }
            }
            return out;
        };
        map.exportPrototypeTriggerDefinitions = function exportPrototypeTriggerDefinitions() {
            const triggerState = this._prototypeTriggerState;
            if (!triggerState || !(triggerState.triggerDefsById instanceof Map)) return [];
            return Array.from(triggerState.triggerDefsById.values())
                .sort((a, b) => (Number(a && a.id) || 0) - (Number(b && b.id) || 0))
                .map((record) => {
                    const exported = {
                        id: Number(record && record.id) || 0,
                        type: "triggerArea",
                        x: Number(record && record.x) || 0,
                        y: Number(record && record.y) || 0,
                        points: Array.isArray(record && record.points) ? record.points.map((point) => ({ ...point })) : [],
                        coverageSectionKeys: Array.isArray(record && record.coverageSectionKeys) ? record.coverageSectionKeys.slice() : []
                    };
                    if (record && record.script && typeof record.script === "object") {
                        exported.script = JSON.parse(JSON.stringify(record.script));
                    }
                    if (typeof (record && record.scriptingName) === "string" && record.scriptingName.trim().length > 0) {
                        exported.scriptingName = record.scriptingName.trim();
                    }
                    return exported;
                });
        };
        map.refreshPrototypeActiveTriggerSetForActor = function refreshPrototypeActiveTriggerSetForActor(actor, options = {}) {
            if (!actor || !this._prototypeTriggerState) return [];
            const force = !!(options && options.force === true);
            const sectionKey = (typeof this.getPrototypeSectionKeyForWorldPoint === "function")
                ? this.getPrototypeSectionKeyForWorldPoint(actor.x, actor.y)
                : "";
            const registryVersion = Number(this._prototypeTriggerState.registryVersion) || 0;
            if (
                !force &&
                actor._prototypeActiveTriggerSectionKey === sectionKey &&
                actor._prototypeActiveTriggerRegistryVersion === registryVersion &&
                Array.isArray(actor._prototypeActiveTriggerTraversalEntries)
            ) {
                return actor._prototypeActiveTriggerTraversalEntries;
            }
            const defs = sectionKey ? this.getPrototypeTriggerDefsForSectionKeys([sectionKey]) : [];
            const entries = defs.map((def) => ({
                obj: def,
                hitbox: def && def._prototypeTriggerHitbox ? def._prototypeTriggerHitbox : buildPrototypeTriggerTraversalHitbox(def && def.points)
            }));
            actor._prototypeActiveTriggerSectionKey = sectionKey || "";
            actor._prototypeActiveTriggerRegistryVersion = registryVersion;
            actor._prototypeActiveTriggerTraversalEntries = entries;
            return entries;
        };
        map.getPrototypeActiveTriggerTraversalEntriesForActor = function getPrototypeActiveTriggerTraversalEntriesForActor(actor, options = {}) {
            return this.refreshPrototypeActiveTriggerSetForActor(actor, options);
        };
        map.getPrototypeActiveTriggerDisplayObjectsForActor = function getPrototypeActiveTriggerDisplayObjectsForActor(actor, options = {}) {
            if (!actor || !this._prototypeTriggerState) return [];
            const entries = this.refreshPrototypeActiveTriggerSetForActor(actor, options);
            const out = [];
            for (let i = 0; i < entries.length; i++) {
                const entry = entries[i];
                const displayObj = entry && entry.obj ? getPrototypeTriggerDisplayObject(this, entry.obj.id) : null;
                if (displayObj) out.push(displayObj);
            }
            return out;
        };
        map.setPrototypeActiveCenterKey = function setPrototypeActiveCenterKey(nextCenterKey) {
            return setActiveCenter(this, nextCenterKey);
        };
        const bubbleSyncHelpers = createSectionWorldBubbleSyncHelpers(map, {
            updatePrototypeGpuDebugStats,
            updatePrototypeSeamSegmentsForSections,
            applyPrototypeSectionClearanceChunk,
            sortPrototypeLoadedNodes
        });
        const {
            prototypeNow,
            prependPrototypeTasks,
            createPrototypeTask,
            createPrototypeAsyncBubbleShiftSession,
            advancePrototypeAsyncBubbleShiftSession,
            attachFlushPrototypeBubbleShiftSession,
            enqueuePrototypeAsyncLayoutSync,
            attachBubbleShiftControlApis
        } = bubbleSyncHelpers;
        const persistenceHelpers = createSectionWorldPersistenceHelpers(map, {
            getPrototypeParkedObjectCacheLimit: getSectionWorldParkedObjectCacheLimit,
            markPrototypeBlockedEdgesDirty,
            markPrototypeClearanceDirty,
            prototypeNow,
            rebuildPrototypeAssetObjectNameRegistry,
            shouldParkPrototypeRuntimeObject: shouldParkSectionWorldRuntimeObject
        });
        const {
            buildPrototypeObjectPersistenceSignature,
            buildPrototypeWallPersistenceSignature,
            evictPrototypeParkedRuntimeObject,
            formatPrototypeObjectProfileMap,
            getPrototypeObjectProfileKey,
            isPrototypeSavableAnimal,
            isPrototypeSavableObject,
            parkPrototypeRuntimeObject,
            prunePrototypeAnimalRuntimeRecord,
            removePrototypeObjectRecordById,
            removePrototypeRecordById,
            removePrototypeRoofRuntime,
            restorePrototypeParkedRuntimeObject,
            sanitizePrototypeObjectRecords,
            trimPrototypeParkedRuntimeObjectCache,
            upsertPrototypeAnimalRecord,
            upsertPrototypeObjectRecord
        } = persistenceHelpers;
        const asyncSyncPlanners = createSectionWorldAsyncSyncPlanners(map, {
            applyPrototypeBlockedEdgesForSection,
            applyPrototypeSectionClearanceChunk,
            buildPrototypeObjectPersistenceSignature,
            buildPrototypeWallPersistenceSignature,
            canReusePrototypeParkedRuntimeObject: canReuseSectionWorldParkedRuntimeObject,
            evictPrototypeParkedRuntimeObject,
            getPrototypeObjectProfileKey,
            isPrototypeSavableObject,
            parkPrototypeRuntimeObject,
            createPrototypeTask,
            prependPrototypeTasks,
            prototypeNow,
            removePrototypeBlockedEdgesForSection,
            removePrototypeObjectRecordById,
            removePrototypeRoofRuntime,
            removePrototypeRuntimeWallVisual,
            restorePrototypeParkedRuntimeObject,
            trimPrototypeParkedRuntimeObjectCache,
            upsertPrototypeObjectRecord
        });
        const {
            enqueuePrototypeAsyncObjectSync: enqueuePrototypeAsyncObjectSyncPlanner,
            enqueuePrototypeAsyncWallSync: enqueuePrototypeAsyncWallSyncPlanner,
            enqueuePrototypeAsyncAnimalSync: enqueuePrototypeAsyncAnimalSyncPlanner,
            enqueuePrototypeAsyncPowerupSync: enqueuePrototypeAsyncPowerupSyncPlanner
        } = asyncSyncPlanners;
        attachFlushPrototypeBubbleShiftSession();
        attachBubbleShiftControlApis({
            updateActiveBubbleForActor,
            enqueuePrototypeAsyncWallSync: enqueuePrototypeAsyncWallSyncPlanner,
            enqueuePrototypeAsyncObjectSync: enqueuePrototypeAsyncObjectSyncPlanner,
            enqueuePrototypeAsyncAnimalSync: enqueuePrototypeAsyncAnimalSyncPlanner,
            enqueuePrototypeAsyncPowerupSync: enqueuePrototypeAsyncPowerupSyncPlanner
        });
        initializePrototypeRuntimeState(map, prototypeState);
        installSectionWorldRuntimeRecordApis(map, {
            buildPrototypeObjectPersistenceSignature,
            buildPrototypeWallPersistenceSignature,
            isPrototypeSavableAnimal,
            isPrototypeSavableObject,
            markPrototypeBlockedEdgesDirty,
            markPrototypeClearanceDirty,
            prototypeNow,
            prunePrototypeAnimalRuntimeRecord,
            removePrototypeObjectRecordById,
            removePrototypeRecordById,
            settlePendingPrototypeLayoutTransition,
            upsertPrototypeAnimalRecord,
            upsertPrototypeObjectRecord
        });
        installSectionWorldEntitySyncApis(map, {
            applyPrototypeBlockedEdgesForSection,
            buildPrototypeObjectPersistenceSignature,
            buildPrototypeWallPersistenceSignature,
            canReusePrototypeParkedRuntimeObject: canReuseSectionWorldParkedRuntimeObject,
            ensurePrototypeBlockedEdgeState,
            evictPrototypeParkedRuntimeObject,
            formatPrototypeObjectProfileMap,
            getPrototypeObjectProfileKey,
            isPrototypeSavableObject,
            parkPrototypeRuntimeObject,
            prototypeNow,
            removePrototypeBlockedEdgesForSection,
            removePrototypeRoofRuntime,
            removePrototypeRuntimeWallVisual,
            restorePrototypeParkedRuntimeObject,
            sanitizePrototypeObjectRecords,
            settlePendingPrototypeLayoutTransition,
            trimPrototypeParkedRuntimeObjectCache,
            upsertPrototypeObjectRecord
        });
    }

    async function loadSectionWorld(map) {
        const config = getSectionWorldConfig();
        const textureCount = getPrototypeGroundTextureCount(map);
        let sectionStateSource = null;
        if (config.sectionAssetUrl) {
            let assetBundle = await loadPrototypeSectionAssetBundle(config.sectionAssetUrl);
            if (!assetBundle && config.fallbackSectionAssetUrl) {
                assetBundle = await loadPrototypeSectionAssetBundle(config.fallbackSectionAssetUrl);
            }
            if (assetBundle) {
                sectionStateSource = buildSectionStateFromAssetBundle(assetBundle, config, map);
            }
        } else {
            const sectionRecords = buildSectionRecords(config, map);
            const sectionAssets = buildPrototypeSectionAssets(sectionRecords, config.sectionRadius);
            for (let i = 0; i < sectionAssets.orderedSectionAssets.length; i++) {
                const asset = sectionAssets.orderedSectionAssets[i];
                if (!asset) continue;
                asset.groundTiles = normalizePrototypeGroundTiles(asset.groundTiles, asset.tileCoordKeys, textureCount);
            }
            sectionStateSource = {
                radius: config.sectionRadius,
                sectionGraphRadius: config.sectionGraphRadius,
                basis: sectionRecords.basis,
                sectionCoords: sectionRecords.sectionCoords,
                sectionsByKey: sectionRecords.sectionsByKey,
                orderedSections: sectionRecords.orderedSections,
                sectionAssetsByKey: sectionAssets.sectionAssetsByKey,
                orderedSectionAssets: sectionAssets.orderedSectionAssets,
                anchorCenter: sectionRecords.anchorCenter
            };
        }
        if (!sectionStateSource) {
            const sectionRecords = buildSectionRecords(config, map);
            const sectionAssets = buildPrototypeSectionAssets(sectionRecords, config.sectionRadius);
            for (let i = 0; i < sectionAssets.orderedSectionAssets.length; i++) {
                const asset = sectionAssets.orderedSectionAssets[i];
                if (!asset) continue;
                asset.groundTiles = normalizePrototypeGroundTiles(asset.groundTiles, asset.tileCoordKeys, textureCount);
            }
            sectionStateSource = {
                radius: config.sectionRadius,
                sectionGraphRadius: config.sectionGraphRadius,
                basis: sectionRecords.basis,
                sectionCoords: sectionRecords.sectionCoords,
                sectionsByKey: sectionRecords.sectionsByKey,
                orderedSections: sectionRecords.orderedSections,
                sectionAssetsByKey: sectionAssets.sectionAssetsByKey,
                orderedSectionAssets: sectionAssets.orderedSectionAssets,
                anchorCenter: sectionRecords.anchorCenter
            };
        }
        const manifest = getPrototypeManifest(sectionStateSource);
        const initialCenterKey = (typeof manifest.activeCenterKey === "string" && manifest.activeCenterKey.length > 0)
            ? manifest.activeCenterKey
            : makeSectionKey({ q: 0, r: 0 });
        const prototypeState = createPrototypeState(sectionStateSource, initialCenterKey);

        assignNodesToSections(map, prototypeState);
        attachSectionWorldApis(map, prototypeState);
        if (typeof map.ensurePrototypeBlockedEdges === "function") {
            map.ensurePrototypeBlockedEdges();
        }
        setActiveCenter(map, prototypeState.activeCenterKey);
        map.syncPrototypeWalls();
        map.syncPrototypeObjects();
        if (typeof map.syncPrototypeAnimals === "function") {
            map.syncPrototypeAnimals();
        }
        if (typeof map.syncPrototypePowerups === "function") {
            map.syncPrototypePowerups();
        }

        if (manifest.wizard && typeof manifest.wizard === "object") {
            globalScope.RUNAROUND_PROTOTYPE_WIZARD_STATE = JSON.parse(JSON.stringify(manifest.wizard));
        } else {
            globalScope.RUNAROUND_PROTOTYPE_WIZARD_STATE = null;
        }

        const savedMazeMode = (
            manifest &&
            manifest.los &&
            typeof manifest.los === "object" &&
            typeof manifest.los.mazeMode === "boolean"
        ) ? manifest.los.mazeMode : null;
        if (typeof globalScope.applySavedLosMazeModeValue === "function") {
            globalScope.applySavedLosMazeModeValue(savedMazeMode);
        }

        if (manifest.wizard && Number.isFinite(manifest.wizard.x) && Number.isFinite(manifest.wizard.y)) {
            globalScope.RUNAROUND_PROTOTYPE_SPAWN = {
                x: Number(manifest.wizard.x),
                y: Number(manifest.wizard.y)
            };
        } else {
            const spawn = axialToEvenQOffset(sectionStateSource.anchorCenter);
            globalScope.RUNAROUND_PROTOTYPE_SPAWN = { x: spawn.x, y: spawn.y };
        }
    }

    function bootstrapSectionWorldApisWithoutWorldLoad(map) {
        if (!map) return null;
        clearMapForSectionWorld(map);
        const config = getSectionWorldConfig();
        const emptyState = createPrototypeState({
            radius: config.sectionRadius,
            sectionGraphRadius: config.sectionGraphRadius,
            basis: getSectionBasisVectors(config.sectionRadius),
            sectionCoords: [],
            sectionsByKey: new Map(),
            orderedSections: [],
            sectionAssetsByKey: new Map(),
            orderedSectionAssets: [],
            anchorCenter: { q: 0, r: 0 },
            nextRecordIds: { walls: 1, objects: 1, animals: 1, powerups: 1 }
        }, makeSectionKey({ q: 0, r: 0 }));
        attachSectionWorldApis(map, emptyState);
        globalScope.RUNAROUND_PROTOTYPE_WIZARD_STATE = null;
        globalScope.RUNAROUND_PROTOTYPE_SPAWN = {
            x: Math.max(0, Math.floor((Number(map.width) || 0) * 0.5)),
            y: Math.max(0, Math.floor((Number(map.height) || 0) * 0.5))
        };
        finishPrototypeSetup(map);
        return map._sectionWorld || null;
    }

    function finishPrototypeSetup(map) {
        if (!map) return;
        map._suppressClearanceUpdates = false;
        if (typeof map.applyPrototypeSectionClearance === "function") {
            map.applyPrototypeSectionClearance();
        } else if (typeof map.computeClearance === "function") {
            map.computeClearance();
        }
        if (typeof map.rebuildGameObjectRegistry === "function") {
            map.rebuildGameObjectRegistry();
        }
        if (typeof globalScope.invalidateMinimap === "function") {
            globalScope.invalidateMinimap();
        }
    }

    globalScope.buildSectionWorld = async function buildSectionWorld(map) {
        if (!map) return null;
        clearMapForSectionWorld(map);
        await loadSectionWorld(map);
        finishPrototypeSetup(map);
        return map._sectionWorld || null;
    };
    globalScope.bootstrapSectionWorldApis = function bootstrapSectionWorldApis(map) {
        return bootstrapSectionWorldApisWithoutWorldLoad(map);
    };
    // Keep legacy entry points alive while the rest of the app migrates to the
    // newer sectionWorld naming.
    globalScope.buildTwoSectionPrototypeWorld = globalScope.buildSectionWorld;
    globalScope.bootstrapTwoSectionPrototypeApis = globalScope.bootstrapSectionWorldApis;
    globalScope.__sectionWorldTestHooks = {
        attachSectionWorldApis,
        attachPrototypeApis: attachSectionWorldApis,
        canReuseSectionWorldParkedRuntimeObject,
        canReusePrototypeParkedRuntimeObject: canReuseSectionWorldParkedRuntimeObject,
        createPrototypeState,
        getSectionWorldParkedObjectCacheLimit,
        getPrototypeParkedObjectCacheLimit: getSectionWorldParkedObjectCacheLimit,
        initializePrototypeRuntimeState,
        shouldParkSectionWorldRuntimeObject,
        shouldParkPrototypeRuntimeObject: shouldParkSectionWorldRuntimeObject
    };
    globalScope.__twoSectionPrototypeTestHooks = globalScope.__sectionWorldTestHooks;
})(typeof globalThis !== "undefined" ? globalThis : window);

if (typeof module !== "undefined" && module.exports) {
    module.exports = globalThis.__sectionWorldTestHooks;
}
