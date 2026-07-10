const polygonClipping = require("polygon-clipping");

const TERRAIN_TYPES = ["grass", "water", "mud", "desert"];
const TERRAIN_PRIORITY = new Map([
    ["water", 0],
    ["mud", 1],
    ["grass", 2],
    ["desert", 3]
]);
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
const INNER_KEYS = new Set(INNER_COORDS.map(coordKey));
const SQRT3 = Math.sqrt(3);
const ROUND_SCALE = 1000000;

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

function terrainPolygonsToMultiPolygon(polygons) {
    const normalized = [];
    for (const polygon of Array.isArray(polygons) ? polygons : []) {
        if (!polygon || !Array.isArray(polygon.points) || polygon.points.length < 3) continue;
        normalized.push(...terrainPolygonToMultiPolygon(polygon));
    }
    return normalized;
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

function pointDistance(a, b) {
    return Math.hypot(Number(a.x) - Number(b.x), Number(a.y) - Number(b.y));
}

function pointKey(point) {
    const rounded = roundPoint(point);
    return `${rounded.x},${rounded.y}`;
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

function multiPolygonArea(multiPolygon) {
    let total = 0;
    for (const polygon of Array.isArray(multiPolygon) ? multiPolygon : []) {
        if (!Array.isArray(polygon) || polygon.length === 0) continue;
        total += Math.abs(ringAreaPairs(polygon[0]));
        for (let i = 1; i < polygon.length; i++) total -= Math.abs(ringAreaPairs(polygon[i]));
    }
    return total;
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

function unionAll(multiPolygons) {
    const nonEmpty = multiPolygons.filter((multiPolygon) => Array.isArray(multiPolygon) && multiPolygon.length > 0);
    if (nonEmpty.length === 0) return [];
    return polygonClipping.union(...nonEmpty);
}

function innerSevenMask() {
    return unionAll(INNER_COORDS.map((coord) => ringToPolygonClippingPolygon(hexCorners(coord))));
}

function terrainTilesByKey(input) {
    if (!input || !Array.isArray(input.tiles)) {
        throw new Error("terrain bubble ruleset requires input.tiles");
    }
    const tiles = new Map();
    for (const tile of input.tiles) {
        if (!tile || !TERRAIN_TYPES.includes(tile.type)) {
            throw new Error(`terrain bubble ruleset got invalid tile terrain ${tile && tile.type}`);
        }
        tiles.set(coordKey(tile), tile.type);
    }
    for (const coord of BUBBLE_COORDS) {
        const key = coordKey(coord);
        if (!tiles.has(key)) throw new Error(`terrain bubble ruleset input missing tile ${key}`);
    }
    return tiles;
}

function buildHexVertexContexts(tiles) {
    const contexts = new Map();
    for (const coord of BUBBLE_COORDS) {
        const type = tiles.get(coordKey(coord));
        const center = axialToModel(coord);
        for (const corner of hexCorners(coord)) {
            const key = pointKey(corner);
            if (!contexts.has(key)) {
                contexts.set(key, {
                    point: roundPoint(corner),
                    tiles: []
                });
            }
            contexts.get(key).tiles.push({ coord, type, center });
        }
    }
    return contexts;
}

function lowestPriorityTile(tiles) {
    return tiles.slice().sort((a, b) => (
        (TERRAIN_PRIORITY.get(a.type) || 0) - (TERRAIN_PRIORITY.get(b.type) || 0)
    ))[0];
}

function threeTerrainJunctionReplacement(context, options = {}) {
    if (!context || !Array.isArray(context.tiles)) return null;
    const typeSet = new Set(context.tiles.map((tile) => tile.type));
    if (typeSet.size !== 3) return null;
    const typeKey = [...typeSet].sort().join("/");
    if (Array.isArray(options.threeTerrainJunctionTriples) && !options.threeTerrainJunctionTriples.includes(typeKey)) {
        return null;
    }
    const lowTile = lowestPriorityTile(context.tiles);
    if (!lowTile) return null;
    if (!context.tiles.every((tile) => INNER_KEYS.has(coordKey(tile.coord)))) return null;
    return roundPoint({
        x: (context.point.x + lowTile.center.x) / 2,
        y: (context.point.y + lowTile.center.y) / 2
    });
}

function applyLocalJunctionRules(polygons, tiles, options = {}) {
    const contexts = buildHexVertexContexts(tiles);
    const out = [];
    for (const polygon of polygons) {
        const points = normalizeRing(polygon.points.map((point) => {
            const replacement = threeTerrainJunctionReplacement(contexts.get(pointKey(point)), options);
            return replacement || point;
        }));
        if (points.length < 3 || Math.abs(ringSignedArea(points)) <= 1e-9) continue;
        const next = {
            type: polygon.type,
            points: ringSignedArea(points) < 0 ? points.slice().reverse() : points
        };
        if (Array.isArray(polygon.holes) && polygon.holes.length > 0) {
            const holes = polygon.holes
                .map((hole) => normalizeRing(hole.map((point) => {
                    const replacement = threeTerrainJunctionReplacement(contexts.get(pointKey(point)), options);
                    return replacement || point;
                })))
                .filter((hole) => hole.length >= 3 && Math.abs(ringSignedArea(hole)) > 1e-9);
            if (holes.length > 0) next.holes = holes;
        }
        out.push(next);
    }
    return out;
}

function generateTerrainBubblePolygons(input, options = {}) {
    const tiles = terrainTilesByKey(input);
    const mask = innerSevenMask();
    const polygons = [];

    for (const type of TERRAIN_TYPES) {
        const typeHexes = INNER_COORDS
            .filter((coord) => tiles.get(coordKey(coord)) === type)
            .map((coord) => ringToPolygonClippingPolygon(hexCorners(coord)));
        if (typeHexes.length === 0) continue;
        const unioned = unionAll(typeHexes);
        const clipped = polygonClipping.intersection(unioned, mask);
        polygons.push(...multiPolygonToTerrainPolygons(type, clipped));
    }

    const nextPolygons = options.useThreeTerrainJunctionRule
        ? applyLocalJunctionRules(polygons, tiles, options)
        : polygons;
    return sortTerrainPolygons(nextPolygons);
}

function clipTerrainPolygonsToInnerSeven(polygons) {
    const mask = innerSevenMask();
    const byType = new Map(TERRAIN_TYPES.map((type) => [type, []]));
    for (const polygon of Array.isArray(polygons) ? polygons : []) {
        if (!polygon || !TERRAIN_TYPES.includes(polygon.type)) continue;
        const clipped = polygonClipping.intersection(terrainPolygonToMultiPolygon(polygon), mask);
        if (Array.isArray(clipped) && clipped.length > 0) {
            byType.get(polygon.type).push(clipped);
        }
    }

    const out = [];
    for (const type of TERRAIN_TYPES) {
        const unioned = unionAll(byType.get(type));
        out.push(...multiPolygonToTerrainPolygons(type, unioned));
    }
    return sortTerrainPolygons(out);
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

module.exports = {
    BUBBLE_COORDS,
    DIRECTIONS,
    INNER_COORDS,
    TERRAIN_TYPES,
    axialToModel,
    applyLocalJunctionRules,
    clipTerrainPolygonsToInnerSeven,
    compareTerrainBubblePolygons,
    coordKey,
    generateTerrainBubblePolygons,
    hexCorners,
    innerSevenMask,
    multiPolygonArea,
    roundPoint,
    terrainTilesByKey
};
