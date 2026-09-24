const polygonClipping = require("polygon-clipping");
const {
    BUBBLE_COORDS,
    INNER_COORDS,
    TERRAIN_TYPES,
    axialToModel,
    clipTerrainPolygonsToInnerSeven,
    compareTerrainBubblePolygons,
    coordKey,
    getTerrainBubbleInputCoordSets,
    hexCorners,
    innerSevenMask,
    multiPolygonArea,
    roundPoint,
    terrainTilesByKey
} = require("./terrain-bubble-ruleset");

const ROUND_SCALE = 1000000;
const EPSILON = 1e-9;
const ONE_EIGHTH_HEX_SIDE = 0.125;
const TERRAIN_PRIORITY = new Map([
    ["water", 0],
    ["mud", 1],
    ["grass", 2],
    ["mowedgrass", 3],
    ["desert", 4]
]);

function roundNumber(value) {
    return Math.round(Number(value) * ROUND_SCALE) / ROUND_SCALE;
}

function pointKey(point) {
    const rounded = roundPoint(point);
    return `${rounded.x},${rounded.y}`;
}

function sourceEdgeKey(aSourceKey, bSourceKey) {
    return aSourceKey < bSourceKey ? `${aSourceKey}|${bSourceKey}` : `${bSourceKey}|${aSourceKey}`;
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

function pointDistance(a, b) {
    return Math.hypot(Number(a.x) - Number(b.x), Number(a.y) - Number(b.y));
}

function midpoint(a, b) {
    return roundPoint({
        x: (Number(a.x) + Number(b.x)) / 2,
        y: (Number(a.y) + Number(b.y)) / 2
    });
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
        if (!previous || pointDistance(previous, rounded) > 1e-6) out.push(rounded);
    }
    if (out.length > 1 && pointDistance(out[0], out[out.length - 1]) <= 1e-6) out.pop();
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

function normalizeSourceRing(points) {
    const out = [];
    for (const point of Array.isArray(points) ? points : []) {
        const rounded = roundPoint(point);
        const previous = out[out.length - 1];
        if (!previous || pointDistance(previous.point, rounded) > 1e-6) {
            out.push({
                point: rounded,
                sourceKey: pointKey(rounded)
            });
        }
    }
    if (out.length > 1 && pointDistance(out[0].point, out[out.length - 1].point) <= 1e-6) out.pop();
    return out;
}

function ringToPolygonClippingPolygon(points) {
    return [[points.map(pointToPair)]];
}

function unionAll(multiPolygons) {
    const nonEmpty = multiPolygons.filter((multiPolygon) => Array.isArray(multiPolygon) && multiPolygon.length > 0);
    if (nonEmpty.length === 0) return [];
    return polygonClipping.union(...nonEmpty);
}

function sourcePolygonToMultiPolygon(polygon) {
    const rings = [polygon.points].concat(Array.isArray(polygon.holes) ? polygon.holes : []);
    return [rings.map((ring) => ring.map((entry) => pointToPair(entry.point)))];
}

function multiPolygonToSourcePolygons(type, multiPolygon) {
    const out = [];
    for (const polygon of Array.isArray(multiPolygon) ? multiPolygon : []) {
        if (!Array.isArray(polygon) || polygon.length === 0) continue;
        const points = normalizeSourceRing(polygon[0].map(pairToPoint));
        if (points.length < 3 || Math.abs(ringSignedArea(points.map((entry) => entry.point))) <= EPSILON) continue;
        const orientedPoints = ringSignedArea(points.map((entry) => entry.point)) < 0 ? points.slice().reverse() : points;
        const holes = polygon.slice(1)
            .map((ring) => normalizeSourceRing(ring.map(pairToPoint)))
            .filter((ring) => ring.length >= 3 && Math.abs(ringSignedArea(ring.map((entry) => entry.point))) > EPSILON)
            .map((ring) => ringSignedArea(ring.map((entry) => entry.point)) > 0 ? ring.slice().reverse() : ring);
        const next = { type, points: orientedPoints };
        if (holes.length > 0) next.holes = holes;
        out.push(next);
    }
    return out;
}

function sourcePolygonArea(polygon) {
    return Math.abs(ringSignedArea(polygon.points.map((entry) => entry.point)));
}

function sortPolygons(polygons) {
    return polygons.slice().sort((a, b) => {
        const priorityOrder = (TERRAIN_PRIORITY.get(a.type) || 0) - (TERRAIN_PRIORITY.get(b.type) || 0);
        if (priorityOrder !== 0) return priorityOrder;
        const areaOrder = sourcePolygonArea(b) - sourcePolygonArea(a);
        if (Math.abs(areaOrder) > EPSILON) return areaOrder;
        const aFirst = a.points[0] ? a.points[0].point : { x: 0, y: 0 };
        const bFirst = b.points[0] ? b.points[0].point : { x: 0, y: 0 };
        return (aFirst.x - bFirst.x) || (aFirst.y - bFirst.y);
    });
}

function buildInitialSourcePolygons(tiles, bubbleCoords = BUBBLE_COORDS) {
    const polygons = [];
    for (const type of TERRAIN_TYPES) {
        const typeHexes = bubbleCoords
            .filter((coord) => tiles.get(coordKey(coord)) === type)
            .map((coord) => ringToPolygonClippingPolygon(hexCorners(coord)));
        if (typeHexes.length === 0) continue;
        polygons.push(...multiPolygonToSourcePolygons(type, unionAll(typeHexes)));
    }
    return sortPolygons(polygons);
}

function buildVertexContexts(tiles, bubbleCoords = BUBBLE_COORDS) {
    const contexts = new Map();
    for (const coord of bubbleCoords) {
        const type = tiles.get(coordKey(coord));
        const center = roundPoint(axialToModel(coord));
        for (const corner of hexCorners(coord)) {
            const point = roundPoint(corner);
            const key = pointKey(point);
            if (!contexts.has(key)) contexts.set(key, { point, tiles: [] });
            contexts.get(key).tiles.push({ coord, type, center });
        }
    }
    return contexts;
}

function buildSourceVertexPolygonCounts(polygons) {
    const counts = new Map();
    for (const polygon of Array.isArray(polygons) ? polygons : []) {
        const sourceKeys = new Set();
        for (const entry of polygon.points || []) sourceKeys.add(entry.sourceKey);
        for (const hole of polygon.holes || []) {
            for (const entry of hole) sourceKeys.add(entry.sourceKey);
        }
        for (const sourceKey of sourceKeys) counts.set(sourceKey, (counts.get(sourceKey) || 0) + 1);
    }
    return counts;
}

function representedHighestPriority(tiles) {
    let highest = -Infinity;
    for (const type of tiles.values()) highest = Math.max(highest, TERRAIN_PRIORITY.get(type));
    if (!Number.isFinite(highest)) throw new Error("deterministic solver found no represented terrain priorities");
    return highest;
}

function polygonTouchesRepairMask(polygon, repairMask) {
    const clipped = polygonClipping.intersection(sourcePolygonToMultiPolygon(polygon), repairMask);
    return multiPolygonArea(clipped) > EPSILON;
}

function movementCandidateForEntry(entry, terrainType, contexts, fixedSourceKeys) {
    if (fixedSourceKeys.has(entry.sourceKey)) return null;
    const context = contexts.get(entry.sourceKey);
    if (!context) return null;
    const ownPriority = TERRAIN_PRIORITY.get(terrainType);
    const ownTiles = context.tiles.filter((tile) => tile.type === terrainType);
    const higherTiles = context.tiles.filter((tile) => tile.type !== terrainType && TERRAIN_PRIORITY.get(tile.type) > ownPriority);
    if (ownTiles.length !== 1 || higherTiles.length !== 2 || context.tiles.length !== 3) return null;
    return {
        sourceKey: entry.sourceKey,
        point: context.point,
        center: ownTiles[0].center
    };
}

function vertexBordersSameTerrainAndHigherPriorityTile(entry, terrainType, contexts, fixedSourceKeys) {
    if (fixedSourceKeys.has(entry.sourceKey)) return false;
    const context = contexts.get(entry.sourceKey);
    if (!context) return false;
    const ownPriority = TERRAIN_PRIORITY.get(terrainType);
    const ownTiles = context.tiles.filter((tile) => tile.type === terrainType);
    const higherTiles = context.tiles.filter((tile) => tile.type !== terrainType && TERRAIN_PRIORITY.get(tile.type) > ownPriority);
    return ownTiles.length === 2 && higherTiles.length === 1 && context.tiles.length === 3;
}

function sameTerrainHigherPriorityEdgeInsertion(aEntry, bEntry, terrainType, contexts, fixedSourceKeys) {
    if (
        !vertexBordersSameTerrainAndHigherPriorityTile(aEntry, terrainType, contexts, fixedSourceKeys) ||
        !vertexBordersSameTerrainAndHigherPriorityTile(bEntry, terrainType, contexts, fixedSourceKeys)
    ) {
        return null;
    }

    const aContext = contexts.get(aEntry.sourceKey);
    const bContext = contexts.get(bEntry.sourceKey);
    if (!aContext || !bContext) return null;

    const aOwnTiles = aContext.tiles.filter((tile) => tile.type === terrainType);
    const bOwnTileKeys = new Set(bContext.tiles.filter((tile) => tile.type === terrainType).map((tile) => coordKey(tile.coord)));
    const commonOwnTiles = aOwnTiles.filter((tile) => bOwnTileKeys.has(coordKey(tile.coord)));
    if (commonOwnTiles.length !== 1) {
        throw new Error(`deterministic solver same-terrain edge ${aEntry.sourceKey}|${bEntry.sourceKey} could not resolve exactly one lower-priority tile`);
    }

    const ownPriority = TERRAIN_PRIORITY.get(terrainType);
    const aHigherTiles = aContext.tiles.filter((tile) => tile.type !== terrainType && TERRAIN_PRIORITY.get(tile.type) > ownPriority);
    const bHigherTileKeys = new Set(
        bContext.tiles
            .filter((tile) => tile.type !== terrainType && TERRAIN_PRIORITY.get(tile.type) > ownPriority)
            .map((tile) => coordKey(tile.coord))
    );
    const commonHigherTiles = aHigherTiles.filter((tile) => bHigherTileKeys.has(coordKey(tile.coord)));
    if (commonHigherTiles.length !== 1) {
        throw new Error(`deterministic solver same-terrain edge ${aEntry.sourceKey}|${bEntry.sourceKey} could not resolve exactly one higher-priority tile`);
    }

    const edgeMidpoint = midpoint(aContext.point, bContext.point);
    const lowerCenter = commonOwnTiles[0].center;
    const dx = lowerCenter.x - edgeMidpoint.x;
    const dy = lowerCenter.y - edgeMidpoint.y;
    const distance = Math.hypot(dx, dy);
    if (distance <= EPSILON) {
        throw new Error(`deterministic solver same-terrain edge ${aEntry.sourceKey}|${bEntry.sourceKey} has coincident lower-priority center`);
    }

    return roundPoint({
        x: edgeMidpoint.x + dx / distance * ONE_EIGHTH_HEX_SIDE,
        y: edgeMidpoint.y + dy / distance * ONE_EIGHTH_HEX_SIDE
    });
}

function cyclicRuns(flags) {
    const length = flags.length;
    if (length === 0) return [];
    const trueCount = flags.filter(Boolean).length;
    if (trueCount === 0) return [];
    if (trueCount === length) return [{ start: 0, length }];

    let cursor = 0;
    while (flags[cursor]) cursor++;
    const runs = [];
    for (let step = 1; step <= length; step++) {
        const index = (cursor + step) % length;
        if (!flags[index]) continue;
        const start = index;
        let runLength = 0;
        while (runLength < length && flags[(start + runLength) % length]) runLength++;
        runs.push({ start, length: runLength });
        step += runLength;
    }
    return runs;
}

function addMove(moveBySourceKey, modifiedSourceKeys, sourceKey, target) {
    const rounded = roundPoint(target);
    const existing = moveBySourceKey.get(sourceKey);
    if (existing && pointDistance(existing, rounded) > 1e-6) {
        throw new Error(`deterministic solver conflicting move for shared vertex ${sourceKey}: ${pointKey(existing)} vs ${pointKey(rounded)}`);
    }
    moveBySourceKey.set(sourceKey, rounded);
    modifiedSourceKeys.add(sourceKey);
}

function addDelete(deleteSourceKeys, modifiedSourceKeys, fixedSourceKeys, sourceKey) {
    if (fixedSourceKeys.has(sourceKey)) return;
    deleteSourceKeys.add(sourceKey);
    modifiedSourceKeys.add(sourceKey);
}

function addInsertion(insertBySourceEdgeKey, sourceEdge, point) {
    const rounded = roundPoint(point);
    const existing = insertBySourceEdgeKey.get(sourceEdge);
    if (existing && pointDistance(existing, rounded) > 1e-6) {
        throw new Error(`deterministic solver conflicting insertion for shared edge ${sourceEdge}: ${pointKey(existing)} vs ${pointKey(rounded)}`);
    }
    insertBySourceEdgeKey.set(sourceEdge, rounded);
}

function sameCenter(a, b) {
    return pointDistance(a, b) <= 1e-6;
}

function vertexIsSharedByTwoOtherPolygons(sourceKey, sourceVertexPolygonCounts) {
    return (sourceVertexPolygonCounts.get(sourceKey) || 0) >= 3;
}

function betweenOriginalAndAdjacentCenterMidpoint(entry, adjacentEntry, center) {
    return midpoint(midpoint(entry.point, center), midpoint(adjacentEntry.point, center));
}

function processCandidateRun(ring, candidates, run, terrainType, contexts, sourceVertexPolygonCounts, moveBySourceKey, deleteSourceKeys, fixedSourceKeys) {
    const modifiedSourceKeys = new Set();
    if (run.length === 2) {
        const firstIndex = run.start;
        const secondIndex = (run.start + 1) % ring.length;
        const beforeIndex = (run.start + ring.length - 1) % ring.length;
        const afterIndex = (run.start + 2) % ring.length;
        const first = candidates[firstIndex];
        const second = candidates[secondIndex];
        if (!sameCenter(first.center, second.center)) {
            throw new Error(`deterministic solver two-vertex run has different tile centers at ${first.sourceKey} and ${second.sourceKey}`);
        }
        addMove(moveBySourceKey, modifiedSourceKeys, first.sourceKey, betweenOriginalAndAdjacentCenterMidpoint(first, ring[beforeIndex], first.center));
        addMove(moveBySourceKey, modifiedSourceKeys, second.sourceKey, betweenOriginalAndAdjacentCenterMidpoint(second, ring[afterIndex], second.center));
        return modifiedSourceKeys;
    }

    for (let offset = 0; offset < run.length; offset++) {
        const index = (run.start + offset) % ring.length;
        const candidate = candidates[index];
        addMove(moveBySourceKey, modifiedSourceKeys, candidate.sourceKey, midpoint(candidate.point, candidate.center));
    }

    if (run.length === 3) {
        const centerSourceKey = candidates[(run.start + 1) % ring.length].sourceKey;
        if (!vertexIsSharedByTwoOtherPolygons(centerSourceKey, sourceVertexPolygonCounts)) {
            deleteSourceKeys.add(centerSourceKey);
            modifiedSourceKeys.add(centerSourceKey);
        }
        return modifiedSourceKeys;
    }

    if (run.length === 5) {
        throw new Error(`deterministic solver encountered impossible five-vertex run starting at ${ring[run.start].sourceKey}`);
    }

    return modifiedSourceKeys;
}

function processRing(ring, terrainType, contexts, sourceVertexPolygonCounts, moveBySourceKey, deleteSourceKeys, insertBySourceEdgeKey, fixedSourceKeys) {
    if (!Array.isArray(ring) || ring.length < 3) return;
    for (let i = 0; i < ring.length; i++) {
        const current = ring[i];
        const next = ring[(i + 1) % ring.length];
        const insertion = sameTerrainHigherPriorityEdgeInsertion(current, next, terrainType, contexts, fixedSourceKeys);
        if (!insertion) continue;
        addInsertion(insertBySourceEdgeKey, sourceEdgeKey(current.sourceKey, next.sourceKey), insertion);
    }

    const candidates = ring.map((entry) => movementCandidateForEntry(entry, terrainType, contexts, fixedSourceKeys));
    const runs = cyclicRuns(candidates.map(Boolean));
    for (const run of runs) {
        const modifiedSourceKeys = processCandidateRun(ring, candidates, run, terrainType, contexts, sourceVertexPolygonCounts, moveBySourceKey, deleteSourceKeys, fixedSourceKeys);
        for (const sourceKey of modifiedSourceKeys) fixedSourceKeys.add(sourceKey);
    }
}

function collectDeterministicOperations(polygons, tiles, bubbleCoords = BUBBLE_COORDS, repairMask = innerSevenMask()) {
    const contexts = buildVertexContexts(tiles, bubbleCoords);
    const sourceVertexPolygonCounts = buildSourceVertexPolygonCounts(polygons);
    const highestPriority = representedHighestPriority(tiles);
    const moveBySourceKey = new Map();
    const deleteSourceKeys = new Set();
    const insertBySourceEdgeKey = new Map();
    const fixedSourceKeys = new Set();

    for (const polygon of polygons) {
        if ((TERRAIN_PRIORITY.get(polygon.type) || 0) === highestPriority) continue;
        if (!polygonTouchesRepairMask(polygon, repairMask)) continue;
        processRing(polygon.points, polygon.type, contexts, sourceVertexPolygonCounts, moveBySourceKey, deleteSourceKeys, insertBySourceEdgeKey, fixedSourceKeys);
        for (const hole of polygon.holes || []) {
            processRing(hole, polygon.type, contexts, sourceVertexPolygonCounts, moveBySourceKey, deleteSourceKeys, insertBySourceEdgeKey, fixedSourceKeys);
        }
    }

    return { moveBySourceKey, deleteSourceKeys, insertBySourceEdgeKey };
}

function transformRing(ring, operations) {
    const points = [];
    const sourceRing = Array.isArray(ring) ? ring : [];
    for (let i = 0; i < sourceRing.length; i++) {
        const entry = sourceRing[i];
        if (operations.deleteSourceKeys.has(entry.sourceKey)) continue;
        points.push(operations.moveBySourceKey.get(entry.sourceKey) || entry.point);
        const next = sourceRing[(i + 1) % sourceRing.length];
        if (!next || operations.deleteSourceKeys.has(next.sourceKey)) continue;
        const insertion = operations.insertBySourceEdgeKey.get(sourceEdgeKey(entry.sourceKey, next.sourceKey));
        if (insertion) points.push(insertion);
    }
    return normalizeRing(points);
}

function applyDeterministicOperations(polygons, operations) {
    const out = [];
    for (const polygon of polygons) {
        const points = transformRing(polygon.points, operations);
        if (points.length < 3 || Math.abs(ringSignedArea(points)) <= EPSILON) continue;
        const next = {
            type: polygon.type,
            points: ringSignedArea(points) < 0 ? points.slice().reverse() : points
        };
        const holes = (polygon.holes || [])
            .map((hole) => transformRing(hole, operations))
            .filter((hole) => hole.length >= 3 && Math.abs(ringSignedArea(hole)) > EPSILON)
            .map((hole) => ringSignedArea(hole) > 0 ? hole.slice().reverse() : hole);
        if (holes.length > 0) next.holes = holes;
        out.push(next);
    }
    return out;
}

function nearestPointOnSegment(point, a, b) {
    const dx = Number(b.x) - Number(a.x);
    const dy = Number(b.y) - Number(a.y);
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq <= EPSILON) return roundPoint(a);
    const t = Math.max(0, Math.min(1, ((Number(point.x) - Number(a.x)) * dx + (Number(point.y) - Number(a.y)) * dy) / lengthSq));
    return {
        x: Number(a.x) + dx * t,
        y: Number(a.y) + dy * t
    };
}

