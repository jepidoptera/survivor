const polygonClipping = require("polygon-clipping");
const {
    BUBBLE_COORDS,
    INNER_COORDS,
    TERRAIN_TYPES,
    axialToModel,
    clipTerrainPolygonsToInnerSeven,
    compareTerrainBubblePolygons,
    coordKey,
    hexCorners,
    innerSevenMask,
    multiPolygonArea,
    roundPoint,
    terrainTilesByKey
} = require("./terrain-bubble-ruleset");

const ROUND_SCALE = 1000000;
const EPSILON = 1e-9;
const GRID_EPSILON = 1e-5;
const SQRT3 = Math.sqrt(3);
const TRIANGLE_GRID_U = { x: SQRT3 / 4, y: -0.25 };
const TRIANGLE_GRID_V = { x: 0, y: 0.5 };
const PRIORITY_BIAS_MODE = "pairwise-constant-v1";
const TERRAIN_PRIORITY = new Map([
    ["water", 0],
    ["mud", 1],
    ["grass", 2],
    ["mowedgrass", 3],
    ["desert", 4]
]);
const PRIORITY_BIAS_STEP_CANDIDATES = [
    0,
    0.01,
    0.02,
    0.03,
    0.04,
    0.05,
    0.06,
    0.075,
    0.09,
    0.105,
    0.12,
    0.15,
    0.18,
    0.21,
    0.24,
    0.27,
    0.3,
    0.35
];
const DEFAULT_MODEL = Object.freeze({
    schema: "terrain-bubble-iso-contour-model-v1",
    priorityBiasMode: PRIORITY_BIAS_MODE,
    priorityBiasStep: 0.18,
    quantizationSteps: 0,
    trainedExampleCount: 0,
    trainingError: null
});

function roundNumber(value) {
    return Math.round(Number(value) * ROUND_SCALE) / ROUND_SCALE;
}

function pointKey(point) {
    const rounded = roundPoint(point);
    return `${rounded.x},${rounded.y}`;
}

function pointToPair(point) {
    return [roundNumber(point.x), roundNumber(point.y)];
}

function pairToPoint(pair) {
    return {
        x: roundNumber(pair[0]),
        y: roundNumber(pair[1])
    };
}

function ringSignedArea(points) {
    let area = 0;
    for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        area += Number(a.x) * Number(b.y) - Number(b.x) * Number(a.y);
    }
    return area / 2;
}

function normalizeRing(points) {
    const out = [];
    for (const point of Array.isArray(points) ? points : []) {
        const rounded = roundPoint(point);
        const previous = out[out.length - 1];
        if (!previous || Math.hypot(previous.x - rounded.x, previous.y - rounded.y) > 1e-6) {
            out.push(rounded);
        }
    }
    if (out.length > 1) {
        const first = out[0];
        const last = out[out.length - 1];
        if (Math.hypot(first.x - last.x, first.y - last.y) <= 1e-6) out.pop();
    }
    return removeCollinearPoints(out);
}

function removeCollinearPoints(points) {
    if (!Array.isArray(points) || points.length < 4) return points;
    const out = [];
    for (let i = 0; i < points.length; i++) {
        const previous = points[(i + points.length - 1) % points.length];
        const current = points[i];
        const next = points[(i + 1) % points.length];
        const cross = ((current.x - previous.x) * (next.y - current.y)) -
            ((current.y - previous.y) * (next.x - current.x));
        if (Math.abs(cross) > 1e-8) out.push(current);
    }
    return out.length >= 3 ? out : points;
}

function triangleGridPoint(i, j) {
    return roundPoint({
        x: TRIANGLE_GRID_U.x * i + TRIANGLE_GRID_V.x * j,
        y: TRIANGLE_GRID_U.y * i + TRIANGLE_GRID_V.y * j
    });
}

function nearestTriangleGridPoint(point) {
    if (!Number.isFinite(Number(point && point.x)) || !Number.isFinite(Number(point && point.y))) {
        throw new Error("terrain iso-contour cannot snap a non-finite point to the triangle grid");
    }
    const estimatedI = Number(point.x) / TRIANGLE_GRID_U.x;
    const estimatedJ = (Number(point.y) - TRIANGLE_GRID_U.y * estimatedI) / TRIANGLE_GRID_V.y;
    const baseI = Math.round(estimatedI);
    const baseJ = Math.round(estimatedJ);
    let best = null;
    let bestDistance = Infinity;
    for (let di = -3; di <= 3; di++) {
        for (let dj = -3; dj <= 3; dj++) {
            const candidate = triangleGridPoint(baseI + di, baseJ + dj);
            const distance = Math.hypot(candidate.x - Number(point.x), candidate.y - Number(point.y));
            if (distance < bestDistance) {
                best = candidate;
                bestDistance = distance;
            }
        }
    }
    if (!best) throw new Error("terrain iso-contour could not resolve nearest triangle grid point");
    return best;
}

function pointIsOnTriangleGrid(point, epsilon = GRID_EPSILON) {
    return pointDistance(point, nearestTriangleGridPoint(point)) <= epsilon;
}

function snapRingToTriangleGrid(ring) {
    return normalizeRing((Array.isArray(ring) ? ring : []).map(nearestTriangleGridPoint));
}

