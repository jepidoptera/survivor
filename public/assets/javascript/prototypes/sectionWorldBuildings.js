(function (globalScope) {
    "use strict";

    const BUILDING_PLACEMENT_SCHEMA = "survivor-building-placement-v1";
    const BUILDING_SAVE_SCHEMA = "survivor-building-v1";
    const EXTERIOR_BITMAP_RENDER_DATA_VERSION = "depth-rgb-biased-v3";
    const INTERIOR_BITMAP_RENDER_DATA_VERSION = "depth-rgb-interior-v4-z-baked";
    const MOVEMENT_BLOCKER_GEOMETRY_VERSION = "layered-wall-column-v3-vertical-span";
    const DEFAULT_BUILDING_WALL_HEIGHT = 3;

    function finiteNumber(value, label) {
        const num = Number(value);
        if (!Number.isFinite(num)) {
            throw new Error(`${label} must be a finite number`);
        }
        return num;
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
            : (Number.isFinite(Number(entry.level)) ? Math.round(Number(entry.level)) : null);
        if (!Number.isFinite(traversalLayer)) {
            throw new Error(`${label} ${index} movement blocker entry requires traversalLayer`);
        }
        const normalized = {
            polygon: normalizePolygon(entry.polygon, `${label} ${index} polygon`),
            level: Number.isFinite(Number(entry.level)) ? Math.round(Number(entry.level)) : traversalLayer,
            traversalLayer
        };
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
                : (Number.isFinite(Number(entry.level)) ? Math.round(Number(entry.level)) : null);
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

    function exteriorBitmapSettingsSignature(placement, options = {}, dataSignature = "") {
        const transform = placement && placement.transform ? placement.transform : {};
        const pixelsPerWorldUnit = Number.isFinite(Number(options.pixelsPerWorldUnit))
            ? Number(options.pixelsPerWorldUnit)
            : 72;
        const paddingPixels = Number.isFinite(Number(options.paddingPixels))
            ? Number(options.paddingPixels)
            : 48;
        const maxDimension = Number.isFinite(Number(options.maxDimension))
            ? Number(options.maxDimension)
            : 2048;
        const pitch = Number.isFinite(Number(options.pitch))
            ? Number(options.pitch)
            : Math.PI / 4;
        return [
            EXTERIOR_BITMAP_RENDER_DATA_VERSION,
            String(placement && placement.buildingSaveName || ""),
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

    function interiorBitmapSettingsSignature(placement, floorId, options = {}, dataSignature = "") {
        const transform = placement && placement.transform ? placement.transform : {};
        const pixelsPerWorldUnit = Number.isFinite(Number(options.pixelsPerWorldUnit))
            ? Number(options.pixelsPerWorldUnit)
            : 72;
        const paddingPixels = Number.isFinite(Number(options.paddingPixels))
            ? Number(options.paddingPixels)
            : 48;
        const maxDimension = Number.isFinite(Number(options.maxDimension))
            ? Number(options.maxDimension)
            : 2048;
        const pitch = Number.isFinite(Number(options.pitch))
            ? Number(options.pitch)
            : Math.PI / 4;
        return [
            INTERIOR_BITMAP_RENDER_DATA_VERSION,
            String(placement && placement.buildingSaveName || ""),
            String(floorId || ""),
            Number(transform.rotation || 0).toFixed(6),
            pixelsPerWorldUnit.toFixed(3),
            paddingPixels,
            maxDimension,
            pitch.toFixed(6),
            String(dataSignature || "")
        ].join("|");
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
        return {
            schema: BUILDING_PLACEMENT_SCHEMA,
            id: normalizePlacementId(record.id, index),
            buildingSaveName: nonEmptyString(record.buildingSaveName, `building placement ${index} buildingSaveName`),
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
            overlappedSectionKeys: normalizeSectionKeys(record.overlappedSectionKeys),
            loadState: typeof record.loadState === "string" && record.loadState.length > 0
                ? record.loadState
                : "unloaded"
        };
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
        if (Number.isFinite(Number(floor && floor.nodeBaseZ))) return Number(floor.nodeBaseZ);
        const offset = Number.isFinite(Number(floor && floor.nodeBaseZOffset))
            ? Number(floor.nodeBaseZOffset)
            : 0;
        return (Number(layer) || 0) * 3 + offset;
    }

    function getBuildingFloorId(floor, fallback = "") {
        const id = floor && (floor.fragmentId || floor.surfaceId || floor.id || fallback);
        return String(id === undefined || id === null ? "" : id);
    }

    function getBuildingFloorLayer(floor) {
        const candidates = [
            floor && floor.traversalLayer,
            floor && floor.level,
            floor && Number(floor.nodeBaseZ) / 3,
            floor && Number(floor.nodeBaseZOffset) / 3
        ];
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
            const layer = Number.isFinite(Number(wall && wall.traversalLayer))
                ? Math.round(Number(wall.traversalLayer))
                : (floorIdsByLayer.has(wallFloorId) ? floorIdsByLayer.get(wallFloorId) : 0);
            const bottomZ = buildingElementBottomZ(ownerFloor, layer, wall);
            const height = buildingElementHeight(ownerFloor, wall);
            const polygons = wallMovementBlockerPolygons(buildingData, wall);
            for (let p = 0; p < polygons.length; p++) {
                localEntries.push({ polygon: polygons[p], level: layer, traversalLayer: layer, bottomZ, height });
            }
        }
        for (let i = 0; i < floors.length; i++) {
            const floor = floors[i];
            const floorLayer = getBuildingFloorLayer(floor);
            const columns = Array.isArray(floor && floor.columns) ? floor.columns : [];
            for (let c = 0; c < columns.length; c++) {
                const column = columns[c];
                const layer = Number.isFinite(Number(column && column.traversalLayer))
                    ? Math.round(Number(column.traversalLayer))
                    : floorLayer;
                localEntries.push({
                    polygon: columnMovementBlockerPolygon(column),
                    level: layer,
                    traversalLayer: layer,
                    bottomZ: buildingElementBottomZ(floor, layer, column),
                    height: buildingElementHeight(floor, column)
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
            height: entry.height
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
        return placement.movementBlockerPolygons;
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
            level: layer,
            nodeBaseZ: getBuildingLayerBaseZ(floor, layer),
            nodeBaseZOffset: Number.isFinite(Number(floor && floor.nodeBaseZOffset)) ? Number(floor.nodeBaseZOffset) : 0,
            outerPolygon: interiorPolygonsByFloor instanceof Map && interiorPolygonsByFloor.has(sourceFloorId)
                ? normalizePolygon(interiorPolygonsByFloor.get(sourceFloorId), `building placement ${placement.id} floor ${sourceFloorId} interiorPolygon`)
                : transformPolygon(floor && floor.outerPolygon, placement.transform, `building placement ${placement.id} floor ${sourceFloorId} outerPolygon`),
            holes,
            renderedByBuildingCutaway: true,
            _prototypeBuildingPlacementId: placement.id,
            _prototypeBuildingSourceFragmentId: sourceFloorId
        };
    }

    function createPrototypeBuildingWallItem(placement, wall, sourceFloorToFragmentId, index) {
        const wallId = String(wall && wall.id);
        if (!wallId) throw new Error(`building placement ${placement.id} wall ${index} missing wall id`);
        const points = wallCenterlinePoints(wall);
        const sourceFloorId = String(wall && (wall.fragmentId || wall.floorId) || "");
        const fragmentId = sourceFloorToFragmentId.get(sourceFloorId) || "";
        const layer = Number.isFinite(Number(wall && wall.traversalLayer))
            ? Math.round(Number(wall.traversalLayer))
            : 0;
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
            bottomZ: Number.isFinite(Number(wall && wall.bottomZ)) ? Number(wall.bottomZ) : layer * 3,
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
        const placement = normalizeBuildingPlacementRecord(placementRecord);
        const fragments = [];
        const sourceFloorToFragmentId = new Map();
        const interiorPolygonsByFloor = computeInteriorPolygonsByFloor(buildingData, placement);
        for (let i = 0; i < buildingData.floorFragments.length; i++) {
            const floor = buildingData.floorFragments[i];
            const fragment = createPrototypeBuildingFragment(placement, floor, i, interiorPolygonsByFloor);
            fragments.push(fragment);
            sourceFloorToFragmentId.set(getBuildingFloorId(floor, i), fragment.fragmentId);
        }
        if (fragments.length === 0) {
            throw new Error(`building placement ${placement.id} has no cutaway floor fragments`);
        }

        const renderItems = [];
        const wallItemsBySourceId = new Map();
        const walls = Array.isArray(buildingData.wallSections) ? buildingData.wallSections : [];
        for (let i = 0; i < walls.length; i++) {
            const wall = walls[i];
            const wallItem = createPrototypeBuildingWallItem(placement, wall, sourceFloorToFragmentId, i);
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
        const fragmentIds = new Set();
        const surfaceIds = new Set();
        for (let i = 0; i < fragments.length; i++) {
            const level = getBuildingFloorLayer(fragments[i]);
            minLevel = Math.min(minLevel, level);
            maxLevel = Math.max(maxLevel, level);
            fragmentIds.add(fragments[i].fragmentId);
            surfaceIds.add(fragments[i].surfaceId);
        }
        if (!Number.isFinite(minLevel) || !Number.isFinite(maxLevel)) {
            throw new Error(`building placement ${placement.id} cutaway record has invalid floor levels`);
        }

        const building = {
            buildingId: placement.id,
            placementId: placement.id,
            buildingSaveName: placement.buildingSaveName,
            minLevel,
            maxLevel,
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

    function findBuildingRuntimeFloorAtZ(fragments, z, point, stairId, endpointLabel) {
        const targetZ = finiteNumber(z, `stair ${stairId} ${endpointLabel} z`);
        const matches = [];
        for (let i = 0; i < fragments.length; i++) {
            const fragment = fragments[i];
            if (!fragment) continue;
            const fragmentZ = getBuildingLayerBaseZ(fragment, getBuildingFloorLayer(fragment));
            if (Math.abs(fragmentZ - targetZ) > 0.000001) continue;
            if (!fragmentContainsWorldPoint(fragment, point)) continue;
            matches.push(fragment);
        }
        matches.sort((a, b) => polygonArea(a.outerPolygon) - polygonArea(b.outerPolygon));
        if (matches[0]) return matches[0];
        throw new Error(`building stair ${stairId} cannot resolve ${endpointLabel} floor at z ${targetZ}`);
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

    function clearPrototypeBuildingMovementBlockers(state) {
        if (!state || !(state.movementBlockersByPlacementId instanceof Map)) return;
        for (const blockers of state.movementBlockersByPlacementId.values()) {
            if (!Array.isArray(blockers)) continue;
            for (let i = 0; i < blockers.length; i++) {
                removePrototypeBuildingMovementBlocker(blockers[i]);
            }
        }
        state.movementBlockersByPlacementId.clear();
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
        const promise = map.loadPrototypeBuildingEditorSaveData(placement.buildingSaveName)
            .then((buildingData) => {
                setPlacementMovementBlockerPolygons(
                    placement,
                    computeBuildingPlacementMovementBlockerPolygons(buildingData, placement)
                );
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
        const saveName = placement.buildingSaveName;
        const buildingData = state && state.buildingDataBySaveName instanceof Map
            ? state.buildingDataBySaveName.get(saveName)
            : null;
        if (buildingData && !placementHasCurrentMovementBlockerGeometry(placement)) {
            setPlacementMovementBlockerPolygons(
                placement,
                computeBuildingPlacementMovementBlockerPolygons(buildingData, placement)
            );
            return placement.movementBlockerPolygons;
        }
        if (Array.isArray(placement.movementBlockerPolygons)) {
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

    function syncPrototypeBuildingMovementBlockers(map) {
        const state = map && map._prototypeBuildingState;
        if (!state) return 0;
        const registry = getPrototypeBuildingMovementNodeRegistry(map);
        const registrySize = registry instanceof Map ? registry.size : 0;
        if (
            state.movementBlockersDirty !== true &&
            Number(state.movementBlockerNodeRegistrySize) === registrySize &&
            arePrototypeBuildingMovementBlockersCurrent(map, state, registry)
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
        let awaitingGeometry = 0;
        for (let i = 0; i < placements.length; i++) {
            const placement = placements[i];
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
        }
        state.lastMovementBlockerStats = {
            placements: placements.length,
            blockers: Array.from(state.movementBlockersByPlacementId.values()).reduce((sum, blockers) => sum + blockers.length, 0),
            nodeAttachments: attachedCount,
            awaitingGeometry
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
        if (
            state.movementBlockersDirty === true ||
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
            movementBlockersByPlacementId: new Map(),
            pendingMovementGeometryByPlacementId: new Map(),
            cutawayBuildingsByPlacementId: new Map(),
            runtimeFloorFragmentIdsByPlacementId: new Map(),
            runtimeStairIdsByPlacementId: new Map(),
            lastCutawayGeometryStats: null,
            lastGeometryRuntimeStats: null,
            movementBlockersDirty: true,
            movementBlockerNodeRegistrySize: 0,
            lastIndexStats: null,
            lastSyncStats: null,
            lastMovementBlockerStats: null,
            lastMovementBlockerError: null,
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
            const keys = normalizeSectionKeys(placement.overlappedSectionKeys);
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

    function clearPrototypeBuildingGeometryRuntime(map, placementId) {
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
            removed += map.unregisterFloorFragments(fragmentIds);
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
        let stairs = 0;
        let pending = 0;
        for (let i = 0; i < state.orderedPlacements.length; i++) {
            const placement = state.orderedPlacements[i];
            if (!placement || !placement.id) continue;
            const buildingData = state.buildingDataBySaveName instanceof Map
                ? state.buildingDataBySaveName.get(placement.buildingSaveName)
                : null;
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
            const interiorPolygonsByFloor = computeInteriorPolygonsByFloor(buildingData, placement);
            const fragments = [];
            for (let f = 0; f < buildingData.floorFragments.length; f++) {
                const fragment = createPrototypeBuildingFragment(placement, buildingData.floorFragments[f], f, interiorPolygonsByFloor);
                const registered = map.registerFloorFragment(fragment);
                if (!registered) throw new Error(`building placement ${placement.id} failed to register floor ${fragment.fragmentId}`);
                fragments.push(registered);
            }
            const runtimeStairs = createPrototypeBuildingStairRuntimeRecords(buildingData, placement, fragments);
            const stairIds = [];
            for (let s = 0; s < runtimeStairs.length; s++) {
                const registeredStair = map.registerStairRuntimeRecord(runtimeStairs[s]);
                if (!registeredStair) throw new Error(`building placement ${placement.id} failed to register stair ${runtimeStairs[s].id}`);
                stairIds.push(registeredStair.id);
            }
            state.runtimeFloorFragmentIdsByPlacementId.set(placement.id, fragments.map((fragment) => fragment.fragmentId));
            state.runtimeStairIdsByPlacementId.set(placement.id, stairIds);
            floors += fragments.length;
            stairs += stairIds.length;
        }
        state.lastGeometryRuntimeStats = {
            placements: state.orderedPlacements.length,
            floors,
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
            const normalized = Array.isArray(records)
                ? records.map((record, index) => normalizeBuildingPlacementRecord(record, index))
                : [];
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
            markPrototypeBuildingMovementBlockersDirty(this);
            if (hasPrototypeBuildingMovementNodeRegistry(this)) {
                syncPrototypeBuildingMovementBlockers(this);
            }
            return state;
        };

        map.exportPrototypeBuildingPlacements = function exportPrototypeBuildingPlacements() {
            const state = this._prototypeBuildingState;
            if (!state || !Array.isArray(state.orderedPlacements)) return [];
            return state.orderedPlacements.map((placement) => JSON.parse(JSON.stringify(placement)));
        };

        map.getPrototypeBuildingPlacements = function getPrototypeBuildingPlacements() {
            const state = this._prototypeBuildingState;
            return state && Array.isArray(state.orderedPlacements)
                ? state.orderedPlacements.slice()
                : [];
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
                state.buildingDataBySaveName.set(placement.buildingSaveName, options.buildingData);
            }
            if (placement.footprintPolygons.length === 0) {
                throw new Error(`missing footprint for building placement ${placement.id}`);
            }
            placement.overlappedSectionKeys = computeOverlappedSectionKeysForFootprint(this, placement.footprintPolygons);
            state.placementsById.set(placement.id, placement);
            state.orderedPlacements.push(placement);
            state.contentVersion += 1;
            rebuildBuildingPlacementIndex(this);
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
                        if (placementHasCurrentMovementBlockerGeometry(placement)) return;
                        setPlacementMovementBlockerPolygons(
                            placement,
                            computeBuildingPlacementMovementBlockerPolygons(buildingData, placement)
                        );
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
            const loadPromise = this.loadPrototypeBuildingEditorSaveData(placement.buildingSaveName)
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
                            : 48,
                        maxDimension: Number.isFinite(Number(options.maxDimension))
                            ? Number(options.maxDimension)
                            : 2048
                    });
                    if (!result || !result.texture) {
                        throw new Error(`building exterior bitmap render returned no texture for ${placementId}`);
                    }
                    if (!result.depthMetricTexture || !result.depthMetric || !(Number(result.depthMetric.span) > 0)) {
                        throw new Error(`building exterior bitmap render returned no depth metric texture for ${placementId}`);
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
            const cached = state.interiorBitmapsByKey.get(key) || null;
            const pending = state.pendingInteriorBitmapLoadsByKey.get(key) || null;
            const settingsSignature = interiorBitmapSettingsSignature(placement, sourceFloorId, options);
            if (cached && cached.status === "ready" && cached.settingsSignature === settingsSignature) {
                return cached;
            }
            if (cached && cached.status === "error" && cached.settingsSignature === settingsSignature) {
                return cached;
            }
            if (pending && pending.settingsSignature === settingsSignature) {
                return cached || { status: "loading", id: key, placementId, floorId: sourceFloorId, settingsSignature };
            }
            const appRef = (options && options.app) || globalScope.app || null;
            const rendererRef = (options && options.renderer) || (appRef && appRef.renderer) || null;
            if (!appRef || !rendererRef) {
                throw new Error("building interior bitmap request requires a Pixi app and renderer");
            }
            const loadPromise = this.loadPrototypeBuildingEditorSaveData(placement.buildingSaveName)
                .then(async (buildingData) => {
                    const dataSignature = buildingDataSignature(buildingData);
                    const signature = interiorBitmapSettingsSignature(placement, sourceFloorId, options, dataSignature);
                    const existing = state.interiorBitmapsByKey.get(key);
                    if (existing && existing.status === "ready" && existing.signature === signature) {
                        return existing;
                    }
                    const module = await import("/building-editor/BuildingRenderer.js");
                    if (!module || typeof module.renderBuildingInteriorBitmap !== "function") {
                        throw new Error("BuildingRenderer.js missing renderBuildingInteriorBitmap export");
                    }
                    const result = await module.renderBuildingInteriorBitmap(buildingData, {
                        app: appRef,
                        renderer: rendererRef,
                        floorId: sourceFloorId,
                        rotation: Number(placement.transform && placement.transform.rotation) || 0,
                        pitch: Number.isFinite(Number(options.pitch)) ? Number(options.pitch) : Math.PI / 4,
                        pixelsPerWorldUnit: Number.isFinite(Number(options.pixelsPerWorldUnit))
                            ? Number(options.pixelsPerWorldUnit)
                            : 72,
                        paddingPixels: Number.isFinite(Number(options.paddingPixels))
                            ? Number(options.paddingPixels)
                            : 48,
                        maxDimension: Number.isFinite(Number(options.maxDimension))
                            ? Number(options.maxDimension)
                            : 2048
                    });
                    if (!result || !result.texture) {
                        throw new Error(`building interior bitmap render returned no texture for ${placementId} floor ${sourceFloorId}`);
                    }
                    if (!result.depthMetricTexture || !result.depthMetric || !(Number(result.depthMetric.span) > 0)) {
                        throw new Error(`building interior bitmap render returned no depth metric texture for ${placementId} floor ${sourceFloorId}`);
                    }
                    const previous = state.interiorBitmapsByKey.get(key);
                    if (previous && previous !== result) destroyPrototypeBuildingBitmapEntry(previous);
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
                    state.interiorBitmapsByKey.set(key, entry);
                    return entry;
                })
                .catch((error) => {
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
                    console.error("[building interior bitmap]", entry.error);
                    throw error;
                })
                .finally(() => {
                    state.pendingInteriorBitmapLoadsByKey.delete(key);
                });
            state.pendingInteriorBitmapLoadsByKey.set(key, {
                settingsSignature,
                promise: loadPromise
            });
            state.interiorBitmapsByKey.set(key, {
                id: key,
                placementId,
                floorId: sourceFloorId,
                status: "loading",
                settingsSignature,
                buildingSaveName: placement.buildingSaveName
            });
            loadPromise.catch(() => {});
            return state.interiorBitmapsByKey.get(key);
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
                const buildingData = state.buildingDataBySaveName instanceof Map
                    ? state.buildingDataBySaveName.get(placement.buildingSaveName)
                    : null;
                if (!buildingData) {
                    pending += 1;
                    if (typeof this.loadPrototypeBuildingEditorSaveData === "function") {
                        this.loadPrototypeBuildingEditorSaveData(placement.buildingSaveName).catch((error) => {
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
            state.placementsById.delete(placementId);
            state.orderedPlacements = state.orderedPlacements.filter((placement) => placement.id !== placementId);
            const exteriorEntry = state.exteriorBitmapsById.get(placementId);
            destroyPrototypeBuildingBitmapEntry(exteriorEntry);
            state.exteriorBitmapsById.delete(placementId);
            state.pendingExteriorBitmapLoadsById.delete(placementId);
            if (state.interiorBitmapsByKey instanceof Map) {
                for (const [key, entry] of state.interiorBitmapsByKey.entries()) {
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
            clearPrototypeBuildingGeometryRuntime(this, placementId);
            state.contentVersion += 1;
            rebuildBuildingPlacementIndex(this);
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

        map.syncPrototypeBuildingMovementBlockers = function syncPrototypeBuildingMovementBlockersForMap() {
            return syncPrototypeBuildingMovementBlockers(this);
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
        normalizeBuildingPlacementRecord,
        rebuildBuildingPlacementIndex,
        collectPrototypeBuildingMovementBlockersInBounds,
        syncPrototypeBuildingMovementBlockers,
        syncPrototypeBuildingGeometryRuntime
    };
})(typeof globalThis !== "undefined" ? globalThis : window);

if (typeof module !== "undefined" && module.exports) {
    module.exports = globalThis.__sectionWorldBuildings;
}