function pointTouchesRing(point, ring) {
    for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        if (pointDistance(point, nearestPointOnSegment(point, a, b)) <= 1e-6) return true;
    }
    return false;
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

function pointInsideOrTouchingPolygon(point, polygon) {
    const points = Array.isArray(polygon.points) ? polygon.points : [];
    if (!pointInRing(point, points) && !pointTouchesRing(point, points)) return false;
    for (const hole of polygon.holes || []) {
        if (pointInRing(point, hole) && !pointTouchesRing(point, hole)) return false;
    }
    return true;
}

function polygonTouchesSameTerrainInnerCenter(polygon, tiles, innerCoords = INNER_COORDS) {
    for (const coord of innerCoords) {
        if (tiles.get(coordKey(coord)) !== polygon.type) continue;
        if (pointInsideOrTouchingPolygon(axialToModel(coord), polygon)) return true;
    }
    return false;
}

function generateDeterministicTerrainBubblePolygons(input) {
    const coordSets = getTerrainBubbleInputCoordSets(input);
    const tiles = terrainTilesByKey(input, coordSets);
    const repairMask = innerSevenMask(coordSets.innerCoords);
    const initialPolygons = buildInitialSourcePolygons(tiles, coordSets.bubbleCoords);
    const operations = collectDeterministicOperations(initialPolygons, tiles, coordSets.bubbleCoords, repairMask);
    const transformed = applyDeterministicOperations(initialPolygons, operations);
    return clipTerrainPolygonsToInnerSeven(transformed, coordSets.innerCoords)
        .filter((polygon) => polygonTouchesSameTerrainInnerCenter(polygon, tiles, coordSets.innerCoords));
}