function snapPolygonsToTriangleGrid(polygons) {
    const out = [];
    for (const polygon of polygons) {
        const points = snapRingToTriangleGrid(polygon.points);
        if (points.length < 3 || Math.abs(ringSignedArea(points)) <= EPSILON) continue;
        const next = {
            type: polygon.type,
            points: ringSignedArea(points) < 0 ? points.slice().reverse() : points
        };
        const holes = (polygon.holes || [])
            .map(snapRingToTriangleGrid)
            .filter((hole) => hole.length >= 3 && Math.abs(ringSignedArea(hole)) > EPSILON)
            .map((hole) => ringSignedArea(hole) > 0 ? hole.slice().reverse() : hole);
        if (holes.length > 0) next.holes = holes;
        out.push(next);
    }
    return sortTerrainPolygons(out);
}

function ringToMultiPolygon(points) {
    const ring = normalizeRing(points);
    if (ring.length < 3 || Math.abs(ringSignedArea(ring)) <= EPSILON) return [];
    const oriented = ringSignedArea(ring) < 0 ? ring.slice().reverse() : ring;
    return [[oriented.map(pointToPair)]];
}

function terrainPolygonToMultiPolygon(polygon) {
    const rings = [polygon.points].concat(Array.isArray(polygon.holes) ? polygon.holes : []);
    return [rings.map((ring) => normalizeRing(ring).map(pointToPair))];
}

function terrainPolygonsToMultiPolygon(polygons) {
    const out = [];
    for (const polygon of Array.isArray(polygons) ? polygons : []) {
        if (!polygon || !Array.isArray(polygon.points) || polygon.points.length < 3) continue;
        out.push(...terrainPolygonToMultiPolygon(polygon));
    }
    return out;
}

function unionAll(multiPolygons) {
    const nonEmpty = multiPolygons.filter((multiPolygon) => Array.isArray(multiPolygon) && multiPolygon.length > 0);
    if (nonEmpty.length === 0) return [];
    return polygonClipping.union(...nonEmpty);
}

function multiPolygonToTerrainPolygons(type, multiPolygon) {
    const out = [];
    for (const polygon of Array.isArray(multiPolygon) ? multiPolygon : []) {
        if (!Array.isArray(polygon) || polygon.length === 0) continue;
        const points = normalizeRing(polygon[0].map(pairToPoint));
        if (points.length < 3 || Math.abs(ringSignedArea(points)) <= EPSILON) continue;
        const holes = polygon.slice(1)
            .map((ring) => normalizeRing(ring.map(pairToPoint)))
            .filter((ring) => ring.length >= 3 && Math.abs(ringSignedArea(ring)) > EPSILON);
        const terrainPolygon = {
            type,
            points: ringSignedArea(points) < 0 ? points.slice().reverse() : points
        };
        if (holes.length > 0) {
            terrainPolygon.holes = holes.map((hole) => ringSignedArea(hole) > 0 ? hole.slice().reverse() : hole);
        }
        out.push(terrainPolygon);
    }
    return out;
}

function sortTerrainPolygons(polygons) {
    return polygons.slice().sort((a, b) => {
        const typeOrder = TERRAIN_TYPES.indexOf(a.type) - TERRAIN_TYPES.indexOf(b.type);
        if (typeOrder !== 0) return typeOrder;
        const areaOrder = Math.abs(ringSignedArea(b.points)) - Math.abs(ringSignedArea(a.points));
        if (Math.abs(areaOrder) > EPSILON) return areaOrder;
        const aFirst = a.points[0] || { x: 0, y: 0 };
        const bFirst = b.points[0] || { x: 0, y: 0 };
        return (aFirst.x - bFirst.x) || (aFirst.y - bFirst.y);
    });
}

function normalizedInput(input) {
    const tiles = terrainTilesByKey(input);
    return {
        schema: "terrain-bubble-19-v1",
        innerKeys: INNER_COORDS.map(coordKey),
        tiles: BUBBLE_COORDS.map((coord) => ({
            q: coord.q,
            r: coord.r,
            type: tiles.get(coordKey(coord))
        }))
    };
}

function normalizeModel(model = DEFAULT_MODEL, options = {}) {
    const source = model || DEFAULT_MODEL;
    if (source.schema && source.schema !== "terrain-bubble-iso-contour-model-v1") {
        throw new Error(`invalid terrain iso-contour model schema ${source.schema}`);
    }
    const priorityBiasMode = source.priorityBiasMode || PRIORITY_BIAS_MODE;
    if (priorityBiasMode !== PRIORITY_BIAS_MODE) {
        throw new Error(`terrain iso-contour model uses unsupported priorityBiasMode ${priorityBiasMode}`);
    }
    if (options.requirePriorityBiasMode && source.priorityBiasMode !== PRIORITY_BIAS_MODE) {
        throw new Error("trained terrain iso-contour model is stale; retrain to use pairwise-constant priority bias");
    }
    const priorityBiasStep = Number(source.priorityBiasStep);
    if (!Number.isFinite(priorityBiasStep)) {
        throw new Error("terrain iso-contour model requires a finite priorityBiasStep");
    }
    const quantizationSteps = Number(source.quantizationSteps || 0);
    if (!Number.isInteger(quantizationSteps) || quantizationSteps < 0) {
        throw new Error("terrain iso-contour model requires a non-negative integer quantizationSteps");
    }
    return {
        schema: "terrain-bubble-iso-contour-model-v1",
        priorityBiasMode,
        priorityBiasStep,
        quantizationSteps,
        trainedExampleCount: Number.isFinite(Number(source.trainedExampleCount)) ? Number(source.trainedExampleCount) : 0,
        trainingError: Number.isFinite(Number(source.trainingError)) ? Number(source.trainingError) : null,
        trainedAt: typeof source.trainedAt === "string" ? source.trainedAt : null
    };
}

