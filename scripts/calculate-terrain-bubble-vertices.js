#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const polygonClipping = require("polygon-clipping");
const {
    buildLearnedExample,
    generateLearnedTerrainBubblePolygons,
    outputSnapPoints,
    trainTerrainBubbleLearner
} = require("./terrain-bubble-learner");

const DEFAULT_EXAMPLES_PATH = path.join(__dirname, "..", "public", "assets", "data", "terrain-bubble-examples.json");
const TERRAIN_TYPES = ["grass", "water", "mud", "desert"];
const SQRT3 = Math.sqrt(3);
const ROUND_SCALE = 1000000;
const DEFAULT_MAX_ERROR = 0.25;
const SPATIAL_MESH_STEP = 0.125;
const SPATIAL_TREE_MAX_DEPTH = 19;
const SNAP_EDGE_TREE_MAX_DEPTH = 19;
const DIRECTIONS = [
    { q: 1, r: 0 },
    { q: 1, r: -1 },
    { q: 0, r: -1 },
    { q: -1, r: 0 },
    { q: -1, r: 1 },
    { q: 0, r: 1 }
];
const INNER_COORDS = [{ q: 0, r: 0 }, ...DIRECTIONS];
const BUBBLE_COORDS = createBubbleCoords(2);
const OUTER_COORDS = BUBBLE_COORDS.filter((coord) => axialDistance(coord) === 2);
const CORNER_NEIGHBOR_DIRECTION_INDICES = [
    [5, 0],
    [4, 5],
    [3, 4],
    [2, 3],
    [1, 2],
    [0, 1]
];
const EDGE_CORNER_INDICES = [
    [5, 0],
    [4, 5],
    [3, 4],
    [2, 3],
    [1, 2],
    [0, 1]
];
const TERRAIN_PRIORITY = new Map([
    ["water", 0],
    ["mud", 1],
    ["grass", 2],
    ["desert", 3]
]);

function parseArgs(argv) {
    const options = {
        examplesPath: DEFAULT_EXAMPLES_PATH,
        maxError: DEFAULT_MAX_ERROR,
        inputOnly: false,
        json: false
    };

    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--examples") {
            options.examplesPath = path.resolve(argv[++i] || "");
        } else if (arg === "--max-error") {
            options.maxError = Number(argv[++i]);
        } else if (arg === "--input-only") {
            options.inputOnly = true;
        } else if (arg === "--json") {
            options.json = true;
        } else if (arg === "--help" || arg === "-h") {
            options.help = true;
        } else {
            throw new Error(`unknown option ${arg}`);
        }
    }

    if (!Number.isFinite(options.maxError) || options.maxError < 0) {
        throw new Error("--max-error must be a non-negative number");
    }
    return options;
}

function usage() {
    return [
        "Usage: node scripts/calculate-terrain-bubble-vertices.js [options]",
        "",
        "Calculates terrain-bubble vertices with a generalized input-only rule model and reports area error.",
        "",
        "Options:",
        "  --examples <path>    Examples JSON path",
        "  --max-error <n>      Required maximum error (default 0.25)",
        "  --input-only         Kept for compatibility; generation is always input-only",
        "  --json               Print the report as JSON",
        "  --help               Show this help"
    ].join("\n");
}

function loadExamples(examplesPath) {
    const raw = fs.readFileSync(examplesPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.schema !== "terrain-bubble-examples-v1" || !Array.isArray(parsed.examples)) {
        throw new Error(`invalid terrain bubble examples schema in ${examplesPath}`);
    }
    return parsed.examples.filter((example) => example.editor && example.editor.edited);
}

function coordKey(coord) {
    return `${coord.q},${coord.r}`;
}

function axialDistance(coord) {
    return Math.max(Math.abs(coord.q), Math.abs(coord.r), Math.abs(-coord.q - coord.r));
}

function createBubbleCoords(radius) {
    const coords = [];
    for (let q = -radius; q <= radius; q++) {
        for (let r = -radius; r <= radius; r++) {
            const coord = { q, r };
            if (axialDistance(coord) <= radius) coords.push(coord);
        }
    }
    return coords.sort((a, b) => axialDistance(a) - axialDistance(b) || a.r - b.r || a.q - b.q);
}

function roundNumber(value) {
    return Math.round(Number(value) * ROUND_SCALE) / ROUND_SCALE;
}

function roundPoint(point) {
    return {
        x: roundNumber(point.x),
        y: roundNumber(point.y)
    };
}

function pointKey(point) {
    const rounded = roundPoint(point);
    return `${rounded.x},${rounded.y}`;
}

function axialToModel(coord) {
    return {
        x: SQRT3 * (coord.q + coord.r / 2),
        y: 1.5 * coord.r
    };
}

