(function (globalScope) {
    "use strict";

    const DEFAULT_EPS = 1e-6;

    function finiteNumber(value) {
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

    function normalizeDirection(direction) {
        const d = Number.isFinite(Number(direction)) ? Math.round(Number(direction)) : 0;
        return ((d % 12) + 12) % 12;
    }

    function baseProfileFromEndpoints(startPoint, endPoint, thickness, options = {}) {
        const sx = finiteNumber(startPoint && startPoint.x);
        const sy = finiteNumber(startPoint && startPoint.y);
        const ex = finiteNumber(endPoint && endPoint.x);
        const ey = finiteNumber(endPoint && endPoint.y);
        if (sx === null || sy === null || ex === null || ey === null) return null;

        const dx = ex - sx;
        const dy = ey - sy;
        const len = Math.hypot(dx, dy);
        const eps = Number.isFinite(Number(options.eps)) ? Number(options.eps) : DEFAULT_EPS;
        if (!(len > eps)) return null;

        const nx = -dy / len;
        const ny = dx / len;
        const halfT = Math.max(0.001, Number(thickness) || 0.001) * 0.5;

        return {
            aLeft: { x: sx + nx * halfT, y: sy + ny * halfT },
            aRight: { x: sx - nx * halfT, y: sy - ny * halfT },
            bLeft: { x: ex + nx * halfT, y: ey + ny * halfT },
            bRight: { x: ex - nx * halfT, y: ey - ny * halfT }
        };
    }

    function parameterForWorldPointOnSection(startPoint, endPoint, worldPoint, mapRef = null) {
        const sx = finiteNumber(startPoint && startPoint.x);
        const sy = finiteNumber(startPoint && startPoint.y);
        const exRaw = finiteNumber(endPoint && endPoint.x);
        const eyRaw = finiteNumber(endPoint && endPoint.y);
        const pxRaw = finiteNumber(worldPoint && worldPoint.x);
        const pyRaw = finiteNumber(worldPoint && worldPoint.y);
        if (sx === null || sy === null || exRaw === null || eyRaw === null || pxRaw === null || pyRaw === null) return null;

        const dx = mapRef && typeof mapRef.shortestDeltaX === "function"
            ? mapRef.shortestDeltaX(sx, exRaw)
            : (exRaw - sx);
        const dy = mapRef && typeof mapRef.shortestDeltaY === "function"
            ? mapRef.shortestDeltaY(sy, eyRaw)
            : (eyRaw - sy);
        const len2 = dx * dx + dy * dy;
        if (!(len2 > DEFAULT_EPS)) return null;

        const px = mapRef && typeof mapRef.shortestDeltaX === "function"
            ? mapRef.shortestDeltaX(sx, pxRaw)
            : (pxRaw - sx);
        const py = mapRef && typeof mapRef.shortestDeltaY === "function"
            ? mapRef.shortestDeltaY(sy, pyRaw)
            : (pyRaw - sy);
        if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
        return (px * dx + py * dy) / len2;
    }

    function wallPositionAtScreenPoint(section, screenX, screenY, options = {}) {
        if (!section || !Number.isFinite(Number(screenX)) || !Number.isFinite(Number(screenY))) return null;
        if (!section.startPoint || !section.endPoint) return null;

        const toScreenPoint = typeof options.toScreenPoint === "function"
            ? options.toScreenPoint
            : null;
        const worldToScreenFn = typeof options.worldToScreenFn === "function"
            ? options.worldToScreenFn
            : null;
        const vs = Number.isFinite(Number(options.viewscale)) ? Number(options.viewscale) : 1;
        const xyr = Number.isFinite(Number(options.xyratio)) ? Number(options.xyratio) : 0.66;
        const direction = Number.isFinite(Number(options.direction))
            ? Number(options.direction)
            : Number(section.direction);
        const dir = normalizeDirection(direction);
        const isVertical = dir === 3 || dir === 9;

        let t = null;

        const profile = typeof options.getWallProfile === "function"
            ? options.getWallProfile()
            : (typeof section.getWallProfile === "function" ? section.getWallProfile() : null);
        if ((toScreenPoint || worldToScreenFn) && profile) {
            const wallHeight = Math.max(0, Number(section.height) || 0);
            const wallBottomZ = Number.isFinite(Number(section.bottomZ)) ? Number(section.bottomZ) : 0;
            const wallTopZ = wallBottomZ + wallHeight;
            const toScreen = (pt, z) => {
                if (toScreenPoint) return toScreenPoint({ x: Number(pt.x), y: Number(pt.y) }, z);
                const s = worldToScreenFn({ x: Number(pt.x), y: Number(pt.y) });
                return { x: s.x, y: s.y - z * vs * xyr };
            };

            const longFaceA = [
                toScreen(profile.aLeft, wallBottomZ),
                toScreen(profile.bLeft, wallBottomZ),
                toScreen(profile.bLeft, wallTopZ),
                toScreen(profile.aLeft, wallTopZ)
            ];
            const longFaceB = [
                toScreen(profile.aRight, wallBottomZ),
                toScreen(profile.bRight, wallBottomZ),
                toScreen(profile.bRight, wallTopZ),
                toScreen(profile.aRight, wallTopZ)
            ];
            const topFace = [
                toScreen(profile.aLeft, wallTopZ),
                toScreen(profile.bLeft, wallTopZ),
                toScreen(profile.bRight, wallTopZ),
                toScreen(profile.aRight, wallTopZ)
            ];
            const faceDepth = (poly) => {
                let sum = 0;
                for (let i = 0; i < poly.length; i++) sum += Number(poly[i].y) || 0;
                return sum / Math.max(1, poly.length);
            };
            const longAFront = faceDepth(longFaceA) >= faceDepth(longFaceB);
            const front = longAFront ? longFaceA : longFaceB;

            if (!isVertical) {
                const spanStart = Number(front[0].x);
                const spanEnd = Number(front[1].x);
                const spanMin = Math.min(spanStart, spanEnd);
                const spanMax = Math.max(spanStart, spanEnd);
                const spanSize = spanMax - spanMin;
                if (spanSize > 1e-6) {
                    t = (Number(screenX) - spanMin) / spanSize;
                    t = Math.max(0, Math.min(1, t));
                    if (spanEnd < spanStart) t = 1 - t;
                }
            } else {
                let topMinY = Infinity;
                let topMaxY = -Infinity;
                for (let i = 0; i < topFace.length; i++) {
                    if (topFace[i].y < topMinY) topMinY = topFace[i].y;
                    if (topFace[i].y > topMaxY) topMaxY = topFace[i].y;
                }
                const spanSize = topMaxY - topMinY;
                const startY = (topFace[0].y + topFace[3].y) * 0.5;
                const endY = (topFace[1].y + topFace[2].y) * 0.5;
                if (spanSize > 1e-6) {
                    t = (Number(screenY) - topMinY) / spanSize;
                    t = Math.max(0, Math.min(1, t));
                    if (endY < startY) t = 1 - t;
                }
            }
        }

        if (!Number.isFinite(t)) {
            const wx = finiteNumber(options.worldX);
            const wy = finiteNumber(options.worldY);
            if (wx !== null && wy !== null) {
                const tRaw = typeof options.parameterForWorldPoint === "function"
                    ? options.parameterForWorldPoint({ x: wx, y: wy })
                    : parameterForWorldPointOnSection(section.startPoint, section.endPoint, { x: wx, y: wy }, options.mapRef || null);
                if (Number.isFinite(tRaw)) {
                    t = Math.max(0, Math.min(1, Number(tRaw)));
                }
            }
        }

        return Number.isFinite(t) ? Number(t) : null;
    }

    const api = {
        baseProfileFromEndpoints,
        normalizeDirection,
        parameterForWorldPointOnSection,
        wallPositionAtScreenPoint
    };

    globalScope.WallGeometry = api;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
})(typeof globalThis !== "undefined" ? globalThis : window);