function terrainPriorityValue(type) {
    const priority = TERRAIN_PRIORITY.get(type);
    if (!Number.isFinite(priority)) throw new Error(`terrain iso-contour has no priority for ${type}`);
    return priority;
}

function emptyFields() {
    const fields = {};
    for (const type of TERRAIN_TYPES) fields[type] = 0;
    return fields;
}

function scoreFields(fields) {
    const scores = {};
    for (const type of TERRAIN_TYPES) scores[type] = Number(fields[type] || 0);
    return scores;
}

function pairwisePriorityBias(type, otherType, model) {
    const priority = terrainPriorityValue(type);
    const otherPriority = terrainPriorityValue(otherType);
    if (priority === otherPriority) return 0;
    return priority > otherPriority ? model.priorityBiasStep : -model.priorityBiasStep;
}

function centerSample(coord, tiles, model) {
    const type = tiles.get(coordKey(coord));
    if (!TERRAIN_TYPES.includes(type)) throw new Error(`terrain iso-contour invalid center terrain ${type}`);
    const fields = emptyFields();
    fields[type] = 1;
    return {
        point: roundPoint(axialToModel(coord)),
        fields,
        scores: scoreFields(fields)
    };
}

function buildCornerContexts(tiles) {
    const contexts = new Map();
    for (const coord of BUBBLE_COORDS) {
        const type = tiles.get(coordKey(coord));
        if (!TERRAIN_TYPES.includes(type)) throw new Error(`terrain iso-contour invalid corner terrain ${type}`);
        for (const corner of hexCorners(coord)) {
            const point = roundPoint(corner);
            const key = pointKey(point);
            if (!contexts.has(key)) contexts.set(key, { point, tiles: [] });
            contexts.get(key).tiles.push({ coord, type });
        }
    }
    return contexts;
}

function cornerSample(point, contexts, model) {
    const key = pointKey(point);
    const context = contexts.get(key);
    if (!context || !Array.isArray(context.tiles) || context.tiles.length !== 3) {
        const count = context && Array.isArray(context.tiles) ? context.tiles.length : 0;
        throw new Error(`terrain iso-contour expected exactly three touching hexes at corner ${key}, found ${count}`);
    }
    const fields = emptyFields();
    for (const tile of context.tiles) fields[tile.type] += 1 / 3;
    return {
        point: roundPoint(point),
        fields,
        scores: scoreFields(fields)
    };
}

function buildEdgeContexts(tiles) {
    const contexts = new Map();
    for (const coord of BUBBLE_COORDS) {
        const type = tiles.get(coordKey(coord));
        if (!TERRAIN_TYPES.includes(type)) throw new Error(`terrain iso-contour invalid edge terrain ${type}`);
        const corners = hexCorners(coord).map(roundPoint);
        for (let i = 0; i < corners.length; i++) {
            const point = roundPoint({
                x: (corners[i].x + corners[(i + 1) % corners.length].x) / 2,
                y: (corners[i].y + corners[(i + 1) % corners.length].y) / 2
            });
            const key = pointKey(point);
            if (!contexts.has(key)) contexts.set(key, { point, tiles: [] });
            contexts.get(key).tiles.push({ coord, type });
        }
    }
    return contexts;
}

function edgeSample(point, contexts, model) {
    const key = pointKey(point);
    const context = contexts.get(key);
    if (!context || !Array.isArray(context.tiles) || context.tiles.length !== 2) {
        const count = context && Array.isArray(context.tiles) ? context.tiles.length : 0;
        throw new Error(`terrain iso-contour expected exactly two touching hexes at edge midpoint ${key}, found ${count}`);
    }
    const fields = emptyFields();
    for (const tile of context.tiles) fields[tile.type] += 1 / 2;
    return {
        point: roundPoint(point),
        fields,
        scores: scoreFields(fields)
    };
}

function interpolateSample(a, b, t, quantizationSteps) {
    let clamped = Math.max(0, Math.min(1, t));
    if (quantizationSteps > 0) clamped = Math.round(clamped * quantizationSteps) / quantizationSteps;
    const scores = {};
    const fields = {};
    for (const type of TERRAIN_TYPES) {
        fields[type] = Number(a.fields[type] || 0) + (Number(b.fields[type] || 0) - Number(a.fields[type] || 0)) * clamped;
        scores[type] = Number(a.scores[type]) + (Number(b.scores[type]) - Number(a.scores[type])) * clamped;
    }
    return {
        point: roundPoint({
            x: Number(a.point.x) + (Number(b.point.x) - Number(a.point.x)) * clamped,
            y: Number(a.point.y) + (Number(b.point.y) - Number(a.point.y)) * clamped
        }),
        fields,
        scores
    };
}

function scoreDiff(sample, type, otherType, model) {
    return Number(sample.fields[type] || 0) - Number(sample.fields[otherType] || 0) + pairwisePriorityBias(type, otherType, model);
}

function clipSamplesByScore(poly, type, otherType, model) {
    if (!Array.isArray(poly) || poly.length === 0) return [];
    const out = [];
    for (let i = 0; i < poly.length; i++) {
        const current = poly[i];
        const previous = poly[(i + poly.length - 1) % poly.length];
        const currentDiff = scoreDiff(current, type, otherType, model);
        const previousDiff = scoreDiff(previous, type, otherType, model);
        const currentInside = currentDiff >= -EPSILON;
        const previousInside = previousDiff >= -EPSILON;

        if (currentInside !== previousInside) {
            const denominator = previousDiff - currentDiff;
            if (Math.abs(denominator) <= EPSILON) {
                throw new Error(`terrain iso-contour could not resolve ${type}/${otherType} crossing`);
            }
            out.push(interpolateSample(previous, current, previousDiff / denominator, model.quantizationSteps));
        }
        if (currentInside) out.push(current);
    }
    return dedupeSampleRing(out);
}

