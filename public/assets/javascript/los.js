const LOSSystem = (() => {
    function shortestDeltaX(mapRef, fromX, toX) {
        if (mapRef && typeof mapRef.shortestDeltaX === "function") {
            return mapRef.shortestDeltaX(fromX, toX);
        }
        return toX - fromX;
    }

    function shortestDeltaY(mapRef, fromY, toY) {
        if (mapRef && typeof mapRef.shortestDeltaY === "function") {
            return mapRef.shortestDeltaY(fromY, toY);
        }
        return toY - fromY;
    }

    function normalizeAngle(theta) {
        let a = theta;
        const twoPi = Math.PI * 2;
        while (a <= -Math.PI) a += twoPi;
        while (a > Math.PI) a -= twoPi;
        return a;
    }

    function angleInSpan(theta, a0, a1) {
        const t = normalizeAngle(theta);
        const s0 = normalizeAngle(a0);
        const s1 = normalizeAngle(a1);
        let span = normalizeAngle(s1 - s0);
        if (span < 0) span += Math.PI * 2;
        let rel = normalizeAngle(t - s0);
        if (rel < 0) rel += Math.PI * 2;
        return rel <= span;
    }

    function angleToBin(theta, bins) {
        const twoPi = Math.PI * 2;
        const norm = normalizeAngle(theta);
        const unit = (norm + Math.PI) / twoPi;
        const idx = Math.floor(unit * bins);
        if (idx < 0) return 0;
        if (idx >= bins) return bins - 1;
        return idx;
    }

    function forEachBinInShortSpan(a0, a1, bins, callback) {
        const twoPi = Math.PI * 2;
        const start = normalizeAngle(a0);
        const delta = normalizeAngle(a1 - a0); // shortest signed arc in [-pi, pi]
        const direction = delta >= 0 ? 1 : -1;
        const spanBins = Math.max(1, Math.ceil((Math.abs(delta) / twoPi) * bins));
        const startIdx = angleToBin(start, bins);
        let prevIdx = -1;
        for (let i = 0; i <= spanBins; i++) {
            const idx = (startIdx + (direction * i) + bins) % bins;
            if (idx === prevIdx) continue;
            prevIdx = idx;
            callback(idx);
        }
    }

    function cross2(ax, ay, bx, by) {
        return ax * by - ay * bx;
    }

    function raySegmentDistance(wx, wy, dirX, dirY, x1, y1, x2, y2) {
        const rx = dirX;
        const ry = dirY;
        const sx = x2 - x1;
        const sy = y2 - y1;
        const qpx = x1 - wx;
        const qpy = y1 - wy;
        const denom = cross2(rx, ry, sx, sy);
        if (Math.abs(denom) < 1e-8) return null;
        const t = cross2(qpx, qpy, sx, sy) / denom;
        const u = cross2(qpx, qpy, rx, ry) / denom;
        if (t >= 0 && u >= 0 && u <= 1) return t;
        return null;
    }

    function rayCircleDistance(wx, wy, dirX, dirY, cx, cy, r) {
        const ox = wx - cx;
        const oy = wy - cy;
        const b = 2 * (ox * dirX + oy * dirY);
        const c = ox * ox + oy * oy - r * r;
        const disc = b * b - 4 * c;
        if (disc < 0) return null;
        const s = Math.sqrt(disc);
        const t1 = (-b - s) / 2;
        const t2 = (-b + s) / 2;
        if (t1 >= 0) return t1;
        if (t2 >= 0) return t2;
        return null;
    }

    function computeState(wizardRef, candidates, options = {}) {
        if (!wizardRef || !Array.isArray(candidates)) {
            return { bins: 1000, minAngle: -Math.PI, owner: [], depth: [], boundaryBins: [], visibleObjects: [], elapsedMs: 0 };
        }
        const startMs = performance.now();
        const bins = Number.isFinite(options.bins) ? Math.max(64, Math.floor(options.bins)) : 1000;
        const fovDegreesRaw = Number(options.fovDegrees);
        const fovDegrees = Number.isFinite(fovDegreesRaw) ? Math.max(0, Math.min(360, fovDegreesRaw)) : 360;
        const hasForwardFov = fovDegrees < 359.999;
        const facingAngle = Number.isFinite(options.facingAngle) ? normalizeAngle(options.facingAngle) : 0;
        const halfFovRad = (fovDegrees * Math.PI / 180) * 0.5;
        const twoPi = Math.PI * 2;
        const minAngle = -Math.PI;
        const depth = new Float32Array(bins);
        const owner = new Array(bins).fill(null);
        for (let i = 0; i < bins; i++) depth[i] = Infinity;

        const wx = wizardRef.x;
        const wy = wizardRef.y;
        const mapRef = wizardRef.map || null;
        const angleForBin = idx => minAngle + ((idx + 0.5) / bins) * twoPi;
        const isAngleInsideForwardFov = theta => {
            if (!hasForwardFov) return true;
            const delta = normalizeAngle(theta - facingAngle);
            return Math.abs(delta) <= halfFovRad;
        };

        const processHit = (obj, binIdx, hitDist) => {
            if (!Number.isFinite(hitDist) || hitDist < 0) return;
            if (hitDist < depth[binIdx]) {
                depth[binIdx] = hitDist;
                owner[binIdx] = obj;
            }
        };

        for (const obj of candidates) {
            if (!obj || obj.gone || obj.vanishing) continue;
            const hitbox = obj.groundPlaneHitbox;
            if (!hitbox) continue;

            if (hitbox instanceof CircleHitbox) {
                const cxRaw = hitbox.x;
                const cyRaw = hitbox.y;
                const r = hitbox.radius;
                if (!Number.isFinite(cxRaw) || !Number.isFinite(cyRaw) || !Number.isFinite(r) || r <= 0) continue;
                const dx = shortestDeltaX(mapRef, wx, cxRaw);
                const dy = shortestDeltaY(mapRef, wy, cyRaw);
                const cx = wx + dx;
                const cy = wy + dy;
                const centerDist = Math.hypot(dx, dy);
                if (centerDist <= r + 1e-6) {
                    for (let b = 0; b < bins; b++) processHit(obj, b, 0);
                    continue;
                }
                const centerAngle = Math.atan2(dy, dx);
                const halfSpan = Math.asin(Math.min(1, r / centerDist));
                const a0 = centerAngle - halfSpan;
                const a1 = centerAngle + halfSpan;
                forEachBinInShortSpan(a0, a1, bins, b => {
                    const theta = angleForBin(b);
                    if (!angleInSpan(theta, a0, a1)) return;
                    const dirX = Math.cos(theta);
                    const dirY = Math.sin(theta);
                    const t = rayCircleDistance(wx, wy, dirX, dirY, cx, cy, r);
                    if (t !== null) processHit(obj, b, t);
                });
                continue;
            }

            if (hitbox instanceof PolygonHitbox && Array.isArray(hitbox.points) && hitbox.points.length >= 2) {
                const points = hitbox.points.map(p => ({
                    x: wx + shortestDeltaX(mapRef, wx, p.x),
                    y: wy + shortestDeltaY(mapRef, wy, p.y)
                }));
                for (let i = 0; i < points.length; i++) {
                    const p1 = points[i];
                    const p2 = points[(i + 1) % points.length];
                    if (!p1 || !p2) continue;
                    const a0 = Math.atan2(p1.y - wy, p1.x - wx);
                    const a1 = Math.atan2(p2.y - wy, p2.x - wx);
                    forEachBinInShortSpan(a0, a1, bins, b => {
                        const theta = angleForBin(b);
                        const dirX = Math.cos(theta);
                        const dirY = Math.sin(theta);
                        const t = raySegmentDistance(wx, wy, dirX, dirY, p1.x, p1.y, p2.x, p2.y);
                        if (t !== null) processHit(obj, b, t);
                    });
                }
            }
        }

        if (hasForwardFov) {
            for (let i = 0; i < bins; i++) {
                const theta = angleForBin(i);
                if (!isAngleInsideForwardFov(theta)) {
                    // Outside forward FOV is always treated as blocked/shadowed.
                    depth[i] = 0;
                    owner[i] = null;
                }
            }
        }

        const boundaryBins = [];
        for (let i = 0; i < bins; i++) {
            const prev = owner[(i - 1 + bins) % bins];
            if (owner[i] !== prev) boundaryBins.push(i);
        }
        const visibleSet = new Set();
        for (let i = 0; i < bins; i++) {
            if (owner[i]) visibleSet.add(owner[i]);
        }
        return {
            bins,
            minAngle,
            owner,
            depth,
            boundaryBins,
            visibleObjects: Array.from(visibleSet),
            elapsedMs: performance.now() - startMs
        };
    }

    function buildPolygonWorldPoints(wizardRef, state, farDistance) {
        if (!wizardRef || !state || !state.depth || !Number.isFinite(state.bins) || state.bins < 3) return [];
        const bins = state.bins;
        const minAngle = Number.isFinite(state.minAngle) ? state.minAngle : -Math.PI;
        const twoPi = Math.PI * 2;
        const points = [];
        for (let i = 0; i < bins; i++) {
            const theta = minAngle + ((i + 0.5) / bins) * twoPi;
            const d = Number.isFinite(state.depth[i]) ? state.depth[i] : farDistance;
            points.push({
                x: wizardRef.x + Math.cos(theta) * d,
                y: wizardRef.y + Math.sin(theta) * d
            });
        }
        return points;
    }

    return {
        computeState,
        buildPolygonWorldPoints
    };
})();
