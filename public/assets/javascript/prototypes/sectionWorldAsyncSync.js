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
        } = deps;

        const objectTaskTypeLabel = (entryOrObj) => {
            const type = (entryOrObj && entryOrObj.record && entryOrObj.record.type) || entryOrObj && entryOrObj.type;
            return (typeof type === "string" && type.length > 0) ? type : "unknown";
        };

        const restoreActivePrototypeWallRegistry = (wallState) => {
            const wallCtor = globalScope.WallSectionUnit;
            const registry = (wallCtor && wallCtor._allSections instanceof Map)
                ? wallCtor._allSections
                : null;
            if (!registry || !(wallState && wallState.activeRuntimeWallsByRecordId instanceof Map)) {
                return 0;
            }
            let restoredCount = 0;
            for (const [recordId, runtimeWall] of wallState.activeRuntimeWallsByRecordId.entries()) {
                if (!runtimeWall || runtimeWall.gone) continue;
                const wallId = Number.isInteger(runtimeWall.id)
                    ? Number(runtimeWall.id)
                    : (Number.isInteger(recordId) ? Number(recordId) : null);
                if (!Number.isInteger(wallId)) continue;
                if (!Number.isInteger(runtimeWall.id)) {
                    runtimeWall.id = wallId;
                }
                if (registry.get(wallId) === runtimeWall) continue;
                registry.set(wallId, runtimeWall);
                restoredCount += 1;
            }
            return restoredCount;
        };

        const chooseMountedWallReplacementId = (obj, replacementIds) => {
            const ids = Array.isArray(replacementIds)
                ? replacementIds.filter((id) => Number.isInteger(Number(id))).map((id) => Number(id))
                : [];
            if (ids.length === 0) return null;
            if (ids.length === 1 || !obj || !Number.isFinite(obj.x) || !Number.isFinite(obj.y)) return ids[0];
            const wallCtor = globalScope.WallSectionUnit;
            const registry = wallCtor && wallCtor._allSections instanceof Map ? wallCtor._allSections : null;
            if (!registry) return ids[0];
            let bestId = ids[0];
            let bestDist = Infinity;
            for (let i = 0; i < ids.length; i++) {
                const wall = registry.get(ids[i]);
                if (!wall || !wall.startPoint || !wall.endPoint) continue;
                const ax = Number(wall.startPoint.x);
                const ay = Number(wall.startPoint.y);
                const bx = Number(wall.endPoint.x);
                const by = Number(wall.endPoint.y);
                if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) continue;
                const dx = bx - ax;
                const dy = by - ay;
                const lenSq = dx * dx + dy * dy;
                const t = lenSq > 1e-8
                    ? Math.max(0, Math.min(1, (((Number(obj.x) - ax) * dx) + ((Number(obj.y) - ay) * dy)) / lenSq))
                    : 0;
                const cx = ax + dx * t;
                const cy = ay + dy * t;
                const ox = Number(obj.x) - cx;
                const oy = Number(obj.y) - cy;
                const dist = (ox * ox) + (oy * oy);
                if (dist < bestDist) {
                    bestDist = dist;
                    bestId = ids[i];
                }
            }
            return bestId;
        };

        const getMountedWallReferenceId = (entry) => {
            if (!entry || typeof entry !== "object") return null;
            const candidates = [
                entry.mountedWallSectionUnitId,
                entry.mountedWallLineGroupId,
                entry.mountedSectionId
            ];
            for (let i = 0; i < candidates.length; i++) {
                const id = Number(candidates[i]);
                if (Number.isInteger(id)) return id;
            }
            return null;
        };

        const setMountedWallReferenceId = (entry, replacementId) => {
            if (!entry || !Number.isInteger(replacementId)) return false;
            entry.mountedWallSectionUnitId = replacementId;
            entry.mountedWallLineGroupId = replacementId;
            entry.mountedSectionId = replacementId;
            return true;
        };

        const applyPendingMountedWallIdRemaps = (wallState) => {
            const remaps = wallState && wallState.pendingMountedWallIdRemaps instanceof Map
                ? wallState.pendingMountedWallIdRemaps
                : null;
            if (!remaps || remaps.size === 0) return [];
            const remappedObjects = [];
            const remapRecord = (record) => {
                const oldId = getMountedWallReferenceId(record);
                if (!Number.isInteger(oldId) || !remaps.has(oldId)) return false;
                const nextId = chooseMountedWallReplacementId(record, remaps.get(oldId));
                if (!Number.isInteger(nextId)) return false;
                return setMountedWallReferenceId(record, nextId);
            };
            const sectionState = map && map._prototypeSectionState;
            const assets = sectionState && Array.isArray(sectionState.orderedSectionAssets)
                ? sectionState.orderedSectionAssets
                : [];
            for (let i = 0; i < assets.length; i++) {
                const records = Array.isArray(assets[i] && assets[i].objects) ? assets[i].objects : [];
                for (let j = 0; j < records.length; j++) {
                    remapRecord(records[j]);
                }
            }
            const objectState = map && map._prototypeObjectState;
            const runtimeObjects = objectState && objectState.activeRuntimeObjectsByRecordId instanceof Map
                ? Array.from(objectState.activeRuntimeObjectsByRecordId.values())
                : [];
            for (let i = 0; i < runtimeObjects.length; i++) {
                const obj = runtimeObjects[i];
                if (!obj || obj.gone) continue;
                const oldId = getMountedWallReferenceId(obj);
                if (!Number.isInteger(oldId) || !remaps.has(oldId)) continue;
                const nextId = chooseMountedWallReplacementId(obj, remaps.get(oldId));
                if (!Number.isInteger(nextId)) continue;
                setMountedWallReferenceId(obj, nextId);
                let snapSucceeded = false;
                if (typeof obj.snapToMountedWall === "function") {
                    snapSucceeded = !!obj.snapToMountedWall();
                }
                if (!snapSucceeded) {
                    const wallCtor = globalScope.WallSectionUnit;
                    const wall = wallCtor && wallCtor._allSections instanceof Map
                        ? wallCtor._allSections.get(nextId)
                        : null;
                    if (wall && typeof wall.attachObject === "function") {
                        snapSucceeded = !!wall.attachObject(obj);
                    }
                }
                if (typeof obj.refreshIndexedNodesFromHitbox === "function") {
                    obj.refreshIndexedNodesFromHitbox({ minExtent: 1.5, sampleSpacing: 1.0 });
                }
                if (isPrototypeSavableObject(obj)) {
                    upsertPrototypeObjectRecord(obj);
                }
                remappedObjects.push(obj);
            }
            remaps.clear();
            return remappedObjects;
        };

        const emitPrototypeWallSwapDiagnostic = (phase, wallState, sync, extra = {}) => {
            const sectionState = map && map._prototypeSectionState;
            const objectState = map && map._prototypeObjectState;
            const wallCtor = globalScope.WallSectionUnit;
            const registry = (wallCtor && wallCtor._allSections instanceof Map) ? wallCtor._allSections : null;
            const activeWallEntries = (wallState && wallState.activeRuntimeWallsByRecordId instanceof Map)
                ? Array.from(wallState.activeRuntimeWallsByRecordId.entries())
                : [];
            const activeObjects = (objectState && objectState.activeRuntimeObjectsByRecordId instanceof Map)
                ? Array.from(objectState.activeRuntimeObjectsByRecordId.values())
                : [];
            const mapObjects = Array.isArray(map && map.objects) ? map.objects : [];
            const activeKeys = sync && sync.activeSectionKeys instanceof Set
                ? Array.from(sync.activeSectionKeys)
                : (typeof map.getPrototypeActiveSectionKeys === "function" ? Array.from(map.getPrototypeActiveSectionKeys()) : []);
            const mountedCategory = (obj) => {
                const category = (typeof obj && obj && obj.category === "string") ? obj.category.trim().toLowerCase() : "";
                const type = (typeof obj && obj && obj.type === "string") ? obj.type.trim().toLowerCase() : "";
                return category === "doors" || category === "windows" || type === "door" || type === "window";
            };
            const objectSummary = (obj) => obj && typeof obj === "object" ? ({
                id: Number.isInteger(Number(obj._prototypeRecordId)) ? Number(obj._prototypeRecordId) : (Number.isInteger(Number(obj.id)) ? Number(obj.id) : null),
                type: typeof obj.type === "string" ? obj.type : "",
                category: typeof obj.category === "string" ? obj.category : "",
                gone: !!obj.gone,
                mountedWallLineGroupId: Number.isInteger(Number(obj.mountedWallLineGroupId)) ? Number(obj.mountedWallLineGroupId) : null,
                mountedSectionId: Number.isInteger(Number(obj.mountedSectionId)) ? Number(obj.mountedSectionId) : null,
                mountedWallSectionUnitId: Number.isInteger(Number(obj.mountedWallSectionUnitId)) ? Number(obj.mountedWallSectionUnitId) : null,
                ownerSectionKey: typeof obj._prototypeOwnerSectionKey === "string" ? obj._prototypeOwnerSectionKey : ""
            }) : null;
            const countActiveAssetRecords = () => {
                const totals = { objects: 0, mounted: 0, roads: 0, walls: 0 };
                for (let i = 0; i < activeKeys.length; i++) {
                    const asset = typeof map.getPrototypeSectionAsset === "function"
                        ? map.getPrototypeSectionAsset(activeKeys[i])
                        : null;
                    const objects = Array.isArray(asset && asset.objects) ? asset.objects : [];
                    const walls = Array.isArray(asset && asset.walls) ? asset.walls : [];
                    totals.objects += objects.length;
                    totals.walls += walls.length;
                    for (let j = 0; j < objects.length; j++) {
                        const record = objects[j];
                        const category = (typeof record && record && record.category === "string") ? record.category.trim().toLowerCase() : "";
                        const type = (typeof record && record && record.type === "string") ? record.type.trim().toLowerCase() : "";
                        if (type === "road") totals.roads += 1;
                        if (category === "doors" || category === "windows" || type === "door" || type === "window") totals.mounted += 1;
                    }
                }
                return totals;
            };
            let attachedCount = 0;
            const attachedObjectSamples = [];
            for (let i = 0; i < activeWallEntries.length; i++) {
                const wall = activeWallEntries[i][1];
                const attached = Array.isArray(wall && wall.attachedObjects) ? wall.attachedObjects : [];
                attachedCount += attached.length;
                for (let j = 0; j < attached.length && attachedObjectSamples.length < 12; j++) {
                    attachedObjectSamples.push(objectSummary(attached[j] && attached[j].object));
                }
            }
            const mountedActiveObjects = activeObjects.filter(mountedCategory);
            const mountedMapObjects = mapObjects.filter(mountedCategory);
            const roadActiveObjects = activeObjects.filter(obj => obj && obj.type === "road");
            const roadMapObjects = mapObjects.filter(obj => obj && obj.type === "road");
            const snapshot = {
                phase,
                atMs: Number((prototypeNow()).toFixed(2)),
                centerKey: sectionState && typeof sectionState.activeCenterKey === "string" ? sectionState.activeCenterKey : "",
                pendingCenterKey: sectionState && sectionState.pendingLayoutTransition && typeof sectionState.pendingLayoutTransition.targetCenterKey === "string"
                    ? sectionState.pendingLayoutTransition.targetCenterKey
                    : "",
                activeSectionKeys: activeKeys,
                desiredWalls: Array.isArray(sync && sync.desiredRecords) ? sync.desiredRecords.length : 0,
                activeWalls: activeWallEntries.length,
                registryWalls: registry ? registry.size : 0,
                plannedUnloadWallIds: Array.isArray(sync && sync.removalEntries) ? sync.removalEntries.map(entry => Number(entry && entry.recordId)).filter(Number.isInteger).slice(0, 24) : [],
                plannedLoadWallIds: Array.isArray(sync && sync.loadWallEntries) ? sync.loadWallEntries.map(entry => Number(entry && entry.record && entry.record.id)).filter(Number.isInteger).slice(0, 24) : [],
                removedCount: Number(sync && sync.removedCount) || 0,
                loadedCount: Number(sync && sync.loadedCount) || 0,
                orphanedMountedCount: Array.isArray(sync && sync.orphanedMountedObjects) ? sync.orphanedMountedObjects.length : 0,
                orphanedMountedSamples: Array.isArray(sync && sync.orphanedMountedObjects)
                    ? sync.orphanedMountedObjects.slice(0, 12).map(objectSummary)
                    : [],
                attachedCount,
                attachedObjectSamples,
                runtimeObjects: {
                    active: activeObjects.length,
                    activeMounted: mountedActiveObjects.length,
                    mapMounted: mountedMapObjects.length,
                    activeRoads: roadActiveObjects.length,
                    mapRoads: roadMapObjects.length,
                    goneActive: activeObjects.filter(obj => obj && obj.gone).length,
                    dirtyCount: objectState && objectState.dirtyRuntimeObjects instanceof Set ? objectState.dirtyRuntimeObjects.size : 0,
                    captureScanNeeded: !!(objectState && objectState.captureScanNeeded)
                },
                activeAssetRecords: countActiveAssetRecords(),
                extra: extra && typeof extra === "object" ? { ...extra } : {}
            };
            if (!Array.isArray(globalScope.prototypeWallSyncDiagnostics)) {
                globalScope.prototypeWallSyncDiagnostics = [];
            }
            globalScope.prototypeWallSyncDiagnostics.push(snapshot);
            if (globalScope.prototypeWallSyncDiagnostics.length > 200) {
                globalScope.prototypeWallSyncDiagnostics.splice(0, globalScope.prototypeWallSyncDiagnostics.length - 200);
            }
            if (typeof globalScope.prototypeWallSyncDiagnosticHook === "function") {
                try { globalScope.prototypeWallSyncDiagnosticHook(snapshot); } catch (_err) {}
            }
            if (typeof globalScope.onPrototypeWallSyncDiagnostic === "function") {
                try { globalScope.onPrototypeWallSyncDiagnostic(snapshot); } catch (_err) {}
            }
            if (globalScope.DEBUG_PROTOTYPE_WALL_SYNC === true || globalScope.prototypeWallSyncDiagnosticsEnabled === true) {
                console.log("[prototype wall sync]", snapshot);
            }
            return snapshot;
        };

        const markLevel0RoadSurfacesDirtyForNodes = (nodes) => {
            if (!(nodes instanceof Set) || nodes.size === 0) return 0;
            const markDirty = globalScope.markPrototypeLevel0RoadSurfaceDirty;
            if (typeof markDirty !== "function") return 0;
            const flushDirty = globalScope.flushPrototypeLevel0RoadSurfaceDirtyAsset;
            const sectionState = map && map._prototypeSectionState;
            const dirtyAssets = new Set();
            let dirtyCount = 0;
            nodes.forEach((node) => {
                if (!node || typeof node !== "object") return;
                if (markDirty(map, node, { immediate: typeof flushDirty !== "function" })) {
                    dirtyCount += 1;
                    const sectionKey = typeof node._prototypeSectionKey === "string" ? node._prototypeSectionKey : "";
                    const asset = sectionKey && sectionState && sectionState.sectionAssetsByKey instanceof Map
                        ? sectionState.sectionAssetsByKey.get(sectionKey)
                        : null;
                    if (asset) dirtyAssets.add(asset);
                }
            });
            if (typeof flushDirty === "function") {
                dirtyAssets.forEach((asset) => flushDirty(asset));
            }
            return dirtyCount;
        };

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
            prependPrototypeTasks(session, [createPrototypeTask("objects.plan", () => {
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
                        nextTasks.push(createPrototypeTask("objects.captureGone", () => {
                            const taskStart = prototypeNow();
                            if (removePrototypeObjectRecordById(objectState, Number(recordId))) {
                                sync.capturedAny = true;
                                sync.captureDetail.goneRemovedCount += 1;
                            }
                            const taskMs = prototypeNow() - taskStart;
                            sync.captureDetail.pruneGoneMs += taskMs;
                            sync.captureMs += taskMs;
                        }));
                    }
                    for (let i = 0; i < sync.dirtyObjects.length; i++) {
                        const obj = sync.dirtyObjects[i];
                        nextTasks.push(createPrototypeTask(`objects.captureDirty.${objectTaskTypeLabel(obj)}`, () => {
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
                        }));
                    }
                }
                nextTasks.push(createPrototypeTask("objects.captureFinalize", () => {
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
                }));
                nextTasks.push(createPrototypeTask("objects.collect", () => {
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
                    if (typeof map.getPrototypeTriggerDefsForSectionKeys === "function") {
                        const triggerDefs = map.getPrototypeTriggerDefsForSectionKeys(activeSectionKeys);
                        for (let i = 0; i < triggerDefs.length; i++) {
                            const triggerDef = triggerDefs[i];
                            if (!triggerDef || typeof triggerDef !== "object") continue;
                            desiredRecords.push({ sectionKey: "", record: triggerDef });
                        }
                    }
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
                        phaseTasks.push(createPrototypeTask(`objects.unload.${objectTaskTypeLabel(removalEntry && removalEntry.runtimeObj)}`, () => {
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
                        }));
                    }
                    phaseTasks.push(createPrototypeTask("objects.trimParked", () => {
                        const trimStart = prototypeNow();
                        sync.parkedEvicted += trimPrototypeParkedRuntimeObjectCache(objectState);
                        sync.unloadMs += prototypeNow() - trimStart;
                    }));
                    for (let i = 0; i < sync.loadEntries.length; i++) {
                        const entry = sync.loadEntries[i];
                        phaseTasks.push(createPrototypeTask(`objects.load.${objectTaskTypeLabel(entry)}`, () => {
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
                                        runtimeObj = globalScope.Roof.loadJson(entry.record, {
                                            suppressAutoScriptingName: true,
                                            trustLoadedScriptingName: true,
                                            targetSectionKey: entry.sectionKey
                                        });
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
                                        trustLoadedScriptingName: true,
                                        targetSectionKey: entry.sectionKey
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
                        }));
                    }
                    phaseTasks.push(createPrototypeTask("objects.roadRefreshPlan", () => {
                        if (sync.roadRefreshNodes.size === 0) return;
                        const dirtyTask = createPrototypeTask("objects.roadSurfaceDirty", () => {
                            markLevel0RoadSurfacesDirtyForNodes(sync.roadRefreshNodes);
                        });
                        if (!globalScope.Road) {
                            prependPrototypeTasks(session, [dirtyTask]);
                            return;
                        }
                        const refreshRoads = (typeof globalScope.Road.collectRefreshRoadsFromNodes === "function")
                            ? globalScope.Road.collectRefreshRoadsFromNodes(sync.roadRefreshNodes)
                            : null;
                        if (Array.isArray(refreshRoads) && refreshRoads.length > 0 && typeof globalScope.Road.refreshTexturesForRoads === "function") {
                            const roadRefreshChunkSize = 6;
                            sync.roadRefreshCount = refreshRoads.length;
                            const refreshTasks = [];
                            for (let i = 0; i < refreshRoads.length; i += roadRefreshChunkSize) {
                                const startIndex = i;
                                refreshTasks.push(createPrototypeTask("objects.roadRefresh", () => {
                                    const roadRefreshStart = prototypeNow();
                                    globalScope.Road.refreshTexturesForRoads(refreshRoads, startIndex, roadRefreshChunkSize);
                                    sync.roadRefreshMs += prototypeNow() - roadRefreshStart;
                                }));
                            }
                            refreshTasks.push(dirtyTask);
                            prependPrototypeTasks(session, refreshTasks);
                            return;
                        }
                        if (typeof globalScope.Road.refreshTexturesAroundNodes === "function") {
                            prependPrototypeTasks(session, [createPrototypeTask("objects.roadRefresh", () => {
                                const roadRefreshStart = prototypeNow();
                                sync.roadRefreshCount = globalScope.Road.refreshTexturesAroundNodes(sync.roadRefreshNodes);
                                sync.roadRefreshMs += prototypeNow() - roadRefreshStart;
                            }), dirtyTask]);
                            return;
                        }
                        prependPrototypeTasks(session, [dirtyTask]);
                    }));
                    phaseTasks.push(createPrototypeTask("objects.treeFinalizePlan", () => {
                        const deferredTrees = Array.isArray(sync.deferredTrees) ? sync.deferredTrees : [];
                        if (sync.treeDebugStarted === true && sync.treeDebugEnabled) {
                            sync.treeLoadDebug = globalScope.Tree.endPrototypeLoadDebugSession();
                            sync.treeDebugStarted = false;
                        }
                        if (deferredTrees.length === 0) {
                            // Nothing to finalize — run commit inline.
                            objectState.activeRuntimeObjects = Array.from(objectState.activeRuntimeObjectsByRecordId.values());
                            objectState.activeRecordSignature = sync.desiredSignature;
                            objectState.captureScanNeeded = false;
                            if ((sync.capturedAny || sync.removedAny || sync.loadedAny) && typeof globalScope.invalidateMinimap === "function") {
                                const invalidateStart = prototypeNow();
                                globalScope.invalidateMinimap();
                                sync.invalidateMs += prototypeNow() - invalidateStart;
                            }
                            return;
                        }
                        const treeChunkSize = 50;
                        const treeTasks = [];
                        for (let i = 0; i < deferredTrees.length; i += treeChunkSize) {
                            const batchStart = i;
                            treeTasks.push(createPrototypeTask("objects.treeFinalizeChunk", () => {
                                const t0 = prototypeNow();
                                const end = Math.min(batchStart + treeChunkSize, deferredTrees.length);
                                for (let t = batchStart; t < end; t++) {
                                    const tree = deferredTrees[t];
                                    if (tree && typeof tree.finalizeDeferredLoad === "function") {
                                        tree.finalizeDeferredLoad();
                                    }
                                }
                                sync.treeFinalizeMs += prototypeNow() - t0;
                            }));
                        }
                        treeTasks.push(createPrototypeTask("objects.treeFinalizeCommit", () => {
                            objectState.activeRuntimeObjects = Array.from(objectState.activeRuntimeObjectsByRecordId.values());
                            objectState.activeRecordSignature = sync.desiredSignature;
                            objectState.captureScanNeeded = false;
                            if ((sync.capturedAny || sync.removedAny || sync.loadedAny) && typeof globalScope.invalidateMinimap === "function") {
                                const invalidateStart = prototypeNow();
                                globalScope.invalidateMinimap();
                                sync.invalidateMs += prototypeNow() - invalidateStart;
                            }
                        }));
                        prependPrototypeTasks(session, treeTasks);
                    }));
                    phaseTasks.push(createPrototypeTask("objects.finalizeStats", () => {
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
                    }));
                    prependPrototypeTasks(session, phaseTasks);
                }));
                prependPrototypeTasks(session, nextTasks);
            })]);
        };

        const enqueuePrototypeAsyncWallSync = (session, options = {}) => {
            const wallState = map._prototypeWallState;
            if (!wallState) return;
            if (!(wallState.pendingCapturedMountedObjects instanceof Set)) {
                wallState.pendingCapturedMountedObjects = new Set();
            }
            const scopedSectionKeys = Array.isArray(options && options.onlySectionKeys)
                ? Array.from(new Set(options.onlySectionKeys.filter((sectionKey) => typeof sectionKey === "string" && sectionKey.length > 0)))
                : null;
            const requestedScopedToSections = Array.isArray(scopedSectionKeys);
            prependPrototypeTasks(session, [createPrototypeTask("walls.plan", () => {
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
                    requestedScopedToSections,
                    scopedToSections: requestedScopedToSections,
                    scopedSectionKeys: scopedSectionKeys ? scopedSectionKeys.slice() : null,
                    loadedRuntimeWalls: [],
                    changedClearanceNodes: new Set()
                };
                const captureStart = prototypeNow();
                sync.capturedAny = !!map.capturePendingPrototypeWalls({
                    allowRuntimeSignatureCapture: !requestedScopedToSections
                });
                sync.captureMs += prototypeNow() - captureStart;
                if (sync.capturedAny && sync.scopedToSections) {
                    sync.scopedToSections = false;
                    sync.scopedSectionKeys = null;
                }
                const nextTasks = [];
                nextTasks.push(createPrototypeTask("walls.collect", () => {
                    const collectStart = prototypeNow();
                    const activeSectionKeys = map.getPrototypeActiveSectionKeys();
                    const collectSectionKeys = sync.scopedToSections ? new Set(scopedSectionKeys) : activeSectionKeys;
                    sync.activeSectionKeys = activeSectionKeys;
                    sync.collectSectionKeys = collectSectionKeys;
                    if (typeof map.ensurePrototypeBlockedEdges === "function") {
                        map.ensurePrototypeBlockedEdges(collectSectionKeys);
                    }
                    const desiredRecords = [];
                    const blockedEdgesByRecordId = new Map();
                    // Load-time wall splitting disabled — walls are already split in
                    // saved section assets.  New walls placed at runtime are split by
                    // capturePrototypeWall when they are captured into section records.
                    // Center-change sync scopes this to newly-entered sections;
                    // full sync still reconciles all active sections.
                    collectSectionKeys.forEach((sectionKey) => {
                        const asset = map.getPrototypeSectionAsset(sectionKey);
                        if (!asset) return;
                        const records = Array.isArray(asset.walls) ? asset.walls : null;
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
                    sync.restoredRegistryCount = restoreActivePrototypeWallRegistry(wallState);
                    if (!sync.scopedToSections && !sync.capturedAny && sync.desiredSignature === wallState.activeRecordSignature && sync.restoredRegistryCount === 0) {
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
                            joineryMs: 0,
                            restoredRegistryCount: 0,
                            scopedSectionKeys: null
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
                    if (!sync.scopedToSections && blockedEdgeState && blockedEdgeState.activeEntriesBySectionKey instanceof Map) {
                        for (const sectionKey of blockedEdgeState.activeEntriesBySectionKey.keys()) {
                            if (!activeSectionKeys.has(sectionKey)) sync.removeBlockedSectionKeys.push(sectionKey);
                        }
                    }
                    sync.removalEntries = [];
                    sync.orphanedMountedObjects = [];
                    if (!sync.scopedToSections) {
                        for (const [recordId, runtimeWall] of wallState.activeRuntimeWallsByRecordId.entries()) {
                            if (desiredRecordIds.has(recordId)) continue;
                            sync.removalEntries.push({ recordId, runtimeWall });
                        }
                    }
                    sync.loadWallEntries = [];
                    for (let i = 0; i < desiredRecords.length; i++) {
                        const entry = desiredRecords[i];
                        const recordId = Number(entry && entry.record && entry.record.id);
                        if (!Number.isInteger(recordId)) continue;
                        if (wallState.activeRuntimeWallsByRecordId.has(recordId)) continue;
                        sync.loadWallEntries.push(entry);
                    }
                    sync.applyBlockedSectionKeys = Array.from(collectSectionKeys);
                    const phaseTasks = [];
                    for (let i = 0; i < sync.removeBlockedSectionKeys.length; i++) {
                        const sectionKey = sync.removeBlockedSectionKeys[i];
                        phaseTasks.push(createPrototypeTask("walls.removeBlockedEdges", () => {
                            const start = prototypeNow();
                            sync.blockedEdgeRemovedLinks += removePrototypeBlockedEdgesForSection(map, sectionKey, sync.changedClearanceNodes);
                            sync.blockedEdgeRemoveMs += prototypeNow() - start;
                        }));
                    }
                    if (sync.removalEntries.length > 0 || sync.loadWallEntries.length > 0) {
                        phaseTasks.push(createPrototypeTask("walls.diagnostic.beforeUnload", () => {
                            emitPrototypeWallSwapDiagnostic("beforeUnload", wallState, sync, {
                                queuedTasks: "before wall removal",
                                unloadCount: sync.removalEntries.length,
                                loadCount: sync.loadWallEntries.length
                            });
                        }));
                    }
                    for (let i = 0; i < sync.removalEntries.length; i++) {
                        const removalEntry = sync.removalEntries[i];
                        phaseTasks.push(createPrototypeTask("walls.unload", () => {
                            const start = prototypeNow();
                            const recordId = Number(removalEntry && removalEntry.recordId);
                            const runtimeWall = removalEntry && removalEntry.runtimeWall;
                            if (!Number.isInteger(recordId)) return;
                            if (!runtimeWall || runtimeWall.gone) {
                                wallState.activeRuntimeWallsByRecordId.delete(recordId);
                                return;
                            }
                            // Rescue attached objects (doors/windows) before the wall
                            // is removed — they will be re-snapped after joinery.
                            if (Array.isArray(runtimeWall.attachedObjects)) {
                                for (let a = 0; a < runtimeWall.attachedObjects.length; a++) {
                                    const entry = runtimeWall.attachedObjects[a];
                                    if (entry && entry.object && !entry.object.gone) {
                                        sync.orphanedMountedObjects.push(entry.object);
                                    }
                                }
                                runtimeWall.attachedObjects.length = 0;
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
                        }));
                    }
                    if (sync.removalEntries.length > 0) {
                        phaseTasks.push(createPrototypeTask("walls.diagnostic.afterUnload", () => {
                            emitPrototypeWallSwapDiagnostic("afterUnload", wallState, sync, {
                                queuedTasks: "after wall removal, before wall load"
                            });
                        }));
                    }
                    for (let i = 0; i < sync.loadWallEntries.length; i++) {
                        const entry = sync.loadWallEntries[i];
                        phaseTasks.push(createPrototypeTask("walls.loadJson", () => {
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
                            sync.loadedRuntimeWalls.push(runtimeWall);
                            sync.loadedAny = true;
                            sync.loadedCount += 1;
                        }));
                    }
                    if (sync.loadWallEntries.length > 0) {
                        phaseTasks.push(createPrototypeTask("walls.diagnostic.afterLoad", () => {
                            emitPrototypeWallSwapDiagnostic("afterLoad", wallState, sync, {
                                queuedTasks: "after wall load, before blocked edges/joinery"
                            });
                        }));
                    }
                    for (let i = 0; i < sync.applyBlockedSectionKeys.length; i++) {
                        const sectionKey = sync.applyBlockedSectionKeys[i];
                        phaseTasks.push(createPrototypeTask("walls.applyBlockedEdges", () => {
                            const start = prototypeNow();
                            const appliedLinks = applyPrototypeBlockedEdgesForSection(map, sectionKey, sync.changedClearanceNodes);
                            sync.blockedEdgeApplyMs += prototypeNow() - start;
                            sync.blockedEdgeAppliedLinks += appliedLinks;
                        }));
                    }
                    phaseTasks.push(createPrototypeTask("walls.refreshActive", () => {
                        wallState.activeRuntimeWalls = Array.from(wallState.activeRuntimeWallsByRecordId.values());
                    }));
                    phaseTasks.push(createPrototypeTask("walls.joinery", () => {
                        if (sync.removalEntries.length > 0 || sync.loadWallEntries.length > 0 || sync.orphanedMountedObjects.length > 0) {
                            emitPrototypeWallSwapDiagnostic("beforeJoinery", wallState, sync, {
                                queuedTasks: "before joinery and mounted-object resnap"
                            });
                        }
                        const joineryWalls = sync.scopedToSections ? sync.loadedRuntimeWalls : wallState.activeRuntimeWalls;
                        if (joineryWalls.length > 0 && globalScope.WallSectionUnit && typeof globalScope.WallSectionUnit.batchHandleJoinery === "function") {
                            const joineryStart = prototypeNow();
                            globalScope.WallSectionUnit.batchHandleJoinery(joineryWalls);
                            sync.joineryMs += prototypeNow() - joineryStart;
                        }
                        const remappedMountedObjects = applyPendingMountedWallIdRemaps(wallState);
                        sync.remappedMountedObjectCount = Array.isArray(remappedMountedObjects)
                            ? remappedMountedObjects.length
                            : 0;
                        // Re-snap doors/windows whose parent wall was removed
                        // due to re-splitting.
                        if (sync.orphanedMountedObjects.length > 0) {
                            for (let i = 0; i < sync.orphanedMountedObjects.length; i++) {
                                const obj = sync.orphanedMountedObjects[i];
                                if (!obj || obj.gone) continue;
                                let snapSucceeded = false;
                                if (typeof obj.snapToMountedWall === "function") {
                                    snapSucceeded = !!obj.snapToMountedWall();
                                }
                                // Suppress dirty tracking for the node refresh: if snap failed (wall
                                // is from a section that just left the bubble), clearing the indexed
                                // nodes would mark the door dirty and cause it to be re-saved to an
                                // inactive section's asset, causing disappearance on the next cycle.
                                const previousSuppress = map._prototypeSuppressObjectDirtyTracking;
                                map._prototypeSuppressObjectDirtyTracking = true;
                                try {
                                    if (typeof obj.refreshIndexedNodesFromHitbox === "function") {
                                        obj.refreshIndexedNodesFromHitbox({ minExtent: 1.5, sampleSpacing: 1.0 });
                                    }
                                } finally {
                                    map._prototypeSuppressObjectDirtyTracking = previousSuppress;
                                }
                                // If snap succeeded (door found an active wall), save the updated
                                // position immediately — matching what pendingCapturedMountedObjects does.
                                if (snapSucceeded && isPrototypeSavableObject(obj)) {
                                    upsertPrototypeObjectRecord(obj);
                                }
                            }
                        }
                        if (wallState.pendingCapturedMountedObjects.size > 0) {
                            const preservedMountedObjects = Array.from(wallState.pendingCapturedMountedObjects);
                            wallState.pendingCapturedMountedObjects.clear();
                            for (let i = 0; i < preservedMountedObjects.length; i++) {
                                const obj = preservedMountedObjects[i];
                                if (!obj || obj.gone) continue;
                                if (typeof obj.snapToMountedWall === "function") {
                                    obj.snapToMountedWall();
                                }
                                if (typeof obj.refreshIndexedNodesFromHitbox === "function") {
                                    obj.refreshIndexedNodesFromHitbox({ minExtent: 1.5, sampleSpacing: 1.0 });
                                }
                                if (isPrototypeSavableObject(obj)) {
                                    upsertPrototypeObjectRecord(obj);
                                }
                            }
                        }
                        if (sync.removalEntries.length > 0 || sync.loadWallEntries.length > 0 || sync.orphanedMountedObjects.length > 0) {
                            emitPrototypeWallSwapDiagnostic("afterJoinery", wallState, sync, {
                                queuedTasks: "after joinery and mounted-object resnap"
                            });
                        }
                    }));
                    const needsClearanceRefresh = sync.changedClearanceNodes.size > 0 || (
                        map._prototypeSectionState &&
                        Array.isArray(map._prototypeSectionState.orderedSectionAssets) &&
                        map._prototypeSectionState.orderedSectionAssets.some((asset) => asset && asset._prototypeClearanceDirty === true)
                    );
                    if (needsClearanceRefresh && !map._suppressClearanceUpdates && typeof map.applyPrototypeSectionClearance === "function") {
                        const activeKeysArray = sync.scopedToSections ? sync.applyBlockedSectionKeys.slice() : Array.from(activeSectionKeys);
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
                                phaseTasks.push(createPrototypeTask("walls.clearanceChunk", () => {
                                    const start = prototypeNow();
                                    applyPrototypeSectionClearanceChunk(map, sectionKey, chunkStartIndex, clearanceChunkSize);
                                    sync.clearanceMs += prototypeNow() - start;
                                }));
                            }
                        }
                    }
                    phaseTasks.push(createPrototypeTask("walls.finalize", () => {
                        sync.precomputedBlockMs = sync.blockedEdgeApplyMs;
                        sync.precomputedBlockedConnections = sync.blockedEdgeAppliedLinks;
                        wallState.activeRuntimeWalls = Array.from(wallState.activeRuntimeWallsByRecordId.values());
                        if (!sync.scopedToSections) {
                            wallState.activeRecordSignature = sync.desiredSignature;
                        }
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
                            joineryMs: Number(sync.joineryMs.toFixed(2)),
                            restoredRegistryCount: Number(sync.restoredRegistryCount) || 0,
                            scopedSectionKeys: sync.scopedSectionKeys ? sync.scopedSectionKeys.slice() : null,
                            requestedScopedSectionKeys: scopedSectionKeys ? scopedSectionKeys.slice() : null,
                            widenedAfterCapture: !!(sync.capturedAny && sync.requestedScopedToSections)
                        };
                        session.wallsChanged = !!(sync.capturedAny || sync.removedCount > 0 || sync.loadedCount > 0);
                    }));
                    prependPrototypeTasks(session, phaseTasks);
                }));
                prependPrototypeTasks(session, nextTasks);
            })]);
        };

        const enqueuePrototypeAsyncAnimalSync = (session) => {
            const animalState = map._prototypeAnimalState;
            if (!animalState) return;
            prependPrototypeTasks(session, [createPrototypeTask("animals.plan", () => {
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
                    removeTasks.push(createPrototypeTask("animals.remove", () => {
                        const taskStart = prototypeNow();
                        if (runtimeAnimal && typeof runtimeAnimal.removeFromGame === "function") runtimeAnimal.removeFromGame();
                        else if (runtimeAnimal && typeof runtimeAnimal.remove === "function") runtimeAnimal.remove();
                        else if (runtimeAnimal) runtimeAnimal.gone = true;
                        animalState.activeRuntimeAnimalsByRecordId.delete(recordId);
                        removedAny = true;
                        removedCount += 1;
                        activeTaskMs += prototypeNow() - taskStart;
                    }));
                }
                for (let i = 0; i < desiredRecords.length; i++) {
                    const entry = desiredRecords[i];
                    const recordId = Number(entry && entry.record && entry.record.id);
                    const animalType = (entry && entry.record && typeof entry.record.type === "string" && entry.record.type.length > 0)
                        ? entry.record.type
                        : "unknown";
                    removeTasks.push(createPrototypeTask(`animals.load.${animalType}#${Number.isInteger(recordId) ? recordId : "?"}`, () => {
                        const taskStart = prototypeNow();
                        if (!Number.isInteger(recordId) || animalState.activeRuntimeAnimalsByRecordId.has(recordId)) return;
                        if (!globalScope.Animal || typeof globalScope.Animal.loadJson !== "function") return;
                        const runtimeAnimal = globalScope.Animal.loadJson(entry.record, map, {
                            targetSectionKey: entry.sectionKey
                        });
                        if (!runtimeAnimal) return;
                        if (Array.isArray(globalScope.animals) && globalScope.animals.indexOf(runtimeAnimal) < 0) globalScope.animals.push(runtimeAnimal);
                        runtimeAnimal._prototypeRuntimeRecord = true;
                        runtimeAnimal._prototypeRecordId = recordId;
                        runtimeAnimal._prototypeOwnerSectionKey = entry.sectionKey;
                        animalState.activeRuntimeAnimalsByRecordId.set(recordId, runtimeAnimal);
                        loadedAny = true;
                        loadedCount += 1;
                        const taskMs = prototypeNow() - taskStart;
                        if (taskMs >= 8 && typeof console !== "undefined" && typeof console.log === "function") {
                            console.log("[prototype animal load]", {
                                type: animalType,
                                recordId,
                                ms: Number(taskMs.toFixed(2)),
                                recordScriptingName: (
                                    entry &&
                                    entry.record &&
                                    typeof entry.record.scriptingName === "string" &&
                                    entry.record.scriptingName.trim().length > 0
                                )
                                    ? entry.record.scriptingName.trim()
                                    : "",
                                debug: runtimeAnimal && runtimeAnimal._prototypeLoadDebug
                                    ? { ...runtimeAnimal._prototypeLoadDebug }
                                    : null
                            });
                        }
                        activeTaskMs += taskMs;
                    }));
                }
                removeTasks.push(createPrototypeTask("animals.finalize", () => {
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
                }));
                prependPrototypeTasks(session, removeTasks);
            })]);
        };

        const enqueuePrototypeAsyncPowerupSync = (session) => {
            const powerupState = map._prototypePowerupState;
            if (!powerupState) return;
            prependPrototypeTasks(session, [createPrototypeTask("powerups.plan", () => {
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
                    tasks.push(createPrototypeTask("powerups.remove", () => {
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
                    }));
                }
                for (let i = 0; i < desiredRecords.length; i++) {
                    const entry = desiredRecords[i];
                    tasks.push(createPrototypeTask("powerups.load", () => {
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
                    }));
                }
                tasks.push(createPrototypeTask("powerups.finalize", () => {
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
                }));
                prependPrototypeTasks(session, tasks);
            })]);
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
