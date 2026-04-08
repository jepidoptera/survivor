(function (globalScope) {
    "use strict";

    function createSectionWorldAsyncSyncPlanners(map, deps) {
        const {
            applyPrototypeBlockedEdgesForSection,
            applyPrototypeSectionClearanceChunk,
            buildPrototypeObjectPersistenceSignature,
            buildPrototypeWallPersistenceSignature,
            canReusePrototypeParkedRuntimeObject,
            evictPrototypeParkedRuntimeObject,
            getPrototypeObjectProfileKey,
            isPrototypeSavableObject,
            parkPrototypeRuntimeObject,
            prependPrototypeTasks,
            prototypeNow,
            removePrototypeBlockedEdgesForSection,
            removePrototypeObjectRecordById,
            removePrototypeRoofRuntime,
            removePrototypeRuntimeWallVisual,
            restorePrototypeParkedRuntimeObject,
            trimPrototypeParkedRuntimeObjectCache,
            upsertPrototypeObjectRecord
        } = deps;

        const enqueuePrototypeAsyncObjectSync = (session) => {
            const objectState = map._prototypeObjectState;
            if (!objectState) return;
            const sync = {
                syncStartMs: prototypeNow(),
                captureMs: 0,
                collectMs: 0,
                stalePruneMs: 0,
                unloadMs: 0,
                loadMs: 0,
                roofLoadMs: 0,
                staticLoadMs: 0,
                roofLoaded: 0,
                staticLoaded: 0,
                roofRemoved: 0,
                staticRemoved: 0,
                parkedStored: 0,
                parkedReused: 0,
                parkedEvicted: 0,
                roadRefreshMs: 0,
                roadRefreshCount: 0,
                treeFinalizeMs: 0,
                invalidateMs: 0,
                loadedCount: 0,
                removedCount: 0,
                capturedAny: false,
                removedAny: false,
                loadedAny: false,
                desiredRecords: [],
                desiredRecordIds: new Set(),
                roadRefreshNodes: new Set(),
                profileByType: new Map(),
                treeDebugEnabled: !!(
                    globalScope.Tree &&
                    typeof globalScope.Tree.beginPrototypeLoadDebugSession === "function" &&
                    typeof globalScope.Tree.endPrototypeLoadDebugSession === "function"
                ),
                treeDebugStarted: false,
                captureDetail: {
                    pruneGoneMs: 0,
                    dirtyListBuildMs: 0,
                    scanDirtyMs: 0,
                    saveJsonMs: 0,
                    signatureMs: 0,
                    upsertMs: 0,
                    dirtyCandidateCount: 0,
                    dirtyProcessedCount: 0,
                    dirtySkippedCount: 0,
                    goneRemovedCount: 0
                }
            };
            const bumpProfile = (profileKey, field, deltaValue = 1, msValue = 0) => {
                const key = (typeof profileKey === "string" && profileKey.length > 0) ? profileKey : "unknown";
                if (!sync.profileByType.has(key)) {
                    sync.profileByType.set(key, { loaded: 0, removed: 0, ms: 0 });
                }
                const stats = sync.profileByType.get(key);
                stats[field] = (Number(stats[field]) || 0) + deltaValue;
                stats.ms = (Number(stats.ms) || 0) + (Number(msValue) || 0);
            };
            prependPrototypeTasks(session, [() => {
                const nextTasks = [];
                if (sync.treeDebugEnabled && sync.treeDebugStarted !== true) {
                    globalScope.Tree.beginPrototypeLoadDebugSession();
                    sync.treeDebugStarted = true;
                }
                if (objectState.captureScanNeeded === true) {
                    const goneStart = prototypeNow();
                    sync.goneRecordIds = [];
                    if (objectState.activeRuntimeObjectsByRecordId instanceof Map) {
                        for (const [recordId, runtimeObj] of objectState.activeRuntimeObjectsByRecordId.entries()) {
                            if (runtimeObj && !runtimeObj.gone && !runtimeObj.vanishing) continue;
                            sync.goneRecordIds.push(recordId);
                        }
                    }
                    sync.captureDetail.pruneGoneMs += prototypeNow() - goneStart;
                    sync.captureMs += prototypeNow() - goneStart;
                    if (objectState.dirtyRuntimeObjects instanceof Set && objectState.dirtyRuntimeObjects.size > 0) {
                        const dirtyListBuildStart = prototypeNow();
                        sync.dirtyObjects = Array.from(objectState.dirtyRuntimeObjects);
                        const dirtyListBuildMs = prototypeNow() - dirtyListBuildStart;
                        sync.captureDetail.dirtyListBuildMs += dirtyListBuildMs;
                        sync.captureMs += dirtyListBuildMs;
                        sync.captureDetail.dirtyCandidateCount = sync.dirtyObjects.length;
                    } else {
                        sync.dirtyObjects = [];
                    }
                    for (let i = 0; i < sync.goneRecordIds.length; i++) {
                        const recordId = sync.goneRecordIds[i];
                        nextTasks.push(() => {
                            const taskStart = prototypeNow();
                            if (removePrototypeObjectRecordById(objectState, Number(recordId))) {
                                sync.capturedAny = true;
                                sync.captureDetail.goneRemovedCount += 1;
                            }
                            const taskMs = prototypeNow() - taskStart;
                            sync.captureDetail.pruneGoneMs += taskMs;
                            sync.captureMs += taskMs;
                        });
                    }
                    for (let i = 0; i < sync.dirtyObjects.length; i++) {
                        const obj = sync.dirtyObjects[i];
                        nextTasks.push(() => {
                            const taskStart = prototypeNow();
                            if (objectState.dirtyRuntimeObjects instanceof Set) {
                                objectState.dirtyRuntimeObjects.delete(obj);
                            }
                            if (!isPrototypeSavableObject(obj)) {
                                sync.captureDetail.scanDirtyMs += prototypeNow() - taskStart;
                                sync.captureMs += prototypeNow() - taskStart;
                                return;
                            }
                            sync.captureDetail.dirtyProcessedCount += 1;
                            if (obj._prototypeRuntimeRecord === true && obj._prototypeDirty !== true) {
                                sync.captureDetail.dirtySkippedCount += 1;
                                const skippedMs = prototypeNow() - taskStart;
                                sync.captureDetail.scanDirtyMs += skippedMs;
                                sync.captureMs += skippedMs;
                                return;
                            }
                            const saveJsonStart = prototypeNow();
                            const currentSignature = buildPrototypeObjectPersistenceSignature(obj);
                            sync.captureDetail.saveJsonMs += prototypeNow() - saveJsonStart;
                            const previousSignature = (typeof obj._prototypePersistenceSignature === "string")
                                ? obj._prototypePersistenceSignature
                                : "";
                            if (!obj._prototypeRuntimeRecord || currentSignature !== previousSignature) {
                                const upsertStart = prototypeNow();
                                if (upsertPrototypeObjectRecord(obj)) {
                                    sync.capturedAny = true;
                                }
                                sync.captureDetail.upsertMs += prototypeNow() - upsertStart;
                            }
                            const taskMs = prototypeNow() - taskStart;
                            sync.captureDetail.scanDirtyMs += taskMs;
                            sync.captureMs += taskMs;
                        });
                    }
                }
                nextTasks.push(() => {
                    objectState.captureScanNeeded = !!(objectState.dirtyRuntimeObjects instanceof Set && objectState.dirtyRuntimeObjects.size > 0);
                    objectState.lastCaptureStats = {
                        pruneGoneMs: Number(sync.captureDetail.pruneGoneMs.toFixed(2)),
                        dirtyListBuildMs: Number(sync.captureDetail.dirtyListBuildMs.toFixed(2)),
                        scanDirtyMs: Number(sync.captureDetail.scanDirtyMs.toFixed(2)),
                        saveJsonMs: Number(sync.captureDetail.saveJsonMs.toFixed(2)),
                        signatureMs: Number(sync.captureDetail.signatureMs.toFixed(2)),
                        upsertMs: Number(sync.captureDetail.upsertMs.toFixed(2)),
                        dirtyCandidateCount: sync.captureDetail.dirtyCandidateCount,
                        dirtyProcessedCount: sync.captureDetail.dirtyProcessedCount,
                        dirtySkippedCount: sync.captureDetail.dirtySkippedCount,
                        goneRemovedCount: sync.captureDetail.goneRemovedCount
                    };
                });
                nextTasks.push(() => {
                    const collectStart = prototypeNow();
                    const activeSectionKeys = map.getPrototypeActiveSectionKeys();
                    sync.activeSectionKeys = activeSectionKeys;
                    const desiredRecords = [];
                    activeSectionKeys.forEach((sectionKey) => {
                        const asset = map.getPrototypeSectionAsset(sectionKey);
                        const records = Array.isArray(asset && asset.objects) ? asset.objects : null;
                        if (!Array.isArray(records)) return;
                        for (let i = 0; i < records.length; i++) {
                            desiredRecords.push({ sectionKey, record: records[i] });
                        }
                    });
                    sync.desiredRecords = desiredRecords;
                    sync.desiredSignature = desiredRecords
                        .map((entry) => Number.isInteger(entry.record && entry.record.id) ? entry.record.id : "")
                        .join("|");
                    sync.collectMs += prototypeNow() - collectStart;
                    if (!sync.capturedAny && sync.desiredSignature === objectState.activeRecordSignature) {
                        if (sync.treeDebugStarted === true && sync.treeDebugEnabled) {
                            globalScope.Tree.endPrototypeLoadDebugSession();
                            sync.treeDebugStarted = false;
                        }
                        objectState.lastSyncStats = {
                            ms: Number((sync.captureMs + sync.collectMs + sync.stalePruneMs + sync.unloadMs + sync.loadMs + sync.invalidateMs).toFixed(2)),
                            desired: desiredRecords.length,
                            loaded: 0,
                            removed: 0,
                            active: objectState.activeRuntimeObjectsByRecordId instanceof Map ? objectState.activeRuntimeObjectsByRecordId.size : 0,
                            captureMs: Number(sync.captureMs.toFixed(2)),
                            collectMs: Number(sync.collectMs.toFixed(2)),
                            stalePruneMs: 0,
                            unloadMs: 0,
                            loadMs: 0,
                            roofLoadMs: 0,
                            staticLoadMs: 0,
                            roofLoaded: 0,
                            staticLoaded: 0,
                            roofRemoved: 0,
                            staticRemoved: 0,
                            parkedStored: 0,
                            parkedReused: 0,
                            parkedEvicted: 0,
                            parkedActive: objectState.parkedRuntimeObjectsByRecordId instanceof Map ? objectState.parkedRuntimeObjectsByRecordId.size : 0,
                            roadRefreshMs: 0,
                            roadRefreshCount: 0,
                            treeFinalizeMs: 0,
                            treeLoadDebug: null,
                            byType: {},
                            captureDetail: objectState.lastCaptureStats ? { ...objectState.lastCaptureStats } : null,
                            invalidateMs: 0
                        };
                        session.objectsChanged = false;
                        return;
                    }
                    if (!(objectState.activeRuntimeObjectsByRecordId instanceof Map)) {
                        objectState.activeRuntimeObjectsByRecordId = new Map();
                    }
                    const stalePruneStart = prototypeNow();
                    const staleRecordIds = [];
                    for (const [recordId, runtimeObj] of objectState.activeRuntimeObjectsByRecordId.entries()) {
                        if (runtimeObj && !runtimeObj.gone) continue;
                        staleRecordIds.push(recordId);
                    }
                    for (let i = 0; i < staleRecordIds.length; i++) {
                        objectState.activeRuntimeObjectsByRecordId.delete(staleRecordIds[i]);
                    }
                    sync.stalePruneMs += prototypeNow() - stalePruneStart;
                    sync.desiredRecordIds = new Set();
                    for (let i = 0; i < desiredRecords.length; i++) {
                        const recordId = Number(desiredRecords[i] && desiredRecords[i].record && desiredRecords[i].record.id);
                        if (Number.isInteger(recordId)) sync.desiredRecordIds.add(recordId);
                    }
                    sync.removalEntries = [];
                    for (const [recordId, runtimeObj] of objectState.activeRuntimeObjectsByRecordId.entries()) {
                        if (sync.desiredRecordIds.has(recordId)) continue;
                        sync.removalEntries.push({ recordId, runtimeObj });
                    }
                    sync.loadEntries = [];
                    for (let i = 0; i < desiredRecords.length; i++) {
                        const entry = desiredRecords[i];
                        if (entry && entry.record && !Number.isInteger(Number(entry.record.id))) {
                            entry.record.id = objectState.nextRecordId++;
                        }
                        const recordId = Number(entry && entry.record && entry.record.id);
                        if (!Number.isInteger(recordId)) continue;
                        if (objectState.activeRuntimeObjectsByRecordId.has(recordId)) continue;
                        sync.loadEntries.push(entry);
                    }
                    const phaseTasks = [];
                    for (let i = 0; i < sync.removalEntries.length; i++) {
                        const removalEntry = sync.removalEntries[i];
                        phaseTasks.push(() => {
                            const removeStart = prototypeNow();
                            const recordId = Number(removalEntry && removalEntry.recordId);
                            const runtimeObj = removalEntry && removalEntry.runtimeObj;
                            if (!Number.isInteger(recordId)) return;
                            if (!runtimeObj || runtimeObj.gone) {
                                objectState.activeRuntimeObjectsByRecordId.delete(recordId);
                                return;
                            }
                            const runtimeProfileKey = getPrototypeObjectProfileKey(runtimeObj);
                            const previousSuppressClearanceUpdates = !!map._suppressClearanceUpdates;
                            map._suppressClearanceUpdates = true;
                            map._prototypeSuppressObjectDirtyTracking = true;
                            try {
                                if (runtimeObj.type === "roof") {
                                    removePrototypeRoofRuntime(runtimeObj);
                                    sync.roofRemoved += 1;
                                    bumpProfile(runtimeProfileKey, "removed", 1, 0);
                                } else if (
                                    runtimeObj.type === "road" &&
                                    globalScope.Road &&
                                    typeof globalScope.Road.collectRefreshNodesFromNode === "function"
                                ) {
                                    globalScope.Road.collectRefreshNodesFromNode(typeof runtimeObj.getNode === "function" ? runtimeObj.getNode() : runtimeObj.node, sync.roadRefreshNodes);
                                    if (parkPrototypeRuntimeObject(runtimeObj)) {
                                        objectState.parkedRuntimeObjectsByRecordId.delete(recordId);
                                        objectState.parkedRuntimeObjectsByRecordId.set(recordId, runtimeObj);
                                        sync.parkedStored += 1;
                                        bumpProfile(runtimeProfileKey, "removed", 1, 0);
                                        sync.staticRemoved += 1;
                                    } else if (typeof runtimeObj.removeFromGame === "function") {
                                        runtimeObj._deferRoadNeighborRefresh = true;
                                        runtimeObj.removeFromGame();
                                        runtimeObj._deferRoadNeighborRefresh = false;
                                        sync.staticRemoved += 1;
                                        bumpProfile(runtimeProfileKey, "removed", 1, prototypeNow() - removeStart);
                                    } else if (typeof runtimeObj.remove === "function") {
                                        runtimeObj._deferRoadNeighborRefresh = true;
                                        runtimeObj.remove();
                                        runtimeObj._deferRoadNeighborRefresh = false;
                                        sync.staticRemoved += 1;
                                        bumpProfile(runtimeProfileKey, "removed", 1, prototypeNow() - removeStart);
                                    }
                                } else if (parkPrototypeRuntimeObject(runtimeObj)) {
                                    objectState.parkedRuntimeObjectsByRecordId.delete(recordId);
                                    objectState.parkedRuntimeObjectsByRecordId.set(recordId, runtimeObj);
                                    sync.parkedStored += 1;
                                    sync.staticRemoved += 1;
                                    bumpProfile(runtimeProfileKey, "removed", 1, 0);
                                } else if (typeof runtimeObj.removeFromGame === "function") {
                                    runtimeObj.removeFromGame();
                                    sync.staticRemoved += 1;
                                    bumpProfile(runtimeProfileKey, "removed", 1, prototypeNow() - removeStart);
                                } else if (typeof runtimeObj.remove === "function") {
                                    runtimeObj.remove();
                                    sync.staticRemoved += 1;
                                    bumpProfile(runtimeProfileKey, "removed", 1, prototypeNow() - removeStart);
                                }
                            } finally {
                                map._prototypeSuppressObjectDirtyTracking = false;
                                map._suppressClearanceUpdates = previousSuppressClearanceUpdates;
                            }
                            objectState.activeRuntimeObjectsByRecordId.delete(recordId);
                            sync.removedAny = true;
                            sync.removedCount += 1;
                            sync.unloadMs += prototypeNow() - removeStart;
                        });
                    }
                    phaseTasks.push(() => {
                        const trimStart = prototypeNow();
                        sync.parkedEvicted += trimPrototypeParkedRuntimeObjectCache(objectState);
                        sync.unloadMs += prototypeNow() - trimStart;
                    });
                    for (let i = 0; i < sync.loadEntries.length; i++) {
                        const entry = sync.loadEntries[i];
                        phaseTasks.push(() => {
                            const loadTaskStart = prototypeNow();
                            let runtimeObj = null;
                            const profileKey = getPrototypeObjectProfileKey(entry && entry.record);
                            const recordId = Number(entry && entry.record && entry.record.id);
                            const expectedSignature = buildPrototypeObjectPersistenceSignature(entry && entry.record);
                            const parkedRuntimeObj = (objectState.parkedRuntimeObjectsByRecordId instanceof Map)
                                ? objectState.parkedRuntimeObjectsByRecordId.get(recordId)
                                : null;
                            if (canReusePrototypeParkedRuntimeObject(parkedRuntimeObj, entry && entry.record && entry.record.type, expectedSignature)) {
                                runtimeObj = restorePrototypeParkedRuntimeObject(parkedRuntimeObj, map);
                                objectState.parkedRuntimeObjectsByRecordId.delete(recordId);
                                if (runtimeObj) {
                                    sync.parkedReused += 1;
                                    sync.staticLoaded += 1;
                                    bumpProfile(profileKey, "loaded", 1, 0);
                                    if (runtimeObj.type === "road" && globalScope.Road && typeof globalScope.Road.collectRefreshNodesFromNode === "function") {
                                        globalScope.Road.collectRefreshNodesFromNode(typeof runtimeObj.getNode === "function" ? runtimeObj.getNode() : runtimeObj.node, sync.roadRefreshNodes);
                                    }
                                }
                            } else if (parkedRuntimeObj) {
                                objectState.parkedRuntimeObjectsByRecordId.delete(recordId);
                                if (evictPrototypeParkedRuntimeObject(parkedRuntimeObj)) {
                                    sync.parkedEvicted += 1;
                                }
                            }
                            const previousSuppressClearanceUpdates = !!map._suppressClearanceUpdates;
                            map._suppressClearanceUpdates = true;
                            map._prototypeSuppressObjectDirtyTracking = true;
                            try {
                                if (entry && entry.record && entry.record.type === "roof") {
                                    if (globalScope.Roof && typeof globalScope.Roof.loadJson === "function") {
                                        const roofStart = prototypeNow();
                                        runtimeObj = globalScope.Roof.loadJson(entry.record);
                                        const roofMs = prototypeNow() - roofStart;
                                        sync.roofLoadMs += roofMs;
                                        if (runtimeObj) {
                                            if (!Array.isArray(globalScope.roofs)) globalScope.roofs = [];
                                            globalScope.roofs.push(runtimeObj);
                                            globalScope.roof = runtimeObj;
                                            if (Array.isArray(map.objects) && map.objects.indexOf(runtimeObj) < 0) {
                                                map.objects.push(runtimeObj);
                                            }
                                            sync.roofLoaded += 1;
                                            bumpProfile(profileKey, "loaded", 1, roofMs);
                                        }
                                    }
                                } else if (!runtimeObj && globalScope.StaticObject && typeof globalScope.StaticObject.loadJson === "function") {
                                    const staticStart = prototypeNow();
                                    runtimeObj = globalScope.StaticObject.loadJson(entry.record, map, {
                                        deferRoadTextureRefresh: true,
                                        deferTreePostLoad: true,
                                        suppressAutoScriptingName: true,
                                        trustLoadedScriptingName: true
                                    });
                                    const staticMs = prototypeNow() - staticStart;
                                    sync.staticLoadMs += staticMs;
                                    if (runtimeObj) {
                                        sync.staticLoaded += 1;
                                        bumpProfile(profileKey, "loaded", 1, staticMs);
                                        if (runtimeObj.type === "road" && globalScope.Road && typeof globalScope.Road.collectRefreshNodesFromNode === "function") {
                                            globalScope.Road.collectRefreshNodesFromNode(typeof runtimeObj.getNode === "function" ? runtimeObj.getNode() : runtimeObj.node, sync.roadRefreshNodes);
                                        }
                                        if (runtimeObj.type === "tree" && typeof runtimeObj.finalizeDeferredLoad === "function") {
                                            if (!Array.isArray(sync.deferredTrees)) sync.deferredTrees = [];
                                            sync.deferredTrees.push(runtimeObj);
                                        }
                                    }
                                }
                            } finally {
                                map._prototypeSuppressObjectDirtyTracking = false;
                                map._suppressClearanceUpdates = previousSuppressClearanceUpdates;
                            }
                            if (!runtimeObj) return;
                            runtimeObj._prototypeRuntimeRecord = true;
                            runtimeObj._prototypeObjectManaged = true;
                            runtimeObj._prototypeRecordId = recordId;
                            runtimeObj._prototypePersistenceSignature = buildPrototypeObjectPersistenceSignature(entry.record);
                            runtimeObj._prototypeOwnerSectionKey = entry.sectionKey;
                            runtimeObj._prototypeDirty = false;
                            objectState.activeRuntimeObjectsByRecordId.set(recordId, runtimeObj);
                            sync.loadedAny = true;
                            sync.loadedCount += 1;
                            sync.loadMs += prototypeNow() - loadTaskStart;
                        });
                    }
                    phaseTasks.push(() => {
                        if (sync.roadRefreshNodes.size > 0 && globalScope.Road && typeof globalScope.Road.refreshTexturesAroundNodes === "function") {
                            const roadRefreshStart = prototypeNow();
                            sync.roadRefreshCount = globalScope.Road.refreshTexturesAroundNodes(sync.roadRefreshNodes);
                            sync.roadRefreshMs += prototypeNow() - roadRefreshStart;
                        }
                    });
                    phaseTasks.push(() => {
                        const deferredTrees = Array.isArray(sync.deferredTrees) ? sync.deferredTrees : [];
                        if (deferredTrees.length > 0) {
                            const treeFinalizeStart = prototypeNow();
                            for (let i = 0; i < deferredTrees.length; i++) {
                                const tree = deferredTrees[i];
                                if (tree && typeof tree.finalizeDeferredLoad === "function") {
                                    tree.finalizeDeferredLoad();
                                }
                            }
                            sync.treeFinalizeMs += prototypeNow() - treeFinalizeStart;
                        }
                        if (sync.treeDebugStarted === true && sync.treeDebugEnabled) {
                            sync.treeLoadDebug = globalScope.Tree.endPrototypeLoadDebugSession();
                            sync.treeDebugStarted = false;
                        }
                        objectState.activeRuntimeObjects = Array.from(objectState.activeRuntimeObjectsByRecordId.values());
                        objectState.activeRecordSignature = sync.desiredSignature;
                        objectState.captureScanNeeded = false;
                        if ((sync.capturedAny || sync.removedAny || sync.loadedAny) && typeof globalScope.invalidateMinimap === "function") {
                            const invalidateStart = prototypeNow();
                            globalScope.invalidateMinimap();
                            sync.invalidateMs += prototypeNow() - invalidateStart;
                        }
                        objectState.lastSyncStats = {
                            ms: Number((sync.captureMs + sync.collectMs + sync.stalePruneMs + sync.unloadMs + sync.loadMs + sync.invalidateMs).toFixed(2)),
                            desired: sync.desiredRecords.length,
                            loaded: sync.loadedCount,
                            removed: sync.removedCount,
                            active: objectState.activeRuntimeObjectsByRecordId.size,
                            captureMs: Number(sync.captureMs.toFixed(2)),
                            collectMs: Number(sync.collectMs.toFixed(2)),
                            stalePruneMs: Number(sync.stalePruneMs.toFixed(2)),
                            unloadMs: Number(sync.unloadMs.toFixed(2)),
                            loadMs: Number(sync.loadMs.toFixed(2)),
                            roofLoadMs: Number(sync.roofLoadMs.toFixed(2)),
                            staticLoadMs: Number(sync.staticLoadMs.toFixed(2)),
                            roofLoaded: sync.roofLoaded,
                            staticLoaded: sync.staticLoaded,
                            roofRemoved: sync.roofRemoved,
                            staticRemoved: sync.staticRemoved,
                            parkedStored: sync.parkedStored,
                            parkedReused: sync.parkedReused,
                            parkedEvicted: sync.parkedEvicted,
                            parkedActive: objectState.parkedRuntimeObjectsByRecordId instanceof Map ? objectState.parkedRuntimeObjectsByRecordId.size : 0,
                            roadRefreshMs: Number(sync.roadRefreshMs.toFixed(2)),
                            roadRefreshCount: sync.roadRefreshCount,
                            treeFinalizeMs: Number(sync.treeFinalizeMs.toFixed(2)),
                            treeLoadDebug: sync.treeLoadDebug ? { ...sync.treeLoadDebug } : null,
                            byType: (() => {
                                const out = {};
                                for (const [key, stats] of sync.profileByType.entries()) {
                                    out[key] = {
                                        loaded: Number(stats.loaded) || 0,
                                        removed: Number(stats.removed) || 0,
                                        ms: Number((Number(stats.ms) || 0).toFixed(2))
                                    };
                                }
                                return out;
                            })(),
                            captureDetail: objectState.lastCaptureStats ? { ...objectState.lastCaptureStats } : null,
                            invalidateMs: Number(sync.invalidateMs.toFixed(2))
                        };
                        session.objectsChanged = !!(sync.capturedAny || sync.removedAny || sync.loadedAny);
                    });
                    prependPrototypeTasks(session, phaseTasks);
                });
                prependPrototypeTasks(session, nextTasks);
            }]);
        };

        const enqueuePrototypeAsyncWallSync = (session) => {
            const wallState = map._prototypeWallState;
            if (!wallState) return;
            prependPrototypeTasks(session, [() => {
                const sync = {
                    captureMs: 0,
                    collectMs: 0,
                    unloadMs: 0,
                    loadJsonMs: 0,
                    addNodesMs: 0,
                    addNodesRemoveMs: 0,
                    addNodesCenterlineMs: 0,
                    addNodesDirectionalMs: 0,
                    blockedEdgeApplyMs: 0,
                    blockedEdgeRemoveMs: 0,
                    blockedEdgeAppliedLinks: 0,
                    blockedEdgeRemovedLinks: 0,
                    clearanceMs: 0,
                    clearanceNodeCount: 0,
                    precomputedBlockMs: 0,
                    precomputedBlockedConnections: 0,
                    directionalTotalMs: 0,
                    directionalClearMs: 0,
                    directionalCollectMs: 0,
                    directionalBlockMs: 0,
                    directionalBlockedConnections: 0,
                    joineryMs: 0,
                    loadedCount: 0,
                    removedCount: 0,
                    capturedAny: false,
                    removedAny: false,
                    loadedAny: false,
                    desiredRecords: [],
                    changedClearanceNodes: new Set()
                };
                const captureStart = prototypeNow();
                sync.capturedAny = !!map.capturePendingPrototypeWalls();
                sync.captureMs += prototypeNow() - captureStart;
                const nextTasks = [];
                nextTasks.push(() => {
                    const collectStart = prototypeNow();
                    const activeSectionKeys = map.getPrototypeActiveSectionKeys();
                    sync.activeSectionKeys = activeSectionKeys;
                    if (typeof map.ensurePrototypeBlockedEdges === "function") {
                        map.ensurePrototypeBlockedEdges(activeSectionKeys);
                    }
                    const desiredRecords = [];
                    const blockedEdgesByRecordId = new Map();
                    activeSectionKeys.forEach((sectionKey) => {
                        const asset = map.getPrototypeSectionAsset(sectionKey);
                        const records = Array.isArray(asset && asset.walls) ? asset.walls : null;
                        if (Array.isArray(records)) {
                            for (let i = 0; i < records.length; i++) {
                                desiredRecords.push({ sectionKey, record: records[i] });
                            }
                        }
                        const blockedEdges = Array.isArray(asset && asset.blockedEdges) ? asset.blockedEdges : null;
                        if (Array.isArray(blockedEdges)) {
                            for (let i = 0; i < blockedEdges.length; i++) {
                                const edge = blockedEdges[i];
                                const recordId = Number(edge && edge.recordId);
                                if (!Number.isInteger(recordId)) continue;
                                if (!blockedEdgesByRecordId.has(recordId)) blockedEdgesByRecordId.set(recordId, []);
                                blockedEdgesByRecordId.get(recordId).push(edge);
                            }
                        }
                    });
                    sync.desiredRecords = desiredRecords;
                    sync.blockedEdgesByRecordId = blockedEdgesByRecordId;
                    sync.desiredSignature = desiredRecords
                        .map((entry) => Number.isInteger(entry.record && entry.record.id) ? entry.record.id : "")
                        .join("|");
                    sync.collectMs += prototypeNow() - collectStart;
                    if (!sync.capturedAny && sync.desiredSignature === wallState.activeRecordSignature) {
                        wallState.lastSyncStats = {
                            ms: Number((sync.captureMs + sync.collectMs).toFixed(2)),
                            desired: desiredRecords.length,
                            loaded: 0,
                            removed: 0,
                            active: wallState.activeRuntimeWallsByRecordId instanceof Map ? wallState.activeRuntimeWallsByRecordId.size : 0,
                            captureMs: Number(sync.captureMs.toFixed(2)),
                            collectMs: Number(sync.collectMs.toFixed(2)),
                            unloadMs: 0,
                            loadJsonMs: 0,
                            addNodesMs: 0,
                            blockedEdgeApplyMs: 0,
                            blockedEdgeRemoveMs: 0,
                            blockedEdgeAppliedLinks: 0,
                            blockedEdgeRemovedLinks: 0,
                            joineryMs: 0
                        };
                        session.wallsChanged = false;
                        return;
                    }
                    if (!(wallState.activeRuntimeWallsByRecordId instanceof Map)) {
                        wallState.activeRuntimeWallsByRecordId = new Map();
                    }
                    const desiredRecordIds = new Set();
                    for (let i = 0; i < desiredRecords.length; i++) {
                        const recordId = Number(desiredRecords[i] && desiredRecords[i].record && desiredRecords[i].record.id);
                        if (Number.isInteger(recordId)) desiredRecordIds.add(recordId);
                    }
                    sync.removeBlockedSectionKeys = [];
                    const blockedEdgeState = map._prototypeBlockedEdgeState;
                    if (blockedEdgeState && blockedEdgeState.activeEntriesBySectionKey instanceof Map) {
                        for (const sectionKey of blockedEdgeState.activeEntriesBySectionKey.keys()) {
                            if (!activeSectionKeys.has(sectionKey)) sync.removeBlockedSectionKeys.push(sectionKey);
                        }
                    }
                    sync.removalEntries = [];
                    for (const [recordId, runtimeWall] of wallState.activeRuntimeWallsByRecordId.entries()) {
                        if (desiredRecordIds.has(recordId)) continue;
                        sync.removalEntries.push({ recordId, runtimeWall });
                    }
                    sync.loadWallEntries = [];
                    for (let i = 0; i < desiredRecords.length; i++) {
                        const entry = desiredRecords[i];
                        const recordId = Number(entry && entry.record && entry.record.id);
                        if (!Number.isInteger(recordId)) continue;
                        if (wallState.activeRuntimeWallsByRecordId.has(recordId)) continue;
                        sync.loadWallEntries.push(entry);
                    }
                    sync.applyBlockedSectionKeys = Array.from(activeSectionKeys);
                    const phaseTasks = [];
                    for (let i = 0; i < sync.removeBlockedSectionKeys.length; i++) {
                        const sectionKey = sync.removeBlockedSectionKeys[i];
                        phaseTasks.push(() => {
                            const start = prototypeNow();
                            sync.blockedEdgeRemovedLinks += removePrototypeBlockedEdgesForSection(map, sectionKey, sync.changedClearanceNodes);
                            sync.blockedEdgeRemoveMs += prototypeNow() - start;
                        });
                    }
                    for (let i = 0; i < sync.removalEntries.length; i++) {
                        const removalEntry = sync.removalEntries[i];
                        phaseTasks.push(() => {
                            const start = prototypeNow();
                            const recordId = Number(removalEntry && removalEntry.recordId);
                            const runtimeWall = removalEntry && removalEntry.runtimeWall;
                            if (!Number.isInteger(recordId)) return;
                            if (!runtimeWall || runtimeWall.gone) {
                                wallState.activeRuntimeWallsByRecordId.delete(recordId);
                                return;
                            }
                            if (runtimeWall._prototypeUsesSectionBlockedEdges === true) {
                                removePrototypeRuntimeWallVisual(runtimeWall);
                            } else if (typeof runtimeWall._removeWallPreserving === "function") {
                                runtimeWall._removeWallPreserving([], { skipAutoMerge: true });
                            } else if (typeof runtimeWall.removeFromGame === "function") {
                                runtimeWall.removeFromGame();
                            } else if (typeof runtimeWall.remove === "function") {
                                runtimeWall.remove();
                            }
                            wallState.activeRuntimeWallsByRecordId.delete(recordId);
                            sync.removedAny = true;
                            sync.removedCount += 1;
                            sync.unloadMs += prototypeNow() - start;
                        });
                    }
                    for (let i = 0; i < sync.loadWallEntries.length; i++) {
                        const entry = sync.loadWallEntries[i];
                        phaseTasks.push(() => {
                            const recordId = Number(entry && entry.record && entry.record.id);
                            if (!Number.isInteger(recordId) || wallState.activeRuntimeWallsByRecordId.has(recordId)) return;
                            const loadStart = prototypeNow();
                            const runtimeWall = globalScope.WallSectionUnit.loadJson(entry.record, map, { deferSetup: true });
                            sync.loadJsonMs += prototypeNow() - loadStart;
                            if (!runtimeWall) return;
                            const precomputedEdges = sync.blockedEdgesByRecordId.get(recordId) || null;
                            const usesSectionBlockedEdges = !!(precomputedEdges && precomputedEdges.length > 0);
                            if (typeof runtimeWall.addToMapNodes === "function") {
                                const addNodesStart = prototypeNow();
                                runtimeWall.addToMapNodes({ applyDirectionalBlocking: !usesSectionBlockedEdges });
                                sync.addNodesMs += prototypeNow() - addNodesStart;
                                const addStats = runtimeWall._lastAddToMapNodesStats || null;
                                if (addStats) {
                                    sync.addNodesRemoveMs += Number(addStats.removeMs) || 0;
                                    sync.addNodesCenterlineMs += Number(addStats.centerlineMs) || 0;
                                    sync.addNodesDirectionalMs += Number(addStats.directionalMs) || 0;
                                }
                                const directionalStats = runtimeWall._lastDirectionalBlockingStats || null;
                                if (directionalStats) {
                                    sync.directionalTotalMs += Number(directionalStats.ms) || 0;
                                    sync.directionalClearMs += Number(directionalStats.clearMs) || 0;
                                    sync.directionalCollectMs += Number(directionalStats.collectMs) || 0;
                                    sync.directionalBlockMs += Number(directionalStats.blockMs) || 0;
                                    sync.directionalBlockedConnections += Number(directionalStats.blockedConnectionCount) || 0;
                                }
                            }
                            runtimeWall._prototypeUsesSectionBlockedEdges = usesSectionBlockedEdges;
                            runtimeWall._prototypeRuntimeRecord = true;
                            runtimeWall._prototypeRecordId = recordId;
                            runtimeWall._prototypePersistenceSignature = buildPrototypeWallPersistenceSignature(entry.record);
                            runtimeWall._prototypeOwnerSectionKey = entry.sectionKey;
                            wallState.activeRuntimeWallsByRecordId.set(recordId, runtimeWall);
                            sync.loadedAny = true;
                            sync.loadedCount += 1;
                        });
                    }
                    for (let i = 0; i < sync.applyBlockedSectionKeys.length; i++) {
                        const sectionKey = sync.applyBlockedSectionKeys[i];
                        phaseTasks.push(() => {
                            const start = prototypeNow();
                            const appliedLinks = applyPrototypeBlockedEdgesForSection(map, sectionKey, sync.changedClearanceNodes);
                            sync.blockedEdgeApplyMs += prototypeNow() - start;
                            sync.blockedEdgeAppliedLinks += appliedLinks;
                        });
                    }
                    phaseTasks.push(() => {
                        wallState.activeRuntimeWalls = Array.from(wallState.activeRuntimeWallsByRecordId.values());
                    });
                    phaseTasks.push(() => {
                        if (wallState.activeRuntimeWalls.length > 0 && globalScope.WallSectionUnit && typeof globalScope.WallSectionUnit.batchHandleJoinery === "function") {
                            const joineryStart = prototypeNow();
                            globalScope.WallSectionUnit.batchHandleJoinery(wallState.activeRuntimeWalls);
                            sync.joineryMs += prototypeNow() - joineryStart;
                        }
                    });
                    const needsClearanceRefresh = sync.changedClearanceNodes.size > 0 || (
                        map._prototypeSectionState &&
                        Array.isArray(map._prototypeSectionState.orderedSectionAssets) &&
                        map._prototypeSectionState.orderedSectionAssets.some((asset) => asset && asset._prototypeClearanceDirty === true)
                    );
                    if (needsClearanceRefresh && !map._suppressClearanceUpdates && typeof map.applyPrototypeSectionClearance === "function") {
                        const activeKeysArray = Array.from(activeSectionKeys);
                        const clearanceChunkSize = 1200;
                        sync.clearanceNodeCount = 0;
                        for (let i = 0; i < activeKeysArray.length; i++) {
                            const sectionKey = activeKeysArray[i];
                            const sectionNodes = (map._prototypeSectionState && map._prototypeSectionState.nodesBySectionKey instanceof Map)
                                ? (map._prototypeSectionState.nodesBySectionKey.get(sectionKey) || [])
                                : [];
                            sync.clearanceNodeCount += sectionNodes.length;
                            for (let startIndex = 0; startIndex < sectionNodes.length; startIndex += clearanceChunkSize) {
                                const chunkStartIndex = startIndex;
                                phaseTasks.push(() => {
                                    const start = prototypeNow();
                                    applyPrototypeSectionClearanceChunk(map, sectionKey, chunkStartIndex, clearanceChunkSize);
                                    sync.clearanceMs += prototypeNow() - start;
                                });
                            }
                        }
                    }
                    phaseTasks.push(() => {
                        sync.precomputedBlockMs = sync.blockedEdgeApplyMs;
                        sync.precomputedBlockedConnections = sync.blockedEdgeAppliedLinks;
                        wallState.activeRuntimeWalls = Array.from(wallState.activeRuntimeWallsByRecordId.values());
                        wallState.activeRecordSignature = sync.desiredSignature;
                        if ((sync.capturedAny || sync.removedCount > 0 || sync.loadedCount > 0) && typeof globalScope.invalidateMinimap === "function") {
                            globalScope.invalidateMinimap();
                        }
                        wallState.lastSyncStats = {
                            ms: Number((sync.captureMs + sync.collectMs + sync.unloadMs + sync.loadJsonMs + sync.addNodesMs + sync.blockedEdgeApplyMs + sync.blockedEdgeRemoveMs + sync.clearanceMs + sync.joineryMs).toFixed(2)),
                            desired: sync.desiredRecords.length,
                            loaded: sync.loadedCount,
                            removed: sync.removedCount,
                            active: wallState.activeRuntimeWallsByRecordId.size,
                            captureMs: Number(sync.captureMs.toFixed(2)),
                            collectMs: Number(sync.collectMs.toFixed(2)),
                            unloadMs: Number(sync.unloadMs.toFixed(2)),
                            loadJsonMs: Number(sync.loadJsonMs.toFixed(2)),
                            addNodesMs: Number(sync.addNodesMs.toFixed(2)),
                            blockedEdgeApplyMs: Number(sync.blockedEdgeApplyMs.toFixed(2)),
                            blockedEdgeRemoveMs: Number(sync.blockedEdgeRemoveMs.toFixed(2)),
                            blockedEdgeAppliedLinks: sync.blockedEdgeAppliedLinks,
                            blockedEdgeRemovedLinks: sync.blockedEdgeRemovedLinks,
                            clearanceMs: Number(sync.clearanceMs.toFixed(2)),
                            clearanceNodeCount: sync.clearanceNodeCount,
                            addNodesRemoveMs: Number(sync.addNodesRemoveMs.toFixed(2)),
                            addNodesCenterlineMs: Number(sync.addNodesCenterlineMs.toFixed(2)),
                            addNodesDirectionalMs: Number(sync.addNodesDirectionalMs.toFixed(2)),
                            precomputedBlockMs: Number(sync.precomputedBlockMs.toFixed(2)),
                            precomputedBlockedConnections: sync.precomputedBlockedConnections,
                            directionalTotalMs: Number(sync.directionalTotalMs.toFixed(2)),
                            directionalClearMs: Number(sync.directionalClearMs.toFixed(2)),
                            directionalCollectMs: Number(sync.directionalCollectMs.toFixed(2)),
                            directionalBlockMs: Number(sync.directionalBlockMs.toFixed(2)),
                            directionalBlockedConnections: sync.directionalBlockedConnections,
                            joineryMs: Number(sync.joineryMs.toFixed(2))
                        };
                        session.wallsChanged = !!(sync.capturedAny || sync.removedCount > 0 || sync.loadedCount > 0);
                    });
                    prependPrototypeTasks(session, phaseTasks);
                });
                prependPrototypeTasks(session, nextTasks);
            }]);
        };

        const enqueuePrototypeAsyncAnimalSync = (session) => {
            const animalState = map._prototypeAnimalState;
            if (!animalState) return;
            prependPrototypeTasks(session, [() => {
                const captureStart = prototypeNow();
                const capturedAny = (typeof map.capturePendingPrototypeAnimals === "function")
                    ? map.capturePendingPrototypeAnimals()
                    : false;
                const captureMs = prototypeNow() - captureStart;
                let activeTaskMs = 0;
                const sectionState = map._prototypeSectionState;
                const activeSectionKeys = (
                    sectionState &&
                    sectionState.pendingLayoutTransition &&
                    sectionState.pendingLayoutTransition.targetActiveKeys instanceof Set
                )
                    ? new Set(sectionState.pendingLayoutTransition.targetActiveKeys)
                    : map.getPrototypeActiveSectionKeys();
                const desiredRecords = [];
                activeSectionKeys.forEach((sectionKey) => {
                    const asset = map.getPrototypeSectionAsset(sectionKey);
                    const records = Array.isArray(asset && asset.animals) ? asset.animals : null;
                    if (!Array.isArray(records)) return;
                    for (let i = 0; i < records.length; i++) desiredRecords.push({ sectionKey, record: records[i] });
                });
                const desiredSignature = desiredRecords.map((entry) => Number.isInteger(entry.record && entry.record.id) ? entry.record.id : "").join("|");
                if (desiredSignature === animalState.activeRecordSignature) {
                    animalState.lastSyncStats = {
                        ms: Number(captureMs.toFixed(2)),
                        desired: desiredRecords.length,
                        loaded: 0,
                        removed: 0,
                        active: animalState.activeRuntimeAnimalsByRecordId instanceof Map ? animalState.activeRuntimeAnimalsByRecordId.size : 0,
                        captureMs: Number(captureMs.toFixed(2))
                    };
                    session.animalsChanged = false;
                    return;
                }
                if (!(animalState.activeRuntimeAnimalsByRecordId instanceof Map)) animalState.activeRuntimeAnimalsByRecordId = new Map();
                const desiredRecordIds = new Set();
                for (let i = 0; i < desiredRecords.length; i++) {
                    if (desiredRecords[i] && desiredRecords[i].record && !Number.isInteger(Number(desiredRecords[i].record.id))) {
                        desiredRecords[i].record.id = animalState.nextRecordId++;
                    }
                    const recordId = Number(desiredRecords[i] && desiredRecords[i].record && desiredRecords[i].record.id);
                    if (Number.isInteger(recordId)) desiredRecordIds.add(recordId);
                }
                const removeTasks = [];
                let removedCount = 0;
                let loadedCount = 0;
                let removedAny = false;
                let loadedAny = false;
                for (const [recordId, runtimeAnimal] of animalState.activeRuntimeAnimalsByRecordId.entries()) {
                    if (desiredRecordIds.has(recordId)) continue;
                    removeTasks.push(() => {
                        const taskStart = prototypeNow();
                        if (runtimeAnimal && typeof runtimeAnimal.removeFromGame === "function") runtimeAnimal.removeFromGame();
                        else if (runtimeAnimal && typeof runtimeAnimal.remove === "function") runtimeAnimal.remove();
                        else if (runtimeAnimal) runtimeAnimal.gone = true;
                        animalState.activeRuntimeAnimalsByRecordId.delete(recordId);
                        removedAny = true;
                        removedCount += 1;
                        activeTaskMs += prototypeNow() - taskStart;
                    });
                }
                for (let i = 0; i < desiredRecords.length; i++) {
                    const entry = desiredRecords[i];
                    removeTasks.push(() => {
                        const taskStart = prototypeNow();
                        const recordId = Number(entry && entry.record && entry.record.id);
                        if (!Number.isInteger(recordId) || animalState.activeRuntimeAnimalsByRecordId.has(recordId)) return;
                        if (!globalScope.Animal || typeof globalScope.Animal.loadJson !== "function") return;
                        const runtimeAnimal = globalScope.Animal.loadJson(entry.record, map);
                        if (!runtimeAnimal) return;
                        if (Array.isArray(globalScope.animals) && globalScope.animals.indexOf(runtimeAnimal) < 0) globalScope.animals.push(runtimeAnimal);
                        runtimeAnimal._prototypeRuntimeRecord = true;
                        runtimeAnimal._prototypeRecordId = recordId;
                        runtimeAnimal._prototypeOwnerSectionKey = entry.sectionKey;
                        animalState.activeRuntimeAnimalsByRecordId.set(recordId, runtimeAnimal);
                        loadedAny = true;
                        loadedCount += 1;
                        activeTaskMs += prototypeNow() - taskStart;
                    });
                }
                removeTasks.push(() => {
                    animalState.activeRuntimeAnimals = Array.from(animalState.activeRuntimeAnimalsByRecordId.values());
                    animalState.activeRecordSignature = desiredSignature;
                    animalState.lastSyncStats = {
                        ms: Number((captureMs + activeTaskMs).toFixed(2)),
                        desired: desiredRecords.length,
                        loaded: loadedCount,
                        removed: removedCount,
                        active: animalState.activeRuntimeAnimalsByRecordId.size,
                        captureMs: Number(captureMs.toFixed(2))
                    };
                    session.animalsChanged = !!(capturedAny || removedAny || loadedAny);
                });
                prependPrototypeTasks(session, removeTasks);
            }]);
        };

        const enqueuePrototypeAsyncPowerupSync = (session) => {
            const powerupState = map._prototypePowerupState;
            if (!powerupState) return;
            prependPrototypeTasks(session, [() => {
                let activeTaskMs = 0;
                const activeSectionKeys = map.getPrototypeActiveSectionKeys();
                const desiredRecords = [];
                activeSectionKeys.forEach((sectionKey) => {
                    const asset = map.getPrototypeSectionAsset(sectionKey);
                    const records = Array.isArray(asset && asset.powerups) ? asset.powerups : null;
                    if (!Array.isArray(records)) return;
                    for (let i = 0; i < records.length; i++) desiredRecords.push({ sectionKey, record: records[i] });
                });
                const desiredSignature = desiredRecords.map((entry) => Number.isInteger(entry.record && entry.record.id) ? entry.record.id : "").join("|");
                if (desiredSignature === powerupState.activeRecordSignature) {
                    powerupState.lastSyncStats = {
                        ms: 0,
                        desired: desiredRecords.length,
                        loaded: 0,
                        removed: 0,
                        active: powerupState.activeRuntimePowerupsByRecordId instanceof Map ? powerupState.activeRuntimePowerupsByRecordId.size : 0
                    };
                    session.powerupsChanged = false;
                    return;
                }
                if (!(powerupState.activeRuntimePowerupsByRecordId instanceof Map)) powerupState.activeRuntimePowerupsByRecordId = new Map();
                const desiredRecordIds = new Set();
                for (let i = 0; i < desiredRecords.length; i++) {
                    if (desiredRecords[i] && desiredRecords[i].record && !Number.isInteger(Number(desiredRecords[i].record.id))) {
                        desiredRecords[i].record.id = powerupState.nextRecordId++;
                    }
                    const recordId = Number(desiredRecords[i] && desiredRecords[i].record && desiredRecords[i].record.id);
                    if (Number.isInteger(recordId)) desiredRecordIds.add(recordId);
                }
                const tasks = [];
                let removedCount = 0;
                let loadedCount = 0;
                let removedAny = false;
                let loadedAny = false;
                for (const [recordId, runtimePowerup] of powerupState.activeRuntimePowerupsByRecordId.entries()) {
                    if (desiredRecordIds.has(recordId)) continue;
                    tasks.push(() => {
                        const taskStart = prototypeNow();
                        if (runtimePowerup) {
                            runtimePowerup.collected = true;
                            runtimePowerup.gone = true;
                            if (runtimePowerup.pixiSprite && runtimePowerup.pixiSprite.parent) runtimePowerup.pixiSprite.parent.removeChild(runtimePowerup.pixiSprite);
                            if (Array.isArray(globalScope.powerups)) {
                                const idx = globalScope.powerups.indexOf(runtimePowerup);
                                if (idx >= 0) globalScope.powerups.splice(idx, 1);
                            }
                        }
                        powerupState.activeRuntimePowerupsByRecordId.delete(recordId);
                        removedAny = true;
                        removedCount += 1;
                        activeTaskMs += prototypeNow() - taskStart;
                    });
                }
                for (let i = 0; i < desiredRecords.length; i++) {
                    const entry = desiredRecords[i];
                    tasks.push(() => {
                        const taskStart = prototypeNow();
                        const recordId = Number(entry && entry.record && entry.record.id);
                        if (!Number.isInteger(recordId) || powerupState.activeRuntimePowerupsByRecordId.has(recordId)) return;
                        if (!globalScope.Powerup || typeof globalScope.Powerup.loadJson !== "function") return;
                        const runtimePowerup = globalScope.Powerup.loadJson(entry.record);
                        if (!runtimePowerup) return;
                        if (!Array.isArray(globalScope.powerups)) globalScope.powerups = [];
                        globalScope.powerups.push(runtimePowerup);
                        runtimePowerup._prototypeRuntimeRecord = true;
                        runtimePowerup._prototypeRecordId = recordId;
                        runtimePowerup._prototypeOwnerSectionKey = entry.sectionKey;
                        powerupState.activeRuntimePowerupsByRecordId.set(recordId, runtimePowerup);
                        loadedAny = true;
                        loadedCount += 1;
                        activeTaskMs += prototypeNow() - taskStart;
                    });
                }
                tasks.push(() => {
                    powerupState.activeRuntimePowerups = Array.from(powerupState.activeRuntimePowerupsByRecordId.values());
                    powerupState.activeRecordSignature = desiredSignature;
                    powerupState.lastSyncStats = {
                        ms: Number(activeTaskMs.toFixed(2)),
                        desired: desiredRecords.length,
                        loaded: loadedCount,
                        removed: removedCount,
                        active: powerupState.activeRuntimePowerupsByRecordId.size
                    };
                    session.powerupsChanged = !!(removedAny || loadedAny);
                });
                prependPrototypeTasks(session, tasks);
            }]);
        };

        return {
            enqueuePrototypeAsyncObjectSync,
            enqueuePrototypeAsyncWallSync,
            enqueuePrototypeAsyncAnimalSync,
            enqueuePrototypeAsyncPowerupSync
        };
    }

    globalScope.__sectionWorldAsyncSync = {
        createSectionWorldAsyncSyncPlanners,
        createPrototypeAsyncSyncPlanners: createSectionWorldAsyncSyncPlanners
    };
    globalScope.__twoSectionPrototypeAsyncSync = globalScope.__sectionWorldAsyncSync;
})(typeof globalThis !== "undefined" ? globalThis : window);

if (typeof module !== "undefined" && module.exports) {
    module.exports = globalThis.__sectionWorldAsyncSync;
}