function hexCorners(coord) {
    const center = axialToModel(coord);
    const corners = [];
    for (let i = 0; i < 6; i++) {
        const angle = Math.PI / 180 * (30 + i * 60);
        corners.push(roundPoint({
            x: center.x + Math.cos(angle),
            y: center.y + Math.sin(angle)
        }));
    }
    return corners;
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

function ringToPolygonClippingPolygon(points) {
    return [[points.map(pointToPair)]];
}

function terrainPolygonToMultiPolygon(polygon) {
    const rings = [polygon.points].concat(Array.isArray(polygon.holes) ? polygon.holes : []);
    return [rings.map((ring) => ring.map(pointToPair))];
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

function ringAreaPairs(ring) {
    let area = 0;
    for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        area += Number(a[0]) * Number(b[1]) - Number(b[0]) * Number(a[1]);
    }
    return area / 2;
}

function multiPolygonArea(multiPolygon) {
    let total = 0;
    for (const polygon of Array.isArray(multiPolygon) ? multiPolygon : []) {
        if (!Array.isArray(polygon) || polygon.length === 0) continue;
        total += Math.abs(ringAreaPairs(polygon[0]));
        for (let i = 1; i < polygon.length; i++) total -= Math.abs(ringAreaPairs(polygon[i]));
    }
    return total;
}

function pointDistance(a, b) {
    return Math.hypot(Number(a.x) - Number(b.x), Number(a.y) - Number(b.y));
}

function normalizeRing(points) {
    const out = [];
    for (const point of points) {
        const rounded = roundPoint(point);
        const previous = out[out.length - 1];
        if (!previous || pointDistance(previous, rounded) > 1e-6) out.push(rounded);
    }
    if (out.length > 1 && pointDistance(out[0], out[out.length - 1]) <= 1e-6) out.pop();
    return out;
}

function unionAll(multiPolygons) {
    const nonEmpty = multiPolygons.filter((multiPolygon) => Array.isArray(multiPolygon) && multiPolygon.length > 0);
    if (nonEmpty.length === 0) return [];
    return polygonClipping.union(...nonEmpty);
}

function innerSevenMask() {
    return unionAll(INNER_COORDS.map((coord) => ringToPolygonClippingPolygon(hexCorners(coord))));
}

function erodedInnerSevenMask() {
    const s = SQRT3;
    return ringToPolygonClippingPolygon([
        { x: -s, y: -0.5 },
        { x: -0.75 * s, y: -1.25 },
        { x: -0.25 * s, y: -1.75 },
        { x: 0.25 * s, y: -1.75 },
        { x: 0.75 * s, y: -1.25 },
        { x: s, y: -0.5 },
        { x: s, y: 0.5 },
        { x: 0.75 * s, y: 1.25 },
        { x: 0.25 * s, y: 1.75 },
        { x: -0.25 * s, y: 1.75 },
        { x: -0.75 * s, y: 1.25 },
        { x: -s, y: 0.5 }
    ].map(roundPoint));
}

function multiPolygonToTerrainPolygons(type, multiPolygon) {
    const out = [];
    for (const polygon of Array.isArray(multiPolygon) ? multiPolygon : []) {
        if (!Array.isArray(polygon) || polygon.length === 0) continue;
        const points = normalizeRing(polygon[0].map(pairToPoint));
        if (points.length < 3 || Math.abs(ringSignedArea(points)) <= 1e-9) continue;
        const holes = polygon.slice(1)
            .map((ring) => normalizeRing(ring.map(pairToPoint)))
            .filter((ring) => ring.length >= 3 && Math.abs(ringSignedArea(ring)) > 1e-9);
        const terrainPolygon = {
            type,
            points: ringSignedArea(points) < 0 ? points.slice().reverse() : points
        };
        if (holes.length > 0) terrainPolygon.holes = holes;
        out.push(terrainPolygon);
    }
    return out;
}

function sortTerrainPolygons(polygons) {
    return polygons.slice().sort((a, b) => {
        const typeOrder = TERRAIN_TYPES.indexOf(a.type) - TERRAIN_TYPES.indexOf(b.type);
        if (typeOrder !== 0) return typeOrder;
        const areaOrder = Math.abs(ringSignedArea(b.points)) - Math.abs(ringSignedArea(a.points));
        if (Math.abs(areaOrder) > 1e-9) return areaOrder;
        const aFirst = a.points[0] || { x: 0, y: 0 };
        const bFirst = b.points[0] || { x: 0, y: 0 };
        return (aFirst.x - bFirst.x) || (aFirst.y - bFirst.y);
    });
}

function clipTerrainPolygonsToInnerSeven(polygons) {
    const mask = innerSevenMask();
    const byType = new Map(TERRAIN_TYPES.map((type) => [type, []]));
    for (const polygon of Array.isArray(polygons) ? polygons : []) {
        if (!polygon || !TERRAIN_TYPES.includes(polygon.type)) continue;
        const clipped = polygonClipping.intersection(terrainPolygonToMultiPolygon(polygon), mask);
        if (Array.isArray(clipped) && clipped.length > 0) byType.get(polygon.type).push(clipped);
    }

    const out = [];
    for (const type of TERRAIN_TYPES) {
        const unioned = unionAll(byType.get(type));
        out.push(...multiPolygonToTerrainPolygons(type, unioned));
    }
    return sortTerrainPolygons(out);
}

function terrainPolygonsByTypeMultiPolygon(polygons) {
    const byType = new Map(TERRAIN_TYPES.map((type) => [type, []]));
    for (const polygon of Array.isArray(polygons) ? polygons : []) {
        if (!polygon || !TERRAIN_TYPES.includes(polygon.type)) continue;
        byType.get(polygon.type).push(terrainPolygonToMultiPolygon(polygon));
    }
    const out = new Map();
    for (const type of TERRAIN_TYPES) out.set(type, unionAll(byType.get(type)));
    return out;
}

function compareTerrainBubblePolygons(actualPolygons, expectedPolygons) {
    const actualByType = terrainPolygonsByTypeMultiPolygon(actualPolygons);
    const expectedByType = terrainPolygonsByTypeMultiPolygon(expectedPolygons);
    const rows = [];
    for (const type of TERRAIN_TYPES) {
        const actual = actualByType.get(type);
        const expected = expectedByType.get(type);
        const actualArea = multiPolygonArea(actual);
        const expectedArea = multiPolygonArea(expected);
        const xor = (actual.length || expected.length) ? polygonClipping.xor(actual, expected) : [];
        const diffArea = multiPolygonArea(xor);
        rows.push({
            type,
            actualArea: roundNumber(actualArea),
            expectedArea: roundNumber(expectedArea),
            diffArea: roundNumber(diffArea)
        });
    }
    return {
        rows,
        totalDiffArea: roundNumber(rows.reduce((sum, row) => sum + row.diffArea, 0))
    };
}

function clonePolygons(polygons) {
    return polygons.map((polygon) => ({
        type: polygon.type,
        points: polygon.points.map(roundPoint),
        holes: (polygon.holes || []).map((hole) => hole.map(roundPoint))
    }));
}

function normalizedOutputPolygons(example) {
    if (!example || !example.output || !Array.isArray(example.output.polygons)) {
        throw new Error(`example ${example && example.id} is missing output.polygons`);
    }
    return clipTerrainPolygonsToInnerSeven(example.output.polygons);
}

function inputSignature(input) {
    if (!input || input.schema !== "terrain-bubble-19-v1" || !Array.isArray(input.tiles)) {
        throw new Error("terrain bubble calculator requires terrain-bubble-19-v1 input.tiles");
    }
    const seen = new Set();
    for (const tile of input.tiles) {
        if (!tile || !TERRAIN_TYPES.includes(tile.type)) {
            throw new Error(`invalid terrain type ${tile && tile.type}`);
        }
        seen.add(coordKey(tile));
    }
    for (const coord of BUBBLE_COORDS) {
        if (!seen.has(coordKey(coord))) throw new Error(`input missing tile ${coordKey(coord)}`);
    }
    return input.tiles
        .map((tile) => `${tile.q},${tile.r}:${tile.type}`)
        .sort()
        .join("|");
}

function terrainTilesByKey(input) {
    inputSignature(input);
    return new Map(input.tiles.map((tile) => [coordKey(tile), tile.type]));
}

function innerTerrainTypes(input) {
    const tiles = terrainTilesByKey(input);
    return new Set(INNER_COORDS.map((coord) => tiles.get(coordKey(coord))));
}

function uniformOuterTerrain(input) {
    const tiles = terrainTilesByKey(input);
    const outerTypes = new Set(OUTER_COORDS.map((coord) => tiles.get(coordKey(coord))));
    return outerTypes.size === 1 ? [...outerTypes][0] : null;
}

function terrainPolygonsToMultiPolygon(polygons) {
    const normalized = [];
    for (const polygon of Array.isArray(polygons) ? polygons : []) {
        if (!polygon || !Array.isArray(polygon.points) || polygon.points.length < 3) continue;
        normalized.push(...terrainPolygonToMultiPolygon(polygon));
    }
    return normalized;
}

function terrainPriority(type) {
    if (!TERRAIN_PRIORITY.has(type)) throw new Error(`unknown terrain priority for ${type}`);
    return TERRAIN_PRIORITY.get(type);
}

function neighborCoord(coord, directionIndex) {
    const direction = DIRECTIONS[directionIndex];
    return {
        q: coord.q + direction.q,
        r: coord.r + direction.r
    };
}

function buildTerrainVertexSlotMap(coords) {
    const out = new Map();
    for (const coord of coords) {
        const corners = hexCorners(coord);
        for (let i = 0; i < corners.length; i++) {
            const key = pointKey(corners[i]);
            if (!out.has(key)) out.set(key, new Set());
            const slots = out.get(key);
            slots.add(coordKey(coord));
            for (const directionIndex of CORNER_NEIGHBOR_DIRECTION_INDICES[i]) {
                slots.add(coordKey(neighborCoord(coord, directionIndex)));
            }
        }
    }
    return out;
}

function terrainTypeForSlotKey(slotKey, tiles) {
    return tiles.get(slotKey) || "grass";
}

function boundaryKeepStats(type, slots, tiles, options = {}) {
    const groupPriority = terrainPriority(type);
    let groupCount = 0;
    let higherPriorityNeighbor = false;
    const terrainTypes = new Set();
    for (const slotKey of slots) {
        const slotType = terrainTypeForSlotKey(slotKey, tiles);
        terrainTypes.add(slotType);
        if (slotType === type) {
            groupCount += 1;
        } else if (terrainPriority(slotType) > groupPriority) {
            higherPriorityNeighbor = true;
        }
    }

    const normalKeepNonGroupCount = options.isHole ? 1 : 2;
    const nonGroupCount = 3 - groupCount;
    if (terrainTypes.size >= 3 && groupCount === 1) {
        let lowestPriority = groupPriority;
        for (const slotKey of slots) {
            lowestPriority = Math.min(lowestPriority, terrainPriority(terrainTypeForSlotKey(slotKey, tiles)));
        }
        return {
            groupCount,
            nonGroupCount,
            higherPriorityNeighbor,
            keepNonGroupCount: groupPriority === lowestPriority ? 1 : 2
        };
    }

    return {
        groupCount,
        nonGroupCount,
        higherPriorityNeighbor,
        keepNonGroupCount: higherPriorityNeighbor && !options.isHole
            ? 3 - normalKeepNonGroupCount
            : normalKeepNonGroupCount
    };
}

function resolveSlotCenter(slotKey) {
    const [q, r] = String(slotKey).split(",").map(Number);
    if (!Number.isFinite(q) || !Number.isFinite(r)) return null;
    return roundPoint(axialToModel({ q, r }));
}

function priorityJunctionForVertex(point, slots, type, tiles) {
    if (!(slots instanceof Set) || slots.size !== 3) return null;
    const typeBySlot = new Map();
    const priorities = [];
    for (const slotKey of slots) {
        const slotType = terrainTypeForSlotKey(slotKey, tiles);
        typeBySlot.set(slotKey, slotType);
        priorities.push(terrainPriority(slotType));
    }
    const distinctTypes = new Set(typeBySlot.values());
    if (distinctTypes.size !== 3 || !distinctTypes.has(type)) return null;

    const lowestPriority = Math.min(...priorities);
    const lowSlots = [...typeBySlot.entries()].filter(([, slotType]) => (
        terrainPriority(slotType) === lowestPriority
    ));
    if (lowSlots.length !== 1) return null;

    const [lowSlotKey, lowType] = lowSlots[0];
    const [q, r] = lowSlotKey.split(",").map(Number);
    if (!Number.isFinite(q) || !Number.isFinite(r)) return null;
    const lowCoord = { q, r };
    const corners = hexCorners(lowCoord);
    const vertexKey = pointKey(point);
    const cornerIndex = corners.findIndex((corner) => pointKey(corner) === vertexKey);
    if (cornerIndex < 0) return null;

    const previous = corners[(cornerIndex + corners.length - 1) % corners.length];
    const next = corners[(cornerIndex + 1) % corners.length];
    const center = axialToModel(lowCoord);
    const rx = center.x - point.x;
    const ry = center.y - point.y;
    const sx = next.x - previous.x;
    const sy = next.y - previous.y;
    const denom = rx * sy - ry * sx;
    let junction = null;
    if (Math.abs(denom) > 1e-9) {
        const qx = previous.x - point.x;
        const qy = previous.y - point.y;
        const t = (qx * sy - qy * sx) / denom;
        junction = {
            x: point.x + rx * t,
            y: point.y + ry * t
        };
    }
    if (!junction || !Number.isFinite(junction.x) || !Number.isFinite(junction.y)) {
        junction = {
            x: (previous.x + next.x) / 2,
            y: (previous.y + next.y) / 2
        };
    }

    return {
        point: roundPoint(junction),
        groupIsLowest: terrainPriority(type) === terrainPriority(lowType),
        lowAdjacentPoints: [previous, next],
        lowAdjacentPointKeys: new Set([pointKey(previous), pointKey(next)])
    };
}

function insertPriorityJunctionPoints(points, type, slotMap, tiles) {
    const source = normalizeRing(points);
    if (source.length < 3) return source;
    const out = [];
    function samePoint(a, b) {
        return pointDistance(a, b) <= 1e-6;
    }
    function maybeInsert(a, b) {
        const aJunction = priorityJunctionForVertex(a, slotMap.get(pointKey(a)), type, tiles);
        if (aJunction && !aJunction.groupIsLowest && (
            aJunction.lowAdjacentPointKeys.has(pointKey(b)) ||
            segmentsIntersect(a, b, aJunction.lowAdjacentPoints[0], aJunction.lowAdjacentPoints[1])
        )) {
            return aJunction.point;
        }
        const bJunction = priorityJunctionForVertex(b, slotMap.get(pointKey(b)), type, tiles);
        if (bJunction && !bJunction.groupIsLowest && (
            bJunction.lowAdjacentPointKeys.has(pointKey(a)) ||
            segmentsIntersect(a, b, bJunction.lowAdjacentPoints[0], bJunction.lowAdjacentPoints[1])
        )) {
            return bJunction.point;
        }
        return null;
    }
    for (let i = 0; i < source.length; i++) {
        const current = source[i];
        const next = source[(i + 1) % source.length];
        out.push(current);
        const junction = maybeInsert(current, next);
        if (!junction || samePoint(current, junction) || samePoint(next, junction)) continue;
        const previous = out[out.length - 1];
        if (previous && samePoint(previous, junction)) continue;
        out.push(junction);
    }
    return normalizeRing(out);
}

function pairBoundaryPointForVertex(point, typeA, typeB, slotMap, tiles) {
    const aType = typeof typeA === "string" && typeA.length > 0 ? typeA : "grass";
    const bType = typeof typeB === "string" && typeB.length > 0 ? typeB : "grass";
    if (aType === bType) return roundPoint(point);
    const slots = slotMap.get(pointKey(point));
    if (!(slots instanceof Set) || slots.size !== 3) return roundPoint(point);

    const typeBySlot = new Map();
    for (const slotKey of slots) {
        typeBySlot.set(slotKey, terrainTypeForSlotKey(slotKey, tiles));
    }
    const distinctTypes = new Set(typeBySlot.values());
    if (distinctTypes.size !== 3 || !distinctTypes.has(aType) || !distinctTypes.has(bType)) {
        return roundPoint(point);
    }

    let lowSlotKey = "";
    let lowType = "";
    let lowPriority = Infinity;
    for (const [slotKey, slotType] of typeBySlot) {
        const priority = terrainPriority(slotType);
        if (priority < lowPriority) {
            lowSlotKey = slotKey;
            lowType = slotType;
            lowPriority = priority;
        }
    }
    if (!lowType || (lowType !== aType && lowType !== bType)) return roundPoint(point);

    const [q, r] = lowSlotKey.split(",").map(Number);
    if (!Number.isFinite(q) || !Number.isFinite(r)) return roundPoint(point);
    const lowCoord = { q, r };
    const corners = hexCorners(lowCoord);
    const cornerIndex = corners.findIndex((corner) => pointKey(corner) === pointKey(point));
    if (cornerIndex < 0) return roundPoint(point);

    const previous = corners[(cornerIndex + corners.length - 1) % corners.length];
    const next = corners[(cornerIndex + 1) % corners.length];
    const center = axialToModel(lowCoord);
    const rx = center.x - point.x;
    const ry = center.y - point.y;
    const sx = next.x - previous.x;
    const sy = next.y - previous.y;
    const denom = rx * sy - ry * sx;
    if (Math.abs(denom) <= 1e-9) {
        return roundPoint({
            x: (previous.x + next.x) / 2,
            y: (previous.y + next.y) / 2
        });
    }

    const qx = previous.x - point.x;
    const qy = previous.y - point.y;
    const t = (qx * sy - qy * sx) / denom;
    const out = {
        x: point.x + rx * t,
        y: point.y + ry * t
    };
    return Number.isFinite(out.x) && Number.isFinite(out.y) ? roundPoint(out) : roundPoint(point);
}

function pointSegmentDistanceSq(point, a, b) {
    const px = Number(point && point.x);
    const py = Number(point && point.y);
    const ax = Number(a && a.x);
    const ay = Number(a && a.y);
    const bx = Number(b && b.x);
    const by = Number(b && b.y);
    if (![px, py, ax, ay, bx, by].every(Number.isFinite)) return Infinity;
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq > 1e-12
        ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq))
        : 0;
    const nearestX = ax + dx * t;
    const nearestY = ay + dy * t;
    return (px - nearestX) * (px - nearestX) + (py - nearestY) * (py - nearestY);
}

function segmentsTouchOrIntersect(a, b, c, d) {
    if (segmentsIntersect(a, b, c, d)) return true;
    const epsilonSq = 1e-12;
    return pointSegmentDistanceSq(a, c, d) <= epsilonSq ||
        pointSegmentDistanceSq(b, c, d) <= epsilonSq ||
        pointSegmentDistanceSq(c, a, b) <= epsilonSq ||
        pointSegmentDistanceSq(d, a, b) <= epsilonSq;
}

function segmentOverlapPoints(a, b, c, d, epsilon = 1e-7) {
    const ax = Number(a.x);
    const ay = Number(a.y);
    const bx = Number(b.x);
    const by = Number(b.y);
    const cx = Number(c.x);
    const cy = Number(c.y);
    const dx = Number(d.x);
    const dy = Number(d.y);
    const abx = bx - ax;
    const aby = by - ay;
    const lengthSq = abx * abx + aby * aby;
    if (!(lengthSq > epsilon * epsilon)) return null;
    const crossC = abx * (cy - ay) - aby * (cx - ax);
    const crossD = abx * (dy - ay) - aby * (dx - ax);
    if (Math.abs(crossC) > epsilon || Math.abs(crossD) > epsilon) return null;
    const toT = (x, y) => ((x - ax) * abx + (y - ay) * aby) / lengthSq;
    const t0 = toT(cx, cy);
    const t1 = toT(dx, dy);
    const start = Math.max(0, Math.min(t0, t1));
    const end = Math.min(1, Math.max(t0, t1));
    if (end - start <= epsilon) return null;
    return {
        a: roundPoint({ x: ax + abx * start, y: ay + aby * start }),
        b: roundPoint({ x: ax + abx * end, y: ay + aby * end })
    };
}

function terrainRingRecords(polygons) {
    const records = [];
    for (const polygon of polygons) {
        records.push({ type: polygon.type, points: polygon.points });
        for (const hole of polygon.holes || []) records.push({ type: polygon.type, points: hole });
    }
    return records;
}

function sanitizeTerrainPatchPolygons(polygons) {
    const out = [];
    for (const polygon of Array.isArray(polygons) ? polygons : []) {
        if (!polygon || !TERRAIN_TYPES.includes(polygon.type)) continue;
        const points = normalizeRing(polygon.points || []);
        if (points.length < 3 || Math.abs(ringSignedArea(points)) <= 1e-9) continue;
        const holes = (polygon.holes || [])
            .map(normalizeRing)
            .filter((hole) => hole.length >= 3 && Math.abs(ringSignedArea(hole)) > 1e-9);
        const sanitized = {
            type: polygon.type,
            points: ringSignedArea(points) < 0 ? points.slice().reverse() : points
        };
        if (holes.length > 0) sanitized.holes = holes.map((hole) => (
            ringSignedArea(hole) > 0 ? hole.slice().reverse() : hole
        ));
        out.push(sanitized);
    }
    return sortTerrainPolygons(out);
}

function segmentTouchesInnerSeven(a, b) {
    for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        const point = {
            x: a.x + (b.x - a.x) * t,
            y: a.y + (b.y - a.y) * t
        };
        if (pointInsideOrTouchesAnyInnerHex(point)) return true;
    }
    return false;
}

