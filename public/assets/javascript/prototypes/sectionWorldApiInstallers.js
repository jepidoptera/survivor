(function (globalScope) {
    "use strict";

    function installSectionWorldSectionApis(map, deps) {
        const {
            globalScope: runtimeGlobalScope,
            ensurePrototypeBubbleSectionsExist,
            getBubbleKeysForCenter,
            getPrototypeLookaheadKeysForCenter,
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
            normalizePrototypeScriptingName,
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
            getPrototypeConfig,
            buildSectionStateFromAssetBundle,
            createPrototypeState,
            assignNodesToSections,
            buildPrototypeSummary,
            initializePrototypeRuntimeState,
            installSectionWorldBuildingApis,
            setActiveCenter
        } = deps;

        map.getPrototypeActiveSectionKeys = function getPrototypeActiveSectionKeys() {
            if (!this._prototypeSectionState) return new Set();
            const state = this._prototypeSectionState;
            if (
                state.pendingLayoutTransition &&
                state.actualActiveSectionKeys instanceof Set &&
                state.actualActiveSectionKeys.size > 0
            ) {
                const unionKeys = new Set(state.actualActiveSectionKeys);
                if (state.activeSectionKeys instanceof Set) {
                    state.activeSectionKeys.forEach((key) => unionKeys.add(key));
                }
                if (state.pendingLayoutTransition.targetActiveKeys instanceof Set) {
                    state.pendingLayoutTransition.targetActiveKeys.forEach((key) => unionKeys.add(key));
                }
                return unionKeys;
            }
            return new Set(state.activeSectionKeys);
        };
        map.getPrototypeBubbleSectionKeys = function getPrototypeBubbleSectionKeys(centerSectionKey = null) {
            const state = this._prototypeSectionState;
            if (!state) return new Set();
            if (
                (
                    !(typeof centerSectionKey === "string" && centerSectionKey.length > 0) ||
                    centerSectionKey === state.activeCenterKey
                ) &&
                state.activeBubbleSectionKeys instanceof Set &&
                state.activeBubbleSectionKeys.size > 0
            ) {
                return new Set(state.activeBubbleSectionKeys);
            }
            const key = (typeof centerSectionKey === "string" && centerSectionKey.length > 0)
                ? centerSectionKey
                : state.activeCenterKey;
            ensurePrototypeBubbleSectionsExist(this, state, key);
            return getBubbleKeysForCenter(state, key);
        };
        map.collectPrototypeBubbleSectionKeys = function collectPrototypeBubbleSectionKeys(centerSectionKey = null) {
            const state = this._prototypeSectionState;
            if (!state) return new Set();
            if (
                (
                    !(typeof centerSectionKey === "string" && centerSectionKey.length > 0) ||
                    centerSectionKey === state.activeCenterKey
                ) &&
                state.activeBubbleSectionKeys instanceof Set &&
                state.activeBubbleSectionKeys.size > 0
            ) {
                return new Set(state.activeBubbleSectionKeys);
            }
            const key = (typeof centerSectionKey === "string" && centerSectionKey.length > 0)
                ? centerSectionKey
                : state.activeCenterKey;
            if (typeof key !== "string" || key.length === 0) return new Set();
            return getBubbleKeysForCenter(state, key);
        };
        map.getPrototypeLookaheadSectionKeys = function getPrototypeLookaheadSectionKeys(centerSectionKey = null) {
            const state = this._prototypeSectionState;
            if (!state) return new Set();
            const key = (typeof centerSectionKey === "string" && centerSectionKey.length > 0)
                ? centerSectionKey
                : state.activeCenterKey;
            ensurePrototypeBubbleSectionsExist(this, state, key);
            return getPrototypeLookaheadKeysForCenter(state, key);
        };
        map.getPrototypeSectionAsset = function getPrototypeSectionAsset(sectionKey) {
            const state = this._prototypeSectionState;
            if (!state || !(state.sectionAssetsByKey instanceof Map)) return null;
            return state.sectionAssetsByKey.get(sectionKey) || null;
        };
        map.materializePrototypeSectionNodes = function materializePrototypeSectionNodes(sectionKeys) {
            const state = this._prototypeSectionState;
            if (!state || state.useSparseNodes !== true) return 0;
            const normalizedSectionKeys = Array.isArray(sectionKeys)
                ? sectionKeys
                    .map((key) => String(key || "").trim())
                    .filter((key, index, array) => key.length > 0 && array.indexOf(key) === index)
                : [];
            if (normalizedSectionKeys.length === 0) return 0;
            let materializedCount = 0;
            for (let i = 0; i < normalizedSectionKeys.length; i++) {
                const sectionKey = normalizedSectionKeys[i];
                let asset = this.getPrototypeSectionAsset(sectionKey);
                if (!asset) {
                    const coord = parseSectionKey(sectionKey);
                    ensurePrototypeSectionExists(this, state, coord);
                    asset = this.getPrototypeSectionAsset(sectionKey);
                }
                if (!asset || state.nodesBySectionKey.has(sectionKey)) continue;
                addSparseNodesForSection(this, state, asset);
                refreshSparseNodesForSectionAsset(this, state, asset);
                materializedCount += 1;
            }
            return materializedCount;
        };
        map.rebuildPrototypeFloorRuntime = function rebuildPrototypeFloorRuntimeForMap() {
            const state = this._prototypeSectionState;
            if (!state) return 0;
            rebuildPrototypeFloorRuntime(this, state);
            return 1;
        };
        map.registerSectionFloorNodes = function registerSectionFloorNodes(sectionKey) {
            const state = this._prototypeSectionState;
            if (!state) return 0;
            return this.registerFloorSection(sectionKey, state, {
                synthesizeGroundFragment: (asset) => createPrototypeImplicitGroundFloorFragment(asset, state.basis),
                doesNodeBelongToFragment: doesPrototypeNodeBelongToFloorFragment
            });
        };
        map.prepareFloorSectionFragmentsForSection = function prepareFloorSectionFragmentsForSection(sectionKey) {
            const state = this._prototypeSectionState;
            if (!state) return null;
            return this.prepareFloorSectionFragments(sectionKey, state, {
                synthesizeGroundFragment: (asset) => createPrototypeImplicitGroundFloorFragment(asset, state.basis),
                doesNodeBelongToFragment: doesPrototypeNodeBelongToFloorFragment
            });
        };
        map.addFloorSectionNodeBatchForSection = function addFloorSectionNodeBatchForSection(sectionKey, start, count) {
            const state = this._prototypeSectionState;
            if (!state) return 0;
            const sectionNodes = (state.nodesBySectionKey instanceof Map)
                ? (state.nodesBySectionKey.get(sectionKey) || []) : [];
            return this.addFloorSectionNodeBatch(sectionKey, state, sectionNodes, start, count, doesPrototypeNodeBelongToFloorFragment);
        };
        map.finalizeFloorSectionNodesForSection = function finalizeFloorSectionNodesForSection(sectionKey) {
            return this.finalizeFloorSectionNodes(sectionKey);
        };
        map.getSectionNodeCount = function getSectionNodeCount(sectionKey) {
            const state = this._prototypeSectionState;
            if (!state || !(state.nodesBySectionKey instanceof Map)) return 0;
            const nodes = state.nodesBySectionKey.get(sectionKey);
            return Array.isArray(nodes) ? nodes.length : 0;
        };
        map.getPrototypeTileKeyCount = function getPrototypeTileKeyCount(sectionKey) {
            const state = this._prototypeSectionState;
            if (!state || !(state.sectionAssetsByKey instanceof Map)) return 0;
            const asset = state.sectionAssetsByKey.get(sectionKey);
            return Array.isArray(asset && asset.tileCoordKeys) ? asset.tileCoordKeys.length : 0;
        };
        map.getSparseNodeCount = function getSparseNodeCount(sectionKey) {
            const state = this._prototypeSectionState;
            if (!state || !(state.nodesBySectionKey instanceof Map)) return 0;
            const nodes = state.nodesBySectionKey.get(sectionKey);
            return Array.isArray(nodes) ? nodes.length : 0;
        };
        map.startSparseNodeBuildForSection = function startSparseNodeBuildForSection_(sectionKey) {
            const state = this._prototypeSectionState;
            if (!state) return false;
            return startSparseNodeBuildForSection(state, sectionKey);
        };
        map.addSparseNodeBuildBatchForSection = function addSparseNodeBuildBatchForSection_(sectionKey, start, count) {
            const state = this._prototypeSectionState;
            if (!state) return 0;
            return addSparseNodeBuildBatchForSection(this, state, sectionKey, start, count);
        };
        map.commitSparseNodeBuildForSection = function commitSparseNodeBuildForSection_(sectionKey) {
            const state = this._prototypeSectionState;
            if (!state) return 0;
            return commitSparseNodeBuildForSection(this, state, sectionKey);
        };
        map.connectSparseNodesForSectionBatch = function connectSparseNodesForSectionBatch_(sectionKey, start, count) {
            const state = this._prototypeSectionState;
            if (!state) return 0;
            return connectSparseNodesForSectionBatch(state, sectionKey, start, count);
        };
        map.prepareFloorSectionUnregisterForSection = function prepareFloorSectionUnregisterForSection(sectionKey) {
            return this.prepareFloorSectionUnregister(sectionKey);
        };
        map.unregisterFloorSectionNodeBatchForSection = function unregisterFloorSectionNodeBatchForSection(sectionKey, start, count) {
            return this.unregisterFloorSectionNodeBatch(sectionKey, start, count);
        };
        map.commitFloorSectionUnregisterForSection = function commitFloorSectionUnregisterForSection(sectionKey) {
            return this.commitFloorSectionUnregister(sectionKey);
        };
        map.prepareFloorSectionConnectionForSection = function prepareFloorSectionConnectionForSection(sectionKey) {
            return this.prepareFloorSectionConnection(sectionKey);
        };
        map.connectFloorSectionNodeBatchForSection = function connectFloorSectionNodeBatchForSection(sectionKey, start, count) {
            return this.connectFloorSectionNodeBatch(sectionKey, start, count);
        };
        map.commitFloorSectionConnectionForSection = function commitFloorSectionConnectionForSection(sectionKey) {
            return this.commitFloorSectionConnection(sectionKey);
        };
        map.unregisterSectionFloorNodes = function unregisterSectionFloorNodes(sectionKey) {
            return this.unregisterFloorSection(sectionKey);
        };
        map.getPrototypeHydratedSectionKeys = function getPrototypeHydratedSectionKeys() {
            const state = this._prototypeSectionState;
            if (!state || !(state.loadedSectionAssetKeys instanceof Set)) return [];
            return Array.from(state.loadedSectionAssetKeys);
        };
        map.setPrototypeSectionAssetLoader = function setPrototypeSectionAssetLoader(loader) {
            const state = this._prototypeSectionState;
            if (!state) return false;
            state.sectionAssetLoader = (typeof loader === "function") ? loader : null;
            if (!(state.pendingSectionHydrations instanceof Map)) {
                state.pendingSectionHydrations = new Map();
            }
            return true;
        };
        map.hydratePrototypeSectionAssets = async function hydratePrototypeSectionAssets(sectionKeys, options = {}) {
            const state = this._prototypeSectionState;
            if (!state || typeof state.sectionAssetLoader !== "function") return [];
            if (!(state.pendingSectionHydrations instanceof Map)) {
                state.pendingSectionHydrations = new Map();
            }
            const materialize = options && options.materialize === false ? false : true;
            const normalizedSectionKeys = Array.isArray(sectionKeys)
                ? sectionKeys
                    .map((key) => String(key || "").trim())
                    .filter((key, index, array) => key.length > 0 && array.indexOf(key) === index)
                : [];
            if (normalizedSectionKeys.length === 0) return [];

            const missingKeys = [];
            const pendingPromises = [];
            for (let i = 0; i < normalizedSectionKeys.length; i++) {
                const sectionKey = normalizedSectionKeys[i];
                const asset = this.getPrototypeSectionAsset(sectionKey);
                if (asset && asset._prototypeSectionHydrated === true) continue;
                if (state.pendingSectionHydrations.has(sectionKey)) {
                    pendingPromises.push(state.pendingSectionHydrations.get(sectionKey));
                    continue;
                }
                missingKeys.push(sectionKey);
            }

            if (missingKeys.length > 0) {
                const requestPromise = Promise.resolve(state.sectionAssetLoader(missingKeys)).then((records) => {
                    const loadedKeys = [];
                    const recordsByKey = new Map();
                    if (Array.isArray(records)) {
                        for (let i = 0; i < records.length; i++) {
                            const record = records[i];
                            const recordKey = (record && typeof record.key === "string" && record.key.length > 0)
                                ? record.key
                                : makeSectionKey(record && record.coord);
                            if (!recordKey.length) continue;
                            recordsByKey.set(recordKey, record);
                        }
                    }
                    for (let i = 0; i < missingKeys.length; i++) {
                        const sectionKey = missingKeys[i];
                        const rawAsset = recordsByKey.get(sectionKey);
                        if (!rawAsset) continue;
                        let asset = this.getPrototypeSectionAsset(sectionKey);
                        if (!asset) {
                            const coord = parseSectionKey(sectionKey);
                            ensurePrototypeSectionExists(this, state, coord);
                            asset = this.getPrototypeSectionAsset(sectionKey);
                        }
                        if (!asset) continue;
                        applyRawPrototypeSectionAssetToStateAsset(asset, rawAsset, this, state.basis);
                        reassignHydratedPrototypeAssetRecordIds(this, asset);
                        if (typeof this.syncPrototypeBuildingPlacementRefs === "function") {
                            this.syncPrototypeBuildingPlacementRefs();
                        }
                        if (materialize && state.useSparseNodes === true) {
                            addSparseNodesForSection(this, state, asset);
                            refreshSparseNodesForSectionAsset(this, state, asset);
                        }
                        rebuildPrototypeAssetObjectNameRegistry(asset);
                        state.loadedSectionAssetKeys.add(sectionKey);
                        loadedKeys.push(sectionKey);
                    }
                    if (loadedKeys.length > 0 && materialize) {
                        rebuildPrototypeFloorRuntime(this, state);
                        const activeSectionKeys = this.getPrototypeActiveSectionKeys();
                        const loadedActiveKeys = loadedKeys.filter((key) => activeSectionKeys.has(key));
                        if (loadedActiveKeys.length > 0) {
                            if (typeof this.ensurePrototypeBlockedEdges === "function") {
                                this.ensurePrototypeBlockedEdges(new Set(loadedActiveKeys));
                            }
                            if (typeof this.syncPrototypeWalls === "function") {
                                this.syncPrototypeWalls();
                            }
                            if (typeof this.syncPrototypeObjects === "function") {
                                this.syncPrototypeObjects();
                            }
                            if (typeof this.syncPrototypeAnimals === "function") {
                                this.syncPrototypeAnimals();
                            }
                            if (typeof this.syncPrototypePowerups === "function") {
                                this.syncPrototypePowerups();
                            }
                            if (typeof this.ensurePrototypeBuildingPlacementsForSectionKeys === "function") {
                                this.ensurePrototypeBuildingPlacementsForSectionKeys(new Set(loadedActiveKeys)).catch((error) => {
                                    console.error("[prototype building hydrate]", error && error.message ? error.message : error);
                                });
                            }
                            if (typeof this.applyPrototypeSectionClearance === "function") {
                                this.applyPrototypeSectionClearance(new Set(loadedActiveKeys));
                            }
                        }
                        if (typeof runtimeGlobalScope.invalidateMinimap === "function") {
                            runtimeGlobalScope.invalidateMinimap();
                        }
                    }
                    return loadedKeys;
                }).finally(() => {
                    for (let i = 0; i < missingKeys.length; i++) {
                        state.pendingSectionHydrations.delete(missingKeys[i]);
                    }
                });
                for (let i = 0; i < missingKeys.length; i++) {
                    state.pendingSectionHydrations.set(missingKeys[i], requestPromise);
                }
                pendingPromises.push(requestPromise);
            }

            if (pendingPromises.length === 0) return [];
            const loadedKeyGroups = await Promise.all(pendingPromises);
            const loadedKeySet = new Set();
            for (let i = 0; i < loadedKeyGroups.length; i++) {
                const group = Array.isArray(loadedKeyGroups[i]) ? loadedKeyGroups[i] : [];
                for (let j = 0; j < group.length; j++) {
                    loadedKeySet.add(group[j]);
                }
            }
            return Array.from(loadedKeySet);
        };
        map.prefetchPrototypeSectionAssets = function prefetchPrototypeSectionAssets(sectionKeys, options = {}) {
            this.hydratePrototypeSectionAssets(sectionKeys, options).catch(() => {});
        };
        map.rebuildPrototypeSectionObjectNameRegistry = function rebuildPrototypeSectionObjectNameRegistry(sectionKey = null) {
            const state = this._prototypeSectionState;
            if (!state || !(state.sectionAssetsByKey instanceof Map)) return new Map();
            if (typeof sectionKey === "string" && sectionKey.length > 0) {
                const asset = state.sectionAssetsByKey.get(sectionKey) || null;
                return rebuildPrototypeAssetObjectNameRegistry(asset);
            }
            const out = new Map();
            for (const [key, asset] of state.sectionAssetsByKey.entries()) {
                out.set(key, rebuildPrototypeAssetObjectNameRegistry(asset));
            }
            return out;
        };
        map.generatePrototypeObjectScriptingName = function generatePrototypeObjectScriptingName(baseName, targetSectionKey, options = {}) {
            const state = this._prototypeSectionState;
            if (!state || typeof targetSectionKey !== "string" || targetSectionKey.length === 0) return "";
            return generatePrototypeBubbleUniqueObjectName(this, state, targetSectionKey, baseName, options);
        };
        map.findPrototypeNamedObjectInBubble = function findPrototypeNamedObjectInBubble(name, centerSectionKey = null) {
            const state = this._prototypeSectionState;
            if (!state) return null;
            return resolvePrototypeActiveNamedObject(this, state, name, centerSectionKey);
        };

        const markPrototypeRuntimeTargetDirty = (target) => {
            if (!target || typeof target !== "object" || target.gone || target._prototypeRuntimeRecord !== true) {
                return false;
            }
            target._prototypeDirty = true;
            if (target._prototypeObjectManaged === true && map._prototypeObjectState) {
                if (!(map._prototypeObjectState.dirtyRuntimeObjects instanceof Set)) {
                    map._prototypeObjectState.dirtyRuntimeObjects = new Set();
                }
                map._prototypeObjectState.dirtyRuntimeObjects.add(target);
                map._prototypeObjectState.captureScanNeeded = true;
            }
            return true;
        };

        map.setPrototypeRuntimeObjectScriptingName = function setPrototypeRuntimeObjectScriptingName(target, rawName, options = {}) {
            if (!target || typeof target !== "object") return false;
            const state = this._prototypeSectionState;
            if (!state) return false;
            const nextName = normalizePrototypeScriptingName(rawName);
            const restoreFromSave = !!(options && options.restoreFromSave === true);
            const skipBubbleEnsureOnRestore = !!(
                restoreFromSave &&
                options &&
                options.skipBubbleEnsureOnRestore === true
            );
            const targetSectionKey = (typeof options.targetSectionKey === "string" && options.targetSectionKey.length > 0)
                ? options.targetSectionKey
                : (
                    (typeof target._prototypeOwnerSectionKey === "string" && target._prototypeOwnerSectionKey.length > 0)
                        ? target._prototypeOwnerSectionKey
                        : this.getPrototypeSectionKeyForWorldPoint(target.x, target.y)
                );
            if (!targetSectionKey) return false;
            if (!nextName) {
                target.scriptingName = "";
                markPrototypeRuntimeTargetDirty(target);
                return true;
            }
            if (!skipBubbleEnsureOnRestore) {
                ensurePrototypeBubbleSectionsExist(this, state, targetSectionKey);
            }
            if (restoreFromSave) {
                target.scriptingName = nextName;
                markPrototypeRuntimeTargetDirty(target);
                return true;
            }
            const existing = resolvePrototypeActiveNamedObject(this, state, nextName, targetSectionKey);
            const existingSharesRecord = existing && Number.isInteger(Number(target._prototypeRecordId)) &&
                Number(existing._prototypeRecordId) === Number(target._prototypeRecordId);
            if (existing && existing !== target && !existingSharesRecord) return false;
            const usedNames = collectPrototypeBubbleObjectNames(this, state, targetSectionKey, {
                ignoreRuntimeObj: target,
                ignoreRecordId: Number.isInteger(target && target._prototypeRecordId)
                    ? Number(target._prototypeRecordId)
                    : null
            });
            if (usedNames.has(nextName)) return false;
            target.scriptingName = nextName;
            markPrototypeRuntimeTargetDirty(target);
            return true;
        };
        map.ensurePrototypeBlockedEdges = function ensurePrototypeBlockedEdgesForMap(sectionKeys = null) {
            return ensurePrototypeBlockedEdges(this, sectionKeys);
        };
        map.applyPrototypeSectionClearance = function applyPrototypeSectionClearanceForMap(sectionKeys = null) {
            return applyPrototypeSectionClearanceToNodes(this, sectionKeys);
        };
        map.rebuildPrototypeSectionClearance = function rebuildPrototypeSectionClearanceForMap(sectionKeys = null) {
            return rebuildPrototypeSectionClearance(this, sectionKeys);
        };
        map.ensurePrototypeSectionClearance = function ensurePrototypeSectionClearanceForMap(sectionKeys = null) {
            return rebuildPrototypeSectionClearance(this, sectionKeys);
        };
        const clonePrototypeExportObjectRecord = (obj) => {
            return obj && typeof obj === "object" ? JSON.parse(JSON.stringify(obj)) : obj;
        };
        const normalizeRoadPathExportPoint = (raw, label) => {
            const x = Number(raw && raw.x);
            const y = Number(raw && raw.y);
            if (!Number.isFinite(x) || !Number.isFinite(y)) {
                throw new Error(`${label} requires finite x/y`);
            }
            return { x, y };
        };
        const getRoadPathExportSectionPolygon = (mapRef, sectionKey) => {
            const state = mapRef && mapRef._prototypeSectionState ? mapRef._prototypeSectionState : null;
            const asset = mapRef && typeof mapRef.getPrototypeSectionAsset === "function"
                ? mapRef.getPrototypeSectionAsset(sectionKey)
                : null;
            const geometry = runtimeGlobalScope && runtimeGlobalScope.__sectionGeometry
                ? runtimeGlobalScope.__sectionGeometry
                : null;
            if (
                !state ||
                !state.basis ||
                !asset ||
                !asset.centerAxial ||
                !geometry ||
                typeof geometry.getSectionHexagonCorners !== "function"
            ) {
                throw new Error(`Cannot split exported road path for section ${sectionKey}; section polygon geometry is unavailable.`);
            }
            const polygon = geometry.getSectionHexagonCorners(asset.centerAxial, state.basis);
            if (!Array.isArray(polygon) || polygon.length < 3) {
                throw new Error(`Cannot split exported road path for section ${sectionKey}; section polygon is invalid.`);
            }
            return polygon.map((point, index) => normalizeRoadPathExportPoint(point, `section ${sectionKey} polygon point ${index}`));
        };
        const roadPathExportSegmentIntersectionT = (a, b, c, d) => {
            const ax = Number(a.x);
            const ay = Number(a.y);
            const bx = Number(b.x);
            const by = Number(b.y);
            const cx = Number(c.x);
            const cy = Number(c.y);
            const dx = Number(d.x);
            const dy = Number(d.y);
            const rx = bx - ax;
            const ry = by - ay;
            const sx = dx - cx;
            const sy = dy - cy;
            const denom = (rx * sy) - (ry * sx);
            if (Math.abs(denom) <= 1e-9) return null;
            const qpx = cx - ax;
            const qpy = cy - ay;
            const t = ((qpx * sy) - (qpy * sx)) / denom;
            const u = ((qpx * ry) - (qpy * rx)) / denom;
            const eps = 1e-9;
            if (t <= eps || t >= 1 - eps || u < -eps || u > 1 + eps) return null;
            return Math.max(0, Math.min(1, t));
        };
        const splitRoadPathExportPointsAtPolygon = (points, polygon) => {
            const out = [];
            for (let i = 0; i < points.length - 1; i++) {
                const start = points[i];
                const end = points[i + 1];
                if (i === 0) out.push({ x: start.x, y: start.y });
                const cuts = [];
                for (let e = 0; e < polygon.length; e++) {
                    const t = roadPathExportSegmentIntersectionT(start, end, polygon[e], polygon[(e + 1) % polygon.length]);
                    if (t === null) continue;
                    if (!cuts.some((existing) => Math.abs(existing - t) <= 1e-7)) cuts.push(t);
                }
                cuts.sort((a, b) => a - b);
                for (let c = 0; c < cuts.length; c++) {
                    const t = cuts[c];
                    out.push({
                        x: start.x + ((end.x - start.x) * t),
                        y: start.y + ((end.y - start.y) * t)
                    });
                }
                out.push({ x: end.x, y: end.y });
            }
            const deduped = [];
            for (let i = 0; i < out.length; i++) {
                const point = out[i];
                const prev = deduped[deduped.length - 1];
                if (!prev || Math.hypot(point.x - prev.x, point.y - prev.y) > 1e-7) deduped.push(point);
            }
            return deduped;
        };
        const splitRoadPathExportRecord = (mapRef, record, ownerSectionKey) => {
            if (!record || record.type !== "roadPath") {
                return [{ sectionKey: ownerSectionKey, record: clonePrototypeExportObjectRecord(record) }];
            }
            const rawPoints = Array.isArray(record.points)
                ? record.points
                : (Array.isArray(record.pathPoints) ? record.pathPoints : null);
            if (!rawPoints) {
                throw new Error(`Cannot export road path in section ${ownerSectionKey}; points are missing.`);
            }
            const points = rawPoints.map((point, index) => normalizeRoadPathExportPoint(point, `road path export point ${index}`));
            if (points.length < 2) {
                throw new Error(`Cannot export road path in section ${ownerSectionKey}; at least two points are required.`);
            }
            if (!mapRef || typeof mapRef.getPrototypeSectionKeyForWorldPoint !== "function") {
                throw new Error("Cannot split exported road path; section lookup is unavailable.");
            }
            const candidateKeys = new Set();
            if (typeof ownerSectionKey === "string" && ownerSectionKey.length > 0) candidateKeys.add(ownerSectionKey);
            const addCandidate = (point) => {
                const key = mapRef.getPrototypeSectionKeyForWorldPoint(point.x, point.y);
                if (typeof key === "string" && key.length > 0) candidateKeys.add(key);
            };
            for (let i = 0; i < points.length; i++) addCandidate(points[i]);
            const state = mapRef._prototypeSectionState || null;
            for (let i = 0; i < points.length - 1; i++) {
                const a = points[i];
                const b = points[i + 1];
                const mid = { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
                addCandidate(mid);
                const length = Math.hypot(b.x - a.x, b.y - a.y);
                const sampleStride = Math.max(1, Math.floor(Number(state && state.radius) || 12) * 0.75);
                const steps = Math.max(1, Math.ceil(length / sampleStride));
                for (let step = 1; step < steps; step++) {
                    const t = step / steps;
                    addCandidate({
                        x: a.x + ((b.x - a.x) * t),
                        y: a.y + ((b.y - a.y) * t)
                    });
                }
            }
            const withNeighbors = Array.from(candidateKeys);
            for (let i = 0; i < withNeighbors.length; i++) {
                const asset = mapRef.getPrototypeSectionAsset(withNeighbors[i]);
                const neighbors = Array.isArray(asset && asset.neighborKeys) ? asset.neighborKeys : [];
                for (let n = 0; n < neighbors.length; n++) {
                    if (typeof neighbors[n] === "string" && neighbors[n].length > 0) candidateKeys.add(neighbors[n]);
                }
            }
            let splitPoints = points;
            for (const sectionKey of candidateKeys) {
                splitPoints = splitRoadPathExportPointsAtPolygon(
                    splitPoints,
                    getRoadPathExportSectionPolygon(mapRef, sectionKey)
                );
            }
            const sequentialPieces = [];
            for (let i = 0; i < splitPoints.length - 1; i++) {
                const a = splitPoints[i];
                const b = splitPoints[i + 1];
                if (Math.hypot(b.x - a.x, b.y - a.y) <= 1e-7) continue;
                const mid = { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
                const sectionKey = mapRef.getPrototypeSectionKeyForWorldPoint(mid.x, mid.y);
                if (typeof sectionKey !== "string" || sectionKey.length === 0) {
                    throw new Error("Cannot export road path split span without an owning section.");
                }
                const current = sequentialPieces[sequentialPieces.length - 1] || null;
                if (current && current.sectionKey === sectionKey) {
                    current.points.push(b);
                } else {
                    sequentialPieces.push({ sectionKey, points: [a, b] });
                }
            }
            const pieces = [];
            for (let i = 0; i < sequentialPieces.length; i++) {
                const piece = sequentialPieces[i];
                const cloned = clonePrototypeExportObjectRecord(record);
                cloned.points = piece.points.map((point, index) => normalizeRoadPathExportPoint(point, `road path export split ${i} point ${index}`));
                delete cloned.pathPoints;
                cloned.x = cloned.points[0].x;
                cloned.y = cloned.points[0].y;
                if (i > 0) delete cloned.id;
                pieces.push({ sectionKey: piece.sectionKey, record: cloned });
            }
            if (pieces.length === 0) {
                throw new Error(`Cannot export road path in section ${ownerSectionKey}; no section-owned spans were produced.`);
            }
            return pieces;
        };
        map.exportPrototypeSectionAssets = function exportPrototypeSectionAssets(sectionKeys = null) {
            const state = this._prototypeSectionState;
            if (!state || !Array.isArray(state.orderedSectionAssets)) return [];
            this.rebuildPrototypeSectionObjectNameRegistry();
            ensurePrototypeBlockedEdges(this);
            rebuildPrototypeSectionClearance(this);
            if (typeof this.syncPrototypeBuildingPlacementRefs === "function") {
                this.syncPrototypeBuildingPlacementRefs();
            }
            const keyFilter = sectionKeys instanceof Set
                ? sectionKeys
                : (Array.isArray(sectionKeys) ? new Set(sectionKeys) : null);
            const cloneExportSectionAsset = (asset) => ({
                id: asset.id,
                key: asset.key,
                coord: { q: asset.coord.q, r: asset.coord.r },
                centerAxial: { q: asset.centerAxial.q, r: asset.centerAxial.r },
                centerOffset: { x: asset.centerOffset.x, y: asset.centerOffset.y },
                neighborKeys: Array.isArray(asset.neighborKeys) ? asset.neighborKeys.slice() : [],
                tileCoordKeys: Array.isArray(asset.tileCoordKeys) ? asset.tileCoordKeys.slice() : [],
                groundTextureId: Number.isFinite(asset.groundTextureId) ? Number(asset.groundTextureId) : 0,
                groundTiles: (asset.groundTiles && typeof asset.groundTiles === "object") ? { ...asset.groundTiles } : {},
                floors: clonePrototypeFloorRecords(asset.floors, asset.key),
                floorHoles: typeof clonePrototypeFloorHoleRecords === "function" ? clonePrototypeFloorHoleRecords(asset.floorHoles) : [],
                floorVoids: typeof clonePrototypeFloorVoidRecords === "function" ? clonePrototypeFloorVoidRecords(asset.floorVoids) : [],
                walls: Array.isArray(asset.walls) ? asset.walls.map((wall) => ({ ...wall })) : [],
                blockedEdges: clonePrototypeBlockedEdges(asset.blockedEdges),
                clearanceByTile: clonePrototypeClearanceByTile(asset.clearanceByTile),
                objects: Array.isArray(asset.objects) ? asset.objects.map((obj) => ({ ...obj })) : [],
                animals: Array.isArray(asset.animals) ? asset.animals.map((animal) => ({ ...animal })) : [],
                powerups: Array.isArray(asset.powerups) ? asset.powerups.map((powerup) => ({ ...powerup })) : [],
                buildingRefs: (() => {
                    if (!Array.isArray(asset.buildingRefs)) return [];
                    const refs = [];
                    const seen = new Set();
                    for (let i = 0; i < asset.buildingRefs.length; i++) {
                        const ref = asset.buildingRefs[i];
                        const id = String(ref && ref.id || "").trim();
                        if (!/^building:[A-Za-z0-9_.:-]+$/.test(id)) {
                            throw new Error(`section ${asset.key} buildingRefs ${i} requires a valid building id`);
                        }
                        if (seen.has(id)) {
                            throw new Error(`section ${asset.key} buildingRefs contains duplicate building ref ${id}`);
                        }
                        seen.add(id);
                        refs.push({ id, shell: ref && ref.shell === false ? false : true });
                    }
                    return refs;
                })()
            });
            const exportedSections = state.orderedSectionAssets
                .filter((asset) => {
                    if (!asset) return false;
                    if (keyFilter && !keyFilter.has(asset.key)) return false;
                    return true;
                })
                .map(cloneExportSectionAsset);
            const exportedByKey = new Map();
            for (let i = 0; i < exportedSections.length; i++) {
                const section = exportedSections[i];
                if (section && typeof section.key === "string" && section.key.length > 0) {
                    section._unsplitObjects = Array.isArray(section.objects) ? section.objects : [];
                    section.objects = [];
                    exportedByKey.set(section.key, section);
                }
            }
            for (let i = 0; i < exportedSections.length; i++) {
                const section = exportedSections[i];
                if (!section || typeof section.key !== "string" || section.key.length === 0) continue;
                const records = Array.isArray(section._unsplitObjects) ? section._unsplitObjects : [];
                for (let r = 0; r < records.length; r++) {
                    const pieces = splitRoadPathExportRecord(this, records[r], section.key);
                    for (let p = 0; p < pieces.length; p++) {
                        let targetSection = exportedByKey.get(pieces[p].sectionKey);
                        if (!targetSection) {
                            const targetAsset = typeof this.getPrototypeSectionAsset === "function"
                                ? this.getPrototypeSectionAsset(pieces[p].sectionKey)
                                : null;
                            if (!targetAsset) {
                                throw new Error(`Cannot export road path split for missing section ${pieces[p].sectionKey}.`);
                            }
                            targetSection = cloneExportSectionAsset(targetAsset);
                            targetSection._unsplitObjects = Array.isArray(targetSection.objects) ? targetSection.objects : [];
                            targetSection.objects = [];
                            exportedSections.push(targetSection);
                            exportedByKey.set(targetSection.key, targetSection);
                        }
                        targetSection.objects.push(pieces[p].record);
                    }
                }
                delete section._unsplitObjects;
            }
            return exportedSections;
        };
        map.exportPrototypeFloorTransitions = function exportPrototypeFloorTransitions() {
            const state = this._prototypeSectionState;
            return Array.isArray(state && state.floorTransitions)
                ? clonePrototypeFloorTransitions(state.floorTransitions)
                : [];
        };
        map.loadPrototypeSectionWorld = function loadPrototypeSectionWorld(assetBundle) {
            if (!assetBundle || typeof assetBundle !== "object") return false;
            clearPrototypeRuntimeStateForReload(this);
            const config = getPrototypeConfig();
            const sectionStateSource = buildSectionStateFromAssetBundle(assetBundle, config, this);
            const nextState = createPrototypeState(
                sectionStateSource,
                (typeof assetBundle.activeCenterKey === "string" && assetBundle.activeCenterKey.length > 0)
                    ? assetBundle.activeCenterKey
                    : makeSectionKey({ q: 0, r: 0 })
            );
            assignNodesToSections(this, nextState);
            this._prototypeSectionState = nextState;
            if (typeof installSectionWorldBuildingApis === "function") {
                installSectionWorldBuildingApis(this);
                this.initializePrototypeBuildingState(nextState.buildingPlacements || []);
            }
            rebuildPrototypeFloorRuntime(this, nextState);
            this._sectionWorld = buildPrototypeSummary(nextState);
            this._twoSectionPrototype = this._sectionWorld;
            ensurePrototypeBlockedEdges(this);
            setActiveCenter(this, nextState.activeCenterKey);
            initializePrototypeRuntimeState(this, nextState);
            if (typeof runtimeGlobalScope.invalidateMinimap === "function") {
                runtimeGlobalScope.invalidateMinimap();
            }
            return true;
        };
    }

    function installSectionWorldTraversalApis(map, deps) {
        const { globalScope: runtimeGlobalScope } = deps;

        map._baseGetTraversalInfo = (typeof map.getTraversalInfo === "function") ? map.getTraversalInfo.bind(map) : null;
        map._baseFindPathAStar = (typeof map.findPathAStar === "function") ? map.findPathAStar.bind(map) : null;
        map._baseFindPath = (typeof map.findPath === "function") ? map.findPath.bind(map) : null;
        map.getLoadedPrototypeNodes = function getLoadedPrototypeNodes() {
            return (this._prototypeSectionState && Array.isArray(this._prototypeSectionState.loadedNodes))
                ? this._prototypeSectionState.loadedNodes.slice()
                : [];
        };
        map.getLoadedPrototypeNodeKeySet = function getLoadedPrototypeNodeKeySet() {
            return (this._prototypeSectionState && this._prototypeSectionState.loadedNodeKeySet instanceof Set)
                ? this._prototypeSectionState.loadedNodeKeySet
                : new Set();
        };
        map.getNodeByIndex = function getNodeByIndex(xindex, yindex) {
            const state = this._prototypeSectionState;
            if (!state || !(state.allNodesByCoordKey instanceof Map)) return null;
            return state.allNodesByCoordKey.get(`${Number(xindex)},${Number(yindex)}`) || null;
        };
        map.getAllPrototypeNodes = function getAllPrototypeNodes() {
            return (this._prototypeSectionState && Array.isArray(this._prototypeSectionState.allNodes))
                ? this._prototypeSectionState.allNodes.slice()
                : [];
        };
        map.getPrototypeSectionSeamSegments = function getPrototypeSectionSeamSegments() {
            return (this._prototypeSectionState && Array.isArray(this._prototypeSectionState.seamSegments))
                ? this._prototypeSectionState.seamSegments.slice()
                : [];
        };
        map.getPrototypeActivityNode = function getPrototypeActivityNode(node) {
            return node || null;
        };
        map.getNodeActivityState = function getNodeActivityState(node) {
            if (!node || typeof node !== "object") {
                return { active: false, void: true, activityNode: null };
            }
            const layer = Number.isFinite(node.traversalLayer)
                ? Math.round(Number(node.traversalLayer))
                : (Number.isFinite(node.level) ? Math.round(Number(node.level)) : 0);
            const usesSectionActivity = (
                layer !== 0 &&
                node._prototypeBuildingFloorNode !== true &&
                node._prototypeOwnerType !== "building" &&
                this._prototypeSectionState &&
                this._prototypeSectionState.allNodesByCoordKey instanceof Map
            );
            const activityNode = usesSectionActivity
                ? (this._prototypeSectionState.allNodesByCoordKey.get(`${Number(node.xindex)},${Number(node.yindex)}`) || node)
                : node;
            return {
                active: !!(activityNode && activityNode._prototypeSectionActive === true),
                void: !!(activityNode && activityNode._prototypeVoid === true),
                activityNode
            };
        };
        map.isPrototypeNodeActive = function isPrototypeNodeActive(node) {
            const state = typeof this.getNodeActivityState === "function"
                ? this.getNodeActivityState(node)
                : { active: !!(node && node._prototypeSectionActive === true) };
            return state.active === true;
        };
        map.shouldRenderNode = function shouldRenderNode(node) {
            return this.isPrototypeNodeActive(node);
        };
        map.getMinimapNodeColor = function getMinimapNodeColor(node) {
            const state = typeof this.getNodeActivityState === "function"
                ? this.getNodeActivityState(node)
                : { active: !!(node && node._prototypeSectionActive === true), void: !!(node && node._prototypeVoid === true) };
            if (!state.activityNode || state.void === true) return "#000000";
            return state.active === true ? "#007700" : "#000000";
        };
        map.canOccupyWorldPosition = function canOccupyWorldPosition(worldX, worldY, actor = null, options = {}) {
            const baseNode = (typeof this.worldToNode === "function") ? this.worldToNode(worldX, worldY) : null;
            const resolveActorLayer = () => {
                const candidates = [
                    options && options.traversalLayer,
                    options && options.currentLayer,
                    actor && actor.currentLayer,
                    actor && actor.traversalLayer,
                    actor && actor.level,
                    actor && actor.node && actor.node.traversalLayer,
                    actor && actor.node && actor.node.level
                ];
                for (let i = 0; i < candidates.length; i++) {
                    const value = Number(candidates[i]);
                    if (Number.isFinite(value)) return Math.round(value);
                }
                return 0;
            };
            const layer = resolveActorLayer();
            let node = baseNode;
            if (layer !== 0 && baseNode && typeof this.getFloorNodeAtLayer === "function") {
                const sectionKey = typeof baseNode._prototypeSectionKey === "string" ? baseNode._prototypeSectionKey : "";
                node = this.getFloorNodeAtLayer(baseNode.xindex, baseNode.yindex, layer, {
                    sectionKey,
                    allowScan: false
                }) || null;
            }
            const activityState = typeof this.getNodeActivityState === "function"
                ? this.getNodeActivityState(node)
                : { active: !!(node && node._prototypeSectionActive === true), void: !!(node && node._prototypeVoid === true) };
            const isBlocked = node && typeof node.isBlocked === "function"
                ? node.isBlocked()
                : !!(node && (node.blocked || node.blockedByObjects > 0));
            return !!(node && activityState.active === true && activityState.void !== true && !isBlocked);
        };
        map.getNodesInIndexWindow = function getNodesInIndexWindow(xStart, xEnd, yStart, yEnd) {
            if (typeof this.syncPrototypeBuildingMovementBlockers === "function") {
                this.syncPrototypeBuildingMovementBlockers();
            }
            const state = this._prototypeSectionState;
            const sparseNodes = (state && state.allNodesByCoordKey instanceof Map) ? state.allNodesByCoordKey : null;
            if (!sparseNodes) return [];
            const out = [];
            const minX = Math.floor(Math.min(Number(xStart), Number(xEnd)));
            const maxX = Math.floor(Math.max(Number(xStart), Number(xEnd)));
            const minY = Math.floor(Math.min(Number(yStart), Number(yEnd)));
            const maxY = Math.floor(Math.max(Number(yStart), Number(yEnd)));
            for (let x = minX; x <= maxX; x++) {
                for (let y = minY; y <= maxY; y++) {
                    const node = sparseNodes.get(`${x},${y}`);
                    if (node) out.push(node);
                }
            }
            return out;
        };
        map.getVisibleNodesInViewport = function getVisibleNodesInViewport(camera, xPadding = 0, yPadding = 0) {
            const state = this._prototypeSectionState;
            const loadedNodes = (state && Array.isArray(state.loadedNodes)) ? state.loadedNodes : [];
            if (loadedNodes.length === 0) return [];
            const cameraRef = camera || runtimeGlobalScope.viewport || {};
            const cameraWidth = Number.isFinite(cameraRef.width) ? cameraRef.width : 0;
            const cameraHeight = Number.isFinite(cameraRef.height) ? cameraRef.height : 0;
            const padXWorld = Math.max(0, Number(xPadding) || 0) * 0.866;
            const padYWorld = Math.max(0, Number(yPadding) || 0);
            const minX = Number(cameraRef.x) - padXWorld;
            const maxX = Number(cameraRef.x) + cameraWidth + padXWorld;
            const minY = Number(cameraRef.y) - padYWorld;
            const maxY = Number(cameraRef.y) + cameraHeight + padYWorld;
            if (!this._visibleNodesReuse) this._visibleNodesReuse = [];
            const visible = this._visibleNodesReuse;
            visible.length = 0;
            if (
                Number.isFinite(minX) &&
                Number.isFinite(maxX) &&
                Number.isFinite(minY) &&
                Number.isFinite(maxY)
            ) {
                const minYi = Math.floor(minY) - 1;
                const maxYi = Math.ceil(maxY) + 1;
                let low = 0;
                let high = loadedNodes.length;
                while (low < high) {
                    const mid = (low + high) >> 1;
                    const nodeYIndex = Number(loadedNodes[mid] && loadedNodes[mid].yindex) || 0;
                    if (nodeYIndex < minYi) {
                        low = mid + 1;
                    } else {
                        high = mid;
                    }
                }
                for (let i = low; i < loadedNodes.length; i++) {
                    const node = loadedNodes[i];
                    if (!node) continue;
                    const nodeYIndex = Number(node.yindex) || 0;
                    if (nodeYIndex > maxYi) break;
                    if (node.x < minX || node.x > maxX) continue;
                    if (node.y < minY || node.y > maxY) continue;
                    visible.push(node);
                }
                return visible;
            }
            for (let i = 0; i < loadedNodes.length; i++) {
                const node = loadedNodes[i];
                if (!node) continue;
                if (node.x < minX || node.x > maxX) continue;
                if (node.y < minY || node.y > maxY) continue;
                visible.push(node);
            }
            return visible;
        };
        map._baseWorldToNode = (typeof map.worldToNode === "function") ? map.worldToNode.bind(map) : null;
        map._baseWorldToNodeOrMidpoint = (typeof map.worldToNodeOrMidpoint === "function") ? map.worldToNodeOrMidpoint.bind(map) : null;
        map.worldToNode = function prototypeWorldToNode(worldX, worldY) {
            const state = this._prototypeSectionState;
            const sparseNodes = (state && state.allNodesByCoordKey instanceof Map) ? state.allNodesByCoordKey : null;
            if (!sparseNodes || sparseNodes.size === 0) {
                if (typeof this._baseWorldToNode !== "function") return null;
                const fallbackNode = this._baseWorldToNode(worldX, worldY);
                return this.isPrototypeNodeActive(fallbackNode) ? fallbackNode : null;
            }

            const approxX = Math.round(Number(worldX) / 0.866);
            const approxY = Math.round(Number(worldY) - (approxX % 2 === 0 ? 0.5 : 0));
            let best = null;
            let bestDist = Infinity;
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    const node = sparseNodes.get(`${approxX + dx},${approxY + dy}`);
                    if (!node) continue;
                    const dist = Math.hypot(
                        Number(node.x) - Number(worldX),
                        Number(node.y) - Number(worldY)
                    );
                    if (dist < bestDist) {
                        bestDist = dist;
                        best = node;
                    }
                }
            }
            return (best && this.isPrototypeNodeActive(best)) ? best : null;
        };
        map.worldToNodeOrMidpoint = function prototypeWorldToNodeOrMidpoint(worldX, worldY) {
            const node = this.worldToNode(worldX, worldY);
            if (!node) {
                if (typeof this._baseWorldToNodeOrMidpoint === "function") {
                    return this._baseWorldToNodeOrMidpoint(worldX, worldY);
                }
                return null;
            }
            const nodeDist = Math.hypot(Number(node.x) - Number(worldX), Number(node.y) - Number(worldY));
            const midpointDirections = [1, 3, 5, 7, 9, 11];
            let bestMidpoint = null;
            let bestMidpointDist = Infinity;
            const seenPairs = new Set();

            for (let i = 0; i < midpointDirections.length; i++) {
                const dir = midpointDirections[i];
                const neighbor = node.neighbors[dir];
                if (!neighbor || typeof neighbor.xindex !== "number" || typeof neighbor.yindex !== "number") continue;
                const ax = Math.min(node.xindex, neighbor.xindex);
                const ay = Math.min(node.yindex, neighbor.yindex);
                const bx = Math.max(node.xindex, neighbor.xindex);
                const by = Math.max(node.yindex, neighbor.yindex);
                const pairKey = `${ax},${ay}|${bx},${by}`;
                if (seenPairs.has(pairKey)) continue;
                seenPairs.add(pairKey);

                const midpoint = (typeof runtimeGlobalScope.makeMidpoint === "function")
                    ? runtimeGlobalScope.makeMidpoint(node, neighbor)
                    : null;
                if (!midpoint) continue;
                const midDist = Math.hypot(Number(midpoint.x) - Number(worldX), Number(midpoint.y) - Number(worldY));
                if (midDist < bestMidpointDist) {
                    bestMidpointDist = midDist;
                    bestMidpoint = midpoint;
                }
            }

            if (bestMidpoint && bestMidpointDist < nodeDist) {
                return bestMidpoint;
            }
            return node;
        };
        map.getMidpointNode = function getMidpointNode(nodeA, nodeB) {
            if (typeof runtimeGlobalScope.makeMidpoint === "function") {
                return runtimeGlobalScope.makeMidpoint(nodeA, nodeB);
            }
            return null;
        };
        map.getTraversalInfo = function prototypeGetTraversalInfo(currentNode, directionIndex, options = {}) {
            if (!this.isPrototypeNodeActive(currentNode)) {
                return { allowed: false, neighborNode: null, penalty: 0, blockers: [] };
            }
            const neighborNode = currentNode && currentNode.neighbors
                ? currentNode.neighbors[directionIndex]
                : null;
            if (!this.isPrototypeNodeActive(neighborNode)) {
                return { allowed: false, neighborNode: null, penalty: 0, blockers: [] };
            }
            if (typeof this._baseGetTraversalInfo !== "function") {
                return { allowed: false, neighborNode: null, penalty: 0, blockers: [] };
            }
            return this._baseGetTraversalInfo(currentNode, directionIndex, options);
        };
        map.findPathAStar = function prototypeFindPathAStar(startingNode, destinationNode, options = {}) {
            if (!this.isPrototypeNodeActive(startingNode) || !this.isPrototypeNodeActive(destinationNode)) {
                return null;
            }
            if (typeof this._baseFindPathAStar !== "function") return null;
            const loadedCount = (this._prototypeSectionState && Array.isArray(this._prototypeSectionState.loadedNodes))
                ? this._prototypeSectionState.loadedNodes.length
                : 0;
            return this._baseFindPathAStar(startingNode, destinationNode, {
                ...options,
                maxIterations: Number.isFinite(options.maxIterations)
                    ? options.maxIterations
                    : Math.max(200, loadedCount * 8)
            });
        };
        map.findPath = function prototypeFindPath(startingNode, destinationNode, options = {}) {
            if (!this.isPrototypeNodeActive(startingNode) || !this.isPrototypeNodeActive(destinationNode)) {
                return null;
            }
            if (typeof this._baseFindPath !== "function") return null;
            return this._baseFindPath(startingNode, destinationNode, options);
        };
    }

    globalScope.__sectionWorldApiInstallers = {
        installSectionWorldSectionApis,
        installSectionWorldTraversalApis,
        installPrototypeSectionApis: installSectionWorldSectionApis,
        installPrototypeTraversalApis: installSectionWorldTraversalApis
    };
    globalScope.__twoSectionPrototypeApiInstallers = globalScope.__sectionWorldApiInstallers;
})(typeof globalThis !== "undefined" ? globalThis : window);

if (typeof module !== "undefined" && module.exports) {
    module.exports = globalThis.__sectionWorldApiInstallers;
}
