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

    function clipSegmentToCircle(originX, originY, maxDistance, ax, ay, bx, by) {
        const startX = ax - originX;
        const startY = ay - originY;
        const dx = bx - ax;
        const dy = by - ay;
        const segmentLengthSquared = dx * dx + dy * dy;
        const radiusSquared = maxDistance * maxDistance;
        if (segmentLengthSquared <= DEFAULT_EPSILON) {
            if (startX * startX + startY * startY > radiusSquared) return null;
            return { ax, ay, bx, by, containsOrigin: startX * startX + startY * startY <= DEFAULT_EPSILON };
        }
        const closestT = Math.max(0, Math.min(1, -(startX * dx + startY * dy) / segmentLengthSquared));
        const closestX = startX + dx * closestT;
        const closestY = startY + dy * closestT;
        const b = 2 * (startX * dx + startY * dy);
        const c = startX * startX + startY * startY - radiusSquared;
        const discriminant = b * b - 4 * segmentLengthSquared * c;
        if (discriminant < 0) return null;
        const root = Math.sqrt(Math.max(0, discriminant));
        const startT = Math.max(0, (-b - root) / (2 * segmentLengthSquared));
        const endT = Math.min(1, (-b + root) / (2 * segmentLengthSquared));
        if (startT > endT) return null;
        return {
            ax: ax + dx * startT,
            ay: ay + dy * startT,
            bx: ax + dx * endT,
            by: ay + dy * endT,
            containsOrigin: closestX * closestX + closestY * closestY <= DEFAULT_EPSILON
        };
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
        const wallCount = walls.length / wallStride;
        const ranges = options.wallRanges === undefined
            ? [{ startWallIndex: 0, wallCount }]
            : options.wallRanges;
        if (!Array.isArray(ranges)) {
            throw new Error("Wizard of Flatland LOS wall ranges must be an array");
        }
        let scannedWallCount = 0;
        for (const range of ranges) {
            if (
                !range ||
                !Number.isInteger(range.startWallIndex) ||
                !Number.isInteger(range.wallCount) ||
                range.startWallIndex < 0 ||
                range.wallCount < 0 ||
                range.startWallIndex + range.wallCount > wallCount
            ) {
                throw new Error("Wizard of Flatland LOS received an invalid wall range");
            }
            const end = (range.startWallIndex + range.wallCount) * wallStride;
            for (let i = range.startWallIndex * wallStride; i < end; i += wallStride) {
                scannedWallCount++;
                const ax = finiteNumber(walls[i + x1], "wall start x");
                const ay = finiteNumber(walls[i + y1], "wall start y");
                const bx = finiteNumber(walls[i + x2], "wall end x");
                const by = finiteNumber(walls[i + y2], "wall end y");
                const clipped = clipSegmentToCircle(originX, originY, maxDistance, ax, ay, bx, by);
                if (!clipped) continue;
                out.push({ ax, ay, bx, by, wallIndex: i / wallStride, clipped });
            }
        }
        return { candidates: out, scannedWallCount };
    }

    function addCandidateToRayBuckets(candidate, buckets, originX, originY, bins) {
        const twoPi = Math.PI * 2;
        const step = twoPi / bins;
        const clipped = candidate.clipped;
        if (clipped.containsOrigin) {
            for (const bucket of buckets) bucket.push(candidate);
            return;
        }
        const startAngle = Math.atan2(clipped.ay - originY, clipped.ax - originX);
        const endAngle = Math.atan2(clipped.by - originY, clipped.bx - originX);
        let delta = endAngle - startAngle;
        while (delta > Math.PI) delta -= twoPi;
        while (delta < -Math.PI) delta += twoPi;
        const low = delta >= 0 ? startAngle : startAngle + delta;
        const high = delta >= 0 ? startAngle + delta : startAngle;
        const first = Math.ceil((low + Math.PI) / step - 0.5 - DEFAULT_EPSILON);
        const last = Math.floor((high + Math.PI) / step - 0.5 + DEFAULT_EPSILON);
        for (let unwrappedIndex = first; unwrappedIndex <= last; unwrappedIndex++) {
            const index = ((unwrappedIndex % bins) + bins) % bins;
            buckets[index].push(candidate);
        }
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
        const collected = collectCandidateWalls(walls, {
            wallStride,
            wallX1,
            wallY1,
            wallX2,
            wallY2,
            originX,
            originY,
            maxDistance,
            wallRanges: input.wallRanges
        });
        const candidates = collected.candidates;
        const rayCandidates = Array.from({ length: bins }, () => []);
        for (const candidate of candidates) {
            addCandidateToRayBuckets(candidate, rayCandidates, originX, originY, bins);
        }
        const points = new Float32Array(bins * 2);
        const depths = new Float32Array(bins);
        const hitWallIndices = new Int32Array(bins);
        hitWallIndices.fill(-1);
        const hitWallTs = new Float32Array(bins);
        hitWallTs.fill(NaN);
        const rayHit = { distance: 0, wallT: 0 };
        const twoPi = Math.PI * 2;
        let raySegmentTests = 0;

        for (let i = 0; i < bins; i++) {
            const theta = -Math.PI + ((i + 0.5) / bins) * twoPi;
            const dirX = Math.cos(theta);
            const dirY = Math.sin(theta);
            let best = maxDistance;
            let bestWallIndex = -1;
            let bestWallT = NaN;
            const candidatesForRay = rayCandidates[i];
            for (let w = 0; w < candidatesForRay.length; w++) {
                const wall = candidatesForRay[w];
                raySegmentTests++;
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
            points[i * 2] = originX + dirX * best;
            points[i * 2 + 1] = originY + dirY * best;
        }
        const enemyResult = computeEnemyVisibility(input, walls, {
            wallStride,
            wallX1,
            wallY1,
            wallX2,
            wallY2,
            originX,
            originY
        });

        return {
            bins,
            maxDistance,
            points,
            depths,
            hitWallIndices,
            hitWallTs,
            enemyTargets: enemyResult.targets,
            enemyVisibility: enemyResult.visibility,
            scannedWallCount: collected.scannedWallCount,
            candidateWallCount: candidates.length,
            raySegmentTests,
            enemyScannedWallCount: enemyResult.scannedWallCount,
            enemyCandidateWallCount: enemyResult.candidateWallCount,
            enemySegmentTests: enemyResult.segmentTests,
            elapsedMs: performance.now() - startedAt
        };
    }

    function computeEnemyVisibility(input, walls, wallOptions) {
        const targets = input.enemyTargets === undefined ? new Float64Array(0) : input.enemyTargets;
        if (!(targets instanceof Float64Array) || targets.length % 4 !== 0) {
            throw new Error("Wizard of Flatland LOS enemy targets require packed id, position, and radius data");
        }
        const targetCount = targets.length / 4;
        const visibility = new Uint8Array(targetCount);
        if (targetCount === 0) {
            return { targets, visibility, scannedWallCount: 0, candidateWallCount: 0, segmentTests: 0 };
        }
        let maxTargetDistance = 0;
        for (let i = 0; i < targetCount; i++) {
            const base = i * 4;
            finiteNumber(targets[base], `enemy target ${i} id`);
            const x = finiteNumber(targets[base + 1], `enemy target ${i} x`);
            const y = finiteNumber(targets[base + 2], `enemy target ${i} y`);
            const radius = finiteNumber(targets[base + 3], `enemy target ${i} radius`);
            if (!(radius > 0)) throw new Error(`Wizard of Flatland LOS enemy target ${i} requires a positive radius`);
            maxTargetDistance = Math.max(
                maxTargetDistance,
                Math.hypot(x - wallOptions.originX, y - wallOptions.originY)
            );
        }
        const collected = collectCandidateWalls(walls, {
            ...wallOptions,
            maxDistance: Math.max(DEFAULT_MIN_DISTANCE, maxTargetDistance),
            wallRanges: input.enemyWallRanges
        });
        const wallGeometry = globalScope.WallGeometry;
        if (!wallGeometry || typeof wallGeometry.connectionCrossesWallFaces !== "function") {
            throw new Error("Wizard of Flatland LOS enemy visibility requires WallGeometry.connectionCrossesWallFaces");
        }
        let segmentTests = 0;
        for (let i = 0; i < targetCount; i++) {
            const base = i * 4;
            const target = { x: targets[base + 1], y: targets[base + 2] };
            let visible = true;
            for (const wall of collected.candidates) {
                segmentTests++;
                if (wallGeometry.connectionCrossesWallFaces(
                    { x: wallOptions.originX, y: wallOptions.originY },
                    target,
                    { x: wall.ax, y: wall.ay },
                    { x: wall.bx, y: wall.by },
                    {
                        thickness: finiteNumber(input.enemyWallThickness, "enemy wall thickness"),
                        extend: finiteNumber(input.enemyWallFaceExtend, "enemy wall face extension")
                    }
                )) {
                    visible = false;
                    break;
                }
            }
            visibility[i] = visible ? 1 : 0;
        }
        return {
            targets,
            visibility,
            scannedWallCount: collected.scannedWallCount,
            candidateWallCount: collected.candidates.length,
            segmentTests
        };
    }

    globalScope.getWizardFlatlandLosApi = function getWizardFlatlandLosApi() {
        return Object.freeze({
            computeVisibilityPolygon
        });
    };
})(typeof window !== "undefined" ? window : globalThis);
