"use strict";

(function installFloorStairs(globalScope) {
    const INTENT_THRESHOLD_PX = 10;
    const DEFAULT_WIDTH = 1.2;
    const MIN_LENGTH = 0.35;
    const DEFAULT_TEXTURE = "/assets/images/flooring/dirt.jpg";
    const FloorFragmentEdit = globalScope.FloorFragmentEdit ||
        (typeof require === "function" ? require("./FloorFragmentEdit.js") : null);
    if (!FloorFragmentEdit) {
        throw new Error("FloorStairs requires FloorFragmentEdit");
    }

    function normalizeLevel(value) {
        return Number.isFinite(value) ? Math.round(Number(value)) : 0;
    }

    function clonePoint(point) {
        return { x: Number(point.x), y: Number(point.y) };
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

    function signedArea(points) {
        const ring = normalizeRing(points);
        let sum = 0;
        for (let i = 0; i < ring.length; i++) {
            const a = ring[i];
            const b = ring[(i + 1) % ring.length];
            sum += (a.x * b.y) - (b.x * a.y);
        }
        return sum * 0.5;
    }

    function ringArea(points) {
        return Math.abs(signedArea(points));
    }

    function pointInRing(x, y, points) {
        const ring = normalizeRing(points);
        if (ring.length < 3) return false;
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const xi = ring[i].x;
            const yi = ring[i].y;
            const xj = ring[j].x;
            const yj = ring[j].y;
            const cross = ((x - xi) * (yj - yi)) - ((y - yi) * (xj - xi));
            if (Math.abs(cross) <= 1e-9) {
                const minX = Math.min(xi, xj) - 1e-9;
                const maxX = Math.max(xi, xj) + 1e-9;
                const minY = Math.min(yi, yj) - 1e-9;
                const maxY = Math.max(yi, yj) + 1e-9;
                if (x >= minX && x <= maxX && y >= minY && y <= maxY) return true;
            }
            const intersects = ((yi > y) !== (yj > y)) &&
                (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi);
            if (intersects) inside = !inside;
        }
        return inside;
    }

    function fragmentContainsPoint(fragment, x, y) {
        if (!fragment || !Number.isFinite(x) || !Number.isFinite(y)) return false;
        const outer = Array.isArray(fragment.outerPolygon) && fragment.outerPolygon.length >= 3
            ? fragment.outerPolygon
            : null;
        if (!outer || !pointInRing(x, y, outer)) return false;
        const holes = Array.isArray(fragment.holes) ? fragment.holes : [];
        for (let i = 0; i < holes.length; i++) {
            if (Array.isArray(holes[i]) && holes[i].length >= 3 && pointInRing(x, y, holes[i])) return false;
        }
        return true;
    }

    function getFragmentBaseZ(fragment) {
        if (!fragment) return NaN;
        if (Number.isFinite(fragment.nodeBaseZ)) return Number(fragment.nodeBaseZ);
        if (Number.isFinite(fragment.baseZ)) return Number(fragment.baseZ);
        throw new Error(`floor fragment ${fragment.fragmentId || fragment.id || "(unknown)"} is missing nodeBaseZ`);
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
        const points = [];
        if (!Array.isArray(ring)) return points;
        for (let i = 0; i < ring.length; i++) {
            const x = Number(ring[i] && ring[i][0]);
            const y = Number(ring[i] && ring[i][1]);
            if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
            if (
                i === ring.length - 1 &&
                points.length > 0 &&
                Math.abs(points[0].x - x) <= 1e-9 &&
                Math.abs(points[0].y - y) <= 1e-9
            ) {
                continue;
            }
            points.push({ x, y });
        }
        return points;
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
            throw new Error("floor stair placement requires polygon-clipping");
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

    function getSectionPolygon(asset, basis) {
        if (Array.isArray(asset && asset.sectionPolygon) && asset.sectionPolygon.length >= 3) {
            return asset.sectionPolygon.map(clonePoint);
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
        throw new Error(`cannot resolve section polygon for stair placement in section ${asset && asset.key ? asset.key : "(unknown)"}`);
    }

    function worldFromTileKey(tileKey) {
        const parts = String(tileKey || "").split(",");
        const x = Number(parts[0]);
        const y = Number(parts[1]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
        return { x: x * 0.866, y: y + (x % 2 === 0 ? 0.5 : 0) };
    }

    function tileKeysForPolygon(asset, outer, holes) {
        const keys = Array.isArray(asset && asset.tileCoordKeys) ? asset.tileCoordKeys : [];
        const out = [];
        for (let i = 0; i < keys.length; i++) {
            const point = worldFromTileKey(keys[i]);
            if (!point) continue;
            if (!pointInRing(point.x, point.y, outer)) continue;
            let insideHole = false;
            for (let h = 0; h < holes.length; h++) {
                if (pointInRing(point.x, point.y, holes[h])) {
                    insideHole = true;
                    break;
                }
            }
            if (!insideHole) out.push(keys[i]);
        }
        return out;
    }

    function getAssetAreaGeometry(asset, level, basis) {
        const targetLevel = normalizeLevel(level);
        const floorGeometries = [];
        const floors = Array.isArray(asset && asset.floors) ? asset.floors : [];
        for (let i = 0; i < floors.length; i++) {
            const floor = floors[i];
            if (!floor || normalizeLevel(floor.level) !== targetLevel) continue;
            const outer = pointsToClipRing(floor.outerPolygon);
            if (!outer) continue;
            const polygon = [outer];
            const holes = Array.isArray(floor.holes) ? floor.holes : [];
            for (let h = 0; h < holes.length; h++) {
                const hole = pointsToClipRing(holes[h]);
                if (hole) polygon.push(hole);
            }
            floorGeometries.push([polygon]);
        }
        if (floorGeometries.length > 0) return booleanGeometry("union", ...floorGeometries);
        if (targetLevel === 0) return geometryFromPoints(getSectionPolygon(asset, basis));
        return [];
    }

    function inferLevelStyle(asset, level, preferred = null) {
        const targetLevel = normalizeLevel(level);
        const floors = Array.isArray(asset && asset.floors) ? asset.floors : [];
        const style = {
            nodeBaseZ: Number.isFinite(preferred && preferred.nodeBaseZ) ? Number(preferred.nodeBaseZ) : null,
            nodeBaseZOffset: Number.isFinite(preferred && preferred.nodeBaseZOffset)
                ? Number(preferred.nodeBaseZOffset)
                : 0,
            texturePath: preferred && typeof preferred.texturePath === "string" ? preferred.texturePath : ""
        };
        for (let i = 0; i < floors.length; i++) {
            const floor = floors[i];
            if (!floor || normalizeLevel(floor.level) !== targetLevel) continue;
            if (Number.isFinite(floor.nodeBaseZ)) style.nodeBaseZ = Number(floor.nodeBaseZ);
            if (Number.isFinite(floor.nodeBaseZOffset)) style.nodeBaseZOffset = Number(floor.nodeBaseZOffset);
            if (!style.texturePath && typeof floor.texturePath === "string" && floor.texturePath.length > 0) {
                style.texturePath = floor.texturePath;
            }
            break;
        }
        if (!Number.isFinite(style.nodeBaseZ)) {
            throw new Error(`stair floor level ${targetLevel} requires preferred style or existing floor nodeBaseZ`);
        }
        return style;
    }

    function setAssetAreaGeometry(asset, level, geometry, basis, preferredStyle = null) {
        if (!asset) throw new Error("cannot write stair floor geometry without a section asset");
        const targetLevel = normalizeLevel(level);
        const existingFloors = Array.isArray(asset.floors) ? asset.floors : [];
        const nextFloors = existingFloors.filter(floor => !floor || normalizeLevel(floor.level) !== targetLevel);
        const style = inferLevelStyle(asset, targetLevel, preferredStyle);
        const surfaceId = `floor_area:${asset.key}:${targetLevel}`;
        let fragments = 0;
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
                const record = {
                    fragmentId: `${surfaceId}:${i}`,
                    surfaceId,
                    ownerSectionKey: asset.key,
                    level: targetLevel,
                    nodeBaseZ: style.nodeBaseZ,
                    outerPolygon: outer,
                    holes,
                    tileCoordKeys: tileKeysForPolygon(asset, outer, holes)
                };
                if (style.texturePath) record.texturePath = style.texturePath;
                nextFloors.push(record);
                fragments += 1;
            }
        }
        if (fragments === 0 && targetLevel === 0) {
            nextFloors.push({
                fragmentId: `${surfaceId}:empty`,
                surfaceId,
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
        asset.floors = nextFloors;
        if (targetLevel === 0) asset._level0SurfaceVersion = (Number(asset._level0SurfaceVersion) || 0) + 1;
        asset._floorStairGeometryVersion = (Number(asset._floorStairGeometryVersion) || 0) + 1;
        return fragments;
    }

    function getProjectionContext(options = {}) {
        const viewport = options && options.viewport
            ? options.viewport
            : (globalScope && globalScope.viewport ? globalScope.viewport : null);
        const viewscale = Number.isFinite(options && options.viewscale) && Number(options.viewscale)
            ? Number(options.viewscale)
            : (Number.isFinite(globalScope && globalScope.viewscale) && globalScope.viewscale ? Number(globalScope.viewscale) : 1);
        const xyratio = Number.isFinite(options && options.xyratio) && Number(options.xyratio)
            ? Number(options.xyratio)
            : (Number.isFinite(globalScope && globalScope.xyratio) && globalScope.xyratio ? Number(globalScope.xyratio) : 1);
        return { viewport, viewscale, xyratio };
    }

    function projectScreenToPlane(screenX, screenY, baseZ, wizardRef, options = {}) {
        const context = getProjectionContext(options);
        const viewport = context.viewport;
        if (!viewport || !Number.isFinite(screenX) || !Number.isFinite(screenY)) return null;
        const viewscale = context.viewscale;
        const xyratio = context.xyratio;
        const cameraZ = Number.isFinite(viewport.z) ? Number(viewport.z) : 0;
        const z = Number.isFinite(baseZ) ? Number(baseZ) : 0;
        let x = (screenX / viewscale) + Number(viewport.x);
        let y = (screenY / (viewscale * xyratio)) + Number(viewport.y) + (z - cameraZ);
        const mapRef = wizardRef && wizardRef.map ? wizardRef.map : null;
        if (mapRef && typeof mapRef.wrapWorldX === "function") x = mapRef.wrapWorldX(x);
        if (mapRef && typeof mapRef.wrapWorldY === "function") y = mapRef.wrapWorldY(y);
        return { x, y };
    }

    function getSelectedFloorLevel(wizardRef) {
        if (wizardRef && Number.isFinite(wizardRef.selectedFloorEditLevel)) return normalizeLevel(wizardRef.selectedFloorEditLevel);
        if (globalScope && Number.isFinite(globalScope.selectedFloorEditLevel)) return normalizeLevel(globalScope.selectedFloorEditLevel);
        if (wizardRef && Number.isFinite(wizardRef.currentLayer)) return normalizeLevel(wizardRef.currentLayer);
        return 0;
    }

    function findFragmentAtPoint(mapRef, level, x, y, options = {}) {
        if (!mapRef || !(mapRef.floorsById instanceof Map)) return null;
        let best = null;
        let bestArea = Infinity;
        const zDirection = options.zDirection || "";
        const referenceZ = Number(options.referenceZ);
        for (const fragment of mapRef.floorsById.values()) {
            if (!fragment || normalizeLevel(fragment.level) !== normalizeLevel(level)) continue;
            if (fragment._floorEditEmpty === true) continue;
            const baseZ = getFragmentBaseZ(fragment);
            if (zDirection === "up" && !(baseZ > referenceZ + 1e-6)) continue;
            if (zDirection === "down" && !(baseZ < referenceZ - 1e-6)) continue;
            if (!fragmentContainsPoint(fragment, x, y)) continue;
            const area = ringArea(fragment.outerPolygon);
            if (!best || area < bestArea || Math.abs(baseZ - referenceZ) < Math.abs(getFragmentBaseZ(best) - referenceZ)) {
                best = fragment;
                bestArea = area;
            }
        }
        return best;
    }

    function findStartFragment(wizardRef, screenX, screenY, options = {}) {
        const mapRef = wizardRef && wizardRef.map ? wizardRef.map : null;
        if (!mapRef || !(mapRef.floorsById instanceof Map)) return null;
        const level = getSelectedFloorLevel(wizardRef);
        let best = null;
        let bestArea = Infinity;
        for (const fragment of mapRef.floorsById.values()) {
            if (!fragment || normalizeLevel(fragment.level) !== level) continue;
            if (fragment._floorEditEmpty === true) continue;
            const baseZ = getFragmentBaseZ(fragment);
            const point = projectScreenToPlane(screenX, screenY, baseZ, wizardRef, options);
            if (!point || !fragmentContainsPoint(fragment, point.x, point.y)) continue;
            const area = ringArea(fragment.outerPolygon);
            if (!best || area < bestArea) {
                best = { fragment, point, baseZ, level };
                bestArea = area;
            }
        }
        return best;
    }

    function buildFootprint(startPoint, endPoint, width, mapRef = null) {
        const dx = mapRef && typeof mapRef.shortestDeltaX === "function"
            ? mapRef.shortestDeltaX(startPoint.x, endPoint.x)
            : (endPoint.x - startPoint.x);
        const dy = mapRef && typeof mapRef.shortestDeltaY === "function"
            ? mapRef.shortestDeltaY(startPoint.y, endPoint.y)
            : (endPoint.y - startPoint.y);
        const length = Math.hypot(dx, dy);
        if (!(length > 1e-9)) return null;
        const ux = dx / length;
        const uy = dy / length;
        const halfWidth = Math.max(0.05, Number(width) || DEFAULT_WIDTH) * 0.5;
        const px = -uy * halfWidth;
        const py = ux * halfWidth;
        const far = { x: startPoint.x + dx, y: startPoint.y + dy };
        return {
            length,
            points: [
                { x: startPoint.x + px, y: startPoint.y + py },
                { x: far.x + px, y: far.y + py },
                { x: far.x - px, y: far.y - py },
                { x: startPoint.x - px, y: startPoint.y - py }
            ]
        };
    }

    function resolveTargetFragment(draft, endPoint) {
        const mapRef = draft.map;
        const startZ = draft.startBaseZ;
        let best = null;
        let bestDelta = Infinity;
        for (const fragment of mapRef.floorsById.values()) {
            if (!fragment || fragment === draft.startFragment) continue;
            if (fragment._floorEditEmpty === true) continue;
            const baseZ = getFragmentBaseZ(fragment);
            if (draft.intent === "up" && !(baseZ > startZ + 1e-6)) continue;
            if (draft.intent === "down" && !(baseZ < startZ - 1e-6)) continue;
            if (!fragmentContainsPoint(fragment, endPoint.x, endPoint.y)) continue;
            const delta = Math.abs(baseZ - startZ);
            if (!best || delta < bestDelta) {
                best = fragment;
                bestDelta = delta;
            }
        }
        return best;
    }

    function updateDraftFromScreen(wizardRef, draft, screenX, screenY, options = {}) {
        if (!draft || !Number.isFinite(screenX) || !Number.isFinite(screenY)) return draft;
        const dyPx = screenY - draft.startScreenY;
        if (!draft.intent && Math.abs(dyPx) >= INTENT_THRESHOLD_PX) {
            draft.intent = dyPx < 0 ? "up" : "down";
        }
        const point = projectScreenToPlane(screenX, screenY, draft.startBaseZ, wizardRef, options);
        if (!point) return draft;
        draft.currentPoint = point;
        if (!draft.intent) return draft;
        const footprint = buildFootprint(draft.startPoint, point, draft.width, draft.map);
        draft.footprint = footprint ? footprint.points : null;
        draft.length = footprint ? footprint.length : 0;
        draft.targetFragment = footprint && footprint.length >= MIN_LENGTH
            ? resolveTargetFragment(draft, point)
            : null;
        draft.valid = !!(draft.intent && draft.targetFragment && draft.footprint && draft.length >= MIN_LENGTH);
        return draft;
    }

    function notifyPlacementIssue(wizardRef, messageText) {
        if (!wizardRef || typeof messageText !== "string" || messageText.length === 0) return;
        if (typeof globalScope.message === "function") globalScope.message(messageText);
        wizardRef._floorStairPlacementIssue = messageText;
    }

    function beginPlacement(wizardRef, screenX, screenY, options = {}) {
        if (!wizardRef || wizardRef.currentSpell !== "floorstair" || !wizardRef.map) return false;
        const context = getProjectionContext(options);
        if (!context.viewport) {
            notifyPlacementIssue(wizardRef, "Cannot place stairs: missing camera projection context.");
            return false;
        }
        const hit = findStartFragment(wizardRef, screenX, screenY, options);
        if (!hit) {
            notifyPlacementIssue(wizardRef, "Start stairs on a floor fragment at the selected level.");
            return false;
        }
        wizardRef._floorStairPlacementIssue = "";
        wizardRef._floorStairPlacementDraft = {
            map: wizardRef.map,
            startFragment: hit.fragment,
            startFragmentId: hit.fragment.fragmentId,
            startPoint: hit.point,
            currentPoint: hit.point,
            startBaseZ: hit.baseZ,
            startLevel: hit.level,
            startScreenX: Number(screenX),
            startScreenY: Number(screenY),
            intent: "",
            width: DEFAULT_WIDTH,
            valid: false,
            targetFragment: null,
            footprint: null,
            length: 0
        };
        return true;
    }

    function updatePlacement(wizardRef, worldX, worldY, options = {}) {
        if (!wizardRef || wizardRef.currentSpell !== "floorstair") return false;
        const draft = wizardRef._floorStairPlacementDraft;
        if (!draft) return false;
        const screenX = Number.isFinite(options.screenX)
            ? Number(options.screenX)
            : (globalScope.mousePos && Number.isFinite(globalScope.mousePos.screenX) ? Number(globalScope.mousePos.screenX) : NaN);
        const screenY = Number.isFinite(options.screenY)
            ? Number(options.screenY)
            : (globalScope.mousePos && Number.isFinite(globalScope.mousePos.screenY) ? Number(globalScope.mousePos.screenY) : NaN);
        if (Number.isFinite(screenX) && Number.isFinite(screenY)) {
                updateDraftFromScreen(wizardRef, draft, screenX, screenY, options);
        } else if (Number.isFinite(worldX) && Number.isFinite(worldY)) {
            draft.currentPoint = { x: Number(worldX), y: Number(worldY) };
        }
        return true;
    }

    function rematerializeSections(mapRef, sectionKeys) {
        if (!mapRef || !(sectionKeys instanceof Set)) return 0;
        let count = 0;
        for (const sectionKey of sectionKeys) {
            if (typeof mapRef.unregisterSectionFloorNodes === "function") mapRef.unregisterSectionFloorNodes(sectionKey);
            else if (typeof mapRef.unregisterFloorSection === "function") mapRef.unregisterFloorSection(sectionKey);
            if (typeof mapRef.registerSectionFloorNodes === "function") mapRef.registerSectionFloorNodes(sectionKey);
            else if (typeof mapRef.registerFloorSection === "function" && mapRef._prototypeSectionState) {
                mapRef.registerFloorSection(sectionKey, mapRef._prototypeSectionState, {
                    doesNodeBelongToFragment: (node, fragment) => {
                        if (!node || !fragment) return false;
                        if (Array.isArray(fragment.tileCoordKeys) && fragment.tileCoordKeys.length > 0) {
                            return fragment.tileCoordKeys.includes(`${node.xindex},${node.yindex}`);
                        }
                        return fragmentContainsPoint(fragment, node.x, node.y);
                    }
                });
            }
            const blockedEdgeState = mapRef._prototypeBlockedEdgeState;
            if (blockedEdgeState && blockedEdgeState.activeEntriesBySectionKey instanceof Map) {
                blockedEdgeState.activeEntriesBySectionKey.delete(sectionKey);
            }
            // Re-apply wall blocked edges directly to the freshly-registered floor
            // nodes.  syncPrototypeWalls (called below) may not correctly re-apply
            // blocking when runtime wall objects hold stale references to the old
            // nodes that were just destroyed.  Applying here, immediately after
            // registration, ensures the new nodes pick up the correct blockedNeighbors.
            const blockingModule = globalScope && globalScope.__sectionWorldBlocking;
            if (blockingModule && typeof blockingModule.createSectionWorldBlockingHelpers === "function") {
                const { applyPrototypeBlockedEdgesForSection } =
                    blockingModule.createSectionWorldBlockingHelpers(mapRef, {});
                applyPrototypeBlockedEdgesForSection(mapRef, sectionKey);
            }
            refreshManagedWallNodeRegistrations(mapRef, new Set([sectionKey]));
            count += 1;
        }
        const wallState = mapRef._prototypeWallState;
        if (count > 0 && wallState && typeof wallState === "object") {
            wallState.activeRecordSignature = null;
        }
        if (count > 0 && typeof mapRef.syncPrototypeWalls === "function") {
            mapRef.syncPrototypeWalls();
        }
        return count;
    }

    function rematerializeFragmentChanges(mapRef, changesBySectionKey) {
        return FloorFragmentEdit.rematerializeFragmentChanges(mapRef, changesBySectionKey, {
            rematerializeSections,
            refreshManagedWallNodeRegistrations
        });
    }

    function refreshManagedWallNodeRegistrations(mapRef, sectionKeys) {
        return FloorFragmentEdit.refreshManagedWallNodeRegistrations(mapRef, sectionKeys);
    }

    function findFragmentAtWorldPointByZ(mapRef, point, baseZ) {
        let best = null;
        let bestDelta = Infinity;
        for (const fragment of mapRef.floorsById.values()) {
            if (!fragment || fragment._floorEditEmpty === true) continue;
            const z = getFragmentBaseZ(fragment);
            const delta = Math.abs(z - baseZ);
            if (delta > 1e-6 || !fragmentContainsPoint(fragment, point.x, point.y)) continue;
            const area = ringArea(fragment.outerPolygon);
            if (!best || delta < bestDelta || area < ringArea(best.outerPolygon)) {
                best = fragment;
                bestDelta = delta;
            }
        }
        return best;
    }

    function resolveEndpointNode(mapRef, fragment, point) {
        if (!mapRef || !fragment || !point || typeof mapRef.worldToNode !== "function") return null;
        const baseNode = mapRef.worldToNode(point.x, point.y);
        if (!baseNode) return null;
        const level = normalizeLevel(fragment.level);
        if (level === 0) return baseNode;
        if (typeof mapRef.getFloorNodeAtLayer !== "function") return null;
        return mapRef.getFloorNodeAtLayer(baseNode.xindex, baseNode.yindex, level, {
            fragmentId: fragment.fragmentId,
            surfaceId: fragment.surfaceId,
            sectionKey: fragment.ownerSectionKey || "",
            allowScan: true
        });
    }

    function getOffsetPointAlongStair(lowerPoint, higherPoint, distance) {
        const dx = Number(higherPoint.x) - Number(lowerPoint.x);
        const dy = Number(higherPoint.y) - Number(lowerPoint.y);
        const length = Math.hypot(dx, dy);
        if (!(length > 1e-9)) return clonePoint(higherPoint);
        const d = Number.isFinite(distance) ? Number(distance) : 0;
        return {
            x: Number(higherPoint.x) + (dx / length) * d,
            y: Number(higherPoint.y) + (dy / length) * d
        };
    }

    function applyFootprintGeometry(draft, lowerFragment, higherFragment, lowerPoint, higherPoint) {
        const mapRef = draft.map;
        const state = mapRef._prototypeSectionState || null;
        if (!state || !(state.sectionAssetsByKey instanceof Map)) {
            throw new Error("straight stair placement requires prototype section state");
        }
        const basis = state.basis || null;
        const lowerLevel = normalizeLevel(lowerFragment.level);
        const higherLevel = normalizeLevel(higherFragment.level);
        const footprintGeom = geometryFromPoints(draft.footprint);
        if (isEmptyGeometry(footprintGeom)) throw new Error("straight stair placement has empty footprint geometry");
        const changedSectionKeys = new Set();
        const fragmentChangesBySectionKey = new Map();
        for (const [sectionKey, asset] of state.sectionAssetsByKey.entries()) {
            const sectionGeom = geometryFromPoints(getSectionPolygon(asset, basis));
            const editGeom = booleanGeometry("intersection", sectionGeom, footprintGeom);
            if (isEmptyGeometry(editGeom)) continue;
            const lowerDelta = FloorFragmentEdit.applyAssetGeometryDelta(asset, lowerLevel, editGeom, "add", {
                basis,
                getSectionPolygon,
                preferredStyle: lowerFragment,
                defaultTexture: DEFAULT_TEXTURE,
                includeLegacyHoles: false,
                clearLegacyRecords: false,
                versionKey: "_floorStairGeometryVersion"
            });
            const higherDelta = FloorFragmentEdit.applyAssetGeometryDelta(asset, higherLevel, editGeom, "subtract", {
                basis,
                getSectionPolygon,
                preferredStyle: higherFragment,
                defaultTexture: DEFAULT_TEXTURE,
                includeLegacyHoles: false,
                clearLegacyRecords: false,
                versionKey: "_floorStairGeometryVersion"
            });
            if (!lowerDelta.changed && !higherDelta.changed) continue;
            fragmentChangesBySectionKey.set(sectionKey, {
                removedFragmentIds: lowerDelta.removedFragmentIds.concat(higherDelta.removedFragmentIds),
                fragmentRecords: lowerDelta.fragmentRecords.concat(higherDelta.fragmentRecords)
            });
            changedSectionKeys.add(sectionKey);
        }
        if (changedSectionKeys.size === 0) {
            throw new Error("straight stair footprint did not intersect any loaded section");
        }
        rematerializeFragmentChanges(mapRef, fragmentChangesBySectionKey);
        return {
            lowerFragment: findFragmentAtWorldPointByZ(mapRef, lowerPoint, getFragmentBaseZ(lowerFragment)),
            higherFragment: findFragmentAtWorldPointByZ(mapRef, higherPoint, getFragmentBaseZ(higherFragment)),
            changedSectionKeys
        };
    }

    function commitDraft(wizardRef, draft) {
        if (!wizardRef || !draft || !draft.valid) return false;
        const startFragment = draft.startFragment;
        const targetFragment = draft.targetFragment;
        const startZ = getFragmentBaseZ(startFragment);
        const targetZ = getFragmentBaseZ(targetFragment);
        if (Math.abs(startZ - targetZ) <= 1e-6) {
            throw new Error("straight stair target fragment is not vertically separated");
        }
        const descending = startZ > targetZ;
        const lowerFragment = descending ? targetFragment : startFragment;
        const higherFragment = descending ? startFragment : targetFragment;
        const lowerPoint = descending ? draft.currentPoint : draft.startPoint;
        const higherPoint = descending ? draft.startPoint : draft.currentPoint;
        const mapRef = draft.map;
        const higherLandingPoint = getOffsetPointAlongStair(
            lowerPoint,
            higherPoint,
            Math.min(0.45, Math.max(0.12, draft.length * 0.05))
        );
        const geometryResult = applyFootprintGeometry(draft, lowerFragment, higherFragment, lowerPoint, higherPoint);
        const resolvedLowerFragment = geometryResult.lowerFragment;
        const resolvedHigherFragment = geometryResult.higherFragment ||
            findFragmentAtWorldPointByZ(mapRef, higherLandingPoint, getFragmentBaseZ(higherFragment));
        if (!resolvedLowerFragment || !resolvedHigherFragment) {
            throw new Error("straight stair placement could not resolve edited endpoint fragments");
        }
        const lowerNode = resolveEndpointNode(mapRef, resolvedLowerFragment, lowerPoint);
        const higherNode = resolveEndpointNode(mapRef, resolvedHigherFragment, higherLandingPoint);
        if (!lowerNode || !higherNode) {
            throw new Error("straight stair placement could not resolve endpoint nodes");
        }
        const state = mapRef._prototypeSectionState;
        if (!Array.isArray(state.floorTransitions)) state.floorTransitions = [];
        const texturePath = wizardRef && typeof wizardRef.selectedFlooringTexture === "string" && wizardRef.selectedFlooringTexture.length > 0
            ? wizardRef.selectedFlooringTexture
            : DEFAULT_TEXTURE;
        const stepCount = Math.max(2, Math.ceil(draft.length / 0.55), Math.ceil(Math.abs(targetZ - startZ) / 0.35));
        const id = `straight_stairs:${Date.now().toString(36)}:${Math.floor(Math.random() * 100000).toString(36)}`;
        const transition = {
            id,
            type: "stairs",
            stairKind: "straight",
            from: { x: lowerNode.xindex, y: lowerNode.yindex, floorId: resolvedLowerFragment.fragmentId },
            to: { x: higherNode.xindex, y: higherNode.yindex, floorId: resolvedHigherFragment.fragmentId },
            bidirectional: true,
            movementCost: Math.max(1, draft.length),
            zProfile: "steps",
            metadata: {
                stairKind: "straight",
                straightStair: {
                    lowerFragmentId: resolvedLowerFragment.fragmentId,
                    higherFragmentId: resolvedHigherFragment.fragmentId,
                    lowerPoint: clonePoint(lowerPoint),
                    higherPoint: clonePoint(higherPoint),
                    footprint: draft.footprint.map(clonePoint),
                    width: draft.width,
                    stepCount,
                    texturePath
                }
            }
        };
        state.floorTransitions.push(transition);
        if (typeof mapRef.registerFloorTransition === "function") mapRef.registerFloorTransition(transition);
        if (typeof mapRef.connectFloorTransitions === "function") mapRef.connectFloorTransitions();
        wizardRef._floorStairPlacementDraft = null;
        if (typeof globalScope.presentGameFrame === "function") globalScope.presentGameFrame();
        if (typeof globalScope.message === "function") {
            globalScope.message(`Built straight stairs: ${stepCount} treads.`);
        }
        return true;
    }

    function endPlacement(wizardRef) {
        if (!wizardRef || wizardRef.currentSpell !== "floorstair") return false;
        const draft = wizardRef._floorStairPlacementDraft;
        if (!draft) return false;
        if (!draft.valid) {
            wizardRef._floorStairPlacementDraft = null;
            return false;
        }
        return commitDraft(wizardRef, draft);
    }

    function cancelPlacement(wizardRef) {
        if (!wizardRef || !wizardRef._floorStairPlacementDraft) return false;
        wizardRef._floorStairPlacementDraft = null;
        return true;
    }

    function getPlacementPreview(wizardRef) {
        if (!wizardRef || wizardRef.currentSpell !== "floorstair") return null;
        const draft = wizardRef._floorStairPlacementDraft;
        if (!draft) return null;
        return {
            startPoint: draft.startPoint,
            currentPoint: draft.currentPoint,
            footprint: Array.isArray(draft.footprint) ? draft.footprint : null,
            intent: draft.intent,
            valid: !!draft.valid,
            startBaseZ: draft.startBaseZ,
            targetBaseZ: draft.targetFragment ? getFragmentBaseZ(draft.targetFragment) : null,
            targetFragmentId: draft.targetFragment ? draft.targetFragment.fragmentId : "",
            width: draft.width,
            length: draft.length
        };
    }

    const api = {
        beginPlacement,
        updatePlacement,
        endPlacement,
        cancelPlacement,
        getPlacementPreview,
        commitDraft,
        buildFootprint,
        _test: {
            pointInRing,
            fragmentContainsPoint,
            geometryFromPoints,
            getAssetAreaGeometry,
            setAssetAreaGeometry,
            refreshManagedWallNodeRegistrations,
            rematerializeFragmentChanges,
            rematerializeSections
        }
    };

    globalScope.FloorStairs = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : global);
