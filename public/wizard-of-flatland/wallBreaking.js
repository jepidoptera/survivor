(function (globalScope) {
    "use strict";

    const KEY_PRECISION = 4;

    function createWallBreakingSystem(options) {
        const wallStride = requirePositiveInteger(options && options.wallStride, "wall stride");
        const wallX1 = requireNonNegativeInteger(options && options.wallX1, "wall x1 offset");
        const wallY1 = requireNonNegativeInteger(options && options.wallY1, "wall y1 offset");
        const wallX2 = requireNonNegativeInteger(options && options.wallX2, "wall x2 offset");
        const wallY2 = requireNonNegativeInteger(options && options.wallY2, "wall y2 offset");
        const wallLabelCode = requireNonNegativeInteger(options && options.wallLabelCode, "wall label offset");
        const wallLabelSide = requireNonNegativeInteger(options && options.wallLabelSide, "wall side offset");
        const baseSegmentLength = requirePositiveNumber(options && options.baseSegmentLength, "base segment length");
        const segmentScalePerZone = requireNonNegativeNumber(options && options.segmentScalePerZone, "segment scale per zone");
        const baseHitpoints = requirePositiveNumber(options && options.baseHitpoints, "base hitpoints");

        function buildRegistry(walls, sectionRanges, previousRegistry, getSectionZone, getFallbackSectionKey = () => "manual") {
            validateWalls(walls);
            if (!Array.isArray(sectionRanges)) throw new Error("Wizard of Flatland wall breaking requires section ranges");
            if (!(previousRegistry instanceof Map)) throw new Error("Wizard of Flatland wall breaking requires a previous segment registry");
            if (typeof getSectionZone !== "function") throw new Error("Wizard of Flatland wall breaking requires section zone lookup");
            if (typeof getFallbackSectionKey !== "function") throw new Error("Wizard of Flatland wall breaking requires fallback section lookup");
            const registry = new Map();
            const segmentIdsByWallIndex = new Array(walls.length / wallStride);
            for (let wallIndex = 0; wallIndex < segmentIdsByWallIndex.length; wallIndex++) {
                const base = wallIndex * wallStride;
                const ax = walls[base + wallX1];
                const ay = walls[base + wallY1];
                const bx = walls[base + wallX2];
                const by = walls[base + wallY2];
                const sectionKey = getWallSectionKey(wallIndex, sectionRanges)
                    || getFallbackSectionKey((ax + bx) * 0.5, (ay + by) * 0.5);
                if (typeof sectionKey !== "string" || sectionKey.length === 0) {
                    throw new Error(`Wizard of Flatland wall ${wallIndex} has no stable section identity`);
                }
                const zone = sectionKey === "manual" ? 0 : getSectionZone(sectionKey);
                if (!Number.isInteger(zone) || zone < 0) {
                    throw new Error(`Wizard of Flatland wall ${wallIndex} has invalid break zone ${zone}`);
                }
                const labelCode = Math.round(walls[base + wallLabelCode]);
                const sideCode = Math.round(walls[base + wallLabelSide]);
                const length = Math.hypot(bx - ax, by - ay);
                if (!(length > 0.001)) throw new Error(`Wizard of Flatland wall ${wallIndex} cannot be segmented`);
                const minimumLength = baseSegmentLength * (1 + zone * segmentScalePerZone);
                const count = Math.max(1, Math.floor(length / minimumLength + 0.000001));
                const actualLength = length / count;
                const ids = [];
                for (let segmentIndex = 0; segmentIndex < count; segmentIndex++) {
                    const startT = segmentIndex / count;
                    const endT = (segmentIndex + 1) / count;
                    const sax = lerp(ax, bx, startT);
                    const say = lerp(ay, by, startT);
                    const sbx = lerp(ax, bx, endT);
                    const sby = lerp(ay, by, endT);
                    const id = createSegmentId(sectionKey, sax, say, sbx, sby, labelCode, sideCode);
                    if (registry.has(id)) {
                        throw new Error(`Wizard of Flatland wall breaking produced duplicate segment ${id}`);
                    }
                    const previous = previousRegistry.get(id);
                    const hitpoints = baseHitpoints * actualLength / baseSegmentLength;
                    const damage = previous ? Number(previous.damage) : 0;
                    if (!Number.isFinite(damage) || damage < 0) {
                        throw new Error(`Wizard of Flatland wall segment ${id} has invalid damage`);
                    }
                    registry.set(id, {
                        id,
                        sectionKey,
                        wallIndex,
                        segmentIndex,
                        startT,
                        endT,
                        ax: sax,
                        ay: say,
                        bx: sbx,
                        by: sby,
                        length: actualLength,
                        hitpoints,
                        damage: Math.min(damage, hitpoints),
                        labelCode,
                        sideCode
                    });
                    ids.push(id);
                }
                segmentIdsByWallIndex[wallIndex] = ids;
            }
            return { registry, segmentIdsByWallIndex };
        }

        function chooseTarget(registry, segmentIdsByWallIndex, wallIndex, x, y) {
            if (!(registry instanceof Map) || !Array.isArray(segmentIdsByWallIndex)) {
                throw new Error("Wizard of Flatland wall target selection requires segment state");
            }
            if (!Number.isInteger(wallIndex) || wallIndex < 0 || wallIndex >= segmentIdsByWallIndex.length) {
                throw new Error(`Wizard of Flatland wall target selection received invalid wall ${wallIndex}`);
            }
            if (!Number.isFinite(x) || !Number.isFinite(y)) {
                throw new Error("Wizard of Flatland wall target selection requires finite actor coordinates");
            }
            const ids = segmentIdsByWallIndex[wallIndex];
            if (!Array.isArray(ids) || ids.length === 0) {
                throw new Error(`Wizard of Flatland wall ${wallIndex} has no breakable segments`);
            }
            let best = null;
            for (const id of ids) {
                const segment = registry.get(id);
                if (!segment) throw new Error(`Wizard of Flatland wall target segment ${id} is missing`);
                const distance = pointSegmentDistance(x, y, segment.ax, segment.ay, segment.bx, segment.by);
                const remainingRatio = Math.max(0, segment.hitpoints - segment.damage) / segment.hitpoints;
                const score = distance + remainingRatio * 0.35;
                if (!best || score < best.score) best = { ...segment, score };
            }
            return best;
        }

        function getWallProgress(registry, segmentIdsByWallIndex, wallIndex) {
            const ids = segmentIdsByWallIndex[wallIndex];
            if (!Array.isArray(ids) || ids.length === 0) return 0;
            let bestProgress = 0;
            for (const id of ids) {
                const segment = registry.get(id);
                if (!segment) throw new Error(`Wizard of Flatland wall progress segment ${id} is missing`);
                bestProgress = Math.max(bestProgress, segment.damage / segment.hitpoints);
            }
            return Math.max(0, Math.min(1, bestProgress));
        }

        function validateWalls(walls) {
            if (!(walls instanceof Float32Array) || walls.length % wallStride !== 0) {
                throw new Error("Wizard of Flatland wall breaking requires a valid wall buffer");
            }
        }

        return Object.freeze({
            buildRegistry,
            chooseTarget,
            getWallProgress,
            createSegmentId
        });
    }

    function getWallSectionKey(wallIndex, ranges) {
        for (const range of ranges) {
            if (!range || typeof range.sectionKey !== "string") continue;
            if (wallIndex >= range.startWallIndex && wallIndex < range.startWallIndex + range.wallCount) {
                return range.sectionKey;
            }
        }
        return null;
    }

    function createSegmentId(sectionKey, ax, ay, bx, by, labelCode, sideCode) {
        const forward = [ax, ay, bx, by];
        const reverse = [bx, by, ax, ay];
        const ordered = comparePoints(ax, ay, bx, by) <= 0 ? forward : reverse;
        return [
            sectionKey,
            ...ordered.map(formatCoordinate),
            Math.round(labelCode),
            Math.round(sideCode)
        ].join("|");
    }

    function comparePoints(ax, ay, bx, by) {
        if (ax !== bx) return ax - bx;
        return ay - by;
    }

    function formatCoordinate(value) {
        if (!Number.isFinite(value)) throw new Error("Wizard of Flatland wall segment identity requires finite coordinates");
        return Number(value).toFixed(KEY_PRECISION);
    }

    function pointSegmentDistance(px, py, ax, ay, bx, by) {
        const dx = bx - ax;
        const dy = by - ay;
        const lengthSq = dx * dx + dy * dy;
        const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq)) : 0;
        return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
    }

    function lerp(a, b, t) {
        return a + (b - a) * t;
    }

    function requirePositiveInteger(value, label) {
        if (!Number.isInteger(value) || value <= 0) throw new Error(`Wizard of Flatland ${label} must be a positive integer`);
        return value;
    }

    function requireNonNegativeInteger(value, label) {
        if (!Number.isInteger(value) || value < 0) throw new Error(`Wizard of Flatland ${label} must be a non-negative integer`);
        return value;
    }

    function requirePositiveNumber(value, label) {
        if (!Number.isFinite(value) || value <= 0) throw new Error(`Wizard of Flatland ${label} must be positive`);
        return value;
    }

    function requireNonNegativeNumber(value, label) {
        if (!Number.isFinite(value) || value < 0) throw new Error(`Wizard of Flatland ${label} must be non-negative`);
        return value;
    }

    globalScope.WizardFlatlandWallBreaking = Object.freeze({ createWallBreakingSystem });
}(typeof window !== "undefined" ? window : globalThis));