function dedupeSampleRing(samples) {
    const out = [];
    for (const sample of samples) {
        const previous = out[out.length - 1];
        if (!previous || pointKey(previous.point) !== pointKey(sample.point)) out.push(sample);
    }
    if (out.length > 1 && pointKey(out[0].point) === pointKey(out[out.length - 1].point)) out.pop();
    return out;
}

function terrainCellRegion(cell, type, model) {
    if (!cellHasTerrain(cell, type)) return [];
    let region = cell.slice();
    for (const otherType of TERRAIN_TYPES) {
        if (otherType === type) continue;
        if (!cellHasTerrain(cell, otherType)) continue;
        region = clipSamplesByScore(region, type, otherType, model);
        if (region.length < 3) return [];
    }
    return normalizeRing(region.map((sample) => sample.point));
}

function cellHasTerrain(cell, type) {
    return Array.isArray(cell) && cell.some((sample) => Number(sample.fields && sample.fields[type]) > EPSILON);
}

function nearestPointOnSegment(point, a, b) {
    const dx = Number(b.x) - Number(a.x);
    const dy = Number(b.y) - Number(a.y);
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq <= EPSILON) return roundPoint(a);
    const t = Math.max(0, Math.min(1, ((Number(point.x) - Number(a.x)) * dx + (Number(point.y) - Number(a.y)) * dy) / lengthSq));
    return roundPoint({
        x: Number(a.x) + dx * t,
        y: Number(a.y) + dy * t
    });
}

function pointDistance(a, b) {
    return Math.hypot(Number(a.x) - Number(b.x), Number(a.y) - Number(b.y));
}

function pointOnSegment(point, a, b, epsilon = 1e-6) {
    return pointDistance(point, nearestPointOnSegment(point, a, b)) <= epsilon;
}

function pointInRing(point, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const pi = ring[i];
        const pj = ring[j];
        const intersects = ((pi.y > point.y) !== (pj.y > point.y)) &&
            (point.x < (pj.x - pi.x) * (point.y - pi.y) / (pj.y - pi.y) + pi.x);
        if (intersects) inside = !inside;
    }
    return inside;
}

function pointTouchesRing(point, ring, epsilon = 1e-6) {
    for (let i = 0; i < ring.length; i++) {
        if (pointOnSegment(point, ring[i], ring[(i + 1) % ring.length], epsilon)) return true;
    }
    return false;
}

function pointInsideOrTouchingTerrainPolygon(point, polygon) {
    if (!pointInRing(point, polygon.points || []) && !pointTouchesRing(point, polygon.points || [])) return false;
    for (const hole of polygon.holes || []) {
        if (pointInRing(point, hole) && !pointTouchesRing(point, hole)) return false;
    }
    return true;
}

function orientation(a, b, c) {
    return (Number(b.x) - Number(a.x)) * (Number(c.y) - Number(a.y)) -
        (Number(b.y) - Number(a.y)) * (Number(c.x) - Number(a.x));
}

function segmentsTouch(a, b, c, d, epsilon = 1e-6) {
    const abC = orientation(a, b, c);
    const abD = orientation(a, b, d);
    const cdA = orientation(c, d, a);
    const cdB = orientation(c, d, b);
    const boxesOverlap = (
        Math.min(a.x, b.x) - epsilon <= Math.max(c.x, d.x) &&
        Math.min(c.x, d.x) - epsilon <= Math.max(a.x, b.x) &&
        Math.min(a.y, b.y) - epsilon <= Math.max(c.y, d.y) &&
        Math.min(c.y, d.y) - epsilon <= Math.max(a.y, b.y)
    );
    if (!boxesOverlap) return false;
    if (Math.abs(abC) <= epsilon && pointOnSegment(c, a, b, epsilon)) return true;
    if (Math.abs(abD) <= epsilon && pointOnSegment(d, a, b, epsilon)) return true;
    if (Math.abs(cdA) <= epsilon && pointOnSegment(a, c, d, epsilon)) return true;
    if (Math.abs(cdB) <= epsilon && pointOnSegment(b, c, d, epsilon)) return true;
    return (abC > 0) !== (abD > 0) && (cdA > 0) !== (cdB > 0);
}

function segmentTouchesTerrainPolygonFill(a, b, polygon) {
    if (pointInsideOrTouchingTerrainPolygon(a, polygon) || pointInsideOrTouchingTerrainPolygon(b, polygon)) return true;
    const midpoint = roundPoint({
        x: (Number(a.x) + Number(b.x)) / 2,
        y: (Number(a.y) + Number(b.y)) / 2
    });
    if (pointInsideOrTouchingTerrainPolygon(midpoint, polygon)) return true;
    const rings = [polygon.points].concat(Array.isArray(polygon.holes) ? polygon.holes : []);
    for (const ring of rings) {
        for (let i = 0; i < ring.length; i++) {
            if (segmentsTouch(a, b, ring[i], ring[(i + 1) % ring.length])) return true;
        }
    }
    return false;
}

