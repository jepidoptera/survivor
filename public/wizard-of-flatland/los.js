(function (globalScope) {
    "use strict";

    const DEFAULT_BINS = 720;
    const DEFAULT_MAX_DISTANCE = 20;
    const DEFAULT_MIN_DISTANCE = 1.2;
    const DEFAULT_EPSILON = 1e-8;

    function finiteNumber(value, label) {
        const number = Number(value);
        if (!Number.isFinite(number)) throw new Error(`Wizard of Flatland LOS requires finite ${label}`);
        return number;
    }

    function validateWallBuffer(walls, wallStride) {
        if (!(walls instanceof Float32Array)) throw new Error("Wizard of Flatland LOS requires a wall buffer");
        if (!Number.isInteger(wallStride) || wallStride <= 0) {
            throw new Error("Wizard of Flatland LOS requires a positive wall stride");
        }
        if (walls.length % wallStride !== 0) throw new Error("Wizard of Flatland LOS wall buffer has an invalid stride");
    }

    function cross2(ax, ay, bx, by) {
        return ax * by - ay * bx;
    }

    function raySegmentHit(originX, originY, dirX, dirY, ax, ay, bx, by, out) {
        const sx = bx - ax;
        const sy = by - ay;
        const qpx = ax - originX;
        const qpy = ay - originY;
        const denominator = cross2(dirX, dirY, sx, sy);
        if (Math.abs(denominator) < DEFAULT_EPSILON) return false;
        const t = cross2(qpx, qpy, sx, sy) / denominator;
        const u = cross2(qpx, qpy, dirX, dirY) / denominator;
        if (t < 0 || u < 0 || u > 1) return false;
        out.distance = t;
        out.wallT = u;
        return true;
    }

    function wallCouldAffectCircle(originX, originY, maxDistance, ax, ay, bx, by) {
        const minX = Math.min(ax, bx);
        const maxX = Math.max(ax, bx);
        const minY = Math.min(ay, by);
        const maxY = Math.max(ay, by);
        return (
            maxX >= originX - maxDistance &&
            minX <= originX + maxDistance &&
            maxY >= originY - maxDistance &&
            minY <= originY + maxDistance
        );
    }

    function collectCandidateWalls(walls, options) {
        const out = [];
        const wallStride = options.wallStride;
        const x1 = options.wallX1;
        const y1 = options.wallY1;
        const x2 = options.wallX2;
        const y2 = options.wallY2;
        const originX = options.originX;
        const originY = options.originY;
        const maxDistance = options.maxDistance;
        for (let i = 0; i < walls.length; i += wallStride) {
            const ax = finiteNumber(walls[i + x1], "wall start x");
            const ay = finiteNumber(walls[i + y1], "wall start y");
            const bx = finiteNumber(walls[i + x2], "wall end x");
            const by = finiteNumber(walls[i + y2], "wall end y");
            if (!wallCouldAffectCircle(originX, originY, maxDistance, ax, ay, bx, by)) continue;
            out.push({ ax, ay, bx, by, wallIndex: i / wallStride });
        }
        return out;
    }

    function computeVisibilityPolygon(input) {
        if (!input || typeof input !== "object") throw new Error("Wizard of Flatland LOS requires options");
        const walls = input.walls;
        const wallStride = Number.isInteger(input.wallStride) ? input.wallStride : 8;
        validateWallBuffer(walls, wallStride);

        const originX = finiteNumber(input.x, "origin x");
        const originY = finiteNumber(input.y, "origin y");
        const binsRaw = Number.isFinite(Number(input.bins)) ? Math.floor(Number(input.bins)) : DEFAULT_BINS;
        const bins = Math.max(64, binsRaw);
        const maxDistance = Number.isFinite(Number(input.maxDistance))
            ? Math.max(DEFAULT_MIN_DISTANCE, Number(input.maxDistance))
            : DEFAULT_MAX_DISTANCE;
        const wallX1 = Number.isInteger(input.wallX1) ? input.wallX1 : 0;
        const wallY1 = Number.isInteger(input.wallY1) ? input.wallY1 : 1;
        const wallX2 = Number.isInteger(input.wallX2) ? input.wallX2 : 2;
        const wallY2 = Number.isInteger(input.wallY2) ? input.wallY2 : 3;
        const startedAt = performance.now();
        const candidates = collectCandidateWalls(walls, {
            wallStride,
            wallX1,
            wallY1,
            wallX2,
            wallY2,
            originX,
            originY,
            maxDistance
        });
        const points = new Array(bins);
        const depths = new Float32Array(bins);
        const hitWallIndices = new Int32Array(bins);
        hitWallIndices.fill(-1);
        const hitWallTs = new Float32Array(bins);
        hitWallTs.fill(NaN);
        const rayHit = { distance: 0, wallT: 0 };
        const twoPi = Math.PI * 2;

        for (let i = 0; i < bins; i++) {
            const theta = -Math.PI + ((i + 0.5) / bins) * twoPi;
            const dirX = Math.cos(theta);
            const dirY = Math.sin(theta);
            let best = maxDistance;
            let bestWallIndex = -1;
            let bestWallT = NaN;
            for (let w = 0; w < candidates.length; w++) {
                const wall = candidates[w];
                const hit = raySegmentHit(originX, originY, dirX, dirY, wall.ax, wall.ay, wall.bx, wall.by, rayHit);
                if (hit && (rayHit.distance < best || (bestWallIndex < 0 && rayHit.distance <= best))) {
                    best = rayHit.distance;
                    bestWallIndex = wall.wallIndex;
                    bestWallT = rayHit.wallT;
                }
            }
            depths[i] = best;
            hitWallIndices[i] = bestWallIndex;
            hitWallTs[i] = bestWallT;
            points[i] = {
                x: originX + dirX * best,
                y: originY + dirY * best
            };
        }

        return {
            bins,
            maxDistance,
            points,
            depths,
            hitWallIndices,
            hitWallTs,
            candidateWallCount: candidates.length,
            elapsedMs: performance.now() - startedAt
        };
    }

    globalScope.getWizardFlatlandLosApi = function getWizardFlatlandLosApi() {
        return Object.freeze({
            computeVisibilityPolygon
        });
    };
})(typeof window !== "undefined" ? window : globalThis);
