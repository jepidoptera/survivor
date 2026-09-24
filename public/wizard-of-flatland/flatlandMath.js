(function () {
    "use strict";

    function hashString(value) {
        const text = String(value || "");
        let hash = 2166136261;
        for (let i = 0; i < text.length; i++) {
            hash ^= text.charCodeAt(i);
            hash = Math.imul(hash, 16777619);
        }
        return hash >>> 0;
    }

    function seededRandom(seed) {
        let stateValue = seed >>> 0;
        return function nextRandom() {
            stateValue = (Math.imul(stateValue, 1664525) + 1013904223) >>> 0;
            return stateValue / 4294967296;
        };
    }

    function getHexCornersWorld(cx, cy, radius) {
        const corners = [];
        for (let i = 0; i < 6; i++) {
            const angle = (-30 + i * 60) * Math.PI / 180;
            corners.push({
                x: cx + Math.cos(angle) * radius,
                y: cy + Math.sin(angle) * radius
            });
        }
        return corners;
    }

    function isEvenGridColumn(col) {
        return Math.abs(col % 2) === 0;
    }

    function moveToward(value, target, maxDelta) {
        const current = Number(value);
        const goal = Number(target);
        const delta = Number(maxDelta);
        if (!Number.isFinite(current) || !Number.isFinite(goal) || !Number.isFinite(delta)) {
            throw new Error("Wizard of Flatland moveToward requires finite values");
        }
        if (Math.abs(goal - current) <= delta) return goal;
        return current + Math.sign(goal - current) * delta;
    }

    function normalizeAngle(angle) {
        let out = angle;
        while (out <= -Math.PI) out += Math.PI * 2;
        while (out > Math.PI) out -= Math.PI * 2;
        return out;
    }

    function shortestAngleDelta(from, to) {
        return normalizeAngle(to - from);
    }

    function squareDistance(ax, ay, bx, by) {
        const dx = bx - ax;
        const dy = by - ay;
        return dx * dx + dy * dy;
    }

    function rotatePoint(x, y, angle) {
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        return {
            x: x * cos - y * sin,
            y: x * sin + y * cos
        };
    }

    function segmentIntersectionParameters(ax, ay, bx, by, cx, cy, dx, dy) {
        const rx = bx - ax;
        const ry = by - ay;
        const sx = dx - cx;
        const sy = dy - cy;
        const denominator = rx * sy - ry * sx;
        if (Math.abs(denominator) <= 0.000001) return null;
        const qpx = cx - ax;
        const qpy = cy - ay;
        const t = (qpx * sy - qpy * sx) / denominator;
        const u = (qpx * ry - qpy * rx) / denominator;
        if (t < 0 || t > 1 || u < 0 || u > 1) return null;
        return { t, u };
    }

    function pointProjectionParameter(px, py, ax, ay, bx, by) {
        const dx = bx - ax;
        const dy = by - ay;
        const lengthSq = dx * dx + dy * dy;
        if (lengthSq <= 0.000001) return 0;
        return ((px - ax) * dx + (py - ay) * dy) / lengthSq;
    }

    function pointSegmentDistance(px, py, ax, ay, bx, by) {
        const t = Math.max(0, Math.min(1, pointProjectionParameter(px, py, ax, ay, bx, by)));
        const closestX = ax + (bx - ax) * t;
        const closestY = ay + (by - ay) * t;
        return Math.hypot(px - closestX, py - closestY);
    }

    function segmentRepulsionNormal(px, py, ax, ay, bx, by) {
        const t = Math.max(0, Math.min(1, pointProjectionParameter(px, py, ax, ay, bx, by)));
        const closestX = ax + (bx - ax) * t;
        const closestY = ay + (by - ay) * t;
        let nx = px - closestX;
        let ny = py - closestY;
        const length = Math.hypot(nx, ny);
        if (length > 0.000001) return { x: nx / length, y: ny / length };
        const wallDx = bx - ax;
        const wallDy = by - ay;
        const wallLength = Math.hypot(wallDx, wallDy);
        if (wallLength <= 0.000001) return { x: 1, y: 0 };
        return { x: -wallDy / wallLength, y: wallDx / wallLength };
    }

    window.WizardFlatlandMath = Object.freeze({
        hashString,
        seededRandom,
        getHexCornersWorld,
        isEvenGridColumn,
        moveToward,
        normalizeAngle,
        shortestAngleDelta,
        squareDistance,
        rotatePoint,
        segmentIntersectionParameters,
        pointProjectionParameter,
        pointSegmentDistance,
        segmentRepulsionNormal
    });
}());