function polygonTouchesTileEdge(polygon, coord) {
    const corners = hexCorners(coord).map(roundPoint);
    for (let i = 0; i < corners.length; i++) {
        if (segmentTouchesTerrainPolygonFill(corners[i], corners[(i + 1) % corners.length], polygon)) return true;
    }
    return false;
}

function tileEdgeMidpointRing(coord) {
    const corners = hexCorners(coord).map(roundPoint);
    return corners.map((corner, index) => roundPoint({
        x: (corner.x + corners[(index + 1) % corners.length].x) / 2,
        y: (corner.y + corners[(index + 1) % corners.length].y) / 2
    }));
}

function ringSharpAngleProblem(type, ring, label) {
    const points = normalizeRing(ring || []);
    if (points.length < 3) return "";
    for (let i = 0; i < points.length; i++) {
        const previous = points[(i + points.length - 1) % points.length];
        const current = points[i];
        const next = points[(i + 1) % points.length];
        const ax = Number(previous.x) - Number(current.x);
        const ay = Number(previous.y) - Number(current.y);
        const bx = Number(next.x) - Number(current.x);
        const by = Number(next.y) - Number(current.y);
        const aLength = Math.hypot(ax, ay);
        const bLength = Math.hypot(bx, by);
        if (aLength <= 1e-6 || bLength <= 1e-6) continue;
        const cosine = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (aLength * bLength)));
        const angleDegrees = Math.acos(cosine) * 180 / Math.PI;
        if (angleDegrees < 90 - 1e-5) {
            return `${type} ${label} vertex ${i + 1} has ${roundNumber(angleDegrees)} degree angle`;
        }
    }
    return "";
}

function ringAngleDegrees(previous, current, next) {
    const ax = Number(previous.x) - Number(current.x);
    const ay = Number(previous.y) - Number(current.y);
    const bx = Number(next.x) - Number(current.x);
    const by = Number(next.y) - Number(current.y);
    const aLength = Math.hypot(ax, ay);
    const bLength = Math.hypot(bx, by);
    if (aLength <= 1e-6 || bLength <= 1e-6) return 180;
    const cosine = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (aLength * bLength)));
    return Math.acos(cosine) * 180 / Math.PI;
}

function enforceMinimumRingAngle(ring) {
    let points = normalizeRing(ring || []);
    let changed = true;
    let guard = 0;
    while (changed && points.length >= 3 && guard < 200) {
        guard++;
        changed = false;
        for (let i = 0; i < points.length; i++) {
            const previous = points[(i + points.length - 1) % points.length];
            const current = points[i];
            const next = points[(i + 1) % points.length];
            if (ringAngleDegrees(previous, current, next) >= 90 - 1e-5) continue;
            if (points.length <= 3) return [];
            points = points.slice(0, i).concat(points.slice(i + 1));
            changed = true;
            break;
        }
    }
    return normalizeRing(points);
}

function enforceMinimumAngles(polygons) {
    const out = [];
    for (const polygon of polygons) {
        const points = enforceMinimumRingAngle(polygon.points);
        if (points.length < 3 || Math.abs(ringSignedArea(points)) <= EPSILON) continue;
        const next = {
            type: polygon.type,
            points: ringSignedArea(points) < 0 ? points.slice().reverse() : points
        };
        const holes = (polygon.holes || [])
            .map(enforceMinimumRingAngle)
            .filter((hole) => hole.length >= 3 && Math.abs(ringSignedArea(hole)) > EPSILON)
            .map((hole) => ringSignedArea(hole) > 0 ? hole.slice().reverse() : hole);
        if (holes.length > 0) next.holes = holes;
        out.push(next);
    }
    return sortTerrainPolygons(out);
}

function ensureTileEdgeSupport(polygons, tiles) {
    const byType = new Map(TERRAIN_TYPES.map((type) => [type, []]));
    for (const polygon of polygons) {
        byType.get(polygon.type).push(terrainPolygonToMultiPolygon(polygon));
    }

    let addedSupport = false;
    for (const coord of INNER_COORDS) {
        const type = tiles.get(coordKey(coord));
        const matchingPolygons = polygons.filter((polygon) => polygon.type === type);
        if (matchingPolygons.some((polygon) => polygonTouchesTileEdge(polygon, coord))) continue;
        byType.get(type).push(ringToMultiPolygon(tileEdgeMidpointRing(coord)));
        addedSupport = true;
    }
    if (!addedSupport) return polygons;

    const out = [];
    for (const type of TERRAIN_TYPES) {
        out.push(...multiPolygonToTerrainPolygons(type, unionAll(byType.get(type))));
    }
    return sortTerrainPolygons(out);
}

function polygonRepresentativePointPairs(polygon) {
    if (!Array.isArray(polygon) || !Array.isArray(polygon[0]) || polygon[0].length === 0) {
        throw new Error("terrain iso-contour cannot resolve representative point for empty gap polygon");
    }
    const ring = polygon[0];
    const sum = ring.reduce((acc, pair) => ({
        x: acc.x + Number(pair[0]),
        y: acc.y + Number(pair[1])
    }), { x: 0, y: 0 });
    const centroid = {
        x: sum.x / ring.length,
        y: sum.y / ring.length
    };
    if (pointInRing(centroid, ring.map(pairToPoint))) return centroid;
    const first = pairToPoint(ring[0]);
    const second = pairToPoint(ring[1] || ring[0]);
    return {
        x: (first.x + second.x) / 2,
        y: (first.y + second.y) / 2
    };
}

