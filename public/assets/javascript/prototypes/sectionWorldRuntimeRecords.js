(function (globalScope) {
    "use strict";

    function installSectionWorldRuntimeRecordApis(map, deps) {
        const {
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
        } = deps;

        map.getPrototypeSectionKeyForWorldPoint = function getPrototypeSectionKeyForWorldPoint(worldX, worldY) {
            const node = (typeof this.worldToNode === "function") ? this.worldToNode(worldX, worldY) : null;
            return node && typeof node._prototypeSectionKey === "string" ? node._prototypeSectionKey : null;
        };

        map.capturePrototypeWall = function capturePrototypeWall(wall) {
            if (!wall || wall.gone || wall._prototypeWallManaged === true) return false;
            if (typeof wall._collectOrderedLineAnchors !== "function" || typeof wall.saveJson !== "function") return false;
            const collectedAnchors = wall._collectOrderedLineAnchors();
            const anchors = Array.isArray(collectedAnchors) ? collectedAnchors.slice() : [];
            if (!Array.isArray(anchors) || anchors.length < 2) return false;

            const rewriteEndpointAnchor = (anchorIndex, endpoint) => {
                if (!endpoint || endpoint._splitVertex !== true) return;
                if (!anchors[anchorIndex]) return;
                anchors[anchorIndex] = {
                    ...anchors[anchorIndex],
                    anchor: endpoint,
                    t: (anchorIndex === 0) ? 0 : 1,
                    key: globalScope.WallSectionUnit.endpointKey(endpoint),
                    isEndpoint: true
                };
            };
            rewriteEndpointAnchor(0, wall.startPoint);
            rewriteEndpointAnchor(anchors.length - 1, wall.endPoint);

            const baseRecord = wall.saveJson();
            const endpointsMatch = (left, right) => {
                if (!left || !right) return false;
                if (globalScope.WallSectionUnit && typeof globalScope.WallSectionUnit._pointsMatch === "function") {
                    return globalScope.WallSectionUnit._pointsMatch(left, right);
                }
                return globalScope.WallSectionUnit.endpointKey(left) === globalScope.WallSectionUnit.endpointKey(right);
            };
            const segments = [];
            for (let i = 0; i < anchors.length - 1; i++) {
                const startEntry = anchors[i];
                const endEntry = anchors[i + 1];
                if (!startEntry || !endEntry || !startEntry.anchor || !endEntry.anchor) continue;
                if (endpointsMatch(startEntry.anchor, endEntry.anchor)) continue;
                const midX = (Number(startEntry.anchor.x) + Number(endEntry.anchor.x)) * 0.5;
                const midY = (Number(startEntry.anchor.y) + Number(endEntry.anchor.y)) * 0.5;
                const ownerSectionKey = this.getPrototypeSectionKeyForWorldPoint(midX, midY);
                if (!ownerSectionKey) continue;
                segments.push({
                    ownerSectionKey,
                    startAnchor: startEntry.anchor,
                    endAnchor: endEntry.anchor
                });
            }
            if (segments.length === 0) return false;

            const grouped = [];
            for (let i = 0; i < segments.length; i++) {
                const segment = segments[i];
                const last = grouped[grouped.length - 1];
                if (last && last.ownerSectionKey === segment.ownerSectionKey) {
                    last.endAnchor = segment.endAnchor;
                } else {
                    grouped.push({
                        ownerSectionKey: segment.ownerSectionKey,
                        startAnchor: segment.startAnchor,
                        endAnchor: segment.endAnchor
                    });
                }
            }

            const wallState = this._prototypeWallState;
            if (Number.isInteger(wall._prototypeRecordId)) {
                removePrototypeRecordById(wallState, Number(wall._prototypeRecordId));
            }
            for (let i = 0; i < grouped.length; i++) {
                const fragment = grouped[i];
                if (!fragment || endpointsMatch(fragment.startAnchor, fragment.endAnchor)) continue;
                const asset = this.getPrototypeSectionAsset(fragment.ownerSectionKey);
                if (!asset) continue;
                const record = {
                    ...baseRecord,
                    id: wallState.nextRecordId++,
                    startPoint: globalScope.WallSectionUnit._serializeEndpoint(fragment.startAnchor),
                    endPoint: globalScope.WallSectionUnit._serializeEndpoint(fragment.endAnchor),
                    _prototypeManagedRecordId: wallState.nextRecordId
                };
                asset.walls.push(record);
                markPrototypeBlockedEdgesDirty(asset);
                markPrototypeClearanceDirty(asset);
            }

            const preservedMountedObjects = [];
            if (Array.isArray(wall.attachedObjects)) {
                for (let i = 0; i < wall.attachedObjects.length; i++) {
                    const entry = wall.attachedObjects[i];
                    if (entry && entry.object && !entry.object.gone) {
                        preservedMountedObjects.push(entry.object);
                    }
                }
            }
            wall._prototypeWallManaged = true;
            if (typeof wall._removeWallPreserving === "function") {
                wall._removeWallPreserving(preservedMountedObjects, { skipAutoMerge: true });
            } else if (typeof wall.removeFromGame === "function") {
                wall.removeFromGame();
            } else if (typeof wall.remove === "function") {
                wall.remove();
            }
            if (
                preservedMountedObjects.length > 0 &&
                wallState &&
                wallState.pendingCapturedMountedObjects instanceof Set
            ) {
                for (let i = 0; i < preservedMountedObjects.length; i++) {
                    const obj = preservedMountedObjects[i];
                    if (obj && !obj.gone) {
                        wallState.pendingCapturedMountedObjects.add(obj);
                    }
                }
            }
            return true;
        };

        map.capturePendingPrototypeWalls = function capturePendingPrototypeWalls() {
            const wallCtor = globalScope.WallSectionUnit;
            const wallState = this._prototypeWallState;
            if (!wallCtor || !(wallCtor._allSections instanceof Map) || !wallState) return false;
            let changed = false;
            if (wallState.activeRuntimeWallsByRecordId instanceof Map) {
                for (const [recordId, runtimeWall] of wallState.activeRuntimeWallsByRecordId.entries()) {
                    if (runtimeWall && !runtimeWall.gone && !runtimeWall.vanishing) continue;
                    if (removePrototypeRecordById(wallState, Number(recordId))) {
                        changed = true;
                    }
                }
            }
            for (const wall of wallCtor._allSections.values()) {
                if (!wall) continue;
                if (wall._prototypeRuntimeRecord === true) {
                    const currentSignature = buildPrototypeWallPersistenceSignature(wall);
                    const previousSignature = (typeof wall._prototypePersistenceSignature === "string")
                        ? wall._prototypePersistenceSignature
                        : "";
                    if (currentSignature && previousSignature && currentSignature !== previousSignature) {
                        if (this.capturePrototypeWall(wall)) {
                            changed = true;
                        }
                    }
                    continue;
                }
                if (this.capturePrototypeWall(wall)) {
                    changed = true;
                }
            }
            return changed;
        };

        map.capturePendingPrototypeObjects = function capturePendingPrototypeObjects() {
            const state = this._prototypeSectionState;
            if (!state || !(state.activeSectionKeys instanceof Set) || !(state.nodesBySectionKey instanceof Map)) return false;
            const objectState = this._prototypeObjectState;
            if (objectState && objectState.captureScanNeeded !== true) {
                return false;
            }
            let changed = false;
            let pruneGoneMs = 0;
            let dirtyListBuildMs = 0;
            let scanDirtyMs = 0;
            let saveJsonMs = 0;
            let signatureMs = 0;
            let upsertMs = 0;
            let dirtyCandidateCount = 0;
            let dirtyProcessedCount = 0;
            let dirtySkippedCount = 0;
            let goneRemovedCount = 0;
            if (objectState && objectState.activeRuntimeObjectsByRecordId instanceof Map) {
                const pruneGoneStart = prototypeNow();
                for (const [recordId, runtimeObj] of objectState.activeRuntimeObjectsByRecordId.entries()) {
                    if (runtimeObj && !runtimeObj.gone && !runtimeObj.vanishing) continue;
                    if (removePrototypeObjectRecordById(objectState, Number(recordId))) {
                        changed = true;
                        goneRemovedCount += 1;
                    }
                }
                pruneGoneMs = prototypeNow() - pruneGoneStart;
            }
            const seen = new Set();
            const scanRuntimeObject = (obj) => {
                if (!isPrototypeSavableObject(obj) || seen.has(obj)) return;
                seen.add(obj);
                dirtyProcessedCount += 1;
                if (objectState && objectState.dirtyRuntimeObjects instanceof Set) {
                    objectState.dirtyRuntimeObjects.delete(obj);
                }
                if (obj._prototypeRuntimeRecord === true && obj._prototypeDirty !== true) {
                    dirtySkippedCount += 1;
                    return;
                }
                const saveJsonStart = prototypeNow();
                const currentSignature = buildPrototypeObjectPersistenceSignature(obj);
                saveJsonMs += prototypeNow() - saveJsonStart;
                const previousSignature = (typeof obj._prototypePersistenceSignature === "string")
                    ? obj._prototypePersistenceSignature
                    : "";
                if (!obj._prototypeRuntimeRecord || currentSignature !== previousSignature) {
                    const upsertStart = prototypeNow();
                    if (upsertPrototypeObjectRecord(obj)) {
                        changed = true;
                    }
                    upsertMs += prototypeNow() - upsertStart;
                }
            };
            if (objectState && objectState.dirtyRuntimeObjects instanceof Set && objectState.dirtyRuntimeObjects.size > 0) {
                const dirtyListBuildStart = prototypeNow();
                const dirtyObjects = Array.from(objectState.dirtyRuntimeObjects);
                dirtyListBuildMs = prototypeNow() - dirtyListBuildStart;
                dirtyCandidateCount = dirtyObjects.length;
                const scanDirtyStart = prototypeNow();
                for (let i = 0; i < dirtyObjects.length; i++) {
                    scanRuntimeObject(dirtyObjects[i]);
                }
                scanDirtyMs = prototypeNow() - scanDirtyStart;
            }
            if (objectState) {
                objectState.captureScanNeeded = false;
                objectState.lastCaptureStats = {
                    pruneGoneMs: Number(pruneGoneMs.toFixed(2)),
                    dirtyListBuildMs: Number(dirtyListBuildMs.toFixed(2)),
                    scanDirtyMs: Number(scanDirtyMs.toFixed(2)),
                    saveJsonMs: Number(saveJsonMs.toFixed(2)),
                    signatureMs: Number(signatureMs.toFixed(2)),
                    upsertMs: Number(upsertMs.toFixed(2)),
                    dirtyCandidateCount,
                    dirtyProcessedCount,
                    dirtySkippedCount,
                    goneRemovedCount
                };
            }
            return changed;
        };

        map.capturePendingPrototypeAnimals = function capturePendingPrototypeAnimals() {
            const animalState = this._prototypeAnimalState;
            if (!animalState || !(animalState.activeRuntimeAnimalsByRecordId instanceof Map)) return false;
            let changed = false;
            const candidateAnimals = [];
            const seenAnimals = new Set();
            const addCandidateAnimal = (runtimeAnimal) => {
                if (!runtimeAnimal || seenAnimals.has(runtimeAnimal)) return;
                if (runtimeAnimal.map && runtimeAnimal.map !== this) return;
                seenAnimals.add(runtimeAnimal);
                candidateAnimals.push(runtimeAnimal);
            };

            for (const runtimeAnimal of animalState.activeRuntimeAnimalsByRecordId.values()) {
                addCandidateAnimal(runtimeAnimal);
            }

            if (Array.isArray(globalScope.animals)) {
                for (let i = 0; i < globalScope.animals.length; i++) {
                    addCandidateAnimal(globalScope.animals[i]);
                }
            }

            for (const [recordId, runtimeAnimal] of Array.from(animalState.activeRuntimeAnimalsByRecordId.entries())) {
                const shouldPrune = (
                    !runtimeAnimal ||
                    runtimeAnimal.gone === true ||
                    runtimeAnimal.vanishing === true ||
                    runtimeAnimal.dead === true ||
                    (runtimeAnimal.map && runtimeAnimal.map !== this) ||
                    (Array.isArray(globalScope.animals) && globalScope.animals.indexOf(runtimeAnimal) < 0)
                );
                if (!shouldPrune) continue;
                if (prunePrototypeAnimalRuntimeRecord(animalState, runtimeAnimal, Number(recordId))) {
                    changed = true;
                }
            }

            for (let i = 0; i < candidateAnimals.length; i++) {
                const runtimeAnimal = candidateAnimals[i];
                if (!isPrototypeSavableAnimal(runtimeAnimal)) continue;
                const currentSectionKey = this.getPrototypeSectionKeyForWorldPoint(runtimeAnimal.x, runtimeAnimal.y);
                const previousSectionKey = (typeof runtimeAnimal._prototypeOwnerSectionKey === "string")
                    ? runtimeAnimal._prototypeOwnerSectionKey
                    : "";
                if (!currentSectionKey) continue;
                if (
                    currentSectionKey !== previousSectionKey ||
                    runtimeAnimal._prototypeRuntimeRecord !== true ||
                    runtimeAnimal._prototypeDirty === true
                ) {
                    if (upsertPrototypeAnimalRecord(runtimeAnimal)) {
                        changed = true;
                    }
                }
            }
            return changed;
        };

        map.syncPrototypeAnimals = function syncPrototypeAnimals() {
            settlePendingPrototypeLayoutTransition(this);
            const syncStart = prototypeNow();
            const animalState = this._prototypeAnimalState;
            if (!animalState) return false;
            const captureStart = prototypeNow();
            const capturedAny = (typeof this.capturePendingPrototypeAnimals === "function")
                ? this.capturePendingPrototypeAnimals()
                : false;
            const captureMs = prototypeNow() - captureStart;
            const activeSectionKeys = this.getPrototypeActiveSectionKeys();
            const desiredRecords = [];
            const desiredRecordIdsSeen = new Set();
            const desiredRecordSignaturesSeen = new Set();
            activeSectionKeys.forEach((sectionKey) => {
                const asset = this.getPrototypeSectionAsset(sectionKey);
                const records = Array.isArray(asset && asset.animals) ? asset.animals : null;
                if (!Array.isArray(records)) return;
                for (let i = 0; i < records.length; i++) {
                    const record = records[i];
                    if (!record || typeof record !== "object") continue;
                    const recordId = Number(record.id);
                    const signature = (() => {
                        const normalized = { ...record };
                        delete normalized.id;
                        return JSON.stringify(normalized);
                    })();
                    if (Number.isInteger(recordId) && desiredRecordIdsSeen.has(recordId)) continue;
                    if (signature && desiredRecordSignaturesSeen.has(signature)) continue;
                    if (Number.isInteger(recordId)) desiredRecordIdsSeen.add(recordId);
                    if (signature) desiredRecordSignaturesSeen.add(signature);
                    desiredRecords.push({ sectionKey, record });
                }
            });
            const desiredSignature = desiredRecords
                .map((entry) => Number.isInteger(entry.record && entry.record.id) ? entry.record.id : "")
                .join("|");
            if (desiredSignature === animalState.activeRecordSignature) {
                animalState.lastSyncStats = {
                    ms: Number((prototypeNow() - syncStart).toFixed(2)),
                    desired: desiredRecords.length,
                    loaded: 0,
                    removed: 0,
                    active: animalState.activeRuntimeAnimalsByRecordId instanceof Map ? animalState.activeRuntimeAnimalsByRecordId.size : 0,
                    captureMs: Number(captureMs.toFixed(2))
                };
                return false;
            }
            if (!(animalState.activeRuntimeAnimalsByRecordId instanceof Map)) {
                animalState.activeRuntimeAnimalsByRecordId = new Map();
            }

            const desiredRecordIds = new Set();
            for (let i = 0; i < desiredRecords.length; i++) {
                if (desiredRecords[i] && desiredRecords[i].record && !Number.isInteger(Number(desiredRecords[i].record.id))) {
                    desiredRecords[i].record.id = animalState.nextRecordId++;
                }
                const recordId = Number(desiredRecords[i] && desiredRecords[i].record && desiredRecords[i].record.id);
                if (Number.isInteger(recordId)) desiredRecordIds.add(recordId);
            }

            let removedAny = false;
            let removedCount = 0;
            for (const [recordId, runtimeAnimal] of animalState.activeRuntimeAnimalsByRecordId.entries()) {
                if (desiredRecordIds.has(recordId)) continue;
                if (runtimeAnimal && typeof runtimeAnimal.removeFromGame === "function") {
                    runtimeAnimal.removeFromGame();
                } else if (runtimeAnimal && typeof runtimeAnimal.remove === "function") {
                    runtimeAnimal.remove();
                } else if (runtimeAnimal) {
                    runtimeAnimal.gone = true;
                }
                animalState.activeRuntimeAnimalsByRecordId.delete(recordId);
                removedAny = true;
                removedCount += 1;
            }

            let loadedAny = false;
            let loadedCount = 0;
            for (let i = 0; i < desiredRecords.length; i++) {
                const entry = desiredRecords[i];
                const recordId = Number(entry && entry.record && entry.record.id);
                if (!Number.isInteger(recordId) || animalState.activeRuntimeAnimalsByRecordId.has(recordId)) continue;
                if (!globalScope.Animal || typeof globalScope.Animal.loadJson !== "function") continue;
                const runtimeAnimal = globalScope.Animal.loadJson(entry.record, this, {
                    targetSectionKey: entry.sectionKey
                });
                if (!runtimeAnimal) continue;
                if (Array.isArray(globalScope.animals) && globalScope.animals.indexOf(runtimeAnimal) < 0) {
                    globalScope.animals.push(runtimeAnimal);
                }
                runtimeAnimal._prototypeRuntimeRecord = true;
                runtimeAnimal._prototypeRecordId = recordId;
                runtimeAnimal._prototypeOwnerSectionKey = entry.sectionKey;
                animalState.activeRuntimeAnimalsByRecordId.set(recordId, runtimeAnimal);
                loadedAny = true;
                loadedCount += 1;
            }

            animalState.activeRuntimeAnimals = Array.from(animalState.activeRuntimeAnimalsByRecordId.values());
            animalState.activeRecordSignature = desiredSignature;
            animalState.lastSyncStats = {
                ms: Number((prototypeNow() - syncStart).toFixed(2)),
                desired: desiredRecords.length,
                loaded: loadedCount,
                removed: removedCount,
                active: animalState.activeRuntimeAnimalsByRecordId.size,
                captureMs: Number(captureMs.toFixed(2))
            };
            return capturedAny || removedAny || loadedAny;
        };

        map.syncPrototypePowerups = function syncPrototypePowerups() {
            settlePendingPrototypeLayoutTransition(this);
            const syncStart = prototypeNow();
            const powerupState = this._prototypePowerupState;
            if (!powerupState) return false;
            const activeSectionKeys = this.getPrototypeActiveSectionKeys();
            const desiredRecords = [];
            activeSectionKeys.forEach((sectionKey) => {
                const asset = this.getPrototypeSectionAsset(sectionKey);
                const records = Array.isArray(asset && asset.powerups) ? asset.powerups : null;
                if (!Array.isArray(records)) return;
                for (let i = 0; i < records.length; i++) {
                    desiredRecords.push({ sectionKey, record: records[i] });
                }
            });
            const desiredSignature = desiredRecords
                .map((entry) => Number.isInteger(entry.record && entry.record.id) ? entry.record.id : "")
                .join("|");
            if (desiredSignature === powerupState.activeRecordSignature) {
                return false;
            }
            if (!(powerupState.activeRuntimePowerupsByRecordId instanceof Map)) {
                powerupState.activeRuntimePowerupsByRecordId = new Map();
            }

            const desiredRecordIds = new Set();
            for (let i = 0; i < desiredRecords.length; i++) {
                if (desiredRecords[i] && desiredRecords[i].record && !Number.isInteger(Number(desiredRecords[i].record.id))) {
                    desiredRecords[i].record.id = powerupState.nextRecordId++;
                }
                const recordId = Number(desiredRecords[i] && desiredRecords[i].record && desiredRecords[i].record.id);
                if (Number.isInteger(recordId)) desiredRecordIds.add(recordId);
            }

            let removedAny = false;
            let removedCount = 0;
            for (const [recordId, runtimePowerup] of powerupState.activeRuntimePowerupsByRecordId.entries()) {
                if (desiredRecordIds.has(recordId)) continue;
                if (runtimePowerup) {
                    runtimePowerup.collected = true;
                    runtimePowerup.gone = true;
                    if (runtimePowerup.pixiSprite && runtimePowerup.pixiSprite.parent) {
                        runtimePowerup.pixiSprite.parent.removeChild(runtimePowerup.pixiSprite);
                    }
                    if (Array.isArray(globalScope.powerups)) {
                        const idx = globalScope.powerups.indexOf(runtimePowerup);
                        if (idx >= 0) globalScope.powerups.splice(idx, 1);
                    }
                }
                powerupState.activeRuntimePowerupsByRecordId.delete(recordId);
                removedAny = true;
                removedCount += 1;
            }

            let loadedAny = false;
            let loadedCount = 0;
            for (let i = 0; i < desiredRecords.length; i++) {
                const entry = desiredRecords[i];
                const recordId = Number(entry && entry.record && entry.record.id);
                if (!Number.isInteger(recordId) || powerupState.activeRuntimePowerupsByRecordId.has(recordId)) continue;
                if (!globalScope.Powerup || typeof globalScope.Powerup.loadJson !== "function") continue;
                const runtimePowerup = globalScope.Powerup.loadJson(entry.record, this);
                if (!runtimePowerup) continue;
                if (Array.isArray(globalScope.powerups) && globalScope.powerups.indexOf(runtimePowerup) < 0) {
                    globalScope.powerups.push(runtimePowerup);
                }
                runtimePowerup._prototypeRuntimeRecord = true;
                runtimePowerup._prototypeRecordId = recordId;
                runtimePowerup._prototypeOwnerSectionKey = entry.sectionKey;
                powerupState.activeRuntimePowerupsByRecordId.set(recordId, runtimePowerup);
                loadedAny = true;
                loadedCount += 1;
            }

            powerupState.activeRuntimePowerups = Array.from(powerupState.activeRuntimePowerupsByRecordId.values());
            powerupState.activeRecordSignature = desiredSignature;
            powerupState.lastSyncStats = {
                ms: Number((prototypeNow() - syncStart).toFixed(2)),
                desired: desiredRecords.length,
                loaded: loadedCount,
                removed: removedCount,
                active: powerupState.activeRuntimePowerupsByRecordId.size
            };
            return removedAny || loadedAny;
        };
    }

    globalScope.__sectionWorldRuntimeRecords = {
        installSectionWorldRuntimeRecordApis,
        installPrototypeRuntimeRecordApis: installSectionWorldRuntimeRecordApis
    };
    globalScope.__twoSectionPrototypeRuntimeRecords = globalScope.__sectionWorldRuntimeRecords;
})(typeof globalThis !== "undefined" ? globalThis : window);

if (typeof module !== "undefined" && module.exports) {
    module.exports = globalThis.__sectionWorldRuntimeRecords;
}
