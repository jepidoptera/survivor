(function (globalScope) {
    "use strict";

    const BUILDING_PLACEMENT_SCHEMA = "survivor-building-placement-v1";
    const BUILDING_SAVE_SCHEMA = "survivor-building-v1";
    const EXTERIOR_BITMAP_RENDER_DATA_VERSION = "depth-rgb-biased-v5-alpha-mask-runtime-floor-layers";
    const INTERIOR_BITMAP_RENDER_DATA_VERSION = "depth-rgb-interior-v28-object-bake-y-origin";
    const MOVEMENT_BLOCKER_GEOMETRY_VERSION = "layered-wall-column-stairless-v10-stack-layers";
    const MOVEMENT_EDGE_BLOCKER_VERSION = "surface-neighbor-crossings-v3";
    const DEFAULT_BUILDING_WALL_HEIGHT = 3;
    const DEFAULT_PROTOTYPE_BUILDING_BITMAP_PADDING_PIXELS = 96;
    const DEFAULT_PROTOTYPE_BUILDING_BITMAP_MAX_DIMENSION = 4096;
    const BUILDING_BITMAP_GAME_XY_RATIO = 0.66;
    const BUILDING_BITMAP_CAMERA_DEFAULT_PITCH = Math.PI / 4;
    const BUILDING_BITMAP_CAMERA_MIN_PITCH = 0;
    const BUILDING_BITMAP_CAMERA_MAX_PITCH = Math.PI / 2 - 0.001;
    const BUILDING_BITMAP_CAMERA_PITCH_BASE = Math.SQRT1_2;
    const INTERIOR_BITMAP_GROUND_PLANE_VISUAL_LIFT = 0.03;

    function finiteNumber(value, label) {
        const num = Number(value);
        if (!Number.isFinite(num)) {
            throw new Error(`${label} must be a finite number`);
        }
        return num;
    }

    function hasFiniteNumericValue(value) {
        return value !== undefined && value !== null && value !== "" && Number.isFinite(Number(value));
    }

    function nonEmptyString(value, label) {
        const text = String(value === undefined || value === null ? "" : value).trim();
        if (!text) {
            throw new Error(`${label} must be a non-empty string`);
        }
        return text;
    }

    function normalizePlacementId(rawId, index = 0) {
        const id = nonEmptyString(rawId, `building placement ${index} id`);
        if (!/^building:[A-Za-z0-9_.:-]+$/.test(id)) {
            throw new Error(`building placement id must start with building: and use stable id characters: ${id}`);
        }
        return id;
    }

    function clonePoint(point, label) {
        if (!point || typeof point !== "object") {
            throw new Error(`${label} point must be an object`);
        }
        return {
            x: finiteNumber(point.x, `${label} x`),
            y: finiteNumber(point.y, `${label} y`)
        };
    }

    function normalizePolygon(points, label) {
        if (!Array.isArray(points) || points.length < 3) {
            throw new Error(`${label} requires at least three points`);
        }
        return points.map((point, index) => clonePoint(point, `${label} point ${index}`));
    }

    function normalizeFootprintPolygons(polygons, label = "building placement footprintPolygons") {
        if (polygons === undefined || polygons === null) return [];
        if (!Array.isArray(polygons)) {
            throw new Error(`${label} must be an array`);
        }
        return polygons.map((polygon, index) => normalizePolygon(polygon, `${label} ${index}`));
    }

    function normalizeMovementBlockerPolygons(polygons, label = "building placement movementBlockerPolygons") {
        if (polygons === undefined || polygons === null) return [];
        if (!Array.isArray(polygons)) {
            throw new Error(`${label} must be an array`);
        }
        return polygons.map((entry, index) => normalizeMovementBlockerEntry(entry, index, label));
    }

    function normalizeMovementBlockerEntry(entry, index, label = "building placement movementBlockerPolygons") {
        if (Array.isArray(entry)) {
            return normalizePolygon(entry, `${label} ${index}`);
        }
        if (!entry || typeof entry !== "object" || !Array.isArray(entry.polygon)) {
            throw new Error(`${label} ${index} must be a polygon or movement blocker entry`);
        }
        const traversalLayer = Number.isFinite(Number(entry.traversalLayer))
            ? Math.round(Number(entry.traversalLayer))
            : null;
        if (!Number.isFinite(traversalLayer)) {
            throw new Error(`${label} ${index} movement blocker entry requires traversalLayer`);
        }
        const normalized = {
            polygon: normalizePolygon(entry.polygon, `${label} ${index} polygon`),
            traversalLayer
        };
        if (typeof entry.surfaceId === "string" && entry.surfaceId.length > 0) normalized.surfaceId = entry.surfaceId;
        if (typeof entry.fragmentId === "string" && entry.fragmentId.length > 0) normalized.fragmentId = entry.fragmentId;
        if (typeof entry.floorId === "string" && entry.floorId.length > 0) normalized.floorId = entry.floorId;
        if (typeof entry.sourceFloorId === "string" && entry.sourceFloorId.length > 0) normalized.sourceFloorId = entry.sourceFloorId;
        if (Object.prototype.hasOwnProperty.call(entry, "bottomZ")) {
            normalized.bottomZ = finiteNumber(entry.bottomZ, `${label} ${index} bottomZ`);
        }
        if (Object.prototype.hasOwnProperty.call(entry, "height")) {
            normalized.height = finiteNumber(entry.height, `${label} ${index} height`);
            if (!(normalized.height > 0)) {
                throw new Error(`${label} ${index} height must be positive`);
            }
        }
        return normalized;
    }

    function normalizeMovementBlockedEdges(edges, label = "building placement movementBlockedEdges") {
        if (edges === undefined || edges === null) return [];
        if (!Array.isArray(edges)) {
            throw new Error(`${label} must be an array`);
        }
        const out = [];
        for (let i = 0; i < edges.length; i++) {
            const edge = edges[i];
            if (!edge || typeof edge !== "object") {
                throw new Error(`${label} ${i} must be an object`);
            }
            const surfaceId = nonEmptyString(edge.surfaceId, `${label} ${i} surfaceId`);
            const normalizeEndpoint = (endpoint, endpointLabel) => {
                if (!endpoint || typeof endpoint !== "object") {
                    throw new Error(`${endpointLabel} must be an object`);
                }
                const normalized = {
                    xindex: finiteNumber(endpoint.xindex, `${endpointLabel} xindex`),
                    yindex: finiteNumber(endpoint.yindex, `${endpointLabel} yindex`),
                    surfaceId
                };
                if (typeof endpoint.fragmentId === "string" && endpoint.fragmentId.length > 0) {
                    normalized.fragmentId = endpoint.fragmentId;
                }
                if (typeof endpoint.surfaceId === "string" && endpoint.surfaceId.length > 0) {
                    normalized.surfaceId = endpoint.surfaceId;
                }
                if (Number.isFinite(Number(endpoint.traversalLayer))) normalized.traversalLayer = Math.round(Number(endpoint.traversalLayer));
                return normalized;
            };
            const normalizedEdge = {
                id: typeof edge.id === "string" && edge.id.length > 0 ? edge.id : `${surfaceId}:${i}`,
                buildingPlacementId: typeof edge.buildingPlacementId === "string" ? edge.buildingPlacementId : "",
                surfaceId,
                a: normalizeEndpoint(edge.a, `${label} ${i} a`),
                b: normalizeEndpoint(edge.b, `${label} ${i} b`)
            };
            if (typeof edge.fragmentId === "string" && edge.fragmentId.length > 0) normalizedEdge.fragmentId = edge.fragmentId;
            if (Number.isInteger(Number(edge.movementBlockerIndex))) normalizedEdge.movementBlockerIndex = Number(edge.movementBlockerIndex);
            if (Number.isFinite(Number(edge.traversalLayer))) normalizedEdge.traversalLayer = Math.round(Number(edge.traversalLayer));
            out.push(normalizedEdge);
        }
        return out;
    }

    function getMovementBlockerEntryPolygon(entry, label = "building movement blocker") {
        if (Array.isArray(entry)) return entry;
        if (entry && typeof entry === "object" && Array.isArray(entry.polygon)) return entry.polygon;
        throw new Error(`${label} requires a polygon`);
    }

    function getMovementBlockerEntryLayer(entry, label = "building movement blocker") {
        if (Array.isArray(entry)) return 0;
        if (entry && typeof entry === "object") {
            const traversalLayer = Number.isFinite(Number(entry.traversalLayer))
                ? Math.round(Number(entry.traversalLayer))
                : null;
            if (Number.isFinite(traversalLayer)) return traversalLayer;
        }
        throw new Error(`${label} requires traversalLayer`);
    }

    function getMovementBlockerEntryBottomZ(entry, traversalLayer, label = "building movement blocker") {
        if (entry && typeof entry === "object" && Object.prototype.hasOwnProperty.call(entry, "bottomZ")) {
            return finiteNumber(entry.bottomZ, `${label} bottomZ`);
        }
        return (Number(traversalLayer) || 0) * DEFAULT_BUILDING_WALL_HEIGHT;
    }

    function getMovementBlockerEntryHeight(entry, label = "building movement blocker") {
        if (entry && typeof entry === "object" && Object.prototype.hasOwnProperty.call(entry, "height")) {
            const height = finiteNumber(entry.height, `${label} height`);
            if (!(height > 0)) throw new Error(`${label} height must be positive`);
            return height;
        }
        return DEFAULT_BUILDING_WALL_HEIGHT;
    }

    function normalizeSectionKeys(keys) {
        if (keys === undefined || keys === null) return [];
        if (!Array.isArray(keys)) {
            throw new Error("building placement overlappedSectionKeys must be an array");
        }
        const out = [];
        const seen = new Set();
        for (let i = 0; i < keys.length; i++) {
            const key = String(keys[i] || "").trim();
            if (!key || seen.has(key)) continue;
            seen.add(key);
            out.push(key);
        }
        return out;
    }

    function cloneBuildingPlacementRef(placement) {
        if (!placement || typeof placement !== "object") {
            throw new Error("building section ref requires a placement");
        }
        return {
            id: normalizePlacementId(placement.id, 0),
            shell: true
        };
    }

    function cloneBuildingPlacementRefs(refs, label = "buildingRefs") {
        if (refs === undefined || refs === null) return [];
        if (!Array.isArray(refs)) {
            throw new Error(`${label} must be an array`);
        }
        const out = [];
        const seen = new Set();
        for (let i = 0; i < refs.length; i++) {
            const ref = refs[i];
            if (!ref || typeof ref !== "object" || Array.isArray(ref)) {
                throw new Error(`${label} ${i} must be an object`);
            }
            const id = normalizePlacementId(ref.id, i);
            if (seen.has(id)) {
                throw new Error(`${label} contains duplicate building ref ${id}`);
            }
            seen.add(id);
            out.push({
                id,
                shell: ref.shell === false ? false : true
            });
        }
        return out;
    }

    function ensurePrototypeDirtyWorldUnits(state) {
        if (!state || typeof state !== "object") return null;
        if (!state.dirtyWorldUnits || typeof state.dirtyWorldUnits !== "object") {
            state.dirtyWorldUnits = {
                sections: new Set(),
                buildings: new Set()
            };
        }
        if (!(state.dirtyWorldUnits.sections instanceof Set)) {
            state.dirtyWorldUnits.sections = new Set(state.dirtyWorldUnits.sections || []);
        }
        if (!(state.dirtyWorldUnits.buildings instanceof Set)) {
            state.dirtyWorldUnits.buildings = new Set(state.dirtyWorldUnits.buildings || []);
        }
        return state.dirtyWorldUnits;
    }

    function markPrototypeBuildingUnitDirty(state, buildingId) {
        const dirty = ensurePrototypeDirtyWorldUnits(state);
        if (!dirty) return false;
        dirty.buildings.add(normalizePlacementId(buildingId, 0));
        return true;
    }

    function markPrototypeSectionUnitsDirty(state, sectionKeys) {
        const dirty = ensurePrototypeDirtyWorldUnits(state);
        const keys = normalizeSectionKeys(sectionKeys);
        if (!dirty) return false;
        keys.forEach((key) => dirty.sections.add(key));
        return keys.length > 0;
    }

    function setBuildingInstanceRecord(state, rawInstance, options = {}) {
        if (!state || typeof state !== "object") {
            throw new Error("building instance registry requires building state");
        }
        const instance = normalizeBuildingInstanceRecord(rawInstance, 0);
        if (!(state.buildingInstancesById instanceof Map)) state.buildingInstancesById = new Map();
        if (!(state.buildingDataByInstanceId instanceof Map)) state.buildingDataByInstanceId = new Map();
        state.buildingInstancesById.set(instance.id, instance);
        state.buildingDataByInstanceId.set(instance.id, instance);
        if (options.markDirty === true) markPrototypeBuildingUnitDirty(state, instance.id);
        return instance;
    }

    function getBuildingInstanceRecord(state, placementOrId) {
        const placementId = typeof placementOrId === "string"
            ? normalizePlacementId(placementOrId, 0)
            : (placementOrId && placementOrId.id ? normalizePlacementId(placementOrId.id, 0) : "");
        if (!placementId || !state || !(state.buildingInstancesById instanceof Map)) return null;
        return state.buildingInstancesById.get(placementId) || null;
    }

    function getBuildingDataForPlacement(state, placement) {
        if (!state || !placement) return null;
        const instance = getBuildingInstanceRecord(state, placement);
        if (instance) return instance;
        if (state.buildingDataByInstanceId instanceof Map && state.buildingDataByInstanceId.has(placement.id)) {
            return state.buildingDataByInstanceId.get(placement.id);
        }
        return state.buildingDataBySaveName instanceof Map
            ? (state.buildingDataBySaveName.get(placement.buildingSaveName) || null)
            : null;
    }

    function updatePlacementFromInstance(placement, instance) {
        if (!placement || !instance) return placement;
        placement.sourceBuildingSaveName = instance.sourceBuildingSaveName;
        placement.buildingSaveName = instance.sourceBuildingSaveName;
        placement.contentVersion = instance.contentVersion;
        placement.transform = { ...instance.transform };
        placement.footprintPolygons = normalizeFootprintPolygons(instance.footprintPolygons);
        placement.movementBlockerPolygons = instance.movementBlockerPolygons === null
            ? null
            : normalizeMovementBlockerPolygons(instance.movementBlockerPolygons);
        placement.movementBlockerGeometryVersion = instance.movementBlockerGeometryVersion || "";
        placement.movementBlockedEdges = instance.movementBlockedEdges === null || instance.movementBlockedEdges === undefined
            ? null
            : normalizeMovementBlockedEdges(instance.movementBlockedEdges, `building placement ${placement.id} movementBlockedEdges`);
        placement.movementEdgeBlockerVersion = instance.movementEdgeBlockerVersion || "";
        placement.overlappedSectionKeys = normalizeSectionKeys(instance.touchedSectionKeys || instance.overlappedSectionKeys);
        placement.touchedSectionKeys = placement.overlappedSectionKeys.slice();
        placement.loadState = instance.loadState || placement.loadState || "unloaded";
        return placement;
    }

    function buildingLoadStateRank(loadState) {
        switch (loadState) {
            case "interior": return 4;
            case "loading-interior": return 3;
            case "shell": return 2;
            case "loading-shell": return 1;
            case "unloaded": return 0;
            case "error": return -1;
            default: return 0;
        }
    }

    function setPrototypeBuildingLoadState(state, placement, loadState) {
        if (!placement || typeof placement !== "object") {
            throw new Error("cannot set building load state without a placement");
        }
        const nextState = nonEmptyString(loadState, `building placement ${placement.id} loadState`);
        const previousState = typeof placement.loadState === "string" ? placement.loadState : "unloaded";
        if (
            nextState !== "error" &&
            previousState !== "error" &&
            buildingLoadStateRank(previousState) > buildingLoadStateRank(nextState)
        ) {
            return previousState;
        }
        placement.loadState = nextState;
        const instance = getBuildingInstanceRecord(state, placement);
        if (instance) instance.loadState = nextState;
        return nextState;
    }

    function normalizePrototypeWorldScope(scope) {
        if (scope === undefined || scope === null || scope === "sectionWorld") {
            return { type: "sectionWorld" };
        }
        if (typeof scope === "string") {
            return { type: "building", id: normalizePlacementId(scope, 0) };
        }
        if (!scope || typeof scope !== "object") {
            throw new Error("prototype world scope must be an object");
        }
        const type = String(scope.type || "").trim();
        if (type === "sectionWorld") return { type: "sectionWorld" };
        if (type === "building") {
            return { type: "building", id: normalizePlacementId(scope.id, 0) };
        }
        throw new Error(`unknown prototype world scope type: ${type || "(missing)"}`);
    }

    function samePrototypeWorldScope(a, b) {
        return !!(
            a &&
            b &&
            a.type === b.type &&
            (a.type !== "building" || a.id === b.id)
        );
    }

    function resolvePrototypeWorldScopeFromSupport(support) {
        if (!support || typeof support !== "object") return { type: "sectionWorld" };
        if (support.type === "floor") {
            const ownerType = typeof support.ownerType === "string" ? support.ownerType : "";
            const ownerId = typeof support.ownerId === "string" ? support.ownerId : "";
            const sectionKey = typeof support.sectionKey === "string" ? support.sectionKey : "";
            if (ownerType === "building" && ownerId) return { type: "building", id: normalizePlacementId(ownerId, 0) };
            if (sectionKey.startsWith("building:")) return { type: "building", id: normalizePlacementId(sectionKey, 0) };
            return { type: "sectionWorld" };
        }
        if (support.type === "stair") {
            const stairId = typeof support.stairId === "string" ? support.stairId : "";
            const marker = ":stair";
            const markerIndex = stairId.indexOf(marker);
            if (markerIndex > 0) {
                const buildingId = stairId.slice(0, markerIndex);
                if (buildingId.startsWith("building:")) return { type: "building", id: normalizePlacementId(buildingId, 0) };
            }
        }
        return { type: "sectionWorld" };
    }

    function isPrototypeWizardActor(actor, options = {}) {
        if (options && options.updateWorldScope === true) return true;
        if (options && options.actorIsWizard === true) return true;
        return typeof globalScope !== "undefined" && actor && actor === globalScope.wizard;
    }

    function collectPrototypeBuildingIdsFromSectionKeys(map, sectionKeys) {
        const state = map && map._prototypeBuildingState;
        const keys = sectionKeys instanceof Set ? Array.from(sectionKeys) : (Array.isArray(sectionKeys) ? sectionKeys : []);
        const out = new Set();
        if (!state || keys.length === 0) return out;
        let sawSectionRefs = false;
        for (let i = 0; i < keys.length; i++) {
            const sectionKey = String(keys[i] || "").trim();
            if (!sectionKey) continue;
            const asset = typeof map.getPrototypeSectionAsset === "function"
                ? map.getPrototypeSectionAsset(sectionKey)
                : (
                    map._prototypeSectionState && map._prototypeSectionState.sectionAssetsByKey instanceof Map
                        ? map._prototypeSectionState.sectionAssetsByKey.get(sectionKey)
                        : null
                );
            const refs = Array.isArray(asset && asset.buildingRefs) ? asset.buildingRefs : null;
            if (refs) {
                sawSectionRefs = true;
                for (let r = 0; r < refs.length; r++) {
                    const ref = refs[r];
                    const id = normalizePlacementId(ref && ref.id, r);
                    if (ref.shell === false) continue;
                    if (!(state.placementsById instanceof Map) || !state.placementsById.has(id)) {
                        throw new Error(`section ${sectionKey} references missing building ${id}`);
                    }
                    out.add(id);
                }
            }
        }
        if (sawSectionRefs) return out;
        for (let i = 0; i < keys.length; i++) {
            const sectionKey = String(keys[i] || "").trim();
            if (!sectionKey) continue;
            const ids = state.buildingIdsBySectionKey instanceof Map
                ? state.buildingIdsBySectionKey.get(sectionKey)
                : null;
            if (!(ids instanceof Set)) continue;
            ids.forEach((id) => out.add(id));
        }
        return out;
    }

    function normalizeBuildingPlacementIdSet(ids, state) {
        const rawIds = ids instanceof Set ? Array.from(ids) : (Array.isArray(ids) ? ids : []);
        const out = new Set();
        for (let i = 0; i < rawIds.length; i++) {
            const id = normalizePlacementId(rawIds[i], i);
            if (state && state.placementsById instanceof Map && !state.placementsById.has(id)) {
                throw new Error(`active building selection references missing placement ${id}`);
            }
            out.add(id);
        }
        return out;
    }

    function hashString(text) {
        let hash = 2166136261;
        const value = String(text || "");
        for (let i = 0; i < value.length; i++) {
            hash ^= value.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return (hash >>> 0).toString(16).padStart(8, "0");
    }

    function buildingDataSignature(buildingData) {
        return hashString(JSON.stringify(buildingData));
    }

    function deepCloneJson(value) {
        return JSON.parse(JSON.stringify(value));
    }

    function exteriorBitmapSettingsSignature(placement, options = {}, dataSignature = "") {
        const transform = placement && placement.transform ? placement.transform : {};
        const pixelsPerWorldUnit = Number.isFinite(Number(options.pixelsPerWorldUnit))
            ? Number(options.pixelsPerWorldUnit)
            : 72;
        const paddingPixels = Number.isFinite(Number(options.paddingPixels))
            ? Number(options.paddingPixels)
            : DEFAULT_PROTOTYPE_BUILDING_BITMAP_PADDING_PIXELS;
        const maxDimension = Number.isFinite(Number(options.maxDimension))
            ? Number(options.maxDimension)
            : DEFAULT_PROTOTYPE_BUILDING_BITMAP_MAX_DIMENSION;
        const pitch = Number.isFinite(Number(options.pitch))
            ? Number(options.pitch)
            : Math.PI / 4;
        return [
            EXTERIOR_BITMAP_RENDER_DATA_VERSION,
            String(placement && placement.id || ""),
            String(placement && placement.contentVersion || ""),
            Number(transform.rotation || 0).toFixed(6),
            pixelsPerWorldUnit.toFixed(3),
            paddingPixels,
            maxDimension,
            pitch.toFixed(6),
            String(dataSignature || "")
        ].join("|");
    }

    function interiorBitmapKey(placementId, floorId) {
        const id = normalizePlacementId(placementId, 0);
        const sourceFloorId = nonEmptyString(floorId, `building placement ${id} interior floorId`);
        return `${id}|${sourceFloorId}`;
    }

    function recordMoveObjectPerfEvent(name, data = null, elapsedMs = null) {
        if (
            typeof globalScope === "undefined" ||
            !globalScope.__moveObjectPerf ||
            typeof globalScope.__recordMoveObjectPerf !== "function"
        ) {
            return;
        }
        globalScope.__recordMoveObjectPerf(name, data, elapsedMs);
    }

    function getInteriorBitmapObjectExclusionSet(state, placementId, floorId, create = false) {
        if (!state || typeof state !== "object") return null;
        const key = interiorBitmapKey(placementId, floorId);
        if (!(state.interiorBitmapObjectExclusionsByKey instanceof Map)) {
            if (!create) return null;
            state.interiorBitmapObjectExclusionsByKey = new Map();
        }
        let set = state.interiorBitmapObjectExclusionsByKey.get(key) || null;
        if (!set && create) {
            set = new Set();
            state.interiorBitmapObjectExclusionsByKey.set(key, set);
        }
        return set;
    }

    function getInteriorBitmapObjectExclusionSignature(state, placementId, floorId) {
        const set = getInteriorBitmapObjectExclusionSet(state, placementId, floorId, false);
        if (!(set instanceof Set) || set.size === 0) return "";
        return Array.from(set)
            .map((recordId) => Number(recordId))
            .filter(Number.isInteger)
            .sort((a, b) => a - b)
            .join(",");
    }

    function invalidatePrototypeBuildingInteriorBitmapEntry(state, placementId, floorId) {
        if (!state || !(state.interiorBitmapsByKey instanceof Map)) return false;
        const key = interiorBitmapKey(placementId, floorId);
        if (state.pendingInteriorBitmapLoadsByKey instanceof Map) {
            state.pendingInteriorBitmapLoadsByKey.delete(key);
        }
        const entry = state.interiorBitmapsByKey.get(key) || null;
        if (!entry) return false;
        if (entry.status === "ready" && entry.texture) {
            entry.stale = true;
            entry.staleReason = "object-bake-membership";
            return true;
        }
        if (entry.status === "loading") {
            entry.stale = true;
            entry.staleReason = "object-bake-membership";
            return true;
        }
        destroyPrototypeBuildingBitmapEntry(entry);
        state.interiorBitmapsByKey.delete(key);
        return true;
    }

    function cloneBuildingDataWithoutInteriorBitmapExcludedObjects(state, placementId, floorId, buildingData) {
        const set = getInteriorBitmapObjectExclusionSet(state, placementId, floorId, false);
        if (!(set instanceof Set) || set.size === 0) return buildingData;
        if (!buildingData || typeof buildingData !== "object") {
            throw new Error(`building ${placementId} interior bitmap ${floorId} cannot apply object exclusions without building data`);
        }
        return buildingData;
    }

    function buildingDataFloorId(floor) {
        return String(floor && (floor.id || floor.fragmentId || floor.floorId) || "");
    }

    function buildingDataFloorLevel(floor) {
        const level = Number(floor && floor.level);
        if (Number.isFinite(level)) return Math.round(level);
        const elevation = Number(floor && floor.elevation);
        return Number.isFinite(elevation) ? Math.round(elevation / 3) : 0;
    }

    function buildingDataFloorBaseZ(floor) {
        const nodeBaseZ = Number(floor && floor.nodeBaseZ);
        if (Number.isFinite(nodeBaseZ)) return nodeBaseZ;
        const elevation = Number(floor && floor.elevation);
        if (Number.isFinite(elevation)) return elevation;
        throw new Error(`building interior object bake floor ${buildingDataFloorId(floor) || "(unknown)"} requires nodeBaseZ or elevation`);
    }

    function findBuildingDataFloor(buildingData, floorId) {
        const id = String(floorId || "");
        const floors = Array.isArray(buildingData && buildingData.floorFragments) ? buildingData.floorFragments : [];
        return floors.find((floor) => buildingDataFloorId(floor) === id) || null;
    }

    function lowerBuildingDataFloorIds(buildingData, sourceFloorId) {
        const source = findBuildingDataFloor(buildingData, sourceFloorId);
        if (!source) {
            throw new Error(`building interior bitmap references missing source floor ${sourceFloorId}`);
        }
        const sourceLevel = buildingDataFloorLevel(source);
        const floors = Array.isArray(buildingData && buildingData.floorFragments) ? buildingData.floorFragments : [];
        return floors
            .filter((floor) => buildingDataFloorLevel(floor) < sourceLevel)
            .sort((a, b) => buildingDataFloorLevel(a) - buildingDataFloorLevel(b))
            .map((floor) => buildingDataFloorId(floor))
            .filter((id) => id.length > 0);
    }

    function interiorBitmapSettingsSignature(placement, floorId, options = {}, dataSignature = "") {
        const transform = placement && placement.transform ? placement.transform : {};
        const pixelsPerWorldUnit = Number.isFinite(Number(options.pixelsPerWorldUnit))
            ? Number(options.pixelsPerWorldUnit)
            : 72;
        const paddingPixels = Number.isFinite(Number(options.paddingPixels))
            ? Number(options.paddingPixels)
            : DEFAULT_PROTOTYPE_BUILDING_BITMAP_PADDING_PIXELS;
        const maxDimension = Number.isFinite(Number(options.maxDimension))
            ? Number(options.maxDimension)
            : DEFAULT_PROTOTYPE_BUILDING_BITMAP_MAX_DIMENSION;
        const pitch = Number.isFinite(Number(options.pitch))
            ? Number(options.pitch)
            : Math.PI / 4;
        return [
            INTERIOR_BITMAP_RENDER_DATA_VERSION,
            String(placement && placement.id || ""),
            String(placement && placement.contentVersion || ""),
            String(floorId || ""),
            String(options.exclusionSignature || ""),
            String(options.bakeObjectSignature || ""),
            Number(transform.rotation || 0).toFixed(6),
            pixelsPerWorldUnit.toFixed(3),
            paddingPixels,
            maxDimension,
            pitch.toFixed(6),
            String(dataSignature || "")
        ].join("|");
    }

    function clampInteriorBitmapCameraPitch(value) {
        const pitch = Number(value);
        if (!Number.isFinite(pitch)) return BUILDING_BITMAP_CAMERA_DEFAULT_PITCH;
        return Math.max(BUILDING_BITMAP_CAMERA_MIN_PITCH, Math.min(BUILDING_BITMAP_CAMERA_MAX_PITCH, pitch));
    }

    function interiorBitmapCameraPitchProjectionFactors(camera) {
        const pitch = clampInteriorBitmapCameraPitch(camera && camera.pitch !== undefined ? camera.pitch : BUILDING_BITMAP_CAMERA_DEFAULT_PITCH);
        return {
            floor: Math.cos(pitch) / BUILDING_BITMAP_CAMERA_PITCH_BASE,
            height: Math.sin(pitch) / BUILDING_BITMAP_CAMERA_PITCH_BASE
        };
    }

    function rotateInteriorBitmapPointForCamera(point, camera) {
        const rotation = Number(camera && camera.rotation) || 0;
        if (Math.abs(rotation) < 0.000001) return { x: Number(point.x), y: Number(point.y) };
        const center = (camera && camera.rotationCenter) || { x: 0, y: 0 };
        const dx = Number(point.x) - Number(center.x || 0);
        const dy = Number(point.y) - Number(center.y || 0);
        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);
        return {
            x: Number(center.x || 0) + dx * cos - dy * sin,
            y: Number(center.y || 0) + dx * sin + dy * cos
        };
    }

    function buildingInteriorBitmapPointFromWorld(point, transform) {
        const worldX = Number(point && point.x);
        const worldY = Number(point && point.y);
        const tx = Number(transform && transform.x);
        const ty = Number(transform && transform.y);
        if (!Number.isFinite(worldX) || !Number.isFinite(worldY) || !Number.isFinite(tx) || !Number.isFinite(ty)) {
            throw new Error("building interior object bake requires finite placement transform and object position");
        }
        // Interior bitmap exports rotate the building model itself around the
        // local origin, so world object positions only need their placement
        // translation removed. Undoing rotation would put objects back into the
        // unrotated save coordinate space while the target floor bitmap is
        // already rotated.
        return {
            x: worldX - tx,
            y: worldY - ty
        };
    }

    function projectInteriorBitmapWorldPoint(result, x, y, z = 0, options = {}) {
        if (!result || !result.camera) {
            throw new Error("building interior object bake requires bitmap camera metadata");
        }
        const camera = result.camera;
        const width = Number(result.width);
        const height = Number(result.height);
        const zoom = Number(camera.zoom);
        if (!(width > 0) || !(height > 0) || !(zoom > 0)) {
            throw new Error("building interior object bake requires finite bitmap dimensions and zoom");
        }
        const cameraZ = Number.isFinite(Number(camera.z)) ? Number(camera.z) : 0;
        const rotated = options.skipCameraRotation === true
            ? { x: Number(x), y: Number(y) }
            : rotateInteriorBitmapPointForCamera({ x, y }, camera);
        const pitch = interiorBitmapCameraPitchProjectionFactors(camera);
        const projectedY = (rotated.y - Number(camera.y || 0)) * pitch.floor - (Number(z) - cameraZ) * pitch.height;
        return {
            x: (rotated.x - Number(camera.x || 0)) * zoom + width / 2,
            y: projectedY * zoom * BUILDING_BITMAP_GAME_XY_RATIO + height / 2
        };
    }

    function getInteriorBitmapBakeObjectRecordId(obj) {
        const id = Number(obj && obj._prototypeRecordId);
        return Number.isInteger(id) ? id : null;
    }

    function isInteriorBitmapBakeableFloorObject(obj) {
        if (!obj || obj.gone || obj.vanishing || obj._prototypeParked === true) return false;
        if (obj.visible === false) return false;
        if (obj.type === "powerup") return false;
        if (
            Number.isInteger(obj.mountedWallLineGroupId) ||
            Number.isInteger(obj.mountedSectionId) ||
            Number.isInteger(obj.mountedWallSectionUnitId)
        ) {
            return false;
        }
        if (obj.objectType === "placedObject" || obj.isPlacedObject === true) return true;
        return obj.type === "placedObject";
    }

    function getInteriorBitmapBakeObjectMembership(obj, options = {}) {
        const direct = obj && obj._floorMembership && typeof obj._floorMembership === "object"
            ? obj._floorMembership
            : (obj && obj.floorMembership && typeof obj.floorMembership === "object" ? obj.floorMembership : null);
        if (direct) return direct;
        const floorSupportApi = globalScope && globalScope.FloorSupport;
        if (floorSupportApi && typeof floorSupportApi.getEntityFloorMembership === "function") {
            return floorSupportApi.getEntityFloorMembership(obj, { map: options.map || null });
        }
        return null;
    }

    function getInteriorBitmapBakeObjectWorldZ(obj, options = {}) {
        const recordId = getInteriorBitmapBakeObjectRecordId(obj);
        const membership = getInteriorBitmapBakeObjectMembership(obj, options);
        const placementId = String(options.placementId || "");
        const sourceFloorId = String(options.floorId || "");
        if (
            !membership ||
            membership.ownerType !== "building" ||
            membership.ownerId !== placementId ||
            membership.floorId !== sourceFloorId
        ) {
            throw new Error(`building interior object bake record ${recordId} requires matching building floor membership`);
        }
        const buildingData = options.buildingData || null;
        const floor = findBuildingDataFloor(buildingData, sourceFloorId);
        if (!floor) {
            throw new Error(`building interior object bake record ${recordId} references missing source floor ${sourceFloorId}`);
        }
        const localZ = Number.isFinite(Number(obj && obj.z)) ? Number(obj.z) : 0;
        const hasAbsoluteZ = !!(
            obj &&
            (
                obj.zMode === "absolute" ||
                Number.isInteger(obj.mountedWallLineGroupId) ||
                Number.isInteger(obj.mountedSectionId) ||
                Number.isInteger(obj.mountedWallSectionUnitId)
            )
        );
        return hasAbsoluteZ ? localZ : buildingDataFloorBaseZ(floor) + localZ;
    }

    function interiorBitmapSpriteIntersectsTexture(sprite, textureWidth, textureHeight) {
        if (!sprite) return false;
        const x = Number(sprite.x);
        const y = Number(sprite.y);
        const width = Math.abs(Number(sprite.width) || 0);
        const height = Math.abs(Number(sprite.height) || 0);
        const anchorX = sprite.anchor && Number.isFinite(Number(sprite.anchor.x)) ? Number(sprite.anchor.x) : 0;
        const anchorY = sprite.anchor && Number.isFinite(Number(sprite.anchor.y)) ? Number(sprite.anchor.y) : 0;
        if (!Number.isFinite(x) || !Number.isFinite(y) || !(width > 0) || !(height > 0)) return false;
        const left = x - anchorX * width;
        const right = left + width;
        const top = y - anchorY * height;
        const bottom = top + height;
        return right > 0 && bottom > 0 && left < textureWidth && top < textureHeight;
    }

    function interiorBitmapProjectedQuadIntersectsTexture(points, textureWidth, textureHeight) {
        if (!Array.isArray(points) || points.length < 3) return false;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (let i = 0; i < points.length; i++) {
            const x = Number(points[i] && points[i].x);
            const y = Number(points[i] && points[i].y);
            if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
        }
        return maxX > 0 && maxY > 0 && minX < textureWidth && minY < textureHeight;
    }

    function isInteriorBitmapBakeObjectGroundPlane(obj) {
        return String(obj && obj.rotationAxis || "").trim().toLowerCase() === "ground";
    }

    function projectInteriorBitmapBakeObjectPoint(result, point, z, options = {}) {
        const localPoint = buildingInteriorBitmapPointFromWorld(point, options.placementTransform);
        return projectInteriorBitmapWorldPoint(result, localPoint.x, localPoint.y, z, {
            skipCameraRotation: true
        });
    }

    function flipInteriorBitmapBakePointY(point, textureHeight) {
        return {
            x: Number(point && point.x),
            y: Number(textureHeight) - Number(point && point.y)
        };
    }

    function createInteriorBitmapGroundPlaneMesh(pixi, texture, points, alpha, tint) {
        if (!pixi.Geometry || !pixi.Mesh || !pixi.MeshMaterial) {
            throw new Error("building interior ground object bake requires Pixi Geometry, Mesh, and MeshMaterial");
        }
        const geometry = new pixi.Geometry()
            .addAttribute("aVertexPosition", new Float32Array([
                points[0].x, points[0].y,
                points[1].x, points[1].y,
                points[2].x, points[2].y,
                points[3].x, points[3].y
            ]), 2)
            .addAttribute("aTextureCoord", new Float32Array([
                0, 1,
                1, 1,
                1, 0,
                0, 0
            ]), 2)
            .addIndex(new Uint16Array([0, 1, 2, 0, 2, 3]));
        const material = new pixi.MeshMaterial(texture);
        material.tint = tint;
        const mesh = new pixi.Mesh(
            geometry,
            material,
            undefined,
            pixi.DRAW_MODES ? pixi.DRAW_MODES.TRIANGLES : undefined
        );
        mesh.texture = texture;
        mesh.tint = tint;
        mesh.alpha = alpha;
        return mesh;
    }

    function getInteriorBitmapBakeObjectTexturePath(obj) {
        if (!obj || typeof obj !== "object") return "";
        if (typeof obj.texturePath === "string" && obj.texturePath.length > 0) return obj.texturePath;
        if (typeof obj.imagePath === "string" && obj.imagePath.length > 0) return obj.imagePath;
        if (obj.pixiSprite && obj.pixiSprite.texture && obj.pixiSprite.texture.textureCacheIds && obj.pixiSprite.texture.textureCacheIds[0]) {
            return obj.pixiSprite.texture.textureCacheIds[0];
        }
        return "";
    }

    function interiorBitmapBakeObjectSignature(obj) {
        const numberOrNull = (value) => Number.isFinite(Number(value)) ? Number(Number(value).toFixed(4)) : null;
        const membership = obj && obj._floorMembership && typeof obj._floorMembership === "object"
            ? obj._floorMembership
            : (obj && obj.floorMembership && typeof obj.floorMembership === "object" ? obj.floorMembership : null);
        return JSON.stringify({
            recordId: getInteriorBitmapBakeObjectRecordId(obj),
            type: typeof (obj && obj.type) === "string" ? obj.type : "",
            objectType: typeof (obj && obj.objectType) === "string" ? obj.objectType : "",
            category: typeof (obj && obj.category) === "string" ? obj.category : "",
            texturePath: getInteriorBitmapBakeObjectTexturePath(obj),
            x: numberOrNull(obj && obj.x),
            y: numberOrNull(obj && obj.y),
            z: numberOrNull(obj && obj.z),
            width: numberOrNull(obj && obj.width),
            height: numberOrNull(obj && obj.height),
            size: numberOrNull(obj && obj.size),
            anchorX: numberOrNull(obj && (Number.isFinite(obj.anchorX) ? obj.anchorX : obj.placeableAnchorX)),
            anchorY: numberOrNull(obj && (Number.isFinite(obj.anchorY) ? obj.anchorY : obj.placeableAnchorY)),
            traversalLayer: numberOrNull(obj && obj.traversalLayer),
            level: numberOrNull(obj && obj.level),
            rotationAxis: typeof (obj && obj.rotationAxis) === "string" ? obj.rotationAxis : "",
            placementRotation: numberOrNull(obj && obj.placementRotation),
            isOpen: obj && obj.isOpen === true,
            visible: !(obj && obj.visible === false),
            ownerType: membership && typeof membership.ownerType === "string" ? membership.ownerType : "",
            ownerId: membership && typeof membership.ownerId === "string" ? membership.ownerId : "",
            floorId: membership && typeof membership.floorId === "string" ? membership.floorId : ""
        });
    }

    function collectInteriorBitmapBakeObjects(map, state, placementId, floorId) {
        if (!map || typeof map.getObjectsForFloorMembership !== "function") {
            throw new Error("building interior object bake requires map.getObjectsForFloorMembership");
        }
        const membership = { ownerType: "building", ownerId: placementId, floorId };
        const objects = map.getObjectsForFloorMembership(membership);
        if (!Array.isArray(objects)) {
            throw new Error(`building interior object bake for ${placementId} floor ${floorId} expected floor object list`);
        }
        const exclusions = getInteriorBitmapObjectExclusionSet(state, placementId, floorId, false);
        const out = [];
        const seenRecords = new Set();
        const addCandidate = (obj) => {
            if (!isInteriorBitmapBakeableFloorObject(obj)) return;
            const recordId = getInteriorBitmapBakeObjectRecordId(obj);
            if (!Number.isInteger(recordId)) {
                const label = obj && (obj.scriptingName || obj.objectType || obj.type || obj.imageFileName || obj.texturePath) || "(unknown)";
                throw new Error(`building interior object bake for ${placementId} floor ${floorId} found bakeable object without prototype record id: ${label}`);
            }
            if (exclusions instanceof Set && exclusions.has(recordId)) return;
            if (obj._prototypeInteriorBitmapExcluded === true) return;
            if (seenRecords.has(recordId)) return;
            seenRecords.add(recordId);
            out.push(obj);
        };
        for (let i = 0; i < objects.length; i++) {
            addCandidate(objects[i]);
        }
        return out.sort((a, b) => {
            const ay = Number.isFinite(Number(a && a.y)) ? Number(a.y) : 0;
            const by = Number.isFinite(Number(b && b.y)) ? Number(b.y) : 0;
            if (ay !== by) return ay - by;
            return getInteriorBitmapBakeObjectRecordId(a) - getInteriorBitmapBakeObjectRecordId(b);
        });
    }

    function interiorBitmapBakeObjectsSignature(objects) {
        if (!Array.isArray(objects) || objects.length === 0) return "";
        return objects.map(interiorBitmapBakeObjectSignature).join("\n");
    }

    function collectInteriorBitmapBakeObjectTexturePaths(objects) {
        const paths = [];
        const seen = new Set();
        for (let i = 0; i < objects.length; i++) {
            const path = getInteriorBitmapBakeObjectTexturePath(objects[i]);
            if (!path || seen.has(path)) continue;
            seen.add(path);
            paths.push(path);
        }
        return paths;
    }

    async function loadInteriorBitmapBakeObjectTextures(objects) {
        const pixi = globalScope.PIXI || globalScope.PIXIJS || null;
        if (!pixi || !pixi.Texture) {
            throw new Error("building interior object bake texture preload requires PIXI.Texture");
        }
        const paths = collectInteriorBitmapBakeObjectTexturePaths(objects);
        if (paths.length === 0) return true;
        await Promise.all(paths.map((path) => {
            if (pixi.Assets && typeof pixi.Assets.load === "function") {
                return pixi.Assets.load(path);
            }
            const texture = pixi.Texture.from(path);
            const baseTexture = texture && texture.baseTexture;
            if (baseTexture && baseTexture.valid === true) return texture;
            if (!baseTexture || typeof baseTexture.once !== "function") {
                throw new Error(`building interior object bake could not preload texture ${path}`);
            }
            return new Promise((resolve, reject) => {
                const cleanup = () => {
                    if (typeof baseTexture.off === "function") {
                        baseTexture.off("loaded", onLoaded);
                        baseTexture.off("error", onError);
                    }
                };
                const onLoaded = () => {
                    cleanup();
                    resolve(texture);
                };
                const onError = (err) => {
                    cleanup();
                    reject(new Error(`building interior object bake failed to load texture ${path}: ${err && err.message ? err.message : err || "unknown error"}`));
                };
                baseTexture.once("loaded", onLoaded);
                baseTexture.once("error", onError);
            });
        }));
        return true;
    }

    function renderPixiDisplayObjectToTexture(rendererRef, displayObject, texture, clear = false) {
        if (!rendererRef || typeof rendererRef.render !== "function") {
            throw new Error("building interior object bake requires a Pixi renderer");
        }
        const gl = rendererRef.gl || null;
        const hadDepthTest = !!(gl && typeof gl.isEnabled === "function" && gl.isEnabled(gl.DEPTH_TEST));
        const previousDepthMask = gl && typeof gl.getParameter === "function" ? gl.getParameter(gl.DEPTH_WRITEMASK) : null;
        try {
            if (gl) {
                if (typeof gl.disable === "function") gl.disable(gl.DEPTH_TEST);
                if (typeof gl.depthMask === "function") gl.depthMask(false);
            }
            if (rendererRef.state && typeof rendererRef.state.reset === "function") {
                rendererRef.state.reset();
            }
            rendererRef.render(displayObject, texture, clear);
        } finally {
            if (gl) {
                if (typeof gl.depthMask === "function" && previousDepthMask !== null) gl.depthMask(!!previousDepthMask);
                if (typeof gl.enable === "function" && hadDepthTest) gl.enable(gl.DEPTH_TEST);
                if (typeof gl.disable === "function" && !hadDepthTest) gl.disable(gl.DEPTH_TEST);
            }
            if (rendererRef.state && typeof rendererRef.state.reset === "function") {
                rendererRef.state.reset();
            }
        }
    }

    function bakeInteriorBitmapFloorObjectsIntoTexture(result, objects, options = {}) {
        if (!Array.isArray(objects) || objects.length === 0) return [];
        const pixi = globalScope.PIXI || globalScope.PIXIJS || null;
        if (!pixi || !pixi.Container || !pixi.Sprite || !pixi.Texture) {
            throw new Error("building interior object bake requires PIXI Container, Sprite, and Texture");
        }
        if (!result || !result.texture) {
            throw new Error("building interior object bake requires a rendered bitmap texture");
        }
        const rendererRef = options.renderer || null;
        const container = new pixi.Container();
        const zoom = Number(result.camera && result.camera.zoom);
        if (!(zoom > 0)) {
            throw new Error("building interior object bake requires positive bitmap zoom");
        }
        const textureWidth = Number(result.width || (result.texture && result.texture.width));
        const textureHeight = Number(result.height || (result.texture && result.texture.height));
        if (!(textureWidth > 0) || !(textureHeight > 0)) {
            throw new Error("building interior object bake requires finite bitmap texture dimensions");
        }
        const bakedObjects = [];
        try {
            const orderedObjects = objects.slice().sort((a, b) => {
                const ag = isInteriorBitmapBakeObjectGroundPlane(a) ? 0 : 1;
                const bg = isInteriorBitmapBakeObjectGroundPlane(b) ? 0 : 1;
                if (ag !== bg) return ag - bg;
                const ay = Number.isFinite(Number(a && a.y)) ? Number(a.y) : 0;
                const by = Number.isFinite(Number(b && b.y)) ? Number(b.y) : 0;
                if (ay !== by) return ay - by;
                return getInteriorBitmapBakeObjectRecordId(a) - getInteriorBitmapBakeObjectRecordId(b);
            });
            for (let i = 0; i < orderedObjects.length; i++) {
                const obj = orderedObjects[i];
                const texturePath = getInteriorBitmapBakeObjectTexturePath(obj);
                if (!texturePath) {
                    throw new Error(`building interior object bake cannot resolve texture for record ${getInteriorBitmapBakeObjectRecordId(obj)}`);
                }
                const x = Number(obj && obj.x);
                const y = Number(obj && obj.y);
                const z = getInteriorBitmapBakeObjectWorldZ(obj, options);
                if (!Number.isFinite(x) || !Number.isFinite(y)) {
                    throw new Error(`building interior object bake requires finite position for record ${getInteriorBitmapBakeObjectRecordId(obj)}`);
                }
                const texture = pixi.Texture.from(texturePath);
                const anchorX = Number.isFinite(Number(obj && obj.anchorX))
                    ? Number(obj.anchorX)
                    : (Number.isFinite(Number(obj && obj.placeableAnchorX)) ? Number(obj.placeableAnchorX) : 0.5);
                const anchorY = Number.isFinite(Number(obj && obj.anchorY))
                    ? Number(obj.anchorY)
                    : (Number.isFinite(Number(obj && obj.placeableAnchorY)) ? Number(obj.placeableAnchorY) : 1);
                const worldWidth = Number.isFinite(Number(obj && obj.width)) ? Math.max(0.01, Number(obj.width)) : 1;
                const worldHeight = Number.isFinite(Number(obj && obj.height)) ? Math.max(0.01, Number(obj.height)) : worldWidth;
                const alpha = Number.isFinite(Number(obj && obj.billboardAlpha)) ? Math.max(0, Math.min(1, Number(obj.billboardAlpha))) : 1;
                const tint = Number.isFinite(Number(obj && obj.billboardTint)) ? Math.max(0, Math.min(0xffffff, Math.floor(Number(obj.billboardTint)))) : 0xffffff;
                if (isInteriorBitmapBakeObjectGroundPlane(obj)) {
                    const angleDeg = Number.isFinite(Number(obj && obj.placementRotation)) ? Number(obj.placementRotation) : 0;
                    const theta = angleDeg * (Math.PI / 180);
                    const cosT = Math.cos(theta);
                    const sinT = Math.sin(theta);
                    const leftOff = -anchorX * worldWidth;
                    const rightOff = (1 - anchorX) * worldWidth;
                    const nearOff = (1 - anchorY) * worldHeight;
                    const farOff = -anchorY * worldHeight;
                    const projectOffset = (xOff, yOff) => {
                        const dx = xOff * cosT - yOff * sinT;
                        const dy = xOff * sinT + yOff * cosT;
                        return flipInteriorBitmapBakePointY(projectInteriorBitmapBakeObjectPoint(
                            result,
                            { x: x + dx, y: y + dy },
                            z + INTERIOR_BITMAP_GROUND_PLANE_VISUAL_LIFT,
                            options
                        ), textureHeight);
                    };
                    const points = [
                        projectOffset(leftOff, nearOff),
                        projectOffset(rightOff, nearOff),
                        projectOffset(rightOff, farOff),
                        projectOffset(leftOff, farOff)
                    ];
                    if (!interiorBitmapProjectedQuadIntersectsTexture(points, textureWidth, textureHeight)) {
                        throw new Error(`building interior object bake record ${getInteriorBitmapBakeObjectRecordId(obj)} projected outside bitmap ${options.placementId || ""} floor ${options.floorId || ""}`);
                    }
                    container.addChild(createInteriorBitmapGroundPlaneMesh(pixi, texture, points, alpha, tint));
                    bakedObjects.push(obj);
                    continue;
                }
                const sprite = new pixi.Sprite(texture);
                sprite.anchor.set(anchorX, anchorY);
                sprite.alpha = alpha;
                sprite.tint = tint;
                const projected = flipInteriorBitmapBakePointY(
                    projectInteriorBitmapBakeObjectPoint(result, { x, y }, z, options),
                    textureHeight
                );
                sprite.x = projected.x;
                sprite.y = projected.y;
                sprite.width = worldWidth * zoom;
                sprite.height = worldHeight * zoom;
                if (!interiorBitmapSpriteIntersectsTexture(sprite, textureWidth, textureHeight)) {
                    throw new Error(`building interior object bake record ${getInteriorBitmapBakeObjectRecordId(obj)} projected outside bitmap ${options.placementId || ""} floor ${options.floorId || ""}`);
                }
                if (sprite.scale && Number.isFinite(Number(sprite.scale.y))) {
                    sprite.scale.y = -Math.abs(Number(sprite.scale.y));
                }
                container.addChild(sprite);
                bakedObjects.push(obj);
            }
            renderPixiDisplayObjectToTexture(rendererRef, container, result.texture, false);
        } finally {
            if (typeof container.destroy === "function") {
                container.destroy({ children: true, texture: false, baseTexture: false });
            }
        }
        return bakedObjects;
    }

    function destroyPrototypeBuildingBitmapEntry(entry) {
        if (
            entry &&
            entry.texture &&
            typeof entry.texture.destroy === "function"
        ) {
            entry.texture.destroy(true);
        }
        if (
            entry &&
            entry.depthMetricTexture &&
            typeof entry.depthMetricTexture.destroy === "function"
        ) {
            entry.depthMetricTexture.destroy(true);
        }
        if (entry && entry.lowerFloorsBitmap) {
            destroyPrototypeBuildingBitmapEntry(entry.lowerFloorsBitmap);
            entry.lowerFloorsBitmap = null;
        }
        if (entry && entry._replacedReadyEntry) {
            const replaced = entry._replacedReadyEntry;
            entry._replacedReadyEntry = null;
            destroyPrototypeBuildingBitmapEntry(replaced);
        }
    }

    async function fetchBuildingEditorSaveData(saveName) {
        const name = nonEmptyString(saveName, "buildingSaveName");
        const response = await fetch(`/api/building-editor/buildings/${encodeURIComponent(name)}`, { cache: "no-cache" });
        const payload = await response.json();
        if (!response.ok || !payload || !payload.ok || !payload.data) {
            throw new Error(`failed to load building save ${name}`);
        }
        assertValidBuildingEditorSave(payload.data, name);
        return payload.data;
    }

    function normalizeBuildingPlacementRecord(record, index = 0) {
        if (!record || typeof record !== "object" || Array.isArray(record)) {
            throw new Error(`building placement ${index} must be an object`);
        }
        const transform = record.transform && typeof record.transform === "object"
            ? record.transform
            : {};
        const sourceBuildingSaveName = String(
            record.buildingSaveName || record.sourceBuildingSaveName || record.name || record.id || ""
        ).trim();
        return {
            schema: BUILDING_PLACEMENT_SCHEMA,
            id: normalizePlacementId(record.id, index),
            buildingSaveName: nonEmptyString(sourceBuildingSaveName, `building placement ${index} buildingSaveName`),
            sourceBuildingSaveName,
            contentVersion: Number.isFinite(Number(record.contentVersion)) ? Number(record.contentVersion) : 1,
            transform: {
                x: finiteNumber(transform.x, `building placement ${index} transform.x`),
                y: finiteNumber(transform.y, `building placement ${index} transform.y`),
                rotation: Number.isFinite(Number(transform.rotation)) ? Number(transform.rotation) : 0
            },
            footprintPolygons: normalizeFootprintPolygons(record.footprintPolygons),
            movementBlockerPolygons: record.movementBlockerPolygons === undefined || record.movementBlockerPolygons === null
                ? null
                : normalizeMovementBlockerPolygons(record.movementBlockerPolygons),
            movementBlockerGeometryVersion: typeof record.movementBlockerGeometryVersion === "string"
                ? record.movementBlockerGeometryVersion
                : "",
            movementBlockedEdges: record.movementBlockedEdges === undefined || record.movementBlockedEdges === null
                ? null
                : normalizeMovementBlockedEdges(record.movementBlockedEdges, `building placement ${index} movementBlockedEdges`),
            movementEdgeBlockerVersion: typeof record.movementEdgeBlockerVersion === "string"
                ? record.movementEdgeBlockerVersion
                : "",
            overlappedSectionKeys: normalizeSectionKeys(record.overlappedSectionKeys),
            touchedSectionKeys: normalizeSectionKeys(record.touchedSectionKeys || record.overlappedSectionKeys),
            loadState: typeof record.loadState === "string" && record.loadState.length > 0
                ? record.loadState
                : "unloaded"
        };
    }

    function normalizeBuildingInstanceRecord(record, index = 0) {
        if (!record || typeof record !== "object" || Array.isArray(record)) {
            throw new Error(`building instance ${index} must be an object`);
        }
        assertValidBuildingEditorSave(record, record && (record.sourceBuildingSaveName || record.name || record.id));
        const instance = deepCloneJson(record);
        instance.schema = BUILDING_SAVE_SCHEMA;
        instance.id = normalizePlacementId(instance.id, index);
        const sourceName = String(
            instance.sourceBuildingSaveName || instance.buildingSaveName || instance.name || instance.id
        ).trim();
        instance.sourceBuildingSaveName = nonEmptyString(sourceName, `building instance ${index} sourceBuildingSaveName`);
        instance.buildingSaveName = instance.sourceBuildingSaveName;
        if (typeof instance.name !== "string" || instance.name.trim().length === 0) {
            instance.name = instance.sourceBuildingSaveName;
        }
        const transform = instance.transform && typeof instance.transform === "object" ? instance.transform : {};
        instance.transform = {
            x: finiteNumber(transform.x, `building instance ${instance.id} transform.x`),
            y: finiteNumber(transform.y, `building instance ${instance.id} transform.y`),
            rotation: Number.isFinite(Number(transform.rotation)) ? Number(transform.rotation) : 0
        };
        instance.footprintPolygons = normalizeFootprintPolygons(instance.footprintPolygons);
        instance.movementBlockerPolygons = instance.movementBlockerPolygons === undefined || instance.movementBlockerPolygons === null
            ? null
            : normalizeMovementBlockerPolygons(instance.movementBlockerPolygons);
        instance.movementBlockerGeometryVersion = typeof instance.movementBlockerGeometryVersion === "string"
            ? instance.movementBlockerGeometryVersion
            : "";
        instance.movementBlockedEdges = instance.movementBlockedEdges === undefined || instance.movementBlockedEdges === null
            ? null
            : normalizeMovementBlockedEdges(instance.movementBlockedEdges, `building instance ${instance.id} movementBlockedEdges`);
        instance.movementEdgeBlockerVersion = typeof instance.movementEdgeBlockerVersion === "string"
            ? instance.movementEdgeBlockerVersion
            : "";
        const touchedSectionKeys = normalizeSectionKeys(instance.touchedSectionKeys || instance.overlappedSectionKeys);
        instance.touchedSectionKeys = touchedSectionKeys;
        instance.overlappedSectionKeys = touchedSectionKeys.slice();
        instance.objects = Array.isArray(instance.objects) ? instance.objects : [];
        instance.animals = Array.isArray(instance.animals) ? instance.animals : [];
        instance.powerups = Array.isArray(instance.powerups) ? instance.powerups : [];
        instance.triggers = Array.isArray(instance.triggers) ? instance.triggers : [];
        instance.loadState = typeof instance.loadState === "string" && instance.loadState.length > 0
            ? instance.loadState
            : "unloaded";
        instance.contentVersion = Number.isFinite(Number(instance.contentVersion)) ? Number(instance.contentVersion) : 1;
        return instance;
    }

    function createPlacementFromBuildingInstance(instance, index = 0) {
        const normalized = normalizeBuildingInstanceRecord(instance, index);
        return normalizeBuildingPlacementRecord({
            schema: BUILDING_PLACEMENT_SCHEMA,
            id: normalized.id,
            buildingSaveName: normalized.sourceBuildingSaveName,
            sourceBuildingSaveName: normalized.sourceBuildingSaveName,
            contentVersion: normalized.contentVersion,
            transform: normalized.transform,
            footprintPolygons: normalized.footprintPolygons,
            movementBlockerPolygons: normalized.movementBlockerPolygons,
            movementBlockerGeometryVersion: normalized.movementBlockerGeometryVersion,
            movementBlockedEdges: normalized.movementBlockedEdges,
            movementEdgeBlockerVersion: normalized.movementEdgeBlockerVersion,
            overlappedSectionKeys: normalized.touchedSectionKeys,
            touchedSectionKeys: normalized.touchedSectionKeys,
            loadState: normalized.loadState
        }, index);
    }

    function createBuildingInstanceFromEditorSave(buildingData, placementRecord, options = {}) {
        assertValidBuildingEditorSave(buildingData, placementRecord && placementRecord.buildingSaveName);
        const placement = normalizeBuildingPlacementRecord(placementRecord, 0);
        const instance = deepCloneJson(buildingData);
        instance.schema = BUILDING_SAVE_SCHEMA;
        instance.id = placement.id;
        instance.name = typeof options.name === "string" && options.name.trim().length > 0
            ? options.name.trim()
            : placement.buildingSaveName;
        instance.sourceBuildingSaveName = placement.buildingSaveName;
        instance.buildingSaveName = placement.buildingSaveName;
        instance.transform = { ...placement.transform };
        instance.footprintPolygons = Array.isArray(options.footprintPolygons)
            ? normalizeFootprintPolygons(options.footprintPolygons)
            : computeBuildingPlacementFootprint(buildingData, placement);
        if (Array.isArray(options.movementBlockerPolygons)) {
            instance.movementBlockerPolygons = normalizeMovementBlockerPolygons(options.movementBlockerPolygons);
            instance.movementBlockerGeometryVersion = MOVEMENT_BLOCKER_GEOMETRY_VERSION;
        } else {
            instance.movementBlockerPolygons = computeBuildingPlacementMovementBlockerPolygons(buildingData, placement);
            instance.movementBlockerGeometryVersion = MOVEMENT_BLOCKER_GEOMETRY_VERSION;
        }
        instance.movementBlockedEdges = Array.isArray(options.movementBlockedEdges)
            ? normalizeMovementBlockedEdges(options.movementBlockedEdges, `building instance ${instance.id} movementBlockedEdges`)
            : null;
        instance.movementEdgeBlockerVersion = Array.isArray(instance.movementBlockedEdges)
            ? MOVEMENT_EDGE_BLOCKER_VERSION
            : "";
        instance.touchedSectionKeys = normalizeSectionKeys(options.touchedSectionKeys || placement.touchedSectionKeys || placement.overlappedSectionKeys);
        instance.overlappedSectionKeys = instance.touchedSectionKeys.slice();
        instance.objects = Array.isArray(options.objects) ? deepCloneJson(options.objects) : [];
        instance.animals = Array.isArray(options.animals) ? deepCloneJson(options.animals) : [];
        instance.powerups = Array.isArray(options.powerups) ? deepCloneJson(options.powerups) : [];
        instance.triggers = Array.isArray(options.triggers) ? deepCloneJson(options.triggers) : [];
        instance.loadState = typeof options.loadState === "string" ? options.loadState : "unloaded";
        instance.contentVersion = Number.isFinite(Number(options.contentVersion)) ? Number(options.contentVersion) : 1;
        return normalizeBuildingInstanceRecord(instance, 0);
    }

    function assertValidBuildingEditorSave(buildingData, saveName = "") {
        if (!buildingData || typeof buildingData !== "object" || Array.isArray(buildingData)) {
            throw new Error(`building save ${saveName || "(unnamed)"} must be an object`);
        }
        if (buildingData.schema !== BUILDING_SAVE_SCHEMA) {
            throw new Error(`building save ${saveName || "(unnamed)"} schema must be ${BUILDING_SAVE_SCHEMA}`);
        }
        if (!Array.isArray(buildingData.floorFragments)) {
            throw new Error(`building save ${saveName || "(unnamed)"} missing floorFragments`);
        }
        return true;
    }

    function transformPoint(point, transform) {
        const x = finiteNumber(point.x, "building footprint point x");
        const y = finiteNumber(point.y, "building footprint point y");
        const rotation = Number(transform.rotation) || 0;
        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);
        return {
            x: (x * cos) - (y * sin) + Number(transform.x),
            y: (x * sin) + (y * cos) + Number(transform.y)
        };
    }

    function transformPolygon(points, transform, label) {
        return normalizePolygon(points, label).map((point) => transformPoint(point, transform));
    }

    function getBuildingLayerBaseZ(floor, layer = 0) {
        if (hasFiniteNumericValue(floor && floor.nodeBaseZ)) return Number(floor.nodeBaseZ);
        if (hasFiniteNumericValue(floor && floor.elevation)) return Number(floor.elevation);
        const offset = hasFiniteNumericValue(floor && floor.nodeBaseZOffset)
            ? Number(floor.nodeBaseZOffset)
            : 0;
        if (offset !== 0) {
            throw new Error(`building floor layer ${layer} has nodeBaseZOffset without nodeBaseZ`);
        }
        throw new Error(`building floor layer ${layer} requires nodeBaseZ`);
    }

    function assignBuildingFloorRuntimeTraversalLayers(buildingData) {
        const floors = Array.isArray(buildingData && buildingData.floorFragments)
            ? buildingData.floorFragments
            : [];
        const ordered = floors
            .map((floor, index) => ({
                floor,
                index,
                baseZ: getBuildingLayerBaseZ(floor, index)
            }))
            .sort((a, b) => {
                if (a.baseZ !== b.baseZ) return a.baseZ - b.baseZ;
                return a.index - b.index;
            });
        const ordinalByFloor = new Map();
        for (let i = 0; i < ordered.length; i++) {
            ordinalByFloor.set(ordered[i].floor, i);
        }
        for (let i = 0; i < floors.length; i++) {
            const floor = floors[i];
            if (!floor || typeof floor !== "object") continue;
            const layer = ordinalByFloor.has(floor) ? ordinalByFloor.get(floor) : i;
            Object.defineProperty(floor, "_prototypeRuntimeTraversalLayer", {
                value: layer,
                writable: true,
                configurable: true,
                enumerable: false
            });
        }
    }

    function getBuildingFloorId(floor, fallback = "") {
        const id = floor && (floor.fragmentId || floor.surfaceId || floor.id || fallback);
        return String(id === undefined || id === null ? "" : id);
    }

    function getBuildingFloorLayer(floor) {
        const candidates = [];
        if (hasFiniteNumericValue(floor && floor._prototypeRuntimeTraversalLayer)) candidates.push(floor._prototypeRuntimeTraversalLayer);
        if (hasFiniteNumericValue(floor && floor.traversalLayer)) candidates.push(floor.traversalLayer);
        if (hasFiniteNumericValue(floor && floor.level)) candidates.push(floor.level);
        for (let i = 0; i < candidates.length; i++) {
            const value = Number(candidates[i]);
            if (Number.isFinite(value)) return Math.round(value);
        }
        return 0;
    }

    function pointFromWallEndpoint(endpoint, label) {
        if (!endpoint || typeof endpoint !== "object") {
            throw new Error(`${label} endpoint must be an object`);
        }
        return {
            x: finiteNumber(endpoint.x, `${label} x`),
            y: finiteNumber(endpoint.y, `${label} y`)
        };
    }

    function wallCenterlinePoints(wall) {
        if (wall && wall.startPoint && wall.endPoint) {
            return [
                pointFromWallEndpoint(wall.startPoint, `wall ${wall.id} startPoint`),
                pointFromWallEndpoint(wall.endPoint, `wall ${wall.id} endPoint`)
            ];
        }
        if (Array.isArray(wall && wall.points) && wall.points.length >= 2) {
            return [
                clonePoint(wall.points[0], `wall ${wall.id} point 0`),
                clonePoint(wall.points[wall.points.length - 1], `wall ${wall.id} point 1`)
            ];
        }
        if (wall && wall.resolvedGeometry && wall.resolvedGeometry.profile) {
            const profile = wall.resolvedGeometry.profile;
            const aLeft = clonePoint(profile.aLeft, `wall ${wall.id} profile aLeft`);
            const aRight = clonePoint(profile.aRight, `wall ${wall.id} profile aRight`);
            const bLeft = clonePoint(profile.bLeft, `wall ${wall.id} profile bLeft`);
            const bRight = clonePoint(profile.bRight, `wall ${wall.id} profile bRight`);
            return [
                { x: (aLeft.x + aRight.x) * 0.5, y: (aLeft.y + aRight.y) * 0.5 },
                { x: (bLeft.x + bRight.x) * 0.5, y: (bLeft.y + bRight.y) * 0.5 }
            ];
        }
        throw new Error(`wall ${wall && wall.id} movement blocker requires two endpoints`);
    }

    function wallMovementBlockerIntervals(buildingData, wall, length) {
        const intervals = [{ start: 0, end: length }];
        const mountedObjects = Array.isArray(buildingData && buildingData.mountedWallObjects)
            ? buildingData.mountedWallObjects
            : [];
        const wallId = String(wall && wall.id);
        const doorIntervals = mountedObjects
            .filter((object) => (
                object &&
                String(object.wallId) === wallId &&
                String(object.category || "").trim().toLowerCase() === "doors" &&
                object.isPassable !== false
            ))
            .map((object) => {
                const width = Number(object.width);
                const wallT = Number(object.wallT);
                if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(wallT)) {
                    throw new Error(`door ${object && object.id} on wall ${wall && wall.id} requires finite wallT and width`);
                }
                const center = Math.max(0, Math.min(1, wallT)) * length;
                return {
                    start: Math.max(0, center - width * 0.5),
                    end: Math.min(length, center + width * 0.5)
                };
            })
            .filter((interval) => interval.end > interval.start)
            .sort((a, b) => a.start - b.start);

        doorIntervals.forEach((door) => {
            for (let i = intervals.length - 1; i >= 0; i--) {
                const solid = intervals[i];
                if (door.end <= solid.start || door.start >= solid.end) continue;
                const replacement = [];
                if (door.start > solid.start) replacement.push({ start: solid.start, end: door.start });
                if (door.end < solid.end) replacement.push({ start: door.end, end: solid.end });
                intervals.splice(i, 1, ...replacement);
            }
        });
        return intervals.filter((interval) => interval.end - interval.start > 0.000001);
    }

    function wallSegmentPolygon(start, end, thickness) {
        const dx = Number(end.x) - Number(start.x);
        const dy = Number(end.y) - Number(start.y);
        const length = Math.hypot(dx, dy);
        if (!(length > 0.000001)) {
            throw new Error("wall movement blocker segment requires non-coincident endpoints");
        }
        const halfThickness = Math.max(0.001, Number(thickness) || 0.25) * 0.5;
        const nx = -dy / length;
        const ny = dx / length;
        return [
            { x: start.x + nx * halfThickness, y: start.y + ny * halfThickness },
            { x: end.x + nx * halfThickness, y: end.y + ny * halfThickness },
            { x: end.x - nx * halfThickness, y: end.y - ny * halfThickness },
            { x: start.x - nx * halfThickness, y: start.y - ny * halfThickness }
        ];
    }

    function wallMovementBlockerPolygons(buildingData, wall) {
        const points = wallCenterlinePoints(wall);
        const start = points[0];
        const end = points[1];
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const length = Math.hypot(dx, dy);
        if (!(length > 0.000001)) {
            throw new Error(`wall ${wall && wall.id} movement blocker requires non-coincident endpoints`);
        }
        const ux = dx / length;
        const uy = dy / length;
        const intervals = wallMovementBlockerIntervals(buildingData, wall, length);
        return intervals.map((interval) => wallSegmentPolygon(
            { x: start.x + ux * interval.start, y: start.y + uy * interval.start },
            { x: start.x + ux * interval.end, y: start.y + uy * interval.end },
            Number(wall && wall.thickness)
        ));
    }

    function columnMovementBlockerPolygon(column) {
        const cx = finiteNumber(column && column.position && column.position.x, `column ${column && column.id} x`);
        const cy = finiteNumber(column && column.position && column.position.y, `column ${column && column.id} y`);
        const sideCount = Math.max(3, Math.min(12, Math.round(Number(column && column.sideCount) || 4)));
        const legacySize = Number(column && column.size) || 0.125;
        const width = Number.isFinite(Number(column && column.width)) && Number(column.width) > 0
            ? Number(column.width)
            : legacySize * 2;
        const depth = Number.isFinite(Number(column && column.depth)) && Number(column.depth) > 0
            ? Number(column.depth)
            : legacySize * 2;
        if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(depth) || depth <= 0) {
            throw new Error(`column ${column && column.id} movement blocker requires positive width and depth`);
        }
        const rotation = Number(column && column.rotation) || 0;
        const scale = 1 / Math.cos(Math.PI / sideCount);
        const points = [];
        for (let i = 0; i < sideCount; i++) {
            const angle = Math.PI / sideCount + (i * 2 * Math.PI) / sideCount;
            const localX = (width * 0.5 * scale) * Math.cos(angle);
            const localY = (depth * 0.5 * scale) * Math.sin(angle);
            points.push({
                x: cx + localX * Math.cos(rotation) - localY * Math.sin(rotation),
                y: cy + localX * Math.sin(rotation) + localY * Math.cos(rotation)
            });
        }
        return points;
    }

    function buildingElementBottomZ(floor, layer, element) {
        if (Number.isFinite(Number(element && element.bottomZ))) return Number(element.bottomZ);
        return getBuildingLayerBaseZ(floor, layer);
    }

    function buildingElementHeight(floor, element) {
        const height = Number(element && element.height);
        if (Number.isFinite(height) && height > 0) return height;
        const floorDefaultWallHeight = Number(floor && floor.defaultWallHeight);
        if (Number.isFinite(floorDefaultWallHeight) && floorDefaultWallHeight > 0) return floorDefaultWallHeight;
        const floorHeight = Number(floor && floor.floorHeight);
        if (Number.isFinite(floorHeight) && floorHeight > 0) return floorHeight;
        return DEFAULT_BUILDING_WALL_HEIGHT;
    }

    function computeBuildingPlacementMovementBlockerPolygons(buildingData, placementRecord) {
        assertValidBuildingEditorSave(buildingData, placementRecord && placementRecord.buildingSaveName);
        assignBuildingFloorRuntimeTraversalLayers(buildingData);
        const placement = normalizeBuildingPlacementRecord(placementRecord);
        const floorIdsByLayer = new Map();
        const floorsById = new Map();
        const floors = Array.isArray(buildingData.floorFragments) ? buildingData.floorFragments : [];
        for (let i = 0; i < floors.length; i++) {
            const floor = floors[i];
            const floorId = getBuildingFloorId(floor, i);
            if (!floorId) throw new Error(`building save floor ${i} missing floor id`);
            floorIdsByLayer.set(floorId, getBuildingFloorLayer(floor));
            floorsById.set(floorId, floor);
        }
        const localEntries = [];
        const walls = Array.isArray(buildingData.wallSections) ? buildingData.wallSections : [];
        for (let i = 0; i < walls.length; i++) {
            const wall = walls[i];
            const wallFloorId = String(wall && (wall.fragmentId || wall.floorId) || "");
            const ownerFloor = floorsById.get(wallFloorId) || null;
            const sourceFloorId = ownerFloor ? getBuildingFloorId(ownerFloor, wallFloorId) : wallFloorId;
            const fragmentId = sourceFloorId ? `${placement.id}:floor:${sourceFloorId}` : "";
            const surfaceId = sourceFloorId ? `${placement.id}:surface:${String(ownerFloor && ownerFloor.surfaceId || sourceFloorId)}` : "";
            const layer = floorIdsByLayer.has(wallFloorId)
                ? floorIdsByLayer.get(wallFloorId)
                : (Number.isFinite(Number(wall && wall.traversalLayer)) ? Math.round(Number(wall.traversalLayer)) : 0);
            const bottomZ = buildingElementBottomZ(ownerFloor, layer, wall);
            const height = buildingElementHeight(ownerFloor, wall);
            const polygons = wallMovementBlockerPolygons(buildingData, wall);
            for (let p = 0; p < polygons.length; p++) {
                localEntries.push({
                    polygon: polygons[p],
                    level: layer,
                    traversalLayer: layer,
                    bottomZ,
                    height,
                    surfaceId,
                    fragmentId,
                    floorId: sourceFloorId,
                    sourceFloorId
                });
            }
        }
        for (let i = 0; i < floors.length; i++) {
            const floor = floors[i];
            const floorLayer = getBuildingFloorLayer(floor);
            const sourceFloorId = getBuildingFloorId(floor, i);
            const fragmentId = `${placement.id}:floor:${sourceFloorId}`;
            const surfaceId = `${placement.id}:surface:${String(floor && floor.surfaceId || sourceFloorId)}`;
            const columns = Array.isArray(floor && floor.columns) ? floor.columns : [];
            for (let c = 0; c < columns.length; c++) {
                const column = columns[c];
                const layer = floorLayer;
                localEntries.push({
                    polygon: columnMovementBlockerPolygon(column),
                    level: layer,
                    traversalLayer: layer,
                    bottomZ: buildingElementBottomZ(floor, layer, column),
                    height: buildingElementHeight(floor, column),
                    surfaceId,
                    fragmentId,
                    floorId: sourceFloorId,
                    sourceFloorId
                });
            }
        }
        return localEntries.map((entry, index) => ({
            polygon: normalizePolygon(
                entry.polygon.map((point) => transformPoint(point, placement.transform)),
                `building placement ${placement.id} movement blocker ${index}`
            ),
            level: entry.level,
            traversalLayer: entry.traversalLayer,
            bottomZ: entry.bottomZ,
            height: entry.height,
            surfaceId: entry.surfaceId,
            fragmentId: entry.fragmentId,
            floorId: entry.floorId,
            sourceFloorId: entry.sourceFloorId
        }));
    }

    function setPlacementMovementBlockerPolygons(placement, polygons) {
        if (!placement || typeof placement !== "object") {
            throw new Error("cannot assign movement blocker geometry without a placement");
        }
        placement.movementBlockerPolygons = normalizeMovementBlockerPolygons(
            polygons,
            `building placement ${placement.id} movementBlockerPolygons`
        );
        placement.movementBlockerGeometryVersion = MOVEMENT_BLOCKER_GEOMETRY_VERSION;
        placement.movementBlockedEdges = null;
        placement.movementEdgeBlockerVersion = "";
        return placement.movementBlockerPolygons;
    }

    function setPlacementMovementBlockedEdges(placement, edges) {
        if (!placement || typeof placement !== "object") {
            throw new Error("cannot assign movement edge blockers without a placement");
        }
        placement.movementBlockedEdges = normalizeMovementBlockedEdges(
            edges,
            `building placement ${placement.id} movementBlockedEdges`
        );
        placement.movementEdgeBlockerVersion = MOVEMENT_EDGE_BLOCKER_VERSION;
        return placement.movementBlockedEdges;
    }

    function placementHasCurrentMovementBlockerGeometry(placement) {
        return !!(
            placement &&
            Array.isArray(placement.movementBlockerPolygons) &&
            placement.movementBlockerGeometryVersion === MOVEMENT_BLOCKER_GEOMETRY_VERSION
        );
    }

    function computeBuildingPlacementFootprint(buildingData, placementRecord) {
        assertValidBuildingEditorSave(buildingData, placementRecord && placementRecord.buildingSaveName);
        const placement = normalizeBuildingPlacementRecord(placementRecord);
        const polygons = [];
        for (let i = 0; i < buildingData.floorFragments.length; i++) {
            const floor = buildingData.floorFragments[i];
            const floorId = floor && (floor.fragmentId || floor.surfaceId || i);
            const outer = normalizePolygon(floor && floor.outerPolygon, `building save floor ${floorId} outerPolygon`);
            polygons.push(outer.map((point) => transformPoint(point, placement.transform)));
        }
        if (polygons.length === 0) {
            throw new Error(`building placement ${placement.id} has no footprint polygons`);
        }
        return polygons;
    }

    function pointsNearlyEqual(a, b, epsilon = 0.000001) {
        return !!(
            a &&
            b &&
            Math.abs(Number(a.x) - Number(b.x)) <= epsilon &&
            Math.abs(Number(a.y) - Number(b.y)) <= epsilon
        );
    }

    function buildWallLoopPolygon(walls, label) {
        const source = Array.isArray(walls) ? walls : [];
        const segments = source.map((wall) => {
            const points = wallCenterlinePoints(wall);
            return { start: points[0], end: points[1], wall };
        });
        if (segments.length < 3) return null;
        const remaining = segments.slice(1);
        const first = segments[0].start;
        const points = [segments[0].start];
        let current = segments[0].end;
        while (remaining.length > 0) {
            let nextIndex = -1;
            let reversed = false;
            for (let i = 0; i < remaining.length; i++) {
                if (pointsNearlyEqual(remaining[i].start, current)) {
                    nextIndex = i;
                    reversed = false;
                    break;
                }
                if (pointsNearlyEqual(remaining[i].end, current)) {
                    nextIndex = i;
                    reversed = true;
                    break;
                }
            }
            if (nextIndex < 0) return null;
            const next = remaining.splice(nextIndex, 1)[0];
            points.push(current);
            current = reversed ? next.start : next.end;
        }
        if (!pointsNearlyEqual(current, first)) return null;
        const normalized = normalizePolygon(points, `${label} wall loop`);
        return normalized.length >= 3 ? normalized : null;
    }

    function computeInteriorPolygonsByFloor(buildingData, placement) {
        const walls = Array.isArray(buildingData && buildingData.wallSections)
            ? buildingData.wallSections
            : [];
        const floors = Array.isArray(buildingData && buildingData.floorFragments)
            ? buildingData.floorFragments
            : [];
        const out = new Map();
        for (let i = 0; i < floors.length; i++) {
            const floor = floors[i];
            const floorId = getBuildingFloorId(floor, i);
            const floorWalls = walls.filter((wall) => String(wall && (wall.fragmentId || wall.floorId) || "") === floorId);
            const perimeterWalls = floorWalls.filter((wall) => String(wall && wall.role || "").trim().toLowerCase() === "perimeter");
            const loop = buildWallLoopPolygon(
                perimeterWalls.length >= 3 ? perimeterWalls : floorWalls,
                `building placement ${placement.id} floor ${floorId}`
            );
            if (loop) {
                out.set(floorId, loop.map((point) => transformPoint(point, placement.transform)));
            }
        }
        return out;
    }

    function createPrototypeBuildingFragment(placement, floor, index, interiorPolygonsByFloor = null) {
        const sourceFloorId = getBuildingFloorId(floor, index);
        if (!sourceFloorId) throw new Error(`building placement ${placement.id} floor ${index} missing floor id`);
        const layer = getBuildingFloorLayer(floor);
        const baseZ = getBuildingLayerBaseZ(floor, layer);
        const fragmentId = `${placement.id}:floor:${sourceFloorId}`;
        const surfaceId = `${placement.id}:surface:${String(floor && floor.surfaceId || sourceFloorId)}`;
        const holes = [];
        const sourceHoles = Array.isArray(floor && floor.holes) ? floor.holes : [];
        for (let h = 0; h < sourceHoles.length; h++) {
            holes.push(transformPolygon(sourceHoles[h], placement.transform, `building placement ${placement.id} floor ${sourceFloorId} hole ${h}`));
        }
        return {
            ...(floor || {}),
            fragmentId,
            surfaceId,
            ownerSectionKey: placement.id,
            ownerType: "building",
            ownerId: placement.id,
            level: layer,
            nodeBaseZ: baseZ,
            outerPolygon: interiorPolygonsByFloor instanceof Map && interiorPolygonsByFloor.has(sourceFloorId)
                ? normalizePolygon(interiorPolygonsByFloor.get(sourceFloorId), `building placement ${placement.id} floor ${sourceFloorId} interiorPolygon`)
                : transformPolygon(floor && floor.outerPolygon, placement.transform, `building placement ${placement.id} floor ${sourceFloorId} outerPolygon`),
            holes,
            renderedByBuildingCutaway: true,
            _prototypeBuildingPlacementId: placement.id,
            _prototypeBuildingSourceFragmentId: sourceFloorId
        };
    }

    function createPrototypeBuildingWallItem(placement, wall, sourceFloorToFragmentId, sourceFloorToLayer, sourceFloorToFloor, index) {
        const wallId = String(wall && wall.id);
        if (!wallId) throw new Error(`building placement ${placement.id} wall ${index} missing wall id`);
        const points = wallCenterlinePoints(wall);
        const sourceFloorId = String(wall && (wall.fragmentId || wall.floorId) || "");
        const fragmentId = sourceFloorToFragmentId.get(sourceFloorId) || "";
        const ownerFloor = sourceFloorToFloor instanceof Map ? sourceFloorToFloor.get(sourceFloorId) || null : null;
        const layer = sourceFloorToLayer instanceof Map && sourceFloorToLayer.has(sourceFloorId)
            ? sourceFloorToLayer.get(sourceFloorId)
            : (Number.isFinite(Number(wall && wall.traversalLayer)) ? Math.round(Number(wall.traversalLayer)) : 0);
        return {
            ...(wall || {}),
            type: "wallSection",
            id: `${placement.id}:wall:${wallId}`,
            sourceWallId: wallId,
            map: null,
            fragmentId,
            surfaceId: fragmentId,
            startPoint: transformPoint(points[0], placement.transform),
            endPoint: transformPoint(points[1], placement.transform),
            bottomZ: buildingElementBottomZ(ownerFloor, layer, wall),
            traversalLayer: layer,
            level: layer,
            gone: false,
            vanishing: false,
            visible: true,
            _prototypeBuildingPlacementId: placement.id
        };
    }

    function createPrototypeBuildingDoorItem(placement, object, wall, wallItem, index) {
        const doorId = String(object && object.id);
        if (!doorId) throw new Error(`building placement ${placement.id} door ${index} missing door id`);
        const width = Number(object && object.width);
        const wallT = Number(object && object.wallT);
        if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(wallT)) {
            throw new Error(`building placement ${placement.id} door ${doorId} requires finite wallT and width`);
        }
        const points = wallCenterlinePoints(wall);
        const start = points[0];
        const end = points[1];
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const length = Math.hypot(dx, dy);
        if (!(length > 0.000001)) {
            throw new Error(`building placement ${placement.id} door ${doorId} requires a non-coincident wall`);
        }
        const ux = dx / length;
        const uy = dy / length;
        const nx = -uy;
        const ny = ux;
        const centerLocal = {
            x: start.x + dx * Math.max(0, Math.min(1, wallT)),
            y: start.y + dy * Math.max(0, Math.min(1, wallT))
        };
        const thickness = Math.max(0.001, Number(wall && wall.thickness) || 0.25);
        const frontLocal = {
            x: centerLocal.x + nx * thickness * 0.55,
            y: centerLocal.y + ny * thickness * 0.55
        };
        const backLocal = {
            x: centerLocal.x - nx * thickness * 0.55,
            y: centerLocal.y - ny * thickness * 0.55
        };
        const center = transformPoint(centerLocal, placement.transform);
        return {
            ...(object || {}),
            type: "door",
            category: "doors",
            id: `${placement.id}:door:${doorId}`,
            sourceObjectId: doorId,
            sourceWallId: String(wall && wall.id),
            map: null,
            x: center.x,
            y: center.y,
            z: Number.isFinite(Number(object && object.z)) ? Number(object.z) : 0,
            width,
            height: Number.isFinite(Number(object && object.height)) ? Number(object.height) : 3,
            rotationAxis: "spatial",
            placementRotation: Number.isFinite(Number(object && object.placementRotation)) ? Number(object.placementRotation) : 0,
            mountedWallSectionUnitId: null,
            mountedSectionId: null,
            mountedWallLineGroupId: null,
            _prototypeMountedWallSection: wallItem,
            depthBillboardFaceCenters: {
                front: transformPoint(frontLocal, placement.transform),
                back: transformPoint(backLocal, placement.transform)
            },
            traversalLayer: Number.isFinite(Number(wallItem && wallItem.traversalLayer)) ? Number(wallItem.traversalLayer) : 0,
            level: Number.isFinite(Number(wallItem && wallItem.level)) ? Number(wallItem.level) : 0,
            gone: false,
            vanishing: false,
            visible: true,
            _prototypeBuildingPlacementId: placement.id
        };
    }

    function createPrototypeBuildingCutawayRecord(buildingData, placementRecord) {
        assertValidBuildingEditorSave(buildingData, placementRecord && placementRecord.buildingSaveName);
        assignBuildingFloorRuntimeTraversalLayers(buildingData);
        const placement = normalizeBuildingPlacementRecord(placementRecord);
        const fragments = [];
        const sourceFloorToFragmentId = new Map();
        const sourceFloorToLayer = new Map();
        const sourceFloorToFloor = new Map();
        const interiorPolygonsByFloor = computeInteriorPolygonsByFloor(buildingData, placement);
        for (let i = 0; i < buildingData.floorFragments.length; i++) {
            const floor = buildingData.floorFragments[i];
            const fragment = createPrototypeBuildingFragment(placement, floor, i, interiorPolygonsByFloor);
            fragments.push(fragment);
            const sourceFloorId = getBuildingFloorId(floor, i);
            sourceFloorToFragmentId.set(sourceFloorId, fragment.fragmentId);
            sourceFloorToLayer.set(sourceFloorId, fragment.level);
            sourceFloorToFloor.set(sourceFloorId, floor);
        }
        if (fragments.length === 0) {
            throw new Error(`building placement ${placement.id} has no cutaway floor fragments`);
        }

        const renderItems = [];
        const wallItemsBySourceId = new Map();
        const walls = Array.isArray(buildingData.wallSections) ? buildingData.wallSections : [];
        for (let i = 0; i < walls.length; i++) {
            const wall = walls[i];
            const wallItem = createPrototypeBuildingWallItem(placement, wall, sourceFloorToFragmentId, sourceFloorToLayer, sourceFloorToFloor, i);
            wallItemsBySourceId.set(String(wall && wall.id), wallItem);
            renderItems.push({
                item: wallItem,
                level: wallItem.level,
                refs: wallItem.fragmentId ? [{ fragmentId: wallItem.fragmentId, surfaceId: wallItem.surfaceId || wallItem.fragmentId }] : []
            });
        }

        const mountedObjects = Array.isArray(buildingData.mountedWallObjects) ? buildingData.mountedWallObjects : [];
        for (let i = 0; i < mountedObjects.length; i++) {
            const object = mountedObjects[i];
            if (!object || String(object.category || "").trim().toLowerCase() !== "doors") continue;
            if (object.isPassable === false) continue;
            const wallId = String(object.wallId || object.mountedSectionId || object.mountedWallSectionUnitId || object.mountedWallLineGroupId || "");
            const wall = walls.find((candidate) => String(candidate && candidate.id) === wallId);
            const wallItem = wallItemsBySourceId.get(wallId);
            if (!wall || !wallItem) {
                throw new Error(`building placement ${placement.id} door ${object.id} references missing wall ${wallId}`);
            }
            const doorItem = createPrototypeBuildingDoorItem(placement, object, wall, wallItem, i);
            renderItems.push({
                item: doorItem,
                level: doorItem.level,
                refs: wallItem.fragmentId ? [{ fragmentId: wallItem.fragmentId, surfaceId: wallItem.surfaceId || wallItem.fragmentId }] : []
            });
        }

        for (let i = 0; i < buildingData.floorFragments.length; i++) {
            const floor = buildingData.floorFragments[i];
            const sourceFloorId = getBuildingFloorId(floor, i);
            const stairs = Array.isArray(floor && floor.stairs) ? floor.stairs : [];
            for (let s = 0; s < stairs.length; s++) {
                renderItems.push(createPrototypeBuildingStairRenderItem(floor, stairs[s], s, placement, fragments, sourceFloorId));
            }
        }

        let minLevel = Infinity;
        let maxLevel = -Infinity;
        let minBaseZ = Infinity;
        let maxTopZ = -Infinity;
        const fragmentIds = new Set();
        const surfaceIds = new Set();
        for (let i = 0; i < fragments.length; i++) {
            const level = getBuildingFloorLayer(fragments[i]);
            const baseZ = getBuildingLayerBaseZ(fragments[i], level);
            const floorHeight = Number.isFinite(Number(fragments[i].floorHeight)) && Number(fragments[i].floorHeight) > 0
                ? Number(fragments[i].floorHeight)
                : DEFAULT_BUILDING_WALL_HEIGHT;
            minLevel = Math.min(minLevel, level);
            maxLevel = Math.max(maxLevel, level);
            minBaseZ = Math.min(minBaseZ, baseZ);
            maxTopZ = Math.max(maxTopZ, baseZ + floorHeight);
            fragmentIds.add(fragments[i].fragmentId);
            surfaceIds.add(fragments[i].surfaceId);
        }
        for (let i = 0; i < renderItems.length; i++) {
            const item = renderItems[i] && renderItems[i].item;
            if (!item) continue;
            const bottomZ = Number.isFinite(Number(item.bottomZ))
                ? Number(item.bottomZ)
                : (Number.isFinite(Number(item.z)) ? Number(item.z) : null);
            const height = Number.isFinite(Number(item.height)) && Number(item.height) > 0
                ? Number(item.height)
                : 0;
            if (bottomZ !== null) {
                minBaseZ = Math.min(minBaseZ, bottomZ);
                maxTopZ = Math.max(maxTopZ, bottomZ + height);
            }
        }
        if (!Number.isFinite(minLevel) || !Number.isFinite(maxLevel)) {
            throw new Error(`building placement ${placement.id} cutaway record has invalid floor levels`);
        }
        if (!Number.isFinite(minBaseZ) || !Number.isFinite(maxTopZ)) {
            throw new Error(`building placement ${placement.id} cutaway record has invalid physical z bounds`);
        }

        const building = {
            buildingId: placement.id,
            placementId: placement.id,
            buildingSaveName: placement.buildingSaveName,
            minLevel,
            maxLevel,
            minBaseZ,
            maxTopZ,
            fragmentIds,
            surfaceIds,
            fragments,
            staticObjects: renderItems,
            fragmentGraph: new Map(),
            renderCache: null,
            _prototypeBuildingPlacement: placement
        };
        for (let i = 0; i < renderItems.length; i++) {
            if (renderItems[i] && renderItems[i].item) renderItems[i].item.map = null;
        }
        return building;
    }

    function pointInRing(point, ring) {
        const x = Number(point && point.x);
        const y = Number(point && point.y);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Array.isArray(ring) || ring.length < 3) return false;
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const xi = Number(ring[i] && ring[i].x);
            const yi = Number(ring[i] && ring[i].y);
            const xj = Number(ring[j] && ring[j].x);
            const yj = Number(ring[j] && ring[j].y);
            if (![xi, yi, xj, yj].every(Number.isFinite)) continue;
            const intersects = ((yi > y) !== (yj > y)) &&
                (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi);
            if (intersects) inside = !inside;
        }
        return inside;
    }

    function polygonArea(points) {
        if (!Array.isArray(points) || points.length < 3) return Infinity;
        let sum = 0;
        for (let i = 0; i < points.length; i++) {
            const a = points[i];
            const b = points[(i + 1) % points.length];
            sum += Number(a && a.x) * Number(b && b.y) - Number(b && b.x) * Number(a && a.y);
        }
        return Math.abs(sum * 0.5);
    }

    function fragmentContainsWorldPoint(fragment, point) {
        if (!fragment || !pointInRing(point, fragment.outerPolygon)) return false;
        const holes = Array.isArray(fragment.holes) ? fragment.holes : [];
        for (let i = 0; i < holes.length; i++) {
            if (pointInRing(point, holes[i])) return false;
        }
        return true;
    }

    function orientation2D(a, b, c) {
        return ((Number(b.y) - Number(a.y)) * (Number(c.x) - Number(b.x))) -
            ((Number(b.x) - Number(a.x)) * (Number(c.y) - Number(b.y)));
    }

    function pointOnSegment2D(a, b, p, eps = 1e-9) {
        return (
            Math.min(Number(a.x), Number(b.x)) - eps <= Number(p.x) &&
            Number(p.x) <= Math.max(Number(a.x), Number(b.x)) + eps &&
            Math.min(Number(a.y), Number(b.y)) - eps <= Number(p.y) &&
            Number(p.y) <= Math.max(Number(a.y), Number(b.y)) + eps &&
            Math.abs(orientation2D(a, b, p)) <= eps
        );
    }

    function segmentsIntersect2D(a, b, c, d, eps = 1e-9) {
        const o1 = orientation2D(a, b, c);
        const o2 = orientation2D(a, b, d);
        const o3 = orientation2D(c, d, a);
        const o4 = orientation2D(c, d, b);
        if (Math.abs(o1) <= eps && pointOnSegment2D(a, b, c, eps)) return true;
        if (Math.abs(o2) <= eps && pointOnSegment2D(a, b, d, eps)) return true;
        if (Math.abs(o3) <= eps && pointOnSegment2D(c, d, a, eps)) return true;
        if (Math.abs(o4) <= eps && pointOnSegment2D(c, d, b, eps)) return true;
        return (o1 > eps) !== (o2 > eps) && (o3 > eps) !== (o4 > eps);
    }

    function segmentIntersectsPolygon2D(a, b, polygon) {
        if (!Array.isArray(polygon) || polygon.length < 3) return false;
        if (pointInRing(a, polygon) || pointInRing(b, polygon)) return true;
        for (let i = 0; i < polygon.length; i++) {
            const c = polygon[i];
            const d = polygon[(i + 1) % polygon.length];
            if (segmentsIntersect2D(a, b, c, d)) return true;
        }
        return false;
    }

    function getBuildingNodeEndpoint(node) {
        return {
            xindex: Number(node.xindex),
            yindex: Number(node.yindex),
            surfaceId: typeof node.surfaceId === "string" ? node.surfaceId : "",
            fragmentId: typeof node.fragmentId === "string" ? node.fragmentId : "",
            traversalLayer: Number.isFinite(Number(node.traversalLayer)) ? Math.round(Number(node.traversalLayer)) : undefined
        };
    }

    function buildingNodeEndpointKey(node) {
        return [
            Number(node && node.xindex),
            Number(node && node.yindex),
            String(node && node.surfaceId || ""),
            String(node && node.fragmentId || "")
        ].join(",");
    }

    function placementHasCurrentMovementBlockedEdges(placement) {
        return !!(
            placement &&
            Array.isArray(placement.movementBlockedEdges) &&
            placement.movementEdgeBlockerVersion === MOVEMENT_EDGE_BLOCKER_VERSION &&
            placement.movementBlockerGeometryVersion === MOVEMENT_BLOCKER_GEOMETRY_VERSION
        );
    }

    function computeBuildingPlacementMovementBlockedEdges(map, placement) {
        const state = map && map._prototypeBuildingState;
        if (!map || !state || !placement || !placement.id) return null;
        const polygons = getPlacementMovementBlockerPolygons(map, placement, { scheduleLoad: true });
        if (polygons === null) return null;
        const fragmentIds = state.runtimeFloorFragmentIdsByPlacementId instanceof Map
            ? (state.runtimeFloorFragmentIdsByPlacementId.get(placement.id) || [])
            : [];
        if (fragmentIds.length === 0) return null;

        const polygonsBySurfaceId = new Map();
        for (let i = 0; i < polygons.length; i++) {
            const entry = polygons[i];
            const surfaceId = typeof entry.surfaceId === "string" ? entry.surfaceId : "";
            if (!surfaceId) {
                throw new Error(`building placement ${placement.id} movement blocker ${i} is missing surfaceId`);
            }
            if (!polygonsBySurfaceId.has(surfaceId)) polygonsBySurfaceId.set(surfaceId, []);
            polygonsBySurfaceId.get(surfaceId).push({
                index: i,
                polygon: getMovementBlockerEntryPolygon(entry, `building placement ${placement.id} movement blocker ${i}`),
                entry
            });
        }

        const edges = [];
        const seen = new Set();
        for (let f = 0; f < fragmentIds.length; f++) {
            const fragmentId = fragmentIds[f];
            const nodes = map.floorNodesById instanceof Map ? (map.floorNodesById.get(fragmentId) || []) : [];
            for (let n = 0; n < nodes.length; n++) {
                const node = nodes[n];
                if (!node || !Array.isArray(node.neighbors)) continue;
                const surfaceId = typeof node.surfaceId === "string" ? node.surfaceId : "";
                if (!surfaceId) {
                    throw new Error(`building placement ${placement.id} floor node ${node.xindex},${node.yindex} is missing surfaceId`);
                }
                const blockers = polygonsBySurfaceId.get(surfaceId);
                if (!Array.isArray(blockers) || blockers.length === 0) continue;
                const a = { x: Number(node.x), y: Number(node.y) };
                if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) continue;
                for (let d = 0; d < node.neighbors.length; d++) {
                    const neighbor = node.neighbors[d];
                    if (!neighbor || neighbor === node || neighbor.surfaceId !== surfaceId) continue;
                    const b = { x: Number(neighbor.x), y: Number(neighbor.y) };
                    if (!Number.isFinite(b.x) || !Number.isFinite(b.y)) continue;
                    const nodeKey = buildingNodeEndpointKey(node);
                    const neighborKey = buildingNodeEndpointKey(neighbor);
                    const edgeKey = nodeKey <= neighborKey ? `${nodeKey}|${neighborKey}` : `${neighborKey}|${nodeKey}`;
                    if (seen.has(edgeKey)) continue;
                    let blockingEntry = null;
                    for (let p = 0; p < blockers.length; p++) {
                        if (!segmentIntersectsPolygon2D(a, b, blockers[p].polygon)) continue;
                        blockingEntry = blockers[p];
                        break;
                    }
                    if (!blockingEntry) continue;
                    seen.add(edgeKey);
                    edges.push({
                        id: `${placement.id}:movement-edge:${edges.length}`,
                        buildingPlacementId: placement.id,
                        surfaceId,
                        fragmentId: typeof node.fragmentId === "string" ? node.fragmentId : "",
                        movementBlockerIndex: blockingEntry.index,
                        traversalLayer: Number.isFinite(Number(node.traversalLayer)) ? Math.round(Number(node.traversalLayer)) : undefined,
                        a: getBuildingNodeEndpoint(node),
                        b: getBuildingNodeEndpoint(neighbor)
                    });
                }
            }
        }
        return edges;
    }

    function findBuildingRuntimeFloorAtZ(fragments, z, point, stairId, endpointLabel) {
        const targetZ = finiteNumber(z, `stair ${stairId} ${endpointLabel} z`);
        const zMatches = [];
        const matches = [];
        const candidates = [];
        for (let i = 0; i < fragments.length; i++) {
            const fragment = fragments[i];
            if (!fragment) continue;
            const fragmentZ = getBuildingLayerBaseZ(fragment, getBuildingFloorLayer(fragment));
            candidates.push({
                id: getBuildingFloorId(fragment, i),
                level: fragment.level,
                traversalLayer: fragment.traversalLayer,
                nodeBaseZ: fragment.nodeBaseZ,
                elevation: fragment.elevation,
                resolvedZ: fragmentZ
            });
            if (Math.abs(fragmentZ - targetZ) > 0.000001) continue;
            zMatches.push(fragment);
            if (!fragmentContainsWorldPoint(fragment, point)) continue;
            matches.push(fragment);
        }
        matches.sort((a, b) => polygonArea(a.outerPolygon) - polygonArea(b.outerPolygon));
        if (matches[0]) return matches[0];
        if (zMatches.length === 1) return zMatches[0];
        if (zMatches.length > 1) {
            throw new Error(`building stair ${stairId} cannot resolve ${endpointLabel} floor at z ${targetZ}: ${zMatches.length} floors share that height and none contains the endpoint`);
        }
        throw new Error(`building stair ${stairId} cannot resolve ${endpointLabel} floor at z ${targetZ}; candidates=${JSON.stringify(candidates)}`);
    }

    function transformStairTread(tread, transform, label) {
        if (!tread || typeof tread !== "object") throw new Error(`${label} must be a tread`);
        const out = {
            left: transformPoint(clonePoint(tread.left, `${label} left`), transform),
            right: transformPoint(clonePoint(tread.right, `${label} right`), transform)
        };
        out.center = {
            x: (out.left.x + out.right.x) * 0.5,
            y: (out.left.y + out.right.y) * 0.5
        };
        if (Object.prototype.hasOwnProperty.call(tread, "arcDeltaAngle")) {
            out.arcDeltaAngle = finiteNumber(tread.arcDeltaAngle, `${label} arcDeltaAngle`);
        }
        if (Object.prototype.hasOwnProperty.call(tread, "arcNearDeltaAngle")) {
            out.arcNearDeltaAngle = finiteNumber(tread.arcNearDeltaAngle, `${label} arcNearDeltaAngle`);
        }
        return out;
    }

    function createPrototypeBuildingStairDescriptor(sourceFloor, stair, stairIndex, placement, fragments, sourceFloorId, idPrefix) {
        const sourceStairId = String(stair && stair.id);
        if (!sourceStairId) throw new Error(`building placement ${placement.id} stair ${stairIndex} missing id`);
        if (stair && stair.ladder === true) {
            throw new Error(`building placement ${placement.id} stair ${sourceStairId} ladders are not supported by path stairs`);
        }
        const treads = Array.isArray(stair && stair.treads) ? stair.treads : [];
        if (treads.length < 2) throw new Error(`building placement ${placement.id} stair ${sourceStairId} requires saved tread geometry`);
        const bottomZ = Number.isFinite(Number(stair.bottomZ))
            ? Number(stair.bottomZ)
            : getBuildingLayerBaseZ(sourceFloor, getBuildingFloorLayer(sourceFloor));
        const height = finiteNumber(stair && stair.height, `building placement ${placement.id} stair ${sourceStairId} height`);
        if (!(height > 0)) throw new Error(`building placement ${placement.id} stair ${sourceStairId} requires a positive height`);
        const direction = String(stair && stair.direction || "up").toLowerCase();
        const topZ = direction === "down" ? bottomZ - height : bottomZ + height;
        const lowerZ = Math.min(bottomZ, topZ);
        const higherZ = Math.max(bottomZ, topZ);
        const startPoint = stair.startPoint || (treads[0] && treads[0].center);
        const endPoint = stair.endPoint || (treads[treads.length - 1] && treads[treads.length - 1].center);
        if (!startPoint || !endPoint) throw new Error(`building placement ${placement.id} stair ${sourceStairId} requires endpoint geometry`);
        const lowerPoint = transformPoint(direction === "down" ? endPoint : startPoint, placement.transform);
        const higherPoint = transformPoint(direction === "down" ? startPoint : endPoint, placement.transform);
        const orderedSourceTreads = direction === "down" ? treads.slice().reverse() : treads.slice();
        const runtimeTreads = orderedSourceTreads.map((tread, index) => transformStairTread(
            tread,
            placement.transform,
            `building placement ${placement.id} stair ${sourceStairId} tread ${index}`
        ));
        const runtimeId = `${placement.id}:${idPrefix}:${sourceFloorId}:${sourceStairId}`;
        const lowerFloor = findBuildingRuntimeFloorAtZ(fragments, lowerZ, lowerPoint, runtimeId, "lower");
        const higherFloor = findBuildingRuntimeFloorAtZ(fragments, higherZ, higherPoint, runtimeId, "higher");
        return {
            id: runtimeId,
            sourceStairId,
            type: "stairs",
            stairKind: "treadPath",
            lowerPoint,
            higherPoint,
            lowerZ,
            higherZ,
            lowerLevel: getBuildingFloorLayer(lowerFloor),
            higherLevel: getBuildingFloorLayer(higherFloor),
            lowerFragmentId: lowerFloor.fragmentId,
            higherFragmentId: higherFloor.fragmentId,
            lowerSurfaceId: lowerFloor.surfaceId,
            higherSurfaceId: higherFloor.surfaceId,
            width: Number.isFinite(Number(stair.width)) ? Number(stair.width) : undefined,
            stepCount: Number.isFinite(Number(stair.stepCount)) ? Math.max(1, Math.round(Number(stair.stepCount))) : undefined,
            riserDepth: Number.isFinite(Number(stair.riserDepth)) ? Math.max(0, Number(stair.riserDepth)) : undefined,
            texturePath: typeof stair.texturePath === "string" ? stair.texturePath : "",
            treads: runtimeTreads,
            bottomZ: direction === "down" ? higherZ : lowerZ,
            height,
            direction,
            _prototypeBuildingPlacementId: placement.id,
            _prototypeBuildingSourceFloorId: sourceFloorId,
            _prototypeBuildingSourceStairId: sourceStairId
        };
    }

    function createPrototypeBuildingStairRenderItem(sourceFloor, stair, stairIndex, placement, fragments, sourceFloorId) {
        const descriptor = createPrototypeBuildingStairDescriptor(sourceFloor, stair, stairIndex, placement, fragments, sourceFloorId, "stair-render");
        const item = {
            ...descriptor,
            id: `${placement.id}:stair-render:${sourceFloorId}:${descriptor.sourceStairId}`,
            type: "treadPathStair",
            isStairRenderObject: true,
            stair: descriptor,
            stairId: descriptor.id,
            map: null,
            level: descriptor.lowerLevel,
            traversalLayer: descriptor.lowerLevel,
            x: (Number(descriptor.lowerPoint.x) + Number(descriptor.higherPoint.x)) * 0.5,
            y: (Number(descriptor.lowerPoint.y) + Number(descriptor.higherPoint.y)) * 0.5,
            gone: false,
            vanishing: false,
            visible: true
        };
        return {
            item,
            level: item.level,
            refs: [
                { fragmentId: descriptor.lowerFragmentId, surfaceId: descriptor.lowerSurfaceId },
                { fragmentId: descriptor.higherFragmentId, surfaceId: descriptor.higherSurfaceId }
            ].filter(ref => ref.fragmentId || ref.surfaceId)
        };
    }

    function createPrototypeBuildingStairRuntimeRecords(buildingData, placementRecord, fragments) {
        assertValidBuildingEditorSave(buildingData, placementRecord && placementRecord.buildingSaveName);
        const placement = normalizeBuildingPlacementRecord(placementRecord);
        const out = [];
        const sourceFloors = Array.isArray(buildingData.floorFragments) ? buildingData.floorFragments : [];
        for (let f = 0; f < sourceFloors.length; f++) {
            const sourceFloor = sourceFloors[f];
            const sourceFloorId = getBuildingFloorId(sourceFloor, f);
            const stairs = Array.isArray(sourceFloor && sourceFloor.stairs) ? sourceFloor.stairs : [];
            for (let s = 0; s < stairs.length; s++) {
                const descriptor = createPrototypeBuildingStairDescriptor(sourceFloor, stairs[s], s, placement, fragments, sourceFloorId, "stair");
                out.push({
                    ...descriptor,
                    renderedByBuildingCutaway: true,
                });
            }
        }
        return out;
    }

    function boundsForPolygon(points) {
        const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
        for (let i = 0; i < points.length; i++) {
            const x = Number(points[i] && points[i].x);
            const y = Number(points[i] && points[i].y);
            if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
            bounds.minX = Math.min(bounds.minX, x);
            bounds.minY = Math.min(bounds.minY, y);
            bounds.maxX = Math.max(bounds.maxX, x);
            bounds.maxY = Math.max(bounds.maxY, y);
        }
        if (!Number.isFinite(bounds.minX) || !Number.isFinite(bounds.minY)) {
            throw new Error("cannot compute bounds for empty building polygon");
        }
        return bounds;
    }

    function boundsOverlap(a, b) {
        return !!(a && b && a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY);
    }

    function boundsFromHitbox(hitbox) {
        if (!hitbox || typeof hitbox.getBounds !== "function") {
            throw new Error("building movement blocker requires hitbox bounds");
        }
        const bounds = hitbox.getBounds();
        const x = finiteNumber(bounds && bounds.x, "building movement blocker bounds x");
        const y = finiteNumber(bounds && bounds.y, "building movement blocker bounds y");
        const width = finiteNumber(bounds && bounds.width, "building movement blocker bounds width");
        const height = finiteNumber(bounds && bounds.height, "building movement blocker bounds height");
        return {
            minX: x,
            minY: y,
            maxX: x + width,
            maxY: y + height
        };
    }

    function getPrototypeBuildingMovementNodeRegistry(map) {
        const sectionState = map && map._prototypeSectionState;
        if (sectionState && sectionState.allNodesByCoordKey instanceof Map) {
            return sectionState.allNodesByCoordKey;
        }
        if (map && Array.isArray(map.nodes)) {
            const registry = new Map();
            for (let x = 0; x < map.nodes.length; x++) {
                const column = map.nodes[x];
                if (!Array.isArray(column)) continue;
                for (let y = 0; y < column.length; y++) {
                    const node = column[y];
                    if (!node) continue;
                    registry.set(`${Number(node.xindex)},${Number(node.yindex)}`, node);
                }
            }
            return registry;
        }
        return null;
    }

    function hasPrototypeBuildingMovementNodeRegistry(map) {
        const registry = getPrototypeBuildingMovementNodeRegistry(map);
        return registry instanceof Map && registry.size > 0;
    }

    function getPrototypeBuildingMovementCandidateNodes(map, bounds, traversalLayer = 0) {
        const registry = getPrototypeBuildingMovementNodeRegistry(map);
        if (!(registry instanceof Map) || registry.size === 0) return null;
        const targetLayer = Number.isFinite(Number(traversalLayer)) ? Math.round(Number(traversalLayer)) : 0;
        const minXi = Math.floor(bounds.minX / 0.866) - 3;
        const maxXi = Math.ceil(bounds.maxX / 0.866) + 3;
        const minYi = Math.floor(bounds.minY) - 3;
        const maxYi = Math.ceil(bounds.maxY) + 3;
        const nodes = [];
        const seen = new Set();
        for (let x = minXi; x <= maxXi; x++) {
            for (let y = minYi; y <= maxYi; y++) {
                const baseNode = registry.get(`${x},${y}`);
                if (!baseNode) continue;
                let node = baseNode;
                if (targetLayer !== 0) {
                    const sectionKey = typeof baseNode._prototypeSectionKey === "string" ? baseNode._prototypeSectionKey : "";
                    node = map && typeof map.getFloorNodeAtLayer === "function"
                        ? map.getFloorNodeAtLayer(baseNode.xindex, baseNode.yindex, targetLayer, {
                            sectionKey,
                            allowScan: false
                        })
                        : null;
                }
                if (!node) continue;
                const nodeLayer = Number.isFinite(Number(node.traversalLayer))
                    ? Math.round(Number(node.traversalLayer))
                    : (Number.isFinite(Number(node.level)) ? Math.round(Number(node.level)) : targetLayer);
                if (nodeLayer !== targetLayer) continue;
                const nodeKey = `${Number(node.xindex)},${Number(node.yindex)},${nodeLayer}`;
                if (seen.has(nodeKey)) continue;
                seen.add(nodeKey);
                nodes.push(node);
            }
        }
        return nodes;
    }

    function removePrototypeBuildingMovementBlocker(blocker) {
        const attachedNodes = Array.isArray(blocker && blocker._prototypeBuildingMovementNodes)
            ? blocker._prototypeBuildingMovementNodes
            : [];
        for (let i = 0; i < attachedNodes.length; i++) {
            const node = attachedNodes[i];
            if (!node || !Array.isArray(node.objects)) continue;
            const index = node.objects.indexOf(blocker);
            if (index >= 0) node.objects.splice(index, 1);
        }
        if (blocker) {
            blocker._prototypeBuildingMovementNodes = [];
            blocker.gone = true;
        }
    }

    function removePrototypeBuildingMovementEdgeBlockers(state, placementId = null) {
        if (!state || !(state.movementEdgeBlockersByPlacementId instanceof Map)) return 0;
        const entries = placementId
            ? [[placementId, state.movementEdgeBlockersByPlacementId.get(placementId)]]
            : Array.from(state.movementEdgeBlockersByPlacementId.entries());
        let removed = 0;
        for (let e = 0; e < entries.length; e++) {
            const [id, activeEntry] = entries[e];
            const links = Array.isArray(activeEntry && activeEntry.links) ? activeEntry.links : [];
            for (let i = 0; i < links.length; i++) {
                const link = links[i];
                const node = link && link.node;
                const direction = Number(link && link.direction);
                const blocker = link && link.blocker;
                if (!node || !Number.isInteger(direction) || !blocker) continue;
                if (!(node.blockedNeighbors instanceof Map) || !node.blockedNeighbors.has(direction)) continue;
                const blockers = node.blockedNeighbors.get(direction);
                if (!(blockers instanceof Set) || !blockers.has(blocker)) continue;
                blockers.delete(blocker);
                if (blockers.size === 0) node.blockedNeighbors.delete(direction);
                blocker.gone = true;
                removed += 1;
            }
            state.movementEdgeBlockersByPlacementId.delete(id);
        }
        return removed;
    }

    function clearPrototypeBuildingMovementBlockers(state) {
        if (!state) return;
        removePrototypeBuildingMovementEdgeBlockers(state);
        if (state.movementBlockersByPlacementId instanceof Map) {
            for (const blockers of state.movementBlockersByPlacementId.values()) {
                if (!Array.isArray(blockers)) continue;
                for (let i = 0; i < blockers.length; i++) {
                    removePrototypeBuildingMovementBlocker(blockers[i]);
                }
            }
            state.movementBlockersByPlacementId.clear();
        }
    }

    function resolveMovementBlockedEdgeNode(map, endpoint, surfaceId) {
        if (!map || !endpoint) return null;
        const x = Number(endpoint.xindex);
        const y = Number(endpoint.yindex);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        const resolvedSurfaceId = typeof endpoint.surfaceId === "string" && endpoint.surfaceId.length > 0
            ? endpoint.surfaceId
            : surfaceId;
        const fragmentId = typeof endpoint.fragmentId === "string" ? endpoint.fragmentId : "";
        if (fragmentId && map.floorNodeIndex instanceof Map && typeof map.getFloorNodeKey === "function") {
            const directNode = map.floorNodeIndex.get(map.getFloorNodeKey(x, y, resolvedSurfaceId, fragmentId)) || null;
            if (directNode) return directNode;
        }
        if (resolvedSurfaceId && typeof map.getFloorNodeBySurface === "function") {
            return map.getFloorNodeBySurface(resolvedSurfaceId, x, y);
        }
        return null;
    }

    function getPlacementMovementBlockedEdges(map, placement) {
        if (!placement || typeof placement !== "object") return null;
        if (placementHasCurrentMovementBlockedEdges(placement)) {
            return normalizeMovementBlockedEdges(placement.movementBlockedEdges, `building placement ${placement.id} movementBlockedEdges`);
        }
        const edges = computeBuildingPlacementMovementBlockedEdges(map, placement);
        if (edges === null) return null;
        return setPlacementMovementBlockedEdges(placement, edges);
    }

    function applyPrototypeBuildingMovementBlockedEdges(map, placement) {
        const state = map && map._prototypeBuildingState;
        if (!state || !placement || !placement.id) return { applied: 0, pending: 0 };
        if (!(state.movementEdgeBlockersByPlacementId instanceof Map)) {
            state.movementEdgeBlockersByPlacementId = new Map();
        }
        removePrototypeBuildingMovementEdgeBlockers(state, placement.id);
        const edges = getPlacementMovementBlockedEdges(map, placement);
        if (edges === null) return { applied: 0, pending: 1 };
        const instance = getBuildingInstanceRecord(state, placement);
        if (instance) {
            instance.movementBlockedEdges = normalizeMovementBlockedEdges(edges, `building instance ${instance.id} movementBlockedEdges`);
            instance.movementEdgeBlockerVersion = MOVEMENT_EDGE_BLOCKER_VERSION;
        }
        const links = [];
        let applied = 0;
        for (let i = 0; i < edges.length; i++) {
            const edge = edges[i];
            const surfaceId = nonEmptyString(edge.surfaceId, `building placement ${placement.id} movement edge ${i} surfaceId`);
            const nodeA = resolveMovementBlockedEdgeNode(map, edge.a, surfaceId);
            const nodeB = resolveMovementBlockedEdgeNode(map, edge.b, surfaceId);
            if (!nodeA || !nodeB || !Array.isArray(nodeA.neighbors) || !Array.isArray(nodeB.neighbors)) continue;
            const dirA = nodeA.neighbors.indexOf(nodeB);
            const dirB = nodeB.neighbors.indexOf(nodeA);
            if (dirA < 0 && dirB < 0) continue;
            const blocker = {
                type: "prototypeBuildingMovementEdgeBlocker",
                id: edge.id || `${placement.id}:movement-edge:${i}`,
                buildingPlacementId: placement.id,
                surfaceId,
                fragmentId: edge.fragmentId || "",
                movementBlockerIndex: Number.isInteger(edge.movementBlockerIndex) ? edge.movementBlockerIndex : null,
                blocksTile: false,
                isPassable: false,
                gone: false,
                _prototypeBuildingMovementEdgeBlocker: true
            };
            if (dirA >= 0) {
                if (!(nodeA.blockedNeighbors instanceof Map)) nodeA.blockedNeighbors = new Map();
                if (!nodeA.blockedNeighbors.has(dirA)) nodeA.blockedNeighbors.set(dirA, new Set());
                const blockersA = nodeA.blockedNeighbors.get(dirA);
                if (!blockersA.has(blocker)) {
                    blockersA.add(blocker);
                    links.push({ node: nodeA, direction: dirA, blocker });
                    applied += 1;
                }
            }
            if (dirB >= 0) {
                if (!(nodeB.blockedNeighbors instanceof Map)) nodeB.blockedNeighbors = new Map();
                if (!nodeB.blockedNeighbors.has(dirB)) nodeB.blockedNeighbors.set(dirB, new Set());
                const blockersB = nodeB.blockedNeighbors.get(dirB);
                if (!blockersB.has(blocker)) {
                    blockersB.add(blocker);
                    links.push({ node: nodeB, direction: dirB, blocker });
                    applied += 1;
                }
            }
        }
        state.movementEdgeBlockersByPlacementId.set(placement.id, { links });
        return { applied, pending: 0 };
    }

    function scheduleMovementGeometryLoad(map, placement) {
        const state = map && map._prototypeBuildingState;
        if (!state || !placement || !placement.id) return false;
        if (!(state.pendingMovementGeometryByPlacementId instanceof Map)) {
            state.pendingMovementGeometryByPlacementId = new Map();
        }
        if (state.pendingMovementGeometryByPlacementId.has(placement.id)) return true;
        if (typeof map.loadPrototypeBuildingEditorSaveData !== "function") {
            state.lastMovementBlockerError = `building placement ${placement.id} missing structural movement blockers and no building loader is installed`;
            return false;
        }
        const loadBuildingData = typeof map.loadPrototypeBuildingDataForPlacement === "function"
            ? map.loadPrototypeBuildingDataForPlacement.bind(map)
            : map.loadPrototypeBuildingEditorSaveData.bind(map);
        const promise = loadBuildingData(placement)
            .then((buildingData) => {
                const polygons = setPlacementMovementBlockerPolygons(
                    placement,
                    computeBuildingPlacementMovementBlockerPolygons(buildingData, placement)
                );
                const instance = getBuildingInstanceRecord(state, placement);
                if (instance) {
                    instance.movementBlockerPolygons = normalizeMovementBlockerPolygons(polygons);
                    instance.movementBlockerGeometryVersion = MOVEMENT_BLOCKER_GEOMETRY_VERSION;
                    instance.movementBlockedEdges = null;
                    instance.movementEdgeBlockerVersion = "";
                }
                markPrototypeBuildingMovementBlockersDirty(map);
                if (hasPrototypeBuildingMovementNodeRegistry(map)) {
                    syncPrototypeBuildingMovementBlockers(map);
                }
                return placement.movementBlockerPolygons;
            })
            .catch((error) => {
                state.lastMovementBlockerError = error && error.message ? error.message : String(error);
                console.error("[building movement blocking]", state.lastMovementBlockerError);
                throw error;
            })
            .finally(() => {
                state.pendingMovementGeometryByPlacementId.delete(placement.id);
            });
        state.pendingMovementGeometryByPlacementId.set(placement.id, promise);
        promise.catch(() => {});
        return true;
    }

    function getPlacementMovementBlockerPolygons(map, placement, options = {}) {
        if (!placement || typeof placement !== "object") return [];
        const state = map && map._prototypeBuildingState;
        const buildingData = state ? getBuildingDataForPlacement(state, placement) : null;
        if (buildingData && !placementHasCurrentMovementBlockerGeometry(placement)) {
            const polygons = setPlacementMovementBlockerPolygons(
                placement,
                computeBuildingPlacementMovementBlockerPolygons(buildingData, placement)
            );
            const instance = getBuildingInstanceRecord(state, placement);
            if (instance) {
                instance.movementBlockerPolygons = normalizeMovementBlockerPolygons(polygons);
                instance.movementBlockerGeometryVersion = MOVEMENT_BLOCKER_GEOMETRY_VERSION;
                instance.movementBlockedEdges = null;
                instance.movementEdgeBlockerVersion = "";
            }
            return placement.movementBlockerPolygons;
        }
        if (placementHasCurrentMovementBlockerGeometry(placement) && Array.isArray(placement.movementBlockerPolygons)) {
            return normalizeMovementBlockerPolygons(placement.movementBlockerPolygons, `building placement ${placement.id} movementBlockerPolygons`);
        }
        if (options.scheduleLoad === true && scheduleMovementGeometryLoad(map, placement)) {
            return null;
        }
        return null;
    }

    function createPrototypeBuildingMovementBlocker(map, placement, entry, polygonIndex) {
        const PolygonHitboxCtor = globalScope.PolygonHitbox;
        if (typeof PolygonHitboxCtor !== "function") {
            throw new Error("building movement blocking requires PolygonHitbox to be loaded");
        }
        const polygon = getMovementBlockerEntryPolygon(entry, `building placement ${placement.id} movement blocker ${polygonIndex}`);
        const traversalLayer = getMovementBlockerEntryLayer(entry, `building placement ${placement.id} movement blocker ${polygonIndex}`);
        const bottomZ = getMovementBlockerEntryBottomZ(entry, traversalLayer, `building placement ${placement.id} movement blocker ${polygonIndex}`);
        const height = getMovementBlockerEntryHeight(entry, `building placement ${placement.id} movement blocker ${polygonIndex}`);
        const normalizedPolygon = normalizePolygon(polygon, `building placement ${placement.id} movement blocker ${polygonIndex}`);
        const bounds = boundsForPolygon(normalizedPolygon);
        const centerX = (bounds.minX + bounds.maxX) * 0.5;
        const centerY = (bounds.minY + bounds.maxY) * 0.5;
        return {
            type: "prototypeBuildingMovementBlocker",
            id: `${placement.id}:movement:${polygonIndex}`,
            buildingPlacementId: placement.id,
            buildingSaveName: placement.buildingSaveName,
            map,
            x: centerX,
            y: centerY,
            level: traversalLayer,
            traversalLayer,
            bottomZ,
            height,
            isPassable: false,
            blocksTile: false,
            gone: false,
            groundPlaneHitbox: new PolygonHitboxCtor(normalizedPolygon),
            _prototypeBuildingMovementBlocker: true,
            _prototypeBuildingMovementNodes: []
        };
    }

    function attachPrototypeBuildingMovementBlockerToNode(blocker, node) {
        if (!blocker || !node) return false;
        if (!Array.isArray(node.objects)) node.objects = [];
        if (!node.objects.includes(blocker)) node.objects.push(blocker);
        if (!Array.isArray(blocker._prototypeBuildingMovementNodes)) {
            blocker._prototypeBuildingMovementNodes = [];
        }
        if (!blocker._prototypeBuildingMovementNodes.includes(node)) {
            blocker._prototypeBuildingMovementNodes.push(node);
        }
        return true;
    }

    function arePrototypeBuildingMovementBlockersCurrent(map, state, registry) {
        if (!state || !(registry instanceof Map)) return false;
        const placements = Array.isArray(state.orderedPlacements) ? state.orderedPlacements : [];
        if (placements.length === 0) return true;
        if (!(state.movementBlockersByPlacementId instanceof Map)) return false;
        for (let i = 0; i < placements.length; i++) {
            const placement = placements[i];
            if (!isPrototypeBuildingPlacementDesired(state, placement)) continue;
            const polygons = getPlacementMovementBlockerPolygons(null, placement, { scheduleLoad: false });
            const pending = state.pendingMovementGeometryByPlacementId instanceof Map &&
                state.pendingMovementGeometryByPlacementId.has(placement && placement.id);
            if (polygons === null && pending) {
                const blockers = state.movementBlockersByPlacementId.get(placement.id);
                if (blockers === undefined || (Array.isArray(blockers) && blockers.length === 0)) continue;
            }
            if (polygons === null) return false;
            const blockers = state.movementBlockersByPlacementId.get(placement.id);
            if (!Array.isArray(blockers) || blockers.length !== polygons.length) return false;
            for (let b = 0; b < blockers.length; b++) {
                const blocker = blockers[b];
                const attachedNodes = Array.isArray(blocker && blocker._prototypeBuildingMovementNodes)
                    ? blocker._prototypeBuildingMovementNodes
                    : [];
                if (attachedNodes.length === 0) return false;
                const traversalLayer = getMovementBlockerEntryLayer(polygons[b], `building placement ${placement.id} movement blocker ${b}`);
                for (let n = 0; n < attachedNodes.length; n++) {
                    const node = attachedNodes[n];
                    const key = `${Number(node && node.xindex)},${Number(node && node.yindex)}`;
                    const baseNode = registry.get(key);
                    if (!baseNode) return false;
                    if (traversalLayer === 0) {
                        if (baseNode !== node) return false;
                    } else {
                        const sectionKey = typeof baseNode._prototypeSectionKey === "string" ? baseNode._prototypeSectionKey : "";
                        const currentLayerNode = map && typeof map.getFloorNodeAtLayer === "function"
                            ? map.getFloorNodeAtLayer(node.xindex, node.yindex, traversalLayer, {
                                sectionKey,
                                allowScan: false
                            })
                            : null;
                        if (currentLayerNode !== node) return false;
                    }
                    if (!Array.isArray(node.objects) || !node.objects.includes(blocker)) return false;
                }
            }
        }
        return true;
    }

    function syncPrototypeBuildingMovementBlockers(map, options = {}) {
        const state = map && map._prototypeBuildingState;
        if (!state) return 0;
        const registry = getPrototypeBuildingMovementNodeRegistry(map);
        const registrySize = registry instanceof Map ? registry.size : 0;
        const forceValidate = !!(options && options.forceValidate);
        if (
            state.movementBlockersDirty !== true &&
            Number(state.movementBlockerNodeRegistrySize) === registrySize &&
            (forceValidate !== true || arePrototypeBuildingMovementBlockersCurrent(map, state, registry))
        ) {
            return 0;
        }
        clearPrototypeBuildingMovementBlockers(state);
        state.movementBlockersDirty = false;
        state.movementBlockerNodeRegistrySize = registrySize;
        const placements = Array.isArray(state.orderedPlacements) ? state.orderedPlacements : [];
        if (placements.length === 0) return 0;
        if (!(registry instanceof Map) || registry.size === 0) {
            throw new Error("building movement blocking requires a prototype node index");
        }
        let attachedCount = 0;
        let edgeBlockedCount = 0;
        let awaitingGeometry = 0;
        let awaitingEdges = 0;
        for (let i = 0; i < placements.length; i++) {
            const placement = placements[i];
            if (!isPrototypeBuildingPlacementDesired(state, placement)) continue;
            const polygons = getPlacementMovementBlockerPolygons(map, placement, { scheduleLoad: true });
            if (polygons === null) {
                state.movementBlockersByPlacementId.set(placement.id, []);
                awaitingGeometry += 1;
                continue;
            }
            const blockers = [];
            for (let p = 0; p < polygons.length; p++) {
                const polygon = getMovementBlockerEntryPolygon(polygons[p], `building placement ${placement.id} movement blocker ${p}`);
                const traversalLayer = getMovementBlockerEntryLayer(polygons[p], `building placement ${placement.id} movement blocker ${p}`);
                const blocker = createPrototypeBuildingMovementBlocker(map, placement, polygons[p], p);
                const candidates = getPrototypeBuildingMovementCandidateNodes(map, boundsForPolygon(polygon), traversalLayer);
                if (!Array.isArray(candidates)) {
                    throw new Error(`building placement ${placement.id} movement blocker has no node candidates`);
                }
                for (let n = 0; n < candidates.length; n++) {
                    if (attachPrototypeBuildingMovementBlockerToNode(blocker, candidates[n])) attachedCount += 1;
                }
                blockers.push(blocker);
            }
            state.movementBlockersByPlacementId.set(placement.id, blockers);
            const edgeStats = applyPrototypeBuildingMovementBlockedEdges(map, placement);
            edgeBlockedCount += Number(edgeStats && edgeStats.applied) || 0;
            awaitingEdges += Number(edgeStats && edgeStats.pending) || 0;
        }
        state.lastMovementBlockerStats = {
            placements: placements.length,
            blockers: Array.from(state.movementBlockersByPlacementId.values()).reduce((sum, blockers) => sum + blockers.length, 0),
            nodeAttachments: attachedCount,
            edgeBlockedConnections: edgeBlockedCount,
            awaitingGeometry,
            awaitingEdges
        };
        return attachedCount;
    }

    function collectPrototypeBuildingMovementBlockersInBounds(map, bounds, traversalLayer = 0, options = {}) {
        const state = map && map._prototypeBuildingState;
        if (!state) return [];
        const queryBounds = {
            minX: finiteNumber(bounds && bounds.minX, "building movement blocker query minX"),
            minY: finiteNumber(bounds && bounds.minY, "building movement blocker query minY"),
            maxX: finiteNumber(bounds && bounds.maxX, "building movement blocker query maxX"),
            maxY: finiteNumber(bounds && bounds.maxY, "building movement blocker query maxY")
        };
        if (queryBounds.maxX < queryBounds.minX || queryBounds.maxY < queryBounds.minY) {
            throw new Error("building movement blocker query bounds are inverted");
        }
        const registry = getPrototypeBuildingMovementNodeRegistry(map);
        const registrySize = registry instanceof Map ? registry.size : 0;
        if (
            state.movementBlockersDirty === true ||
            Number(state.movementBlockerNodeRegistrySize) !== registrySize ||
            !(state.movementBlockersByPlacementId instanceof Map) ||
            state.movementBlockersByPlacementId.size === 0
        ) {
            syncPrototypeBuildingMovementBlockers(map);
        }
        if (!(state.movementBlockersByPlacementId instanceof Map)) return [];
        const layer = Number.isFinite(Number(traversalLayer)) ? Math.round(Number(traversalLayer)) : 0;
        const out = [];
        const seen = options && options.seen instanceof Set ? options.seen : null;
        for (const blockers of state.movementBlockersByPlacementId.values()) {
            if (!Array.isArray(blockers)) continue;
            for (let i = 0; i < blockers.length; i++) {
                const blocker = blockers[i];
                if (!blocker || blocker.gone) continue;
                const blockerLayer = Number.isFinite(Number(blocker.traversalLayer))
                    ? Math.round(Number(blocker.traversalLayer))
                    : (Number.isFinite(Number(blocker.level)) ? Math.round(Number(blocker.level)) : 0);
                if (blockerLayer !== layer) continue;
                if (seen && seen.has(blocker)) continue;
                if (!boundsOverlap(queryBounds, boundsFromHitbox(blocker.groundPlaneHitbox))) continue;
                if (seen) seen.add(blocker);
                out.push(blocker);
            }
        }
        return out;
    }

    function markPrototypeBuildingMovementBlockersDirty(map) {
        const state = map && map._prototypeBuildingState;
        if (!state) return;
        state.movementBlockersDirty = true;
    }

    function polygonFromTileCoordKeys(asset) {
        const keys = Array.isArray(asset && asset.tileCoordKeys) ? asset.tileCoordKeys : [];
        if (keys.length === 0) return [];
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (let i = 0; i < keys.length; i++) {
            const parts = String(keys[i]).split(",");
            const xi = Number(parts[0]);
            const yi = Number(parts[1]);
            if (!Number.isFinite(xi) || !Number.isFinite(yi)) continue;
            const wx = xi * 0.866;
            const wy = yi + (xi % 2 === 0 ? 0.5 : 0);
            minX = Math.min(minX, wx);
            minY = Math.min(minY, wy);
            maxX = Math.max(maxX, wx);
            maxY = Math.max(maxY, wy);
        }
        if (!Number.isFinite(minX)) return [];
        return [
            { x: minX, y: minY },
            { x: maxX, y: minY },
            { x: maxX, y: maxY },
            { x: minX, y: maxY }
        ];
    }

    function getSectionAssetPolygon(map, asset) {
        if (Array.isArray(asset && asset.sectionPolygon) && asset.sectionPolygon.length >= 3) {
            return normalizePolygon(asset.sectionPolygon, `section ${asset.key || asset.id || "(unknown)"} polygon`);
        }
        const sectionGeometry = globalScope.__sectionGeometry || null;
        const state = map && map._prototypeSectionState;
        if (
            sectionGeometry &&
            typeof sectionGeometry.getSectionHexagonCorners === "function" &&
            asset &&
            asset.centerAxial &&
            state &&
            state.basis
        ) {
            return sectionGeometry.getSectionHexagonCorners(asset.centerAxial, state.basis);
        }
        return polygonFromTileCoordKeys(asset);
    }

    function computeOverlappedSectionKeysForFootprint(map, footprintPolygons) {
        const state = map && map._prototypeSectionState;
        const assets = Array.isArray(state && state.orderedSectionAssets) ? state.orderedSectionAssets : [];
        const footprints = normalizeFootprintPolygons(footprintPolygons);
        const footprintBounds = footprints.map(boundsForPolygon);
        const keys = [];
        for (let i = 0; i < assets.length; i++) {
            const asset = assets[i];
            if (!asset || typeof asset.key !== "string" || !asset.key) continue;
            const sectionPolygon = getSectionAssetPolygon(map, asset);
            if (!Array.isArray(sectionPolygon) || sectionPolygon.length < 3) continue;
            const sectionBounds = boundsForPolygon(sectionPolygon);
            if (footprintBounds.some((bounds) => boundsOverlap(bounds, sectionBounds))) {
                keys.push(asset.key);
            }
        }
        return keys;
    }

    function createPrototypeBuildingState(records = []) {
        return {
            placementsById: new Map(),
            orderedPlacements: [],
            buildingInstancesById: new Map(),
            buildingDataByInstanceId: new Map(),
            buildingIdsBySectionKey: new Map(),
            loadedBuildingsById: new Map(),
            desiredBuildingIds: new Set(),
            pendingLoadsById: new Map(),
            buildingDataBySaveName: new Map(),
            pendingBuildingDataBySaveName: new Map(),
            exteriorBitmapsById: new Map(),
            pendingExteriorBitmapLoadsById: new Map(),
            interiorBitmapsByKey: new Map(),
            pendingInteriorBitmapLoadsByKey: new Map(),
            interiorBitmapObjectExclusionsByKey: new Map(),
            movementBlockersByPlacementId: new Map(),
            movementEdgeBlockersByPlacementId: new Map(),
            pendingMovementGeometryByPlacementId: new Map(),
            cutawayBuildingsByPlacementId: new Map(),
            runtimeFloorFragmentIdsByPlacementId: new Map(),
            runtimeStairIdsByPlacementId: new Map(),
            currentWorldScope: { type: "sectionWorld" },
            lastCutawayGeometryStats: null,
            lastGeometryRuntimeStats: null,
            movementBlockersDirty: true,
            movementBlockerNodeRegistrySize: 0,
            lastIndexStats: null,
            lastSyncStats: null,
            lastMovementBlockerStats: null,
            lastMovementBlockerError: null,
            lastSectionRefStats: null,
            hasActiveBuildingSelection: false,
            activeDesiredSignature: null,
            dirtyWorldUnits: {
                sections: new Set(),
                buildings: new Set()
            },
            contentVersion: 1,
            nextPlacementSerial: 1,
            rawPlacements: Array.isArray(records) ? records.slice() : []
        };
    }

    function rebuildBuildingPlacementIndex(map) {
        const state = map && map._prototypeBuildingState;
        if (!state) return null;
        state.buildingIdsBySectionKey = new Map();
        let indexed = 0;
        for (let i = 0; i < state.orderedPlacements.length; i++) {
            const placement = state.orderedPlacements[i];
            const keys = normalizeSectionKeys(placement.touchedSectionKeys || placement.overlappedSectionKeys);
            for (let k = 0; k < keys.length; k++) {
                if (!state.buildingIdsBySectionKey.has(keys[k])) {
                    state.buildingIdsBySectionKey.set(keys[k], new Set());
                }
                state.buildingIdsBySectionKey.get(keys[k]).add(placement.id);
                indexed += 1;
            }
        }
        state.lastIndexStats = {
            placements: state.orderedPlacements.length,
            sectionLinks: indexed
        };
        return state.lastIndexStats;
    }

    function syncPrototypeBuildingPlacementRefsToSections(map) {
        const buildingState = map && map._prototypeBuildingState;
        const sectionState = map && map._prototypeSectionState;
        const assets = Array.isArray(sectionState && sectionState.orderedSectionAssets)
            ? sectionState.orderedSectionAssets
            : [];
        if (!buildingState || assets.length === 0) return { sections: 0, refs: 0 };
        const assetsByKey = sectionState.sectionAssetsByKey instanceof Map
            ? sectionState.sectionAssetsByKey
            : new Map(assets.map((asset) => [asset && asset.key, asset]).filter((entry) => entry[0]));
        for (let i = 0; i < assets.length; i++) {
            if (assets[i]) assets[i].buildingRefs = [];
        }
        let refs = 0;
        const placements = Array.isArray(buildingState.orderedPlacements) ? buildingState.orderedPlacements : [];
        for (let i = 0; i < placements.length; i++) {
            const placement = placements[i];
            if (!placement || !placement.id) continue;
            const keys = normalizeSectionKeys(placement.touchedSectionKeys || placement.overlappedSectionKeys);
            const ref = cloneBuildingPlacementRef(placement);
            for (let k = 0; k < keys.length; k++) {
                const sectionKey = keys[k];
                const asset = assetsByKey.get(sectionKey);
                if (!asset) {
                    throw new Error(`building placement ${placement.id} references missing section ${sectionKey}`);
                }
                if (!Array.isArray(asset.buildingRefs)) asset.buildingRefs = [];
                asset.buildingRefs.push({ ...ref });
                refs += 1;
            }
        }
        buildingState.lastSectionRefStats = { sections: assets.length, refs };
        return buildingState.lastSectionRefStats;
    }

    function isPrototypeBuildingPlacementCurrentWorldScope(state, placementOrId) {
        if (!state || !placementOrId) return false;
        const placementId = typeof placementOrId === "string"
            ? placementOrId
            : (typeof placementOrId.id === "string" ? placementOrId.id : "");
        if (!placementId) return false;
        const scope = normalizePrototypeWorldScope(state.currentWorldScope);
        return scope.type === "building" && scope.id === placementId;
    }

    function isPrototypeBuildingPlacementDesired(state, placement) {
        if (!placement || !placement.id) return false;
        if (isPrototypeBuildingPlacementCurrentWorldScope(state, placement)) return true;
        if (!state || state.hasActiveBuildingSelection !== true) return true;
        return state.desiredBuildingIds instanceof Set && state.desiredBuildingIds.has(placement.id);
    }

    function destroyPrototypeBuildingPlacementBitmapEntries(state, placementId) {
        if (!state || !placementId) return;
        if (state.exteriorBitmapsById instanceof Map) {
            const exteriorEntry = state.exteriorBitmapsById.get(placementId);
            destroyPrototypeBuildingBitmapEntry(exteriorEntry);
            state.exteriorBitmapsById.delete(placementId);
        }
        if (state.pendingExteriorBitmapLoadsById instanceof Map) {
            state.pendingExteriorBitmapLoadsById.delete(placementId);
        }
        if (state.interiorBitmapsByKey instanceof Map) {
            for (const [key, entry] of Array.from(state.interiorBitmapsByKey.entries())) {
                if (!key.startsWith(`${placementId}|`)) continue;
                destroyPrototypeBuildingBitmapEntry(entry);
                state.interiorBitmapsByKey.delete(key);
            }
        }
        if (state.pendingInteriorBitmapLoadsByKey instanceof Map) {
            for (const key of Array.from(state.pendingInteriorBitmapLoadsByKey.keys())) {
                if (key.startsWith(`${placementId}|`)) state.pendingInteriorBitmapLoadsByKey.delete(key);
            }
        }
        if (state.cutawayBuildingsByPlacementId instanceof Map) {
            state.cutawayBuildingsByPlacementId.delete(placementId);
        }
    }

    function translateBuildingPlacementPolygons(polygons, dx, dy, label) {
        if (!Array.isArray(polygons)) return polygons;
        return polygons.map((entry, index) => {
            if (Array.isArray(entry)) {
                return normalizePolygon(entry, `${label} ${index}`).map((point) => ({
                    x: point.x + dx,
                    y: point.y + dy
                }));
            }
            if (entry && typeof entry === "object" && Array.isArray(entry.polygon)) {
                return {
                    ...entry,
                    polygon: normalizePolygon(entry.polygon, `${label} ${index} polygon`).map((point) => ({
                        x: point.x + dx,
                        y: point.y + dy
                    }))
                };
            }
            throw new Error(`${label} ${index} must be a polygon or movement blocker entry`);
        });
    }

    function clearPrototypeBuildingGeometryRuntime(map, placementId, options = {}) {
        const state = map && map._prototypeBuildingState;
        if (!state || !placementId) return 0;
        if (!(state.runtimeFloorFragmentIdsByPlacementId instanceof Map)) {
            state.runtimeFloorFragmentIdsByPlacementId = new Map();
        }
        if (!(state.runtimeStairIdsByPlacementId instanceof Map)) {
            state.runtimeStairIdsByPlacementId = new Map();
        }
        let removed = 0;
        const fragmentIds = state.runtimeFloorFragmentIdsByPlacementId.get(placementId) || [];
        if (fragmentIds.length > 0) {
            if (typeof map.unregisterFloorFragments !== "function") {
                throw new Error(`building placement ${placementId} cannot clear runtime floors without unregisterFloorFragments`);
            }
            removed += map.unregisterFloorFragments(fragmentIds, {
                removeAttachedObjects: options.removeAttachedObjects === true
            });
        }
        state.runtimeFloorFragmentIdsByPlacementId.delete(placementId);
        const stairIds = state.runtimeStairIdsByPlacementId.get(placementId) || [];
        if (stairIds.length > 0) {
            if (!(map.stairsById instanceof Map)) {
                throw new Error(`building placement ${placementId} cannot clear runtime stairs without stairsById`);
            }
            for (let i = 0; i < stairIds.length; i++) {
                if (map.stairsById.delete(stairIds[i])) removed += 1;
            }
        }
        state.runtimeStairIdsByPlacementId.delete(placementId);
        return removed;
    }

    function getPrototypeBuildingNeighborOffsetsForColumn(x) {
        const isEven = Number(x) % 2 === 0;
        if (isEven) {
            return [
                { x: -2, y: 0 }, { x: -1, y: 0 }, { x: -1, y: -1 },
                { x: 0, y: -1 }, { x: 1, y: -1 }, { x: 1, y: 0 },
                { x: 2, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 2 },
                { x: 0, y: 1 }, { x: -1, y: 2 }, { x: -1, y: 1 }
            ];
        }
        return [
            { x: -2, y: 0 }, { x: -1, y: -1 }, { x: -1, y: -2 },
            { x: 0, y: -1 }, { x: 1, y: -2 }, { x: 1, y: -1 },
            { x: 2, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 },
            { x: 0, y: 1 }, { x: -1, y: 1 }, { x: -1, y: 0 }
        ];
    }

    function getPrototypeBuildingNodeWorldPoint(xindex, yindex) {
        const xi = Number(xindex);
        const yi = Number(yindex);
        return {
            x: xi * 0.866,
            y: yi + (xi % 2 === 0 ? 0.5 : 0)
        };
    }

    function getPrototypeBuildingPolygonBounds(points) {
        if (!Array.isArray(points) || points.length < 3) return null;
        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;
        for (let i = 0; i < points.length; i++) {
            const x = Number(points[i] && points[i].x);
            const y = Number(points[i] && points[i].y);
            if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
        }
        if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) return null;
        return { minX, maxX, minY, maxY };
    }

    function getPrototypeBuildingPointSegmentDistanceSq(px, py, ax, ay, bx, by) {
        const abx = bx - ax;
        const aby = by - ay;
        const lenSq = abx * abx + aby * aby;
        if (!(lenSq > 1e-12)) {
            const dx = px - ax;
            const dy = py - ay;
            return dx * dx + dy * dy;
        }
        const t = Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lenSq));
        const cx = ax + abx * t;
        const cy = ay + aby * t;
        const dx = px - cx;
        const dy = py - cy;
        return dx * dx + dy * dy;
    }

    function getPrototypeBuildingPointPolygonBoundaryDistanceSq(px, py, points) {
        if (!Array.isArray(points) || points.length < 3) return Infinity;
        let best = Infinity;
        for (let i = 0; i < points.length; i++) {
            const a = points[i];
            const b = points[(i + 1) % points.length];
            const ax = Number(a && a.x);
            const ay = Number(a && a.y);
            const bx = Number(b && b.x);
            const by = Number(b && b.y);
            if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) continue;
            best = Math.min(best, getPrototypeBuildingPointSegmentDistanceSq(px, py, ax, ay, bx, by));
        }
        return best;
    }

    function getPrototypeBuildingFloorNodeClearance(fragment, x, y) {
        const outer = Array.isArray(fragment && fragment.outerPolygon) ? fragment.outerPolygon : null;
        if (!outer || outer.length < 3) return Infinity;
        let distanceSq = getPrototypeBuildingPointPolygonBoundaryDistanceSq(x, y, outer);
        const holes = Array.isArray(fragment.holes) ? fragment.holes : [];
        for (let i = 0; i < holes.length; i++) {
            if (Array.isArray(holes[i]) && holes[i].length >= 3) {
                distanceSq = Math.min(distanceSq, getPrototypeBuildingPointPolygonBoundaryDistanceSq(x, y, holes[i]));
            }
        }
        if (!Number.isFinite(distanceSq)) return Infinity;
        const distance = Math.sqrt(distanceSq);
        if (distance < 0.5) return -1;
        return Math.max(1, Math.floor(distance / 0.5));
    }

    function getPrototypeBuildingFloorNodeCtor(map) {
        if (map && map.nodes && map.nodes[0] && map.nodes[0][0] && typeof map.nodes[0][0].constructor === "function") {
            return map.nodes[0][0].constructor;
        }
        const sectionState = map && map._prototypeSectionState;
        if (sectionState && Array.isArray(sectionState.allNodes) && sectionState.allNodes.length > 0) {
            const node = sectionState.allNodes[0];
            if (node && typeof node.constructor === "function") return node.constructor;
        }
        return null;
    }

    function ensurePrototypeBuildingFloorNodeMethods(node) {
        if (!node || typeof node !== "object") return node;
        const doesBlockTile = (obj) => (
            typeof globalScope.doesObjectBlockTile === "function"
                ? globalScope.doesObjectBlockTile(obj)
                : !!(obj && !obj.gone && obj.blocksTile !== false)
        );
        const recountBlockingObjects = function recountBlockingObjects() {
            let count = 0;
            if (Array.isArray(this.objects)) {
                for (let i = 0; i < this.objects.length; i++) {
                    if (doesBlockTile(this.objects[i])) count += 1;
                }
            }
            this.blockedByObjects = count;
        };
        if (typeof node.addObject !== "function") {
            node.addObject = function addObject(obj) {
                if (!obj) return;
                if (!Array.isArray(this.objects)) this.objects = [];
                if (!this.objects.includes(obj)) {
                    this.objects.push(obj);
                    if (doesBlockTile(obj)) {
                        this.blockedByObjects = Math.max(0, Number(this.blockedByObjects) || 0) + 1;
                    }
                }
            };
        }
        if (typeof node.removeObject !== "function") {
            node.removeObject = function removeObject(obj) {
                if (!Array.isArray(this.objects)) return;
                const index = this.objects.indexOf(obj);
                if (index >= 0) {
                    const removed = this.objects[index];
                    this.objects.splice(index, 1);
                    if (doesBlockTile(removed)) {
                        this.blockedByObjects = Math.max(0, (Number(this.blockedByObjects) || 0) - 1);
                    }
                }
            };
        }
        if (typeof node.recountBlockingObjects !== "function") {
            node.recountBlockingObjects = recountBlockingObjects;
        }
        if (typeof node.addVisibilityObject !== "function") {
            node.addVisibilityObject = function addVisibilityObject(obj) {
                if (!obj) return;
                if (!Array.isArray(this.visibilityObjects)) this.visibilityObjects = [];
                if (!this.visibilityObjects.includes(obj)) this.visibilityObjects.push(obj);
            };
        }
        if (typeof node.removeVisibilityObject !== "function") {
            node.removeVisibilityObject = function removeVisibilityObject(obj) {
                if (!Array.isArray(this.visibilityObjects)) return;
                const index = this.visibilityObjects.indexOf(obj);
                if (index >= 0) this.visibilityObjects.splice(index, 1);
            };
        }
        if (typeof node.hasObjects !== "function") {
            node.hasObjects = function hasObjects() {
                return !!(this.objects && this.objects.length > 0);
            };
        }
        if (typeof node.hasBlockingObject !== "function") {
            node.hasBlockingObject = function hasBlockingObject() {
                if (this.blockedByObjects <= 0) return false;
                if (!Array.isArray(this.objects)) return false;
                for (let i = 0; i < this.objects.length; i++) {
                    if (doesBlockTile(this.objects[i])) return true;
                }
                return false;
            };
        }
        if (typeof node.isBlocked !== "function") {
            node.isBlocked = function isBlocked() {
                return !!(this.blocked || (typeof this.hasBlockingObject === "function" && this.hasBlockingObject()));
            };
        }
        return node;
    }

    function createPrototypeBuildingFloorNode(map, placement, fragment, xindex, yindex) {
        if (!map || !placement || !fragment || typeof map.registerFloorNode !== "function" || typeof map.getFloorNodeKey !== "function") {
            return null;
        }
        const xi = Number(xindex);
        const yi = Number(yindex);
        if (!Number.isFinite(xi) || !Number.isFinite(yi)) return null;
        const nodeKey = map.getFloorNodeKey(xi, yi, fragment.surfaceId, fragment.fragmentId);
        const existingNode = map.floorNodeIndex instanceof Map ? (map.floorNodeIndex.get(nodeKey) || null) : null;
        if (existingNode) return existingNode;
        const NodeCtor = getPrototypeBuildingFloorNodeCtor(map);
        const node = NodeCtor ? new NodeCtor(xi, yi, 1, 1) : {};
        const point = getPrototypeBuildingNodeWorldPoint(xi, yi);
        const layer = Number.isFinite(Number(fragment.level)) ? Math.round(Number(fragment.level)) : 0;
        if (!Number.isFinite(Number(fragment.nodeBaseZ))) {
            throw new Error(`prototype building floor node fragment ${fragment.fragmentId || "(unknown)"} requires nodeBaseZ`);
        }
        const baseZ = Number(fragment.nodeBaseZ);
        node.xindex = xi;
        node.yindex = yi;
        node.x = point.x;
        node.y = point.y;
        node.surfaceId = typeof fragment.surfaceId === "string" ? fragment.surfaceId : "";
        node.fragmentId = typeof fragment.fragmentId === "string" ? fragment.fragmentId : "";
        node.ownerSectionKey = typeof fragment.ownerSectionKey === "string" ? fragment.ownerSectionKey : placement.id;
        node.level = layer;
        node.traversalLayer = layer;
        node.baseZ = baseZ;
        node.portalEdges = [];
        node.neighbors = new Array(12).fill(null);
        node.neighborOffsets = getPrototypeBuildingNeighborOffsetsForColumn(xi);
        node.blockedNeighbors = new Map();
        node.objects = [];
        node.visibilityObjects = [];
        node.blockedByObjects = 0;
        node.blocked = false;
        node.clearance = getPrototypeBuildingFloorNodeClearance(fragment, point.x, point.y);
        node._prototypeBuildingFloorNode = true;
        node._prototypeOwnerType = "building";
        node._prototypeOwnerId = placement.id;
        node._prototypeSectionActive = true;
        node._prototypeVoid = false;
        ensurePrototypeBuildingFloorNodeMethods(node);
        const registered = map.registerFloorNode(node, fragment);
        if (!registered) {
            throw new Error(`building placement ${placement.id} failed to register floor node ${nodeKey}`);
        }
        return registered;
    }

    function materializePrototypeBuildingFloorNodesForFragment(map, placement, fragment, materializedNodes) {
        if (!map || !placement || !fragment || !Array.isArray(materializedNodes)) return 0;
        const polygon = Array.isArray(fragment.outerPolygon) ? fragment.outerPolygon : [];
        if (polygon.length < 3) return 0;
        const bounds = getPrototypeBuildingPolygonBounds(polygon);
        if (!bounds) return 0;
        const minXi = Math.floor(bounds.minX / 0.866) - 3;
        const maxXi = Math.ceil(bounds.maxX / 0.866) + 3;
        const minYi = Math.floor(bounds.minY) - 3;
        const maxYi = Math.ceil(bounds.maxY) + 3;
        const materializedNodeKeys = [];
        let floorNodes = 0;
        for (let xi = minXi; xi <= maxXi; xi++) {
            for (let yi = minYi; yi <= maxYi; yi++) {
                const point = getPrototypeBuildingNodeWorldPoint(xi, yi);
                if (!map.isPointSupportedByFloorFragment(fragment, point.x, point.y)) continue;
                const floorNode = createPrototypeBuildingFloorNode(map, placement, fragment, xi, yi);
                if (!floorNode) {
                    throw new Error(`building placement ${placement.id} failed to materialize floor node ${xi},${yi},${fragment.fragmentId}`);
                }
                materializedNodes.push(floorNode);
                materializedNodeKeys.push(`${xi},${yi}`);
                floorNodes += 1;
            }
        }
        fragment.materializedNodeKeys = materializedNodeKeys;
        return floorNodes;
    }

    function materializePrototypeBuildingFloorNodes(map, placement, fragments) {
        if (
            !map ||
            !placement ||
            !Array.isArray(fragments) ||
            typeof map.registerFloorNode !== "function" ||
            typeof map.isPointSupportedByFloorFragment !== "function" ||
            typeof map.getFloorNodeKey !== "function"
        ) {
            return { floorNodes: 0 };
        }
        const materializedNodes = [];
        let floorNodes = 0;
        for (let f = 0; f < fragments.length; f++) {
            const fragment = fragments[f];
            if (!fragment || Math.round(Number(fragment.level) || 0) === 0) continue;
            floorNodes += materializePrototypeBuildingFloorNodesForFragment(map, placement, fragment, materializedNodes);
        }
        if (materializedNodes.length > 0) {
            const newNodeIdSet = new Set();
            for (let i = 0; i < materializedNodes.length; i++) {
                if (materializedNodes[i] && materializedNodes[i].id) newNodeIdSet.add(materializedNodes[i].id);
            }
            if (typeof map._connectFloorNodesIncremental === "function") {
                map._connectFloorNodesIncremental(materializedNodes, newNodeIdSet);
            } else if (typeof map.connectFloorNodeNeighbors === "function") {
                map.connectFloorNodeNeighbors();
            } else {
                throw new Error(`building placement ${placement.id} materialized floor nodes without a floor-node connector`);
            }
        }
        return { floorNodes };
    }

    function collectPrototypeBuildingRuntimeFloorObjects(map, placementId, fragmentIds) {
        const objects = new Set();
        const fragmentSet = new Set(Array.isArray(fragmentIds) ? fragmentIds : []);
        const addObject = (obj) => {
            if (!obj || obj.gone || obj.vanishing || obj._prototypeParked === true) return;
            const membership = obj._floorMembership && typeof obj._floorMembership === "object"
                ? obj._floorMembership
                : (obj.floorMembership && typeof obj.floorMembership === "object" ? obj.floorMembership : null);
            const ownsObject = !!(
                membership &&
                membership.ownerType === "building" &&
                membership.ownerId === placementId
            );
            const referencesFragment = !!(
                (typeof obj.fragmentId === "string" && fragmentSet.has(obj.fragmentId)) ||
                (obj.node && typeof obj.node.fragmentId === "string" && fragmentSet.has(obj.node.fragmentId))
            );
            if (ownsObject || referencesFragment) objects.add(obj);
        };
        if (map && map.floorNodesById instanceof Map) {
            for (const fragmentId of fragmentSet) {
                const nodes = map.floorNodesById.get(fragmentId);
                if (!Array.isArray(nodes)) continue;
                for (let i = 0; i < nodes.length; i++) {
                    const node = nodes[i];
                    const nodeObjects = Array.isArray(node && node.objects) ? node.objects : [];
                    for (let j = 0; j < nodeObjects.length; j++) addObject(nodeObjects[j]);
                    const visibilityObjects = Array.isArray(node && node.visibilityObjects) ? node.visibilityObjects : [];
                    for (let j = 0; j < visibilityObjects.length; j++) addObject(visibilityObjects[j]);
                }
            }
        }
        if (map && map._prototypeObjectState && map._prototypeObjectState.activeRuntimeObjectsByRecordId instanceof Map) {
            for (const obj of map._prototypeObjectState.activeRuntimeObjectsByRecordId.values()) addObject(obj);
        }
        if (map && Array.isArray(map.objects)) {
            for (let i = 0; i < map.objects.length; i++) addObject(map.objects[i]);
        }
        return Array.from(objects);
    }

    function getPrototypeBuildingObjectLabel(obj) {
        return obj && (obj.scriptingName || obj.objectType || obj.type) || "(unknown)";
    }

    function getPrototypeBuildingObjectFloorNodeSnapLimit(obj) {
        const radiusCandidates = [
            Number(obj && obj.groundRadius),
            Number(obj && obj.visualRadius),
            Number(obj && obj.groundPlaneHitbox && obj.groundPlaneHitbox.radius),
            Number(obj && obj.visualHitbox && obj.visualHitbox.radius),
            Number(obj && obj.width) * 0.5,
            Number(obj && obj.height) * 0.5
        ].filter((value) => Number.isFinite(value) && value > 0);
        const radius = radiusCandidates.length > 0 ? Math.max(...radiusCandidates) : 0.5;
        return Math.max(1.5, radius + 1.25);
    }

    function findNearestPrototypeBuildingFloorNode(map, fragment, obj, layer) {
        if (!map || !fragment || !(map.floorNodesById instanceof Map)) return null;
        const nodes = map.floorNodesById.get(fragment.fragmentId);
        if (!Array.isArray(nodes) || nodes.length === 0) return null;
        const x = Number(obj && obj.x);
        const y = Number(obj && obj.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        let best = null;
        let bestDistanceSq = Infinity;
        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];
            if (!node) continue;
            const nodeLayer = Number.isFinite(Number(node.traversalLayer))
                ? Math.round(Number(node.traversalLayer))
                : (Number.isFinite(Number(node.level)) ? Math.round(Number(node.level)) : 0);
            if (nodeLayer !== layer) continue;
            const dx = Number(node.x) - x;
            const dy = Number(node.y) - y;
            const distanceSq = dx * dx + dy * dy;
            if (distanceSq < bestDistanceSq) {
                best = node;
                bestDistanceSq = distanceSq;
            }
        }
        if (!best) return null;
        const snapLimit = getPrototypeBuildingObjectFloorNodeSnapLimit(obj);
        if (bestDistanceSq > snapLimit * snapLimit) return null;
        return best;
    }

    function roundPrototypeBuildingDiagnosticNumber(value) {
        const number = Number(value);
        if (!Number.isFinite(number)) return null;
        return Math.round(number * 1000) / 1000;
    }

    function getPrototypeBuildingDiagnosticBounds(points) {
        const bounds = getPrototypeBuildingPolygonBounds(points);
        if (!bounds) return null;
        return {
            minX: roundPrototypeBuildingDiagnosticNumber(bounds.minX),
            minY: roundPrototypeBuildingDiagnosticNumber(bounds.minY),
            maxX: roundPrototypeBuildingDiagnosticNumber(bounds.maxX),
            maxY: roundPrototypeBuildingDiagnosticNumber(bounds.maxY)
        };
    }

    function getPrototypeBuildingHitboxDiagnostic(hitbox) {
        if (!hitbox || typeof hitbox !== "object") return null;
        const out = {
            type: typeof hitbox.type === "string" ? hitbox.type : ""
        };
        if (Number.isFinite(Number(hitbox.x))) out.x = roundPrototypeBuildingDiagnosticNumber(hitbox.x);
        if (Number.isFinite(Number(hitbox.y))) out.y = roundPrototypeBuildingDiagnosticNumber(hitbox.y);
        if (Number.isFinite(Number(hitbox.radius))) out.radius = roundPrototypeBuildingDiagnosticNumber(hitbox.radius);
        if (typeof hitbox.getBounds === "function") {
            const bounds = hitbox.getBounds();
            if (bounds) {
                out.bounds = {
                    minX: roundPrototypeBuildingDiagnosticNumber(bounds.minX),
                    minY: roundPrototypeBuildingDiagnosticNumber(bounds.minY),
                    maxX: roundPrototypeBuildingDiagnosticNumber(bounds.maxX),
                    maxY: roundPrototypeBuildingDiagnosticNumber(bounds.maxY)
                };
            }
        }
        return out;
    }

    function findNearestPrototypeBuildingFloorNodeDiagnostic(map, fragment, obj, layer) {
        if (!map || !fragment || !(map.floorNodesById instanceof Map)) return null;
        const nodes = map.floorNodesById.get(fragment.fragmentId);
        if (!Array.isArray(nodes) || nodes.length === 0) return null;
        const x = Number(obj && obj.x);
        const y = Number(obj && obj.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        let best = null;
        let bestDistanceSq = Infinity;
        for (let i = 0; i < nodes.length; i++) {
            const node = nodes[i];
            if (!node) continue;
            const nodeLayer = Number.isFinite(Number(node.traversalLayer))
                ? Math.round(Number(node.traversalLayer))
                : (Number.isFinite(Number(node.level)) ? Math.round(Number(node.level)) : 0);
            if (nodeLayer !== layer) continue;
            const dx = Number(node.x) - x;
            const dy = Number(node.y) - y;
            const distanceSq = dx * dx + dy * dy;
            if (distanceSq < bestDistanceSq) {
                best = node;
                bestDistanceSq = distanceSq;
            }
        }
        if (!best) return null;
        return {
            id: best.id || "",
            xindex: Number(best.xindex),
            yindex: Number(best.yindex),
            x: roundPrototypeBuildingDiagnosticNumber(best.x),
            y: roundPrototypeBuildingDiagnosticNumber(best.y),
            traversalLayer: Number.isFinite(Number(best.traversalLayer)) ? Math.round(Number(best.traversalLayer)) : null,
            surfaceId: best.surfaceId || "",
            fragmentId: best.fragmentId || "",
            clearance: Number.isFinite(Number(best.clearance)) ? Number(best.clearance) : null,
            neighborCount: Array.isArray(best.neighbors) ? best.neighbors.filter(Boolean).length : 0,
            distance: roundPrototypeBuildingDiagnosticNumber(Math.sqrt(bestDistanceSq)),
            distanceSq: roundPrototypeBuildingDiagnosticNumber(bestDistanceSq),
            withinSnapLimit: bestDistanceSq <= getPrototypeBuildingObjectFloorNodeSnapLimit(obj) * getPrototypeBuildingObjectFloorNodeSnapLimit(obj)
        };
    }

    function getPrototypeBuildingRehomeFailureDiagnostic(map, placementId, obj, fragment, baseNode, layer) {
        const nodes = map && map.floorNodesById instanceof Map && fragment
            ? (map.floorNodesById.get(fragment.fragmentId) || [])
            : [];
        const membership = obj && obj._floorMembership && typeof obj._floorMembership === "object"
            ? obj._floorMembership
            : (obj && obj.floorMembership && typeof obj.floorMembership === "object" ? obj.floorMembership : null);
        const expectedKey = map && typeof map.getFloorNodeKey === "function" && baseNode && fragment
            ? map.getFloorNodeKey(baseNode.xindex, baseNode.yindex, fragment.surfaceId, fragment.fragmentId)
            : "";
        return {
            placementId,
            object: {
                label: getPrototypeBuildingObjectLabel(obj),
                type: obj && obj.type || "",
                objectType: obj && obj.objectType || "",
                category: obj && obj.category || "",
                scriptingName: obj && obj.scriptingName || "",
                texturePath: obj && obj.texturePath || "",
                x: roundPrototypeBuildingDiagnosticNumber(obj && obj.x),
                y: roundPrototypeBuildingDiagnosticNumber(obj && obj.y),
                width: roundPrototypeBuildingDiagnosticNumber(obj && obj.width),
                height: roundPrototypeBuildingDiagnosticNumber(obj && obj.height),
                groundRadius: roundPrototypeBuildingDiagnosticNumber(obj && obj.groundRadius),
                visualRadius: roundPrototypeBuildingDiagnosticNumber(obj && obj.visualRadius),
                traversalLayer: Number.isFinite(Number(obj && obj.traversalLayer)) ? Math.round(Number(obj.traversalLayer)) : null,
                level: Number.isFinite(Number(obj && obj.level)) ? Math.round(Number(obj.level)) : null,
                fragmentId: obj && obj.fragmentId || "",
                surfaceId: obj && obj.surfaceId || "",
                membership,
                groundPlaneHitbox: getPrototypeBuildingHitboxDiagnostic(obj && obj.groundPlaneHitbox),
                visualHitbox: getPrototypeBuildingHitboxDiagnostic(obj && obj.visualHitbox)
            },
            baseNode: baseNode ? {
                id: baseNode.id || "",
                xindex: Number(baseNode.xindex),
                yindex: Number(baseNode.yindex),
                x: roundPrototypeBuildingDiagnosticNumber(baseNode.x),
                y: roundPrototypeBuildingDiagnosticNumber(baseNode.y),
                traversalLayer: Number.isFinite(Number(baseNode.traversalLayer)) ? Math.round(Number(baseNode.traversalLayer)) : null
            } : null,
            floor: fragment ? {
                fragmentId: fragment.fragmentId || "",
                surfaceId: fragment.surfaceId || "",
                sourceFloorId: fragment._prototypeBuildingSourceFragmentId || "",
                ownerId: fragment.ownerId || "",
                ownerSectionKey: fragment.ownerSectionKey || "",
                level: Number.isFinite(Number(fragment.level)) ? Math.round(Number(fragment.level)) : null,
                nodeBaseZ: roundPrototypeBuildingDiagnosticNumber(fragment.nodeBaseZ),
                bounds: getPrototypeBuildingDiagnosticBounds(fragment.outerPolygon),
                holeBounds: Array.isArray(fragment.holes)
                    ? fragment.holes.map((hole) => getPrototypeBuildingDiagnosticBounds(hole)).filter(Boolean)
                    : [],
                objectPointInside: !!(map && typeof map.isPointSupportedByFloorFragment === "function" && obj && map.isPointSupportedByFloorFragment(fragment, obj.x, obj.y)),
                materializedNodeKeyCount: Array.isArray(fragment.materializedNodeKeys) ? fragment.materializedNodeKeys.length : 0,
                registeredNodeCount: Array.isArray(nodes) ? nodes.length : 0
            } : null,
            expectedNodeKey: expectedKey,
            expectedNodeIndexed: !!(expectedKey && map && map.floorNodeIndex instanceof Map && map.floorNodeIndex.has(expectedKey)),
            snapLimit: roundPrototypeBuildingDiagnosticNumber(getPrototypeBuildingObjectFloorNodeSnapLimit(obj)),
            nearestNode: findNearestPrototypeBuildingFloorNodeDiagnostic(map, fragment, obj, layer)
        };
    }

    function deleteUnrehomeablePrototypeBuildingRuntimeFloorObject(map, placementId, obj, diagnostic) {
        const objectState = map && map._prototypeObjectState;
        const buildingState = map && map._prototypeBuildingState;
        const recordId = Number.isInteger(Number(obj && obj._prototypeRecordId))
            ? Number(obj._prototypeRecordId)
            : (Number.isInteger(Number(obj && obj._prototypeRecord && obj._prototypeRecord.id))
                ? Number(obj._prototypeRecord.id)
                : NaN);
        console.warn("[prototype building floor object quarantine] deleting unrehomeable object", diagnostic);
        if (objectState && objectState.activeRuntimeObjectsByRecordId instanceof Map) {
            if (Number.isInteger(recordId)) {
                objectState.activeRuntimeObjectsByRecordId.delete(recordId);
            } else {
                for (const [candidateId, runtimeObj] of objectState.activeRuntimeObjectsByRecordId.entries()) {
                    if (runtimeObj === obj) objectState.activeRuntimeObjectsByRecordId.delete(candidateId);
                }
            }
            objectState.activeRuntimeObjects = Array.from(objectState.activeRuntimeObjectsByRecordId.values());
        }
        if (objectState && objectState.parkedRuntimeObjectsByRecordId instanceof Map && Number.isInteger(recordId)) {
            objectState.parkedRuntimeObjectsByRecordId.delete(recordId);
        }
        if (objectState && objectState.dirtyRuntimeObjects instanceof Set) {
            objectState.dirtyRuntimeObjects.delete(obj);
        }
        if (buildingState && buildingState.buildingInstancesById instanceof Map && Number.isInteger(recordId)) {
            const instance = buildingState.buildingInstancesById.get(placementId) || null;
            const records = Array.isArray(instance && instance.objects) ? instance.objects : null;
            if (records) {
                const nextRecords = records.filter((record) => Number(record && record.id) !== recordId);
                if (nextRecords.length !== records.length) {
                    instance.objects = nextRecords;
                    instance.contentVersion = (Number(instance.contentVersion) || 1) + 1;
                    const placement = buildingState.placementsById instanceof Map
                        ? buildingState.placementsById.get(placementId) || null
                        : null;
                    if (placement) placement.contentVersion = instance.contentVersion;
                    markPrototypeBuildingUnitDirty(buildingState, placementId);
                }
            }
        }
        if (typeof obj.removeFromGame === "function") {
            obj.removeFromGame();
        } else {
            if (typeof obj.removeFromNodes === "function") obj.removeFromNodes();
            obj.gone = true;
            if (Array.isArray(map && map.objects)) {
                const index = map.objects.indexOf(obj);
                if (index >= 0) map.objects.splice(index, 1);
            }
        }
        if (typeof map.markFloorObjectNodeCacheDirty === "function") map.markFloorObjectNodeCacheDirty();
        if (typeof map.markBuildingRenderCacheDirty === "function") map.markBuildingRenderCacheDirty();
        return true;
    }

    function rehomePrototypeBuildingRuntimeFloorObjects(map, placementId, objects) {
        if (!Array.isArray(objects) || objects.length === 0) return 0;
        if (typeof map.worldToNode !== "function" || typeof map.getFloorNodeAtLayer !== "function") {
            throw new Error(`building placement ${placementId} cannot rehome floor objects without floor-node lookup APIs`);
        }
        let rehomed = 0;
        for (let i = 0; i < objects.length; i++) {
            const obj = objects[i];
            if (!obj || obj.gone || obj.vanishing || obj._prototypeParked === true) continue;
            const membership = obj._floorMembership && typeof obj._floorMembership === "object"
                ? obj._floorMembership
                : (obj.floorMembership && typeof obj.floorMembership === "object" ? obj.floorMembership : null);
            const fragmentId = typeof obj.fragmentId === "string" && obj.fragmentId.length > 0
                ? obj.fragmentId
                : (membership && typeof membership.floorId === "string" ? `${placementId}:floor:${membership.floorId}` : "");
            const fragment = fragmentId && map.floorsById instanceof Map ? (map.floorsById.get(fragmentId) || null) : null;
            if (!fragment) {
                throw new Error(`building placement ${placementId} cannot rehome object ${getPrototypeBuildingObjectLabel(obj)} without runtime floor fragment ${fragmentId || "(missing)"}`);
            }
            const layer = Number.isFinite(Number(fragment.level))
                ? Math.round(Number(fragment.level))
                : (Number.isFinite(Number(obj.traversalLayer)) ? Math.round(Number(obj.traversalLayer)) : 0);
            if (layer <= 0) continue;
            const baseNode = map.worldToNode(obj.x, obj.y);
            let floorNode = baseNode ? map.getFloorNodeAtLayer(baseNode.xindex, baseNode.yindex, layer, {
                fragmentId: fragment.fragmentId,
                surfaceId: fragment.surfaceId,
                groundNode: baseNode,
                worldX: obj.x,
                worldY: obj.y,
                allowScan: true
            }) : null;
            if (!floorNode) {
                floorNode = findNearestPrototypeBuildingFloorNode(map, fragment, obj, layer);
            }
            if (!floorNode) {
                const diagnostic = getPrototypeBuildingRehomeFailureDiagnostic(map, placementId, obj, fragment, baseNode, layer);
                deleteUnrehomeablePrototypeBuildingRuntimeFloorObject(map, placementId, obj, diagnostic);
                continue;
            }
            obj.fragmentId = fragment.fragmentId;
            obj.surfaceId = fragment.surfaceId;
            obj.traversalLayer = layer;
            obj.level = layer;
            obj.currentLayer = layer;
            if (!Number.isFinite(Number(fragment.nodeBaseZ))) {
                throw new Error(`building placement ${placementId} object ${getPrototypeBuildingObjectLabel(obj)} requires fragment nodeBaseZ`);
            }
            obj.currentLayerBaseZ = Number(fragment.nodeBaseZ);
            obj._activeFloorFragment = fragment;
            if (typeof obj.refreshIndexedNodesFromHitbox === "function") {
                obj.refreshIndexedNodesFromHitbox({
                    traversalLayer: layer,
                    minExtent: 1.5,
                    sampleSpacing: 1.0,
                    fallbackNode: floorNode,
                    requireTraversalLayerNode: true
                });
            } else if (typeof obj.setIndexedNodes === "function") {
                obj.setIndexedNodes([floorNode], floorNode);
            } else if (typeof floorNode.addObject === "function") {
                floorNode.addObject(obj);
                obj.node = floorNode;
                obj._indexedNodes = [floorNode];
            }
            rehomed += 1;
        }
        return rehomed;
    }

    function syncPrototypeBuildingGeometryRuntime(map) {
        const state = map && map._prototypeBuildingState;
        if (!state || !Array.isArray(state.orderedPlacements)) return { placements: 0, floors: 0, stairs: 0, pending: 0 };
        if (!(state.runtimeFloorFragmentIdsByPlacementId instanceof Map)) {
            state.runtimeFloorFragmentIdsByPlacementId = new Map();
        }
        if (!(state.runtimeStairIdsByPlacementId instanceof Map)) {
            state.runtimeStairIdsByPlacementId = new Map();
        }
        let floors = 0;
        let floorNodes = 0;
        let floorObjectsRehomed = 0;
        let stairs = 0;
        let pending = 0;
        for (let i = 0; i < state.orderedPlacements.length; i++) {
            const placement = state.orderedPlacements[i];
            if (!placement || !placement.id) continue;
            if (!isPrototypeBuildingPlacementDesired(state, placement)) {
                clearPrototypeBuildingGeometryRuntime(map, placement.id);
                if (state.loadedBuildingsById instanceof Map) state.loadedBuildingsById.delete(placement.id);
                continue;
            }
            const buildingData = getBuildingDataForPlacement(state, placement);
            const previousFragmentIds = state.runtimeFloorFragmentIdsByPlacementId.get(placement.id) || [];
            const floorObjectsToRehome = collectPrototypeBuildingRuntimeFloorObjects(map, placement.id, previousFragmentIds);
            clearPrototypeBuildingGeometryRuntime(map, placement.id);
            if (!buildingData) {
                pending += 1;
                continue;
            }
            if (typeof map.registerFloorFragment !== "function") {
                throw new Error("building geometry runtime requires registerFloorFragment");
            }
            if (typeof map.registerStairRuntimeRecord !== "function") {
                throw new Error("building geometry runtime requires registerStairRuntimeRecord");
            }
            assignBuildingFloorRuntimeTraversalLayers(buildingData);
            const interiorPolygonsByFloor = computeInteriorPolygonsByFloor(buildingData, placement);
            const fragments = [];
            for (let f = 0; f < buildingData.floorFragments.length; f++) {
                const fragment = createPrototypeBuildingFragment(placement, buildingData.floorFragments[f], f, interiorPolygonsByFloor);
                const registered = map.registerFloorFragment(fragment);
                if (!registered) throw new Error(`building placement ${placement.id} failed to register floor ${fragment.fragmentId}`);
                fragments.push(registered);
            }
            const nodeStats = materializePrototypeBuildingFloorNodes(map, placement, fragments);
            floorNodes += Number(nodeStats.floorNodes) || 0;
            const runtimeStairs = createPrototypeBuildingStairRuntimeRecords(buildingData, placement, fragments);
            const stairIds = [];
            for (let s = 0; s < runtimeStairs.length; s++) {
                const registeredStair = map.registerStairRuntimeRecord(runtimeStairs[s]);
                if (!registeredStair) throw new Error(`building placement ${placement.id} failed to register stair ${runtimeStairs[s].id}`);
                stairIds.push(registeredStair.id);
            }
            state.runtimeFloorFragmentIdsByPlacementId.set(placement.id, fragments.map((fragment) => fragment.fragmentId));
            state.runtimeStairIdsByPlacementId.set(placement.id, stairIds);
            if (state.loadedBuildingsById instanceof Map) state.loadedBuildingsById.set(placement.id, placement);
            floors += fragments.length;
            floorObjectsRehomed += rehomePrototypeBuildingRuntimeFloorObjects(map, placement.id, floorObjectsToRehome);
            stairs += stairIds.length;
        }
        state.lastGeometryRuntimeStats = {
            placements: state.orderedPlacements.length,
            floors,
            floorNodes,
            floorObjectsRehomed,
            stairs,
            pending
        };
        return state.lastGeometryRuntimeStats;
    }

    function maybeSyncPrototypeBuildingGeometryRuntime(map) {
        if (
            map &&
            typeof map.registerFloorFragment === "function" &&
            typeof map.registerStairRuntimeRecord === "function"
        ) {
            return syncPrototypeBuildingGeometryRuntime(map);
        }
        return null;
    }

    function installSectionWorldBuildingApis(map) {
        if (!map) return null;

        map.initializePrototypeBuildingState = function initializePrototypeBuildingState(records = []) {
            const state = createPrototypeBuildingState(records);
            const normalized = [];
            const sourceRecords = Array.isArray(records) ? records : [];
            for (let i = 0; i < sourceRecords.length; i++) {
                const record = sourceRecords[i];
                if (record && record.schema === BUILDING_SAVE_SCHEMA && Array.isArray(record.floorFragments)) {
                    const instance = setBuildingInstanceRecord(state, record);
                    normalized.push(createPlacementFromBuildingInstance(instance, i));
                    continue;
                }
                if (record && record.buildingData && typeof record.buildingData === "object") {
                    const placement = normalizeBuildingPlacementRecord(record, i);
                    const instance = createBuildingInstanceFromEditorSave(record.buildingData, placement, {
                        footprintPolygons: placement.footprintPolygons,
                        movementBlockerPolygons: placement.movementBlockerPolygons,
                        touchedSectionKeys: placement.touchedSectionKeys || placement.overlappedSectionKeys,
                        loadState: placement.loadState,
                        contentVersion: placement.contentVersion
                    });
                    setBuildingInstanceRecord(state, instance);
                    normalized.push(createPlacementFromBuildingInstance(instance, i));
                    continue;
                }
                normalized.push(normalizeBuildingPlacementRecord(record, i));
            }
            const seen = new Set();
            normalized.forEach((placement) => {
                if (seen.has(placement.id)) {
                    throw new Error(`duplicate building placement id: ${placement.id}`);
                }
                seen.add(placement.id);
                state.placementsById.set(placement.id, placement);
                state.orderedPlacements.push(placement);
                const match = /^building:placed-(\d+)$/.exec(placement.id);
                if (match) {
                    state.nextPlacementSerial = Math.max(state.nextPlacementSerial, Number(match[1]) + 1);
                }
            });
            this._prototypeBuildingState = state;
            rebuildBuildingPlacementIndex(this);
            syncPrototypeBuildingPlacementRefsToSections(this);
            markPrototypeBuildingMovementBlockersDirty(this);
            if (hasPrototypeBuildingMovementNodeRegistry(this)) {
                syncPrototypeBuildingMovementBlockers(this);
            }
            return state;
        };

        map.exportPrototypeBuildingPlacements = function exportPrototypeBuildingPlacements() {
            const state = this._prototypeBuildingState;
            if (!state || !Array.isArray(state.orderedPlacements)) return [];
            syncPrototypeBuildingPlacementRefsToSections(this);
            return state.orderedPlacements.map((placement) => JSON.parse(JSON.stringify(placement)));
        };

        map.exportPrototypeBuildingInstances = function exportPrototypeBuildingInstances() {
            const state = this._prototypeBuildingState;
            if (!state || !Array.isArray(state.orderedPlacements)) return [];
            syncPrototypeBuildingPlacementRefsToSections(this);
            return state.orderedPlacements.map((placement) => {
                const instance = getBuildingInstanceRecord(state, placement);
                if (instance) return deepCloneJson(instance);
                return deepCloneJson(placement);
            });
        };

        map.getPrototypeDirtyWorldUnits = function getPrototypeDirtyWorldUnits() {
            const state = this._prototypeBuildingState;
            const dirty = ensurePrototypeDirtyWorldUnits(state);
            return {
                sections: dirty ? Array.from(dirty.sections) : [],
                buildings: dirty ? Array.from(dirty.buildings) : []
            };
        };

        map.markPrototypeBuildingUnitDirty = function markPrototypeBuildingUnitDirtyForMap(buildingId) {
            return markPrototypeBuildingUnitDirty(this._prototypeBuildingState, buildingId);
        };

        map.getPrototypeWorldScope = function getPrototypeWorldScope() {
            const state = this._prototypeBuildingState;
            return normalizePrototypeWorldScope(state && state.currentWorldScope);
        };

        map.setPrototypeWorldScope = function setPrototypeWorldScope(scope, options = {}) {
            if (!this._prototypeBuildingState) {
                this.initializePrototypeBuildingState([]);
            }
            const state = this._prototypeBuildingState;
            const nextScope = normalizePrototypeWorldScope(scope);
            if (nextScope.type === "building" && !(state.placementsById instanceof Map && state.placementsById.has(nextScope.id))) {
                throw new Error(`cannot enter missing building world scope ${nextScope.id}`);
            }
            const previousScope = normalizePrototypeWorldScope(state.currentWorldScope);
            const changed = !samePrototypeWorldScope(previousScope, nextScope);
            state.currentWorldScope = nextScope;
            if (changed && state.hasActiveBuildingSelection === true) {
                markPrototypeBuildingMovementBlockersDirty(this);
                maybeSyncPrototypeBuildingGeometryRuntime(this);
                if (hasPrototypeBuildingMovementNodeRegistry(this)) {
                    syncPrototypeBuildingMovementBlockers(this);
                }
                if (typeof this.markBuildingRenderCacheDirty === "function") {
                    this.markBuildingRenderCacheDirty();
                }
            }
            const placement = nextScope.type === "building" && state.placementsById instanceof Map
                ? state.placementsById.get(nextScope.id)
                : null;
            const loadState = typeof (placement && placement.loadState) === "string" ? placement.loadState : "";
            const needsInteriorPromotion = !!(
                nextScope.type === "building" &&
                options.promoteInterior !== false &&
                typeof this.promotePrototypeBuildingInterior === "function" &&
                (changed || (loadState !== "interior" && loadState !== "loading-interior" && loadState !== "error"))
            );
            if (needsInteriorPromotion) {
                const promotion = this.promotePrototypeBuildingInterior(nextScope.id);
                if (promotion && typeof promotion.catch === "function") {
                    promotion.catch((error) => {
                        state.lastScopeError = error && error.message ? error.message : String(error);
                    });
                }
            }
            return {
                previous: previousScope,
                current: nextScope,
                changed
            };
        };

        map.updatePrototypeWorldScopeForMovementSupport = function updatePrototypeWorldScopeForMovementSupport(actor, support, options = {}) {
            if (!isPrototypeWizardActor(actor, options)) return this.getPrototypeWorldScope();
            return this.setPrototypeWorldScope(resolvePrototypeWorldScopeFromSupport(support), options).current;
        };

        map.isPrototypeOutdoorBubbleSuspendedForActor = function isPrototypeOutdoorBubbleSuspendedForActor(actor, options = {}) {
            if (options && options.force === true) return false;
            if (!isPrototypeWizardActor(actor, options)) return false;
            const scope = this.getPrototypeWorldScope();
            return !!(scope && scope.type === "building");
        };

        map.getPrototypeBuildingPlacements = function getPrototypeBuildingPlacements() {
            const state = this._prototypeBuildingState;
            return state && Array.isArray(state.orderedPlacements)
                ? state.orderedPlacements.slice()
                : [];
        };

        map.syncPrototypeBuildingPlacementRefs = function syncPrototypeBuildingPlacementRefs() {
            return syncPrototypeBuildingPlacementRefsToSections(this);
        };

        map.collectPrototypeBuildingIdsForSectionKeys = function collectPrototypeBuildingIdsForSectionKeys(sectionKeys) {
            return collectPrototypeBuildingIdsFromSectionKeys(this, sectionKeys);
        };

        map.setPrototypeBuildingDesiredPlacementIds = function setPrototypeBuildingDesiredPlacementIds(ids) {
            if (!this._prototypeBuildingState) {
                this.initializePrototypeBuildingState([]);
            }
            const state = this._prototypeBuildingState;
            const desiredIds = normalizeBuildingPlacementIdSet(ids, state);
            const desiredSignature = Array.from(desiredIds).sort().join("|");
            const previousSignature = state.hasActiveBuildingSelection === true && typeof state.activeDesiredSignature === "string"
                ? state.activeDesiredSignature
                : null;
            state.hasActiveBuildingSelection = true;
            state.desiredBuildingIds = desiredIds;
            state.activeDesiredSignature = desiredSignature;
            let unloaded = 0;
            if (state.loadedBuildingsById instanceof Map) {
                for (const id of Array.from(state.loadedBuildingsById.keys())) {
                    if (desiredIds.has(id)) continue;
                    if (isPrototypeBuildingPlacementCurrentWorldScope(state, id)) continue;
                    clearPrototypeBuildingGeometryRuntime(this, id);
                    state.loadedBuildingsById.delete(id);
                    if (state.cutawayBuildingsByPlacementId instanceof Map) {
                        state.cutawayBuildingsByPlacementId.delete(id);
                    }
                    unloaded += 1;
                }
            }
            if (previousSignature !== desiredSignature || unloaded > 0) {
                markPrototypeBuildingMovementBlockersDirty(this);
                maybeSyncPrototypeBuildingGeometryRuntime(this);
                if (hasPrototypeBuildingMovementNodeRegistry(this)) {
                    syncPrototypeBuildingMovementBlockers(this);
                }
                if (typeof this.markBuildingRenderCacheDirty === "function") {
                    this.markBuildingRenderCacheDirty();
                }
            }
            return {
                changed: previousSignature !== desiredSignature,
                desired: desiredIds.size,
                unloaded
            };
        };

        map.ensurePrototypeBuildingPlacementsForSectionKeys = function ensurePrototypeBuildingPlacementsForSectionKeys(sectionKeys) {
            if (!this._prototypeBuildingState) {
                this.initializePrototypeBuildingState([]);
            }
            const state = this._prototypeBuildingState;
            const keys = sectionKeys instanceof Set ? Array.from(sectionKeys) : (Array.isArray(sectionKeys) ? sectionKeys : []);
            const desiredIds = collectPrototypeBuildingIdsFromSectionKeys(this, keys);
            const placementIds = normalizeBuildingPlacementIdSet(desiredIds, state);
            if (placementIds.size === 0) {
                state.lastLoadStats = { requested: 0, cached: 0, pending: 0 };
                return Promise.resolve([]);
            }
            if (!(state.pendingLoadsById instanceof Map)) state.pendingLoadsById = new Map();
            const promises = [];
            let cached = 0;
            let pending = 0;
            for (const placementId of placementIds) {
                const placement = state.placementsById.get(placementId);
                if (!placement) {
                    throw new Error(`cannot load missing building placement ${placementId}`);
                }
                const cachedData = getBuildingDataForPlacement(state, placement);
                if (cachedData) {
                    setPrototypeBuildingLoadState(state, placement, "shell");
                    state.loadedBuildingsById.set(placementId, placement);
                    cached += 1;
                    continue;
                }
                const existing = state.pendingLoadsById.get(placementId);
                if (existing) {
                    promises.push(existing);
                    pending += 1;
                    continue;
                }
                if (typeof this.loadPrototypeBuildingEditorSaveData !== "function") {
                    throw new Error(`building placement ${placementId} requires template migration loader for shell load`);
                }
                setPrototypeBuildingLoadState(state, placement, "loading-shell");
                const promise = this.loadPrototypeBuildingDataForPlacement(placement)
                    .then((buildingData) => {
                        setPrototypeBuildingLoadState(state, placement, "shell");
                        state.loadedBuildingsById.set(placementId, placement);
                        if (!placementHasCurrentMovementBlockerGeometry(placement)) {
                            const polygons = setPlacementMovementBlockerPolygons(
                                placement,
                                computeBuildingPlacementMovementBlockerPolygons(buildingData, placement)
                            );
                            const instance = getBuildingInstanceRecord(state, placement);
                            if (instance) {
                                instance.movementBlockerPolygons = normalizeMovementBlockerPolygons(polygons);
                                instance.movementBlockerGeometryVersion = MOVEMENT_BLOCKER_GEOMETRY_VERSION;
                                instance.movementBlockedEdges = null;
                                instance.movementEdgeBlockerVersion = "";
                            }
                        }
                        maybeSyncPrototypeBuildingGeometryRuntime(this);
                        markPrototypeBuildingMovementBlockersDirty(this);
                        if (hasPrototypeBuildingMovementNodeRegistry(this)) {
                            syncPrototypeBuildingMovementBlockers(this);
                        }
                        return placement;
                    })
                    .catch((error) => {
                        setPrototypeBuildingLoadState(state, placement, "error");
                        state.lastLoadError = error && error.message ? error.message : String(error);
                        throw error;
                    })
                    .finally(() => {
                        state.pendingLoadsById.delete(placementId);
                    });
                state.pendingLoadsById.set(placementId, promise);
                promises.push(promise);
                pending += 1;
            }
            maybeSyncPrototypeBuildingGeometryRuntime(this);
            if (hasPrototypeBuildingMovementNodeRegistry(this)) {
                syncPrototypeBuildingMovementBlockers(this);
            }
            state.lastLoadStats = { requested: placementIds.size, cached, pending };
            return Promise.all(promises);
        };

        map.ensurePrototypeBuildingShellsForSectionKeys = function ensurePrototypeBuildingShellsForSectionKeys(sectionKeys) {
            return this.ensurePrototypeBuildingPlacementsForSectionKeys(sectionKeys);
        };

        map.promotePrototypeBuildingInterior = function promotePrototypeBuildingInterior(id) {
            if (!this._prototypeBuildingState) {
                this.initializePrototypeBuildingState([]);
            }
            const state = this._prototypeBuildingState;
            const placementId = normalizePlacementId(id, 0);
            const placement = state.placementsById.get(placementId);
            if (!placement) throw new Error(`cannot promote missing building ${placementId} to interior`);
            if (placement.loadState === "interior") {
                const existingData = getBuildingDataForPlacement(state, placement);
                if (existingData) return Promise.resolve(existingData);
            }
            if (placement.loadState === "loading-interior") {
                const existingData = getBuildingDataForPlacement(state, placement);
                if (existingData) return Promise.resolve(existingData);
            }
            setPrototypeBuildingLoadState(state, placement, "loading-interior");
            return this.loadPrototypeBuildingDataForPlacement(placement)
                .then((buildingData) => {
                    setPrototypeBuildingLoadState(state, placement, "interior");
                    state.loadedBuildingsById.set(placementId, placement);
                    maybeSyncPrototypeBuildingGeometryRuntime(this);
                    return buildingData;
                })
                .catch((error) => {
                    setPrototypeBuildingLoadState(state, placement, "error");
                    throw error;
                });
        };

        map.computePrototypeBuildingFootprint = function computePrototypeBuildingFootprint(buildingData, placementRecord) {
            return computeBuildingPlacementFootprint(buildingData, placementRecord);
        };

        map.computePrototypeBuildingOverlappedSectionKeys = function computePrototypeBuildingOverlappedSectionKeys(footprintPolygons) {
            return computeOverlappedSectionKeysForFootprint(this, footprintPolygons);
        };

        map.addPrototypeBuildingPlacement = function addPrototypeBuildingPlacement(record, options = {}) {
            if (!this._prototypeBuildingState) {
                this.initializePrototypeBuildingState([]);
            }
            const state = this._prototypeBuildingState;
            let nextRecord = { ...record };
            if (!nextRecord.id) {
                nextRecord.id = `building:placed-${state.nextPlacementSerial++}`;
            }
            let placement = normalizeBuildingPlacementRecord(nextRecord, state.orderedPlacements.length);
            if (state.placementsById.has(placement.id)) {
                throw new Error(`duplicate building placement id: ${placement.id}`);
            }
            if (Array.isArray(options.footprintPolygons)) {
                placement.footprintPolygons = normalizeFootprintPolygons(options.footprintPolygons);
            } else if (options.buildingData) {
                placement.footprintPolygons = computeBuildingPlacementFootprint(options.buildingData, placement);
            }
            if (Array.isArray(options.movementBlockerPolygons)) {
                setPlacementMovementBlockerPolygons(placement, options.movementBlockerPolygons);
            } else if (options.buildingData) {
                setPlacementMovementBlockerPolygons(
                    placement,
                    computeBuildingPlacementMovementBlockerPolygons(options.buildingData, placement)
                );
            }
            if (placement.footprintPolygons.length === 0) {
                throw new Error(`missing footprint for building placement ${placement.id}`);
            }
            placement.overlappedSectionKeys = computeOverlappedSectionKeysForFootprint(this, placement.footprintPolygons);
            placement.touchedSectionKeys = placement.overlappedSectionKeys.slice();
            if (options.buildingData) {
                const instance = createBuildingInstanceFromEditorSave(options.buildingData, placement, {
                    footprintPolygons: placement.footprintPolygons,
                    movementBlockerPolygons: placement.movementBlockerPolygons,
                    touchedSectionKeys: placement.touchedSectionKeys,
                    loadState: "shell"
                });
                setBuildingInstanceRecord(state, instance, { markDirty: true });
                updatePlacementFromInstance(placement, instance);
            }
            state.placementsById.set(placement.id, placement);
            state.orderedPlacements.push(placement);
            state.contentVersion += 1;
            rebuildBuildingPlacementIndex(this);
            syncPrototypeBuildingPlacementRefsToSections(this);
            markPrototypeSectionUnitsDirty(state, placement.touchedSectionKeys || placement.overlappedSectionKeys);
            markPrototypeBuildingMovementBlockersDirty(this);
            maybeSyncPrototypeBuildingGeometryRuntime(this);
            if (hasPrototypeBuildingMovementNodeRegistry(this)) {
                syncPrototypeBuildingMovementBlockers(this);
            }
            if (typeof this.markBuildingRenderCacheDirty === "function") {
                this.markBuildingRenderCacheDirty();
            }
            if (typeof globalScope.invalidateMinimap === "function") {
                globalScope.invalidateMinimap();
            }
            return placement;
        };

        map.getPrototypeBuildingExteriorBitmap = function getPrototypeBuildingExteriorBitmap(id) {
            const placementId = normalizePlacementId(id, 0);
            const state = this._prototypeBuildingState;
            return state && state.exteriorBitmapsById instanceof Map
                ? (state.exteriorBitmapsById.get(placementId) || null)
                : null;
        };

        map.getPrototypeBuildingInteriorBitmap = function getPrototypeBuildingInteriorBitmap(id, floorId) {
            const key = interiorBitmapKey(id, floorId);
            const state = this._prototypeBuildingState;
            return state && state.interiorBitmapsByKey instanceof Map
                ? (state.interiorBitmapsByKey.get(key) || null)
                : null;
        };

        map.releasePrototypeBuildingInteriorBitmapReplacement = function releasePrototypeBuildingInteriorBitmapReplacement(entry) {
            if (!entry || !entry._replacedReadyEntry) return false;
            const replaced = entry._replacedReadyEntry;
            entry._replacedReadyEntry = null;
            destroyPrototypeBuildingBitmapEntry(replaced);
            return true;
        };

        map.loadPrototypeBuildingEditorSaveData = function loadPrototypeBuildingEditorSaveData(buildingSaveName) {
            const saveName = nonEmptyString(buildingSaveName, "buildingSaveName");
            if (!this._prototypeBuildingState) {
                this.initializePrototypeBuildingState([]);
            }
            const state = this._prototypeBuildingState;
            if (state.buildingDataBySaveName.has(saveName)) {
                return Promise.resolve(state.buildingDataBySaveName.get(saveName));
            }
            if (state.pendingBuildingDataBySaveName.has(saveName)) {
                return state.pendingBuildingDataBySaveName.get(saveName);
            }
            const promise = fetchBuildingEditorSaveData(saveName)
                .then((buildingData) => {
                    state.buildingDataBySaveName.set(saveName, buildingData);
                    const placements = Array.isArray(state.orderedPlacements) ? state.orderedPlacements : [];
                    placements.forEach((placement) => {
                        if (!placement || placement.buildingSaveName !== saveName) return;
                        if (!getBuildingInstanceRecord(state, placement)) {
                            const touchedSectionKeys = normalizeSectionKeys(placement.touchedSectionKeys || placement.overlappedSectionKeys);
                            const instance = createBuildingInstanceFromEditorSave(buildingData, placement, {
                                footprintPolygons: placement.footprintPolygons,
                                movementBlockerPolygons: placement.movementBlockerPolygons,
                                touchedSectionKeys,
                                loadState: placement.loadState || "shell",
                                contentVersion: placement.contentVersion
                            });
                            setBuildingInstanceRecord(state, instance, { markDirty: true });
                            updatePlacementFromInstance(placement, instance);
                        }
                        if (placementHasCurrentMovementBlockerGeometry(placement)) return;
                        const polygons = setPlacementMovementBlockerPolygons(
                            placement,
                            computeBuildingPlacementMovementBlockerPolygons(buildingData, placement)
                        );
                        const instance = getBuildingInstanceRecord(state, placement);
                        if (instance) {
                            instance.movementBlockerPolygons = normalizeMovementBlockerPolygons(polygons);
                            instance.movementBlockerGeometryVersion = MOVEMENT_BLOCKER_GEOMETRY_VERSION;
                            instance.movementBlockedEdges = null;
                            instance.movementEdgeBlockerVersion = "";
                        }
                    });
                    if (state.cutawayBuildingsByPlacementId instanceof Map) {
                        state.cutawayBuildingsByPlacementId.clear();
                    }
                    maybeSyncPrototypeBuildingGeometryRuntime(this);
                    markPrototypeBuildingMovementBlockersDirty(this);
                    if (hasPrototypeBuildingMovementNodeRegistry(this)) {
                        syncPrototypeBuildingMovementBlockers(this);
                    }
                    if (typeof this.markBuildingRenderCacheDirty === "function") {
                        this.markBuildingRenderCacheDirty();
                    }
                    return buildingData;
                })
                .finally(() => {
                    state.pendingBuildingDataBySaveName.delete(saveName);
                });
            state.pendingBuildingDataBySaveName.set(saveName, promise);
            return promise;
        };

        map.loadPrototypeBuildingDataForPlacement = function loadPrototypeBuildingDataForPlacement(placementOrId) {
            if (!this._prototypeBuildingState) {
                this.initializePrototypeBuildingState([]);
            }
            const state = this._prototypeBuildingState;
            const placement = typeof placementOrId === "string"
                ? state.placementsById.get(normalizePlacementId(placementOrId, 0))
                : placementOrId;
            if (!placement || typeof placement !== "object") {
                throw new Error("building data load requires a known placement");
            }
            const instance = getBuildingInstanceRecord(state, placement);
            if (instance) return Promise.resolve(instance);
            return this.loadPrototypeBuildingEditorSaveData(placement.buildingSaveName)
                .then((buildingData) => {
                    let migrated = getBuildingInstanceRecord(state, placement);
                    if (!migrated) {
                        migrated = createBuildingInstanceFromEditorSave(buildingData, placement, {
                            footprintPolygons: placement.footprintPolygons,
                            movementBlockerPolygons: placement.movementBlockerPolygons,
                            touchedSectionKeys: placement.touchedSectionKeys || placement.overlappedSectionKeys,
                            loadState: placement.loadState || "shell",
                            contentVersion: placement.contentVersion
                        });
                        setBuildingInstanceRecord(state, migrated, { markDirty: true });
                        updatePlacementFromInstance(placement, migrated);
                    }
                    return migrated;
                });
        };

        const resolveInteriorBitmapFloorBakeRef = (targetOrRef, options = {}) => {
            const ref = targetOrRef && typeof targetOrRef === "object" ? targetOrRef : {};
            const explicitPlacementId = typeof (options && options.placementId) === "string"
                ? options.placementId
                : (typeof ref.placementId === "string"
                    ? ref.placementId
                    : (typeof ref.buildingId === "string"
                        ? ref.buildingId
                        : (typeof ref._prototypeOwnerId === "string" ? ref._prototypeOwnerId : "")));
            if (
                ref._prototypeOwnerType &&
                ref._prototypeOwnerType !== "building"
            ) {
                throw new Error(`prototype object is not owned by a building and cannot affect a building baked texture`);
            }
            const placementId = normalizePlacementId(explicitPlacementId, 0);
            const parseFloorId = (source) => {
                if (!source || typeof source !== "object") return "";
                const floorPrefix = `${placementId}:floor:`;
                const surfacePrefix = `${placementId}:surface:`;
                const candidates = [
                    source.floorId,
                    source.sourceFloorId,
                    source.floorMembership && source.floorMembership.floorId,
                    source._floorMembership && source._floorMembership.floorId,
                    source.fragmentId,
                    source.surfaceId
                ];
                for (let i = 0; i < candidates.length; i++) {
                    const value = typeof candidates[i] === "string" ? candidates[i] : "";
                    if (!value) continue;
                    if (value.startsWith(floorPrefix) && value.length > floorPrefix.length) return value.slice(floorPrefix.length);
                    if (value.startsWith(surfacePrefix) && value.length > surfacePrefix.length) return value.slice(surfacePrefix.length);
                    if (value.indexOf(":") < 0) return value;
                }
                return "";
            };
            const floorId = parseFloorId(options) ||
                parseFloorId(ref) ||
                parseFloorId(ref.currentMovementSupport) ||
                parseFloorId(ref._activeFloorFragment) ||
                parseFloorId(ref.node);
            if (!floorId) {
                throw new Error(`prototype building baked texture invalidation for ${placementId} requires a floor id`);
            }
            return { placementId, floorId };
        };

        const resolveInteriorBitmapObjectBakeRef = (targetOrRef, options = {}) => {
            const ref = targetOrRef && typeof targetOrRef === "object" ? targetOrRef : {};
            const recordId = Number.isInteger(Number(options && options.recordId))
                ? Number(options.recordId)
                : (Number.isInteger(Number(ref.recordId))
                    ? Number(ref.recordId)
                    : (Number.isInteger(Number(ref._prototypeRecordId)) ? Number(ref._prototypeRecordId) : NaN));
            if (!Number.isInteger(recordId)) {
                throw new Error("prototype building baked texture exclusion requires an object record id");
            }
            const floorRef = resolveInteriorBitmapFloorBakeRef(targetOrRef, options);
            const placementId = floorRef.placementId;
            const floorId = floorRef.floorId;
            return { placementId, floorId, recordId };
        };

        map.invalidatePrototypeBuildingInteriorBitmap = function invalidatePrototypeBuildingInteriorBitmap(targetOrRef, options = {}) {
            if (!this._prototypeBuildingState) {
                this.initializePrototypeBuildingState([]);
            }
            const state = this._prototypeBuildingState;
            const ref = resolveInteriorBitmapFloorBakeRef(targetOrRef, options);
            const changed = invalidatePrototypeBuildingInteriorBitmapEntry(state, ref.placementId, ref.floorId);
            if (globalScope && typeof globalScope.requestPrototypeInteriorInvalidationFrameCapture === "function") {
                globalScope.requestPrototypeInteriorInvalidationFrameCapture({
                    operation: "invalidatePrototypeBuildingInteriorBitmap",
                    placementId: ref.placementId,
                    floorId: ref.floorId,
                    changed
                });
            }
            return { ...ref, changed };
        };

        map.removePrototypeBuildingObjectFromInteriorBitmap = function removePrototypeBuildingObjectFromInteriorBitmap(targetOrRef, options = {}) {
            if (!this._prototypeBuildingState) {
                this.initializePrototypeBuildingState([]);
            }
            const state = this._prototypeBuildingState;
            const ref = resolveInteriorBitmapObjectBakeRef(targetOrRef, options);
            const set = getInteriorBitmapObjectExclusionSet(state, ref.placementId, ref.floorId, true);
            const changed = !set.has(ref.recordId);
            if (changed) {
                set.add(ref.recordId);
                invalidatePrototypeBuildingInteriorBitmapEntry(state, ref.placementId, ref.floorId);
            }
            if (globalScope && typeof globalScope.requestPrototypeInteriorInvalidationFrameCapture === "function") {
                globalScope.requestPrototypeInteriorInvalidationFrameCapture({
                    operation: "removePrototypeBuildingObjectFromInteriorBitmap",
                    placementId: ref.placementId,
                    floorId: ref.floorId,
                    recordId: ref.recordId,
                    changed
                });
            }
            if (targetOrRef && typeof targetOrRef === "object") {
                targetOrRef._prototypeInteriorBitmapExcluded = true;
                targetOrRef._prototypeInteriorBitmapExclusion = { ...ref };
            }
            return { ...ref, changed };
        };

        map.restorePrototypeBuildingObjectToInteriorBitmap = function restorePrototypeBuildingObjectToInteriorBitmap(targetOrRef, options = {}) {
            if (!this._prototypeBuildingState) {
                this.initializePrototypeBuildingState([]);
            }
            const state = this._prototypeBuildingState;
            const ref = resolveInteriorBitmapObjectBakeRef(targetOrRef, options);
            const set = getInteriorBitmapObjectExclusionSet(state, ref.placementId, ref.floorId, false);
            const changed = !!(set && set.delete(ref.recordId));
            if (set && set.size === 0 && state.interiorBitmapObjectExclusionsByKey instanceof Map) {
                state.interiorBitmapObjectExclusionsByKey.delete(interiorBitmapKey(ref.placementId, ref.floorId));
            }
            if (changed) {
                invalidatePrototypeBuildingInteriorBitmapEntry(state, ref.placementId, ref.floorId);
            }
            if (globalScope && typeof globalScope.requestPrototypeInteriorInvalidationFrameCapture === "function") {
                globalScope.requestPrototypeInteriorInvalidationFrameCapture({
                    operation: "restorePrototypeBuildingObjectToInteriorBitmap",
                    placementId: ref.placementId,
                    floorId: ref.floorId,
                    recordId: ref.recordId,
                    changed
                });
            }
            if (targetOrRef && typeof targetOrRef === "object") {
                targetOrRef._prototypeInteriorBitmapExcluded = false;
                targetOrRef._prototypeInteriorBitmapExclusion = null;
            }
            return { ...ref, changed };
        };

        map.requestPrototypeBuildingExteriorBitmap = function requestPrototypeBuildingExteriorBitmap(placementOrId, options = {}) {
            if (!this._prototypeBuildingState) {
                this.initializePrototypeBuildingState([]);
            }
            const state = this._prototypeBuildingState;
            const placement = typeof placementOrId === "string"
                ? state.placementsById.get(normalizePlacementId(placementOrId, 0))
                : placementOrId;
            if (!placement || typeof placement !== "object") {
                throw new Error("building exterior bitmap request requires a known placement");
            }
            const placementId = normalizePlacementId(placement.id, 0);
            const cached = state.exteriorBitmapsById.get(placementId) || null;
            const pending = state.pendingExteriorBitmapLoadsById.get(placementId) || null;
            const settingsSignature = exteriorBitmapSettingsSignature(placement, options);
            if (cached && cached.status === "ready" && cached.settingsSignature === settingsSignature) {
                return cached;
            }
            if (cached && cached.status === "error" && cached.settingsSignature === settingsSignature) {
                return cached;
            }
            if (pending && pending.settingsSignature === settingsSignature) {
                return cached || { status: "loading", id: placementId, settingsSignature };
            }
            const appRef = (options && options.app) || globalScope.app || null;
            const rendererRef = (options && options.renderer) || (appRef && appRef.renderer) || null;
            if (!appRef || !rendererRef) {
                throw new Error("building exterior bitmap request requires a Pixi app and renderer");
            }
            setPrototypeBuildingLoadState(state, placement, "shell");
            let loadPromise = null;
            loadPromise = this.loadPrototypeBuildingDataForPlacement(placement)
                .then(async (buildingData) => {
                    const dataSignature = buildingDataSignature(buildingData);
                    const signature = exteriorBitmapSettingsSignature(placement, options, dataSignature);
                    const existing = state.exteriorBitmapsById.get(placementId);
                    if (existing && existing.status === "ready" && existing.signature === signature) {
                        return existing;
                    }
                    const module = await import("/building-editor/BuildingRenderer.js");
                    if (!module || typeof module.renderBuildingExteriorBitmap !== "function") {
                        throw new Error("BuildingRenderer.js missing renderBuildingExteriorBitmap export");
                    }
                    const result = await module.renderBuildingExteriorBitmap(buildingData, {
                        app: appRef,
                        renderer: rendererRef,
                        rotation: Number(placement.transform && placement.transform.rotation) || 0,
                        pitch: Number.isFinite(Number(options.pitch)) ? Number(options.pitch) : Math.PI / 4,
                        pixelsPerWorldUnit: Number.isFinite(Number(options.pixelsPerWorldUnit))
                            ? Number(options.pixelsPerWorldUnit)
                            : 72,
                        paddingPixels: Number.isFinite(Number(options.paddingPixels))
                            ? Number(options.paddingPixels)
                            : DEFAULT_PROTOTYPE_BUILDING_BITMAP_PADDING_PIXELS,
                        maxDimension: Number.isFinite(Number(options.maxDimension))
                            ? Number(options.maxDimension)
                            : DEFAULT_PROTOTYPE_BUILDING_BITMAP_MAX_DIMENSION
                    });
                    if (!result || !result.texture) {
                        throw new Error(`building exterior bitmap render returned no texture for ${placementId}`);
                    }
                    if (!result.depthMetricTexture || !result.depthMetric || !(Number(result.depthMetric.span) > 0)) {
                        throw new Error(`building exterior bitmap render returned no depth metric texture for ${placementId}`);
                    }
                    if (
                        !result.alphaMask ||
                        !result.alphaMask.pixels ||
                        typeof result.alphaMask.pixels.length !== "number" ||
                        !(Number(result.alphaMask.width) > 0) ||
                        !(Number(result.alphaMask.height) > 0)
                    ) {
                        throw new Error(`building exterior bitmap render returned no alpha mask for ${placementId}`);
                    }
                    const previous = state.exteriorBitmapsById.get(placementId);
                    if (
                        previous &&
                        previous.texture &&
                        previous.texture !== result.texture &&
                        typeof previous.texture.destroy === "function"
                    ) {
                        previous.texture.destroy(true);
                    }
                    if (
                        previous &&
                        previous.depthMetricTexture &&
                        previous.depthMetricTexture !== result.depthMetricTexture &&
                        typeof previous.depthMetricTexture.destroy === "function"
                    ) {
                        previous.depthMetricTexture.destroy(true);
                    }
                    const entry = {
                        ...result,
                        id: placementId,
                        status: "ready",
                        signature,
                        settingsSignature,
                        dataSignature,
                        buildingSaveName: placement.buildingSaveName,
                        placementRevision: state.contentVersion
                    };
                    state.exteriorBitmapsById.set(placementId, entry);
                    return entry;
                })
                .catch((error) => {
                    const entry = {
                        id: placementId,
                        status: "error",
                        settingsSignature,
                        buildingSaveName: placement.buildingSaveName,
                        error: error && error.message ? error.message : String(error)
                    };
                    state.exteriorBitmapsById.set(placementId, entry);
                    console.error("[building exterior bitmap]", entry.error);
                    throw error;
                })
                .finally(() => {
                    state.pendingExteriorBitmapLoadsById.delete(placementId);
                });
            state.pendingExteriorBitmapLoadsById.set(placementId, {
                settingsSignature,
                promise: loadPromise
            });
            state.exteriorBitmapsById.set(placementId, {
                id: placementId,
                status: "loading",
                settingsSignature,
                buildingSaveName: placement.buildingSaveName
            });
            loadPromise.catch(() => {});
            return state.exteriorBitmapsById.get(placementId);
        };

        map.requestPrototypeBuildingInteriorBitmap = function requestPrototypeBuildingInteriorBitmap(placementOrId, floorId, options = {}) {
            if (!this._prototypeBuildingState) {
                this.initializePrototypeBuildingState([]);
            }
            const state = this._prototypeBuildingState;
            const placement = typeof placementOrId === "string"
                ? state.placementsById.get(normalizePlacementId(placementOrId, 0))
                : placementOrId;
            if (!placement || typeof placement !== "object") {
                throw new Error("building interior bitmap request requires a known placement");
            }
            const placementId = normalizePlacementId(placement.id, 0);
            const sourceFloorId = nonEmptyString(floorId, `building interior bitmap ${placementId} floorId`);
            const key = interiorBitmapKey(placementId, sourceFloorId);
            if (!(state.interiorBitmapsByKey instanceof Map)) state.interiorBitmapsByKey = new Map();
            if (!(state.pendingInteriorBitmapLoadsByKey instanceof Map)) state.pendingInteriorBitmapLoadsByKey = new Map();
            if (typeof this.capturePendingPrototypeObjects === "function") {
                this.capturePendingPrototypeObjects();
            }
            const bakeObjects = collectInteriorBitmapBakeObjects(this, state, placementId, sourceFloorId);
            const bakeObjectSignature = interiorBitmapBakeObjectsSignature(bakeObjects);
            const cached = state.interiorBitmapsByKey.get(key) || null;
            const pending = state.pendingInteriorBitmapLoadsByKey.get(key) || null;
            const exclusionSignature = getInteriorBitmapObjectExclusionSignature(state, placementId, sourceFloorId);
            const signatureOptions = { ...options, exclusionSignature, bakeObjectSignature };
            const settingsSignature = interiorBitmapSettingsSignature(placement, sourceFloorId, signatureOptions);
            if (cached && cached.status === "ready" && cached.stale !== true && cached.settingsSignature === settingsSignature) {
                recordMoveObjectPerfEvent("prototypeInteriorBitmap.cacheHit", {
                    placementId,
                    floorId: sourceFloorId,
                    status: "ready"
                });
                return cached;
            }
            if (cached && cached.status === "error" && cached.settingsSignature === settingsSignature) {
                recordMoveObjectPerfEvent("prototypeInteriorBitmap.cacheHit", {
                    placementId,
                    floorId: sourceFloorId,
                    status: "error"
                });
                return cached;
            }
            if (pending && pending.settingsSignature === settingsSignature) {
                recordMoveObjectPerfEvent("prototypeInteriorBitmap.pendingHit", {
                    placementId,
                    floorId: sourceFloorId,
                    hasCachedPlaceholder: !!cached
                });
                return cached || { status: "loading", id: key, placementId, floorId: sourceFloorId, settingsSignature };
            }
            const appRef = (options && options.app) || globalScope.app || null;
            const rendererRef = (options && options.renderer) || (appRef && appRef.renderer) || null;
            if (!appRef || !rendererRef) {
                throw new Error("building interior bitmap request requires a Pixi app and renderer");
            }
            recordMoveObjectPerfEvent("prototypeInteriorBitmap.request", {
                placementId,
                floorId: sourceFloorId,
                exclusionSignature,
                hadCachedEntry: !!cached,
                hadPendingEntry: !!pending
            });
            setPrototypeBuildingLoadState(state, placement, "loading-interior");
            const loadPromise = this.loadPrototypeBuildingDataForPlacement(placement)
                .then(async (buildingData) => {
                    const renderStartMs = (
                        typeof performance !== "undefined" &&
                        performance &&
                        typeof performance.now === "function"
                    ) ? performance.now() : 0;
                    const renderBuildingData = cloneBuildingDataWithoutInteriorBitmapExcludedObjects(
                        state,
                        placementId,
                        sourceFloorId,
                        buildingData
                    );
                    const excludedObjectIds = getInteriorBitmapObjectExclusionSet(state, placementId, sourceFloorId, false);
                    const dataSignature = buildingDataSignature(renderBuildingData);
                    const signature = interiorBitmapSettingsSignature(placement, sourceFloorId, signatureOptions, dataSignature);
                    const existing = state.interiorBitmapsByKey.get(key);
                    if (existing && existing.status === "ready" && existing.signature === signature) {
                        existing.stale = false;
                        delete existing.staleReason;
                        delete existing.pendingSettingsSignature;
                        return existing;
                    }
                    const rendererModuleUrl = `/building-editor/BuildingRenderer.js?interiorBitmap=${encodeURIComponent(INTERIOR_BITMAP_RENDER_DATA_VERSION)}`;
                    const module = await import(rendererModuleUrl);
                    if (!module || typeof module.renderBuildingBitmap !== "function") {
                        throw new Error("BuildingRenderer.js missing renderBuildingBitmap export");
                    }
                    await loadInteriorBitmapBakeObjectTextures(bakeObjects);
                    const baseRenderOptions = {
                        app: appRef,
                        renderer: rendererRef,
                        rotation: Number(placement.transform && placement.transform.rotation) || 0,
                        rotateModelAroundOrigin: true,
                        pitch: Number.isFinite(Number(options.pitch)) ? Number(options.pitch) : Math.PI / 4,
                        pixelsPerWorldUnit: Number.isFinite(Number(options.pixelsPerWorldUnit))
                            ? Number(options.pixelsPerWorldUnit)
                            : 72,
                        paddingPixels: Number.isFinite(Number(options.paddingPixels))
                            ? Number(options.paddingPixels)
                            : DEFAULT_PROTOTYPE_BUILDING_BITMAP_PADDING_PIXELS,
                        maxDimension: Number.isFinite(Number(options.maxDimension))
                            ? Number(options.maxDimension)
                            : DEFAULT_PROTOTYPE_BUILDING_BITMAP_MAX_DIMENSION,
                        includeDepthMetric: true
                    };
                    const lowerFloorIds = lowerBuildingDataFloorIds(renderBuildingData, sourceFloorId);
                    const lowerFloorsBitmap = lowerFloorIds.length > 0
                        ? await module.renderBuildingBitmap(renderBuildingData, {
                            ...baseRenderOptions,
                            label: "building lower interior",
                            floorIds: lowerFloorIds,
                            includeRoofs: true,
                            roofFloorIds: lowerFloorIds,
                            fullHeightWallFloorIds: lowerFloorIds,
                            fullOpacityMountedObjectFloorIds: lowerFloorIds,
                            excludedObjectIds
                        })
                        : null;
                    const result = await module.renderBuildingBitmap(renderBuildingData, {
                        ...baseRenderOptions,
                        label: "building current interior",
                        floorId: sourceFloorId,
                        includeRoofs: false,
                        clipDownStairFloorIds: [sourceFloorId],
                        excludedObjectIds,
                        validate(exportRenderer) {
                            const floor = exportRenderer && exportRenderer.state
                                ? findBuildingDataFloor(exportRenderer.state.building, sourceFloorId)
                                : null;
                            if (!floor) throw new Error(`building current interior bitmap references missing floor ${sourceFloorId}`);
                            exportRenderer.assertInteriorBitmapRenderableSurfaces(floor);
                        }
                    });
                    const bakedObjects = bakeInteriorBitmapFloorObjectsIntoTexture(result, bakeObjects, {
                        renderer: rendererRef,
                        map: this,
                        buildingData: renderBuildingData,
                        placementTransform: placement.transform,
                        placementId,
                        floorId: sourceFloorId
                    });
                    result.lowerFloorsBitmap = lowerFloorsBitmap;
                    if (renderStartMs > 0) {
                        recordMoveObjectPerfEvent("prototypeInteriorBitmap.render", {
                            placementId,
                            floorId: sourceFloorId,
                            exclusionSignature,
                            objectCount: Array.isArray(renderBuildingData.objects) ? renderBuildingData.objects.length : null
                        }, performance.now() - renderStartMs);
                    }
                    if (!result || !result.texture) {
                        throw new Error(`building interior bitmap render returned no texture for ${placementId} floor ${sourceFloorId}`);
                    }
                    if (!result.depthMetricTexture || !result.depthMetric || !(Number(result.depthMetric.span) > 0)) {
                        throw new Error(`building interior bitmap render returned no depth metric texture for ${placementId} floor ${sourceFloorId}`);
                    }
                    const pendingAtCommit = state.pendingInteriorBitmapLoadsByKey.get(key) || null;
                    if (!pendingAtCommit || pendingAtCommit.promise !== loadPromise) {
                        destroyPrototypeBuildingBitmapEntry(result);
                        const current = state.interiorBitmapsByKey.get(key);
                        if (current) return current;
                        throw new Error(`obsolete building interior bitmap render had no current cache for ${placementId} floor ${sourceFloorId}`);
                    }
                    const entry = {
                        ...result,
                        id: key,
                        placementId,
                        floorId: sourceFloorId,
                        status: "ready",
                        signature,
                        settingsSignature,
                        dataSignature,
                        buildingSaveName: placement.buildingSaveName,
                        placementRevision: state.contentVersion
                    };
                    entry.coveredObjects = bakedObjects.slice();
                    entry.coveredObjectEntries = bakedObjects.map((item) => ({
                        item,
                        recordId: getInteriorBitmapBakeObjectRecordId(item),
                        signature: interiorBitmapBakeObjectSignature(item)
                    }));
                    if (entry.lowerFloorsBitmap) {
                        entry.lowerFloorsBitmap.id = `${key}:lower`;
                        entry.lowerFloorsBitmap.placementId = placementId;
                        entry.lowerFloorsBitmap.floorId = sourceFloorId;
                        entry.lowerFloorsBitmap.status = "ready";
                        entry.lowerFloorsBitmap.signature = `${signature}:lower`;
                        entry.lowerFloorsBitmap.settingsSignature = `${settingsSignature}:lower`;
                        entry.lowerFloorsBitmap.dataSignature = dataSignature;
                        entry.lowerFloorsBitmap.buildingSaveName = placement.buildingSaveName;
                        entry.lowerFloorsBitmap.placementRevision = state.contentVersion;
                    }
                    const previous = state.interiorBitmapsByKey.get(key);
                    state.interiorBitmapsByKey.set(key, entry);
                    if (previous && previous !== entry) {
                        if (previous.status === "ready" && previous.texture) {
                            entry._replacedReadyEntry = previous;
                        } else {
                            destroyPrototypeBuildingBitmapEntry(previous);
                        }
                    }
                    setPrototypeBuildingLoadState(state, placement, "interior");
                    return entry;
                })
                .catch((error) => {
                    const pendingAtError = state.pendingInteriorBitmapLoadsByKey.get(key) || null;
                    if (!pendingAtError || pendingAtError.promise !== loadPromise) {
                        throw error;
                    }
                    const previous = state.interiorBitmapsByKey.get(key) || null;
                    if (previous && previous.status === "ready" && previous.texture) {
                        previous.stale = true;
                        previous.error = error && error.message ? error.message : String(error);
                        setPrototypeBuildingLoadState(state, placement, "interior");
                        console.error("[building interior bitmap]", previous.error);
                        throw error;
                    }
                    const entry = {
                        id: key,
                        placementId,
                        floorId: sourceFloorId,
                        status: "error",
                        settingsSignature,
                        buildingSaveName: placement.buildingSaveName,
                        error: error && error.message ? error.message : String(error)
                    };
                    state.interiorBitmapsByKey.set(key, entry);
                    setPrototypeBuildingLoadState(state, placement, "error");
                    console.error("[building interior bitmap]", entry.error);
                    throw error;
                })
                .finally(() => {
                    const pendingAtFinish = state.pendingInteriorBitmapLoadsByKey.get(key) || null;
                    if (!pendingAtFinish || pendingAtFinish.promise === loadPromise) {
                        state.pendingInteriorBitmapLoadsByKey.delete(key);
                    }
                });
            state.pendingInteriorBitmapLoadsByKey.set(key, {
                settingsSignature,
                promise: loadPromise
            });
            if (cached && cached.status === "ready" && cached.texture) {
                cached.stale = true;
                cached.pendingSettingsSignature = settingsSignature;
                loadPromise.catch(() => {});
                return cached;
            }
            const loadingEntry = {
                id: key,
                placementId,
                floorId: sourceFloorId,
                status: "loading",
                settingsSignature,
                buildingSaveName: placement.buildingSaveName
            };
            state.interiorBitmapsByKey.set(key, loadingEntry);
            loadPromise.catch(() => {});
            return loadingEntry;
        };

        map.getPrototypeBuildingCutawayBuildings = function getPrototypeBuildingCutawayBuildings() {
            const state = this._prototypeBuildingState;
            if (!state || !Array.isArray(state.orderedPlacements)) return [];
            if (!(state.cutawayBuildingsByPlacementId instanceof Map)) {
                state.cutawayBuildingsByPlacementId = new Map();
            }
            const out = [];
            let pending = 0;
            for (let i = 0; i < state.orderedPlacements.length; i++) {
                const placement = state.orderedPlacements[i];
                if (!placement || !placement.id) continue;
                if (!isPrototypeBuildingPlacementDesired(state, placement)) continue;
                const buildingData = getBuildingDataForPlacement(state, placement);
                if (!buildingData) {
                    pending += 1;
                    if (typeof this.loadPrototypeBuildingDataForPlacement === "function") {
                        this.loadPrototypeBuildingDataForPlacement(placement).catch((error) => {
                            state.lastCutawayGeometryStats = {
                                pending,
                                error: error && error.message ? error.message : String(error)
                            };
                        });
                    }
                    continue;
                }
                let building = state.cutawayBuildingsByPlacementId.get(placement.id);
                if (!building || building._prototypeBuildingContentVersion !== state.contentVersion) {
                    building = createPrototypeBuildingCutawayRecord(buildingData, placement);
                    building._prototypeBuildingContentVersion = state.contentVersion;
                    state.cutawayBuildingsByPlacementId.set(placement.id, building);
                    maybeSyncPrototypeBuildingGeometryRuntime(this);
                }
                const entries = Array.isArray(building.staticObjects) ? building.staticObjects : [];
                for (let e = 0; e < entries.length; e++) {
                    if (entries[e] && entries[e].item) entries[e].item.map = this;
                }
                out.push(building);
            }
            state.lastCutawayGeometryStats = { placements: state.orderedPlacements.length, ready: out.length, pending };
            return out;
        };

        map.removePrototypeBuildingPlacement = function removePrototypeBuildingPlacement(id) {
            const placementId = normalizePlacementId(id, 0);
            const state = this._prototypeBuildingState;
            if (!state || !state.placementsById.has(placementId)) return false;
            const placement = state.placementsById.get(placementId);
            const touchedSectionKeys = normalizeSectionKeys(placement && (placement.touchedSectionKeys || placement.overlappedSectionKeys));
            state.placementsById.delete(placementId);
            state.orderedPlacements = state.orderedPlacements.filter((placement) => placement.id !== placementId);
            if (state.buildingInstancesById instanceof Map) state.buildingInstancesById.delete(placementId);
            if (state.buildingDataByInstanceId instanceof Map) state.buildingDataByInstanceId.delete(placementId);
            destroyPrototypeBuildingPlacementBitmapEntries(state, placementId);
            clearPrototypeBuildingGeometryRuntime(this, placementId, { removeAttachedObjects: true });
            state.contentVersion += 1;
            rebuildBuildingPlacementIndex(this);
            syncPrototypeBuildingPlacementRefsToSections(this);
            markPrototypeBuildingUnitDirty(state, placementId);
            markPrototypeSectionUnitsDirty(state, touchedSectionKeys);
            markPrototypeBuildingMovementBlockersDirty(this);
            if (hasPrototypeBuildingMovementNodeRegistry(this)) {
                syncPrototypeBuildingMovementBlockers(this);
            }
            if (typeof this.markBuildingRenderCacheDirty === "function") {
                this.markBuildingRenderCacheDirty();
            }
            if (typeof globalScope.invalidateMinimap === "function") {
                globalScope.invalidateMinimap();
            }
            return true;
        };

        map.updatePrototypeBuildingPlacementTransform = function updatePrototypeBuildingPlacementTransform(id, transform) {
            const placementId = normalizePlacementId(id, 0);
            const state = this._prototypeBuildingState;
            if (!state || !state.placementsById.has(placementId)) {
                throw new Error(`cannot move missing building placement ${placementId}`);
            }
            const placement = state.placementsById.get(placementId);
            const previousTransform = placement.transform || {};
            const nextTransform = {
                x: finiteNumber(transform && transform.x, `building placement ${placementId} transform.x`),
                y: finiteNumber(transform && transform.y, `building placement ${placementId} transform.y`),
                rotation: Number.isFinite(Number(transform && transform.rotation))
                    ? Number(transform.rotation)
                    : (Number(previousTransform.rotation) || 0)
            };
            const previousRotation = Number(previousTransform.rotation) || 0;
            const rotationChanged = Math.abs(nextTransform.rotation - previousRotation) > 0.000001;
            const dx = nextTransform.x - finiteNumber(previousTransform.x, `building placement ${placementId} current transform.x`);
            const dy = nextTransform.y - finiteNumber(previousTransform.y, `building placement ${placementId} current transform.y`);
            const buildingData = getBuildingDataForPlacement(state, placement);

            placement.transform = nextTransform;
            if (buildingData) {
                placement.footprintPolygons = computeBuildingPlacementFootprint(buildingData, placement);
                setPlacementMovementBlockerPolygons(
                    placement,
                    computeBuildingPlacementMovementBlockerPolygons(buildingData, placement)
                );
            } else {
                if (rotationChanged) {
                    placement.transform = previousTransform;
                    throw new Error(`cannot rotate building placement ${placementId} before its building save is loaded`);
                }
                placement.footprintPolygons = normalizeFootprintPolygons(
                    translateBuildingPlacementPolygons(
                        placement.footprintPolygons,
                        dx,
                        dy,
                        `building placement ${placementId} footprintPolygons`
                    ),
                    `building placement ${placementId} footprintPolygons`
                );
                if (placement.movementBlockerPolygons !== null) {
                    setPlacementMovementBlockerPolygons(
                        placement,
                        translateBuildingPlacementPolygons(
                            placement.movementBlockerPolygons,
                            dx,
                            dy,
                            `building placement ${placementId} movementBlockerPolygons`
                        )
                    );
                }
            }
            if (placement.footprintPolygons.length === 0) {
                placement.transform = previousTransform;
                throw new Error(`missing footprint after moving building placement ${placementId}`);
            }
            const previousTouchedSectionKeys = normalizeSectionKeys(placement.touchedSectionKeys || placement.overlappedSectionKeys);
            placement.overlappedSectionKeys = computeOverlappedSectionKeysForFootprint(this, placement.footprintPolygons);
            placement.touchedSectionKeys = placement.overlappedSectionKeys.slice();
            const instance = getBuildingInstanceRecord(state, placement);
            if (instance) {
                instance.transform = { ...placement.transform };
                instance.footprintPolygons = normalizeFootprintPolygons(placement.footprintPolygons);
                instance.movementBlockerPolygons = placement.movementBlockerPolygons === null
                    ? null
                    : normalizeMovementBlockerPolygons(placement.movementBlockerPolygons);
                instance.movementBlockerGeometryVersion = placement.movementBlockerGeometryVersion || "";
                instance.movementBlockedEdges = null;
                instance.movementEdgeBlockerVersion = "";
                instance.touchedSectionKeys = placement.touchedSectionKeys.slice();
                instance.overlappedSectionKeys = placement.touchedSectionKeys.slice();
                instance.contentVersion = Number(instance.contentVersion || 1) + 1;
                placement.contentVersion = instance.contentVersion;
                setBuildingInstanceRecord(state, instance, { markDirty: true });
            }
            destroyPrototypeBuildingPlacementBitmapEntries(state, placementId);
            clearPrototypeBuildingGeometryRuntime(this, placementId);
            state.contentVersion += 1;
            rebuildBuildingPlacementIndex(this);
            syncPrototypeBuildingPlacementRefsToSections(this);
            markPrototypeSectionUnitsDirty(state, previousTouchedSectionKeys.concat(placement.touchedSectionKeys));
            markPrototypeBuildingMovementBlockersDirty(this);
            maybeSyncPrototypeBuildingGeometryRuntime(this);
            if (hasPrototypeBuildingMovementNodeRegistry(this)) {
                syncPrototypeBuildingMovementBlockers(this);
            }
            if (typeof this.markBuildingRenderCacheDirty === "function") {
                this.markBuildingRenderCacheDirty();
            }
            if (typeof globalScope.invalidateMinimap === "function") {
                globalScope.invalidateMinimap();
            }
            return placement;
        };

        map.preparePrototypeBuildingPlacement = async function preparePrototypeBuildingPlacement(buildingSaveName, transform) {
            const saveName = nonEmptyString(buildingSaveName, "buildingSaveName");
            const tx = finiteNumber(transform && transform.x, "building placement transform.x");
            const ty = finiteNumber(transform && transform.y, "building placement transform.y");
            const rotation = Number.isFinite(Number(transform && transform.rotation)) ? Number(transform.rotation) : 0;
            const response = await fetch(`/api/building-editor/buildings/${encodeURIComponent(saveName)}`, { cache: "no-cache" });
            const payload = await response.json();
            if (!response.ok || !payload || !payload.ok || !payload.data) {
                throw new Error(`failed to load building save ${saveName}`);
            }
            assertValidBuildingEditorSave(payload.data, saveName);
            const placement = {
                id: "building:preview",
                buildingSaveName: saveName,
                transform: { x: tx, y: ty, rotation }
            };
            const footprintPolygons = computeBuildingPlacementFootprint(payload.data, placement);
            const movementBlockerPolygons = computeBuildingPlacementMovementBlockerPolygons(payload.data, placement);
            const overlappedSectionKeys = computeOverlappedSectionKeysForFootprint(this, footprintPolygons);
            return {
                buildingData: payload.data,
                buildingSaveName: saveName,
                transform: { x: tx, y: ty, rotation },
                footprintPolygons,
                movementBlockerPolygons,
                movementBlockerGeometryVersion: MOVEMENT_BLOCKER_GEOMETRY_VERSION,
                overlappedSectionKeys
            };
        };

        map.syncPrototypeBuildingMovementBlockers = function syncPrototypeBuildingMovementBlockersForMap(options = {}) {
            return syncPrototypeBuildingMovementBlockers(this, options);
        };

        map.markPrototypeBuildingMovementBlockersDirty = function markPrototypeBuildingMovementBlockersDirtyForMap() {
            return markPrototypeBuildingMovementBlockersDirty(this);
        };

        map.collectPrototypeBuildingMovementBlockersInBounds = function collectPrototypeBuildingMovementBlockersInBoundsForMap(bounds, traversalLayer = 0, options = {}) {
            return collectPrototypeBuildingMovementBlockersInBounds(this, bounds, traversalLayer, options);
        };

        map.syncPrototypeBuildingGeometryRuntime = function syncPrototypeBuildingGeometryRuntimeForMap() {
            return syncPrototypeBuildingGeometryRuntime(this);
        };

        if (!map._prototypeBuildingState) {
            map.initializePrototypeBuildingState([]);
        }
        return map._prototypeBuildingState;
    }

    globalScope.__sectionWorldBuildings = {
        BUILDING_PLACEMENT_SCHEMA,
        assertValidBuildingEditorSave,
        computeBuildingPlacementFootprint,
        computeBuildingPlacementMovementBlockerPolygons,
        createPrototypeBuildingCutawayRecord,
        computeOverlappedSectionKeysForFootprint,
        createPrototypeBuildingState,
        markPrototypeBuildingMovementBlockersDirty,
        installSectionWorldBuildingApis,
        cloneBuildingPlacementRefs,
        normalizeBuildingPlacementRecord,
        rebuildBuildingPlacementIndex,
        syncPrototypeBuildingPlacementRefsToSections,
        collectPrototypeBuildingMovementBlockersInBounds,
        syncPrototypeBuildingMovementBlockers,
        syncPrototypeBuildingGeometryRuntime
    };
})(typeof globalThis !== "undefined" ? globalThis : window);

if (typeof module !== "undefined" && module.exports) {
    module.exports = globalThis.__sectionWorldBuildings;
}