function terrainTypeForPoint(point, tiles) {
    let best = null;
    let bestDistance = Infinity;
    for (const coord of INNER_COORDS) {
        const center = axialToModel(coord);
        const distance = Math.hypot(Number(point.x) - center.x, Number(point.y) - center.y);
        if (pointInRing(point, hexCorners(coord)) || pointTouchesRing(point, hexCorners(coord))) {
            return tiles.get(coordKey(coord));
        }
        if (distance < bestDistance) {
            best = coord;
            bestDistance = distance;
        }
    }
    if (!best) throw new Error("terrain iso-contour could not resolve gap terrain type");
    return tiles.get(coordKey(best));
}

function fillPartitionGaps(polygons, tiles) {
    const claimed = terrainPolygonsToMultiPolygon(polygons);
    const remainder = claimed.length > 0
        ? polygonClipping.difference(innerSevenMask(), unionAll([claimed]))
        : innerSevenMask();
    if (!Array.isArray(remainder) || remainder.length === 0 || multiPolygonArea(remainder) <= 0.00001) {
        return polygons;
    }

    const byType = new Map(TERRAIN_TYPES.map((type) => [type, []]));
    for (const polygon of polygons) byType.get(polygon.type).push(terrainPolygonToMultiPolygon(polygon));
    for (const polygon of remainder) {
        const type = terrainTypeForPoint(polygonRepresentativePointPairs(polygon), tiles);
        byType.get(type).push([polygon]);
    }

    const out = [];
    for (const type of TERRAIN_TYPES) {
        out.push(...multiPolygonToTerrainPolygons(type, unionAll(byType.get(type))));
    }
    return sortTerrainPolygons(out);
}

function symmetricCenterIslandTypes(tiles) {
    const centerType = tiles.get("0,0");
    if (!TERRAIN_TYPES.includes(centerType)) return null;
    let ringType = null;
    for (const coord of INNER_COORDS) {
        if (coord.q === 0 && coord.r === 0) continue;
        const type = tiles.get(coordKey(coord));
        if (!TERRAIN_TYPES.includes(type) || type === centerType) return null;
        if (ringType === null) ringType = type;
        if (type !== ringType) return null;
    }
    return ringType ? { centerType, ringType } : null;
}

function symmetricCenterIslandRing(centerType, ringType) {
    const centerPriority = terrainPriorityValue(centerType);
    const ringPriority = terrainPriorityValue(ringType);
    if (centerPriority > ringPriority) {
        return [
            { x: -SQRT3 / 2, y: -0.5 },
            { x: -SQRT3 / 4, y: -0.75 },
            { x: SQRT3 / 4, y: -0.75 },
            { x: SQRT3 / 2, y: -0.5 },
            { x: SQRT3 / 2, y: 0.5 },
            { x: SQRT3 / 4, y: 0.75 },
            { x: -SQRT3 / 4, y: 0.75 },
            { x: -SQRT3 / 2, y: 0.5 }
        ].map(roundPoint);
    }
    return [
        { x: -SQRT3 / 4, y: -0.75 },
        { x: SQRT3 / 4, y: -0.75 },
        { x: SQRT3 / 4, y: 0.75 },
        { x: -SQRT3 / 4, y: 0.75 }
    ].map(roundPoint);
}

function generateSymmetricCenterIslandPartition(tiles) {
    const types = symmetricCenterIslandTypes(tiles);
    if (!types) return null;
    const island = ringToMultiPolygon(symmetricCenterIslandRing(types.centerType, types.ringType));
    const outside = polygonClipping.difference(innerSevenMask(), island);
    return sortTerrainPolygons([
        ...multiPolygonToTerrainPolygons(types.centerType, island),
        ...multiPolygonToTerrainPolygons(types.ringType, outside)
    ]);
}

function generateStrictHexTilePartitionPolygons(tiles) {
    const byType = new Map(TERRAIN_TYPES.map((type) => [type, []]));
    for (const coord of INNER_COORDS) {
        const type = tiles.get(coordKey(coord));
        if (!TERRAIN_TYPES.includes(type)) throw new Error(`terrain iso-contour strict partition got invalid terrain ${type}`);
        byType.get(type).push(ringToMultiPolygon(hexCorners(coord)));
    }

    const out = [];
    for (const type of TERRAIN_TYPES) {
        out.push(...multiPolygonToTerrainPolygons(type, unionAll(byType.get(type))));
    }
    return snapPolygonsToTriangleGrid(sortTerrainPolygons(out));
}

function terrainPriority(type) {
    return terrainPriorityValue(type);
}

function makeTerrainPolygonsDisjoint(polygons) {
    const byType = new Map(TERRAIN_TYPES.map((type) => [type, []]));
    for (const polygon of polygons) byType.get(polygon.type).push(terrainPolygonToMultiPolygon(polygon));

    let claimed = [];
    const out = [];
    const typesByPriority = TERRAIN_TYPES.slice().sort((a, b) => terrainPriority(b) - terrainPriority(a));
    for (const type of typesByPriority) {
        let terrainArea = unionAll(byType.get(type));
        if (terrainArea.length > 0 && claimed.length > 0) {
            terrainArea = polygonClipping.difference(terrainArea, claimed);
        }
        out.push(...multiPolygonToTerrainPolygons(type, terrainArea));
        if (terrainArea.length > 0) {
            claimed = claimed.length > 0 ? polygonClipping.union(claimed, terrainArea) : terrainArea;
        }
    }
    return sortTerrainPolygons(out);
}