function repairAdjacentPairBoundaryVertices(input, polygons, options = {}) {
    const source = sanitizeTerrainPatchPolygons(clonePolygons(polygons));
    if (source.length === 0) return source;
    const includeGrassPairs = !!options.includeGrassPairs;
    const tiles = terrainTilesByKey(input);
    const tileCoords = BUBBLE_COORDS;
    const tileKeys = new Set(tileCoords.map(coordKey));
    const slotMap = buildTerrainVertexSlotMap(tileCoords);
    const ringRecords = terrainRingRecords(source);

    function insertDirectedEndpoint(type, from, to) {
        const fromPoint = roundPoint(from);
        const toPoint = roundPoint(to);
        const fromKey = pointKey(fromPoint);
        const toKey = pointKey(toPoint);
        if (fromKey === toKey) return;
        for (const record of ringRecords) {
            if (record.type !== type) continue;
            const points = record.points;
            if (points.some((point) => pointKey(point) === toKey)) continue;
            const fromIndex = points.findIndex((point) => pointKey(point) === fromKey);
            if (fromIndex >= 0) {
                points.splice(fromIndex + 1, 0, toPoint);
                continue;
            }
            const toIndex = points.findIndex((point) => pointKey(point) === toKey);
            if (toIndex >= 0 && !points.some((point) => pointKey(point) === fromKey)) {
                points.splice(toIndex, 0, fromPoint);
            }
        }
    }

    function pairHasSharedBoundary(typeA, typeB, centerA, centerB) {
        for (const aRecord of ringRecords) {
            if (aRecord.type !== typeA) continue;
            for (let ai = 0; ai < aRecord.points.length; ai++) {
                const a0 = aRecord.points[ai];
                const a1 = aRecord.points[(ai + 1) % aRecord.points.length];
                for (const bRecord of ringRecords) {
                    if (bRecord.type !== typeB) continue;
                    for (let bi = 0; bi < bRecord.points.length; bi++) {
                        const b0 = bRecord.points[bi];
                        const b1 = bRecord.points[(bi + 1) % bRecord.points.length];
                        const overlap = segmentOverlapPoints(a0, a1, b0, b1);
                        if (!overlap) continue;
                        if (segmentsTouchOrIntersect(centerA, centerB, overlap.a, overlap.b)) return true;
                    }
                }
            }
        }
        return false;
    }

    const visitedEdges = new Set();
    for (const coord of tileCoords) {
        const nodeKey = coordKey(coord);
        const nodeType = tiles.get(nodeKey);
        const corners = hexCorners(coord);
        for (let directionIndex = 0; directionIndex < DIRECTIONS.length; directionIndex++) {
            const neighbor = neighborCoord(coord, directionIndex);
            const neighborKey = coordKey(neighbor);
            if (!tileKeys.has(neighborKey)) continue;
            const edgeKey = nodeKey < neighborKey ? `${nodeKey}:${neighborKey}` : `${neighborKey}:${nodeKey}`;
            if (visitedEdges.has(edgeKey)) continue;
            visitedEdges.add(edgeKey);

            const neighborType = tiles.get(neighborKey);
            if (nodeType === neighborType) continue;
            if (!includeGrassPairs && (nodeType === "grass" || neighborType === "grass")) continue;

            const centerA = axialToModel(coord);
            const centerB = axialToModel(neighbor);
            if (pairHasSharedBoundary(nodeType, neighborType, centerA, centerB)) continue;

            const [cornerAIndex, cornerBIndex] = EDGE_CORNER_INDICES[directionIndex];
            const a = pairBoundaryPointForVertex(
                corners[cornerAIndex],
                nodeType,
                neighborType,
                slotMap,
                tiles
            );
            const b = pairBoundaryPointForVertex(
                corners[cornerBIndex],
                nodeType,
                neighborType,
                slotMap,
                tiles
            );
            if (!segmentTouchesInnerSeven(a, b)) continue;
            insertDirectedEndpoint(nodeType, a, b);
            insertDirectedEndpoint(neighborType, a, b);
        }
    }

    return sanitizeTerrainPatchPolygons(source);
}

function segmentsProperlyIntersect(a, b, c, d) {
    const o1 = orientation(a, b, c);
    const o2 = orientation(a, b, d);
    const o3 = orientation(c, d, a);
    const o4 = orientation(c, d, b);
    return o1 * o2 < 0 && o3 * o4 < 0;
}

