"use strict";

(function installFloorFragmentEdit(globalScope) {
    function normalizeLevel(value) {
        return Number.isFinite(value) ? Math.round(Number(value)) : 0;
    }

    function normalizeRing(points) {
        if (!Array.isArray(points)) return [];
        const out = [];
        for (let i = 0; i < points.length; i++) {
            const x = Number(points[i] && points[i].x);
            const y = Number(points[i] && points[i].y);
            if (Number.isFinite(x) && Number.isFinite(y)) out.push({ x, y });
        }
        return out;
    }

    function pointOnSegment(x, y, a, b) {
        const ax = Number(a && a.x);
        const ay = Number(a && a.y);
        const bx = Number(b && b.x);
        const by = Number(b && b.y);
        if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) return false;
        const dx = bx - ax;
        const dy = by - ay;
        const lenSq = dx * dx + dy * dy;
        if (lenSq <= 1e-12) return Math.hypot(x - ax, y - ay) <= 1e-6;
        const t = ((x - ax) * dx + (y - ay) * dy) / lenSq;
        if (t < -1e-6 || t > 1 + 1e-6) return false;
        const px = ax + t * dx;
        const py = ay + t * dy;
        return Math.hypot(x - px, y - py) <= 1e-6;
    }

    function pointInOrOnRing(x, y, points) {
        const ring = normalizeRing(points);
        if (ring.length < 3) return false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            if (pointOnSegment(x, y, ring[j], ring[i])) return true;
        }
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const xi = ring[i].x;
            const yi = ring[i].y;
            const xj = ring[j].x;
            const yj = ring[j].y;
            const intersects = ((yi > y) !== (yj > y)) &&
                (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi);
            if (intersects) inside = !inside;
        }
        return inside;
    }

    function getBooleanApi() {
        if (globalScope && globalScope.polygonClipping) return globalScope.polygonClipping;
        if (typeof require === "function") {
            try {
                return require("polygon-clipping");
            } catch (_err) {
                return null;
            }
        }
        return null;
    }

    function pointsToClipRing(points) {
        const ring = normalizeRing(points).map(point => [point.x, point.y]);
        if (ring.length < 3) return null;
        const first = ring[0];
        const last = ring[ring.length - 1];
        if (!last || Math.abs(first[0] - last[0]) > 1e-9 || Math.abs(first[1] - last[1]) > 1e-9) {
            ring.push([first[0], first[1]]);
        }
        return ring;
    }

    function clipRingToPoints(ring) {
        const out = [];
        if (!Array.isArray(ring)) return out;
        for (let i = 0; i < ring.length; i++) {
            const pair = ring[i];
            const x = Number(pair && pair[0]);
            const y = Number(pair && pair[1]);
            if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
            if (
                i === ring.length - 1 &&
                out.length > 0 &&
                Math.abs(out[0].x - x) <= 1e-9 &&
                Math.abs(out[0].y - y) <= 1e-9
            ) {
                continue;
            }
            out.push({ x, y });
        }
        return out;
    }

    function geometryFromPoints(points) {
        const ring = pointsToClipRing(points);
        return ring ? [[ring]] : [];
    }

    function isEmptyGeometry(geometry) {
        return !Array.isArray(geometry) || geometry.length === 0;
    }

    function booleanGeometry(operation, ...geometries) {
        const api = getBooleanApi();
        if (!api || typeof api[operation] !== "function") {
            throw new Error("floor fragment editing requires polygon-clipping");
        }
        if (operation === "difference") {
            const subject = geometries[0];
            if (isEmptyGeometry(subject)) return [];
            const clips = geometries.slice(1).filter(geometry => !isEmptyGeometry(geometry));
            return clips.length > 0 ? api.difference(subject, ...clips) : subject;
        }
        const usable = geometries.filter(geometry => !isEmptyGeometry(geometry));
        if (usable.length === 0) return [];
        return usable.length === 1 ? usable[0] : api[operation](...usable);
    }

    function geometriesEquivalent(a, b) {
        return isEmptyGeometry(booleanGeometry("difference", a, b)) &&
            isEmptyGeometry(booleanGeometry("difference", b, a));
    }

    function worldFromTileKey(tileKey) {
        const [xRaw, yRaw] = String(tileKey || "").split(",");
        const x = Number(xRaw);
        const y = Number(yRaw);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        return { x: x * 0.866, y: y + (x % 2 === 0 ? 0.5 : 0) };
    }

    function tileKeysForPolygon(asset, outer, holes) {
        const keys = Array.isArray(asset && asset.tileCoordKeys) ? asset.tileCoordKeys : [];
        const out = [];
        for (let i = 0; i < keys.length; i++) {
            const point = worldFromTileKey(keys[i]);
            if (!point) continue;
            if (!pointInOrOnRing(point.x, point.y, outer)) continue;
            let insideHole = false;
            const normalizedHoles = Array.isArray(holes) ? holes : [];
            for (let h = 0; h < normalizedHoles.length; h++) {
                if (pointInOrOnRing(point.x, point.y, normalizedHoles[h])) {
                    insideHole = true;
                    break;
                }
            }
            if (!insideHole) out.push(keys[i]);
        }
        return out;
    }

    function fragmentGeometry(fragment) {
        if (!fragment) return [];
        const outer = pointsToClipRing(fragment.outerPolygon);
        if (!outer) return [];
        const polygon = [outer];
        const holes = Array.isArray(fragment.holes) ? fragment.holes : [];
        for (let i = 0; i < holes.length; i++) {
            const hole = pointsToClipRing(holes[i]);
            if (hole) polygon.push(hole);
        }
        return [polygon];
    }

    function fragmentOuterGeometry(fragment) {
        if (!fragment) return [];
        const outer = pointsToClipRing(fragment.outerPolygon);
        return outer ? [[outer]] : [];
    }

    function countSharedOuterVertices(a, b) {
        const aPoints = normalizeRing(a && a.outerPolygon);
        const bPoints = normalizeRing(b && b.outerPolygon);
        if (aPoints.length === 0 || bPoints.length === 0) return 0;
        let count = 0;
        for (let i = 0; i < aPoints.length; i++) {
            for (let j = 0; j < bPoints.length; j++) {
                if (
                    Math.abs(aPoints[i].x - bPoints[j].x) <= 1e-6 &&
                    Math.abs(aPoints[i].y - bPoints[j].y) <= 1e-6
                ) {
                    count += 1;
                    break;
                }
            }
        }
        return count;
    }

    function sectionPolygon(asset, basis, options = {}) {
        if (typeof options.getSectionPolygon === "function") {
            return options.getSectionPolygon(asset, basis);
        }
        if (Array.isArray(asset && asset.sectionPolygon) && asset.sectionPolygon.length >= 3) {
            return asset.sectionPolygon.map(point => ({ x: Number(point.x), y: Number(point.y) }));
        }
        const sectionGeometryApi = globalScope ? globalScope.__sectionGeometry : null;
        if (
            sectionGeometryApi &&
            typeof sectionGeometryApi.getSectionHexagonCorners === "function" &&
            asset &&
            asset.centerAxial &&
            basis
        ) {
            return sectionGeometryApi.getSectionHexagonCorners(asset.centerAxial, basis);
        }
        throw new Error(`cannot resolve floor edit section polygon for section ${asset && asset.key ? asset.key : "(unknown)"}`);
    }

    function assetAreaGeometry(asset, level, options = {}) {
        const targetLevel = normalizeLevel(level);
        const floorGeometries = [];
        const floors = Array.isArray(asset && asset.floors) ? asset.floors : [];
        for (let i = 0; i < floors.length; i++) {
            const floor = floors[i];
            if (!floor || normalizeLevel(floor.level) !== targetLevel) continue;
            const geom = fragmentGeometry(floor);
            if (!isEmptyGeometry(geom)) floorGeometries.push(geom);
        }
        let area = floorGeometries.length > 0 ? booleanGeometry("union", ...floorGeometries) : [];
        if (floorGeometries.length === 0 && targetLevel === 0) {
            area = geometryFromPoints(sectionPolygon(asset, options.basis || null, options));
        }
        const legacyHoles = options.includeLegacyHoles === false
            ? []
            : (Array.isArray(asset && asset.floorHoles) ? asset.floorHoles : []);
        for (let i = 0; i < legacyHoles.length; i++) {
            const hole = legacyHoles[i];
            if (!hole || normalizeLevel(hole.level) !== targetLevel) continue;
            const holeGeom = geometryFromPoints(hole.points);
            if (!isEmptyGeometry(holeGeom)) area = booleanGeometry("difference", area, holeGeom);
        }
        return area;
    }

    function inferStyle(asset, level, reusableRecords, options = {}) {
        const targetLevel = normalizeLevel(level);
        const preferred = options.preferredStyle || null;
        const style = {
            nodeBaseZ: Number.isFinite(preferred && preferred.nodeBaseZ) ? Number(preferred.nodeBaseZ) : targetLevel * 3,
            nodeBaseZOffset: Number.isFinite(preferred && preferred.nodeBaseZOffset) ? Number(preferred.nodeBaseZOffset) : 0,
            texturePath: preferred && typeof preferred.texturePath === "string" ? preferred.texturePath : ""
        };
        const records = Array.isArray(reusableRecords) && reusableRecords.length > 0
            ? reusableRecords
            : (Array.isArray(asset && asset.floors) ? asset.floors : []);
        for (let i = 0; i < records.length; i++) {
            const record = records[i];
            if (!record || normalizeLevel(record.level) !== targetLevel) continue;
            if (Number.isFinite(record.nodeBaseZ)) style.nodeBaseZ = Number(record.nodeBaseZ);
            if (Number.isFinite(record.nodeBaseZOffset)) style.nodeBaseZOffset = Number(record.nodeBaseZOffset);
            if (!style.texturePath && typeof record.texturePath === "string" && record.texturePath.length > 0) {
                style.texturePath = record.texturePath;
            }
            break;
        }
        if (!style.texturePath && typeof options.defaultTexture === "string") style.texturePath = options.defaultTexture;
        return style;
    }

    function touchedFragments(asset, level, editGeometry, operation = "") {
        const targetLevel = normalizeLevel(level);
        const floors = Array.isArray(asset && asset.floors) ? asset.floors : [];
        const touched = [];
        for (let i = 0; i < floors.length; i++) {
            const floor = floors[i];
            if (!floor || normalizeLevel(floor.level) !== targetLevel) continue;
            const overlap = booleanGeometry("intersection", fragmentGeometry(floor), editGeometry);
            if (!isEmptyGeometry(overlap)) {
                touched.push(floor);
                continue;
            }
            if (operation === "add") {
                const outerOverlap = booleanGeometry("intersection", fragmentOuterGeometry(floor), editGeometry);
                if (!isEmptyGeometry(outerOverlap)) touched.push(floor);
            }
        }
        return touched;
    }

    function uniqueFragmentId(preferredId, fallbackId, usedIds) {
        const base = (typeof preferredId === "string" && preferredId.length > 0) ? preferredId : fallbackId;
        let candidate = base;
        let suffix = 0;
        while (usedIds.has(candidate)) {
            suffix += 1;
            candidate = `${base}:${suffix}`;
        }
        usedIds.add(candidate);
        return candidate;
    }

    function fragmentRecordsFromGeometry(asset, level, geometry, reusableRecords, usedIds, options = {}) {
        const records = [];
        const targetLevel = normalizeLevel(level);
        const reusable = Array.isArray(reusableRecords) ? reusableRecords : [];
        const style = inferStyle(asset, targetLevel, reusable, options);
        const fallbackSurfaceId = `floor_area:${asset.key}:${targetLevel}`;
        if (Array.isArray(geometry)) {
            for (let i = 0; i < geometry.length; i++) {
                const polygon = geometry[i];
                if (!Array.isArray(polygon) || polygon.length === 0) continue;
                const outer = clipRingToPoints(polygon[0]);
                if (outer.length < 3) continue;
                const holes = [];
                for (let h = 1; h < polygon.length; h++) {
                    const hole = clipRingToPoints(polygon[h]);
                    if (hole.length >= 3) holes.push(hole);
                }
                const oldRecord = reusable[i] || null;
                const preferredSurfaceId = typeof options.preferredSurfaceId === "string" && options.preferredSurfaceId.length > 0
                    ? options.preferredSurfaceId
                    : "";
                const surfaceId = oldRecord && typeof oldRecord.surfaceId === "string" && oldRecord.surfaceId.length > 0
                    ? oldRecord.surfaceId
                    : (preferredSurfaceId || fallbackSurfaceId);
                const record = {
                    fragmentId: uniqueFragmentId(
                        oldRecord && typeof oldRecord.fragmentId === "string" ? oldRecord.fragmentId : `${fallbackSurfaceId}:${i}`,
                        `${fallbackSurfaceId}:${i}`,
                        usedIds
                    ),
                    surfaceId,
                    ownerSectionKey: asset.key,
                    level: targetLevel,
                    nodeBaseZOffset: oldRecord && Number.isFinite(oldRecord.nodeBaseZOffset)
                        ? Number(oldRecord.nodeBaseZOffset)
                        : style.nodeBaseZOffset,
                    nodeBaseZ: oldRecord && Number.isFinite(oldRecord.nodeBaseZ)
                        ? Number(oldRecord.nodeBaseZ)
                        : style.nodeBaseZ,
                    outerPolygon: outer,
                    holes,
                    tileCoordKeys: tileKeysForPolygon(asset, outer, holes)
                };
                const texturePath = oldRecord && typeof oldRecord.texturePath === "string" && oldRecord.texturePath.length > 0
                    ? oldRecord.texturePath
                    : style.texturePath;
                if (texturePath) record.texturePath = texturePath;
                records.push(record);
            }
        }
        if (records.length === 0 && targetLevel === 0) {
            records.push({
                fragmentId: uniqueFragmentId(`${fallbackSurfaceId}:empty`, `${fallbackSurfaceId}:empty`, usedIds),
                surfaceId: fallbackSurfaceId,
                ownerSectionKey: asset.key,
                level: 0,
                nodeBaseZOffset: 0,
                nodeBaseZ: 0,
                outerPolygon: [],
                holes: [],
                tileCoordKeys: [],
                _floorEditEmpty: true
            });
        }
        return records;
    }

    function applyAssetGeometryDelta(asset, level, editGeometry, operation, options = {}) {
        if (!asset) return { changed: false, fragments: 0, tiles: 0, removedFragmentIds: [], fragmentRecords: [] };
        const targetLevel = normalizeLevel(level);
        const floors = Array.isArray(asset.floors) ? asset.floors : [];
        const touched = touchedFragments(asset, targetLevel, editGeometry, operation);
        const hasExplicitLevel = floors.some(floor => floor && normalizeLevel(floor.level) === targetLevel);
        let subject = [];
        if (touched.length > 0) {
            subject = booleanGeometry("union", ...touched.map(fragmentGeometry));
        } else if (targetLevel === 0 && !hasExplicitLevel) {
            subject = assetAreaGeometry(asset, targetLevel, options);
        } else if (operation === "add") {
            subject = [];
        } else {
            return { changed: false, fragments: 0, tiles: 0, removedFragmentIds: [], fragmentRecords: [] };
        }
        if (operation === "subtract" && isEmptyGeometry(subject)) {
            return { changed: false, fragments: 0, tiles: 0, removedFragmentIds: [], fragmentRecords: [] };
        }
        const nextGeometry = operation === "subtract"
            ? booleanGeometry("difference", subject, editGeometry)
            : booleanGeometry("union", subject, editGeometry);
        if (!isEmptyGeometry(subject) && geometriesEquivalent(subject, nextGeometry)) {
            return { changed: false, fragments: 0, tiles: 0, removedFragmentIds: [], fragmentRecords: [] };
        }
        const removedFragmentIds = touched
            .map(fragment => typeof fragment.fragmentId === "string" ? fragment.fragmentId : "")
            .filter(id => id.length > 0);
        const removedSet = new Set(removedFragmentIds);
        const nextFloors = [];
        const usedIds = new Set();
        for (let i = 0; i < floors.length; i++) {
            const floor = floors[i];
            if (!floor) continue;
            const fragmentId = typeof floor.fragmentId === "string" ? floor.fragmentId : "";
            if (removedSet.has(fragmentId)) continue;
            nextFloors.push(floor);
            if (fragmentId) usedIds.add(fragmentId);
        }
        const fragmentRecords = fragmentRecordsFromGeometry(asset, targetLevel, nextGeometry, touched, usedIds, options);
        for (let i = 0; i < fragmentRecords.length; i++) nextFloors.push(fragmentRecords[i]);
        asset.floors = nextFloors;
        if (options.clearLegacyRecords !== false) {
            if (Array.isArray(asset.floorHoles)) {
                asset.floorHoles = asset.floorHoles.filter(hole => !hole || normalizeLevel(hole.level) !== targetLevel);
            }
            if (!Array.isArray(asset.floorVoids)) asset.floorVoids = [];
            asset.floorVoids = asset.floorVoids.filter(record => !record || normalizeLevel(record.level) !== targetLevel);
        }
        if (targetLevel === 0) asset._level0SurfaceVersion = (Number(asset._level0SurfaceVersion) || 0) + 1;
        if (typeof options.versionKey === "string" && options.versionKey.length > 0) {
            asset[options.versionKey] = (Number(asset[options.versionKey]) || 0) + 1;
        }
        let tiles = 0;
        for (let i = 0; i < fragmentRecords.length; i++) {
            tiles += Array.isArray(fragmentRecords[i].tileCoordKeys) ? fragmentRecords[i].tileCoordKeys.length : 0;
        }
        return {
            changed: removedFragmentIds.length > 0 || fragmentRecords.length > 0,
            fragments: fragmentRecords.length,
            tiles,
            removedFragmentIds,
            fragmentRecords
        };
    }

    function mergeOverlappingFragment(asset, level, fragmentId, options = {}) {
        if (!asset || typeof fragmentId !== "string" || fragmentId.length === 0) {
            return { changed: false, fragments: 0, tiles: 0, removedFragmentIds: [], fragmentRecords: [] };
        }
        const targetLevel = normalizeLevel(level);
        const floors = Array.isArray(asset.floors) ? asset.floors : [];
        const edited = floors.find(floor =>
            floor &&
            floor.fragmentId === fragmentId &&
            normalizeLevel(floor.level) === targetLevel
        ) || null;
        if (!edited) return { changed: false, fragments: 0, tiles: 0, removedFragmentIds: [], fragmentRecords: [] };
        const editedGeometry = fragmentGeometry(edited);
        if (isEmptyGeometry(editedGeometry)) return { changed: false, fragments: 0, tiles: 0, removedFragmentIds: [], fragmentRecords: [] };
        const touched = [edited];
        for (let i = 0; i < floors.length; i++) {
            const floor = floors[i];
            if (!floor || floor === edited || floor.fragmentId === fragmentId) continue;
            if (normalizeLevel(floor.level) !== targetLevel) continue;
            const overlap = booleanGeometry("intersection", editedGeometry, fragmentGeometry(floor));
            if (!isEmptyGeometry(overlap) || countSharedOuterVertices(edited, floor) >= 2) touched.push(floor);
        }
        if (touched.length < 2) return { changed: false, fragments: 0, tiles: 0, removedFragmentIds: [], fragmentRecords: [] };
        const mergedGeometry = booleanGeometry("union", ...touched.map(fragmentGeometry));
        if (isEmptyGeometry(mergedGeometry)) return { changed: false, fragments: 0, tiles: 0, removedFragmentIds: [], fragmentRecords: [] };
        const removedFragmentIds = touched
            .map(fragment => typeof fragment.fragmentId === "string" ? fragment.fragmentId : "")
            .filter(id => id.length > 0);
        const removedSet = new Set(removedFragmentIds);
        const nextFloors = [];
        const usedIds = new Set();
        for (let i = 0; i < floors.length; i++) {
            const floor = floors[i];
            if (!floor) continue;
            const id = typeof floor.fragmentId === "string" ? floor.fragmentId : "";
            if (removedSet.has(id)) continue;
            nextFloors.push(floor);
            if (id) usedIds.add(id);
        }
        const fragmentRecords = fragmentRecordsFromGeometry(asset, targetLevel, mergedGeometry, touched, usedIds, options);
        for (let i = 0; i < fragmentRecords.length; i++) nextFloors.push(fragmentRecords[i]);
        asset.floors = nextFloors;
        if (targetLevel === 0) asset._level0SurfaceVersion = (Number(asset._level0SurfaceVersion) || 0) + 1;
        if (typeof options.versionKey === "string" && options.versionKey.length > 0) {
            asset[options.versionKey] = (Number(asset[options.versionKey]) || 0) + 1;
        }
        let tiles = 0;
        for (let i = 0; i < fragmentRecords.length; i++) {
            tiles += Array.isArray(fragmentRecords[i].tileCoordKeys) ? fragmentRecords[i].tileCoordKeys.length : 0;
        }
        return {
            changed: true,
            fragments: fragmentRecords.length,
            tiles,
            removedFragmentIds,
            fragmentRecords
        };
    }

    function refreshManagedWallNodeRegistrations(mapRef, sectionKeys) {
        const wallState = mapRef && mapRef._prototypeWallState;
        const activeWalls = wallState && wallState.activeRuntimeWallsByRecordId;
        if (!(activeWalls instanceof Map) || !(sectionKeys instanceof Set) || sectionKeys.size === 0) return 0;

        const recordIds = new Set();
        if (typeof mapRef.getPrototypeSectionAsset === "function") {
            sectionKeys.forEach((sectionKey) => {
                const asset = mapRef.getPrototypeSectionAsset(sectionKey);
                const records = Array.isArray(asset && asset.walls) ? asset.walls : [];
                for (let i = 0; i < records.length; i++) {
                    const recordId = Number(records[i] && records[i].id);
                    if (Number.isInteger(recordId)) recordIds.add(recordId);
                }
            });
        }

        const refreshed = new Set();
        const refreshWall = (wall) => {
            if (!wall || wall.gone || refreshed.has(wall)) return 0;
            if (typeof wall.addToMapNodes !== "function") return 0;
            refreshed.add(wall);
            wall.addToMapNodes({
                applyDirectionalBlocking: wall._prototypeUsesSectionBlockedEdges === true ? false : true
            });
            return 1;
        };

        let count = 0;
        recordIds.forEach((recordId) => {
            count += refreshWall(activeWalls.get(recordId));
        });

        if (recordIds.size === 0) {
            for (const [, wall] of activeWalls.entries()) {
                const ownerSectionKey = wall && typeof wall._prototypeOwnerSectionKey === "string"
                    ? wall._prototypeOwnerSectionKey
                    : "";
                if (ownerSectionKey && sectionKeys.has(ownerSectionKey)) count += refreshWall(wall);
            }
        }
        return count;
    }

    function collectFloorFragmentContents(mapRef, fragmentIds) {
        const out = new Set();
        const ids = Array.isArray(fragmentIds) ? fragmentIds : [];
        if (!mapRef || !(mapRef.floorNodesById instanceof Map) || ids.length === 0) return out;
        for (let idIndex = 0; idIndex < ids.length; idIndex++) {
            const fragmentId = ids[idIndex];
            if (typeof fragmentId !== "string" || fragmentId.length === 0) continue;
            const nodes = mapRef.floorNodesById.get(fragmentId) || [];
            if (!Array.isArray(nodes)) continue;
            for (let i = 0; i < nodes.length; i++) {
                const node = nodes[i];
                if (!node) continue;
                const objects = Array.isArray(node.objects) ? node.objects : [];
                for (let j = 0; j < objects.length; j++) {
                    if (objects[j]) out.add(objects[j]);
                }
                const visibilityObjects = Array.isArray(node.visibilityObjects) ? node.visibilityObjects : [];
                for (let j = 0; j < visibilityObjects.length; j++) {
                    if (visibilityObjects[j]) out.add(visibilityObjects[j]);
                }
            }
        }
        return out;
    }

    function refreshCollectedFragmentContents(contents) {
        if (!(contents instanceof Set) || contents.size === 0) return 0;
        let count = 0;
        contents.forEach((obj) => {
            if (!obj || obj.gone || obj.vanishing) return;
            if (typeof obj.addToMapNodes !== "function") return;
            obj.addToMapNodes({
                applyDirectionalBlocking: obj._prototypeUsesSectionBlockedEdges === true ? false : true
            });
            count += 1;
        });
        return count;
    }

    function getBlockingHelpers(mapRef) {
        const blockingModule = (globalScope && globalScope.__sectionWorldBlocking) ||
            (typeof globalThis !== "undefined" && globalThis.__sectionWorldBlocking);
        if (!blockingModule || typeof blockingModule.createSectionWorldBlockingHelpers !== "function") return null;
        return blockingModule.createSectionWorldBlockingHelpers(mapRef, {});
    }

    function rematerializeFragmentChanges(mapRef, changesBySectionKey, options = {}) {
        if (!mapRef || !(changesBySectionKey instanceof Map) || changesBySectionKey.size === 0) return 0;
        if (
            typeof mapRef.unregisterFloorFragments !== "function" ||
            typeof mapRef.registerFloorFragmentsForSection !== "function"
        ) {
            if (typeof options.rematerializeSections === "function") {
                return options.rematerializeSections(mapRef, new Set(changesBySectionKey.keys()));
            }
            throw new Error("floor fragment rematerialization requires fragment runtime APIs");
        }
        const state = mapRef._prototypeSectionState || null;
        if (!state || !(state.sectionAssetsByKey instanceof Map)) {
            if (typeof options.rematerializeSections === "function") {
                return options.rematerializeSections(mapRef, new Set(changesBySectionKey.keys()));
            }
            throw new Error("floor fragment rematerialization requires prototype section state");
        }

        const blockingHelpers = getBlockingHelpers(mapRef);
        const changedSectionKeys = new Set();
        const contentsToRefresh = new Set();
        let count = 0;
        for (const [sectionKey, change] of changesBySectionKey.entries()) {
            const removedFragmentIds = Array.isArray(change && change.removedFragmentIds)
                ? change.removedFragmentIds.filter(id => typeof id === "string" && id.length > 0)
                : [];
            const fragmentRecords = Array.isArray(change && change.fragmentRecords) ? change.fragmentRecords : [];
            if (removedFragmentIds.length === 0 && fragmentRecords.length === 0) continue;

            if (blockingHelpers && typeof blockingHelpers.removePrototypeBlockedEdgesForSection === "function") {
                blockingHelpers.removePrototypeBlockedEdgesForSection(mapRef, sectionKey);
            } else {
                const blockedEdgeState = mapRef._prototypeBlockedEdgeState;
                if (blockedEdgeState && blockedEdgeState.activeEntriesBySectionKey instanceof Map) {
                    blockedEdgeState.activeEntriesBySectionKey.delete(sectionKey);
                }
            }

            const fragmentContents = collectFloorFragmentContents(mapRef, removedFragmentIds);
            fragmentContents.forEach(obj => contentsToRefresh.add(obj));
            if (removedFragmentIds.length > 0) {
                mapRef.unregisterFloorFragments(removedFragmentIds, { removeAttachedObjects: true });
            }
            if (fragmentRecords.length > 0) mapRef.registerFloorFragmentsForSection(sectionKey, state, fragmentRecords);
            if (blockingHelpers && typeof blockingHelpers.applyPrototypeBlockedEdgesForSection === "function") {
                blockingHelpers.applyPrototypeBlockedEdgesForSection(mapRef, sectionKey);
            }
            changedSectionKeys.add(sectionKey);
            count += 1;
        }

        refreshCollectedFragmentContents(contentsToRefresh);
        return count;
    }

    const api = {
        normalizeLevel,
        pointsToClipRing,
        clipRingToPoints,
        geometryFromPoints,
        isEmptyGeometry,
        booleanGeometry,
        assetAreaGeometry,
        applyAssetGeometryDelta,
        mergeOverlappingFragment,
        rematerializeFragmentChanges,
        collectFloorFragmentContents,
        refreshCollectedFragmentContents,
        refreshManagedWallNodeRegistrations
    };

    globalScope.FloorFragmentEdit = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : global);