function assertAllVerticesOnTriangleGrid(polygons) {
    for (let polygonIndex = 0; polygonIndex < polygons.length; polygonIndex++) {
        const polygon = polygons[polygonIndex];
        const rings = [polygon.points].concat(Array.isArray(polygon.holes) ? polygon.holes : []);
        for (let ringIndex = 0; ringIndex < rings.length; ringIndex++) {
            const ring = rings[ringIndex] || [];
            for (let pointIndex = 0; pointIndex < ring.length; pointIndex++) {
                const point = ring[pointIndex];
                if (!pointIsOnTriangleGrid(point)) {
                    throw new Error(`terrain iso-contour vertex ${polygon.type}[${polygonIndex + 1}:${ringIndex + 1}:${pointIndex + 1}] is off the half-side triangle grid`);
                }
            }
        }
    }
}

function assertTerrainPartition(polygons) {
    const allTerrain = terrainPolygonsToMultiPolygon(polygons);
    const unioned = unionAll([allTerrain]);
    if (unioned.length !== 1) {
        throw new Error(`terrain iso-contour partition expected one union polygon, found ${unioned.length}`);
    }
    if (!Array.isArray(unioned[0]) || unioned[0].length !== 1) {
        const holeCount = Array.isArray(unioned[0]) ? Math.max(0, unioned[0].length - 1) : 0;
        throw new Error(`terrain iso-contour partition expected no union holes, found ${holeCount}`);
    }

    const unionArea = multiPolygonArea(unioned);
    const summedArea = TERRAIN_TYPES.reduce((sum, type) => {
        const typePolygons = polygons.filter((polygon) => polygon.type === type);
        return sum + multiPolygonArea(terrainPolygonsToMultiPolygon(typePolygons));
    }, 0);
    if (Math.abs(summedArea - unionArea) > 0.00001) {
        throw new Error(`terrain iso-contour partition has overlapping terrain area ${roundNumber(summedArea - unionArea)}`);
    }

    const mask = innerSevenMask();
    const xor = polygonClipping.xor(unioned, mask);
    const diffArea = multiPolygonArea(xor);
    if (diffArea > 0.00001) {
        throw new Error(`terrain iso-contour partition does not match inner-seven mask; diff area ${roundNumber(diffArea)}`);
    }
}

function finalizeIsoContourPolygons(polygons, tiles) {
    const symmetricCenterIsland = generateSymmetricCenterIslandPartition(tiles);
    if (symmetricCenterIsland) return snapPolygonsToTriangleGrid(symmetricCenterIsland);
    let current = snapPolygonsToTriangleGrid(sortTerrainPolygons(polygons));
    for (let i = 0; i < 6; i++) {
        current = snapPolygonsToTriangleGrid(makeTerrainPolygonsDisjoint(fillPartitionGaps(
            makeTerrainPolygonsDisjoint(ensureTileEdgeSupport(enforceMinimumAngles(current), tiles)),
            tiles
        )));
    }
    return current;
}

function assertIsoContourInvariants(polygons, tiles) {
    assertAllVerticesOnTriangleGrid(polygons);
    assertTerrainPartition(polygons);
    for (const coord of INNER_COORDS) {
        const type = tiles.get(coordKey(coord));
        const matchingPolygons = polygons.filter((polygon) => polygon.type === type);
        if (!matchingPolygons.some((polygon) => polygonTouchesTileEdge(polygon, coord))) {
            throw new Error(`terrain iso-contour produced no ${type} polygon touching an edge of tile ${coordKey(coord)}`);
        }
    }
    for (let polygonIndex = 0; polygonIndex < polygons.length; polygonIndex++) {
        const polygon = polygons[polygonIndex];
        const outerProblem = ringSharpAngleProblem(polygon.type, polygon.points, `polygon ${polygonIndex + 1}`);
        if (outerProblem) throw new Error(`terrain iso-contour produced sharp angle: ${outerProblem}`);
        for (let holeIndex = 0; holeIndex < (polygon.holes || []).length; holeIndex++) {
            const holeProblem = ringSharpAngleProblem(polygon.type, polygon.holes[holeIndex], `polygon ${polygonIndex + 1} hole ${holeIndex + 1}`);
            if (holeProblem) throw new Error(`terrain iso-contour produced sharp angle: ${holeProblem}`);
        }
    }
}

function validateIsoContourPolygons(input, polygons) {
    assertIsoContourInvariants(polygons, terrainTilesByKey(input));
}

