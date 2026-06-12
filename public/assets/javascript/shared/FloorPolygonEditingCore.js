"use strict";

(function installFloorPolygonEditingCore(globalScope) {
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

    function cloneRing(points) {
        return normalizeRing(points);
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

    function geometryFromRings(outer, holes = []) {
        const outerRing = pointsToClipRing(outer);
        if (!outerRing) return [];
        const polygon = [outerRing];
        for (let i = 0; i < holes.length; i++) {
            const hole = pointsToClipRing(holes[i]);
            if (hole) polygon.push(hole);
        }
        return [polygon];
    }

    function isEmptyGeometry(geometry) {
        return !Array.isArray(geometry) || geometry.length === 0;
    }

    function booleanApi() {
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

    function booleanGeometry(operation, ...geometries) {
        const api = booleanApi();
        if (!api || typeof api[operation] !== "function") {
            throw new Error("polygon editing requires polygon-clipping");
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

    function singlePolygonFromGeometry(geometry, label = "polygon edit") {
        if (isEmptyGeometry(geometry)) {
            throw new Error(`${label} removed the entire polygon`);
        }
        if (!Array.isArray(geometry) || geometry.length !== 1) {
            throw new Error(`${label} produced multiple disjoint polygons; building floors do not support split fragments yet`);
        }
        const polygon = geometry[0];
        if (!Array.isArray(polygon) || polygon.length < 1) {
            throw new Error(`${label} produced invalid polygon geometry`);
        }
        const outer = clipRingToPoints(polygon[0]);
        if (outer.length < 3) {
            throw new Error(`${label} produced a polygon with fewer than three vertices`);
        }
        const holes = [];
        for (let i = 1; i < polygon.length; i++) {
            const hole = clipRingToPoints(polygon[i]);
            if (hole.length >= 3) holes.push(hole);
        }
        return { outer, holes };
    }

    function applyEditToPolygon(outer, holes, editPoints, operation) {
        const subject = geometryFromRings(outer, holes);
        const edit = geometryFromRings(editPoints, []);
        if (isEmptyGeometry(edit)) {
            throw new Error("polygon edit requires at least three points");
        }
        const nextGeometry = operation === "subtract"
            ? booleanGeometry("difference", subject, edit)
            : booleanGeometry("union", subject, edit);
        return singlePolygonFromGeometry(nextGeometry, operation === "subtract" ? "polygon subtract" : "polygon add");
    }

    function closestSegmentInfo(point, a, b) {
        const px = Number(point && point.x);
        const py = Number(point && point.y);
        const ax = Number(a && a.x);
        const ay = Number(a && a.y);
        const bx = Number(b && b.x);
        const by = Number(b && b.y);
        if (![px, py, ax, ay, bx, by].every(Number.isFinite)) return null;
        const abx = bx - ax;
        const aby = by - ay;
        const lenSq = abx * abx + aby * aby;
        if (!(lenSq > 0)) {
            const dx = px - ax;
            const dy = py - ay;
            return { x: ax, y: ay, distanceSq: dx * dx + dy * dy, t: 0 };
        }
        const t = Math.max(0, Math.min(1, (((px - ax) * abx) + ((py - ay) * aby)) / lenSq));
        const x = ax + abx * t;
        const y = ay + aby * t;
        const dx = px - x;
        const dy = py - y;
        return { x, y, distanceSq: dx * dx + dy * dy, t };
    }

    function insertPointOnRingEdge(ring, insertAfterIndex, point) {
        const next = cloneRing(ring);
        if (next.length < 3) throw new Error("cannot insert vertex into invalid ring");
        const index = Math.max(0, Math.min(next.length, Math.floor(Number(insertAfterIndex)) + 1));
        next.splice(index, 0, { x: Number(point.x), y: Number(point.y) });
        return { ring: next, vertexIndex: index };
    }

    function insertPointNearSelectedNeighbor(ring, selectedIndex, point) {
        const next = cloneRing(ring);
        if (next.length < 3) throw new Error("cannot insert vertex into invalid ring");
        const index = Math.floor(Number(selectedIndex));
        if (!Number.isInteger(index) || index < 0 || index >= next.length) {
            throw new Error("cannot insert vertex without a valid selected vertex");
        }
        const prevIndex = (index - 1 + next.length) % next.length;
        const nextIndex = (index + 1) % next.length;
        const prevDx = Number(point.x) - Number(next[prevIndex].x);
        const prevDy = Number(point.y) - Number(next[prevIndex].y);
        const nextDx = Number(point.x) - Number(next[nextIndex].x);
        const nextDy = Number(point.y) - Number(next[nextIndex].y);
        const insertIndex = (prevDx * prevDx + prevDy * prevDy) <= (nextDx * nextDx + nextDy * nextDy)
            ? index
            : index + 1;
        next.splice(insertIndex, 0, { x: Number(point.x), y: Number(point.y) });
        return { ring: next, vertexIndex: insertIndex };
    }

    const api = {
        normalizeRing,
        cloneRing,
        pointsToClipRing,
        clipRingToPoints,
        geometryFromRings,
        isEmptyGeometry,
        booleanGeometry,
        singlePolygonFromGeometry,
        applyEditToPolygon,
        closestSegmentInfo,
        insertPointOnRingEdge,
        insertPointNearSelectedNeighbor
    };

    globalScope.FloorPolygonEditingCore = api;
    if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : global);
