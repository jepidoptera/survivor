(function attachRendering(global) {
    const GROUND_TILE_OVERLAP_SCALE = 1.5;
    const GROUND_TILE_CACHE_LIMIT = 6000;
    const GROUND_TILE_TRIM_CHUNK_SIZE = 250;
    const GROUND_TILE_POOL_LIMIT = 1024;
    const TREE_ALPHA_CUTOFF = 0.08;
    const LOS_NEAR_REVEAL_RADIUS = 1.0;
    const LOS_THROTTLE_MS = 33;
    const LOS_BINS = 3600;
    const MAZE_MODE_ACTIVATION_SKIP_REVEAL_MS = 700;
    const FLOOR_VISUAL_FILL = 0x746b4d;
    const FLOOR_VISUAL_FILL_ACTIVE = 0x8c7f54;
    const FLOOR_VISUAL_HOLE_FILL = 0x050505;
    const FLOOR_VISUAL_UPPER_FILL = 0xb89a68;
    const FLOOR_VISUAL_CAVE_TEXTURE_PATH = "/assets/images/flooring/cave.jpg";
    const FLOOR_VISUAL_TEXTURE_WORLD_SCALE = 0.1;
    const FLOORING_TEXTURE_CONFIG_URL = "/assets/images/flooring/items.json";
    const FLOOR_LAYER_DEFAULT_HEIGHT_UNITS = 3;
    const FLOOR_LEVEL0_SURFACE_TEXTURE_PX_PER_WORLD = 128;
    const FLOOR_LEVEL0_SURFACE_TEXTURE_MAX_SIZE = 4096;
    const FLOOR_LEVEL0_BAKED_SURFACE_ENABLED = true;
    const FLOOR_LEVEL0_FORCE_BAKED_SURFACE = true;
    const FLOOR_LEVEL0_CHUNKED_SURFACE_ENABLED = true;
    const FLOOR_LEVEL0_CHUNK_TEXTURE_SIZE = 1024;
    const FLOOR_LEVEL0_CHUNK_TEXTURE_PX_PER_WORLD = 32;
    const FLOOR_LEVEL0_CHUNK_BUILDS_PER_FRAME = 1;
    const FLOOR_LEVEL0_CHUNK_CACHE_LIMIT = 96;
    const FLOOR_LEVEL0_SEAM_BLEED_UNITS = 0.16;
    const FLOOR_VISUAL_DEPTH_NEAR_METRIC = -128;
    const FLOOR_VISUAL_DEPTH_FAR_METRIC = 256;
    const FLOOR_VISUAL_DEPTH_BIAS_UNITS = 0.001;
    const FLOOR_VISUAL_HOLE_DEPTH_BIAS_UNITS = 0.02;
    const FLOOR_BELOW_CURRENT_DARKNESS_MULTIPLIER = 0.8;
    const BUILDING_CUTAWAY_GHOST_ALPHA = 0.1;
    const BUILDING_CUTAWAY_INTERIOR_ALPHA = 0.5;
    const BUILDING_CUTAWAY_COMPOSITE_VERSION = 2;
    const BUILDING_CUTAWAY_ENTRY_FADE_MS = 500;
    const BUILDING_INTERIOR_OVERLAY_Z = 2147483648;
    const BUILDING_INTERIOR_FOREGROUND_Z = 2147483650;
    const LOS_SHADOW_DEPTH_BIAS_UNITS = 0.004;
    const WIZARD_SHADOW_DEPTH_BIAS_UNITS = 0.02;
    const WIZARD_HAT_LIFT_UNITS = 0.15;
    const WIZARD_BODY_LOWER_UNITS = 0.25;
    const FLOOR_VISUAL_DEPTH_VS = `
precision highp float;
attribute vec2 aVertexPosition;
attribute vec2 aUvs;
uniform vec2 uScreenSize;
uniform vec2 uCameraWorld;
uniform float uCameraZ;
uniform float uBaseZ;
uniform float uDepthBias;
uniform float uViewScale;
uniform float uXyRatio;
uniform vec2 uDepthRange;
varying vec2 vUvs;
void main(void) {
    float camDx = aVertexPosition.x - uCameraWorld.x;
    float camDy = aVertexPosition.y - uCameraWorld.y;
    float camDz = uBaseZ - uCameraZ;
    float sx = max(1.0, uScreenSize.x);
    float sy = max(1.0, uScreenSize.y);
    float screenX = camDx * uViewScale;
    float screenY = (camDy - camDz) * uViewScale * uXyRatio;
    float depthMetric = camDy + camDz + uDepthBias;
    float farMetric = uDepthRange.x;
    float invSpan = max(1e-6, uDepthRange.y);
    float nd = clamp((farMetric - depthMetric) * invSpan, 0.0, 1.0);
    vec2 clip = vec2(
        (screenX / sx) * 2.0 - 1.0,
        1.0 - (screenY / sy) * 2.0
    );
    gl_Position = vec4(clip, nd * 2.0 - 1.0, 1.0);
    vUvs = aUvs;
}
`;
    const LOS_SHADOW_DEPTH_VS = `
precision highp float;
attribute vec2 aWorldPosition;
uniform vec2 uScreenSize;
uniform vec2 uCameraWorld;
uniform float uCameraZ;
uniform float uBaseZ;
uniform float uDepthBias;
uniform float uViewScale;
uniform float uXyRatio;
uniform vec2 uDepthRange;
void main(void) {
    float camDx = aWorldPosition.x - uCameraWorld.x;
    float camDy = aWorldPosition.y - uCameraWorld.y;
    float camDz = uBaseZ - uCameraZ;
    float sx = max(1.0, uScreenSize.x);
    float sy = max(1.0, uScreenSize.y);
    float screenX = camDx * uViewScale;
    float screenY = (camDy - camDz) * uViewScale * uXyRatio;
    float depthMetric = camDy + camDz + uDepthBias;
    float farMetric = uDepthRange.x;
    float invSpan = max(1e-6, uDepthRange.y);
    float nd = clamp((farMetric - depthMetric) * invSpan, 0.0, 1.0);
    vec2 clip = vec2(
        (screenX / sx) * 2.0 - 1.0,
        1.0 - (screenY / sy) * 2.0
    );
    gl_Position = vec4(clip, nd * 2.0 - 1.0, 1.0);
}
`;
    const LOS_SHADOW_DEPTH_FS = `
precision highp float;
uniform vec4 uTint;
void main(void) {
    gl_FragColor = uTint;
}
`;
    const FLOOR_VISUAL_DEPTH_FS = `
precision highp float;
varying vec2 vUvs;
uniform sampler2D uSampler;
uniform vec4 uTint;
uniform float uAlphaCutoff;
void main(void) {
    vec4 outColor = texture2D(uSampler, vUvs) * uTint;
    if (outColor.a < uAlphaCutoff) discard;
    gl_FragColor = outColor;
}
`;
    if (typeof global.renderingShowPickerScreen !== "boolean") {
        global.renderingShowPickerScreen = false;
    }

    function getShowPickerScreenFlag() {
        return !!global.renderingShowPickerScreen;
    }

    function setShowPickerScreenFlag(enabled) {
        const next = !!enabled;
        global.renderingShowPickerScreen = next;
        return next;
    }

    function getFloorEarcut() {
        if (global.earcut) {
            if (typeof global.earcut === "function") return global.earcut;
            if (typeof global.earcut.default === "function") return global.earcut.default;
        }
        if (typeof PIXI !== "undefined" && PIXI.utils && typeof PIXI.utils.earcut === "function") {
            return PIXI.utils.earcut;
        }
        return null;
    }

    function normalizeFloorVisualPointList(points) {
        if (!Array.isArray(points)) return [];
        const out = [];
        for (let i = 0; i < points.length; i++) {
            const point = points[i];
            const x = Number(point && point.x);
            const y = Number(point && point.y);
            if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
            out.push({ x, y });
        }
        return out;
    }

    function buildFloorVisualSignature(outer, holes) {
        const parts = [];
        const appendRing = (ring) => {
            parts.push("[");
            for (let i = 0; i < ring.length; i++) {
                const pt = ring[i];
                parts.push(`${Math.round(pt.x * 1000)},${Math.round(pt.y * 1000)};`);
            }
            parts.push("]");
        };
        appendRing(outer);
        const normalizedHoles = Array.isArray(holes) ? holes : [];
        for (let i = 0; i < normalizedHoles.length; i++) {
            appendRing(normalizeFloorVisualPointList(normalizedHoles[i]));
        }
        return parts.join("");
    }

    function triangulateFloorVisualPolygon(outer, holes) {
        const earcut = getFloorEarcut();
        if (!earcut || outer.length < 3) return null;
        const vertices = [];
        const holeIndices = [];
        const allPoints = [];
        const pushRing = (ring) => {
            for (let i = 0; i < ring.length; i++) {
                const pt = ring[i];
                vertices.push(pt.x, pt.y);
                allPoints.push(pt);
            }
        };
        pushRing(outer);
        const normalizedHoles = Array.isArray(holes) ? holes : [];
        for (let i = 0; i < normalizedHoles.length; i++) {
            const ring = normalizeFloorVisualPointList(normalizedHoles[i]);
            if (ring.length < 3) continue;
            holeIndices.push(allPoints.length);
            pushRing(ring);
        }
        if (allPoints.length < 3) return null;
        const indices = earcut(vertices, holeIndices.length > 0 ? holeIndices : null, 2);
        if (!indices || indices.length < 3) return null;
        const maxIndex = allPoints.length - 1;
        const IndexArray = maxIndex > 65535 ? Uint32Array : Uint16Array;
        return {
            points: allPoints,
            indices: new IndexArray(indices),
            vertexCount: allPoints.length
        };
    }

    function expandFloorVisualPolygonFromCentroid(points, amount) {
        const ring = normalizeFloorVisualPointList(points);
        const delta = Number(amount);
        if (ring.length < 3 || !Number.isFinite(delta) || delta <= 0) return ring;
        let cx = 0;
        let cy = 0;
        for (let i = 0; i < ring.length; i++) {
            cx += ring[i].x;
            cy += ring[i].y;
        }
        cx /= ring.length;
        cy /= ring.length;
        const out = [];
        for (let i = 0; i < ring.length; i++) {
            const pt = ring[i];
            const dx = pt.x - cx;
            const dy = pt.y - cy;
            const length = Math.hypot(dx, dy);
            if (length <= 1e-6) {
                out.push({ x: pt.x, y: pt.y });
                continue;
            }
            out.push({
                x: pt.x + (dx / length) * delta,
                y: pt.y + (dy / length) * delta
            });
        }
        return out;
    }

    function getFloorVisualPointBounds(points) {
        const ring = normalizeFloorVisualPointList(points);
        if (ring.length === 0) return null;
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (let i = 0; i < ring.length; i++) {
            minX = Math.min(minX, ring[i].x);
            minY = Math.min(minY, ring[i].y);
            maxX = Math.max(maxX, ring[i].x);
            maxY = Math.max(maxY, ring[i].y);
        }
        if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) return null;
        return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
    }

    function clipFloorVisualPolygonToRect(points, rect) {
        let polygon = normalizeFloorVisualPointList(points);
        if (polygon.length < 3 || !rect) return [];
        const EPS = 1e-7;
        const clipEdge = (input, inside, intersect) => {
            if (!Array.isArray(input) || input.length === 0) return [];
            const output = [];
            for (let i = 0; i < input.length; i++) {
                const current = input[i];
                const previous = input[(i + input.length - 1) % input.length];
                const currentInside = inside(current);
                const previousInside = inside(previous);
                if (currentInside) {
                    if (!previousInside) output.push(intersect(previous, current));
                    output.push(current);
                } else if (previousInside) {
                    output.push(intersect(previous, current));
                }
            }
            return output;
        };
        polygon = clipEdge(
            polygon,
            (pt) => pt.x >= rect.minX - EPS,
            (a, b) => {
                const t = (rect.minX - a.x) / ((b.x - a.x) || EPS);
                return { x: rect.minX, y: a.y + (b.y - a.y) * t };
            }
        );
        polygon = clipEdge(
            polygon,
            (pt) => pt.x <= rect.maxX + EPS,
            (a, b) => {
                const t = (rect.maxX - a.x) / ((b.x - a.x) || EPS);
                return { x: rect.maxX, y: a.y + (b.y - a.y) * t };
            }
        );
        polygon = clipEdge(
            polygon,
            (pt) => pt.y >= rect.minY - EPS,
            (a, b) => {
                const t = (rect.minY - a.y) / ((b.y - a.y) || EPS);
                return { x: a.x + (b.x - a.x) * t, y: rect.minY };
            }
        );
        polygon = clipEdge(
            polygon,
            (pt) => pt.y <= rect.maxY + EPS,
            (a, b) => {
                const t = (rect.maxY - a.y) / ((b.y - a.y) || EPS);
                return { x: a.x + (b.x - a.x) * t, y: rect.maxY };
            }
        );
        return polygon.length >= 3 ? polygon : [];
    }

    function getFloorVisualPolygonClippingApi() {
        return (global && global.polygonClipping) ? global.polygonClipping : null;
    }

    function floorVisualPointsToClipRing(points) {
        const normalized = normalizeFloorVisualPointList(points);
        if (normalized.length < 3) return null;
        const ring = normalized.map(point => [point.x, point.y]);
        const first = ring[0];
        const last = ring[ring.length - 1];
        if (!last || Math.abs(first[0] - last[0]) > 1e-9 || Math.abs(first[1] - last[1]) > 1e-9) {
            ring.push([first[0], first[1]]);
        }
        return ring;
    }

    function floorVisualClipRingToPoints(ring) {
        if (!Array.isArray(ring)) return [];
        const points = [];
        for (let i = 0; i < ring.length; i++) {
            const pair = ring[i];
            const x = Number(pair && pair[0]);
            const y = Number(pair && pair[1]);
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

    function floorVisualClipMultiPolygonFromRings(outer, holes) {
        const outerRing = floorVisualPointsToClipRing(outer);
        if (!outerRing) return [];
        const polygon = [outerRing];
        const normalizedHoles = Array.isArray(holes) ? holes : [];
        for (let i = 0; i < normalizedHoles.length; i++) {
            const holeRing = floorVisualPointsToClipRing(normalizedHoles[i]);
            if (holeRing) polygon.push(holeRing);
        }
        return [polygon];
    }

    function floorVisualClipGeometryToPolygons(geometry) {
        if (!Array.isArray(geometry) || geometry.length === 0) return [];
        const out = [];
        for (let i = 0; i < geometry.length; i++) {
            const polygon = geometry[i];
            if (!Array.isArray(polygon) || polygon.length === 0) continue;
            const outer = floorVisualClipRingToPoints(polygon[0]);
            if (outer.length < 3) continue;
            const holes = [];
            for (let h = 1; h < polygon.length; h++) {
                const hole = floorVisualClipRingToPoints(polygon[h]);
                if (hole.length >= 3) holes.push(hole);
            }
            out.push({ outer, holes });
        }
        return out;
    }

    function unionFloorVisualPolygons(polygons) {
        const normalized = Array.isArray(polygons)
            ? polygons.filter(poly => Array.isArray(poly) && poly.length >= 3)
            : [];
        if (normalized.length === 0) return [];
        const api = getFloorVisualPolygonClippingApi();
        if (!api || typeof api.union !== "function") {
            return normalized.map(outer => ({ outer, holes: [] }));
        }
        const geometries = normalized
            .map(outer => floorVisualClipMultiPolygonFromRings(outer, []))
            .filter(geometry => Array.isArray(geometry) && geometry.length > 0);
        if (geometries.length === 0) return [];
        try {
            const union = api.union(...geometries);
            const converted = floorVisualClipGeometryToPolygons(union);
            return converted.length > 0 ? converted : normalized.map(outer => ({ outer, holes: [] }));
        } catch (_err) {
            return normalized.map(outer => ({ outer, holes: [] }));
        }
    }

    function intersectFloorVisualPolygonWithPolygon(outer, holes, clipPolygon) {
        const normalizedOuter = normalizeFloorVisualPointList(outer);
        const clipOuter = normalizeFloorVisualPointList(clipPolygon && clipPolygon.outer);
        if (normalizedOuter.length < 3 || clipOuter.length < 3) return [];
        const api = getFloorVisualPolygonClippingApi();
        if (!api || typeof api.intersection !== "function") {
            return floorVisualPolygonsContainPoint([{
                outer: clipOuter,
                holes: Array.isArray(clipPolygon && clipPolygon.holes) ? clipPolygon.holes : []
            }], normalizedOuter[0].x, normalizedOuter[0].y)
                ? [{ outer: normalizedOuter, holes: Array.isArray(holes) ? holes : [] }]
                : [];
        }
        const subject = floorVisualClipMultiPolygonFromRings(normalizedOuter, holes);
        const clip = floorVisualClipMultiPolygonFromRings(clipOuter, Array.isArray(clipPolygon && clipPolygon.holes) ? clipPolygon.holes : []);
        if (!Array.isArray(subject) || subject.length === 0 || !Array.isArray(clip) || clip.length === 0) return [];
        try {
            return floorVisualClipGeometryToPolygons(api.intersection(subject, clip));
        } catch (_err) {
            return [];
        }
    }

    function floorVisualPolygonsContainPoint(polygons, x, y) {
        const normalized = Array.isArray(polygons) ? polygons : [];
        for (let i = 0; i < normalized.length; i++) {
            const polygon = normalized[i];
            if (!polygon || !Array.isArray(polygon.outer) || polygon.outer.length < 3) continue;
            if (!pointInFloorVisualPolygon2D(x, y, polygon.outer)) continue;
            let inHole = false;
            const holes = Array.isArray(polygon.holes) ? polygon.holes : [];
            for (let h = 0; h < holes.length; h++) {
                if (pointInFloorVisualPolygon2D(x, y, holes[h])) {
                    inHole = true;
                    break;
                }
            }
            if (!inHole) return true;
        }
        return false;
    }

    function floorVisualClipGeometryFromRect(rect) {
        if (!rect) return [];
        const minX = Number(rect.minX);
        const minY = Number(rect.minY);
        const maxX = Number(rect.maxX);
        const maxY = Number(rect.maxY);
        if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) return [];
        if (!(maxX > minX) || !(maxY > minY)) return [];
        return floorVisualClipMultiPolygonFromRings([
            { x: minX, y: minY },
            { x: maxX, y: minY },
            { x: maxX, y: maxY },
            { x: minX, y: maxY }
        ], []);
    }

    function collectFloorVisualClippedPolygonsForRect(outer, holes, rect) {
        const normalizedHoles = Array.isArray(holes) ? holes : [];
        if (normalizedHoles.length === 0) {
            const clippedOuter = clipFloorVisualPolygonToRect(outer, rect);
            return clippedOuter.length >= 3 ? [{ outer: clippedOuter, holes: [] }] : [];
        }
        const api = getFloorVisualPolygonClippingApi();
        if (!api || typeof api.intersection !== "function") return null;
        const subject = floorVisualClipMultiPolygonFromRings(outer, normalizedHoles);
        const clip = floorVisualClipGeometryFromRect(rect);
        if (!Array.isArray(subject) || subject.length === 0 || !Array.isArray(clip) || clip.length === 0) return [];
        let intersection = [];
        try {
            intersection = api.intersection(subject, clip);
        } catch (err) {
            if (global && global.renderingDiagnostics && global.renderingDiagnostics.floorChunkClipLogging === true) {
                console.warn("[level0 floor chunk clip failed]", err);
            }
            return null;
        }
        if (!Array.isArray(intersection) || intersection.length === 0) return [];
        const out = [];
        for (let i = 0; i < intersection.length; i++) {
            const polygon = intersection[i];
            if (!Array.isArray(polygon) || polygon.length === 0) continue;
            const clippedOuter = floorVisualClipRingToPoints(polygon[0]);
            if (clippedOuter.length < 3) continue;
            const clippedHoles = [];
            for (let h = 1; h < polygon.length; h++) {
                const hole = floorVisualClipRingToPoints(polygon[h]);
                if (hole.length >= 3) clippedHoles.push(hole);
            }
            out.push({ outer: clippedOuter, holes: clippedHoles });
        }
        return out;
    }

    function isFloorEditIsolationActive() {
        return false;
    }

    function isPointSupportedByFloorFragment(fragment, x, y) {
        if (!fragment || !Array.isArray(fragment.outerPolygon) || fragment.outerPolygon.length < 3) return false;
        if (typeof pointInPolygon2D !== "function" || !pointInPolygon2D(x, y, fragment.outerPolygon)) return false;
        const holes = Array.isArray(fragment.holes) ? fragment.holes : [];
        for (let i = 0; i < holes.length; i++) {
            const hole = holes[i];
            if (Array.isArray(hole) && hole.length >= 3 && typeof pointInPolygon2D === "function" && pointInPolygon2D(x, y, hole)) {
                return false;
            }
        }
        return true;
    }

    function pointNearFloorVisualSegment2D(px, py, ax, ay, bx, by, epsilon = 0.001) {
        const abx = bx - ax;
        const aby = by - ay;
        const apx = px - ax;
        const apy = py - ay;
        const abLen2 = abx * abx + aby * aby;
        if (abLen2 <= 1e-9) return Math.hypot(px - ax, py - ay) <= epsilon;
        const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLen2));
        const cx = ax + abx * t;
        const cy = ay + aby * t;
        return Math.hypot(px - cx, py - cy) <= epsilon;
    }

    function closestFloorVisualSegmentPoint2D(px, py, ax, ay, bx, by) {
        const abx = bx - ax;
        const aby = by - ay;
        const apx = px - ax;
        const apy = py - ay;
        const abLen2 = abx * abx + aby * aby;
        if (abLen2 <= 1e-9) {
            const dx = px - ax;
            const dy = py - ay;
            return { x: ax, y: ay, t: 0, distanceSq: dx * dx + dy * dy };
        }
        const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / abLen2));
        const x = ax + abx * t;
        const y = ay + aby * t;
        const dx = px - x;
        const dy = py - y;
        return { x, y, t, distanceSq: dx * dx + dy * dy };
    }

    function distanceToFloorVisualRing2D(x, y, points) {
        const ring = normalizeFloorVisualPointList(points);
        if (ring.length === 0 || !Number.isFinite(x) || !Number.isFinite(y)) return null;
        let best = null;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const closest = closestFloorVisualSegmentPoint2D(x, y, ring[j].x, ring[j].y, ring[i].x, ring[i].y);
            if (!closest || !Number.isFinite(closest.distanceSq)) continue;
            if (!best || closest.distanceSq < best.distanceSq) {
                best = {
                    distanceSq: closest.distanceSq,
                    distance: Math.sqrt(Math.max(0, closest.distanceSq)),
                    closestPoint: { x: closest.x, y: closest.y },
                    edgeIndex: j
                };
            }
        }
        return best;
    }

    function pointInFloorVisualPolygon2D(x, y, points, options = {}) {
        const ring = normalizeFloorVisualPointList(points);
        if (ring.length < 3 || !Number.isFinite(x) || !Number.isFinite(y)) return false;
        const includeBoundary = options.includeBoundary !== false;
        if (includeBoundary) {
            const epsilon = Number.isFinite(options.epsilon) ? Math.max(0, Number(options.epsilon)) : 0.001;
            for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
                if (pointNearFloorVisualSegment2D(x, y, ring[j].x, ring[j].y, ring[i].x, ring[i].y, epsilon)) {
                    return true;
                }
            }
        }
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const xi = ring[i].x;
            const yi = ring[i].y;
            const xj = ring[j].x;
            const yj = ring[j].y;
            const intersect = ((yi > y) !== (yj > y))
                && (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-7) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    function distanceToFloorVisualPolygon2D(x, y, polygon) {
        if (!polygon || !Number.isFinite(x) || !Number.isFinite(y)) return null;
        const outer = Array.isArray(polygon.outer)
            ? polygon.outer
            : (Array.isArray(polygon) ? polygon : []);
        if (outer.length < 3) return null;
        const outerDistance = distanceToFloorVisualRing2D(x, y, outer);
        const insideOuter = pointInFloorVisualPolygon2D(x, y, outer);
        const holes = Array.isArray(polygon.holes) ? polygon.holes : [];
        let insideHole = false;
        let bestHoleDistance = null;
        for (let h = 0; h < holes.length; h++) {
            const hole = holes[h];
            if (!Array.isArray(hole) || hole.length < 3) continue;
            const holeDistance = distanceToFloorVisualRing2D(x, y, hole);
            if (holeDistance && (!bestHoleDistance || holeDistance.distanceSq < bestHoleDistance.distanceSq)) {
                bestHoleDistance = holeDistance;
            }
            if (pointInFloorVisualPolygon2D(x, y, hole)) insideHole = true;
        }
        const inside = insideOuter && !insideHole;
        if (inside) {
            return { inside: true, distance: 0, distanceSq: 0, closestPoint: { x, y } };
        }
        const best = insideHole && bestHoleDistance
            ? bestHoleDistance
            : (outerDistance || bestHoleDistance);
        if (!best) return null;
        return {
            inside: false,
            distance: best.distance,
            distanceSq: best.distanceSq,
            closestPoint: best.closestPoint || null
        };
    }

    function floorVisualPolygonsDistanceToPoint(polygons, x, y) {
        const normalized = Array.isArray(polygons) ? polygons : [];
        let best = null;
        for (let i = 0; i < normalized.length; i++) {
            const distance = distanceToFloorVisualPolygon2D(x, y, normalized[i]);
            if (!distance) continue;
            if (distance.inside) return distance;
            if (!best || distance.distanceSq < best.distanceSq) best = distance;
        }
        return best;
    }

    function isPointInsideFloorVisibilityFragment(fragment, x, y) {
        if (!fragment) return false;
        const outer = Array.isArray(fragment.visibilityPolygon) && fragment.visibilityPolygon.length >= 3
            ? fragment.visibilityPolygon
            : fragment.outerPolygon;
        if (!pointInFloorVisualPolygon2D(x, y, outer)) return false;
        const holes = Array.isArray(fragment.visibilityHoles) && fragment.visibilityHoles.length > 0
            ? fragment.visibilityHoles
            : (Array.isArray(fragment.holes) ? fragment.holes : []);
        for (let i = 0; i < holes.length; i++) {
            if (pointInFloorVisualPolygon2D(x, y, holes[i])) return false;
        }
        return true;
    }

    function findNearestSupportedFloorLayer(map, x, y, startLayer) {
        if (!(map && map.floorsById instanceof Map)) return null;
        const byLevel = new Map();
        for (const fragment of map.floorsById.values()) {
            if (!fragment) continue;
            const level = Number.isFinite(fragment.level) ? Math.round(Number(fragment.level)) : 0;
            if (!byLevel.has(level)) byLevel.set(level, []);
            byLevel.get(level).push(fragment);
        }
        const requestedLevel = Number.isFinite(startLayer) ? Math.round(Number(startLayer)) : 0;
        const levels = Array.from(byLevel.keys()).sort((a, b) => b - a);
        for (let i = 0; i < levels.length; i++) {
            const level = levels[i];
            if (level > requestedLevel) continue;
            const fragments = byLevel.get(level) || [];
            for (let j = 0; j < fragments.length; j++) {
                if (isPointSupportedByFloorFragment(fragments[j], x, y)) {
                    return level;
                }
            }
        }
        return null;
    }

    // Keep expensive renderer diagnostics available for triage, but leave them
    // off in normal gameplay. Re-enable only when chasing invalid PIXI textures
    // or ground tile lifetime bugs.
    function ensureRenderingDiagnosticsConfig() {
        const defaults = {
            textureSanitizer: false,
            pixiSpriteCrashDiagnostics: false,
            roadTextureLifecycleDiagnostics: false,
            groundTileProfiling: false,
            drawPassBreakdown: true,
            scenePickerHoverProfiling: false
        };
        if (!global.renderingDiagnostics || typeof global.renderingDiagnostics !== "object") {
            global.renderingDiagnostics = { ...defaults };
            return global.renderingDiagnostics;
        }
        const config = global.renderingDiagnostics;
        for (const key of Object.keys(defaults)) {
            if (typeof config[key] !== "boolean") {
                config[key] = defaults[key];
            }
        }
        return config;
    }

    function isTextureSanitizerEnabled() {
        return !!ensureRenderingDiagnosticsConfig().textureSanitizer;
    }

    function isPixiSpriteCrashDiagnosticsEnabled() {
        return !!ensureRenderingDiagnosticsConfig().pixiSpriteCrashDiagnostics;
    }

    function isRoadTextureLifecycleDiagnosticsEnabled() {
        return !!ensureRenderingDiagnosticsConfig().roadTextureLifecycleDiagnostics;
    }

    function isGroundTileProfilingEnabled() {
        return !!ensureRenderingDiagnosticsConfig().groundTileProfiling;
    }

    function isDrawPassBreakdownEnabled() {
        return !!ensureRenderingDiagnosticsConfig().drawPassBreakdown;
    }

    if (typeof global.RenderingDiagnostics !== "object" || !global.RenderingDiagnostics) {
        global.RenderingDiagnostics = {
            getFlags() {
                return { ...ensureRenderingDiagnosticsConfig() };
            },
            setTextureSanitizerEnabled(enabled) {
                const config = ensureRenderingDiagnosticsConfig();
                config.textureSanitizer = !!enabled;
                return config.textureSanitizer;
            },
            setPixiSpriteCrashDiagnosticsEnabled(enabled) {
                const config = ensureRenderingDiagnosticsConfig();
                config.pixiSpriteCrashDiagnostics = !!enabled;
                if (config.pixiSpriteCrashDiagnostics) {
                    installPixiSpriteRenderDiagnostics();
                }
                return config.pixiSpriteCrashDiagnostics;
            },
            setRoadTextureLifecycleDiagnosticsEnabled(enabled) {
                const config = ensureRenderingDiagnosticsConfig();
                config.roadTextureLifecycleDiagnostics = !!enabled;
                return config.roadTextureLifecycleDiagnostics;
            },
            setGroundTileProfilingEnabled(enabled) {
                const config = ensureRenderingDiagnosticsConfig();
                config.groundTileProfiling = !!enabled;
                return config.groundTileProfiling;
            },
            setDrawPassBreakdownEnabled(enabled) {
                const config = ensureRenderingDiagnosticsConfig();
                config.drawPassBreakdown = !!enabled;
                return config.drawPassBreakdown;
            },
            setScenePickerHoverProfilingEnabled(enabled) {
                const config = ensureRenderingDiagnosticsConfig();
                config.scenePickerHoverProfiling = !!enabled;
                return config.scenePickerHoverProfiling;
            }
        };
    }

    function isRenderablePixiTexture(texture) {
        if (!texture || texture === PIXI.Texture.EMPTY) return false;
        const baseTexture = texture.baseTexture || null;
        const orig = texture.orig || null;
        const hasUvs = !!(texture._uvs && texture._uvs.uvsFloat32);
        const hasOrigSize = !!(
            orig &&
            Number.isFinite(orig.width) &&
            Number.isFinite(orig.height)
        );
        return !!(baseTexture && hasUvs && hasOrigSize);
    }

    function sanitizeDisplayTreeTextures(root, options = {}) {
        if (!root) return { repaired: 0, samples: [] };
        const maxSamples = Number.isFinite(options.maxSamples) ? Math.max(1, Number(options.maxSamples)) : 8;
        const samples = [];
        let repaired = 0;
        const stack = [root];
        while (stack.length > 0) {
            const current = stack.pop();
            if (!current) continue;
            const texture = current.texture;
            if (Object.prototype.hasOwnProperty.call(current, "texture") && !isRenderablePixiTexture(texture)) {
                if (samples.length < maxSamples) {
                    samples.push({
                        name: typeof current.name === "string" ? current.name : "",
                        ctor: current.constructor && current.constructor.name ? current.constructor.name : "",
                        textureValid: !!texture,
                        hasBaseTexture: !!(texture && texture.baseTexture),
                        hasUvs: !!(texture && texture._uvs && texture._uvs.uvsFloat32),
                        origWidth: texture && texture.orig ? Number(texture.orig.width) : null,
                        origHeight: texture && texture.orig ? Number(texture.orig.height) : null
                    });
                }
                current.texture = PIXI.Texture.WHITE;
                repaired += 1;
            }
            const children = Array.isArray(current.children) ? current.children : null;
            if (!children) continue;
            for (let i = children.length - 1; i >= 0; i--) {
                stack.push(children[i]);
            }
        }
        return { repaired, samples };
    }

    function summarizePixiTexture(texture) {
        if (!texture) {
            return {
                exists: false
            };
        }
        const baseTexture = texture.baseTexture || null;
        const orig = texture.orig || null;
        return {
            exists: true,
            hasBaseTexture: !!baseTexture,
            baseTextureValid: !!(baseTexture && baseTexture.valid),
            hasUvs: !!(texture._uvs && texture._uvs.uvsFloat32),
            origWidth: orig && Number.isFinite(orig.width) ? Number(orig.width) : null,
            origHeight: orig && Number.isFinite(orig.height) ? Number(orig.height) : null,
            frameWidth: texture.frame && Number.isFinite(texture.frame.width) ? Number(texture.frame.width) : null,
            frameHeight: texture.frame && Number.isFinite(texture.frame.height) ? Number(texture.frame.height) : null
        };
    }

    function summarizePixiDisplayObject(displayObj) {
        if (!displayObj) return null;
        const parent = displayObj.parent || null;
        const scale = displayObj.scale || null;
        const anchor = displayObj.anchor || null;
        return {
            ctor: displayObj.constructor && displayObj.constructor.name ? displayObj.constructor.name : "",
            name: typeof displayObj.name === "string" ? displayObj.name : "",
            destroyed: displayObj.destroyed === true,
            visible: displayObj.visible !== false,
            renderable: displayObj.renderable !== false,
            x: Number.isFinite(displayObj.x) ? Number(displayObj.x) : null,
            y: Number.isFinite(displayObj.y) ? Number(displayObj.y) : null,
            scaleX: scale && Number.isFinite(scale.x) ? Number(scale.x) : null,
            scaleY: scale && Number.isFinite(scale.y) ? Number(scale.y) : null,
            anchorX: anchor && Number.isFinite(anchor.x) ? Number(anchor.x) : null,
            anchorY: anchor && Number.isFinite(anchor.y) ? Number(anchor.y) : null,
            alpha: Number.isFinite(displayObj.alpha) ? Number(displayObj.alpha) : null,
            parentName: parent && typeof parent.name === "string" ? parent.name : "",
            roadTextureCacheKey: (typeof displayObj._roadTextureCacheKey === "string") ? displayObj._roadTextureCacheKey : "",
            texture: summarizePixiTexture(displayObj.texture)
        };
    }

    function buildPixiDisplayObjectCrashSignature(summary) {
        if (!summary) return "unknown";
        const tex = summary.texture || {};
        return [
            summary.ctor || "",
            summary.name || "",
            summary.parentName || "",
            tex.hasBaseTexture ? "bt1" : "bt0",
            tex.hasUvs ? "uv1" : "uv0",
            tex.origWidth === null ? "owx" : `ow${tex.origWidth}`,
            tex.origHeight === null ? "ohx" : `oh${tex.origHeight}`
        ].join("|");
    }

    function syncRoadRenderSpriteTextureRetention(sprite, road) {
        if (!sprite) return;
        const RoadClass = (typeof global !== "undefined" && global && global.Road) ? global.Road : null;
        const nextKey = (road && typeof road._roadTextureCacheKey === "string" && road._roadTextureCacheKey.length > 0)
            ? road._roadTextureCacheKey
            : "";
        const currentKey = (typeof sprite._roadTextureCacheKey === "string") ? sprite._roadTextureCacheKey : "";
        if (currentKey === nextKey) return;
        if (currentKey && RoadClass && typeof RoadClass._releaseTextureCacheEntry === "function") {
            RoadClass._releaseTextureCacheEntry(currentKey);
        }
        sprite._roadTextureCacheKey = "";
        if (nextKey && RoadClass && typeof RoadClass._retainTextureCacheEntry === "function") {
            RoadClass._retainTextureCacheEntry(nextKey);
            sprite._roadTextureCacheKey = nextKey;
        }
    }

    function installPixiSpriteRenderDiagnostics() {
        if (typeof PIXI === "undefined" || !PIXI || !PIXI.Sprite || !PIXI.Sprite.prototype) return;
        if (PIXI.Sprite.prototype._survivorTextureDiagInstalled === true) return;
        PIXI.Sprite.prototype._survivorTextureDiagInstalled = true;
        const loggedCrashSignatures = new Set();

        const originalCalculateVertices = PIXI.Sprite.prototype.calculateVertices;
        if (typeof originalCalculateVertices === "function") {
            PIXI.Sprite.prototype.calculateVertices = function survivorDiagnoseCalculateVertices(...args) {
                try {
                    return originalCalculateVertices.apply(this, args);
                } catch (err) {
                    const message = err && err.message ? String(err.message) : "";
                    const textureState = summarizePixiDisplayObject(this);
                    const signature = buildPixiDisplayObjectCrashSignature(textureState);
                    if (isPixiSpriteCrashDiagnosticsEnabled() && !loggedCrashSignatures.has(signature)) {
                        loggedCrashSignatures.add(signature);
                        console.error("[pixi sprite calculateVertices crash]", {
                            message,
                            signature,
                            sprite: textureState
                        });
                        try {
                            console.error("[pixi sprite calculateVertices crash json]", JSON.stringify({
                                message,
                                signature,
                                sprite: textureState
                            }));
                        } catch (_jsonErr) {
                            // ignore JSON serialization failures
                        }
                    }
                    if (!isRenderablePixiTexture(this.texture)) {
                        this.texture = PIXI.Texture.WHITE;
                        try {
                            return originalCalculateVertices.apply(this, args);
                        } catch (_retryErr) {
                            // fall through to original error
                        }
                    }
                    throw err;
                }
            };
        }
    }

    class RenderingImpl {
        constructor() {
            installPixiSpriteRenderDiagnostics();
            const CameraCtor = global.RenderingCamera;
            const LayersCtor = global.RenderingLayers;
            const MazeModeCtor = global.RenderingMazeMode;
            this.camera = new CameraCtor();
            this.layers = new LayersCtor();
            this.mazeModeRenderer = (MazeModeCtor && typeof MazeModeCtor === "function")
                ? new MazeModeCtor()
                : null;
            this.mazeModeOverlayActive = false;
            this.mazeModeJustActivatedFrame = false;
            this.mazeModeActivatedAtMs = null;
            this.lastMazeModeSettingEnabled = null;
            this.mazeModeSuppressRevealAnimation = false;
            this.initialized = false;
            this.wizardSprite = null;
            this.wizardGhostSprite = null;
            this.wizardShadowGraphics = null;
            this.wizardShadowSprite = null;
            this.wizardShadowProxy = null;
            this.placeObjectPreviewSprite = null;
            this.placeObjectPreviewTexturePath = "";
            this.placeObjectPreviewDisplayObject = null;
            this.placeObjectPreviewItem = null;
            this.placeObjectCenterSnapGuideGraphics = null;
            this.powerupPlacementPreviewSprite = null;
            this.powerupPlacementPreviewTexturePath = "";
            this.powerupPlacementPreviewDisplayObject = null;
            this.powerupPlacementPreviewItem = null;
            this.wallPlacementPreviewGraphics = null;
            this.floorEditorPolygonOverlayGraphics = null;
            this.layerCutawayDebugGraphics = null;
            this.buildingCutawayGroundMaskGraphics = null;
            this.buildingCutawayGroundMaskMeshes = new Map();
            this.buildingCutawayGroundMaskState = null;
            this.buildingCutawayCompositeRenderTexture = null;
            this.buildingCutawayCompositeSprite = null;
            this.buildingCutawayCompositeTexture = null;
            this.buildingCutawayCompositeProxy = null;
            this.buildingCutawayCompositeSize = null;
            this.buildingCutawayCompositeCache = null;
            this.buildingCutawayCompositeBillboardState = null;
            this.buildingCutawayCompositePendingBaseTextures = new Set();
            this.buildingCutawayEntryTransitions = new Map();
            this.buildingInteriorForegroundState = null;
            this.buildingInteriorOverlayContainer = null;
            this.buildingInteriorOverlayFloorMeshes = new Map();
            this.buildingInteriorOverlayWallMeshes = new Map();
            this.buildingInteriorOverlayItemMeshes = new Map();
            this.buildingInteriorOverlayCharacterProxies = new Map();
            this.buildingInteriorOverlayRenderTexture = null;
            this.buildingInteriorOverlaySprite = null;
            this.buildingInteriorOverlaySize = null;
            this._buildingInteriorForegroundPromotions = [];
            this._cutawayInteriorOverlayWallSections = new Set();
            this._layerCutawayFrameId = 0;
            this._drawFrameId = 0;
            this._activeDrawFrameId = 0;
            this._layerCutawayPreparedDrawFrameId = 0;
            this.prototypeSectionSeamGraphics = null;
            this.hexGridTexture = null;
            this.hexGridSprites = [];
            this.hexGridContainer = null;
            this.hexGridPickerBackdrop = null;
            this.groundTileContainer = null;
            this.hexGridLastViewscale = 0;
            this.hexGridLastXyratio = 0;
            this.groundSpriteByNodeKey = new Map();
            this.groundVisibleNodeKeys = new Set();
            this.groundSpritePool = [];
            this.floorVisualContainer = null;
            this.floorVisualMeshByKey = new Map();
            this.floorVisualVisibleKeys = new Set();
            this.floorVisualCaveTexture = null;
            this.floorVisualTextureByPath = new Map();
            this.floorVisualTextureConfigCache = null;
            this.floorVisualTextureConfigPromise = null;
            this.floorVisualDepthState = null;
            this.losShadowDepthMesh = null;
            this.losShadowDepthMaskGraphics = null;
            this.losShadowDepthState = null;
            this.level0GroundSurfaceCache = new Map();
            this.level0GroundSurfaceBakeNodeCache = new Map();
            this.level0GroundSurfaceChunkCache = new Map();
            this.level0GroundSurfaceChunkTick = 0;
            this.level0GroundSurfaceChunkBuildsThisFrame = 0;
            this.floorVisualChunkClipCache = new Map();
            this.floorVisualChunkClipTick = 0;
            this.bakedLevel0SectionKeys = new Set();
            this.bakedLevel0SectionSignature = "";
            this.level0GroundSurfacePendingLoads = new Set();
            this.roadSpriteByObject = new Map();
            this.lastSectionInputItems = [];
            this.activeObjectDisplayObjects = new Set();
            this.activeDepthBillboardMeshes = new Set();
            this.activeDepthBillboardItems = new Set();
            this.activeAnimalHealthBarItems = new Set();
            this.activeTreeHealthBarItems = new Set();
            this.activePowerupDisplayObjects = new Set();
            this.activeProjectileDisplayObjects = new Set();
            this.scriptMessageTextObjects = new Map();
            this.pickRenderItems = [];
            this.losShadowGraphics = null;
            this.currentLosState = null;
            this.lastLosWizardX = null;
            this.lastLosWizardY = null;
            this.lastLosWizardLayer = null;
            this.lastLosWizardBaseZ = null;
            this.lastLosFacingAngle = null;
            this.lastLosCandidateCount = -1;
            this.lastLosCandidateHash = 0;
            this.lastLosComputeAtMs = 0;
            this.nextLosObjectId = 1;
            this.drawPassProfiler = {
                startMs: null,
                deadlineMs: null,
                frameCount: 0,
                totalFrameMs: 0,
                maxFrameMs: 0,
                sections: Object.create(null),
                metrics: Object.create(null),
                printed: false
            };
            this.currentFrameDrawSections = Object.create(null);
            this.groundTileProfiler = {
                startMs: null,
                deadlineMs: null,
                frameCount: 0,
                printed: false,
                totals: {
                    totalMs: 0,
                    activeKeyBuildMs: 0,
                    visibleSetMs: 0,
                    createSpriteMs: 0,
                    parentAttachMs: 0,
                    textureResolveMs: 0,
                    positionSizeMs: 0,
                    cleanupMs: 0
                },
                counts: {
                    visibleNodes: 0,
                    createdSprites: 0,
                    attachedSprites: 0,
                    cleanedSprites: 0,
                    evictedSprites: 0,
                    reusedSprites: 0
                }
            };
            this._lastTextureSanitizerLogAtMs = 0;
            const ScenePickerCtor = global.RenderingScenePicker;
            this.scenePicker = (ScenePickerCtor && typeof ScenePickerCtor === "function")
                ? new ScenePickerCtor()
                : null;
        }

        resetPickRenderItems() {
            this.pickRenderItems.length = 0;
        }

        addPickRenderItem(item, displayObj, options = null) {
            if (!item || !displayObj) return;
            if (item.gone || item.vanishing) return;
            const opts = options && typeof options === "object" ? options : {};
            const forceInclude = !!opts.forceInclude;
            if (!forceInclude && !displayObj.visible) return;
            if (!displayObj.parent && !(forceInclude && (item.type === "triggerArea" || item.isTriggerArea === true))) return;
            this.pickRenderItems.push({ item, displayObj, forceInclude });
        }

        getLayerIndexFromValue(value, fallback = 0) {
            const n = Number(value);
            if (!Number.isFinite(n)) return Number(fallback) || 0;
            return Math.round(n);
        }

        getLayerIndexForNode(node) {
            if (!node) return 0;
            if (Number.isFinite(node.traversalLayer)) return this.getLayerIndexFromValue(node.traversalLayer, 0);
            if (Number.isFinite(node.level)) return this.getLayerIndexFromValue(node.level, 0);
            return 0;
        }

        getLayerBaseZForLevel(level) {
            return this.getLayerIndexFromValue(level, 0) * FLOOR_LAYER_DEFAULT_HEIGHT_UNITS;
        }

        getLayerBaseZForNode(node) {
            if (node && Number.isFinite(node.baseZ)) return Number(node.baseZ);
            return this.getLayerBaseZForLevel(this.getLayerIndexForNode(node));
        }

        getLayerIndexForObject(item, fallback = 0) {
            if (!item) return this.getLayerIndexFromValue(fallback, 0);
            if (item.type === "wallSection" && Number.isFinite(item.bottomZ)) {
                const layerHeight = (typeof FLOOR_LAYER_DEFAULT_HEIGHT_UNITS !== "undefined" && Number.isFinite(FLOOR_LAYER_DEFAULT_HEIGHT_UNITS) && FLOOR_LAYER_DEFAULT_HEIGHT_UNITS > 0)
                    ? Number(FLOOR_LAYER_DEFAULT_HEIGHT_UNITS)
                    : 3;
                return this.getLayerIndexFromValue(Math.floor((Number(item.bottomZ) / layerHeight) + 1e-6), fallback);
            }
            if (Number.isFinite(item._renderTraversalLayer)) {
                return this.getLayerIndexFromValue(item._renderTraversalLayer, fallback);
            }
            if (Number.isFinite(item.traversalLayer)) {
                return this.getLayerIndexFromValue(item.traversalLayer, fallback);
            }
            if (Number.isFinite(item.level)) {
                return this.getLayerIndexFromValue(item.level, fallback);
            }
            if (Number.isFinite(item.currentLayer)) {
                return this.getLayerIndexFromValue(item.currentLayer, fallback);
            }
            return this.getLayerIndexFromValue(fallback, 0);
        }

        getLayerBaseZForObject(item, fallback = 0) {
            if (this.isCharacterRenderItem(item)) {
                return 0;
            }
            return this.getLayerBaseZForLevel(this.getLayerIndexForObject(item, fallback));
        }

        getMountedWallLayerIndexForItem(item, fallback = 0) {
            if (!this.isWallMountedSpatialItem(item)) return null;
            const mountedSection = this.resolveMountedWallSectionForItem(item);
            if (!mountedSection || mountedSection.type !== "wallSection") return null;
            const wallBottomZ = Number.isFinite(mountedSection.bottomZ) ? Number(mountedSection.bottomZ) : null;
            if (!Number.isFinite(wallBottomZ)) return null;
            const layerHeight = (typeof FLOOR_LAYER_DEFAULT_HEIGHT_UNITS !== "undefined" && Number.isFinite(FLOOR_LAYER_DEFAULT_HEIGHT_UNITS) && FLOOR_LAYER_DEFAULT_HEIGHT_UNITS > 0)
                ? Number(FLOOR_LAYER_DEFAULT_HEIGHT_UNITS)
                : 3;
            // Wall bottoms can carry custom positive offsets; classify by floor band,
            // not nearest integer, so layer-1 walls (e.g. z=4.5) stay in layer 1.
            const derivedLayer = Math.floor((wallBottomZ / layerHeight) + 1e-6);
            return this.getLayerIndexFromValue(derivedLayer, fallback);
        }

        getLayerIndexForRoof(roof, fallback = 0) {
            if (!roof) return this.getLayerIndexFromValue(fallback, 0);
            if (Number.isFinite(roof.traversalLayer)) {
                return this.getLayerIndexFromValue(Number(roof.traversalLayer) + 1, fallback);
            }
            if (Number.isFinite(roof.level)) {
                return this.getLayerIndexFromValue(Number(roof.level) + 1, fallback);
            }
            // Most legacy roofs are level 0. Only infer negatives from z.
            const roofZ = Number.isFinite(roof.z)
                ? Number(roof.z)
                : (Number.isFinite(roof.heightFromGround) ? Number(roof.heightFromGround) : 0);
            if (
                roofZ > 0 &&
                (
                    (Array.isArray(roof.wallLoopSectionIds) && roof.wallLoopSectionIds.length > 0) ||
                    (Array.isArray(roof.vertices) && roof.vertices.length >= 3)
                )
            ) {
                const layerHeight = (typeof FLOOR_LAYER_DEFAULT_HEIGHT_UNITS !== "undefined" && Number.isFinite(FLOOR_LAYER_DEFAULT_HEIGHT_UNITS) && FLOOR_LAYER_DEFAULT_HEIGHT_UNITS > 0)
                    ? Number(FLOOR_LAYER_DEFAULT_HEIGHT_UNITS)
                    : 3;
                return this.getLayerIndexFromValue(Math.floor((roofZ / layerHeight) + 1e-6) + 1, fallback);
            }
            if (roofZ < 0) {
                return Math.floor(roofZ / FLOOR_LAYER_DEFAULT_HEIGHT_UNITS);
            }
            return this.getLayerIndexFromValue(fallback, 0);
        }

        syncLayerTransitionState(ctx) {
            const wizard = ctx && ctx.wizard ? ctx.wizard : null;
            if (!wizard) return;
            const nowMs = (ctx && Number.isFinite(ctx.renderNowMs)) ? Number(ctx.renderNowMs) : Date.now();
            const currentLayer = this.getLayerIndexFromValue(wizard.currentLayer, 0);
            const currentLayerBaseZ = Number.isFinite(wizard.currentLayerBaseZ)
                ? Number(wizard.currentLayerBaseZ)
                : this.getLayerBaseZForLevel(currentLayer);

            if (!Number.isFinite(this._lastRenderedWizardLayer)) {
                this._lastRenderedWizardLayer = currentLayer;
            }

            // During a downward fall, reveal the lower layer early once the wizard's
            // head crosses below world z=0 so the player sees where they are falling.
            this._fallRevealLayer = null;
            const fallState = wizard && wizard._floorFallState;
            if (fallState && fallState.active && Number.isFinite(fallState.targetLayer)) {
                const fromLayer = this.getLayerIndexFromValue(fallState.fromLayer, currentLayer);
                const toLayer = this.getLayerIndexFromValue(fallState.targetLayer, fromLayer);
                if (toLayer < fromLayer) {
                    const headHeight = Number.isFinite(wizard.height)
                        ? Math.max(0.55, Number(wizard.height) * 0.85)
                        : 0.85;
                    const wizardHeadWorldZ = currentLayerBaseZ + (Number.isFinite(wizard.z) ? Number(wizard.z) : 0) + headHeight;
                    if (wizardHeadWorldZ <= 0) {
                        this._fallRevealLayer = toLayer;
                        if (!fallState._layerRevealTransitionStarted) {
                            this._layerFadeTransition = {
                                fromLayer,
                                toLayer,
                                fadingLayer: Math.max(fromLayer, toLayer),
                                startedAtMs: nowMs,
                                durationMs: 260
                            };
                            fallState._layerRevealTransitionStarted = true;
                        }
                    }
                }
            }

            const pending = wizard._pendingLayerTransition;
            if (pending && typeof pending === "object" && pending.active) {
                const fromLayer = this.getLayerIndexFromValue(pending.fromLevel, this._lastRenderedWizardLayer);
                const toLayer = this.getLayerIndexFromValue(pending.toLevel, currentLayer);
                const durationMs = Number.isFinite(pending.durationMs) ? Math.max(60, Number(pending.durationMs)) : 320;
                this._layerFadeTransition = {
                    fromLayer,
                    toLayer,
                    fadingLayer: Math.max(fromLayer, toLayer),
                    startedAtMs: Number.isFinite(pending.startedAtMs) ? Number(pending.startedAtMs) : nowMs,
                    durationMs
                };
                pending.active = false;
                this._lastRenderedWizardLayer = toLayer;
            } else if (currentLayer !== this._lastRenderedWizardLayer) {
                const fromLayer = this._lastRenderedWizardLayer;
                const toLayer = currentLayer;
                this._layerFadeTransition = {
                    fromLayer,
                    toLayer,
                    fadingLayer: Math.max(fromLayer, toLayer),
                    startedAtMs: nowMs,
                    durationMs: 320
                };
                this._lastRenderedWizardLayer = toLayer;
            }

            const active = this._layerFadeTransition;
            if (!active) return;
            const elapsedMs = nowMs - Number(active.startedAtMs || 0);
            if (!(elapsedMs < Number(active.durationMs || 0))) {
                this._layerFadeTransition = null;
            }
        }

        getLayerFadeMultiplier(level, nowMs = null) {
            const layer = this.getLayerIndexFromValue(level, 0);
            const active = this._layerFadeTransition;
            if (!active) return 1;
            if (layer !== this.getLayerIndexFromValue(active.fadingLayer, 0)) return 1;
            const currentNowMs = Number.isFinite(nowMs) ? Number(nowMs) : Date.now();
            const startedAtMs = Number(active.startedAtMs) || 0;
            const durationMs = Math.max(1, Number(active.durationMs) || 320);
            const progress = Math.max(0, Math.min(1, (currentNowMs - startedAtMs) / durationMs));
            return 1 - progress;
        }

        projectWorldPointToCutawayPlane(x, y, z = 0) {
            const px = Number(x);
            const py = Number(y);
            const pz = Number(z) || 0;
            if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
            return { x: px, y: py - pz };
        }

        projectWorldRingToCutawayPlane(points, baseZ = 0) {
            const ring = normalizeFloorVisualPointList(points);
            if (ring.length < 3) return [];
            const out = [];
            for (let i = 0; i < ring.length; i++) {
                const projected = this.projectWorldPointToCutawayPlane(ring[i].x, ring[i].y, baseZ);
                if (!projected) return [];
                out.push(projected);
            }
            return out;
        }

        getBuildingFragments(map, building) {
            if (!(map && map.floorsById instanceof Map) || !building) return [];
            const ids = building.fragmentIds instanceof Set
                ? Array.from(building.fragmentIds)
                : (Array.isArray(building.fragmentIds) ? building.fragmentIds : []);
            const out = [];
            for (let i = 0; i < ids.length; i++) {
                const fragment = map.floorsById.get(ids[i]);
                if (fragment) out.push(fragment);
            }
            return out;
        }

        getWizardStandingBuildingLevel(map, building, x, y, wizardLayer) {
            const fragments = this.getBuildingFragments(map, building);
            const targetLayer = this.getLayerIndexFromValue(wizardLayer, 0);
            for (let i = 0; i < fragments.length; i++) {
                const fragment = fragments[i];
                if (!fragment || this.getLayerIndexFromValue(fragment.level, 0) !== targetLayer) continue;
                if (isPointInsideFloorVisibilityFragment(fragment, x, y) || isPointSupportedByFloorFragment(fragment, x, y)) {
                    return targetLayer;
                }
            }
            return null;
        }

        getBottommostUpperBuildingFragments(map, building) {
            const fragments = this.getBuildingFragments(map, building);
            let minLevel = Infinity;
            const out = [];
            for (let i = 0; i < fragments.length; i++) {
                const fragment = fragments[i];
                if (!fragment) continue;
                const level = this.getLayerIndexFromValue(fragment.level, 0);
                if (level <= 0) continue;
                if (level < minLevel) {
                    minLevel = level;
                    out.length = 0;
                }
                if (level === minLevel) out.push(fragment);
            }
            return out;
        }

        getBuildingGroundProjectionPolygons(map, building) {
            if (!building) return [];
            const floorVersion = Number(map && map._floorBuildingVersion) || 0;
            const cacheKey = `${floorVersion}`;
            if (
                building._groundProjectionCacheKey === cacheKey &&
                Array.isArray(building.groundProjectionPolygons)
            ) {
                return building.groundProjectionPolygons;
            }
            const fragments = this.getBottommostUpperBuildingFragments(map, building);
            const polygons = [];
            for (let i = 0; i < fragments.length; i++) {
                const fragment = fragments[i];
                const outer = normalizeFloorVisualPointList(
                    Array.isArray(fragment.visibilityPolygon) && fragment.visibilityPolygon.length >= 3
                        ? fragment.visibilityPolygon
                        : fragment.outerPolygon
                );
                if (outer.length < 3) continue;
                const holes = [];
                const fragmentHoles = Array.isArray(fragment.visibilityHoles) && fragment.visibilityHoles.length > 0
                    ? fragment.visibilityHoles
                    : (Array.isArray(fragment.holes) ? fragment.holes : []);
                for (let h = 0; h < fragmentHoles.length; h++) {
                    const hole = normalizeFloorVisualPointList(fragmentHoles[h]);
                    if (hole.length >= 3) holes.push(hole);
                }
                polygons.push({ outer, holes });
            }
            building._groundProjectionCacheKey = cacheKey;
            building.groundProjectionPolygons = polygons;
            return polygons;
        }

        getWizardGroundProjectionBuildingLevel(map, building, x, y, wizardLayer) {
            const targetLayer = this.getLayerIndexFromValue(wizardLayer, 0);
            if (targetLayer !== 0) return null;
            const polygons = this.getBuildingGroundProjectionPolygons(map, building);
            return floorVisualPolygonsContainPoint(polygons, x, y) ? 0 : null;
        }

        getBuildingRenderCacheKey(ctx, map) {
            const floorVersion = Number(map && map._floorBuildingVersion) || 0;
            const renderVersion = Number(map && map._buildingRenderCacheVersion) || 0;
            const roofVersion = Number(ctx && ctx.roofVersion) || Number(global.roofVersion) || 0;
            const objectState = map && map._prototypeObjectState ? map._prototypeObjectState : null;
            const objectSignature = objectState && typeof objectState.activeRecordSignature === "string"
                ? objectState.activeRecordSignature
                : "";
            const activeObjectCount = objectState && objectState.activeRuntimeObjectsByRecordId instanceof Map
                ? objectState.activeRuntimeObjectsByRecordId.size
                : "";
            const wallState = map && map._prototypeWallState ? map._prototypeWallState : null;
            const wallSignature = wallState && typeof wallState.activeRecordSignature === "string"
                ? wallState.activeRecordSignature
                : "";
            const activeWallCount = wallState && wallState.activeRuntimeWallsByRecordId instanceof Map
                ? wallState.activeRuntimeWallsByRecordId.size
                : "";
            return `${floorVersion}|${renderVersion}|${roofVersion}|${activeObjectCount}|${objectSignature}|${activeWallCount}|${wallSignature}`;
        }

        getBuildingRenderObjectCandidates(ctx, map) {
            const out = [];
            const seen = new Set();
            const pushItem = (item) => {
                if (!item || item.gone || item.vanishing || seen.has(item)) return;
                if (map && item.map && item.map !== map) return;
                seen.add(item);
                out.push(item);
            };
            if (map && typeof map.getGameObjects === "function") {
                const objects = map.getGameObjects({ refresh: true });
                if (Array.isArray(objects)) {
                    for (let i = 0; i < objects.length; i++) pushItem(objects[i]);
                }
            }
            const wallCtor = global.WallSectionUnit;
            const allSections = wallCtor && wallCtor._allSections instanceof Map ? wallCtor._allSections : null;
            if (allSections) {
                for (const section of allSections.values()) pushItem(section);
            }
            const roofs = this.getRoofsList(ctx);
            if (Array.isArray(roofs)) {
                for (let i = 0; i < roofs.length; i++) pushItem(roofs[i]);
            }
            return out;
        }

        getFloorFragmentInteriorPolygon(fragment) {
            if (!fragment) return null;
            const outer = normalizeFloorVisualPointList(
                Array.isArray(fragment.visibilityPolygon) && fragment.visibilityPolygon.length >= 3
                    ? fragment.visibilityPolygon
                    : fragment.outerPolygon
            );
            if (outer.length < 3) return null;
            const holes = [];
            const sourceHoles = Array.isArray(fragment.visibilityHoles) && fragment.visibilityHoles.length > 0
                ? fragment.visibilityHoles
                : (Array.isArray(fragment.holes) ? fragment.holes : []);
            for (let i = 0; i < sourceHoles.length; i++) {
                const hole = normalizeFloorVisualPointList(sourceHoles[i]);
                if (hole.length >= 3) holes.push(hole);
            }
            return { outer, holes };
        }

        buildBuildingInteriorRegions(fragments, groundProjectionPolygons) {
            const regions = [];
            const addRegion = (region) => {
                if (!region || !region.polygon || !Array.isArray(region.polygon.outer) || region.polygon.outer.length < 3) return;
                region.staticObjects = [];
                region._staticObjectSet = new Set();
                regions.push(region);
            };
            const list = Array.isArray(fragments) ? fragments : [];
            for (let i = 0; i < list.length; i++) {
                const fragment = list[i];
                const polygon = this.getFloorFragmentInteriorPolygon(fragment);
                if (!polygon) continue;
                const fragmentId = typeof fragment.fragmentId === "string" ? fragment.fragmentId : "";
                const surfaceId = typeof fragment.surfaceId === "string" ? fragment.surfaceId : "";
                addRegion({
                    id: `fragment:${fragmentId || i}`,
                    kind: "floorFragment",
                    level: this.getLayerIndexFromValue(fragment.level, 0),
                    fragment,
                    fragmentId,
                    surfaceId,
                    polygon
                });
            }
            const groundPolygons = Array.isArray(groundProjectionPolygons) ? groundProjectionPolygons : [];
            for (let i = 0; i < groundPolygons.length; i++) {
                const polygon = groundPolygons[i];
                if (!polygon || !Array.isArray(polygon.outer) || polygon.outer.length < 3) continue;
                addRegion({
                    id: `groundFootprint:${i}`,
                    kind: "groundFootprint",
                    level: 0,
                    polygon
                });
            }
            return regions;
        }

        addBuildingInteriorRegionObject(region, entry) {
            if (!region || !entry || !entry.item) return false;
            if (!(region._staticObjectSet instanceof Set)) region._staticObjectSet = new Set();
            if (region._staticObjectSet.has(entry.item)) return false;
            region._staticObjectSet.add(entry.item);
            if (!Array.isArray(region.staticObjects)) region.staticObjects = [];
            region.staticObjects.push(entry);
            return true;
        }

        populateBuildingInteriorRegionMembership(cache, item, entry, refs, map) {
            if (!cache || !item || item.type === "roof" || !entry) return;
            const regions = Array.isArray(cache.interiorRegions) ? cache.interiorRegions : [];
            if (regions.length === 0) return;
            const itemLevel = this.getLayerIndexFromValue(entry.level, 0);
            const refList = Array.isArray(refs) ? refs : [];
            for (let i = 0; i < regions.length; i++) {
                const region = regions[i];
                if (!region || this.getLayerIndexFromValue(region.level, 0) !== itemLevel) continue;
                let matches = false;
                if (region.kind === "floorFragment") {
                    for (let r = 0; r < refList.length; r++) {
                        const ref = refList[r];
                        if (!ref) continue;
                        if (region.fragmentId && ref.fragmentId && region.fragmentId === ref.fragmentId) {
                            matches = true;
                            break;
                        }
                        if (region.surfaceId && ref.surfaceId && region.surfaceId === ref.surfaceId) {
                            matches = true;
                            break;
                        }
                    }
                }
                if (!matches && region.polygon) {
                    matches = this.renderItemSamplesMatchPolygons(item, [region.polygon], map);
                }
                if (matches) this.addBuildingInteriorRegionObject(region, entry);
            }
        }

        finalizeBuildingInteriorRegions(cache) {
            const regions = Array.isArray(cache && cache.interiorRegions) ? cache.interiorRegions : [];
            for (let i = 0; i < regions.length; i++) {
                if (regions[i]) delete regions[i]._staticObjectSet;
            }
        }

        getBuildingInteriorRegionAtPoint(renderCache, x, y, level) {
            const regions = Array.isArray(renderCache && renderCache.interiorRegions) ? renderCache.interiorRegions : [];
            const targetLevel = this.getLayerIndexFromValue(level, 0);
            for (let i = 0; i < regions.length; i++) {
                const region = regions[i];
                if (!region || this.getLayerIndexFromValue(region.level, 0) !== targetLevel) continue;
                const contains = region.kind === "floorFragment" && region.fragment
                    ? (isPointInsideFloorVisibilityFragment(region.fragment, x, y) || isPointSupportedByFloorFragment(region.fragment, x, y))
                    : floorVisualPolygonsContainPoint([region.polygon], x, y);
                if (contains) return region;
            }
            return null;
        }

        getBuildingInteriorOverlayRegionsForTrigger(trigger) {
            const activeRegion = trigger && trigger.activeInteriorRegion;
            const renderCache = trigger && trigger.renderCache;
            const regions = Array.isArray(renderCache && renderCache.interiorRegions)
                ? renderCache.interiorRegions
                : [];
            if (!activeRegion || regions.length === 0) return [];
            const activeLevel = this.getLayerIndexFromValue(activeRegion.level, 0);
            const activeId = typeof activeRegion.id === "string" ? activeRegion.id : "";
            const out = [];
            for (let i = 0; i < regions.length; i++) {
                const region = regions[i];
                if (!region || !region.polygon) continue;
                const level = this.getLayerIndexFromValue(region.level, 0);
                const isActiveRegion = region === activeRegion || (
                    activeId &&
                    typeof region.id === "string" &&
                    region.id === activeId
                );
                if (level < activeLevel || isActiveRegion) out.push(region);
            }
            out.sort((a, b) => {
                const levelA = this.getLayerIndexFromValue(a && a.level, 0);
                const levelB = this.getLayerIndexFromValue(b && b.level, 0);
                if (levelA !== levelB) return levelA - levelB;
                const aIsActive = a === activeRegion || (activeId && a && a.id === activeId);
                const bIsActive = b === activeRegion || (activeId && b && b.id === activeId);
                if (aIsActive !== bIsActive) return aIsActive ? 1 : -1;
                return String(a && a.id || "").localeCompare(String(b && b.id || ""));
            });
            return out;
        }

        getCompiledBuildingRenderCache(ctx, map, building) {
            if (!building) return null;
            const diagnosticsEnabled = !!this.currentFrameMetrics;
            const cacheKey = this.getBuildingRenderCacheKey(ctx, map);
            if (
                building.renderCache &&
                building.renderCache.cacheKey === cacheKey &&
                Array.isArray(building.renderCache.occlusionPolygons)
            ) {
                this.incrementFrameMetric("buildingRenderCacheHits", 1);
                return building.renderCache;
            }
            this.incrementFrameMetric("buildingRenderCacheMisses", 1);
            const buildStartMs = diagnosticsEnabled ? performance.now() : 0;

            const fragments = this.getBuildingFragments(map, building);
            const roofs = this.getRoofsForBuilding(ctx, map, building);
            const occlusionPolygons = this.buildBuildingOcclusionPolygons(ctx, map, building, roofs);
            const groundProjectionPolygons = this.getBuildingGroundProjectionPolygons(map, building);
            const cache = {
                cacheKey,
                buildingId: building.buildingId,
                fragments,
                fragmentGraph: building.fragmentGraph instanceof Map ? building.fragmentGraph : new Map(),
                fragmentIds: building.fragmentIds instanceof Set ? building.fragmentIds : new Set(),
                surfaceIds: building.surfaceIds instanceof Set ? building.surfaceIds : new Set(),
                roofs,
                occlusionPolygons,
                occlusionBounds: this.getCutawayPolygonBounds(occlusionPolygons),
                groundProjectionPolygons,
                interiorRegions: this.buildBuildingInteriorRegions(fragments, groundProjectionPolygons),
                renderItems: [],
                wallSections: [],
                groundProjectionWalls: [],
                wallSectionsByLevel: new Map(),
                maskEntries: null
            };

            const candidates = this.getBuildingRenderObjectCandidates(ctx, map);
            this.incrementFrameMetric("buildingRenderCacheCandidates", candidates.length);
            for (let i = 0; i < candidates.length; i++) {
                const item = candidates[i];
                if (!item || item === global.wizard) continue;
                this.incrementFrameMetric("buildingRenderCacheRefsScanned", 1);
                const refs = this.collectFloorRefsForRenderItem(item, map);
                const level = item.type === "roof"
                    ? this.getLayerIndexForRoof(item, 0)
                    : this.getLayerIndexForObject(item, 0);
                const matchesBuildingRefs = item.type === "roof"
                    ? this.roofMatchesBuilding(item, map, building)
                    : this.refsMatchBuilding(refs, building);
                const matchesGroundProjectionWall = !!(
                    !matchesBuildingRefs &&
                    item.type === "wallSection" &&
                    level === 0 &&
                    this.renderItemSamplesMatchPolygons(item, groundProjectionPolygons, map)
                );
                if (!matchesBuildingRefs && !matchesGroundProjectionWall) continue;
                const entry = { item, level, refs };
                cache.renderItems.push(entry);
                item._buildingRenderCacheId = building.buildingId;
                item._buildingRenderCacheKey = cacheKey;
                item._buildingRenderCacheLevel = level;
                this.populateBuildingInteriorRegionMembership(cache, item, entry, refs, map);
                if (item.type === "wallSection") {
                    cache.wallSections.push(entry);
                    if (!cache.wallSectionsByLevel.has(level)) cache.wallSectionsByLevel.set(level, []);
                    cache.wallSectionsByLevel.get(level).push(entry);
                    if (level === 0) {
                        cache.groundProjectionWalls.push(entry);
                    }
                }
            }
            this.finalizeBuildingInteriorRegions(cache);

            building.renderCache = cache;
            building.occlusionPolygons = occlusionPolygons;
            building.occlusionBounds = cache.occlusionBounds;
            building.groundProjectionPolygons = groundProjectionPolygons;
            this.incrementFrameMetric("buildingRenderCacheItems", cache.renderItems.length);
            this.incrementFrameMetric("buildingRenderCacheWalls", cache.wallSections.length);
            this.incrementFrameMetric("buildingRenderCacheGroundWalls", cache.groundProjectionWalls.length);
            if (diagnosticsEnabled) {
                this.incrementFrameMetric("buildingRenderCacheBuildMs", performance.now() - buildStartMs);
            }
            return cache;
        }

        floorFragmentOverlapsAnyAbove(map, fragment, fragments) {
            if (!(map && typeof map.doFloorFragmentsOverlapXY === "function") || !fragment) return false;
            const level = this.getLayerIndexFromValue(fragment.level, 0);
            const list = Array.isArray(fragments) ? fragments : [];
            for (let i = 0; i < list.length; i++) {
                const other = list[i];
                if (!other || other === fragment) continue;
                if (this.getLayerIndexFromValue(other.level, 0) <= level) continue;
                if (map.doFloorFragmentsOverlapXY(fragment, other)) return true;
            }
            return false;
        }

        refsMatchBuilding(refs, building) {
            if (!building) return false;
            const fragmentIds = building.fragmentIds instanceof Set ? building.fragmentIds : new Set();
            const surfaceIds = building.surfaceIds instanceof Set ? building.surfaceIds : new Set();
            const list = Array.isArray(refs) ? refs : [];
            for (let i = 0; i < list.length; i++) {
                const ref = list[i];
                if (!ref) continue;
                if (ref.fragmentId && fragmentIds.has(ref.fragmentId)) return true;
                if (ref.surfaceId && surfaceIds.has(ref.surfaceId)) return true;
            }
            return false;
        }

        getRoofBuildingFootprintPolygon(roof) {
            if (!roof) return null;
            const pointSources = [
                roof.interiorHidePolygonPoints,
                roof.groundPlaneHitbox && roof.groundPlaneHitbox.points,
                roof.interiorHideHitbox && roof.interiorHideHitbox.points
            ];
            for (let i = 0; i < pointSources.length; i++) {
                const outer = normalizeFloorVisualPointList(pointSources[i]);
                if (outer.length >= 3) return { outer, holes: [] };
            }
            if (Array.isArray(roof.vertices) && roof.vertices.length >= 3) {
                const points = [];
                for (let i = 0; i < roof.vertices.length; i++) {
                    const vertex = roof.vertices[i];
                    const x = Number(roof.x) + (Number(vertex && vertex.x) || 0);
                    const y = Number(roof.y) + (Number(vertex && vertex.y) || 0);
                    if (Number.isFinite(x) && Number.isFinite(y)) points.push({ x, y });
                }
                const hull = typeof convexHull2D === "function" ? convexHull2D(points) : points;
                const outer = normalizeFloorVisualPointList(hull);
                if (outer.length >= 3) return { outer, holes: [] };
            }
            return null;
        }

        roofFootprintOverlapsFloorFragment(roofPolygon, fragment) {
            if (!roofPolygon || !fragment) return false;
            const fragmentPolygon = this.getFloorFragmentInteriorPolygon(fragment);
            if (!fragmentPolygon) return false;
            const intersection = intersectFloorVisualPolygonWithPolygon(
                roofPolygon.outer,
                roofPolygon.holes,
                fragmentPolygon
            );
            if (Array.isArray(intersection) && intersection.length > 0) return true;
            const roofOuter = Array.isArray(roofPolygon.outer) ? roofPolygon.outer : [];
            for (let i = 0; i < roofOuter.length; i++) {
                const point = roofOuter[i];
                if (point && floorVisualPolygonsContainPoint([fragmentPolygon], point.x, point.y)) return true;
            }
            const fragmentOuter = Array.isArray(fragmentPolygon.outer) ? fragmentPolygon.outer : [];
            for (let i = 0; i < fragmentOuter.length; i++) {
                const point = fragmentOuter[i];
                if (point && floorVisualPolygonsContainPoint([roofPolygon], point.x, point.y)) return true;
            }
            return false;
        }

        roofMatchesBuilding(roof, map, building) {
            if (!roof || !building) return false;
            const refs = this.collectFloorRefsForRenderItem(roof, map);
            if (this.refsMatchBuilding(refs, building)) return true;
            const roofLayer = this.getLayerIndexForRoof(roof, 0);
            const minLevel = this.getLayerIndexFromValue(building.minLevel, 0);
            if (Number.isFinite(roofLayer) && roofLayer < minLevel) return false;
            const roofPolygon = this.getRoofBuildingFootprintPolygon(roof);
            if (!roofPolygon) return false;
            const fragments = this.getBuildingFragments(map, building);
            for (let i = 0; i < fragments.length; i++) {
                if (this.roofFootprintOverlapsFloorFragment(roofPolygon, fragments[i])) return true;
            }
            return false;
        }

        getRoofsForBuilding(ctx, map, building) {
            const roofs = this.getRoofsList(ctx);
            if (!Array.isArray(roofs) || roofs.length === 0) return [];
            return roofs.filter(roof => {
                if (!roof || roof.gone || roof.vanishing) return false;
                return this.roofMatchesBuilding(roof, map, building);
            });
        }

        getRoofOcclusionSignature(roof) {
            if (!roof) return "";
            const parts = [
                Number.isFinite(roof.z) ? Number(roof.z) : "",
                Number.isFinite(roof.heightFromGround) ? Number(roof.heightFromGround) : "",
                Number.isFinite(roof.x) ? Number(roof.x) : "",
                Number.isFinite(roof.y) ? Number(roof.y) : "",
                Array.isArray(roof.wallLoopSectionIds) ? roof.wallLoopSectionIds.join(",") : ""
            ];
            const vertices = Array.isArray(roof.vertices) ? roof.vertices : [];
            for (let i = 0; i < vertices.length; i++) {
                const v = vertices[i];
                parts.push(
                    Math.round((Number(v && v.x) || 0) * 1000),
                    Math.round((Number(v && v.y) || 0) * 1000),
                    Math.round((Number(v && v.z) || 0) * 1000)
                );
            }
            const faces = Array.isArray(roof.faces) ? roof.faces : [];
            for (let i = 0; i < faces.length; i++) {
                parts.push(Array.isArray(faces[i]) ? faces[i].join(".") : "");
            }
            return parts.join("|");
        }

        getBuildingRoofSignature(roofs) {
            if (!Array.isArray(roofs) || roofs.length === 0) return "";
            return roofs.map(roof => this.getRoofOcclusionSignature(roof)).sort().join("::");
        }

        collectRoofOcclusionPolygons(roof, layerPointsByLevel) {
            if (!roof || !Array.isArray(roof.vertices) || roof.vertices.length < 3) return [];
            const polygons = [];
            const baseZ = Number.isFinite(roof.z)
                ? Number(roof.z)
                : (Number.isFinite(roof.heightFromGround) ? Number(roof.heightFromGround) : 0);
            const roofLayer = Math.floor((Number(baseZ) || 0) / FLOOR_LAYER_DEFAULT_HEIGHT_UNITS);
            const projectedVertices = roof.vertices.map(vertex => {
                const worldX = Number(roof.x) + (Number(vertex && vertex.x) || 0);
                const worldY = Number(roof.y) + (Number(vertex && vertex.y) || 0);
                const worldZ = baseZ + (Number(vertex && vertex.z) || 0);
                return this.projectWorldPointToCutawayPlane(worldX, worldY, worldZ);
            });
            const validLayerPoints = projectedVertices.filter(Boolean);
            if (validLayerPoints.length >= 3) {
                if (!layerPointsByLevel.has(roofLayer)) layerPointsByLevel.set(roofLayer, []);
                layerPointsByLevel.get(roofLayer).push(...validLayerPoints);
            }
            const faces = Array.isArray(roof.faces) ? roof.faces : [];
            for (let i = 0; i < faces.length; i++) {
                const face = faces[i];
                if (!Array.isArray(face) || face.length < 3) continue;
                const polygon = [];
                for (let j = 0; j < face.length; j++) {
                    const idx = Math.floor(Number(face[j]));
                    const point = Number.isInteger(idx) ? projectedVertices[idx] : null;
                    if (point) polygon.push(point);
                }
                if (polygon.length >= 3) polygons.push(polygon);
            }
            if (polygons.length === 0 && validLayerPoints.length >= 3) {
                polygons.push(validLayerPoints);
            }
            return polygons;
        }

        getCutawayPolygonBounds(polygons) {
            const list = Array.isArray(polygons) ? polygons : [];
            let minX = Infinity;
            let minY = Infinity;
            let maxX = -Infinity;
            let maxY = -Infinity;
            for (let i = 0; i < list.length; i++) {
                const outer = list[i] && Array.isArray(list[i].outer) ? list[i].outer : [];
                for (let p = 0; p < outer.length; p++) {
                    const x = Number(outer[p] && outer[p].x);
                    const y = Number(outer[p] && outer[p].y);
                    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
                    minX = Math.min(minX, x);
                    minY = Math.min(minY, y);
                    maxX = Math.max(maxX, x);
                    maxY = Math.max(maxY, y);
                }
            }
            if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) return null;
            return { minX, minY, maxX, maxY };
        }

        isCutawayPointInsideBounds(point, bounds) {
            if (!point || !bounds) return false;
            return point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY;
        }

        isCutawayPointNearBounds(point, bounds, distance = 0) {
            if (!point || !bounds) return false;
            const d = Math.max(0, Number(distance) || 0);
            return point.x >= bounds.minX - d &&
                point.x <= bounds.maxX + d &&
                point.y >= bounds.minY - d &&
                point.y <= bounds.maxY + d;
        }

        getBuildingCutawayEntryAlpha(buildingId, nowMs) {
            if (!(this.buildingCutawayEntryTransitions instanceof Map)) {
                this.buildingCutawayEntryTransitions = new Map();
            }
            const key = typeof buildingId === "string" && buildingId.length > 0 ? buildingId : "building";
            const currentMs = Number.isFinite(nowMs) ? Number(nowMs) : Date.now();
            const minAlpha = Math.max(0, Math.min(1, Number(BUILDING_CUTAWAY_GHOST_ALPHA) || 0.1));
            const durationMs = Math.max(1, Number(BUILDING_CUTAWAY_ENTRY_FADE_MS) || 500);
            let transition = this.buildingCutawayEntryTransitions.get(key);
            if (!transition || !Number.isFinite(transition.enteredAtMs)) {
                transition = { enteredAtMs: currentMs };
                this.buildingCutawayEntryTransitions.set(key, transition);
            }
            const progress = Math.max(0, Math.min(1, (currentMs - transition.enteredAtMs) / durationMs));
            if (progress <= 0) return 1;
            if (progress >= 1) return minAlpha;
            return 1 - ((1 - minAlpha) * progress);
        }

        clearBuildingCutawayEntryTransition(buildingId) {
            if (!(this.buildingCutawayEntryTransitions instanceof Map)) return;
            const key = typeof buildingId === "string" && buildingId.length > 0 ? buildingId : "building";
            this.buildingCutawayEntryTransitions.delete(key);
        }

        buildBuildingOcclusionPolygons(ctx, map, building, roofs = null) {
            const fragments = this.getBuildingFragments(map, building);
            if (fragments.length === 0) return [];
            const polygons = [];
            const layerPointsByLevel = new Map();
            const addLayerPoints = (level, points) => {
                if (!Array.isArray(points) || points.length < 3) return;
                if (!layerPointsByLevel.has(level)) layerPointsByLevel.set(level, []);
                layerPointsByLevel.get(level).push(...points);
            };
            const addProjectedFloor = (fragment, baseZ, levelForSide = null) => {
                const outer = Array.isArray(fragment.visibilityPolygon) && fragment.visibilityPolygon.length >= 3
                    ? fragment.visibilityPolygon
                    : fragment.outerPolygon;
                const projected = this.projectWorldRingToCutawayPlane(outer, baseZ);
                if (projected.length < 3) return;
                polygons.push(projected);
                if (Number.isFinite(levelForSide)) addLayerPoints(levelForSide, projected);
            };

            let minLevel = Infinity;
            for (let i = 0; i < fragments.length; i++) {
                const level = this.getLayerIndexFromValue(fragments[i].level, 0);
                minLevel = Math.min(minLevel, level);
                const baseZ = Number.isFinite(fragments[i].nodeBaseZ)
                    ? Number(fragments[i].nodeBaseZ)
                    : this.getLayerBaseZForLevel(level);
                addProjectedFloor(fragments[i], baseZ, level);
            }

            for (let i = 0; i < fragments.length; i++) {
                const fragment = fragments[i];
                const level = this.getLayerIndexFromValue(fragment.level, 0);
                if (level === minLevel) addProjectedFloor(fragment, this.getLayerBaseZForLevel(0), 0);
                if (!this.floorFragmentOverlapsAnyAbove(map, fragment, fragments)) {
                    const baseZ = Number.isFinite(fragment.nodeBaseZ)
                        ? Number(fragment.nodeBaseZ) + FLOOR_LAYER_DEFAULT_HEIGHT_UNITS
                        : this.getLayerBaseZForLevel(level + 1);
                    addProjectedFloor(fragment, baseZ, null);
                }
            }

            const buildingRoofs = Array.isArray(roofs) ? roofs : this.getRoofsForBuilding(ctx, map, building);
            for (let i = 0; i < buildingRoofs.length; i++) {
                polygons.push(...this.collectRoofOcclusionPolygons(buildingRoofs[i], layerPointsByLevel));
            }

            const levels = Array.from(layerPointsByLevel.keys()).sort((a, b) => a - b);
            if (levels.length >= 2) {
                const left = [];
                const right = [];
                for (let i = 0; i < levels.length; i++) {
                    const points = layerPointsByLevel.get(levels[i]) || [];
                    if (points.length === 0) continue;
                    let leftPoint = points[0];
                    let rightPoint = points[0];
                    for (let p = 1; p < points.length; p++) {
                        if (points[p].x < leftPoint.x) leftPoint = points[p];
                        if (points[p].x > rightPoint.x) rightPoint = points[p];
                    }
                    left.push(leftPoint);
                    right.push(rightPoint);
                }
                const silhouette = left.concat(right.reverse());
                if (silhouette.length >= 3) polygons.push(silhouette);
            }

            return unionFloorVisualPolygons(polygons);
        }

        getBuildingOcclusionPolygons(ctx, map, building) {
            if (!building) return [];
            const cache = this.getCompiledBuildingRenderCache(ctx, map, building);
            return cache && Array.isArray(cache.occlusionPolygons) ? cache.occlusionPolygons : [];
        }

        getLayerCutawayState(ctx) {
            if (ctx && ctx._renderingLayerCutawayState) return ctx._renderingLayerCutawayState;
            const diagnosticsEnabled = !!this.currentFrameMetrics;
            const cutawayStartMs = diagnosticsEnabled ? performance.now() : 0;
            let buildingsScanned = 0;
            let buildingBoundsTests = 0;
            let buildingPointTests = 0;
            let buildingTriggers = 0;
            let floorFallbackScanned = 0;
            const finish = (state) => {
                if (ctx && typeof ctx === "object") ctx._renderingLayerCutawayState = state;
                if (diagnosticsEnabled) {
                    this.setFrameMetric("layerCutawayStateMs", performance.now() - cutawayStartMs);
                    this.setFrameMetric("layerCutawayBuildingsScanned", buildingsScanned);
                    this.setFrameMetric("layerCutawayBuildingBoundsTests", buildingBoundsTests);
                    this.setFrameMetric("layerCutawayBuildingPointTests", buildingPointTests);
                    this.setFrameMetric("layerCutawayBuildingTriggers", buildingTriggers);
                    this.setFrameMetric("layerCutawayFloorFallbackScanned", floorFallbackScanned);
                }
                return state;
            };
            const map = ctx && ctx.map ? ctx.map : global.map || null;
            const wizard = (ctx && ctx.wizard) || global.wizard || null;
            if (!(map && map.floorsById instanceof Map) || !wizard) {
                return finish({ active: false, triggers: [], hiddenFromLevel: Infinity, hiddenSurfaceIds: new Set() });
            }
            const wizardLayer = this.getLayerIndexFromValue(
                Number.isFinite(wizard.currentLayer) ? wizard.currentLayer : wizard.traversalLayer,
                0
            );
            const wizardPos = this.resolveInterpolatedItemWorldPosition(wizard, map);
            const x = Number(wizardPos && wizardPos.x);
            const y = Number(wizardPos && wizardPos.y);
            if (!Number.isFinite(x) || !Number.isFinite(y)) {
                return finish({ active: false, triggers: [], hiddenFromLevel: Infinity, hiddenSurfaceIds: new Set() });
            }
            const wizardBaseZ = Number.isFinite(wizard.currentLayerBaseZ)
                ? Number(wizard.currentLayerBaseZ)
                : this.getLayerBaseZForLevel(wizardLayer);
            const nowMs = Number.isFinite(ctx && ctx.renderNowMs)
                ? Number(ctx.renderNowMs)
                : Date.now();

            if (wizardLayer < 0) {
                return finish({
                    active: true,
                    wizardLayer,
                    wizardBaseZ,
                    wizardX: x,
                    wizardY: y,
                    triggers: [],
                    hiddenFromLevel: 0,
                    globalHiddenFromLevel: 0,
                    hiddenSurfaceIds: new Set(),
                    hiddenFragmentIds: new Set()
                });
            }

            const triggers = [];
            const hiddenSurfaceIds = new Set();
            const hiddenFragmentIds = new Set();
            let hiddenFromLevel = Infinity;
            if (typeof map.ensureFloorBuildings === "function") {
                const buildings = map.ensureFloorBuildings();
                const wizardProjection = this.projectWorldPointToCutawayPlane(x, y, wizardBaseZ);
                if (wizardProjection && buildings instanceof Map) {
                    for (const building of buildings.values()) {
                        buildingsScanned += 1;
                        if (!building) continue;
                        const renderCache = this.getCompiledBuildingRenderCache(ctx, map, building);
                        if (!renderCache) continue;
                        const occlusionPolygons = renderCache.occlusionPolygons;
                        const groundProjectionPolygons = renderCache.groundProjectionPolygons;
                        buildingBoundsTests += 1;
                        if (!this.isCutawayPointInsideBounds(wizardProjection, renderCache.occlusionBounds)) {
                            this.clearBuildingCutawayEntryTransition(building.buildingId);
                            continue;
                        }
                        buildingPointTests += 1;
                        if (!floorVisualPolygonsContainPoint(occlusionPolygons, wizardProjection.x, wizardProjection.y)) {
                            this.clearBuildingCutawayEntryTransition(building.buildingId);
                            continue;
                        }
                        const buildingAlpha = this.getBuildingCutawayEntryAlpha(building.buildingId, nowMs);
                        const activeInteriorRegion = this.getBuildingInteriorRegionAtPoint(renderCache, x, y, wizardLayer);
                        const visibleThroughLevel = activeInteriorRegion
                            ? this.getLayerIndexFromValue(activeInteriorRegion.level, 0)
                            : null;
                        const triggerLevel = activeInteriorRegion
                            ? (activeInteriorRegion.kind === "groundFootprint"
                                ? this.getLayerIndexFromValue(building.minLevel, 0)
                                : this.getLayerIndexFromValue(visibleThroughLevel + 1, building.minLevel))
                            : this.getLayerIndexFromValue(building.minLevel, 0);
                        const trigger = {
                            level: triggerLevel,
                            baseZ: this.getLayerBaseZForLevel(triggerLevel),
                            buildingId: building.buildingId,
                            building,
                            renderCache,
                            distanceToOcclusion: 0,
                            alpha: buildingAlpha,
                            visibleThroughLevel: Number.isFinite(visibleThroughLevel) ? visibleThroughLevel : null,
                            activeInteriorRegion,
                            activeInteriorRegionId: activeInteriorRegion && typeof activeInteriorRegion.id === "string"
                                ? activeInteriorRegion.id
                                : "",
                            visibleThroughPolygons: activeInteriorRegion && activeInteriorRegion.kind === "groundFootprint"
                                ? [activeInteriorRegion.polygon]
                                : null,
                            groundProjectionPolygons,
                            fragmentIds: renderCache.fragmentIds,
                            surfaceIds: renderCache.surfaceIds,
                            occlusionPolygons
                        };
                        triggers.push(trigger);
                        buildingTriggers += 1;
                        hiddenFromLevel = Math.min(hiddenFromLevel, trigger.level);
                        for (const surfaceId of trigger.surfaceIds) hiddenSurfaceIds.add(surfaceId);
                        for (const fragmentId of trigger.fragmentIds) hiddenFragmentIds.add(fragmentId);
                    }
                }
            }

            if (triggers.length > 0) {
                return finish({
                    active: true,
                    wizardLayer,
                    wizardBaseZ,
                    wizardX: x,
                    wizardY: y,
                    triggers,
                    hiddenFromLevel,
                    hiddenSurfaceIds,
                    hiddenFragmentIds
                });
            }

            for (const fragment of map.floorsById.values()) {
                floorFallbackScanned += 1;
                if (!fragment) continue;
                const level = this.getLayerIndexFromValue(fragment.level, 0);
                if (level <= wizardLayer) continue;
                const fragmentBaseZ = Number.isFinite(fragment.nodeBaseZ)
                    ? Number(fragment.nodeBaseZ)
                    : this.getLayerBaseZForLevel(level);
                const projectedY = y + (fragmentBaseZ - wizardBaseZ);
                if (!isPointInsideFloorVisibilityFragment(fragment, x, projectedY)) continue;
                const trigger = {
                    level,
                    baseZ: fragmentBaseZ,
                    surfaceId: typeof fragment.surfaceId === "string" ? fragment.surfaceId : "",
                    fragmentId: typeof fragment.fragmentId === "string" ? fragment.fragmentId : "",
                    fragment
                };
                triggers.push(trigger);
                hiddenFromLevel = Math.min(hiddenFromLevel, level);
                if (trigger.surfaceId) hiddenSurfaceIds.add(trigger.surfaceId);
                if (trigger.fragmentId) hiddenFragmentIds.add(trigger.fragmentId);
            }

            return finish({
                active: triggers.length > 0,
                wizardLayer,
                wizardBaseZ,
                wizardX: x,
                wizardY: y,
                triggers,
                hiddenFromLevel,
                hiddenSurfaceIds,
                hiddenFragmentIds
            });
        }

        floorFragmentMatchesCutawayTrigger(fragment, trigger) {
            if (!fragment || !trigger) return false;
            const fragmentId = typeof fragment.fragmentId === "string" ? fragment.fragmentId : "";
            const surfaceId = typeof fragment.surfaceId === "string" ? fragment.surfaceId : "";
            if (fragmentId && trigger.fragmentIds instanceof Set && trigger.fragmentIds.has(fragmentId)) return true;
            if (surfaceId && trigger.surfaceIds instanceof Set && trigger.surfaceIds.has(surfaceId)) return true;
            if (fragment.buildingId && trigger.buildingId && fragment.buildingId === trigger.buildingId) return true;
            const triggerFragmentId = typeof trigger.fragmentId === "string" ? trigger.fragmentId : "";
            const triggerSurfaceId = typeof trigger.surfaceId === "string" ? trigger.surfaceId : "";
            if (fragmentId && triggerFragmentId && fragmentId === triggerFragmentId) return true;
            if (surfaceId && triggerSurfaceId && surfaceId === triggerSurfaceId) return true;
            return false;
        }

        getFloorFragmentCutawayAlpha(fragment, cutawayState = null) {
            const state = cutawayState || this.getLayerCutawayState(null);
            if (!state || !state.active || !fragment) return 1;
            const level = this.getLayerIndexFromValue(fragment.level, 0);
            if (Number.isFinite(state.globalHiddenFromLevel) && level >= state.globalHiddenFromLevel) return 0;
            const triggers = Array.isArray(state.triggers) ? state.triggers : [];
            for (let i = 0; i < triggers.length; i++) {
                const trigger = triggers[i];
                if (!trigger || level < this.getLayerIndexFromValue(trigger.level, Infinity)) continue;
                if (this.floorFragmentMatchesCutawayTrigger(fragment, trigger)) {
                    return trigger.building
                        ? (Number.isFinite(trigger.alpha) ? Math.max(0, Math.min(1, Number(trigger.alpha))) : BUILDING_CUTAWAY_GHOST_ALPHA)
                        : 0;
                }
            }
            return 1;
        }

        isFloorFragmentHiddenByLayerCutaway(fragment, cutawayState = null) {
            return this.getFloorFragmentCutawayAlpha(fragment, cutawayState) <= 0.001;
        }

        getBuildingCutawayAlphaForItem(_item) {
            return 1;
        }

        getBuildingCutawayCompositeAlphaForItem(item) {
            if (
                item &&
                item._cutawayCompositeFrame === this._layerCutawayFrameId &&
                Number.isFinite(item._cutawayCompositeAlpha)
            ) {
                return Math.max(0, Math.min(1, Number(item._cutawayCompositeAlpha)));
            }
            return 1;
        }

        getBuildingCutawayCompositeAlpha(cutawayState = null) {
            const state = cutawayState || this.getLayerCutawayState(null);
            const triggers = Array.isArray(state && state.triggers) ? state.triggers : [];
            let alpha = 1;
            let found = false;
            for (let i = 0; i < triggers.length; i++) {
                const trigger = triggers[i];
                if (!trigger || !trigger.building) continue;
                if (trigger.activeInteriorRegion) return BUILDING_CUTAWAY_INTERIOR_ALPHA;
                const triggerAlpha = Number.isFinite(trigger.alpha)
                    ? Math.max(0, Math.min(1, Number(trigger.alpha)))
                    : BUILDING_CUTAWAY_GHOST_ALPHA;
                alpha = Math.min(alpha, triggerAlpha);
                found = true;
            }
            return found ? alpha : 1;
        }

        getFloorFragmentBuildingCutawayTrigger(fragment, cutawayState = null) {
            const state = cutawayState || this.getLayerCutawayState(null);
            if (!state || !state.active || !fragment) return null;
            if (Number.isFinite(state.globalHiddenFromLevel)) return null;
            const level = this.getLayerIndexFromValue(fragment.level, 0);
            const triggers = Array.isArray(state.triggers) ? state.triggers : [];
            for (let i = 0; i < triggers.length; i++) {
                const trigger = triggers[i];
                if (!trigger || !trigger.building) continue;
                if (!trigger.activeInteriorRegion && level < this.getLayerIndexFromValue(trigger.level, Infinity)) continue;
                if (this.floorFragmentMatchesCutawayTrigger(fragment, trigger)) return trigger;
            }
            return null;
        }

        isBuildingCutawayDoorItem(item) {
            if (!item) return false;
            const type = typeof item.type === "string" ? item.type.trim().toLowerCase() : "";
            const category = typeof item.category === "string" ? item.category.trim().toLowerCase() : "";
            return type === "door" || category === "doors";
        }

        isBuildingFrameOnlyCutawayState(state) {
            if (!state || !state.active || state._buildingFrameFlagsApplied !== true) return false;
            const triggers = Array.isArray(state.triggers) ? state.triggers : [];
            if (triggers.length === 0) return false;
            for (let i = 0; i < triggers.length; i++) {
                const trigger = triggers[i];
                if (!trigger || !trigger.building) return false;
            }
            return true;
        }

        isWorldPointHiddenByLayerCutaway(x, y, level, cutawayState = null, pointBaseZ = null) {
            const state = cutawayState || this.getLayerCutawayState(null);
            if (!state || !state.active) return false;
            const itemLevel = this.getLayerIndexFromValue(level, 0);
            if (Number.isFinite(state.globalHiddenFromLevel) && itemLevel >= state.globalHiddenFromLevel) return true;
            this.incrementFrameMetric("layerCutawayWorldPointTests", 1);
            if (this.isBuildingFrameOnlyCutawayState(state)) {
                this.incrementFrameMetric("layerCutawayWorldPointFastPath", 1);
                return false;
            }
            if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
            const sourceBaseZ = Number.isFinite(pointBaseZ)
                ? Number(pointBaseZ)
                : this.getLayerBaseZForLevel(itemLevel);
            const triggers = Array.isArray(state.triggers) ? state.triggers : [];
            for (let i = 0; i < triggers.length; i++) {
                const trigger = triggers[i];
                if (!trigger || itemLevel < this.getLayerIndexFromValue(trigger.level, Infinity)) continue;
                const triggerBaseZ = Number.isFinite(trigger.baseZ)
                    ? Number(trigger.baseZ)
                    : this.getLayerBaseZForLevel(trigger.level);
                if (trigger.fragment && isPointInsideFloorVisibilityFragment(trigger.fragment, x, y + (triggerBaseZ - sourceBaseZ))) return true;
                if (Array.isArray(trigger.occlusionPolygons)) {
                    const projected = this.projectWorldPointToCutawayPlane(x, y, sourceBaseZ);
                    const bounds = trigger.building && trigger.building.occlusionBounds ? trigger.building.occlusionBounds : null;
                    if (
                        projected &&
                        (!bounds || this.isCutawayPointInsideBounds(projected, bounds)) &&
                        floorVisualPolygonsContainPoint(trigger.occlusionPolygons, projected.x, projected.y)
                    ) return true;
                }
            }
            return false;
        }

        collectFloorRefsForRenderItem(item, mapRef = null) {
            const refs = [];
            const seen = new Set();
            const pushRef = (source) => {
                if (!source || typeof source !== "object") return;
                const fragmentId = typeof source.fragmentId === "string" ? source.fragmentId : "";
                const surfaceId = typeof source.surfaceId === "string" ? source.surfaceId : "";
                if (!fragmentId && !surfaceId) return;
                const key = `${surfaceId}|${fragmentId}`;
                if (seen.has(key)) return;
                seen.add(key);
                refs.push({ surfaceId, fragmentId });
            };
            const pushNode = (node) => {
                pushRef(node);
                if (node && node.sourceNode) pushRef(node.sourceNode);
            };
            const pushEndpoint = (endpoint) => {
                pushNode(endpoint);
                if (endpoint && endpoint.nodeA) pushNode(endpoint.nodeA);
                if (endpoint && endpoint.nodeB) pushNode(endpoint.nodeB);
            };

            pushRef(item);
            pushNode(item && item.node);
            if (Array.isArray(item && item._indexedNodes)) {
                item._indexedNodes.forEach(pushNode);
            }
            if (Array.isArray(item && item.nodes)) {
                item.nodes.forEach(pushNode);
            }
            if (Array.isArray(item && item.wallSections)) {
                item.wallSections.forEach(section => {
                    const sectionRefs = this.collectFloorRefsForRenderItem(section, mapRef);
                    for (let i = 0; i < sectionRefs.length; i++) pushRef(sectionRefs[i]);
                });
            }
            if (Array.isArray(item && item.wallLoopSectionIds)) {
                const wallCtor = global.WallSectionUnit;
                const allSections = wallCtor && wallCtor._allSections instanceof Map ? wallCtor._allSections : null;
                if (allSections) {
                    item.wallLoopSectionIds.forEach(id => {
                        const section = Number.isInteger(id) ? allSections.get(Number(id)) : null;
                        const sectionRefs = this.collectFloorRefsForRenderItem(section, mapRef);
                        for (let i = 0; i < sectionRefs.length; i++) pushRef(sectionRefs[i]);
                    });
                }
            }
            pushEndpoint(item && item.startPoint);
            pushEndpoint(item && item.endPoint);

            const mountedSection = this.resolveMountedWallSectionForItem(item);
            if (mountedSection && mountedSection !== item) {
                const mountedRefs = this.collectFloorRefsForRenderItem(mountedSection, mapRef);
                for (let i = 0; i < mountedRefs.length; i++) pushRef(mountedRefs[i]);
            }

            return refs;
        }

        renderItemMatchesCutawayTrigger(item, trigger, mapRef = null) {
            if (!item || !trigger) return false;
            const refs = this.collectFloorRefsForRenderItem(item, mapRef);
            for (let i = 0; i < refs.length; i++) {
                const ref = refs[i];
                if (!ref) continue;
                if (ref.fragmentId && trigger.fragmentIds instanceof Set && trigger.fragmentIds.has(ref.fragmentId)) return true;
                if (ref.surfaceId && trigger.surfaceIds instanceof Set && trigger.surfaceIds.has(ref.surfaceId)) return true;
                if (ref.fragmentId && trigger.fragmentId && ref.fragmentId === trigger.fragmentId) return true;
                if (ref.surfaceId && trigger.surfaceId && ref.surfaceId === trigger.surfaceId) return true;
            }
            return false;
        }

        renderItemMatchesCutawayVisibleThroughArea(item, trigger, mapRef = null) {
            const polygons = Array.isArray(trigger && trigger.visibleThroughPolygons)
                ? trigger.visibleThroughPolygons
                : [];
            if (polygons.length === 0) return false;
            return this.renderItemSamplesMatchPolygons(item, polygons, mapRef || global.map || null);
        }

        renderItemMatchesCutawayGroundProjection(item, trigger, mapRef = null) {
            const polygons = Array.isArray(trigger && trigger.groundProjectionPolygons)
                ? trigger.groundProjectionPolygons
                : [];
            if (polygons.length === 0) return false;
            return this.renderItemSamplesMatchPolygons(item, polygons, mapRef || global.map || null);
        }

        renderItemSamplesMatchPolygons(item, polygons, mapRef = null) {
            if (!Array.isArray(polygons) || polygons.length === 0) return false;
            const samples = this.getCutawaySamplePointsForRenderItem(item, mapRef || global.map || null);
            for (let i = 0; i < samples.length; i++) {
                const sample = samples[i];
                if (sample && floorVisualPolygonsContainPoint(polygons, sample.x, sample.y)) return true;
            }
            return false;
        }

        getCutawaySamplePointsForRenderItem(item, mapRef = null) {
            const points = [];
            const pushPoint = (x, y) => {
                if (!Number.isFinite(x) || !Number.isFinite(y)) return;
                points.push({ x: Number(x), y: Number(y) });
            };
            if (item && item.type === "wallSection") {
                const sx = Number(item.startPoint && item.startPoint.x);
                const sy = Number(item.startPoint && item.startPoint.y);
                const ex = Number(item.endPoint && item.endPoint.x);
                const ey = Number(item.endPoint && item.endPoint.y);
                pushPoint(sx, sy);
                pushPoint(ex, ey);
                if (Number.isFinite(sx) && Number.isFinite(sy) && Number.isFinite(ex) && Number.isFinite(ey)) {
                    let cx = sx + ((ex - sx) * 0.5);
                    let cy = sy + ((ey - sy) * 0.5);
                    if (mapRef && typeof mapRef.shortestDeltaX === "function") cx = sx + (mapRef.shortestDeltaX(sx, ex) * 0.5);
                    if (mapRef && typeof mapRef.shortestDeltaY === "function") cy = sy + (mapRef.shortestDeltaY(sy, ey) * 0.5);
                    if (mapRef && typeof mapRef.wrapWorldX === "function") cx = mapRef.wrapWorldX(cx);
                    if (mapRef && typeof mapRef.wrapWorldY === "function") cy = mapRef.wrapWorldY(cy);
                    pushPoint(cx, cy);
                }
            }
            const pos = this.resolveInterpolatedItemWorldPosition(item, mapRef || global.map || null);
            if (pos) pushPoint(Number(pos.x), Number(pos.y));
            return points;
        }

        isRenderItemHiddenByLayerCutaway(item, level, cutawayState = null, mapRef = null) {
            if (!item || item === global.wizard) return false;
            const state = cutawayState || this.getLayerCutawayState(null);
            if (!state || !state.active) return false;
            if (item._cutawayHiddenFrame === this._layerCutawayFrameId) return true;
            const itemLevel = this.getLayerIndexFromValue(level, 0);
            if (Number.isFinite(state.globalHiddenFromLevel) && itemLevel >= state.globalHiddenFromLevel) return true;
            this.incrementFrameMetric("layerCutawayRenderItemTests", 1);
            if (this.isBuildingFrameOnlyCutawayState(state)) {
                this.incrementFrameMetric("layerCutawayRenderItemFastPath", 1);
                return false;
            }
            const currentBuildingCacheKey = mapRef
                ? this.getBuildingRenderCacheKey(null, mapRef)
                : null;
            if (
                state._buildingFrameFlagsApplied === true &&
                item._buildingRenderCacheKey &&
                (!currentBuildingCacheKey || item._buildingRenderCacheKey === currentBuildingCacheKey) &&
                item._cutawayHiddenFrame !== this._layerCutawayFrameId
            ) {
                return false;
            }
            const refs = this.collectFloorRefsForRenderItem(item, mapRef || global.map || null);
            const triggers = Array.isArray(state.triggers) ? state.triggers : [];
            for (let i = 0; i < triggers.length; i++) {
                const trigger = triggers[i];
                if (!trigger || itemLevel < this.getLayerIndexFromValue(trigger.level, Infinity)) continue;
                if (refs.length > 0 && this.renderItemMatchesCutawayTrigger(item, trigger, mapRef || global.map || null)) {
                    if (trigger.building) continue;
                    return true;
                }
            }
            if (refs.length > 0) return false;
            const sourceBaseZ = this.isCharacterRenderItem(item)
                ? 0
                : (item && item.type === "wallSection" && Number.isFinite(item.bottomZ)
                    ? Number(item.bottomZ)
                    : this.getLayerBaseZForLevel(itemLevel));
            const samples = this.getCutawaySamplePointsForRenderItem(item, mapRef || global.map || null);
            for (let i = 0; i < samples.length; i++) {
                const sample = samples[i];
                if (this.isWorldPointHiddenByLayerCutaway(sample.x, sample.y, itemLevel, state, sourceBaseZ)) return true;
            }
            return false;
        }

        beginLayerCutawayFrame() {
            this._layerCutawayFrameId = (Number(this._layerCutawayFrameId) || 0) + 1;
            this.clearLayerCutawayFrameMarkers();
            return this._layerCutawayFrameId;
        }

        applyBuildingCutawayFrameFlags(ctx, cutawayState, mapRef = null, wizardRef = null) {
            const state = cutawayState || this.getLayerCutawayState(ctx);
            if (!state || !state.active || !Array.isArray(state.triggers)) return;
            const frameId = Number(this._layerCutawayFrameId) || this.beginLayerCutawayFrame();
            const map = mapRef || (ctx && ctx.map) || global.map || null;
            let ghostItemsFlagged = 0;
            for (let i = 0; i < state.triggers.length; i++) {
                const trigger = state.triggers[i];
                if (!trigger || !trigger.building) continue;
                const cache = trigger.renderCache || this.getCompiledBuildingRenderCache(ctx, map, trigger.building);
                if (!cache) continue;
                const triggerLevel = trigger.activeInteriorRegion
                    ? this.getLayerIndexFromValue(trigger.building && trigger.building.minLevel, 0)
                    : this.getLayerIndexFromValue(trigger.level, Infinity);
                const triggerAlpha = Number.isFinite(trigger.alpha)
                    ? Math.max(0, Math.min(1, Number(trigger.alpha)))
                    : BUILDING_CUTAWAY_GHOST_ALPHA;
                const items = Array.isArray(cache.renderItems) ? cache.renderItems : [];
                for (let j = 0; j < items.length; j++) {
                    const entry = items[j];
                    const item = entry && entry.item;
                    if (!item || item.gone || item.vanishing) continue;
                    if (this.isBuildingCutawayDoorItem(item)) continue;
                    const level = this.getLayerIndexFromValue(entry.level, 0);
                    if (level >= triggerLevel) {
                        item._cutawayCompositeFrame = frameId;
                        item._cutawayCompositeAlpha = triggerAlpha;
                        ghostItemsFlagged += 1;
                    }
                }

                const shouldCompositeGroundWalls = !Number.isFinite(trigger.visibleThroughLevel) ||
                    this.getLayerIndexFromValue(trigger.visibleThroughLevel, 0) <= 0;
                if (shouldCompositeGroundWalls) {
                    const groundWalls = Array.isArray(cache.groundProjectionWalls) ? cache.groundProjectionWalls : [];
                    for (let j = 0; j < groundWalls.length; j++) {
                        const wall = groundWalls[j] && groundWalls[j].item;
                        if (!wall || wall.gone || wall.vanishing || this.isBuildingCutawayDoorItem(wall)) continue;
                        wall._cutawayCompositeFrame = frameId;
                        wall._cutawayCompositeAlpha = triggerAlpha;
                        ghostItemsFlagged += 1;
                    }
                }

            }
            this.setFrameMetric("objects3dBuildingGhostItemsFlagged", ghostItemsFlagged);
            this.setFrameMetric("objects3dBuildingHiddenItemsFlagged", ghostItemsFlagged);
            state._buildingFrameFlagsApplied = true;
        }

        prepareLayerCutawayFrame(ctx, mapRef = null, wizardRef = null) {
            const state = this.getLayerCutawayState(ctx);
            const activeDrawFrameId = Number(this._activeDrawFrameId) || 0;
            if (activeDrawFrameId > 0 && this._layerCutawayPreparedDrawFrameId === activeDrawFrameId) {
                return state;
            }
            this.beginLayerCutawayFrame();
            const diagnosticsEnabled = !!this.currentFrameMetrics;
            if (diagnosticsEnabled) {
                this.setFrameMetric("objects3dBuildingGhostItemsFlagged", 0);
                this.setFrameMetric("objects3dBuildingHiddenItemsFlagged", 0);
                this.setFrameMetric("layerCutawayRenderItemTests", 0);
                this.setFrameMetric("layerCutawayRenderItemFastPath", 0);
                this.setFrameMetric("layerCutawayWorldPointTests", 0);
                this.setFrameMetric("layerCutawayWorldPointFastPath", 0);
            }
            const buildingFlagStartMs = diagnosticsEnabled ? performance.now() : 0;
            this.applyBuildingCutawayFrameFlags(ctx, state, mapRef || (ctx && ctx.map) || global.map || null, wizardRef || (ctx && ctx.wizard) || global.wizard || null);
            if (diagnosticsEnabled) {
                this.setFrameMetric("objects3dBuildingFlagMs", performance.now() - buildingFlagStartMs);
            }
            if (activeDrawFrameId > 0) this._layerCutawayPreparedDrawFrameId = activeDrawFrameId;
            return state;
        }

        clearLayerCutawayFrameMarkers() {
            if (!(this._cutawayInteriorOverlayWallSections instanceof Set)) {
                this._cutawayInteriorOverlayWallSections = new Set();
                return;
            }
            this._cutawayInteriorOverlayWallSections.forEach(section => {
                if (section) delete section._cutawayInteriorOverlayFrame;
            });
            this._cutawayInteriorOverlayWallSections.clear();
        }

        getBuildingCutawayGroundMaskPolygons(cutawayState) {
            const state = cutawayState || this.getLayerCutawayState(null);
            if (!state || !state.active || !Array.isArray(state.triggers)) return [];
            const polygons = [];
            for (let i = 0; i < state.triggers.length; i++) {
                const trigger = state.triggers[i];
                if (!trigger || !trigger.building) continue;
                if (Number.isFinite(trigger.visibleThroughLevel)) continue;
                const maskAlpha = 1 - (Number.isFinite(trigger.alpha)
                    ? Math.max(0, Math.min(1, Number(trigger.alpha)))
                    : BUILDING_CUTAWAY_GHOST_ALPHA);
                if (!(maskAlpha > 0.001)) continue;
                const triggerPolygons = Array.isArray(trigger.groundProjectionPolygons)
                    ? trigger.groundProjectionPolygons
                    : [];
                for (let p = 0; p < triggerPolygons.length; p++) {
                    if (triggerPolygons[p]) polygons.push(triggerPolygons[p]);
                }
            }
            return polygons;
        }

        getBuildingCutawayGroundMaskEntries(cutawayState) {
            const state = cutawayState || this.getLayerCutawayState(null);
            if (!state || !state.active || !Array.isArray(state.triggers)) return [];
            const entries = [];
            for (let i = 0; i < state.triggers.length; i++) {
                const trigger = state.triggers[i];
                if (!trigger || !trigger.building) continue;
                if (Number.isFinite(trigger.visibleThroughLevel)) continue;
                const maskAlpha = 1 - (Number.isFinite(trigger.alpha)
                    ? Math.max(0, Math.min(1, Number(trigger.alpha)))
                    : BUILDING_CUTAWAY_GHOST_ALPHA);
                if (!(maskAlpha > 0.001)) continue;
                const triggerPolygons = Array.isArray(trigger.groundProjectionPolygons)
                    ? trigger.groundProjectionPolygons
                    : [];
                for (let p = 0; p < triggerPolygons.length; p++) {
                    if (!triggerPolygons[p]) continue;
                    entries.push({
                        key: `${trigger.buildingId || "building"}:${p}`,
                        buildingId: trigger.buildingId || "",
                        polygon: triggerPolygons[p],
                        alpha: maskAlpha
                    });
                }
            }
            return entries;
        }

        ensureBuildingCutawayGroundMaskGraphics(container) {
            if (!container || typeof PIXI === "undefined" || !PIXI.Graphics) return null;
            if (!this.buildingCutawayGroundMaskGraphics) {
                this.buildingCutawayGroundMaskGraphics = new PIXI.Graphics();
                this.buildingCutawayGroundMaskGraphics.name = "renderingBuildingCutawayGroundMask";
                this.buildingCutawayGroundMaskGraphics.interactive = false;
                this.buildingCutawayGroundMaskGraphics.visible = false;
            }
            const g = this.buildingCutawayGroundMaskGraphics;
            if (g.parent !== container) {
                container.addChild(g);
            }
            if (typeof container.setChildIndex === "function" && Array.isArray(container.children) && container.children.length > 0) {
                container.setChildIndex(g, 0);
            }
            return g;
        }

        clearBuildingCutawayGroundMask() {
            const g = this.buildingCutawayGroundMaskGraphics;
            if (g) {
                if (typeof g.clear === "function") g.clear();
                g.visible = false;
                if (Object.prototype.hasOwnProperty.call(g, "renderable")) {
                    g.renderable = false;
                }
            }
            if (this.buildingCutawayGroundMaskMeshes instanceof Map) {
                for (const entry of this.buildingCutawayGroundMaskMeshes.values()) {
                    if (entry && entry.mesh) {
                        entry.mesh.visible = false;
                        if (Object.prototype.hasOwnProperty.call(entry.mesh, "renderable")) entry.mesh.renderable = false;
                    }
                }
            }
        }

        drawBuildingCutawayGroundMaskRing(g, points) {
            const ring = normalizeFloorVisualPointList(points);
            if (!g || !this.camera || ring.length < 3) return false;
            let started = false;
            for (let i = 0; i < ring.length; i++) {
                const screen = this.camera.worldToScreen(ring[i].x, ring[i].y, 0);
                if (!screen || !Number.isFinite(screen.x) || !Number.isFinite(screen.y)) return false;
                if (!started) {
                    g.moveTo(screen.x, screen.y);
                    started = true;
                } else {
                    g.lineTo(screen.x, screen.y);
                }
            }
            if (started) g.closePath();
            return started;
        }

        getBuildingCutawayGroundMaskState() {
            if (this.buildingCutawayGroundMaskState) return this.buildingCutawayGroundMaskState;
            if (typeof PIXI === "undefined" || !PIXI.State) return null;
            const state = new PIXI.State();
            state.depthTest = true;
            state.depthMask = false;
            state.blend = true;
            state.culling = false;
            this.buildingCutawayGroundMaskState = state;
            return state;
        }

        createBuildingCutawayGroundMaskMesh(entry) {
            if (!entry || !entry.triangulation || typeof PIXI === "undefined" || !PIXI.Geometry || !PIXI.Mesh || !PIXI.Shader) {
                return null;
            }
            const vertexData = new Float32Array(entry.triangulation.vertexCount * 2);
            const geometry = new PIXI.Geometry()
                .addAttribute("aWorldPosition", vertexData, 2)
                .addIndex(entry.triangulation.indices);
            const nearMetric = FLOOR_VISUAL_DEPTH_NEAR_METRIC;
            const farMetric = FLOOR_VISUAL_DEPTH_FAR_METRIC;
            const shader = PIXI.Shader.from(LOS_SHADOW_DEPTH_VS, LOS_SHADOW_DEPTH_FS, {
                uScreenSize: new Float32Array([1, 1]),
                uCameraWorld: new Float32Array([0, 0]),
                uCameraZ: 0,
                uBaseZ: 0,
                uDepthBias: FLOOR_VISUAL_HOLE_DEPTH_BIAS_UNITS,
                uViewScale: 1,
                uXyRatio: 1,
                uDepthRange: new Float32Array([farMetric, 1 / Math.max(1e-6, farMetric - nearMetric)]),
                uTint: new Float32Array([0, 0, 0, 1])
            });
            const mesh = new PIXI.Mesh(geometry, shader);
            mesh.name = "buildingCutawayGroundMaskMesh";
            mesh.interactive = false;
            const state = this.getBuildingCutawayGroundMaskState();
            if (state) mesh.state = state;
            return mesh;
        }

        uploadBuildingCutawayGroundMaskGeometry(entry) {
            if (!entry || !entry.mesh || !entry.triangulation) return false;
            const geometry = entry.mesh.geometry || null;
            const buffer = geometry && typeof geometry.getBuffer === "function"
                ? geometry.getBuffer("aWorldPosition")
                : null;
            if (!buffer || !buffer.data) return false;
            const data = buffer.data;
            const points = entry.triangulation.points;
            if (!Array.isArray(points) || data.length < points.length * 2) return false;
            for (let i = 0; i < points.length; i++) {
                const pt = points[i];
                data[i * 2] = Number(pt && pt.x) || 0;
                data[i * 2 + 1] = Number(pt && pt.y) || 0;
            }
            buffer.update();
            entry.uploadedGeometrySignature = entry.signature || "";
            return true;
        }

        updateBuildingCutawayGroundMaskMesh(entry) {
            if (!entry || !entry.mesh) return false;
            const shader = entry.mesh.shader || null;
            const uniforms = shader && shader.uniforms ? shader.uniforms : null;
            if (uniforms) {
                const appRef = (typeof app !== "undefined" && app) ? app : (global.app || null);
                const screenW = (appRef && appRef.screen && Number.isFinite(appRef.screen.width))
                    ? Number(appRef.screen.width)
                    : 1;
                const screenH = (appRef && appRef.screen && Number.isFinite(appRef.screen.height))
                    ? Number(appRef.screen.height)
                    : 1;
                const cam = this.camera || {};
                if (uniforms.uScreenSize) {
                    uniforms.uScreenSize[0] = Math.max(1, screenW);
                    uniforms.uScreenSize[1] = Math.max(1, screenH);
                }
                if (uniforms.uCameraWorld) {
                    uniforms.uCameraWorld[0] = Number(cam.x) || 0;
                    uniforms.uCameraWorld[1] = Number(cam.y) || 0;
                }
                uniforms.uCameraZ = Number(cam.z) || 0;
                uniforms.uBaseZ = 0;
                uniforms.uDepthBias = FLOOR_VISUAL_HOLE_DEPTH_BIAS_UNITS;
                uniforms.uViewScale = Number(cam.viewscale) || 1;
                uniforms.uXyRatio = Number(cam.xyratio) || 1;
                if (uniforms.uDepthRange) {
                    const nearMetric = FLOOR_VISUAL_DEPTH_NEAR_METRIC;
                    const farMetric = FLOOR_VISUAL_DEPTH_FAR_METRIC;
                    uniforms.uDepthRange[0] = farMetric;
                    uniforms.uDepthRange[1] = 1 / Math.max(1e-6, farMetric - nearMetric);
                }
                if (uniforms.uTint) {
                    uniforms.uTint[0] = 0;
                    uniforms.uTint[1] = 0;
                    uniforms.uTint[2] = 0;
                    uniforms.uTint[3] = Number.isFinite(entry.alpha) ? Math.max(0, Math.min(1, Number(entry.alpha))) : 1;
                }
            }
            entry.mesh.alpha = 1;
            entry.mesh.tint = 0xffffff;
            entry.mesh.position.set(0, 0);
            entry.mesh.scale.set(1, 1);
            entry.mesh.visible = true;
            if (Object.prototype.hasOwnProperty.call(entry.mesh, "renderable")) {
                entry.mesh.renderable = true;
            }
            return true;
        }

        renderBuildingCutawayGroundMasks(ctx, cutawayState, container = null) {
            const targetContainer = container || (this.layers && this.layers.objects3d) || null;
            const maskEntries = this.getBuildingCutawayGroundMaskEntries(cutawayState || this.getLayerCutawayState(ctx));
            let maskMeshes = 0;
            let maskVertices = 0;
            let maskTriangles = 0;
            let maskCreated = 0;
            let maskGeometryUploads = 0;
            let maskUniformUpdates = 0;
            let maskAttachOps = 0;
            let maskHiddenMeshes = 0;
            const maskDisabled = !!(
                (typeof globalThis !== "undefined" && globalThis.renderingDisableBuildingCutawayGroundMask === true) ||
                (typeof global !== "undefined" && global.renderingDisableBuildingCutawayGroundMask === true)
            );
            if (maskEntries.length === 0) {
                this.clearBuildingCutawayGroundMask();
                this.setFrameMetric("objects3dBuildingMaskActive", 0);
                this.setFrameMetric("objects3dBuildingMaskEntries", 0);
                this.setFrameMetric("objects3dBuildingMaskMeshes", 0);
                this.setFrameMetric("objects3dBuildingMaskVertices", 0);
                this.setFrameMetric("objects3dBuildingMaskTriangles", 0);
                this.setFrameMetric("objects3dBuildingMaskCreated", 0);
                this.setFrameMetric("objects3dBuildingMaskGeometryUploads", 0);
                this.setFrameMetric("objects3dBuildingMaskUniformUpdates", 0);
                this.setFrameMetric("objects3dBuildingMaskAttachOps", 0);
                this.setFrameMetric("objects3dBuildingMaskHiddenMeshes", 0);
                return [];
            }
            if (maskDisabled) {
                this.clearBuildingCutawayGroundMask();
                this.setFrameMetric("objects3dBuildingMaskActive", 0);
                this.setFrameMetric("objects3dBuildingMaskEntries", maskEntries.length);
                this.setFrameMetric("objects3dBuildingMaskMeshes", 0);
                this.setFrameMetric("objects3dBuildingMaskVertices", 0);
                this.setFrameMetric("objects3dBuildingMaskTriangles", 0);
                this.setFrameMetric("objects3dBuildingMaskCreated", 0);
                this.setFrameMetric("objects3dBuildingMaskGeometryUploads", 0);
                this.setFrameMetric("objects3dBuildingMaskUniformUpdates", 0);
                this.setFrameMetric("objects3dBuildingMaskAttachOps", 0);
                this.setFrameMetric("objects3dBuildingMaskHiddenMeshes", 0);
                return [];
            }
            if (typeof PIXI !== "undefined" && PIXI.Mesh && PIXI.Geometry && PIXI.Shader) {
                if (!(this.buildingCutawayGroundMaskMeshes instanceof Map)) {
                    this.buildingCutawayGroundMaskMeshes = new Map();
                }
                const visibleKeys = new Set();
                const visibleMeshes = [];
                for (let i = 0; i < maskEntries.length; i++) {
                    const source = maskEntries[i];
                    const polygon = source && source.polygon;
                    const outer = normalizeFloorVisualPointList(polygon && polygon.outer);
                    if (outer.length < 3) continue;
                    const holes = Array.isArray(polygon && polygon.holes) ? polygon.holes : [];
                    const signature = buildFloorVisualSignature(outer, holes);
                    const key = source.key || `mask:${i}`;
                    visibleKeys.add(key);
                    let entry = this.buildingCutawayGroundMaskMeshes.get(key);
                    if (!entry || entry.signature !== signature) {
                        if (entry && entry.mesh) {
                            if (entry.mesh.parent) entry.mesh.parent.removeChild(entry.mesh);
                            if (typeof entry.mesh.destroy === "function") {
                                entry.mesh.destroy({ children: false, texture: false, baseTexture: false });
                            }
                        }
                        const triangulation = triangulateFloorVisualPolygon(outer, holes);
                        if (!triangulation) continue;
                        entry = {
                            signature,
                            triangulation,
                            mesh: null,
                            uploadedGeometrySignature: ""
                        };
                        entry.mesh = this.createBuildingCutawayGroundMaskMesh(entry);
                        if (!entry.mesh) continue;
                        if (this.uploadBuildingCutawayGroundMaskGeometry(entry)) {
                            maskGeometryUploads += 1;
                        }
                        maskCreated += 1;
                        this.buildingCutawayGroundMaskMeshes.set(key, entry);
                    }
                    entry.alpha = Number.isFinite(source && source.alpha) ? Math.max(0, Math.min(1, Number(source.alpha))) : 1;
                    if (entry.triangulation) {
                        maskVertices += Number(entry.triangulation.vertexCount) || 0;
                        maskTriangles += entry.triangulation.indices ? Math.floor(entry.triangulation.indices.length / 3) : 0;
                    }
                    if (entry.mesh && entry.mesh.parent !== targetContainer && targetContainer) {
                        targetContainer.addChild(entry.mesh);
                        maskAttachOps += 1;
                        if (typeof targetContainer.setChildIndex === "function" && Array.isArray(targetContainer.children)) {
                            targetContainer.setChildIndex(entry.mesh, Math.min(i, targetContainer.children.length - 1));
                        }
                    }
                    if (this.updateBuildingCutawayGroundMaskMesh(entry)) {
                        maskUniformUpdates += 1;
                    }
                    if (entry.mesh) {
                        entry.mesh.visible = true;
                        if (Object.prototype.hasOwnProperty.call(entry.mesh, "renderable")) entry.mesh.renderable = true;
                        visibleMeshes.push(entry.mesh);
                        maskMeshes += 1;
                    }
                }
                for (const [key, entry] of this.buildingCutawayGroundMaskMeshes.entries()) {
                    if (visibleKeys.has(key)) continue;
                    if (entry && entry.mesh) {
                        entry.mesh.visible = false;
                        if (Object.prototype.hasOwnProperty.call(entry.mesh, "renderable")) entry.mesh.renderable = false;
                        maskHiddenMeshes += 1;
                    }
                }
                this.setFrameMetric("objects3dBuildingMaskActive", visibleMeshes.length > 0 ? 1 : 0);
                this.setFrameMetric("objects3dBuildingMaskEntries", maskEntries.length);
                this.setFrameMetric("objects3dBuildingMaskMeshes", maskMeshes);
                this.setFrameMetric("objects3dBuildingMaskVertices", maskVertices);
                this.setFrameMetric("objects3dBuildingMaskTriangles", maskTriangles);
                this.setFrameMetric("objects3dBuildingMaskCreated", maskCreated);
                this.setFrameMetric("objects3dBuildingMaskGeometryUploads", maskGeometryUploads);
                this.setFrameMetric("objects3dBuildingMaskUniformUpdates", maskUniformUpdates);
                this.setFrameMetric("objects3dBuildingMaskAttachOps", maskAttachOps);
                this.setFrameMetric("objects3dBuildingMaskHiddenMeshes", maskHiddenMeshes);
                return visibleMeshes;
            }
            const g = this.ensureBuildingCutawayGroundMaskGraphics(targetContainer);
            if (!g) return [];
            g.clear();
            let drewAny = false;
            for (let i = 0; i < maskEntries.length; i++) {
                const source = maskEntries[i];
                const polygon = source && source.polygon;
                if (!polygon || !Array.isArray(polygon.outer) || polygon.outer.length < 3) continue;
                const alpha = Number.isFinite(source && source.alpha) ? Math.max(0, Math.min(1, Number(source.alpha))) : 1;
                g.beginFill(0x000000, alpha);
                const drewOuter = this.drawBuildingCutawayGroundMaskRing(g, polygon.outer);
                if (drewOuter) {
                    const holes = Array.isArray(polygon.holes) ? polygon.holes : [];
                    const canDrawHoles = typeof g.beginHole === "function" && typeof g.endHole === "function";
                    if (canDrawHoles) {
                        for (let h = 0; h < holes.length; h++) {
                            g.beginHole();
                            this.drawBuildingCutawayGroundMaskRing(g, holes[h]);
                            g.endHole();
                        }
                    }
                    drewAny = true;
                }
                g.endFill();
            }
            g.visible = drewAny;
            if (Object.prototype.hasOwnProperty.call(g, "renderable")) {
                g.renderable = drewAny;
            }
            this.setFrameMetric("objects3dBuildingMaskActive", drewAny ? 1 : 0);
            this.setFrameMetric("objects3dBuildingMaskEntries", maskEntries.length);
            this.setFrameMetric("objects3dBuildingMaskMeshes", drewAny ? 1 : 0);
            this.setFrameMetric("objects3dBuildingMaskVertices", 0);
            this.setFrameMetric("objects3dBuildingMaskTriangles", 0);
            this.setFrameMetric("objects3dBuildingMaskCreated", 0);
            this.setFrameMetric("objects3dBuildingMaskGeometryUploads", 0);
            this.setFrameMetric("objects3dBuildingMaskUniformUpdates", 0);
            this.setFrameMetric("objects3dBuildingMaskAttachOps", 0);
            this.setFrameMetric("objects3dBuildingMaskHiddenMeshes", 0);
            return drewAny ? [g] : [];
        }

        ensureBuildingCutawayCompositeRenderTexture(ctx, targetWidth = null, targetHeight = null, localBounds = null) {
            if (typeof PIXI === "undefined" || !PIXI.RenderTexture || !PIXI.Sprite || !PIXI.Texture || !PIXI.Rectangle) return null;
            const appRef = (ctx && ctx.app && ctx.app.renderer)
                ? ctx.app
                : ((typeof app !== "undefined" && app && app.renderer) ? app : (global.app || null));
            const renderer = appRef && appRef.renderer ? appRef.renderer : null;
            if (!renderer) return null;
            const screen = appRef.screen || renderer.screen || {};
            const width = Math.max(1, Math.round(Number(targetWidth) || Number(screen.width) || Number(renderer.width) || 1));
            const height = Math.max(1, Math.round(Number(targetHeight) || Number(screen.height) || Number(renderer.height) || 1));
            const sizeKey = `${width}x${height}`;
            if (
                !this.buildingCutawayCompositeRenderTexture ||
                !this.buildingCutawayCompositeSize ||
                this.buildingCutawayCompositeSize.key !== sizeKey
            ) {
                if (this.buildingCutawayCompositeRenderTexture && typeof this.buildingCutawayCompositeRenderTexture.destroy === "function") {
                    this.buildingCutawayCompositeRenderTexture.destroy(true);
                }
                this.buildingCutawayCompositeRenderTexture = PIXI.RenderTexture.create({
                    width,
                    height,
                    resolution: 1
                });
                this.buildingCutawayCompositeSize = { key: sizeKey, width, height };
            }
            const framebuffer = this.buildingCutawayCompositeRenderTexture &&
                this.buildingCutawayCompositeRenderTexture.baseTexture &&
                this.buildingCutawayCompositeRenderTexture.baseTexture.framebuffer
                ? this.buildingCutawayCompositeRenderTexture.baseTexture.framebuffer
                : null;
            if (framebuffer && typeof framebuffer.enableDepth === "function" && framebuffer.depth !== true) {
                framebuffer.enableDepth();
            }
            if (!this.buildingCutawayCompositeSprite) {
                this.buildingCutawayCompositeSprite = new PIXI.Sprite(this.buildingCutawayCompositeRenderTexture);
                this.buildingCutawayCompositeSprite.name = "buildingCutawayCompositeSprite";
                this.buildingCutawayCompositeSprite.interactive = false;
                if (this.buildingCutawayCompositeSprite.anchor) {
                    this.buildingCutawayCompositeSprite.anchor.set(0.5, 1);
                }
            } else if (this.buildingCutawayCompositeSprite.texture !== this.buildingCutawayCompositeRenderTexture) {
                this.buildingCutawayCompositeSprite.texture = this.buildingCutawayCompositeRenderTexture;
            }
            this.buildingCutawayCompositeSprite.position.set(0, 0);
            this.buildingCutawayCompositeSprite.scale.set(1, 1);
            return {
                app: appRef,
                renderer,
                texture: this.buildingCutawayCompositeRenderTexture,
                sprite: this.buildingCutawayCompositeSprite,
                width,
                height,
                localBounds: localBounds || null
            };
        }

        clearBuildingCutawayCompositeRenderTarget(resources) {
            if (!resources || !resources.renderer || !resources.texture) return false;
            const renderer = resources.renderer;
            const framebuffer = resources.texture.baseTexture && resources.texture.baseTexture.framebuffer
                ? resources.texture.baseTexture.framebuffer
                : null;
            const gl = renderer.gl || null;
            if (!gl || !framebuffer || !renderer.framebuffer || typeof renderer.framebuffer.bind !== "function") return false;
            try {
                renderer.framebuffer.bind(framebuffer);
                gl.clearColor(0, 0, 0, 0);
                gl.clearDepth(1);
                gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
                return true;
            } catch (_err) {
                return false;
            }
        }

        ensureRenderTextureDepthAttachment(renderTexture, label = "render texture") {
            const framebuffer = renderTexture && renderTexture.baseTexture && renderTexture.baseTexture.framebuffer
                ? renderTexture.baseTexture.framebuffer
                : (renderTexture && renderTexture.framebuffer ? renderTexture.framebuffer : null);
            if (!framebuffer) {
                throw new Error(`${label} is missing a framebuffer; depth-tested rendering cannot be used.`);
            }
            if (typeof framebuffer.enableDepth === "function") {
                framebuffer.enableDepth();
            } else if (Object.prototype.hasOwnProperty.call(framebuffer, "depth")) {
                framebuffer.depth = true;
            } else {
                throw new Error(`${label} framebuffer does not support a depth attachment.`);
            }
            return framebuffer;
        }

        clearDepthTestedRenderTarget(resources, label = "render target") {
            const cleared = this.clearBuildingCutawayCompositeRenderTarget(resources);
            if (!cleared) {
                throw new Error(`${label} could not be cleared with a depth buffer.`);
            }
            return true;
        }

        getBuildingCutawayCompositeDisplayObjects(cutawayState) {
            const frameId = Number(this._layerCutawayFrameId) || 0;
            const out = new Set();
            const add = (displayObj) => {
                if (!displayObj || !displayObj.parent || displayObj.visible === false) return;
                if (Object.prototype.hasOwnProperty.call(displayObj, "renderable") && displayObj.renderable === false) return;
                out.add(displayObj);
            };
            if (this.floorVisualMeshByKey instanceof Map) {
                for (const entry of this.floorVisualMeshByKey.values()) {
                    const mesh = entry && entry.mesh;
                    if (mesh && mesh._buildingCutawayCompositeFrame === frameId) add(mesh);
                }
            }
            const triggers = Array.isArray(cutawayState && cutawayState.triggers) ? cutawayState.triggers : [];
            for (let i = 0; i < triggers.length; i++) {
                const trigger = triggers[i];
                if (!trigger || !trigger.building) continue;
                const cache = trigger.renderCache || null;
                const items = Array.isArray(cache && cache.renderItems) ? cache.renderItems : [];
                for (let j = 0; j < items.length; j++) {
                    const item = items[j] && items[j].item;
                    if (!item || item._cutawayCompositeFrame !== frameId) continue;
                    add(item._renderingDepthMesh);
                    add(item._compositeUnderlayMesh);
                    add(item._renderingDisplayObject);
                    add(item._flowerBurnFragmentContainer);
                    add(item.pixiSprite);
                    add(item.fireSprite);
                    add(item._doorBottomFaceDebugGraphics);
                    if (item.type === "roof") add(item.pixiMesh);
                }
            }
            return out;
        }

        getBuildingCutawayCompositeWallSelectionDiagnostics(cutawayState, displayObjects) {
            const frameId = Number(this._layerCutawayFrameId) || 0;
            const selected = displayObjects instanceof Set ? displayObjects : new Set();
            const triggers = Array.isArray(cutawayState && cutawayState.triggers) ? cutawayState.triggers : [];
            let expectedWalls = 0;
            let selectedWalls = 0;
            for (let i = 0; i < triggers.length; i++) {
                const trigger = triggers[i];
                if (!trigger || !trigger.building) continue;
                const cache = trigger.renderCache || null;
                const items = Array.isArray(cache && cache.renderItems) ? cache.renderItems : [];
                for (let j = 0; j < items.length; j++) {
                    const item = items[j] && items[j].item;
                    if (!item || item.type !== "wallSection" || item._cutawayCompositeFrame !== frameId) continue;
                    if (item.gone || item.vanishing || this.isBuildingCutawayDoorItem(item)) continue;
                    expectedWalls += 1;
                    if (
                        selected.has(item._renderingDepthMesh) ||
                        selected.has(item._renderingDisplayObject) ||
                        selected.has(item.pixiSprite)
                    ) {
                        selectedWalls += 1;
                    }
                }
            }
            return { expectedWalls, selectedWalls };
        }

        isolateBuildingCutawayCompositeDisplayTree(keepSet) {
            const saved = [];
            const saveVisible = (displayObj, visible) => {
                if (!displayObj || displayObj.visible === visible) return;
                saved.push({ displayObj, visible: displayObj.visible, renderable: displayObj.renderable });
                displayObj.visible = visible;
                if (!visible && Object.prototype.hasOwnProperty.call(displayObj, "renderable")) {
                    displayObj.renderable = false;
                }
            };
            const visit = (displayObj) => {
                if (!displayObj) return false;
                if (keepSet.has(displayObj)) return true;
                const children = Array.isArray(displayObj.children) ? displayObj.children : [];
                let hasKeptChild = false;
                for (let i = 0; i < children.length; i++) {
                    if (visit(children[i])) hasKeptChild = true;
                }
                const keep = hasKeptChild;
                if (!keep) saveVisible(displayObj, false);
                return keep;
            };
            const includeLayers = [
                this.layers && this.layers.depthObjects,
                this.layers && this.layers.groundObjects,
                this.layers && this.layers.objects3d,
                this.layers && this.layers.entities
            ].filter(Boolean);
            const includeSet = new Set(includeLayers);
            const rootChildren = this.layers && this.layers.root && Array.isArray(this.layers.root.children)
                ? this.layers.root.children
                : [];
            for (let i = 0; i < rootChildren.length; i++) {
                const child = rootChildren[i];
                if (!child) continue;
                if (includeSet.has(child)) visit(child);
                else saveVisible(child, false);
            }
            return () => {
                for (let i = saved.length - 1; i >= 0; i--) {
                    const entry = saved[i];
                    if (!entry || !entry.displayObj) continue;
                    entry.displayObj.visible = entry.visible;
                    if (Object.prototype.hasOwnProperty.call(entry.displayObj, "renderable")) {
                        entry.displayObj.renderable = entry.renderable;
                    }
                }
            };
        }

        applyBuildingCutawayCompositeLocalCaptureState(displayObjects, bounds, textureWidth, textureHeight) {
            const displaySet = displayObjects instanceof Set ? displayObjects : new Set();
            const savedAlpha = [];
            const savedUniforms = [];
            const root = this.layers && this.layers.root ? this.layers.root : null;
            const rootPosition = root && root.position ? root.position : null;
            const rootX = rootPosition && Number.isFinite(rootPosition.x) ? rootPosition.x : null;
            const rootY = rootPosition && Number.isFinite(rootPosition.y) ? rootPosition.y : null;
            const offsetX = Number.isFinite(bounds && bounds.x) ? Number(bounds.x) : 0;
            const offsetY = Number.isFinite(bounds && bounds.y) ? Number(bounds.y) : 0;
            const width = Math.max(1, Math.round(Number(textureWidth) || Number(bounds && bounds.width) || 1));
            const height = Math.max(1, Math.round(Number(textureHeight) || Number(bounds && bounds.height) || 1));
            const cam = this.camera || {};
            const viewScale = Math.max(1e-6, Math.abs(Number(cam.viewscale) || 1));
            const xyRatio = Math.max(1e-6, Math.abs(Number(cam.xyratio) || 1));
            const localCameraX = (Number(cam.x) || 0) + offsetX / viewScale;
            const localCameraY = (Number(cam.y) || 0) + offsetY / (viewScale * xyRatio);
            const localCameraZ = Number(cam.z) || 0;

            if (rootPosition && rootX !== null && rootY !== null) {
                rootPosition.x = rootX - offsetX;
                rootPosition.y = rootY - offsetY;
            }

            const visitSeen = new Set();
            const visit = (displayObj) => {
                if (!displayObj || visitSeen.has(displayObj)) return;
                visitSeen.add(displayObj);
                if (typeof displayObj.alpha === "number") {
                    savedAlpha.push({ displayObj, alpha: displayObj.alpha });
                    displayObj.alpha = 1;
                }
                const uniforms = displayObj.shader && displayObj.shader.uniforms ? displayObj.shader.uniforms : null;
                if (uniforms) {
                    const saved = { uniforms };
                    let changed = false;
                    if (uniforms.uScreenSize && uniforms.uScreenSize.length >= 2) {
                        saved.uScreenSize = [uniforms.uScreenSize[0], uniforms.uScreenSize[1]];
                        uniforms.uScreenSize[0] = width;
                        uniforms.uScreenSize[1] = height;
                        changed = true;
                    }
                    if (uniforms.uCameraWorld && uniforms.uCameraWorld.length >= 2) {
                        saved.uCameraWorld = [uniforms.uCameraWorld[0], uniforms.uCameraWorld[1]];
                        uniforms.uCameraWorld[0] = localCameraX;
                        uniforms.uCameraWorld[1] = localCameraY;
                        changed = true;
                    }
                    if (Object.prototype.hasOwnProperty.call(uniforms, "uCameraZ")) {
                        saved.uCameraZ = uniforms.uCameraZ;
                        uniforms.uCameraZ = localCameraZ;
                        changed = true;
                    }
                    if (Object.prototype.hasOwnProperty.call(uniforms, "uViewScale")) {
                        saved.uViewScale = uniforms.uViewScale;
                        uniforms.uViewScale = viewScale;
                        changed = true;
                    }
                    if (Object.prototype.hasOwnProperty.call(uniforms, "uXyRatio")) {
                        saved.uXyRatio = uniforms.uXyRatio;
                        uniforms.uXyRatio = xyRatio;
                        changed = true;
                    }
                    if (uniforms.uTint && uniforms.uTint.length >= 4) {
                        saved.uTint = [uniforms.uTint[0], uniforms.uTint[1], uniforms.uTint[2], uniforms.uTint[3]];
                        uniforms.uTint[3] = 1;
                        changed = true;
                    }
                    if (changed) savedUniforms.push(saved);
                }
                const children = Array.isArray(displayObj.children) ? displayObj.children : [];
                for (let i = 0; i < children.length; i++) visit(children[i]);
            };
            displaySet.forEach(displayObj => visit(displayObj));

            return () => {
                for (let i = savedUniforms.length - 1; i >= 0; i--) {
                    const saved = savedUniforms[i];
                    const uniforms = saved && saved.uniforms;
                    if (!uniforms) continue;
                    if (saved.uScreenSize && uniforms.uScreenSize && uniforms.uScreenSize.length >= 2) {
                        uniforms.uScreenSize[0] = saved.uScreenSize[0];
                        uniforms.uScreenSize[1] = saved.uScreenSize[1];
                    }
                    if (saved.uCameraWorld && uniforms.uCameraWorld && uniforms.uCameraWorld.length >= 2) {
                        uniforms.uCameraWorld[0] = saved.uCameraWorld[0];
                        uniforms.uCameraWorld[1] = saved.uCameraWorld[1];
                    }
                    if (Object.prototype.hasOwnProperty.call(saved, "uCameraZ")) uniforms.uCameraZ = saved.uCameraZ;
                    if (Object.prototype.hasOwnProperty.call(saved, "uViewScale")) uniforms.uViewScale = saved.uViewScale;
                    if (Object.prototype.hasOwnProperty.call(saved, "uXyRatio")) uniforms.uXyRatio = saved.uXyRatio;
                    if (saved.uTint && uniforms.uTint && uniforms.uTint.length >= 4) {
                        uniforms.uTint[0] = saved.uTint[0];
                        uniforms.uTint[1] = saved.uTint[1];
                        uniforms.uTint[2] = saved.uTint[2];
                        uniforms.uTint[3] = saved.uTint[3];
                    }
                }
                for (let i = savedAlpha.length - 1; i >= 0; i--) {
                    const entry = savedAlpha[i];
                    if (entry && entry.displayObj) entry.displayObj.alpha = entry.alpha;
                }
                if (rootPosition && rootX !== null && rootY !== null) {
                    rootPosition.x = rootX;
                    rootPosition.y = rootY;
                }
            };
        }

        hideBuildingCutawayCompositeOriginals(displayObjects) {
            if (!(displayObjects instanceof Set)) return 0;
            let hidden = 0;
            displayObjects.forEach(displayObj => {
                if (!displayObj) return;
                displayObj.visible = false;
                if (Object.prototype.hasOwnProperty.call(displayObj, "renderable")) {
                    displayObj.renderable = false;
                }
                hidden += 1;
            });
            return hidden;
        }

        getBuildingCutawayCompositeScreenSize(ctx = null) {
            const appRef = (ctx && ctx.app && ctx.app.renderer)
                ? ctx.app
                : ((typeof app !== "undefined" && app && app.renderer) ? app : (global.app || null));
            const renderer = appRef && appRef.renderer ? appRef.renderer : null;
            const screen = (appRef && appRef.screen) || (renderer && renderer.screen) || {};
            return {
                width: Math.max(1, Math.round(Number(screen.width) || Number(renderer && renderer.width) || 1)),
                height: Math.max(1, Math.round(Number(screen.height) || Number(renderer && renderer.height) || 1))
            };
        }

        getBuildingCutawayCompositeSignature(ctx = null, cutawayState = null) {
            const state = cutawayState || this.getLayerCutawayState(ctx);
            const triggers = Array.isArray(state && state.triggers)
                ? state.triggers.filter(trigger => trigger && trigger.building)
                : [];
            if (triggers.length === 0) return "";
            const size = this.getBuildingCutawayCompositeScreenSize(ctx);
            const cam = this.camera || {};
            const triggerSig = triggers.map(trigger => {
                const buildingId = typeof trigger.buildingId === "string" ? trigger.buildingId : "";
                const cacheKey = trigger.renderCache && typeof trigger.renderCache.cacheKey === "string"
                    ? trigger.renderCache.cacheKey
                    : "";
                return [
                    buildingId,
                    cacheKey
                ].join(":");
            }).sort().join("|");
            return [
                `v${BUILDING_CUTAWAY_COMPOSITE_VERSION}`,
                size.width,
                size.height,
                (Number(cam.viewscale) || 1).toFixed(4),
                (Number(cam.xyratio) || 1).toFixed(4),
                (Number(cam.z) || 0).toFixed(4),
                this.getCurrentFloorDarknessLayer(),
                triggerSig
            ].join("|");
        }

        isBuildingCutawayCompositeCacheUsable(ctx = null, cutawayState = null) {
            const cache = this.buildingCutawayCompositeCache || null;
            if (!cache || !cache.texture || cache.active !== true) return false;
            const signature = this.getBuildingCutawayCompositeSignature(ctx, cutawayState);
            return !!(signature && cache.signature === signature);
        }

        isBuildingCutawayCompositeTextureReady(texture) {
            if (!texture) return true;
            if (typeof PIXI !== "undefined" && PIXI.Texture) {
                if (texture === PIXI.Texture.WHITE) return true;
                if (texture === PIXI.Texture.EMPTY) return false;
            }
            const baseTexture = texture.baseTexture || null;
            if (!baseTexture || baseTexture.valid !== true) return false;
            const frame = texture.frame || texture.orig || null;
            const width = Number(frame && frame.width);
            const height = Number(frame && frame.height);
            return width > 0 && height > 0;
        }

        collectBuildingCutawayCompositePendingTextures(displayObjects, maxSamples = 8) {
            const roots = displayObjects instanceof Set ? Array.from(displayObjects) : [];
            const pending = [];
            const seenObjects = new Set();
            const seenBaseTextures = new Set();
            const inspectTexture = (texture, owner, label) => {
                if (!texture || this.isBuildingCutawayCompositeTextureReady(texture)) return;
                const baseTexture = texture.baseTexture || null;
                if (baseTexture && seenBaseTextures.has(baseTexture)) return;
                if (baseTexture) seenBaseTextures.add(baseTexture);
                if (pending.length < maxSamples) {
                    pending.push({
                        texture,
                        baseTexture,
                        label,
                        ownerName: owner && typeof owner.name === "string" ? owner.name : "",
                        ownerType: owner && owner.constructor && owner.constructor.name ? owner.constructor.name : "",
                        baseTextureValid: !!(baseTexture && baseTexture.valid),
                        frameWidth: texture.frame && Number.isFinite(texture.frame.width) ? Number(texture.frame.width) : null,
                        frameHeight: texture.frame && Number.isFinite(texture.frame.height) ? Number(texture.frame.height) : null
                    });
                } else {
                    pending.push({ texture, baseTexture });
                }
            };
            const stack = roots.slice();
            while (stack.length > 0) {
                const current = stack.pop();
                if (!current || seenObjects.has(current)) continue;
                seenObjects.add(current);
                if (Object.prototype.hasOwnProperty.call(current, "texture")) {
                    inspectTexture(current.texture, current, "texture");
                }
                const shaderUniforms = current.shader && current.shader.uniforms ? current.shader.uniforms : null;
                if (shaderUniforms) {
                    for (const key of Object.keys(shaderUniforms)) {
                        const value = shaderUniforms[key];
                        if (value && value.baseTexture) inspectTexture(value, current, `shader.${key}`);
                    }
                }
                const materialTexture = current.material && current.material.texture ? current.material.texture : null;
                if (materialTexture) inspectTexture(materialTexture, current, "material.texture");
                const children = Array.isArray(current.children) ? current.children : null;
                if (children) {
                    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]);
                }
            }
            return {
                count: seenBaseTextures.size,
                samples: pending.slice(0, maxSamples),
                baseTextures: Array.from(seenBaseTextures)
            };
        }

        watchBuildingCutawayCompositePendingTextures(pendingInfo) {
            const baseTextures = Array.isArray(pendingInfo && pendingInfo.baseTextures) ? pendingInfo.baseTextures : [];
            if (!(this.buildingCutawayCompositePendingBaseTextures instanceof Set)) {
                this.buildingCutawayCompositePendingBaseTextures = new Set();
            }
            for (let i = 0; i < baseTextures.length; i++) {
                const baseTexture = baseTextures[i];
                if (!baseTexture || baseTexture.valid === true || this.buildingCutawayCompositePendingBaseTextures.has(baseTexture)) continue;
                this.buildingCutawayCompositePendingBaseTextures.add(baseTexture);
                let completed = false;
                const onReady = () => {
                    if (completed) return;
                    completed = true;
                    this.buildingCutawayCompositePendingBaseTextures.delete(baseTexture);
                    this.buildingCutawayCompositeCache = null;
                    if (typeof globalThis !== "undefined" && typeof globalThis.presentGameFrame === "function") {
                        globalThis.presentGameFrame();
                    }
                };
                if (typeof baseTexture.once === "function") {
                    baseTexture.once("loaded", onReady);
                    baseTexture.once("update", onReady);
                    baseTexture.once("error", onReady);
                }
            }
        }

        getBuildingCutawayCompositeAnchor(cutawayState = null) {
            const state = cutawayState || this.getLayerCutawayState(null);
            const triggers = Array.isArray(state && state.triggers)
                ? state.triggers.filter(trigger => trigger && trigger.building)
                : [];
            if (triggers.length === 0 || !this.camera || typeof this.camera.worldToScreen !== "function") return null;
            let minWorldX = Infinity;
            let maxWorldX = -Infinity;
            let bottomWorldY = -Infinity;
            const visitRing = (ring) => {
                const points = normalizeFloorVisualPointList(ring);
                for (let i = 0; i < points.length; i++) {
                    const wx = Number(points[i].x);
                    const wy = Number(points[i].y);
                    if (!Number.isFinite(wx) || !Number.isFinite(wy)) continue;
                    minWorldX = Math.min(minWorldX, wx);
                    maxWorldX = Math.max(maxWorldX, wx);
                    bottomWorldY = Math.max(bottomWorldY, wy);
                }
            };
            const getFragmentOuter = (fragment) => Array.isArray(fragment && fragment.visibilityPolygon) && fragment.visibilityPolygon.length >= 3
                ? fragment.visibilityPolygon
                : (fragment && fragment.outerPolygon);
            for (let i = 0; i < triggers.length; i++) {
                const trigger = triggers[i];
                const cache = trigger.renderCache || null;
                const fragments = Array.isArray(cache && cache.fragments) ? cache.fragments : [];
                let lowestLevel = Infinity;
                for (let f = 0; f < fragments.length; f++) {
                    const fragment = fragments[f];
                    if (!fragment) continue;
                    const level = this.getLayerIndexFromValue(fragment.level, 0);
                    if (level < lowestLevel) lowestLevel = level;
                }
                let foundLowestFragment = false;
                if (Number.isFinite(lowestLevel)) {
                    for (let f = 0; f < fragments.length; f++) {
                        const fragment = fragments[f];
                        if (!fragment || this.getLayerIndexFromValue(fragment.level, 0) !== lowestLevel) continue;
                        visitRing(this.projectWorldRingToCutawayPlane(
                            getFragmentOuter(fragment),
                            this.getLayerBaseZForLevel(0)
                        ));
                        foundLowestFragment = true;
                    }
                }
                if (foundLowestFragment) continue;
                const polygons = Array.isArray(trigger.groundProjectionPolygons)
                    ? trigger.groundProjectionPolygons
                    : [];
                for (let p = 0; p < polygons.length; p++) {
                    visitRing(polygons[p] && polygons[p].outer);
                }
            }
            if (!Number.isFinite(minWorldX) || !Number.isFinite(maxWorldX) || !Number.isFinite(bottomWorldY)) return null;
            let worldX = (minWorldX + maxWorldX) * 0.5;
            let worldY = bottomWorldY;
            const mapRef = this.camera.map || global.map || null;
            if (mapRef && typeof mapRef.wrapWorldX === "function" && Number.isFinite(worldX)) {
                worldX = mapRef.wrapWorldX(worldX);
            }
            if (mapRef && typeof mapRef.wrapWorldY === "function" && Number.isFinite(worldY)) {
                worldY = mapRef.wrapWorldY(worldY);
            }
            const worldZ = 0;
            const screen = this.camera.worldToScreen(worldX, worldY, worldZ);
            const centerX = Number(screen && screen.x);
            const bottomY = Number(screen && screen.y);
            if (!Number.isFinite(centerX) || !Number.isFinite(bottomY)) return null;
            return {
                centerX,
                bottomY,
                worldX,
                worldY,
                worldZ
            };
        }

        getBuildingCutawayCompositeScreenBounds(cutawayState = null, paddingPx = 2) {
            const state = cutawayState || this.getLayerCutawayState(null);
            const triggers = Array.isArray(state && state.triggers)
                ? state.triggers.filter(trigger => trigger && trigger.building)
                : [];
            if (triggers.length === 0 || !this.camera || typeof this.camera.worldToScreen !== "function") return null;
            let minX = Infinity;
            let minY = Infinity;
            let maxX = -Infinity;
            let maxY = -Infinity;
            const visitPoint = (point) => {
                if (!point) return;
                const wx = Number(point.x);
                const wy = Number(point.y);
                if (!Number.isFinite(wx) || !Number.isFinite(wy)) return;
                const screen = this.camera.worldToScreen(wx, wy, 0);
                const sx = Number(screen && screen.x);
                const sy = Number(screen && screen.y);
                if (!Number.isFinite(sx) || !Number.isFinite(sy)) return;
                minX = Math.min(minX, sx);
                minY = Math.min(minY, sy);
                maxX = Math.max(maxX, sx);
                maxY = Math.max(maxY, sy);
            };
            for (let i = 0; i < triggers.length; i++) {
                const trigger = triggers[i];
                const polygons = Array.isArray(trigger && trigger.occlusionPolygons)
                    ? trigger.occlusionPolygons
                    : [];
                for (let p = 0; p < polygons.length; p++) {
                    const polygon = polygons[p];
                    const outer = Array.isArray(polygon && polygon.outer)
                        ? polygon.outer
                        : (Array.isArray(polygon) ? polygon : []);
                    for (let j = 0; j < outer.length; j++) visitPoint(outer[j]);
                }
            }
            if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
                return null;
            }
            const pad = Math.max(0, Number(paddingPx) || 0);
            const x = Math.floor(minX - pad);
            const y = Math.floor(minY - pad);
            const right = Math.ceil(maxX + pad);
            const bottom = Math.ceil(maxY + pad);
            return {
                x,
                y,
                width: Math.max(1, right - x),
                height: Math.max(1, bottom - y)
            };
        }

        getBuildingCutawayCompositeCaptureBounds(cutawayState = null, anchor = null) {
            const bounds = this.getBuildingCutawayCompositeScreenBounds(cutawayState);
            if (!bounds || !anchor || !Number.isFinite(anchor.bottomY)) return bounds;
            const bottom = Math.ceil(Number(anchor.bottomY));
            const y = Math.min(Number(bounds.y) || 0, bottom - 1);
            return {
                x: bounds.x,
                y,
                width: bounds.width,
                height: Math.max(1, bottom - y)
            };
        }

        updateBuildingCutawayCompositeBillboardTexture(resources, anchor, bounds = null) {
            if (!resources || !resources.texture || !anchor || typeof PIXI === "undefined" || !PIXI.Texture || !PIXI.Rectangle) return null;
            const width = Math.max(1, Math.round(Number(resources.width) || 1));
            const height = Math.max(1, Math.round(Number(resources.height) || 1));
            if (resources.localBounds) {
                const oldTexture = this.buildingCutawayCompositeTexture;
                this.buildingCutawayCompositeTexture = resources.texture;
                if (oldTexture && oldTexture !== resources.texture && typeof oldTexture.destroy === "function") {
                    oldTexture.destroy(false);
                }
                const sprite = resources.sprite;
                sprite.texture = resources.texture;
                const anchorX = Math.max(0, Math.min(1, ((Number(anchor.centerX) || 0) - (Number(bounds && bounds.x) || 0)) / width));
                const anchorY = Math.max(0, Math.min(1, ((Number(anchor.bottomY) || 0) - (Number(bounds && bounds.y) || 0)) / height));
                if (sprite.anchor && typeof sprite.anchor.set === "function") {
                    sprite.anchor.set(anchorX, anchorY);
                }
                sprite.width = width;
                sprite.height = height;
                return {
                    texture: resources.texture,
                    width,
                    height,
                    anchorX,
                    anchorY,
                    bounds: {
                        x: Number(bounds && bounds.x) || 0,
                        y: Number(bounds && bounds.y) || 0,
                        width,
                        height
                    }
                };
            }
            const rawX = Number.isFinite(bounds && bounds.x) ? Number(bounds.x) : 0;
            const rawY = Number.isFinite(bounds && bounds.y) ? Number(bounds.y) : 0;
            const rawRight = rawX + (Number.isFinite(bounds && bounds.width) ? Number(bounds.width) : width);
            const rawBottom = rawY + (Number.isFinite(bounds && bounds.height) ? Number(bounds.height) : height);
            const frameX = Math.max(0, Math.min(width - 1, Math.floor(rawX)));
            const frameY = Math.max(0, Math.min(height - 1, Math.floor(rawY)));
            const frameRight = Math.max(frameX + 1, Math.min(width, Math.ceil(rawRight)));
            const frameBottom = Math.max(frameY + 1, Math.min(height, Math.ceil(rawBottom)));
            const frameWidth = Math.max(1, frameRight - frameX);
            const frameHeight = Math.max(1, frameBottom - frameY);
            const frame = new PIXI.Rectangle(frameX, frameY, frameWidth, frameHeight);
            const oldTexture = this.buildingCutawayCompositeTexture;
            this.buildingCutawayCompositeTexture = new PIXI.Texture(resources.texture.baseTexture, frame);
            if (oldTexture && oldTexture !== this.buildingCutawayCompositeTexture && typeof oldTexture.destroy === "function") {
                oldTexture.destroy(false);
            }
            const sprite = resources.sprite;
            sprite.texture = this.buildingCutawayCompositeTexture;
            const anchorX = Math.max(0, Math.min(1, ((Number(anchor.centerX) || 0) - frameX) / frameWidth));
            const anchorY = Math.max(0, Math.min(1, ((Number(anchor.bottomY) || 0) - frameY) / frameHeight));
            if (sprite.anchor && typeof sprite.anchor.set === "function") {
                sprite.anchor.set(anchorX, anchorY);
            }
            sprite.width = frameWidth;
            sprite.height = frameHeight;
            return {
                texture: this.buildingCutawayCompositeTexture,
                width: frameWidth,
                height: frameHeight,
                anchorX,
                anchorY,
                bounds: {
                    x: frameX,
                    y: frameY,
                    width: frameWidth,
                    height: frameHeight
                }
            };
        }

        ensureBuildingCutawayCompositeProxy(sprite) {
            if (!sprite) return null;
            if (!this.buildingCutawayCompositeProxy) {
                this.buildingCutawayCompositeProxy = {
                    type: "buildingCutawayComposite",
                    category: "",
                    rotationAxis: "billboard",
                    placementRotation: 0,
                    pixiSprite: sprite,
                    x: 0,
                    y: 0,
                    z: 0,
                    width: 1,
                    height: 1,
                    gone: false,
                    vanishing: false,
                    visible: true,
                    tint: 0xFFFFFF,
                    _renderLayerBaseZ: 0,
                    _renderDepthBias: 0,
                    _depthBillboardMesh: null,
                    _depthBillboardWorldPositions: null,
                    _depthBillboardLastSignature: "",
                    _depthBillboardLastUvSignature: "",
                    _depthBillboardMeshMode: ""
                };
                const staticProto = (typeof global.StaticObject === "function" && global.StaticObject.prototype)
                    ? global.StaticObject.prototype
                    : null;
                if (staticProto) {
                    if (typeof staticProto.ensureDepthBillboardMesh === "function") {
                        this.buildingCutawayCompositeProxy.ensureDepthBillboardMesh = staticProto.ensureDepthBillboardMesh;
                    }
                    if (typeof staticProto.updateDepthBillboardUvsForTexture === "function") {
                        this.buildingCutawayCompositeProxy.updateDepthBillboardUvsForTexture = staticProto.updateDepthBillboardUvsForTexture;
                    }
                    if (typeof staticProto.updateDepthBillboardMesh === "function") {
                        this.buildingCutawayCompositeProxy.updateDepthBillboardMesh = staticProto.updateDepthBillboardMesh;
                    }
                }
            }
            this.buildingCutawayCompositeProxy.pixiSprite = sprite;
            return this.buildingCutawayCompositeProxy;
        }

        hideBuildingCutawayCompositeBillboard() {
            if (this.buildingCutawayCompositeSprite) {
                this.buildingCutawayCompositeSprite.visible = false;
                if (Object.prototype.hasOwnProperty.call(this.buildingCutawayCompositeSprite, "renderable")) {
                    this.buildingCutawayCompositeSprite.renderable = false;
                }
            }
            const proxy = this.buildingCutawayCompositeProxy || null;
            const mesh = proxy && proxy._depthBillboardMesh ? proxy._depthBillboardMesh : null;
            if (mesh) {
                mesh.visible = false;
                if (Object.prototype.hasOwnProperty.call(mesh, "renderable")) {
                    mesh.renderable = false;
                }
            }
        }

        failBuildingCutawayComposite(reason, details = null) {
            const detailText = details ? ` ${JSON.stringify(details)}` : "";
            const err = new Error(`[building cutaway composite] ${reason}${detailText}`);
            err.reason = reason;
            err.details = details;
            throw err;
        }

        ensureBuildingCutawayCompositeBillboardState() {
            if (this.buildingCutawayCompositeBillboardState) return this.buildingCutawayCompositeBillboardState;
            if (typeof PIXI === "undefined" || !PIXI.State) return null;
            const state = new PIXI.State();
            state.depthTest = true;
            state.depthMask = false;
            state.blend = true;
            state.culling = false;
            this.buildingCutawayCompositeBillboardState = state;
            return state;
        }

        renderBuildingCutawayCompositeBillboard(ctx, resources, cache, container = null) {
            if (!resources || !resources.sprite || !cache || !cache.anchor) return null;
            const staticProto = (typeof global.StaticObject === "function" && global.StaticObject.prototype)
                ? global.StaticObject.prototype
                : null;
            if (!staticProto || typeof staticProto.updateDepthBillboardMesh !== "function") return null;
            const sprite = resources.sprite;
            const proxy = this.ensureBuildingCutawayCompositeProxy(sprite);
            if (!proxy || typeof proxy.updateDepthBillboardMesh !== "function") return null;
            const viewScale = Math.max(1e-6, Math.abs(Number(this.camera && this.camera.viewscale) || 1));
            const xyRatio = Math.max(1e-6, Math.abs(Number(this.camera && this.camera.xyratio) || 1));
            const textureWidth = Math.max(1, Number(cache.textureWidth) || Number(sprite.width) || Number(resources.width) || 1);
            const textureHeight = Math.max(1, Number(cache.textureHeight) || Number(sprite.height) || Number(resources.height) || 1);
            const compositeAlpha = Number.isFinite(cache.alpha)
                ? Math.max(0, Math.min(1, Number(cache.alpha)))
                : BUILDING_CUTAWAY_GHOST_ALPHA;
            sprite.width = textureWidth;
            sprite.height = textureHeight;
            sprite.alpha = compositeAlpha;
            sprite.visible = false;
            if (Object.prototype.hasOwnProperty.call(sprite, "renderable")) sprite.renderable = false;
            const anchor = cache.anchor;
            proxy.x = Number.isFinite(anchor.worldX) ? Number(anchor.worldX) : 0;
            proxy.y = Number.isFinite(anchor.worldY) ? Number(anchor.worldY) : 0;
            proxy.z = Number.isFinite(anchor.worldZ) ? Number(anchor.worldZ) : 0;
            proxy.width = textureWidth / viewScale;
            proxy.height = textureHeight / (viewScale * xyRatio);
            proxy.map = (ctx && ctx.map) || (this.camera && this.camera.map) || global.map || null;
            proxy._renderLayerBaseZ = 0;
            proxy._renderDepthBias = -0.002;
            const mesh = proxy.updateDepthBillboardMesh(ctx, this.camera, {
                alphaCutoff: 0.01,
                mazeMode: false
            });
            if (!mesh) return null;
            this.flipBuildingCutawayCompositeBillboardUvs(mesh, sprite.texture);
            const billboardState = this.ensureBuildingCutawayCompositeBillboardState();
            if (billboardState) mesh.state = billboardState;
            if (typeof PIXI !== "undefined" && PIXI.BLEND_MODES) {
                mesh.blendMode = PIXI.BLEND_MODES.NORMAL;
            }
            if (mesh.shader && mesh.shader.uniforms && mesh.shader.uniforms.uTint) {
                const tint = Number.isFinite(sprite.tint) ? Math.max(0, Math.min(0xffffff, Math.floor(sprite.tint))) : 0xffffff;
                mesh.shader.uniforms.uTint[0] = (((tint >> 16) & 0xff) / 255) * compositeAlpha;
                mesh.shader.uniforms.uTint[1] = (((tint >> 8) & 0xff) / 255) * compositeAlpha;
                mesh.shader.uniforms.uTint[2] = ((tint & 0xff) / 255) * compositeAlpha;
                mesh.shader.uniforms.uTint[3] = compositeAlpha;
            }
            const targetContainer = container || (this.layers && (this.layers.objects3d || this.layers.depthObjects || this.layers.root));
            if (targetContainer) {
                if (Object.prototype.hasOwnProperty.call(targetContainer, "sortableChildren")) {
                    targetContainer.sortableChildren = true;
                }
                mesh.zIndex = 2147483647;
                targetContainer.addChild(mesh);
                if (Object.prototype.hasOwnProperty.call(targetContainer, "sortDirty")) {
                    targetContainer.sortDirty = true;
                }
            }
            mesh.visible = true;
            mesh.alpha = 1;
            if (Object.prototype.hasOwnProperty.call(mesh, "renderable")) mesh.renderable = true;
            return mesh;
        }

        flipBuildingCutawayCompositeBillboardUvs(mesh, texture) {
            if (!mesh || !mesh.geometry || !texture || !texture.baseTexture) return false;
            const uvBuffer = mesh.geometry.getBuffer("aUvs");
            if (!uvBuffer) return false;
            const baseTexture = texture.baseTexture;
            const baseW = Number(baseTexture.realWidth || baseTexture.width || 0);
            const baseH = Number(baseTexture.realHeight || baseTexture.height || 0);
            if (!(baseW > 0) || !(baseH > 0)) return false;
            const frame = texture.frame || new PIXI.Rectangle(0, 0, baseW, baseH);
            const u0 = Number(frame.x) / baseW;
            const v0 = Number(frame.y) / baseH;
            const u1 = (Number(frame.x) + Number(frame.width)) / baseW;
            const v1 = (Number(frame.y) + Number(frame.height)) / baseH;
            uvBuffer.data = new Float32Array([
                u0, v0,
                u1, v0,
                u1, v1,
                u0, v1
            ]);
            uvBuffer.update();
            return true;
        }

        renderBuildingCutawayComposites(ctx, cutawayState, container = null, maskDisplayObjects = null) {
            const triggers = Array.isArray(cutawayState && cutawayState.triggers)
                ? cutawayState.triggers.filter(trigger => trigger && trigger.building)
                : [];
            if (triggers.length === 0) {
                this.hideBuildingCutawayCompositeBillboard();
                this.buildingCutawayCompositeCache = null;
                this.setFrameMetric("objects3dBuildingCompositeActive", 0);
                this.setFrameMetric("objects3dBuildingCompositeObjects", 0);
                this.setFrameMetric("objects3dBuildingCompositeOriginalsHidden", 0);
                this.setFrameMetric("objects3dBuildingCompositeCacheHits", 0);
                this.setFrameMetric("objects3dBuildingCompositeCacheMisses", 0);
                this.setFrameMetric("objects3dBuildingCompositePendingTextures", 0);
                return null;
            }
            const signature = this.getBuildingCutawayCompositeSignature(ctx, cutawayState);
            if (!signature) {
                this.failBuildingCutawayComposite("missing cache signature", {
                    triggers: triggers.length
                });
            }
            const cacheUsable = !!(
                this.buildingCutawayCompositeCache &&
                this.buildingCutawayCompositeCache.active === true &&
                this.buildingCutawayCompositeCache.signature === signature
            );
            const displayObjects = this.getBuildingCutawayCompositeDisplayObjects(cutawayState);
            let captureAnchor = cacheUsable
                ? (this.buildingCutawayCompositeCache && this.buildingCutawayCompositeCache.anchor)
                : this.getBuildingCutawayCompositeAnchor(cutawayState);
            const captureBounds = cacheUsable
                ? (this.buildingCutawayCompositeCache && this.buildingCutawayCompositeCache.bounds)
                : this.getBuildingCutawayCompositeCaptureBounds(cutawayState, captureAnchor);
            const resourceWidth = cacheUsable
                ? (this.buildingCutawayCompositeCache && this.buildingCutawayCompositeCache.textureWidth)
                : (captureBounds && captureBounds.width);
            const resourceHeight = cacheUsable
                ? (this.buildingCutawayCompositeCache && this.buildingCutawayCompositeCache.textureHeight)
                : (captureBounds && captureBounds.height);
            const resources = this.ensureBuildingCutawayCompositeRenderTexture(ctx, resourceWidth, resourceHeight, captureBounds);
            if (!resources) {
                this.failBuildingCutawayComposite("render texture unavailable", {
                    resourceWidth,
                    resourceHeight,
                    hasPixi: typeof PIXI !== "undefined",
                    hasApp: !!((ctx && ctx.app) || (typeof app !== "undefined" && app) || global.app)
                });
            }
            if (!captureAnchor) {
                this.failBuildingCutawayComposite("missing capture anchor", {
                    cacheUsable,
                    signature
                });
            }
            if (!captureBounds) {
                this.failBuildingCutawayComposite("missing capture bounds", {
                    cacheUsable,
                    signature,
                    anchor: captureAnchor
                });
            }
            if (displayObjects.size === 0) {
                this.failBuildingCutawayComposite("no display objects selected for capture", {
                    signature,
                    frameId: Number(this._layerCutawayFrameId) || 0,
                    cacheUsable,
                    triggers: triggers.map(trigger => ({
                        buildingId: trigger && trigger.buildingId,
                        activeInteriorRegionId: trigger && trigger.activeInteriorRegionId,
                        level: trigger && trigger.level,
                        visibleThroughLevel: trigger && trigger.visibleThroughLevel,
                        renderItems: trigger && trigger.renderCache && Array.isArray(trigger.renderCache.renderItems)
                            ? trigger.renderCache.renderItems.length
                            : null
                    }))
                });
            }
            if (!cacheUsable) {
                const wallSelection = this.getBuildingCutawayCompositeWallSelectionDiagnostics(cutawayState, displayObjects);
                if (wallSelection.expectedWalls > 0 && wallSelection.selectedWalls === 0) {
                    this.failBuildingCutawayComposite("no wall display objects selected for capture", {
                        signature,
                        frameId: Number(this._layerCutawayFrameId) || 0,
                        expectedWalls: wallSelection.expectedWalls,
                        selectedWalls: wallSelection.selectedWalls
                    });
                }
                const pendingTextures = this.collectBuildingCutawayCompositePendingTextures(displayObjects);
                if (pendingTextures.count > 0) {
                    this.watchBuildingCutawayCompositePendingTextures(pendingTextures);
                    this.hideBuildingCutawayCompositeBillboard();
                    this.buildingCutawayCompositeCache = null;
                    if (typeof globalThis !== "undefined") {
                        globalThis.renderingLastBuildingCutawayCompositePendingTextures = pendingTextures.samples.map(sample => ({
                            label: sample.label || "",
                            ownerName: sample.ownerName || "",
                            ownerType: sample.ownerType || "",
                            baseTextureValid: !!sample.baseTextureValid,
                            frameWidth: sample.frameWidth,
                            frameHeight: sample.frameHeight
                        }));
                    }
                    this.setFrameMetric("objects3dBuildingCompositeActive", 0);
                    this.setFrameMetric("objects3dBuildingCompositeObjects", displayObjects.size);
                    this.setFrameMetric("objects3dBuildingCompositeOriginalsHidden", 0);
                    this.setFrameMetric("objects3dBuildingCompositeCacheHits", 0);
                    this.setFrameMetric("objects3dBuildingCompositeCacheMisses", 1);
                    this.setFrameMetric("objects3dBuildingCompositePendingTextures", pendingTextures.count);
                    return null;
                }
            }
            if (!(this.layers && this.layers.root)) {
                this.failBuildingCutawayComposite("missing render root", {
                    hasLayers: !!this.layers
                });
            }
            const compositeAlpha = this.getBuildingCutawayCompositeAlpha(cutawayState);
            if (resources.sprite) {
                resources.sprite.visible = false;
                if (Object.prototype.hasOwnProperty.call(resources.sprite, "renderable")) resources.sprite.renderable = false;
            }
            let rendered = cacheUsable;
            if (!cacheUsable) {
                const restoreTree = this.isolateBuildingCutawayCompositeDisplayTree(displayObjects);
                const restoreCaptureState = this.applyBuildingCutawayCompositeLocalCaptureState(
                    displayObjects,
                    captureBounds,
                    resources.width,
                    resources.height
                );
                try {
                    const cleared = this.clearBuildingCutawayCompositeRenderTarget(resources);
                    resources.renderer.render(this.layers.root, resources.texture, !cleared);
                    rendered = true;
                } catch (err) {
                    this.failBuildingCutawayComposite("render-to-texture failed", {
                        message: err && err.message ? err.message : String(err),
                        signature,
                        displayObjects: displayObjects.size,
                        textureWidth: resources.width,
                        textureHeight: resources.height
                    });
                } finally {
                    restoreCaptureState();
                    restoreTree();
                }
            }
            if (!rendered) {
                this.failBuildingCutawayComposite("render-to-texture did not render", {
                    signature,
                    displayObjects: displayObjects.size
                });
            }
            const hiddenOriginals = this.hideBuildingCutawayCompositeOriginals(displayObjects);
            const sprite = resources.sprite;
            sprite.alpha = compositeAlpha;
            sprite.visible = false;
            if (Object.prototype.hasOwnProperty.call(sprite, "renderable")) sprite.renderable = false;
            if (!cacheUsable) {
                const billboardTexture = this.updateBuildingCutawayCompositeBillboardTexture(resources, captureAnchor, captureBounds);
                if (!billboardTexture || !billboardTexture.texture) {
                    this.failBuildingCutawayComposite("billboard texture update failed", {
                        signature,
                        captureAnchor,
                        captureBounds,
                        resourceWidth: resources.width,
                        resourceHeight: resources.height
                    });
                }
                this.buildingCutawayCompositeCache = {
                    active: true,
                    signature,
                    texture: billboardTexture.texture,
                    anchor: captureAnchor,
                    bounds: billboardTexture.bounds,
                    anchorX: billboardTexture.anchorX,
                    anchorY: billboardTexture.anchorY,
                    textureWidth: billboardTexture.width,
                    textureHeight: billboardTexture.height,
                    alpha: compositeAlpha
                };
            } else if (sprite.anchor && this.buildingCutawayCompositeCache) {
                this.buildingCutawayCompositeCache.alpha = compositeAlpha;
                if (this.buildingCutawayCompositeCache.texture) {
                    sprite.texture = this.buildingCutawayCompositeCache.texture;
                }
                sprite.anchor.set(
                    Number.isFinite(this.buildingCutawayCompositeCache.anchorX) ? this.buildingCutawayCompositeCache.anchorX : 0.5,
                    Number.isFinite(this.buildingCutawayCompositeCache.anchorY) ? this.buildingCutawayCompositeCache.anchorY : 1
                );
            }
            const billboardMesh = this.renderBuildingCutawayCompositeBillboard(
                ctx,
                resources,
                this.buildingCutawayCompositeCache,
                container
            );
            if (!billboardMesh) {
                this.failBuildingCutawayComposite("billboard mesh creation failed", {
                    signature,
                    cacheUsable,
                    hasStaticObject: typeof global.StaticObject === "function",
                    hasTexture: !!(this.buildingCutawayCompositeCache && this.buildingCutawayCompositeCache.texture)
                });
            }
            this.setFrameMetric("objects3dBuildingCompositeActive", 1);
            this.setFrameMetric("objects3dBuildingCompositeObjects", displayObjects.size);
            this.setFrameMetric("objects3dBuildingCompositeOriginalsHidden", hiddenOriginals);
            this.setFrameMetric("objects3dBuildingCompositeCacheHits", cacheUsable ? 1 : 0);
            this.setFrameMetric("objects3dBuildingCompositeCacheMisses", cacheUsable ? 0 : 1);
            this.setFrameMetric("objects3dBuildingCompositePendingTextures", 0);
            return billboardMesh;
        }

        getBuildingInteriorForegroundState() {
            if (this.buildingInteriorForegroundState) return this.buildingInteriorForegroundState;
            if (typeof PIXI === "undefined" || !PIXI.State) return null;
            const state = new PIXI.State();
            state.depthTest = true;
            state.depthMask = true;
            state.blend = true;
            state.culling = false;
            this.buildingInteriorForegroundState = state;
            return state;
        }

        clearBuildingInteriorForegroundPromotions() {
            const list = Array.isArray(this._buildingInteriorForegroundPromotions)
                ? this._buildingInteriorForegroundPromotions
                : [];
            for (let i = list.length - 1; i >= 0; i--) {
                const entry = list[i];
                const obj = entry && entry.displayObj;
                if (!obj) continue;
                const originalParent = entry.parent || null;
                if (entry.addedToPromotionContainer && !originalParent) {
                    if (obj.parent && typeof obj.parent.removeChild === "function") {
                        obj.parent.removeChild(obj);
                    }
                } else if (originalParent && obj.parent !== originalParent) {
                    if (obj.parent && typeof obj.parent.removeChild === "function") {
                        obj.parent.removeChild(obj);
                    }
                    if (typeof originalParent.addChildAt === "function" && Number.isFinite(entry.parentIndex)) {
                        const childCount = Array.isArray(originalParent.children) ? originalParent.children.length : 0;
                        const index = Math.max(0, Math.min(childCount, Math.floor(entry.parentIndex)));
                        originalParent.addChildAt(obj, index);
                    } else if (typeof originalParent.addChild === "function") {
                        originalParent.addChild(obj);
                    }
                }
                if (Object.prototype.hasOwnProperty.call(entry, "state")) obj.state = entry.state;
                if (Object.prototype.hasOwnProperty.call(entry, "zIndex")) obj.zIndex = entry.zIndex;
                if (Object.prototype.hasOwnProperty.call(entry, "visible")) obj.visible = entry.visible;
                if (Object.prototype.hasOwnProperty.call(entry, "renderable") && Object.prototype.hasOwnProperty.call(obj, "renderable")) {
                    obj.renderable = entry.renderable;
                }
            }
            this._buildingInteriorForegroundPromotions = [];
        }

        promoteDisplayObjectForBuildingInterior(displayObj, container, currentDisplayObjects = null, promotedSet = null) {
            if (!displayObj || !container) return false;
            const set = promotedSet instanceof Set ? promotedSet : null;
            if (set && set.has(displayObj)) return false;
            if (set) set.add(displayObj);
            if (!Array.isArray(this._buildingInteriorForegroundPromotions)) {
                this._buildingInteriorForegroundPromotions = [];
            }
            const originalParent = displayObj.parent || null;
            const originalParentIndex = originalParent && typeof originalParent.getChildIndex === "function"
                ? originalParent.getChildIndex(displayObj)
                : null;
            this._buildingInteriorForegroundPromotions.push({
                displayObj,
                parent: originalParent,
                parentIndex: originalParentIndex,
                state: displayObj.state,
                zIndex: displayObj.zIndex,
                visible: displayObj.visible,
                renderable: displayObj.renderable,
                addedToPromotionContainer: !originalParent
            });
            const foregroundState = this.getBuildingInteriorForegroundState();
            if (foregroundState && Object.prototype.hasOwnProperty.call(displayObj, "state")) {
                displayObj.state = foregroundState;
            }
            displayObj.zIndex = BUILDING_INTERIOR_OVERLAY_Z;
            const sortContainer = originalParent || container;
            if (sortContainer && Object.prototype.hasOwnProperty.call(sortContainer, "sortableChildren")) {
                sortContainer.sortableChildren = true;
            }
            if (!originalParent && typeof container.addChild === "function") {
                container.addChild(displayObj);
            }
            if (sortContainer && Object.prototype.hasOwnProperty.call(sortContainer, "sortDirty")) {
                sortContainer.sortDirty = true;
            }
            displayObj.visible = true;
            if (Object.prototype.hasOwnProperty.call(displayObj, "renderable")) {
                displayObj.renderable = true;
            }
            if (currentDisplayObjects instanceof Set) currentDisplayObjects.add(displayObj);
            return true;
        }

        isBuildingInteriorPresentationActive(ctx = null) {
            const state = (ctx && ctx._renderingLayerCutawayState) || this.getLayerCutawayState(ctx);
            const triggers = Array.isArray(state && state.triggers) ? state.triggers : [];
            for (let i = 0; i < triggers.length; i++) {
                if (triggers[i] && triggers[i].activeInteriorRegion) return true;
            }
            return false;
        }

        promoteInteriorPresentationDisplayObject(displayObj, ctx = null) {
            if (!displayObj || !this.isBuildingInteriorPresentationActive(ctx)) return false;
            const ui = this.layers && this.layers.ui ? this.layers.ui : null;
            if (!ui) return false;
            ui.sortableChildren = true;
            if (displayObj.parent !== ui) ui.addChild(displayObj);
            displayObj.zIndex = BUILDING_INTERIOR_FOREGROUND_Z;
            displayObj.visible = true;
            if (Object.prototype.hasOwnProperty.call(displayObj, "renderable")) {
                displayObj.renderable = true;
            }
            if (Object.prototype.hasOwnProperty.call(ui, "sortDirty")) ui.sortDirty = true;
            return true;
        }

        collectBuildingInteriorDisplayObjectsForItem(item) {
            const out = [];
            const push = (displayObj) => {
                if (!displayObj) return;
                if (out.indexOf(displayObj) >= 0) return;
                out.push(displayObj);
            };
            push(item && item._renderingDepthMesh);
            push(item && item._compositeUnderlayMesh);
            push(item && item._renderingDisplayObject);
            push(item && item._flowerBurnFragmentContainer);
            push(item && item.pixiSprite);
            push(item && item.fireSprite);
            push(item && item._doorBottomFaceDebugGraphics);
            if (item && item.type === "roof") push(item.pixiMesh);
            return out;
        }

        promoteBuildingInteriorFloorMeshes(region, container, currentDisplayObjects, promotedSet) {
            if (!region || region.kind !== "floorFragment" || !region.fragmentId || !(this.floorVisualMeshByKey instanceof Map)) return 0;
            const prefix = `fragment:${region.fragmentId}`;
            let promoted = 0;
            for (const [key, entry] of this.floorVisualMeshByKey.entries()) {
                if (key !== prefix && !key.startsWith(`${prefix}:`)) continue;
                const mesh = entry && entry.mesh;
                if (this.promoteDisplayObjectForBuildingInterior(mesh, container, currentDisplayObjects, promotedSet)) {
                    promoted += 1;
                }
            }
            return promoted;
        }

        promoteActiveBuildingInteriorRegions(ctx, cutawayState, container, currentDisplayObjects = null) {
            const triggers = Array.isArray(cutawayState && cutawayState.triggers) ? cutawayState.triggers : [];
            if (triggers.length === 0 || !container) {
                this.setFrameMetric("objects3dBuildingInteriorPromoted", 0);
                return 0;
            }
            const promotedSet = new Set();
            let promoted = 0;
            for (let i = 0; i < triggers.length; i++) {
                const trigger = triggers[i];
                const region = trigger && trigger.activeInteriorRegion;
                if (!region) continue;
                promoted += this.promoteBuildingInteriorFloorMeshes(region, container, currentDisplayObjects, promotedSet);
                const entries = Array.isArray(region.staticObjects) ? region.staticObjects : [];
                for (let j = 0; j < entries.length; j++) {
                    const item = entries[j] && entries[j].item;
                    if (!item || item.gone || item.vanishing) continue;
                    const displayObjects = this.collectBuildingInteriorDisplayObjectsForItem(item);
                    for (let d = 0; d < displayObjects.length; d++) {
                        if (this.promoteDisplayObjectForBuildingInterior(displayObjects[d], container, currentDisplayObjects, promotedSet)) {
                            promoted += 1;
                        }
                    }
                }
            }
            this.setFrameMetric("objects3dBuildingInteriorPromoted", promoted);
            return promoted;
        }

        ensureBuildingInteriorOverlayContainer(container = null) {
            const target = container || (this.layers && this.layers.objects3d) || null;
            if (!target || typeof PIXI === "undefined" || !PIXI.Container) return null;
            if (!this.buildingInteriorOverlayContainer) {
                this.buildingInteriorOverlayContainer = new PIXI.Container();
                this.buildingInteriorOverlayContainer.name = "buildingInteriorOverlay";
                this.buildingInteriorOverlayContainer.interactiveChildren = false;
                this.buildingInteriorOverlayContainer.sortableChildren = true;
            }
            const overlay = this.buildingInteriorOverlayContainer;
            overlay.position.set(0, 0);
            overlay.scale.set(1, 1);
            overlay.zIndex = 2147483647;
            overlay.visible = true;
            if (Object.prototype.hasOwnProperty.call(overlay, "renderable")) overlay.renderable = true;
            if (Object.prototype.hasOwnProperty.call(target, "sortableChildren")) target.sortableChildren = true;
            if (overlay.parent !== target) target.addChild(overlay);
            if (Object.prototype.hasOwnProperty.call(target, "sortDirty")) target.sortDirty = true;
            return overlay;
        }

        collectBuildingInteriorOverlayFloorEntries(ctx, region, trigger) {
            if (!region || !region.polygon || !Array.isArray(region.polygon.outer) || region.polygon.outer.length < 3) return [];
            const regionLevel = this.getLayerIndexFromValue(region.level, 0);
            const floorEntries = this.collectFloorVisualEntries(ctx);
            const out = [];
            for (let i = 0; i < floorEntries.length; i++) {
                const source = floorEntries[i];
                if (!source || this.getLayerIndexFromValue(source.level, 0) !== regionLevel) continue;
                const clipped = intersectFloorVisualPolygonWithPolygon(source.outer, source.holes, region.polygon);
                for (let p = 0; p < clipped.length; p++) {
                    const poly = clipped[p];
                    if (!poly || !Array.isArray(poly.outer) || poly.outer.length < 3) continue;
                    const holes = Array.isArray(poly.holes) ? poly.holes : [];
                    const signature = buildFloorVisualSignature(poly.outer, holes);
                    out.push({
                        key: `${String(trigger && trigger.buildingId || "building")}:${String(region.id || "region")}:floor:${String(source.key || i)}:${p}`,
                        signature,
                        triangulation: null,
                        mesh: null,
                        tint: Number.isFinite(source.tint) ? Number(source.tint) : 0xffffff,
                        alpha: 1,
                        baseZ: Number.isFinite(source.baseZ) ? Number(source.baseZ) : this.getLayerBaseZForLevel(regionLevel),
                        texture: source.texture || null,
                        textureBounds: source.textureBounds || null,
                        textureRepeat: source.textureRepeat || null,
                        texturePath: source.texturePath || "",
                        depthBias: Number.isFinite(source.depthBias) ? Number(source.depthBias) - 0.05 : FLOOR_VISUAL_DEPTH_BIAS_UNITS - 0.05,
                        isHoleOverlay: !!source.isHoleOverlay,
                        zIndex: regionLevel * 100000 + out.length,
                        uploadedGeometrySignature: "",
                        uploadedTextureBoundsSignature: "",
                        uploadedTextureRepeatSignature: "",
                        outer: poly.outer,
                        holes
                    });
                }
            }
            return out;
        }

        renderBuildingInteriorOverlayFloorEntry(source, overlay, activeKeys) {
            if (!source || !overlay || !(activeKeys instanceof Set)) return 0;
            let entry = this.buildingInteriorOverlayFloorMeshes instanceof Map
                ? this.buildingInteriorOverlayFloorMeshes.get(source.key)
                : null;
            const textureBoundsSignature = this.getFloorVisualTextureBoundsSignature(source.textureBounds);
            const textureRepeatSignature = this.getFloorVisualTextureRepeatSignature(source.textureRepeat);
            if (
                !entry ||
                entry.signature !== source.signature ||
                entry.texturePath !== source.texturePath ||
                entry.uploadedTextureBoundsSignature !== textureBoundsSignature ||
                entry.uploadedTextureRepeatSignature !== textureRepeatSignature
            ) {
                if (entry && entry.mesh) {
                    if (entry.mesh.parent) entry.mesh.parent.removeChild(entry.mesh);
                    if (typeof entry.mesh.destroy === "function") {
                        entry.mesh.destroy({ children: false, texture: false, baseTexture: false });
                    }
                }
                const triangulation = triangulateFloorVisualPolygon(source.outer, source.holes);
                if (!triangulation) return 0;
                entry = {
                    ...source,
                    triangulation
                };
                entry.mesh = this.createFloorVisualMesh(entry);
                if (!entry.mesh) return 0;
                const foregroundState = this.getBuildingInteriorForegroundState();
                if (foregroundState) entry.mesh.state = foregroundState;
                this.uploadFloorVisualMeshGeometry(entry);
                if (!(this.buildingInteriorOverlayFloorMeshes instanceof Map)) {
                    this.buildingInteriorOverlayFloorMeshes = new Map();
                }
                this.buildingInteriorOverlayFloorMeshes.set(source.key, entry);
            } else {
                entry.tint = source.tint;
                entry.alpha = source.alpha;
                entry.baseZ = source.baseZ;
                entry.depthBias = source.depthBias;
                entry.textureRepeat = source.textureRepeat;
                entry.texturePath = source.texturePath;
                entry.texture = source.texture || null;
                entry.textureBounds = source.textureBounds || null;
                entry.isHoleOverlay = !!source.isHoleOverlay;
            }
            if (entry.mesh.parent !== overlay) overlay.addChild(entry.mesh);
            entry.mesh.zIndex = source.zIndex;
            const foregroundState = this.getBuildingInteriorForegroundState();
            if (foregroundState) entry.mesh.state = foregroundState;
            this.updateFloorVisualMesh(entry);
            entry.mesh.visible = true;
            if (Object.prototype.hasOwnProperty.call(entry.mesh, "renderable")) entry.mesh.renderable = true;
            activeKeys.add(source.key);
            return 1;
        }

        renderBuildingInteriorOverlayFloor(ctx, region, trigger, overlay, activeKeys) {
            const sources = this.collectBuildingInteriorOverlayFloorEntries(ctx, region, trigger);
            let rendered = 0;
            for (let i = 0; i < sources.length; i++) {
                rendered += this.renderBuildingInteriorOverlayFloorEntry(sources[i], overlay, activeKeys);
            }
            return rendered;
        }

        shouldRenderBuildingInteriorOverlayWall(wall, region, trigger, ctx, wizardRef) {
            if (!wall || wall.type !== "wallSection" || wall.gone || wall.vanishing) return false;
            if (this.isBuildingCutawayDoorItem(wall)) return false;
            const wallLayer = this.getLayerIndexForObject(wall, this.getLayerIndexFromValue(region && region.level, 0));
            if (wallLayer !== this.getLayerIndexFromValue(region && region.level, 0)) return false;
            return true;
        }

        shouldFlattenBuildingInteriorOverlayWall(wall, ctx, wizardRef) {
            if (!wall || wall.type !== "wallSection") return false;
            if (typeof wall.isVisibleInMazeModeFacingRule !== "function") return true;
            const facesSame = wall.isVisibleInMazeModeFacingRule({
                worldToScreenFn: (pt) => this.camera.worldToScreen(
                    Number(pt && pt.x) || 0,
                    Number(pt && pt.y) || 0,
                    0
                ),
                viewscale: this.camera.viewscale,
                xyratio: this.camera.xyratio,
                player: wizardRef || (ctx && ctx.wizard) || global.wizard || null
            });
            return !facesSame;
        }

        renderBuildingInteriorOverlayWall(wall, key, ctx, overlay, activeKeys, options = {}) {
            if (!wall || !overlay || !(activeKeys instanceof Set)) return 0;
            const foregroundState = this.getBuildingInteriorForegroundState();
            if (!(this.buildingInteriorOverlayWallMeshes instanceof Map)) {
                this.buildingInteriorOverlayWallMeshes = new Map();
            }
            let entry = this.buildingInteriorOverlayWallMeshes.get(key);
            const topFaceOnly = !!(options && options.topFaceOnly);
            const meshOptions = {
                name: "buildingInteriorOverlayWallMesh",
                camera: this.camera,
                app: (ctx && ctx.app) || global.app || null,
                viewscale: this.camera && Number.isFinite(this.camera.viewscale) ? this.camera.viewscale : 1,
                xyratio: this.camera && Number.isFinite(this.camera.xyratio) ? this.camera.xyratio : 1,
                mazeMode: false,
                topFaceOnly,
                bottomFaceOnly: false,
                nowMs: Number.isFinite(ctx && ctx.renderNowMs) ? Number(ctx.renderNowMs) : Date.now(),
                tint: wall.pixiSprite && Number.isFinite(wall.pixiSprite.tint) ? wall.pixiSprite.tint : 0xFFFFFF,
                alpha: wall.pixiSprite && Number.isFinite(wall.pixiSprite.alpha) ? wall.pixiSprite.alpha : 1,
                brightness: Number.isFinite(wall.brightness) ? Number(wall.brightness) : 0
            };
            let mesh = entry && entry.mesh;
            if (mesh && typeof wall.updateDepthMeshDisplayObject === "function") {
                mesh = wall.updateDepthMeshDisplayObject(mesh, meshOptions);
            } else if (typeof wall.createDepthMeshDisplayObject === "function") {
                mesh = wall.createDepthMeshDisplayObject(meshOptions);
            }
            if (!mesh) return 0;
            if (!entry) {
                entry = { mesh, wall };
                this.buildingInteriorOverlayWallMeshes.set(key, entry);
            } else {
                entry.mesh = mesh;
                entry.wall = wall;
            }
            if (foregroundState) mesh.state = foregroundState;
            mesh.zIndex = 1000000000;
            if (mesh.parent !== overlay) overlay.addChild(mesh);
            mesh.visible = true;
            if (Object.prototype.hasOwnProperty.call(mesh, "renderable")) mesh.renderable = true;
            activeKeys.add(key);
            return 1;
        }

        shouldRenderBuildingInteriorOverlayItem(item, region, entry, ctx, wizardRef) {
            if (!item || item.gone || item.vanishing || item.type === "wallSection" || item.type === "roof") return false;
            if (this.isCharacterRenderItem(item) || item === wizardRef) return false;
            if (!this.isScriptVisible(item)) return false;
            const regionLevel = this.getLayerIndexFromValue(region && region.level, 0);
            const itemLevel = Number.isFinite(entry && entry.level)
                ? this.getLayerIndexFromValue(entry.level, regionLevel)
                : this.getLayerIndexForObject(item, regionLevel);
            return itemLevel === regionLevel;
        }

        renderBuildingInteriorOverlayItem(item, key, ctx, overlay, activeKeys, region, entry = null) {
            if (!item || !overlay || !(activeKeys instanceof Set)) return 0;
            if (this.isWallMountedSpatialItem(item) && !this.resolveMountedWallSectionForItem(item)) return 0;
            const regionLevel = this.getLayerIndexFromValue(region && region.level, 0);
            if (typeof item.updateSpriteAnimation === "function") item.updateSpriteAnimation();
            item._renderLayerIndex = regionLevel;
            item._renderLayerAlpha = 1;
            item._renderLayerBaseZ = this.isCharacterRenderItem(item)
                ? 0
                : this.getLayerBaseZForLevel(regionLevel);
            let displayObj = null;
            if (typeof item.updateDepthBillboardMesh === "function") {
                displayObj = item.updateDepthBillboardMesh(ctx, this.camera, {
                    alphaCutoff: TREE_ALPHA_CUTOFF,
                    mazeMode: false,
                    player: (ctx && ctx.wizard) || global.wizard || null
                });
                if (displayObj) item._renderingDepthMesh = displayObj;
            }
            if (!displayObj && item.pixiSprite) {
                this.applySpriteTransform(item);
                displayObj = item.pixiSprite;
            }
            if (!displayObj) return 0;
            const foregroundState = this.getBuildingInteriorForegroundState();
            const displayObjects = [];
            const underlayMesh = item._compositeUnderlayMesh;
            if (underlayMesh && !underlayMesh.destroyed && item._compositeUnderlayShouldRender) {
                if (foregroundState && Object.prototype.hasOwnProperty.call(underlayMesh, "state")) underlayMesh.state = foregroundState;
                underlayMesh.zIndex = 499999999;
                if (underlayMesh.parent !== overlay) overlay.addChild(underlayMesh);
                underlayMesh.visible = true;
                underlayMesh.alpha = this.getScriptDisplayAlpha(item);
                if (Object.prototype.hasOwnProperty.call(underlayMesh, "renderable")) underlayMesh.renderable = true;
                displayObjects.push(underlayMesh);
            } else if (underlayMesh && !underlayMesh.destroyed) {
                underlayMesh.visible = false;
                if (Object.prototype.hasOwnProperty.call(underlayMesh, "renderable")) underlayMesh.renderable = false;
            }
            if (foregroundState && Object.prototype.hasOwnProperty.call(displayObj, "state")) displayObj.state = foregroundState;
            displayObj.zIndex = 500000000;
            if (displayObj.parent !== overlay) overlay.addChild(displayObj);
            displayObj.visible = true;
            displayObj.alpha = this.getScriptDisplayAlpha(item);
            if (Object.prototype.hasOwnProperty.call(displayObj, "renderable")) displayObj.renderable = true;
            this.applyScriptBrightness(item, displayObj);
            this.applyFrozenTint(item, displayObj);
            displayObjects.push(displayObj);
            if (!(this.buildingInteriorOverlayItemMeshes instanceof Map)) {
                this.buildingInteriorOverlayItemMeshes = new Map();
            }
            this.buildingInteriorOverlayItemMeshes.set(key, { item, displayObjects });
            activeKeys.add(key);
            return 1;
        }

        getBuildingInteriorRegionForCharacter(cutawayState, character) {
            if (!cutawayState || !character || !Number.isFinite(character.x) || !Number.isFinite(character.y)) return null;
            const triggers = Array.isArray(cutawayState.triggers) ? cutawayState.triggers : [];
            const characterLevel = this.getLayerIndexForObject(
                character,
                this.getLayerIndexFromValue(cutawayState.wizardLayer, 0)
            );
            for (let i = 0; i < triggers.length; i++) {
                const trigger = triggers[i];
                const region = trigger && trigger.activeInteriorRegion;
                if (!region) continue;
                if (this.getLayerIndexFromValue(region.level, 0) !== characterLevel) continue;
                const contains = region.kind === "floorFragment" && region.fragment
                    ? (isPointInsideFloorVisibilityFragment(region.fragment, character.x, character.y) || isPointSupportedByFloorFragment(region.fragment, character.x, character.y))
                    : floorVisualPolygonsContainPoint([region.polygon], character.x, character.y);
                if (contains) return { trigger, region };
            }
            return null;
        }

        getBuildingInteriorOverlayCharacterKey(character, fallbackIndex = 0) {
            if (!character) return `character:${fallbackIndex}`;
            if (character === global.wizard) return "wizard";
            if (Number.isInteger(character.id)) return `id:${character.id}`;
            if (typeof character.scriptingName === "string" && character.scriptingName.length > 0) {
                return `script:${character.scriptingName}`;
            }
            if (typeof character.type === "string" && Number.isFinite(character.x) && Number.isFinite(character.y)) {
                return `${character.type}:${Number(character.x).toFixed(3)},${Number(character.y).toFixed(3)}:${fallbackIndex}`;
            }
            return `character:${fallbackIndex}`;
        }

        collectBuildingInteriorOverlayCharacters(ctx, renderItems = []) {
            const out = [];
            const seen = new Set();
            const push = (item) => {
                if (!item || seen.has(item)) return;
                if (item.gone || item.vanishing) return;
                const isCharacter = this.isCharacterRenderItem(item);
                if (!isCharacter && item !== ((ctx && ctx.wizard) || global.wizard || null)) return;
                seen.add(item);
                out.push(item);
            };
            push((ctx && ctx.wizard) || global.wizard || null);
            const items = Array.isArray(renderItems) ? renderItems : [];
            for (let i = 0; i < items.length; i++) push(items[i]);
            return out;
        }

        ensureBuildingInteriorOverlayCharacterProxy(character, key) {
            if (!character || typeof global.StaticObject !== "function" || !global.StaticObject.prototype) return null;
            if (!(this.buildingInteriorOverlayCharacterProxies instanceof Map)) {
                this.buildingInteriorOverlayCharacterProxies = new Map();
            }
            let proxy = this.buildingInteriorOverlayCharacterProxies.get(key);
            if (!proxy) {
                proxy = {
                    type: "buildingInteriorCharacterOverlay",
                    category: "character",
                    rotationAxis: "upright",
                    placementRotation: 0,
                    map: character.map || global.map || null,
                    x: 0,
                    y: 0,
                    z: 0,
                    width: 1,
                    height: 1,
                    pixiSprite: null,
                    gone: false,
                    vanishing: false,
                    visible: true,
                    _depthBillboardMesh: null,
                    _depthBillboardWorldPositions: null,
                    _depthBillboardLastSignature: "",
                    _depthBillboardLastUvSignature: "",
                    _depthBillboardMeshMode: ""
                };
                const staticProto = global.StaticObject.prototype;
                if (typeof staticProto.ensureDepthBillboardMesh === "function") {
                    proxy.ensureDepthBillboardMesh = staticProto.ensureDepthBillboardMesh;
                }
                if (typeof staticProto.updateDepthBillboardUvsForTexture === "function") {
                    proxy.updateDepthBillboardUvsForTexture = staticProto.updateDepthBillboardUvsForTexture;
                }
                if (typeof staticProto.updateDepthBillboardMesh === "function") {
                    proxy.updateDepthBillboardMesh = staticProto.updateDepthBillboardMesh;
                }
                this.buildingInteriorOverlayCharacterProxies.set(key, proxy);
            }
            return proxy;
        }

        syncBuildingInteriorOverlayCharacterProxy(proxy, character, ctx = null) {
            if (!proxy || !character) return false;
            const sprite = character.pixiSprite || null;
            if (!sprite || !sprite.texture) return false;
            proxy.pixiSprite = sprite;
            proxy.map = character.map || global.map || null;
            const wizardRef = (ctx && ctx.wizard) || global.wizard || null;
            const isWizard = character === wizardRef;
            const renderPos = isWizard && typeof character.getInterpolatedPosition === "function"
                ? character.getInterpolatedPosition(Number.isFinite(ctx && ctx.renderAlpha) ? Number(ctx.renderAlpha) : 1)
                : null;
            proxy.x = Number.isFinite(renderPos && renderPos.x)
                ? Number(renderPos.x)
                : (Number.isFinite(character.x) ? Number(character.x) : 0);
            proxy.y = Number.isFinite(renderPos && renderPos.y)
                ? Number(renderPos.y)
                : (Number.isFinite(character.y) ? Number(character.y) : 0);
            proxy.z = Number.isFinite(renderPos && renderPos.z)
                ? (Number(renderPos.z) - WIZARD_BODY_LOWER_UNITS)
                : (Number.isFinite(character.z) ? Number(character.z) : 0);
            proxy.width = Number.isFinite(character.width) ? Number(character.width) : 1;
            proxy.height = Number.isFinite(character.height) ? Number(character.height) : 1;
            proxy._renderLayerBaseZ = isWizard
                ? (Number.isFinite(character.currentLayerBaseZ)
                    ? Number(character.currentLayerBaseZ)
                    : this.getLayerBaseZForLevel(this.getLayerIndexFromValue(character.currentLayer, 0)))
                : (this.isCharacterRenderItem(character)
                    ? 0
                    : this.getLayerBaseZForObject(character, 0));
            proxy._renderDepthBias = -0.04;
            return true;
        }

        renderBuildingInteriorOverlayCharacter(character, key, ctx, overlay, activeKeys) {
            if (!character || !overlay || !(activeKeys instanceof Set)) return 0;
            const proxy = this.ensureBuildingInteriorOverlayCharacterProxy(character, key);
            if (!this.syncBuildingInteriorOverlayCharacterProxy(proxy, character, ctx)) return 0;
            if (typeof proxy.updateDepthBillboardMesh !== "function") return 0;
            const mesh = proxy.updateDepthBillboardMesh(ctx, this.camera, {
                alphaCutoff: TREE_ALPHA_CUTOFF,
                mazeMode: false,
                player: (ctx && ctx.wizard) || global.wizard || null
            });
            if (!mesh) return 0;
            const foregroundState = this.getBuildingInteriorForegroundState();
            if (foregroundState) mesh.state = foregroundState;
            mesh.zIndex = 500000000;
            if (mesh.parent !== overlay) overlay.addChild(mesh);
            mesh.visible = true;
            if (Object.prototype.hasOwnProperty.call(mesh, "renderable")) mesh.renderable = true;
            activeKeys.add(key);
            return 1;
        }

        renderBuildingInteriorOverlayCharacters(ctx, cutawayState, overlay, renderItems, activeCharacterKeys) {
            const characters = this.collectBuildingInteriorOverlayCharacters(ctx, renderItems);
            let rendered = 0;
            for (let i = 0; i < characters.length; i++) {
                const character = characters[i];
                if (!this.getBuildingInteriorRegionForCharacter(cutawayState, character)) continue;
                const key = this.getBuildingInteriorOverlayCharacterKey(character, i);
                rendered += this.renderBuildingInteriorOverlayCharacter(character, key, ctx, overlay, activeCharacterKeys);
            }
            return rendered;
        }

        renderActiveBuildingInteriorOverlay(ctx, cutawayState, container, renderItems = []) {
            const triggers = Array.isArray(cutawayState && cutawayState.triggers) ? cutawayState.triggers : [];
            const overlay = this.ensureBuildingInteriorOverlayContainer(container);
            const activeFloorKeys = new Set();
            const activeWallKeys = new Set();
            const activeItemKeys = new Set();
            const activeCharacterKeys = new Set();
            if (!overlay || triggers.length === 0) {
                this.hideInactiveBuildingInteriorOverlayMeshes(activeFloorKeys, activeWallKeys, activeItemKeys, activeCharacterKeys);
                this.hideBuildingInteriorOverlayTexture();
                this.setFrameMetric("objects3dBuildingInteriorPromoted", 0);
                return 0;
            }
            const wizardRef = (ctx && ctx.wizard) || global.wizard || null;
            let rendered = 0;
            for (let i = 0; i < triggers.length; i++) {
                const trigger = triggers[i];
                const activeRegion = trigger && trigger.activeInteriorRegion;
                const regions = this.getBuildingInteriorOverlayRegionsForTrigger(trigger);
                if (!activeRegion || regions.length === 0) continue;
                const activeRegionId = typeof activeRegion.id === "string" ? activeRegion.id : "";
                for (let r = 0; r < regions.length; r++) {
                    const region = regions[r];
                    if (!region) continue;
                    const isActiveRegion = region === activeRegion || (
                        activeRegionId &&
                        typeof region.id === "string" &&
                        region.id === activeRegionId
                    );
                    rendered += this.renderBuildingInteriorOverlayFloor(ctx, region, trigger, overlay, activeFloorKeys);
                    const entries = Array.isArray(region.staticObjects) ? region.staticObjects : [];
                    for (let j = 0; j < entries.length; j++) {
                        const entry = entries[j];
                        const wall = entry && entry.item;
                        if (!this.shouldRenderBuildingInteriorOverlayWall(wall, region, trigger, ctx, wizardRef)) continue;
                        const topFaceOnly = isActiveRegion
                            ? this.shouldFlattenBuildingInteriorOverlayWall(wall, ctx, wizardRef)
                            : false;
                        const key = `${String(trigger.buildingId || "building")}:${String(region.id || "region")}:wall:${Number.isInteger(wall.id) ? wall.id : j}`;
                        rendered += this.renderBuildingInteriorOverlayWall(wall, key, ctx, overlay, activeWallKeys, { topFaceOnly });
                    }
                    for (let j = 0; j < entries.length; j++) {
                        const entry = entries[j];
                        const item = entry && entry.item;
                        if (!this.shouldRenderBuildingInteriorOverlayItem(item, region, entry, ctx, wizardRef)) continue;
                        const itemKey = Number.isInteger(item.id)
                            ? item.id
                            : (typeof item.scriptingName === "string" && item.scriptingName.length > 0
                                ? item.scriptingName
                                : j);
                        const key = `${String(trigger.buildingId || "building")}:${String(region.id || "region")}:item:${String(itemKey)}`;
                        rendered += this.renderBuildingInteriorOverlayItem(item, key, ctx, overlay, activeItemKeys, region, entry);
                    }
                }
            }
            rendered += this.renderBuildingInteriorOverlayCharacters(ctx, cutawayState, overlay, renderItems, activeCharacterKeys);
            this.hideInactiveBuildingInteriorOverlayMeshes(activeFloorKeys, activeWallKeys, activeItemKeys, activeCharacterKeys);
            this.presentBuildingInteriorOverlayTexture(
                ctx,
                overlay,
                container,
                activeFloorKeys.size > 0 || activeWallKeys.size > 0 || activeItemKeys.size > 0 || activeCharacterKeys.size > 0
            );
            this.setFrameMetric("objects3dBuildingInteriorPromoted", rendered);
            return rendered;
        }

        hideInactiveBuildingInteriorOverlayMeshes(activeFloorKeys, activeWallKeys, activeItemKeys = null, activeCharacterKeys = null) {
            const floorKeys = activeFloorKeys instanceof Set ? activeFloorKeys : new Set();
            const wallKeys = activeWallKeys instanceof Set ? activeWallKeys : new Set();
            const itemKeys = activeItemKeys instanceof Set ? activeItemKeys : new Set();
            const characterKeys = activeCharacterKeys instanceof Set ? activeCharacterKeys : new Set();
            if (this.buildingInteriorOverlayFloorMeshes instanceof Map) {
                for (const [key, entry] of this.buildingInteriorOverlayFloorMeshes.entries()) {
                    if (floorKeys.has(key)) continue;
                    if (entry && entry.mesh) {
                        entry.mesh.visible = false;
                        if (Object.prototype.hasOwnProperty.call(entry.mesh, "renderable")) entry.mesh.renderable = false;
                    }
                }
            }
            if (this.buildingInteriorOverlayWallMeshes instanceof Map) {
                for (const [key, entry] of this.buildingInteriorOverlayWallMeshes.entries()) {
                    if (wallKeys.has(key)) continue;
                    if (entry && entry.mesh) {
                        entry.mesh.visible = false;
                        if (Object.prototype.hasOwnProperty.call(entry.mesh, "renderable")) entry.mesh.renderable = false;
                    }
                }
            }
            if (this.buildingInteriorOverlayItemMeshes instanceof Map) {
                for (const [key, entry] of this.buildingInteriorOverlayItemMeshes.entries()) {
                    if (itemKeys.has(key)) continue;
                    const displayObjects = Array.isArray(entry && entry.displayObjects) ? entry.displayObjects : [];
                    for (let i = 0; i < displayObjects.length; i++) {
                        const obj = displayObjects[i];
                        if (!obj) continue;
                        obj.visible = false;
                        if (Object.prototype.hasOwnProperty.call(obj, "renderable")) obj.renderable = false;
                    }
                }
            }
            if (this.buildingInteriorOverlayCharacterProxies instanceof Map) {
                for (const [key, proxy] of this.buildingInteriorOverlayCharacterProxies.entries()) {
                    if (characterKeys.has(key)) continue;
                    if (proxy && proxy._depthBillboardMesh) {
                        proxy._depthBillboardMesh.visible = false;
                        if (Object.prototype.hasOwnProperty.call(proxy._depthBillboardMesh, "renderable")) {
                            proxy._depthBillboardMesh.renderable = false;
                        }
                    }
                }
            }
            if (this.buildingInteriorOverlayContainer) {
                const anyActive = floorKeys.size > 0 || wallKeys.size > 0 || itemKeys.size > 0 || characterKeys.size > 0;
                this.buildingInteriorOverlayContainer.visible = anyActive;
                if (Object.prototype.hasOwnProperty.call(this.buildingInteriorOverlayContainer, "renderable")) {
                    this.buildingInteriorOverlayContainer.renderable = anyActive;
                }
            }
        }

        ensureBuildingInteriorOverlayRenderTexture(ctx = null) {
            if (typeof PIXI === "undefined" || !PIXI.RenderTexture || !PIXI.Sprite) return null;
            const appRef = (ctx && ctx.app && ctx.app.renderer)
                ? ctx.app
                : ((typeof app !== "undefined" && app && app.renderer) ? app : (global.app || null));
            const renderer = appRef && appRef.renderer ? appRef.renderer : null;
            if (!renderer) return null;
            const screen = (appRef && appRef.screen) || (renderer && renderer.screen) || {};
            const width = Math.max(1, Math.ceil(Number(screen.width) || Number(renderer.width) || 1));
            const height = Math.max(1, Math.ceil(Number(screen.height) || Number(renderer.height) || 1));
            const currentSize = this.buildingInteriorOverlaySize || null;
            if (
                !this.buildingInteriorOverlayRenderTexture ||
                !currentSize ||
                currentSize.width !== width ||
                currentSize.height !== height
            ) {
                const oldTexture = this.buildingInteriorOverlayRenderTexture;
                this.buildingInteriorOverlayRenderTexture = PIXI.RenderTexture.create({
                    width,
                    height,
                    resolution: 1
                });
                this.ensureRenderTextureDepthAttachment(
                    this.buildingInteriorOverlayRenderTexture,
                    "building interior overlay render texture"
                );
                this.buildingInteriorOverlaySize = { width, height };
                if (oldTexture && typeof oldTexture.destroy === "function") {
                    oldTexture.destroy(true);
                }
            } else {
                this.ensureRenderTextureDepthAttachment(
                    this.buildingInteriorOverlayRenderTexture,
                    "building interior overlay render texture"
                );
            }
            if (!this.buildingInteriorOverlaySprite || this.buildingInteriorOverlaySprite.destroyed) {
                this.buildingInteriorOverlaySprite = new PIXI.Sprite(this.buildingInteriorOverlayRenderTexture);
                this.buildingInteriorOverlaySprite.name = "buildingInteriorOverlayTexture";
                this.buildingInteriorOverlaySprite.interactive = false;
            }
            const sprite = this.buildingInteriorOverlaySprite;
            sprite.texture = this.buildingInteriorOverlayRenderTexture;
            if (sprite.anchor && typeof sprite.anchor.set === "function") {
                sprite.anchor.set(0, 0);
            }
            sprite.position.set(0, height);
            sprite.width = width;
            sprite.height = height;
            if (sprite.scale && Number.isFinite(sprite.scale.y)) {
                sprite.scale.y = -Math.abs(sprite.scale.y);
            }
            sprite.alpha = 1;
            sprite.zIndex = BUILDING_INTERIOR_OVERLAY_Z;
            return {
                renderer,
                texture: this.buildingInteriorOverlayRenderTexture,
                sprite,
                width,
                height
            };
        }

        hideBuildingInteriorOverlayTexture() {
            if (this.buildingInteriorOverlaySprite) {
                this.buildingInteriorOverlaySprite.visible = false;
                if (Object.prototype.hasOwnProperty.call(this.buildingInteriorOverlaySprite, "renderable")) {
                    this.buildingInteriorOverlaySprite.renderable = false;
                }
            }
            if (this.buildingInteriorOverlayContainer) {
                this.buildingInteriorOverlayContainer.visible = false;
                if (Object.prototype.hasOwnProperty.call(this.buildingInteriorOverlayContainer, "renderable")) {
                    this.buildingInteriorOverlayContainer.renderable = false;
                }
            }
        }

        presentBuildingInteriorOverlayTexture(ctx, overlay, container, active) {
            if (!active || !overlay || !container) {
                this.hideBuildingInteriorOverlayTexture();
                return null;
            }
            const resources = this.ensureBuildingInteriorOverlayRenderTexture(ctx);
            if (!resources || !resources.renderer || !resources.texture || !resources.sprite) {
                return null;
            }
            const sprite = resources.sprite;
            sprite.visible = false;
            if (Object.prototype.hasOwnProperty.call(sprite, "renderable")) sprite.renderable = false;
            overlay.visible = true;
            if (Object.prototype.hasOwnProperty.call(overlay, "renderable")) overlay.renderable = true;
            let renderError = null;
            try {
                this.clearDepthTestedRenderTarget(resources, "building interior overlay render target");
                resources.renderer.render(overlay, resources.texture, false);
            } catch (err) {
                renderError = err;
                try {
                    this.clearDepthTestedRenderTarget(resources, "building interior overlay render target");
                    resources.renderer.render({
                        container: overlay,
                        target: resources.texture,
                        clear: false
                    });
                    renderError = null;
                } catch (err2) {
                    renderError = err2;
                }
            }
            overlay.visible = false;
            if (Object.prototype.hasOwnProperty.call(overlay, "renderable")) overlay.renderable = false;
            if (renderError) {
                this.hideBuildingInteriorOverlayTexture();
                throw renderError;
            }
            const targetContainer = (this.layers && this.layers.ui) || container;
            if (Object.prototype.hasOwnProperty.call(targetContainer, "sortableChildren")) targetContainer.sortableChildren = true;
            if (sprite.parent !== targetContainer) targetContainer.addChild(sprite);
            sprite.visible = true;
            if (Object.prototype.hasOwnProperty.call(sprite, "renderable")) sprite.renderable = true;
            if (Object.prototype.hasOwnProperty.call(targetContainer, "sortDirty")) targetContainer.sortDirty = true;
            return sprite;
        }

        getCurrentFloorDarknessLayer() {
            if (Number.isFinite(this._fallRevealLayer)) {
                return this.getLayerIndexFromValue(this._fallRevealLayer, 0);
            }
            if (Number.isFinite(this._lastRenderedWizardLayer)) {
                return this.getLayerIndexFromValue(this._lastRenderedWizardLayer, 0);
            }
            return this.getLayerIndexFromValue(global && global.wizard ? global.wizard.currentLayer : 0, 0);
        }

        getLayerDarknessMultiplier(level) {
            const layer = this.getLayerIndexFromValue(level, 0);
            const currentLayer = this.getCurrentFloorDarknessLayer();
            return layer < currentLayer ? FLOOR_BELOW_CURRENT_DARKNESS_MULTIPLIER : 1;
        }

        multiplyTint(tint, multiplier) {
            const baseTint = Number.isFinite(tint) ? Math.max(0, Math.min(0xffffff, Math.floor(tint))) : 0xffffff;
            const m = Number.isFinite(multiplier) ? Math.max(0, Math.min(1, Number(multiplier))) : 1;
            const r = Math.round(((baseTint >> 16) & 0xff) * m);
            const g = Math.round(((baseTint >> 8) & 0xff) * m);
            const b = Math.round((baseTint & 0xff) * m);
            return (r << 16) | (g << 8) | b;
        }

        getLayerDarkenedTint(tint, level) {
            return this.multiplyTint(tint, this.getLayerDarknessMultiplier(level));
        }

        applyLayerDarknessToDisplayObject(displayObj, multiplier = 1) {
            if (!displayObj || typeof displayObj !== "object") return;
            const m = Number.isFinite(multiplier) ? Math.max(0, Math.min(1, Number(multiplier))) : 1;
            const tintStateKey = "__renderingLayerDarknessTintState";
            const uniformStateKey = "__renderingLayerDarknessUniformState";
            const applyOne = (obj) => {
                if (!obj || typeof obj !== "object") return;
                if (Number.isFinite(obj.tint)) {
                    const state = obj[tintStateKey];
                    const currentTint = Math.max(0, Math.min(0xffffff, Math.floor(Number(obj.tint))));
                    const hasState = !!(
                        state &&
                        Number.isFinite(state.baseTint) &&
                        Number.isFinite(state.appliedTint)
                    );
                    const baseTint = hasState && currentTint === Math.floor(state.appliedTint)
                        ? Math.max(0, Math.min(0xffffff, Math.floor(Number(state.baseTint))))
                        : currentTint;
                    if (m < 0.999) {
                        const appliedTint = this.multiplyTint(baseTint, m);
                        obj.tint = appliedTint;
                        obj[tintStateKey] = { baseTint, appliedTint };
                    } else {
                        if (hasState && currentTint === Math.floor(state.appliedTint)) {
                            obj.tint = baseTint;
                        }
                        delete obj[tintStateKey];
                    }
                }

                const uniforms = obj.shader && obj.shader.uniforms ? obj.shader.uniforms : null;
                const uTint = uniforms && uniforms.uTint && uniforms.uTint.length >= 3 ? uniforms.uTint : null;
                if (uTint) {
                    const state = obj[uniformStateKey];
                    const current = [Number(uTint[0]) || 0, Number(uTint[1]) || 0, Number(uTint[2]) || 0];
                    const hasState = !!(
                        state &&
                        Array.isArray(state.base) &&
                        Array.isArray(state.applied) &&
                        state.base.length >= 3 &&
                        state.applied.length >= 3
                    );
                    const matchesApplied = hasState &&
                        Math.abs(current[0] - Number(state.applied[0])) < 1e-6 &&
                        Math.abs(current[1] - Number(state.applied[1])) < 1e-6 &&
                        Math.abs(current[2] - Number(state.applied[2])) < 1e-6;
                    const base = matchesApplied
                        ? [Number(state.base[0]) || 0, Number(state.base[1]) || 0, Number(state.base[2]) || 0]
                        : current;
                    if (m < 0.999) {
                        uTint[0] = base[0] * m;
                        uTint[1] = base[1] * m;
                        uTint[2] = base[2] * m;
                        obj[uniformStateKey] = {
                            base,
                            applied: [uTint[0], uTint[1], uTint[2]]
                        };
                    } else {
                        if (matchesApplied) {
                            uTint[0] = base[0];
                            uTint[1] = base[1];
                            uTint[2] = base[2];
                        }
                        delete obj[uniformStateKey];
                    }
                }
            };

            applyOne(displayObj);
            const children = Array.isArray(displayObj.children) ? displayObj.children : [];
            for (let i = 0; i < children.length; i++) {
                this.applyLayerDarknessToDisplayObject(children[i], m);
            }
        }

        applyLayerDarknessForItem(item, level, displayObj = null) {
            const layer = Number.isFinite(level)
                ? this.getLayerIndexFromValue(level, 0)
                : this.getLayerIndexForObject(item, 0);
            this.applyLayerDarknessToDisplayObject(displayObj, this.getLayerDarknessMultiplier(layer));
        }

        init(ctx) {
            if (this.initialized) return;
            const parent = (ctx && ctx.gameContainer) || (ctx && ctx.app && ctx.app.stage) || null;
            if (!parent) return;
            parent.addChild(this.layers.root);
            this.layers.root.zIndex = 10000;
            this.initialized = true;
        }

        getCharacterLayer() {
            return (this.layers && (this.layers.depthObjects || this.layers.characters || this.layers.entities)) || null;
        }

        isCharacterRenderItem(item) {
            return !!(item && typeof Character !== "undefined" && item instanceof Character);
        }

        getWizardShadowTexture() {
            if (this._wizardShadowTexture) return this._wizardShadowTexture;
            const canvas = document.createElement("canvas");
            canvas.width = 128;
            canvas.height = 128;
            const ctx2d = canvas.getContext("2d");
            if (!ctx2d) return PIXI.Texture.WHITE;
            const gradient = ctx2d.createRadialGradient(64, 64, 12, 64, 64, 62);
            gradient.addColorStop(0, "rgba(0,0,0,0.34)");
            gradient.addColorStop(0.6, "rgba(0,0,0,0.18)");
            gradient.addColorStop(1, "rgba(0,0,0,0)");
            ctx2d.fillStyle = gradient;
            ctx2d.beginPath();
            ctx2d.ellipse(64, 64, 62, 62, 0, 0, Math.PI * 2);
            ctx2d.fill();
            this._wizardShadowTexture = PIXI.Texture.from(canvas);
            return this._wizardShadowTexture;
        }

        ensureWizardGhostSprite() {
            if (!this.wizardGhostSprite) {
                this.wizardGhostSprite = new PIXI.Sprite(PIXI.Texture.from("/assets/images/ghost.png"));
                this.wizardGhostSprite.name = "renderingWizardGhost";
                this.wizardGhostSprite.anchor.set(0.5, 1);
                this.wizardGhostSprite.visible = false;
                if (Object.prototype.hasOwnProperty.call(this.wizardGhostSprite, "renderable")) {
                    this.wizardGhostSprite.renderable = false;
                }
            }
            return this.wizardGhostSprite;
        }

        ensureWizardShadowProxy() {
            if (!this.wizardShadowSprite) {
                this.wizardShadowSprite = new PIXI.Sprite(this.getWizardShadowTexture());
                this.wizardShadowSprite.name = "renderingWizardShadowSprite";
                this.wizardShadowSprite.anchor.set(0.5, 0.5);
            }
            if (!this.wizardShadowProxy) {
                this.wizardShadowProxy = {
                    type: "wizardShadow",
                    category: "shadow",
                    rotationAxis: "ground",
                    placementRotation: 0,
                    forceDepthTestGround: true,
                    pixiSprite: this.wizardShadowSprite,
                    x: 0,
                    y: 0,
                    z: 0,
                    width: 0.4,
                    height: 0.4,
                    gone: false,
                    vanishing: false,
                    visible: true,
                    tint: 0xFFFFFF,
                    _depthBillboardMesh: null,
                    _depthBillboardWorldPositions: null,
                    _depthBillboardLastSignature: "",
                    _depthBillboardLastUvSignature: "",
                    _depthBillboardMeshMode: ""
                };
                const staticProto = (typeof global.StaticObject === "function" && global.StaticObject.prototype)
                    ? global.StaticObject.prototype
                    : null;
                if (staticProto) {
                    if (typeof staticProto.ensureDepthBillboardMesh === "function") {
                        this.wizardShadowProxy.ensureDepthBillboardMesh = staticProto.ensureDepthBillboardMesh;
                    }
                    if (typeof staticProto.updateDepthBillboardUvsForTexture === "function") {
                        this.wizardShadowProxy.updateDepthBillboardUvsForTexture = staticProto.updateDepthBillboardUvsForTexture;
                    }
                    if (typeof staticProto.updateDepthBillboardMesh === "function") {
                        this.wizardShadowProxy.updateDepthBillboardMesh = staticProto.updateDepthBillboardMesh;
                    }
                }
            }
            return this.wizardShadowProxy;
        }

        setLegacyLayersVisible(visible) {
            const names = [
                "landLayer",
                "roadLayer",
                "gridLayer",
                "neighborDebugLayer",
                "opaqueMeshLayer",
                "objectLayer",
                "roofLayer",
                "characterLayer",
                "projectileLayer",
                "hitboxLayer"
            ];
            for (let i = 0; i < names.length; i++) {
                const layer = global[names[i]];
                if (layer && typeof layer.visible === "boolean") layer.visible = visible;
            }
        }

        getProjectileTexture(projectile) {
            if (!projectile) return null;
            const frames = Array.isArray(projectile.explosionFrames) ? projectile.explosionFrames : null;
            if (frames && frames.length > 0) {
                const rawFrame = Number.isFinite(projectile.explosionFrame)
                    ? Math.floor(projectile.explosionFrame)
                    : 0;
                const frameIndex = ((rawFrame % frames.length) + frames.length) % frames.length;
                const frameTexture = frames[frameIndex];
                if (frameTexture) return frameTexture;
            }
            const imageSrc = (projectile.image && typeof projectile.image.src === "string" && projectile.image.src.length > 0)
                ? projectile.image.src
                : null;
            if (imageSrc) return PIXI.Texture.from(imageSrc);
            const texturePath = (typeof projectile.texturePath === "string" && projectile.texturePath.length > 0)
                ? projectile.texturePath
                : null;
            if (texturePath) return PIXI.Texture.from(texturePath);
            return null;
        }

        renderProjectileParticles(projectile, container, hiddenByMazeLos) {
            if (!projectile) return null;
            const particles = Array.isArray(projectile.snowParticles) ? projectile.snowParticles : null;
            let graphics = projectile.particleGraphics || null;

            if (!particles || particles.length === 0 || hiddenByMazeLos) {
                if (graphics) {
                    graphics.clear();
                    graphics.visible = false;
                    if (graphics.parent) {
                        graphics.parent.removeChild(graphics);
                    }
                }
                return graphics;
            }

            if (!graphics) {
                graphics = new PIXI.Graphics();
                graphics.name = "projectileParticles";
                projectile.particleGraphics = graphics;
            }
            if (graphics.parent !== container) {
                container.addChild(graphics);
            }

            graphics.clear();
            graphics.visible = true;
            graphics.zIndex = 2;

            for (let i = 0; i < particles.length; i++) {
                const particle = particles[i];
                if (!particle) continue;
                const lifeMs = Math.max(1, Number(particle.lifeMs) || 1);
                const ageMs = Math.max(0, Number(particle.ageMs) || 0);
                const lifeProgress = Math.max(0, Math.min(1, ageMs / lifeMs));
                const alpha = Math.max(0, (Number(particle.alpha) || 0) * (1 - lifeProgress));
                if (alpha <= 0.01) continue;
                const baseSize = Math.max(1, Number(particle.size) || 1);
                const shrink = Math.max(0, Math.min(1, Number(particle.shrink) || 0));
                const radiusPx = Math.max(0.7, baseSize * (1 - (lifeProgress * shrink)));
                const projectileBaseZ = this.getProjectileVisualBaseZ(projectile);
                const screenPoint = this.camera.worldToScreen(
                    Number(particle.x) || 0,
                    Number(particle.y) || 0,
                    projectileBaseZ + Math.max(0, Number(particle.z) || 0)
                );
                graphics.beginFill(Number.isFinite(particle.color) ? Number(particle.color) : 0xeaf7ff, alpha);
                graphics.drawCircle(screenPoint.x, screenPoint.y, radiusPx);
                graphics.endFill();
            }

            return graphics;
        }

        getProjectileVisualProgress(projectile) {
            if (!projectile) return 0;
            if (Number.isFinite(projectile.visualProgress)) {
                return Math.max(0, Math.min(1, Number(projectile.visualProgress)));
            }
            const traveled = Number(projectile.traveledDist);
            const total = Number(projectile.totalDist);
            if (Number.isFinite(traveled) && Number.isFinite(total) && total > 0) {
                return Math.max(0, Math.min(1, traveled / total));
            }
            const ageMs = Number(projectile.ageMs);
            const lifetimeMs = Number(projectile.maxLifetimeMs);
            if (Number.isFinite(ageMs) && Number.isFinite(lifetimeMs) && lifetimeMs > 0) {
                return Math.max(0, Math.min(1, ageMs / lifetimeMs));
            }
            return 0;
        }

        getProjectileVisualBaseZ(projectile) {
            if (!projectile) return 0;
            const startZ = Number(projectile.visualStartZ);
            const targetZ = Number(projectile.visualTargetZ);
            if (Number.isFinite(startZ) && Number.isFinite(targetZ)) {
                const progress = this.getProjectileVisualProgress(projectile);
                return startZ + ((targetZ - startZ) * progress);
            }
            if (Number.isFinite(projectile.visualBaseZ)) return Number(projectile.visualBaseZ);
            return 0;
        }

        getLosVisualSetting(key, fallback) {
            const settings = (typeof LOSVisualSettings !== "undefined")
                ? LOSVisualSettings
                : (global.LOSVisualSettings || null);
            if (!settings || typeof settings !== "object") return fallback;
            return Object.prototype.hasOwnProperty.call(settings, key) ? settings[key] : fallback;
        }

        isLosMazeModeEnabled() {
            return !!this.getLosVisualSetting("mazeMode", false);
        }

        isMazeModeOverlayEligible(ctx) {
            if (!this.mazeModeRenderer) return false;
            if (!this.isLosMazeModeEnabled()) return false;
            const wizard = (ctx && ctx.wizard) ? ctx.wizard : null;
            return !this.isOmnivisionActive(wizard);
        }

        applyMazeModeCompositor(ctx) {
            const overlayEligible = this.isMazeModeOverlayEligible(ctx);
            const wasOverlayActive = !!this.mazeModeOverlayActive;
            if (!this.mazeModeRenderer) {
                this.mazeModeOverlayActive = false;
                this.mazeModeJustActivatedFrame = false;
                return false;
            }

            this.mazeModeOverlayActive = !!this.mazeModeRenderer.apply(this, ctx, {
                enabled: overlayEligible
            });
            this.mazeModeJustActivatedFrame = !!(this.mazeModeOverlayActive && !wasOverlayActive);

            const root = this.layers && this.layers.root ? this.layers.root : null;
            if (!root) return this.mazeModeOverlayActive;
            const bringToTop = (node) => {
                if (node && node.parent === root) root.addChild(node);
            };

            if (this.mazeModeOverlayActive) {
                const maskNode = this.mazeModeRenderer.occlusionMaskGraphics || null;
                const backdropNode = this.mazeModeRenderer.blackBackdropGraphics || null;
                if (maskNode && maskNode.parent === root) root.setChildIndex(maskNode, 0);
                if (backdropNode && backdropNode.parent === root) root.setChildIndex(backdropNode, Math.min(1, root.children.length - 1));
                bringToTop(this.layers.ground);
                bringToTop(this.layers.roadsFloor);
                bringToTop(this.layers.groundObjects);
                bringToTop(this.layers.losShadow);
                bringToTop(this.layers.depthObjects);
                bringToTop(this.layers.characters);
                bringToTop(this.layers.objects3d);
                bringToTop(this.layers.entities);
                bringToTop(this.layers.ui);
                bringToTop(this.layers.scriptMessages);
            } else {
                bringToTop(this.layers.ground);
                bringToTop(this.layers.roadsFloor);
                bringToTop(this.layers.groundObjects);
                bringToTop(this.layers.losShadow);
                bringToTop(this.layers.depthObjects);
                bringToTop(this.layers.characters);
                bringToTop(this.layers.objects3d);
                bringToTop(this.layers.entities);
                bringToTop(this.layers.ui);
                bringToTop(this.layers.scriptMessages);
            }

            return this.mazeModeOverlayActive;
        }

        isOmnivisionActive(wizard) {
            if (!wizard) return false;
            const activeAuras = (Array.isArray(wizard.activeAuras))
                ? wizard.activeAuras
                : ((typeof wizard.activeAura === "string") ? [wizard.activeAura] : []);
            return activeAuras.includes("omnivision");
        }

        isInvisibilityActive(wizard) {
            if (!wizard) return false;
            const activeAuras = (Array.isArray(wizard.activeAuras))
                ? wizard.activeAuras
                : ((typeof wizard.activeAura === "string") ? [wizard.activeAura] : []);
            return activeAuras.includes("invisibility");
        }

        getWizardFacingAngleRad(wizard) {
            if (!wizard) return 0;
            if (Number.isFinite(wizard.smoothedFacingAngleDeg)) {
                return Number(wizard.smoothedFacingAngleDeg) * (Math.PI / 180);
            }
            if (Number.isInteger(wizard.lastDirectionRow)) {
                const rowAngleDegByDirectionIndex = [180, -150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150];
                const rowOffset = Number.isFinite(global.wizardDirectionRowOffset)
                    ? Number(global.wizardDirectionRowOffset)
                    : 0;
                const directionIndex = ((wizard.lastDirectionRow - rowOffset) % 12 + 12) % 12;
                const deg = rowAngleDegByDirectionIndex[directionIndex];
                if (Number.isFinite(deg)) return deg * (Math.PI / 180);
            }
            if (wizard.direction && Number.isFinite(wizard.direction.x) && Number.isFinite(wizard.direction.y)) {
                const mag = Math.hypot(wizard.direction.x, wizard.direction.y);
                if (mag > 1e-6) return Math.atan2(wizard.direction.y, wizard.direction.x);
            }
            return 0;
        }

        resolveInterpolatedItemWorldPosition(item, mapRef) {
            if (!item) return null;
            const interpolated = (typeof item.getInterpolatedPosition === "function")
                ? item.getInterpolatedPosition()
                : null;
            if (interpolated && Number.isFinite(interpolated.x) && Number.isFinite(interpolated.y)) {
                return { x: interpolated.x, y: interpolated.y };
            }
            const alpha = Number.isFinite(global.renderAlpha) ? Math.max(0, Math.min(1, global.renderAlpha)) : 1;
            const x = (Number.isFinite(item.prevX) && Number.isFinite(item.x))
                ? (
                    Number.isFinite(alpha) && mapRef && typeof mapRef.shortestDeltaX === "function"
                        ? (item.prevX + mapRef.shortestDeltaX(item.prevX, item.x) * alpha)
                        : (item.prevX + (item.x - item.prevX) * alpha)
                )
                : item.x;
            const y = (Number.isFinite(item.prevY) && Number.isFinite(item.y))
                ? (
                    Number.isFinite(alpha) && mapRef && typeof mapRef.shortestDeltaY === "function"
                        ? (item.prevY + mapRef.shortestDeltaY(item.prevY, item.y) * alpha)
                        : (item.prevY + (item.y - item.prevY) * alpha)
                )
                : item.y;
            if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
            return { x, y };
        }

        getMountedFaceCentersForItem(item) {
            if (!item) return null;
            const explicitFaceCenters = (
                item.depthBillboardFaceCenters &&
                item.depthBillboardFaceCenters.front &&
                item.depthBillboardFaceCenters.back
            ) ? item.depthBillboardFaceCenters : null;
            if (
                explicitFaceCenters &&
                Number.isFinite(explicitFaceCenters.front.x) &&
                Number.isFinite(explicitFaceCenters.front.y) &&
                Number.isFinite(explicitFaceCenters.back.x) &&
                Number.isFinite(explicitFaceCenters.back.y)
            ) {
                return {
                    front: {
                        x: Number(explicitFaceCenters.front.x),
                        y: Number(explicitFaceCenters.front.y)
                    },
                    back: {
                        x: Number(explicitFaceCenters.back.x),
                        y: Number(explicitFaceCenters.back.y)
                    }
                };
            }
            const getFaceCenters = (typeof global.getMountedWallFaceCentersForObject === "function")
                ? global.getMountedWallFaceCentersForObject
                : null;
            if (!getFaceCenters) return null;
            const resolved = getFaceCenters(item);
            if (
                !resolved ||
                !resolved.front ||
                !resolved.back ||
                !Number.isFinite(resolved.front.x) ||
                !Number.isFinite(resolved.front.y) ||
                !Number.isFinite(resolved.back.x) ||
                !Number.isFinite(resolved.back.y)
            ) {
                return null;
            }
            return {
                front: { x: Number(resolved.front.x), y: Number(resolved.front.y) },
                back: { x: Number(resolved.back.x), y: Number(resolved.back.y) }
            };
        }

        isWallMountedSpatialItem(item) {
            if (!item) return false;
            const category = (typeof item.category === "string") ? item.category.trim().toLowerCase() : "";
            const isDoorOrWindow = (
                category === "windows" ||
                category === "doors" ||
                item.type === "window" ||
                item.type === "door"
            );
            if (!isDoorOrWindow || item.rotationAxis !== "spatial") return false;
            return !!(
                Number.isInteger(item.mountedWallSectionUnitId) ||
                Number.isInteger(item.mountedWallLineGroupId) ||
                Number.isInteger(item.mountedSectionId)
            );
        }

        resolveMountedWallSectionForItem(item) {
            if (!item) return null;
            const wallCtor = global.WallSectionUnit;
            const allSections = (wallCtor && wallCtor._allSections instanceof Map)
                ? wallCtor._allSections
                : null;
            if (!allSections) return null;
            const candidateIds = [
                item.mountedWallSectionUnitId,
                item.mountedSectionId,
                item.mountedWallLineGroupId
            ];
            for (let i = 0; i < candidateIds.length; i++) {
                const id = Number(candidateIds[i]);
                if (!Number.isInteger(id)) continue;
                const section = allSections.get(id) || null;
                if (section && section.type === "wallSection") return section;
            }
            return null;
        }

        getLosVisibilitySamplePointForItem(item, mapRef, observer = null) {
            if (!item) return null;
            if (
                item.isFallenDoorEffect &&
                item._losVisibilitySamplePoint &&
                Number.isFinite(item._losVisibilitySamplePoint.x) &&
                Number.isFinite(item._losVisibilitySamplePoint.y)
            ) {
                return {
                    x: Number(item._losVisibilitySamplePoint.x),
                    y: Number(item._losVisibilitySamplePoint.y)
                };
            }
            const isWallMountedSpatial = this.isWallMountedSpatialItem(item);
            if (isWallMountedSpatial) {
                const faceCenters = this.getMountedFaceCentersForItem(item);
                if (faceCenters) {
                    const refX = (observer && Number.isFinite(observer.x))
                        ? Number(observer.x)
                        : (Number.isFinite(item.x) ? Number(item.x) : 0);
                    const refY = (observer && Number.isFinite(observer.y))
                        ? Number(observer.y)
                        : (Number.isFinite(item.y) ? Number(item.y) : 0);
                    const frontDx = (mapRef && typeof mapRef.shortestDeltaX === "function")
                        ? mapRef.shortestDeltaX(refX, faceCenters.front.x)
                        : (faceCenters.front.x - refX);
                    const frontDy = (mapRef && typeof mapRef.shortestDeltaY === "function")
                        ? mapRef.shortestDeltaY(refY, faceCenters.front.y)
                        : (faceCenters.front.y - refY);
                    const backDx = (mapRef && typeof mapRef.shortestDeltaX === "function")
                        ? mapRef.shortestDeltaX(refX, faceCenters.back.x)
                        : (faceCenters.back.x - refX);
                    const backDy = (mapRef && typeof mapRef.shortestDeltaY === "function")
                        ? mapRef.shortestDeltaY(refY, faceCenters.back.y)
                        : (faceCenters.back.y - refY);
                    const frontDist2 = frontDx * frontDx + frontDy * frontDy;
                    const backDist2 = backDx * backDx + backDy * backDy;
                    const picked = frontDist2 <= backDist2 ? faceCenters.front : faceCenters.back;
                    return { x: picked.x, y: picked.y };
                }
            }
            return this.resolveInterpolatedItemWorldPosition(item, mapRef);
        }

        isWorldPointInLosShadow(worldX, worldY, wizard, mapRef = null) {
            if (!wizard || !Number.isFinite(worldX) || !Number.isFinite(worldY)) return false;
            const state = this.currentLosState;
            if (!state || !state.depth || !Number.isFinite(state.bins) || state.bins < 3) return false;
            const bins = Math.floor(state.bins);
            const depth = state.depth;
            if (!depth || depth.length !== bins) return false;
            const effectiveMap = mapRef || (wizard && wizard.map) || (this.camera && this.camera.map) || global.map || null;
            if (!this.isWorldPointInsideLosShadowLayerFloor(worldX, worldY, wizard, effectiveMap)) return false;
            const dx = (effectiveMap && typeof effectiveMap.shortestDeltaX === "function")
                ? effectiveMap.shortestDeltaX(wizard.x, worldX)
                : (worldX - wizard.x);
            const dy = (effectiveMap && typeof effectiveMap.shortestDeltaY === "function")
                ? effectiveMap.shortestDeltaY(wizard.y, worldY)
                : (worldY - wizard.y);
            const distance = Math.hypot(dx, dy);
            const theta = Math.atan2(dy, dx);
            const twoPi = Math.PI * 2;
            const norm = ((theta + Math.PI) % twoPi + twoPi) % twoPi;
            const binIdx = Math.max(0, Math.min(bins - 1, Math.floor((norm / twoPi) * bins)));
            const losDepth = Number.isFinite(depth[binIdx]) ? Number(depth[binIdx]) : Infinity;
            const losHasForwardFov = !!state.hasForwardFov;
            const losFacingAngle = Number.isFinite(state.facingAngle) ? state.facingAngle : 0;
            const losHalfFovRad = Number.isFinite(state.halfFovRad) ? state.halfFovRad : Math.PI;
            let insideFov = true;
            if (losHasForwardFov) {
                let delta = theta - losFacingAngle;
                while (delta <= -Math.PI) delta += twoPi;
                while (delta > Math.PI) delta -= twoPi;
                insideFov = Math.abs(delta) <= losHalfFovRad;
            }
            const nearReveal = insideFov ? 0 : LOS_NEAR_REVEAL_RADIUS;
            const litDistance = Math.max(nearReveal, losDepth);
            return distance > litDistance;
        }

        isWorldPointInsideLosShadowLayerFloor(worldX, worldY, wizard, mapRef = null) {
            const effectiveMap = mapRef || (wizard && wizard.map) || (this.camera && this.camera.map) || global.map || null;
            if (!effectiveMap || !(effectiveMap.floorsById instanceof Map)) return true;
            const level = this.getLayerIndexFromValue(Number.isFinite(wizard && wizard.currentLayer) ? wizard.currentLayer : 0, 0);
            let sawLayerFloor = false;
            for (const fragment of effectiveMap.floorsById.values()) {
                if (!fragment || fragment._floorEditEmpty === true) continue;
                const fragmentLevel = Number.isFinite(fragment.level)
                    ? this.getLayerIndexFromValue(fragment.level, 0)
                    : 0;
                if (fragmentLevel !== level) continue;
                if (!Array.isArray(fragment.outerPolygon) || fragment.outerPolygon.length < 3) continue;
                sawLayerFloor = true;
                if (isPointSupportedByFloorFragment(fragment, worldX, worldY)) return true;
            }
            return level === 0 && !sawLayerFloor;
        }

        isRadialItemHiddenByLos(item, wizard, mapRef = null) {
            if (!item || !wizard) return false;
            const worldPos = this.getLosVisibilitySamplePointForItem(item, mapRef, wizard);
            if (!worldPos) return false;
            if (!this.isWorldPointInLosShadow(worldPos.x, worldPos.y, wizard, mapRef)) return false;

            const state = this.currentLosState;
            if (!state || !state.depth || !Number.isFinite(state.bins) || state.bins < 3) return true;
            const bins = Math.floor(state.bins);
            const depth = state.depth;
            if (!depth || depth.length !== bins) return true;

            const effectiveMap = mapRef || (wizard && wizard.map) || (this.camera && this.camera.map) || global.map || null;
            const dx = (effectiveMap && typeof effectiveMap.shortestDeltaX === "function")
                ? effectiveMap.shortestDeltaX(wizard.x, worldPos.x)
                : (worldPos.x - wizard.x);
            const dy = (effectiveMap && typeof effectiveMap.shortestDeltaY === "function")
                ? effectiveMap.shortestDeltaY(wizard.y, worldPos.y)
                : (worldPos.y - wizard.y);
            const dist = Math.hypot(dx, dy);
            if (dist < 0.01) return false;

            const visR = Math.max(
                Number.isFinite(item.width) ? item.width / 2 : 0,
                Number.isFinite(item.height) ? item.height / 2 : 0,
                Number.isFinite(item.radius) ? item.radius : 0,
                (item.groundPlaneHitbox && Number.isFinite(item.groundPlaneHitbox.radius))
                    ? item.groundPlaneHitbox.radius : 0,
                Number.isFinite(item.visualRadius) ? item.visualRadius : 0
            );
            if (visR <= 0) return true;

            const halfSpan = Math.asin(Math.min(1, visR / dist));
            const centerAngle = Math.atan2(dy, dx);
            const twoPi = Math.PI * 2;
            const a0 = centerAngle - halfSpan;
            const a1 = centerAngle + halfSpan;
            const norm0 = ((a0 + Math.PI) % twoPi + twoPi) % twoPi;
            const norm1 = ((a1 + Math.PI) % twoPi + twoPi) % twoPi;
            const bin0 = Math.max(0, Math.min(bins - 1, Math.floor((norm0 / twoPi) * bins)));
            const bin1 = Math.max(0, Math.min(bins - 1, Math.floor((norm1 / twoPi) * bins)));
            const spanBins = ((bin1 - bin0 + bins) % bins) || 1;

            for (let i = 0; i <= spanBins; i++) {
                const b = (bin0 + i) % bins;
                const d = Number.isFinite(depth[b]) ? depth[b] : Infinity;
                if (d >= dist) return false;
            }
            return true;
        }

        isPlacedObjectEntity(item) {
            return !!(
                item &&
                (item.isPlacedObject || item.objectType === "placedObject" || item.type === "placedObject")
            );
        }

        forEachWrappedNodeInViewport(mapRef, xPadding, yPadding, callback, cameraOverride = null) {
            if (!mapRef || typeof callback !== "function") return;
            if (typeof mapRef.getVisibleNodesInViewport === "function") {
                const nodes = mapRef.getVisibleNodesInViewport(cameraOverride || this.camera || {}, xPadding, yPadding);
                for (let i = 0; i < nodes.length; i++) {
                    if (nodes[i]) callback(nodes[i]);
                }
                return;
            }
            const camera = cameraOverride || this.camera || {};
            const viewportRef = global.viewport || null;
            const cameraWidth = Number.isFinite(camera.width)
                ? camera.width
                : (viewportRef && Number.isFinite(viewportRef.width) ? viewportRef.width : 0);
            const cameraHeight = Number.isFinite(camera.height)
                ? camera.height
                : (viewportRef && Number.isFinite(viewportRef.height) ? viewportRef.height : 0);
            const padX = Math.max(0, Number.isFinite(xPadding) ? Math.floor(xPadding) : 0);
            const padY = Math.max(0, Number.isFinite(yPadding) ? Math.floor(yPadding) : 0);
            const xScale = 0.866;
            const xStart = Math.floor(camera.x / xScale) - padX;
            const xEnd = Math.ceil((camera.x + cameraWidth) / xScale) + padX;
            const yStart = Math.floor(camera.y) - padY;
            const yEnd = Math.ceil(camera.y + cameraHeight) + padY;
            const xRanges = (typeof global.getWrappedIndexRanges === "function")
                ? global.getWrappedIndexRanges(xStart, xEnd, mapRef.width, mapRef.wrapX)
                : [];
            const yRanges = (typeof global.getWrappedIndexRanges === "function")
                ? global.getWrappedIndexRanges(yStart, yEnd, mapRef.height, mapRef.wrapY)
                : [];
            if (xRanges.length === 0 || yRanges.length === 0) return;

            yRanges.forEach(yRange => {
                for (let y = yRange.start; y <= yRange.end; y++) {
                    xRanges.forEach(xRange => {
                        for (let x = xRange.start; x <= xRange.end; x++) {
                            const node = mapRef.nodes[x] && mapRef.nodes[x][y] ? mapRef.nodes[x][y] : null;
                            if (node) callback(node);
                        }
                    });
                }
            });
        }

        resolvePlacedObjectLodTexturePath(item) {
            if (!item || !this.isPlacedObjectEntity(item)) return null;
            const basePath = (typeof item.texturePath === "string" && item.texturePath.length > 0)
                ? item.texturePath
                : null;
            const lodList = Array.isArray(item.lodTextures) ? item.lodTextures : null;
            if (!lodList || lodList.length === 0) return basePath;
            const itemWidthWorld = Math.max(0.01, Number.isFinite(item.width) ? Number(item.width) : 1);
            const itemHeightWorld = Math.max(0.01, Number.isFinite(item.height) ? Number(item.height) : 1);
            const rotationAxis = (typeof item.rotationAxis === "string") ? item.rotationAxis : "visual";
            const yIsoScale = Math.max(0.0001, Math.abs(Number.isFinite(this.camera.xyratio) ? this.camera.xyratio : 0.66));
            const screenWidthPx = itemWidthWorld * this.camera.viewscale;
            const screenHeightPx = (rotationAxis === "spatial")
                ? (itemHeightWorld * this.camera.viewscale)
                : (itemHeightWorld * this.camera.viewscale * yIsoScale);
            const sizeMetric = Math.max(screenWidthPx, screenHeightPx);

            for (let i = 0; i < lodList.length; i++) {
                const entry = lodList[i];
                if (!entry || typeof entry.texturePath !== "string" || entry.texturePath.length === 0) continue;
                const maxSize = Number.isFinite(entry.maxDistance) ? Number(entry.maxDistance) : Infinity;
                if (sizeMetric <= maxSize) return entry.texturePath;
            }
            return basePath || (lodList[lodList.length - 1] && lodList[lodList.length - 1].texturePath) || null;
        }

        resolvePowerupLodTexturePath(item) {
            if (!item) return null;
            const basePath = (typeof item.imagePath === "string" && item.imagePath.length > 0)
                ? item.imagePath
                : null;
            const lodList = Array.isArray(item.lodTextures) ? item.lodTextures : null;
            if (!lodList || lodList.length === 0) return basePath;
            const itemWidthWorld = Math.max(0.01, Number.isFinite(item.width) ? Number(item.width) : 1);
            const itemHeightWorld = Math.max(0.01, Number.isFinite(item.height) ? Number(item.height) : 1);
            const sizeMetric = Math.max(
                itemWidthWorld * this.camera.viewscale,
                itemHeightWorld * this.camera.viewscale
            );

            for (let i = 0; i < lodList.length; i++) {
                const entry = lodList[i];
                if (!entry || typeof entry.texturePath !== "string" || entry.texturePath.length === 0) continue;
                const maxSize = Number.isFinite(entry.maxDistance) ? Number(entry.maxDistance) : Infinity;
                if (sizeMetric <= maxSize) return entry.texturePath;
            }
            return basePath || (lodList[lodList.length - 1] && lodList[lodList.length - 1].texturePath) || null;
        }

        applySpriteTransform(item) {
            if (!item || !item.pixiSprite) return;
            if (item.dead && typeof item.tickDeadFire === "function") {
                item.tickDeadFire();
            }
            if (item.dead && typeof item.tickDeathAnimation === "function") {
                item.tickDeathAnimation();
            }
            if (typeof item._syncFireVisualState === "function") {
                item._syncFireVisualState();
            }
            const interpolatedWorld = (typeof item.getInterpolatedPosition === "function")
                ? item.getInterpolatedPosition()
                : null;
            const mapRef = this.camera.map || global.map || null;
            const alpha = Number.isFinite(global.renderAlpha) ? Math.max(0, Math.min(1, global.renderAlpha)) : 1;
            const fallbackWorldX = (item && Number.isFinite(item.prevX) && Number.isFinite(item.x))
                ? (
                    Number.isFinite(alpha) && mapRef && typeof mapRef.shortestDeltaX === "function"
                        ? (item.prevX + mapRef.shortestDeltaX(item.prevX, item.x) * alpha)
                        : (item.prevX + (item.x - item.prevX) * alpha)
                )
                : item.x;
            const fallbackWorldY = (item && Number.isFinite(item.prevY) && Number.isFinite(item.y))
                ? (
                    Number.isFinite(alpha) && mapRef && typeof mapRef.shortestDeltaY === "function"
                        ? (item.prevY + mapRef.shortestDeltaY(item.prevY, item.y) * alpha)
                        : (item.prevY + (item.y - item.prevY) * alpha)
                )
                : item.y;
            const drawX = (
                interpolatedWorld &&
                Number.isFinite(interpolatedWorld.x) &&
                Number.isFinite(interpolatedWorld.y)
            ) ? interpolatedWorld.x : fallbackWorldX;
            const drawY = (
                interpolatedWorld &&
                Number.isFinite(interpolatedWorld.x) &&
                Number.isFinite(interpolatedWorld.y)
            ) ? interpolatedWorld.y : fallbackWorldY;
            const drawZ = (
                interpolatedWorld &&
                Number.isFinite(interpolatedWorld.z)
            )
                ? interpolatedWorld.z
                : (Number.isFinite(item.z) ? Number(item.z) : 0);
            const layerBaseZ = this.getLayerBaseZForObject(item, 0);
            const coors = this.camera.worldToScreen(drawX, drawY, drawZ + layerBaseZ);
            item.pixiSprite.x = coors.x;
            item.pixiSprite.y = coors.y;

            if (typeof global.ensureSpriteFrames === "function") {
                global.ensureSpriteFrames(item);
            }
            if (item.spriteFrames && item.pixiSprite) {
                const rowIndex = typeof item.getDirectionRow === "function" ? item.getDirectionRow() : 0;
                const safeRow = Math.max(0, Math.min(rowIndex, (item.spriteRows || 1) - 1));
                const safeCol = Math.max(0, Math.min(item.spriteCol || 0, (item.spriteCols || 1) - 1));
                const rowFrames = item.spriteFrames[safeRow] || item.spriteFrames[0];
                const nextTexture = rowFrames && (rowFrames[safeCol] || rowFrames[0]);
                if (nextTexture) item.pixiSprite.texture = nextTexture;
            }

            const spriteTexture = item.pixiSprite.texture || null;
            const nativeTexW = spriteTexture && Number.isFinite(spriteTexture.width) ? Number(spriteTexture.width) : null;
            const nativeTexH = spriteTexture && Number.isFinite(spriteTexture.height) ? Number(spriteTexture.height) : null;
            const frameScale = (typeof item.getSpriteFrameScale === "function")
                ? item.getSpriteFrameScale()
                : null;
            const frameScaleWidth = Math.max(
                0.01,
                frameScale && Number.isFinite(frameScale.width) ? Number(frameScale.width) : 1
            );
            const frameScaleHeight = Math.max(
                0.01,
                frameScale && Number.isFinite(frameScale.height) ? Number(frameScale.height) : 1
            );
            const useNativeLodSize = !!(
                global.debugUseLodNativePixelSize &&
                this.isPlacedObjectEntity(item) &&
                item.rotationAxis !== "spatial" &&
                Number.isFinite(nativeTexW) &&
                Number.isFinite(nativeTexH)
            );

            if (this.isPlacedObjectEntity(item) && item.rotationAxis !== "spatial" && item.pixiSprite instanceof PIXI.Sprite) {
                const lodTexturePath = this.resolvePlacedObjectLodTexturePath(item);
                if (typeof lodTexturePath === "string" && lodTexturePath.length > 0 && lodTexturePath !== item._activeLodTexturePath) {
                    item.pixiSprite.texture = PIXI.Texture.from(lodTexturePath);
                    item._activeLodTexturePath = lodTexturePath;
                }
            }

            let targetWidth = 0;
            let targetHeight = 0;
            if (item.type === "road") {
                targetWidth = (item.width || 1) * this.camera.viewscale * 1.1547;
                targetHeight = (item.height || 1) * this.camera.viewscale * this.camera.xyratio;
            } else if (item.rotationAxis === "ground") {
                targetWidth = (item.width || 1) * this.camera.viewscale;
                targetHeight = (item.height || 1) * this.camera.viewscale;
            } else if (useNativeLodSize) {
                targetWidth = nativeTexW;
                targetHeight = nativeTexH;
            } else {
                targetWidth = (item.width || 1) * this.camera.viewscale;
                targetHeight = (item.height || 1) * this.camera.viewscale;
            }
            item.pixiSprite.width = targetWidth * frameScaleWidth;
            item.pixiSprite.height = targetHeight * frameScaleHeight;

            if (item.dead && item.pixiSprite.anchor) {
                // For items with a gradual death fall animation (e.g. Blodia), keep the
                // default foot anchor so the depth billboard bottomZ stays at ground level.
                if (!item._useGradualDeathFall) {
                    // Flip around the sprite midline (y=0.5), not the default foot anchor.
                    item.pixiSprite.anchor.set(0.5, 0.5);
                    item.pixiSprite.y = coors.y - (item.pixiSprite.height * 0.5);
                }
            }

            if (!this.shouldUseDepthBillboard(item) && item.fireSprite) {
                const shouldShowFire = !!(item.isOnFire && this.isScriptVisible(item) && !item.gone && !item.vanishing);
                if (shouldShowFire) {
                    const fireContainer = this.isCharacterRenderItem(item)
                        ? (this.getCharacterLayer() || item.pixiSprite.parent || null)
                        : (this.layers.entities || item.pixiSprite.parent || null);
                    if (fireContainer && item.fireSprite.parent !== fireContainer) {
                        fireContainer.addChild(item.fireSprite);
                    }
                    if (item.fireSprite.anchor) item.fireSprite.anchor.set(0.5, 1);
                    item.fireSprite.x = item.pixiSprite.x;
                    // For trees, flames grow as HP is lost: scale = min(maxHP / hp, 4)
                    const _fireScale = (item.type === 'tree' && item.maxHP > 0 && item.hp > 0)
                        ? Math.min(item.maxHP / item.hp, 4)
                        : 1;
                    item.fireSprite.width = item.pixiSprite.width * 1.6 * _fireScale;
                    item.fireSprite.height = item.pixiSprite.height * 1.2 * _fireScale;
                    if (item.type === "flower") {
                        const hostAnchorY = (item.pixiSprite.anchor && Number.isFinite(item.pixiSprite.anchor.y))
                            ? Number(item.pixiSprite.anchor.y)
                            : 1;
                        const hostTopY = item.pixiSprite.y - (item.pixiSprite.height * hostAnchorY);
                        item.fireSprite.y = hostTopY + (item.pixiSprite.height * 0.5) + (item.fireSprite.height * 0.12);
                    } else {
                        // Place fire bottom at the top of the host sprite, compensating for its anchor.
                        const _sprAnchorY = (item.pixiSprite.anchor && Number.isFinite(item.pixiSprite.anchor.y))
                            ? item.pixiSprite.anchor.y : 1;
                        item.fireSprite.y = item.pixiSprite.y - item.pixiSprite.height * _sprAnchorY;
                    }
                    item.fireSprite.visible = true;
                    if (Object.prototype.hasOwnProperty.call(item.fireSprite, "renderable")) {
                        item.fireSprite.renderable = true;
                    }
                    this.applyLayerDarknessForItem(item, item._renderLayerIndex, item.fireSprite);
                } else {
                    item.fireSprite.visible = false;
                    if (Object.prototype.hasOwnProperty.call(item.fireSprite, "renderable")) {
                        item.fireSprite.renderable = false;
                    }
                }
            }

            const visualRotationBase = (item && item.dead)
                ? (Number.isFinite(item.rotation) ? item.rotation : 180)
                : ((item && item.rotationAxis === "none")
                    ? 0
                    : Number.isFinite(item.placementRotation)
                        ? item.placementRotation
                        : item.rotation);
            const visualRotationOffset = (item && typeof item.getAdditionalSpriteRotationDegrees === "function")
                ? Number(item.getAdditionalSpriteRotationDegrees()) || 0
                : 0;
            const visualRotation = (Number(visualRotationBase) || 0) + visualRotationOffset;
            item.pixiSprite.rotation = visualRotation ? (visualRotation * (Math.PI / 180)) : 0;
            const layerAlpha = Number.isFinite(item._renderLayerAlpha)
                ? Math.max(0, Math.min(1, Number(item._renderLayerAlpha)))
                : 1;
            item.pixiSprite.alpha = this.getScriptDisplayAlpha(item) * layerAlpha;
            this.applyLayerDarknessForItem(item, item._renderLayerIndex, item.pixiSprite);
        }

        getRoofsList(ctx) {
            const fromCtx = Array.isArray(ctx && ctx.roofs) ? ctx.roofs : null;
            if (fromCtx) return fromCtx;
            if (Array.isArray(global.roofs)) return global.roofs;
            const legacy = global.roof || null;
            return legacy ? [legacy] : [];
        }

        isWorldPointUnderRoof(worldX, worldY, ctx = null) {
            if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return false;
            const roofList = this.getRoofsList(ctx);
            if (!Array.isArray(roofList) || roofList.length === 0) return false;

            for (let i = 0; i < roofList.length; i++) {
                const roofRef = roofList[i];
                if (!roofRef || roofRef.gone || !roofRef.placed) continue;
                if (!this.isScriptVisible(roofRef)) continue;
                const roofInteriorHitbox = (
                    roofRef.interiorHideHitbox &&
                    typeof roofRef.interiorHideHitbox.containsPoint === "function"
                ) ? roofRef.interiorHideHitbox : roofRef.groundPlaneHitbox;
                if (!roofInteriorHitbox || typeof roofInteriorHitbox.containsPoint !== "function") continue;
                if (roofInteriorHitbox.containsPoint(worldX, worldY)) {
                    return true;
                }
            }
            return false;
        }

        updateRoofPreview(roof, wizardRef) {
            if (!roof) return;
            if (!roof.pixiMesh) {
                roof.createPixiMesh();
                if (roof.pixiMesh && roof.pixiMesh.parent) {
                    roof.pixiMesh.parent.removeChild(roof.pixiMesh);
                }
            }

            if (!roof.pixiMesh) return;
            roof.currentAlpha = 1;
            const layerAlpha = Number.isFinite(roof._renderLayerAlpha)
                ? Math.max(0, Math.min(1, Number(roof._renderLayerAlpha)))
                : 1;
            roof.pixiMesh.alpha = roof.currentAlpha * layerAlpha;
            roof.pixiMesh.visible = !!roof.placed && (roof.currentAlpha * layerAlpha) > 0.01;
            this.applyLayerDarknessToDisplayObject(
                roof.pixiMesh,
                this.getLayerDarknessMultiplier(roof._renderLayerIndex)
            );

            if (roof.placed) {
                const baseZ = Number.isFinite(roof.z)
                    ? Number(roof.z)
                    : (Number.isFinite(roof.heightFromGround) ? Number(roof.heightFromGround) : 0);
                const usesDepthShader = !!(
                    roof.pixiMesh &&
                    roof.pixiMesh._usesRoofDepthShader &&
                    Array.isArray(roof.pixiMesh._roofDepthUniforms)
                );
                if (usesDepthShader) {
                    const uniformsList = roof.pixiMesh._roofDepthUniforms;
                    const appRef = (typeof app !== "undefined" && app) ? app : (global.app || null);
                    const screenW = (appRef && appRef.screen && Number.isFinite(appRef.screen.width))
                        ? Number(appRef.screen.width)
                        : 1;
                    const screenH = (appRef && appRef.screen && Number.isFinite(appRef.screen.height))
                        ? Number(appRef.screen.height)
                        : 1;
                    const roofCtor = (typeof Roof !== "undefined") ? Roof : null;
                    const nearMetric = Number.isFinite(roofCtor && roofCtor.DEPTH_NEAR_METRIC)
                        ? Number(roofCtor.DEPTH_NEAR_METRIC)
                        : -128;
                    const farMetric = Number.isFinite(roofCtor && roofCtor.DEPTH_FAR_METRIC)
                        ? Number(roofCtor.DEPTH_FAR_METRIC)
                        : 256;
                    const depthSpanInv = 1 / Math.max(1e-6, farMetric - nearMetric);
                    const mapRef = roof.map || this.camera.map || global.map || null;
                    const worldW = (mapRef && Number.isFinite(mapRef.worldWidth) && mapRef.worldWidth > 0)
                        ? Number(mapRef.worldWidth)
                        : 0;
                    const worldH = (mapRef && Number.isFinite(mapRef.worldHeight) && mapRef.worldHeight > 0)
                        ? Number(mapRef.worldHeight)
                        : 0;
                    const wrapX = (mapRef && mapRef.wrapX !== false) ? 1 : 0;
                    const wrapY = (mapRef && mapRef.wrapY !== false) ? 1 : 0;
                    for (let i = 0; i < uniformsList.length; i++) {
                        const u = uniformsList[i];
                        if (!u) continue;
                        u.uScreenSize[0] = Math.max(1, screenW);
                        u.uScreenSize[1] = Math.max(1, screenH);
                        u.uCameraWorld[0] = Number(this.camera.x) || 0;
                        u.uCameraWorld[1] = Number(this.camera.y) || 0;
                        u.uCameraZ = Number(this.camera.z) || 0;
                        u.uViewScale = Number(this.camera.viewscale) || 1;
                        u.uXyRatio = Number(this.camera.xyratio) || 1;
                        u.uDepthRange[0] = farMetric;
                        u.uDepthRange[1] = depthSpanInv;
                        u.uModelOrigin[0] = Number(roof.x) || 0;
                        u.uModelOrigin[1] = Number(roof.y) || 0;
                        u.uModelOrigin[2] = baseZ;
                        u.uWorldSize[0] = worldW;
                        u.uWorldSize[1] = worldH;
                        u.uWrapEnabled[0] = wrapX;
                        u.uWrapEnabled[1] = wrapY;
                        u.uWrapAnchorWorld[0] = Number(roof.x) || 0;
                        u.uWrapAnchorWorld[1] = Number(roof.y) || 0;
                        u.uTint[3] = (Number.isFinite(roof.currentAlpha) ? Number(roof.currentAlpha) : 1) * layerAlpha;
                    }
                    roof.pixiMesh.x = 0;
                    roof.pixiMesh.y = 0;
                    roof.pixiMesh.scale.set(1, 1);
                    roof.pixiMesh.alpha = 1;
                } else {
                    const roofCoords = this.camera.worldToScreen(roof.x, roof.y, 0);
                    const baseYOffsetPx = baseZ * this.camera.viewscale * this.camera.xyratio;
                    roof.pixiMesh.x = roofCoords.x;
                    roof.pixiMesh.y = roofCoords.y - baseYOffsetPx;
                    roof.pixiMesh.scale.set(this.camera.viewscale, this.camera.viewscale);
                }
            }
        }

        _inferWallLoopSectionIds(roof, wallCtor) {
            const poly = roof.interiorHidePolygonPoints;
            if (
                !Array.isArray(poly) || poly.length < 3 ||
                !(wallCtor && wallCtor._allSections instanceof Map)
            ) {
                return [];
            }
            // Wall section endpoints lie at polygon vertices (exact grid coords).
            // Use a generous epsilon to survive save/load float rounding.
            const EPS = 0.5;
            const epsSq = EPS * EPS;
            const isAtVertex = (px, py) => {
                for (let vi = 0; vi < poly.length; vi++) {
                    const v = poly[vi];
                    const dx = px - Number(v.x);
                    const dy = py - Number(v.y);
                    if (dx * dx + dy * dy <= epsSq) return true;
                }
                return false;
            };
            const ids = [];
            wallCtor._allSections.forEach((section) => {
                if (!section || section.gone || section.vanishing) return;
                if (!section.startPoint || !section.endPoint || !Number.isInteger(section.id)) return;
                const sx = Number(section.startPoint.x);
                const sy = Number(section.startPoint.y);
                const ex = Number(section.endPoint.x);
                const ey = Number(section.endPoint.y);
                if (!Number.isFinite(sx) || !Number.isFinite(sy) ||
                    !Number.isFinite(ex) || !Number.isFinite(ey)) return;
                if (isAtVertex(sx, sy) && isAtVertex(ex, ey)) {
                    ids.push(section.id);
                }
            });
            return ids;
        }

        isLosOccluder(item) {
            if (!item || !item.groundPlaneHitbox) return false;
            if (item.type === "road" || item.type === "firewall" || item.type === "roof") return false;
            if (typeof item.castsLosShadows === "boolean" && !item.castsLosShadows) return false;
            const isAnimal = (typeof Animal !== "undefined" && item instanceof Animal);
            if (isAnimal) return false;
            return true;
        }

        getLosObjectId(item) {
            if (!item) return 0;
            if (!Number.isInteger(item._losObjectId)) {
                item._losObjectId = this.nextLosObjectId++;
            }
            return item._losObjectId;
        }

        computeLosCandidateHash(candidates) {
            let xor = 0;
            let sum = 0;
            for (let i = 0; i < candidates.length; i++) {
                const id = this.getLosObjectId(candidates[i]) >>> 0;
                xor = (xor ^ id) >>> 0;
                sum = (sum + ((id * 2654435761) >>> 0)) >>> 0;
            }
            return (xor ^ sum) >>> 0;
        }

        clearLosStateDebug() {
            this.currentLosState = null;
            this.lastLosWizardX = null;
            this.lastLosWizardY = null;
            this.lastLosFacingAngle = null;
            this.lastLosCandidateCount = -1;
            this.lastLosCandidateHash = 0;
            this.lastLosComputeAtMs = 0;
            global.losDebugVisibleObjects = [];
            global.losDebugLastMs = 0;
            global.losDebugBreakdown = {
                buildMs: 0,
                traceMs: 0,
                totalMs: 0,
                recomputed: false,
                candidates: 0
            };
        }

        updateLosState(ctx, visibleNodes, visibleObjectsOverride = null) {
            const wizard = ctx && ctx.wizard ? ctx.wizard : null;
            const losSystem = (typeof LOSSystem !== "undefined") ? LOSSystem : global.LOSSystem;
            if (!wizard || !losSystem || typeof losSystem.computeState !== "function") {
                this.clearLosStateDebug();
                return;
            }

            const omnivisionActive = this.isOmnivisionActive(wizard);
            if (omnivisionActive) {
                this.clearLosStateDebug();
                return;
            }

            const losBuildStartMs = performance.now();
            const visibleObjects = Array.isArray(visibleObjectsOverride)
                ? visibleObjectsOverride
                : this.collectVisibleObjects(visibleNodes, ctx);
            const losNowMs = (ctx && Number.isFinite(ctx.renderNowMs)) ? Number(ctx.renderNowMs) : Date.now();
            const wizardLayer = this.getLayerIndexFromValue(
                wizard && Number.isFinite(wizard.currentLayer) ? wizard.currentLayer : 0,
                0
            );
            const wizardLayerBaseZ = Number.isFinite(wizard.currentLayerBaseZ)
                ? Number(wizard.currentLayerBaseZ)
                : this.getLayerBaseZForLevel(wizardLayer);
            const losCandidates = [];
            for (let i = 0; i < visibleObjects.length; i++) {
                const obj = visibleObjects[i];
                if (!obj || obj === wizard || obj.gone || obj.vanishing) continue;
                const objLayer = this.getLayerIndexForObject(obj, this.isLosMazeModeEnabled() ? 0 : wizardLayer);
                if (objLayer !== wizardLayer) continue;
                this.updateSinkAnimation(obj, losNowMs);
                if (this.isLosOccluder(obj)) losCandidates.push(obj);
            }
            const losBuildMs = performance.now() - losBuildStartMs;

            const candidateCount = losCandidates.length;
            const candidateHash = this.computeLosCandidateHash(losCandidates);
            const facingAngle = this.getWizardFacingAngleRad(wizard);
            const mapRef = ctx && ctx.map ? ctx.map : (wizard.map || null);
            const movedDx = (mapRef && typeof mapRef.shortestDeltaX === "function" && Number.isFinite(this.lastLosWizardX))
                ? mapRef.shortestDeltaX(this.lastLosWizardX, wizard.x)
                : (Number.isFinite(this.lastLosWizardX) ? (wizard.x - this.lastLosWizardX) : Infinity);
            const movedDy = (mapRef && typeof mapRef.shortestDeltaY === "function" && Number.isFinite(this.lastLosWizardY))
                ? mapRef.shortestDeltaY(this.lastLosWizardY, wizard.y)
                : (Number.isFinite(this.lastLosWizardY) ? (wizard.y - this.lastLosWizardY) : Infinity);
            const movedDist = Math.hypot(movedDx, movedDy);
            const facingDelta = Number.isFinite(this.lastLosFacingAngle)
                ? Math.abs(Math.atan2(Math.sin(facingAngle - this.lastLosFacingAngle), Math.cos(facingAngle - this.lastLosFacingAngle)))
                : Infinity;
            const structuralChange = (
                !this.currentLosState ||
                candidateCount !== this.lastLosCandidateCount ||
                candidateHash !== this.lastLosCandidateHash ||
                wizardLayer !== this.lastLosWizardLayer ||
                wizardLayerBaseZ !== this.lastLosWizardBaseZ
            );
            const nowMs = (ctx && Number.isFinite(ctx.renderNowMs)) ? Number(ctx.renderNowMs) : performance.now();
            const timeSinceLastLosMs = Number.isFinite(this.lastLosComputeAtMs) ? (nowMs - this.lastLosComputeAtMs) : Infinity;
            const shouldRecomputeLos = (
                structuralChange ||
                movedDist > 0.03 ||
                facingDelta > 0.05 ||
                timeSinceLastLosMs >= LOS_THROTTLE_MS
            );

            let losTraceMs = 0;
            if (shouldRecomputeLos) {
                const mazeMode = this.isLosMazeModeEnabled();
                const losForwardFovDegreesRaw = Number(this.getLosVisualSetting("forwardFovDegrees", 200));
                const losForwardFovDegrees = mazeMode
                    ? 360
                    : (
                        Number.isFinite(losForwardFovDegreesRaw)
                            ? Math.max(0, Math.min(360, losForwardFovDegreesRaw))
                            : 200
                    );
                this.currentLosState = losSystem.computeState(wizard, losCandidates, {
                    bins: LOS_BINS,
                    facingAngle,
                    fovDegrees: losForwardFovDegrees,
                    mazeMode
                });
                if (this.currentLosState) {
                    this.currentLosState.viewerLayer = wizardLayer;
                    this.currentLosState.viewerBaseZ = wizardLayerBaseZ;
                }
                losTraceMs = Number.isFinite(this.currentLosState && this.currentLosState.elapsedMs)
                    ? Number(this.currentLosState.elapsedMs)
                    : 0;
                this.lastLosWizardX = wizard.x;
                this.lastLosWizardY = wizard.y;
                this.lastLosFacingAngle = facingAngle;
                this.lastLosWizardLayer = wizardLayer;
                this.lastLosWizardBaseZ = wizardLayerBaseZ;
                this.lastLosCandidateCount = candidateCount;
                this.lastLosCandidateHash = candidateHash;
                this.lastLosComputeAtMs = nowMs;
            }

            global.losDebugVisibleObjects = (this.currentLosState && Array.isArray(this.currentLosState.visibleObjects))
                ? this.currentLosState.visibleObjects
                : [];
            global.losDebugLastMs = losBuildMs + losTraceMs;
            global.losDebugBreakdown = {
                buildMs: losBuildMs,
                traceMs: losTraceMs,
                totalMs: losBuildMs + losTraceMs,
                recomputed: shouldRecomputeLos,
                candidates: candidateCount
            };
            this.setFrameMetric("losCandidates", candidateCount);
            this.setFrameMetric("losBuildMs", losBuildMs);
            this.setFrameMetric("losTraceMs", losTraceMs);
            this.setFrameMetric("losTotalMs", losBuildMs + losTraceMs);
            this.setFrameMetric("losRecomputed", shouldRecomputeLos ? 1 : 0);
            this.setFrameMetric(
                "losVisibleObjects",
                (this.currentLosState && Array.isArray(this.currentLosState.visibleObjects))
                    ? this.currentLosState.visibleObjects.length
                    : 0
            );
        }

        updateWallLosIlluminationTallies(ctx) {
            const wallCtor = global.WallSectionUnit;
            const allSections = (wallCtor && wallCtor._allSections instanceof Map)
                ? wallCtor._allSections
                : null;
            if (!allSections) return;

            const diagnosticsEnabled = !!this.currentFrameMetrics;
            const functionStartMs = diagnosticsEnabled ? performance.now() : 0;
            let resetSections = 0;
            let illuminatedBins = 0;
            let rangedSections = 0;
            let endpointOwnerLookups = 0;
            let endpointOwnersResolved = 0;

            for (const section of allSections.values()) {
                if (!section || typeof section.resetLosIlluminationTally !== "function") continue;
                section.resetLosIlluminationTally();
                resetSections += 1;
            }

            const wizard = ctx && ctx.wizard ? ctx.wizard : null;
            const mazeMode = this.isLosMazeModeEnabled() && !this.isOmnivisionActive(wizard);
            if (!mazeMode) return;

            const state = this.currentLosState;
            if (!wizard || !state || !Array.isArray(state.owner) || !state.depth || !Number.isFinite(state.bins)) return;

            const bins = Math.max(1, Math.floor(state.bins));
            if (bins <= 0) return;
            const minAngle = Number.isFinite(state.minAngle) ? state.minAngle : -Math.PI;
            const twoPi = Math.PI * 2;
            const mapRef = (wizard && wizard.map) || global.map || null;

            const angleToBinIndex = theta => {
                const relative = ((theta - minAngle) % twoPi + twoPi) % twoPi;
                const rawIndex = Math.floor((relative / twoPi) * bins);
                if (rawIndex < 0) return 0;
                if (rawIndex >= bins) return bins - 1;
                return rawIndex;
            };

            const collectEndpointOwners = endpoint => {
                if (!endpoint || !Number.isFinite(endpoint.x) || !Number.isFinite(endpoint.y)) return [];
                endpointOwnerLookups += 1;
                const dx = (mapRef && typeof mapRef.shortestDeltaX === "function")
                    ? mapRef.shortestDeltaX(wizard.x, endpoint.x)
                    : (endpoint.x - wizard.x);
                const dy = (mapRef && typeof mapRef.shortestDeltaY === "function")
                    ? mapRef.shortestDeltaY(wizard.y, endpoint.y)
                    : (endpoint.y - wizard.y);
                if (!Number.isFinite(dx) || !Number.isFinite(dy)) return [];
                const endpointDistance = Math.hypot(dx, dy);
                const theta = Math.atan2(dy, dx);
                const centerBin = angleToBinIndex(theta);
                const endpointSampleRadius = 0.8;
                const angularTolerance = endpointDistance > 1e-6
                    ? Math.atan2(endpointSampleRadius, endpointDistance)
                    : Math.PI;
                const dynamicRadius = Math.ceil((angularTolerance / twoPi) * bins);
                const searchRadiusBins = Math.min(
                    Math.max(2, dynamicRadius),
                    Math.max(2, Math.min(24, Math.floor(bins / 6)))
                );
                const endpointDepthSlack = 0.35;
                const out = [];
                const seen = new Set();
                for (let offset = 0; offset <= searchRadiusBins; offset++) {
                    const candidates = offset === 0
                        ? [centerBin]
                        : [
                            (centerBin - offset + bins) % bins,
                            (centerBin + offset) % bins
                        ];
                    for (let i = 0; i < candidates.length; i++) {
                        const binIndex = candidates[i];
                        const owner = state.owner[binIndex] || null;
                        if (!owner || seen.has(owner)) continue;
                        const hitDist = Number(state.depth[binIndex]);
                        if (!Number.isFinite(hitDist) || hitDist <= 0) continue;
                        if (Number.isFinite(endpointDistance) && hitDist > (endpointDistance + endpointDepthSlack)) continue;
                        seen.add(owner);
                        out.push(owner);
                    }
                }
                endpointOwnersResolved += out.length;
                return out;
            };

            for (let i = 0; i < bins; i++) {
                const owner = state.owner[i];
                if (!owner || owner.type !== "wallSection" || typeof owner.accumulateLosIlluminationT !== "function") continue;
                const hitDist = Number(state.depth[i]);
                if (!Number.isFinite(hitDist) || hitDist <= 0) continue;
                illuminatedBins += 1;

                const theta = minAngle + ((i + 0.5) / bins) * twoPi;
                const hitX = Number(wizard.x) + Math.cos(theta) * hitDist;
                const hitY = Number(wizard.y) + Math.sin(theta) * hitDist;
                const t = (typeof owner._parameterForWorldPointOnSection === "function")
                    ? owner._parameterForWorldPointOnSection({ x: hitX, y: hitY })
                    : null;
                owner.accumulateLosIlluminationT(t);
            }

            for (const section of allSections.values()) {
                if (!section || typeof section.getLosIlluminationRangeT !== "function") continue;
                const range = section.getLosIlluminationRangeT();
                if (!range) continue;
                rangedSections += 1;

                const sectionLength = Number.isFinite(section.length) ? Math.max(0, Number(section.length)) : 0;
                const tMin = Number(range.tMin);
                const tMax = Number(range.tMax);
                const endpointSnapDistance = 1.0;
                const startDistToPlayer = (
                    section.startPoint &&
                    Number.isFinite(section.startPoint.x) &&
                    Number.isFinite(section.startPoint.y)
                )
                    ? Math.hypot(
                        (mapRef && typeof mapRef.shortestDeltaX === "function")
                            ? mapRef.shortestDeltaX(wizard.x, section.startPoint.x)
                            : (Number(section.startPoint.x) - Number(wizard.x)),
                        (mapRef && typeof mapRef.shortestDeltaY === "function")
                            ? mapRef.shortestDeltaY(wizard.y, section.startPoint.y)
                            : (Number(section.startPoint.y) - Number(wizard.y))
                    )
                    : Infinity;
                const endDistToPlayer = (
                    section.endPoint &&
                    Number.isFinite(section.endPoint.x) &&
                    Number.isFinite(section.endPoint.y)
                )
                    ? Math.hypot(
                        (mapRef && typeof mapRef.shortestDeltaX === "function")
                            ? mapRef.shortestDeltaX(wizard.x, section.endPoint.x)
                            : (Number(section.endPoint.x) - Number(wizard.x)),
                        (mapRef && typeof mapRef.shortestDeltaY === "function")
                            ? mapRef.shortestDeltaY(wizard.y, section.endPoint.y)
                            : (Number(section.endPoint.y) - Number(wizard.y))
                    )
                    : Infinity;
                const nearStartEndpointToPlayer = startDistToPlayer <= endDistToPlayer;
                const nearEndEndpointToPlayer = endDistToPlayer < startDistToPlayer;
                const nearStartByDistance = (
                    nearStartEndpointToPlayer &&
                    sectionLength > 0 &&
                    Number.isFinite(tMin) &&
                    (Math.max(0, tMin) * sectionLength) <= endpointSnapDistance
                );
                const nearEndByDistance = (
                    nearEndEndpointToPlayer &&
                    sectionLength > 0 &&
                    Number.isFinite(tMax) &&
                    (Math.max(0, 1 - tMax) * sectionLength) <= endpointSnapDistance
                );

                const ownersAtStart = collectEndpointOwners(section.startPoint);
                const ownersAtEnd = collectEndpointOwners(section.endPoint);
                const snapStartByOwner = (typeof section.isEndpointOwnedBySameWall === "function")
                    ? ownersAtStart.some(owner => section.isEndpointOwnedBySameWall("a", owner))
                    : false;
                const snapEndByOwner = (typeof section.isEndpointOwnedBySameWall === "function")
                    ? ownersAtEnd.some(owner => section.isEndpointOwnedBySameWall("b", owner))
                    : false;
                const snapStart = snapStartByOwner || nearStartByDistance;
                const snapEnd = snapEndByOwner || nearEndByDistance;

                if (typeof section.setLosEndpointSnapEligibility === "function") {
                    section.setLosEndpointSnapEligibility("a", snapStart);
                    section.setLosEndpointSnapEligibility("b", snapEnd);
                }
            }

            this.setFrameMetric("wallLosResetSections", resetSections);
            this.setFrameMetric("wallLosIlluminatedBins", illuminatedBins);
            this.setFrameMetric("wallLosRangedSections", rangedSections);
            this.setFrameMetric("wallLosEndpointLookups", endpointOwnerLookups);
            this.setFrameMetric("wallLosEndpointOwnersResolved", endpointOwnersResolved);
            this.setFrameMetric(
                "wallLosMs",
                diagnosticsEnabled ? (performance.now() - functionStartMs) : 0
            );
        }

        ensureLosShadowGraphics() {
            const layer = this.layers && this.layers.losShadow ? this.layers.losShadow : null;
            if (!layer) return null;
            if (!this.losShadowGraphics) {
                this.losShadowGraphics = new PIXI.Graphics();
                this.losShadowGraphics.name = "renderingLosShadowGraphics";
                this.losShadowGraphics.visible = false;
                this.losShadowGraphics.interactive = false;
                layer.addChild(this.losShadowGraphics);
            } else if (this.losShadowGraphics.parent !== layer) {
                layer.addChild(this.losShadowGraphics);
            }
            const shadowBlurEnabled = !!this.getLosVisualSetting("shadowBlurEnabled", true);
            const shadowBlurStrength = Number(this.getLosVisualSetting("shadowBlurStrength", 12));
            if (shadowBlurEnabled && shadowBlurStrength > 0 && typeof PIXI !== "undefined") {
                if (typeof PIXI.BlurFilter === "function") {
                    if (!this.losShadowGraphics._losBlurFilter || !(this.losShadowGraphics._losBlurFilter instanceof PIXI.BlurFilter)) {
                        this.losShadowGraphics._losBlurFilter = new PIXI.BlurFilter();
                    }
                    this.losShadowGraphics._losBlurFilter.blur = shadowBlurStrength;
                    this.losShadowGraphics.filters = [this.losShadowGraphics._losBlurFilter];
                } else if (PIXI.filters && typeof PIXI.filters.BlurFilter === "function") {
                    if (!this.losShadowGraphics._losBlurFilter || !(this.losShadowGraphics._losBlurFilter instanceof PIXI.filters.BlurFilter)) {
                        this.losShadowGraphics._losBlurFilter = new PIXI.filters.BlurFilter();
                    }
                    this.losShadowGraphics._losBlurFilter.blur = shadowBlurStrength;
                    this.losShadowGraphics.filters = [this.losShadowGraphics._losBlurFilter];
                } else {
                    this.losShadowGraphics.filters = null;
                }
            } else {
                this.losShadowGraphics.filters = null;
            }
            return this.losShadowGraphics;
        }

        getLosShadowDepthState() {
            if (this.losShadowDepthState) return this.losShadowDepthState;
            if (typeof PIXI === "undefined" || !PIXI.State) return null;
            const state = new PIXI.State();
            state.depthTest = true;
            state.depthMask = false;
            state.blend = true;
            state.culling = false;
            this.losShadowDepthState = state;
            return state;
        }

        ensureLosShadowDepthMesh() {
            const parent = this.layers && this.layers.depthObjects;
            if (!parent || typeof PIXI === "undefined" || !PIXI.Geometry || !PIXI.Mesh || !PIXI.Shader) return null;
            if (!this.losShadowDepthMesh) {
                const geometry = new PIXI.Geometry()
                    .addAttribute("aWorldPosition", new Float32Array(0), 2)
                    .addIndex(new Uint16Array(0));
                const nearMetric = FLOOR_VISUAL_DEPTH_NEAR_METRIC;
                const farMetric = FLOOR_VISUAL_DEPTH_FAR_METRIC;
                const shader = PIXI.Shader.from(LOS_SHADOW_DEPTH_VS, LOS_SHADOW_DEPTH_FS, {
                    uScreenSize: new Float32Array([1, 1]),
                    uCameraWorld: new Float32Array([0, 0]),
                    uCameraZ: 0,
                    uBaseZ: 0,
                    uDepthBias: LOS_SHADOW_DEPTH_BIAS_UNITS,
                    uViewScale: 1,
                    uXyRatio: 1,
                    uDepthRange: new Float32Array([farMetric, 1 / Math.max(1e-6, farMetric - nearMetric)]),
                    uTint: new Float32Array([0, 0, 0, 0])
                });
                const state = this.getLosShadowDepthState();
                const mesh = new PIXI.Mesh(geometry, shader);
                mesh.name = "renderingLosShadowDepthMesh";
                mesh.interactive = false;
                mesh.visible = false;
                if (state) mesh.state = state;
                this.losShadowDepthMesh = mesh;
            }
            if (this.losShadowDepthMesh.parent !== parent) {
                parent.addChild(this.losShadowDepthMesh);
            }
            return this.losShadowDepthMesh;
        }

        ensureLosShadowDepthMaskGraphics() {
            const parent = this.layers && this.layers.depthObjects;
            if (!parent || typeof PIXI === "undefined" || !PIXI.Graphics) return null;
            if (!this.losShadowDepthMaskGraphics) {
                this.losShadowDepthMaskGraphics = new PIXI.Graphics();
                this.losShadowDepthMaskGraphics.name = "renderingLosShadowDepthFloorMask";
                this.losShadowDepthMaskGraphics.interactive = false;
                this.losShadowDepthMaskGraphics.visible = false;
            }
            if (this.losShadowDepthMaskGraphics.parent !== parent) {
                parent.addChild(this.losShadowDepthMaskGraphics);
            }
            return this.losShadowDepthMaskGraphics;
        }

        clearLosShadowDepthMask() {
            if (this.losShadowDepthMesh) {
                this.losShadowDepthMesh.mask = null;
            }
            if (this.losShadowDepthMaskGraphics) {
                this.losShadowDepthMaskGraphics.clear();
                this.losShadowDepthMaskGraphics.visible = false;
            }
        }

        getLosShadowFloorMaskFragments(ctx, level) {
            const mapRef = ctx && ctx.map ? ctx.map : null;
            if (!mapRef || !(mapRef.floorsById instanceof Map)) return [];
            const targetLevel = this.getLayerIndexFromValue(level, 0);
            const out = [];
            for (const fragment of mapRef.floorsById.values()) {
                if (!fragment) continue;
                const fragmentLevel = Number.isFinite(fragment.level)
                    ? this.getLayerIndexFromValue(fragment.level, 0)
                    : 0;
                if (fragmentLevel !== targetLevel) continue;
                if (fragment._floorEditEmpty === true) continue;
                const outer = normalizeFloorVisualPointList(
                    Array.isArray(fragment.visibilityPolygon) && fragment.visibilityPolygon.length >= 3
                        ? fragment.visibilityPolygon
                        : fragment.outerPolygon
                );
                if (outer.length < 3) continue;
                const holes = Array.isArray(fragment.visibilityHoles) && fragment.visibilityHoles.length > 0
                    ? fragment.visibilityHoles
                    : (Array.isArray(fragment.holes) ? fragment.holes : []);
                const baseZ = Number.isFinite(fragment.nodeBaseZ)
                    ? Number(fragment.nodeBaseZ)
                    : this.getLayerBaseZForLevel(targetLevel);
                out.push({ outer, holes, baseZ });
            }
            return out;
        }

        drawLosShadowFloorMaskRing(maskGraphics, ring, baseZ) {
            if (!maskGraphics || !Array.isArray(ring) || ring.length < 3 || !this.camera) return false;
            let started = false;
            for (let i = 0; i < ring.length; i++) {
                const point = ring[i];
                if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
                const screen = this.camera.worldToScreen(Number(point.x), Number(point.y), baseZ);
                if (!screen || !Number.isFinite(screen.x) || !Number.isFinite(screen.y)) continue;
                if (!started) {
                    maskGraphics.moveTo(screen.x, screen.y);
                    started = true;
                } else {
                    maskGraphics.lineTo(screen.x, screen.y);
                }
            }
            if (started) maskGraphics.closePath();
            return started;
        }

        applyLosShadowDepthFloorMask(ctx, depthMesh, level) {
            if (!depthMesh) return false;
            const fragments = this.getLosShadowFloorMaskFragments(ctx, level);
            if (fragments.length === 0) {
                this.clearLosShadowDepthMask();
                return level === 0;
            }
            const maskGraphics = this.ensureLosShadowDepthMaskGraphics();
            if (!maskGraphics) {
                this.clearLosShadowDepthMask();
                return false;
            }
            maskGraphics.clear();
            maskGraphics.visible = true;
            if (Object.prototype.hasOwnProperty.call(maskGraphics, "renderable")) {
                maskGraphics.renderable = true;
            }
            let polygonCount = 0;
            let holeCount = 0;
            for (let i = 0; i < fragments.length; i++) {
                const fragment = fragments[i];
                maskGraphics.beginFill(0xffffff, 1);
                const drewOuter = this.drawLosShadowFloorMaskRing(maskGraphics, fragment.outer, fragment.baseZ);
                if (drewOuter) {
                    const holes = Array.isArray(fragment.holes) ? fragment.holes : [];
                    const canDrawHoles = typeof maskGraphics.beginHole === "function" && typeof maskGraphics.endHole === "function";
                    if (canDrawHoles) {
                        for (let h = 0; h < holes.length; h++) {
                            const hole = normalizeFloorVisualPointList(holes[h]);
                            if (hole.length < 3) continue;
                            maskGraphics.beginHole();
                            if (this.drawLosShadowFloorMaskRing(maskGraphics, hole, fragment.baseZ)) {
                                holeCount += 1;
                            }
                            maskGraphics.endHole();
                        }
                    }
                    polygonCount += 1;
                }
                maskGraphics.endFill();
            }
            if (polygonCount <= 0) {
                this.clearLosShadowDepthMask();
                return false;
            }
            depthMesh.mask = maskGraphics;
            this.setFrameMetric("losShadowFloorMaskPolygons", polygonCount);
            this.setFrameMetric("losShadowFloorMaskHoles", holeCount);
            return true;
        }

        renderLosShadowOverlay(ctx) {
            const graphics = this.ensureLosShadowGraphics();
            if (!graphics) return;
            graphics.clear();
            graphics.visible = false;
            if (graphics.filters) graphics.filters = null;
            const depthMesh = this.ensureLosShadowDepthMesh();
            if (depthMesh) {
                depthMesh.visible = false;
                depthMesh.mask = null;
            }
            this.clearLosShadowDepthMask();
            if (this.mazeModeOverlayActive) {
                return;
            }

            const shadowEnabled = !!this.getLosVisualSetting("shadowEnabled", true);
            const wizard = ctx && ctx.wizard ? ctx.wizard : null;
            const omnivisionActive = this.isOmnivisionActive(wizard);
            const mazeMode = this.isLosMazeModeEnabled() && !omnivisionActive;
            const shadowOpacityRaw = Number(this.getLosVisualSetting("shadowOpacity", 0.4));
            const shadowOpacity = mazeMode
                ? 1
                : (Number.isFinite(shadowOpacityRaw) ? Math.max(0, Math.min(1, shadowOpacityRaw)) : 0.4);
            const state = this.currentLosState;
            if (omnivisionActive || !shadowEnabled || shadowOpacity <= 0 || !wizard || !state || !state.depth || !Number.isFinite(state.bins)) {
                return;
            }

            const bins = Math.max(3, Math.floor(state.bins));
            const depth = state.depth;
            if (!depth || depth.length !== bins) {
                return;
            }

            const minAngle = Number.isFinite(state.minAngle) ? state.minAngle : -Math.PI;
            const twoPi = Math.PI * 2;
            const viewportRef = (ctx && ctx.viewport) || null;
            const viewportW = viewportRef && Number.isFinite(viewportRef.width) ? viewportRef.width : 24;
            const viewportH = viewportRef && Number.isFinite(viewportRef.height) ? viewportRef.height : 24;
            const farDist = Math.max(viewportW, viewportH) * 1.5;
            const angleForBin = idx => minAngle + ((idx + 0.5) / bins) * twoPi;
            const losHasForwardFov = !!state.hasForwardFov;
            const losFacingAngle = Number.isFinite(state.facingAngle) ? state.facingAngle : 0;
            const losHalfFovRad = Number.isFinite(state.halfFovRad) ? state.halfFovRad : Math.PI;
            const isInsideFov = theta => {
                if (!losHasForwardFov) return true;
                let delta = theta - losFacingAngle;
                while (delta <= -Math.PI) delta += twoPi;
                while (delta > Math.PI) delta -= twoPi;
                return Math.abs(delta) <= losHalfFovRad;
            };
            if (!depthMesh || !depthMesh.geometry || !depthMesh.shader || !depthMesh.shader.uniforms) return;
            const shadowColorRaw = Number(this.getLosVisualSetting("shadowColor", 0x777777));
            const shadowColor = Number.isFinite(shadowColorRaw)
                ? Math.max(0, Math.min(0xffffff, Math.floor(shadowColorRaw)))
                : 0x777777;
            const wizardX = Number(wizard.x) || 0;
            const wizardY = Number(wizard.y) || 0;
            const maxVertexCount = (bins + 1) * 2;
            const maxIndexCount = bins * 6;
            if (!this._losShadowPositionScratch || this._losShadowPositionScratch.length < maxVertexCount * 2) {
                this._losShadowPositionScratch = new Float32Array(maxVertexCount * 2);
            }
            if (!this._losShadowIndexScratch || this._losShadowIndexScratch.length < maxIndexCount) {
                this._losShadowIndexScratch = new Uint16Array(maxIndexCount);
            }
            const positions = this._losShadowPositionScratch;
            const indices = this._losShadowIndexScratch;
            const edgeCoordCount = (bins + 1) * 2;
            if (!this._losShadowEdgeNearScratch || this._losShadowEdgeNearScratch.length < edgeCoordCount) {
                this._losShadowEdgeNearScratch = new Float32Array(edgeCoordCount);
            }
            if (!this._losShadowEdgeFarScratch || this._losShadowEdgeFarScratch.length < edgeCoordCount) {
                this._losShadowEdgeFarScratch = new Float32Array(edgeCoordCount);
            }
            const edgeNear = this._losShadowEdgeNearScratch;
            const edgeFar = this._losShadowEdgeFarScratch;
            let vertexCount = 0;
            let indexCount = 0;
            let runActive = false;
            let previousEdge = -1;
            let shadowRuns = 0;

            const computeEdge = (edgeIndex) => {
                const wrapped = ((edgeIndex % bins) + bins) % bins;
                const theta = angleForBin(wrapped);
                const nearReveal = isInsideFov(theta) ? 0 : LOS_NEAR_REVEAL_RADIUS;
                const d = Number.isFinite(depth[wrapped]) ? Math.max(nearReveal, depth[wrapped]) : farDist;
                const cosT = Math.cos(theta);
                const sinT = Math.sin(theta);
                edgeNear[edgeIndex * 2] = wizardX + cosT * d;
                edgeNear[edgeIndex * 2 + 1] = wizardY + sinT * d;
                edgeFar[edgeIndex * 2] = wizardX + cosT * farDist;
                edgeFar[edgeIndex * 2 + 1] = wizardY + sinT * farDist;
                return d;
            };

            const emitEdgeVertices = (edgeIndex) => {
                if (vertexCount + 2 > 65535) return -1;
                const base = vertexCount;
                const nearOffset = edgeIndex * 2;
                const farOffset = edgeIndex * 2;
                let dst = vertexCount * 2;
                positions[dst] = edgeNear[nearOffset];
                positions[dst + 1] = edgeNear[nearOffset + 1];
                positions[dst + 2] = edgeFar[farOffset];
                positions[dst + 3] = edgeFar[farOffset + 1];
                vertexCount += 2;
                return base;
            };

            for (let i = 0; i < bins; i++) {
                const d0 = computeEdge(i);
                const d1 = computeEdge(i + 1);
                const visibleShadow = d0 < farDist || d1 < farDist;
                if (!visibleShadow) {
                    runActive = false;
                    previousEdge = -1;
                    continue;
                }
                if (!runActive) {
                    previousEdge = emitEdgeVertices(i);
                    if (previousEdge < 0) break;
                    runActive = true;
                    shadowRuns += 1;
                }
                const nextEdge = emitEdgeVertices(i + 1);
                if (nextEdge < 0 || indexCount + 6 > indices.length) break;
                indices[indexCount++] = previousEdge;
                indices[indexCount++] = nextEdge;
                indices[indexCount++] = nextEdge + 1;
                indices[indexCount++] = previousEdge;
                indices[indexCount++] = nextEdge + 1;
                indices[indexCount++] = previousEdge + 1;
                previousEdge = nextEdge;
            }
            if (vertexCount < 3 || indexCount < 3) {
                return;
            }
            const geometry = depthMesh.geometry;
            const positionBuffer = geometry.getBuffer("aWorldPosition");
            const indexBuffer = geometry.getIndex();
            if (!positionBuffer || !indexBuffer) return;
            positionBuffer.data = positions.subarray(0, vertexCount * 2);
            indexBuffer.data = indices.subarray(0, indexCount);
            positionBuffer.update();
            indexBuffer.update();

            const appRef = (ctx && ctx.app) || (typeof app !== "undefined" ? app : (global.app || null));
            const screenW = (appRef && appRef.screen && Number.isFinite(appRef.screen.width)) ? Number(appRef.screen.width) : 1;
            const screenH = (appRef && appRef.screen && Number.isFinite(appRef.screen.height)) ? Number(appRef.screen.height) : 1;
            const wizardLayer = this.getLayerIndexFromValue(Number.isFinite(wizard.currentLayer) ? wizard.currentLayer : 0, 0);
            const baseZ = Number.isFinite(wizard.currentLayerBaseZ)
                ? Number(wizard.currentLayerBaseZ)
                : this.getLayerBaseZForLevel(wizardLayer);
            if (!this.applyLosShadowDepthFloorMask(ctx, depthMesh, wizardLayer)) {
                depthMesh.visible = false;
                return;
            }
            const uniforms = depthMesh.shader.uniforms;
            uniforms.uScreenSize[0] = Math.max(1, screenW);
            uniforms.uScreenSize[1] = Math.max(1, screenH);
            uniforms.uCameraWorld[0] = Number(this.camera.x) || 0;
            uniforms.uCameraWorld[1] = Number(this.camera.y) || 0;
            uniforms.uCameraZ = Number(this.camera.z) || 0;
            uniforms.uBaseZ = baseZ;
            uniforms.uDepthBias = LOS_SHADOW_DEPTH_BIAS_UNITS;
            uniforms.uViewScale = Number(this.camera.viewscale) || 1;
            uniforms.uXyRatio = Number(this.camera.xyratio) || 1;
            uniforms.uDepthRange[0] = FLOOR_VISUAL_DEPTH_FAR_METRIC;
            uniforms.uDepthRange[1] = 1 / Math.max(1e-6, FLOOR_VISUAL_DEPTH_FAR_METRIC - FLOOR_VISUAL_DEPTH_NEAR_METRIC);
            uniforms.uTint[0] = ((shadowColor >> 16) & 0xff) / 255;
            uniforms.uTint[1] = ((shadowColor >> 8) & 0xff) / 255;
            uniforms.uTint[2] = (shadowColor & 0xff) / 255;
            uniforms.uTint[3] = shadowOpacity;
            depthMesh.alpha = 1;
            depthMesh.visible = true;
            if (Object.prototype.hasOwnProperty.call(depthMesh, "renderable")) {
                depthMesh.renderable = true;
            }
            this.setFrameMetric("losShadowDepthVertices", vertexCount);
            this.setFrameMetric("losShadowDepthTriangles", indexCount / 3);
            this.setFrameMetric("losShadowDepthRuns", shadowRuns);
        }

        collectVisibleObjects(visibleNodes, ctx) {
            const nodes = Array.isArray(visibleNodes) ? visibleNodes : [];
            const mapRef = ctx && ctx.map ? ctx.map : null;
            const seen = new Set();
            const out = [];
            let nodeObjectsRefs = 0;
            let nodeVisibilityRefs = 0;
            let duplicateRefsSkipped = 0;
            let skippedBuildingCutaway = 0;
            const cutawayFrameId = Number(this._layerCutawayFrameId) || 0;
            const isHiddenByBuildingCutawayFrame = (item) => !!(
                cutawayFrameId > 0 &&
                item &&
                item._cutawayHiddenFrame === cutawayFrameId
            );
            for (let n = 0; n < nodes.length; n++) {
                const node = nodes[n];
                if (!node) continue;
                const nodeLayer = this.getLayerIndexForNode(node);
                const objectLists = [node.objects, node.visibilityObjects];
                for (let listIndex = 0; listIndex < objectLists.length; listIndex++) {
                    const list = objectLists[listIndex];
                    if (!Array.isArray(list)) continue;
                    if (listIndex === 0) {
                        nodeObjectsRefs += list.length;
                    } else {
                        nodeVisibilityRefs += list.length;
                    }
                    for (let i = 0; i < list.length; i++) {
                        const obj = list[i];
                        if (!obj || obj.gone || obj.vanishing) continue;
                        if (isHiddenByBuildingCutawayFrame(obj)) {
                            skippedBuildingCutaway += 1;
                            continue;
                        }
                        if (
                            mapRef &&
                            mapRef._prototypeTriggerState &&
                            (obj.type === "triggerArea" || obj.isTriggerArea === true)
                        ) {
                            continue;
                        }
                        if (seen.has(obj)) {
                            duplicateRefsSkipped += 1;
                            continue;
                        }
                        obj._renderTraversalLayer = Number.isFinite(obj.traversalLayer)
                            ? this.getLayerIndexFromValue(obj.traversalLayer, nodeLayer)
                            : (Number.isFinite(obj.level)
                                ? this.getLayerIndexFromValue(obj.level, nodeLayer)
                                : nodeLayer);
                        seen.add(obj);
                        out.push(obj);
                    }
                }
            }
            const wallCtor = global.WallSectionUnit;
            const allWallSections = (wallCtor && wallCtor._allSections instanceof Map)
                ? wallCtor._allSections
                : null;
            let globalWallsConsidered = 0;
            let globalWallsAdded = 0;
            let globalWallsSkippedIndexedGround = 0;
            const mountedWallCandidates = [];
            const mountedWallCandidateSet = new Set();
            const addMountedWallCandidate = (wall, wallLayer = 0) => {
                if (!wall || wall.gone || wall.vanishing || !Array.isArray(wall.attachedObjects)) return;
                if (mountedWallCandidateSet.has(wall)) return;
                mountedWallCandidateSet.add(wall);
                mountedWallCandidates.push({
                    wall,
                    wallLayer: this.getLayerIndexFromValue(wallLayer, 0)
                });
            };
            if (allWallSections) {
                const cameraRef = (ctx && ctx.camera) || this.camera || {};
                const appRef = (ctx && ctx.app) || global.app || null;
                const screenW = appRef && appRef.screen && Number.isFinite(appRef.screen.width)
                    ? Number(appRef.screen.width)
                    : (Number.isFinite(cameraRef.screenWidth) ? Number(cameraRef.screenWidth) : 0);
                const screenH = appRef && appRef.screen && Number.isFinite(appRef.screen.height)
                    ? Number(appRef.screen.height)
                    : (Number.isFinite(cameraRef.screenHeight) ? Number(cameraRef.screenHeight) : 0);
                const hasScreenBounds = screenW > 0 && screenH > 0;
                const screenMargin = 256;
                const isWallRoughlyOnscreen = (wall) => {
                    if (!hasScreenBounds || !cameraRef || typeof cameraRef.worldToScreen !== "function") return true;
                    const points = [];
                    const start = wall && wall.startPoint;
                    const end = wall && wall.endPoint;
                    const sx = Number(start && start.x);
                    const sy = Number(start && start.y);
                    const ex = Number(end && end.x);
                    const ey = Number(end && end.y);
                    if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(ex) || !Number.isFinite(ey)) return true;
                    const z = Number.isFinite(wall.bottomZ) ? Number(wall.bottomZ) : 0;
                    points.push(cameraRef.worldToScreen(sx, sy, z));
                    points.push(cameraRef.worldToScreen(ex, ey, z));
                    let cx = (sx + ex) * 0.5;
                    let cy = (sy + ey) * 0.5;
                    if (mapRef && typeof mapRef.shortestDeltaX === "function") cx = sx + mapRef.shortestDeltaX(sx, ex) * 0.5;
                    if (mapRef && typeof mapRef.shortestDeltaY === "function") cy = sy + mapRef.shortestDeltaY(sy, ey) * 0.5;
                    if (mapRef && typeof mapRef.wrapWorldX === "function") cx = mapRef.wrapWorldX(cx);
                    if (mapRef && typeof mapRef.wrapWorldY === "function") cy = mapRef.wrapWorldY(cy);
                    points.push(cameraRef.worldToScreen(cx, cy, z));
                    for (let i = 0; i < points.length; i++) {
                        const pt = points[i];
                        if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) continue;
                        if (
                            pt.x >= -screenMargin &&
                            pt.x <= screenW + screenMargin &&
                            pt.y >= -screenMargin &&
                            pt.y <= screenH + screenMargin
                        ) {
                            return true;
                        }
                    }
                    return false;
                };
                const getWallTraversalLayer = (wall) => {
                    if (wallCtor && typeof wallCtor.getTraversalLayerForSection === "function") {
                        return wallCtor.getTraversalLayerForSection(wall, 0);
                    }
                    if (Number.isFinite(wall && wall.traversalLayer)) return this.getLayerIndexFromValue(wall.traversalLayer, 0);
                    if (Number.isFinite(wall && wall.level)) return this.getLayerIndexFromValue(wall.level, 0);
                    if (Number.isFinite(wall && wall.bottomZ)) return this.getLayerIndexFromValue(Number(wall.bottomZ) / 3, 0);
                    return 0;
                };
                for (const wall of allWallSections.values()) {
                    if (!wall || wall.gone || wall.vanishing || wall.type !== "wallSection") continue;
                    if (mapRef && wall.map && wall.map !== mapRef) continue;
                    globalWallsConsidered += 1;
                    const wallLayer = getWallTraversalLayer(wall);
                    if (isHiddenByBuildingCutawayFrame(wall)) {
                        skippedBuildingCutaway += 1;
                        continue;
                    }
                    if (!isWallRoughlyOnscreen(wall)) continue;
                    addMountedWallCandidate(wall, wallLayer);
                    if (seen.has(wall)) continue;
                    const hasIndexedNodes = Array.isArray(wall.nodes) && wall.nodes.length > 0;
                    if (wallLayer === 0 && hasIndexedNodes) {
                        globalWallsSkippedIndexedGround += 1;
                        continue;
                    }
                    wall._renderTraversalLayer = wallLayer;
                    seen.add(wall);
                    out.push(wall);
                    globalWallsAdded += 1;
                }
            }
            let mountedObjectsAdded = 0;
            const visibleWalls = mountedWallCandidates.length > 0
                ? mountedWallCandidates
                : out
                    .filter(obj => (
                        obj &&
                        obj.type === "wallSection" &&
                        Array.isArray(obj.attachedObjects)
                    ))
                    .map(wall => ({
                        wall,
                        wallLayer: this.getLayerIndexForObject(wall, 0)
                    }));
            for (let i = 0; i < visibleWalls.length; i++) {
                const candidate = visibleWalls[i];
                const wall = candidate && candidate.wall;
                const wallLayer = Number.isFinite(candidate && candidate.wallLayer)
                    ? Number(candidate.wallLayer)
                    : this.getLayerIndexForObject(wall, 0);
                if (!wall || !Array.isArray(wall.attachedObjects)) continue;
                for (let j = 0; j < wall.attachedObjects.length; j++) {
                    const entry = wall.attachedObjects[j];
                    const obj = entry && entry.object;
                    if (!obj || obj.gone || obj.vanishing || seen.has(obj)) continue;
                    if (isHiddenByBuildingCutawayFrame(obj)) {
                        skippedBuildingCutaway += 1;
                        continue;
                    }
                    obj._renderTraversalLayer = wallLayer;
                    seen.add(obj);
                    out.push(obj);
                    mountedObjectsAdded += 1;
                }
            }
            const animalsList = Array.isArray(ctx && ctx.animals)
                ? ctx.animals
                : (Array.isArray(global.animals) ? global.animals : []);
            const animalsPreFilteredVisible = !!(ctx && ctx.animalsPreFilteredVisible);
            let animalsConsidered = 0;
            let animalsAdded = 0;
            let animalsSkippedOffscreen = 0;
            for (let i = 0; i < animalsList.length; i++) {
                const animal = animalsList[i];
                if (!animal || animal.gone || animal.vanishing) continue;
                animalsConsidered += 1;
                if (!animalsPreFilteredVisible && !animal.onScreen) {
                    animalsSkippedOffscreen += 1;
                    continue;
                }
                if (seen.has(animal)) continue;
                animal._renderTraversalLayer = Number.isFinite(animal.traversalLayer)
                    ? Number(animal.traversalLayer)
                    : (Number.isFinite(animal.currentLayer)
                        ? Number(animal.currentLayer)
                        : 0);
                seen.add(animal);
                out.push(animal);
                animalsAdded += 1;
            }
            const wizardRef = (ctx && ctx.wizard) || global.wizard || null;
            if (
                mapRef &&
                wizardRef &&
                typeof mapRef.getPrototypeActiveTriggerDisplayObjectsForActor === "function"
            ) {
                const triggerObjects = mapRef.getPrototypeActiveTriggerDisplayObjectsForActor(wizardRef);
                for (let i = 0; i < triggerObjects.length; i++) {
                    const triggerObj = triggerObjects[i];
                    if (!triggerObj || triggerObj.gone || triggerObj.vanishing) continue;
                    if (seen.has(triggerObj)) continue;
                    seen.add(triggerObj);
                    out.push(triggerObj);
                }
            }
            this.setFrameMetric("visibleObjectNodeRefs", nodeObjectsRefs);
            this.setFrameMetric("visibleObjectVisibilityRefs", nodeVisibilityRefs);
            this.setFrameMetric("visibleObjectDuplicateRefsSkipped", duplicateRefsSkipped);
            this.setFrameMetric("visibleObjectsSkippedBuildingCutaway", skippedBuildingCutaway);
            this.setFrameMetric("visibleGlobalWallsConsidered", globalWallsConsidered);
            this.setFrameMetric("visibleGlobalWallsAdded", globalWallsAdded);
            this.setFrameMetric("visibleGlobalWallsSkippedIndexedGround", globalWallsSkippedIndexedGround);
            this.setFrameMetric("visibleMountedObjectsAdded", mountedObjectsAdded);
            this.setFrameMetric("visibleAnimalCandidates", animalsConsidered);
            this.setFrameMetric("visibleAnimalsAdded", animalsAdded);
            this.setFrameMetric("visibleAnimalsSkippedOffscreen", animalsSkippedOffscreen);
            this.setFrameMetric("visibleObjects", out.length);
            return out;
        }

        collectVisibleNodes(ctx, xPadding = 0, yPadding = 0) {
            const map = ctx.map;
            if (!map || !Array.isArray(map.nodes)) return [];
            const prototypeState = map._prototypeSectionState || null;
            this.setFrameMetric(
                "visibleLoadedNodes",
                prototypeState && Array.isArray(prototypeState.loadedNodes) ? prototypeState.loadedNodes.length : 0
            );
            this.setFrameMetric(
                "visibleNodeCoordIndexSize",
                prototypeState && prototypeState.loadedNodesByCoordKey instanceof Map
                    ? prototypeState.loadedNodesByCoordKey.size
                    : 0
            );
            const nodes = [];
            const seenNodeKeys = new Set();
            const shouldRenderNode = (typeof map.shouldRenderNode === "function")
                ? map.shouldRenderNode.bind(map)
                : null;
            const selectedFloorLevel = Number.isFinite(global.selectedFloorEditLevel)
                ? Math.round(Number(global.selectedFloorEditLevel))
                : 0;
            const isolateFloorLevel = isFloorEditIsolationActive();
            // Floor editor surfaces are polygon meshes now; these tile-like
            // runtime floor nodes are only needed by traversal/pathfinding.
            const collectSyntheticFloorNodes = false;
            const shouldRenderFloorLevel = (node) => {
                if (!node) return false;
                const level = Number.isFinite(node.traversalLayer)
                    ? Number(node.traversalLayer)
                    : (Number.isFinite(node.level) ? Number(node.level) : 0);
                if (!isolateFloorLevel) return true;
                if (Math.round(level) !== selectedFloorLevel) return false;
                const tileKey = `${node.xindex},${node.yindex}`;
                if (selectedFloorLevel !== 0) {
                    const hiddenByLevel = map._floorEditHiddenTileKeysByLevel;
                    if (hiddenByLevel instanceof Map) {
                        const hiddenKeys = hiddenByLevel.get(selectedFloorLevel);
                        if (hiddenKeys instanceof Set && hiddenKeys.has(tileKey)) {
                            return false;
                        }
                    }
                    const sectionKey = typeof node._prototypeSectionKey === "string"
                        ? node._prototypeSectionKey
                        : "";
                    const state = map._prototypeSectionState || null;
                    const asset = sectionKey && state && state.sectionAssetsByKey instanceof Map
                        ? state.sectionAssetsByKey.get(sectionKey)
                        : null;
                    if (asset && Array.isArray(asset.floorHoles)) {
                        for (let i = 0; i < asset.floorHoles.length; i++) {
                            const hole = asset.floorHoles[i];
                            if (!hole || Math.round(Number(hole.level) || 0) !== selectedFloorLevel) continue;
                            if (!(hole._tileCoordKeySet instanceof Set)) {
                                hole._tileCoordKeySet = new Set(Array.isArray(hole.tileCoordKeys) ? hole.tileCoordKeys : []);
                            }
                            if (hole._tileCoordKeySet.has(tileKey)) return false;
                        }
                    }
                }
                return true;
            };
            let skippedByRenderFilter = 0;
            let wrappedNodes = 0;
            let fallbackNodes = 0;
            const addVisibleNode = (node) => {
                if (!node) return false;
                const key = typeof node.id === "string" && node.id.length > 0
                    ? node.id
                    : `${node.xindex},${node.yindex},${Number.isFinite(node.traversalLayer) ? Number(node.traversalLayer) : 0}`;
                if (seenNodeKeys.has(key)) return false;
                seenNodeKeys.add(key);
                nodes.push(node);
                return true;
            };

            this.forEachWrappedNodeInViewport(
                map,
                xPadding,
                yPadding,
                (node) => {
                    if (shouldRenderNode && !shouldRenderNode(node)) {
                        skippedByRenderFilter += 1;
                        return;
                    }
                    if (!shouldRenderFloorLevel(node)) {
                        skippedByRenderFilter += 1;
                        return;
                    }
                    if (addVisibleNode(node)) {
                        wrappedNodes += 1;
                    }
                },
                ctx.camera
            );
            if (isolateFloorLevel && collectSyntheticFloorNodes) {
                this.collectVisibleFloorNodes(ctx, selectedFloorLevel, shouldRenderNode, shouldRenderFloorLevel, addVisibleNode);
            } else {
                this.setFrameMetric("visibleFloorNodes", 0);
            }
            if (nodes.length > 0 || (isolateFloorLevel && selectedFloorLevel !== 0)) {
                this.setFrameMetric("visibleNodes", nodes.length);
                this.setFrameMetric("visibleNodesWrapped", wrappedNodes);
                this.setFrameMetric("visibleNodesFallback", 0);
                this.setFrameMetric("visibleNodeFilterSkipped", skippedByRenderFilter);
                this.setFrameMetric("visibleNodeFallbackUsed", 0);
                return nodes;
            }

            const cam = this.camera;
            const padX = Math.max(0, Number.isFinite(xPadding) ? Math.floor(xPadding) : 0);
            const padY = Math.max(0, Number.isFinite(yPadding) ? Math.floor(yPadding) : 0);
            const minX = Math.max(0, Math.floor(cam.x / 0.866) - padX);
            const maxX = Math.min(map.width - 1, Math.ceil((cam.x + ctx.viewport.width) / 0.866) + padX);
            const minY = Math.max(0, Math.floor(cam.y) - padY);
            const maxY = Math.min(map.height - 1, Math.ceil(cam.y + ctx.viewport.height) + padY);
            for (let x = minX; x <= maxX; x++) {
                const col = map.nodes[x];
                if (!Array.isArray(col)) continue;
                for (let y = minY; y <= maxY; y++) {
                    const node = col[y];
                    if (shouldRenderNode && !shouldRenderNode(node)) {
                        skippedByRenderFilter += 1;
                        continue;
                    }
                    if (!shouldRenderFloorLevel(node)) {
                        skippedByRenderFilter += 1;
                        continue;
                    }
                    if (addVisibleNode(node)) {
                        fallbackNodes += 1;
                    }
                }
            }
            if (isolateFloorLevel && collectSyntheticFloorNodes) {
                this.collectVisibleFloorNodes(ctx, selectedFloorLevel, shouldRenderNode, shouldRenderFloorLevel, addVisibleNode);
            } else {
                this.setFrameMetric("visibleFloorNodes", 0);
            }
            this.setFrameMetric("visibleNodes", nodes.length);
            this.setFrameMetric("visibleNodesWrapped", wrappedNodes);
            this.setFrameMetric("visibleNodesFallback", fallbackNodes);
            this.setFrameMetric("visibleNodeFilterSkipped", skippedByRenderFilter);
            this.setFrameMetric("visibleNodeFallbackUsed", fallbackNodes > 0 ? 1 : 0);
            return nodes;
        }

        collectVisibleFloorNodes(ctx, selectedFloorLevel, shouldRenderNode, shouldRenderFloorLevel, addVisibleNode) {
            const map = ctx && ctx.map;
            if (!map || !(map.floorNodesById instanceof Map)) return 0;
            const cam = this.camera;
            const padX = 4;
            const padY = 4;
            const xScale = 0.866;
            const minX = Math.floor((Number(cam.x) || 0) / xScale) - padX;
            const maxX = Math.ceil(((Number(cam.x) || 0) + (Number(ctx.viewport && ctx.viewport.width) || 0)) / xScale) + padX;
            const minY = Math.floor(Number(cam.y) || 0) - padY;
            const maxY = Math.ceil((Number(cam.y) || 0) + (Number(ctx.viewport && ctx.viewport.height) || 0)) + padY;
            let added = 0;
            for (const floorNodes of map.floorNodesById.values()) {
                if (!Array.isArray(floorNodes) || floorNodes.length === 0) continue;
                for (let i = 0; i < floorNodes.length; i++) {
                    const node = floorNodes[i];
                    if (!node) continue;
                    if (!shouldRenderFloorLevel(node)) continue;
                    if (shouldRenderNode && !shouldRenderNode(node)) continue;
                    const xi = Number(node.xindex);
                    const yi = Number(node.yindex);
                    if (!Number.isFinite(xi) || !Number.isFinite(yi)) continue;
                    if (xi < minX || xi > maxX || yi < minY || yi > maxY) continue;
                    if (addVisibleNode(node)) added += 1;
                }
            }
            if (Number.isFinite(selectedFloorLevel)) {
                this.setFrameMetric("visibleFloorNodes", added);
            }
            return added;
        }

        syncOnscreenObjectsCache(ctx, visibleNodes, visibleObjectsOverride = null) {
            const cache = (typeof global.onscreenObjects !== "undefined") ? global.onscreenObjects : null;
            if (!cache || typeof cache.clear !== "function" || typeof cache.add !== "function") return;
            cache.clear();

            const visibleObjects = Array.isArray(visibleObjectsOverride)
                ? visibleObjectsOverride
                : this.collectVisibleObjects(visibleNodes, ctx);
            let cacheObjectsAdded = 0;
            for (let i = 0; i < visibleObjects.length; i++) {
                const obj = visibleObjects[i];
                if (!obj || obj.gone || obj.vanishing) continue;
                cache.add(obj);
                cacheObjectsAdded += 1;
            }

            const roofList = this.getRoofsList(ctx);
            let cacheRoofsAdded = 0;
            for (let i = 0; i < roofList.length; i++) {
                const roofRef = roofList[i];
                if (!roofRef || roofRef.gone || !roofRef.placed || !roofRef.pixiMesh || !roofRef.pixiMesh.visible) continue;
                cache.add(roofRef);
                cacheRoofsAdded += 1;
            }
            this.setFrameMetric("onscreenCacheObjects", cacheObjectsAdded);
            this.setFrameMetric("onscreenCacheRoofs", cacheRoofsAdded);
        }

        shouldUseDepthBillboard(item) {
            if (!item || item.gone || item.vanishing) return false;
            if (item._flowerBurnFragmentContainer && Array.isArray(item._flowerBurnFragments) && item._flowerBurnFragments.length > 0) {
                return false;
            }
            if (item.type === "road" || item.type === "roof" || item.type === "wallSection") {
                return false;
            }
            if (item.type === "triggerArea" || item.isTriggerArea === true) {
                return false;
            }
            const category = (typeof item.category === "string") ? item.category.trim().toLowerCase() : "";
            const isSpatialDoorOrWindow = !!(
                item.rotationAxis === "spatial" &&
                (category === "windows" || category === "doors" || item.type === "window" || item.type === "door")
            );
            const isWallMountedSpatial = this.isWallMountedSpatialItem(item);
            if (item.rotationAxis === "spatial" && !isSpatialDoorOrWindow) return false;
            if (typeof item.updateDepthBillboardMesh !== "function") return false;
            const sprite = item.pixiSprite;
            if (!sprite && !(typeof item.texturePath === "string" && item.texturePath.length > 0)) return false;
            return true;
        }

        applyScriptBrightness(item, displayObj = null) {
            if (!item) return;
            const scriptingApi = (typeof global.Scripting !== "undefined" && global.Scripting)
                ? global.Scripting
                : ((typeof Scripting !== "undefined" && Scripting) ? Scripting : null);
            if (!scriptingApi || typeof scriptingApi.applyTargetBrightness !== "function") return;
            scriptingApi.applyTargetBrightness(item, displayObj);
        }

        applyFrozenTint(item, displayObj = null) {
            if (!item) return;
            const nowMs = Date.now();
            const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));
            const fullyFrozenBaseTint = 0x2222ff;
            const freezeBrightnessFilterKey = "__freezeBrightnessFilter";
            const freezeTemperatureRecoverRateDegreesPerSecond = 1;
            const frozenUntilMs = Number(item._freezeTintUntilMs);
            const degreesBelowBaseline = (typeof item.getDegreesBelowBaseline === "function")
                ? Math.max(0, Number(item.getDegreesBelowBaseline()) || 0)
                : 0;
            const baselineTemperature = (typeof item.getTemperatureBaseline === "function")
                ? Number(item.getTemperatureBaseline())
                : Number(item.baselineTemperature);
            const freezeThreshold = (typeof item.getFreezeTemperatureThreshold === "function")
                ? Number(item.getFreezeTemperatureThreshold())
                : -20;
            const fullFreezeDegrees = Math.max(
                1,
                Number.isFinite(baselineTemperature) && Number.isFinite(freezeThreshold)
                    ? Math.abs(baselineTemperature - freezeThreshold)
                    : 20
            );
            const isDead = item.dead === true;
            const isTemperatureFrozen = typeof item.isTemperatureFrozen === "function" && item.isTemperatureFrozen();
            const hasFreezeFlash = Number.isFinite(frozenUntilMs) && frozenUntilMs > nowMs;
            const deadFreezeFadeCompleted = isDead && item._freezeDeathFadeCompleted === true;
            const liveTemperatureFreezeProgress = clamp01(degreesBelowBaseline / fullFreezeDegrees);
            const liveFreezeProgress = deadFreezeFadeCompleted
                ? 0
                : Math.max(liveTemperatureFreezeProgress, hasFreezeFlash ? 0.35 : 0);
            const hadFrozenVisualState = !!(
                !deadFreezeFadeCompleted && (
                    liveFreezeProgress > 1e-6 ||
                    Number.isFinite(item._freezeOriginalTint) ||
                    Number.isFinite(item._freezeDeathFadeStartedAtMs) ||
                    Number.isFinite(item._freezeDeathFadeInitialDegreesBelow)
                )
            );
            if (isDead && hadFrozenVisualState && !Number.isFinite(item._freezeDeathFadeStartedAtMs)) {
                item._freezeDeathFadeStartedAtMs = nowMs;
                item._freezeDeathFadeInitialDegreesBelow = Math.max(0, liveFreezeProgress * fullFreezeDegrees);
                item._freezeDeathFadeCompleted = false;
            } else if (!isDead && Number.isFinite(item._freezeDeathFadeStartedAtMs)) {
                item._freezeDeathFadeStartedAtMs = null;
                item._freezeDeathFadeInitialDegreesBelow = null;
                item._freezeDeathFadeCompleted = null;
            }
            const deathFadeStartMs = Number(item._freezeDeathFadeStartedAtMs);
            const deathFadeInitialDegreesBelow = Number(item._freezeDeathFadeInitialDegreesBelow);
            const corpseDegreesBelowBaseline = (isDead && Number.isFinite(deathFadeStartMs))
                ? Math.max(
                    0,
                    (Number.isFinite(deathFadeInitialDegreesBelow)
                        ? deathFadeInitialDegreesBelow
                        : (liveFreezeProgress * fullFreezeDegrees)) -
                    (((nowMs - deathFadeStartMs) / 1000) * freezeTemperatureRecoverRateDegreesPerSecond)
                )
                : null;
            const freezeProgress = isDead
                ? clamp01((Number.isFinite(corpseDegreesBelowBaseline) ? corpseDegreesBelowBaseline : 0) / fullFreezeDegrees)
                : liveFreezeProgress;
            const shouldRenderFrozen = hadFrozenVisualState && freezeProgress > 1e-6;
            const targetTint = Number.isFinite(item._freezeTintColor)
                ? Math.max(0, Math.min(0xFFFFFF, Math.floor(Number(item._freezeTintColor))))
                : 0x9fd8ff;
            const baseTint = Number.isFinite(item.tint)
                ? Math.max(0, Math.min(0xFFFFFF, Math.floor(Number(item.tint))))
                : (Number.isFinite(item._freezeOriginalTint) ? Number(item._freezeOriginalTint) : 0xFFFFFF);
            const displayObjects = new Set();
            if (displayObj && typeof displayObj === "object") displayObjects.add(displayObj);
            if (item.pixiSprite && typeof item.pixiSprite === "object") displayObjects.add(item.pixiSprite);
            if (item._renderingDepthMesh && typeof item._renderingDepthMesh === "object") displayObjects.add(item._renderingDepthMesh);
            if (item._renderingDisplayObject && typeof item._renderingDisplayObject === "object") displayObjects.add(item._renderingDisplayObject);
            if (item._compositeUnderlayMesh && typeof item._compositeUnderlayMesh === "object") displayObjects.add(item._compositeUnderlayMesh);

            if (shouldRenderFrozen) {
                if (!Number.isFinite(item._freezeOriginalTint)) {
                    const currentTint = Number.isFinite(item.tint)
                        ? Number(item.tint)
                        : (item.pixiSprite && Number.isFinite(item.pixiSprite.tint) ? Number(item.pixiSprite.tint) : 0xFFFFFF);
                    item._freezeOriginalTint = Math.max(0, Math.min(0xFFFFFF, Math.floor(currentTint)));
                }
                const blendColor = (fromColor, toColor, factor) => {
                    const t = Math.max(0, Math.min(1, Number(factor) || 0));
                    const fromR = (fromColor >> 16) & 0xFF;
                    const fromG = (fromColor >> 8) & 0xFF;
                    const fromB = fromColor & 0xFF;
                    const toR = (toColor >> 16) & 0xFF;
                    const toG = (toColor >> 8) & 0xFF;
                    const toB = toColor & 0xFF;
                    const r = Math.round(fromR + ((toR - fromR) * t));
                    const g = Math.round(fromG + ((toG - fromG) * t));
                    const b = Math.round(fromB + ((toB - fromB) * t));
                    return (r << 16) | (g << 8) | b;
                };
                const applyFreezeBrightness = (obj, brightnessPercent = null) => {
                    if (!obj || typeof obj !== "object") return;
                    if (
                        obj.shader &&
                        obj.shader.uniforms &&
                        Object.prototype.hasOwnProperty.call(obj.shader.uniforms, "uBrightness")
                    ) {
                        obj.shader.uniforms.uBrightness = Number.isFinite(brightnessPercent)
                            ? Math.max(-1, Math.min(1, Number(brightnessPercent) / 100))
                            : 0;
                        return;
                    }
                    const pixiScope = (typeof PIXI !== "undefined" && PIXI)
                        ? PIXI
                        : ((typeof globalThis !== "undefined" && globalThis.PIXI) ? globalThis.PIXI : null);
                    const ColorMatrixFilterCtor = pixiScope && pixiScope.filters && pixiScope.filters.ColorMatrixFilter;
                    const SpriteCtor = pixiScope && pixiScope.Sprite;
                    const currentFilters = Array.isArray(obj.filters) ? obj.filters.filter(Boolean) : [];
                    const existingFilter = obj[freezeBrightnessFilterKey];
                    const retainedFilters = currentFilters.filter(filter => filter !== existingFilter);
                    const isSprite = (typeof SpriteCtor === "function") && (obj instanceof SpriteCtor);
                    if (!isSprite || typeof ColorMatrixFilterCtor !== "function") {
                        obj[freezeBrightnessFilterKey] = null;
                        obj.filters = retainedFilters.length > 0 ? retainedFilters : null;
                        return;
                    }
                    if (!(Number.isFinite(brightnessPercent) && brightnessPercent > 1e-6)) {
                        obj[freezeBrightnessFilterKey] = null;
                        obj.filters = retainedFilters.length > 0 ? retainedFilters : null;
                        return;
                    }
                    const normalized = clamp01(Number(brightnessPercent) / 100);
                    const whiteMix = 0.55 * normalized;
                    const scale = 1 - whiteMix;
                    const filter = (existingFilter instanceof ColorMatrixFilterCtor)
                        ? existingFilter
                        : new ColorMatrixFilterCtor();
                    filter.matrix = [
                        scale, 0, 0, 0, whiteMix,
                        0, scale, 0, 0, whiteMix,
                        0, 0, scale, 0, whiteMix,
                        0, 0, 0, 1, 0
                    ];
                    obj[freezeBrightnessFilterKey] = filter;
                    retainedFilters.push(filter);
                    obj.filters = retainedFilters;
                };
                const freezeFadeScale = (isDead && liveFreezeProgress > 1e-6)
                    ? clamp01(freezeProgress / liveFreezeProgress)
                    : 1;
                const impactFlashBlend = (hasFreezeFlash ? 1 : 0) * freezeFadeScale;
                const coldTintBlend = Math.max(
                    (!isDead && isTemperatureFrozen ? 1 : 0),
                    clamp01(0.2 + (freezeProgress * 0.8))
                );
                const intermediateTint = blendColor(baseTint, targetTint, Math.max(impactFlashBlend, coldTintBlend));
                const appliedTint = blendColor(intermediateTint, fullyFrozenBaseTint, freezeProgress);
                const appliedBrightness = 35 * freezeProgress;
                displayObjects.forEach(obj => {
                    if (Number.isFinite(obj.tint)) obj.tint = appliedTint;
                    applyFreezeBrightness(obj, appliedBrightness);
                });
                return;
            }

            if (
                Number.isFinite(item._freezeOriginalTint) ||
                Number.isFinite(frozenUntilMs) ||
                Number.isFinite(item._freezeDeathFadeStartedAtMs) ||
                item._freezeDeathFadeCompleted === true
            ) {
                displayObjects.forEach(obj => {
                    if (Number.isFinite(obj.tint)) obj.tint = baseTint;
                    if (
                        obj &&
                        typeof obj === "object" &&
                        obj.shader &&
                        obj.shader.uniforms &&
                        Object.prototype.hasOwnProperty.call(obj.shader.uniforms, "uBrightness")
                    ) {
                        obj.shader.uniforms.uBrightness = 0;
                    }
                    if (obj && typeof obj === "object" && Object.prototype.hasOwnProperty.call(obj, freezeBrightnessFilterKey)) {
                        const currentFilters = Array.isArray(obj.filters) ? obj.filters.filter(Boolean) : [];
                        const existingFilter = obj[freezeBrightnessFilterKey];
                        const retainedFilters = currentFilters.filter(filter => filter !== existingFilter);
                        obj[freezeBrightnessFilterKey] = null;
                        obj.filters = retainedFilters.length > 0 ? retainedFilters : null;
                    }
                });
                item._freezeTintUntilMs = 0;
                item._freezeTintColor = null;
                item._freezeOriginalTint = null;
                item._freezeDeathFadeStartedAtMs = null;
                item._freezeDeathFadeInitialDegreesBelow = null;
                item._freezeDeathFadeCompleted = isDead ? true : null;
            }
        }

        isDebugModeEnabled() {
            return !!(
                (typeof debugMode !== "undefined" && debugMode) ||
                global.debugMode
            );
        }

        shouldRevealScriptHiddenInDebug(item) {
            return !!(item && item.visible === false && this.isDebugModeEnabled());
        }

        isScriptVisible(item) {
            if (!(item && item.visible === false)) return true;
            return this.shouldRevealScriptHiddenInDebug(item);
        }

        getScriptDisplayAlpha(item) {
            if (this.shouldRevealScriptHiddenInDebug(item)) {
                return 0.35;
            }
            return 1;
        }

        isForceVisible(item) {
            if (!item) return false;
            if (item.forceVisible === true || item._forceVisible === true) return true;
            if (item.forceVisible === 1 || item._forceVisible === 1) return true;
            if (typeof item.forceVisible === "string" && item.forceVisible.trim().toLowerCase() === "true") return true;
            if (typeof item._forceVisible === "string" && item._forceVisible.trim().toLowerCase() === "true") return true;
            return false;
        }

        updateSinkAnimation(item, nowMs = null) {
            if (!item || typeof item !== "object") return 0;
            const sinkState = (item._scriptSinkState && typeof item._scriptSinkState === "object")
                ? item._scriptSinkState
                : null;
            if (!sinkState) return 0;
            const baseProperty = (typeof sinkState.baseProperty === "string" && sinkState.baseProperty.length > 0)
                ? sinkState.baseProperty
                : (item.type === "wallSection" ? "bottomZ" : "z");
            const startBase = Number.isFinite(sinkState.startBase) ? Number(sinkState.startBase) : 0;
            const targetBase = Number.isFinite(sinkState.targetBase) ? Number(sinkState.targetBase) : startBase;
            const durationMs = Number.isFinite(sinkState.durationMs) ? Math.max(0, Number(sinkState.durationMs)) : 0;
            const candidateNowMs = Number.isFinite(nowMs) ? Number(nowMs) : NaN;
            const currentMs = (Number.isFinite(candidateNowMs) && candidateNowMs > 1e12)
                ? candidateNowMs
                : Date.now();
            const pausedUntilMs = Number(item._scriptPausedUntilMs);
            const frozenUntilMs = Number(item._scriptFrozenUntilMs);
            const blockedUntilMs = Math.max(
                Number.isFinite(pausedUntilMs) ? pausedUntilMs : 0,
                frozenUntilMs > 0 ? frozenUntilMs : 0
            );
            const wasBlocked = blockedUntilMs > currentMs;
            const lastUpdateMs = Number.isFinite(sinkState.lastUpdateMs) ? Number(sinkState.lastUpdateMs) : currentMs;
            if (!wasBlocked) {
                const deltaMs = Math.max(0, currentMs - lastUpdateMs);
                sinkState.elapsedMs = Math.max(0, Number(sinkState.elapsedMs) || 0) + deltaMs;
            }
            sinkState.lastUpdateMs = currentMs;
            const animationProgress = durationMs > 0
                ? Math.max(0, Math.min(1, (Number(sinkState.elapsedMs) || 0) / durationMs))
                : 1;
            const startProgress = Number.isFinite(sinkState.startProgress)
                ? Math.max(0, Math.min(1, Number(sinkState.startProgress)))
                : 0;
            const targetProgress = Number.isFinite(sinkState.targetProgress)
                ? Math.max(0, Math.min(1, Number(sinkState.targetProgress)))
                : 1;
            const progress = startProgress + ((targetProgress - startProgress) * animationProgress);
            const nextBase = startBase + (targetBase - startBase) * animationProgress;
            const prevBase = Number.isFinite(item[baseProperty]) ? Number(item[baseProperty]) : startBase;
            const heightProperty = (typeof sinkState.heightProperty === "string" && sinkState.heightProperty.length > 0)
                ? sinkState.heightProperty
                : "";
            const startHeight = Number.isFinite(sinkState.startHeight) ? Math.max(0, Number(sinkState.startHeight)) : NaN;
            const targetHeight = Number.isFinite(sinkState.targetHeight) ? Math.max(0, Number(sinkState.targetHeight)) : NaN;
            const prevHeight = (heightProperty && Number.isFinite(item[heightProperty]))
                ? Math.max(0, Number(item[heightProperty]))
                : NaN;
            item[baseProperty] = nextBase;
            if (baseProperty === "z") {
                if (Number.isFinite(item.prevZ) || Object.prototype.hasOwnProperty.call(item, "prevZ")) {
                    item.prevZ = nextBase;
                }
                if (Number.isFinite(item.heightFromGround) || item.type === "roof") {
                    item.heightFromGround = nextBase;
                }
            }
            const nextHeight = (heightProperty && Number.isFinite(startHeight) && Number.isFinite(targetHeight))
                ? Math.max(0, startHeight + ((targetHeight - startHeight) * animationProgress))
                : NaN;
            if (heightProperty && Number.isFinite(startHeight)) {
                item[heightProperty] = nextHeight;
            }
            if (
                (baseProperty === "bottomZ" && Math.abs(nextBase - prevBase) > 1e-6) ||
                (heightProperty && Number.isFinite(prevHeight) && Number.isFinite(nextHeight) && Math.abs(nextHeight - prevHeight) > 1e-6)
            ) {
                if (Object.prototype.hasOwnProperty.call(item, "mesh3d")) {
                    item.mesh3d = null;
                }
                if (Object.prototype.hasOwnProperty.call(item, "_depthGeometryCache")) {
                    item._depthGeometryCache = null;
                }
            }
            sinkState.progress = progress;
            sinkState.currentBase = nextBase;
            const prevNonBlocking = !!sinkState.nonBlocking;
            const prevLosTransparent = !!sinkState.losTransparent;
            if (typeof globalThis !== "undefined" && typeof globalThis.syncTargetSinkInteractionState === "function") {
                globalThis.syncTargetSinkInteractionState(item);
            }
            if (
                (prevNonBlocking !== !!sinkState.nonBlocking || prevLosTransparent !== !!sinkState.losTransparent) &&
                typeof globalThis !== "undefined" &&
                typeof globalThis.refreshTargetSinkBlocking === "function"
            ) {
                globalThis.refreshTargetSinkBlocking(item);
            }
            sinkState.active = animationProgress < 1;
            if (animationProgress >= 1 && sinkState.nonBlocking === false) {
                if (typeof globalThis !== "undefined" && typeof globalThis.restoreTargetSinkBlockingState === "function") {
                    globalThis.restoreTargetSinkBlockingState(item, sinkState);
                }
                item._scriptSinkState = null;
            }
            return progress;
        }

        clearSinkClip(item, displayObj = null) {
            const obj = displayObj || (item && item._renderingDisplayObject) || null;
            if (obj && obj.mask && item && item._scriptSinkMaskGraphics && obj.mask === item._scriptSinkMaskGraphics) {
                obj.mask = null;
            }
            if (item && item._scriptSinkMaskGraphics) {
                item._scriptSinkMaskGraphics.clear();
                item._scriptSinkMaskGraphics.visible = false;
                if (Object.prototype.hasOwnProperty.call(item._scriptSinkMaskGraphics, "renderable")) {
                    item._scriptSinkMaskGraphics.renderable = false;
                }
            }
        }

        applySinkClip(item, displayObj = null) {
            if (!item || !displayObj) return true;
            const sinkState = (item._scriptSinkState && typeof item._scriptSinkState === "object")
                ? item._scriptSinkState
                : null;
            const progress = sinkState && Number.isFinite(sinkState.progress)
                ? Math.max(0, Math.min(1, Number(sinkState.progress)))
                : 0;
            if (progress <= 1e-4) {
                this.clearSinkClip(item, displayObj);
                return true;
            }
            const visibleRatio = Math.max(0, 1 - progress);
            if (visibleRatio <= 1e-4) {
                this.clearSinkClip(item, displayObj);
                displayObj.visible = false;
                if (Object.prototype.hasOwnProperty.call(displayObj, "renderable")) {
                    displayObj.renderable = false;
                }
                return false;
            }
            displayObj.visible = true;
            if (Object.prototype.hasOwnProperty.call(displayObj, "renderable")) {
                displayObj.renderable = true;
            }
            if (!displayObj.parent || typeof displayObj.getBounds !== "function" || typeof PIXI === "undefined") {
                return true;
            }
            if (displayObj instanceof PIXI.Mesh) {
                this.clearSinkClip(item, displayObj);
                return true;
            }
            if (!item._scriptSinkMaskGraphics) {
                item._scriptSinkMaskGraphics = new PIXI.Graphics();
                item._scriptSinkMaskGraphics.name = "renderingSinkMask";
                item._scriptSinkMaskGraphics.interactive = false;
            }
            const maskGraphics = item._scriptSinkMaskGraphics;
            if (maskGraphics.parent !== displayObj.parent) {
                displayObj.parent.addChild(maskGraphics);
            }
            const bounds = displayObj.getBounds();
            if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y) ||
                !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height) ||
                bounds.width <= 0 || bounds.height <= 0) {
                this.clearSinkClip(item, displayObj);
                return true;
            }
            const groundPoint = (
                this.camera &&
                Number.isFinite(item.x) &&
                Number.isFinite(item.y) &&
                typeof this.camera.worldToScreen === "function"
            )
                ? this.camera.worldToScreen(Number(item.x), Number(item.y), 0)
                : null;
            const clipBottom = (groundPoint && Number.isFinite(groundPoint.y))
                ? Math.min(bounds.y + bounds.height, Number(groundPoint.y))
                : (bounds.y + Math.max(0.5, bounds.height * visibleRatio));
            const visibleHeight = clipBottom - bounds.y;
            if (!(visibleHeight > 0.5)) {
                this.clearSinkClip(item, displayObj);
                displayObj.visible = false;
                if (Object.prototype.hasOwnProperty.call(displayObj, "renderable")) {
                    displayObj.renderable = false;
                }
                return false;
            }
            maskGraphics.clear();
            maskGraphics.beginFill(0xffffff, 1);
            maskGraphics.drawRect(bounds.x, bounds.y, bounds.width, visibleHeight);
            maskGraphics.endFill();
            maskGraphics.visible = true;
            if (Object.prototype.hasOwnProperty.call(maskGraphics, "renderable")) {
                maskGraphics.renderable = true;
            }
            displayObj.mask = maskGraphics;
            return true;
        }

        shouldShowTriggerAreaPickerPolygon() {
            const activeSpell = this.getActiveToolSpellName();
            return activeSpell === "editscript";
        }

        isWallBottomFaceOutlineDebugEnabled() {
            const wallCtor = global.WallSectionUnit || null;
            return !!(wallCtor && wallCtor._showBottomFaceOnlyDebug);
        }

        renderDoorBottomFaceDebugOutline(item, container) {
            if (!item || !item.pixiSprite || !container || typeof PIXI === "undefined") return false;
            if (!item._doorBottomFaceDebugGraphics) {
                item._doorBottomFaceDebugGraphics = new PIXI.Graphics();
                item._doorBottomFaceDebugGraphics.name = "renderingDoorBottomFaceDebugOutline";
                item._doorBottomFaceDebugGraphics.visible = false;
                item._doorBottomFaceDebugGraphics.interactive = false;
            }
            this.applySpriteTransform(item);
            const sprite = item.pixiSprite;
            const g = item._doorBottomFaceDebugGraphics;
            if (g.parent !== container) {
                container.addChild(g);
            }
            const width = Number(sprite.width) || 0;
            const height = Number(sprite.height) || 0;
            const x = Number(sprite.x);
            const y = Number(sprite.y);
            if (!(width > 0) || !(height > 0) || !Number.isFinite(x) || !Number.isFinite(y)) {
                g.visible = false;
                return false;
            }
            const anchorX = (sprite.anchor && Number.isFinite(sprite.anchor.x)) ? Number(sprite.anchor.x) : 0.5;
            const anchorY = (sprite.anchor && Number.isFinite(sprite.anchor.y)) ? Number(sprite.anchor.y) : 1;
            g.clear();
            g.position.set(x, y);
            g.rotation = Number(sprite.rotation) || 0;
            g.alpha = this.getScriptDisplayAlpha(item);
            g.lineStyle(2, 0x33cc66, 1);
            g.drawRect(-anchorX * width, -anchorY * height, width, height);
            g.visible = true;
            if (Object.prototype.hasOwnProperty.call(g, "renderable")) {
                g.renderable = true;
            }
            return true;
        }

        getActiveToolSpellName(wizardOverride = null) {
            const wizard = wizardOverride || global.wizard || null;
            if (!wizard) return "";
            if (typeof wizard.currentSpell === "string" && wizard.currentSpell.length > 0) {
                return wizard.currentSpell;
            }
            if (typeof wizard.selectedSpellName === "string" && wizard.selectedSpellName.length > 0) {
                return wizard.selectedSpellName;
            }
            return "";
        }

        shouldShowTriggerAreaToolOutlines(wizardOverride = null) {
            if (this.isDebugModeEnabled()) return true;
            const activeSpell = this.getActiveToolSpellName(wizardOverride);
            if (global.renderingShowPickerScreen) {
                return activeSpell === "editscript";
            }
            return activeSpell === "editscript" || activeSpell === "triggerarea";
        }

        shouldShowTriggerAreaVertexMarkersForTool(wizardOverride = null) {
            const activeSpell = this.getActiveToolSpellName(wizardOverride);
            return activeSpell === "triggerarea";
        }

        isTriggerAreaHighlighted(item) {
            if (!item) return false;
            const pickerApi = (typeof global.renderingScenePicker !== "undefined")
                ? global.renderingScenePicker
                : null;
            if (!pickerApi || typeof pickerApi.getHoveredObject !== "function") return false;
            try {
                return pickerApi.getHoveredObject() === item;
            } catch (_err) {
                return false;
            }
        }

        getTriggerAreaOutlineClipRect() {
            const appRef = (typeof app !== "undefined" && app)
                ? app
                : (global.app || null);
            const screenWidth = Math.max(
                1,
                Number(appRef && appRef.renderer && appRef.renderer.width) ||
                Number(appRef && appRef.screen && appRef.screen.width) ||
                Number(window && window.innerWidth) ||
                1
            );
            const screenHeight = Math.max(
                1,
                Number(appRef && appRef.renderer && appRef.renderer.height) ||
                Number(appRef && appRef.screen && appRef.screen.height) ||
                Number(window && window.innerHeight) ||
                1
            );
            const insetX = Math.max(0, (Number(this.camera && this.camera.viewscale) || 1) * 0.5);
            const insetY = Math.max(0, (Number(this.camera && this.camera.viewscale) || 1) * (Number(this.camera && this.camera.xyratio) || 1) * 0.5);
            const rect = {
                left: insetX,
                top: insetY,
                right: screenWidth - insetX,
                bottom: screenHeight - insetY
            };
            if (!(rect.right > rect.left) || !(rect.bottom > rect.top)) return null;
            return rect;
        }

        clipPolygonAgainstBoundary(points, isInside, intersect) {
            const input = Array.isArray(points) ? points : [];
            if (input.length === 0) return [];
            const output = [];
            let previous = input[input.length - 1];
            let previousInside = !!isInside(previous);
            for (let i = 0; i < input.length; i++) {
                const current = input[i];
                const currentInside = !!isInside(current);
                if (currentInside) {
                    if (!previousInside) {
                        const entry = intersect(previous, current);
                        if (entry) output.push(entry);
                    }
                    output.push(current);
                } else if (previousInside) {
                    const exit = intersect(previous, current);
                    if (exit) output.push(exit);
                }
                previous = current;
                previousInside = currentInside;
            }
            return output;
        }

        clipTriggerAreaScreenPolygon(points, rect) {
            let clipped = Array.isArray(points)
                ? points
                    .filter((pt) => pt && Number.isFinite(pt.x) && Number.isFinite(pt.y))
                    .map((pt) => ({ x: Number(pt.x), y: Number(pt.y) }))
                : [];
            if (!rect || clipped.length < 3) return clipped;
            const intersectVertical = (boundaryX) => (a, b) => {
                const dx = Number(b.x) - Number(a.x);
                if (Math.abs(dx) <= 1e-7) {
                    return { x: boundaryX, y: Number(a.y) };
                }
                const t = (boundaryX - Number(a.x)) / dx;
                return {
                    x: boundaryX,
                    y: Number(a.y) + (Number(b.y) - Number(a.y)) * t
                };
            };
            const intersectHorizontal = (boundaryY) => (a, b) => {
                const dy = Number(b.y) - Number(a.y);
                if (Math.abs(dy) <= 1e-7) {
                    return { x: Number(a.x), y: boundaryY };
                }
                const t = (boundaryY - Number(a.y)) / dy;
                return {
                    x: Number(a.x) + (Number(b.x) - Number(a.x)) * t,
                    y: boundaryY
                };
            };
            clipped = this.clipPolygonAgainstBoundary(clipped, (pt) => Number(pt.x) >= rect.left, intersectVertical(rect.left));
            clipped = this.clipPolygonAgainstBoundary(clipped, (pt) => Number(pt.x) <= rect.right, intersectVertical(rect.right));
            clipped = this.clipPolygonAgainstBoundary(clipped, (pt) => Number(pt.y) >= rect.top, intersectHorizontal(rect.top));
            clipped = this.clipPolygonAgainstBoundary(clipped, (pt) => Number(pt.y) <= rect.bottom, intersectHorizontal(rect.bottom));
            return clipped;
        }

        renderTriggerAreaOmnivisionOutline(item, container, omnivisionActive, wizardOverride = null) {
            if (!item) return;
            if (!item._triggerOutlineGraphics) {
                item._triggerOutlineGraphics = new PIXI.Graphics();
                item._triggerOutlineGraphics.name = "renderingTriggerAreaOutline";
                item._triggerOutlineGraphics.visible = false;
                item._triggerOutlineGraphics.interactive = false;
            }
            const g = item._triggerOutlineGraphics;
            if (g.parent !== container) {
                container.addChild(g);
            }
            g.clear();
            const points = (item.groundPlaneHitbox && Array.isArray(item.groundPlaneHitbox.points))
                ? item.groundPlaneHitbox.points
                : null;
            if (!this.shouldShowTriggerAreaToolOutlines(wizardOverride) || !points || points.length < 3) {
                g.visible = false;
                return;
            }
            const screenPoints = [];
            for (let i = 0; i < points.length; i++) {
                const pt = points[i];
                if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) continue;
                const sp = this.camera.worldToScreen(Number(pt.x), Number(pt.y), 0);
                if (!sp || !Number.isFinite(sp.x) || !Number.isFinite(sp.y)) continue;
                screenPoints.push(sp);
            }
            if (screenPoints.length < 3) {
                g.visible = false;
                return;
            }

            const clippedPoints = this.clipTriggerAreaScreenPolygon(
                screenPoints,
                this.getTriggerAreaOutlineClipRect()
            );
            if (!Array.isArray(clippedPoints) || clippedPoints.length < 2) {
                g.visible = false;
                return;
            }

            const dashLengthPx = 10;
            const gapLengthPx = 6;
            const outlineColor = this.isTriggerAreaHighlighted(item) ? 0x66c2ff : 0xffffff;
            g.lineStyle(3, outlineColor, 1);
            let drewAny = false;
            for (let i = 0; i < clippedPoints.length; i++) {
                const a = clippedPoints[i];
                const b = clippedPoints[(i + 1) % clippedPoints.length];
                const dx = Number(b.x) - Number(a.x);
                const dy = Number(b.y) - Number(a.y);
                const len = Math.hypot(dx, dy);
                if (!(len > 0)) continue;
                const ux = dx / len;
                const uy = dy / len;
                let dist = 0;
                while (dist < len) {
                    const dashStart = dist;
                    const dashEnd = Math.min(len, dist + dashLengthPx);
                    g.moveTo(
                        Number(a.x) + ux * dashStart,
                        Number(a.y) + uy * dashStart
                    );
                    g.lineTo(
                        Number(a.x) + ux * dashEnd,
                        Number(a.y) + uy * dashEnd
                    );
                    drewAny = true;
                    dist += dashLengthPx + gapLengthPx;
                }
            }
            g.visible = drewAny;
        }

        renderTriggerAreaVertexMarkers(item, container, wizardOverride = null) {
            if (!item) return;
            if (!item._triggerVertexGraphics) {
                item._triggerVertexGraphics = new PIXI.Graphics();
                item._triggerVertexGraphics.name = "renderingTriggerAreaVertices";
                item._triggerVertexGraphics.visible = false;
                item._triggerVertexGraphics.interactive = false;
            }
            const g = item._triggerVertexGraphics;
            if (g.parent !== container) {
                container.addChild(g);
            }
            g.clear();
            const points = (item.groundPlaneHitbox && Array.isArray(item.groundPlaneHitbox.points))
                ? item.groundPlaneHitbox.points
                : null;
            if (!this.shouldShowTriggerAreaVertexMarkersForTool(wizardOverride) || !points || points.length < 3) {
                g.visible = false;
                return;
            }

            const wizard = global.wizard || null;
            const spellSystemRef = (typeof SpellSystem !== "undefined")
                ? SpellSystem
                : (global.SpellSystem || null);
            const selection = (
                wizard &&
                spellSystemRef &&
                typeof spellSystemRef.getTriggerAreaVertexSelection === "function"
            )
                ? spellSystemRef.getTriggerAreaVertexSelection(wizard)
                : null;

            g.lineStyle(2, 0xffffff, 1);
            for (let i = 0; i < points.length; i++) {
                const pt = points[i];
                if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) continue;
                const sp = this.camera.worldToScreen(Number(pt.x), Number(pt.y), 0);
                if (!sp || !Number.isFinite(sp.x) || !Number.isFinite(sp.y)) continue;
                const isSelected = !!(selection && selection.area === item && selection.vertexIndex === i);
                g.drawCircle(sp.x, sp.y, isSelected ? 10 : 6);
            }
            g.visible = true;
            this.promoteInteriorPresentationDisplayObject(g, ctx);
        }

        renderDepthBillboardObjects(ctx, renderItems) {
            const container = this.layers.depthObjects;
            const characterContainer = this.getCharacterLayer() || container;
            const groundContainer = this.layers.groundObjects;
            if (!container) return new Set();
            const depthRenderedItems = new Set();
            const currentMeshes = new Set();
            const currentItems = new Set();
            const wizardRef = (ctx && ctx.wizard) || global.wizard || null;
            const mazeModeForDepth = this.isLosMazeModeEnabled() && !this.isOmnivisionActive(wizardRef);
            let depthCandidates = 0;
            let depthMissingMountedSection = 0;
            let depthHiddenByScript = 0;
            let depthDoorBottomOutlineOnly = 0;

            for (let i = 0; i < renderItems.length; i++) {
                const item = renderItems[i];
                if (!this.shouldUseDepthBillboard(item)) continue;
                depthCandidates += 1;
                if (this.isWallMountedSpatialItem(item)) {
                    const _mountedSection = this.resolveMountedWallSectionForItem(item);
                    // Section streaming can temporarily leave a mounted door/window alive
                    // while its backing wall section is unloaded. In that state, falling
                    // back to the single-plane depth billboard uses raw sprite pixel
                    // dimensions and renders at the wrong size, so keep it hidden until
                    // the mounted wall is present again.
                    if (!_mountedSection) {
                        if (item.pixiSprite) {
                            item.pixiSprite.visible = false;
                            if (Object.prototype.hasOwnProperty.call(item.pixiSprite, "renderable")) {
                                item.pixiSprite.renderable = false;
                            }
                        }
                        if (item.fireSprite) {
                            item.fireSprite.visible = false;
                            if (Object.prototype.hasOwnProperty.call(item.fireSprite, "renderable")) {
                                item.fireSprite.renderable = false;
                            }
                        }
                        if (item._renderingDepthMesh) {
                            item._renderingDepthMesh.visible = false;
                        }
                        if (item._compositeUnderlayMesh) {
                            item._compositeUnderlayMesh.visible = false;
                            if (Object.prototype.hasOwnProperty.call(item._compositeUnderlayMesh, "renderable")) {
                                item._compositeUnderlayMesh.renderable = false;
                            }
                        }
                        if (item._doorBottomFaceDebugGraphics) {
                            item._doorBottomFaceDebugGraphics.visible = false;
                            if (Object.prototype.hasOwnProperty.call(item._doorBottomFaceDebugGraphics, "renderable")) {
                                item._doorBottomFaceDebugGraphics.renderable = false;
                            }
                        }
                        depthMissingMountedSection += 1;
                        depthRenderedItems.add(item);
                        continue;
                    }
                }
                if (!this.isScriptVisible(item)) {
                    depthHiddenByScript += 1;
                    if (item.pixiSprite) {
                        item.pixiSprite.visible = false;
                        if (Object.prototype.hasOwnProperty.call(item.pixiSprite, "renderable")) {
                            item.pixiSprite.renderable = false;
                        }
                    }
                    if (item.fireSprite) {
                        item.fireSprite.visible = false;
                        if (Object.prototype.hasOwnProperty.call(item.fireSprite, "renderable")) {
                            item.fireSprite.renderable = false;
                        }
                    }
                    if (item._compositeUnderlayMesh) {
                        item._compositeUnderlayMesh.visible = false;
                    }
                    continue;
                }
                if (typeof item.updateSpriteAnimation === "function") {
                    item.updateSpriteAnimation();
                }
                const sprite = item.pixiSprite;
                const disableMazeDepthVariant = this.isWallMountedSpatialItem(item);
                const category = (typeof item.category === "string") ? item.category.trim().toLowerCase() : "";
                const isMountedDoor = !!(
                    disableMazeDepthVariant &&
                    (category === "doors" || item.type === "door")
                );
                const showDoorBottomDebugOutline = !!(
                    isMountedDoor &&
                    this.isWallBottomFaceOutlineDebugEnabled()
                );
                let forceMountedWallSide = null;
                if (isMountedDoor) {
                    const mountedSection = this.resolveMountedWallSectionForItem(item);
                    const isBottomFaceOnly = !!(
                        mazeModeForDepth &&
                        mountedSection &&
                        typeof mountedSection.isBottomOnlyVisibleInMazeMode === "function" &&
                        mountedSection.isBottomOnlyVisibleInMazeMode({ player: wizardRef, camera: this.camera })
                    );
                    if (isBottomFaceOnly) {
                        forceMountedWallSide = "center";
                    }
                }
                if (showDoorBottomDebugOutline) {
                    depthDoorBottomOutlineOnly += 1;
                    const itemContainer = this.isCharacterRenderItem(item) ? characterContainer : container;
                    const targetContainer = (item.rotationAxis === "ground" && groundContainer)
                        ? groundContainer
                        : itemContainer;
                    const outlineVisible = this.renderDoorBottomFaceDebugOutline(item, targetContainer);
                    if (item._renderingDepthMesh) {
                        if (item._renderingDepthMesh.parent) {
                            item._renderingDepthMesh.parent.removeChild(item._renderingDepthMesh);
                        }
                        item._renderingDepthMesh.visible = false;
                        item._renderingDepthMesh = null;
                    }
                    if (item._compositeUnderlayMesh) {
                        item._compositeUnderlayMesh.visible = false;
                        if (Object.prototype.hasOwnProperty.call(item._compositeUnderlayMesh, "renderable")) {
                            item._compositeUnderlayMesh.renderable = false;
                        }
                    }
                    if (sprite) {
                        sprite.visible = false;
                        if (Object.prototype.hasOwnProperty.call(sprite, "renderable")) {
                            sprite.renderable = false;
                        }
                    }
                    if (item.fireSprite) {
                        item.fireSprite.visible = false;
                        if (Object.prototype.hasOwnProperty.call(item.fireSprite, "renderable")) {
                            item.fireSprite.renderable = false;
                        }
                    }
                    currentItems.add(item);
                    depthRenderedItems.add(item);
                    if (outlineVisible && item._doorBottomFaceDebugGraphics) {
                        currentMeshes.add(item._doorBottomFaceDebugGraphics);
                        this.addPickRenderItem(item, item._doorBottomFaceDebugGraphics, { forceInclude: true });
                    }
                    continue;
                }
                const mesh = item.updateDepthBillboardMesh(ctx, this.camera, {
                    alphaCutoff: TREE_ALPHA_CUTOFF,
                    mazeMode: disableMazeDepthVariant ? false : mazeModeForDepth,
                    player: wizardRef,
                    forceMountedWallSide
                });
                if (!mesh) continue;
                item._renderingDepthMesh = mesh;

                const itemContainer = this.isCharacterRenderItem(item) ? characterContainer : container;

                const targetContainer = (item.rotationAxis === "ground" && groundContainer)
                    ? groundContainer
                    : itemContainer;

                // Add composite underlay mesh BEFORE the main mesh so it renders behind
                const underlayMesh = item._compositeUnderlayMesh;
                if (underlayMesh && !underlayMesh.destroyed && item._compositeUnderlayShouldRender) {
                    if (underlayMesh.parent !== targetContainer) {
                        targetContainer.addChild(underlayMesh);
                    }
                    const layerAlpha = Number.isFinite(item._renderLayerAlpha)
                        ? Math.max(0, Math.min(1, Number(item._renderLayerAlpha)))
                        : 1;
                    underlayMesh.visible = true;
                    underlayMesh.alpha = this.getScriptDisplayAlpha(item) * layerAlpha;
                    if (Object.prototype.hasOwnProperty.call(underlayMesh, "renderable")) {
                        underlayMesh.renderable = true;
                    }
                    this.applyLayerDarknessForItem(item, item._renderLayerIndex, underlayMesh);
                    if (this.applySinkClip(item, underlayMesh)) {
                        currentMeshes.add(underlayMesh);
                    }
                } else if (underlayMesh && !underlayMesh.destroyed) {
                    underlayMesh.visible = false;
                    if (Object.prototype.hasOwnProperty.call(underlayMesh, "renderable")) {
                        underlayMesh.renderable = false;
                    }
                }

                if (mesh.parent !== targetContainer) {
                    targetContainer.addChild(mesh);
                }
                const layerAlpha = Number.isFinite(item._renderLayerAlpha)
                    ? Math.max(0, Math.min(1, Number(item._renderLayerAlpha)))
                    : 1;
                mesh.visible = true;
                mesh.alpha = this.getScriptDisplayAlpha(item) * layerAlpha;
                if (Object.prototype.hasOwnProperty.call(mesh, "renderable")) {
                    mesh.renderable = true;
                }
                this.applyScriptBrightness(item, mesh);
                this.applyFrozenTint(item, mesh);
                this.applyLayerDarknessForItem(item, item._renderLayerIndex, mesh);
                currentItems.add(item);
                depthRenderedItems.add(item);
                const meshVisibleAfterSinkClip = this.applySinkClip(item, mesh);
                if (meshVisibleAfterSinkClip) {
                    currentMeshes.add(mesh);
                }
                // Use the same depth billboard mesh for picker hits so picker-screen
                // occlusion matches the regular depth-rendered scene (trees included).
                if (meshVisibleAfterSinkClip) {
                    this.addPickRenderItem(item, mesh, { forceInclude: true });
                }
                if (item._doorBottomFaceDebugGraphics) {
                    item._doorBottomFaceDebugGraphics.visible = false;
                    if (Object.prototype.hasOwnProperty.call(item._doorBottomFaceDebugGraphics, "renderable")) {
                        item._doorBottomFaceDebugGraphics.renderable = false;
                    }
                }

                // Hide legacy sprite when depth mesh is active.
                sprite.visible = false;
                if (Object.prototype.hasOwnProperty.call(sprite, "renderable")) {
                    sprite.renderable = false;
                }

                // Position fire sprite overlay if present
                if (item.fireSprite) {
                    const fireSprite = item.fireSprite;
                    const fireContainer = targetContainer || itemContainer;
                    if (fireSprite.parent !== fireContainer) {
                        fireContainer.addChild(fireSprite);
                    }
                    if (fireContainer && mesh && typeof fireContainer.getChildIndex === "function" && typeof fireContainer.setChildIndex === "function") {
                        const meshIndex = fireContainer.getChildIndex(mesh);
                        const maxIndex = Math.max(0, fireContainer.children.length - 1);
                        const desiredIndex = Math.min(meshIndex + 1, maxIndex);
                        if (fireContainer.getChildIndex(fireSprite) !== desiredIndex) {
                            fireContainer.setChildIndex(fireSprite, desiredIndex);
                        }
                    }

                    let fp = null;
                    if (item.type === "tree") {
                        fireSprite.anchor.set(0.5, 1);
                        const worldPositions = item._depthBillboardWorldPositions;
                        if (worldPositions && worldPositions.length >= 12) {
                            // Use a point 1/3 down from the crown (TR/TL midpoint toward BL/BR midpoint).
                            // worldPositions layout: BL[0-2], BR[3-5], TR[6-8], TL[9-11]
                            const crownX = (worldPositions[6] + worldPositions[9]) / 2;
                            const crownY = (worldPositions[7] + worldPositions[10]) / 2;
                            const crownZ = (worldPositions[8] + worldPositions[11]) / 2;
                            const baseX = (worldPositions[0] + worldPositions[3]) / 2;
                            const baseY = (worldPositions[1] + worldPositions[4]) / 2;
                            const baseZ = (worldPositions[2] + worldPositions[5]) / 2;
                            const t = 1 / 3; // fraction down from crown
                            const tx = crownX + (baseX - crownX) * t;
                            const ty = crownY + (baseY - crownY) * t;
                            const tz = crownZ + (baseZ - crownZ) * t;
                            fp = this.camera.worldToScreen(tx, ty, tz);
                        } else {
                            const treeWidth = Number.isFinite(item.width) ? item.width : 4;
                            const treeHeight = Number.isFinite(item.height) ? item.height : 4;
                            const anchorX = (item.pixiSprite && item.pixiSprite.anchor && Number.isFinite(item.pixiSprite.anchor.x))
                                ? Number(item.pixiSprite.anchor.x)
                                : 0.5;
                            const anchorY = (item.pixiSprite && item.pixiSprite.anchor && Number.isFinite(item.pixiSprite.anchor.y))
                                ? Number(item.pixiSprite.anchor.y)
                                : 1;
                            const topWorldX = item.x + (0.5 - anchorX) * treeWidth;
                            const topWorldZ = anchorY * treeHeight * 0.75; // 25% down from top
                            fp = this.camera.worldToScreen(topWorldX, item.y, topWorldZ);
                        }
                    } else {
                        const itemHeight = Number.isFinite(item.height) ? item.height : 0;
                        const isDeadAnimal = !!(
                            item &&
                            item.dead &&
                            typeof Animal !== "undefined" &&
                            item instanceof Animal
                        );
                        if (fireSprite.anchor) {
                            fireSprite.anchor.set(0.5, isDeadAnimal ? 0.5 : 1);
                        }
                        if (item.isFallenDoorEffect && typeof item.getFallenDoorWorldPointFromLocalAnchor === "function") {
                            const anchorWorld = item.getFallenDoorWorldPointFromLocalAnchor();
                            if (anchorWorld) {
                                fp = this.camera.worldToScreen(anchorWorld.x, anchorWorld.y, anchorWorld.z);
                            }
                        }
                        if (!fp && isDeadAnimal && item._useGradualDeathFall) {
                            // Keep corpse fire centered on the billboard while it falls by
                            // rotating the upright midpoint around the corpse foot pivot.
                            const centerScreen = this.camera.worldToScreen(item.x, item.y, itemHeight * 0.5);
                            const pivotScreen = this.camera.worldToScreen(item.x, item.y, 0);
                            const rotRad = (Number.isFinite(item.rotation) ? item.rotation : 0) * (Math.PI / 180);
                            const cosR = Math.cos(rotRad);
                            const sinR = Math.sin(rotRad);
                            const dx = centerScreen.x - pivotScreen.x;
                            const dy = centerScreen.y - pivotScreen.y;
                            fp = {
                                x: pivotScreen.x + dx * cosR - dy * sinR,
                                y: pivotScreen.y + dx * sinR + dy * cosR
                            };
                        } else if (!fp && isDeadAnimal) {
                            fp = this.camera.worldToScreen(item.x, item.y, itemHeight * 0.5);
                        } else if (!fp) {
                            // Keep flower flames in the bloom canopy, not at stem/base level.
                            const fireBaseHeightRatio = (item.type === "flower") ? 0.68 : 0.75;
                            fp = this.camera.worldToScreen(item.x, item.y, itemHeight * fireBaseHeightRatio);
                        }
                    }
                    fireSprite.x = fp.x;
                    fireSprite.y = fp.y;

                    // Size the fire. For trees: use _frozenFireScale (locked at death)
                    // while falling/fading so there's no sudden size jump when hp hits 0.
                    const _fireScale = (item.type === 'tree')
                        ? (Number.isFinite(item._frozenFireScale)
                            ? item._frozenFireScale
                            : (item.maxHP > 0 && item.hp > 0 ? Math.min(item.maxHP / item.hp, 4) : 1))
                        : 1;
                    const fireScale = Number.isFinite(item.fireScale) ? item.fireScale : 1;
                    const treeWidth = Number.isFinite(item.width) ? item.width : 4;
                    const treeHeight = Number.isFinite(item.height) ? item.height : 4;
                    const vs = this.camera.viewscale;
                    // Gradual death-fall fire: apply animated scale and alpha.
                    const deathFireMul = (item._useGradualDeathFall && Number.isFinite(item._deathFireScale))
                        ? Math.max(0, item._deathFireScale) : 1;
                    const deathFireAlpha = (item._useGradualDeathFall && Number.isFinite(item._deathFireAlpha))
                        ? Math.max(0, Math.min(1, item._deathFireAlpha)) : 1;
                    fireSprite.width = treeWidth * vs * fireScale * _fireScale * 0.8 * deathFireMul;
                    fireSprite.height = treeHeight * vs * fireScale * _fireScale * 0.6 * deathFireMul;
                    fireSprite.alpha = deathFireAlpha;
                    fireSprite.visible = true;
                    fireSprite.renderable = true;
                    this.applyLayerDarknessForItem(item, item._renderLayerIndex, fireSprite);
                }
            }

            for (const mesh of this.activeDepthBillboardMeshes) {
                if (!currentMeshes.has(mesh) && mesh) {
                    mesh.visible = false;
                }
            }
            for (const item of this.activeDepthBillboardItems) {
                if (currentItems.has(item)) continue;
                if (item && item.pixiSprite) {
                    // When a flower transitions to fragment-crumble mode, its fragment
                    // container takes over rendering. Keep the underlying pixiSprite
                    // hidden so it does not ghost on top of the fragments.
                    const hasActiveFragments = !!(item._flowerBurnFragmentContainer &&
                        Array.isArray(item._flowerBurnFragments) &&
                        item._flowerBurnFragments.length > 0);
                    if (hasActiveFragments) {
                        item.pixiSprite.visible = false;
                        if (Object.prototype.hasOwnProperty.call(item.pixiSprite, "renderable")) {
                            item.pixiSprite.renderable = false;
                        }
                    } else {
                        const category = (typeof item.category === "string") ? item.category.trim().toLowerCase() : "";
                        const isSpatialDoorOrWindow = !!(
                            item.rotationAxis === "spatial" &&
                            (category === "doors" || category === "windows" || item.type === "door" || item.type === "window")
                        );
                        const shouldShowSprite = isSpatialDoorOrWindow ? false : this.isScriptVisible(item);
                        item.pixiSprite.visible = shouldShowSprite;
                        item.pixiSprite.alpha = shouldShowSprite ? this.getScriptDisplayAlpha(item) : 1;
                        if (shouldShowSprite) {
                            this.applyLayerDarknessForItem(item, item._renderLayerIndex, item.pixiSprite);
                        }
                        if (Object.prototype.hasOwnProperty.call(item.pixiSprite, "renderable")) {
                            item.pixiSprite.renderable = shouldShowSprite;
                        }
                    }
                }
                if (item && item._renderingDepthMesh) {
                    item._renderingDepthMesh = null;
                }
                if (item && item._compositeUnderlayMesh) {
                    item._compositeUnderlayMesh.visible = false;
                    if (Object.prototype.hasOwnProperty.call(item._compositeUnderlayMesh, "renderable")) {
                        item._compositeUnderlayMesh.renderable = false;
                    }
                }
                if (item && item._doorBottomFaceDebugGraphics) {
                    item._doorBottomFaceDebugGraphics.visible = false;
                    if (Object.prototype.hasOwnProperty.call(item._doorBottomFaceDebugGraphics, "renderable")) {
                        item._doorBottomFaceDebugGraphics.renderable = false;
                    }
                }
                // Hide fire sprite when item leaves depth billboard rendering
                if (item && item.fireSprite) {
                    item.fireSprite.visible = false;
                }
            }
            this.activeDepthBillboardMeshes = currentMeshes;
            this.activeDepthBillboardItems = currentItems;

            this.setFrameMetric("depthCandidates", depthCandidates);
            this.setFrameMetric("depthMissingMountedSection", depthMissingMountedSection);
            this.setFrameMetric("depthHiddenByScript", depthHiddenByScript);
            this.setFrameMetric("depthDoorBottomOutlineOnly", depthDoorBottomOutlineOnly);

            return depthRenderedItems;
        }

        renderGroundObjects(ctx, renderItems, alreadyRenderedItems) {
            const container = this.layers.groundObjects;
            if (!container) return new Set();
            if (!container.sortableChildren) container.sortableChildren = true;
            const groundRenderedItems = new Set();
            const currentSprites = new Set();

            for (let i = 0; i < renderItems.length; i++) {
                const item = renderItems[i];
                if (!item || item.gone || item.vanishing) continue;
                if (item.rotationAxis !== "ground") continue;
                if (item.type === "triggerArea" || item.isTriggerArea === true) continue;
                if (alreadyRenderedItems && alreadyRenderedItems.has(item)) continue;
                if (!this.isScriptVisible(item)) continue;
                const sprite = item.pixiSprite;
                if (!sprite) continue;

                // Fallback sprite path for ground items not handled by depth billboard
                if (sprite.parent !== container) {
                    container.addChild(sprite);
                }
                // Ensure last-placed rug always renders on top
                sprite.zIndex = Number.isFinite(item._groundLayerOrder) ? item._groundLayerOrder : 0;
                sprite.visible = true;
                const layerAlpha = Number.isFinite(item._renderLayerAlpha)
                    ? Math.max(0, Math.min(1, Number(item._renderLayerAlpha)))
                    : 1;
                sprite.alpha = this.getScriptDisplayAlpha(item) * layerAlpha;
                if (Object.prototype.hasOwnProperty.call(sprite, "renderable")) {
                    sprite.renderable = true;
                }
                this.applyScriptBrightness(item, sprite);
                this.applyFrozenTint(item, sprite);
                this.applyLayerDarknessForItem(item, item._renderLayerIndex, sprite);
                groundRenderedItems.add(item);
                if (this.applySinkClip(item, sprite)) {
                    currentSprites.add(sprite);
                    this.addPickRenderItem(item, sprite);
                }
            }

            if (!this._activeGroundObjectSprites) this._activeGroundObjectSprites = new Set();
            for (const sprite of this._activeGroundObjectSprites) {
                if (!currentSprites.has(sprite) && sprite) {
                    sprite.visible = false;
                }
            }
            this._activeGroundObjectSprites = currentSprites;

            this.setFrameMetric("groundObjectSpritesRendered", currentSprites.size);

            return groundRenderedItems;
        }

        getGroundTileZIndex(node, mapRef) {
            const mapWidth = Number.isFinite(mapRef && mapRef.width) ? Math.max(1, Math.floor(mapRef.width)) : 1;
            const y = Number.isFinite(node && node.yindex) ? Math.floor(node.yindex) : 0;
            const x = Number.isFinite(node && node.xindex) ? Math.floor(node.xindex) : 0;
            return y * mapWidth + x;
        }

        ensureGroundTileContainer() {
            const layer = this.layers && this.layers.ground;
            if (!layer) return null;
            if (!this.groundTileContainer) {
                this.groundTileContainer = new PIXI.Container();
                this.groundTileContainer.name = "renderingGroundTiles";
                layer.addChild(this.groundTileContainer);
            } else if (this.groundTileContainer.parent !== layer) {
                layer.addChild(this.groundTileContainer);
            }
            return this.groundTileContainer;
        }

        beginGroundTileProfiling(nowMs) {
            const profiler = this.groundTileProfiler;
            if (!profiler || profiler.printed || !isGroundTileProfilingEnabled()) return null;
            const currentNow = Number.isFinite(nowMs) ? Number(nowMs) : performance.now();
            if (!Number.isFinite(profiler.startMs)) {
                profiler.startMs = currentNow;
                profiler.deadlineMs = currentNow + 10000;
            }
            return profiler;
        }

        maybePrintGroundTileProfile(nowMs) {
            const profiler = this.groundTileProfiler;
            if (!profiler || profiler.printed || !Number.isFinite(profiler.deadlineMs)) return;
            const currentNow = Number.isFinite(nowMs) ? Number(nowMs) : performance.now();
            if (currentNow < profiler.deadlineMs) return;
            const frameCount = Math.max(1, Number(profiler.frameCount) || 1);
            const totals = profiler.totals || {};
            const counts = profiler.counts || {};
            console.log("[ground tile profile 10s]", {
                durationMs: Number((currentNow - profiler.startMs).toFixed(2)),
                frameCount,
                avg: {
                    totalMs: Number((Number(totals.totalMs || 0) / frameCount).toFixed(3)),
                    activeKeyBuildMs: Number((Number(totals.activeKeyBuildMs || 0) / frameCount).toFixed(3)),
                    visibleSetMs: Number((Number(totals.visibleSetMs || 0) / frameCount).toFixed(3)),
                    createSpriteMs: Number((Number(totals.createSpriteMs || 0) / frameCount).toFixed(3)),
                    parentAttachMs: Number((Number(totals.parentAttachMs || 0) / frameCount).toFixed(3)),
                    textureResolveMs: Number((Number(totals.textureResolveMs || 0) / frameCount).toFixed(3)),
                    positionSizeMs: Number((Number(totals.positionSizeMs || 0) / frameCount).toFixed(3)),
                    cleanupMs: Number((Number(totals.cleanupMs || 0) / frameCount).toFixed(3))
                },
                counts: {
                    visibleNodesPerFrame: Number((Number(counts.visibleNodes || 0) / frameCount).toFixed(2)),
                    createdSpritesPerFrame: Number((Number(counts.createdSprites || 0) / frameCount).toFixed(2)),
                    attachedSpritesPerFrame: Number((Number(counts.attachedSprites || 0) / frameCount).toFixed(2)),
                    cleanedSpritesPerFrame: Number((Number(counts.cleanedSprites || 0) / frameCount).toFixed(2)),
                    evictedSpritesPerFrame: Number((Number(counts.evictedSprites || 0) / frameCount).toFixed(2)),
                    reusedSpritesPerFrame: Number((Number(counts.reusedSprites || 0) / frameCount).toFixed(2)),
                    skippedForLevel0ChunksPerFrame: Number((Number(counts.skippedForLevel0Chunks || 0) / frameCount).toFixed(2))
                }
            });
            profiler.printed = true;
        }

        acquireGroundTileSprite() {
            let sprite = Array.isArray(this.groundSpritePool) && this.groundSpritePool.length > 0
                ? this.groundSpritePool.pop()
                : null;
            if (!sprite) {
                sprite = new PIXI.Sprite(PIXI.Texture.WHITE);
                sprite.name = "renderingGroundTile";
                sprite.anchor.set(0.5, 0.5);
            }
            sprite.visible = true;
            if (Object.prototype.hasOwnProperty.call(sprite, "renderable")) {
                sprite.renderable = true;
            }
            sprite.alpha = 1;
            return sprite;
        }

        releaseGroundTileSprite(sprite) {
            if (!sprite) return false;
            if (sprite.parent) {
                sprite.parent.removeChild(sprite);
            }
            sprite.visible = false;
            if (Object.prototype.hasOwnProperty.call(sprite, "renderable")) {
                sprite.renderable = false;
            }
            sprite.alpha = 1;
            sprite.texture = PIXI.Texture.WHITE;
            if (Array.isArray(this.groundSpritePool) && this.groundSpritePool.length < GROUND_TILE_POOL_LIMIT) {
                this.groundSpritePool.push(sprite);
                return false;
            }
            if (typeof sprite.destroy === "function") {
                sprite.destroy({ children: false, texture: false, baseTexture: false });
            }
            return true;
        }

        trimGroundTileSpriteCache(maxEvictions = GROUND_TILE_TRIM_CHUNK_SIZE) {
            if (!(this.groundSpriteByNodeKey instanceof Map) || this.groundSpriteByNodeKey.size <= GROUND_TILE_CACHE_LIMIT) {
                return 0;
            }
            const visibleKeys = this.groundVisibleNodeKeys instanceof Set
                ? this.groundVisibleNodeKeys
                : new Set();
            const evictTarget = Math.max(
                0,
                Math.min(
                    Math.floor(Number(maxEvictions) || 0),
                    this.groundSpriteByNodeKey.size - GROUND_TILE_CACHE_LIMIT
                )
            );
            if (evictTarget <= 0) return 0;

            let evictedSprites = 0;
            for (const [key, sprite] of this.groundSpriteByNodeKey.entries()) {
                if (visibleKeys.has(key)) continue;
                this.groundSpriteByNodeKey.delete(key);
                this.groundVisibleNodeKeys.delete(key);
                this.releaseGroundTileSprite(sprite);
                evictedSprites += 1;
                if (evictedSprites >= evictTarget || this.groundSpriteByNodeKey.size <= GROUND_TILE_CACHE_LIMIT) {
                    break;
                }
            }
            return evictedSprites;
        }

        renderGroundTiles(ctx, visibleNodes) {
            const map = ctx.map;
            const layer = this.layers.ground;
            if (!map || !Array.isArray(map.nodes) || !layer) return;
            const frameStartMs = performance.now();
            const profiler = this.beginGroundTileProfiling(
                ctx && Number.isFinite(ctx.renderNowMs) ? Number(ctx.renderNowMs) : frameStartMs
            );

            const cam = this.camera;
            const tileWorldW = (Number.isFinite(map.hexWidth) ? map.hexWidth : (1 / 0.866))
                * GROUND_TILE_OVERLAP_SCALE;
            const tileWorldH = (Number.isFinite(map.hexHeight) ? map.hexHeight : 1)
                * GROUND_TILE_OVERLAP_SCALE;
            const nodes = Array.isArray(visibleNodes) ? visibleNodes : [];
            const nowMs = (ctx && Number.isFinite(ctx.renderNowMs))
                ? Number(ctx.renderNowMs)
                : ((typeof performance !== "undefined" && performance && typeof performance.now === "function")
                    ? performance.now()
                    : Date.now());
            const visibleNodeKeys = new Set();
            const wizard = (ctx && ctx.wizard) || global.wizard || null;
            const mazeLayerOnly = !!(
                this.isLosMazeModeEnabled() &&
                !this.isOmnivisionActive(wizard) &&
                wizard
            );
            const wizardLayer = this.getLayerIndexFromValue(
                wizard && Number.isFinite(wizard.currentLayer) ? wizard.currentLayer : 0,
                0
            );
            const cutawayState = this.getLayerCutawayState(ctx);
            const bakedLevel0SectionKeys = this.getBakedLevel0SectionKeys(ctx);
            const activeKeyBuildStartMs = profiler ? performance.now() : 0;
            const activePrototypeNodeKeys = (typeof map.getLoadedPrototypeNodeKeySet === "function")
                ? map.getLoadedPrototypeNodeKeySet()
                : null;
            const activeKeyBuildMs = profiler ? (performance.now() - activeKeyBuildStartMs) : 0;
            const usePrototypeContainerTransform = !!activePrototypeNodeKeys;
            const container = usePrototypeContainerTransform
                ? this.ensureGroundTileContainer()
                : layer;
            if (!container) return;

            if (usePrototypeContainerTransform) {
                container.position.set(
                    -(Number(cam.x) || 0) * (Number(cam.viewscale) || 1),
                    (-(Number(cam.y) || 0) + (Number(cam.z) || 0)) * (Number(cam.viewscale) || 1) * (Number(cam.xyratio) || 1)
                );
                container.scale.set(
                    Number(cam.viewscale) || 1,
                    (Number(cam.viewscale) || 1) * (Number(cam.xyratio) || 1)
                );
            } else if (this.groundTileContainer) {
                this.groundTileContainer.position.set(0, 0);
                this.groundTileContainer.scale.set(1, 1);
            }

            let createSpriteMs = 0;
            let parentAttachMs = 0;
            let textureResolveMs = 0;
            let positionSizeMs = 0;
            let createdSprites = 0;
            let attachedSprites = 0;
            let reusedSprites = 0;
            let skippedForLevel0Chunks = 0;
            const level0ChunkReadyCache = FLOOR_LEVEL0_CHUNKED_SURFACE_ENABLED ? new Map() : null;
            const level0SectionAssetCache = FLOOR_LEVEL0_CHUNKED_SURFACE_ENABLED ? new Map() : null;
            const nonzeroFloorFragmentsByLevel = new Map();
            if (map.floorsById instanceof Map) {
                for (const fragment of map.floorsById.values()) {
                    if (!fragment || fragment._floorEditEmpty === true) continue;
                    const fragmentLevel = Number.isFinite(fragment.level)
                        ? this.getLayerIndexFromValue(fragment.level, 0)
                        : 0;
                    if (fragmentLevel === 0) continue;
                    if (!Array.isArray(fragment.outerPolygon) || fragment.outerPolygon.length < 3) continue;
                    if (!nonzeroFloorFragmentsByLevel.has(fragmentLevel)) {
                        nonzeroFloorFragmentsByLevel.set(fragmentLevel, []);
                    }
                    nonzeroFloorFragmentsByLevel.get(fragmentLevel).push(fragment);
                }
            }
            const nonzeroFloorCoverageByNodeKey = new Map();
            const visibleSetStartMs = profiler ? performance.now() : 0;
            for (let i = 0; i < nodes.length; i++) {
                const node = nodes[i];
                if (!node) continue;
                const nodeLayer = this.getLayerIndexForNode(node);
                if (nodeLayer !== 0) {
                    const nodeKey = `${node.xindex},${node.yindex},${nodeLayer}`;
                    let coveredByFloorFragment = nonzeroFloorCoverageByNodeKey.get(nodeKey);
                    if (coveredByFloorFragment === undefined) {
                        coveredByFloorFragment = false;
                        const levelFragments = nonzeroFloorFragmentsByLevel.get(nodeLayer) || [];
                        const nodeX = Number(node.x);
                        const nodeY = Number(node.y);
                        if (Number.isFinite(nodeX) && Number.isFinite(nodeY)) {
                            for (let f = 0; f < levelFragments.length; f++) {
                                if (isPointSupportedByFloorFragment(levelFragments[f], nodeX, nodeY)) {
                                    coveredByFloorFragment = true;
                                    break;
                                }
                            }
                        }
                        nonzeroFloorCoverageByNodeKey.set(nodeKey, coveredByFloorFragment);
                    }
                    if (coveredByFloorFragment) continue;
                }
                if (mazeLayerOnly && nodeLayer !== wizardLayer) continue;
                if (this.isWorldPointHiddenByLayerCutaway(Number(node.x), Number(node.y), nodeLayer, cutawayState)) continue;
                const sectionKey = typeof node._prototypeSectionKey === "string" ? node._prototypeSectionKey : "";
                if (sectionKey && bakedLevel0SectionKeys.has(sectionKey)) continue;
                if (
                    this.isGroundNodeCoveredByReadyLevel0Chunk(
                        ctx,
                        node,
                        tileWorldW,
                        tileWorldH,
                        level0ChunkReadyCache,
                        level0SectionAssetCache
                    )
                ) {
                    skippedForLevel0Chunks += 1;
                    continue;
                }
                const key = `${node.xindex},${node.yindex}`;
                visibleNodeKeys.add(key);
                let sprite = this.groundSpriteByNodeKey.get(key);
                if (!sprite) {
                    const createStartMs = profiler ? performance.now() : 0;
                    sprite = this.acquireGroundTileSprite();
                    this.groundSpriteByNodeKey.set(key, sprite);
                    if (profiler) createSpriteMs += (performance.now() - createStartMs);
                    createdSprites += 1;
                } else {
                    this.groundSpriteByNodeKey.delete(key);
                    this.groundSpriteByNodeKey.set(key, sprite);
                    reusedSprites += 1;
                }
                if (sprite.parent !== container) {
                    const attachStartMs = profiler ? performance.now() : 0;
                    container.addChild(sprite);
                    if (profiler) parentAttachMs += (performance.now() - attachStartMs);
                    attachedSprites += 1;
                }

                const textureStartMs = profiler ? performance.now() : 0;
                const maxTextureIndex = Array.isArray(map.groundTextures) ? (map.groundTextures.length - 1) : 0;
                const _baseId = Math.max(0, Math.min(12, Number.isFinite(node.groundTextureId) ? Math.floor(node.groundTextureId) : 0));
                const _x = Number.isFinite(node.xindex) ? Math.floor(node.xindex) : 0;
                const _y = Number.isFinite(node.yindex) ? Math.floor(node.yindex) : 0;
                const _seed = ((_x * 73856093) ^ (_y * 19349663) ^ (_baseId * 83492791)) >>> 0;
                const _variant = _seed % 4;
                const _variantTextureIndex = _baseId + (_variant * 13);
                const _tileCount = 52;
                const _scrambledIndex = (_variantTextureIndex * 17) % _tileCount;
                const textureIndex = Math.min(maxTextureIndex, (_tileCount <= (maxTextureIndex + 1)) ? _scrambledIndex : _variantTextureIndex);
                const texture = (Array.isArray(map.groundTextures) && map.groundTextures[textureIndex])
                    ? map.groundTextures[textureIndex]
                    : PIXI.Texture.WHITE;
                if (sprite.texture !== texture) {
                    sprite.texture = texture;
                }
                if (profiler) textureResolveMs += (performance.now() - textureStartMs);

                const positionStartMs = profiler ? performance.now() : 0;
                const nodeBaseZ = this.getLayerBaseZForNode(node);
                if (usePrototypeContainerTransform) {
                    sprite.x = Number(node.x) || 0;
                    sprite.y = (Number(node.y) || 0) - nodeBaseZ;
                    sprite.width = tileWorldW;
                    sprite.height = tileWorldH;
                } else {
                    const center = cam.worldToScreen(node.x, node.y, nodeBaseZ);
                    sprite.x = center.x;
                    sprite.y = center.y;
                    sprite.width = tileWorldW * cam.viewscale;
                    sprite.height = tileWorldH * cam.viewscale * cam.xyratio;
                }
                sprite.alpha = this.getLayerFadeMultiplier(nodeLayer, nowMs);
                this.applyLayerDarknessToDisplayObject(sprite, this.getLayerDarknessMultiplier(nodeLayer));
                sprite.visible = true;
                if (profiler) positionSizeMs += (performance.now() - positionStartMs);
            }
            const visibleSetMs = profiler ? (performance.now() - visibleSetStartMs) : 0;

            const cleanupStartMs = profiler ? performance.now() : 0;
            let cleanedSprites = 0;
            let evictedSprites = 0;
            const previouslyVisibleNodeKeys = this.groundVisibleNodeKeys instanceof Set
                ? this.groundVisibleNodeKeys
                : new Set();
            for (const key of previouslyVisibleNodeKeys) {
                if (visibleNodeKeys.has(key)) continue;
                const sprite = this.groundSpriteByNodeKey.get(key);
                if (sprite) {
                    sprite.visible = false;
                    cleanedSprites += 1;
                }
            }
            this.groundVisibleNodeKeys = visibleNodeKeys;
            evictedSprites = this.trimGroundTileSpriteCache(GROUND_TILE_TRIM_CHUNK_SIZE);
            cleanedSprites += evictedSprites;
            const cleanupMs = profiler ? (performance.now() - cleanupStartMs) : 0;

            if (profiler) {
                profiler.frameCount += 1;
                profiler.totals.totalMs += (performance.now() - frameStartMs);
                profiler.totals.activeKeyBuildMs += activeKeyBuildMs;
                profiler.totals.visibleSetMs += visibleSetMs;
                profiler.totals.createSpriteMs += createSpriteMs;
                profiler.totals.parentAttachMs += parentAttachMs;
                profiler.totals.textureResolveMs += textureResolveMs;
                profiler.totals.positionSizeMs += positionSizeMs;
                profiler.totals.cleanupMs += cleanupMs;
                profiler.counts.visibleNodes += nodes.length;
                profiler.counts.createdSprites += createdSprites;
                profiler.counts.attachedSprites += attachedSprites;
                profiler.counts.cleanedSprites += cleanedSprites;
                profiler.counts.evictedSprites += evictedSprites;
                profiler.counts.reusedSprites += reusedSprites;
                profiler.counts.skippedForLevel0Chunks = (Number(profiler.counts.skippedForLevel0Chunks) || 0) + skippedForLevel0Chunks;
                this.maybePrintGroundTileProfile(
                    ctx && Number.isFinite(ctx.renderNowMs) ? Number(ctx.renderNowMs) : performance.now()
                );
            }
            if (this.currentFrameMetrics) {
                this.currentFrameMetrics.groundTilesSkippedForLevel0Chunks = skippedForLevel0Chunks;
                this.currentFrameMetrics.groundTileSpritesVisible = visibleNodeKeys.size;
            }
        }

        ensureFloorVisualContainer() {
            const parent = this.layers && this.layers.depthObjects;
            if (!parent || typeof PIXI === "undefined") return null;
            if (!this.floorVisualContainer) {
                this.floorVisualContainer = new PIXI.Container();
                this.floorVisualContainer.name = "renderingFloorVisualPolygons";
                this.floorVisualContainer.interactiveChildren = false;
                this.floorVisualContainer.sortableChildren = true;
            }
            if (this.floorVisualContainer.parent !== parent) {
                if (typeof parent.addChildAt === "function") {
                    parent.addChildAt(this.floorVisualContainer, 0);
                } else {
                    parent.addChild(this.floorVisualContainer);
                }
            }
            return this.floorVisualContainer;
        }

        updateFloorVisualContainerTransform(container) {
            if (!container) return;
            container.position.set(0, 0);
            container.scale.set(1, 1);
        }

        getSelectedFloorVisualLevel() {
            return Number.isFinite(global.selectedFloorEditLevel)
                ? Math.round(Number(global.selectedFloorEditLevel))
                : 0;
        }

        hasEditedLevel0FloorAsset(asset) {
            if (FLOOR_LEVEL0_FORCE_BAKED_SURFACE && asset && Array.isArray(asset.tileCoordKeys) && asset.tileCoordKeys.length > 0) {
                return true;
            }
            if (!asset || !Array.isArray(asset.floors)) return false;
            for (let i = 0; i < asset.floors.length; i++) {
                const floor = asset.floors[i];
                if (!floor || Math.round(Number(floor.level) || 0) !== 0) continue;
                if (floor._prototypeSynthesizedGround === true) continue;
                if (floor._floorEditEmpty === true) return true;
                if (Array.isArray(floor.outerPolygon) && floor.outerPolygon.length >= 3) return true;
            }
            return false;
        }

        getLevel0GroundSurfaceChunkWorldSize() {
            const pxPerWorld = Math.max(1, Number(FLOOR_LEVEL0_CHUNK_TEXTURE_PX_PER_WORLD) || 32);
            return Math.max(0.001, FLOOR_LEVEL0_CHUNK_TEXTURE_SIZE / pxPerWorld);
        }

        getLevel0GroundSurfaceChunkCoord(value) {
            const chunkWorldSize = this.getLevel0GroundSurfaceChunkWorldSize();
            return Math.floor((Number(value) || 0) / chunkWorldSize);
        }

        getLevel0GroundSurfaceChunkKey(sectionKey, chunkX, chunkY) {
            return `${sectionKey || ""}:${Math.floor(Number(chunkX) || 0)},${Math.floor(Number(chunkY) || 0)}`;
        }

        getLevel0GroundSurfaceChunkBounds(chunkX, chunkY, map) {
            const chunkWorldSize = this.getLevel0GroundSurfaceChunkWorldSize();
            const minX = Math.floor(Number(chunkX) || 0) * chunkWorldSize;
            const minY = Math.floor(Number(chunkY) || 0) * chunkWorldSize;
            return {
                minX,
                minY,
                maxX: minX + chunkWorldSize,
                maxY: minY + chunkWorldSize,
                width: chunkWorldSize,
                height: chunkWorldSize,
                tileWorldW: ((Number.isFinite(map && map.hexWidth) ? map.hexWidth : (1 / 0.866)) * GROUND_TILE_OVERLAP_SCALE),
                tileWorldH: ((Number.isFinite(map && map.hexHeight) ? map.hexHeight : 1) * GROUND_TILE_OVERLAP_SCALE),
                chunkX: Math.floor(Number(chunkX) || 0),
                chunkY: Math.floor(Number(chunkY) || 0)
            };
        }

        getLevel0GroundSurfaceChunkCoordsForBounds(bounds) {
            if (!bounds) return [];
            const minX = Number(bounds.minX);
            const minY = Number(bounds.minY);
            const maxX = Number(bounds.maxX);
            const maxY = Number(bounds.maxY);
            if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) return [];
            const startX = this.getLevel0GroundSurfaceChunkCoord(Math.min(minX, maxX));
            const endX = this.getLevel0GroundSurfaceChunkCoord(Math.max(minX, maxX) - 1e-7);
            const startY = this.getLevel0GroundSurfaceChunkCoord(Math.min(minY, maxY));
            const endY = this.getLevel0GroundSurfaceChunkCoord(Math.max(minY, maxY) - 1e-7);
            const out = [];
            for (let chunkX = startX; chunkX <= endX; chunkX++) {
                for (let chunkY = startY; chunkY <= endY; chunkY++) {
                    out.push({ chunkX, chunkY });
                }
            }
            return out;
        }

        getLevel0GroundSurfaceChunkSignature(asset, chunkX, chunkY) {
            const tileCoordKeys = Array.isArray(asset && asset.tileCoordKeys) ? asset.tileCoordKeys : [];
            return [
                Math.floor(Number(chunkX) || 0),
                Math.floor(Number(chunkY) || 0),
                Number(asset && asset._level0SurfaceVersion) || 0,
                Number(asset && asset._level0RoadSurfaceModelVersion) || 0,
                Number(asset && asset._level0RoadSurfaceVersion) || 0,
                Number(asset && asset._level0GroundSurfaceVersion) || 0,
                Number(asset && asset._level0SurfaceTextureReadyVersion) || 0,
                tileCoordKeys.length
            ].join(":");
        }

        getLevel0GroundSurfaceChunkTexture(ctx, sectionKey, asset, chunkX, chunkY) {
            const map = ctx && ctx.map;
            if (!map || !asset || typeof document === "undefined" || typeof PIXI === "undefined") return null;
            if (!(this.level0GroundSurfaceChunkCache instanceof Map)) {
                this.level0GroundSurfaceChunkCache = new Map();
            }
            const cacheKey = this.getLevel0GroundSurfaceChunkKey(sectionKey, chunkX, chunkY);
            const signature = this.getLevel0GroundSurfaceChunkSignature(asset, chunkX, chunkY);
            let cache = this.level0GroundSurfaceChunkCache.get(cacheKey);
            if (cache && cache.signature === signature && cache.ready === true && cache.texture && cache.bounds) {
                cache.lastUsedTick = ++this.level0GroundSurfaceChunkTick;
                return cache;
            }
            const buildLimit = Math.max(0, Math.floor(Number(FLOOR_LEVEL0_CHUNK_BUILDS_PER_FRAME) || 0));
            const buildsThisFrame = Math.max(0, Number(this.level0GroundSurfaceChunkBuildsThisFrame) || 0);
            if (buildsThisFrame >= buildLimit) {
                if (cache && cache.texture && cache.bounds) {
                    cache.ready = false;
                    cache.pending = true;
                    cache.targetSignature = signature;
                    cache.lastUsedTick = ++this.level0GroundSurfaceChunkTick;
                    return cache;
                }
                return null;
            }
            this.level0GroundSurfaceChunkBuildsThisFrame = buildsThisFrame + 1;

            const bounds = this.getLevel0GroundSurfaceChunkBounds(chunkX, chunkY, map);
            const canvas = document.createElement("canvas");
            canvas.width = FLOOR_LEVEL0_CHUNK_TEXTURE_SIZE;
            canvas.height = FLOOR_LEVEL0_CHUNK_TEXTURE_SIZE;
            const ctx2d = canvas.getContext("2d");
            if (!ctx2d) return cache && cache.texture ? cache : null;
            ctx2d.clearRect(0, 0, canvas.width, canvas.height);
            const scale = FLOOR_LEVEL0_CHUNK_TEXTURE_SIZE / Math.max(0.001, Number(bounds.width) || 1);
            const candidateNodes = this.getLevel0PatchCandidateNodes(map, sectionKey, bounds, bounds);
            const groundBakeNodes = this.expandLevel0GroundBakeNodes(candidateNodes);
            let pendingTexture = false;
            let bakedGroundTiles = 0;
            for (let i = 0; i < groundBakeNodes.length; i++) {
                const node = groundBakeNodes[i];
                if (!node) continue;
                if (this.drawLevel0GroundTileToCanvas(ctx2d, map, node, bounds, scale, sectionKey, asset)) {
                    bakedGroundTiles += 1;
                } else {
                    pendingTexture = true;
                }
            }
            const roadBake = this.addRoadsToLevel0GroundSurfaceCanvas(ctx2d, groundBakeNodes, bounds, scale, sectionKey, asset);
            pendingTexture = pendingTexture || !!(roadBake && roadBake.pending);
            if (pendingTexture) {
                if (cache && cache.texture) {
                    cache.ready = false;
                    cache.targetSignature = signature;
                    cache.pending = true;
                    cache.lastUsedTick = ++this.level0GroundSurfaceChunkTick;
                    return cache;
                }
                return null;
            }

            const texture = PIXI.Texture.from(canvas);
            if (!texture) return cache && cache.texture ? cache : null;
            if (cache && cache.texture && cache.texture !== texture && typeof cache.texture.destroy === "function") {
                cache.texture.destroy(true);
            }
            cache = {
                key: cacheKey,
                sectionKey,
                chunkX: Math.floor(Number(chunkX) || 0),
                chunkY: Math.floor(Number(chunkY) || 0),
                signature,
                ready: true,
                pending: false,
                texture,
                canvas,
                ctx2d,
                bounds,
                scale,
                bakedGroundTiles,
                bakedRoads: roadBake && Number.isFinite(roadBake.baked) ? roadBake.baked : 0
            };
            cache.lastUsedTick = ++this.level0GroundSurfaceChunkTick;
            this.level0GroundSurfaceChunkCache.set(cacheKey, cache);
            if (this.currentFrameMetrics) {
                this.currentFrameMetrics.floorLevel0ChunkBuilds = (this.currentFrameMetrics.floorLevel0ChunkBuilds || 0) + 1;
                this.currentFrameMetrics.floorLevel0ChunkGroundTiles = (this.currentFrameMetrics.floorLevel0ChunkGroundTiles || 0) + bakedGroundTiles;
                this.currentFrameMetrics.floorLevel0ChunkRoads = (this.currentFrameMetrics.floorLevel0ChunkRoads || 0) + cache.bakedRoads;
            }
            return cache;
        }

        trimLevel0GroundSurfaceChunkCache(limit = FLOOR_LEVEL0_CHUNK_CACHE_LIMIT) {
            if (!(this.level0GroundSurfaceChunkCache instanceof Map)) return 0;
            const safeLimit = Math.max(0, Math.floor(Number(limit) || 0));
            if (this.level0GroundSurfaceChunkCache.size <= safeLimit) return 0;
            const entries = Array.from(this.level0GroundSurfaceChunkCache.entries())
                .sort((a, b) => {
                    const aTick = Number(a[1] && a[1].lastUsedTick) || 0;
                    const bTick = Number(b[1] && b[1].lastUsedTick) || 0;
                    return aTick - bTick;
                });
            let removed = 0;
            const removeCount = Math.max(0, entries.length - safeLimit);
            for (let i = 0; i < removeCount; i++) {
                const [key, cache] = entries[i];
                if (cache && cache.texture && typeof cache.texture.destroy === "function") {
                    cache.texture.destroy(true);
                }
                this.level0GroundSurfaceChunkCache.delete(key);
                removed += 1;
            }
            return removed;
        }

        trimFloorVisualChunkClipCache(limit = FLOOR_LEVEL0_CHUNK_CACHE_LIMIT * 4) {
            if (!(this.floorVisualChunkClipCache instanceof Map)) return 0;
            const safeLimit = Math.max(0, Math.floor(Number(limit) || 0));
            if (this.floorVisualChunkClipCache.size <= safeLimit) return 0;
            const entries = Array.from(this.floorVisualChunkClipCache.entries())
                .sort((a, b) => {
                    const aTick = Number(a[1] && a[1].lastUsedTick) || 0;
                    const bTick = Number(b[1] && b[1].lastUsedTick) || 0;
                    return aTick - bTick;
                });
            const removeCount = Math.max(0, entries.length - safeLimit);
            for (let i = 0; i < removeCount; i++) {
                this.floorVisualChunkClipCache.delete(entries[i][0]);
            }
            return removeCount;
        }

        getCachedFloorVisualClippedPolygonsForChunk(fragmentId, renderOuter, holes, chunkBounds, chunkX, chunkY, shapeSignature) {
            const normalizedHoles = Array.isArray(holes) ? holes : [];
            if (normalizedHoles.length === 0) {
                return collectFloorVisualClippedPolygonsForRect(renderOuter, normalizedHoles, chunkBounds);
            }
            if (!(this.floorVisualChunkClipCache instanceof Map)) {
                this.floorVisualChunkClipCache = new Map();
            }
            const signature = typeof shapeSignature === "string" && shapeSignature.length > 0
                ? shapeSignature
                : buildFloorVisualSignature(renderOuter, normalizedHoles);
            const cacheKey = `${fragmentId || ""}:chunk:${Math.floor(Number(chunkX) || 0)},${Math.floor(Number(chunkY) || 0)}:${signature}`;
            const cached = this.floorVisualChunkClipCache.get(cacheKey);
            if (cached && Array.isArray(cached.polygons)) {
                cached.lastUsedTick = ++this.floorVisualChunkClipTick;
                if (this.currentFrameMetrics) {
                    this.currentFrameMetrics.floorVisualChunkClipCacheHits = (this.currentFrameMetrics.floorVisualChunkClipCacheHits || 0) + 1;
                }
                return cached.polygons;
            }
            const clippedPolygons = collectFloorVisualClippedPolygonsForRect(renderOuter, normalizedHoles, chunkBounds);
            if (clippedPolygons === null) return null;
            this.floorVisualChunkClipCache.set(cacheKey, {
                polygons: Array.isArray(clippedPolygons) ? clippedPolygons : [],
                lastUsedTick: ++this.floorVisualChunkClipTick
            });
            if (this.currentFrameMetrics) {
                this.currentFrameMetrics.floorVisualChunkClipCacheMisses = (this.currentFrameMetrics.floorVisualChunkClipCacheMisses || 0) + 1;
            }
            return clippedPolygons;
        }

        collectLevel0ChunkFloorVisualEntries(ctx, fragmentId, fragment, asset, outer, holes, baseZ, alpha) {
            if (!FLOOR_LEVEL0_CHUNKED_SURFACE_ENABLED) return null;
            const map = ctx && ctx.map;
            const sectionKey = typeof fragment.ownerSectionKey === "string" ? fragment.ownerSectionKey : "";
            if (!map || !sectionKey || !asset) return [];
            const renderOuter = expandFloorVisualPolygonFromCentroid(outer, FLOOR_LEVEL0_SEAM_BLEED_UNITS);
            const shapeSignature = Array.isArray(holes) && holes.length > 0
                ? buildFloorVisualSignature(renderOuter, holes)
                : "";
            const polygonBounds = getFloorVisualPointBounds(renderOuter);
            if (!polygonBounds) return [];
            const chunkCoords = this.getLevel0GroundSurfaceChunkCoordsForBounds(polygonBounds);
            const out = [];
            const cam = this.camera || null;
            const viewportRef = ctx && ctx.viewport ? ctx.viewport : null;
            const chunkWorldSize = this.getLevel0GroundSurfaceChunkWorldSize();
            const viewBounds = (
                cam &&
                Number.isFinite(cam.x) &&
                Number.isFinite(cam.y) &&
                Number.isFinite(viewportRef && viewportRef.width) &&
                Number.isFinite(viewportRef && viewportRef.height)
            ) ? {
                minX: Number(cam.x) - chunkWorldSize,
                minY: Number(cam.y) - chunkWorldSize,
                maxX: Number(cam.x) + Math.max(0, Number(viewportRef.width)) + chunkWorldSize,
                maxY: Number(cam.y) + Math.max(0, Number(viewportRef.height)) + chunkWorldSize
            } : null;
            for (let i = 0; i < chunkCoords.length; i++) {
                const coord = chunkCoords[i];
                const chunkBounds = this.getLevel0GroundSurfaceChunkBounds(coord.chunkX, coord.chunkY, map);
                if (
                    viewBounds &&
                    (
                        chunkBounds.maxX < viewBounds.minX ||
                        chunkBounds.minX > viewBounds.maxX ||
                        chunkBounds.maxY < viewBounds.minY ||
                        chunkBounds.minY > viewBounds.maxY
                    )
                ) {
                    continue;
                }
                const clippedPolygons = this.getCachedFloorVisualClippedPolygonsForChunk(
                    fragmentId,
                    renderOuter,
                    holes,
                    chunkBounds,
                    coord.chunkX,
                    coord.chunkY,
                    shapeSignature
                );
                if (clippedPolygons === null) return null;
                if (!Array.isArray(clippedPolygons) || clippedPolygons.length === 0) continue;
                const chunk = this.getLevel0GroundSurfaceChunkTexture(ctx, sectionKey, asset, coord.chunkX, coord.chunkY);
                if (!chunk || !chunk.texture || !chunk.bounds) continue;
                for (let p = 0; p < clippedPolygons.length; p++) {
                    const clipped = clippedPolygons[p];
                    if (!clipped || !Array.isArray(clipped.outer) || clipped.outer.length < 3) continue;
                    const polygonKeySuffix = (
                        p === 0 &&
                        clippedPolygons.length === 1 &&
                        (!Array.isArray(holes) || holes.length === 0)
                    ) ? "" : `:poly:${p}`;
                    out.push({
                        key: `fragment:${fragmentId}:chunk:${coord.chunkX},${coord.chunkY}${polygonKeySuffix}`,
                        level: 0,
                        baseZ,
                        outer: clipped.outer,
                        holes: Array.isArray(clipped.holes) ? clipped.holes : [],
                        texture: chunk.texture,
                        textureBounds: chunk.bounds,
                        textureRepeat: null,
                        texturePath: `level0chunk:${sectionKey}:${coord.chunkX},${coord.chunkY}`,
                        tint: 0xffffff,
                        alpha,
                        depthBias: FLOOR_VISUAL_DEPTH_BIAS_UNITS - 0.005,
                        isHoleOverlay: false
                    });
                }
            }
            return out;
        }

        isRoadCoveredByReadyLevel0Chunks(ctx, road) {
            if (!FLOOR_LEVEL0_CHUNKED_SURFACE_ENABLED || !road) return false;
            const map = ctx && ctx.map;
            const node = typeof road.getNode === "function" ? road.getNode() : road.node;
            const sectionKey = node && typeof node._prototypeSectionKey === "string" ? node._prototypeSectionKey : "";
            const state = map && map._prototypeSectionState;
            const asset = sectionKey && state && state.sectionAssetsByKey instanceof Map
                ? state.sectionAssetsByKey.get(sectionKey)
                : null;
            if (!asset) return false;
            const worldX = Number.isFinite(road.x) ? Number(road.x) : (Number.isFinite(node && node.x) ? Number(node.x) : 0);
            const worldY = Number.isFinite(road.y) ? Number(road.y) : (Number.isFinite(node && node.y) ? Number(node.y) : 0);
            const width = Math.max(0.001, Number(road.width) || 1) * 1.1547;
            const height = Math.max(0.001, Number(road.height) || 1);
            const bounds = {
                minX: worldX - width * 0.5,
                minY: worldY - height * 0.5,
                maxX: worldX + width * 0.5,
                maxY: worldY + height * 0.5
            };
            const coords = this.getLevel0GroundSurfaceChunkCoordsForBounds(bounds);
            if (coords.length === 0) return false;
            for (let i = 0; i < coords.length; i++) {
                const coord = coords[i];
                const key = this.getLevel0GroundSurfaceChunkKey(sectionKey, coord.chunkX, coord.chunkY);
                const cache = this.level0GroundSurfaceChunkCache instanceof Map
                    ? this.level0GroundSurfaceChunkCache.get(key)
                    : null;
                const signature = this.getLevel0GroundSurfaceChunkSignature(asset, coord.chunkX, coord.chunkY);
                if (!cache || cache.ready !== true || cache.signature !== signature || !cache.texture || !cache.bounds) {
                    return false;
                }
            }
            return true;
        }

        getLevel0GroundSurfaceAssetTileCoordSet(asset) {
            const tileCoordKeys = Array.isArray(asset && asset.tileCoordKeys) ? asset.tileCoordKeys : [];
            const signature = `${tileCoordKeys.length}:${Number(asset && asset._level0SurfaceVersion) || 0}`;
            if (asset && asset._level0GroundSurfaceTileCoordSet instanceof Set && asset._level0GroundSurfaceTileCoordSetSignature === signature) {
                return asset._level0GroundSurfaceTileCoordSet;
            }
            const set = new Set(tileCoordKeys);
            if (asset) {
                asset._level0GroundSurfaceTileCoordSet = set;
                asset._level0GroundSurfaceTileCoordSetSignature = signature;
            }
            return set;
        }

        isLevel0GroundSurfaceChunkReadyForBounds(sectionKey, asset, bounds, readyCache = null) {
            if (!FLOOR_LEVEL0_CHUNKED_SURFACE_ENABLED || !sectionKey || !asset || !bounds) return false;
            const coords = this.getLevel0GroundSurfaceChunkCoordsForBounds(bounds);
            if (coords.length === 0) return false;
            for (let i = 0; i < coords.length; i++) {
                const coord = coords[i];
                const cacheKey = this.getLevel0GroundSurfaceChunkKey(sectionKey, coord.chunkX, coord.chunkY);
                if (readyCache instanceof Map && readyCache.has(cacheKey)) {
                    if (readyCache.get(cacheKey) !== true) return false;
                    continue;
                }
                const cache = this.level0GroundSurfaceChunkCache instanceof Map
                    ? this.level0GroundSurfaceChunkCache.get(cacheKey)
                    : null;
                const signature = this.getLevel0GroundSurfaceChunkSignature(asset, coord.chunkX, coord.chunkY);
                const ready = !!(
                    cache &&
                    cache.ready === true &&
                    cache.signature === signature &&
                    cache.texture &&
                    cache.bounds
                );
                if (readyCache instanceof Map) readyCache.set(cacheKey, ready);
                if (!ready) return false;
            }
            return true;
        }

        isGroundNodeCoveredByReadyLevel0Chunk(ctx, node, tileWorldW, tileWorldH, readyCache = null, assetCache = null) {
            if (!FLOOR_LEVEL0_CHUNKED_SURFACE_ENABLED || !node) return false;
            const nodeLayer = this.getLayerIndexForNode(node);
            if (nodeLayer !== 0) return false;
            const map = ctx && ctx.map;
            const sectionKey = typeof node._prototypeSectionKey === "string" ? node._prototypeSectionKey : "";
            if (!map || !sectionKey) return false;
            let asset = null;
            let editedLevel0 = false;
            if (assetCache instanceof Map && assetCache.has(sectionKey)) {
                const cached = assetCache.get(sectionKey);
                asset = cached && cached.asset ? cached.asset : null;
                editedLevel0 = !!(cached && cached.editedLevel0);
            } else {
                const state = map._prototypeSectionState || null;
                asset = state && state.sectionAssetsByKey instanceof Map
                    ? state.sectionAssetsByKey.get(sectionKey)
                    : null;
                editedLevel0 = !!(asset && this.hasEditedLevel0FloorAsset(asset));
                if (assetCache instanceof Map) {
                    assetCache.set(sectionKey, {
                        asset: asset || null,
                        editedLevel0
                    });
                }
            }
            if (!asset || !editedLevel0) return false;
            const tileKey = `${node.xindex},${node.yindex}`;
            const tileCoordSet = this.getLevel0GroundSurfaceAssetTileCoordSet(asset);
            if (tileCoordSet instanceof Set && !tileCoordSet.has(tileKey)) return false;
            const x = Number(node.x);
            const y = Number(node.y);
            if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
            const width = Math.max(0.001, Number(tileWorldW) || 1);
            const height = Math.max(0.001, Number(tileWorldH) || 1);
            return this.isLevel0GroundSurfaceChunkReadyForBounds(
                sectionKey,
                asset,
                {
                    minX: x - width * 0.5,
                    minY: y - height * 0.5,
                    maxX: x + width * 0.5,
                    maxY: y + height * 0.5
                },
                readyCache
            );
        }

        getBakedLevel0SectionKeys(ctx) {
            if (!FLOOR_LEVEL0_BAKED_SURFACE_ENABLED) return new Set();
            const map = ctx && ctx.map;
            const state = map && map._prototypeSectionState;
            if (!state || !(state.sectionAssetsByKey instanceof Map)) return new Set();
            if (FLOOR_LEVEL0_CHUNKED_SURFACE_ENABLED) {
                if (this.level0GroundSurfaceCache instanceof Map) {
                    for (const [sectionKey, cache] of this.level0GroundSurfaceCache.entries()) {
                        if (cache && cache.texture && typeof cache.texture.destroy === "function") {
                            cache.texture.destroy(true);
                        }
                        this.level0GroundSurfaceCache.delete(sectionKey);
                        if (this.level0GroundSurfaceBakeNodeCache instanceof Map) {
                            this.level0GroundSurfaceBakeNodeCache.delete(sectionKey);
                        }
                    }
                }
                this.bakedLevel0SectionKeys = new Set();
                this.bakedLevel0SectionSignature = `chunked:${state.sectionAssetsByKey.size}`;
                return this.bakedLevel0SectionKeys;
            }
            const assetCount = state.sectionAssetsByKey.size;
            let editVersion = 0;
            for (const [, asset] of state.sectionAssetsByKey.entries()) {
                editVersion += Number(asset && asset._level0SurfaceVersion) || 0;
                editVersion += Number(asset && asset._level0RoadSurfaceVersion) || 0;
                editVersion += Number(asset && asset._level0GroundSurfaceVersion) || 0;
                editVersion += Number(asset && asset._level0SurfaceTextureReadyVersion) || 0;
            }
            const signature = `${assetCount}:${editVersion}`;
            if (signature === this.bakedLevel0SectionSignature && this.bakedLevel0SectionKeys instanceof Set) {
                return this.bakedLevel0SectionKeys;
            }
            const out = new Set();
            for (const [sectionKey, asset] of state.sectionAssetsByKey.entries()) {
                const cache = this.level0GroundSurfaceCache instanceof Map
                    ? this.level0GroundSurfaceCache.get(sectionKey)
                    : null;
                const nodes = state.nodesBySectionKey instanceof Map
                    ? (state.nodesBySectionKey.get(sectionKey) || [])
                    : [];
                const expectedSignature = cache
                    ? this.getLevel0GroundSurfaceSignature(asset, nodes)
                    : "";
                if (
                    this.hasEditedLevel0FloorAsset(asset) &&
                    (
                        FLOOR_LEVEL0_FORCE_BAKED_SURFACE ||
                        (
                            cache &&
                            cache.ready === true &&
                            cache.signature === expectedSignature &&
                            cache.texture &&
                            cache.bounds
                        )
                    )
                ) {
                    out.add(sectionKey);
                }
            }
            if (this.level0GroundSurfaceCache instanceof Map) {
                for (const sectionKey of this.level0GroundSurfaceCache.keys()) {
                    if (!out.has(sectionKey)) {
                        const cache = this.level0GroundSurfaceCache.get(sectionKey);
                        if (cache && cache.texture && typeof cache.texture.destroy === "function") {
                            cache.texture.destroy(true);
                        }
                        this.level0GroundSurfaceCache.delete(sectionKey);
                        if (this.level0GroundSurfaceBakeNodeCache instanceof Map) {
                            this.level0GroundSurfaceBakeNodeCache.delete(sectionKey);
                        }
                    }
                }
            }
            this.bakedLevel0SectionKeys = out;
            this.bakedLevel0SectionSignature = signature;
            return out;
        }

        getLevel0GroundSurfaceSignature(asset, nodes) {
            const tileCoordKeys = Array.isArray(asset && asset.tileCoordKeys) ? asset.tileCoordKeys : [];
            return [
                Number(asset && asset._level0SurfaceVersion) || 0,
                Number(asset && asset._level0RoadSurfaceModelVersion) || 0,
                Number(asset && asset._level0RoadSurfaceVersion) || 0,
                Number(asset && asset._level0GroundSurfaceVersion) || 0,
                Number(asset && asset._level0SurfaceTextureReadyVersion) || 0,
                tileCoordKeys.length,
                Array.isArray(nodes) ? nodes.length : 0
            ].join(":");
        }

        getRoadSectionKey(road) {
            if (!road) return "";
            const node = typeof road.getNode === "function" ? road.getNode() : road.node;
            return node && typeof node._prototypeSectionKey === "string" ? node._prototypeSectionKey : "";
        }

        isRoadBakedIntoLevel0Surface(ctx, road, bakedSectionKeys = null) {
            if (FLOOR_LEVEL0_CHUNKED_SURFACE_ENABLED) {
                return this.isRoadCoveredByReadyLevel0Chunks(ctx, road);
            }
            const sectionKey = this.getRoadSectionKey(road);
            if (!sectionKey) return false;
            const sectionKeys = bakedSectionKeys instanceof Set
                ? bakedSectionKeys
                : this.getBakedLevel0SectionKeys(ctx);
            return sectionKeys instanceof Set && sectionKeys.has(sectionKey);
        }

        markLevel0GroundSurfacePendingTexture(sectionKey, baseTexture, asset = null) {
            if (!sectionKey || !baseTexture || typeof baseTexture.once !== "function") return;
            const key = `${sectionKey}:${baseTexture.uid || baseTexture.cacheId || ""}`;
            if (this.level0GroundSurfacePendingLoads instanceof Set && this.level0GroundSurfacePendingLoads.has(key)) return;
            if (!(this.level0GroundSurfacePendingLoads instanceof Set)) {
                this.level0GroundSurfacePendingLoads = new Set();
            }
            this.level0GroundSurfacePendingLoads.add(key);
            baseTexture.once("loaded", () => {
                this.level0GroundSurfacePendingLoads.delete(key);
                if (asset) {
                    asset._level0SurfaceTextureReadyVersion = (Number(asset._level0SurfaceTextureReadyVersion) || 0) + 1;
                }
                this.bakedLevel0SectionSignature = "";
                if (typeof globalThis !== "undefined" && typeof globalThis.presentGameFrame === "function") {
                    globalThis.presentGameFrame();
                }
            });
        }

        getLevel0BakeImageSource(texture) {
            if (!isRenderablePixiTexture(texture)) return null;
            const baseTexture = texture.baseTexture || null;
            const resource = baseTexture && baseTexture.resource ? baseTexture.resource : null;
            const source = resource && resource.source ? resource.source : null;
            if (!source) return null;
            const width = Number(source.naturalWidth || source.videoWidth || source.width) || 0;
            const height = Number(source.naturalHeight || source.videoHeight || source.height) || 0;
            if (width <= 0 || height <= 0) return null;
            return source;
        }

        drawLevel0GroundTileToCanvas(ctx2d, map, node, bounds, scale, sectionKey = "", asset = null) {
            if (!ctx2d || !map || !node || !bounds || !Number.isFinite(scale)) return false;
            const maxTextureIndex = Array.isArray(map.groundTextures) ? (map.groundTextures.length - 1) : 0;
            const _baseId = Math.max(0, Math.min(12, Number.isFinite(node.groundTextureId) ? Math.floor(node.groundTextureId) : 0));
            const _x = Number.isFinite(node.xindex) ? Math.floor(node.xindex) : 0;
            const _y = Number.isFinite(node.yindex) ? Math.floor(node.yindex) : 0;
            const _seed = ((_x * 73856093) ^ (_y * 19349663) ^ (_baseId * 83492791)) >>> 0;
            const _variant = _seed % 4;
            const _variantTextureIndex = _baseId + (_variant * 13);
            const _tileCount = 52;
            const _scrambledIndex = (_variantTextureIndex * 17) % _tileCount;
            const textureIndex = Math.min(maxTextureIndex, (_tileCount <= (maxTextureIndex + 1)) ? _scrambledIndex : _variantTextureIndex);
            const texture = Array.isArray(map.groundTextures) && map.groundTextures[textureIndex]
                ? map.groundTextures[textureIndex]
                : PIXI.Texture.WHITE;
            if (!isRenderablePixiTexture(texture)) {
                const baseTexture = texture && texture.baseTexture ? texture.baseTexture : null;
                if (baseTexture && baseTexture.valid !== true) {
                    this.markLevel0GroundSurfacePendingTexture(sectionKey, baseTexture, asset);
                }
                return false;
            }
            const source = this.getLevel0BakeImageSource(texture);
            if (!source) return false;
            const width = bounds.tileWorldW * scale;
            const height = bounds.tileWorldH * scale;
            const x = (Number(node.x) - bounds.minX) * scale - width * 0.5;
            const y = (Number(node.y) - bounds.minY) * scale - height * 0.5;
            ctx2d.drawImage(source, x, y, width, height);
            return true;
        }

        drawRoadToLevel0GroundSurfaceCanvas(ctx2d, road, node, bounds, scale, sectionKey = "", asset = null, options = null) {
            if (!ctx2d || !road || road.gone || road.type !== "road" || !bounds || !Number.isFinite(scale)) {
                return { baked: 0, pending: false };
            }
            const RoadClass = typeof global.Road !== "undefined" ? global.Road : null;
            const fillTexture = RoadClass && typeof RoadClass._getFillTexture === "function"
                ? RoadClass._getFillTexture(road.fillTexturePath)
                : null;
            const fillBase = fillTexture && fillTexture.baseTexture ? fillTexture.baseTexture : null;
            if (fillBase && fillBase.valid !== true) {
                this.markLevel0GroundSurfacePendingTexture(sectionKey, fillBase, asset);
                return { baked: 0, pending: true };
            }
            const worldX = Number.isFinite(road.x) ? road.x : (Number.isFinite(node && node.x) ? node.x : 0);
            const worldY = Number.isFinite(road.y) ? road.y : (Number.isFinite(node && node.y) ? node.y : 0);
            const refreshTexture = !options || options.refreshTexture !== false;
            if (refreshTexture && typeof road.updateTexture === "function") {
                road.updateTexture(null, road.fillTexturePath);
            }
            const texture = road.pixiSprite && isRenderablePixiTexture(road.pixiSprite.texture)
                ? road.pixiSprite.texture
                : null;
            const source = this.getLevel0BakeImageSource(texture);
            if (!source) return { baked: 0, pending: true };
            const width = (Number(road.width) || 1) * 1.1547 * scale;
            const height = (Number(road.height) || 1) * scale;
            const x = (worldX - bounds.minX) * scale - width * 0.5;
            const y = (worldY - bounds.minY) * scale - height * 0.5;
            const previousAlpha = ctx2d.globalAlpha;
            ctx2d.globalAlpha = Number.isFinite(road.alpha) ? road.alpha : 1;
            ctx2d.drawImage(source, x, y, width, height);
            ctx2d.globalAlpha = previousAlpha;
            return { baked: 1, pending: false };
        }

        addRoadsToLevel0GroundSurfaceCanvas(ctx2d, nodes, bounds, scale, sectionKey = "", asset = null) {
            if (!ctx2d || !Array.isArray(nodes) || !bounds || typeof PIXI === "undefined") return { baked: 0, pending: false };
            const seenRoads = new Set();
            let baked = 0;
            let pending = false;
            for (let i = 0; i < nodes.length; i++) {
                const node = nodes[i];
                if (!node || !Array.isArray(node.objects)) continue;
                for (let j = 0; j < node.objects.length; j++) {
                    const road = node.objects[j];
                    if (!road || road.gone || road.type !== "road" || seenRoads.has(road)) continue;
                    seenRoads.add(road);
                    const roadBake = this.drawRoadToLevel0GroundSurfaceCanvas(ctx2d, road, node, bounds, scale, sectionKey, asset, {
                        refreshTexture: true
                    });
                    baked += roadBake && Number.isFinite(roadBake.baked) ? roadBake.baked : 0;
                    pending = pending || !!(roadBake && roadBake.pending);
                }
            }
            return { baked, pending };
        }

        getLevel0GroundSurfaceBounds(asset, map) {
            const tileCoordKeys = Array.isArray(asset && asset.tileCoordKeys) ? asset.tileCoordKeys : [];
            const tileWorldW = (Number.isFinite(map && map.hexWidth) ? map.hexWidth : (1 / 0.866))
                * GROUND_TILE_OVERLAP_SCALE;
            const tileWorldH = (Number.isFinite(map && map.hexHeight) ? map.hexHeight : 1)
                * GROUND_TILE_OVERLAP_SCALE;
            let minX = Infinity;
            let minY = Infinity;
            let maxX = -Infinity;
            let maxY = -Infinity;
            for (let i = 0; i < tileCoordKeys.length; i++) {
                const [xRaw, yRaw] = String(tileCoordKeys[i]).split(",");
                const x = Number(xRaw);
                const y = Number(yRaw);
                if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
                const wx = x * 0.866;
                const wy = y + (x % 2 === 0 ? 0.5 : 0);
                minX = Math.min(minX, wx - tileWorldW * 0.5);
                maxX = Math.max(maxX, wx + tileWorldW * 0.5);
                minY = Math.min(minY, wy - tileWorldH * 0.5);
                maxY = Math.max(maxY, wy + tileWorldH * 0.5);
            }
            if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
                return null;
            }
            return {
                minX,
                minY,
                maxX,
                maxY,
                width: Math.max(0.001, maxX - minX),
                height: Math.max(0.001, maxY - minY),
                tileWorldW,
                tileWorldH
            };
        }

        expandLevel0GroundBakeNodes(nodes) {
            const seed = Array.isArray(nodes) ? nodes : [];
            const out = [];
            const seen = new Set();
            const pushNode = (node) => {
                if (!node) return;
                const key = `${Number(node.xindex)},${Number(node.yindex)}`;
                if (seen.has(key)) return;
                seen.add(key);
                out.push(node);
            };
            for (let i = 0; i < seed.length; i++) {
                const node = seed[i];
                pushNode(node);
                const neighbors = Array.isArray(node && node.neighbors) ? node.neighbors : null;
                if (!neighbors) continue;
                for (let n = 0; n < neighbors.length; n++) {
                    const neighbor = neighbors[n];
                    if (!neighbor || neighbor._prototypeVoid === true) continue;
                    pushNode(neighbor);
                }
            }
            return out;
        }

        getLevel0GroundSurfaceBakeNodes(map, sectionKey) {
            const state = map && map._prototypeSectionState;
            if (!state || !(state.nodesBySectionKey instanceof Map)) return [];
            const sectionNodes = state.nodesBySectionKey.get(sectionKey) || [];
            if (!(this.level0GroundSurfaceBakeNodeCache instanceof Map)) {
                this.level0GroundSurfaceBakeNodeCache = new Map();
            }
            const loadedNodeCount = Array.isArray(state.loadedNodes) ? state.loadedNodes.length : 0;
            const graphSectionCount = state.nodesBySectionKey.size;
            const activeCenterKey = typeof state.activeCenterKey === "string" ? state.activeCenterKey : "";
            const signature = `${sectionNodes.length}:${loadedNodeCount}:${graphSectionCount}:${activeCenterKey}`;
            const cached = this.level0GroundSurfaceBakeNodeCache.get(sectionKey);
            if (cached && cached.signature === signature && Array.isArray(cached.nodes)) {
                return cached.nodes;
            }
            const nodes = this.expandLevel0GroundBakeNodes(sectionNodes);
            this.level0GroundSurfaceBakeNodeCache.set(sectionKey, { signature, nodes });
            return nodes;
        }

        getLevel0GroundSurfacePatchRects(asset, bounds) {
            const rects = Array.isArray(asset && asset._level0RoadSurfacePatchRects)
                ? asset._level0RoadSurfacePatchRects
                : [];
            if (!bounds || rects.length === 0) return [];
            const out = [];
            for (let i = 0; i < rects.length; i++) {
                const rect = rects[i];
                const minX = Math.max(bounds.minX, Number(rect && rect.minX));
                const minY = Math.max(bounds.minY, Number(rect && rect.minY));
                const maxX = Math.min(bounds.maxX, Number(rect && rect.maxX));
                const maxY = Math.min(bounds.maxY, Number(rect && rect.maxY));
                if (
                    Number.isFinite(minX) &&
                    Number.isFinite(minY) &&
                    Number.isFinite(maxX) &&
                    Number.isFinite(maxY) &&
                    maxX > minX &&
                    maxY > minY
                ) {
                    out.push({ minX, minY, maxX, maxY });
                }
            }
            return out;
        }

        rectsCoverLargeLevel0SurfaceArea(rects, bounds) {
            if (!Array.isArray(rects) || rects.length === 0 || !bounds) return false;
            const surfaceArea = Math.max(0.001, Number(bounds.width) * Number(bounds.height));
            let area = 0;
            for (let i = 0; i < rects.length; i++) {
                const rect = rects[i];
                area += Math.max(0, Number(rect.maxX) - Number(rect.minX)) *
                    Math.max(0, Number(rect.maxY) - Number(rect.minY));
            }
            return (area / surfaceArea) > 0.35;
        }

        getLevel0PatchCandidateNodes(map, sectionKey, rect, bounds) {
            if (!map || !rect || !bounds) return [];
            const state = map._prototypeSectionState || null;
            const sectionNodes = state && state.nodesBySectionKey instanceof Map
                ? (state.nodesBySectionKey.get(sectionKey) || [])
                : [];
            if (Array.isArray(sectionNodes) && sectionNodes.length > 0) {
                const out = [];
                const padX = (Number(bounds.tileWorldW) || 1.2) * 3;
                const padY = (Number(bounds.tileWorldH) || 1) * 3;
                const minX = Number(rect.minX) - padX;
                const maxX = Number(rect.maxX) + padX;
                const minY = Number(rect.minY) - padY;
                const maxY = Number(rect.maxY) + padY;
                for (let i = 0; i < sectionNodes.length; i++) {
                    const node = sectionNodes[i];
                    const x = Number(node && node.x);
                    const y = Number(node && node.y);
                    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
                    if (x < minX || x > maxX || y < minY || y > maxY) continue;
                    out.push(node);
                }
                return out;
            }
            if (typeof map.getNode !== "function") return [];
            const out = [];
            const seen = new Set();
            const xScale = 0.866;
            const padX = Math.ceil((Number(bounds.tileWorldW) || 1.2) / xScale) + 2;
            const padY = Math.ceil(Number(bounds.tileWorldH) || 1) + 2;
            const minXi = Math.floor(Number(rect.minX) / xScale) - padX;
            const maxXi = Math.ceil(Number(rect.maxX) / xScale) + padX;
            const minYi = Math.floor(Number(rect.minY)) - padY;
            const maxYi = Math.ceil(Number(rect.maxY)) + padY;
            for (let xi = minXi; xi <= maxXi; xi++) {
                for (let yi = minYi; yi <= maxYi; yi++) {
                    const node = map.getNode(xi, yi);
                    if (!node || typeof node._prototypeSectionKey !== "string" || node._prototypeSectionKey !== sectionKey) continue;
                    const key = `${node.xindex},${node.yindex}`;
                    if (seen.has(key)) continue;
                    seen.add(key);
                    out.push(node);
                }
            }
            return out;
        }

        patchLevel0GroundSurfaceTexture(ctx, sectionKey, asset, cache, signature) {
            const map = ctx && ctx.map;
            const bounds = cache && cache.bounds;
            const canvas = cache && cache.canvas;
            const ctx2d = cache && cache.ctx2d;
            const scale = Number(cache && cache.scale);
            const rects = this.getLevel0GroundSurfacePatchRects(asset, bounds);
            if (!map || !bounds || !canvas || !ctx2d || !Number.isFinite(scale) || rects.length === 0) return null;
            const startMs = (typeof performance !== "undefined" && performance && typeof performance.now === "function")
                ? performance.now()
                : Date.now();
            let bakedGroundTiles = 0;
            let bakedRoads = 0;
            let pendingTexture = false;
            let patchedPixels = 0;
            let candidateNodeTotal = 0;
            let textureMisses = 0;
            const nowMs = (typeof performance !== "undefined" && performance && typeof performance.now === "function")
                ? performance.now()
                : Date.now();
            for (let r = 0; r < rects.length; r++) {
                const rect = rects[r];
                const x = Math.floor((rect.minX - bounds.minX) * scale);
                const y = Math.floor((rect.minY - bounds.minY) * scale);
                const w = Math.max(1, Math.ceil((rect.maxX - rect.minX) * scale));
                const h = Math.max(1, Math.ceil((rect.maxY - rect.minY) * scale));
                let previousPatchCanvas = null;
                let previousPatchCtx = null;
                if (typeof document !== "undefined" && document && typeof document.createElement === "function") {
                    try {
                        previousPatchCanvas = document.createElement("canvas");
                        previousPatchCanvas.width = w;
                        previousPatchCanvas.height = h;
                        previousPatchCtx = previousPatchCanvas.getContext("2d");
                        if (previousPatchCtx) {
                            previousPatchCtx.drawImage(canvas, x, y, w, h, 0, 0, w, h);
                        }
                    } catch (_err) {
                        previousPatchCanvas = null;
                        previousPatchCtx = null;
                    }
                }
                if (!previousPatchCanvas || !previousPatchCtx) return null;
                patchedPixels += w * h;
                const candidateNodes = this.getLevel0PatchCandidateNodes(map, sectionKey, rect, bounds);
                const groundCandidateNodes = this.expandLevel0GroundBakeNodes(candidateNodes);
                candidateNodeTotal += candidateNodes.length;
                let rectPendingTexture = false;
                ctx2d.save();
                ctx2d.beginPath();
                ctx2d.rect(x, y, w, h);
                ctx2d.clip();
                ctx2d.clearRect(x, y, w, h);
                const seenRoads = new Set();
                for (let i = 0; i < groundCandidateNodes.length; i++) {
                    if (this.drawLevel0GroundTileToCanvas(ctx2d, map, groundCandidateNodes[i], bounds, scale, sectionKey, asset)) {
                        bakedGroundTiles += 1;
                    } else {
                        pendingTexture = true;
                        rectPendingTexture = true;
                        textureMisses += 1;
                    }
                }
                // Include one-ring neighbors so seam-crossing roads are baked on both sides.
                for (let i = 0; i < groundCandidateNodes.length; i++) {
                    const node = groundCandidateNodes[i];
                    if (!node || !Array.isArray(node.objects)) continue;
                    for (let j = 0; j < node.objects.length; j++) {
                        const road = node.objects[j];
                        if (!road || road.gone || road.type !== "road" || seenRoads.has(road)) continue;
                        seenRoads.add(road);
                        const roadBake = this.drawRoadToLevel0GroundSurfaceCanvas(ctx2d, road, node, bounds, scale, sectionKey, asset, {
                            refreshTexture: false
                        });
                        bakedRoads += roadBake && Number.isFinite(roadBake.baked) ? roadBake.baked : 0;
                        if (roadBake && roadBake.pending) {
                            pendingTexture = true;
                            rectPendingTexture = true;
                        }
                    }
                }
                ctx2d.restore();
                if (rectPendingTexture) {
                    ctx2d.drawImage(previousPatchCanvas, x, y);
                }
            }
            if (cache.texture && cache.texture.baseTexture && typeof cache.texture.baseTexture.update === "function") {
                cache.texture.baseTexture.update();
            } else if (cache.texture && typeof cache.texture.update === "function") {
                cache.texture.update();
            }
            if (pendingTexture) {
                const previousPendingSignature = cache._level0PatchPendingSignature;
                const previousPendingCount = previousPendingSignature === signature
                    ? Math.max(0, Number(cache._level0PatchPendingCount) || 0)
                    : 0;
                const nextPendingCount = Math.min(previousPendingCount + 1, 6);
                cache._level0PatchPendingSignature = signature;
                cache._level0PatchPendingCount = nextPendingCount;
                cache._level0PatchRetryAtMs = nowMs + Math.min(1000, 80 * Math.pow(2, nextPendingCount - 1));
                this.bakedLevel0SectionSignature = "";
                return cache;
            }
            cache.signature = signature;
            cache.ready = true;
            cache._level0PatchPendingSignature = "";
            cache._level0PatchPendingCount = 0;
            cache._level0PatchRetryAtMs = 0;
            asset._level0RoadSurfacePatchRects = [];
            if (this.currentFrameMetrics) {
                this.currentFrameMetrics.floorLevel0BakePatchRects = (this.currentFrameMetrics.floorLevel0BakePatchRects || 0) + rects.length;
                this.currentFrameMetrics.floorLevel0BakeGroundTiles = (this.currentFrameMetrics.floorLevel0BakeGroundTiles || 0) + bakedGroundTiles;
                this.currentFrameMetrics.floorLevel0BakeRoads = (this.currentFrameMetrics.floorLevel0BakeRoads || 0) + bakedRoads;
                this.currentFrameMetrics.floorLevel0BakePixels = (this.currentFrameMetrics.floorLevel0BakePixels || 0) + patchedPixels;
            }
            if (global.renderingDiagnostics && global.renderingDiagnostics.level0RoadPatchBakeLogging === true) {
                const elapsedMs = ((typeof performance !== "undefined" && performance && typeof performance.now === "function")
                    ? performance.now()
                    : Date.now()) - startMs;
                console.log("[level0 road patch bake]", {
                    sectionKey,
                    rects: rects.length,
                    candidateNodes: candidateNodeTotal,
                    groundTiles: bakedGroundTiles,
                    roads: bakedRoads,
                    textureMisses,
                    pendingTexture,
                    pixels: patchedPixels,
                    ms: Math.round(elapsedMs * 100) / 100
                });
            }
            this.bakedLevel0SectionSignature = "";
            return cache;
        }

        getLevel0GroundSurfaceTexture(ctx, sectionKey, asset) {
            const map = ctx && ctx.map;
            const state = map && map._prototypeSectionState;
            if (this.currentFrameMetrics) {
                this.currentFrameMetrics.floorLevel0BakeRequests = (this.currentFrameMetrics.floorLevel0BakeRequests || 0) + 1;
            }
            if (!state || !(state.nodesBySectionKey instanceof Map) || typeof document === "undefined") return null;
            const nodes = state.nodesBySectionKey.get(sectionKey) || [];
            const groundBakeNodes = this.getLevel0GroundSurfaceBakeNodes(map, sectionKey);
            const signature = this.getLevel0GroundSurfaceSignature(asset, groundBakeNodes);
            let cache = this.level0GroundSurfaceCache.get(sectionKey);
            if (cache && cache.signature === signature && cache.texture && cache.bounds) {
                if (this.currentFrameMetrics) {
                    this.currentFrameMetrics.floorLevel0BakeHits = (this.currentFrameMetrics.floorLevel0BakeHits || 0) + 1;
                }
                return cache;
            }
            if (
                cache &&
                cache.texture &&
                cache.bounds &&
                cache._level0PatchPendingSignature === signature &&
                Number(cache._level0PatchRetryAtMs) > (
                    (typeof performance !== "undefined" && performance && typeof performance.now === "function")
                        ? performance.now()
                        : Date.now()
                )
            ) {
                if (this.currentFrameMetrics) {
                    this.currentFrameMetrics.floorLevel0BakePending = (this.currentFrameMetrics.floorLevel0BakePending || 0) + 1;
                }
                return cache;
            }
            const patchedCache = cache && cache.texture && cache.bounds
                ? this.patchLevel0GroundSurfaceTexture(ctx, sectionKey, asset, cache, signature)
                : null;
            if (patchedCache) {
                if (this.currentFrameMetrics) {
                    this.currentFrameMetrics.floorLevel0BakeHits = (this.currentFrameMetrics.floorLevel0BakeHits || 0) + 1;
                }
                return patchedCache;
            }
            if (this.currentFrameMetrics) {
                this.currentFrameMetrics.floorLevel0BakeMisses = (this.currentFrameMetrics.floorLevel0BakeMisses || 0) + 1;
            }
            const bounds = this.getLevel0GroundSurfaceBounds(asset, map);
            if (!bounds) return null;

            const baseScale = FLOOR_LEVEL0_SURFACE_TEXTURE_PX_PER_WORLD;
            const scale = Math.min(
                baseScale,
                FLOOR_LEVEL0_SURFACE_TEXTURE_MAX_SIZE / Math.max(bounds.width, bounds.height)
            );
            const widthPx = Math.max(1, Math.ceil(bounds.width * scale));
            const heightPx = Math.max(1, Math.ceil(bounds.height * scale));
            const canvas = document.createElement("canvas");
            canvas.width = widthPx;
            canvas.height = heightPx;
            const ctx2d = canvas.getContext("2d");
            if (!ctx2d) return null;
            ctx2d.clearRect(0, 0, widthPx, heightPx);
            let pendingTexture = false;
            let bakedGroundTiles = 0;
            for (let i = 0; i < groundBakeNodes.length; i++) {
                const node = groundBakeNodes[i];
                if (!node) continue;
                if (this.drawLevel0GroundTileToCanvas(ctx2d, map, node, bounds, scale, sectionKey, asset)) {
                    bakedGroundTiles += 1;
                } else {
                    pendingTexture = true;
                }
            }
            const roadBake = this.addRoadsToLevel0GroundSurfaceCanvas(ctx2d, groundBakeNodes, bounds, scale, sectionKey, asset);
            pendingTexture = pendingTexture || !!(roadBake && roadBake.pending);
            if (pendingTexture) {
                if (this.currentFrameMetrics) {
                    this.currentFrameMetrics.floorLevel0BakePending = (this.currentFrameMetrics.floorLevel0BakePending || 0) + 1;
                }
                return null;
            }
            const renderTexture = PIXI.Texture.from(canvas);
            if (!renderTexture) return null;
            const previousCache = cache;
            cache = {
                signature,
                texture: renderTexture,
                bounds,
                scale,
                widthPx,
                heightPx,
                canvas,
                ctx2d,
                bakedGroundTiles,
                bakedRoads: roadBake && Number.isFinite(roadBake.baked) ? roadBake.baked : 0,
                ready: true
            };
            if (this.currentFrameMetrics) {
                this.currentFrameMetrics.floorLevel0BakeGroundTiles = (this.currentFrameMetrics.floorLevel0BakeGroundTiles || 0) + bakedGroundTiles;
                this.currentFrameMetrics.floorLevel0BakeRoads = (this.currentFrameMetrics.floorLevel0BakeRoads || 0) + cache.bakedRoads;
                this.currentFrameMetrics.floorLevel0BakePixels = (this.currentFrameMetrics.floorLevel0BakePixels || 0) + (widthPx * heightPx);
            }
            this.level0GroundSurfaceCache.set(sectionKey, cache);
            asset._level0RoadSurfacePatchRects = [];
            this.bakedLevel0SectionSignature = "";
            if (
                previousCache &&
                previousCache.texture &&
                previousCache.texture !== renderTexture &&
                typeof previousCache.texture.destroy === "function"
            ) {
                previousCache.texture.destroy(true);
            }
            return cache;
        }

        getFloorVisualTexture(entry) {
            if (entry && entry.texture) return entry.texture;
            const texturePath = entry && typeof entry.texturePath === "string" ? entry.texturePath : "";
            if (texturePath && !texturePath.startsWith("level0:")) {
                if (texturePath === FLOOR_VISUAL_CAVE_TEXTURE_PATH && this.floorVisualCaveTexture) {
                    return this.floorVisualCaveTexture;
                }
                if (!this.floorVisualTextureByPath) this.floorVisualTextureByPath = new Map();
                let texture = this.floorVisualTextureByPath.get(texturePath);
                if (!texture) {
                    texture = PIXI.Texture.from(texturePath);
                    const baseTexture = texture.baseTexture || null;
                    if (baseTexture && PIXI.WRAP_MODES) {
                        baseTexture.wrapMode = PIXI.WRAP_MODES.REPEAT;
                    }
                    this.floorVisualTextureByPath.set(texturePath, texture);
                    if (texturePath === FLOOR_VISUAL_CAVE_TEXTURE_PATH) {
                        this.floorVisualCaveTexture = texture;
                    }
                }
                return texture;
            }
            return PIXI.Texture.WHITE;
        }

        normalizeFloorVisualTextureConfigPath(texturePath) {
            if (typeof texturePath !== "string" || texturePath.length === 0) return "";
            const raw = texturePath.split("?")[0].split("#")[0];
            if (raw.startsWith("/")) return raw;
            try {
                if (typeof window !== "undefined" && window.location && window.location.origin) {
                    return new URL(raw, window.location.origin).pathname || raw;
                }
            } catch (_) {}
            return raw;
        }

        buildFloorVisualTextureConfigMaps(doc) {
            const cfg = {
                byPath: new Map(),
                byFile: new Map(),
                defaultRepeatX: FLOOR_VISUAL_TEXTURE_WORLD_SCALE,
                defaultRepeatY: FLOOR_VISUAL_TEXTURE_WORLD_SCALE
            };
            const defaults = doc && typeof doc.defaults === "object" && doc.defaults ? doc.defaults : {};
            const defaultRepeat = Number.isFinite(defaults.repeatsPerMapUnit)
                ? Math.max(0.0001, Number(defaults.repeatsPerMapUnit))
                : null;
            cfg.defaultRepeatX = Number.isFinite(defaults.repeatsPerMapUnitX)
                ? Math.max(0.0001, Number(defaults.repeatsPerMapUnitX))
                : (defaultRepeat || FLOOR_VISUAL_TEXTURE_WORLD_SCALE);
            cfg.defaultRepeatY = Number.isFinite(defaults.repeatsPerMapUnitY)
                ? Math.max(0.0001, Number(defaults.repeatsPerMapUnitY))
                : (defaultRepeat || FLOOR_VISUAL_TEXTURE_WORLD_SCALE);
            const items = doc && Array.isArray(doc.items) ? doc.items : [];
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                if (!item || typeof item !== "object") continue;
                const texturePath = this.normalizeFloorVisualTextureConfigPath(item.texturePath);
                const fallbackRepeat = Number.isFinite(item.repeatsPerMapUnit)
                    ? Math.max(0.0001, Number(item.repeatsPerMapUnit))
                    : null;
                const repeatsPerMapUnitX = Number.isFinite(item.repeatsPerMapUnitX)
                    ? Math.max(0.0001, Number(item.repeatsPerMapUnitX))
                    : (fallbackRepeat || cfg.defaultRepeatX);
                const repeatsPerMapUnitY = Number.isFinite(item.repeatsPerMapUnitY)
                    ? Math.max(0.0001, Number(item.repeatsPerMapUnitY))
                    : (fallbackRepeat || cfg.defaultRepeatY);
                const normalizedEntry = { texturePath, repeatsPerMapUnitX, repeatsPerMapUnitY };
                if (texturePath) cfg.byPath.set(texturePath, normalizedEntry);
                const file = typeof item.file === "string" && item.file.length > 0
                    ? item.file.toLowerCase()
                    : "";
                if (file) cfg.byFile.set(file, normalizedEntry);
                const textureFile = texturePath ? (texturePath.split("/").pop() || "").toLowerCase() : "";
                if (textureFile) cfg.byFile.set(textureFile, normalizedEntry);
                const lodTextures = Array.isArray(item.lodTextures) ? item.lodTextures : [];
                for (let j = 0; j < lodTextures.length; j++) {
                    const lodPath = this.normalizeFloorVisualTextureConfigPath(lodTextures[j] && lodTextures[j].texturePath);
                    if (!lodPath) continue;
                    cfg.byPath.set(lodPath, normalizedEntry);
                    const lodFile = (lodPath.split("/").pop() || "").toLowerCase();
                    if (lodFile) cfg.byFile.set(lodFile, normalizedEntry);
                }
            }
            return cfg;
        }

        ensureFloorVisualTextureConfigLoaded() {
            if (this.floorVisualTextureConfigCache) return Promise.resolve(this.floorVisualTextureConfigCache);
            if (this.floorVisualTextureConfigPromise) return this.floorVisualTextureConfigPromise;
            if (typeof fetch !== "function") {
                this.floorVisualTextureConfigCache = this.buildFloorVisualTextureConfigMaps(null);
                return Promise.resolve(this.floorVisualTextureConfigCache);
            }
            const applyAndReturn = (doc) => {
                this.floorVisualTextureConfigCache = this.buildFloorVisualTextureConfigMaps(doc);
                return this.floorVisualTextureConfigCache;
            };
            this.floorVisualTextureConfigPromise = fetch(FLOORING_TEXTURE_CONFIG_URL, { cache: "no-cache" })
                .then(resp => (resp && resp.ok) ? resp.json() : null)
                .then(doc => {
                    const cfg = applyAndReturn(doc);
                    if (typeof presentGameFrame === "function") presentGameFrame();
                    return cfg;
                })
                .catch(() => applyAndReturn(null))
                .finally(() => {
                    this.floorVisualTextureConfigPromise = null;
                });
            return this.floorVisualTextureConfigPromise;
        }

        getFloorVisualTextureConfigEntry(texturePath) {
            const normalized = this.normalizeFloorVisualTextureConfigPath(texturePath);
            const filename = (normalized.split("/").pop() || "").toLowerCase();
            const RoadClass = (typeof Road !== "undefined" && Road)
                ? Road
                : ((global && global.Road) ? global.Road : null);
            if (RoadClass && typeof RoadClass._getFlooringTextureConfigEntry === "function") {
                const entry = RoadClass._getFlooringTextureConfigEntry(normalized);
                if (entry) return entry;
            } else if (!this.floorVisualTextureConfigCache) {
                void this.ensureFloorVisualTextureConfigLoaded();
            }
            const cache = this.floorVisualTextureConfigCache || null;
            const byPath = cache && cache.byPath ? cache.byPath : null;
            const byFile = cache && cache.byFile ? cache.byFile : null;
            return (byPath && byPath.get(normalized)) || (byFile && byFile.get(filename)) || null;
        }

        getFloorVisualTextureRepeat(texturePath) {
            const cache = this.floorVisualTextureConfigCache || null;
            const entry = this.getFloorVisualTextureConfigEntry(texturePath);
            return {
                x: entry && Number.isFinite(entry.repeatsPerMapUnitX)
                    ? Math.max(0.0001, Number(entry.repeatsPerMapUnitX))
                    : (cache && Number.isFinite(cache.defaultRepeatX) ? cache.defaultRepeatX : FLOOR_VISUAL_TEXTURE_WORLD_SCALE),
                y: entry && Number.isFinite(entry.repeatsPerMapUnitY)
                    ? Math.max(0.0001, Number(entry.repeatsPerMapUnitY))
                    : (cache && Number.isFinite(cache.defaultRepeatY) ? cache.defaultRepeatY : FLOOR_VISUAL_TEXTURE_WORLD_SCALE)
            };
        }

        getFloorVisualTextureRepeatSignature(textureRepeat) {
            if (!textureRepeat) return "";
            const x = Number.isFinite(textureRepeat.x) ? Number(textureRepeat.x) : FLOOR_VISUAL_TEXTURE_WORLD_SCALE;
            const y = Number.isFinite(textureRepeat.y) ? Number(textureRepeat.y) : FLOOR_VISUAL_TEXTURE_WORLD_SCALE;
            return `${x.toFixed(6)}:${y.toFixed(6)}`;
        }

        getFloorVisualDepthState() {
            if (this.floorVisualDepthState) return this.floorVisualDepthState;
            if (typeof PIXI === "undefined" || !PIXI.State) return null;
            const state = new PIXI.State();
            state.depthTest = true;
            state.depthMask = true;
            state.blend = true;
            state.culling = false;
            this.floorVisualDepthState = state;
            return state;
        }

        createFloorVisualMesh(entry) {
            if (!entry || !entry.triangulation || typeof PIXI === "undefined" || !PIXI.Geometry || !PIXI.Mesh || !PIXI.Shader) {
                return null;
            }
            const vertexData = new Float32Array(entry.triangulation.vertexCount * 2);
            const uvData = new Float32Array(entry.triangulation.vertexCount * 2);
            const geometry = new PIXI.Geometry()
                .addAttribute("aVertexPosition", vertexData, 2)
                .addAttribute("aUvs", uvData, 2)
                .addIndex(entry.triangulation.indices);
            const nearMetric = FLOOR_VISUAL_DEPTH_NEAR_METRIC;
            const farMetric = FLOOR_VISUAL_DEPTH_FAR_METRIC;
            const shader = PIXI.Shader.from(FLOOR_VISUAL_DEPTH_VS, FLOOR_VISUAL_DEPTH_FS, {
                uScreenSize: new Float32Array([1, 1]),
                uCameraWorld: new Float32Array([0, 0]),
                uCameraZ: 0,
                uBaseZ: 0,
                uDepthBias: Number.isFinite(entry.depthBias) ? Number(entry.depthBias) : FLOOR_VISUAL_DEPTH_BIAS_UNITS,
                uViewScale: 1,
                uXyRatio: 1,
                uDepthRange: new Float32Array([farMetric, 1 / Math.max(1e-6, farMetric - nearMetric)]),
                uTint: new Float32Array([1, 1, 1, 1]),
                uAlphaCutoff: 0.001,
                uSampler: this.getFloorVisualTexture(entry)
            });
            const mesh = new PIXI.Mesh(geometry, shader);
            mesh.name = entry.isHoleOverlay ? "floorHoleVisualMesh" : "floorSurfaceVisualMesh";
            mesh.interactive = false;
            mesh.alpha = entry.alpha;
            mesh.tint = entry.tint;
            const state = this.getFloorVisualDepthState();
            if (state) mesh.state = state;
            return mesh;
        }

        getFloorVisualTextureBoundsSignature(bounds) {
            if (!bounds) return "";
            return [
                Number(bounds.minX) || 0,
                Number(bounds.minY) || 0,
                Number(bounds.width) || 0,
                Number(bounds.height) || 0
            ].map(value => Math.round(value * 1000)).join(",");
        }

        uploadFloorVisualMeshGeometry(entry) {
            if (!entry || !entry.mesh || !entry.triangulation) return false;
            const geometry = entry.mesh.geometry || null;
            const buffer = geometry && typeof geometry.getBuffer === "function"
                ? geometry.getBuffer("aVertexPosition")
                : null;
            if (!buffer || !buffer.data) return false;
            const data = buffer.data;
            const points = entry.triangulation.points;
            if (!Array.isArray(points) || data.length < points.length * 2) return false;
            const uvBuffer = geometry && typeof geometry.getBuffer === "function"
                ? geometry.getBuffer("aUvs")
                : null;
            const uvData = uvBuffer && uvBuffer.data ? uvBuffer.data : null;
            for (let i = 0; i < points.length; i++) {
                const pt = points[i];
                data[i * 2] = pt.x;
                data[i * 2 + 1] = pt.y;
                if (uvData && uvData.length >= (i * 2 + 2)) {
                    if (entry.textureBounds) {
                        uvData[i * 2] = (pt.x - entry.textureBounds.minX) / entry.textureBounds.width;
                        uvData[i * 2 + 1] = (pt.y - entry.textureBounds.minY) / entry.textureBounds.height;
                    } else {
                        const repeat = entry.textureRepeat || this.getFloorVisualTextureRepeat(entry.texturePath);
                        const repeatX = repeat && Number.isFinite(repeat.x) ? Number(repeat.x) : FLOOR_VISUAL_TEXTURE_WORLD_SCALE;
                        const repeatY = repeat && Number.isFinite(repeat.y) ? Number(repeat.y) : FLOOR_VISUAL_TEXTURE_WORLD_SCALE;
                        uvData[i * 2] = pt.x * repeatX;
                        uvData[i * 2 + 1] = pt.y * repeatY;
                    }
                }
            }
            buffer.update();
            if (uvBuffer) uvBuffer.update();
            entry.uploadedGeometrySignature = entry.signature || "";
            entry.uploadedTextureBoundsSignature = this.getFloorVisualTextureBoundsSignature(entry.textureBounds);
            entry.uploadedTextureRepeatSignature = this.getFloorVisualTextureRepeatSignature(entry.textureRepeat);
            return true;
        }

        updateFloorVisualMesh(entry) {
            if (!entry || !entry.mesh) return false;
            const texture = this.getFloorVisualTexture(entry);
            const shader = entry.mesh.shader || null;
            const uniforms = shader && shader.uniforms ? shader.uniforms : null;
            if (uniforms) {
                uniforms.uSampler = texture;
                const appRef = (typeof app !== "undefined" && app) ? app : (global.app || null);
                const screenW = (appRef && appRef.screen && Number.isFinite(appRef.screen.width))
                    ? Number(appRef.screen.width)
                    : 1;
                const screenH = (appRef && appRef.screen && Number.isFinite(appRef.screen.height))
                    ? Number(appRef.screen.height)
                    : 1;
                const cam = this.camera || {};
                if (uniforms.uScreenSize) {
                    uniforms.uScreenSize[0] = Math.max(1, screenW);
                    uniforms.uScreenSize[1] = Math.max(1, screenH);
                }
                if (uniforms.uCameraWorld) {
                    uniforms.uCameraWorld[0] = Number(cam.x) || 0;
                    uniforms.uCameraWorld[1] = Number(cam.y) || 0;
                }
                uniforms.uCameraZ = Number(cam.z) || 0;
                uniforms.uBaseZ = Number.isFinite(entry.baseZ) ? Number(entry.baseZ) : 0;
                uniforms.uDepthBias = Number.isFinite(entry.depthBias) ? Number(entry.depthBias) : FLOOR_VISUAL_DEPTH_BIAS_UNITS;
                uniforms.uViewScale = Number(cam.viewscale) || 1;
                uniforms.uXyRatio = Number(cam.xyratio) || 1;
                if (uniforms.uDepthRange) {
                    const nearMetric = FLOOR_VISUAL_DEPTH_NEAR_METRIC;
                    const farMetric = FLOOR_VISUAL_DEPTH_FAR_METRIC;
                    uniforms.uDepthRange[0] = farMetric;
                    uniforms.uDepthRange[1] = 1 / Math.max(1e-6, farMetric - nearMetric);
                }
                if (uniforms.uTint) {
                    const tint = Number.isFinite(entry.tint) ? Math.max(0, Math.min(0xffffff, Math.floor(entry.tint))) : 0xffffff;
                    uniforms.uTint[0] = ((tint >> 16) & 0xff) / 255;
                    uniforms.uTint[1] = ((tint >> 8) & 0xff) / 255;
                    uniforms.uTint[2] = (tint & 0xff) / 255;
                    uniforms.uTint[3] = Math.max(0, Math.min(1, Number.isFinite(entry.alpha) ? Number(entry.alpha) : 1));
                }
            }
            entry.mesh.alpha = 1;
            entry.mesh.tint = 0xffffff;
            entry.mesh.position.set(0, 0);
            entry.mesh.scale.set(1, 1);
            entry.mesh.visible = true;
            if (Object.prototype.hasOwnProperty.call(entry.mesh, "renderable")) {
                entry.mesh.renderable = true;
            }
            return true;
        }

        collectFloorVisualEntries(ctx) {
            const map = ctx && ctx.map;
            const selectedLevel = this.getSelectedFloorVisualLevel();
            const isolateLevel = isFloorEditIsolationActive();
            const nowMs = (ctx && Number.isFinite(ctx.renderNowMs)) ? Number(ctx.renderNowMs) : Date.now();
            const wizard = (ctx && ctx.wizard) || global.wizard || null;
            const mazeLayerOnly = !!(
                this.isLosMazeModeEnabled() &&
                !this.isOmnivisionActive(wizard) &&
                wizard
            );
            const wizardLayer = this.getLayerIndexFromValue(
                wizard && Number.isFinite(wizard.currentLayer) ? wizard.currentLayer : 0,
                0
            );
            const cutawayState = this.getLayerCutawayState(ctx);
            const entries = [];
            const metrics = this.currentFrameMetrics || null;
            let scannedFragments = 0;
            let skippedLevelIsolation = 0;
            let skippedUneditedLevel0 = 0;
            let skippedNoSurface = 0;
            let skippedInvalidOuter = 0;
            let level0Entries = 0;
            let nonzeroEntries = 0;
            let level0Sections = new Set();
            if (!map) return entries;
            if (map.floorsById instanceof Map) {
                for (const [fragmentId, fragment] of map.floorsById.entries()) {
                    scannedFragments += 1;
                    if (!fragment) continue;
                    const level = Number.isFinite(fragment.level) ? Math.round(Number(fragment.level)) : 0;
                    if (mazeLayerOnly && level !== wizardLayer) {
                        skippedLevelIsolation += 1;
                        continue;
                    }
                    if (isolateLevel && level !== selectedLevel) {
                        skippedLevelIsolation += 1;
                        continue;
                    }
                    const cutawayAlpha = this.getFloorFragmentCutawayAlpha(fragment, cutawayState);
                    if (!(cutawayAlpha > 0.001)) {
                        skippedLevelIsolation += 1;
                        continue;
                    }
                    const buildingCutawayTrigger = this.getFloorFragmentBuildingCutawayTrigger(fragment, cutawayState);
                    const buildingCutawayCompositeFrame = buildingCutawayTrigger
                        ? (Number(this._layerCutawayFrameId) || 0)
                        : 0;
                    const buildingCutawayCompositeAlpha = buildingCutawayTrigger && Number.isFinite(buildingCutawayTrigger.alpha)
                        ? Math.max(0, Math.min(1, Number(buildingCutawayTrigger.alpha)))
                        : BUILDING_CUTAWAY_GHOST_ALPHA;
                    const floorCutawayAlpha = buildingCutawayTrigger ? 1 : cutawayAlpha;
                    const sectionKey = typeof fragment.ownerSectionKey === "string" ? fragment.ownerSectionKey : "";
                    const state = map._prototypeSectionState || null;
                    const asset = sectionKey && state && state.sectionAssetsByKey instanceof Map
                        ? state.sectionAssetsByKey.get(sectionKey)
                        : null;
                    const outer = normalizeFloorVisualPointList(
                        Array.isArray(fragment.visibilityPolygon) && fragment.visibilityPolygon.length >= 3
                            ? fragment.visibilityPolygon
                            : fragment.outerPolygon
                    );
                    if (outer.length < 3) {
                        skippedInvalidOuter += 1;
                        continue;
                    }
                    const holes = Array.isArray(fragment.visibilityHoles) && fragment.visibilityHoles.length > 0
                        ? fragment.visibilityHoles
                        : (Array.isArray(fragment.holes) ? fragment.holes : []);
                    let level0Surface = null;
                    if (level === 0) {
                        if (!FLOOR_LEVEL0_BAKED_SURFACE_ENABLED) continue;
                        if (!this.hasEditedLevel0FloorAsset(asset)) {
                            skippedUneditedLevel0 += 1;
                            continue;
                        }
                        const baseZ = Number.isFinite(fragment.nodeBaseZ)
                            ? Number(fragment.nodeBaseZ)
                            : this.getLayerBaseZForLevel(level);
                        const fadeMultiplier = this.getLayerFadeMultiplier(level, nowMs) * floorCutawayAlpha;
                        const chunkEntries = this.collectLevel0ChunkFloorVisualEntries(
                            ctx,
                            fragmentId,
                            fragment,
                            asset,
                            outer,
                            holes,
                            baseZ,
                            fadeMultiplier
                        );
                        if (Array.isArray(chunkEntries)) {
                            if (buildingCutawayCompositeFrame > 0) {
                                for (let ce = 0; ce < chunkEntries.length; ce++) {
                                    if (chunkEntries[ce]) {
                                        chunkEntries[ce].buildingCutawayCompositeFrame = buildingCutawayCompositeFrame;
                                        chunkEntries[ce].buildingCutawayCompositeAlpha = buildingCutawayCompositeAlpha;
                                    }
                                }
                            }
                            if (chunkEntries.length === 0) {
                                skippedNoSurface += 1;
                            } else {
                                for (let ce = 0; ce < chunkEntries.length; ce++) entries.push(chunkEntries[ce]);
                                if (sectionKey) level0Sections.add(sectionKey);
                                level0Entries += chunkEntries.length;
                            }
                            continue;
                        }
                        level0Surface = this.getLevel0GroundSurfaceTexture(ctx, sectionKey, asset);
                        if (!level0Surface || !level0Surface.texture || !level0Surface.bounds) {
                            skippedNoSurface += 1;
                            continue;
                        }
                        if (sectionKey) level0Sections.add(sectionKey);
                    }
                    if (level === 0) level0Entries += 1;
                    else nonzeroEntries += 1;
                    const baseZ = Number.isFinite(fragment.nodeBaseZ)
                        ? Number(fragment.nodeBaseZ)
                        : this.getLayerBaseZForLevel(level);
                    const fadeMultiplier = this.getLayerFadeMultiplier(level, nowMs) * floorCutawayAlpha;
                    const paintedTexturePath = (
                        level !== 0 &&
                        typeof fragment.texturePath === "string" &&
                        fragment.texturePath.length > 0
                    ) ? fragment.texturePath : "";
                    const visualTexturePath = paintedTexturePath ||
                        (level !== 0 ? FLOOR_VISUAL_CAVE_TEXTURE_PATH : `level0:${fragment.ownerSectionKey || ""}`);
                    const hasTexturedFill = visualTexturePath.length > 0;
                    const defaultAlpha = level === 0 ? 1 : (isolateLevel && level === selectedLevel ? 0.9 : 0.86);
                    const textureRepeat = visualTexturePath && !visualTexturePath.startsWith("level0:")
                        ? this.getFloorVisualTextureRepeat(visualTexturePath)
                        : null;
                    const renderOuter = level === 0
                        ? expandFloorVisualPolygonFromCentroid(outer, FLOOR_LEVEL0_SEAM_BLEED_UNITS)
                        : outer;
                    entries.push({
                        key: `fragment:${fragmentId}`,
                        level,
                        baseZ,
                        outer: renderOuter,
                        holes,
                        texture: level0Surface ? level0Surface.texture : null,
                        textureBounds: level0Surface ? level0Surface.bounds : null,
                        textureRepeat,
                        texturePath: visualTexturePath,
                        tint: this.getLayerDarkenedTint(
                            hasTexturedFill ? 0xffffff : FLOOR_VISUAL_UPPER_FILL,
                            level
                        ),
                        alpha: ((paintedTexturePath || level !== 0) ? 1 : defaultAlpha) * fadeMultiplier,
                        depthBias: level === 0 ? (FLOOR_VISUAL_DEPTH_BIAS_UNITS - 0.005) : FLOOR_VISUAL_DEPTH_BIAS_UNITS,
                        isHoleOverlay: false
                    });
                    if (buildingCutawayCompositeFrame > 0) {
                        entries[entries.length - 1].buildingCutawayCompositeFrame = buildingCutawayCompositeFrame;
                        entries[entries.length - 1].buildingCutawayCompositeAlpha = buildingCutawayCompositeAlpha;
                    }
                    const normalizedHoles = Array.isArray(holes) ? holes : [];
                    for (let h = 0; h < normalizedHoles.length; h++) {
                        const holeOuter = normalizeFloorVisualPointList(normalizedHoles[h]);
                        if (holeOuter.length < 3) continue;
                        entries.push({
                            key: `fragment:${fragmentId}:hole:${h}`,
                            level,
                            baseZ,
                            outer: holeOuter,
                            holes: [],
                            texture: null,
                            textureBounds: null,
                            textureRepeat: null,
                            texturePath: "",
                            tint: this.getLayerDarkenedTint(FLOOR_VISUAL_HOLE_FILL, level),
                            alpha: fadeMultiplier,
                            depthBias: FLOOR_VISUAL_HOLE_DEPTH_BIAS_UNITS,
                            isHoleOverlay: true
                        });
                        if (buildingCutawayCompositeFrame > 0) {
                            entries[entries.length - 1].buildingCutawayCompositeFrame = buildingCutawayCompositeFrame;
                            entries[entries.length - 1].buildingCutawayCompositeAlpha = buildingCutawayCompositeAlpha;
                        }
                    }
                }
            }
            if (metrics) {
                metrics.floorFragmentsScanned = scannedFragments;
                metrics.floorFragmentsSkippedLevelIsolation = skippedLevelIsolation;
                metrics.floorFragmentsSkippedUneditedLevel0 = skippedUneditedLevel0;
                metrics.floorFragmentsSkippedNoSurface = skippedNoSurface;
                metrics.floorFragmentsSkippedInvalidOuter = skippedInvalidOuter;
                metrics.floorLevel0Entries = level0Entries;
                metrics.floorNonzeroEntries = nonzeroEntries;
                metrics.floorLevel0Sections = level0Sections.size;
                metrics.floorEntriesCollected = entries.length;
            }
            entries.sort((a, b) => {
                const levelA = Number.isFinite(a && a.level) ? Number(a.level) : 0;
                const levelB = Number.isFinite(b && b.level) ? Number(b.level) : 0;
                if (levelA !== levelB) return levelA - levelB;
                return String(a && a.key).localeCompare(String(b && b.key));
            });
            return entries;
        }

        renderFloorVisualPolygons(ctx) {
            const container = this.ensureFloorVisualContainer();
            if (!container) return;
            const diagnosticsEnabled = !!this.currentFrameMetrics;
            const now = () => (
                typeof performance !== "undefined" && performance && typeof performance.now === "function"
                    ? performance.now()
                    : Date.now()
            );
            this.level0GroundSurfaceChunkBuildsThisFrame = 0;
            this.updateFloorVisualContainerTransform(container);
            const collectStartMs = diagnosticsEnabled ? now() : 0;
            const entries = this.collectFloorVisualEntries(ctx);
            const collectMs = diagnosticsEnabled ? (now() - collectStartMs) : 0;
            const visibleKeys = new Set();
            let rendered = 0;
            let meshesCreated = 0;
            let geometryUploads = 0;
            let visibleVertices = 0;
            let visibleTriangles = 0;
            let meshLookupMs = 0;
            let meshCreateMs = 0;
            let meshGeometryMs = 0;
            let meshAssignMs = 0;
            let meshUpdateMs = 0;
            for (let i = 0; i < entries.length; i++) {
                const source = entries[i];
                const lookupStartMs = diagnosticsEnabled ? now() : 0;
                const outer = normalizeFloorVisualPointList(source.outer);
                if (outer.length < 3) continue;
                const signature = buildFloorVisualSignature(outer, source.holes);
                const cacheKey = source.key;
                let entry = this.floorVisualMeshByKey.get(cacheKey);
                if (diagnosticsEnabled) meshLookupMs += (now() - lookupStartMs);
                if (
                    !entry ||
                    entry.signature !== signature ||
                    entry.isHoleOverlay !== source.isHoleOverlay ||
                    entry.texturePath !== (source.texturePath || "")
                ) {
                    const createStartMs = diagnosticsEnabled ? now() : 0;
                    if (entry && entry.mesh) {
                        if (entry.mesh.parent) entry.mesh.parent.removeChild(entry.mesh);
                        if (typeof entry.mesh.destroy === "function") {
                            entry.mesh.destroy({ children: false, texture: false, baseTexture: false });
                        }
                    }
                    const triangulation = triangulateFloorVisualPolygon(outer, source.holes);
                    if (!triangulation) continue;
                    entry = {
                        signature,
                        triangulation,
                        mesh: null,
                        tint: source.tint,
                        alpha: source.alpha,
                        baseZ: Number.isFinite(source.baseZ) ? Number(source.baseZ) : this.getLayerBaseZForLevel(source.level),
                        texture: source.texture || null,
                        textureBounds: source.textureBounds || null,
                        textureRepeat: source.textureRepeat || null,
                        texturePath: source.texturePath || "",
                        depthBias: Number.isFinite(source.depthBias) ? Number(source.depthBias) : FLOOR_VISUAL_DEPTH_BIAS_UNITS,
                        isHoleOverlay: source.isHoleOverlay,
                        zIndex: 0,
                        uploadedGeometrySignature: "",
                        uploadedTextureBoundsSignature: "",
                        uploadedTextureRepeatSignature: ""
                    };
                    entry.mesh = this.createFloorVisualMesh(entry);
                    if (!entry.mesh) continue;
                    if (diagnosticsEnabled) meshCreateMs += (now() - createStartMs);
                    const uploadStartMs = diagnosticsEnabled ? now() : 0;
                    this.uploadFloorVisualMeshGeometry(entry);
                    if (diagnosticsEnabled) meshGeometryMs += (now() - uploadStartMs);
                    geometryUploads += 1;
                    container.addChild(entry.mesh);
                    this.floorVisualMeshByKey.set(cacheKey, entry);
                    meshesCreated += 1;
                } else if (diagnosticsEnabled) {
                    meshCreateMs += 0;
                }
                const assignStartMs = diagnosticsEnabled ? now() : 0;
                entry.tint = source.tint;
                entry.alpha = source.alpha;
                entry.baseZ = Number.isFinite(source.baseZ) ? Number(source.baseZ) : this.getLayerBaseZForLevel(source.level);
                entry.isHoleOverlay = source.isHoleOverlay;
                entry.texture = source.texture || null;
                entry.textureBounds = source.textureBounds || null;
                entry.textureRepeat = source.textureRepeat || null;
                entry.texturePath = source.texturePath || "";
                entry.depthBias = Number.isFinite(source.depthBias) ? Number(source.depthBias) : FLOOR_VISUAL_DEPTH_BIAS_UNITS;
                entry.buildingCutawayCompositeFrame = Number(source.buildingCutawayCompositeFrame) || 0;
                entry.buildingCutawayCompositeAlpha = Number.isFinite(source.buildingCutawayCompositeAlpha)
                    ? Math.max(0, Math.min(1, Number(source.buildingCutawayCompositeAlpha)))
                    : 1;
                entry.zIndex = (Number.isFinite(source.level) ? Number(source.level) : 0) * 100000 + i;
                if (entry.mesh && entry.mesh.parent !== container) {
                    container.addChild(entry.mesh);
                }
                if (entry.mesh) {
                    entry.mesh._buildingCutawayCompositeFrame = entry.buildingCutawayCompositeFrame;
                    entry.mesh._buildingCutawayCompositeAlpha = entry.buildingCutawayCompositeAlpha;
                }
                if (entry.mesh && entry.mesh.zIndex !== entry.zIndex) {
                    entry.mesh.zIndex = entry.zIndex;
                }
                if (entry.mesh) entry.mesh.y = 0;
                if (
                    entry.uploadedGeometrySignature !== signature ||
                    entry.uploadedTextureBoundsSignature !== this.getFloorVisualTextureBoundsSignature(entry.textureBounds) ||
                    entry.uploadedTextureRepeatSignature !== this.getFloorVisualTextureRepeatSignature(entry.textureRepeat)
                ) {
                    const uploadStartMs = diagnosticsEnabled ? now() : 0;
                    this.uploadFloorVisualMeshGeometry(entry);
                    if (diagnosticsEnabled) meshGeometryMs += (now() - uploadStartMs);
                    geometryUploads += 1;
                }
                if (diagnosticsEnabled) meshAssignMs += (now() - assignStartMs);
                const updateStartMs = diagnosticsEnabled ? now() : 0;
                if (this.updateFloorVisualMesh(entry)) {
                    if (diagnosticsEnabled) meshUpdateMs += (now() - updateStartMs);
                    visibleKeys.add(cacheKey);
                    rendered += 1;
                    if (entry.triangulation) {
                        visibleVertices += Number(entry.triangulation.vertexCount) || 0;
                        visibleTriangles += entry.triangulation.indices ? Math.floor(entry.triangulation.indices.length / 3) : 0;
                    }
                } else if (diagnosticsEnabled) {
                    meshUpdateMs += (now() - updateStartMs);
                }
            }
            const hideStartMs = diagnosticsEnabled ? now() : 0;
            let cachedMeshes = 0;
            for (const [key, entry] of this.floorVisualMeshByKey.entries()) {
                cachedMeshes += 1;
                if (visibleKeys.has(key)) continue;
                if (entry && entry.mesh) entry.mesh.visible = false;
            }
            const hideMs = diagnosticsEnabled ? (now() - hideStartMs) : 0;
            const trimStartMs = diagnosticsEnabled ? now() : 0;
            this.floorVisualVisibleKeys = visibleKeys;
            const trimmedLevel0Chunks = this.trimLevel0GroundSurfaceChunkCache(
                Math.max(FLOOR_LEVEL0_CHUNK_CACHE_LIMIT, visibleKeys.size)
            );
            const trimmedChunkClips = this.trimFloorVisualChunkClipCache(
                Math.max(FLOOR_LEVEL0_CHUNK_CACHE_LIMIT * 4, visibleKeys.size * 2)
            );
            const trimMs = diagnosticsEnabled ? (now() - trimStartMs) : 0;
            this.setFrameMetric("floorVisualPolygons", rendered);
            this.setFrameMetric("floorVisualMeshesCreated", meshesCreated);
            this.setFrameMetric("floorVisualGeometryUploads", geometryUploads);
            this.setFrameMetric("floorVisualCollectMs", collectMs);
            this.setFrameMetric("floorVisualMeshLookupMs", meshLookupMs);
            this.setFrameMetric("floorVisualMeshCreateMs", meshCreateMs);
            this.setFrameMetric("floorVisualGeometryMs", meshGeometryMs);
            this.setFrameMetric("floorVisualMeshAssignMs", meshAssignMs);
            this.setFrameMetric("floorVisualMeshUpdateMs", meshUpdateMs);
            this.setFrameMetric("floorVisualHideMs", hideMs);
            this.setFrameMetric("floorVisualTrimMs", trimMs);
            this.setFrameMetric("floorVisualVertices", visibleVertices);
            this.setFrameMetric("floorVisualTriangles", visibleTriangles);
            this.setFrameMetric("floorVisualMeshCacheSize", cachedMeshes);
            this.setFrameMetric(
                "floorVisualChunkClipCacheSize",
                this.floorVisualChunkClipCache instanceof Map ? this.floorVisualChunkClipCache.size : 0
            );
            this.setFrameMetric("floorVisualChunkClipsTrimmed", trimmedChunkClips);
            this.setFrameMetric(
                "floorLevel0ChunkCacheSize",
                this.level0GroundSurfaceChunkCache instanceof Map ? this.level0GroundSurfaceChunkCache.size : 0
            );
            this.setFrameMetric("floorLevel0ChunksTrimmed", trimmedLevel0Chunks);
        }

        renderRoadsAndFloors(ctx, visibleNodes) {
            const map = ctx.map;
            const cam = this.camera;
            const container = this.layers.roadsFloor;
            if (!map || !Array.isArray(map.nodes) || !container) return;
            const diagnosticsEnabled = !!this.currentFrameMetrics;
            const functionStartMs = diagnosticsEnabled ? performance.now() : 0;
            const nowMs = (ctx && Number.isFinite(ctx.renderNowMs))
                ? Number(ctx.renderNowMs)
                : ((typeof performance !== "undefined" && performance && typeof performance.now === "function")
                    ? performance.now()
                    : Date.now());
            const wizard = (ctx && ctx.wizard) || global.wizard || null;
            const mazeLayerOnly = !!(
                this.isLosMazeModeEnabled() &&
                !this.isOmnivisionActive(wizard) &&
                wizard
            );
            const wizardLayer = this.getLayerIndexFromValue(
                wizard && Number.isFinite(wizard.currentLayer) ? wizard.currentLayer : 0,
                0
            );
            const cutawayState = this.getLayerCutawayState(ctx);
            const hiddenSpriteGraceMs = 500;
            const maxHiddenSprites = 96;
            let roadSpritesCreated = 0;
            let roadSpritesAttached = 0;
            let roadTextureRefreshes = 0;
            let roadTextureAssignments = 0;
            let roadHiddenSprites = 0;
            let roadDestroyedSprites = 0;
            let roadEvictedSprites = 0;

            const destroyRoadSprite = (road, sprite) => {
                if (isRoadTextureLifecycleDiagnosticsEnabled()) {
                    console.warn("[road render sprite destroy]", {
                        roadId: Number.isInteger(road && road._prototypeRecordId) ? Number(road._prototypeRecordId) : null,
                        roadGone: !!(road && road.gone),
                        roadTextureCacheKey: (road && typeof road._roadTextureCacheKey === "string") ? road._roadTextureCacheKey : "",
                        sprite: summarizePixiDisplayObject(sprite)
                    });
                }
                if (sprite) {
                    if (sprite.destroyed !== true) {
                        syncRoadRenderSpriteTextureRetention(sprite, null);
                    }
                    if (sprite.parent) {
                        sprite.parent.removeChild(sprite);
                    }
                    if (sprite.destroyed !== true && typeof sprite.destroy === "function") {
                        // Pixi's destroy() crashes if _texture is null; restore a safe sentinel first.
                        if (!sprite._texture) { sprite._texture = PIXI.Texture.EMPTY; }
                        sprite.destroy({ children: false, texture: false, baseTexture: false });
                    }
                }
                this.roadSpriteByObject.delete(road);
                roadDestroyedSprites += 1;
            };

            const visibleRoadObjects = new Set();
            const nodes = Array.isArray(visibleNodes) ? visibleNodes : [];
            const bakedLevel0SectionKeys = this.getBakedLevel0SectionKeys(ctx);
            let roadsSkippedForLevel0Bake = 0;
            for (let n = 0; n < nodes.length; n++) {
                const node = nodes[n];
                if (!node || !Array.isArray(node.objects)) continue;
                for (let i = 0; i < node.objects.length; i++) {
                    const obj = node.objects[i];
                    if (!obj || obj.gone || obj.type !== "road") continue;
                    if (!this.isScriptVisible(obj)) continue;
                    const roadLayer = this.getLayerIndexForNode(obj && obj.node ? obj.node : node);
                    if (mazeLayerOnly && roadLayer !== wizardLayer) continue;
                    if (this.isRenderItemHiddenByLayerCutaway(obj, roadLayer, cutawayState, map)) continue;
                    if (this.isRoadBakedIntoLevel0Surface(ctx, obj, bakedLevel0SectionKeys)) {
                        const bakedSprite = this.roadSpriteByObject.get(obj);
                        if (bakedSprite) {
                            bakedSprite.visible = false;
                            if (Object.prototype.hasOwnProperty.call(bakedSprite, "renderable")) {
                                bakedSprite.renderable = false;
                            }
                        }
                        if (obj._renderingDisplayObject === bakedSprite) {
                            obj._renderingDisplayObject = null;
                        }
                        roadsSkippedForLevel0Bake += 1;
                        continue;
                    }
                    visibleRoadObjects.add(obj);
                }
            }

            const roadObjects = Array.from(visibleRoadObjects);
            for (let i = 0; i < roadObjects.length; i++) {
                const road = roadObjects[i];
                let sprite = this.roadSpriteByObject.get(road);
                if (!sprite) {
                    sprite = new PIXI.Sprite(PIXI.Texture.WHITE);
                    sprite.name = "renderingRoad";
                    sprite.anchor.set(0.5, 0.5);
                    this.roadSpriteByObject.set(road, sprite);
                    roadSpritesCreated += 1;
                }
                if (sprite.parent !== container) {
                    container.addChild(sprite);
                    roadSpritesAttached += 1;
                }

                const worldX = Number.isFinite(road.x) ? road.x : (road.node && Number.isFinite(road.node.x) ? road.node.x : 0);
                const worldY = Number.isFinite(road.y) ? road.y : (road.node && Number.isFinite(road.node.y) ? road.node.y : 0);
                const roadLayer = this.getLayerIndexForNode(road && road.node ? road.node : road);
                const roadBaseZ = Number.isFinite(road && road.z)
                    ? Number(road.z)
                    : this.getLayerBaseZForNode(road && road.node ? road.node : road);
                const roadScreenWidth = (Number(road.width) || 1) * cam.viewscale * 1.1547;
                const roadScreenHeight = (Number(road.height) || 1) * cam.viewscale * cam.xyratio;
                if (typeof global.Road !== "undefined" && typeof global.Road.resolveFillTexturePathForSize === "function") {
                    const lodMetric = typeof global.Road.getFillTextureLodMetric === "function"
                        ? global.Road.getFillTextureLodMetric(road.fillTexturePath, roadScreenWidth, roadScreenHeight)
                        : Math.max(roadScreenWidth, roadScreenHeight);
                    const resolvedFillTexturePath = global.Road.resolveFillTexturePathForSize(road.fillTexturePath, lodMetric);
                    if (resolvedFillTexturePath !== road._resolvedRenderFillTexturePath && typeof road.updateTexture === "function") {
                        road.updateTexture(null, resolvedFillTexturePath);
                    }
                }

                const sourceTexture = (
                    road &&
                    road.pixiSprite &&
                    isRenderablePixiTexture(road.pixiSprite.texture)
                ) ? road.pixiSprite.texture : null;
                if (!sourceTexture && typeof road.updateTexture === "function") {
                    road.updateTexture();
                    roadTextureRefreshes += 1;
                }
                const refreshedSourceTexture = (
                    road &&
                    road.pixiSprite &&
                    isRenderablePixiTexture(road.pixiSprite.texture)
                ) ? road.pixiSprite.texture : null;
                if (refreshedSourceTexture && refreshedSourceTexture !== sprite.texture) {
                    sprite.texture = refreshedSourceTexture;
                    syncRoadRenderSpriteTextureRetention(sprite, road);
                    roadTextureAssignments += 1;
                } else if (refreshedSourceTexture) {
                    syncRoadRenderSpriteTextureRetention(sprite, road);
                } else if (!isRenderablePixiTexture(sprite.texture)) {
                    syncRoadRenderSpriteTextureRetention(sprite, null);
                    sprite.texture = PIXI.Texture.WHITE;
                    roadTextureAssignments += 1;
                }

                const p = cam.worldToScreen(worldX, worldY, roadBaseZ);
                sprite.x = p.x;
                sprite.y = p.y;
                if (!isRenderablePixiTexture(sprite.texture)) {
                    syncRoadRenderSpriteTextureRetention(sprite, null);
                    sprite.texture = PIXI.Texture.WHITE;
                }
                sprite.width = roadScreenWidth;
                sprite.height = roadScreenHeight;
                sprite.alpha = (Number.isFinite(road.alpha) ? road.alpha : 1) * this.getLayerFadeMultiplier(roadLayer, nowMs);
                sprite.visible = true;
                if (Object.prototype.hasOwnProperty.call(sprite, "renderable")) {
                    sprite.renderable = true;
                }
                sprite._lastVisibleAtMs = nowMs;
                this.applyScriptBrightness(road, sprite);
                this.applyLayerDarknessToDisplayObject(sprite, this.getLayerDarknessMultiplier(roadLayer));
                road._renderingDisplayObject = sprite;
                this.addPickRenderItem(road, sprite);
            }

            const hiddenEntries = [];
            for (const [road, sprite] of this.roadSpriteByObject.entries()) {
                if (!road || road.gone) {
                    destroyRoadSprite(road, sprite);
                    continue;
                }
                if (!visibleRoadObjects.has(road) && sprite) {
                    const lastVisibleAtMs = Number.isFinite(sprite._lastVisibleAtMs)
                        ? Number(sprite._lastVisibleAtMs)
                        : 0;
                    if (lastVisibleAtMs > 0 && (nowMs - lastVisibleAtMs) > hiddenSpriteGraceMs) {
                        destroyRoadSprite(road, sprite);
                        continue;
                    }
                    if (!isRenderablePixiTexture(sprite.texture)) {
                        syncRoadRenderSpriteTextureRetention(sprite, null);
                        sprite.texture = PIXI.Texture.WHITE;
                    }
                    sprite.visible = false;
                    roadHiddenSprites += 1;
                    hiddenEntries.push({ road, sprite, lastVisibleAtMs });
                }
            }

            if (hiddenEntries.length > maxHiddenSprites) {
                hiddenEntries.sort((a, b) => a.lastVisibleAtMs - b.lastVisibleAtMs);
                const evictCount = hiddenEntries.length - maxHiddenSprites;
                for (let i = 0; i < evictCount; i++) {
                    const entry = hiddenEntries[i];
                    destroyRoadSprite(entry.road, entry.sprite);
                    roadEvictedSprites += 1;
                }
            }

            this.setFrameMetric("roadsVisible", roadObjects.length);
            this.setFrameMetric("roadsCached", this.roadSpriteByObject instanceof Map ? this.roadSpriteByObject.size : 0);
            this.setFrameMetric("roadsCreated", roadSpritesCreated);
            this.setFrameMetric("roadsAttached", roadSpritesAttached);
            this.setFrameMetric("roadsTextureRefreshes", roadTextureRefreshes);
            this.setFrameMetric("roadsTextureAssignments", roadTextureAssignments);
            this.setFrameMetric("roadsHidden", roadHiddenSprites);
            this.setFrameMetric("roadsDestroyed", roadDestroyedSprites);
            this.setFrameMetric("roadsEvicted", roadEvictedSprites);
            this.setFrameMetric("roadsSkippedForLevel0Bake", roadsSkippedForLevel0Bake);
            this.setFrameMetric(
                "roadsMs",
                diagnosticsEnabled ? (performance.now() - functionStartMs) : 0
            );
        }

        renderHexGridOverlay(ctx) {
            const showPickerScreen = getShowPickerScreenFlag();
            const layer = showPickerScreen ? this.layers.ui : this.layers.depthObjects;
            if (!layer) return;
            const appRef = (ctx && ctx.app) || global.app || null;
            if (!appRef || !appRef.renderer) return;
            const wallCtor = global.WallSectionUnit || null;
            const directionalBlockingDebugEnabled = !!(
                wallCtor &&
                wallCtor._showDirectionalBlockingDebug
            );

            if (showPickerScreen) {
                if (!this.hexGridPickerBackdrop) {
                    this.hexGridPickerBackdrop = new PIXI.Sprite(PIXI.Texture.WHITE);
                    this.hexGridPickerBackdrop.name = "renderingHexGridPickerBackdrop";
                    this.hexGridPickerBackdrop.interactive = false;
                    this.hexGridPickerBackdrop.tint = 0x000000;
                    this.hexGridPickerBackdrop.alpha = 1;
                }
                if (this.hexGridPickerBackdrop.parent !== layer) {
                    layer.addChild(this.hexGridPickerBackdrop);
                }
                this.hexGridPickerBackdrop.position.set(0, 0);
                this.hexGridPickerBackdrop.width = Math.max(1, Number(appRef.renderer.width) || Number(window.innerWidth) || 1);
                this.hexGridPickerBackdrop.height = Math.max(1, Number(appRef.renderer.height) || Number(window.innerHeight) || 1);
                this.hexGridPickerBackdrop.visible = true;
                if (layer.getChildIndex(this.hexGridPickerBackdrop) !== 0) {
                    layer.setChildIndex(this.hexGridPickerBackdrop, 0);
                }
            } else if (this.hexGridPickerBackdrop) {
                this.hexGridPickerBackdrop.visible = false;
            }

            const gridEnabled = !!(
                (typeof showHexGrid !== "undefined" && showHexGrid)
            );
            if (!gridEnabled && !directionalBlockingDebugEnabled) {
                if (this.hexGridContainer) this.hexGridContainer.visible = false;
                return;
            }
            const cam = this.camera;

            if (!this.hexGridContainer) {
                this.hexGridContainer = new PIXI.Container();
                this.hexGridContainer.name = "renderingHexGridContainer";
                this.hexGridContainer.interactiveChildren = false;
                this.hexGridContainer.zIndex = Number.MIN_SAFE_INTEGER;
                layer.addChild(this.hexGridContainer);
            } else if (this.hexGridContainer.parent !== layer) {
                layer.addChild(this.hexGridContainer);
            }
            this.hexGridContainer.visible = true;

            if (!this.hexGridDirectionalBlockingGraphics) {
                this.hexGridDirectionalBlockingGraphics = new PIXI.Graphics();
                this.hexGridDirectionalBlockingGraphics.name = "renderingHexGridDirectionalBlockingDebug";
                this.hexGridDirectionalBlockingGraphics.interactive = false;
                this.hexGridContainer.addChild(this.hexGridDirectionalBlockingGraphics);
            } else if (this.hexGridDirectionalBlockingGraphics.parent !== this.hexGridContainer) {
                this.hexGridContainer.addChild(this.hexGridDirectionalBlockingGraphics);
            }

            const vs = cam.viewscale;
            const vsy = cam.viewscale * cam.xyratio;
            if (vs <= 0 || vsy <= 0) return;

            // Hex geometry in screen pixels.
            // Nodes: x = xIndex*0.866, y = yIndex + (xIndex%2===0 ? 0.5 : 0)
            // Even columns are shifted DOWN by 0.5 world units.
            const colStep = 0.866 * vs;       // horizontal distance between adjacent columns
            const vy = vsy;                    // vertical distance between adjacent rows
            const hexPxW = vs / 0.866;         // full hex bounding width
            const halfW = hexPxW / 2;
            const halfH = vy / 2;
            const quarterW = hexPxW / 4;

            // In the texture, hex[col][row] center is at:
            //   tx = col*colStep + cx0
            //   ty = row*vy + cy0 - (col%2===1 ? halfH : 0)
            // cy0=vy ensures odd-col row-0 hexes don't clip above y=0.
            const cx0 = halfW;
            const cy0 = vy;

            const TILE_COLS = 16;  // must be even so parity is preserved when tiling
            const TILE_ROWS = 16;
            // Texture bounding box:
            //   width  = rightmost hex right-edge  = (TILE_COLS-1)*colStep + hexPxW
            //   height = lowest hex bottom-edge    = TILE_ROWS*vy + halfH  (even-col last row)
            const tileTexW = (TILE_COLS - 1) * colStep + hexPxW;
            const tileTexH = TILE_ROWS * vy + halfH;

            // Rebuild texture only when zoom or aspect ratio changes meaningfully.
            let rebuildTexture = !this.hexGridTexture;
            if (!rebuildTexture && Math.abs(vs - this.hexGridLastViewscale) > 1e-3) rebuildTexture = true;
            if (!rebuildTexture && Math.abs(cam.xyratio - this.hexGridLastXyratio) > 1e-3) rebuildTexture = true;

            if (rebuildTexture) {
                const gfx = new PIXI.Graphics();
                gfx.lineStyle(1, 0xffffff, 0.35);
                for (let col = 0; col < TILE_COLS; col++) {
                    const tx = col * colStep + cx0;
                    for (let row = 0; row < TILE_ROWS; row++) {
                        const ty = row * vy + cy0 - (col % 2 === 1 ? halfH : 0);
                        gfx.moveTo(tx - halfW, ty);
                        gfx.lineTo(tx - quarterW, ty - halfH);
                        gfx.lineTo(tx + quarterW, ty - halfH);
                        gfx.lineTo(tx + halfW, ty);
                        gfx.lineTo(tx + quarterW, ty + halfH);
                        gfx.lineTo(tx - quarterW, ty + halfH);
                        gfx.closePath();
                    }
                }
                const pxW = Math.ceil(tileTexW);
                const pxH = Math.ceil(tileTexH);
                const tex = appRef.renderer.generateTexture(gfx, {
                    region: new PIXI.Rectangle(0, 0, pxW, pxH),
                    resolution: 1
                });
                gfx.destroy(true);
                if (this.hexGridTexture && this.hexGridTexture !== tex) {
                    this.hexGridTexture.destroy(true);
                }
                this.hexGridTexture = tex;
                this.hexGridLastViewscale = vs;
                this.hexGridLastXyratio = cam.xyratio;
            }

            // Anchor: even column just offscreen to the top-left.
            // xIndex must be even so the texture parity (even-col first) is always correct.
            const xIndexRaw = Math.floor(cam.x / 0.866) - 1;
            const xIndex = xIndexRaw % 2 === 0 ? xIndexRaw : xIndexRaw - 1;
            const yIndex = Math.floor(cam.y) - 1;
            // Even column: world y = yIndex + 0.5
            const anchorWorldX = xIndex * 0.866;
            const anchorWorldY = yIndex + 0.5;
            const anchorScreen = cam.worldToScreen(anchorWorldX, anchorWorldY);

            // Top-left of first tile sprite in screen space
            const startScreenX = anchorScreen.x - cx0;
            const startScreenY = anchorScreen.y - cy0;

            // Step between successive tile copies (exactly 16 columns / 16 rows)
            const stepX = TILE_COLS * colStep;   // 16 * 0.866 * vs
            const stepY = TILE_ROWS * vy;         // 16 * vy

            const screenW = Math.max(1, appRef.renderer.width || window.innerWidth || 800);
            const screenH = Math.max(1, appRef.renderer.height || window.innerHeight || 600);

            const colsNeeded = Math.ceil((screenW - startScreenX) / stepX) + 1;
            const rowsNeeded = Math.ceil((screenH - startScreenY) / stepY) + 1;

            let idx = 0;
            if (gridEnabled) {
                for (let r = 0; r < rowsNeeded; r++) {
                    for (let c = 0; c < colsNeeded; c++) {
                        let spr = this.hexGridSprites[idx];
                        if (!spr) {
                            spr = new PIXI.Sprite(this.hexGridTexture);
                            spr.name = "renderingHexGridTile";
                            spr.anchor.set(0, 0);
                            spr.interactive = false;
                            this.hexGridContainer.addChild(spr);
                            this.hexGridSprites[idx] = spr;
                        }
                        if (spr.texture !== this.hexGridTexture) spr.texture = this.hexGridTexture;
                        spr.x = startScreenX + c * stepX;
                        spr.y = startScreenY + r * stepY;
                        spr.visible = true;
                        idx++;
                    }
                }
            }
            for (; idx < this.hexGridSprites.length; idx++) {
                if (this.hexGridSprites[idx]) this.hexGridSprites[idx].visible = false;
            }

            const directionalGfx = this.hexGridDirectionalBlockingGraphics;
            if (directionalGfx) {
                directionalGfx.clear();
                directionalGfx.visible = directionalBlockingDebugEnabled;
                if (directionalBlockingDebugEnabled && wallCtor && wallCtor._allSections instanceof Map) {
                    const drawnMarkers = new Map();
                    const worldMarginX = Math.max(2, (Number(ctx && ctx.viewport && ctx.viewport.width) || 20) * 0.15);
                    const worldMarginY = Math.max(2, (Number(ctx && ctx.viewport && ctx.viewport.height) || 20) * 0.15);
                    const minWorldX = Number(cam.x) - worldMarginX;
                    const maxWorldX = Number(cam.x) + Number(ctx && ctx.viewport && ctx.viewport.width || 20) + worldMarginX;
                    const minWorldY = Number(cam.y) - worldMarginY;
                    const maxWorldY = Number(cam.y) + Number(ctx && ctx.viewport && ctx.viewport.height || 20) + worldMarginY;
                    for (const section of wallCtor._allSections.values()) {
                        if (!section || section.gone) continue;
                        const sectionCenter = section.center || null;
                        if (
                            sectionCenter &&
                            Number.isFinite(sectionCenter.x) &&
                            Number.isFinite(sectionCenter.y) &&
                            (
                                Number(sectionCenter.x) < minWorldX ||
                                Number(sectionCenter.x) > maxWorldX ||
                                Number(sectionCenter.y) < minWorldY ||
                                Number(sectionCenter.y) > maxWorldY
                            )
                        ) {
                            continue;
                        }
                        const debugData = section._directionalBlockingDebug;
                        if (!debugData) continue;
                        const blockedLinks = Array.isArray(section.blockedLinks) ? section.blockedLinks : [];

                        for (let i = 0; i < blockedLinks.length; i++) {
                            const link = blockedLinks[i];
                            const sourceNode = link && link.node;
                            const dir = Number(link && link.direction);
                            if (!sourceNode || !Array.isArray(sourceNode.neighbors) || !Number.isInteger(dir)) continue;
                            const destinationNode = sourceNode.neighbors[dir];
                            if (!destinationNode) continue;
                            const incomingDir = ((dir + 6) % 12 + 12) % 12;
                            const markerKey = `${Number(destinationNode.xindex)},${Number(destinationNode.yindex)}|${incomingDir}`;
                            const color = (typeof wallCtor._getDirectionalBlockingDebugColor === "function")
                                ? wallCtor._getDirectionalBlockingDebugColor(link.blocker)
                                : 0xff0000;
                            const existingColor = drawnMarkers.get(markerKey);
                            if (existingColor === 0x3399ff || existingColor === color) continue;
                            drawnMarkers.set(markerKey, {
                                sourceNode,
                                destinationNode,
                                incomingDir,
                                color
                            });
                        }
                    }

                    for (const marker of drawnMarkers.values()) {
                        if (!marker || !marker.sourceNode || !marker.destinationNode) continue;
                        const sourceWorldX = Number(marker.sourceNode.x) || 0;
                        const sourceWorldY = Number(marker.sourceNode.y) || 0;
                        const destinationWorldX = Number(marker.destinationNode.x) || 0;
                        const destinationWorldY = Number(marker.destinationNode.y) || 0;
                        const dxWorld = sourceWorldX - destinationWorldX;
                        const dyWorld = sourceWorldY - destinationWorldY;
                        const worldLen = Math.hypot(dxWorld, dyWorld);
                        if (!(worldLen > 1e-4)) continue;

                        const ux = dxWorld / worldLen;
                        const uy = dyWorld / worldLen;
                        const px = -uy;
                        const py = ux;
                        const incomingDir = Number.isInteger(marker.incomingDir) ? marker.incomingDir : 0;
                        const halfMarkerWorldLength = (incomingDir % 2 === 1) ? 0.28 : 0.22;
                        const markerCenterWorldX = destinationWorldX + ux * worldLen * 0.56;
                        const markerCenterWorldY = destinationWorldY + uy * worldLen * 0.56;
                        const startScreen = cam.worldToScreen(
                            markerCenterWorldX - px * halfMarkerWorldLength,
                            markerCenterWorldY - py * halfMarkerWorldLength,
                            0
                        );
                        const endScreen = cam.worldToScreen(
                            markerCenterWorldX + px * halfMarkerWorldLength,
                            markerCenterWorldY + py * halfMarkerWorldLength,
                            0
                        );

                        directionalGfx.lineStyle(3, marker.color, 0.95);
                        directionalGfx.moveTo(startScreen.x, startScreen.y);
                        directionalGfx.lineTo(endScreen.x, endScreen.y);
                    }
                }
            }

            if (directionalGfx && directionalGfx.parent === this.hexGridContainer) {
                this.hexGridContainer.setChildIndex(directionalGfx, this.hexGridContainer.children.length - 1);
            }

            if (this.hexGridContainer.parent === layer) {
                if (showPickerScreen) {
                    const targetIdx = (this.hexGridPickerBackdrop && this.hexGridPickerBackdrop.parent === layer) ? 1 : 0;
                    if (layer.getChildIndex(this.hexGridContainer) !== targetIdx) {
                        layer.setChildIndex(this.hexGridContainer, targetIdx);
                    }
                } else {
                    let gridIdx = layer.children.length - 1;
                    if (this.floorVisualContainer && this.floorVisualContainer.parent === layer) {
                        gridIdx = Math.min(layer.children.length - 1, layer.getChildIndex(this.floorVisualContainer) + 1);
                    }
                    if (layer.getChildIndex(this.hexGridContainer) !== gridIdx) {
                        layer.setChildIndex(this.hexGridContainer, gridIdx);
                    }
                    if (this.losShadowDepthMesh && this.losShadowDepthMesh.parent === layer) {
                        const shadowIdx = Math.min(layer.children.length - 1, layer.getChildIndex(this.hexGridContainer) + 1);
                        if (layer.getChildIndex(this.losShadowDepthMesh) !== shadowIdx) {
                            layer.setChildIndex(this.losShadowDepthMesh, shadowIdx);
                        }
                    }
                }
            }
        }

        renderObjects3D(ctx, visibleNodes, visibleObjectsOverride = null) {
            const container = this.layers.objects3d;
            if (!container) return;
            this.clearBuildingInteriorForegroundPromotions();
            const diagnosticsEnabled = !!this.currentFrameMetrics;
            const nowIfEnabled = () => diagnosticsEnabled ? performance.now() : 0;
            const showPickerScreen = getShowPickerScreenFlag();
            const wizard = (ctx && ctx.wizard) ? ctx.wizard : null;
            const mapRef = (ctx && ctx.map) ? ctx.map : (this.camera && this.camera.map) || global.map || null;
            const omnivisionActive = this.isOmnivisionActive(wizard);
            const mazeMode = this.isLosMazeModeEnabled() && !omnivisionActive;
            const useMazeLosClipping = mazeMode;
            const renderNowMs = Number.isFinite(ctx && ctx.renderNowMs) ? Number(ctx.renderNowMs) : performance.now();
            const wizardLayer = this.getLayerIndexFromValue(wizard && Number.isFinite(wizard.currentLayer) ? wizard.currentLayer : 0, 0);
            const buildLosSetsStartMs = nowIfEnabled();
            const losVisibleObjectSet = (
                useMazeLosClipping &&
                this.currentLosState &&
                Array.isArray(this.currentLosState.visibleObjects)
            ) ? new Set(this.currentLosState.visibleObjects) : null;
            const visibleWallIdSet = (() => {
                if (!useMazeLosClipping || !losVisibleObjectSet) return null;
                const out = new Set();
                for (const obj of losVisibleObjectSet) {
                    if (!obj || obj.type !== "wallSection" || !Number.isInteger(obj.id)) continue;
                    out.add(Number(obj.id));
                }
                return out;
            })();
            const losVisibleWalls = (() => {
                if (!losVisibleObjectSet) return [];
                const out = [];
                for (const obj of losVisibleObjectSet) {
                    if (!obj || obj.type !== "wallSection") continue;
                    if (this.getLayerIndexForObject(obj, wizardLayer) !== wizardLayer) continue;
                    out.push(obj);
                }
                return out;
            })();
            const buildLosSetsMs = diagnosticsEnabled ? (performance.now() - buildLosSetsStartMs) : 0;
            this.setFrameMetric("objects3dLosBuildMs", buildLosSetsMs);
            this.setFrameMetric("objects3dLosVisibleSetSize", losVisibleObjectSet ? losVisibleObjectSet.size : 0);
            this.setFrameMetric("objects3dLosVisibleWalls", losVisibleWalls.length);
            const sharesVisibleCollinearWallLine = (item) => {
                if (!item || !useMazeLosClipping || !losVisibleObjectSet || losVisibleWalls.length === 0) {
                    return false;
                }
                if (item.type === "wallSection") {
                    if (losVisibleObjectSet.has(item)) return true;
                    for (let i = 0; i < losVisibleWalls.length; i++) {
                        const visibleWall = losVisibleWalls[i];
                        if (!visibleWall || visibleWall === item) continue;
                        const hasMazeGuard = (
                            typeof item.canShareMazeCollinearVisibilityWith === "function" ||
                            typeof visibleWall.canShareMazeCollinearVisibilityWith === "function"
                        );
                        if (
                            typeof item.canShareMazeCollinearVisibilityWith === "function" &&
                            item.canShareMazeCollinearVisibilityWith(visibleWall, wizard)
                        ) {
                            return true;
                        }
                        if (
                            typeof visibleWall.canShareMazeCollinearVisibilityWith === "function" &&
                            visibleWall.canShareMazeCollinearVisibilityWith(item, wizard)
                        ) {
                            return true;
                        }
                        if (hasMazeGuard) continue;
                        if (
                            typeof item._isSameWallLineForVisibility === "function" &&
                            item._isSameWallLineForVisibility(visibleWall)
                        ) {
                            return true;
                        }
                        if (
                            typeof visibleWall._isSameWallLineForVisibility === "function" &&
                            visibleWall._isSameWallLineForVisibility(item)
                        ) {
                            return true;
                        }
                    }
                    return false;
                }
                if (!this.isWallMountedSpatialItem(item)) return false;
                const mountedSection = this.resolveMountedWallSectionForItem(item);
                if (!mountedSection || mountedSection.type !== "wallSection") return false;
                for (let i = 0; i < losVisibleWalls.length; i++) {
                    const visibleWall = losVisibleWalls[i];
                    if (!visibleWall || typeof visibleWall.isEndpointOwnedBySameWall !== "function") continue;
                    const hasMazeGuard = (
                        typeof mountedSection.canShareMazeCollinearVisibilityWith === "function" ||
                        typeof visibleWall.canShareMazeCollinearVisibilityWith === "function"
                    );
                    if (visibleWall === mountedSection) return true;
                    if (
                        typeof mountedSection.canShareMazeCollinearVisibilityWith === "function" &&
                        mountedSection.canShareMazeCollinearVisibilityWith(visibleWall, wizard)
                    ) {
                        return true;
                    }
                    if (
                            typeof visibleWall.canShareMazeCollinearVisibilityWith === "function" &&
                            visibleWall.canShareMazeCollinearVisibilityWith(mountedSection, wizard)
                    ) {
                        return true;
                    }
                    if (hasMazeGuard) continue;
                    if (
                        visibleWall.isEndpointOwnedBySameWall("a", item) ||
                        visibleWall.isEndpointOwnedBySameWall("b", item)
                    ) {
                        return true;
                    }
                }
                return false;
            };
            const isWallDirectlyVisibleByMazeLos = (item) => {
                if (!useMazeLosClipping || !item || item.type !== "wallSection") return false;
                return !!(
                    (losVisibleObjectSet && losVisibleObjectSet.has(item)) ||
                    sharesVisibleCollinearWallLine(item)
                );
            };
            const isWallVisibleByMazeSample = (item) => {
                if (!useMazeLosClipping || !wizard || !item || item.type !== "wallSection") return false;
                if (isWallDirectlyVisibleByMazeLos(item)) return true;
                const samplePos = this.getLosVisibilitySamplePointForItem(item, mapRef, wizard);
                if (!samplePos) return false;
                return !this.isWorldPointInLosShadow(samplePos.x, samplePos.y, wizard, mapRef);
            };
            const animalsList = Array.isArray(ctx && ctx.animals)
                ? ctx.animals
                : (Array.isArray(global.animals) ? global.animals : null);
            const animalSet = Array.isArray(animalsList) ? new Set(animalsList) : null;
            const LOS_ANIMAL_EDGE_SAMPLES = 8;
            const isAnimalHiddenByLos = (item) => {
                if (!animalSet || !animalSet.has(item)) return false;
                if (!useMazeLosClipping && this.isForceVisible(item)) return false;
                return this.isRadialItemHiddenByLos(item, wizard, mapRef);
            };
            const isItemHiddenByMazeLos = (item) => {
                if (!useMazeLosClipping || !wizard || !item) return false;
                if (item.type === "wallSection") {
                    if (item.castsLosShadows === false) return false;
                    return !isWallVisibleByMazeSample(item);
                }
                if (this.isWallMountedSpatialItem(item) && losVisibleObjectSet) {
                    const category = (typeof item.category === "string") ? item.category.trim().toLowerCase() : "";
                    const isDoor = item.type === "door" || category === "doors";
                    if (isDoor) {
                        const mountedSection = this.resolveMountedWallSectionForItem(item);
                        if (mountedSection && mountedSection.type === "wallSection" && !losVisibleObjectSet.has(mountedSection)) {
                            return true;
                        }
                    }
                }
                if (sharesVisibleCollinearWallLine(item)) return false;
                if (losVisibleObjectSet && this.isLosOccluder(item)) {
                    return !losVisibleObjectSet.has(item);
                }
                const samplePos = this.getLosVisibilitySamplePointForItem(item, mapRef, wizard);
                if (!samplePos) return false;
                return this.isWorldPointInLosShadow(samplePos.x, samplePos.y, wizard, mapRef);
            };

            const visibleObjects = Array.isArray(visibleObjectsOverride)
                ? visibleObjectsOverride
                : this.collectVisibleObjects(visibleNodes, ctx);
            let animalLosHiddenCount = 0;
            let itemMazeHiddenCount = 0;
            let wallMazeHiddenCount = 0;
            let itemCutawayHiddenCount = 0;
            const cutawayState = this.prepareLayerCutawayFrame(ctx, mapRef, wizard);
            const buildingCompositeCacheUsable = this.isBuildingCutawayCompositeCacheUsable(ctx, cutawayState);
            const filterStartMs = nowIfEnabled();
            const mapItems = visibleObjects.filter(item => {
                if (!item) return false;
                if (!this.isScriptVisible(item)) return false;
                if (item.type === "road" || item === wizard) return false;
                const mountedWallLayer = this.getMountedWallLayerIndexForItem(item, wizardLayer);
                const itemLayer = Number.isFinite(mountedWallLayer)
                    ? Number(mountedWallLayer)
                    : this.getLayerIndexForObject(item, useMazeLosClipping ? 0 : wizardLayer);
                if (
                    buildingCompositeCacheUsable &&
                    item._cutawayCompositeFrame === this._layerCutawayFrameId &&
                    !this.isBuildingCutawayDoorItem(item)
                ) {
                    return false;
                }
                if (
                    item._cutawayInteriorOverlayFrame === this._layerCutawayFrameId &&
                    !this.isBuildingCutawayDoorItem(item)
                ) {
                    return false;
                }
                if (useMazeLosClipping && itemLayer !== wizardLayer) {
                    itemMazeHiddenCount += 1;
                    if (item.type === "wallSection") {
                        wallMazeHiddenCount += 1;
                    }
                    return false;
                }
                const layerAlpha = this.getLayerFadeMultiplier(itemLayer, renderNowMs);
                const cutawayAlpha = this.getBuildingCutawayAlphaForItem(item);
                const renderAlpha = layerAlpha * cutawayAlpha;
                item._renderLayerIndex = itemLayer;
                item._renderLayerAlpha = renderAlpha;
                item._renderLayerBaseZ = this.isCharacterRenderItem(item)
                    ? 0
                    : this.getLayerBaseZForLevel(itemLayer);
                if (this.isRenderItemHiddenByLayerCutaway(item, itemLayer, cutawayState, mapRef)) {
                    itemCutawayHiddenCount += 1;
                    return false;
                }
                if (!(renderAlpha > 0.001)) {
                    return false;
                }
                if (isAnimalHiddenByLos(item)) {
                    animalLosHiddenCount += 1;
                    return false;
                }
                if (isItemHiddenByMazeLos(item)) {
                    itemMazeHiddenCount += 1;
                    if (item.type === "wallSection") {
                        wallMazeHiddenCount += 1;
                    }
                    return false;
                }
                return true;
            });
            const filterMs = diagnosticsEnabled ? (performance.now() - filterStartMs) : 0;
            const inMazeModeActivationRevealBypassWindow = !!(
                useMazeLosClipping &&
                Number.isFinite(this.mazeModeActivatedAtMs) &&
                (renderNowMs - Number(this.mazeModeActivatedAtMs)) <= MAZE_MODE_ACTIVATION_SKIP_REVEAL_MS
            );
            const skipMazeRevealAnimationForActivation = !!(
                useMazeLosClipping &&
                (
                    this.mazeModeSuppressRevealAnimation ||
                    inMazeModeActivationRevealBypassWindow
                )
            );
            const roofItems = this.getRoofsList(ctx).filter(roofRef =>
                roofRef &&
                !roofRef.gone &&
                this.isScriptVisible(roofRef) &&
                !isItemHiddenByMazeLos(roofRef)
            );
            const filteredRoofItems = [];
            for (let i = 0; i < roofItems.length; i++) {
                const roofRef = roofItems[i];
                const roofLayer = this.getLayerIndexForRoof(roofRef, 0);
                if (useMazeLosClipping && roofLayer !== wizardLayer) continue;
                if (
                    buildingCompositeCacheUsable &&
                    roofRef._cutawayCompositeFrame === this._layerCutawayFrameId &&
                    !this.isBuildingCutawayDoorItem(roofRef)
                ) continue;
                const roofLayerAlpha = this.getLayerFadeMultiplier(roofLayer, renderNowMs);
                const roofCutawayAlpha = this.getBuildingCutawayAlphaForItem(roofRef);
                const roofRenderAlpha = roofLayerAlpha * roofCutawayAlpha;
                roofRef._renderLayerIndex = roofLayer;
                roofRef._renderLayerAlpha = roofRenderAlpha;
                if (this.isRenderItemHiddenByLayerCutaway(roofRef, roofLayer, cutawayState, mapRef)) continue;
                if (roofRenderAlpha > 0.001) {
                    filteredRoofItems.push(roofRef);
                }
            }
            const visibleRoofSet = new Set(filteredRoofItems);
            for (let i = 0; i < roofItems.length; i++) {
                const roofRef = roofItems[i];
                if (visibleRoofSet.has(roofRef)) continue;
                if (roofRef && roofRef.pixiMesh) {
                    roofRef.pixiMesh.visible = false;
                    roofRef.pixiMesh.alpha = 0;
                }
            }
            const renderItems = mapItems.concat(filteredRoofItems);
            this.setFrameMetric("objects3dFilterMs", filterMs);
            this.setFrameMetric("objects3dAnimalLosHidden", animalLosHiddenCount);
            this.setFrameMetric("objects3dCutawayHidden", itemCutawayHiddenCount);
            this.setFrameMetric("objects3dMazeHidden", itemMazeHiddenCount);
            this.setFrameMetric("objects3dMazeHiddenWalls", wallMazeHiddenCount);
            this.setFrameMetric("objects3dMapItems", mapItems.length);
            this.setFrameMetric("objects3dRoofItems", filteredRoofItems.length);
            this.setFrameMetric("objects3dRenderItems", renderItems.length);
            for (let i = 0; i < renderItems.length; i++) {
                this.updateSinkAnimation(renderItems[i], renderNowMs);
            }

            const transformStartMs = nowIfEnabled();
            for (let i = 0; i < renderItems.length; i++) {
                const item = renderItems[i];
                if (!item) continue;
                if (item.type === "roof") {
                    this.updateRoofPreview(item, ctx.wizard || global.wizard || null);
                    continue;
                }
                const isWallMountedSpatial = this.isWallMountedSpatialItem(item);
                if (!isWallMountedSpatial) {
                    if (item.skipTransform && typeof item.draw === "function") {
                        item.draw();
                    } else {
                        this.applySpriteTransform(item);
                    }
                }
            }
            const transformMs = diagnosticsEnabled ? (performance.now() - transformStartMs) : 0;
            this.setFrameMetric("objects3dTransformMs", transformMs);
            const depthStartMs = nowIfEnabled();
            const depthBillboardRenderedItems = this.renderDepthBillboardObjects(ctx, renderItems);
            const depthMs = diagnosticsEnabled ? (performance.now() - depthStartMs) : 0;
            this.setFrameMetric("objects3dDepthMs", depthMs);
            this.setFrameMetric("objects3dDepthRendered", depthBillboardRenderedItems.size);
            const groundStartMs = nowIfEnabled();
            const groundObjectsRenderedItems = this.renderGroundObjects(ctx, renderItems, depthBillboardRenderedItems);
            const groundMs = diagnosticsEnabled ? (performance.now() - groundStartMs) : 0;
            this.setFrameMetric("objects3dGroundMs", groundMs);
            this.setFrameMetric("objects3dGroundRendered", groundObjectsRenderedItems.size);
            const currentDisplayObjects = new Set();
            const buildingMaskStartMs = nowIfEnabled();
            const buildingCutawayGroundMasks = this.renderBuildingCutawayGroundMasks(ctx, cutawayState, container);
            const buildingMaskMs = diagnosticsEnabled ? (performance.now() - buildingMaskStartMs) : 0;
            this.setFrameMetric("objects3dBuildingMaskMs", buildingMaskMs);
            if (Array.isArray(buildingCutawayGroundMasks)) {
                for (let i = 0; i < buildingCutawayGroundMasks.length; i++) {
                    if (buildingCutawayGroundMasks[i]) currentDisplayObjects.add(buildingCutawayGroundMasks[i]);
                }
            }
            const displayStartMs = nowIfEnabled();

            for (let i = 0; i < renderItems.length; i++) {
                const item = renderItems[i];
                if (!item) continue;
                if (depthBillboardRenderedItems.has(item)) continue;
                if (groundObjectsRenderedItems.has(item)) continue;
                if (item.type === "triggerArea") {
                    const triggerOverlayContainer = (!showPickerScreen && this.layers && this.layers.ui)
                        ? this.layers.ui
                        : container;
                    this.renderTriggerAreaOmnivisionOutline(item, triggerOverlayContainer, omnivisionActive, wizard);
                    this.renderTriggerAreaVertexMarkers(item, triggerOverlayContainer, wizard);
                    if (item._triggerOutlineGraphics) {
                        currentDisplayObjects.add(item._triggerOutlineGraphics);
                    }
                    if (item._triggerVertexGraphics) {
                        currentDisplayObjects.add(item._triggerVertexGraphics);
                    }
                    if (item.pixiSprite) {
                        this.applySpriteTransform(item);
                        item.pixiSprite.visible = false;
                        if (Object.prototype.hasOwnProperty.call(item.pixiSprite, "renderable")) {
                            item.pixiSprite.renderable = false;
                        }
                        if (this.shouldShowTriggerAreaPickerPolygon()) {
                            this.addPickRenderItem(item, item.pixiSprite, { forceInclude: true });
                        }
                    }
                    continue;
                }
                let displayObj = (item.type === "roof")
                    ? (item.pixiMesh || null)
                    : (item._flowerBurnFragmentContainer || item.pixiSprite || null);
                const wallCtor = global.WallSectionUnit || null;
                const wallBottomOutlineOnly = !!(
                    item.type === "wallSection" &&
                    wallCtor &&
                    wallCtor._showBottomFaceOnlyDebug
                );
                if (
                    item.type === "wallSection" &&
                    typeof item.getDepthMeshDisplayObject === "function" &&
                    !wallBottomOutlineOnly
                ) {
                    const clipWallToLosVisibleSpan = !!(
                        useMazeLosClipping &&
                        isWallDirectlyVisibleByMazeLos(item)
                    );
                    const depthDisplay = item.getDepthMeshDisplayObject({
                        camera: this.camera,
                        app: ctx.app,
                        viewscale: this.camera.viewscale,
                        xyratio: this.camera.xyratio,
                        worldToScreenFn: (pt) => this.camera.worldToScreen(Number(pt && pt.x) || 0, Number(pt && pt.y) || 0, 0),
                        // Use regular wall geometry; LOS visibility still filters which walls render.
                        mazeMode: false,
                        topFaceOnly: false,
                        bottomFaceOnly: !!(item.type === "wallSection" && wallCtor && wallCtor._showBottomFaceOnlyDebug),
                        clipToLosVisibleSpan: clipWallToLosVisibleSpan,
                        skipMazeRevealAnimation: !!(
                            this.mazeModeJustActivatedFrame ||
                            skipMazeRevealAnimationForActivation
                        ),
                        visibleWallIdSet,
                        nowMs: renderNowMs,
                        player: wizard,
                        tint: item.pixiSprite && Number.isFinite(item.pixiSprite.tint)
                            ? item.pixiSprite.tint
                            : 0xFFFFFF,
                        alpha: item.pixiSprite && Number.isFinite(item.pixiSprite.alpha)
                            ? item.pixiSprite.alpha
                            : 1,
                        brightness: Number.isFinite(item.brightness)
                            ? Number(item.brightness)
                            : 0
                    });
                    if (depthDisplay) {
                        displayObj = depthDisplay;
                    } else if (useMazeLosClipping) {
                        displayObj = null;
                    }
                }
                if (wallBottomOutlineOnly && item._depthDisplayMesh) {
                    if (item._depthDisplayMesh.parent) {
                        item._depthDisplayMesh.parent.removeChild(item._depthDisplayMesh);
                    }
                    item._depthDisplayMesh.visible = false;
                }
                if (!displayObj) continue;
                const isRoofItem = item.type === "roof";
                if (isRoofItem && !displayObj.visible) {
                    if (Object.prototype.hasOwnProperty.call(displayObj, "renderable")) {
                        displayObj.renderable = false;
                    }
                    item._renderingDisplayObject = displayObj;
                    continue;
                }
                if (displayObj.parent !== container) {
                    container.addChild(displayObj);
                }
                if (!isRoofItem) {
                    displayObj.visible = true;
                }
                item._renderingDisplayObject = displayObj;
                if (Object.prototype.hasOwnProperty.call(displayObj, "renderable")) {
                    displayObj.renderable = true;
                }
                this.applyScriptBrightness(item, displayObj);
                this.applyFrozenTint(item, displayObj);
                this.applyLayerDarknessForItem(item, item._renderLayerIndex, displayObj);
                const displayVisibleAfterSinkClip = this.applySinkClip(item, displayObj);
                if (displayVisibleAfterSinkClip) {
                    currentDisplayObjects.add(displayObj);
                }
                if (
                    item.type === "roof" &&
                    typeof PIXI !== "undefined" &&
                    displayObj instanceof PIXI.Container
                ) {
                    const roofChildren = Array.isArray(displayObj.children) ? displayObj.children : [];
                    for (let c = 0; c < roofChildren.length; c++) {
                        const child = roofChildren[c];
                        if (!child) continue;
                        if (!(child instanceof PIXI.Mesh) && !(child instanceof PIXI.Sprite)) continue;
                        if (displayVisibleAfterSinkClip) {
                            this.addPickRenderItem(item, child);
                        }
                    }
                } else if (displayVisibleAfterSinkClip) {
                    this.addPickRenderItem(item, displayObj);
                }
            }

            const buildingCompositeStartMs = nowIfEnabled();
            const buildingCutawayComposite = this.renderBuildingCutawayComposites(
                ctx,
                cutawayState,
                container,
                buildingCutawayGroundMasks
            );
            const buildingCompositeMs = diagnosticsEnabled ? (performance.now() - buildingCompositeStartMs) : 0;
            this.setFrameMetric("objects3dBuildingCompositeMs", buildingCompositeMs);
            if (buildingCutawayComposite) currentDisplayObjects.add(buildingCutawayComposite);
            this.renderActiveBuildingInteriorOverlay(ctx, cutawayState, container, renderItems);

            // Ensure wall-mounted depth billboards (windows/doors) win picker hits over wall sections.
            // Their visible pixels should be targetable even when coplanar with section meshes.
            for (let i = 0; i < renderItems.length; i++) {
                const item = renderItems[i];
                if (!item || !depthBillboardRenderedItems.has(item)) continue;
                const isWallMountedSpatial = this.isWallMountedSpatialItem(item);
                if (!isWallMountedSpatial) continue;
                const mesh = item._renderingDepthMesh;
                if (!mesh || !mesh.parent || !mesh.visible) continue;
                this.addPickRenderItem(item, mesh, { forceInclude: true });
            }

            for (const obj of this.activeObjectDisplayObjects) {
                if (!currentDisplayObjects.has(obj) && obj) {
                    obj.visible = false;
                }
            }
            this.activeObjectDisplayObjects = currentDisplayObjects;

            const visibleAnimalItems = new Set();
            for (let i = 0; i < renderItems.length; i++) {
                const item = renderItems[i];
                if (!item) continue;
                if (!(typeof Animal !== "undefined" && item instanceof Animal)) continue;
                visibleAnimalItems.add(item);
                if (typeof item.updateHealthBarOverlay === "function") {
                    item.updateHealthBarOverlay(this.camera, this.layers.entities || this.getCharacterLayer());
                }
            }
            for (const animal of this.activeAnimalHealthBarItems) {
                if (visibleAnimalItems.has(animal)) continue;
                if (animal && typeof animal.hideHealthBarOverlay === "function") {
                    animal.hideHealthBarOverlay();
                }
            }
            this.activeAnimalHealthBarItems = visibleAnimalItems;

            const visibleTreeItems = new Set();
            for (let i = 0; i < renderItems.length; i++) {
                const item = renderItems[i];
                if (!item || item.type !== "tree") continue;
                if (typeof item.updateHealthBarOverlay !== "function") continue;
                visibleTreeItems.add(item);
                item.updateHealthBarOverlay(this.camera, this.layers.entities || this.getCharacterLayer());
            }
            for (const tree of this.activeTreeHealthBarItems) {
                if (visibleTreeItems.has(tree)) continue;
                if (tree && typeof tree.hideHealthBarOverlay === "function") {
                    tree.hideHealthBarOverlay();
                }
            }
            this.activeTreeHealthBarItems = visibleTreeItems;

            const displayMs = diagnosticsEnabled ? (performance.now() - displayStartMs) : 0;
            this.setFrameMetric("objects3dDisplayMs", displayMs);
            this.setFrameMetric("objects3dDisplayObjects", currentDisplayObjects.size);
            this.setFrameMetric("objects3dVisibleAnimals", visibleAnimalItems.size);
            this.setFrameMetric("objects3dVisibleTrees", visibleTreeItems.size);
        }

        renderWizard(ctx) {
            const depthContainer = this.getCharacterLayer();
            const overlayContainer = (this.layers && (this.layers.entities || this.layers.characters || this.layers.depthObjects)) || null;
            const wizard = ctx.wizard;
            if (!wizard || !Number.isFinite(wizard.x) || !Number.isFinite(wizard.y)) return;
            if (!depthContainer || !overlayContainer) return;

            const createWizardSprite = (texture) => {
                const sprite = new PIXI.Sprite(texture || PIXI.Texture.WHITE);
                sprite.name = "renderingWizard";
                sprite.anchor.set(0.5, 0.75);
                return sprite;
            };
            const ensureWizardSprite = (forceRecreate = false) => {
                const current = this.wizardSprite;
                const transform = current && current.transform ? current.transform : null;
                const anchor = current && current._anchor ? current._anchor : null;
                const usable = !!(
                    current &&
                    current.destroyed !== true &&
                    transform &&
                    transform.scale &&
                    anchor
                );
                if (!forceRecreate && usable) {
                    return current;
                }
                if (current && current.parent) {
                    current.parent.removeChild(current);
                }
                if (current && typeof current.destroy === "function") {
                    try {
                        current.destroy({ children: false, texture: false, baseTexture: false });
                    } catch (_destroyErr) {
                        // Ignore stale Pixi teardown failures and rebuild the sprite.
                    }
                }
                const initialTexture = (Array.isArray(ctx.wizardFrames) && ctx.wizardFrames[0])
                    ? ctx.wizardFrames[0]
                    : PIXI.Texture.WHITE;
                this.wizardSprite = createWizardSprite(initialTexture);
                return this.wizardSprite;
            };

            let wizardSprite = ensureWizardSprite();
            wizard.pixiSprite = wizardSprite;
            if (wizardSprite.parent) {
                wizardSprite.parent.removeChild(wizardSprite);
            }

            const visualSpeed = Math.hypot(
                Number(wizard?.movementVector?.x) || 0,
                Number(wizard?.movementVector?.y) || 0
            );
            const isVisuallyMoving = !!wizard.moving || visualSpeed > 0.02;
            const rowIndex = Number.isInteger(wizard.lastDirectionRow)
                ? ((wizard.lastDirectionRow % 12) + 12) % 12
                : 0;

            let frameIndex = rowIndex * 9;
            if (wizard.isJumping) {
                frameIndex = rowIndex * 9 + 2;
            } else if (isVisuallyMoving) {
                const speedRatio = (wizard.speed > 0)
                    ? (visualSpeed / wizard.speed)
                    : 0;
                const nowMs = Number.isFinite(ctx.renderNowMs) ? ctx.renderNowMs : performance.now();
                const simFrameRate = Number.isFinite(ctx.frameRate) ? ctx.frameRate : 60;
                const animSpeed = Number.isFinite(wizard.animationSpeedMultiplier)
                    ? wizard.animationSpeedMultiplier
                    : 1;
                const simTicks = (nowMs / 1000) * simFrameRate;
                const animFrame = Math.floor(simTicks * animSpeed * speedRatio / 2) % 8;
                const effectiveAnimFrame = wizard.isMovingBackward ? (7 - animFrame) : animFrame;
                frameIndex = rowIndex * 9 + 1 + effectiveAnimFrame;
            }

            if (Array.isArray(ctx.wizardFrames) && ctx.wizardFrames[frameIndex]) {
                try {
                    wizardSprite.texture = ctx.wizardFrames[frameIndex];
                } catch (_textureErr) {
                    wizardSprite = ensureWizardSprite(true);
                    wizard.pixiSprite = wizardSprite;
                    try {
                        wizardSprite.texture = ctx.wizardFrames[frameIndex] || PIXI.Texture.WHITE;
                    } catch (_retryErr) {
                        wizardSprite.texture = PIXI.Texture.WHITE;
                    }
                }
            }

            const invisibilityActive = this.isInvisibilityActive(wizard);
            const wizardAlpha = invisibilityActive ? 0.45 : 1;
            wizardSprite.alpha = wizardAlpha;

            const alpha = Number.isFinite(ctx.renderAlpha)
                ? Math.max(0, Math.min(1, ctx.renderAlpha))
                : 1;
            const renderPos = (wizard && typeof wizard.getInterpolatedPosition === "function")
                ? wizard.getInterpolatedPosition(alpha)
                : {
                    x: Number.isFinite(wizard.x) ? wizard.x : 0,
                    y: Number.isFinite(wizard.y) ? wizard.y : 0,
                    z: Number.isFinite(wizard.z) ? wizard.z : 0
                };
            const wizardLayer = this.getLayerIndexFromValue(wizard.currentLayer, 0);
            const wizardLayerBaseZ = Number.isFinite(wizard.currentLayerBaseZ) ? wizard.currentLayerBaseZ : 0;
            const supportedShadowLayer = findNearestSupportedFloorLayer(
                ctx && ctx.map ? ctx.map : null,
                renderPos.x,
                renderPos.y,
                wizardLayer
            );
            const shadowLayerBaseZ = Number.isFinite(supportedShadowLayer)
                ? this.getLayerBaseZForLevel(supportedShadowLayer)
                : wizardLayerBaseZ;
            const pGround = this.camera.worldToScreen(renderPos.x, renderPos.y, wizardLayerBaseZ);
            const interpolatedJumpHeight = Number.isFinite(renderPos.z) ? renderPos.z : 0;
            const jumpOffsetPx = interpolatedJumpHeight * this.camera.viewscale * this.camera.xyratio;
            const wizardCenterY = pGround.y - jumpOffsetPx - (this.camera.viewscale * 0.25);
            const renderNowMs = Number.isFinite(ctx.renderNowMs)
                ? Number(ctx.renderNowMs)
                : ((typeof performance !== "undefined" && performance && typeof performance.now === "function")
                    ? performance.now()
                    : Date.now());
            const deathAnimationActive = !!(
                wizard &&
                typeof wizard.isAdventureDeathAnimationActive === "function" &&
                wizard.isAdventureDeathAnimationActive(renderNowMs)
            );
            const deathAnimationProgress = deathAnimationActive && typeof wizard.getAdventureDeathAnimationProgress === "function"
                ? wizard.getAdventureDeathAnimationProgress(renderNowMs)
                : 0;
            const ghostSprite = this.ensureWizardGhostSprite();

            wizardSprite.width = this.camera.viewscale;
            wizardSprite.height = this.camera.viewscale;
            wizardSprite.visible = false;
            if (Object.prototype.hasOwnProperty.call(wizardSprite, "renderable")) {
                wizardSprite.renderable = false;
            }
            if (ghostSprite) {
                ghostSprite.visible = false;
                if (Object.prototype.hasOwnProperty.call(ghostSprite, "renderable")) {
                    ghostSprite.renderable = false;
                }
            }

            if (deathAnimationActive) {
                if (wizard._renderingDepthMesh) {
                    wizard._renderingDepthMesh.visible = false;
                    if (Object.prototype.hasOwnProperty.call(wizard._renderingDepthMesh, "renderable")) {
                        wizard._renderingDepthMesh.renderable = false;
                    }
                }
                const shadowProxy = this.ensureWizardShadowProxy();
                if (shadowProxy && shadowProxy._renderingDepthMesh) {
                    shadowProxy._renderingDepthMesh.visible = false;
                    if (Object.prototype.hasOwnProperty.call(shadowProxy._renderingDepthMesh, "renderable")) {
                        shadowProxy._renderingDepthMesh.renderable = false;
                    }
                }
                if (this.wizardShadowGraphics) {
                    this.wizardShadowGraphics.visible = false;
                    if (Object.prototype.hasOwnProperty.call(this.wizardShadowGraphics, "renderable")) {
                        this.wizardShadowGraphics.renderable = false;
                    }
                }
                if (wizardSprite.parent !== overlayContainer) {
                    overlayContainer.addChild(wizardSprite);
                }
                wizardSprite.anchor.set(0.5, 0.5);
                wizardSprite.x = pGround.x;
                wizardSprite.y = wizardCenterY;
                wizardSprite.rotation = Math.PI / 2;
                wizardSprite.alpha = wizardAlpha;
                wizardSprite.visible = true;
                if (Object.prototype.hasOwnProperty.call(wizardSprite, "renderable")) {
                    wizardSprite.renderable = true;
                }

                if (ghostSprite) {
                    if (ghostSprite.parent !== overlayContainer) {
                        overlayContainer.addChild(ghostSprite);
                    }
                    const riseDistance = this.camera.viewscale * 0.55;
                    ghostSprite.x = pGround.x;
                    ghostSprite.y = wizardCenterY - (this.camera.viewscale * 0.05) - (riseDistance * deathAnimationProgress);
                    ghostSprite.width = this.camera.viewscale * 0.8;
                    ghostSprite.height = this.camera.viewscale * 0.95;
                    ghostSprite.alpha = Math.max(0, Math.min(1, deathAnimationProgress / 0.2));
                    ghostSprite.visible = true;
                    if (Object.prototype.hasOwnProperty.call(ghostSprite, "renderable")) {
                        ghostSprite.renderable = true;
                    }
                }
            }

            const staticProto = (typeof global.StaticObject === "function" && global.StaticObject.prototype)
                ? global.StaticObject.prototype
                : null;
            let wizardDepthMesh = null;
            wizard._renderLayerBaseZ = wizardLayerBaseZ;
            wizard._renderDepthBias = 0;
            if (!deathAnimationActive && staticProto && typeof staticProto.updateDepthBillboardMesh === "function") {
                if (typeof staticProto.ensureDepthBillboardMesh === "function") {
                    wizard.ensureDepthBillboardMesh = staticProto.ensureDepthBillboardMesh;
                }
                if (typeof staticProto.updateDepthBillboardUvsForTexture === "function") {
                    wizard.updateDepthBillboardUvsForTexture = staticProto.updateDepthBillboardUvsForTexture;
                }
                const savedX = wizard.x;
                const savedY = wizard.y;
                const savedZ = wizard.z;
                wizard.x = renderPos.x;
                wizard.y = renderPos.y;
                wizard.z = (Number.isFinite(renderPos.z) ? Number(renderPos.z) : 0) - WIZARD_BODY_LOWER_UNITS;
                wizardDepthMesh = staticProto.updateDepthBillboardMesh.call(wizard, ctx, this.camera, {
                    alphaCutoff: TREE_ALPHA_CUTOFF,
                    mazeMode: false,
                    player: wizard
                });
                wizard.x = savedX;
                wizard.y = savedY;
                wizard.z = savedZ;
            }
            if (wizardDepthMesh) {
                wizard._renderingDepthMesh = wizardDepthMesh;
                if (wizardDepthMesh.parent !== depthContainer) {
                    depthContainer.addChild(wizardDepthMesh);
                }
                wizardDepthMesh.alpha = wizardAlpha;
                wizardDepthMesh.visible = true;
                if (Object.prototype.hasOwnProperty.call(wizardDepthMesh, "renderable")) {
                    wizardDepthMesh.renderable = true;
                }
                this.addPickRenderItem(wizard, wizardDepthMesh, { forceInclude: true });
            } else if (wizard._renderingDepthMesh) {
                wizard._renderingDepthMesh.visible = false;
                if (Object.prototype.hasOwnProperty.call(wizard._renderingDepthMesh, "renderable")) {
                    wizard._renderingDepthMesh.renderable = false;
                }
            }

            if (this.wizardShadowGraphics) {
                this.wizardShadowGraphics.visible = false;
                if (Object.prototype.hasOwnProperty.call(this.wizardShadowGraphics, "renderable")) {
                    this.wizardShadowGraphics.renderable = false;
                }
            }

            const shadowProxy = this.ensureWizardShadowProxy();
            if (!deathAnimationActive && shadowProxy && typeof shadowProxy.updateDepthBillboardMesh === "function") {
                shadowProxy._renderLayerBaseZ = shadowLayerBaseZ;
                shadowProxy._renderDepthBias = WIZARD_SHADOW_DEPTH_BIAS_UNITS;
                shadowProxy.map = wizard.map || global.map || null;
                shadowProxy.x = renderPos.x;
                shadowProxy.y = renderPos.y + 0.08;
                shadowProxy.z = 0;
                shadowProxy.visible = true;
                shadowProxy.gone = false;
                shadowProxy.vanishing = false;
                shadowProxy.width = 0.44;
                shadowProxy.height = 0.44;
                shadowProxy.pixiSprite.width = 0.44 * this.camera.viewscale;
                shadowProxy.pixiSprite.height = 0.44 * this.camera.viewscale;
                shadowProxy.pixiSprite.alpha = invisibilityActive ? 0.25 : 1;
                shadowProxy.pixiSprite.tint = 0xFFFFFF;
                const shadowMesh = shadowProxy.updateDepthBillboardMesh(ctx, this.camera, {
                    alphaCutoff: 0.01,
                    mazeMode: false,
                    player: wizard
                });
                if (shadowMesh) {
                    shadowProxy._renderingDepthMesh = shadowMesh;
                    if (shadowMesh.parent !== depthContainer) {
                        depthContainer.addChild(shadowMesh);
                    }
                    shadowMesh.alpha = invisibilityActive ? 0.25 : 1;
                    shadowMesh.visible = true;
                    if (Object.prototype.hasOwnProperty.call(shadowMesh, "renderable")) {
                        shadowMesh.renderable = true;
                    }
                }
            } else if (shadowProxy && shadowProxy._renderingDepthMesh) {
                shadowProxy._renderingDepthMesh.visible = false;
                if (Object.prototype.hasOwnProperty.call(shadowProxy._renderingDepthMesh, "renderable")) {
                    shadowProxy._renderingDepthMesh.renderable = false;
                }
            }

            const hat = wizard.hatGraphics;
            if (wizard && typeof wizard.drawShield === "function") {
                if (deathAnimationActive) {
                    if (wizard.shieldGraphics) {
                        wizard.shieldGraphics.visible = false;
                    }
                    if (wizard.shieldWireframeMesh) {
                        wizard.shieldWireframeMesh.visible = false;
                        if (Object.prototype.hasOwnProperty.call(wizard.shieldWireframeMesh, "renderable")) {
                            wizard.shieldWireframeMesh.renderable = false;
                        }
                    }
                } else {
                    wizard.drawShield(interpolatedJumpHeight, renderPos);
                }
            }
            if (hat && typeof hat === "object") {
                if (hat.parent !== overlayContainer) {
                    overlayContainer.addChild(hat);
                }
                const hatLiftPx = WIZARD_HAT_LIFT_UNITS * this.camera.viewscale * this.camera.xyratio;
                if (deathAnimationActive) {
                    const hatYOffset = (Number.isFinite(wizard.hatRenderYOffsetUnits) ? wizard.hatRenderYOffsetUnits : 0)
                        * this.camera.viewscale * this.camera.xyratio;
                    const bodyCenterToHatOriginY = (this.camera.viewscale * 0.25) - hatYOffset;
                    const deathRotation = Math.PI / 2;
                    const cosTheta = Math.cos(deathRotation);
                    const sinTheta = Math.sin(deathRotation);
                    const rotatedHatOffsetX = 0 * cosTheta - bodyCenterToHatOriginY * sinTheta;
                    const rotatedHatOffsetY = 0 * sinTheta + bodyCenterToHatOriginY * cosTheta;
                    hat.x = pGround.x + rotatedHatOffsetX;
                    hat.y = wizardCenterY + rotatedHatOffsetY - hatLiftPx;
                    hat.rotation = deathRotation;
                } else {
                    hat.x = pGround.x;
                    const hatYOffset = (Number.isFinite(wizard.hatRenderYOffsetUnits) ? wizard.hatRenderYOffsetUnits : 0)
                        * this.camera.viewscale * this.camera.xyratio;
                    hat.y = pGround.y - jumpOffsetPx - hatYOffset - hatLiftPx;
                    hat.rotation = 0;
                }
                if (hat.scale && typeof hat.scale.set === "function") {
                    const hatRes = Number.isFinite(wizard.hatResolution) ? Math.max(1, wizard.hatResolution) : 1;
                    const hatRenderScale = Number.isFinite(wizard.hatRenderScale) ? Math.max(0.05, wizard.hatRenderScale) : 1;
                    const s = (this.camera.viewscale / hatRes) * hatRenderScale;
                    hat.scale.set(s, s);
                }
                hat.alpha = wizardAlpha;
                hat.visible = true;
                if (hat.parent && hat.parent.children[hat.parent.children.length - 1] !== hat) {
                    hat.parent.setChildIndex(hat, hat.parent.children.length - 1);
                }
                this.promoteInteriorPresentationDisplayObject(hat, ctx);
            }
        }

        renderPowerups(ctx) {
            const depthContainer = this.layers.depthObjects;
            if (!depthContainer) return;
            const maskedContainer = this.layers.groundObjects || depthContainer;
            const wizard = (ctx && ctx.wizard) ? ctx.wizard : null;
            const mapRef = (ctx && ctx.map) ? ctx.map : (this.camera && this.camera.map) || global.map || null;
            const mazeLosActive = !!(
                this.isLosMazeModeEnabled() &&
                !this.isOmnivisionActive(wizard) &&
                wizard
            );
            const wizardLayer = this.getLayerIndexFromValue(
                wizard && Number.isFinite(wizard.currentLayer) ? wizard.currentLayer : 0,
                0
            );
            const cutawayState = this.getLayerCutawayState(ctx);

            const list = Array.isArray(ctx && ctx.powerups)
                ? ctx.powerups
                : (Array.isArray(global.powerups) ? global.powerups : []);
            const currentDisplayObjects = new Set();
            const renderNowMs = Number.isFinite(ctx && ctx.renderNowMs) ? Number(ctx.renderNowMs) : Date.now();

            for (let i = 0; i < list.length; i++) {
                const powerup = list[i];
                if (!powerup || powerup.gone || powerup.collected) continue;
                if (!Number.isFinite(powerup.x) || !Number.isFinite(powerup.y)) continue;
                this.updateSinkAnimation(powerup, renderNowMs);
                if (typeof powerup.ensureSprite === "function") {
                    powerup.ensureSprite();
                }
                const sprite = powerup.pixiSprite;
                if (!sprite) continue;
                if (typeof powerup.updateSpriteAnimation === "function") {
                    powerup.updateSpriteAnimation();
                }
                const powerupLayer = this.getLayerIndexForObject(powerup, 0);
                powerup._renderLayerIndex = powerupLayer;
                if (
                    (mazeLosActive && powerupLayer !== wizardLayer) ||
                    this.isRenderItemHiddenByLayerCutaway(powerup, powerupLayer, cutawayState, mapRef)
                ) {
                    sprite.visible = false;
                    if (Object.prototype.hasOwnProperty.call(sprite, "renderable")) {
                        sprite.renderable = false;
                    }
                    if (powerup._renderingDepthMesh) {
                        powerup._renderingDepthMesh.visible = false;
                        if (Object.prototype.hasOwnProperty.call(powerup._renderingDepthMesh, "renderable")) {
                            powerup._renderingDepthMesh.renderable = false;
                        }
                    }
                    powerup._renderingDepthMesh = null;
                    powerup._renderingDisplayObject = null;
                    continue;
                }

                if (
                    wizard &&
                    (mazeLosActive || !this.isForceVisible(powerup)) &&
                    this.isRadialItemHiddenByLos(powerup, wizard, mapRef)
                ) {
                    sprite.visible = false;
                    if (Object.prototype.hasOwnProperty.call(sprite, "renderable")) {
                        sprite.renderable = false;
                    }
                    if (powerup._renderingDepthMesh) {
                        powerup._renderingDepthMesh.visible = false;
                        if (Object.prototype.hasOwnProperty.call(powerup._renderingDepthMesh, "renderable")) {
                            powerup._renderingDepthMesh.renderable = false;
                        }
                    }
                    powerup._renderingDepthMesh = null;
                    powerup._renderingDisplayObject = null;
                    continue;
                }

                const point = this.camera.worldToScreen(
                    powerup.x,
                    powerup.y,
                    Number.isFinite(powerup.z) ? powerup.z : 0
                );
                const w = Number.isFinite(powerup.width) ? Math.max(0.01, Number(powerup.width)) : 0.8;
                const h = Number.isFinite(powerup.height) ? Math.max(0.01, Number(powerup.height)) : 0.8;
                const lodTexturePath = this.resolvePowerupLodTexturePath(powerup);
                if (typeof lodTexturePath === "string" && lodTexturePath.length > 0 && lodTexturePath !== powerup._activeLodTexturePath) {
                    sprite.texture = PIXI.Texture.from(lodTexturePath);
                    powerup._activeLodTexturePath = lodTexturePath;
                }
                sprite.x = point.x;
                sprite.y = point.y;
                sprite.width = w * this.camera.viewscale;
                sprite.height = h * this.camera.viewscale;

                let depthMesh = null;
                if (typeof powerup.updateDepthBillboardMesh === "function") {
                    depthMesh = powerup.updateDepthBillboardMesh(ctx, this.camera, { alphaCutoff: TREE_ALPHA_CUTOFF });
                }

                if (!depthMesh) {
                    sprite.visible = false;
                    if (Object.prototype.hasOwnProperty.call(sprite, "renderable")) {
                        sprite.renderable = false;
                    }
                    powerup._renderingDepthMesh = null;
                    powerup._renderingDisplayObject = null;
                    continue;
                }

                const targetContainer = mazeLosActive
                    ? maskedContainer
                    : depthContainer;
                if (depthMesh.parent !== targetContainer) {
                    targetContainer.addChild(depthMesh);
                }
                depthMesh.visible = true;
                if (Object.prototype.hasOwnProperty.call(depthMesh, "renderable")) {
                    depthMesh.renderable = true;
                }
                sprite.visible = false;
                if (Object.prototype.hasOwnProperty.call(sprite, "renderable")) {
                    sprite.renderable = false;
                }

                powerup._renderingDepthMesh = depthMesh;
                powerup._renderingDisplayObject = depthMesh;
                this.applyLayerDarknessForItem(powerup, powerupLayer, depthMesh);
                if (this.applySinkClip(powerup, depthMesh)) {
                    currentDisplayObjects.add(depthMesh);
                    this.addPickRenderItem(powerup, depthMesh, { forceInclude: true });
                }
            }

            for (const sprite of this.activePowerupDisplayObjects) {
                if (!currentDisplayObjects.has(sprite) && sprite) {
                    sprite.visible = false;
                    if (Object.prototype.hasOwnProperty.call(sprite, "renderable")) {
                        sprite.renderable = false;
                    }
                }
            }
            this.activePowerupDisplayObjects = currentDisplayObjects;
        }

        renderProjectiles(ctx) {
            const container = this.layers.entities;
            if (!container) return;
            const wizard = (ctx && ctx.wizard) ? ctx.wizard : null;
            const mapRef = (ctx && ctx.map) ? ctx.map : (this.camera && this.camera.map) || global.map || null;
            const mazeLosActive = !!(
                this.isLosMazeModeEnabled() &&
                !this.isOmnivisionActive(wizard) &&
                wizard
            );
            const wizardLayer = this.getLayerIndexFromValue(
                wizard && Number.isFinite(wizard.currentLayer) ? wizard.currentLayer : 0,
                0
            );
            const cutawayState = this.getLayerCutawayState(ctx);

            const list = Array.isArray(ctx && ctx.projectiles)
                ? ctx.projectiles
                : (
                    (typeof projectiles !== "undefined" && Array.isArray(projectiles))
                        ? projectiles
                        : (Array.isArray(global.projectiles) ? global.projectiles : [])
                );
            const currentDisplayObjects = new Set();

            for (let i = 0; i < list.length; i++) {
                const projectile = list[i];
                if (!projectile || projectile.gone) continue;

                const texture = this.getProjectileTexture(projectile);
                let sprite = projectile.pixiSprite || null;
                if (!sprite) {
                    sprite = new PIXI.Sprite(texture || PIXI.Texture.WHITE);
                    sprite.anchor.set(0.5, 0.5);
                    projectile.pixiSprite = sprite;
                } else if (texture && sprite.texture !== texture) {
                    sprite.texture = texture;
                }

                if (sprite.parent !== container) {
                    container.addChild(sprite);
                }

                const worldX = Number.isFinite(projectile.x) ? Number(projectile.x) : 0;
                const worldY = Number.isFinite(projectile.y) ? Number(projectile.y) : 0;
                const localZ = Number.isFinite(projectile.z) ? Number(projectile.z) : 0;
                const baseZ = projectile.zIsWorld === true ? 0 : this.getProjectileVisualBaseZ(projectile);
                const worldZ = projectile.zIsWorld === true ? localZ : (baseZ + localZ);
                const projectileLayer = this.getLayerIndexFromValue(
                    Number.isFinite(projectile.currentLayer)
                        ? projectile.currentLayer
                        : Math.floor((Number(baseZ) || 0) / FLOOR_LAYER_DEFAULT_HEIGHT_UNITS),
                    0
                );
                projectile._renderLayerIndex = projectileLayer;
                const hiddenByMazeLos = !!(
                    mazeLosActive &&
                    (
                        projectileLayer !== wizardLayer ||
                        this.isWorldPointInLosShadow(worldX, worldY, wizard, mapRef)
                    )
                );
                const hiddenByCutaway = this.isWorldPointHiddenByLayerCutaway(worldX, worldY, projectileLayer, cutawayState);
                const visible = projectile.visible !== false && !hiddenByMazeLos && !hiddenByCutaway;
                const spriteVisible = visible && !projectile.hideProjectileSprite;
                sprite.visible = spriteVisible;
                if (Object.prototype.hasOwnProperty.call(sprite, "renderable")) {
                    sprite.renderable = spriteVisible;
                }

                if (spriteVisible) {
                    const p = this.camera.worldToScreen(worldX, worldY, worldZ);
                    sprite.x = p.x;
                    sprite.y = p.y;

                    const zoomFactor = Math.max(
                        0.01,
                        Number.isFinite(global.viewportZoomFactor)
                            ? Number(global.viewportZoomFactor)
                            : 1
                    );
                    const apparentSize = Number.isFinite(projectile.apparentSize)
                        ? Number(projectile.apparentSize)
                        : NaN;
                    const fallbackSize = (
                        Number.isFinite(projectile.size)
                            ? Number(projectile.size)
                            : 0.35
                    ) * this.camera.viewscale;
                    const sizePx = Math.max(
                        1,
                        Number.isFinite(apparentSize) && apparentSize > 0
                            ? (apparentSize * zoomFactor)
                            : fallbackSize
                    );
                    sprite.width = sizePx;
                    sprite.height = sizePx;

                    if ((projectile.type === "arrow" || projectile.rotateSpriteToMovement) && projectile.movement) {
                        const moveX = Number(projectile.movement.x) || 0;
                        const moveY = Number(projectile.movement.y) || 0;
                        if (Math.hypot(moveX, moveY) > 1e-6) {
                            const rotationOffset = Number.isFinite(projectile.spriteRotationOffset)
                                ? Number(projectile.spriteRotationOffset)
                                : Math.PI * 0.5;
                            sprite.rotation = Math.atan2(moveY, moveX) + rotationOffset;
                        }
                    } else {
                        sprite.rotation = Number(projectile.spriteRotation) || 0;
                    }
                    this.applyLayerDarknessForItem(projectile, projectileLayer, sprite);
                }

                currentDisplayObjects.add(sprite);
                const particleGraphics = this.renderProjectileParticles(projectile, container, hiddenByMazeLos || hiddenByCutaway);
                if (particleGraphics) {
                    currentDisplayObjects.add(particleGraphics);
                }
            }

            for (const sprite of this.activeProjectileDisplayObjects) {
                if (!currentDisplayObjects.has(sprite) && sprite) {
                    if (typeof sprite.clear === "function") {
                        sprite.clear();
                    }
                    sprite.visible = false;
                    if (Object.prototype.hasOwnProperty.call(sprite, "renderable")) {
                        sprite.renderable = false;
                    }
                    if (sprite.parent) {
                        sprite.parent.removeChild(sprite);
                    }
                }
            }
            this.activeProjectileDisplayObjects = currentDisplayObjects;
        }

        renderCreatureTracePaths(ctx) {
            const container = this.layers.entities;
            if (!container) return;
            const creatureList = Array.isArray(ctx && ctx.animals)
                ? ctx.animals
                : ((typeof animals !== "undefined" && Array.isArray(animals)) ? animals : (Array.isArray(global.animals) ? global.animals : []));
            const mapRef = (ctx && ctx.map) ? ctx.map : (this.camera && this.camera.map) || global.map || null;
            const renderNowMs = Number.isFinite(ctx && ctx.renderNowMs) ? Number(ctx.renderNowMs) : Date.now();
            const isGamePaused = !!((typeof paused !== "undefined" && paused) || global.paused);
            const CameraCtor = global.RenderingCamera;

            for (let i = 0; i < creatureList.length; i++) {
                const creature = creatureList[i];
                if (!creature) continue;

                const traceState = (typeof creature.updateTracePathLifetime === "function")
                    ? creature.updateTracePathLifetime(renderNowMs, isGamePaused)
                    : null;
                const traceLog = Array.isArray(creature.nodeVisitLog) ? creature.nodeVisitLog : [];
                const shouldRender = !!(
                    traceState &&
                    traceLog.length >= 2 &&
                    !creature.gone
                );

                let graphics = creature._tracePathGraphics || null;
                if (!shouldRender) {
                    if (graphics) {
                        graphics.clear();
                        graphics.visible = false;
                    }
                    continue;
                }

                if (!graphics) {
                    graphics = new PIXI.Graphics();
                    graphics.name = "creatureTracePath";
                    creature._tracePathGraphics = graphics;
                }
                if (graphics.parent !== container) {
                    container.addChild(graphics);
                }

                graphics.clear();
                graphics.visible = true;
                graphics.zIndex = -10;
                graphics.alpha = 1;
                graphics.lineStyle(Math.max(2, this.camera.viewscale * 0.16), 0xb04cff, 0.9);

                const firstEntry = traceLog[0];
                if (!firstEntry) {
                    graphics.visible = false;
                    continue;
                }

                let continuousPoint = (CameraCtor && typeof CameraCtor.alignWorldPointToReference === "function")
                    ? CameraCtor.alignWorldPointToReference(
                        mapRef,
                        Number(this.camera && this.camera.x) || 0,
                        Number(this.camera && this.camera.y) || 0,
                        Number(firstEntry.x),
                        Number(firstEntry.y)
                    )
                    : { x: Number(firstEntry.x), y: Number(firstEntry.y) };
                let screenPoint = this.camera.worldToScreen(continuousPoint.x, continuousPoint.y, 0);
                graphics.moveTo(screenPoint.x, screenPoint.y);

                for (let j = 1; j < traceLog.length; j++) {
                    const entry = traceLog[j];
                    if (!entry || !Number.isFinite(entry.x) || !Number.isFinite(entry.y)) continue;
                    continuousPoint = (CameraCtor && typeof CameraCtor.alignWorldPointToReference === "function")
                        ? CameraCtor.alignWorldPointToReference(
                            mapRef,
                            continuousPoint.x,
                            continuousPoint.y,
                            Number(entry.x),
                            Number(entry.y)
                        )
                        : { x: Number(entry.x), y: Number(entry.y) };
                    screenPoint = this.camera.worldToScreen(continuousPoint.x, continuousPoint.y, 0);
                    graphics.lineTo(screenPoint.x, screenPoint.y);
                }
            }
        }

        renderScriptMessages(ctx) {
            const container = this.layers.scriptMessages;
            if (!container) return;
            const mapRef = (ctx && ctx.map) ? ctx.map : (this.camera && this.camera.map) || global.map || null;
            const wizard = (ctx && ctx.wizard) ? ctx.wizard : null;
            const wizardUnderRoof = !!(
                wizard &&
                Number.isFinite(wizard.x) &&
                Number.isFinite(wizard.y) &&
                this.isWorldPointUnderRoof(Number(wizard.x), Number(wizard.y), ctx)
            );
            const mazeLosActive = !!(
                this.isLosMazeModeEnabled() &&
                !this.isOmnivisionActive(wizard) &&
                wizard
            );

            // Collect objects with messages from the global registry AND from game objects
            const objectsWithMessages = [];
            const seen = new Set();

            // Primary source: global registry (set by this.message handler)
            const globalTargets = (global._scriptMessageTargets instanceof Set)
                ? global._scriptMessageTargets
                : null;
            if (globalTargets) {
                for (const item of globalTargets) {
                    if (!item || item.gone) {
                        globalTargets.delete(item);
                        continue;
                    }
                    if (!Array.isArray(item._scriptMessages) || item._scriptMessages.length === 0) {
                        globalTargets.delete(item);
                        continue;
                    }
                    if (item.visible === false) continue;
                    seen.add(item);
                    objectsWithMessages.push(item);
                }
            }

            // Fallback: scan game objects (in case registry was missed)
            if (mapRef && typeof mapRef.getGameObjects === "function") {
                const allObjects = mapRef.getGameObjects({ refresh: false }) || [];
                for (let i = 0; i < allObjects.length; i++) {
                    const item = allObjects[i];
                    if (!item || item.gone || seen.has(item)) continue;
                    if (!Array.isArray(item._scriptMessages) || item._scriptMessages.length === 0) continue;
                    if (item.visible === false) continue;
                    objectsWithMessages.push(item);
                }
            }

            const activeKeys = new Set();
            const parseScriptMessageColor = (value, fallback = 0xFFFFFF) => {
                if (Number.isFinite(value)) {
                    return Math.max(0, Math.min(0xFFFFFF, Math.floor(Number(value))));
                }
                if (typeof value === "string") {
                    const text = value.trim().toLowerCase();
                    if (/^#?[0-9a-f]{6}$/.test(text)) {
                        return parseInt(text.replace(/^#/, ""), 16);
                    }
                    if (/^0x[0-9a-f]{6}$/.test(text)) {
                        return parseInt(text, 16);
                    }
                }
                return fallback;
            };
            const normalizeScriptMessageFontSize = (value, fallback = 14) => {
                const parsed = Number(value);
                if (!Number.isFinite(parsed)) return fallback;
                return Math.max(8, Math.min(96, parsed));
            };

            for (let i = 0; i < objectsWithMessages.length; i++) {
                const item = objectsWithMessages[i];
                const messages = item._scriptMessages;

                const worldPos = this.resolveInterpolatedItemWorldPosition(item, mapRef);
                if (!worldPos) continue;
                if (
                    mazeLosActive &&
                    this.isWorldPointInLosShadow(worldPos.x, worldPos.y, wizard, mapRef)
                ) {
                    continue;
                }
                if (this.isWorldPointUnderRoof(worldPos.x, worldPos.y, ctx) && !wizardUnderRoof) {
                    continue;
                }

                // Stable key per object (lazy-assigned, survives array reordering)
                if (!item._scriptMessageRenderingId) {
                    item._scriptMessageRenderingId = "msgobj:" + (this._nextScriptMessageObjId = (this._nextScriptMessageObjId || 0) + 1);
                }

                for (let m = 0; m < messages.length; m++) {
                    const msg = messages[m];
                    if (!msg || typeof msg.text !== "string" || !msg.text.length) continue;
                    const key = item._scriptMessageRenderingId + ":" + m;
                    activeKeys.add(key);
                    const fillColor = parseScriptMessageColor(msg.color, 0xFFFFFF);
                    const fontSize = normalizeScriptMessageFontSize(msg.fontsize, 14);
                    const styleSignature = `${fillColor}:${fontSize}`;

                    let entry = this.scriptMessageTextObjects.get(key);
                    if (!entry) {
                        const textObj = new PIXI.Text(msg.text, {
                            fontFamily: "Arial, Helvetica, sans-serif",
                            fontSize,
                            fontWeight: "bold",
                            fill: fillColor,
                            stroke: 0x000000,
                            strokeThickness: 3,
                            align: "center",
                            wordWrap: true,
                            wordWrapWidth: 200
                        });
                        textObj.anchor.set(0.5, 0.5);
                        textObj.name = "scriptMsg_" + key;
                        container.addChild(textObj);
                        entry = { textObj, lastText: msg.text, lastStyleSignature: styleSignature };
                        this.scriptMessageTextObjects.set(key, entry);
                    } else if (entry.lastText !== msg.text) {
                        entry.textObj.text = msg.text;
                        entry.lastText = msg.text;
                    }
                    if (entry.lastStyleSignature !== styleSignature) {
                        entry.textObj.style.fill = fillColor;
                        entry.textObj.style.fontSize = fontSize;
                        entry.lastStyleSignature = styleSignature;
                    }

                    const offsetX = Number.isFinite(msg.x) ? msg.x : 0;
                    const offsetY = Number.isFinite(msg.y) ? msg.y : 0;

                    // Compute the visual center of the object, accounting for its
                    // actual anchor, dimensions, and rotation axis so the message
                    // is centred on its appearance rather than its anchor point.
                    let visCenterX = worldPos.x;
                    let visCenterY = worldPos.y;
                    let visCenterZ = Number.isFinite(item.z) ? item.z : 0;

                    const itemW = Number.isFinite(item.width) ? item.width : 0;
                    const itemH = Number.isFinite(item.height) ? item.height : 0;
                    const rotAxis = (typeof item.rotationAxis === "string") ? item.rotationAxis : "visual";

                    if (rotAxis === "ground") {
                        // Flat on the ground — visual center is just the position, no Z offset.
                    } else if (item._depthBillboardWorldPositions && item._depthBillboardWorldPositions.length >= 12) {
                        // Use the actual billboard quad corner positions for accuracy.
                        const wp = item._depthBillboardWorldPositions;
                        const count = Math.min(wp.length / 3, rotAxis === "spatial" && wp.length >= 24 ? 8 : 4);
                        let sx = 0, sy = 0, sz = 0;
                        for (let v = 0; v < count; v++) {
                            sx += wp[v * 3];
                            sy += wp[v * 3 + 1];
                            sz += wp[v * 3 + 2];
                        }
                        visCenterX = sx / count;
                        visCenterY = sy / count;
                        visCenterZ = sz / count;
                    } else if (itemW > 0 || itemH > 0) {
                        // Fallback: derive visual center from anchor + dimensions.
                        const sprAnchor = item.pixiSprite && item.pixiSprite.anchor;
                        const ax = Number.isFinite(item.placeableAnchorX)
                            ? Number(item.placeableAnchorX)
                            : (sprAnchor && Number.isFinite(sprAnchor.x) ? Number(sprAnchor.x) : 0.5);
                        const ay = Number.isFinite(item.placeableAnchorY)
                            ? Number(item.placeableAnchorY)
                            : (sprAnchor && Number.isFinite(sprAnchor.y) ? Number(sprAnchor.y) : 1);
                        const xyR = Math.max(0.0001, this.camera.xyratio || 0.66);
                        const worldHeightZ = (rotAxis === "spatial")
                            ? (itemH / xyR)
                            : itemH;
                        visCenterX += (0.5 - ax) * itemW;
                        visCenterZ += (ay - 0.5) * worldHeightZ;
                    }

                    const screenPos = this.camera.worldToScreen(
                        visCenterX + offsetX,
                        visCenterY + offsetY,
                        visCenterZ
                    );
                    entry.textObj.x = screenPos.x;
                    entry.textObj.y = screenPos.y;
                    entry.textObj.visible = true;
                }
            }

            // Hide/remove stale text objects
            for (const [key, entry] of this.scriptMessageTextObjects.entries()) {
                if (!activeKeys.has(key)) {
                    entry.textObj.visible = false;
                    if (entry.textObj.parent) {
                        entry.textObj.parent.removeChild(entry.textObj);
                    }
                    entry.textObj.destroy();
                    this.scriptMessageTextObjects.delete(key);
                }
            }
        }

        getMousePosRef(ctx) {
            if (ctx && ctx.mousePos) return ctx.mousePos;
            if (typeof mousePos !== "undefined") return mousePos;
            return global.mousePos || null;
        }

        resolveScreenPointOnLayerPlane(screenX, screenY, baseZ, mapRef = null, wizardRef = null) {
            if (
                !this.camera ||
                !Number.isFinite(screenX) ||
                !Number.isFinite(screenY) ||
                !Number.isFinite(this.camera.x) ||
                !Number.isFinite(this.camera.y)
            ) {
                return null;
            }
            const vs = Number.isFinite(this.camera.viewscale) && this.camera.viewscale
                ? Number(this.camera.viewscale)
                : 1;
            const xyr = Number.isFinite(this.camera.xyratio) && this.camera.xyratio
                ? Number(this.camera.xyratio)
                : 1;
            const cameraZ = Number.isFinite(this.camera.z) ? Number(this.camera.z) : 0;
            let worldX = (Number(screenX) / vs) + Number(this.camera.x);
            let worldY = (Number(screenY) / (vs * xyr)) + Number(this.camera.y) + (Number(baseZ) - cameraZ);
            if (mapRef && typeof mapRef.wrapWorldX === "function" && Number.isFinite(worldX)) {
                worldX = mapRef.wrapWorldX(worldX);
            }
            if (mapRef && typeof mapRef.wrapWorldY === "function" && Number.isFinite(worldY)) {
                worldY = mapRef.wrapWorldY(worldY);
            }
            if (
                wizardRef &&
                mapRef &&
                typeof mapRef.shortestDeltaX === "function" &&
                typeof mapRef.shortestDeltaY === "function" &&
                Number.isFinite(wizardRef.x) &&
                Number.isFinite(wizardRef.y) &&
                Number.isFinite(worldX) &&
                Number.isFinite(worldY)
            ) {
                worldX = Number(wizardRef.x) + mapRef.shortestDeltaX(Number(wizardRef.x), worldX);
                worldY = Number(wizardRef.y) + mapRef.shortestDeltaY(Number(wizardRef.y), worldY);
            }
            return { x: worldX, y: worldY };
        }

        ensurePlaceObjectPreviewItem(mapRef = null) {
            if (!this.placeObjectPreviewItem) {
                this.placeObjectPreviewItem = {
                    type: "placedObjectPreview",
                    map: mapRef || global.map || null,
                    gone: false,
                    vanishing: false,
                    isPlacedObject: true,
                    objectType: "placedObject",
                    pixiSprite: this.placeObjectPreviewSprite
                };
            }
            const previewItem = this.placeObjectPreviewItem;
            previewItem.map = mapRef || previewItem.map || global.map || null;
            previewItem.gone = false;
            previewItem.vanishing = false;
            previewItem.isPlacedObject = true;
            previewItem.objectType = "placedObject";
            previewItem.pixiSprite = this.placeObjectPreviewSprite;

            const staticProto = global.StaticObject && global.StaticObject.prototype
                ? global.StaticObject.prototype
                : null;
            if (staticProto && typeof staticProto.ensureDepthBillboardMesh === "function" && typeof previewItem.ensureDepthBillboardMesh !== "function") {
                previewItem.ensureDepthBillboardMesh = staticProto.ensureDepthBillboardMesh;
            }
            if (staticProto && typeof staticProto.updateDepthBillboardMesh === "function" && typeof previewItem.updateDepthBillboardMesh !== "function") {
                previewItem.updateDepthBillboardMesh = staticProto.updateDepthBillboardMesh;
            }
            if (staticProto && typeof staticProto._ensureCompositeUnderlayMesh === "function" && typeof previewItem._ensureCompositeUnderlayMesh !== "function") {
                previewItem._ensureCompositeUnderlayMesh = staticProto._ensureCompositeUnderlayMesh;
            }
            if (staticProto && typeof staticProto._destroyCompositeUnderlayMesh === "function" && typeof previewItem._destroyCompositeUnderlayMesh !== "function") {
                previewItem._destroyCompositeUnderlayMesh = staticProto._destroyCompositeUnderlayMesh;
            }

            return previewItem;
        }

        clearPlaceObjectPreview() {
            if (this.placeObjectPreviewItem) {
                if (this.placeObjectPreviewItem._depthBillboardMesh) {
                    const mesh = this.placeObjectPreviewItem._depthBillboardMesh;
                    mesh.visible = false;
                    if (Object.prototype.hasOwnProperty.call(mesh, "renderable")) {
                        mesh.renderable = false;
                    }
                }
                if (this.placeObjectPreviewItem._compositeUnderlayMesh) {
                    const mesh = this.placeObjectPreviewItem._compositeUnderlayMesh;
                    mesh.visible = false;
                    if (Object.prototype.hasOwnProperty.call(mesh, "renderable")) {
                        mesh.renderable = false;
                    }
                }
            }
            if (this.placeObjectPreviewDisplayObject) {
                this.placeObjectPreviewDisplayObject.visible = false;
                if (Object.prototype.hasOwnProperty.call(this.placeObjectPreviewDisplayObject, "renderable")) {
                    this.placeObjectPreviewDisplayObject.renderable = false;
                }
                this.placeObjectPreviewDisplayObject = null;
            }
            if (this.placeObjectPreviewSprite) {
                this.placeObjectPreviewSprite.visible = false;
                if (Object.prototype.hasOwnProperty.call(this.placeObjectPreviewSprite, "renderable")) {
                    this.placeObjectPreviewSprite.renderable = false;
                }
            }
            if (this.placeObjectCenterSnapGuideGraphics) {
                this.placeObjectCenterSnapGuideGraphics.clear();
                this.placeObjectCenterSnapGuideGraphics.visible = false;
            }
        }

        clearPowerupPlacementPreview() {
            if (this.powerupPlacementPreviewItem && this.powerupPlacementPreviewItem._depthBillboardMesh) {
                const mesh = this.powerupPlacementPreviewItem._depthBillboardMesh;
                mesh.visible = false;
                if (Object.prototype.hasOwnProperty.call(mesh, "renderable")) {
                    mesh.renderable = false;
                }
            }
            if (this.powerupPlacementPreviewDisplayObject) {
                this.powerupPlacementPreviewDisplayObject.visible = false;
                if (Object.prototype.hasOwnProperty.call(this.powerupPlacementPreviewDisplayObject, "renderable")) {
                    this.powerupPlacementPreviewDisplayObject.renderable = false;
                }
                this.powerupPlacementPreviewDisplayObject = null;
            }
            if (this.powerupPlacementPreviewSprite) {
                this.powerupPlacementPreviewSprite.visible = false;
                if (Object.prototype.hasOwnProperty.call(this.powerupPlacementPreviewSprite, "renderable")) {
                    this.powerupPlacementPreviewSprite.renderable = false;
                }
            }
        }

        clearWallPlacementPreview() {
            if (!this.wallPlacementPreviewGraphics) return;
            this.wallPlacementPreviewGraphics.clear();
            this.wallPlacementPreviewGraphics.visible = false;
        }

        clearPrototypeSectionSeams() {
            if (!this.prototypeSectionSeamGraphics) return;
            this.prototypeSectionSeamGraphics.clear();
            this.prototypeSectionSeamGraphics.visible = false;
        }

        renderPrototypeSectionSeams(ctx) {
            const layer = this.layers.ui;
            if (!layer) return;
            if (!this.prototypeSectionSeamGraphics) {
                this.prototypeSectionSeamGraphics = new PIXI.Graphics();
                this.prototypeSectionSeamGraphics.name = "renderingPrototypeSectionSeams";
                this.prototypeSectionSeamGraphics.skipTransform = true;
                this.prototypeSectionSeamGraphics.interactive = false;
                this.prototypeSectionSeamGraphics.visible = false;
                layer.addChild(this.prototypeSectionSeamGraphics);
            } else if (this.prototypeSectionSeamGraphics.parent !== layer) {
                layer.addChild(this.prototypeSectionSeamGraphics);
            }

            const g = this.prototypeSectionSeamGraphics;

            const hide = () => {
                if (g.visible) {
                    g.visible = false;
                    this._sectionSeamDrawKey = null;
                }
            };

            const showSectionWorldSeams = !!(
                global.debugViewSettings
                    ? global.debugViewSettings.showSectionWorldSeams !== false
                    : global.renderingShowSectionWorldSeams !== false
            );
            if (!showSectionWorldSeams) { hide(); return; }

            const mapRef = (ctx && ctx.map) || global.map || null;
            const wizardRef = (ctx && ctx.wizard) || global.wizard || null;
            if (wizardRef && typeof wizardRef.isAdventureMode === "function" && wizardRef.isAdventureMode()) {
                hide(); return;
            }

            const state = (mapRef && mapRef._prototypeSectionState) || null;
            const sectionGeometryApi = (typeof globalThis !== "undefined") ? globalThis.__sectionGeometry : null;
            if (!state || !(state.sectionAssetsByKey instanceof Map) || !sectionGeometryApi) {
                hide(); return;
            }

            // World-space edge list — recomputed only when sections are added or removed.
            const sectionCount = state.sectionAssetsByKey.size;
            if (
                !this._sectionSeamEdgeCache ||
                this._sectionSeamEdgeCache.stateRef !== state ||
                this._sectionSeamEdgeCache.sectionCount !== sectionCount
            ) {
                const edges = [];
                const seenKeys = new Set();
                for (const [, asset] of state.sectionAssetsByKey.entries()) {
                    const corners = sectionGeometryApi.getSectionHexagonCorners(asset.centerAxial, state.basis);
                    if (!Array.isArray(corners) || corners.length < 3) continue;
                    const n = corners.length;
                    for (let i = 0; i < n; i++) {
                        const ca = corners[i];
                        const cb = corners[(i + 1) % n];
                        const ax = Math.round(ca.x * 1000);
                        const ay = Math.round(ca.y * 1000);
                        const bx = Math.round(cb.x * 1000);
                        const by = Math.round(cb.y * 1000);
                        const edgeKey = (ax < bx || (ax === bx && ay <= by))
                            ? `${ax},${ay},${bx},${by}`
                            : `${bx},${by},${ax},${ay}`;
                        if (seenKeys.has(edgeKey)) continue;
                        seenKeys.add(edgeKey);
                        edges.push({ wx1: ca.x, wy1: ca.y, wx2: cb.x, wy2: cb.y });
                    }
                }
                this._sectionSeamEdgeCache = { stateRef: state, sectionCount, edges };
                this._sectionSeamDrawKey = null;
            }

            const level = (wizardRef && Number.isFinite(wizardRef.selectedFloorEditLevel))
                ? Math.round(Number(wizardRef.selectedFloorEditLevel))
                : ((typeof globalThis !== "undefined" && Number.isFinite(globalThis.selectedFloorEditLevel))
                    ? Math.round(Number(globalThis.selectedFloorEditLevel))
                    : 0);
            const worldZ = level * FLOOR_LAYER_DEFAULT_HEIGHT_UNITS;

            // Skip clear + redraw entirely when camera and level haven't changed.
            const cam = this.camera;
            const drawKey = `${cam.x},${cam.y},${cam.viewscale},${cam.xyratio},${worldZ}`;
            if (drawKey === this._sectionSeamDrawKey) {
                g.visible = true;
                return;
            }
            this._sectionSeamDrawKey = drawKey;

            g.clear();
            g.visible = true;
            g.lineStyle(2, 0xf4f4f4, 0.72);

            const screenW = Number.isFinite(cam.screenWidth) ? cam.screenWidth
                : (global.app && global.app.screen ? global.app.screen.width : 2000);
            const screenH = Number.isFinite(cam.screenHeight) ? cam.screenHeight
                : (global.app && global.app.screen ? global.app.screen.height : 2000);
            const margin = 64;

            const edges = this._sectionSeamEdgeCache.edges;
            for (let e = 0; e < edges.length; e++) {
                const edge = edges[e];
                const a = cam.worldToScreen(edge.wx1, edge.wy1, worldZ);
                const b = cam.worldToScreen(edge.wx2, edge.wy2, worldZ);
                if (
                    Math.max(a.x, b.x) < -margin || Math.min(a.x, b.x) > screenW + margin ||
                    Math.max(a.y, b.y) < -margin || Math.min(a.y, b.y) > screenH + margin
                ) continue;
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const len = Math.hypot(dx, dy);
                if (!(len > 1)) continue;
                const ux = dx / len;
                const uy = dy / len;
                let pos = 0;
                let drawing = true;
                while (pos < len) {
                    const segLen = drawing ? 8 : 6;
                    const next = Math.min(pos + segLen, len);
                    if (drawing) {
                        g.moveTo(a.x + ux * pos, a.y + uy * pos);
                        g.lineTo(a.x + ux * next, a.y + uy * next);
                    }
                    pos = next;
                    drawing = !drawing;
                }
            }
        }

        clearRoadPlacementPreview() {
            if (this.roadPlacementPreviewContainer) {
                this.roadPlacementPreviewContainer.visible = false;
            }
            if (this.roadPlacementPreviewSpriteByKey && this.roadPlacementPreviewSpriteByKey.size > 0) {
                for (const sprite of this.roadPlacementPreviewSpriteByKey.values()) {
                    if (!sprite) continue;
                    syncRoadRenderSpriteTextureRetention(sprite, null);
                    sprite.visible = false;
                    if (Object.prototype.hasOwnProperty.call(sprite, "renderable")) {
                        sprite.renderable = false;
                    }
                }
            }
        }

        renderWallPlacementPreview(ctx) {
            const layer = this.layers.ui;
            if (!layer) return;
            if (!this.wallPlacementPreviewGraphics) {
                this.wallPlacementPreviewGraphics = new PIXI.Graphics();
                this.wallPlacementPreviewGraphics.name = "renderingWallPlacementPreview";
                this.wallPlacementPreviewGraphics.skipTransform = true;
                this.wallPlacementPreviewGraphics.interactive = false;
                this.wallPlacementPreviewGraphics.visible = false;
                layer.addChild(this.wallPlacementPreviewGraphics);
            } else if (this.wallPlacementPreviewGraphics.parent !== layer) {
                layer.addChild(this.wallPlacementPreviewGraphics);
            }

            const g = this.wallPlacementPreviewGraphics;
            g.clear();

            const wizard = (ctx && ctx.wizard) || global.wizard || null;
            const mapRef = (ctx && ctx.map) || (wizard && wizard.map) || global.map || null;
            const mousePosRef = this.getMousePosRef(ctx);
            if (wizard) wizard.wallPreviewPlacement = null;
            if (
                !wizard ||
                wizard.currentSpell !== "wall" ||
                !wizard.wallLayoutMode ||
                !wizard.wallStartPoint ||
                !mapRef ||
                !mousePosRef ||
                !Number.isFinite(mousePosRef.worldX) ||
                !Number.isFinite(mousePosRef.worldY)
            ) {
                g.visible = false;
                return;
            }

            const spellSystemRef = (typeof SpellSystem !== "undefined")
                ? SpellSystem
                : (global.SpellSystem || null);
            const adjustedWallDragPoint = (
                spellSystemRef &&
                typeof spellSystemRef.getAdjustedWallDragWorldPoint === "function"
            ) ? spellSystemRef.getAdjustedWallDragWorldPoint(wizard, mousePosRef.worldX, mousePosRef.worldY) : null;
            const dragWorldX = adjustedWallDragPoint && Number.isFinite(adjustedWallDragPoint.x)
                ? adjustedWallDragPoint.x
                : mousePosRef.worldX;
            const dragWorldY = adjustedWallDragPoint && Number.isFinite(adjustedWallDragPoint.y)
                ? adjustedWallDragPoint.y
                : mousePosRef.worldY;

            const startWorld = {
                x: Number(wizard.wallStartPoint.x),
                y: Number(wizard.wallStartPoint.y)
            };
            const endWorld = { x: Number(dragWorldX), y: Number(dragWorldY) };
            if (
                !Number.isFinite(startWorld.x) ||
                !Number.isFinite(startWorld.y) ||
                !Number.isFinite(endWorld.x) ||
                !Number.isFinite(endWorld.y)
            ) {
                g.visible = false;
                return;
            }

            let segments = [];
            let previewPlan = null;
            if (
                typeof global.WallSectionUnit !== "undefined" &&
                global.WallSectionUnit &&
                typeof global.WallSectionUnit.planPlacementFromWorldPoints === "function"
            ) {
                const plan = global.WallSectionUnit.planPlacementFromWorldPoints(mapRef, startWorld, endWorld, {
                    rawStartWorld: (
                        wizard.wallDragMouseStartWorld &&
                        Number.isFinite(wizard.wallDragMouseStartWorld.x) &&
                        Number.isFinite(wizard.wallDragMouseStartWorld.y)
                    ) ? {
                        x: Number(wizard.wallDragMouseStartWorld.x),
                        y: Number(wizard.wallDragMouseStartWorld.y)
                    } : { x: startWorld.x, y: startWorld.y },
                    startFromExistingWall: !!wizard.wallStartFromExistingWall,
                    startReferenceWall: wizard.wallStartReferenceWall || null
                });
                if (plan) {
                    previewPlan = plan;
                }
                if (plan && Array.isArray(plan.segments)) {
                    segments = plan.segments.slice();
                }
            }

            if (segments.length === 0) {
                g.visible = false;
                return;
            }

            const normalizedSegments = [];
            for (let i = 0; i < segments.length; i++) {
                const seg = segments[i];
                if (!seg || !seg.start || !seg.end) continue;
                const sx = Number(seg.start.x);
                const sy = Number(seg.start.y);
                const ex = Number(seg.end.x);
                const ey = Number(seg.end.y);
                if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(ex) || !Number.isFinite(ey)) continue;
                normalizedSegments.push({
                    start: { x: sx, y: sy },
                    end: { x: ex, y: ey },
                    direction: Number.isFinite(seg.direction) ? Number(seg.direction) : undefined
                });
            }
            wizard.wallPreviewPlacement = {
                startWorld: { x: startWorld.x, y: startWorld.y },
                endWorld: { x: endWorld.x, y: endWorld.y },
                rawStartWorld: (
                    wizard.wallDragMouseStartWorld &&
                    Number.isFinite(wizard.wallDragMouseStartWorld.x) &&
                    Number.isFinite(wizard.wallDragMouseStartWorld.y)
                ) ? {
                    x: Number(wizard.wallDragMouseStartWorld.x),
                    y: Number(wizard.wallDragMouseStartWorld.y)
                } : { x: startWorld.x, y: startWorld.y },
                plan: previewPlan,
                segments: normalizedSegments
            };

            g.lineStyle(2, 0xff2222, 0.95);
            const wallThickness = (wizard && Number.isFinite(wizard.selectedWallThickness))
                ? wizard.selectedWallThickness : 0.1;
            const halfT = wallThickness * 0.5;
            const wallLayer = wizard && Number.isFinite(wizard.currentLayer)
                ? Math.round(Number(wizard.currentLayer))
                : 0;
            const bottomZ = wizard && Number.isFinite(wizard.currentLayerBaseZ)
                ? Number(wizard.currentLayerBaseZ)
                : this.getLayerBaseZForLevel(wallLayer);
            for (let i = 0; i < segments.length; i++) {
                const seg = segments[i];
                if (!seg || !seg.start || !seg.end) continue;
                const sx = Number(seg.start.x);
                const sy = Number(seg.start.y);
                const ex = Number(seg.end.x);
                const ey = Number(seg.end.y);
                if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(ex) || !Number.isFinite(ey)) continue;
                const dx = ex - sx;
                const dy = ey - sy;
                const len = Math.hypot(dx, dy);
                if (len < 1e-6) continue;
                // Perpendicular normal
                const nx = -dy / len;
                const ny = dx / len;
                // Four corners of the base rectangle
                const al = this.camera.worldToScreen(sx + nx * halfT, sy + ny * halfT, bottomZ);
                const ar = this.camera.worldToScreen(sx - nx * halfT, sy - ny * halfT, bottomZ);
                const bl = this.camera.worldToScreen(ex + nx * halfT, ey + ny * halfT, bottomZ);
                const br = this.camera.worldToScreen(ex - nx * halfT, ey - ny * halfT, bottomZ);
                // Draw closed rectangle
                g.moveTo(al.x, al.y);
                g.lineTo(bl.x, bl.y);
                g.lineTo(br.x, br.y);
                g.lineTo(ar.x, ar.y);
                g.lineTo(al.x, al.y);
            }
            g.visible = true;
        }

        renderRoadPlacementPreview(ctx) {
            const layer = this.layers.ui;
            if (!layer) return;
            if (!this.roadPlacementPreviewContainer) {
                this.roadPlacementPreviewContainer = new PIXI.Container();
                this.roadPlacementPreviewContainer.name = "renderingRoadPlacementPreview";
                this.roadPlacementPreviewContainer.skipTransform = true;
                this.roadPlacementPreviewContainer.interactive = false;
                this.roadPlacementPreviewContainer.visible = false;
                layer.addChild(this.roadPlacementPreviewContainer);
            } else if (this.roadPlacementPreviewContainer.parent !== layer) {
                layer.addChild(this.roadPlacementPreviewContainer);
            }
            if (!this.roadPlacementPreviewSpriteByKey) {
                this.roadPlacementPreviewSpriteByKey = new Map();
            }

            const previewContainer = this.roadPlacementPreviewContainer;
            const previewSpriteByKey = this.roadPlacementPreviewSpriteByKey;

            const wizard = (ctx && ctx.wizard) || global.wizard || null;
            const mapRef = (ctx && ctx.map) || (wizard && wizard.map) || global.map || null;
            const mousePosRef = this.getMousePosRef(ctx);
            const RoadClass = (typeof global.Road !== "undefined") ? global.Road : null;
            if (
                !wizard ||
                wizard.currentSpell !== "buildroad" ||
                !wizard.roadLayoutMode ||
                !wizard.roadStartPoint ||
                !mapRef ||
                typeof mapRef.getHexLine !== "function" ||
                typeof mapRef.worldToNode !== "function" ||
                !RoadClass ||
                typeof RoadClass._getTextureForMaskAndPhase !== "function" ||
                !mousePosRef ||
                !Number.isFinite(mousePosRef.worldX) ||
                !Number.isFinite(mousePosRef.worldY)
            ) {
                this.clearRoadPlacementPreview();
                return;
            }

            const startNode = wizard.roadStartPoint;
            const endNode = mapRef.worldToNode(mousePosRef.worldX, mousePosRef.worldY);
            if (!startNode || !endNode) {
                this.clearRoadPlacementPreview();
                return;
            }

            const configuredRoadWidth = Number.isFinite(wizard.selectedRoadWidth)
                ? Math.max(1, Math.min(5, Math.round(Number(wizard.selectedRoadWidth))))
                : (
                    (typeof roadWidth !== "undefined" && Number.isFinite(roadWidth))
                        ? Number(roadWidth)
                        : ((Number.isFinite(global.roadWidth) ? Number(global.roadWidth) : 3))
                );
            const width = (startNode === endNode) ? 1 : configuredRoadWidth;
            const roadNodes = mapRef.getHexLine(startNode, endNode, width);
            if (!Array.isArray(roadNodes) || roadNodes.length === 0) {
                this.clearRoadPlacementPreview();
                return;
            }

            const oddDirections = Array.isArray(RoadClass._oddDirections) && RoadClass._oddDirections.length > 0
                ? RoadClass._oddDirections.slice()
                : [1, 3, 5, 7, 9, 11];
            const fillTexturePath = (
                typeof wizard.selectedFlooringTexture === "string" &&
                wizard.selectedFlooringTexture.length > 0
            )
                ? wizard.selectedFlooringTexture
                : (
                    (typeof RoadClass._defaultFillTexturePath === "string" && RoadClass._defaultFillTexturePath.length > 0)
                        ? RoadClass._defaultFillTexturePath
                        : "/assets/images/flooring/dirt.jpg"
                );

            const previewKeys = new Set();
            const roadNodeByKey = new Map();
            for (let i = 0; i < roadNodes.length; i++) {
                const node = roadNodes[i];
                if (!node || !Number.isFinite(node.x) || !Number.isFinite(node.y)) continue;
                const key = `${node.xindex},${node.yindex}`;
                if (previewKeys.has(key)) continue;
                previewKeys.add(key);
                roadNodeByKey.set(key, node);
            }

            const hasRoadObjectAtNode = (node) => {
                if (!node || !Array.isArray(node.objects)) return false;
                if (RoadClass && typeof RoadClass.hasMatchingRoadAtNode === "function") {
                    return RoadClass.hasMatchingRoadAtNode(node, fillTexturePath);
                }
                for (let i = 0; i < node.objects.length; i++) {
                    const obj = node.objects[i];
                    if (obj && obj.type === "road" && !obj.gone && !obj.vanishing) return true;
                }
                return false;
            };

            const activeKeys = new Set();
            for (const [key, node] of roadNodeByKey.entries()) {
                const neighborDirections = [];
                for (let i = 0; i < oddDirections.length; i++) {
                    const dir = oddDirections[i];
                    const neighbor = node.neighbors && node.neighbors[dir];
                    if (!neighbor) continue;
                    const neighborKey = `${neighbor.xindex},${neighbor.yindex}`;
                    if (previewKeys.has(neighborKey) || hasRoadObjectAtNode(neighbor)) {
                        neighborDirections.push(dir);
                    }
                }
                const mask = (typeof RoadClass._getNeighborMask === "function")
                    ? RoadClass._getNeighborMask(neighborDirections)
                    : 0;
                const roadScreenWidth = this.camera.viewscale * 1.1547;
                const roadScreenHeight = this.camera.viewscale * this.camera.xyratio;
                const lodMetric = (typeof RoadClass.getFillTextureLodMetric === "function")
                    ? RoadClass.getFillTextureLodMetric(fillTexturePath, roadScreenWidth, roadScreenHeight)
                    : Math.max(roadScreenWidth, roadScreenHeight);
                const resolvedFillTexturePath = (typeof RoadClass.resolveFillTexturePathForSize === "function")
                    ? RoadClass.resolveFillTexturePathForSize(fillTexturePath, lodMetric)
                    : fillTexturePath;
                const metrics = (typeof RoadClass._getTextureTileMetrics === "function")
                    ? RoadClass._getTextureTileMetrics(resolvedFillTexturePath)
                    : { tileW: 1, tileH: 1 };
                const pixelsPerWorldUnit = Number.isFinite(RoadClass._pixelsPerWorldUnit)
                    ? Number(RoadClass._pixelsPerWorldUnit)
                    : ((128 * 2) / 1.1547);
                const phaseX = (((Number(node.x) * pixelsPerWorldUnit) % metrics.tileW) + metrics.tileW) % metrics.tileW;
                const phaseY = (((Number(node.y) * pixelsPerWorldUnit) % metrics.tileH) + metrics.tileH) % metrics.tileH;
                const textureRef = RoadClass._getTextureForMaskAndPhase(mask, phaseX, phaseY, resolvedFillTexturePath);
                const textureCacheKey = (textureRef && typeof textureRef.key === "string") ? textureRef.key : "";
                const texture = (textureRef && textureRef.entry && isRenderablePixiTexture(textureRef.entry.texture))
                    ? textureRef.entry.texture
                    : null;
                if (!texture) {
                    const existingSprite = previewSpriteByKey.get(key);
                    if (existingSprite) {
                        syncRoadRenderSpriteTextureRetention(existingSprite, null);
                        existingSprite.visible = false;
                        if (Object.prototype.hasOwnProperty.call(existingSprite, "renderable")) {
                            existingSprite.renderable = false;
                        }
                    }
                    continue;
                }

                let sprite = previewSpriteByKey.get(key);
                if (!sprite) {
                    sprite = new PIXI.Sprite(texture);
                    sprite.anchor.set(0.5, 0.5);
                    sprite.name = `renderingRoadPlacementTile:${key}`;
                    previewSpriteByKey.set(key, sprite);
                    previewContainer.addChild(sprite);
                } else if (sprite.texture !== texture) {
                    sprite.texture = texture;
                }
                syncRoadRenderSpriteTextureRetention(sprite, { _roadTextureCacheKey: textureCacheKey });
                if (sprite.parent !== previewContainer) {
                    previewContainer.addChild(sprite);
                }

                const center = this.camera.worldToScreen(Number(node.x), Number(node.y), 0);
                sprite.x = center.x;
                sprite.y = center.y;
                sprite.width = this.camera.viewscale * 1.1547;
                sprite.height = this.camera.viewscale * this.camera.xyratio;
                sprite.alpha = 0.5;
                sprite.visible = true;
                if (Object.prototype.hasOwnProperty.call(sprite, "renderable")) {
                    sprite.renderable = true;
                }
                activeKeys.add(key);
            }

            for (const [key, sprite] of previewSpriteByKey.entries()) {
                if (!sprite || activeKeys.has(key)) continue;
                syncRoadRenderSpriteTextureRetention(sprite, null);
                sprite.visible = false;
                if (Object.prototype.hasOwnProperty.call(sprite, "renderable")) {
                    sprite.renderable = false;
                }
            }

            previewContainer.visible = activeKeys.size > 0;
            if (previewContainer.visible) this.promoteInteriorPresentationDisplayObject(previewContainer, ctx);
        }

        clearFirewallPlacementPreview() {
            if (!this.firewallPlacementPreviewGraphics) return;
            this.firewallPlacementPreviewGraphics.clear();
            this.firewallPlacementPreviewGraphics.visible = false;
        }

        renderFirewallPlacementPreview(ctx) {
            const layer = this.layers.ui;
            if (!layer) return;
            if (!this.firewallPlacementPreviewGraphics) {
                this.firewallPlacementPreviewGraphics = new PIXI.Graphics();
                this.firewallPlacementPreviewGraphics.name = "renderingFirewallPlacementPreview";
                this.firewallPlacementPreviewGraphics.skipTransform = true;
                this.firewallPlacementPreviewGraphics.interactive = false;
                this.firewallPlacementPreviewGraphics.visible = false;
                layer.addChild(this.firewallPlacementPreviewGraphics);
            } else if (this.firewallPlacementPreviewGraphics.parent !== layer) {
                layer.addChild(this.firewallPlacementPreviewGraphics);
            }

            const g = this.firewallPlacementPreviewGraphics;
            g.clear();

            const wizard = (ctx && ctx.wizard) || global.wizard || null;
            const mapRef = (ctx && ctx.map) || (wizard && wizard.map) || global.map || null;
            const mousePosRef = this.getMousePosRef(ctx);
            if (
                !wizard ||
                wizard.currentSpell !== "firewall" ||
                !wizard.firewallLayoutMode ||
                !wizard.firewallStartPoint ||
                !mapRef ||
                !mousePosRef ||
                !Number.isFinite(mousePosRef.worldX) ||
                !Number.isFinite(mousePosRef.worldY)
            ) {
                g.visible = false;
                return;
            }

            const startWorld = {
                x: Number(wizard.firewallStartPoint.x),
                y: Number(wizard.firewallStartPoint.y)
            };
            const endWorld = { x: Number(mousePosRef.worldX), y: Number(mousePosRef.worldY) };
            if (
                !Number.isFinite(startWorld.x) ||
                !Number.isFinite(startWorld.y) ||
                !Number.isFinite(endWorld.x) ||
                !Number.isFinite(endWorld.y)
            ) {
                g.visible = false;
                return;
            }

            const screenStart = this.camera.worldToScreen(startWorld.x, startWorld.y, 0);
            const screenEnd = this.camera.worldToScreen(endWorld.x, endWorld.y, 0);
            if (!screenStart || !screenEnd) {
                g.visible = false;
                return;
            }

            // Draw red preview line
            g.lineStyle(3, 0xff2222, 0.9);
            g.moveTo(screenStart.x, screenStart.y);
            g.lineTo(screenEnd.x, screenEnd.y);

            // Draw tick marks along the line at emitter spacing intervals
            const dx = endWorld.x - startWorld.x;
            const dy = endWorld.y - startWorld.y;
            const dist = Math.hypot(dx, dy);
            const spacing = 0.5;
            const steps = Math.max(1, Math.ceil(dist / spacing));
            const perpScreenX = -(screenEnd.y - screenStart.y);
            const perpScreenY = (screenEnd.x - screenStart.x);
            const perpLen = Math.hypot(perpScreenX, perpScreenY);
            const tickHalfLen = 4;
            if (perpLen > 1e-6) {
                const nx = (perpScreenX / perpLen) * tickHalfLen;
                const ny = (perpScreenY / perpLen) * tickHalfLen;
                g.lineStyle(2, 0xff4444, 0.7);
                for (let i = 0; i <= steps; i++) {
                    const t = steps === 0 ? 0 : i / steps;
                    const px = screenStart.x + (screenEnd.x - screenStart.x) * t;
                    const py = screenStart.y + (screenEnd.y - screenStart.y) * t;
                    g.moveTo(px - nx, py - ny);
                    g.lineTo(px + nx, py + ny);
                }
            }

            g.visible = true;
            this.promoteInteriorPresentationDisplayObject(g, ctx);
        }

        clearTriggerAreaPlacementPreview() {
            if (!this.triggerAreaPlacementPreviewGraphics) return;
            this.triggerAreaPlacementPreviewGraphics.clear();
            this.triggerAreaPlacementPreviewGraphics.visible = false;
        }

        renderTriggerAreaPlacementPreview(ctx) {
            const layer = this.layers.ui;
            if (!layer) return;
            if (!this.triggerAreaPlacementPreviewGraphics) {
                this.triggerAreaPlacementPreviewGraphics = new PIXI.Graphics();
                this.triggerAreaPlacementPreviewGraphics.name = "renderingTriggerAreaPlacementPreview";
                this.triggerAreaPlacementPreviewGraphics.skipTransform = true;
                this.triggerAreaPlacementPreviewGraphics.interactive = false;
                this.triggerAreaPlacementPreviewGraphics.visible = false;
                layer.addChild(this.triggerAreaPlacementPreviewGraphics);
            } else if (this.triggerAreaPlacementPreviewGraphics.parent !== layer) {
                layer.addChild(this.triggerAreaPlacementPreviewGraphics);
            }

            const g = this.triggerAreaPlacementPreviewGraphics;
            g.clear();
            const wizard = (ctx && ctx.wizard) || global.wizard || null;
            const spellSystemRef = (typeof SpellSystem !== "undefined")
                ? SpellSystem
                : (global.SpellSystem || null);
            if (
                !wizard ||
                (wizard.currentSpell !== "triggerarea" && wizard.currentSpell !== "floorshape" && wizard.currentSpell !== "floorhole") ||
                !spellSystemRef ||
                typeof spellSystemRef.getTriggerAreaPlacementPreview !== "function"
            ) {
                g.visible = false;
                return;
            }

            const mousePosRef = this.getMousePosRef(ctx);
            const floorShapeMouseWorldPos = (mousePosRef && Number.isFinite(mousePosRef.worldX) && Number.isFinite(mousePosRef.worldY))
                ? { x: Number(mousePosRef.worldX), y: Number(mousePosRef.worldY) }
                : null;
            const preview = wizard.currentSpell === "floorshape" && typeof spellSystemRef.getFloorShapePlacementPreview === "function"
                ? spellSystemRef.getFloorShapePlacementPreview(wizard, { mouseWorldPos: floorShapeMouseWorldPos })
                : (wizard.currentSpell === "floorhole" && typeof spellSystemRef.getFloorHolePlacementPreview === "function"
                    ? spellSystemRef.getFloorHolePlacementPreview(wizard)
                    : spellSystemRef.getTriggerAreaPlacementPreview(wizard));
            if (!preview || !Array.isArray(preview.points) || preview.points.length === 0) {
                g.visible = false;
                return;
            }
            const points = preview.points;
            const first = points[0];
            const previewZ = (wizard.currentSpell === "floorshape" || wizard.currentSpell === "floorhole") && Number.isFinite(global.selectedFloorEditLevel)
                ? Math.round(Number(global.selectedFloorEditLevel)) * 3
                : 0;

            // Wall-loop snap mode: highlight the top faces of all wall sections and draw a
            // closed polygon preview at the selected floor level without a ghost cursor line.
            if (preview.isWallLoop && Array.isArray(preview.wallSections) && preview.wallSections.length > 0) {
                for (let si = 0; si < preview.wallSections.length; si++) {
                    const section = preview.wallSections[si];
                    if (!section || typeof section.getWallProfile !== "function") continue;
                    const profile = section.getWallProfile();
                    if (!profile) continue;
                    const topZ = Math.max(0, Number(section.bottomZ) || 0) + Math.max(0, Number(section.height) || 0);
                    const topFace = [
                        this.camera.worldToScreen(Number(profile.aLeft.x), Number(profile.aLeft.y), topZ),
                        this.camera.worldToScreen(Number(profile.bLeft.x), Number(profile.bLeft.y), topZ),
                        this.camera.worldToScreen(Number(profile.bRight.x), Number(profile.bRight.y), topZ),
                        this.camera.worldToScreen(Number(profile.aRight.x), Number(profile.aRight.y), topZ)
                    ];
                    if (!topFace.every(pt => Number.isFinite(pt.x) && Number.isFinite(pt.y))) continue;
                    g.lineStyle(2, 0x66ffaa, 0.55);
                    g.beginFill(0x66ffaa, 0.13);
                    g.moveTo(topFace[0].x, topFace[0].y);
                    g.lineTo(topFace[1].x, topFace[1].y);
                    g.lineTo(topFace[2].x, topFace[2].y);
                    g.lineTo(topFace[3].x, topFace[3].y);
                    g.closePath();
                    g.endFill();
                }
                // Draw closed floor polygon outline at the selected level.
                const firstScreen = this.camera.worldToScreen(Number(first.x), Number(first.y), previewZ);
                if (firstScreen && Number.isFinite(firstScreen.x) && Number.isFinite(firstScreen.y)) {
                    g.lineStyle(2, 0x66ffaa, 0.9);
                    g.moveTo(firstScreen.x, firstScreen.y);
                    for (let i = 1; i < points.length; i++) {
                        const sp = this.camera.worldToScreen(Number(points[i].x), Number(points[i].y), previewZ);
                        if (Number.isFinite(sp.x) && Number.isFinite(sp.y)) g.lineTo(sp.x, sp.y);
                    }
                    g.closePath();
                }
                g.visible = true;
                return;
            }

            const startScreen = this.camera.worldToScreen(Number(first.x), Number(first.y), previewZ);
            if (!startScreen || !Number.isFinite(startScreen.x) || !Number.isFinite(startScreen.y)) {
                g.visible = false;
                return;
            }

            const hasMouseWorld = !!(
                mousePosRef &&
                Number.isFinite(mousePosRef.worldX) &&
                Number.isFinite(mousePosRef.worldY)
            );
            const mouseScreen = hasMouseWorld
                ? this.camera.worldToScreen(Number(mousePosRef.worldX), Number(mousePosRef.worldY), previewZ)
                : null;

            const lineColor = wizard.currentSpell === "floorshape"
                ? 0xffd700
                : (wizard.currentSpell === "floorhole" ? 0xff5a5a : 0xffffff);
            const startColor = wizard.currentSpell === "floorshape"
                ? 0xfff0a0
                : (wizard.currentSpell === "floorhole" ? 0xffb0b0 : 0x9ee7ff);
            g.lineStyle(2, lineColor, 0.95);
            g.moveTo(startScreen.x, startScreen.y);
            for (let i = 1; i < points.length; i++) {
                const pt = points[i];
                const sp = this.camera.worldToScreen(Number(pt.x), Number(pt.y), previewZ);
                g.lineTo(sp.x, sp.y);
            }
            if (mouseScreen && Number.isFinite(mouseScreen.x) && Number.isFinite(mouseScreen.y)) {
                g.lineTo(mouseScreen.x, mouseScreen.y);
            }

            g.lineStyle(2, startColor, 0.9);
            g.drawCircle(startScreen.x, startScreen.y, 5);
            g.visible = true;
        }

        clearFloorEditorPolygonOverlay() {
            if (!this.floorEditorPolygonOverlayGraphics) return;
            this.floorEditorPolygonOverlayGraphics.clear();
            this.floorEditorPolygonOverlayGraphics.visible = false;
        }

        isLayerCutawayDebugVisible() {
            return global.renderingShowLayerCutawayDebugAreas !== false;
        }

        clearLayerCutawayDebugOverlay() {
            if (!this.layerCutawayDebugGraphics) return;
            this.layerCutawayDebugGraphics.clear();
            this.layerCutawayDebugGraphics.visible = false;
        }

        drawLayerCutawayDebugRing(g, points, baseZ) {
            const ring = normalizeFloorVisualPointList(points);
            if (!g || ring.length < 3 || !this.camera) return false;
            let started = false;
            for (let i = 0; i < ring.length; i++) {
                const screen = this.camera.worldToScreen(ring[i].x, ring[i].y, baseZ);
                if (!screen || !Number.isFinite(screen.x) || !Number.isFinite(screen.y)) return false;
                if (!started) {
                    g.moveTo(screen.x, screen.y);
                    started = true;
                } else {
                    g.lineTo(screen.x, screen.y);
                }
            }
            if (!started) return false;
            g.closePath();
            return true;
        }

        renderLayerCutawayDebugOverlay(ctx) {
            global.renderingLayerCutawayDebugState = {
                active: false,
                disabled: true,
                triggers: []
            };
            this.clearLayerCutawayDebugOverlay();
        }

        isFloorEditorToolSetActive(ctx) {
            const wizard = (ctx && ctx.wizard) || global.wizard || null;
            const spellName = wizard && typeof wizard.currentSpell === "string"
                ? wizard.currentSpell
                : "";
            if (spellName === "flooredit") return true;
            const spellSystemRef = (typeof SpellSystem !== "undefined")
                ? SpellSystem
                : (global.SpellSystem || null);
            if (spellSystemRef && typeof spellSystemRef.isFloorEditorToolName === "function") {
                return !!spellSystemRef.isFloorEditorToolName(spellName);
            }
            return spellName === "floorshape" || spellName === "floorhole" || spellName === "floorstair";
        }

        getFloorEditorOverlayLevel(ctx) {
            const wizard = (ctx && ctx.wizard) || global.wizard || null;
            if (wizard && Number.isFinite(wizard.selectedFloorEditLevel)) {
                return this.getLayerIndexFromValue(wizard.selectedFloorEditLevel, 0);
            }
            return this.getSelectedFloorVisualLevel();
        }

        drawFloorEditorOverlayRing(g, points, baseZ, options = {}) {
            const ring = normalizeFloorVisualPointList(points);
            if (!g || ring.length < 3) return false;
            const screenPoints = [];
            for (let i = 0; i < ring.length; i++) {
                const screen = this.camera.worldToScreen(ring[i].x, ring[i].y, baseZ);
                if (!screen || !Number.isFinite(screen.x) || !Number.isFinite(screen.y)) return false;
                screenPoints.push(screen);
            }

            const alpha = Number.isFinite(options.alpha) ? Number(options.alpha) : 0.95;
            const radius = Number.isFinite(options.radius) ? Number(options.radius) : 3.5;
            const selectedVertexIndex = Number.isInteger(options.selectedVertexIndex)
                ? options.selectedVertexIndex
                : -1;
            g.lineStyle(2, 0xff0000, alpha);
            g.moveTo(screenPoints[0].x, screenPoints[0].y);
            for (let i = 1; i < screenPoints.length; i++) {
                g.lineTo(screenPoints[i].x, screenPoints[i].y);
            }
            g.closePath();

            for (let i = 0; i < screenPoints.length; i++) {
                const selected = i === selectedVertexIndex;
                g.lineStyle(selected ? 2 : 1, selected ? 0xffffff : 0xffffff, selected ? 1 : 0.9);
                g.beginFill(selected ? 0xffffff : 0xff0000, selected ? 1 : 0.95);
                g.drawCircle(screenPoints[i].x, screenPoints[i].y, selected ? radius + 3 : radius);
                g.endFill();
            }
            return true;
        }

        renderFloorEditorPolygonOverlay(ctx) {
            const layer = this.layers && this.layers.ui ? this.layers.ui : null;
            if (!layer) return;
            if (!this.floorEditorPolygonOverlayGraphics) {
                this.floorEditorPolygonOverlayGraphics = new PIXI.Graphics();
                this.floorEditorPolygonOverlayGraphics.name = "renderingFloorEditorPolygonOverlay";
                this.floorEditorPolygonOverlayGraphics.skipTransform = true;
                this.floorEditorPolygonOverlayGraphics.interactive = false;
                this.floorEditorPolygonOverlayGraphics.visible = false;
                layer.addChild(this.floorEditorPolygonOverlayGraphics);
            } else if (this.floorEditorPolygonOverlayGraphics.parent !== layer) {
                layer.addChild(this.floorEditorPolygonOverlayGraphics);
            }

            const g = this.floorEditorPolygonOverlayGraphics;
            g.clear();
            if (!this.isFloorEditorToolSetActive(ctx)) {
                g.visible = false;
                return;
            }

            const mapRef = (ctx && ctx.map) || global.map || null;
            if (!mapRef || !(mapRef.floorsById instanceof Map)) {
                g.visible = false;
                return;
            }

            const selectedLevel = this.getFloorEditorOverlayLevel(ctx);
            const wizard = (ctx && ctx.wizard) || global.wizard || null;
            const spellSystemRef = (typeof SpellSystem !== "undefined")
                ? SpellSystem
                : (global.SpellSystem || null);
            const selection = (
                wizard &&
                spellSystemRef &&
                typeof spellSystemRef.getFloorEditorVertexSelection === "function"
            ) ? spellSystemRef.getFloorEditorVertexSelection(wizard) : null;
            let drawn = 0;
            for (const fragment of mapRef.floorsById.values()) {
                if (!fragment) continue;
                const level = Number.isFinite(fragment.level) ? Math.round(Number(fragment.level)) : 0;
                if (level !== selectedLevel) continue;
                if (fragment._prototypeGroundFloor === true && level === 0) continue;
                const outer = Array.isArray(fragment.visibilityPolygon) && fragment.visibilityPolygon.length >= 3
                    ? fragment.visibilityPolygon
                    : fragment.outerPolygon;
                const baseZ = Number.isFinite(fragment.nodeBaseZ)
                    ? Number(fragment.nodeBaseZ)
                    : this.getLayerBaseZForLevel(level);
                const fragmentId = typeof fragment.fragmentId === "string" ? fragment.fragmentId : "";
                const outerSelectedIndex = (
                    selection &&
                    selection.fragmentId === fragmentId &&
                    selection.ringKind === "outer"
                ) ? selection.vertexIndex : -1;
                if (this.drawFloorEditorOverlayRing(g, outer, baseZ, { alpha: 0.98, radius: 3.5, selectedVertexIndex: outerSelectedIndex })) {
                    drawn += 1;
                }
                const holes = Array.isArray(fragment.visibilityHoles) && fragment.visibilityHoles.length > 0
                    ? fragment.visibilityHoles
                    : (Array.isArray(fragment.holes) ? fragment.holes : []);
                for (let h = 0; h < holes.length; h++) {
                    const holeSelectedIndex = (
                        selection &&
                        selection.fragmentId === fragmentId &&
                        selection.ringKind === "hole" &&
                        selection.holeIndex === h
                    ) ? selection.vertexIndex : -1;
                    if (this.drawFloorEditorOverlayRing(g, holes[h], baseZ, { alpha: 0.8, radius: 3, selectedVertexIndex: holeSelectedIndex })) {
                        drawn += 1;
                    }
                }
            }
            g.visible = drawn > 0;
        }

        buildPlaceObjectPreviewRenderItem(ctx) {
            const wizard = (ctx && ctx.wizard) || global.wizard || null;
            if (!wizard || wizard.currentSpell !== "placeobject" || wizard.editorPlacementActive !== true) {
                return null;
            }
            const mousePosRef = this.getMousePosRef(ctx);
            if (!mousePosRef || !Number.isFinite(mousePosRef.worldX) || !Number.isFinite(mousePosRef.worldY)) {
                return null;
            }

            const texturePath = (
                typeof wizard.selectedPlaceableTexturePath === "string" &&
                wizard.selectedPlaceableTexturePath.length > 0
            ) ? wizard.selectedPlaceableTexturePath : "/assets/images/doors/door5.png";
            const selectedCategory = (
                typeof wizard.selectedPlaceableCategory === "string" &&
                wizard.selectedPlaceableCategory.length > 0
            ) ? wizard.selectedPlaceableCategory : "doors";
            const rawAxis = (typeof wizard.selectedPlaceableRotationAxis === "string")
                ? wizard.selectedPlaceableRotationAxis.trim().toLowerCase()
                : "";
            const rotationAxis = (rawAxis === "spatial" || rawAxis === "visual" || rawAxis === "none" || rawAxis === "ground")
                ? rawAxis
                : ((selectedCategory === "doors" || selectedCategory === "windows") ? "spatial" : "visual");
            const placementRotation = Number.isFinite(wizard.selectedPlaceableRotation)
                ? Number(wizard.selectedPlaceableRotation)
                : 0;
            const effectivePlacementRotation = (rotationAxis === "none") ? 0 : placementRotation;

            if (!this.placeObjectPreviewSprite) {
                this.placeObjectPreviewSprite = new PIXI.Sprite(PIXI.Texture.from(texturePath));
                this.placeObjectPreviewSprite.anchor.set(0.5, 0.5);
                this.placeObjectPreviewSprite.alpha = 0.5;
                this.placeObjectPreviewSprite.interactive = false;
                this.placeObjectPreviewSprite.visible = false;
                this.placeObjectPreviewTexturePath = texturePath;
            } else if (this.placeObjectPreviewTexturePath !== texturePath) {
                this.placeObjectPreviewSprite.texture = PIXI.Texture.from(texturePath);
                this.placeObjectPreviewTexturePath = texturePath;
            }

            const mapRef = (ctx && ctx.map) || wizard.map || global.map || null;
            const placementLayer = this.getLayerIndexFromValue(
                Number.isFinite(wizard.currentLayer)
                    ? wizard.currentLayer
                    : (Number.isFinite(wizard.selectedFloorEditLevel) ? wizard.selectedFloorEditLevel : 0),
                0
            );
            const placementLayerBaseZ = Number.isFinite(wizard.currentLayerBaseZ)
                ? Number(wizard.currentLayerBaseZ)
                : this.getLayerBaseZForLevel(placementLayer);
            const projectedLayerPoint = this.resolveScreenPointOnLayerPlane(
                mousePosRef.screenX,
                mousePosRef.screenY,
                placementLayerBaseZ,
                mapRef,
                wizard
            );
            const rawWorldX = projectedLayerPoint && Number.isFinite(projectedLayerPoint.x)
                ? Number(projectedLayerPoint.x)
                : mousePosRef.worldX;
            const rawWorldY = projectedLayerPoint && Number.isFinite(projectedLayerPoint.y)
                ? Number(projectedLayerPoint.y)
                : mousePosRef.worldY;
            const worldX = (mapRef && typeof mapRef.wrapWorldX === "function")
                ? mapRef.wrapWorldX(rawWorldX)
                : rawWorldX;
            const worldY = (mapRef && typeof mapRef.wrapWorldY === "function")
                ? mapRef.wrapWorldY(rawWorldY)
                : rawWorldY;
            const supportsWallSnapPlacement = selectedCategory === "windows" || selectedCategory === "doors";
            const requiresWallSnapPlacement = selectedCategory === "windows";
            const isRoofPlacement = selectedCategory === "roof";
            const roofApi = (typeof global.Roof === "function")
                ? global.Roof
                : ((typeof Roof === "function") ? Roof : null);
            const roofDiagnostics = (
                isRoofPlacement &&
                roofApi &&
                typeof roofApi.getPlacementDiagnostics === "function"
            ) ? roofApi.getPlacementDiagnostics(wizard, worldX, worldY, { maxDepth: 12 }) : null;
            const spellSystemRef = (typeof SpellSystem !== "undefined")
                ? SpellSystem
                : (global.SpellSystem || null);
            const snapPlacement = (
                (supportsWallSnapPlacement || isRoofPlacement) &&
                spellSystemRef &&
                typeof spellSystemRef.getPlaceObjectPlacementCandidate === "function"
            ) ? spellSystemRef.getPlaceObjectPlacementCandidate(wizard, worldX, worldY) : null;
            if (isRoofPlacement) {
                if (!roofDiagnostics || !roofDiagnostics.hoveredSection) return null;
                const previewItem = this.ensurePlaceObjectPreviewItem(mapRef);
                previewItem.roofHighlightOnly = true;
                previewItem.roofLoopSections = Array.isArray(roofDiagnostics.wallSections)
                    ? roofDiagnostics.wallSections.slice()
                    : [roofDiagnostics.hoveredSection];
                previewItem.centerSnapGuide = null;
                previewItem.traversalLayer = placementLayer;
                previewItem.level = placementLayer;
                previewItem._renderTraversalLayer = placementLayer;
                previewItem._renderLayerBaseZ = placementLayerBaseZ;
                return previewItem;
            }
            const useSnapPlacement = !!(snapPlacement && snapPlacement.targetWall);
            const useRoofPlacement = !!(
                isRoofPlacement &&
                useSnapPlacement &&
                Number.isFinite(snapPlacement.previewX) &&
                Number.isFinite(snapPlacement.previewY) &&
                Number.isFinite(snapPlacement.previewZ)
            );
            if (requiresWallSnapPlacement) {
                if (
                    !useSnapPlacement ||
                    !Number.isFinite(snapPlacement.snappedX) ||
                    !Number.isFinite(snapPlacement.snappedY) ||
                    !Number.isFinite(snapPlacement.snappedRotationDeg) ||
                    !Number.isFinite(snapPlacement.snappedZ)
                ) {
                    return null;
                }
            }
            if (isRoofPlacement && !useRoofPlacement) return null;
            const placeableScale = Number.isFinite(wizard.selectedPlaceableScale)
                ? Number(wizard.selectedPlaceableScale)
                : 1;
            const scaleMin = Number.isFinite(wizard.selectedPlaceableScaleMin) ? wizard.selectedPlaceableScaleMin : 0.2;
            const scaleMax = Number.isFinite(wizard.selectedPlaceableScaleMax) ? wizard.selectedPlaceableScaleMax : 5;
            const clampedScale = Math.max(scaleMin, Math.min(scaleMax, placeableScale));
            const selectedSizing = (
                wizard.selectedPlaceableSizingByTexture &&
                typeof wizard.selectedPlaceableSizingByTexture === "object"
            ) ? wizard.selectedPlaceableSizingByTexture[texturePath] : null;
            const scaledDimensions = (
                typeof globalThis !== "undefined" &&
                typeof globalThis.resolvePlaceableScaledDimensions === "function"
            ) ? globalThis.resolvePlaceableScaledDimensions(selectedSizing, clampedScale) : {
                width: clampedScale,
                height: clampedScale
            };
            const selectedAnchorY = Number.isFinite(wizard.selectedPlaceableAnchorY)
                ? Number(wizard.selectedPlaceableAnchorY)
                : 1;
            const effectiveAnchorY = isRoofPlacement
                ? 0.5
                : ((useSnapPlacement && selectedCategory === "windows") ? 0.5 : selectedAnchorY);
            const yScale = Math.max(0.1, Math.abs(Number.isFinite(this.camera.xyratio) ? this.camera.xyratio : 0.66));
            const placementYOffset = (rotationAxis === "spatial" || rotationAxis === "ground" || isRoofPlacement)
                ? 0
                : (((effectiveAnchorY - 0.5) * scaledDimensions.height) / yScale);
            const spatialAnchorPlacementYOffset = (
                rotationAxis === "spatial" &&
                !useSnapPlacement &&
                !useRoofPlacement &&
                (selectedCategory === "doors" || selectedCategory === "windows")
            )
                ? (((effectiveAnchorY - 0.5) * scaledDimensions.height) / yScale)
                : 0;
            const previewX = useRoofPlacement
                ? Number(snapPlacement.previewX)
                : (useSnapPlacement ? snapPlacement.snappedX : worldX);
            let placedY = useRoofPlacement
                ? Number(snapPlacement.previewY)
                : (useSnapPlacement ? snapPlacement.snappedY : (worldY + placementYOffset + spatialAnchorPlacementYOffset));
            if (mapRef && typeof mapRef.wrapWorldY === "function") {
                placedY = mapRef.wrapWorldY(placedY);
            }
            const renderDepthOffset = Number.isFinite(wizard.selectedPlaceableRenderOffset)
                ? Number(wizard.selectedPlaceableRenderOffset)
                : 0;
            this.placeObjectPreviewSprite.tint = 0xFFFFFF;
            this.placeObjectPreviewSprite.visible = true;
            if (Object.prototype.hasOwnProperty.call(this.placeObjectPreviewSprite, "renderable")) {
                this.placeObjectPreviewSprite.renderable = true;
            }
            const previewItem = this.ensurePlaceObjectPreviewItem(mapRef);
            previewItem.x = previewX;
            previewItem.y = useRoofPlacement
                ? Number(snapPlacement.previewY)
                : (useSnapPlacement ? snapPlacement.snappedY : placedY);
            previewItem.z = useRoofPlacement
                ? Number(snapPlacement.previewZ)
                : (useSnapPlacement ? Number(snapPlacement.snappedZ) : 0);
            previewItem.width = scaledDimensions.width;
            previewItem.height = scaledDimensions.height;
            previewItem.renderZ = placedY + renderDepthOffset;
            previewItem.previewAlpha = 0.5;
            previewItem.texturePath = texturePath;
            previewItem.category = selectedCategory;
            previewItem.traversalLayer = placementLayer;
            previewItem.level = placementLayer;
            previewItem._renderTraversalLayer = placementLayer;
            previewItem._renderLayerBaseZ = placementLayerBaseZ;
            
            if (wizard.selectedPlaceableCompositeLayersByTexture && wizard.selectedPlaceableCompositeLayersByTexture[texturePath]) {
                previewItem.compositeLayers = wizard.selectedPlaceableCompositeLayersByTexture[texturePath];
            } else {
                previewItem.compositeLayers = null;
            }

            previewItem.placeableAnchorX = Number.isFinite(wizard.selectedPlaceableAnchorX)
                ? ((useSnapPlacement && !useRoofPlacement) ? 0.5 : Number(wizard.selectedPlaceableAnchorX))
                : 0.5;
            previewItem.placeableAnchorY = effectiveAnchorY;
            // Keep the preview sprite's Pixi anchor in sync with the item's
            // logical anchor so that updateDepthBillboardMesh (which reads
            // sprite.anchor for the standard billboard path) produces the
            // same quad geometry as the final placed object.
            if (this.placeObjectPreviewSprite && this.placeObjectPreviewSprite.anchor) {
                this.placeObjectPreviewSprite.anchor.set(
                    previewItem.placeableAnchorX,
                    previewItem.placeableAnchorY
                );
            }
            previewItem.rotationAxis = (useSnapPlacement && !useRoofPlacement) ? "spatial" : rotationAxis;
            previewItem.placementRotation = (useSnapPlacement && !useRoofPlacement)
                ? snapPlacement.snappedRotationDeg
                : effectivePlacementRotation;
            previewItem.mountedSectionId = (
                useSnapPlacement &&
                !useRoofPlacement &&
                Number.isInteger(snapPlacement.mountedSectionId)
            ) ? Number(snapPlacement.mountedSectionId) : null;
            previewItem.mountedWallLineGroupId = (
                useSnapPlacement &&
                !useRoofPlacement &&
                Number.isInteger(snapPlacement.mountedWallLineGroupId)
            ) ? Number(snapPlacement.mountedWallLineGroupId) : null;
            previewItem.mountedWallSectionUnitId = (
                useSnapPlacement &&
                !useRoofPlacement &&
                Number.isInteger(snapPlacement.mountedWallSectionUnitId)
            ) ? Number(snapPlacement.mountedWallSectionUnitId) : null;
            previewItem.mountedWallFacingSign = (
                useSnapPlacement &&
                !useRoofPlacement &&
                Number.isFinite(snapPlacement.mountedWallFacingSign)
            ) ? Number(snapPlacement.mountedWallFacingSign) : null;
            if (
                useSnapPlacement &&
                !useRoofPlacement &&
                Number.isFinite(snapPlacement.wallFaceCenterX) &&
                Number.isFinite(snapPlacement.wallFaceCenterY) &&
                Number.isFinite(snapPlacement.sectionNormalX) &&
                Number.isFinite(snapPlacement.sectionNormalY) &&
                Number.isFinite(snapPlacement.wallThickness) &&
                Number.isFinite(previewItem.mountedWallFacingSign)
            ) {
                const sign = Number(previewItem.mountedWallFacingSign) >= 0 ? 1 : -1;
                const thickness = Math.max(0, Number(snapPlacement.wallThickness));
                const nx = Number(snapPlacement.sectionNormalX);
                const ny = Number(snapPlacement.sectionNormalY);
                const frontX = Number(snapPlacement.wallFaceCenterX);
                const frontY = Number(snapPlacement.wallFaceCenterY);
                const faceEpsilon = 0.01;
                const dirX = nx * sign;
                const dirY = ny * sign;
                const backBaseX = frontX - dirX * thickness;
                const backBaseY = frontY - dirY * thickness;
                previewItem.depthBillboardFaceCenters = {
                    // Nudge both planes slightly away from wall faces to prevent preview z-fighting.
                    front: {
                        x: frontX + dirX * faceEpsilon,
                        y: frontY + dirY * faceEpsilon
                    },
                    back: {
                        x: backBaseX + dirX * faceEpsilon,
                        y: backBaseY + dirY * faceEpsilon
                    }
                };
            } else {
                previewItem.depthBillboardFaceCenters = null;
            }
            previewItem.centerSnapGuide = useSnapPlacement
                && !useRoofPlacement
                ? {
                    centerSnapActive: !!snapPlacement.centerSnapActive,
                    placementCenterX: Number(snapPlacement.placementCenterX),
                    placementCenterY: Number(snapPlacement.placementCenterY),
                    sectionCenterX: Number(snapPlacement.sectionCenterX),
                    sectionCenterY: Number(snapPlacement.sectionCenterY),
                    sectionFacingSign: Number(snapPlacement.sectionFacingSign),
                    sectionNormalX: Number(snapPlacement.sectionNormalX),
                    sectionNormalY: Number(snapPlacement.sectionNormalY),
                    sectionDirX: Number(snapPlacement.sectionDirX),
                    sectionDirY: Number(snapPlacement.sectionDirY),
                    wallFaceCenterX: Number(snapPlacement.wallFaceCenterX),
                    wallFaceCenterY: Number(snapPlacement.wallFaceCenterY),
                    placementHalfWidth: Number(snapPlacement.placementHalfWidth),
                    wallHeight: Number(snapPlacement.wallHeight) || 0,
                    wallThickness: Number(snapPlacement.wallThickness) || 0,
                    sectionFaceQuadScreenPoints: Array.isArray(snapPlacement.sectionFaceQuadScreenPoints)
                        ? snapPlacement.sectionFaceQuadScreenPoints
                        : null,
                    sectionVisiblePolygonsScreen: Array.isArray(snapPlacement.sectionVisiblePolygonsScreen)
                        ? snapPlacement.sectionVisiblePolygonsScreen
                        : null
                }
                : null;
            previewItem.roofHighlightOnly = false;
            previewItem.roofLoopSections = (
                useRoofPlacement &&
                Array.isArray(snapPlacement.wallSections)
            ) ? snapPlacement.wallSections.slice() : null;
            return previewItem;
        }

        renderPlaceObjectCenterSnapGuide(previewItem) {
            const layer = this.layers.ui;
            if (!layer) return;
            if (!this.placeObjectCenterSnapGuideGraphics) {
                this.placeObjectCenterSnapGuideGraphics = new PIXI.Graphics();
                this.placeObjectCenterSnapGuideGraphics.name = "renderingPlaceObjectSnapGuide";
                this.placeObjectCenterSnapGuideGraphics.skipTransform = true;
                this.placeObjectCenterSnapGuideGraphics.interactive = false;
                this.placeObjectCenterSnapGuideGraphics.visible = false;
                layer.addChild(this.placeObjectCenterSnapGuideGraphics);
            } else if (this.placeObjectCenterSnapGuideGraphics.parent !== layer) {
                layer.addChild(this.placeObjectCenterSnapGuideGraphics);
            }
            const g = this.placeObjectCenterSnapGuideGraphics;
            g.clear();
            const guide = previewItem && previewItem.centerSnapGuide ? previewItem.centerSnapGuide : null;
            const roofSections = (
                previewItem &&
                Array.isArray(previewItem.roofLoopSections)
            ) ? previewItem.roofLoopSections : null;
            let drewRoofLoop = false;
            if (Array.isArray(roofSections) && roofSections.length > 0) {
                for (let i = 0; i < roofSections.length; i++) {
                    const section = roofSections[i];
                    if (!section || typeof section.getWallProfile !== "function") continue;
                    const profile = section.getWallProfile();
                    if (!profile) continue;
                    const layerBaseZ = Number.isFinite(previewItem && previewItem._renderLayerBaseZ)
                        ? Number(previewItem._renderLayerBaseZ)
                        : null;
                    const topZ = (typeof global !== "undefined" && global.Roof && typeof global.Roof.getWallSectionTopZForLayer === "function")
                        ? global.Roof.getWallSectionTopZForLayer(section, layerBaseZ)
                        : ((Number.isFinite(section.bottomZ) ? Number(section.bottomZ) : 0) + Math.max(0, Number(section.height) || 0));
                    const topFace = [
                        this.camera.worldToScreen(Number(profile.aLeft.x), Number(profile.aLeft.y), topZ),
                        this.camera.worldToScreen(Number(profile.bLeft.x), Number(profile.bLeft.y), topZ),
                        this.camera.worldToScreen(Number(profile.bRight.x), Number(profile.bRight.y), topZ),
                        this.camera.worldToScreen(Number(profile.aRight.x), Number(profile.aRight.y), topZ)
                    ];
                    if (!topFace.every(pt => Number.isFinite(pt.x) && Number.isFinite(pt.y))) continue;
                    g.lineStyle(2, 0x66c2ff, 0.55);
                    g.beginFill(0x66c2ff, 0.12);
                    g.moveTo(topFace[0].x, topFace[0].y);
                    g.lineTo(topFace[1].x, topFace[1].y);
                    g.lineTo(topFace[2].x, topFace[2].y);
                    g.lineTo(topFace[3].x, topFace[3].y);
                    g.closePath();
                    g.endFill();
                    drewRoofLoop = true;
                }
            }
            if (
                !guide ||
                !Number.isFinite(guide.placementCenterX) ||
                !Number.isFinite(guide.placementCenterY) ||
                !Number.isFinite(guide.sectionCenterX) ||
                !Number.isFinite(guide.sectionCenterY)
            ) {
                g.visible = drewRoofLoop;
                return;
            }

            const placementCenterScreen = this.camera.worldToScreen(guide.placementCenterX, guide.placementCenterY, 0);
            const sectionCenterScreen = this.camera.worldToScreen(guide.sectionCenterX, guide.sectionCenterY, 0);
            const topCenterScreen = {
                x: sectionCenterScreen.x,
                y: sectionCenterScreen.y - (Math.max(0, Number(guide.wallHeight) || 0) * this.camera.viewscale * this.camera.xyratio)
            };
            const visiblePolygons = Array.isArray(guide.sectionVisiblePolygonsScreen)
                ? guide.sectionVisiblePolygonsScreen
                : null;
            if (Array.isArray(visiblePolygons) && visiblePolygons.length > 0) {
                for (let i = 0; i < visiblePolygons.length; i++) {
                    const poly = Array.isArray(visiblePolygons[i])
                        ? visiblePolygons[i].map(pt => ({ x: Number(pt.x), y: Number(pt.y) }))
                        : [];
                    if (poly.length < 3) continue;
                    if (!poly.every(pt => Number.isFinite(pt.x) && Number.isFinite(pt.y))) continue;
                    g.lineStyle(2, 0x4FC3FF, 0.8);
                    g.beginFill(0x4FC3FF, 0.12);
                    g.moveTo(poly[0].x, poly[0].y);
                    for (let p = 1; p < poly.length; p++) {
                        g.lineTo(poly[p].x, poly[p].y);
                    }
                    g.closePath();
                    g.endFill();
                }
            } else if (Array.isArray(guide.sectionFaceQuadScreenPoints) && guide.sectionFaceQuadScreenPoints.length >= 4) {
                const quad = guide.sectionFaceQuadScreenPoints
                    .slice(0, 4)
                    .map(pt => ({ x: Number(pt.x), y: Number(pt.y) }))
                    .filter(pt => Number.isFinite(pt.x) && Number.isFinite(pt.y));
                if (quad.length === 4) {
                    g.lineStyle(2, 0x4FC3FF, 0.8);
                    g.beginFill(0x4FC3FF, 0.12);
                    g.moveTo(quad[0].x, quad[0].y);
                    g.lineTo(quad[1].x, quad[1].y);
                    g.lineTo(quad[2].x, quad[2].y);
                    g.lineTo(quad[3].x, quad[3].y);
                    g.closePath();
                    g.endFill();
                }
            }

            const facingSign = Number.isFinite(guide.sectionFacingSign) ? Number(guide.sectionFacingSign) : 1;
            const insideWorld = {
                x: guide.sectionCenterX - (Number.isFinite(guide.sectionNormalX) ? guide.sectionNormalX : 0) * Math.max(0, Number(guide.wallThickness) || 0) * facingSign,
                y: guide.sectionCenterY - (Number.isFinite(guide.sectionNormalY) ? guide.sectionNormalY : 0) * Math.max(0, Number(guide.wallThickness) || 0) * facingSign
            };
            const insideScreen = this.camera.worldToScreen(insideWorld.x, insideWorld.y, 0);
            const topInsideScreen = {
                x: insideScreen.x,
                y: insideScreen.y - (Math.max(0, Number(guide.wallHeight) || 0) * this.camera.viewscale * this.camera.xyratio)
            };
            if (guide.centerSnapActive) {
                g.lineStyle(2, 0xFF0000, 0.5);
                g.moveTo(placementCenterScreen.x, placementCenterScreen.y);
                g.lineTo(topCenterScreen.x, topCenterScreen.y);
                g.moveTo(topCenterScreen.x, topCenterScreen.y);
                g.lineTo(topInsideScreen.x, topInsideScreen.y);
            }

            if (
                Number.isFinite(guide.wallFaceCenterX) &&
                Number.isFinite(guide.wallFaceCenterY) &&
                Number.isFinite(guide.sectionDirX) &&
                Number.isFinite(guide.sectionDirY) &&
                Number.isFinite(guide.placementHalfWidth)
            ) {
                const hx = guide.sectionDirX * guide.placementHalfWidth;
                const hy = guide.sectionDirY * guide.placementHalfWidth;
                const facingEndA = { x: guide.wallFaceCenterX - hx, y: guide.wallFaceCenterY - hy };
                const facingEndB = { x: guide.wallFaceCenterX + hx, y: guide.wallFaceCenterY + hy };
                const insideEndA = {
                    x: facingEndA.x - (Number.isFinite(guide.sectionNormalX) ? guide.sectionNormalX : 0) * Math.max(0, Number(guide.wallThickness) || 0) * facingSign,
                    y: facingEndA.y - (Number.isFinite(guide.sectionNormalY) ? guide.sectionNormalY : 0) * Math.max(0, Number(guide.wallThickness) || 0) * facingSign
                };
                const insideEndB = {
                    x: facingEndB.x - (Number.isFinite(guide.sectionNormalX) ? guide.sectionNormalX : 0) * Math.max(0, Number(guide.wallThickness) || 0) * facingSign,
                    y: facingEndB.y - (Number.isFinite(guide.sectionNormalY) ? guide.sectionNormalY : 0) * Math.max(0, Number(guide.wallThickness) || 0) * facingSign
                };
                const toTop = (pt) => {
                    const s = this.camera.worldToScreen(pt.x, pt.y, 0);
                    return {
                        x: s.x,
                        y: s.y - (Math.max(0, Number(guide.wallHeight) || 0) * this.camera.viewscale * this.camera.xyratio)
                    };
                };
                const topFacingA = toTop(facingEndA);
                const topInsideA = toTop(insideEndA);
                const topFacingB = toTop(facingEndB);
                const topInsideB = toTop(insideEndB);
                g.lineStyle(2, 0x000000, 0.6);
                g.moveTo(topFacingA.x, topFacingA.y);
                g.lineTo(topInsideA.x, topInsideA.y);
                g.moveTo(topFacingB.x, topFacingB.y);
                g.lineTo(topInsideB.x, topInsideB.y);
            }
            g.visible = true;
            this.promoteInteriorPresentationDisplayObject(g, ctx);
        }

        renderPlaceObjectPreview(ctx) {
            const previewItem = this.buildPlaceObjectPreviewRenderItem(ctx);
            if (!previewItem) {
                this.clearPlaceObjectPreview();
                return;
            }
            if (previewItem.roofHighlightOnly) {
                if (this.placeObjectPreviewItem) {
                    if (this.placeObjectPreviewItem._depthBillboardMesh) {
                        const mesh = this.placeObjectPreviewItem._depthBillboardMesh;
                        mesh.visible = false;
                        if (Object.prototype.hasOwnProperty.call(mesh, "renderable")) {
                            mesh.renderable = false;
                        }
                    }
                    if (this.placeObjectPreviewItem._compositeUnderlayMesh) {
                        const mesh = this.placeObjectPreviewItem._compositeUnderlayMesh;
                        mesh.visible = false;
                        if (Object.prototype.hasOwnProperty.call(mesh, "renderable")) {
                            mesh.renderable = false;
                        }
                    }
                }
                if (this.placeObjectPreviewDisplayObject) {
                    this.placeObjectPreviewDisplayObject.visible = false;
                    if (Object.prototype.hasOwnProperty.call(this.placeObjectPreviewDisplayObject, "renderable")) {
                        this.placeObjectPreviewDisplayObject.renderable = false;
                    }
                    this.placeObjectPreviewDisplayObject = null;
                }
                if (this.placeObjectPreviewSprite) {
                    this.placeObjectPreviewSprite.visible = false;
                    if (Object.prototype.hasOwnProperty.call(this.placeObjectPreviewSprite, "renderable")) {
                        this.placeObjectPreviewSprite.renderable = false;
                    }
                }
                this.renderPlaceObjectCenterSnapGuide(previewItem);
                return;
            }
            let displayObj = null;
            // Keep preview sprite dimensions in world scale before any depth-mesh extraction.
            this.applySpriteTransform(previewItem);
            if (
                typeof previewItem.updateDepthBillboardMesh === "function"
            ) {
                const mesh = previewItem.updateDepthBillboardMesh(
                    ctx,
                    this.camera,
                    { alphaCutoff: TREE_ALPHA_CUTOFF }
                );
                if (mesh) {
                    if (Object.prototype.hasOwnProperty.call(mesh, "renderable")) {
                        mesh.renderable = true;
                    }
                    if (Number.isFinite(previewItem.previewAlpha)) {
                        mesh.alpha = previewItem.previewAlpha;
                    }
                    displayObj = mesh;
                }
            }
            if (!displayObj) {
                displayObj = previewItem.pixiSprite || this.placeObjectPreviewSprite;
            }
            if (!displayObj) {
                this.clearPlaceObjectPreview();
                return;
            }
            const interiorPresentationActive = this.isBuildingInteriorPresentationActive(ctx);
            const container = interiorPresentationActive
                ? this.layers.ui
                : ((displayObj instanceof PIXI.Mesh)
                    ? this.layers.depthObjects
                    : this.layers.objects3d);
            if (!container) {
                this.clearPlaceObjectPreview();
                return;
            }
            const depthMesh = previewItem._depthBillboardMesh;
            if (depthMesh && depthMesh !== displayObj) {
                depthMesh.visible = false;
                if (Object.prototype.hasOwnProperty.call(depthMesh, "renderable")) {
                    depthMesh.renderable = false;
                }
            }
            if (displayObj.parent !== container) {
                container.addChild(displayObj);
            }
            displayObj.visible = true;
            if (Object.prototype.hasOwnProperty.call(displayObj, "renderable")) {
                displayObj.renderable = true;
            }
            if (Number.isFinite(previewItem.previewAlpha)) {
                displayObj.alpha = previewItem.previewAlpha;
            }
            if (Number.isFinite(displayObj.tint)) {
                displayObj.tint = 0xFFFFFF;
            }
            if (interiorPresentationActive) {
                displayObj.zIndex = BUILDING_INTERIOR_FOREGROUND_Z;
                container.sortableChildren = true;
                if (Object.prototype.hasOwnProperty.call(container, "sortDirty")) container.sortDirty = true;
            }

            const underlayMesh = previewItem._compositeUnderlayMesh;
            const shouldShowUnderlay = !!(
                underlayMesh &&
                !underlayMesh.destroyed &&
                previewItem._compositeUnderlayShouldRender
            );
            if (shouldShowUnderlay) {
                if (underlayMesh.parent !== container) {
                    container.addChild(underlayMesh);
                }
                underlayMesh.visible = true;
                if (Object.prototype.hasOwnProperty.call(underlayMesh, "renderable")) {
                    underlayMesh.renderable = true;
                }
                if (Number.isFinite(previewItem.previewAlpha)) {
                    underlayMesh.alpha = previewItem.previewAlpha;
                }
                if (Number.isFinite(underlayMesh.tint)) {
                    underlayMesh.tint = 0xFFFFFF;
                }
            } else if (underlayMesh && !underlayMesh.destroyed) {
                underlayMesh.visible = false;
                if (Object.prototype.hasOwnProperty.call(underlayMesh, "renderable")) {
                    underlayMesh.renderable = false;
                }
            }

            const topIndex = container.children.length - 1;
            if (topIndex >= 0) {
                const currentIndex = container.getChildIndex(displayObj);
                if (currentIndex !== topIndex) {
                    container.setChildIndex(displayObj, topIndex);
                }
                if (underlayMesh && underlayMesh.parent === container) {
                    const uIndex = container.getChildIndex(underlayMesh);
                    const newUIndex = Math.max(0, container.children.length - 2);
                    if (uIndex !== newUIndex) {
                        container.setChildIndex(underlayMesh, newUIndex);
                    }
                }
            }
            if (this.placeObjectPreviewDisplayObject && this.placeObjectPreviewDisplayObject !== displayObj) {
                this.placeObjectPreviewDisplayObject.visible = false;
                if (Object.prototype.hasOwnProperty.call(this.placeObjectPreviewDisplayObject, "renderable")) {
                    this.placeObjectPreviewDisplayObject.renderable = false;
                }
            }
            this.placeObjectPreviewDisplayObject = displayObj;
            this.renderPlaceObjectCenterSnapGuide(previewItem);
        }

        buildPowerupPlacementPreviewRenderItem(ctx) {
            const wizard = (ctx && ctx.wizard) || global.wizard || null;
            if (!wizard || wizard.currentSpell !== "blackdiamond" || wizard.editorPlacementActive !== true) {
                return null;
            }
            const mousePosRef = this.getMousePosRef(ctx);
            if (!mousePosRef || !Number.isFinite(mousePosRef.worldX) || !Number.isFinite(mousePosRef.worldY)) {
                return null;
            }

            const spellSystemRef = (typeof SpellSystem !== "undefined")
                ? SpellSystem
                : (global.SpellSystem || null);
            const previewConfig = (
                spellSystemRef &&
                typeof spellSystemRef.getPowerupPlacementPreviewConfig === "function"
            ) ? spellSystemRef.getPowerupPlacementPreviewConfig(wizard) : {
                fileName: "button.png",
                imagePath: "/assets/images/powerups/button.png",
                width: 0.8,
                height: 0.8,
                radius: 0.35,
                scale: 1
            };

            const texturePath = (previewConfig && typeof previewConfig.imagePath === "string" && previewConfig.imagePath.length > 0)
                ? previewConfig.imagePath
                : "/assets/images/powerups/button.png";
            if (!this.powerupPlacementPreviewSprite) {
                this.powerupPlacementPreviewSprite = new PIXI.Sprite(PIXI.Texture.from(texturePath));
                this.powerupPlacementPreviewSprite.anchor.set(0.5, 1);
                this.powerupPlacementPreviewSprite.alpha = 0.55;
                this.powerupPlacementPreviewSprite.interactive = false;
                this.powerupPlacementPreviewSprite.visible = false;
                this.powerupPlacementPreviewTexturePath = texturePath;
            } else if (this.powerupPlacementPreviewTexturePath !== texturePath) {
                this.powerupPlacementPreviewSprite.texture = PIXI.Texture.from(texturePath);
                this.powerupPlacementPreviewTexturePath = texturePath;
            }

            const mapRef = (ctx && ctx.map) || wizard.map || global.map || null;
            const worldX = (mapRef && typeof mapRef.wrapWorldX === "function")
                ? mapRef.wrapWorldX(mousePosRef.worldX)
                : mousePosRef.worldX;
            const worldY = (mapRef && typeof mapRef.wrapWorldY === "function")
                ? mapRef.wrapWorldY(mousePosRef.worldY)
                : mousePosRef.worldY;
            const width = Number.isFinite(previewConfig && previewConfig.width)
                ? Math.max(0.01, Number(previewConfig.width))
                : 0.8;
            const height = Number.isFinite(previewConfig && previewConfig.height)
                ? Math.max(0.01, Number(previewConfig.height))
                : 0.8;

            this.powerupPlacementPreviewSprite.tint = 0xFFFFFF;
            this.powerupPlacementPreviewSprite.visible = true;
            if (Object.prototype.hasOwnProperty.call(this.powerupPlacementPreviewSprite, "renderable")) {
                this.powerupPlacementPreviewSprite.renderable = true;
            }

            if (!this.powerupPlacementPreviewItem) {
                this.powerupPlacementPreviewItem = {
                    type: "powerupPlacementPreview",
                    map: mapRef || global.map || null,
                    gone: false,
                    vanishing: false,
                    pixiSprite: this.powerupPlacementPreviewSprite,
                    anchorX: 0.5,
                    anchorY: 1
                };
                const powerupProto = global.Powerup && global.Powerup.prototype
                    ? global.Powerup.prototype
                    : null;
                if (powerupProto && typeof powerupProto.ensureSprite === "function") {
                    this.powerupPlacementPreviewItem.ensureSprite = powerupProto.ensureSprite;
                }
                if (powerupProto && typeof powerupProto.ensureDepthBillboardMesh === "function") {
                    this.powerupPlacementPreviewItem.ensureDepthBillboardMesh = powerupProto.ensureDepthBillboardMesh;
                }
                if (powerupProto && typeof powerupProto.updateDepthBillboardMesh === "function") {
                    this.powerupPlacementPreviewItem.updateDepthBillboardMesh = powerupProto.updateDepthBillboardMesh;
                }
            }

            const previewItem = this.powerupPlacementPreviewItem;
            previewItem.map = mapRef || previewItem.map || null;
            previewItem.pixiSprite = this.powerupPlacementPreviewSprite;
            previewItem.x = worldX;
            previewItem.y = worldY;
            previewItem.z = 0;
            previewItem.width = width;
            previewItem.height = height;
            previewItem.renderZ = worldY;
            previewItem.previewAlpha = 0.55;
            previewItem.imagePath = texturePath;
            const puAnchorX = Number.isFinite(previewConfig && previewConfig.anchorX)
                ? Number(previewConfig.anchorX) : 0.5;
            const puAnchorY = Number.isFinite(previewConfig && previewConfig.anchorY)
                ? Number(previewConfig.anchorY) : 0.5;
            previewItem.anchorX = puAnchorX;
            previewItem.anchorY = puAnchorY;
            // Sync the preview sprite's Pixi anchor to match the actual
            // powerup anchor from items.json so the depth billboard quad
            // matches the final placed powerup appearance.
            if (this.powerupPlacementPreviewSprite && this.powerupPlacementPreviewSprite.anchor) {
                this.powerupPlacementPreviewSprite.anchor.set(puAnchorX, puAnchorY);
            }
            return previewItem;
        }

        renderPowerupPlacementPreview(ctx) {
            const previewItem = this.buildPowerupPlacementPreviewRenderItem(ctx);
            if (!previewItem) {
                this.clearPowerupPlacementPreview();
                return;
            }
            if (previewItem.pixiSprite) {
                const w = Number.isFinite(previewItem.width) ? Math.max(0.01, Number(previewItem.width)) : 0.8;
                const h = Number.isFinite(previewItem.height) ? Math.max(0.01, Number(previewItem.height)) : 0.8;
                const viewScale = Number.isFinite(this.camera && this.camera.viewscale)
                    ? Number(this.camera.viewscale)
                    : 1;
                // Match live powerup render sizing exactly (see renderPowerups()).
                previewItem.pixiSprite.width = w * viewScale;
                previewItem.pixiSprite.height = h * viewScale;
            }
            let displayObj = null;
            if (typeof previewItem.updateDepthBillboardMesh === "function") {
                const mesh = previewItem.updateDepthBillboardMesh(
                    ctx,
                    this.camera,
                    { alphaCutoff: TREE_ALPHA_CUTOFF }
                );
                if (mesh) {
                    const depthContainer = this.layers.depthObjects;
                    if (depthContainer && mesh.parent !== depthContainer) {
                        depthContainer.addChild(mesh);
                    }
                    mesh.visible = true;
                    if (Object.prototype.hasOwnProperty.call(mesh, "renderable")) {
                        mesh.renderable = true;
                    }
                    if (Number.isFinite(previewItem.previewAlpha)) {
                        mesh.alpha = previewItem.previewAlpha;
                    }
                    displayObj = mesh;
                }
            }
            if (!displayObj) {
                this.applySpriteTransform(previewItem);
                displayObj = previewItem.pixiSprite || this.powerupPlacementPreviewSprite;
            }
            if (!displayObj) {
                this.clearPowerupPlacementPreview();
                return;
            }

            const interiorPresentationActive = this.isBuildingInteriorPresentationActive(ctx);
            const container = interiorPresentationActive
                ? this.layers.ui
                : ((displayObj instanceof PIXI.Mesh)
                    ? this.layers.depthObjects
                    : this.layers.objects3d);
            if (!container) {
                this.clearPowerupPlacementPreview();
                return;
            }
            if (displayObj.parent !== container) {
                container.addChild(displayObj);
            }
            displayObj.visible = true;
            if (Object.prototype.hasOwnProperty.call(displayObj, "renderable")) {
                displayObj.renderable = true;
            }
            if (Number.isFinite(previewItem.previewAlpha)) {
                displayObj.alpha = previewItem.previewAlpha;
            }
            if (Number.isFinite(displayObj.tint)) {
                displayObj.tint = 0xFFFFFF;
            }
            if (interiorPresentationActive) {
                displayObj.zIndex = BUILDING_INTERIOR_FOREGROUND_Z;
                container.sortableChildren = true;
                if (Object.prototype.hasOwnProperty.call(container, "sortDirty")) container.sortDirty = true;
            }
            const topIndex = container.children.length - 1;
            if (topIndex >= 0) {
                const currentIndex = container.getChildIndex(displayObj);
                if (currentIndex !== topIndex) {
                    container.setChildIndex(displayObj, topIndex);
                }
            }
            if (this.powerupPlacementPreviewDisplayObject && this.powerupPlacementPreviewDisplayObject !== displayObj) {
                this.powerupPlacementPreviewDisplayObject.visible = false;
                if (Object.prototype.hasOwnProperty.call(this.powerupPlacementPreviewDisplayObject, "renderable")) {
                    this.powerupPlacementPreviewDisplayObject.renderable = false;
                }
            }
            this.powerupPlacementPreviewDisplayObject = displayObj;
        }

        beginDrawPassProfiling(ctx) {
            const profiler = this.drawPassProfiler;
            if (!profiler || profiler.printed || !isDrawPassBreakdownEnabled()) return null;
            const nowMs = (ctx && Number.isFinite(ctx.renderNowMs)) ? Number(ctx.renderNowMs) : performance.now();
            if (!Number.isFinite(profiler.startMs)) {
                profiler.startMs = nowMs;
                profiler.deadlineMs = nowMs + 60000;
            }
            return profiler;
        }

        beginFrameMetrics() {
            if (!isDrawPassBreakdownEnabled()) {
                this.currentFrameMetrics = null;
                return null;
            }
            this.currentFrameMetrics = Object.create(null);
            return this.currentFrameMetrics;
        }

        setFrameMetric(metricName, value) {
            if (!this.currentFrameMetrics || !metricName) return value;
            this.currentFrameMetrics[metricName] = value;
            return value;
        }

        incrementFrameMetric(metricName, delta = 1) {
            if (!this.currentFrameMetrics || !metricName || !Number.isFinite(delta)) return 0;
            const nextValue = Number(this.currentFrameMetrics[metricName] || 0) + Number(delta);
            this.currentFrameMetrics[metricName] = nextValue;
            return nextValue;
        }

        recordDrawPassSection(sectionName, elapsedMs) {
            const profiler = this.drawPassProfiler;
            if (!profiler || profiler.printed || !sectionName || !Number.isFinite(elapsedMs)) return;
            let section = profiler.sections[sectionName];
            if (!section) {
                section = {
                    count: 0,
                    totalMs: 0,
                    maxMs: 0
                };
                profiler.sections[sectionName] = section;
            }
            section.count += 1;
            section.totalMs += elapsedMs;
            if (elapsedMs > section.maxMs) {
                section.maxMs = elapsedMs;
            }
        }

        recordDrawPassFrameMetrics(metrics) {
            const profiler = this.drawPassProfiler;
            if (!profiler || profiler.printed || !metrics) return;
            const metricNames = Object.keys(metrics);
            for (let i = 0; i < metricNames.length; i++) {
                const name = metricNames[i];
                const value = Number(metrics[name]);
                if (!Number.isFinite(value)) continue;
                let metric = profiler.metrics[name];
                if (!metric) {
                    metric = {
                        count: 0,
                        total: 0,
                        max: -Infinity,
                        last: 0
                    };
                    profiler.metrics[name] = metric;
                }
                metric.count += 1;
                metric.total += value;
                metric.last = value;
                if (value > metric.max) metric.max = value;
            }
        }

        profileDrawPassSection(sectionName, fn) {
            if (!isDrawPassBreakdownEnabled()) {
                return fn();
            }
            const t0 = performance.now();
            const result = fn();
            const elapsedMs = performance.now() - t0;
            this.recordDrawPassSection(sectionName, elapsedMs);
            if (!this.currentFrameDrawSections) {
                this.currentFrameDrawSections = Object.create(null);
            }
            this.currentFrameDrawSections[sectionName] = elapsedMs;
            return result;
        }

        maybePrintDrawPassProfileSummary(ctx) {
            const profiler = this.drawPassProfiler;
            if (!profiler || profiler.printed || !Number.isFinite(profiler.deadlineMs)) return;
            const nowMs = (ctx && Number.isFinite(ctx.renderNowMs)) ? Number(ctx.renderNowMs) : performance.now();
            if (nowMs < profiler.deadlineMs) return;

            const sections = {};
            const sectionNames = Object.keys(profiler.sections);
            for (let i = 0; i < sectionNames.length; i++) {
                const name = sectionNames[i];
                const section = profiler.sections[name];
                if (!section) continue;
                const avgMs = section.count > 0 ? section.totalMs / section.count : 0;
                sections[name] = {
                    samples: section.count,
                    avgMs,
                    maxMs: section.maxMs,
                    totalMs: section.totalMs
                };
            }

            const metrics = {};
            const metricNames = Object.keys(profiler.metrics || {});
            for (let i = 0; i < metricNames.length; i++) {
                const name = metricNames[i];
                const metric = profiler.metrics[name];
                if (!metric) continue;
                metrics[name] = {
                    samples: metric.count,
                    avg: metric.count > 0 ? metric.total / metric.count : 0,
                    max: Number.isFinite(metric.max) ? metric.max : 0,
                    total: metric.total,
                    last: metric.last
                };
            }

            const summary = {
                durationMs: nowMs - profiler.startMs,
                frameCount: profiler.frameCount,
                avgFrameMs: profiler.frameCount > 0 ? profiler.totalFrameMs / profiler.frameCount : 0,
                maxFrameMs: profiler.maxFrameMs,
                sections,
                metrics
            };
            global.renderingDrawPassProfileSummary = summary;
            console.log("Rendering draw-pass profile (60s):", summary);
            profiler.printed = true;
        }

        renderFrame(ctx) {
            this.init(ctx);
            if (!this.initialized) return false;
            const frameStartMs = performance.now();
            this._drawFrameId = (Number(this._drawFrameId) || 0) + 1;
            this._activeDrawFrameId = this._drawFrameId;
            this.currentFrameDrawSections = isDrawPassBreakdownEnabled() ? Object.create(null) : null;
            this.beginFrameMetrics();
            this.clearBuildingInteriorForegroundPromotions();
            const frameNowMs = (ctx && Number.isFinite(ctx.renderNowMs)) ? Number(ctx.renderNowMs) : frameStartMs;
            const mazeModeSettingEnabled = this.isLosMazeModeEnabled();
            if (mazeModeSettingEnabled && (!this.lastMazeModeSettingEnabled || !Number.isFinite(this.mazeModeActivatedAtMs))) {
                this.mazeModeActivatedAtMs = frameNowMs;
                this.mazeModeSuppressRevealAnimation = true;
            } else if (!mazeModeSettingEnabled) {
                this.mazeModeActivatedAtMs = null;
                this.mazeModeSuppressRevealAnimation = false;
            }
            this.lastMazeModeSettingEnabled = mazeModeSettingEnabled;
            this.beginDrawPassProfiling(ctx);
            this.profileDrawPassSection("resetWallDepthGeometryBudget", () => {
                if (typeof global.resetWallDepthGeometryBudget === "function") {
                    global.resetWallDepthGeometryBudget();
                }
            });
            this.setLegacyLayersVisible(false);
            this.layers.root.visible = true;
            this.profileDrawPassSection("camera.update", () => {
                this.camera.update({
                    camera: ctx.camera,
                    wizard: ctx.wizard,
                    viewport: ctx.viewport,
                    viewscale: ctx.viewscale,
                    xyratio: ctx.xyratio,
                    map: ctx.map,
                    renderAlpha: ctx.renderAlpha
                });
            });
            this.profileDrawPassSection("syncLayerTransitionState", () => {
                this.syncLayerTransitionState(ctx);
            });
            this.resetPickRenderItems();
            if (this.scenePicker && this.scenePicker.publicApi) {
                global.renderingScenePicker = this.scenePicker.publicApi;
            }
            const visibleNodes = this.profileDrawPassSection("collectVisibleNodes", () =>
                this.collectVisibleNodes(ctx, 4, 4)
            );
            this.profileDrawPassSection("prepareLayerCutawayFrame", () => {
                this.prepareLayerCutawayFrame(ctx, ctx.map || global.map || null, ctx.wizard || global.wizard || null);
            });
            const visibleObjects = this.profileDrawPassSection("collectVisibleObjects", () =>
                this.collectVisibleObjects(visibleNodes, ctx)
            );
            this.profileDrawPassSection("syncOnscreenObjectsCache", () => {
                this.syncOnscreenObjectsCache(ctx, visibleNodes, visibleObjects);
            });
            this.profileDrawPassSection("updateLosState", () => {
                this.updateLosState(ctx, visibleNodes, visibleObjects);
            });
            this.profileDrawPassSection("updateWallLosIlluminationTallies", () => {
                this.updateWallLosIlluminationTallies(ctx);
            });
            this.profileDrawPassSection("renderGroundTiles", () => {
                this.renderGroundTiles(ctx, visibleNodes);
            });
            this.profileDrawPassSection("renderFloorVisualPolygons", () => {
                this.renderFloorVisualPolygons(ctx);
            });
            this.profileDrawPassSection("renderPrototypeSectionSeams", () => {
                this.renderPrototypeSectionSeams(ctx);
            });
            this.profileDrawPassSection("renderClearanceOverlay", () => {
                if (typeof drawAnimalClearanceOverlay === "function") {
                    drawAnimalClearanceOverlay(this.layers.ground, this.camera);
                }
            });
            this.profileDrawPassSection("renderTileClearanceNumbers", () => {
                if (typeof drawTileClearanceNumbers === "function") {
                    drawTileClearanceNumbers(this.layers.ground, this.camera);
                }
            });
            this.profileDrawPassSection("drawMapBorder", () => {
                const debugEnabled = !!(
                    (typeof debugMode !== "undefined" && debugMode) ||
                    global.debugMode
                );
                if (debugEnabled && typeof global.drawMapBorder === "function") {
                    global.drawMapBorder();
                }
            });
            this.profileDrawPassSection("renderRoadsAndFloors", () => {
                this.renderRoadsAndFloors(ctx, visibleNodes);
            });
            this.profileDrawPassSection("renderHexGridOverlay", () => {
                this.renderHexGridOverlay(ctx);
            });
            this.profileDrawPassSection("applyMazeModeCompositor", () => {
                this.applyMazeModeCompositor(ctx);
            });
            this.profileDrawPassSection("renderLosShadowOverlay", () => {
                this.renderLosShadowOverlay(ctx);
            });
            this.profileDrawPassSection("renderObjects3D", () => {
                this.renderObjects3D(ctx, visibleNodes, visibleObjects);
            });
            this.profileDrawPassSection("renderWallPlacementPreview", () => {
                this.renderWallPlacementPreview(ctx);
            });
            this.profileDrawPassSection("renderRoadPlacementPreview", () => {
                this.renderRoadPlacementPreview(ctx);
            });
            this.profileDrawPassSection("renderFirewallPlacementPreview", () => {
                this.renderFirewallPlacementPreview(ctx);
            });
            this.profileDrawPassSection("renderTriggerAreaPlacementPreview", () => {
                this.renderTriggerAreaPlacementPreview(ctx);
            });
            this.profileDrawPassSection("renderFloorEditorPolygonOverlay", () => {
                this.renderFloorEditorPolygonOverlay(ctx);
            });
            this.profileDrawPassSection("renderLayerCutawayDebugOverlay", () => {
                this.renderLayerCutawayDebugOverlay(ctx);
            });
            this.profileDrawPassSection("renderPlaceObjectPreview", () => {
                this.renderPlaceObjectPreview(ctx);
            });
            this.profileDrawPassSection("renderPowerupPlacementPreview", () => {
                this.renderPowerupPlacementPreview(ctx);
            });
            this.profileDrawPassSection("renderPowerups", () => {
                this.renderPowerups(ctx);
            });
            this.profileDrawPassSection("renderWizard", () => {
                this.renderWizard(ctx);
            });
            this.profileDrawPassSection("renderCreatureTracePaths", () => {
                this.renderCreatureTracePaths(ctx);
            });
            this.profileDrawPassSection("renderProjectiles", () => {
                this.renderProjectiles(ctx);
            });
            this.profileDrawPassSection("renderScriptMessages", () => {
                this.renderScriptMessages(ctx);
            });
            if (this.scenePicker && typeof this.scenePicker.renderHoverHighlight === "function") {
                this.profileDrawPassSection("scenePicker.renderHoverHighlight", () => {
                    const spellSystemRef = (typeof SpellSystem !== "undefined")
                        ? SpellSystem
                        : (global.SpellSystem || null);
                    const mousePosRef = (typeof mousePos !== "undefined")
                        ? mousePos
                        : (global.mousePos || null);
                    const frameCountRef = (typeof frameCount !== "undefined")
                        ? frameCount
                        : (global.frameCount || 0);
                    const spaceHeldRef = !!(
                        typeof keysPressed !== "undefined" &&
                        keysPressed &&
                        keysPressed[" "]
                    );
                    this.scenePicker.renderHoverHighlight({
                        app: ctx.app || global.app || null,
                        map: ctx.map || global.map || null,
                        wizard: ctx.wizard || global.wizard || null,
                        spellSystem: spellSystemRef,
                        mousePos: mousePosRef,
                        spaceHeld: spaceHeldRef,
                        frameCount: frameCountRef,
                        viewport: ctx.viewport || null,
                        pickRenderItems: this.pickRenderItems,
                        camera: this.camera,
                        uiLayer: this.layers.ui,
                        getDisplayObjectForItem: (item) => {
                            if (!item) return null;
                            if (item._renderingDepthMesh && item._renderingDepthMesh.visible) return item._renderingDepthMesh;
                            if (item.type === "road") {
                                const roadSprite = this.roadSpriteByObject.get(item);
                                if (roadSprite && roadSprite.parent) return roadSprite;
                            }
                            if (item._renderingDisplayObject && item._renderingDisplayObject.parent) {
                                return item._renderingDisplayObject;
                            }
                            if (item.pixiSprite && item.pixiSprite.parent) return item.pixiSprite;
                            return null;
                        }
                    });
                });
            }
            if (this.hexGridContainer && this.hexGridContainer.parent === this.layers.ui) {
                const ui = this.layers.ui;
                const hasBackdrop = !!(
                    this.hexGridPickerBackdrop &&
                    this.hexGridPickerBackdrop.parent === ui
                );
                const previewSprite = (this.scenePicker && this.scenePicker.pickPreviewSprite && this.scenePicker.pickPreviewSprite.parent === ui)
                    ? this.scenePicker.pickPreviewSprite
                    : null;
                if (previewSprite) {
                    const previewTopIdx = ui.children.length - 1;
                    if (ui.getChildIndex(previewSprite) !== previewTopIdx) {
                        ui.setChildIndex(previewSprite, previewTopIdx);
                    }
                    const previewIdx = ui.getChildIndex(previewSprite);
                    const gridTargetIdx = Math.max(hasBackdrop ? 1 : 0, previewIdx - 1);
                    if (ui.getChildIndex(this.hexGridContainer) !== gridTargetIdx) {
                        ui.setChildIndex(this.hexGridContainer, gridTargetIdx);
                    }
                    if (hasBackdrop && ui.getChildIndex(this.hexGridPickerBackdrop) !== 0) {
                        ui.setChildIndex(this.hexGridPickerBackdrop, 0);
                    }
                } else {
                    const gridTargetIdx = hasBackdrop ? 1 : 0;
                    if (ui.getChildIndex(this.hexGridContainer) !== gridTargetIdx) {
                        ui.setChildIndex(this.hexGridContainer, gridTargetIdx);
                    }
                    if (hasBackdrop && ui.getChildIndex(this.hexGridPickerBackdrop) !== 0) {
                        ui.setChildIndex(this.hexGridPickerBackdrop, 0);
                    }
                }
            }
            const showPickerScreen = getShowPickerScreenFlag();
            setShowPickerScreenFlag(showPickerScreen);
            this.layers.ground.visible = !showPickerScreen;
            this.layers.roadsFloor.visible = !showPickerScreen;
            this.layers.groundObjects.visible = !showPickerScreen;
            this.layers.losShadow.visible = !showPickerScreen && !this.mazeModeOverlayActive;
            this.layers.depthObjects.visible = !showPickerScreen;
            this.layers.objects3d.visible = !showPickerScreen;
            if (this.layers.characters) {
                this.layers.characters.visible = !showPickerScreen;
            }
            this.layers.entities.visible = !showPickerScreen;
            this.layers.scriptMessages.visible = !showPickerScreen;
            this.layers.ui.visible = true;
            if (this.mazeModeRenderer && this.mazeModeRenderer.blackBackdropGraphics) {
                this.mazeModeRenderer.blackBackdropGraphics.visible = !showPickerScreen && this.mazeModeOverlayActive;
            }
            if (this.mazeModeRenderer && this.mazeModeRenderer.occlusionMaskGraphics) {
                this.mazeModeRenderer.occlusionMaskGraphics.visible = !showPickerScreen && this.mazeModeOverlayActive;
            }
            if (isTextureSanitizerEnabled()) {
                this.profileDrawPassSection("sanitizeDisplayTreeTextures", () => {
                    const sanitizeRoot = (ctx && ctx.app && ctx.app.stage) ? ctx.app.stage : this.layers.root;
                    const sanitizeResult = sanitizeDisplayTreeTextures(sanitizeRoot, { maxSamples: 6 });
                    if (sanitizeResult && sanitizeResult.repaired > 0) {
                        const nowMs = performance.now();
                        if (!Number.isFinite(this._lastTextureSanitizerLogAtMs) || (nowMs - this._lastTextureSanitizerLogAtMs) > 1000) {
                            this._lastTextureSanitizerLogAtMs = nowMs;
                            console.warn("[render texture sanitizer]", {
                                repaired: sanitizeResult.repaired,
                                samples: sanitizeResult.samples
                            });
                        }
                    }
                });
            }
            const frameElapsedMs = performance.now() - frameStartMs;
            this.recordDrawPassSection("renderFrame.total", frameElapsedMs);
            if (typeof globalThis !== "undefined") {
                globalThis.renderingLiveStats = {
                    groundCached: this.groundSpriteByNodeKey instanceof Map
                        ? this.groundSpriteByNodeKey.size
                        : 0,
                    groundVisible: this.groundVisibleNodeKeys instanceof Set
                        ? this.groundVisibleNodeKeys.size
                        : 0,
                    groundPool: Array.isArray(this.groundSpritePool)
                        ? this.groundSpritePool.length
                        : 0,
                    roadCached: this.roadSpriteByObject instanceof Map
                        ? this.roadSpriteByObject.size
                        : 0,
                    depthMeshes: this.activeDepthBillboardMeshes instanceof Set
                        ? this.activeDepthBillboardMeshes.size
                        : 0,
                    objectDisplays: this.activeObjectDisplayObjects instanceof Set
                        ? this.activeObjectDisplayObjects.size
                        : 0,
                    groundLayerChildren: this.layers && this.layers.ground && Array.isArray(this.layers.ground.children)
                        ? this.layers.ground.children.length
                        : 0,
                    roadsLayerChildren: this.layers && this.layers.roadsFloor && Array.isArray(this.layers.roadsFloor.children)
                        ? this.layers.roadsFloor.children.length
                        : 0,
                    objectsLayerChildren: this.layers && this.layers.objects3d && Array.isArray(this.layers.objects3d.children)
                        ? this.layers.objects3d.children.length
                        : 0
                };
            }
            if (typeof globalThis !== "undefined" && isDrawPassBreakdownEnabled()) {
                const sections = this.currentFrameDrawSections || Object.create(null);
                const metrics = this.currentFrameMetrics || Object.create(null);
                const getMs = (name) => Number(sections[name] || 0);
                const getMetric = (name) => Number(metrics[name] || 0);
                const visibleObjectsCount = Array.isArray(visibleObjects) ? visibleObjects.length : 0;
                let hydratedRoads = 0;
                let hydratedTrees = 0;
                for (let i = 0; i < visibleObjectsCount; i++) {
                    const item = visibleObjects[i];
                    if (!item || item.gone || item.vanishing) continue;
                    if (item.type === "road") {
                        hydratedRoads += 1;
                    } else if (item.type === "tree") {
                        hydratedTrees += 1;
                    }
                }
                globalThis.drawPerfBreakdown = {
                    lazyMs: 0,
                    prepMs: getMs("resetWallDepthGeometryBudget") + getMs("camera.update"),
                    collectMs: getMs("collectVisibleNodes") + getMs("prepareLayerCutawayFrame") + getMs("collectVisibleObjects") + getMs("syncOnscreenObjectsCache"),
                    losMs: getMs("updateLosState") + getMs("updateWallLosIlluminationTallies"),
                    composeMs: frameElapsedMs,
                    passWorldMs:
                        getMs("renderGroundTiles") +
                        getMs("renderHexGridOverlay") +
                        getMs("renderPrototypeSectionSeams") +
                        getMs("renderClearanceOverlay") +
                        getMs("renderTileClearanceNumbers") +
                        getMs("drawMapBorder") +
                        getMs("renderRoadsAndFloors"),
                    passWorldGroundMs: getMs("renderGroundTiles"),
                    passWorldHexMs: getMs("renderHexGridOverlay"),
                    passWorldSeamsMs: getMs("renderPrototypeSectionSeams"),
                    passWorldClearanceMs: getMs("renderClearanceOverlay"),
                    passWorldTileNumbersMs: getMs("renderTileClearanceNumbers"),
                    passWorldBorderMs: getMs("drawMapBorder"),
                    passWorldRoadsMs: getMs("renderRoadsAndFloors"),
                    passLosMs:
                        getMs("applyMazeModeCompositor") +
                        getMs("renderLosShadowOverlay"),
                    passObjectsMs:
                        getMs("renderObjects3D") +
                        getMs("renderPowerups") +
                        getMs("renderWizard") +
                        getMs("renderCreatureTracePaths") +
                        getMs("renderProjectiles") +
                        getMs("renderScriptMessages"),
                    passPostMs:
                        getMs("renderWallPlacementPreview") +
                        getMs("renderRoadPlacementPreview") +
                        getMs("renderFirewallPlacementPreview") +
                        getMs("renderTriggerAreaPlacementPreview") +
                        getMs("renderPlaceObjectPreview") +
                        getMs("renderPowerupPlacementPreview") +
                        getMs("scenePicker.renderHoverHighlight") +
                        getMs("drawNodeInspectorOverlay") +
                        getMs("sanitizeDisplayTreeTextures"),
                    composeMaskMs: 0,
                    composeSortMs: 0,
                    composePopulateMs: 0,
                    composeInvariantMs: 0,
                    composeWallSectionsMs: 0,
                    composeWallSectionsGroups: 0,
                    composeWallSectionsRebuilt: 0,
                    composeUnaccountedMs: 0,
                    composeInvariantSkipped: 0,
                    visibleNodes: getMetric("visibleNodes"),
                    visibleNodesWrapped: getMetric("visibleNodesWrapped"),
                    visibleNodesFallback: getMetric("visibleNodesFallback"),
                    visibleNodeFilterSkipped: getMetric("visibleNodeFilterSkipped"),
                    visibleNodeFallbackUsed: getMetric("visibleNodeFallbackUsed"),
                    visibleObjectNodeRefs: getMetric("visibleObjectNodeRefs"),
                    visibleObjectVisibilityRefs: getMetric("visibleObjectVisibilityRefs"),
                    visibleObjectDuplicateRefsSkipped: getMetric("visibleObjectDuplicateRefsSkipped"),
                    visibleObjectsSkippedBuildingCutaway: getMetric("visibleObjectsSkippedBuildingCutaway"),
                    layerCutawayRenderItemTests: getMetric("layerCutawayRenderItemTests"),
                    layerCutawayRenderItemFastPath: getMetric("layerCutawayRenderItemFastPath"),
                    layerCutawayWorldPointTests: getMetric("layerCutawayWorldPointTests"),
                    layerCutawayWorldPointFastPath: getMetric("layerCutawayWorldPointFastPath"),
                    visibleAnimalsAdded: getMetric("visibleAnimalsAdded"),
                    visibleAnimalsSkippedOffscreen: getMetric("visibleAnimalsSkippedOffscreen"),
                    onscreenCacheObjects: getMetric("onscreenCacheObjects"),
                    onscreenCacheRoofs: getMetric("onscreenCacheRoofs"),
                    losCandidates: getMetric("losCandidates"),
                    losBuildMs: getMetric("losBuildMs"),
                    losTraceMs: getMetric("losTraceMs"),
                    losTotalMs: getMetric("losTotalMs"),
                    losRecomputed: getMetric("losRecomputed"),
                    losVisibleObjects: getMetric("losVisibleObjects"),
                    wallLosMs: getMetric("wallLosMs"),
                    wallLosResetSections: getMetric("wallLosResetSections"),
                    wallLosIlluminatedBins: getMetric("wallLosIlluminatedBins"),
                    wallLosRangedSections: getMetric("wallLosRangedSections"),
                    wallLosEndpointLookups: getMetric("wallLosEndpointLookups"),
                    wallLosEndpointOwnersResolved: getMetric("wallLosEndpointOwnersResolved"),
                    mazeModeMaskWorldPoints: getMetric("mazeModeMaskWorldPoints"),
                    mazeModeMaskActive: getMetric("mazeModeMaskActive"),
                    roadsVisible: getMetric("roadsVisible"),
                    roadsCached: getMetric("roadsCached"),
                    roadsCreated: getMetric("roadsCreated"),
                    roadsAttached: getMetric("roadsAttached"),
                    roadsTextureRefreshes: getMetric("roadsTextureRefreshes"),
                    roadsTextureAssignments: getMetric("roadsTextureAssignments"),
                    roadsHidden: getMetric("roadsHidden"),
                    roadsDestroyed: getMetric("roadsDestroyed"),
                    roadsEvicted: getMetric("roadsEvicted"),
                    roadsSkippedForLevel0Bake: getMetric("roadsSkippedForLevel0Bake"),
                    roadsMs: getMetric("roadsMs"),
                    floorFragmentsScanned: getMetric("floorFragmentsScanned"),
                    floorFragmentsSkippedLevelIsolation: getMetric("floorFragmentsSkippedLevelIsolation"),
                    floorFragmentsSkippedUneditedLevel0: getMetric("floorFragmentsSkippedUneditedLevel0"),
                    floorFragmentsSkippedNoSurface: getMetric("floorFragmentsSkippedNoSurface"),
                    floorFragmentsSkippedInvalidOuter: getMetric("floorFragmentsSkippedInvalidOuter"),
                    floorLevel0Entries: getMetric("floorLevel0Entries"),
                    floorNonzeroEntries: getMetric("floorNonzeroEntries"),
                    floorLevel0Sections: getMetric("floorLevel0Sections"),
                    floorEntriesCollected: getMetric("floorEntriesCollected"),
                    floorLevel0BakeRequests: getMetric("floorLevel0BakeRequests"),
                    floorLevel0BakeHits: getMetric("floorLevel0BakeHits"),
                    floorLevel0BakeMisses: getMetric("floorLevel0BakeMisses"),
                    floorLevel0BakePending: getMetric("floorLevel0BakePending"),
                    floorLevel0BakeGroundTiles: getMetric("floorLevel0BakeGroundTiles"),
                    floorLevel0BakeRoads: getMetric("floorLevel0BakeRoads"),
                    floorLevel0BakePixels: getMetric("floorLevel0BakePixels"),
                    floorLevel0BakePatchRects: getMetric("floorLevel0BakePatchRects"),
                    floorVisualPolygons: getMetric("floorVisualPolygons"),
                    floorVisualMeshesCreated: getMetric("floorVisualMeshesCreated"),
                    floorVisualGeometryUploads: getMetric("floorVisualGeometryUploads"),
                    floorVisualCollectMs: getMetric("floorVisualCollectMs"),
                    floorVisualMeshLookupMs: getMetric("floorVisualMeshLookupMs"),
                    floorVisualMeshCreateMs: getMetric("floorVisualMeshCreateMs"),
                    floorVisualGeometryMs: getMetric("floorVisualGeometryMs"),
                    floorVisualMeshAssignMs: getMetric("floorVisualMeshAssignMs"),
                    floorVisualMeshUpdateMs: getMetric("floorVisualMeshUpdateMs"),
                    floorVisualHideMs: getMetric("floorVisualHideMs"),
                    floorVisualTrimMs: getMetric("floorVisualTrimMs"),
                    floorVisualVertices: getMetric("floorVisualVertices"),
                    floorVisualTriangles: getMetric("floorVisualTriangles"),
                    floorVisualMeshCacheSize: getMetric("floorVisualMeshCacheSize"),
                    floorVisualChunkClipCacheHits: getMetric("floorVisualChunkClipCacheHits"),
                    floorVisualChunkClipCacheMisses: getMetric("floorVisualChunkClipCacheMisses"),
                    floorVisualChunkClipCacheSize: getMetric("floorVisualChunkClipCacheSize"),
                    floorVisualChunkClipsTrimmed: getMetric("floorVisualChunkClipsTrimmed"),
                    groundTilesSkippedForLevel0Chunks: getMetric("groundTilesSkippedForLevel0Chunks"),
                    groundTileSpritesVisible: getMetric("groundTileSpritesVisible"),
                    depthCandidates: getMetric("depthCandidates"),
                    depthMissingMountedSection: getMetric("depthMissingMountedSection"),
                    depthHiddenByScript: getMetric("depthHiddenByScript"),
                    depthDoorBottomOutlineOnly: getMetric("depthDoorBottomOutlineOnly"),
                    groundObjectSpritesRendered: getMetric("groundObjectSpritesRendered"),
                    objects3dLosBuildMs: getMetric("objects3dLosBuildMs"),
                    objects3dLosVisibleSetSize: getMetric("objects3dLosVisibleSetSize"),
                    objects3dLosVisibleWalls: getMetric("objects3dLosVisibleWalls"),
                    objects3dFilterMs: getMetric("objects3dFilterMs"),
                    objects3dTransformMs: getMetric("objects3dTransformMs"),
                    objects3dDepthMs: getMetric("objects3dDepthMs"),
                    objects3dGroundMs: getMetric("objects3dGroundMs"),
                    objects3dDisplayMs: getMetric("objects3dDisplayMs"),
                    objects3dAnimalLosHidden: getMetric("objects3dAnimalLosHidden"),
                    objects3dBuildingCompositeMs: getMetric("objects3dBuildingCompositeMs"),
                    objects3dBuildingCompositeActive: getMetric("objects3dBuildingCompositeActive"),
                    objects3dBuildingCompositeObjects: getMetric("objects3dBuildingCompositeObjects"),
                    objects3dBuildingCompositeOriginalsHidden: getMetric("objects3dBuildingCompositeOriginalsHidden"),
                    objects3dBuildingCompositeCacheHits: getMetric("objects3dBuildingCompositeCacheHits"),
                    objects3dBuildingCompositeCacheMisses: getMetric("objects3dBuildingCompositeCacheMisses"),
                    objects3dBuildingCompositePendingTextures: getMetric("objects3dBuildingCompositePendingTextures"),
                    objects3dBuildingGhostItemsFlagged: getMetric("objects3dBuildingGhostItemsFlagged"),
                    objects3dBuildingHiddenItemsFlagged: getMetric("objects3dBuildingHiddenItemsFlagged"),
                    objects3dBuildingMaskMs: getMetric("objects3dBuildingMaskMs"),
                    objects3dBuildingMaskActive: getMetric("objects3dBuildingMaskActive"),
                    objects3dBuildingMaskEntries: getMetric("objects3dBuildingMaskEntries"),
                    objects3dBuildingMaskMeshes: getMetric("objects3dBuildingMaskMeshes"),
                    objects3dBuildingMaskVertices: getMetric("objects3dBuildingMaskVertices"),
                    objects3dBuildingMaskTriangles: getMetric("objects3dBuildingMaskTriangles"),
                    objects3dBuildingMaskCreated: getMetric("objects3dBuildingMaskCreated"),
                    objects3dBuildingMaskGeometryUploads: getMetric("objects3dBuildingMaskGeometryUploads"),
                    objects3dBuildingMaskUniformUpdates: getMetric("objects3dBuildingMaskUniformUpdates"),
                    objects3dBuildingMaskAttachOps: getMetric("objects3dBuildingMaskAttachOps"),
                    objects3dBuildingMaskHiddenMeshes: getMetric("objects3dBuildingMaskHiddenMeshes"),
                    objects3dMazeHidden: getMetric("objects3dMazeHidden"),
                    objects3dMazeHiddenWalls: getMetric("objects3dMazeHiddenWalls"),
                    objects3dMapItems: getMetric("objects3dMapItems"),
                    objects3dRoofItems: getMetric("objects3dRoofItems"),
                    objects3dRenderItems: getMetric("objects3dRenderItems"),
                    objects3dDepthRendered: getMetric("objects3dDepthRendered"),
                    objects3dGroundRendered: getMetric("objects3dGroundRendered"),
                    objects3dDisplayObjects: getMetric("objects3dDisplayObjects"),
                    objects3dVisibleAnimals: getMetric("objects3dVisibleAnimals"),
                    objects3dVisibleTrees: getMetric("objects3dVisibleTrees"),
                    mapItems: visibleObjectsCount,
                    onscreen: (typeof global.onscreenObjects !== "undefined" && global.onscreenObjects && Number.isFinite(global.onscreenObjects.size))
                        ? Number(global.onscreenObjects.size)
                        : visibleObjectsCount,
                    groundCached: this.groundSpriteByNodeKey instanceof Map
                        ? this.groundSpriteByNodeKey.size
                        : 0,
                    groundVisible: this.groundVisibleNodeKeys instanceof Set
                        ? this.groundVisibleNodeKeys.size
                        : 0,
                    groundPool: Array.isArray(this.groundSpritePool)
                        ? this.groundSpritePool.length
                        : 0,
                    roadCached: this.roadSpriteByObject instanceof Map
                        ? this.roadSpriteByObject.size
                        : 0,
                    depthMeshes: this.activeDepthBillboardMeshes instanceof Set
                        ? this.activeDepthBillboardMeshes.size
                        : 0,
                    objectDisplays: this.activeObjectDisplayObjects instanceof Set
                        ? this.activeObjectDisplayObjects.size
                        : 0,
                    groundLayerChildren: this.layers && this.layers.ground && Array.isArray(this.layers.ground.children)
                        ? this.layers.ground.children.length
                        : 0,
                    roadsLayerChildren: this.layers && this.layers.roadsFloor && Array.isArray(this.layers.roadsFloor.children)
                        ? this.layers.roadsFloor.children.length
                        : 0,
                    objectsLayerChildren: this.layers && this.layers.objects3d && Array.isArray(this.layers.objects3d.children)
                        ? this.layers.objects3d.children.length
                        : 0,
                    hydratedRoads,
                    hydratedTrees
                };
                globalThis.renderingFrameMetrics = { ...metrics };
            } else if (typeof globalThis !== "undefined") {
                globalThis.drawPerfBreakdown = null;
                globalThis.renderingFrameMetrics = null;
            }
            if (this.drawPassProfiler && !this.drawPassProfiler.printed) {
                this.recordDrawPassFrameMetrics(this.currentFrameMetrics);
                this.drawPassProfiler.frameCount += 1;
                this.drawPassProfiler.totalFrameMs += frameElapsedMs;
                if (frameElapsedMs > this.drawPassProfiler.maxFrameMs) {
                    this.drawPassProfiler.maxFrameMs = frameElapsedMs;
                }
            }
            this.maybePrintDrawPassProfileSummary(ctx);
            this.profileDrawPassSection("drawNodeInspectorOverlay", () => {
                if (typeof drawNodeInspectorOverlay === "function") {
                    drawNodeInspectorOverlay(this.layers.ui, this.camera);
                }
            });
            this._activeDrawFrameId = 0;
            return true;
        }
    }

    let singleton = null;

    const renderingApi = {
        renderFrame(ctx) {
            if (!global.RenderingCamera || !global.RenderingLayers || typeof PIXI === "undefined") {
                return false;
            }
            if (!singleton) singleton = new RenderingImpl();
            return singleton.renderFrame(ctx || {});
        },
        isWorldPointTargetable(worldX, worldY, wizardOverride = null, mapOverride = null) {
            const wizardRef = wizardOverride || global.wizard || null;
            if (!wizardRef || !Number.isFinite(worldX) || !Number.isFinite(worldY)) return true;
            if (!singleton) return true;
            const mazeModeEnabled = typeof singleton.isLosMazeModeEnabled === "function"
                ? singleton.isLosMazeModeEnabled()
                : false;
            const omnivisionActive = typeof singleton.isOmnivisionActive === "function"
                ? singleton.isOmnivisionActive(wizardRef)
                : false;
            if (!mazeModeEnabled || omnivisionActive) return true;
            if (typeof singleton.isWorldPointInLosShadow !== "function") return true;
            return !singleton.isWorldPointInLosShadow(worldX, worldY, wizardRef, mapOverride);
        },
        getLayers() {
            return singleton && singleton.layers ? singleton.layers : null;
        },
        disable() {
            if (!singleton) return;
            for (const item of singleton.activeDepthBillboardItems) {
                if (item && item.pixiSprite) {
                    item.pixiSprite.visible = true;
                    if (Object.prototype.hasOwnProperty.call(item.pixiSprite, "renderable")) {
                        item.pixiSprite.renderable = true;
                    }
                }
                if (item && item._renderingDepthMesh) {
                    if (item._renderingDepthMesh.parent) {
                        item._renderingDepthMesh.parent.removeChild(item._renderingDepthMesh);
                    }
                    item._renderingDepthMesh.visible = false;
                    item._renderingDepthMesh = null;
                }
            }
            singleton.activeDepthBillboardItems.clear();
            singleton.activeDepthBillboardMeshes.clear();
            for (const sprite of singleton.activePowerupDisplayObjects) {
                if (!sprite) continue;
                sprite.visible = false;
                if (Object.prototype.hasOwnProperty.call(sprite, "renderable")) {
                    sprite.renderable = false;
                }
            }
            singleton.activePowerupDisplayObjects.clear();
            for (const sprite of singleton.activeProjectileDisplayObjects) {
                if (!sprite) continue;
                sprite.visible = false;
                if (Object.prototype.hasOwnProperty.call(sprite, "renderable")) {
                    sprite.renderable = false;
                }
                if (sprite.parent) {
                    sprite.parent.removeChild(sprite);
                }
            }
            singleton.activeProjectileDisplayObjects.clear();
            singleton.clearPlaceObjectPreview();
            singleton.clearPowerupPlacementPreview();
            singleton.clearWallPlacementPreview();
            singleton.clearRoadPlacementPreview();
            if (singleton.scenePicker && typeof singleton.scenePicker.hideAll === "function") {
                singleton.scenePicker.hideAll();
            }
            if (singleton.scenePicker && singleton.scenePicker.publicApi && global.renderingScenePicker === singleton.scenePicker.publicApi) {
                global.renderingScenePicker = null;
            }
            singleton.layers.root.visible = false;
            singleton.setLegacyLayersVisible(true);
        }
    };
    global.Rendering = renderingApi;
})(typeof globalThis !== "undefined" ? globalThis : window);