function normalizedInput(input) {
    const coordSets = getTerrainBubbleInputCoordSets(input);
    const tiles = terrainTilesByKey(input, coordSets);
    return {
        schema: "terrain-bubble-19-v1",
        innerKeys: coordSets.innerCoords.map(coordKey),
        tiles: coordSets.bubbleCoords.map((coord) => ({
            q: coord.q,
            r: coord.r,
            type: tiles.get(coordKey(coord))
        }))
    };
}

function totalVertexCount(polygons) {
    return polygons.reduce((sum, polygon) => (
        sum + polygon.points.length + (polygon.holes || []).reduce((holeSum, hole) => holeSum + hole.length, 0)
    ), 0);
}

function buildSuggestion(input, fields = {}) {
    const polygons = generateDeterministicTerrainBubblePolygons(input);
    const now = new Date().toISOString();
    const id = fields.id || `deterministic-suggestion-${Date.now()}`;
    return {
        schema: "terrain-bubble-example-v1",
        id,
        name: fields.name || "deterministic solver suggestion",
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
            generatedBy: "terrain-bubble-deterministic-solver-v1",
            savedAt: now,
            totalVertices: totalVertexCount(polygons),
            deterministicSolver: {
                schema: "terrain-bubble-deterministic-solver-v1",
                priorityOrder: ["water", "mud", "grass", "mowedgrass", "desert"]
            }
        }
    };
}