function generateIsoContourPolygons(input, rawModel = DEFAULT_MODEL, diagnostics = null) {
    const model = normalizeModel(rawModel);
    const tiles = terrainTilesByKey(input);
    const cornerContexts = buildCornerContexts(tiles);
    const edgeContexts = buildEdgeContexts(tiles);
    const fragmentsByType = new Map(TERRAIN_TYPES.map((type) => [type, []]));

    for (const coord of INNER_COORDS) {
        const center = centerSample(coord, tiles, model);
        const corners = hexCorners(coord).map((corner) => cornerSample(corner, cornerContexts, model));
        const edgeMidpoints = corners.map((corner, index) => edgeSample({
            x: (corner.point.x + corners[(index + 1) % corners.length].point.x) / 2,
            y: (corner.point.y + corners[(index + 1) % corners.length].point.y) / 2
        }, edgeContexts, model));

        for (let i = 0; i < corners.length; i++) {
            const previousEdge = edgeMidpoints[(i + edgeMidpoints.length - 1) % edgeMidpoints.length];
            const nextEdge = edgeMidpoints[i];
            const subcells = [
                [center, previousEdge, corners[i]],
                [center, corners[i], nextEdge]
            ];
            for (const cell of subcells) {
                for (const type of TERRAIN_TYPES) {
                    const region = terrainCellRegion(cell, type, model);
                    if (region.length >= 3 && Math.abs(ringSignedArea(region)) > EPSILON) {
                        fragmentsByType.get(type).push(ringToMultiPolygon(region));
                    }
                }
            }
        }
    }

    const polygons = [];
    for (const type of TERRAIN_TYPES) {
        const unioned = unionAll(fragmentsByType.get(type));
        polygons.push(...multiPolygonToTerrainPolygons(type, unioned));
    }
    try {
        const sorted = finalizeIsoContourPolygons(polygons, tiles);
        assertIsoContourInvariants(sorted, tiles);
        if (diagnostics) diagnostics.strictRepair = null;
        return sorted;
    } catch (error) {
        const repaired = generateStrictHexTilePartitionPolygons(tiles);
        assertIsoContourInvariants(repaired, tiles);
        if (diagnostics) {
            diagnostics.strictRepair = {
                schema: "terrain-bubble-iso-contour-strict-repair-v1",
                mode: "hex-tile-partition",
                reason: error.message
            };
        }
        return repaired;
    }
}

function scoreModel(examples, model) {
    let totalDiffArea = 0;
    let scoredExampleCount = 0;
    for (const example of examples) {
        const actual = generateIsoContourPolygons(example.input, model);
        const expected = clipTerrainPolygonsToInnerSeven(example.output.polygons || []);
        const comparison = compareTerrainBubblePolygons(actual, expected);
        totalDiffArea += comparison.totalDiffArea;
        scoredExampleCount++;
    }
    return {
        scoredExampleCount,
        totalDiffArea: roundNumber(totalDiffArea)
    };
}

function trainIsoContourModel(examples, options = {}) {
    const editedExamples = (Array.isArray(examples) ? examples : [])
        .filter((example) => example && example.editor && example.editor.edited);
    if (editedExamples.length === 0) throw new Error("no edited examples for terrain iso-contour solver");
    const candidates = Array.isArray(options.priorityBiasStepCandidates)
        ? options.priorityBiasStepCandidates
        : PRIORITY_BIAS_STEP_CANDIDATES;

    let best = null;
    const rows = [];
    for (const step of candidates) {
        const model = normalizeModel({
            priorityBiasStep: Number(step),
            quantizationSteps: Number(options.quantizationSteps || 0),
            trainedExampleCount: editedExamples.length
        });
        let row;
        try {
            const score = scoreModel(editedExamples, model);
            row = {
                priorityBiasStep: model.priorityBiasStep,
                totalDiffArea: score.totalDiffArea,
                scoredExampleCount: score.scoredExampleCount
            };
        } catch (error) {
            row = {
                priorityBiasStep: model.priorityBiasStep,
                totalDiffArea: null,
                scoredExampleCount: 0,
                rejected: true,
                error: error.message
            };
        }
        rows.push(row);
        if (Number.isFinite(row.totalDiffArea) && (!best || row.totalDiffArea < best.totalDiffArea)) best = row;
    }
    if (!best) throw new Error("terrain iso-contour training produced no candidate models");

    return {
        schema: "terrain-bubble-iso-contour-model-v1",
        priorityBiasMode: PRIORITY_BIAS_MODE,
        priorityBiasStep: best.priorityBiasStep,
        quantizationSteps: Number(options.quantizationSteps || 0),
        trainedExampleCount: editedExamples.length,
        trainingError: best.totalDiffArea,
        trainedAt: new Date().toISOString(),
        trainingSearch: {
            schema: "terrain-bubble-iso-contour-training-search-v1",
            rows
        }
    };
}

function buildSuggestion(input, model = DEFAULT_MODEL, fields = {}) {
    const normalizedModel = normalizeModel(model);
    const diagnostics = {};
    const polygons = generateIsoContourPolygons(input, normalizedModel, diagnostics);
    const now = new Date().toISOString();
    const id = fields.id || `iso-contour-suggestion-${Date.now()}`;
    return {
        schema: "terrain-bubble-example-v1",
        id,
        name: fields.name || "iso-contour suggestion",
        createdAt: fields.createdAt || now,
        updatedAt: now,
        input: normalizedInput(input),
        output: {
            schema: "terrain-bubble-output-v1",
            fills: "inner-7",
            polygons
        },
        editor: {
            edited: false,
            generated: true,
            generatedBy: "terrain-bubble-iso-contour-solver-v1",
            savedAt: now,
            totalVertices: polygons.reduce((sum, polygon) => (
                sum + polygon.points.length + (polygon.holes || []).reduce((holeSum, hole) => holeSum + hole.length, 0)
            ), 0),
            isoContour: {
                schema: normalizedModel.schema,
                priorityBiasMode: normalizedModel.priorityBiasMode,
                priorityBiasStep: normalizedModel.priorityBiasStep,
                quantizationSteps: normalizedModel.quantizationSteps,
                trainedExampleCount: normalizedModel.trainedExampleCount,
                trainingError: normalizedModel.trainingError,
                strictRepair: diagnostics.strictRepair || null
            }
        }
    };
}

module.exports = {
    DEFAULT_MODEL,
    buildSuggestion,
    generateIsoContourPolygons,
    normalizeModel,
    scoreModel,
    trainIsoContourModel,
    validateIsoContourPolygons
};
