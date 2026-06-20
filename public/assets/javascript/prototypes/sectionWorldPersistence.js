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

        const getBuildingIdFromRuntimeFloorFragmentId = (fragmentId) => {
            if (typeof fragmentId !== "string" || fragmentId.length === 0) return "";
            const marker = ":floor:";
            const index = fragmentId.lastIndexOf(marker);
            if (index <= 0) return "";
            return fragmentId.slice(0, index);
        };

        const getSourceFloorIdFromRuntimeFloorRef = (value, buildingId, marker = ":floor:") => {
            if (typeof value !== "string" || value.length === 0) return "";
            if (typeof buildingId === "string" && buildingId.length > 0) {
                const prefix = `${buildingId}${marker}`;
                if (value.startsWith(prefix) && value.length > prefix.length) return value.slice(prefix.length);
            }
            const index = value.indexOf(marker);
            return index >= 0 && index + marker.length < value.length ? value.slice(index + marker.length) : "";
        };

        const getPrototypeBuildingInstances = () => {
            const buildingState = map && map._prototypeBuildingState;
            return buildingState && buildingState.buildingInstancesById instanceof Map
                ? buildingState.buildingInstancesById
                : null;
        };

        const createBuildingFloorReference = (buildingId, instance, floor, index) => {
            if (!buildingId || !floor || typeof floor !== "object") return null;
            const sourceFloorIdValue = floor.fragmentId || floor.surfaceId || floor.id || index;
            if (!sourceFloorIdValue && sourceFloorIdValue !== 0) return null;
            const sourceFloorId = String(sourceFloorIdValue);
            const sourceSurfaceId = String(floor.surfaceId || sourceFloorId);
            return {
                buildingId,
                instance,
                sourceFloorId,
                sourceSurfaceId,
                runtimeFragmentId: `${buildingId}:floor:${sourceFloorId}`,
                runtimeSurfaceId: `${buildingId}:surface:${sourceSurfaceId}`
            };
        };

        const buildingFloorReferenceMatchesRecord = (reference, record) => {
            if (!reference || !record || typeof record !== "object") return false;
            const fragmentId = typeof record.fragmentId === "string" ? record.fragmentId : "";
            const surfaceId = typeof record.surfaceId === "string" ? record.surfaceId : "";
            const membership = getFloorMembershipForPrototypeObjectRecord(record);
            if (
                membership &&
                membership.ownerType === "building" &&
                membership.ownerId === reference.buildingId &&
                membership.floorId === reference.sourceFloorId
            ) {
                return true;
            }
            return (
                (fragmentId.length > 0 && (
                    fragmentId === reference.runtimeFragmentId ||
                    fragmentId === reference.sourceFloorId
                )) ||
                (surfaceId.length > 0 && (
                    surfaceId === reference.runtimeSurfaceId ||
                    surfaceId === reference.sourceSurfaceId
                ))
            );
        };

        const getFloorMembershipForPrototypeObjectRecord = (record, ownerInfo = null) => {
            if (!record || typeof record !== "object") return null;
            const floorSupportApi = globalScope && globalScope.FloorSupport;
            const fragmentId = typeof record.fragmentId === "string" ? record.fragmentId : "";
            const surfaceId = typeof record.surfaceId === "string" ? record.surfaceId : "";
            const encodedBuildingId = getBuildingIdFromRuntimeFloorFragmentId(fragmentId) ||
                (surfaceId.includes(":surface:")
                    ? surfaceId.slice(0, surfaceId.indexOf(":surface:"))
                    : "");
            const ownerType = encodedBuildingId
                ? "building"
                : (ownerInfo && ownerInfo.ownerType === "building" ? "building" : "");
            const ownerId = encodedBuildingId ||
                (ownerInfo && ownerInfo.ownerType === "building" && typeof ownerInfo.buildingId === "string"
                    ? ownerInfo.buildingId
                    : "");
            if (floorSupportApi && typeof floorSupportApi.getEntityFloorMembership === "function") {
                const membership = floorSupportApi.getEntityFloorMembership(record, {
                    record,
                    ownerType,
                    ownerId
                });
                if (membership) return membership;
            }
            if (record.floorMembership && typeof record.floorMembership === "object") {
                const membershipOwnerType = typeof record.floorMembership.ownerType === "string" ? record.floorMembership.ownerType : "";
                const membershipOwnerId = typeof record.floorMembership.ownerId === "string" ? record.floorMembership.ownerId : "";
                const floorId = typeof record.floorMembership.floorId === "string" ? record.floorMembership.floorId : "";
                if (membershipOwnerType && membershipOwnerId && floorId) {
                    return {
                        ownerType: membershipOwnerType,
                        ownerId: membershipOwnerId,
                        floorId
                    };
                }
            }
            if (!ownerId) return null;
            const floorId = getSourceFloorIdFromRuntimeFloorRef(fragmentId, ownerId, ":floor:") ||
                getSourceFloorIdFromRuntimeFloorRef(surfaceId, ownerId, ":surface:");
            if (!floorId) return null;
            return {
                ownerType: "building",
                ownerId,
                floorId
            };
        };

        const findBuildingFloorReferenceForMembership = (membership) => {
            if (!membership || membership.ownerType !== "building" || !membership.ownerId || !membership.floorId) return null;
            const buildingInstances = getPrototypeBuildingInstances();
            const instance = buildingInstances ? buildingInstances.get(membership.ownerId) || null : null;
            const floors = Array.isArray(instance && instance.floorFragments) ? instance.floorFragments : null;
            if (!Array.isArray(floors)) return null;
            const matches = [];
            for (let i = 0; i < floors.length; i++) {
                const reference = createBuildingFloorReference(membership.ownerId, instance, floors[i], i);
                if (reference && reference.sourceFloorId === membership.floorId) matches.push(reference);
            }
            return matches.length === 1 ? matches[0] : null;
        };

        const findBuildingFloorReferenceForRecord = (record, preferredBuildingId = "") => {
            const buildingInstances = getPrototypeBuildingInstances();
            if (!buildingInstances || !record || typeof record !== "object") return null;
            const membership = getFloorMembershipForPrototypeObjectRecord(record, preferredBuildingId ? {
                ownerType: "building",
                buildingId: preferredBuildingId
            } : null);
            const membershipReference = findBuildingFloorReferenceForMembership(membership);
            if (membershipReference) return membershipReference;
            const fragmentId = typeof record.fragmentId === "string" ? record.fragmentId : "";
            const encodedBuildingId = getBuildingIdFromRuntimeFloorFragmentId(fragmentId);
            const matches = [];
            const seen = new Set();
            const scanBuilding = (buildingId) => {
                if (!buildingId || seen.has(buildingId)) return;
                seen.add(buildingId);
                const instance = buildingInstances.get(buildingId) || null;
                const floors = Array.isArray(instance && instance.floorFragments) ? instance.floorFragments : null;
                if (!Array.isArray(floors)) return;
                for (let i = 0; i < floors.length; i++) {
                    const reference = createBuildingFloorReference(buildingId, instance, floors[i], i);
                    if (buildingFloorReferenceMatchesRecord(reference, record)) {
                        matches.push(reference);
                    }
                }
            };
            if (encodedBuildingId) {
                scanBuilding(encodedBuildingId);
                return matches.length === 1 ? matches[0] : null;
            }
            if (preferredBuildingId) {
                scanBuilding(preferredBuildingId);
                if (matches.length === 1) return matches[0];
                if (matches.length > 1) return null;
            }
            for (const buildingId of buildingInstances.keys()) {
                scanBuilding(typeof buildingId === "string" ? buildingId : String(buildingId));
            }
            if (matches.length !== 1) return null;
            return matches[0];
        };

        const findBuildingFloorReferenceForRecordPosition = (record, buildingId = "") => {
            if (!record || typeof record !== "object" || !buildingId || !(map && map.floorsById instanceof Map)) return null;
            const layer = Number.isFinite(Number(record.traversalLayer))
                ? Math.round(Number(record.traversalLayer))
                : (Number.isFinite(Number(record.level)) ? Math.round(Number(record.level)) : 0);
            if (layer <= 0) return null;
            const x = Number(record.x);
            const y = Number(record.y);
            if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
            const matches = [];
            for (const fragment of map.floorsById.values()) {
                if (!fragment || fragment.renderedByBuildingCutaway !== true) continue;
                if (fragment.ownerType !== "building" || fragment.ownerId !== buildingId) continue;
                const fragmentLayer = Number.isFinite(Number(fragment.level)) ? Math.round(Number(fragment.level)) : 0;
                if (fragmentLayer !== layer) continue;
                if (
                    typeof map.isPointSupportedByFloorFragment === "function" &&
                    !map.isPointSupportedByFloorFragment(fragment, x, y)
                ) continue;
                matches.push(fragment);
            }
            if (matches.length !== 1) return null;
            const fragment = matches[0];
            const buildingInstances = getPrototypeBuildingInstances();
            return {
                buildingId,
                instance: buildingInstances ? buildingInstances.get(buildingId) || null : null,
                sourceFloorId: "",
                sourceSurfaceId: "",
                runtimeFragmentId: typeof fragment.fragmentId === "string" ? fragment.fragmentId : "",
                runtimeSurfaceId: typeof fragment.surfaceId === "string" ? fragment.surfaceId : ""
            };
        };

        const normalizePlacedObjectBuildingFloorRecord = (record, reference) => {
            if (!record || typeof record !== "object" || !reference) return { record, changed: false };
            let changed = false;
            const normalized = { ...record };
            const expectedMembership = {
                ownerType: "building",
                ownerId: reference.buildingId,
                floorId: reference.sourceFloorId
            };
            const currentMembership = normalized.floorMembership && typeof normalized.floorMembership === "object"
                ? normalized.floorMembership
                : null;
            if (
                !currentMembership ||
                currentMembership.ownerType !== expectedMembership.ownerType ||
                currentMembership.ownerId !== expectedMembership.ownerId ||
                currentMembership.floorId !== expectedMembership.floorId
            ) {
                normalized.floorMembership = expectedMembership;
                changed = true;
            }
            if (typeof reference.runtimeFragmentId === "string" && normalized.fragmentId !== reference.runtimeFragmentId) {
                normalized.fragmentId = reference.runtimeFragmentId;
                changed = true;
            }
            if (typeof reference.runtimeSurfaceId === "string" && normalized.surfaceId !== reference.runtimeSurfaceId) {
                normalized.surfaceId = reference.runtimeSurfaceId;
                changed = true;
            }
            return { record: changed ? normalized : record, changed };
        };

        const isLiveNonBuildingFloorFragmentId = (fragmentId) => {
            if (!fragmentId || !(map && map.floorsById instanceof Map)) return false;
            const fragment = map.floorsById.get(fragmentId) || null;
            if (!fragment) return false;
            const floorSupportApi = globalScope && globalScope.FloorSupport;
            const isPrototypeBuildingFragment = floorSupportApi && typeof floorSupportApi.isPrototypeBuildingPlacementFloorFragment === "function"
                ? floorSupportApi.isPrototypeBuildingPlacementFloorFragment(fragment)
                : !!(
                    fragment &&
                    fragment.renderedByBuildingCutaway === true &&
                    fragment.ownerType === "building" &&
                    typeof fragment.ownerId === "string" &&
                    fragment.ownerId.length > 0
                );
            return !isPrototypeBuildingFragment;
        };

        const buildingInstanceHasRuntimeFloorFragmentId = (buildingId, fragmentId) => {
            if (!buildingId || !fragmentId) return false;
            const buildingInstances = getPrototypeBuildingInstances();
            const instance = buildingInstances ? buildingInstances.get(buildingId) || null : null;
            const floors = Array.isArray(instance && instance.floorFragments) ? instance.floorFragments : null;
            if (!Array.isArray(floors)) return false;
            for (let i = 0; i < floors.length; i++) {
                const reference = createBuildingFloorReference(buildingId, instance, floors[i], i);
                if (
                    reference &&
                    (reference.sourceFloorId === fragmentId || reference.runtimeFragmentId === fragmentId)
                ) {
                    return true;
                }
            }
            return false;
        };

        const getMutableBuildingInstanceForEncodedFragment = (fragmentId) => {
            const buildingId = getBuildingIdFromRuntimeFloorFragmentId(fragmentId);
            if (!buildingId || !buildingInstanceHasRuntimeFloorFragmentId(buildingId, fragmentId)) return null;
            const buildingState = map && map._prototypeBuildingState;
            const buildingInstances = buildingState && buildingState.buildingInstancesById instanceof Map
                ? buildingState.buildingInstancesById
                : null;
            return buildingInstances ? buildingInstances.get(buildingId) || null : null;
        };

        const isOrphanedUpperFloorPlacedObjectRecord = (record, ownerInfo = null) => {
            if (!record || typeof record !== "object" || record.type !== "placedObject") return false;
            const layer = Number.isFinite(Number(record.traversalLayer))
                ? Math.round(Number(record.traversalLayer))
                : (Number.isFinite(Number(record.level)) ? Math.round(Number(record.level)) : 0);
            if (layer <= 0) return false;
            const fragmentId = typeof record.fragmentId === "string" && record.fragmentId.length > 0
                ? record.fragmentId
                : "";
            if (!fragmentId) {
                const positionedBuildingFloor = findBuildingFloorReferenceForRecordPosition(
                    record,
                    ownerInfo && ownerInfo.ownerType === "building" && typeof ownerInfo.buildingId === "string"
                        ? ownerInfo.buildingId
                        : ""
                );
                return !positionedBuildingFloor;
            }
            const encodedBuildingId = getBuildingIdFromRuntimeFloorFragmentId(fragmentId);
            if (encodedBuildingId && buildingInstanceHasRuntimeFloorFragmentId(encodedBuildingId, fragmentId)) {
                return false;
            }
            const membership = getFloorMembershipForPrototypeObjectRecord(record, ownerInfo);
            if (membership && membership.ownerType === "building" && membership.ownerId && membership.floorId) {
                const membershipReference = findBuildingFloorReferenceForMembership(membership);
                if (membershipReference) return false;
                const buildingInstances = getPrototypeBuildingInstances();
                if (!buildingInstances || !buildingInstances.has(membership.ownerId)) return false;
                const instance = buildingInstances.get(membership.ownerId) || null;
                const floors = Array.isArray(instance && instance.floorFragments) ? instance.floorFragments : null;
                if (!Array.isArray(floors) || floors.length === 0) return false;
                throw new Error(`building-owned upper-floor placed object ${record.id || "(unknown)"} references unknown canonical floor ${membership.ownerId}:${membership.floorId}`);
            }
            const matchedBuildingFloor = findBuildingFloorReferenceForRecord(
                record,
                ownerInfo && ownerInfo.ownerType === "building" && typeof ownerInfo.buildingId === "string"
                    ? ownerInfo.buildingId
                    : ""
            );
            if (matchedBuildingFloor) return false;
            if (
                ownerInfo &&
                ownerInfo.ownerType === "building" &&
                typeof ownerInfo.buildingId === "string" &&
                buildingInstanceHasRuntimeFloorFragmentId(ownerInfo.buildingId, fragmentId)
            ) {
                return false;
            }
            const fragment = map && map.floorsById instanceof Map ? map.floorsById.get(fragmentId) || null : null;
            const floorSupportApi = globalScope && globalScope.FloorSupport;
            const isPrototypeBuildingFragment = floorSupportApi && typeof floorSupportApi.isPrototypeBuildingPlacementFloorFragment === "function"
                ? floorSupportApi.isPrototypeBuildingPlacementFloorFragment(fragment)
                : !!(
                    fragment &&
                    fragment.renderedByBuildingCutaway === true &&
                    fragment.ownerType === "building" &&
                    typeof fragment.ownerId === "string" &&
                    fragment.ownerId.length > 0
                );
            if (isPrototypeBuildingFragment) return false;
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
            let migratedBuildingFloorObjects = 0;
            let normalizedBuildingFloorObjects = 0;
            const orphanedSamples = [];
            const filterRecords = (records, ownerInfo, onChanged) => {
                if (!Array.isArray(records) || records.length === 0) return records;
                const nextRecords = records.filter((record) => {
                    if (isInvalidPrototypeObjectRecord(record)) return false;
                    const recordFragmentId = record && typeof record.fragmentId === "string" ? record.fragmentId : "";
                    const matchedBuildingFloor = findBuildingFloorReferenceForRecord(
                        record,
                        ownerInfo && ownerInfo.ownerType === "building" && typeof ownerInfo.buildingId === "string"
                            ? ownerInfo.buildingId
                            : ""
                    ) || findBuildingFloorReferenceForRecordPosition(
                        record,
                        ownerInfo && ownerInfo.ownerType === "building" && typeof ownerInfo.buildingId === "string"
                            ? ownerInfo.buildingId
                            : ""
                    );
                    if (
                        ownerInfo &&
                        ownerInfo.ownerType === "section" &&
                        (recordFragmentId || matchedBuildingFloor) &&
                        !isLiveNonBuildingFloorFragmentId(recordFragmentId)
                    ) {
                        const encodedInstance = recordFragmentId ? getMutableBuildingInstanceForEncodedFragment(recordFragmentId) : null;
                        const instance = (matchedBuildingFloor && matchedBuildingFloor.instance) || encodedInstance;
                        if (instance) {
                            const recordId = Number(record && record.id);
                            const normalized = normalizePlacedObjectBuildingFloorRecord(
                                record,
                                matchedBuildingFloor || findBuildingFloorReferenceForRecord(record, instance.id)
                            ).record;
                            if (!Array.isArray(instance.objects)) instance.objects = [];
                            const alreadyPresent = Number.isInteger(recordId) && instance.objects.some((candidate) => (
                                Number(candidate && candidate.id) === recordId
                            ));
                            if (!alreadyPresent) {
                                instance.objects.push({ ...normalized });
                                instance.contentVersion = (Number(instance.contentVersion) || 1) + 1;
                                markPrototypeBuildingUnitDirtyForPersistence(instance.id);
                            }
                            migratedBuildingFloorObjects += 1;
                            return false;
                        }
                    }
                    if (ownerInfo && ownerInfo.ownerType === "building" && matchedBuildingFloor) {
                        const normalized = normalizePlacedObjectBuildingFloorRecord(record, matchedBuildingFloor);
                        if (normalized.changed) {
                            Object.assign(record, normalized.record);
                            normalizedBuildingFloorObjects += 1;
                            if (matchedBuildingFloor.instance) {
                                matchedBuildingFloor.instance.contentVersion = (Number(matchedBuildingFloor.instance.contentVersion) || 1) + 1;
                            }
                            markPrototypeBuildingUnitDirtyForPersistence(ownerInfo.buildingId);
                            removedAny = true;
                        }
                    }
                    if (isOrphanedUpperFloorPlacedObjectRecord(record, ownerInfo)) {
                        orphanedUpperFloorObjects += 1;
                        if (orphanedSamples.length < 5) {
                            orphanedSamples.push({
                                ownerType: ownerInfo && typeof ownerInfo.ownerType === "string" ? ownerInfo.ownerType : "section",
                                sectionKey: ownerInfo && typeof ownerInfo.sectionKey === "string" ? ownerInfo.sectionKey : "",
                                buildingId: ownerInfo && typeof ownerInfo.buildingId === "string" ? ownerInfo.buildingId : "",
                                recordId: Number.isInteger(Number(record && record.id)) ? Number(record.id) : null,
                                fragmentId: typeof record?.fragmentId === "string" ? record.fragmentId : ""
                            });
                        }
                        return false;
                    }
                    return true;
                });
                if (nextRecords.length === records.length) return records;
                if (typeof onChanged === "function") onChanged(nextRecords);
                removedAny = true;
                return nextRecords;
            };
            for (const asset of state.sectionAssetsByKey.values()) {
                const records = Array.isArray(asset && asset.objects) ? asset.objects : null;
                filterRecords(records, {
                    ownerType: "section",
                    sectionKey: typeof asset.key === "string" ? asset.key : ""
                }, (nextRecords) => {
                    asset.objects = nextRecords;
                    rebuildPrototypeAssetObjectNameRegistry(asset);
                    markPrototypeClearanceDirty(asset);
                    markPrototypeSectionUnitDirtyForPersistence(typeof asset.key === "string" ? asset.key : "");
                });
            }
            const buildingState = map && map._prototypeBuildingState;
            const buildingInstances = buildingState && buildingState.buildingInstancesById instanceof Map
                ? buildingState.buildingInstancesById
                : null;
            if (buildingInstances) {
                for (const [buildingId, instance] of buildingInstances.entries()) {
                    const records = Array.isArray(instance && instance.objects) ? instance.objects : null;
                    filterRecords(records, {
                        ownerType: "building",
                        buildingId: typeof buildingId === "string" ? buildingId : ""
                    }, (nextRecords) => {
                        instance.objects = nextRecords;
                        instance.contentVersion = (Number(instance.contentVersion) || 1) + 1;
                        markPrototypeBuildingUnitDirtyForPersistence(typeof buildingId === "string" ? buildingId : "");
                    });
                }
            }
            if (orphanedUpperFloorObjects > 0 && typeof console !== "undefined" && typeof console.warn === "function") {
                console.warn("[prototype object sanitize] removed orphaned upper-floor placed objects", {
                    count: orphanedUpperFloorObjects,
                    samples: orphanedSamples
                });
            }
            if (migratedBuildingFloorObjects > 0 && typeof console !== "undefined" && typeof console.info === "function") {
                console.info("[prototype object sanitize] moved section-owned building-floor objects into building records", {
                    count: migratedBuildingFloorObjects
                });
            }
            if (normalizedBuildingFloorObjects > 0 && typeof console !== "undefined" && typeof console.info === "function") {
                console.info("[prototype object sanitize] normalized building-floor object floor refs", {
                    count: normalizedBuildingFloorObjects
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

        const markPrototypeBuildingInstanceContentChanged = (buildingId, instance) => {
            if (typeof buildingId !== "string" || buildingId.length === 0 || !instance) return;
            const buildingState = map && map._prototypeBuildingState;
            if (!buildingState || typeof buildingState !== "object") return;
            const version = Number.isFinite(Number(instance.contentVersion))
                ? Number(instance.contentVersion)
                : 1;
            const placement = buildingState.placementsById instanceof Map
                ? buildingState.placementsById.get(buildingId) || null
                : null;
            if (placement) {
                placement.contentVersion = version;
            }
            if (buildingState.interiorBitmapsByKey instanceof Map) {
                const prefix = `${buildingId}|`;
                for (const [key, entry] of buildingState.interiorBitmapsByKey.entries()) {
                    if (typeof key !== "string" || !key.startsWith(prefix) || !entry) continue;
                    if (entry.status === "ready" && entry.texture) {
                        entry.stale = true;
                        entry.staleReason = "building-content";
                    } else if (entry.status !== "loading") {
                        buildingState.interiorBitmapsByKey.delete(key);
                    }
                }
            }
            buildingState.contentVersion = (Number(buildingState.contentVersion) || 0) + 1;
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
                markPrototypeBuildingInstanceContentChanged(ownerBuildingId, instance);
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