function summarizeRows(rows) {
    let finiteCount = 0;
    let failedCount = 0;
    let totalDiffArea = 0;
    for (const row of rows) {
        if (Number.isFinite(Number(row.totalDiffArea))) {
            finiteCount++;
            totalDiffArea += Number(row.totalDiffArea);
        } else {
            failedCount++;
        }
    }
    return {
        schema: "terrain-bubble-learning-error-summary-v1",
        rowCount: rows.length,
        finiteCount,
        failedCount,
        totalDiffArea: roundNumber(totalDiffArea)
    };
}

function scoreExamples(examples) {
    const rows = [];
    for (const example of Array.isArray(examples) ? examples : []) {
        try {
            const actual = generateDeterministicTerrainBubblePolygons(example.input);
            const expected = clipTerrainPolygonsToInnerSeven(example.output && example.output.polygons || []);
            const comparison = compareTerrainBubblePolygons(actual, expected);
            rows.push({
                id: example.id,
                name: example.name,
                edited: !!(example.editor && example.editor.edited),
                totalDiffArea: comparison.totalDiffArea,
                rows: comparison.rows
            });
        } catch (error) {
            rows.push({
                id: example && example.id,
                name: example && example.name,
                edited: !!(example && example.editor && example.editor.edited),
                totalDiffArea: null,
                error: error.message
            });
        }
    }
    rows.sort((a, b) => {
        const aValue = Number.isFinite(Number(a.totalDiffArea)) ? Number(a.totalDiffArea) : -Infinity;
        const bValue = Number.isFinite(Number(b.totalDiffArea)) ? Number(b.totalDiffArea) : -Infinity;
        return bValue - aValue || String(a.id).localeCompare(String(b.id));
    });
    return {
        schema: "terrain-bubble-deterministic-score-v1",
        generatedAt: new Date().toISOString(),
        solver: "deterministic",
        scoredExampleCount: rows.length,
        errorSummary: summarizeRows(rows),
        rows
    };
}

function annotateExamplesWithScore(library) {
    const report = scoreExamples(library && library.examples);
    const ranked = new Map(report.rows.map((row, index) => [row.id, index + 1]));
    const byId = new Map(report.rows.map((row) => [row.id, row]));
    const nextLibrary = {
        ...(library || {}),
        examples: (Array.isArray(library && library.examples) ? library.examples : []).map((example) => {
            const row = byId.get(example.id);
            const learningError = {
                schema: "terrain-bubble-learning-error-v1",
                mode: "deterministic-solver",
                totalDiffArea: row && Number.isFinite(Number(row.totalDiffArea)) ? row.totalDiffArea : null,
                rows: row && Array.isArray(row.rows) ? row.rows : undefined,
                error: row && row.error || undefined,
                rank: ranked.get(example.id) || null,
                scoredAt: report.generatedAt
            };
            return {
                ...example,
                editor: {
                    ...(example.editor || {}),
                    learningError
                }
            };
        })
    };
    return { library: nextLibrary, report };
}

module.exports = {
    buildSuggestion,
    generateDeterministicTerrainBubblePolygons,
    scoreExamples,
    annotateExamplesWithScore
};