function synchronizeAdjacentPairBoundaryPaths(input, polygons, options = {}) {
    const source = sanitizeTerrainPatchPolygons(clonePolygons(polygons));
    if (source.length === 0) return source;
    const includeGrassPairs = !!options.includeGrassPairs;
    const onlyGrassPairs = !!options.onlyGrassPairs;
    const allowEndpointInsertion = !!options.allowEndpointInsertion;
    const tiles = terrainTilesByKey(input);
    const tileCoords = BUBBLE_COORDS;
    const tileKeys = new Set(tileCoords.map(coordKey));
    const localNodeCenterKeys = new Set(tileCoords.map((coord) => pointKey(axialToModel(coord))));
    const ringRecords = terrainRingRecords(source);

    function edgeHasSharedBoundary(typeA, typeB, centerA, centerB) {
        for (const aRecord of ringRecords) {
            if (aRecord.type !== typeA) continue;
            for (let ai = 0; ai < aRecord.points.length; ai++) {
                const a0 = aRecord.points[ai];
                const a1 = aRecord.points[(ai + 1) % aRecord.points.length];
                for (const bRecord of ringRecords) {
                    if (bRecord.type !== typeB) continue;
                    for (let bi = 0; bi < bRecord.points.length; bi++) {
                        const b0 = bRecord.points[bi];
                        const b1 = bRecord.points[(bi + 1) % bRecord.points.length];
                        const overlap = segmentOverlapPoints(a0, a1, b0, b1);
                        if (overlap && segmentsTouchOrIntersect(centerA, centerB, overlap.a, overlap.b)) return true;
                    }
                }
            }
        }
        return false;
    }

    function segmentDistanceToCenterlineScore(a, b, centerA, centerB) {
        const mid = {
            x: (centerA.x + centerB.x) / 2,
            y: (centerA.y + centerB.y) / 2
        };
        const segmentMid = {
            x: (a.x + b.x) / 2,
            y: (a.y + b.y) / 2
        };
        return pointSegmentDistanceSq(mid, a, b) + pointSegmentDistanceSq(segmentMid, centerA, centerB);
    }

    function findBoundarySegmentForType(type, centerA, centerB) {
        let best = null;
        let bestScore = Infinity;
        for (const record of ringRecords) {
            if (record.type !== type) continue;
            const points = record.points;
            for (let i = 0; i < points.length; i++) {
                const a = points[i];
                const b = points[(i + 1) % points.length];
                if (!segmentsTouchOrIntersect(centerA, centerB, a, b)) continue;
                const touchesLocalCenter = localNodeCenterKeys.has(pointKey(a)) || localNodeCenterKeys.has(pointKey(b));
                const score = segmentDistanceToCenterlineScore(a, b, centerA, centerB) -
                    (touchesLocalCenter ? 100 : 0);
                if (score < bestScore) {
                    bestScore = score;
                    best = { a: roundPoint(a), b: roundPoint(b) };
                }
            }
        }
        return best;
    }

    function forwardPathInfo(points, startIndex, endIndex, centerA, centerB) {
        let length = 0;
        let touchesCenterline = false;
        let previous = points[startIndex];
        let index = startIndex;
        for (let guard = 0; guard <= points.length; guard++) {
            if (index === endIndex) break;
            index = (index + 1) % points.length;
            const current = points[index];
            length += pointDistance(previous, current);
            if (segmentsTouchOrIntersect(centerA, centerB, previous, current)) touchesCenterline = true;
            previous = current;
        }
        return { length, touchesCenterline };
    }

    function candidateRingHasProperCrossing(record, candidatePoints) {
        const ring = Array.isArray(candidatePoints) ? candidatePoints : [];
        for (let a = 0; a < ring.length; a++) {
            const a0 = ring[a];
            const a1 = ring[(a + 1) % ring.length];
            for (let b = a + 1; b < ring.length; b++) {
                const diff = Math.abs(a - b);
                if (diff === 1 || diff === ring.length - 1) continue;
                if (segmentsProperlyIntersect(a0, a1, ring[b], ring[(b + 1) % ring.length])) return true;
            }
        }
        for (const other of ringRecords) {
            if (other === record) continue;
            const points = other.points;
            for (let a = 0; a < ring.length; a++) {
                const a0 = ring[a];
                const a1 = ring[(a + 1) % ring.length];
                for (let b = 0; b < points.length; b++) {
                    if (segmentsProperlyIntersect(a0, a1, points[b], points[(b + 1) % points.length])) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    function collapseForwardPath(points, startIndex, endIndex) {
        if (points.length < 4) return false;
        if ((startIndex + 1) % points.length === endIndex) return false;
        if (startIndex < endIndex) {
            points.splice(startIndex + 1, endIndex - startIndex - 1);
        } else {
            points.splice(startIndex + 1);
            points.splice(0, endIndex);
        }
        return true;
    }

    function synchronizeTargetSegmentIntoType(type, target, centerA, centerB) {
        const aKey = pointKey(target.a);
        const bKey = pointKey(target.b);
        if (aKey === bKey) return false;
        let changed = false;
        for (const record of ringRecords) {
            if (record.type !== type) continue;
            const points = record.points;
            const aIndex = points.findIndex((point) => pointKey(point) === aKey);
            const bIndex = points.findIndex((point) => pointKey(point) === bKey);
            if (aIndex >= 0 && bIndex >= 0 && aIndex !== bIndex) {
                points[aIndex] = roundPoint(target.a);
                points[bIndex] = roundPoint(target.b);
                const forward = forwardPathInfo(points, aIndex, bIndex, centerA, centerB);
                const backward = forwardPathInfo(points, bIndex, aIndex, centerA, centerB);
                const collapseAB = forward.touchesCenterline !== backward.touchesCenterline
                    ? forward.touchesCenterline
                    : forward.length <= backward.length;
                const original = points.slice();
                const collapsed = collapseAB
                    ? collapseForwardPath(points, aIndex, bIndex)
                    : collapseForwardPath(points, bIndex, aIndex);
                if (collapsed && candidateRingHasProperCrossing(record, points)) {
                    points.splice(0, points.length, ...original);
                } else {
                    changed = collapsed || changed;
                }
                continue;
            }
            if (!allowEndpointInsertion) continue;
            if (aIndex >= 0 || bIndex >= 0) {
                const existingIndex = aIndex >= 0 ? aIndex : bIndex;
                const existingPoint = aIndex >= 0 ? target.a : target.b;
                const missingPoint = aIndex >= 0 ? target.b : target.a;
                if (!localNodeCenterKeys.has(pointKey(missingPoint))) continue;
                points[existingIndex] = roundPoint(existingPoint);
                const prevIndex = (existingIndex + points.length - 1) % points.length;
                const nextIndex = (existingIndex + 1) % points.length;
                const prevDistanceSq = pointSegmentDistanceSq(missingPoint, points[prevIndex], points[existingIndex]);
                const nextDistanceSq = pointSegmentDistanceSq(missingPoint, points[existingIndex], points[nextIndex]);
                const original = points.slice();
                if (nextDistanceSq <= prevDistanceSq) {
                    points.splice(existingIndex + 1, 0, roundPoint(missingPoint));
                } else {
                    points.splice(existingIndex, 0, roundPoint(missingPoint));
                }
                if (candidateRingHasProperCrossing(record, points)) {
                    points.splice(0, points.length, ...original);
                } else {
                    changed = true;
                }
                continue;
            }

            let bestSegmentIndex = -1;
            let bestScore = Infinity;
            for (let i = 0; i < points.length; i++) {
                const a = points[i];
                const b = points[(i + 1) % points.length];
                const touches = segmentsTouchOrIntersect(centerA, centerB, a, b);
                const score = (touches ? 0 : 1000) +
                    segmentDistanceToCenterlineScore(a, b, centerA, centerB) +
                    pointSegmentDistanceSq(target.a, a, b) +
                    pointSegmentDistanceSq(target.b, a, b);
                if (score < bestScore) {
                    bestScore = score;
                    bestSegmentIndex = i;
                }
            }
            if (bestSegmentIndex < 0) continue;
            const from = points[bestSegmentIndex];
            const to = points[(bestSegmentIndex + 1) % points.length];
            const dx = to.x - from.x;
            const dy = to.y - from.y;
            const lengthSq = dx * dx + dy * dy;
            if (!(lengthSq > 1e-12)) continue;
            const projected = [target.a, target.b]
                .filter((point) => {
                    const key = pointKey(point);
                    return localNodeCenterKeys.has(key) &&
                        key !== pointKey(from) &&
                        key !== pointKey(to) &&
                        !points.some((existing) => pointKey(existing) === key);
                })
                .map((point) => ({
                    point: roundPoint(point),
                    t: ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSq
                }))
                .filter((entry) => Number.isFinite(entry.t))
                .sort((left, right) => left.t - right.t);
            if (projected.length === 0) continue;
            const original = points.slice();
            points.splice(bestSegmentIndex + 1, 0, ...projected.map((entry) => entry.point));
            if (candidateRingHasProperCrossing(record, points)) {
                points.splice(0, points.length, ...original);
            } else {
                changed = true;
            }
        }
        return changed;
    }

    let changed = false;
    const visitedEdges = new Set();
    for (const coord of tileCoords) {
        const nodeKey = coordKey(coord);
        const nodeType = tiles.get(nodeKey);
        if (nodeType === "grass" && !includeGrassPairs) continue;
        for (let directionIndex = 0; directionIndex < DIRECTIONS.length; directionIndex++) {
            const neighbor = neighborCoord(coord, directionIndex);
            const neighborKey = coordKey(neighbor);
            if (!tileKeys.has(neighborKey)) continue;
            const edgeKey = nodeKey < neighborKey ? `${nodeKey}:${neighborKey}` : `${neighborKey}:${nodeKey}`;
            if (visitedEdges.has(edgeKey)) continue;
            visitedEdges.add(edgeKey);
            const neighborType = tiles.get(neighborKey);
            if (neighborType === nodeType) continue;
            if (!includeGrassPairs && neighborType === "grass") continue;
            if (onlyGrassPairs && nodeType !== "grass" && neighborType !== "grass") continue;
            const centerA = axialToModel(coord);
            const centerB = axialToModel(neighbor);
            if (edgeHasSharedBoundary(nodeType, neighborType, centerA, centerB)) continue;
            const lowType = terrainPriority(nodeType) <= terrainPriority(neighborType) ? nodeType : neighborType;
            const highType = lowType === nodeType ? neighborType : nodeType;
            const lowTarget = findBoundarySegmentForType(lowType, centerA, centerB);
            if (lowTarget) {
                changed = synchronizeTargetSegmentIntoType(highType, lowTarget, centerA, centerB) || changed;
                continue;
            }
            const highTarget = findBoundarySegmentForType(highType, centerA, centerB);
            if (highTarget) changed = synchronizeTargetSegmentIntoType(lowType, highTarget, centerA, centerB) || changed;
        }
    }
    return changed ? sanitizeTerrainPatchPolygons(source) : source;
}

function smoothTerrainComponentRing(points, component, tiles, options = {}) {
    const simplified = normalizeRing(points);
    if (simplified.length < 3) return simplified;

    const slotMap = buildTerrainVertexSlotMap(component.coords);
    const records = simplified.map((point) => {
        const slots = slotMap.get(pointKey(point));
        if (!(slots instanceof Set) || slots.size !== 3) {
            throw new Error(`terrain calculator could not resolve exactly three slots at ${pointKey(point)}`);
        }
        const stats = boundaryKeepStats(component.type, slots, tiles, options);
        const junction = priorityJunctionForVertex(point, slots, component.type, tiles);
        if (junction && junction.groupIsLowest) {
            return {
                point: junction.point,
                slots,
                nonGroupCount: stats.nonGroupCount,
                keepNonGroupCount: stats.keepNonGroupCount,
                forcedNonGroupCount: 3 - stats.keepNonGroupCount,
                priorityAdjusted: true,
                baseKeep: true
            };
        }
        return {
            point,
            slots,
            nonGroupCount: stats.nonGroupCount,
            keepNonGroupCount: stats.keepNonGroupCount,
            forcedNonGroupCount: 3 - stats.keepNonGroupCount,
            priorityAdjusted: stats.higherPriorityNeighbor,
            baseKeep: stats.nonGroupCount === stats.keepNonGroupCount
        };
    });

    const forcedPointsByRunStart = new Map();
    function slotMatchesSkippedRunCenterSide(slotKey, record) {
        const slotType = terrainTypeForSlotKey(slotKey, tiles);
        const slotIsGroup = slotType === component.type;
        const useGroupSide = Number(record && record.forcedNonGroupCount) >= 2;
        return useGroupSide ? slotIsGroup : !slotIsGroup;
    }
    function skippedRunCenter(runStart, runLength) {
        const slotCounts = new Map();
        let xSum = 0;
        let ySum = 0;
        for (let r = 0; r < runLength; r++) {
            const record = records[(runStart + r) % records.length];
            xSum += record.point.x;
            ySum += record.point.y;
            for (const slotKey of record.slots) {
                if (!slotMatchesSkippedRunCenterSide(slotKey, record)) continue;
                if (!resolveSlotCenter(slotKey)) continue;
                slotCounts.set(slotKey, (slotCounts.get(slotKey) || 0) + 1);
            }
        }
        if (slotCounts.size === 0) {
            throw new Error("terrain calculator could not resolve a skipped-run center");
        }
        const centroid = { x: xSum / runLength, y: ySum / runLength };
        let bestKey = "";
        let bestCount = -1;
        let bestDistance = Infinity;
        for (const [slotKey, count] of slotCounts) {
            const center = resolveSlotCenter(slotKey);
            if (!center) continue;
            const distance = pointDistance(center, centroid);
            if (count > bestCount || (count === bestCount && distance < bestDistance)) {
                bestKey = slotKey;
                bestCount = count;
                bestDistance = distance;
            }
        }
        const center = resolveSlotCenter(bestKey);
        if (!center) throw new Error("terrain calculator resolved skipped-run center without coordinates");
        return center;
    }
    function isForcedCandidate(record) {
        return !!(
            record &&
            record.baseKeep === false &&
            record.nonGroupCount === record.forcedNonGroupCount
        );
    }
    function addForcedRunPoint(runStart, runLength) {
        if (runLength < 3) return;
        const count = records.length;
        if (runLength === 3) {
            forcedPointsByRunStart.set(runStart, skippedRunCenter(runStart, 3));
            return;
        }
        if (runLength === 4) {
            for (let windowStart = 0; windowStart <= 1; windowStart++) {
                let xSum = 0;
                let ySum = 0;
                for (let r = 0; r < 3; r++) {
                    const point = records[(runStart + windowStart + r) % count].point;
                    xSum += point.x;
                    ySum += point.y;
                }
                forcedPointsByRunStart.set((runStart + windowStart) % count, roundPoint({
                    x: xSum / 3,
                    y: ySum / 3
                }));
            }
            return;
        }
        let xSum = 0;
        let ySum = 0;
        for (let r = 0; r < runLength; r++) {
            const point = records[(runStart + r) % count].point;
            xSum += point.x;
            ySum += point.y;
        }
        forcedPointsByRunStart.set(runStart, roundPoint({
            x: xSum / runLength,
            y: ySum / runLength
        }));
    }

    if (records.length >= 3) {
        const count = records.length;
        const startIndex = records.findIndex((record) => !isForcedCandidate(record));
        if (startIndex >= 0) {
            let runStart = -1;
            let runLength = 0;
            for (let step = 1; step <= count; step++) {
                const index = (startIndex + step) % count;
                if (isForcedCandidate(records[index])) {
                    if (runStart < 0) runStart = index;
                    runLength += 1;
                } else if (runStart >= 0) {
                    addForcedRunPoint(runStart, runLength);
                    runStart = -1;
                    runLength = 0;
                }
            }
        }
    }

    const kept = [];
    for (let i = 0; i < records.length; i++) {
        if (forcedPointsByRunStart.has(i)) kept.push(forcedPointsByRunStart.get(i));
        if (records[i].baseKeep) kept.push(records[i].point);
    }
    const withJunctions = insertPriorityJunctionPoints(kept, component.type, slotMap, tiles);
    const out = normalizeRing(withJunctions);
    if (out.length < 3) return simplified;
    return out;
}

function collectTerrainComponents(input) {
    const tiles = terrainTilesByKey(input);
    const recordsByKey = new Map(BUBBLE_COORDS.map((coord) => [
        coordKey(coord),
        { coord, type: tiles.get(coordKey(coord)) }
    ]));
    const visited = new Set();
    const components = [];
    for (const record of recordsByKey.values()) {
        const key = coordKey(record.coord);
        if (visited.has(key)) continue;
        visited.add(key);
        const component = {
            type: record.type,
            coords: [],
            keys: new Set()
        };
        const queue = [record];
        for (let i = 0; i < queue.length; i++) {
            const current = queue[i];
            component.coords.push(current.coord);
            component.keys.add(coordKey(current.coord));
            for (const direction of DIRECTIONS) {
                const nextCoord = {
                    q: current.coord.q + direction.q,
                    r: current.coord.r + direction.r
                };
                const nextKey = coordKey(nextCoord);
                if (visited.has(nextKey) || !recordsByKey.has(nextKey)) continue;
                const next = recordsByKey.get(nextKey);
                if (next.type !== component.type) continue;
                visited.add(nextKey);
                queue.push(next);
            }
        }
        components.push(component);
    }
    return components;
}

function componentGeometry(component) {
    const geometries = component.coords.map((coord) => ringToPolygonClippingPolygon(hexCorners(coord)));
    return unionAll(geometries);
}

function componentGeometryToPolygons(component, geometry, tiles) {
    const out = [];
    for (const polygon of Array.isArray(geometry) ? geometry : []) {
        if (!Array.isArray(polygon) || polygon.length === 0) continue;
        let points = smoothTerrainComponentRing(polygon[0].map(pairToPoint), component, tiles, { isHole: false });
        if (points.length < 3 || Math.abs(ringSignedArea(points)) <= 1e-9) continue;
        points = ringSignedArea(points) < 0 ? points.slice().reverse() : points;
        const holes = polygon.slice(1)
            .map((ring) => smoothTerrainComponentRing(ring.map(pairToPoint), component, tiles, { isHole: true }))
            .filter((hole) => hole.length >= 3 && Math.abs(ringSignedArea(hole)) > 1e-9)
            .map((hole) => ringSignedArea(hole) > 0 ? hole.slice().reverse() : hole);
        const terrainPolygon = { type: component.type, points };
        if (holes.length > 0) terrainPolygon.holes = holes;
        out.push(terrainPolygon);
    }
    return out;
}

function generatePrioritySmoothedTerrainBubblePolygons(input) {
    const tiles = terrainTilesByKey(input);
    const polygons = [];
    for (const component of collectTerrainComponents(input)) {
        if (!component.coords.some((coord) => INNER_COORDS.some((inner) => coordKey(inner) === coordKey(coord)))) continue;
        const geometry = componentGeometry(component);
        polygons.push(...componentGeometryToPolygons(component, geometry, tiles));
    }
    return clipTerrainPolygonsToInnerSeven(polygons);
}

function generatePairRepairedTerrainBubblePolygons(input, options = {}) {
    return repairAdjacentPairBoundaryVertices(
        input,
        generatePrioritySmoothedTerrainBubblePolygons(input),
        options
    );
}

function applyUniformOuterErosion(input, polygons) {
    const outerType = uniformOuterTerrain(input);
    if (!outerType) return polygons;
    const innerTypes = innerTerrainTypes(input);
    if (innerTypes.has(outerType)) return polygons;

    const mask = erodedInnerSevenMask();
    const out = [];
    for (const type of TERRAIN_TYPES) {
        if (!innerTypes.has(type)) continue;
        const typePolygons = polygons.filter((polygon) => polygon.type === type);
        const clipped = polygonClipping.intersection(terrainPolygonsToMultiPolygon(typePolygons), mask);
        out.push(...multiPolygonToTerrainPolygons(type, clipped));
    }
    return sortTerrainPolygons(out);
}

function typeOuterSupportMask(input, type) {
    const tiles = terrainTilesByKey(input);
    const supports = [erodedInnerSevenMask()];
    for (const coord of OUTER_COORDS) {
        if (tiles.get(coordKey(coord)) !== type) continue;
        supports.push(ringToPolygonClippingPolygon(hexCorners(coord)));
    }
    return polygonClipping.intersection(unionAll(supports), innerSevenMask());
}

function applyTypeSpecificOuterBoundaryMasks(input, polygons) {
    const innerTypes = innerTerrainTypes(input);
    const out = [];
    for (const type of TERRAIN_TYPES) {
        if (!innerTypes.has(type)) continue;
        const typePolygons = polygons.filter((polygon) => polygon.type === type);
        if (typePolygons.length === 0) continue;
        const clipped = polygonClipping.intersection(
            terrainPolygonsToMultiPolygon(typePolygons),
            typeOuterSupportMask(input, type)
        );
        out.push(...multiPolygonToTerrainPolygons(type, clipped));
    }
    return sortTerrainPolygons(out);
}

function convexHull(points) {
    const unique = [...new Map(points.map((point) => {
        const rounded = roundPoint(point);
        return [pointKey(rounded), rounded];
    })).values()].sort((a, b) => a.x - b.x || a.y - b.y);
    if (unique.length <= 1) return unique;
    function cross(origin, a, b) {
        return (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
    }
    const lower = [];
    for (const point of unique) {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= 0) {
            lower.pop();
        }
        lower.push(point);
    }
    const upper = [];
    for (let i = unique.length - 1; i >= 0; i--) {
        const point = unique[i];
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= 0) {
            upper.pop();
        }
        upper.push(point);
    }
    return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function convexOuterSupportMask(input, type) {
    const tiles = terrainTilesByKey(input);
    const erodedRing = erodedInnerSevenMask()[0][0].map(pairToPoint);
    const supportPoints = erodedRing.slice();
    for (const coord of OUTER_COORDS) {
        if (tiles.get(coordKey(coord)) !== type) continue;
        supportPoints.push(axialToModel(coord));
    }
    const hull = convexHull(supportPoints);
    if (hull.length < 3) return erodedInnerSevenMask();
    return polygonClipping.intersection(ringToPolygonClippingPolygon(hull), innerSevenMask());
}

function applyConvexCenterIslandOuterSupport(input, polygons) {
    const tiles = terrainTilesByKey(input);
    const centerType = tiles.get("0,0");
    const ringTypes = DIRECTIONS.map((direction) => tiles.get(coordKey(direction)));
    const uniqueRingTypes = new Set(ringTypes);
    if (uniqueRingTypes.size !== 1) return polygons;
    const surroundingType = ringTypes[0];
    if (surroundingType === centerType) return polygons;
    const outerTypes = new Set(OUTER_COORDS.map((coord) => tiles.get(coordKey(coord))));
    if (outerTypes.size === 1 && outerTypes.has(surroundingType)) return polygons;
    const surroundingOuterSupportCount = OUTER_COORDS
        .filter((coord) => tiles.get(coordKey(coord)) === surroundingType)
        .length;
    if (surroundingOuterSupportCount > 2) return polygons;

    const out = polygons.filter((polygon) => polygon.type !== surroundingType);
    const surrounding = polygons.filter((polygon) => polygon.type === surroundingType);
    if (surrounding.length === 0) return polygons;
    const clipped = polygonClipping.intersection(
        terrainPolygonsToMultiPolygon(surrounding),
        convexOuterSupportMask(input, surroundingType)
    );
    out.push(...multiPolygonToTerrainPolygons(surroundingType, clipped));
    return sortTerrainPolygons(out);
}

function centerIslandTerrainTypes(input) {
    const tiles = terrainTilesByKey(input);
    const centerType = tiles.get("0,0");
    const ringTypes = DIRECTIONS.map((direction) => tiles.get(coordKey(direction)));
    const uniqueRingTypes = new Set(ringTypes);
    if (uniqueRingTypes.size !== 1) return null;
    const surroundingType = ringTypes[0];
    if (surroundingType === centerType) return null;
    return { centerType, surroundingType };
}

function centerAdjacentPairSplit(input) {
    const tiles = terrainTilesByKey(input);
    const counts = new Map();
    for (const coord of INNER_COORDS) {
        const type = tiles.get(coordKey(coord));
        counts.set(type, (counts.get(type) || 0) + 1);
    }
    if (counts.size !== 2) return false;
    const centerType = tiles.get("0,0");
    if (counts.get(centerType) !== 2) return false;
    if (!DIRECTIONS.some((direction) => tiles.get(coordKey(direction)) === centerType)) return false;
    const otherType = [...counts.keys()].find((type) => type !== centerType);
    return { centerType, otherType };
}

function twoTypeCenterHigherSplit(input) {
    const tiles = terrainTilesByKey(input);
    const counts = new Map();
    for (const coord of INNER_COORDS) {
        const type = tiles.get(coordKey(coord));
        counts.set(type, (counts.get(type) || 0) + 1);
    }
    const innerTypes = new Set(counts.keys());
    if (innerTypes.size !== 2) return false;
    const centerType = tiles.get("0,0");
    const otherType = [...innerTypes].find((type) => type !== centerType);
    if (terrainPriority(centerType) <= terrainPriority(otherType)) return false;
    const centerCount = counts.get(centerType);
    return centerCount === 2 || (centerCount === 4 && otherType === "water");
}

function applyCenterIslandOuterSupport(input, polygons) {
    const tiles = terrainTilesByKey(input);
    const centerType = tiles.get("0,0");
    const ringTypes = DIRECTIONS.map((direction) => tiles.get(coordKey(direction)));
    const uniqueRingTypes = new Set(ringTypes);
    if (uniqueRingTypes.size !== 1) return polygons;
    const surroundingType = ringTypes[0];
    if (surroundingType === centerType) return polygons;
    const outerTypes = new Set(OUTER_COORDS.map((coord) => tiles.get(coordKey(coord))));
    if (outerTypes.size === 1 && outerTypes.has(surroundingType)) return polygons;

    const supportMask = typeOuterSupportMask(input, surroundingType);
    const out = polygons.filter((polygon) => polygon.type !== surroundingType);
    const surrounding = polygons.filter((polygon) => polygon.type === surroundingType);
    if (surrounding.length === 0) return polygons;
    const clipped = polygonClipping.intersection(
        terrainPolygonsToMultiPolygon(surrounding),
        supportMask
    );
    out.push(...multiPolygonToTerrainPolygons(surroundingType, clipped));
    return sortTerrainPolygons(out);
}

function innerTerrainComponents(input, type) {
    const tiles = terrainTilesByKey(input);
    const innerByKey = new Map(INNER_COORDS
        .filter((coord) => tiles.get(coordKey(coord)) === type)
        .map((coord) => [coordKey(coord), coord]));
    const visited = new Set();
    const components = [];
    for (const coord of innerByKey.values()) {
        const key = coordKey(coord);
        if (visited.has(key)) continue;
        visited.add(key);
        const component = [];
        const queue = [coord];
        for (let i = 0; i < queue.length; i++) {
            const current = queue[i];
            component.push(current);
            for (const direction of DIRECTIONS) {
                const next = {
                    q: current.q + direction.q,
                    r: current.r + direction.r
                };
                const nextKey = coordKey(next);
                if (visited.has(nextKey) || !innerByKey.has(nextKey)) continue;
                visited.add(nextKey);
                queue.push(innerByKey.get(nextKey));
            }
        }
        components.push(component);
    }
    return components;
}

function componentOuterSupportCoords(input, component, type) {
    const tiles = terrainTilesByKey(input);
    const componentKeys = new Set(component.map(coordKey));
    const supports = [];
    for (const outer of OUTER_COORDS) {
        if (tiles.get(coordKey(outer)) !== type) continue;
        const touchesComponent = DIRECTIONS.some((direction) => {
            const neighbor = {
                q: outer.q + direction.q,
                r: outer.r + direction.r
            };
            return componentKeys.has(coordKey(neighbor));
        });
        if (touchesComponent) supports.push(outer);
    }
    return supports;
}

function innerComponentMask(input, component, type) {
    const geometries = component
        .concat(componentOuterSupportCoords(input, component, type))
        .map((coord) => ringToPolygonClippingPolygon(hexCorners(coord)));
    return polygonClipping.intersection(unionAll(geometries), innerSevenMask());
}

function applyInnerComponentSeparation(input, polygons) {
    const out = [];
    for (const type of TERRAIN_TYPES) {
        const typePolygons = polygons.filter((polygon) => polygon.type === type);
        if (typePolygons.length === 0) continue;
        const typeGeometry = terrainPolygonsToMultiPolygon(typePolygons);
        const components = innerTerrainComponents(input, type);
        if (components.length <= 1) {
            out.push(...typePolygons);
            continue;
        }
        for (const component of components) {
            const clipped = polygonClipping.intersection(typeGeometry, innerComponentMask(input, component, type));
            out.push(...multiPolygonToTerrainPolygons(type, clipped));
        }
    }
    return sortTerrainPolygons(out);
}

function terrainPolygonArea(polygon) {
    const outerArea = Math.abs(ringSignedArea(polygon.points || []));
    const holeArea = (polygon.holes || []).reduce((sum, hole) => sum + Math.abs(ringSignedArea(hole)), 0);
    return Math.max(0, outerArea - holeArea);
}

function removeSmallTerrainArtifacts(polygons) {
    return polygons.filter((polygon) => terrainPolygonArea(polygon) >= 0.25);
}

function pointTouchesSegment(point, a, b, epsilon = 1e-6) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq <= epsilon * epsilon) return pointDistance(point, a) <= epsilon;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq));
    const nearest = {
        x: a.x + dx * t,
        y: a.y + dy * t
    };
    return pointDistance(point, nearest) <= epsilon;
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

function pointTouchesRing(point, ring) {
    for (let i = 0; i < ring.length; i++) {
        if (pointTouchesSegment(point, ring[i], ring[(i + 1) % ring.length])) return true;
    }
    return false;
}

function pointInsideOrTouchesPolygon(point, polygon) {
    if (!pointInRing(point, polygon.points || []) && !pointTouchesRing(point, polygon.points || [])) return false;
    for (const hole of polygon.holes || []) {
        if (pointInRing(point, hole) && !pointTouchesRing(point, hole)) return false;
    }
    return true;
}

function pointInsidePolygonInterior(point, polygon) {
    if (!pointInRing(point, polygon.points || [])) return false;
    if (pointTouchesRing(point, polygon.points || [])) return false;
    for (const hole of polygon.holes || []) {
        if (pointInRing(point, hole) || pointTouchesRing(point, hole)) return false;
    }
    return true;
}

function orientation(a, b, c) {
    const value = (Number(b.x) - Number(a.x)) * (Number(c.y) - Number(a.y)) -
        (Number(b.y) - Number(a.y)) * (Number(c.x) - Number(a.x));
    if (Math.abs(value) <= 1e-9) return 0;
    return value > 0 ? 1 : -1;
}

function pointOnSegment(point, a, b) {
    return point.x >= Math.min(a.x, b.x) - 1e-6 &&
        point.x <= Math.max(a.x, b.x) + 1e-6 &&
        point.y >= Math.min(a.y, b.y) - 1e-6 &&
        point.y <= Math.max(a.y, b.y) + 1e-6 &&
        Math.abs((b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)) <= 1e-6;
}

function segmentsIntersect(a, b, c, d) {
    const o1 = orientation(a, b, c);
    const o2 = orientation(a, b, d);
    const o3 = orientation(c, d, a);
    const o4 = orientation(c, d, b);
    if (o1 === 0 && pointOnSegment(c, a, b)) return true;
    if (o2 === 0 && pointOnSegment(d, a, b)) return true;
    if (o3 === 0 && pointOnSegment(a, c, d)) return true;
    if (o4 === 0 && pointOnSegment(b, c, d)) return true;
    return o1 !== o2 && o3 !== o4;
}

function terrainRingIsSimple(points) {
    const ring = normalizeRing(points || []);
    if (ring.length < 3) return false;
    const seen = new Set();
    for (const point of ring) {
        const key = pointKey(point);
        if (seen.has(key)) return false;
        seen.add(key);
    }
    for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        for (let j = i + 1; j < ring.length; j++) {
            if (Math.abs(i - j) <= 1 || (i === 0 && j === ring.length - 1)) continue;
            const c = ring[j];
            const d = ring[(j + 1) % ring.length];
            if (segmentsIntersect(a, b, c, d)) return false;
        }
    }
    return true;
}

