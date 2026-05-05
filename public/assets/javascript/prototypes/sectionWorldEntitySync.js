(function (globalScope) {
    "use strict";

    // Wall-splitting at section seams: loaded lazily
    let _wallSplitting = null;
    function getWallSplitting() {
        if (!_wallSplitting) {
            _wallSplitting = globalScope.__wallSectionSplitting || null;
        }
        return _wallSplitting;
    }

    /**
     * Check all wall records in a section asset for cross-section spanning
     * and split them at seam boundaries. Mutates `asset.walls` in-place,
     * distributes split pieces to their owning section assets, and assigns
     * new record IDs.
     *
     * Only runs once per asset (tracked by `_prototypeWallsSplitChecked`).
     * Returns the number of walls that were split.
     */
    function applyWallSplitsForSectionAsset(map, asset, wallState, activeSectionKeys) {
        if (!asset) return 0;
        // Build a signature of the active section set.  Re-run splitting
        // whenever new sections join the bubble, since walls that previously
        // couldn't detect a seam (target section not loaded) may now be splittable.
        // Already-split pieces are individually skipped (_splitGroupId != null).
        const sig = activeSectionKeys ? Array.from(activeSectionKeys).sort().join(",") : "";
        if (asset._prototypeWallsSplitCheckedSig === sig) return 0;
        asset._prototypeWallsSplitCheckedSig = sig;

        const splitting = getWallSplitting();
        if (!splitting) return 0;

        const WallSectionUnit = globalScope.WallSectionUnit;
        if (!WallSectionUnit || typeof WallSectionUnit.loadJson !== "function") return 0;

        const walls = asset.walls;
        if (!Array.isArray(walls) || walls.length === 0) return 0;

        let splitCount = 0;
        // Process in reverse so splicing doesn't shift upcoming indices
        for (let i = walls.length - 1; i >= 0; i--) {
            const record = walls[i];
            if (!record || record.type !== "wallSection") continue;
            // Already-split pieces should not be re-checked
            if (record._splitGroupId != null) continue;

            // Build a temporary wall instance to walk anchors.
            // Strip id and scriptingName to avoid polluting _allSections
            // and the scripting registry with throwaway objects.
            let tempWall;
            try {
                const tempRecord = Object.assign({}, record);
                delete tempRecord.id;
                delete tempRecord.scriptingName;
                tempWall = WallSectionUnit.loadJson(tempRecord, map, { deferSetup: true });
            } catch (_e) {
                continue;
            }
            if (!tempWall) {
                continue;
            }

            let orderedAnchors;
            try {
                orderedAnchors = tempWall._collectOrderedLineAnchors();
            } catch (_e) {
                // Clean up temp wall registration before continuing
                if (WallSectionUnit._allSections instanceof Map) {
                    WallSectionUnit._allSections.delete(tempWall.id);
                }
                continue;
            }

            // Clean up temp wall from global registry now that we have anchors
            if (WallSectionUnit._allSections instanceof Map) {
                WallSectionUnit._allSections.delete(tempWall.id);
            }
            if (!Array.isArray(orderedAnchors) || orderedAnchors.length < 2) {
                continue;
            }

            const result = splitting.computeWallRecordSplits(record, orderedAnchors);
            if (!result.needsSplit) {
                continue;
            }

            // --- Split detected: distribute pieces ---
            splitCount++;
            const pieces = result.pieces;

            // Remove the original record from this asset
            walls.splice(i, 1);

            // Assign new IDs and distribute to section assets
            const groupMemberIds = [];
            const groupMemberSectionKeys = [];
            for (let p = 0; p < pieces.length; p++) {
                const piece = pieces[p];
                piece.record.id = wallState.nextRecordId++;
                groupMemberIds.push(piece.record.id);
                groupMemberSectionKeys.push(piece.sectionKey || asset.key);
            }

            // Stamp group membership on each piece
            for (let p = 0; p < pieces.length; p++) {
                pieces[p].record._splitGroupMemberRecordIds = groupMemberIds.slice();
                pieces[p].record._splitGroupMemberSectionKeys = groupMemberSectionKeys.slice();
            }

            for (let p = 0; p < pieces.length; p++) {
                const piece = pieces[p];
                const targetSectionKey = piece.sectionKey || asset.key;
                if (targetSectionKey === asset.key) {
                    // This piece stays in the current asset
                    walls.push(piece.record);
                } else {
                    // This piece goes to a different section asset
                    const targetAsset = (typeof map.getPrototypeSectionAsset === "function")
                        ? map.getPrototypeSectionAsset(targetSectionKey)
                        : null;
                    if (targetAsset && Array.isArray(targetAsset.walls)) {
                        targetAsset.walls.push(piece.record);
                        targetAsset._prototypeBlockedEdgesDirty = true;
                        targetAsset._prototypeClearanceDirty = true;
                    } else {
                        // Target section not available — keep in current asset as fallback
                        walls.push(piece.record);
                    }
                }
            }

            asset._prototypeBlockedEdgesDirty = true;
            asset._prototypeClearanceDirty = true;
        }

        return splitCount;
    }

    function installSectionWorldEntitySyncApis(map, deps) {
        const {
            applyPrototypeBlockedEdgesForSection,
            buildPrototypeObjectPersistenceSignature,
            buildPrototypeWallPersistenceSignature,
            canReusePrototypeParkedRuntimeObject,
            ensurePrototypeBlockedEdgeState,
            evictPrototypeParkedRuntimeObject,
            formatPrototypeObjectProfileMap,
            getPrototypeObjectProfileKey,
            isPrototypeSavableObject,
            parkPrototypeRuntimeObject,
            prototypeNow,
            removePrototypeBlockedEdgesForSection,
            removePrototypeRuntimeWallVisual,
            restorePrototypeParkedRuntimeObject,
            sanitizePrototypeObjectRecords,
            settlePendingPrototypeLayoutTransition,
            trimPrototypeParkedRuntimeObjectCache,
            upsertPrototypeObjectRecord
        } = deps;

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

        map.syncPrototypeWalls = function syncPrototypeWalls() {
            settlePendingPrototypeLayoutTransition(this);
            const syncStart = prototypeNow();
            const wallState = this._prototypeWallState;
            if (!wallState) return false;
            if (!(wallState.pendingCapturedMountedObjects instanceof Set)) {
                wallState.pendingCapturedMountedObjects = new Set();
            }
            const blockedEdgeState = ensurePrototypeBlockedEdgeState(this);
            const captureStart = prototypeNow();
            const capturedAny = this.capturePendingPrototypeWalls();
            const captureMs = prototypeNow() - captureStart;
            const collectStart = prototypeNow();
            const activeSectionKeys = this.getPrototypeActiveSectionKeys();
            if (typeof this.ensurePrototypeBlockedEdges === "function") {
                this.ensurePrototypeBlockedEdges(activeSectionKeys);
            }
            const desiredRecords = [];
            const blockedEdgesByRecordId = new Map();
            // Load-time wall splitting disabled — walls are already split in
            // saved section assets.  New walls placed at runtime are split by
            // capturePrototypeWall when they are captured into section records.
            // Collect desired wall records from all active sections.
            activeSectionKeys.forEach((sectionKey) => {
                const asset = this.getPrototypeSectionAsset(sectionKey);
                if (!asset) return;
                const records = Array.isArray(asset.walls) ? asset.walls : null;
                if (!Array.isArray(records)) return;
                for (let i = 0; i < records.length; i++) {
                    desiredRecords.push({ sectionKey, record: records[i] });
                }
                const blockedEdges = Array.isArray(asset && asset.blockedEdges) ? asset.blockedEdges : null;
                if (Array.isArray(blockedEdges)) {
                    for (let i = 0; i < blockedEdges.length; i++) {
                        const edge = blockedEdges[i];
                        const recordId = Number(edge && edge.recordId);
                        if (!Number.isInteger(recordId)) continue;
                        if (!blockedEdgesByRecordId.has(recordId)) {
                            blockedEdgesByRecordId.set(recordId, []);
                        }
                        blockedEdgesByRecordId.get(recordId).push(edge);
                    }
                }
            });
            const desiredSignature = desiredRecords
                .map((entry) => Number.isInteger(entry.record && entry.record.id) ? entry.record.id : "")
                .join("|");
            const collectMs = prototypeNow() - collectStart;
            const restoredRegistryCount = restoreActivePrototypeWallRegistry(wallState);

            if (!capturedAny && desiredSignature === wallState.activeRecordSignature && restoredRegistryCount === 0) {
                wallState.lastSyncStats = {
                    ms: Number((prototypeNow() - syncStart).toFixed(2)),
                    desired: desiredRecords.length,
                    loaded: 0,
                    removed: 0,
                    active: wallState.activeRuntimeWallsByRecordId instanceof Map ? wallState.activeRuntimeWallsByRecordId.size : 0,
                    captureMs: Number(captureMs.toFixed(2)),
                    collectMs: Number(collectMs.toFixed(2)),
                    unloadMs: 0,
                    loadJsonMs: 0,
                    addNodesMs: 0,
                    blockedEdgeApplyMs: 0,
                    blockedEdgeRemoveMs: 0,
                    blockedEdgeAppliedLinks: 0,
                    blockedEdgeRemovedLinks: 0,
                    joineryMs: 0,
                    restoredRegistryCount: 0
                };
                return false;
            }

            if (!(wallState.activeRuntimeWallsByRecordId instanceof Map)) {
                wallState.activeRuntimeWallsByRecordId = new Map();
            }

            const staleRecordIds = [];
            for (const [recordId, runtimeWall] of wallState.activeRuntimeWallsByRecordId.entries()) {
                if (runtimeWall && !runtimeWall.gone) continue;
                staleRecordIds.push(recordId);
            }
            for (let i = 0; i < staleRecordIds.length; i++) {
                wallState.activeRuntimeWallsByRecordId.delete(staleRecordIds[i]);
            }

            const desiredRecordIds = new Set();
            for (let i = 0; i < desiredRecords.length; i++) {
                const recordId = Number(desiredRecords[i] && desiredRecords[i].record && desiredRecords[i].record.id);
                if (Number.isInteger(recordId)) {
                    desiredRecordIds.add(recordId);
                }
            }

            const removedRuntimeWalls = [];
            const changedClearanceNodes = new Set();
            const unloadStart = prototypeNow();
            let blockedEdgeRemoveMs = 0;
            let blockedEdgeRemovedLinks = 0;
            const activeBlockedEdgeSectionKeys = new Set(blockedEdgeState.activeEntriesBySectionKey.keys());
            activeBlockedEdgeSectionKeys.forEach((sectionKey) => {
                if (activeSectionKeys.has(sectionKey)) return;
                const sectionRemoveStart = prototypeNow();
                blockedEdgeRemovedLinks += removePrototypeBlockedEdgesForSection(this, sectionKey, changedClearanceNodes);
                blockedEdgeRemoveMs += (prototypeNow() - sectionRemoveStart);
            });
            const orphanedMountedObjects = [];
            for (const [recordId, runtimeWall] of wallState.activeRuntimeWallsByRecordId.entries()) {
                if (desiredRecordIds.has(recordId)) continue;
                if (!runtimeWall || runtimeWall.gone) {
                    wallState.activeRuntimeWallsByRecordId.delete(recordId);
                    continue;
                }
                removedRuntimeWalls.push(runtimeWall);
                // Rescue attached objects (doors/windows) before the wall is
                // removed — they will be re-snapped to replacement split pieces
                // after the load phase creates the new runtime walls.
                if (Array.isArray(runtimeWall.attachedObjects)) {
                    for (let a = 0; a < runtimeWall.attachedObjects.length; a++) {
                        const entry = runtimeWall.attachedObjects[a];
                        if (entry && entry.object && !entry.object.gone) {
                            orphanedMountedObjects.push(entry.object);
                        }
                    }
                    // Clear before _removeWallPreserving so it won't destroy them
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
            }
            const unloadMs = prototypeNow() - unloadStart;

            const loadedWalls = [];
            let loadJsonMs = 0;
            let addNodesMs = 0;
            let addNodesRemoveMs = 0;
            let addNodesCenterlineMs = 0;
            let addNodesDirectionalMs = 0;
            let precomputedBlockMs = 0;
            let precomputedBlockedConnections = 0;
            let directionalTotalMs = 0;
            let directionalClearMs = 0;
            let directionalCollectMs = 0;
            let directionalBlockMs = 0;
            let directionalBlockedConnections = 0;
            let blockedEdgeApplyMs = 0;
            let blockedEdgeAppliedLinks = 0;
            let clearanceMs = 0;
            let clearanceNodeCount = 0;
            for (let i = 0; i < desiredRecords.length; i++) {
                const entry = desiredRecords[i];
                const recordId = Number(entry && entry.record && entry.record.id);
                if (!Number.isInteger(recordId)) continue;
                if (wallState.activeRuntimeWallsByRecordId.has(recordId)) continue;

                const loadJsonStart = prototypeNow();
                const runtimeWall = globalScope.WallSectionUnit.loadJson(entry.record, this, { deferSetup: true });
                loadJsonMs += (prototypeNow() - loadJsonStart);
                if (!runtimeWall) {
                    continue;
                }
                const precomputedEdges = blockedEdgesByRecordId.get(recordId) || null;
                const usesSectionBlockedEdges = !!(precomputedEdges && precomputedEdges.length > 0);
                if (typeof runtimeWall.addToMapNodes === "function") {
                    const addNodesStart = prototypeNow();
                    runtimeWall.addToMapNodes({ applyDirectionalBlocking: !usesSectionBlockedEdges });
                    addNodesMs += (prototypeNow() - addNodesStart);
                    const addStats = runtimeWall._lastAddToMapNodesStats || null;
                    if (addStats) {
                        addNodesRemoveMs += Number(addStats.removeMs) || 0;
                        addNodesCenterlineMs += Number(addStats.centerlineMs) || 0;
                        addNodesDirectionalMs += Number(addStats.directionalMs) || 0;
                    }
                    const directionalStats = runtimeWall._lastDirectionalBlockingStats || null;
                    if (directionalStats) {
                        directionalTotalMs += Number(directionalStats.ms) || 0;
                        directionalClearMs += Number(directionalStats.clearMs) || 0;
                        directionalCollectMs += Number(directionalStats.collectMs) || 0;
                        directionalBlockMs += Number(directionalStats.blockMs) || 0;
                        directionalBlockedConnections += Number(directionalStats.blockedConnectionCount) || 0;
                    }
                }
                runtimeWall._prototypeUsesSectionBlockedEdges = usesSectionBlockedEdges;
                runtimeWall._prototypeRuntimeRecord = true;
                runtimeWall._prototypeRecordId = recordId;
                runtimeWall._prototypePersistenceSignature = buildPrototypeWallPersistenceSignature(entry.record);
                runtimeWall._prototypeOwnerSectionKey = entry.sectionKey;
                wallState.activeRuntimeWallsByRecordId.set(recordId, runtimeWall);
                loadedWalls.push(runtimeWall);
            }

            activeSectionKeys.forEach((sectionKey) => {
                if (blockedEdgeState.activeEntriesBySectionKey.has(sectionKey)) return;
                const sectionApplyStart = prototypeNow();
                const appliedLinks = applyPrototypeBlockedEdgesForSection(this, sectionKey, changedClearanceNodes);
                blockedEdgeApplyMs += (prototypeNow() - sectionApplyStart);
                blockedEdgeAppliedLinks += appliedLinks;
            });
            precomputedBlockMs = blockedEdgeApplyMs;
            precomputedBlockedConnections = blockedEdgeAppliedLinks;

            wallState.activeRuntimeWalls = Array.from(wallState.activeRuntimeWallsByRecordId.values());
            wallState.activeRecordSignature = desiredSignature;

            let joineryMs = 0;
            if (
                wallState.activeRuntimeWalls.length > 0 &&
                globalScope.WallSectionUnit &&
                typeof globalScope.WallSectionUnit.batchHandleJoinery === "function"
            ) {
                const joineryStart = prototypeNow();
                globalScope.WallSectionUnit.batchHandleJoinery(wallState.activeRuntimeWalls);
                joineryMs = prototypeNow() - joineryStart;
            }

            applyPendingMountedWallIdRemaps(wallState);

            // Re-snap doors/windows whose parent wall was removed due to re-splitting.
            // The replacement split pieces are now in _allSections, so
            // snapToMountedWall will geometrically find the correct new wall.
            if (orphanedMountedObjects.length > 0) {
                for (let i = 0; i < orphanedMountedObjects.length; i++) {
                    const obj = orphanedMountedObjects[i];
                    if (!obj || obj.gone) continue;
                    if (typeof obj.snapToMountedWall === "function") {
                        obj.snapToMountedWall();
                    }
                    if (typeof obj.refreshIndexedNodesFromHitbox === "function") {
                        obj.refreshIndexedNodesFromHitbox({ minExtent: 1.5, sampleSpacing: 1.0 });
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

            let needsClearanceRefresh = changedClearanceNodes.size > 0;
            if (!needsClearanceRefresh && this._prototypeSectionState && Array.isArray(this._prototypeSectionState.orderedSectionAssets)) {
                for (let i = 0; i < this._prototypeSectionState.orderedSectionAssets.length; i++) {
                    const asset = this._prototypeSectionState.orderedSectionAssets[i];
                    if (asset && asset._prototypeClearanceDirty === true) {
                        needsClearanceRefresh = true;
                        break;
                    }
                }
            }

            if (
                needsClearanceRefresh &&
                !this._suppressClearanceUpdates &&
                typeof this.applyPrototypeSectionClearance === "function"
            ) {
                const clearanceStart = prototypeNow();
                clearanceNodeCount = changedClearanceNodes.size;
                this.applyPrototypeSectionClearance(activeSectionKeys);
                clearanceMs = prototypeNow() - clearanceStart;
            }

            if ((capturedAny || removedRuntimeWalls.length > 0 || loadedWalls.length > 0) && typeof globalScope.invalidateMinimap === "function") {
                globalScope.invalidateMinimap();
            }
            wallState.lastSyncStats = {
                ms: Number((prototypeNow() - syncStart).toFixed(2)),
                desired: desiredRecords.length,
                loaded: loadedWalls.length,
                removed: removedRuntimeWalls.length,
                active: wallState.activeRuntimeWallsByRecordId.size,
                captureMs: Number(captureMs.toFixed(2)),
                collectMs: Number(collectMs.toFixed(2)),
                unloadMs: Number(unloadMs.toFixed(2)),
                loadJsonMs: Number(loadJsonMs.toFixed(2)),
                addNodesMs: Number(addNodesMs.toFixed(2)),
                blockedEdgeApplyMs: Number(blockedEdgeApplyMs.toFixed(2)),
                blockedEdgeRemoveMs: Number(blockedEdgeRemoveMs.toFixed(2)),
                blockedEdgeAppliedLinks,
                blockedEdgeRemovedLinks,
                clearanceMs: Number(clearanceMs.toFixed(2)),
                clearanceNodeCount,
                addNodesRemoveMs: Number(addNodesRemoveMs.toFixed(2)),
                addNodesCenterlineMs: Number(addNodesCenterlineMs.toFixed(2)),
                addNodesDirectionalMs: Number(addNodesDirectionalMs.toFixed(2)),
                precomputedBlockMs: Number(precomputedBlockMs.toFixed(2)),
                precomputedBlockedConnections,
                directionalTotalMs: Number(directionalTotalMs.toFixed(2)),
                directionalClearMs: Number(directionalClearMs.toFixed(2)),
                directionalCollectMs: Number(directionalCollectMs.toFixed(2)),
                directionalBlockMs: Number(directionalBlockMs.toFixed(2)),
                directionalBlockedConnections,
                joineryMs: Number(joineryMs.toFixed(2)),
                restoredRegistryCount
            };
            return capturedAny || removedRuntimeWalls.length > 0 || loadedWalls.length > 0;
        };

        map.syncPrototypeObjects = function syncPrototypeObjects() {
            settlePendingPrototypeLayoutTransition(this);
            const syncStart = prototypeNow();
            const objectState = this._prototypeObjectState;
            if (!objectState) return false;
            const sanitizedInvalidRecords = sanitizePrototypeObjectRecords();
            const previousSuppressClearanceUpdates = !!this._suppressClearanceUpdates;
            this._suppressClearanceUpdates = true;
            this._prototypeSuppressObjectDirtyTracking = true;
            try {
                const captureStart = prototypeNow();
                const capturedAny = this.capturePendingPrototypeObjects();
                const captureMs = prototypeNow() - captureStart;
                const collectStart = prototypeNow();
                const activeSectionKeys = this.getPrototypeActiveSectionKeys();
                const desiredRecords = [];
                activeSectionKeys.forEach((sectionKey) => {
                    const asset = this.getPrototypeSectionAsset(sectionKey);
                    const records = Array.isArray(asset && asset.objects) ? asset.objects : null;
                    if (!Array.isArray(records)) return;
                    for (let i = 0; i < records.length; i++) {
                        desiredRecords.push({ sectionKey, record: records[i] });
                    }
                });
                if (typeof this.getPrototypeTriggerDefsForSectionKeys === "function") {
                    const triggerDefs = this.getPrototypeTriggerDefsForSectionKeys(activeSectionKeys);
                    for (let i = 0; i < triggerDefs.length; i++) {
                        const triggerDef = triggerDefs[i];
                        if (!triggerDef || typeof triggerDef !== "object") continue;
                        desiredRecords.push({
                            sectionKey: "",
                            record: triggerDef
                        });
                    }
                }
                const desiredSignature = desiredRecords
                    .map((entry) => Number.isInteger(entry.record && entry.record.id) ? entry.record.id : "")
                    .join("|");
                const collectMs = prototypeNow() - collectStart;

                if (!capturedAny && !sanitizedInvalidRecords && desiredSignature === objectState.activeRecordSignature) {
                    objectState.lastSyncStats = {
                        ms: Number((prototypeNow() - syncStart).toFixed(2)),
                        desired: desiredRecords.length,
                        loaded: 0,
                        removed: 0,
                        active: objectState.activeRuntimeObjectsByRecordId instanceof Map ? objectState.activeRuntimeObjectsByRecordId.size : 0,
                        captureMs: Number(captureMs.toFixed(2)),
                        collectMs: Number(collectMs.toFixed(2)),
                        stalePruneMs: 0,
                        unloadMs: 0,
                        loadMs: 0,
                        roofLoadMs: 0,
                        staticLoadMs: 0,
                        roofLoaded: 0,
                        staticLoaded: 0,
                        roofRemoved: 0,
                        staticRemoved: 0,
                        roadRefreshMs: 0,
                        roadRefreshCount: 0,
                        invalidateMs: 0
                    };
                    return false;
                }

                if (!(objectState.activeRuntimeObjectsByRecordId instanceof Map)) {
                    objectState.activeRuntimeObjectsByRecordId = new Map();
                }

                const staleRecordIds = [];
                const stalePruneStart = prototypeNow();
                for (const [recordId, runtimeObj] of objectState.activeRuntimeObjectsByRecordId.entries()) {
                    if (runtimeObj && !runtimeObj.gone) continue;
                    staleRecordIds.push(recordId);
                }
                for (let i = 0; i < staleRecordIds.length; i++) {
                    objectState.activeRuntimeObjectsByRecordId.delete(staleRecordIds[i]);
                }
                const stalePruneMs = prototypeNow() - stalePruneStart;

                const desiredRecordIds = new Set();
                for (let i = 0; i < desiredRecords.length; i++) {
                    const recordId = Number(desiredRecords[i] && desiredRecords[i].record && desiredRecords[i].record.id);
                    if (Number.isInteger(recordId)) {
                        desiredRecordIds.add(recordId);
                    }
                }

                let removedAny = false;
                let removedCount = 0;
                let roofRemoved = 0;
                let staticRemoved = 0;
                let parkedStored = 0;
                let parkedReused = 0;
                let parkedEvicted = 0;
                let roadRefreshMs = 0;
                let roadRefreshCount = 0;
                const roadRefreshNodes = new Set();
                const profileByType = new Map();
                const bumpProfile = (profileKey, field, deltaValue = 1, msValue = 0) => {
                    const key = (typeof profileKey === "string" && profileKey.length > 0) ? profileKey : "unknown";
                    if (!profileByType.has(key)) {
                        profileByType.set(key, { loaded: 0, removed: 0, ms: 0 });
                    }
                    const stats = profileByType.get(key);
                    stats[field] = (Number(stats[field]) || 0) + deltaValue;
                    stats.ms = (Number(stats.ms) || 0) + (Number(msValue) || 0);
                };
                const unloadStart = prototypeNow();
                for (const [recordId, runtimeObj] of objectState.activeRuntimeObjectsByRecordId.entries()) {
                    if (desiredRecordIds.has(recordId)) continue;
                    if (!runtimeObj || runtimeObj.gone) {
                        objectState.activeRuntimeObjectsByRecordId.delete(recordId);
                        continue;
                    }
                    const runtimeProfileKey = getPrototypeObjectProfileKey(runtimeObj);
                    if (runtimeObj.type === "roof") {
                        if (typeof deps.removePrototypeRoofRuntime === "function") {
                            deps.removePrototypeRoofRuntime(runtimeObj);
                        }
                        roofRemoved += 1;
                        bumpProfile(runtimeProfileKey, "removed", 1, 0);
                    } else if (
                        runtimeObj.type === "road" &&
                        globalScope.Road &&
                        typeof globalScope.Road.collectRefreshNodesFromNode === "function"
                    ) {
                        globalScope.Road.collectRefreshNodesFromNode(typeof runtimeObj.getNode === "function" ? runtimeObj.getNode() : runtimeObj.node, roadRefreshNodes);
                        if (parkPrototypeRuntimeObject(runtimeObj)) {
                            objectState.parkedRuntimeObjectsByRecordId.delete(recordId);
                            objectState.parkedRuntimeObjectsByRecordId.set(recordId, runtimeObj);
                            parkedStored += 1;
                            bumpProfile(runtimeProfileKey, "removed", 1, 0);
                            staticRemoved += 1;
                        } else if (typeof runtimeObj.removeFromGame === "function") {
                            runtimeObj._deferRoadNeighborRefresh = true;
                            const removeStart = prototypeNow();
                            runtimeObj.removeFromGame();
                            runtimeObj._deferRoadNeighborRefresh = false;
                            bumpProfile(runtimeProfileKey, "removed", 1, prototypeNow() - removeStart);
                            staticRemoved += 1;
                        } else if (typeof runtimeObj.remove === "function") {
                            runtimeObj._deferRoadNeighborRefresh = true;
                            const removeStart = prototypeNow();
                            runtimeObj.remove();
                            runtimeObj._deferRoadNeighborRefresh = false;
                            bumpProfile(runtimeProfileKey, "removed", 1, prototypeNow() - removeStart);
                            staticRemoved += 1;
                        }
                    } else if (parkPrototypeRuntimeObject(runtimeObj)) {
                        objectState.parkedRuntimeObjectsByRecordId.delete(recordId);
                        objectState.parkedRuntimeObjectsByRecordId.set(recordId, runtimeObj);
                        parkedStored += 1;
                        bumpProfile(runtimeProfileKey, "removed", 1, 0);
                        staticRemoved += 1;
                    } else if (typeof runtimeObj.removeFromGame === "function") {
                        if (runtimeObj.type === "road" && globalScope.Road && typeof globalScope.Road.collectRefreshNodesFromNode === "function") {
                            globalScope.Road.collectRefreshNodesFromNode(typeof runtimeObj.getNode === "function" ? runtimeObj.getNode() : runtimeObj.node, roadRefreshNodes);
                            runtimeObj._deferRoadNeighborRefresh = true;
                        }
                        const removeStart = prototypeNow();
                        runtimeObj.removeFromGame();
                        if (runtimeObj.type === "road") {
                            runtimeObj._deferRoadNeighborRefresh = false;
                        }
                        bumpProfile(runtimeProfileKey, "removed", 1, prototypeNow() - removeStart);
                        staticRemoved += 1;
                    } else if (typeof runtimeObj.remove === "function") {
                        if (runtimeObj.type === "road" && globalScope.Road && typeof globalScope.Road.collectRefreshNodesFromNode === "function") {
                            globalScope.Road.collectRefreshNodesFromNode(typeof runtimeObj.getNode === "function" ? runtimeObj.getNode() : runtimeObj.node, roadRefreshNodes);
                            runtimeObj._deferRoadNeighborRefresh = true;
                        }
                        const removeStart = prototypeNow();
                        runtimeObj.remove();
                        if (runtimeObj.type === "road") {
                            runtimeObj._deferRoadNeighborRefresh = false;
                        }
                        bumpProfile(runtimeProfileKey, "removed", 1, prototypeNow() - removeStart);
                        staticRemoved += 1;
                    }
                    objectState.activeRuntimeObjectsByRecordId.delete(recordId);
                    removedAny = true;
                    removedCount += 1;
                }
                parkedEvicted += trimPrototypeParkedRuntimeObjectCache(objectState);
                const unloadMs = prototypeNow() - unloadStart;

                let loadedAny = false;
                let loadedCount = 0;
                let roofLoaded = 0;
                let staticLoaded = 0;
                let roofLoadMs = 0;
                let staticLoadMs = 0;
                let treeFinalizeMs = 0;
                let treeLoadDebug = null;
                let skippedAlreadyActive = 0;
                let skippedInvalidId = 0;
                let loadFailedCount = 0;
                const skippedAlreadyActiveByType = new Map();
                const loadFailedByType = new Map();
                const desiredDuplicateIdCounts = new Map();
                const desiredSectionKeysById = new Map();
                const duplicateDesiredIdSectionKeys = [];
                const bumpCountMap = (targetMap, key) => {
                    const safeKey = (typeof key === "string" && key.length > 0) ? key : "unknown";
                    targetMap.set(safeKey, (Number(targetMap.get(safeKey)) || 0) + 1);
                };
                const loadStart = prototypeNow();
                const treeDebugEnabled = !!(
                    globalScope.Tree &&
                    typeof globalScope.Tree.beginPrototypeLoadDebugSession === "function" &&
                    typeof globalScope.Tree.endPrototypeLoadDebugSession === "function"
                );
                if (treeDebugEnabled) {
                    globalScope.Tree.beginPrototypeLoadDebugSession();
                }
                for (let i = 0; i < desiredRecords.length; i++) {
                    const entry = desiredRecords[i];
                    const recordId = Number(entry && entry.record && entry.record.id);
                    if (!Number.isInteger(recordId)) continue;
                    desiredDuplicateIdCounts.set(recordId, (Number(desiredDuplicateIdCounts.get(recordId)) || 0) + 1);
                    if (!desiredSectionKeysById.has(recordId)) {
                        desiredSectionKeysById.set(recordId, new Set());
                    }
                    if (entry && typeof entry.sectionKey === "string" && entry.sectionKey.length > 0) {
                        desiredSectionKeysById.get(recordId).add(entry.sectionKey);
                    }
                }
                desiredDuplicateIdCounts.forEach((count, recordId) => {
                    if (count > 1) {
                        duplicateDesiredIdSectionKeys.push({
                            recordId,
                            count,
                            sectionKeys: Array.from(desiredSectionKeysById.get(recordId) || [])
                        });
                    }
                });
                const deferredTrees = [];
                for (let i = 0; i < desiredRecords.length; i++) {
                    const entry = desiredRecords[i];
                    if (entry && entry.record && !Number.isInteger(Number(entry.record.id))) {
                        entry.record.id = objectState.nextRecordId++;
                    }
                    const recordId = Number(entry && entry.record && entry.record.id);
                    const profileKey = getPrototypeObjectProfileKey(entry && entry.record);
                    if (!Number.isInteger(recordId)) {
                        skippedInvalidId += 1;
                        continue;
                    }
                    if (objectState.activeRuntimeObjectsByRecordId.has(recordId)) {
                        skippedAlreadyActive += 1;
                        bumpCountMap(skippedAlreadyActiveByType, profileKey);
                        continue;
                    }
                    let runtimeObj = null;
                    const expectedSignature = buildPrototypeObjectPersistenceSignature(entry && entry.record);
                    const parkedRuntimeObj = (objectState.parkedRuntimeObjectsByRecordId instanceof Map)
                        ? objectState.parkedRuntimeObjectsByRecordId.get(recordId)
                        : null;
                    if (canReusePrototypeParkedRuntimeObject(parkedRuntimeObj, entry && entry.record && entry.record.type, expectedSignature)) {
                        runtimeObj = restorePrototypeParkedRuntimeObject(parkedRuntimeObj, this);
                        objectState.parkedRuntimeObjectsByRecordId.delete(recordId);
                        if (runtimeObj) {
                            parkedReused += 1;
                            staticLoaded += 1;
                            bumpProfile(profileKey, "loaded", 1, 0);
                            if (runtimeObj.type === "road" && globalScope.Road && typeof globalScope.Road.collectRefreshNodesFromNode === "function") {
                                globalScope.Road.collectRefreshNodesFromNode(typeof runtimeObj.getNode === "function" ? runtimeObj.getNode() : runtimeObj.node, roadRefreshNodes);
                            }
                        }
                    } else if (parkedRuntimeObj) {
                        objectState.parkedRuntimeObjectsByRecordId.delete(recordId);
                        if (evictPrototypeParkedRuntimeObject(parkedRuntimeObj)) {
                            parkedEvicted += 1;
                        }
                    }
                    if (entry && entry.record && entry.record.type === "roof") {
                        if (globalScope.Roof && typeof globalScope.Roof.loadJson === "function") {
                            const roofStart = prototypeNow();
                            runtimeObj = globalScope.Roof.loadJson(entry.record, {
                                suppressAutoScriptingName: true,
                                trustLoadedScriptingName: true,
                                targetSectionKey: entry.sectionKey
                            });
                            const roofMs = prototypeNow() - roofStart;
                            roofLoadMs += roofMs;
                            if (runtimeObj) {
                                if (!Array.isArray(globalScope.roofs)) globalScope.roofs = [];
                                globalScope.roofs.push(runtimeObj);
                                globalScope.roof = runtimeObj;
                                if (Array.isArray(this.objects) && this.objects.indexOf(runtimeObj) < 0) {
                                    this.objects.push(runtimeObj);
                                }
                                roofLoaded += 1;
                                bumpProfile(profileKey, "loaded", 1, roofMs);
                            }
                        }
                    } else if (!runtimeObj && globalScope.StaticObject && typeof globalScope.StaticObject.loadJson === "function") {
                        const staticStart = prototypeNow();
                        runtimeObj = globalScope.StaticObject.loadJson(entry.record, this, {
                            deferRoadTextureRefresh: true,
                            deferTreePostLoad: true,
                            suppressAutoScriptingName: true,
                            trustLoadedScriptingName: true,
                            targetSectionKey: entry.sectionKey
                        });
                        const staticMs = prototypeNow() - staticStart;
                        staticLoadMs += staticMs;
                        if (runtimeObj) {
                            staticLoaded += 1;
                            bumpProfile(profileKey, "loaded", 1, staticMs);
                            if (runtimeObj.type === "road" && globalScope.Road && typeof globalScope.Road.collectRefreshNodesFromNode === "function") {
                                globalScope.Road.collectRefreshNodesFromNode(typeof runtimeObj.getNode === "function" ? runtimeObj.getNode() : runtimeObj.node, roadRefreshNodes);
                            }
                            if (runtimeObj.type === "tree" && typeof runtimeObj.finalizeDeferredLoad === "function") {
                                deferredTrees.push(runtimeObj);
                            }
                        }
                    }
                    if (!runtimeObj) {
                        loadFailedCount += 1;
                        bumpCountMap(loadFailedByType, profileKey);
                        continue;
                    }
                    runtimeObj._prototypeRuntimeRecord = true;
                    runtimeObj._prototypeObjectManaged = true;
                    runtimeObj._prototypeRecordId = recordId;
                    runtimeObj._prototypePersistenceSignature = buildPrototypeObjectPersistenceSignature(entry.record);
                    runtimeObj._prototypeOwnerSectionKey = entry.sectionKey;
                    runtimeObj._prototypeDirty = false;
                    objectState.activeRuntimeObjectsByRecordId.set(recordId, runtimeObj);
                    loadedAny = true;
                    loadedCount += 1;
                }
                if (roadRefreshNodes.size > 0 && globalScope.Road && typeof globalScope.Road.refreshTexturesAroundNodes === "function") {
                    const roadRefreshStart = prototypeNow();
                    roadRefreshCount = globalScope.Road.refreshTexturesAroundNodes(roadRefreshNodes);
                    roadRefreshMs = prototypeNow() - roadRefreshStart;
                }
                markLevel0RoadSurfacesDirtyForNodes(roadRefreshNodes);
                if (deferredTrees.length > 0) {
                    const treeFinalizeStart = prototypeNow();
                    for (let i = 0; i < deferredTrees.length; i++) {
                        const tree = deferredTrees[i];
                        if (tree && typeof tree.finalizeDeferredLoad === "function") {
                            tree.finalizeDeferredLoad();
                        }
                    }
                    treeFinalizeMs = prototypeNow() - treeFinalizeStart;
                }
                if (treeDebugEnabled) {
                    treeLoadDebug = globalScope.Tree.endPrototypeLoadDebugSession();
                }
                const loadMs = prototypeNow() - loadStart;

                objectState.activeRuntimeObjects = Array.from(objectState.activeRuntimeObjectsByRecordId.values());
                objectState.activeRecordSignature = desiredSignature;
                objectState.captureScanNeeded = false;

                let invalidateMs = 0;
                if ((capturedAny || removedAny || loadedAny) && typeof globalScope.invalidateMinimap === "function") {
                    const invalidateStart = prototypeNow();
                    globalScope.invalidateMinimap();
                    invalidateMs = prototypeNow() - invalidateStart;
                }
                objectState.lastSyncStats = {
                    ms: Number((prototypeNow() - syncStart).toFixed(2)),
                    desired: desiredRecords.length,
                    loaded: loadedCount,
                    removed: removedCount,
                    active: objectState.activeRuntimeObjectsByRecordId.size,
                    captureMs: Number(captureMs.toFixed(2)),
                    collectMs: Number(collectMs.toFixed(2)),
                    stalePruneMs: Number(stalePruneMs.toFixed(2)),
                    unloadMs: Number(unloadMs.toFixed(2)),
                    loadMs: Number(loadMs.toFixed(2)),
                    roofLoadMs: Number(roofLoadMs.toFixed(2)),
                    staticLoadMs: Number(staticLoadMs.toFixed(2)),
                    roofLoaded,
                    staticLoaded,
                    roofRemoved,
                    staticRemoved,
                    parkedStored,
                    parkedReused,
                    parkedEvicted,
                    parkedActive: objectState.parkedRuntimeObjectsByRecordId instanceof Map
                        ? objectState.parkedRuntimeObjectsByRecordId.size
                        : 0,
                    roadRefreshMs: Number(roadRefreshMs.toFixed(2)),
                    roadRefreshCount,
                    treeFinalizeMs: Number(treeFinalizeMs.toFixed(2)),
                    skippedAlreadyActive,
                    skippedInvalidId,
                    loadFailedCount,
                    duplicateDesiredIdCount: duplicateDesiredIdSectionKeys.length,
                    duplicateDesiredIdsSample: duplicateDesiredIdSectionKeys.slice(0, 10),
                    skippedAlreadyActiveByType: formatPrototypeObjectProfileMap(skippedAlreadyActiveByType),
                    loadFailedByType: formatPrototypeObjectProfileMap(loadFailedByType),
                    treeLoadDebug: treeLoadDebug ? {
                        treeCount: Number(treeLoadDebug.treeCount) || 0,
                        constructorMs: Number((Number(treeLoadDebug.constructorMs) || 0).toFixed(2)),
                        superMs: Number((Number(treeLoadDebug.superMs) || 0).toFixed(2)),
                        superUnaccountedMs: Number((Number(treeLoadDebug.superUnaccountedMs) || 0).toFixed(2)),
                        constructorApplySizeMs: Number((Number(treeLoadDebug.constructorApplySizeMs) || 0).toFixed(2)),
                        constructorMetadataKickoffMs: Number((Number(treeLoadDebug.constructorMetadataKickoffMs) || 0).toFixed(2)),
                        loadJsonTreeCreateMs: Number((Number(treeLoadDebug.loadJsonTreeCreateMs) || 0).toFixed(2)),
                        textureRestoreMs: Number((Number(treeLoadDebug.textureRestoreMs) || 0).toFixed(2)),
                        sizeRestoreMs: Number((Number(treeLoadDebug.sizeRestoreMs) || 0).toFixed(2)),
                        applySizeMs: Number((Number(treeLoadDebug.applySizeMs) || 0).toFixed(2)),
                        refreshHitboxesMs: Number((Number(treeLoadDebug.refreshHitboxesMs) || 0).toFixed(2)),
                        refreshVisibilityMs: Number((Number(treeLoadDebug.refreshVisibilityMs) || 0).toFixed(2)),
                        finalizeTotalMs: Number((Number(treeLoadDebug.finalizeTotalMs) || 0).toFixed(2)),
                        finalizeVisibilityMs: Number((Number(treeLoadDebug.finalizeVisibilityMs) || 0).toFixed(2)),
                        finalizeMetadataKickoffMs: Number((Number(treeLoadDebug.finalizeMetadataKickoffMs) || 0).toFixed(2)),
                        metadataKickoffMs: Number((Number(treeLoadDebug.metadataKickoffMs) || 0).toFixed(2)),
                        metadataApplyMs: Number((Number(treeLoadDebug.metadataApplyMs) || 0).toFixed(2)),
                        staticCtorNodeResolveMs: Number((Number(treeLoadDebug.staticCtorNodeResolveMs) || 0).toFixed(2)),
                        staticCtorNodeAttachMs: Number((Number(treeLoadDebug.staticCtorNodeAttachMs) || 0).toFixed(2)),
                        staticCtorTexturePickMs: Number((Number(treeLoadDebug.staticCtorTexturePickMs) || 0).toFixed(2)),
                        staticCtorSpriteCreateMs: Number((Number(treeLoadDebug.staticCtorSpriteCreateMs) || 0).toFixed(2)),
                        staticCtorSpriteAttachMs: Number((Number(treeLoadDebug.staticCtorSpriteAttachMs) || 0).toFixed(2)),
                        staticCtorHitboxCreateMs: Number((Number(treeLoadDebug.staticCtorHitboxCreateMs) || 0).toFixed(2)),
                        staticCtorAutoScriptNameMs: Number((Number(treeLoadDebug.staticCtorAutoScriptNameMs) || 0).toFixed(2)),
                        visibilitySamplePointCount: Number(treeLoadDebug.visibilitySamplePointCount) || 0,
                        visibilityRegisteredNodeCount: Number(treeLoadDebug.visibilityRegisteredNodeCount) || 0
                    } : null,
                    byType: formatPrototypeObjectProfileMap(profileByType),
                    captureDetail: objectState.lastCaptureStats ? { ...objectState.lastCaptureStats } : null,
                    invalidateMs: Number(invalidateMs.toFixed(2))
                };
                return sanitizedInvalidRecords || capturedAny || removedAny || loadedAny;
            } finally {
                this._prototypeSuppressObjectDirtyTracking = false;
                this._suppressClearanceUpdates = previousSuppressClearanceUpdates;
            }
        };
    }

    globalScope.__sectionWorldEntitySync = {
        installSectionWorldEntitySyncApis,
        installPrototypeEntitySyncApis: installSectionWorldEntitySyncApis,
        applyWallSplitsForSectionAsset
    };
    globalScope.__twoSectionPrototypeEntitySync = globalScope.__sectionWorldEntitySync;
})(typeof globalThis !== "undefined" ? globalThis : window);

if (typeof module !== "undefined" && module.exports) {
    module.exports = globalThis.__sectionWorldEntitySync;
}
