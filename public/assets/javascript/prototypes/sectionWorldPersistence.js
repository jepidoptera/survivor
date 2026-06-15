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
                traversalLayer: Number.isFinite(data.traversalLayer) ? Number(data.traversalLayer) : null,
                level: Number.isFinite(data.level) ? Number(data.level) : null,
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

        const buildPrototypePowerupPersistenceSignature = buildPrototypeObjectPersistenceSignature;

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
            const markSectionDirty = (sectionKey) => {
                if (typeof sectionKey !== "string" || sectionKey.length === 0) return;
                const buildingState = map && map._prototypeBuildingState;
                if (!buildingState || typeof buildingState !== "object") return;
                if (!buildingState.dirtyWorldUnits || typeof buildingState.dirtyWorldUnits !== "object") {
                    buildingState.dirtyWorldUnits = { sections: new Set(), buildings: new Set() };
                }
                if (!(buildingState.dirtyWorldUnits.sections instanceof Set)) {
                    buildingState.dirtyWorldUnits.sections = new Set(buildingState.dirtyWorldUnits.sections || []);
                }
                buildingState.dirtyWorldUnits.sections.add(sectionKey);
            };
            const markBuildingDirty = (buildingId) => {
                if (typeof buildingId !== "string" || buildingId.length === 0) return;
                if (map && typeof map.markPrototypeBuildingUnitDirty === "function") {
                    map.markPrototypeBuildingUnitDirty(buildingId);
                    return;
                }
                const buildingState = map && map._prototypeBuildingState;
                if (!buildingState || typeof buildingState !== "object") return;
                if (!buildingState.dirtyWorldUnits || typeof buildingState.dirtyWorldUnits !== "object") {
                    buildingState.dirtyWorldUnits = { sections: new Set(), buildings: new Set() };
                }
                if (!(buildingState.dirtyWorldUnits.buildings instanceof Set)) {
                    buildingState.dirtyWorldUnits.buildings = new Set(buildingState.dirtyWorldUnits.buildings || []);
                }
                buildingState.dirtyWorldUnits.buildings.add(buildingId);
            };
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
                markSectionDirty(typeof asset.key === "string" ? asset.key : "");
            }
            const buildingState = map && map._prototypeBuildingState;
            const buildingInstances = buildingState && buildingState.buildingInstancesById instanceof Map
                ? buildingState.buildingInstancesById
                : null;
            if (buildingInstances) {
                for (const [buildingId, instance] of buildingInstances.entries()) {
                    const records = Array.isArray(instance && instance.objects) ? instance.objects : [];
                    if (records.length === 0) continue;
                    const nextRecords = records.filter((record) => Number(record && record.id) !== recordId);
                    if (nextRecords.length === records.length) continue;
                    removed = true;
                    instance.objects = nextRecords;
                    instance.contentVersion = (Number(instance.contentVersion) || 1) + 1;
                    markBuildingDirty(buildingId);
                }
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

        const isOrphanedUpperFloorPlacedObjectRecord = (record) => {
            if (!record || typeof record !== "object" || record.type !== "placedObject") return false;
            const layer = Number.isFinite(Number(record.traversalLayer))
                ? Math.round(Number(record.traversalLayer))
                : (Number.isFinite(Number(record.level)) ? Math.round(Number(record.level)) : 0);
            if (layer <= 0) return false;
            const fragmentId = typeof record.fragmentId === "string" && record.fragmentId.length > 0
                ? record.fragmentId
                : "";
            if (!fragmentId) return true;
            if (typeof map.ensureFloorBuildings === "function") {
                map.ensureFloorBuildings();
            }
            if (!(map.floorBuildingByFragmentId instanceof Map)) return false;
            return !map.floorBuildingByFragmentId.has(fragmentId);
        };

        const sanitizePrototypeObjectRecords = () => {
            const state = map._prototypeSectionState;
            if (!state || !(state.sectionAssetsByKey instanceof Map)) return false;
            let removedAny = false;
            let orphanedUpperFloorObjects = 0;
            const orphanedSamples = [];
            for (const asset of state.sectionAssetsByKey.values()) {
                const records = Array.isArray(asset && asset.objects) ? asset.objects : null;
                if (!Array.isArray(records) || records.length === 0) continue;
                const nextRecords = records.filter((record) => {
                    if (isInvalidPrototypeObjectRecord(record)) return false;
                    if (isOrphanedUpperFloorPlacedObjectRecord(record)) {
                        orphanedUpperFloorObjects += 1;
                        if (orphanedSamples.length < 5) {
                            orphanedSamples.push({
                                sectionKey: typeof asset.key === "string" ? asset.key : "",
                                recordId: Number.isInteger(Number(record && record.id)) ? Number(record.id) : null,
                                fragmentId: typeof record?.fragmentId === "string" ? record.fragmentId : ""
                            });
                        }
                        return false;
                    }
                    return true;
                });
                if (nextRecords.length === records.length) continue;
                asset.objects = nextRecords;
                rebuildPrototypeAssetObjectNameRegistry(asset);
                markPrototypeClearanceDirty(asset);
                removedAny = true;
            }
            if (orphanedUpperFloorObjects > 0 && typeof console !== "undefined" && typeof console.warn === "function") {
                console.warn("[prototype object sanitize] removed orphaned upper-floor placed objects", {
                    count: orphanedUpperFloorObjects,
                    samples: orphanedSamples
                });
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

        const resolvePrototypeEntityPersistenceOwner = (runtimeObj) => {
            if (!runtimeObj || typeof runtimeObj !== "object") return null;
            const floorSupportApi = globalScope && globalScope.FloorSupport;
            if (floorSupportApi && typeof floorSupportApi.getEntityOwner === "function") {
                const owner = floorSupportApi.getEntityOwner(runtimeObj, {
                    map,
                    sectionKeyResolver: resolvePrototypeObjectOwnerSectionKey
                });
                if (owner) return owner;
            }
            const ownerType = typeof runtimeObj._prototypeOwnerType === "string" ? runtimeObj._prototypeOwnerType : "";
            const ownerId = typeof runtimeObj._prototypeOwnerId === "string" ? runtimeObj._prototypeOwnerId : "";
            if (ownerType === "building" && ownerId) return { type: "building", id: ownerId };
            const ownerSectionKey = resolvePrototypeObjectOwnerSectionKey(runtimeObj);
            if (ownerSectionKey) return { type: "section", id: ownerSectionKey };
            return null;
        };

        const resolvePrototypeObjectPersistenceOwner = resolvePrototypeEntityPersistenceOwner;

        const getPrototypeObjectOwnerSignature = (runtimeObj) => {
            const owner = resolvePrototypeEntityPersistenceOwner(runtimeObj);
            const floorSupportApi = globalScope && globalScope.FloorSupport;
            if (floorSupportApi && typeof floorSupportApi.ownerSignature === "function") {
                return floorSupportApi.ownerSignature(owner);
            }
            return owner ? `${owner.type}:${owner.id}` : "";
        };

        const getPrototypeEntityOwnerSignature = (runtimeObj) => {
            const owner = resolvePrototypeEntityPersistenceOwner(runtimeObj);
            const floorSupportApi = globalScope && globalScope.FloorSupport;
            if (floorSupportApi && typeof floorSupportApi.ownerSignature === "function") {
                return floorSupportApi.ownerSignature(owner);
            }
            return owner ? `${owner.type}:${owner.id}` : "";
        };

        const getMutablePrototypeBuildingInstance = (buildingId) => {
            if (typeof buildingId !== "string" || buildingId.length === 0) return null;
            const buildingState = map && map._prototypeBuildingState;
            if (!buildingState || !(buildingState.buildingInstancesById instanceof Map)) return null;
            return buildingState.buildingInstancesById.get(buildingId) || null;
        };

        const markPrototypeSectionUnitDirtyForPersistence = (sectionKey) => {
            if (typeof sectionKey !== "string" || sectionKey.length === 0) return;
            const buildingState = map && map._prototypeBuildingState;
            if (!buildingState || typeof buildingState !== "object") return;
            if (!buildingState.dirtyWorldUnits || typeof buildingState.dirtyWorldUnits !== "object") {
                buildingState.dirtyWorldUnits = { sections: new Set(), buildings: new Set() };
            }
            if (!(buildingState.dirtyWorldUnits.sections instanceof Set)) {
                buildingState.dirtyWorldUnits.sections = new Set(buildingState.dirtyWorldUnits.sections || []);
            }
            buildingState.dirtyWorldUnits.sections.add(sectionKey);
        };

        const markPrototypeBuildingUnitDirtyForPersistence = (buildingId) => {
            if (typeof buildingId !== "string" || buildingId.length === 0) return;
            if (map && typeof map.markPrototypeBuildingUnitDirty === "function") {
                map.markPrototypeBuildingUnitDirty(buildingId);
                return;
            }
            const buildingState = map && map._prototypeBuildingState;
            if (!buildingState || typeof buildingState !== "object") return;
            if (!buildingState.dirtyWorldUnits || typeof buildingState.dirtyWorldUnits !== "object") {
                buildingState.dirtyWorldUnits = { sections: new Set(), buildings: new Set() };
            }
            if (!(buildingState.dirtyWorldUnits.buildings instanceof Set)) {
                buildingState.dirtyWorldUnits.buildings = new Set(buildingState.dirtyWorldUnits.buildings || []);
            }
            buildingState.dirtyWorldUnits.buildings.add(buildingId);
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
            const owner = resolvePrototypeObjectPersistenceOwner(runtimeObj);
            if (!owner) return false;
            let ownerSectionKey = "";
            let ownerBuildingId = "";
            if (owner.type === "building") {
                ownerBuildingId = owner.id;
                const instance = getMutablePrototypeBuildingInstance(ownerBuildingId);
                if (!instance) return false;
                if (!Array.isArray(instance.objects)) instance.objects = [];
                instance.objects.push({
                    ...recordData,
                    id: recordId
                });
                instance.contentVersion = (Number(instance.contentVersion) || 1) + 1;
                if (typeof map.markPrototypeBuildingUnitDirty === "function") {
                    map.markPrototypeBuildingUnitDirty(ownerBuildingId);
                }
            } else {
                ownerSectionKey = owner.id;
                const asset = map.getPrototypeSectionAsset(ownerSectionKey);
                if (!asset) return false;
                asset.objects.push({
                    ...recordData,
                    id: recordId
                });
                rebuildPrototypeAssetObjectNameRegistry(asset);
                markPrototypeClearanceDirty(asset);
                markPrototypeSectionUnitDirtyForPersistence(ownerSectionKey);
            }

            runtimeObj._prototypeObjectManaged = true;
            runtimeObj._prototypeRuntimeRecord = true;
            runtimeObj._prototypeRecordId = recordId;
            runtimeObj._prototypePersistenceSignature = nextSignature;
            runtimeObj._prototypeOwnerSectionKey = ownerSectionKey;
            runtimeObj._prototypeOwnerType = owner.type;
            runtimeObj._prototypeOwnerId = owner.id;
            runtimeObj._prototypeOwnerSignature = `${owner.type}:${owner.id}`;
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
                markPrototypeSectionUnitDirtyForPersistence(typeof asset.key === "string" ? asset.key : "");
            }
            const buildingState = map && map._prototypeBuildingState;
            const buildingInstances = buildingState && buildingState.buildingInstancesById instanceof Map
                ? buildingState.buildingInstancesById
                : null;
            if (buildingInstances) {
                for (const [buildingId, instance] of buildingInstances.entries()) {
                    const records = Array.isArray(instance && instance.animals) ? instance.animals : [];
                    if (records.length === 0) continue;
                    const nextRecords = records.filter((record) => Number(record && record.id) !== recordId);
                    if (nextRecords.length === records.length) continue;
                    removed = true;
                    instance.animals = nextRecords;
                    instance.contentVersion = (Number(instance.contentVersion) || 1) + 1;
                    markPrototypeBuildingUnitDirtyForPersistence(buildingId);
                }
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
                runtimeAnimal._prototypeOwnerType = "";
                runtimeAnimal._prototypeOwnerId = "";
                runtimeAnimal._prototypeOwnerSignature = "";
                runtimeAnimal._prototypePersistenceSignature = "";
                runtimeAnimal._prototypeDirty = false;
            }
            return changed;
        };

        const upsertPrototypeAnimalRecord = (runtimeAnimal) => {
            if (!isPrototypeSavableAnimal(runtimeAnimal)) return false;
            const animalState = map._prototypeAnimalState;
            if (!animalState) return false;
            const recordData = runtimeAnimal.saveJson();
            if (!recordData || typeof recordData !== "object") return false;
            const nextSignature = buildPrototypeObjectPersistenceSignature(recordData);

            let recordId = Number(runtimeAnimal._prototypeRecordId);
            if (!Number.isInteger(recordId)) {
                recordId = animalState.nextRecordId++;
            }
            removePrototypeAnimalRecordById(animalState, recordId);
            const owner = resolvePrototypeEntityPersistenceOwner(runtimeAnimal);
            if (!owner) return false;
            let ownerSectionKey = "";
            if (owner.type === "building") {
                const instance = getMutablePrototypeBuildingInstance(owner.id);
                if (!instance) return false;
                if (!Array.isArray(instance.animals)) instance.animals = [];
                instance.animals.push({
                    ...recordData,
                    id: recordId
                });
                instance.contentVersion = (Number(instance.contentVersion) || 1) + 1;
                markPrototypeBuildingUnitDirtyForPersistence(owner.id);
            } else {
                ownerSectionKey = owner.id;
                const asset = map.getPrototypeSectionAsset(ownerSectionKey);
                if (!asset) return false;
                asset.animals.push({
                    ...recordData,
                    id: recordId
                });
                markPrototypeSectionUnitDirtyForPersistence(ownerSectionKey);
            }

            runtimeAnimal._prototypeRuntimeRecord = true;
            runtimeAnimal._prototypeRecordId = recordId;
            runtimeAnimal._prototypeOwnerSectionKey = ownerSectionKey;
            runtimeAnimal._prototypeOwnerType = owner.type;
            runtimeAnimal._prototypeOwnerId = owner.id;
            runtimeAnimal._prototypeOwnerSignature = `${owner.type}:${owner.id}`;
            runtimeAnimal._prototypePersistenceSignature = nextSignature;
            runtimeAnimal._prototypeDirty = false;
            if (animalState.activeRuntimeAnimalsByRecordId instanceof Map) {
                animalState.activeRuntimeAnimalsByRecordId.set(recordId, runtimeAnimal);
            }
            if (Array.isArray(animalState.activeRuntimeAnimals) && !animalState.activeRuntimeAnimals.includes(runtimeAnimal)) {
                animalState.activeRuntimeAnimals.push(runtimeAnimal);
            }
            return true;
        };

        const isPrototypeSavablePowerup = (powerup) => {
            if (!powerup || powerup.gone || powerup.collected) return false;
            if (typeof powerup.saveJson !== "function") return false;
            return true;
        };

        const removePrototypePowerupRecordById = (powerupState, recordId) => {
            const state = map._prototypeSectionState;
            if (!powerupState || !state || !(state.sectionAssetsByKey instanceof Map) || !Number.isInteger(recordId)) return false;
            let removed = false;
            for (const asset of state.sectionAssetsByKey.values()) {
                const records = Array.isArray(asset && asset.powerups) ? asset.powerups : [];
                if (records.length === 0) continue;
                const nextRecords = records.filter((record) => Number(record && record.id) !== recordId);
                if (nextRecords.length === records.length) continue;
                removed = true;
                asset.powerups = nextRecords;
                markPrototypeSectionUnitDirtyForPersistence(typeof asset.key === "string" ? asset.key : "");
            }
            const buildingState = map && map._prototypeBuildingState;
            const buildingInstances = buildingState && buildingState.buildingInstancesById instanceof Map
                ? buildingState.buildingInstancesById
                : null;
            if (buildingInstances) {
                for (const [buildingId, instance] of buildingInstances.entries()) {
                    const records = Array.isArray(instance && instance.powerups) ? instance.powerups : [];
                    if (records.length === 0) continue;
                    const nextRecords = records.filter((record) => Number(record && record.id) !== recordId);
                    if (nextRecords.length === records.length) continue;
                    removed = true;
                    instance.powerups = nextRecords;
                    instance.contentVersion = (Number(instance.contentVersion) || 1) + 1;
                    markPrototypeBuildingUnitDirtyForPersistence(buildingId);
                }
            }
            return removed;
        };

        const upsertPrototypePowerupRecord = (runtimePowerup) => {
            if (!isPrototypeSavablePowerup(runtimePowerup)) return false;
            const powerupState = map._prototypePowerupState;
            if (!powerupState) return false;
            const recordData = runtimePowerup.saveJson();
            if (!recordData || typeof recordData !== "object") return false;
            const nextSignature = buildPrototypePowerupPersistenceSignature(recordData);

            let recordId = Number(runtimePowerup._prototypeRecordId);
            if (!Number.isInteger(recordId)) {
                recordId = powerupState.nextRecordId++;
            }
            removePrototypePowerupRecordById(powerupState, recordId);
            const owner = resolvePrototypeEntityPersistenceOwner(runtimePowerup);
            if (!owner) return false;
            let ownerSectionKey = "";
            if (owner.type === "building") {
                const instance = getMutablePrototypeBuildingInstance(owner.id);
                if (!instance) return false;
                if (!Array.isArray(instance.powerups)) instance.powerups = [];
                instance.powerups.push({
                    ...recordData,
                    id: recordId
                });
                instance.contentVersion = (Number(instance.contentVersion) || 1) + 1;
                markPrototypeBuildingUnitDirtyForPersistence(owner.id);
            } else {
                ownerSectionKey = owner.id;
                const asset = map.getPrototypeSectionAsset(ownerSectionKey);
                if (!asset) return false;
                if (!Array.isArray(asset.powerups)) asset.powerups = [];
                asset.powerups.push({
                    ...recordData,
                    id: recordId
                });
                markPrototypeSectionUnitDirtyForPersistence(ownerSectionKey);
            }

            runtimePowerup._prototypeRuntimeRecord = true;
            runtimePowerup._prototypeRecordId = recordId;
            runtimePowerup._prototypeOwnerSectionKey = ownerSectionKey;
            runtimePowerup._prototypeOwnerType = owner.type;
            runtimePowerup._prototypeOwnerId = owner.id;
            runtimePowerup._prototypeOwnerSignature = `${owner.type}:${owner.id}`;
            runtimePowerup._prototypePersistenceSignature = nextSignature;
            runtimePowerup._prototypeDirty = false;
            if (powerupState.activeRuntimePowerupsByRecordId instanceof Map) {
                powerupState.activeRuntimePowerupsByRecordId.set(recordId, runtimePowerup);
            }
            if (Array.isArray(powerupState.activeRuntimePowerups) && !powerupState.activeRuntimePowerups.includes(runtimePowerup)) {
                powerupState.activeRuntimePowerups.push(runtimePowerup);
            }
            return true;
        };

        const capturePendingPrototypePowerups = () => {
            const powerupState = map._prototypePowerupState;
            if (!powerupState) return false;
            if (!(powerupState.activeRuntimePowerupsByRecordId instanceof Map)) {
                powerupState.activeRuntimePowerupsByRecordId = new Map();
            }
            let changed = false;
            const candidatePowerups = [];
            const seenPowerups = new Set();
            const addCandidatePowerup = (runtimePowerup) => {
                if (!runtimePowerup || seenPowerups.has(runtimePowerup)) return;
                if (runtimePowerup.map && runtimePowerup.map !== map) return;
                seenPowerups.add(runtimePowerup);
                candidatePowerups.push(runtimePowerup);
            };

            for (const runtimePowerup of powerupState.activeRuntimePowerupsByRecordId.values()) {
                addCandidatePowerup(runtimePowerup);
            }

            if (Array.isArray(globalScope.powerups)) {
                for (let i = 0; i < globalScope.powerups.length; i++) {
                    addCandidatePowerup(globalScope.powerups[i]);
                }
            }

            for (const [recordId, runtimePowerup] of Array.from(powerupState.activeRuntimePowerupsByRecordId.entries())) {
                const shouldPrune = (
                    !runtimePowerup ||
                    runtimePowerup.gone === true ||
                    runtimePowerup.collected === true ||
                    (runtimePowerup.map && runtimePowerup.map !== map) ||
                    (Array.isArray(globalScope.powerups) && globalScope.powerups.indexOf(runtimePowerup) < 0)
                );
                if (!shouldPrune) continue;
                if (removePrototypePowerupRecordById(powerupState, Number(recordId))) {
                    changed = true;
                }
                powerupState.activeRuntimePowerupsByRecordId.delete(recordId);
            }

            for (let i = 0; i < candidatePowerups.length; i++) {
                const runtimePowerup = candidatePowerups[i];
                if (!isPrototypeSavablePowerup(runtimePowerup)) continue;
                const currentOwnerSignature = getPrototypeEntityOwnerSignature(runtimePowerup);
                const previousOwnerSignature = typeof runtimePowerup._prototypeOwnerSignature === "string"
                    ? runtimePowerup._prototypeOwnerSignature
                    : "";
                const currentPersistenceSignature = buildPrototypePowerupPersistenceSignature(runtimePowerup);
                const previousPersistenceSignature = typeof runtimePowerup._prototypePersistenceSignature === "string"
                    ? runtimePowerup._prototypePersistenceSignature
                    : "";
                if (
                    currentOwnerSignature !== previousOwnerSignature ||
                    runtimePowerup._prototypeRuntimeRecord !== true ||
                    runtimePowerup._prototypeDirty === true ||
                    currentPersistenceSignature !== previousPersistenceSignature
                ) {
                    if (upsertPrototypePowerupRecord(runtimePowerup)) {
                        changed = true;
                    }
                }
            }
            powerupState.activeRuntimePowerups = Array.from(powerupState.activeRuntimePowerupsByRecordId.values());
            return changed;
        };

        return {
            buildPrototypeWallPersistenceSignature,
            buildPrototypeObjectPersistenceSignature,
            buildPrototypePowerupPersistenceSignature,
            capturePendingPrototypePowerups,
            evictPrototypeParkedRuntimeObject,
            formatPrototypeObjectProfileMap,
            getPrototypeEntityOwnerSignature,
            getPrototypeObjectProfileKey,
            getPrototypeObjectOwnerSignature,
            isPrototypeSavableAnimal,
            isPrototypeSavableObject,
            isPrototypeSavablePowerup,
            parkPrototypeRuntimeObject,
            prunePrototypeAnimalRuntimeRecord,
            removePrototypePowerupRecordById,
            removePrototypeObjectRecordById,
            removePrototypeRecordById,
            removePrototypeRoofRuntime,
            restorePrototypeParkedRuntimeObject,
            sanitizePrototypeObjectRecords,
            trimPrototypeParkedRuntimeObjectCache,
            upsertPrototypeAnimalRecord,
            upsertPrototypeObjectRecord,
            upsertPrototypePowerupRecord
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