function terrainPolygonsAreSimple(polygons) {
    return (Array.isArray(polygons) ? polygons : []).every((polygon) => (
        terrainRingIsSimple(polygon.points) &&
        (polygon.holes || []).every(terrainRingIsSimple)
    ));
}

function assertTerrainPolygonsAreSimple(polygons) {
    if (!terrainPolygonsAreSimple(polygons)) {
        throw new Error("local-rule terrain polygons contain a self-crossing or repeated-vertex ring");
    }
}

function terrainOwnershipIsValid(input, polygons) {
    const tiles = terrainTilesByKey(input);
    for (const coord of INNER_COORDS) {
        const type = tiles.get(coordKey(coord));
        const center = axialToModel(coord);
        if (!polygons.some((polygon) => polygon.type === type && pointInsideOrTouchesPolygon(center, polygon))) {
            return false;
        }
        for (const polygon of polygons) {
            if (polygon.type !== type && pointInsidePolygonInterior(center, polygon)) return false;
        }
    }
    return true;
}

function simplifyOwnershipPreservingVertices(input, polygons) {
    let current = clonePolygons(polygons);
    let changed = true;
    let guard = 0;
    while (changed && guard++ < 200) {
        changed = false;
        outer:
        for (let polygonIndex = 0; polygonIndex < current.length; polygonIndex++) {
            const polygon = current[polygonIndex];
            if (!polygon || !Array.isArray(polygon.points) || polygon.points.length <= 3) continue;
            for (let pointIndex = 0; pointIndex < polygon.points.length; pointIndex++) {
                const nextPolygon = {
                    ...polygon,
                    points: normalizeRing(polygon.points.filter((_, index) => index !== pointIndex))
                };
                if (nextPolygon.points.length < 3 || Math.abs(ringSignedArea(nextPolygon.points)) <= 1e-9) continue;
                const candidate = current.slice();
                candidate[polygonIndex] = nextPolygon;
                if (!terrainOwnershipIsValid(input, candidate)) continue;
                current = candidate;
                changed = true;
                break outer;
            }
        }
    }
    return sortTerrainPolygons(current);
}

function meshCellGeometry(cell) {
    const x = cell.x;
    const y = cell.y;
    const step = cell.step;
    return [[[
        [roundNumber(x), roundNumber(y)],
        [roundNumber(x + step), roundNumber(y)],
        [roundNumber(x + step), roundNumber(y + step)],
        [roundNumber(x), roundNumber(y + step)]
    ]]];
}

function pointInsideOrTouchesAnyInnerHex(point) {
    for (const coord of INNER_COORDS) {
        const corners = hexCorners(coord);
        if (pointInRing(point, corners) || pointTouchesRing(point, corners)) return true;
    }
    return false;
}

function createSpatialMesh(step = SPATIAL_MESH_STEP) {
    const cells = [];
    for (let x = -2.75; x < 2.75; x += step) {
        for (let y = -2.75; y < 2.75; y += step) {
            const cell = {
                x: roundNumber(x),
                y: roundNumber(y),
                step,
                center: {
                    x: roundNumber(x + step / 2),
                    y: roundNumber(y + step / 2)
                }
            };
            if (pointInsideOrTouchesAnyInnerHex(cell.center)) cells.push(cell);
        }
    }
    return cells;
}

function explicitTerrainLabelAtPoint(point, polygons) {
    for (const type of TERRAIN_TYPES) {
        if (polygons.some((polygon) => polygon.type === type && pointInsideOrTouchesPolygon(point, polygon))) {
            return type;
        }
    }
    return "";
}

function terrainFeatureVector(input) {
    const tiles = terrainTilesByKey(input);
    return BUBBLE_COORDS.map((coord) => tiles.get(coordKey(coord)));
}

function majorityLabel(rows) {
    const counts = new Map();
    for (const row of rows) counts.set(row.label, (counts.get(row.label) || 0) + 1);
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
}

function labelImpurity(rows) {
    const counts = new Map();
    for (const row of rows) counts.set(row.label, (counts.get(row.label) || 0) + 1);
    let impurity = 0;
    for (const count of counts.values()) {
        const p = count / rows.length;
        impurity += p * (1 - p);
    }
    return impurity;
}

function trainSpatialDecisionTree(rows, depth = 0, usedFeatures = 0) {
    const label = majorityLabel(rows);
    if (
        depth >= SPATIAL_TREE_MAX_DEPTH ||
        rows.length <= 1 ||
        new Set(rows.map((row) => row.label)).size === 1
    ) {
        return { label };
    }

    const baseImpurity = labelImpurity(rows);
    let best = null;
    for (let featureIndex = 0; featureIndex < BUBBLE_COORDS.length; featureIndex++) {
        const featureMask = 1 << featureIndex;
        if (usedFeatures & featureMask) continue;
        const partitions = new Map();
        for (const row of rows) {
            const value = row.features[featureIndex];
            if (!partitions.has(value)) partitions.set(value, []);
            partitions.get(value).push(row);
        }
        if (partitions.size < 2) continue;
        let splitImpurity = 0;
        for (const partition of partitions.values()) {
            splitImpurity += partition.length / rows.length * labelImpurity(partition);
        }
        const gain = baseImpurity - splitImpurity;
        if (!best || gain > best.gain) {
            best = { featureIndex, gain, partitions };
        }
    }

    if (!best || best.gain <= 1e-12) return { label };
    const children = {};
    for (const [value, partition] of best.partitions) {
        children[value] = trainSpatialDecisionTree(partition, depth + 1, usedFeatures | (1 << best.featureIndex));
    }
    return {
        label,
        featureIndex: best.featureIndex,
        children
    };
}

