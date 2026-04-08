(function (globalScope) {
    "use strict";

    function createSectionWorldPersistenceHelpers(map, deps) {
        const {
            getPrototypeParkedObjectCacheLimit,
            markPrototypeBlockedEdgesDirty,
            markPrototypeClearanceDirty,
            prototypeNow,
            rebuildPrototypeAssetObjectNameRegistry,
            shouldParkPrototypeRuntimeObject
        } = deps;

        const getPrototypeObjectProfileKey = (record) => {
            if (!record || typeof record !== "object") return "unknown";
            const type = (typeof record.type === "string" && record.type.trim().length > 0)
                ? record.type.trim().toLowerCase()
                : "";
            const category = (typeof record.category === "string" && record.category.trim().length > 0)
                ? record.category.trim().toLowerCase()
                : "";
            if (type === "tree" || category === "trees") return "tree";
            if (type === "roof") return "roof";
            if (type === "flower" || category === "flowers") return "flower";
            if (type === "door" || category === "doors") return "door";
            if (type === "window" || category === "windows") return "window";
            if (type === "road" || category === "roads") return "road";
            if (type === "triggerarea" || category === "triggerareas") return "trigger";
            return type || category || "unknown";
        };

        const formatPrototypeObjectProfileMap = (profileMap) => {
            const out = {};
            if (!(profileMap instanceof Map)) return out;
            for (const [key, stats] of profileMap.entries()) {
                if (!stats || typeof stats !== "object") continue;
                out[key] = {
                    loaded: Number(stats.loaded) || 0,
                    removed: Number(stats.removed) || 0,
                    ms: Number((Number(stats.ms) || 0).toFixed(2))
                };
            }
            return out;
        };

        const buildPrototypeWallPersistenceSignature = (wallOrRecord) => {
            if (!wallOrRecord || typeof wallOrRecord !== "object") return "";
            const data = (typeof wallOrRecord.saveJson === "function")
                ? wallOrRecord.saveJson()
                : wallOrRecord;
            if (!data || typeof data !== "object") return "";
            return JSON.stringify({
                startPoint: data.startPoint || null,
                endPoint: data.endPoint || null,
                height: Number.isFinite(data.height) ? Number(data.height) : null,
                thickness: Number.isFinite(data.thickness) ? Number(data.thickness) : null,
                bottomZ: Number.isFinite(data.bottomZ) ? Number(data.bottomZ) : null,
                wallTexturePath: (typeof data.wallTexturePath === "string") ? data.wallTexturePath : "",
                texturePhaseA: Number.isFinite(data.texturePhaseA) ? Number(data.texturePhaseA) : null,
                texturePhaseB: Number.isFinite(data.texturePhaseB) ? Number(data.texturePhaseB) : null,
                direction: Number.isFinite(data.direction) ? Number(data.direction) : null,
                lineAxis: Number.isFinite(data.lineAxis) ? Number(data.lineAxis) : null,
                visible: typeof data.visible === "boolean" ? data.visible : null,
                brightness: Number.isFinite(data.brightness) ? Number(data.brightness) : null,
                tint: Number.isFinite(data.tint) ? Number(data.tint) : null,
                script: Object.prototype.hasOwnProperty.call(data, "script") ? data.script : null,
                scriptingName: (typeof data.scriptingName === "string") ? data.scriptingName : ""
            });
        };

        const buildPrototypeObjectPersistenceSignature = (objOrRecord) => {
            if (!objOrRecord || typeof objOrRecord !== "object") return "";
            const data = (typeof objOrRecord.saveJson === "function")
                ? objOrRecord.saveJson()
                : objOrRecord;
            if (!data || typeof data !== "object") return "";
            return JSON.stringify(data);
        };

        const removePrototypeRuntimeObjectFully = (runtimeObj) => {
            if (!runtimeObj || runtimeObj.gone) return false;
            if (typeof runtimeObj.removeFromGame === "function") {
                runtimeObj.removeFromGame();
                return true;
            }
            if (typeof runtimeObj.remove === "function") {
                runtimeObj.remove();
                return true;
            }
            return false;
        };

        const parkPrototypeRuntimeObject = (runtimeObj) => {
            if (!shouldParkPrototypeRuntimeObject(runtimeObj)) return false;
            runtimeObj._prototypeParked = true;
            runtimeObj._prototypeParkedAtMs = prototypeNow();
            if (runtimeObj.type === "road") {
                runtimeObj._deferRoadNeighborRefresh = true;
            }
            if (typeof runtimeObj.removeFromNodes === "function") {
                runtimeObj.removeFromNodes();
            }
            if (runtimeObj.type === "road") {
                runtimeObj._deferRoadNeighborRefresh = false;
            }
            if (Array.isArray(runtimeObj.map && runtimeObj.map.objects)) {
                const idx = runtimeObj.map.objects.indexOf(runtimeObj);
                if (idx >= 0) runtimeObj.map.objects.splice(idx, 1);
            }
            if (runtimeObj.pixiSprite) {
                if (runtimeObj.pixiSprite.parent) {
                    runtimeObj.pixiSprite.parent.removeChild(runtimeObj.pixiSprite);
                }
                runtimeObj.pixiSprite.visible = false;
            }
            if (runtimeObj.fireSprite) {
                if (runtimeObj.fireSprite.parent) {
                    runtimeObj.fireSprite.parent.removeChild(runtimeObj.fireSprite);
                }
                runtimeObj.fireSprite.visible = false;
            }
            if (runtimeObj._healthBarGraphics) {
                runtimeObj._healthBarGraphics.visible = false;
            }
            return true;
        };

        const evictPrototypeParkedRuntimeObject = (runtimeObj) => {
            if (!runtimeObj) return false;
            runtimeObj._prototypeParked = false;
            return removePrototypeRuntimeObjectFully(runtimeObj);
        };

        const trimPrototypeParkedRuntimeObjectCache = (objectState) => {
            if (!objectState || !(objectState.parkedRuntimeObjectsByRecordId instanceof Map)) return 0;
            const countsByType = new Map();
            for (const runtimeObj of objectState.parkedRuntimeObjectsByRecordId.values()) {
                const type = (runtimeObj && typeof runtimeObj.type === "string") ? runtimeObj.type : "";
                countsByType.set(type, (countsByType.get(type) || 0) + 1);
            }
            let evicted = 0;
            for (const [recordId, runtimeObj] of objectState.parkedRuntimeObjectsByRecordId.entries()) {
                const type = (runtimeObj && typeof runtimeObj.type === "string") ? runtimeObj.type : "";
                const limit = getPrototypeParkedObjectCacheLimit(type);
                if (limit <= 0) {
                    objectState.parkedRuntimeObjectsByRecordId.delete(recordId);
                    if (evictPrototypeParkedRuntimeObject(runtimeObj)) {
                        evicted += 1;
                    }
                    continue;
                }
                const count = countsByType.get(type) || 0;
                if (count <= limit) continue;
                objectState.parkedRuntimeObjectsByRecordId.delete(recordId);
                countsByType.set(type, count - 1);
                if (evictPrototypeParkedRuntimeObject(runtimeObj)) {
                    evicted += 1;
                }
            }
            return evicted;
        };

        const restorePrototypeParkedRuntimeObject = (runtimeObj, mapRef) => {
            if (!runtimeObj || !mapRef) return null;
            runtimeObj._prototypeParked = false;
            runtimeObj._prototypeParkedAtMs = 0;
            runtimeObj.map = mapRef;
            runtimeObj.gone = false;
            runtimeObj.vanishing = false;
            if (runtimeObj.pixiSprite) {
                runtimeObj.pixiSprite.visible = true;
                if (globalScope.objectLayer && runtimeObj.pixiSprite.parent !== globalScope.objectLayer) {
                    globalScope.objectLayer.addChild(runtimeObj.pixiSprite);
                }
            }
            if (runtimeObj.fireSprite && runtimeObj.isOnFire) {
                runtimeObj.fireSprite.visible = true;
                if (globalScope.objectLayer && runtimeObj.fireSprite.parent !== globalScope.objectLayer) {
                    globalScope.objectLayer.addChild(runtimeObj.fireSprite);
                }
            }
            const node = (typeof mapRef.worldToNode === "function")
                ? mapRef.worldToNode(runtimeObj.x, runtimeObj.y)
                : null;
            if (typeof runtimeObj.refreshIndexedNodesFromHitbox === "function") {
                runtimeObj.refreshIndexedNodesFromHitbox();
            } else if (typeof runtimeObj.setIndexedNodes === "function") {
                runtimeObj.setIndexedNodes(node ? [node] : [], node || null);
            } else if (node && typeof node.addObject === "function") {
                node.addObject(runtimeObj);
                runtimeObj.node = node;
            }
            return runtimeObj;
        };

        const removePrototypeRoofRuntime = (runtimeRoof) => {
            if (!runtimeRoof) return;
            runtimeRoof.gone = true;
            if (runtimeRoof.pixiMesh) {
                try {
                    runtimeRoof.pixiMesh.destroy();
                } catch (_err) {
                    // ignore cleanup failures during prototype streaming
                }
            }
            if (runtimeRoof.map && Array.isArray(runtimeRoof.map.objects)) {
                const idx = runtimeRoof.map.objects.indexOf(runtimeRoof);
                if (idx >= 0) runtimeRoof.map.objects.splice(idx, 1);
            }
            if (Array.isArray(globalScope.roofs)) {
                const idx = globalScope.roofs.indexOf(runtimeRoof);
                if (idx >= 0) globalScope.roofs.splice(idx, 1);
                if (globalScope.roof === runtimeRoof) {
                    globalScope.roof = globalScope.roofs[globalScope.roofs.length - 1] || null;
                }
            }
        };

        const removePrototypeRecordById = (wallState, recordId) => {
            const state = map._prototypeSectionState;
            if (!wallState || !state || !(state.sectionAssetsByKey instanceof Map) || !Number.isInteger(recordId)) return false;
            let removed = false;
            for (const asset of state.sectionAssetsByKey.values()) {
                const records = Array.isArray(asset && asset.walls) ? asset.walls : [];
                if (records.length === 0) continue;
                const nextRecords = records.filter((record) => Number(record && record.id) !== recordId);
                if (nextRecords.length === records.length) continue;
                removed = true;
                asset.walls = nextRecords;
                markPrototypeBlockedEdgesDirty(asset);
                markPrototypeClearanceDirty(asset);
            }
            return removed;
        };

        const removePrototypeObjectRecordById = (objectState, recordId) => {
            const state = map._prototypeSectionState;
            if (!objectState || !state || !(state.sectionAssetsByKey instanceof Map) || !Number.isInteger(recordId)) return false;
            let removed = false;
            const triggerState = map._prototypeTriggerState;
            if (triggerState && triggerState.triggerDefsById instanceof Map && triggerState.triggerDefsById.has(recordId)) {
                triggerState.triggerDefsById.delete(recordId);
                if (typeof map.rebuildPrototypeTriggerRegistry === "function") {
                    map.rebuildPrototypeTriggerRegistry();
                }
                removed = true;
            }
            for (const asset of state.sectionAssetsByKey.values()) {
                const records = Array.isArray(asset && asset.objects) ? asset.objects : [];
                if (records.length === 0) continue;
                const nextRecords = records.filter((record) => Number(record && record.id) !== recordId);
                if (nextRecords.length === records.length) continue;
                removed = true;
                asset.objects = nextRecords;
                rebuildPrototypeAssetObjectNameRegistry(asset);
                markPrototypeClearanceDirty(asset);
            }
            return removed;
        };

        const isPrototypeWizardRuntimeObject = (obj) => {
            if (!obj || typeof obj !== "object") return false;
            if (obj === globalScope.wizard) return true;
            if (globalScope.Wizard && typeof globalScope.Wizard === "function" && obj instanceof globalScope.Wizard) {
                return true;
            }
            return false;
        };

        const isInvalidPrototypeObjectRecord = (record) => {
            if (!record || typeof record !== "object") return false;
            if (record.type === "human") return true;
            const hasViewport = !!(record.viewport && typeof record.viewport === "object");
            const hasWizardFields = (
                Array.isArray(record.spells) ||
                typeof record.currentSpell === "string" ||
                typeof record.gameMode === "string" ||
                typeof record.activeAura === "string" ||
                typeof record.name === "string"
            );
            return hasViewport && hasWizardFields;
        };

        const sanitizePrototypeObjectRecords = () => {
            const state = map._prototypeSectionState;
            if (!state || !(state.sectionAssetsByKey instanceof Map)) return false;
            let removedAny = false;
            for (const asset of state.sectionAssetsByKey.values()) {
                const records = Array.isArray(asset && asset.objects) ? asset.objects : null;
                if (!Array.isArray(records) || records.length === 0) continue;
                const nextRecords = records.filter((record) => !isInvalidPrototypeObjectRecord(record));
                if (nextRecords.length === records.length) continue;
                asset.objects = nextRecords;
                rebuildPrototypeAssetObjectNameRegistry(asset);
                markPrototypeClearanceDirty(asset);
                removedAny = true;
            }
            return removedAny;
        };

        const isPrototypeSavableObject = (obj) => {
            if (!obj || obj.gone || obj.vanishing) return false;
            if (typeof obj.saveJson !== "function") return false;
            if (obj.type === "wallSection") return false;
            if (isPrototypeWizardRuntimeObject(obj)) return false;
            return true;
        };

        const resolvePrototypeObjectOwnerSectionKey = (runtimeObj) => {
            if (!runtimeObj || typeof runtimeObj !== "object") return "";

            const primaryNode = (typeof runtimeObj.getNode === "function")
                ? runtimeObj.getNode()
                : runtimeObj.node;
            if (primaryNode && typeof primaryNode._prototypeSectionKey === "string" && primaryNode._prototypeSectionKey.length > 0) {
                return primaryNode._prototypeSectionKey;
            }

            const indexedNodes = Array.isArray(runtimeObj._indexedNodes) ? runtimeObj._indexedNodes : [];
            for (let i = 0; i < indexedNodes.length; i++) {
                const indexedNode = indexedNodes[i];
                if (indexedNode && typeof indexedNode._prototypeSectionKey === "string" && indexedNode._prototypeSectionKey.length > 0) {
                    return indexedNode._prototypeSectionKey;
                }
            }

            if (
                Number.isFinite(runtimeObj.x) &&
                Number.isFinite(runtimeObj.y) &&
                typeof map.getPrototypeSectionKeyForWorldPoint === "function"
            ) {
                const pointSectionKey = map.getPrototypeSectionKeyForWorldPoint(runtimeObj.x, runtimeObj.y);
                if (typeof pointSectionKey === "string" && pointSectionKey.length > 0) {
                    return pointSectionKey;
                }
            }

            if (typeof runtimeObj._prototypeOwnerSectionKey === "string" && runtimeObj._prototypeOwnerSectionKey.length > 0) {
                return runtimeObj._prototypeOwnerSectionKey;
            }

            return "";
        };

        const upsertPrototypeObjectRecord = (runtimeObj) => {
            if (!isPrototypeSavableObject(runtimeObj)) return false;
            const objectState = map._prototypeObjectState;
            if (!objectState) return false;
            const recordData = runtimeObj.saveJson();
            if (!recordData || typeof recordData !== "object") return false;
            if (isInvalidPrototypeObjectRecord(recordData)) return false;
            const nextSignature = buildPrototypeObjectPersistenceSignature(recordData);

            let recordId = Number(runtimeObj._prototypeRecordId);
            if (!Number.isInteger(recordId)) {
                recordId = objectState.nextRecordId++;
            }
            removePrototypeObjectRecordById(objectState, recordId);
            if (recordData.type === "triggerArea") {
                const triggerState = map._prototypeTriggerState;
                if (!triggerState || !(triggerState.triggerDefsById instanceof Map)) return false;
                const nextRecord = {
                    ...recordData,
                    id: recordId,
                    objectType: "triggerArea",
                    isTriggerArea: true
                };
                triggerState.triggerDefsById.set(recordId, nextRecord);
                if (typeof map.rebuildPrototypeTriggerRegistry === "function") {
                    map.rebuildPrototypeTriggerRegistry();
                }

                runtimeObj._prototypeObjectManaged = true;
                runtimeObj._prototypeRuntimeRecord = true;
                runtimeObj._prototypeRecordId = recordId;
                runtimeObj._prototypePersistenceSignature = nextSignature;
                runtimeObj._prototypeOwnerSectionKey = "";
                runtimeObj._prototypeDirty = false;
                if (objectState.dirtyRuntimeObjects instanceof Set) {
                    objectState.dirtyRuntimeObjects.delete(runtimeObj);
                }
                if (objectState.activeRuntimeObjectsByRecordId instanceof Map) {
                    objectState.activeRuntimeObjectsByRecordId.set(recordId, runtimeObj);
                }
                return true;
            }
            const ownerSectionKey = resolvePrototypeObjectOwnerSectionKey(runtimeObj);
            if (!ownerSectionKey) return false;
            const asset = map.getPrototypeSectionAsset(ownerSectionKey);
            if (!asset) return false;
            asset.objects.push({
                ...recordData,
                id: recordId
            });
            rebuildPrototypeAssetObjectNameRegistry(asset);
            markPrototypeClearanceDirty(asset);

            runtimeObj._prototypeObjectManaged = true;
            runtimeObj._prototypeRuntimeRecord = true;
            runtimeObj._prototypeRecordId = recordId;
            runtimeObj._prototypePersistenceSignature = nextSignature;
            runtimeObj._prototypeOwnerSectionKey = ownerSectionKey;
            runtimeObj._prototypeDirty = false;
            if (objectState.dirtyRuntimeObjects instanceof Set) {
                objectState.dirtyRuntimeObjects.delete(runtimeObj);
            }
            if (objectState.activeRuntimeObjectsByRecordId instanceof Map) {
                objectState.activeRuntimeObjectsByRecordId.set(recordId, runtimeObj);
            }
            return true;
        };

        const isPrototypeSavableAnimal = (animal) => {
            if (!animal || animal.gone || animal.vanishing || animal.dead) return false;
            if (typeof animal.saveJson !== "function") return false;
            return true;
        };

        const removePrototypeAnimalRecordById = (animalState, recordId) => {
            const state = map._prototypeSectionState;
            if (!animalState || !state || !(state.sectionAssetsByKey instanceof Map) || !Number.isInteger(recordId)) return false;
            let removed = false;
            for (const asset of state.sectionAssetsByKey.values()) {
                const records = Array.isArray(asset && asset.animals) ? asset.animals : [];
                if (records.length === 0) continue;
                const nextRecords = records.filter((record) => Number(record && record.id) !== recordId);
                if (nextRecords.length === records.length) continue;
                removed = true;
                asset.animals = nextRecords;
            }
            return removed;
        };

        const prunePrototypeAnimalRuntimeRecord = (animalState, runtimeAnimal, recordId) => {
            if (!animalState || !Number.isInteger(recordId)) return false;
            const changed = removePrototypeAnimalRecordById(animalState, recordId);
            if (animalState.activeRuntimeAnimalsByRecordId instanceof Map) {
                animalState.activeRuntimeAnimalsByRecordId.delete(recordId);
            }
            if (Array.isArray(animalState.activeRuntimeAnimals) && runtimeAnimal) {
                const activeIndex = animalState.activeRuntimeAnimals.indexOf(runtimeAnimal);
                if (activeIndex >= 0) {
                    animalState.activeRuntimeAnimals.splice(activeIndex, 1);
                }
            }
            if (runtimeAnimal && typeof runtimeAnimal === "object") {
                runtimeAnimal._prototypeRuntimeRecord = false;
                runtimeAnimal._prototypeRecordId = null;
                runtimeAnimal._prototypeOwnerSectionKey = "";
                runtimeAnimal._prototypeDirty = false;
            }
            return changed;
        };

        const upsertPrototypeAnimalRecord = (runtimeAnimal) => {
            if (!isPrototypeSavableAnimal(runtimeAnimal)) return false;
            const ownerSectionKey = map.getPrototypeSectionKeyForWorldPoint(runtimeAnimal.x, runtimeAnimal.y);
            if (!ownerSectionKey) return false;
            const asset = map.getPrototypeSectionAsset(ownerSectionKey);
            if (!asset) return false;
            const animalState = map._prototypeAnimalState;
            if (!animalState) return false;
            const recordData = runtimeAnimal.saveJson();
            if (!recordData || typeof recordData !== "object") return false;

            let recordId = Number(runtimeAnimal._prototypeRecordId);
            if (!Number.isInteger(recordId)) {
                recordId = animalState.nextRecordId++;
            }
            removePrototypeAnimalRecordById(animalState, recordId);
            asset.animals.push({
                ...recordData,
                id: recordId
            });

            runtimeAnimal._prototypeRuntimeRecord = true;
            runtimeAnimal._prototypeRecordId = recordId;
            runtimeAnimal._prototypeOwnerSectionKey = ownerSectionKey;
            runtimeAnimal._prototypeDirty = false;
            if (animalState.activeRuntimeAnimalsByRecordId instanceof Map) {
                animalState.activeRuntimeAnimalsByRecordId.set(recordId, runtimeAnimal);
            }
            if (Array.isArray(animalState.activeRuntimeAnimals) && !animalState.activeRuntimeAnimals.includes(runtimeAnimal)) {
                animalState.activeRuntimeAnimals.push(runtimeAnimal);
            }
            return true;
        };

        return {
            buildPrototypeWallPersistenceSignature,
            buildPrototypeObjectPersistenceSignature,
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
        };
    }

    globalScope.__sectionWorldPersistence = {
        createSectionWorldPersistenceHelpers,
        createPrototypePersistenceHelpers: createSectionWorldPersistenceHelpers
    };
    globalScope.__twoSectionPrototypePersistence = globalScope.__sectionWorldPersistence;
})(typeof globalThis !== "undefined" ? globalThis : window);

if (typeof module !== "undefined" && module.exports) {
    module.exports = globalThis.__sectionWorldPersistence;
}
