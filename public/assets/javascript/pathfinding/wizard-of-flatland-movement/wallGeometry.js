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

    function lineIntersection(pointA, directionA, pointB, directionB, eps = DEFAULT_EPS) {
        const denominator = Number(directionA && directionA.x) * Number(directionB && directionB.y) -
            Number(directionA && directionA.y) * Number(directionB && directionB.x);
        if (Math.abs(denominator) <= eps) return null;
        const dx = Number(pointB && pointB.x) - Number(pointA && pointA.x);
        const dy = Number(pointB && pointB.y) - Number(pointA && pointA.y);
        const t = (dx * Number(directionB && directionB.y) - dy * Number(directionB && directionB.x)) / denominator;
        const u = (dx * Number(directionA && directionA.y) - dy * Number(directionA && directionA.x)) / denominator;
        return {
            x: Number(pointA && pointA.x) + Number(directionA && directionA.x) * t,
            y: Number(pointA && pointA.y) + Number(directionA && directionA.y) * t,
            t,
            u
        };
    }

    function orientation2D(a, b, c) {
        return (Number(b && b.y) - Number(a && a.y)) * (Number(c && c.x) - Number(b && b.x)) -
            (Number(b && b.x) - Number(a && a.x)) * (Number(c && c.y) - Number(b && b.y));
    }

    function onSegment2D(a, b, c, eps = DEFAULT_EPS) {
        return Math.min(Number(a && a.x), Number(b && b.x)) - eps <= Number(c && c.x) &&
            Number(c && c.x) <= Math.max(Number(a && a.x), Number(b && b.x)) + eps &&
            Math.min(Number(a && a.y), Number(b && b.y)) - eps <= Number(c && c.y) &&
            Number(c && c.y) <= Math.max(Number(a && a.y), Number(b && b.y)) + eps;
    }

    function segmentsIntersect2D(a, b, c, d, eps = DEFAULT_EPS) {
        const o1 = orientation2D(a, b, c);
        const o2 = orientation2D(a, b, d);
        const o3 = orientation2D(c, d, a);
        const o4 = orientation2D(c, d, b);

        const sign = (value) => (Math.abs(value) <= eps ? 0 : (value > 0 ? 1 : -1));
        const s1 = sign(o1);
        const s2 = sign(o2);
        const s3 = sign(o3);
        const s4 = sign(o4);
        if (s1 !== s2 && s3 !== s4) return true;
        if (s1 === 0 && onSegment2D(a, b, c, eps)) return true;
        if (s2 === 0 && onSegment2D(a, b, d, eps)) return true;
        if (s3 === 0 && onSegment2D(c, d, a, eps)) return true;
        if (s4 === 0 && onSegment2D(c, d, b, eps)) return true;
        return false;
    }

    function connectionCrossesWallFaces(connectionStart, connectionEnd, wallStart, wallEnd, options = {}) {
        const ax = finiteNumber(connectionStart && connectionStart.x);
        const ay = finiteNumber(connectionStart && connectionStart.y);
        const bx = finiteNumber(connectionEnd && connectionEnd.x);
        const by = finiteNumber(connectionEnd && connectionEnd.y);
        const sx = finiteNumber(wallStart && wallStart.x);
        const sy = finiteNumber(wallStart && wallStart.y);
        const ex = finiteNumber(wallEnd && wallEnd.x);
        const ey = finiteNumber(wallEnd && wallEnd.y);
        if (ax === null || ay === null || bx === null || by === null || sx === null || sy === null || ex === null || ey === null) {
            return false;
        }

        const eps = Number.isFinite(Number(options.eps)) ? Number(options.eps) : DEFAULT_EPS;
        const wallDx = ex - sx;
        const wallDy = ey - sy;
        const wallLen = Math.hypot(wallDx, wallDy);
        const connectionLen = Math.hypot(bx - ax, by - ay);
        if (!(wallLen > eps) || !(connectionLen > eps)) return false;

        const ux = wallDx / wallLen;
        const uy = wallDy / wallLen;
        const px = -uy;
        const py = ux;
        const halfT = Math.max(eps, (Number.isFinite(Number(options.thickness)) ? Number(options.thickness) : 0.1) * 0.5);
        const extend = Number.isFinite(Number(options.extend)) ? Number(options.extend) : 0.501;
        const segStart = { x: ax, y: ay };
        const segEnd = { x: bx, y: by };

        const testFace = (sign) => {
            const offX = px * sign * halfT;
            const offY = py * sign * halfT;
            const faceStart = { x: sx + offX - ux * extend, y: sy + offY - uy * extend };
            const faceEnd = { x: ex + offX + ux * extend, y: ey + offY + uy * extend };
            return segmentsIntersect2D(faceStart, faceEnd, segStart, segEnd, eps);
        };

        return testFace(1) || testFace(-1);
    }

    function sideLinePerpendicularCenterHit(point, direction, center, eps = DEFAULT_EPS) {
        const dx = Number(direction && direction.x);
        const dy = Number(direction && direction.y);
        const length = Math.hypot(dx, dy);
        if (!(length > eps)) return null;
        const unitDirection = { x: dx / length, y: dy / length };
        const perpendicular = { x: -unitDirection.y, y: unitDirection.x };
        return lineIntersection(point, unitDirection, center, perpendicular, eps);
    }

    function solveEndpointJoinery(entries, options = {}) {
        const eps = Number.isFinite(Number(options.eps)) ? Number(options.eps) : DEFAULT_EPS;
        const prepared = (Array.isArray(entries) ? entries : [])
            .map((entry, inputIndex) => {
                const sharedPoint = entry && entry.sharedPoint;
                const farPoint = entry && entry.farPoint;
                const sx = finiteNumber(sharedPoint && sharedPoint.x);
                const sy = finiteNumber(sharedPoint && sharedPoint.y);
                const fx = finiteNumber(farPoint && farPoint.x);
                const fy = finiteNumber(farPoint && farPoint.y);
                if (sx === null || sy === null || fx === null || fy === null) return null;
                const dx = fx - sx;
                const dy = fy - sy;
                const length = Math.hypot(dx, dy);
                if (!(length > eps)) return null;
                const ux = dx / length;
                const uy = dy / length;
                const leftN = { x: -uy, y: ux };
                const halfT = Math.max(0.001, Number(entry && entry.thickness) || 0.001) * 0.5;
                const sharedEnd = entry && entry.sharedEnd === "end" ? "end" : "start";
                return {
                    ...entry,
                    inputIndex,
                    sharedEnd,
                    sharedPoint: { x: sx, y: sy },
                    farPoint: { x: fx, y: fy },
                    awayDir: { x: ux, y: uy },
                    angle: Math.atan2(uy, ux),
                    leftFace: {
                        x: sx + leftN.x * halfT,
                        y: sy + leftN.y * halfT
                    },
                    rightFace: {
                        x: sx - leftN.x * halfT,
                        y: sy - leftN.y * halfT
                    },
                    leftLabel: sharedEnd === "start" ? "posN" : "negN",
                    rightLabel: sharedEnd === "start" ? "negN" : "posN"
                };
            })
            .filter(Boolean);

        if (prepared.length < 2) {
            return { entries: prepared, ringCorners: [], stores: [] };
        }

        prepared.sort((a, b) => {
            const angleDelta = b.angle - a.angle;
            if (Math.abs(angleDelta) > eps) return angleDelta;
            const idDelta = Number(a.wallId) - Number(b.wallId);
            if (Number.isFinite(idDelta) && Math.abs(idDelta) > eps) return idDelta;
            return a.inputIndex - b.inputIndex;
        });

        const centerSource = options.center || prepared[0].sharedPoint;
        const center = { x: Number(centerSource && centerSource.x), y: Number(centerSource && centerSource.y) };
        if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) {
            throw new Error("wall endpoint joinery requires a finite center");
        }

        const ringCorners = new Array(prepared.length).fill(null);
        for (let index = 0; index < prepared.length; index++) {
            const current = prepared[index];
            const next = prepared[(index + 1) % prepared.length];
            let hit = lineIntersection(current.rightFace, current.awayDir, next.leftFace, next.awayDir, eps);
            if (!hit) {
                const currentHit = sideLinePerpendicularCenterHit(current.rightFace, current.awayDir, center, eps);
                const nextHit = sideLinePerpendicularCenterHit(next.leftFace, next.awayDir, center, eps);
                if (currentHit && nextHit) {
                    const separation = Math.hypot(currentHit.x - nextHit.x, currentHit.y - nextHit.y);
                    if (separation <= 0.0001) {
                        hit = {
                            x: (currentHit.x + nextHit.x) * 0.5,
                            y: (currentHit.y + nextHit.y) * 0.5
                        };
                    }
                }
            }
            if (hit) ringCorners[index] = { x: Number(hit.x), y: Number(hit.y) };
        }

        const stores = prepared.map((entry, index) => {
            const store = {
                sharedEnd: entry.sharedEnd,
                center: { x: center.x, y: center.y }
            };
            const rightCorner = ringCorners[index];
            const leftCorner = ringCorners[(index - 1 + prepared.length) % prepared.length];
            if (rightCorner) store[entry.rightLabel] = rightCorner;
            if (leftCorner) store[entry.leftLabel] = leftCorner;
            return { entry, store };
        });

        return { entries: prepared, ringCorners, stores };
    }

    const api = {
        baseProfileFromEndpoints,
        connectionCrossesWallFaces,
        lineIntersection,
        normalizeDirection,
        orientation2D,
        onSegment2D,
        parameterForWorldPointOnSection,
        segmentsIntersect2D,
        sideLinePerpendicularCenterHit,
        solveEndpointJoinery,
        wallPositionAtScreenPoint
    };

    globalScope.WallGeometry = api;
    if (typeof module !== "undefined" && module.exports) {
        module.exports = api;
    }
})(typeof globalThis !== "undefined" ? globalThis : window);