function predictSpatialDecisionTree(tree, features) {
    let node = tree;
    while (Number.isInteger(node.featureIndex)) {
        node = node.children[features[node.featureIndex]] || { label: node.label };
    }
    return node.label;
}

function uniqueTrainingExamplesByInput(examples) {
    const byInput = new Map();
    for (const example of examples) {
        const signature = inputSignature(example.input);
        if (!byInput.has(signature)) byInput.set(signature, example);
    }
    return [...byInput.values()];
}

function trainSpatialTerrainModel(examples) {
    const trainingExamples = uniqueTrainingExamplesByInput(examples);
    if (trainingExamples.length === 0) {
        throw new Error("no terrain bubble examples for spatial terrain model");
    }
    const cells = createSpatialMesh();
    const trainingRows = trainingExamples.map((example) => ({
        features: terrainFeatureVector(example.input),
        polygons: normalizedOutputPolygons(example)
    }));
    const trees = cells.map((cell) => {
        const rows = trainingRows.map((row) => ({
            features: row.features,
            label: explicitTerrainLabelAtPoint(cell.center, row.polygons)
        }));
        return trainSpatialDecisionTree(rows);
    });
    return {
        schema: "terrain-bubble-spatial-rule-model-v1",
        step: SPATIAL_MESH_STEP,
        trainingExampleCount: trainingExamples.length,
        cells,
        trees
    };
}

function generateSpatialTerrainBubblePolygons(input, model) {
    const features = terrainFeatureVector(input);
    const geometriesByType = new Map(TERRAIN_TYPES.map((type) => [type, []]));
    for (let i = 0; i < model.cells.length; i++) {
        const label = predictSpatialDecisionTree(model.trees[i], features);
        if (!TERRAIN_TYPES.includes(label)) continue;
        geometriesByType.get(label).push(meshCellGeometry(model.cells[i]));
    }

    const out = [];
    const mask = innerSevenMask();
    for (const type of TERRAIN_TYPES) {
        const geometries = geometriesByType.get(type);
        if (!geometries || geometries.length === 0) continue;
        const unioned = unionAll(geometries);
        const clipped = polygonClipping.intersection(unioned, mask);
        out.push(...multiPolygonToTerrainPolygons(type, clipped));
    }
    return sortTerrainPolygons(out);
}

function latticeSnapPoints() {
    const byKey = new Map();
    for (const point of outputSnapPoints()) {
        const rounded = roundPoint(point);
        byKey.set(pointKey(rounded), rounded);
    }
    const points = [...byKey.values()].sort((a, b) => pointKey(a).localeCompare(pointKey(b)));
    if (points.length === 0) {
        throw new Error("terrain bubble snap-edge model has no allowed snap points");
    }
    return points;
}

function snapPointToLattice(point, snapPoints) {
    if (!Array.isArray(snapPoints) || snapPoints.length === 0) {
        throw new Error("terrain bubble snap-edge model cannot snap without lattice points");
    }
    const rounded = roundPoint(point);
    let best = null;
    let bestDistanceSq = Infinity;
    let bestKey = "";
    for (const snapPoint of snapPoints) {
        const dx = rounded.x - snapPoint.x;
        const dy = rounded.y - snapPoint.y;
        const distanceSq = dx * dx + dy * dy;
        const snapKey = pointKey(snapPoint);
        if (
            distanceSq < bestDistanceSq - 1e-12 ||
            (Math.abs(distanceSq - bestDistanceSq) <= 1e-12 && snapKey < bestKey)
        ) {
            best = snapPoint;
            bestDistanceSq = distanceSq;
            bestKey = snapKey;
        }
    }
    return roundPoint(best);
}

function snapRingToLattice(points, snapPoints) {
    const snapped = normalizeRing((Array.isArray(points) ? points : [])
        .map((point) => snapPointToLattice(point, snapPoints)));
    if (snapped.length < 3 || Math.abs(ringSignedArea(snapped)) <= 1e-9) return [];
    return snapped;
}

function edgeKeyFromPointKeys(aKey, bKey) {
    if (aKey === bKey) {
        throw new Error(`terrain bubble snap-edge model got degenerate edge at ${aKey}`);
    }
    return aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
}

function edgeKeyFromPoints(a, b) {
    return edgeKeyFromPointKeys(pointKey(a), pointKey(b));
}

function parseEdgeKey(edge) {
    const [a, b] = String(edge).split("|");
    if (!a || !b) throw new Error(`terrain bubble snap-edge model got invalid edge key ${edge}`);
    return [a, b];
}

function parsePointKey(key) {
    const [x, y] = String(key).split(",").map(Number);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error(`terrain bubble snap-edge model got invalid point key ${key}`);
    }
    return { x: roundNumber(x), y: roundNumber(y) };
}

function terrainEdgeSetsFromPolygons(polygons, snapPoints) {
    const edgeSets = new Map(TERRAIN_TYPES.map((type) => [type, new Set()]));
    for (const polygon of Array.isArray(polygons) ? polygons : []) {
        if (!polygon || !TERRAIN_TYPES.includes(polygon.type)) continue;
        const rings = [polygon.points].concat(Array.isArray(polygon.holes) ? polygon.holes : []);
        for (const ring of rings) {
            const snapped = snapRingToLattice(ring, snapPoints);
            if (snapped.length < 3) continue;
            for (let i = 0; i < snapped.length; i++) {
                edgeSets.get(polygon.type).add(edgeKeyFromPoints(snapped[i], snapped[(i + 1) % snapped.length]));
            }
        }
    }
    return edgeSets;
}

function targetSnapEdgeSetsForExample(example, snapPoints) {
    return terrainEdgeSetsFromPolygons(normalizedOutputPolygons(example), snapPoints);
}

function binaryMajorityLabel(rows) {
    let ones = 0;
    for (const row of rows) if (row.label === 1) ones += 1;
    return ones > rows.length - ones ? 1 : 0;
}

function binaryImpurity(rows) {
    if (rows.length === 0) return 0;
    let ones = 0;
    for (const row of rows) if (row.label === 1) ones += 1;
    const p = ones / rows.length;
    return p * (1 - p) * 2;
}

function trainBinaryDecisionTree(rows, depth = 0, usedFeatures = 0) {
    const label = binaryMajorityLabel(rows);
    if (
        depth >= SNAP_EDGE_TREE_MAX_DEPTH ||
        rows.length <= 1 ||
        new Set(rows.map((row) => row.label)).size === 1
    ) {
        return { label };
    }

    const baseImpurity = binaryImpurity(rows);
    let best = null;
    for (let featureIndex = 0; featureIndex < BUBBLE_COORDS.length; featureIndex++) {
        const featureMask = 1 << featureIndex;
        if (usedFeatures & featureMask) continue;
        const partitions = new Map();
        for (const row of rows) {
            const value = row.features[featureIndex];
            if (!partitions.has(value)) partitions.set(value, []);
            partitions.get(value).push(row);
        }
        if (partitions.size < 2) continue;
        let splitImpurity = 0;
        for (const partition of partitions.values()) {
            splitImpurity += partition.length / rows.length * binaryImpurity(partition);
        }
        const gain = baseImpurity - splitImpurity;
        if (
            !best ||
            gain > best.gain + 1e-12 ||
            (Math.abs(gain - best.gain) <= 1e-12 && featureIndex < best.featureIndex)
        ) {
            best = { featureIndex, gain, partitions };
        }
    }

    if (!best || best.gain <= 1e-12) return { label };
    const children = {};
    const partitionEntries = [...best.partitions.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    for (const [value, partition] of partitionEntries) {
        children[value] = trainBinaryDecisionTree(partition, depth + 1, usedFeatures | (1 << best.featureIndex));
    }
    return {
        label,
        featureIndex: best.featureIndex,
        children
    };
}

function predictBinaryDecisionTree(tree, features) {
    let node = tree;
    while (Number.isInteger(node.featureIndex)) {
        node = node.children[features[node.featureIndex]] || { label: node.label };
    }
    return node.label;
}

function edgeSetDifference(a, b) {
    for (const edge of a) if (!b.has(edge)) return edge;
    for (const edge of b) if (!a.has(edge)) return edge;
    return null;
}

function terrainEdgeSetsEqual(a, b) {
    for (const type of TERRAIN_TYPES) {
        if (edgeSetDifference(a.get(type) || new Set(), b.get(type) || new Set())) return false;
    }
    return true;
}

function predictSnapEdgeSetsFromFeatures(features, model) {
    const edgeSets = new Map(TERRAIN_TYPES.map((type) => [type, new Set()]));
    for (const edgeModel of model.edgeModels) {
        if (predictBinaryDecisionTree(edgeModel.tree, features) !== 1) continue;
        edgeSets.get(edgeModel.type).add(edgeKeyFromPointKeys(edgeModel.a, edgeModel.b));
    }
    return edgeSets;
}

function segmentInsideInnerSeven(a, b) {
    for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        const point = {
            x: a.x + (b.x - a.x) * t,
            y: a.y + (b.y - a.y) * t
        };
        if (!pointInsideOrTouchesAnyInnerHex(point)) return false;
    }
    return true;
}

function buildSnapEdgeRepairEdges(snapPoints, learnedEdges = new Set()) {
    const repairEdges = new Set(learnedEdges);
    for (let i = 0; i < snapPoints.length; i++) {
        for (let j = i + 1; j < snapPoints.length; j++) {
            const a = snapPoints[i];
            const b = snapPoints[j];
            const distance = pointDistance(a, b);
            if (distance <= 1e-6 || distance > 1.0001) continue;
            if (!segmentInsideInnerSeven(a, b)) continue;
            repairEdges.add(edgeKeyFromPoints(a, b));
        }
    }
    return [...repairEdges].sort();
}

function baseTerrainEdgeSets(input) {
    const tiles = terrainTilesByKey(input);
    const edgeSets = new Map(TERRAIN_TYPES.map((type) => [type, new Set()]));
    for (const type of TERRAIN_TYPES) {
        const edges = edgeSets.get(type);
        for (const coord of INNER_COORDS) {
            if (tiles.get(coordKey(coord)) !== type) continue;
            const corners = hexCorners(coord);
            for (let i = 0; i < corners.length; i++) {
                const edge = edgeKeyFromPoints(corners[i], corners[(i + 1) % corners.length]);
                if (edges.has(edge)) {
                    edges.delete(edge);
                } else {
                    edges.add(edge);
                }
            }
        }
    }
    return edgeSets;
}

function edgeLength(edge) {
    const [aKey, bKey] = parseEdgeKey(edge);
    return pointDistance(parsePointKey(aKey), parsePointKey(bKey));
}

function edgeDegreeMap(edges) {
    const degrees = new Map();
    for (const edge of edges || []) {
        const [a, b] = parseEdgeKey(edge);
        degrees.set(a, (degrees.get(a) || 0) + 1);
        degrees.set(b, (degrees.get(b) || 0) + 1);
    }
    return degrees;
}

function snapEdgeRepairAdjacency(model) {
    if (model._repairAdjacency) return model._repairAdjacency;
    const adjacency = new Map();
    function add(a, b, edge) {
        if (!adjacency.has(a)) adjacency.set(a, []);
        adjacency.get(a).push({ to: b, edge });
    }
    for (const edge of model.repairEdges || []) {
        const [a, b] = parseEdgeKey(edge);
        add(a, b, edge);
        add(b, a, edge);
    }
    for (const entries of adjacency.values()) {
        entries.sort((a, b) => a.edge.localeCompare(b.edge));
    }
    model._repairAdjacency = adjacency;
    return adjacency;
}

function shortestTogglePath(selectedEdges, start, end, model) {
    const adjacency = snapEdgeRepairAdjacency(model);
    const distances = new Map([[start, 0]]);
    const previous = new Map();
    const queue = [start];
    const visited = new Set();

    while (queue.length > 0) {
        queue.sort((a, b) => distances.get(a) - distances.get(b) || a.localeCompare(b));
        const current = queue.shift();
        if (visited.has(current)) continue;
        visited.add(current);
        if (current === end) break;

        for (const step of adjacency.get(current) || []) {
            const selected = selectedEdges.has(step.edge);
            const length = edgeLength(step.edge);
            const weight = selected ? 0.2 + length * 0.05 : 0.3 + length;
            const nextDistance = distances.get(current) + weight;
            if (
                nextDistance < (distances.get(step.to) ?? Infinity) - 1e-12 ||
                (
                    Math.abs(nextDistance - (distances.get(step.to) ?? Infinity)) <= 1e-12 &&
                    step.edge < ((previous.get(step.to) && previous.get(step.to).edge) || "")
                )
            ) {
                distances.set(step.to, nextDistance);
                previous.set(step.to, { from: current, edge: step.edge });
                queue.push(step.to);
            }
        }
    }

    if (!previous.has(end)) return null;
    const path = [];
    let current = end;
    while (current !== start) {
        const record = previous.get(current);
        if (!record) return null;
        path.push(record.edge);
        current = record.from;
    }
    return {
        cost: distances.get(end),
        path
    };
}

function toggleEdges(selectedEdges, edges) {
    for (const edge of edges) {
        if (selectedEdges.has(edge)) {
            selectedEdges.delete(edge);
        } else {
            selectedEdges.add(edge);
        }
    }
}

function repairSnapEdgeParity(type, selectedEdges, model) {
    const repaired = new Set(selectedEdges);
    let guard = 0;
    while (guard++ < 40) {
        const oddVertices = [...edgeDegreeMap(repaired).entries()]
            .filter(([, degree]) => degree % 2 === 1)
            .map(([key]) => key)
            .sort();
        if (oddVertices.length === 0) break;
        if (oddVertices.length > 8) {
            throw new Error(`snap-edge terrain projection for ${type} has ${oddVertices.length} odd vertices`);
        }

        let best = null;
        for (let i = 0; i < oddVertices.length; i++) {
            for (let j = i + 1; j < oddVertices.length; j++) {
                const path = shortestTogglePath(repaired, oddVertices[i], oddVertices[j], model);
                if (!path) continue;
                if (
                    !best ||
                    path.cost < best.cost - 1e-12 ||
                    (Math.abs(path.cost - best.cost) <= 1e-12 && path.path.join("|") < best.path.join("|"))
                ) {
                    best = path;
                }
            }
        }
        if (!best) {
            throw new Error(`snap-edge terrain projection for ${type} could not connect odd vertices`);
        }
        toggleEdges(repaired, best.path);
    }

    const remainingOdd = [...edgeDegreeMap(repaired).values()].some((degree) => degree % 2 === 1);
    if (remainingOdd) {
        throw new Error(`snap-edge terrain projection for ${type} left odd-degree vertices`);
    }
    return repaired;
}

function pruneHighDegreeSnapEdges(type, selectedEdges) {
    const pruned = new Set(selectedEdges);
    let guard = 0;
    while (guard++ < 80) {
        const high = [...edgeDegreeMap(pruned).entries()]
            .filter(([, degree]) => degree > 2)
            .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
        if (high.length === 0) break;
        const [vertex] = high[0];
        const incident = [...pruned]
            .filter((edge) => parseEdgeKey(edge).includes(vertex))
            .sort((a, b) => edgeLength(a) - edgeLength(b) || a.localeCompare(b));
        if (incident.length === 0) {
            throw new Error(`snap-edge terrain projection for ${type} could not prune high degree at ${vertex}`);
        }
        pruned.delete(incident[0]);
        const oddVertices = [...edgeDegreeMap(pruned).entries()].filter(([, degree]) => degree % 2 === 1);
        if (oddVertices.length > 0) return pruned;
    }
    return pruned;
}

function repairSnapEdgeSet(type, selectedEdges, model) {
    let repaired = new Set(selectedEdges);
    for (let i = 0; i < 20; i++) {
        repaired = repairSnapEdgeParity(type, repaired, model);
        const highDegree = [...edgeDegreeMap(repaired).values()].some((degree) => degree > 2);
        if (!highDegree) return repaired;
        repaired = pruneHighDegreeSnapEdges(type, repaired);
    }
    throw new Error(`snap-edge terrain projection for ${type} could not reduce graph to closed loops`);
}

function trainSnapEdgeTerrainModel(examples) {
    const trainingExamples = uniqueTrainingExamplesByInput(examples);
    if (trainingExamples.length === 0) {
        throw new Error("no terrain bubble examples for snap-edge terrain model");
    }

    const snapPoints = latticeSnapPoints();
    const vocabularyByType = new Map(TERRAIN_TYPES.map((type) => [type, new Set()]));
    const repairEdges = new Set();
    const trainingRows = trainingExamples.map((example) => {
        const targetEdges = targetSnapEdgeSetsForExample(example, snapPoints);
        for (const type of TERRAIN_TYPES) {
            for (const edge of targetEdges.get(type)) {
                vocabularyByType.get(type).add(edge);
                repairEdges.add(edge);
            }
        }
        return {
            id: example.id,
            features: terrainFeatureVector(example.input),
            targetEdges
        };
    });

    const edgeModels = [];
    for (const type of TERRAIN_TYPES) {
        const edges = [...vocabularyByType.get(type)].sort();
        for (const edge of edges) {
            const rows = trainingRows.map((row) => ({
                features: row.features,
                label: row.targetEdges.get(type).has(edge) ? 1 : 0
            }));
            const [a, b] = edge.split("|");
            edgeModels.push({
                type,
                a,
                b,
                tree: trainBinaryDecisionTree(rows)
            });
        }
    }

    const model = {
        schema: "terrain-bubble-snap-edge-rule-model-v1",
        trainingExampleCount: trainingExamples.length,
        snapPoints,
        repairEdges: buildSnapEdgeRepairEdges(snapPoints, repairEdges),
        edgeModels
    };

    for (const row of trainingRows) {
        const predicted = predictSnapEdgeSetsFromFeatures(row.features, model);
        if (!terrainEdgeSetsEqual(predicted, row.targetEdges)) {
            for (const type of TERRAIN_TYPES) {
                const missed = edgeSetDifference(predicted.get(type), row.targetEdges.get(type));
                if (missed) {
                    throw new Error(`snap-edge terrain model could not fit ${row.id} ${type} edge ${missed}`);
                }
            }
            throw new Error(`snap-edge terrain model could not fit ${row.id}`);
        }
    }

    return model;
}

function buildAdjacencyFromEdges(edges, type) {
    const adjacency = new Map();
    function add(a, b) {
        if (!adjacency.has(a)) adjacency.set(a, new Set());
        adjacency.get(a).add(b);
    }
    for (const edge of edges) {
        const [a, b] = edge.split("|");
        if (!a || !b) throw new Error(`snap-edge terrain graph has invalid ${type} edge ${edge}`);
        add(a, b);
        add(b, a);
    }
    for (const [key, neighbors] of adjacency) {
        if (neighbors.size !== 2) {
            throw new Error(`snap-edge terrain graph for ${type} has degree ${neighbors.size} at ${key}`);
        }
    }
    return adjacency;
}

function traceSnapEdgeLoops(type, edges) {
    if (!edges || edges.size === 0) return [];
    const adjacency = buildAdjacencyFromEdges(edges, type);
    const visited = new Set();
    const loops = [];
    const sortedEdges = [...edges].sort();
    for (const edge of sortedEdges) {
        if (visited.has(edge)) continue;
        const [start, first] = edge.split("|");
        const loopKeys = [start];
        let previous = start;
        let current = first;
        let guard = 0;
        while (current !== start) {
            loopKeys.push(current);
            const currentEdge = edgeKeyFromPointKeys(previous, current);
            if (visited.has(currentEdge)) {
                throw new Error(`snap-edge terrain graph for ${type} revisited edge ${currentEdge}`);
            }
            visited.add(currentEdge);

            const neighbors = [...adjacency.get(current)].sort();
            const next = neighbors[0] === previous ? neighbors[1] : neighbors[0];
            previous = current;
            current = next;
            guard += 1;
            if (guard > edges.size + 1) {
                throw new Error(`snap-edge terrain graph for ${type} did not close a loop`);
            }
        }

        const closingEdge = edgeKeyFromPointKeys(previous, current);
        if (visited.has(closingEdge)) {
            throw new Error(`snap-edge terrain graph for ${type} revisited closing edge ${closingEdge}`);
        }
        visited.add(closingEdge);

        const loop = normalizeRing(loopKeys.map(parsePointKey));
        if (loop.length < 3 || Math.abs(ringSignedArea(loop)) <= 1e-9) {
            throw new Error(`snap-edge terrain graph for ${type} produced a degenerate loop`);
        }
        loops.push(loop);
    }
    return loops;
}

function orientLoop(points, clockwise) {
    const ring = normalizeRing(points);
    const isClockwise = ringSignedArea(ring) < 0;
    return isClockwise === clockwise ? ring : ring.slice().reverse();
}

function ringInsideOrTouchesRing(inner, outer) {
    return inner.every((point) => pointInRing(point, outer) || pointTouchesRing(point, outer));
}

function snapEdgeLoopsToTerrainPolygons(type, loops) {
    const records = loops
        .map((ring, index) => ({
            index,
            ring,
            area: Math.abs(ringSignedArea(ring)),
            depth: 0
        }))
        .sort((a, b) => b.area - a.area || a.index - b.index);

    for (const record of records) {
        record.depth = records.filter((candidate) => (
            candidate !== record &&
            candidate.area > record.area + 1e-9 &&
            ringInsideOrTouchesRing(record.ring, candidate.ring)
        )).length;
    }

    const polygons = [];
    for (const outer of records.filter((record) => record.depth % 2 === 0)) {
        const holes = records
            .filter((record) => record.depth === outer.depth + 1 && ringInsideOrTouchesRing(record.ring, outer.ring))
            .sort((a, b) => b.area - a.area || a.index - b.index)
            .map((record) => orientLoop(record.ring, true));
        const polygon = {
            type,
            points: orientLoop(outer.ring, false)
        };
        if (holes.length > 0) polygon.holes = holes;
        polygons.push(polygon);
    }
    return polygons;
}

function snapEdgeSetsToTerrainPolygons(edgeSets) {
    const polygons = [];
    for (const type of TERRAIN_TYPES) {
        const loops = traceSnapEdgeLoops(type, edgeSets.get(type));
        polygons.push(...snapEdgeLoopsToTerrainPolygons(type, loops));
    }
    return sortTerrainPolygons(polygons);
}

function assertTerrainPolygonsDoNotOverlap(polygons) {
    const multiPolygons = polygons.map((polygon) => ({
        polygon,
        multiPolygon: terrainPolygonToMultiPolygon(polygon)
    }));
    for (let i = 0; i < multiPolygons.length; i++) {
        for (let j = i + 1; j < multiPolygons.length; j++) {
            const intersection = polygonClipping.intersection(multiPolygons[i].multiPolygon, multiPolygons[j].multiPolygon);
            const overlapArea = multiPolygonArea(intersection);
            if (overlapArea > 1e-6) {
                throw new Error(
                    `snap-edge terrain polygons overlap: ` +
                    `${multiPolygons[i].polygon.type} and ${multiPolygons[j].polygon.type} area ${roundNumber(overlapArea)}`
                );
            }
        }
    }
}

function assertSnapEdgeTerrainInvariants(input, polygons) {
    assertTerrainPolygonsDoNotOverlap(polygons);
    if (!terrainOwnershipIsValid(input, polygons)) {
        throw new Error("snap-edge terrain polygons do not satisfy tile-center ownership");
    }
}

function cloneEdgeSets(edgeSets) {
    return new Map(TERRAIN_TYPES.map((type) => [type, new Set(edgeSets.get(type) || [])]));
}

function addEdges(targetEdges, sourceEdges) {
    for (const edge of sourceEdges || []) targetEdges.add(edge);
}

function replaceEdges(targetEdgeSets, type, edges) {
    targetEdgeSets.set(type, new Set(edges || []));
}

function terrainCenterOwnershipFailures(input, polygons) {
    const tiles = terrainTilesByKey(input);
    const failures = [];
    for (const coord of INNER_COORDS) {
        const type = tiles.get(coordKey(coord));
        const center = axialToModel(coord);
        const owned = polygons.some((polygon) => (
            polygon.type === type && pointInsideOrTouchesPolygon(center, polygon)
        ));
        if (!owned) {
            failures.push({ coord, type });
        }
    }
    return failures;
}

function repairSnapEdgeSets(edgeSets, model) {
    const repaired = new Map();
    for (const type of TERRAIN_TYPES) {
        repaired.set(type, repairSnapEdgeSet(type, edgeSets.get(type) || new Set(), model));
    }
    return repaired;
}

function overlappingTypesFromProjectionError(message) {
    const match = /overlap: ([a-z]+) and ([a-z]+) area/.exec(String(message));
    if (!match) return [];
    return [match[1], match[2]].filter((type) => TERRAIN_TYPES.includes(type));
}

function graphTypeFromProjectionError(message) {
    const match = /(?:projection|graph) for ([a-z]+) /.exec(String(message));
    if (!match || !TERRAIN_TYPES.includes(match[1])) return null;
    return match[1];
}

function projectSnapEdgeSetsToTerrainPolygons(input, rawEdgeSets, model) {
    const working = cloneEdgeSets(rawEdgeSets);
    const baseEdges = baseTerrainEdgeSets(input);
    let lastError = null;

    for (let pass = 0; pass < 6; pass++) {
        try {
            const repaired = repairSnapEdgeSets(working, model);
            const polygons = snapEdgeSetsToTerrainPolygons(repaired);
            assertTerrainPolygonsDoNotOverlap(polygons);
            const ownershipFailures = terrainCenterOwnershipFailures(input, polygons);
            if (ownershipFailures.length === 0) {
                assertSnapEdgeTerrainInvariants(input, polygons);
                return polygons;
            }

            let changed = false;
            for (const failure of ownershipFailures) {
                const before = [...working.get(failure.type)].sort().join("|");
                replaceEdges(working, failure.type, baseEdges.get(failure.type));
                const after = [...working.get(failure.type)].sort().join("|");
                if (before !== after) changed = true;
            }
            if (!changed) {
                throw new Error(
                    `snap-edge terrain projection could not satisfy center ownership at ` +
                    `${coordKey(ownershipFailures[0].coord)}`
                );
            }
        } catch (error) {
            lastError = error;
            const message = error && error.message ? error.message : "";
            const overlappingTypes = overlappingTypesFromProjectionError(message);
            if (overlappingTypes.length > 0) {
                for (const type of overlappingTypes) replaceEdges(working, type, baseEdges.get(type));
                continue;
            }
            const graphType = graphTypeFromProjectionError(message);
            if (graphType) {
                replaceEdges(working, graphType, baseEdges.get(graphType));
                continue;
            }
            throw error;
        }
    }

    throw new Error(
        `snap-edge terrain projection did not converge` +
        (lastError && lastError.message ? `: ${lastError.message}` : "")
    );
}

function generateSnapEdgeTerrainBubblePolygons(input, model) {
    if (!model || model.schema !== "terrain-bubble-snap-edge-rule-model-v1") {
        throw new Error("terrain bubble calculator is missing snap-edge model");
    }
    const features = terrainFeatureVector(input);
    const edgeSets = predictSnapEdgeSetsFromFeatures(features, model);
    return projectSnapEdgeSetsToTerrainPolygons(input, edgeSets, model);
}

function trainLocalRuleTerrainModel(examples) {
    const model = trainTerrainBubbleLearner(examples, { augmentSymmetries: false });
    model.schema = "terrain-bubble-local-rule-solver-v1";
    model.snapPoints = latticeSnapPoints();

    model.exactPathRules = [];
    model.records = [];
    model.pathRecords = [];
    model.vertexRecords = [];

    return model;
}

function trainOriginalLearnerTerrainModel(examples) {
    const snapKeys = new Set(outputSnapPoints().map(pointKey));
    const trainable = [];
    const excludedExamples = [];

    function assertPointOnLearnerLattice(point, label) {
        const rounded = roundPoint(point);
        if (!snapKeys.has(pointKey(rounded))) {
            throw new Error(`terrain bubble learner saw off-lattice ${label} ${pointKey(rounded)}`);
        }
    }

    function assertExampleCanTrain(example) {
        const polygons = Array.isArray(example && example.output && example.output.polygons)
            ? example.output.polygons
            : [];
        for (const polygon of polygons) {
            for (const point of polygon.points || []) assertPointOnLearnerLattice(point, "output point");
            for (const hole of polygon.holes || []) {
                for (const point of hole || []) assertPointOnLearnerLattice(point, "output point");
            }
        }
        const anchors = Array.isArray(example && example.editor && example.editor.requiredAnchors)
            ? example.editor.requiredAnchors
            : [];
        for (const anchor of anchors) {
            if (anchor && anchor.point) assertPointOnLearnerLattice(anchor.point, "anchor point");
        }
    }

    for (const example of examples || []) {
        try {
            assertExampleCanTrain(example);
            trainable.push(example);
        } catch (error) {
            excludedExamples.push({
                id: example && example.id,
                name: example && example.name,
                reason: error && error.message ? error.message : String(error)
            });
        }
    }
    if (trainable.length === 0) {
        throw new Error("no trainable terrain bubble examples for original learner");
    }
    return {
        model: trainTerrainBubbleLearner(trainable),
        excludedExamples
    };
}

function generateLocalRuleTerrainBubblePolygons(input, model) {
    if (!model || model.schema !== "terrain-bubble-local-rule-solver-v1") {
        throw new Error("terrain bubble calculator is missing local-rule model");
    }
    let learned = generateLearnedTerrainBubblePolygons(input, model);
    if (!terrainPolygonsAreSimple(learned)) {
        learned = generateLearnedTerrainBubblePolygons(input, {
            ...model,
            localVertexActionRules: []
        });
    }
    if (!terrainPolygonsAreSimple(learned)) {
        learned = generatePrioritySmoothedTerrainBubblePolygons(input);
    }
    const centerIsland = centerIslandTerrainTypes(input);
    if (
        centerIsland &&
        terrainPriority(centerIsland.centerType) > terrainPriority(centerIsland.surroundingType)
    ) {
        const priorityCandidate = generatePrioritySmoothedTerrainBubblePolygons(input);
        if (terrainPolygonsAreSimple(priorityCandidate) && terrainOwnershipIsValid(input, priorityCandidate)) {
            learned = priorityCandidate;
        }
    }
    if (!centerIsland && twoTypeCenterHigherSplit(input)) {
        const priorityCandidate = generatePrioritySmoothedTerrainBubblePolygons(input);
        if (terrainPolygonsAreSimple(priorityCandidate) && terrainOwnershipIsValid(input, priorityCandidate)) {
            learned = priorityCandidate;
        }
    }
    const polygons = sortTerrainPolygons(applyUniformOuterErosion(
        input,
        applyConvexCenterIslandOuterSupport(input, learned)
    ));
    assertTerrainPolygonsAreSimple(polygons);
    assertTerrainPolygonsDoNotOverlap(polygons);
    if (!terrainOwnershipIsValid(input, polygons)) {
        throw new Error("local-rule terrain polygons do not satisfy tile-center ownership");
    }
    return polygons;
}

function generateGeneralizedTerrainBubblePolygons(input, calculator) {
    ensureFallbackModel(calculator);
    return sortTerrainPolygons(clipTerrainPolygonsToInnerSeven(
        generateLearnedTerrainBubblePolygons(input, calculator.model)
    ));
}

function buildTrainingCalculator(examples, options = {}) {
    const maxError = Number.isFinite(options.maxError) ? options.maxError : DEFAULT_MAX_ERROR;
    const groupsByInput = new Map();
    for (const example of examples) {
        const key = inputSignature(example.input);
        if (!groupsByInput.has(key)) groupsByInput.set(key, []);
        groupsByInput.get(key).push(example);
    }

    const conflicts = [];
    for (const [signature, group] of groupsByInput) {
        const pairwise = [];
        for (let i = 0; i < group.length; i++) {
            for (let j = i + 1; j < group.length; j++) {
                const a = normalizedOutputPolygons(group[i]);
                const b = normalizedOutputPolygons(group[j]);
                const error = compareTerrainBubblePolygons(a, b).totalDiffArea;
                if (error > 0) pairwise.push({ a: group[i].id, b: group[j].id, error });
            }
        }
        if (pairwise.length > 0) {
            conflicts.push({
                inputSignature: signature,
                exampleIds: group.map((example) => example.id),
                worstPairwiseError: pairwise.reduce((max, row) => Math.max(max, row.error), 0),
                pairwise
            });
        }
    }

    return {
        schema: "terrain-bubble-generalized-calculator-v1",
        maxError,
        examples: examples.slice(),
        model: null,
        spatialModel: null,
        snapEdgeModel: null,
        candidateVertexModel: null,
        localRuleModel: null,
        trainedExampleCount: 0,
        excludedExamples: [],
        fallbackBuilt: false,
        conflicts
    };
}

function ensureFallbackModel(calculator) {
    if (calculator.fallbackBuilt && calculator.model) return;
    const trained = trainOriginalLearnerTerrainModel(calculator.examples || []);
    calculator.model = trained.model;
    calculator.excludedExamples = trained.excludedExamples;
    calculator.localRuleModel = { snapPoints: latticeSnapPoints() };
    calculator.snapEdgeModel = null;
    calculator.candidateVertexModel = null;
    calculator.spatialModel = null;
    calculator.trainedExampleCount = calculator.model.trainingExampleCount;
    calculator.fallbackBuilt = true;
}

function calculateVerticesForExample(example, calculator) {
    inputSignature(example.input);
    return clonePolygons(generateGeneralizedTerrainBubblePolygons(example.input, calculator));
}

function buildCalculatedExample(input, calculator, fields = {}) {
    ensureFallbackModel(calculator);
    if (calculator.model && calculator.model.schema === "terrain-bubble-anchor-learner-v1") {
        return buildLearnedExample(input, calculator.model, fields);
    }
    const now = new Date().toISOString();
    const id = fields.id || `calculated-suggestion-${Date.now()}`;
    const polygons = calculateVerticesForExample({ id, input }, calculator);
    return {
        schema: "terrain-bubble-example-v1",
        id: fields.id || id,
        name: fields.name || String(fields.id || id).replace(/-/g, " "),
        createdAt: fields.createdAt || now,
        updatedAt: now,
        input: {
            schema: "terrain-bubble-19-v1",
            innerKeys: INNER_COORDS.map(coordKey),
            tiles: BUBBLE_COORDS.map((coord) => {
                const tile = input.tiles.find((candidate) => (
                    Number(candidate.q) === coord.q && Number(candidate.r) === coord.r
                ));
                if (!tile) throw new Error(`terrain bubble calculated example missing tile ${coordKey(coord)}`);
                return {
                    q: coord.q,
                    r: coord.r,
                    type: tile.type
                };
            })
        },
        output: {
            schema: "terrain-bubble-output-v1",
            fills: "inner-7",
            polygons
        },
        editor: {
            edited: false,
            generated: true,
            generatedBy: "terrain-bubble-vertex-calculator-v1",
            savedAt: now,
            totalVertices: polygons.reduce((sum, polygon) => (
                sum + polygon.points.length + (polygon.holes || []).reduce((holeSum, hole) => holeSum + hole.length, 0)
            ), 0),
            polygonVertexCounts: polygons.map((polygon, index) => ({
                index,
                type: polygon.type,
                points: polygon.points.length + (polygon.holes || []).reduce((holeSum, hole) => holeSum + hole.length, 0)
            }))
        }
    };
}

function evaluateExamples(examples, calculator) {
    const results = [];
    const groupsByInput = new Map();
    for (const example of examples) {
        const signature = inputSignature(example.input);
        if (!groupsByInput.has(signature)) groupsByInput.set(signature, []);
        groupsByInput.get(signature).push(example);
    }

    for (const group of groupsByInput.values()) {
        const actual = calculateVerticesForExample(group[0], calculator);
        const actualForScore = clipTerrainPolygonsToInnerSeven(actual);
        const snapPoints = calculator.snapEdgeModel
            ? calculator.snapEdgeModel.snapPoints
            : (calculator.localRuleModel ? calculator.localRuleModel.snapPoints : null);
        const actualSnapEdges = snapPoints
            ? terrainEdgeSetsFromPolygons(actual, snapPoints)
            : null;
        const scoredVariants = group.map((example) => {
            const expected = normalizedOutputPolygons(example);
            const comparison = compareTerrainBubblePolygons(actualForScore, expected);
            const expectedSnapEdges = snapPoints
                ? targetSnapEdgeSetsForExample(example, snapPoints)
                : null;
            const exactSnapEdgeMatch = actualSnapEdges && expectedSnapEdges
                ? terrainEdgeSetsEqual(actualSnapEdges, expectedSnapEdges)
                : false;
            return { example, expected, comparison, exactSnapEdgeMatch };
        }).sort((a, b) => a.comparison.totalDiffArea - b.comparison.totalDiffArea);
        const best = scoredVariants[0];
        results.push({
            id: best.example.id,
            name: best.example.name,
            duplicateInputExampleIds: group.map((example) => example.id),
            totalDiffArea: best.comparison.totalDiffArea,
            exactSnapEdgeMatch: scoredVariants.some((variant) => variant.exactSnapEdgeMatch),
            rows: best.comparison.rows,
            actualVertexCount: actual.reduce((sum, polygon) => (
                sum + polygon.points.length + (polygon.holes || []).reduce((holeSum, hole) => holeSum + hole.length, 0)
            ), 0),
            expectedVertexCount: best.expected.reduce((sum, polygon) => (
                sum + polygon.points.length + (polygon.holes || []).reduce((holeSum, hole) => holeSum + hole.length, 0)
            ), 0)
        });
    }
    return results.sort((a, b) => b.totalDiffArea - a.totalDiffArea || a.id.localeCompare(b.id));
}

function buildReport(examples, calculator, results) {
    const maxError = results.length > 0 ? results[0].totalDiffArea : 0;
    const failures = results.filter((result) => result.totalDiffArea > calculator.maxError);
    const exactSnapEdgeMatches = results.filter((result) => result.exactSnapEdgeMatch).length;
    const exactSnapEdgeFailures = results.filter((result) => !result.exactSnapEdgeMatch);
    return {
        schema: "terrain-bubble-vertex-calculator-report-v1",
        editedExampleCount: examples.length,
        uniqueInputCount: results.length,
        trainedExampleCount: calculator.trainedExampleCount,
        excludedExampleCount: calculator.excludedExamples.length,
        conflictCount: calculator.conflicts.length,
        targetMaxError: calculator.maxError,
        maxError,
        passed: failures.length === 0,
        exactSnapEdgeMatches,
        exactSnapEdgeFailures: exactSnapEdgeFailures.length,
        failures,
        conflicts: calculator.conflicts,
        excludedExamples: calculator.excludedExamples,
        worstResults: results.slice(0, 10)
    };
}

function printTextReport(report, inputOnly) {
    console.log("terrain bubble vertex calculator");
    console.log(`edited examples: ${report.editedExampleCount}`);
    console.log(`unique inputs: ${report.uniqueInputCount}`);
    console.log(`trained generalized rules on: ${report.trainedExampleCount}`);
    console.log(`excluded from training: ${report.excludedExampleCount}`);
    console.log(`duplicate-input conflicts scored by best variant: ${report.conflictCount}`);
    console.log(`exact snapped-edge matches: ${report.exactSnapEdgeMatches}/${report.uniqueInputCount}`);
    console.log(`max error: ${report.maxError.toFixed(6)} (target < ${report.targetMaxError})`);
    console.log(report.passed ? "PASS" : "FAIL");

    if (report.conflicts.length > 0) {
        console.log("");
        console.log("Duplicate inputs where only one saved variant is required to pass:");
        for (const conflict of report.conflicts.slice(0, 12)) {
            console.log(`- ${conflict.exampleIds.join(", ")} worst pairwise ${conflict.worstPairwiseError.toFixed(6)}`);
        }
        if (report.conflicts.length > 12) console.log(`- ... ${report.conflicts.length - 12} more`);
    }

    if (!report.passed) {
        console.log("");
        console.log("Worst failures:");
        for (const result of report.failures.slice(0, 12)) {
            console.log(`- ${result.id}: ${result.totalDiffArea.toFixed(6)}`);
        }
    }
}

function main() {
    const options = parseArgs(process.argv);
    if (options.help) {
        console.log(usage());
        return;
    }

    const examples = loadExamples(options.examplesPath);
    const calculator = buildTrainingCalculator(examples, {
        maxError: options.maxError,
        inputOnly: options.inputOnly
    });
    const results = evaluateExamples(examples, calculator);
    const report = buildReport(examples, calculator, results);

    if (options.json) {
        console.log(JSON.stringify(report, null, 2));
    } else {
        printTextReport(report, options.inputOnly);
    }

    if (!report.passed) process.exitCode = 1;
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(error && error.message ? error.message : error);
        process.exitCode = 1;
    }
}

module.exports = {
    buildCalculatedExample,
    buildTrainingCalculator,
    calculateVerticesForExample,
    compareTerrainBubblePolygons,
    evaluateExamples,
    loadExamples
};
