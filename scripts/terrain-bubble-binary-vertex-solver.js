#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const polygonClipping = require("polygon-clipping");

const TERRAIN_TYPES = ["grass", "mowedgrass", "water", "mud", "desert"];
const TERRAIN_PRIORITY = new Map([
    ["water", 0],
    ["mud", 1],
    ["grass", 2],
    ["mowedgrass", 3],
    ["desert", 4]
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
const EPSILON = 0.00001;
const DEFAULT_EXAMPLES_PATH = path.join(__dirname, "..", "public", "assets", "data", "terrain-bubble-examples.json");

function parseArgs(argv) {
    const options = {
        command: "score",
        examplesPath: DEFAULT_EXAMPLES_PATH,
        inputPath: "",
        exampleId: "",
        json: false,
        trainFraction: 1,
        threshold: 0.15,
        maxError: null,
        excludeName: "",
        scoreName: "",
        partitionOrder: "low-to-high",
        sharedOwner: "low",
        highOwnerPairs: "",
        minComponentSupport: Infinity,
        minComponentProbability: 0.999,
        sharedRepair: false,
        pathChoice: "frequent"
    };

    const args = argv.slice(2);
    if (args[0] && !args[0].startsWith("-")) options.command = args.shift();

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === "--examples") {
            options.examplesPath = path.resolve(args[++i] || "");
        } else if (arg === "--input") {
            options.inputPath = path.resolve(args[++i] || "");
        } else if (arg === "--example-id") {
            options.exampleId = String(args[++i] || "");
        } else if (arg === "--json") {
            options.json = true;
        } else if (arg === "--train-fraction") {
            options.trainFraction = Number(args[++i]);
        } else if (arg === "--threshold") {
            options.threshold = Number(args[++i]);
        } else if (arg === "--max-error") {
            options.maxError = Number(args[++i]);
        } else if (arg === "--exclude-name") {
            options.excludeName = String(args[++i] || "");
        } else if (arg === "--score-name") {
            options.scoreName = String(args[++i] || "");
        } else if (arg === "--partition-order") {
            options.partitionOrder = String(args[++i] || "");
        } else if (arg === "--shared-owner") {
            options.sharedOwner = String(args[++i] || "");
        } else if (arg === "--high-owner-pairs") {
            options.highOwnerPairs = String(args[++i] || "");
        } else if (arg === "--min-component-support") {
            options.minComponentSupport = Number(args[++i]);
        } else if (arg === "--min-component-probability") {
            options.minComponentProbability = Number(args[++i]);
        } else if (arg === "--shared-repair") {
            options.sharedRepair = true;
        } else if (arg === "--path-choice") {
            options.pathChoice = String(args[++i] || "");
        } else if (arg === "--help" || arg === "-h") {
            options.command = "help";
        } else {
            throw new Error(`unknown option ${arg}`);
        }
    }

    if (!Number.isFinite(options.trainFraction) || options.trainFraction <= 0 || options.trainFraction > 1) {
        throw new Error("--train-fraction must be > 0 and <= 1");
    }
    if (!Number.isFinite(options.threshold) || options.threshold < 0 || options.threshold > 1) {
        throw new Error("--threshold must be between 0 and 1");
    }
    if (options.maxError !== null && (!Number.isFinite(options.maxError) || options.maxError < 0)) {
        throw new Error("--max-error must be a non-negative number");
    }
    if (!["low-to-high", "high-to-low", "raw"].includes(options.partitionOrder)) {
        throw new Error("--partition-order must be low-to-high, high-to-low, or raw");
    }
    if (!["low", "high", "best"].includes(options.sharedOwner)) {
        throw new Error("--shared-owner must be low, high, or best");
    }
    if (
        options.minComponentSupport !== Infinity &&
        (!Number.isFinite(options.minComponentSupport) || options.minComponentSupport < 1)
    ) {
        throw new Error("--min-component-support must be >= 1 or Infinity");
    }
    if (!Number.isFinite(options.minComponentProbability) || options.minComponentProbability < 0 || options.minComponentProbability > 1) {
        throw new Error("--min-component-probability must be between 0 and 1");
    }
    if (!["frequent", "shortest", "longest", "rarest"].includes(options.pathChoice)) {
        throw new Error("--path-choice must be frequent, shortest, longest, or rarest");
    }
    return options;
}

function usage() {
    return [
        "Usage:",
        "  node scripts/terrain-bubble-binary-vertex-solver.js score [options]",
        "  node scripts/terrain-bubble-binary-vertex-solver.js suggest --example-id <id> [options]",
        "  node scripts/terrain-bubble-binary-vertex-solver.js suggest --input <input-json> [options]",
        "",
        "Options:",
        "  --examples <path>       Terrain bubble example library",
        "  --example-id <id>       Library example to suggest",
        "  --input <path>          JSON file containing either an example or input object",
        "  --train-fraction <n>    Deterministically train on the first fraction of authored examples",
        "  --threshold <n>         Candidate inclusion probability threshold (default 0.15)",
        "  --max-error <n>         Fail score if max error is greater than or equal to n",
        "  --exclude-name <regex>  Exclude matching example names from training",
        "  --score-name <regex>    Score only matching example names",
        "  --partition-order <o>   raw, low-to-high, or high-to-low (default low-to-high)",
        "  --shared-owner <o>      low, high, or best owner for shared boundaries (default low)",
        "  --high-owner-pairs <p>  Comma-separated terrain pairs whose shared boundary uses high owner",
        "  --min-component-support <n> Minimum path observations before component recipe use (default Infinity/off)",
        "  --min-component-probability <n> Minimum component edge path probability (default 0.999)",
        "  --shared-repair         Partition repaired shared raw polygons against the inner-seven mask",
        "  --path-choice <mode>    frequent, shortest, longest, or rarest local path choice (default frequent)",
        "  --json                  Print full JSON"
    ].join("\n");
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

function edgeKey(a, b) {
    const aKey = pointKey(a);
    const bKey = pointKey(b);
    return aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
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

function pointDistance(a, b) {
    return Math.hypot(Number(a.x) - Number(b.x), Number(a.y) - Number(b.y));
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
    const out = [];
    for (const polygon of Array.isArray(polygons) ? polygons : []) {
        if (!polygon || !Array.isArray(polygon.points) || polygon.points.length < 3) continue;
        out.push(...terrainPolygonToMultiPolygon(polygon));
    }
    return out;
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

function unionAll(multiPolygons) {
    const nonEmpty = multiPolygons.filter((multiPolygon) => Array.isArray(multiPolygon) && multiPolygon.length > 0);
    if (nonEmpty.length === 0) return [];
    return polygonClipping.union(...nonEmpty);
}

function innerSevenMask() {
    return unionAll(INNER_COORDS.map((coord) => ringToPolygonClippingPolygon(hexCorners(coord))));
}

function normalizeRing(points) {
    const out = [];
    for (const point of points || []) {
        const rounded = roundPoint(point);
        const previous = out[out.length - 1];
        if (!previous || pointDistance(previous, rounded) > 0.000001) out.push(rounded);
    }
    if (out.length > 1 && pointDistance(out[0], out[out.length - 1]) <= 0.000001) out.pop();
    return out;
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

function orientRing(points, clockwise) {
    const ring = normalizeRing(points);
    const isClockwise = ringSignedArea(ring) < 0;
    return isClockwise === clockwise ? ring : ring.slice().reverse();
}

function pointTouchesSegment(point, a, b, epsilon = EPSILON) {
    return pointDistance(point, nearestPointOnSegment(point, a, b)) <= epsilon;
}

function nearestPointOnSegment(point, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq <= EPSILON * EPSILON) return roundPoint(a);
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq));
    return roundPoint({
        x: a.x + dx * t,
        y: a.y + dy * t
    });
}

function pointInPolygon(point, polygonPoints) {
    let inside = false;
    for (let i = 0, j = polygonPoints.length - 1; i < polygonPoints.length; j = i++) {
        const pi = polygonPoints[i];
        const pj = polygonPoints[j];
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

function pointInsideOrTouchesRing(point, ring) {
    return pointInPolygon(point, ring) || pointTouchesRing(point, ring);
}

function ringInsideRing(inner, outer) {
    return inner.every((point) => pointInsideOrTouchesRing(point, outer));
}

function deriveContainedHoles(polygons) {
    const out = polygons
        .filter((polygon) => polygon && Array.isArray(polygon.points) && polygon.points.length >= 3)
        .map((polygon) => ({
            type: polygon.type,
            points: orientRing(polygon.points, false)
        }));

    for (const polygon of out) {
        const holes = [];
        for (const other of out) {
            if (other === polygon || other.type === polygon.type) continue;
            if (!ringInsideRing(other.points, polygon.points)) continue;
            if (pointTouchesRing(other.points[0], polygon.points)) continue;
            holes.push(orientRing(other.points, true));
        }
        if (holes.length > 0) polygon.holes = holes;
    }

    return sortPolygons(out);
}

function sortPolygons(polygons) {
    return polygons.slice().sort((a, b) => {
        const priorityOrder = terrainPriority(b.type) - terrainPriority(a.type);
        if (priorityOrder !== 0) return priorityOrder;
        return a.type.localeCompare(b.type);
    });
}

function terrainPriority(type) {
    if (!TERRAIN_PRIORITY.has(type)) throw new Error(`unknown terrain type ${type}`);
    return TERRAIN_PRIORITY.get(type);
}

function terrainPairKey(types) {
    return types.slice().sort().join("|");
}

function terrainTilesByKey(input) {
    if (!input || !Array.isArray(input.tiles)) throw new Error("input.tiles is required");
    const tiles = new Map();
    for (const tile of input.tiles) {
        if (!tile || !TERRAIN_PRIORITY.has(tile.type)) {
            throw new Error(`invalid terrain tile type ${tile && tile.type}`);
        }
        tiles.set(coordKey(tile), tile.type);
    }
    for (const coord of BUBBLE_COORDS) {
        const key = coordKey(coord);
        if (!tiles.has(key)) throw new Error(`input missing bubble tile ${key}`);
    }
    return tiles;
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

function neighborCoord(coord, direction) {
    return {
        q: coord.q + direction.q,
        r: coord.r + direction.r
    };
}

function isAdjacent(a, b) {
    return DIRECTIONS.some((direction) => a.q + direction.q === b.q && a.r + direction.r === b.r);
}

function tileVertexGroups(tiles) {
    const groups = new Map();
    for (const coord of BUBBLE_COORDS) {
        const type = tiles.get(coordKey(coord));
        for (const corner of hexCorners(coord)) {
            const key = pointKey(corner);
            if (!groups.has(key)) {
                groups.set(key, {
                    point: roundPoint(corner),
                    tiles: []
                });
            }
            groups.get(key).tiles.push({
                coord,
                type,
                center: roundPoint(axialToModel(coord))
            });
        }
    }
    return groups;
}

function addCandidate(candidates, point, kind) {
    const rounded = roundPoint(point);
    const key = pointKey(rounded);
    if (!candidates.has(key)) {
        candidates.set(key, {
            point: rounded,
            kinds: new Set()
        });
    }
    candidates.get(key).kinds.add(kind);
}

function hexEdgeMidpoints(coord) {
    const corners = hexCorners(coord);
    const midpoints = [];
    for (let i = 0; i < corners.length; i++) {
        const a = corners[i];
        const b = corners[(i + 1) % corners.length];
        midpoints.push(roundPoint({
            x: (a.x + b.x) / 2,
            y: (a.y + b.y) / 2
        }));
    }
    return midpoints;
}

function allowedCandidatesForTerrain(input, type) {
    const tiles = terrainTilesByKey(input);
    const groups = tileVertexGroups(tiles);
    const candidates = new Map();
    const ownedInner = INNER_COORDS.filter((coord) => tiles.get(coordKey(coord)) === type);
    const ownedKeys = new Set(ownedInner.map(coordKey));

    for (const coord of BUBBLE_COORDS) {
        for (const corner of hexCorners(coord)) addCandidate(candidates, corner, "hex-vertex");
        for (const midpoint of hexEdgeMidpoints(coord)) addCandidate(candidates, midpoint, "hex-edge-midpoint");
    }

    for (const coord of ownedInner) {
        const center = roundPoint(axialToModel(coord));
        const bordersHigher = DIRECTIONS.some((direction) => {
            const neighborType = tiles.get(coordKey(neighborCoord(coord, direction)));
            return neighborType && terrainPriority(neighborType) > terrainPriority(type);
        });
        if (!bordersHigher) continue;

        addCandidate(candidates, center, "owned-center-borders-higher");
        for (const corner of hexCorners(coord)) {
            const group = groups.get(pointKey(corner));
            const touchesHigher = group && group.tiles.some((tile) => terrainPriority(tile.type) > terrainPriority(type));
            if (!touchesHigher) continue;
            addCandidate(candidates, {
                x: (center.x + corner.x) / 2,
                y: (center.y + corner.y) / 2
            }, "owned-center-to-higher-vertex-midpoint");
        }
    }

    for (const coord of BUBBLE_COORDS) {
        const key = coordKey(coord);
        const coordType = tiles.get(key);
        if (ownedKeys.has(key) || terrainPriority(coordType) >= terrainPriority(type)) continue;
        const bordersOwned = ownedInner.some((owned) => isAdjacent(coord, owned));
        if (!bordersOwned) continue;

        const center = roundPoint(axialToModel(coord));
        addCandidate(candidates, center, "lower-border-center");
        for (const corner of hexCorners(coord)) {
            const group = groups.get(pointKey(corner));
            const sharedWithOwned = group && group.tiles.some((tile) => ownedKeys.has(coordKey(tile.coord)));
            if (!sharedWithOwned) continue;
            addCandidate(candidates, {
                x: (center.x + corner.x) / 2,
                y: (center.y + corner.y) / 2
            }, "lower-border-center-to-shared-vertex-midpoint");
        }
    }

    return [...candidates.values()].map((candidate) => ({
        point: candidate.point,
        kinds: [...candidate.kinds].sort()
    }));
}

function baselineRingForTerrain(input, type) {
    return baselineRingsForTerrain(input, type)[0] || [];
}

function baselineRingsForTerrain(input, type) {
    const tiles = terrainTilesByKey(input);
    const typeHexes = INNER_COORDS
        .filter((coord) => tiles.get(coordKey(coord)) === type)
        .map((coord) => ringToPolygonClippingPolygon(hexCorners(coord)));
    if (typeHexes.length === 0) return [];

    const clipped = polygonClipping.intersection(unionAll(typeHexes), innerSevenMask());
    const rings = [];
    for (const polygon of Array.isArray(clipped) ? clipped : []) {
        if (!Array.isArray(polygon) || polygon.length === 0) continue;
        const ring = normalizeRing(polygon[0].map(pairToPoint));
        if (ring.length >= 3) rings.push(ring);
    }
    rings.sort((a, b) => Math.abs(ringSignedArea(b)) - Math.abs(ringSignedArea(a)));
    return rings;
}

function projectionOnRing(point, ring) {
    if (!Array.isArray(ring) || ring.length < 2) return null;
    let best = null;
    for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const lengthSq = dx * dx + dy * dy;
        const t = lengthSq <= EPSILON * EPSILON
            ? 0
            : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq));
        const nearest = {
            x: a.x + dx * t,
            y: a.y + dy * t
        };
        const distance = pointDistance(point, nearest);
        if (!best || distance < best.distance) {
            best = {
                position: i + t,
                segmentIndex: i,
                t,
                distance
            };
        }
    }
    return best;
}

function directionBucket(from, to) {
    const angle = Math.atan2(to.y - from.y, to.x - from.x);
    return ((Math.round((angle - Math.PI / 6) / (Math.PI / 3)) % 6) + 6) % 6;
}

function relationToTerrain(candidateType, currentType) {
    if (candidateType === currentType) return "self";
    if (terrainPriority(candidateType) > terrainPriority(currentType)) return "higher";
    return "lower";
}

function pointTouchesHex(point, coord) {
    const corners = hexCorners(coord);
    return pointInPolygon(point, corners) || pointTouchesRing(point, corners);
}

function localPointContext(input, type, point) {
    const tiles = terrainTilesByKey(input);
    const entries = [];
    for (const coord of BUBBLE_COORDS) {
        if (!pointTouchesHex(point, coord)) continue;
        const tileType = tiles.get(coordKey(coord));
        const center = roundPoint(axialToModel(coord));
        entries.push(`${directionBucket(point, center)}:${INNER_KEYS.has(coordKey(coord)) ? "inner" : "outer"}:${relationToTerrain(tileType, type)}`);
    }
    entries.sort();
    return entries.join(",");
}

function candidateFeature(input, type, candidate, baseRing) {
    const projection = projectionOnRing(candidate.point, baseRing);
    const distanceBucket = !projection
        ? "none"
        : projection.distance <= EPSILON ? "on" : projection.distance <= 0.5 + EPSILON ? "near" : "far";
    const segmentBucket = projection ? Math.floor(projection.position) % Math.max(1, baseRing.length) : -1;
    const segmentContext = projection && baseRing.length > 0
        ? localPointContext(input, type, baseRing[segmentBucket])
        : "none";
    return [
        candidate.kinds.join("+"),
        `rank:${terrainPriority(type)}`,
        `local:${localPointContext(input, type, candidate.point)}`,
        `base:${distanceBucket}:${segmentContext}`
    ].join("|");
}

function selectedPointKeysForType(example, type) {
    const keys = new Set();
    const polygons = Array.isArray(example.output && example.output.polygons)
        ? example.output.polygons
        : [];
    for (const polygon of polygons) {
        if (polygon.type !== type || !Array.isArray(polygon.points)) continue;
        for (const point of polygon.points) keys.add(pointKey(point));
    }
    return keys;
}

function binaryCandidateFeature(input, type, candidate) {
    return `${candidate.kinds.join("+")}|${localCandidateContextKey(input, type, candidate.point)}`;
}

function trainCandidateModel(examples) {
    const augmented = [];
    for (const example of examples) {
        for (const transform of symmetryTransforms()) augmented.push(transformExample(example, transform));
    }

    const binaryVertexModel = trainBinaryVertexModel(augmented);
    return {
        schema: "terrain-bubble-binary-vertex-model-v0",
        trainedExampleCount: examples.length,
        augmentedExampleCount: augmented.length,
        featureCount: binaryVertexModel.featureCount,
        binaryVertexModel,
        features: binaryVertexModel.features
    };
}

function trainBinaryVertexModel(examples) {
    const featureStats = new Map();
    let observationCount = 0;

    for (const example of examples) {
        for (const type of innerTerrainTypes(example.input)) {
            const baseRings = baselineRingsForTerrain(example.input, type);
            const selectedKeys = selectedPointKeysForType(example, type);
            const candidates = allowedCandidatesForTerrain(example.input, type);
            for (const candidate of candidates) {
                if (!candidateRelevantToTerrainBlock(candidate.point, baseRings)) continue;
                const feature = binaryCandidateFeature(example.input, type, candidate);
                if (!featureStats.has(feature)) featureStats.set(feature, { selected: 0, total: 0 });
                const stat = featureStats.get(feature);
                stat.total++;
                observationCount++;
                if (selectedKeys.has(pointKey(candidate.point))) stat.selected++;
            }
        }
    }

    const fuzzyIndex = buildBinaryFuzzyIndex(featureStats);

    return {
        schema: "terrain-bubble-binary-vertex-lookup-v0",
        observationCount,
        featureCount: featureStats.size,
        fuzzyGroupCount: fuzzyIndex.size,
        fuzzyIndex,
        features: featureStats
    };
}

function buildBinaryFuzzyIndex(featureStats) {
    const fuzzyIndex = new Map();
    for (const [feature, stat] of featureStats || []) {
        const parts = binaryFeatureParts(feature);
        if (!parts) continue;
        if (!fuzzyIndex.has(parts.groupKey)) fuzzyIndex.set(parts.groupKey, []);
        fuzzyIndex.get(parts.groupKey).push({
            feature,
            values: parts.values,
            stat
        });
    }
    return fuzzyIndex;
}

function serializeCandidateModel(model) {
    if (!model || model.schema !== "terrain-bubble-binary-vertex-model-v0") {
        throw new Error("cannot serialize invalid binary vertex model");
    }
    const featureEntries = [...model.features].map(([feature, stat]) => ([
        feature,
        {
            selected: stat.selected,
            total: stat.total
        }
    ]));
    return {
        schema: model.schema,
        trainedExampleCount: model.trainedExampleCount,
        augmentedExampleCount: model.augmentedExampleCount,
        featureCount: model.featureCount,
        binaryVertexModel: {
            schema: model.binaryVertexModel.schema,
            observationCount: model.binaryVertexModel.observationCount,
            featureCount: model.binaryVertexModel.featureCount,
            fuzzyGroupCount: model.binaryVertexModel.fuzzyGroupCount,
            features: featureEntries
        },
        features: featureEntries
    };
}

function deserializeCandidateModel(serialized) {
    if (!serialized || serialized.schema !== "terrain-bubble-binary-vertex-model-v0") {
        throw new Error("invalid serialized binary vertex model");
    }
    const featureEntries = Array.isArray(serialized.features)
        ? serialized.features
        : serialized.binaryVertexModel && serialized.binaryVertexModel.features;
    if (!Array.isArray(featureEntries)) {
        throw new Error("serialized binary vertex model missing features");
    }
    const features = new Map(featureEntries.map(([feature, stat]) => ([
        feature,
        {
            selected: Number(stat && stat.selected) || 0,
            total: Number(stat && stat.total) || 0
        }
    ])));
    const fuzzyIndex = buildBinaryFuzzyIndex(features);
    const binaryVertexModel = {
        schema: serialized.binaryVertexModel && serialized.binaryVertexModel.schema || "terrain-bubble-binary-vertex-lookup-v0",
        observationCount: Number(serialized.binaryVertexModel && serialized.binaryVertexModel.observationCount) || 0,
        featureCount: Number(serialized.binaryVertexModel && serialized.binaryVertexModel.featureCount) || features.size,
        fuzzyGroupCount: Number(serialized.binaryVertexModel && serialized.binaryVertexModel.fuzzyGroupCount) || fuzzyIndex.size,
        fuzzyIndex,
        features
    };
    return {
        schema: serialized.schema,
        trainedExampleCount: Number(serialized.trainedExampleCount) || 0,
        augmentedExampleCount: Number(serialized.augmentedExampleCount) || 0,
        featureCount: Number(serialized.featureCount) || features.size,
        binaryVertexModel,
        features
    };
}

function trainLocalComponentModel(examples) {
    const bySignature = new Map();
    let observationCount = 0;

    for (const example of examples) {
        for (const type of innerTerrainTypes(example.input)) {
            for (const baseRing of baselineRingsForTerrain(example.input, type)) {
                const expectedRing = expectedRingForBaseRing(example, type, baseRing);
                if (baseRing.length < 3 || expectedRing.length < 3) continue;
                const signature = localComponentSignature(example.input, type, baseRing);
                if (!bySignature.has(signature)) {
                    bySignature.set(signature, {
                        edgePaths: new Map()
                    });
                }
                const recipe = bySignature.get(signature);
                for (let i = 0; i < baseRing.length; i++) {
                    const a = baseRing[i];
                    const b = baseRing[(i + 1) % baseRing.length];
                    const observation = segmentPathObservation(example.input, type, a, b, expectedRing);
                    if (!observation) continue;
                    const key = edgeKey(a, b);
                    if (!recipe.edgePaths.has(key)) recipe.edgePaths.set(key, new Map());
                    const bucket = recipe.edgePaths.get(key);
                    bucket.set(observation.pathKey, (bucket.get(observation.pathKey) || 0) + 1);
                    observationCount++;
                }
            }
        }
    }

    return {
        schema: "terrain-bubble-local-component-model-v1",
        observationCount,
        signatureCount: bySignature.size,
        bySignature
    };
}

function localComponentSignature(input, type, baseRing) {
    const tiles = terrainTilesByKey(input);
    const component = INNER_COORDS
        .filter((coord) => tiles.get(coordKey(coord)) === type)
        .filter((coord) => pointInsideOrTouchesRing(axialToModel(coord), baseRing));
    const componentKeys = new Set(component.map(coordKey));
    const contextCoords = new Map();
    for (const coord of component) {
        contextCoords.set(coordKey(coord), coord);
        for (const direction of DIRECTIONS) {
            const neighbor = neighborCoord(coord, direction);
            if (tiles.has(coordKey(neighbor))) contextCoords.set(coordKey(neighbor), neighbor);
        }
    }
    const context = [...contextCoords.values()]
        .sort((a, b) => coordKey(a).localeCompare(coordKey(b)))
        .map((coord) => `${coordKey(coord)}:${componentKeys.has(coordKey(coord)) ? "c" : "n"}:${relationValue(input, type, coord)}`);
    return `component:${[...componentKeys].sort().join(";")}|${context.join("|")}`;
}

function trainLocalTransitionModel(examples) {
    const exact = new Map();
    const masked = new Map();
    const counts = new Map();
    const geometry = new Map();
    let observationCount = 0;

    for (const example of examples) {
        for (const type of innerTerrainTypes(example.input)) {
            for (const baseRing of baselineRingsForTerrain(example.input, type)) {
                const expectedRing = expectedRingForBaseRing(example, type, baseRing);
                if (baseRing.length < 3 || expectedRing.length < 3) continue;
                for (let i = 0; i < baseRing.length; i++) {
                    const a = baseRing[i];
                    const b = baseRing[(i + 1) % baseRing.length];
                    const observation = segmentPathObservation(example.input, type, a, b, expectedRing);
                    if (!observation) continue;
                    const contextKey = localBoundarySegmentContextKey(example.input, type, baseRing, i);
                    addPathObservation(exact, contextKey, observation.pathKey);
                    for (const key of maskedContextKeys(contextKey)) {
                        addPathObservation(masked, key, observation.pathKey);
                    }
                    addPathObservation(counts, localBoundarySegmentCountKey(contextKey), observation.pathKey);
                    addPathObservation(geometry, segmentGeometryKey(a, b, observation.pathKey), observation.pathKey);
                    observationCount++;
                }
            }
        }
    }

    return {
        schema: "terrain-bubble-local-transition-model-v1",
        observationCount,
        exact,
        masked,
        counts,
        geometry,
        tableSizes: {
            exact: exact.size,
            masked: masked.size,
            counts: counts.size,
            geometry: geometry.size
        }
    };
}

function addPathObservation(table, key, pathKey) {
    if (!table.has(key)) table.set(key, new Map());
    const bucket = table.get(key);
    bucket.set(pathKey, (bucket.get(pathKey) || 0) + 1);
}

function expectedRingForTerrain(example, type) {
    const polygons = Array.isArray(example.output && example.output.polygons)
        ? example.output.polygons.filter((polygon) => polygon.type === type && Array.isArray(polygon.points))
        : [];
    if (polygons.length === 0) return [];
    return normalizeRing(polygons
        .slice()
        .sort((a, b) => Math.abs(ringSignedArea(b.points || [])) - Math.abs(ringSignedArea(a.points || [])))[0].points);
}

function expectedRingForBaseRing(example, type, baseRing) {
    const polygons = Array.isArray(example.output && example.output.polygons)
        ? example.output.polygons.filter((polygon) => polygon.type === type && Array.isArray(polygon.points))
        : [];
    if (polygons.length === 0) return [];
    let best = null;
    const basePolygon = ringToPolygonClippingPolygon(baseRing);
    for (const polygon of polygons) {
        const ring = normalizeRing(polygon.points || []);
        if (ring.length < 3) continue;
        const overlap = multiPolygonArea(polygonClipping.intersection(basePolygon, ringToPolygonClippingPolygon(ring)));
        if (!best || overlap > best.overlap) best = { ring, overlap };
    }
    return best && best.overlap > 0.000001 ? best.ring : expectedRingForTerrain(example, type);
}

function segmentPathObservation(input, type, a, b, expectedRing) {
    const entries = [];
    const segmentLength = pointDistance(a, b);
    if (segmentLength <= EPSILON) return null;
    for (const point of expectedRing) {
        const projection = projectionOnSegment(point, a, b);
        if (projection.t < -EPSILON || projection.t > 1 + EPSILON) continue;
        if (projection.distance > 0.500001) continue;
        entries.push({
            t: Math.max(0, Math.min(1, projection.t)),
            signed: signedDistanceFromSegment(point, a, b) / segmentLength,
            point
        });
    }
    entries.sort((left, right) => {
        const tOrder = left.t - right.t;
        if (Math.abs(tOrder) > 0.000001) return tOrder;
        return Math.abs(left.signed) - Math.abs(right.signed);
    });
    const path = entries
        .filter((entry, index) => {
            if (index === 0) return true;
            const previous = entries[index - 1];
            return Math.abs(entry.t - previous.t) > 0.000001 || Math.abs(entry.signed - previous.signed) > 0.000001;
        })
        .map((entry) => ({
            t: quantizePathNumber(entry.t),
            signed: quantizePathNumber(entry.signed),
            context: localCandidateContextKey(input, type, entry.point)
        }));
    if (!path.some((entry) => Math.abs(entry.t - 1) <= 0.000001 && Math.abs(entry.signed) <= 0.000001)) {
        path.push({ t: 1, signed: 0, context: "endpoint" });
    }
    const cleaned = path.filter((entry, index) => (
        index === 0 ||
        Math.abs(entry.t - path[index - 1].t) > 0.000001 ||
        Math.abs(entry.signed - path[index - 1].signed) > 0.000001
    ));
    return {
        pathKey: pathKey(cleaned)
    };
}

function segmentPathObservationsForRing(baseRing, expectedRing) {
    const assigned = new Map();
    for (let i = 0; i < baseRing.length; i++) assigned.set(i, []);

    for (const point of expectedRing) {
        let best = null;
        for (let i = 0; i < baseRing.length; i++) {
            const a = baseRing[i];
            const b = baseRing[(i + 1) % baseRing.length];
            const projection = projectionOnSegmentClamped(point, a, b);
            if (!best || projection.distance < best.distance) {
                best = {
                    segmentIndex: i,
                    projection,
                    signed: signedDistanceFromSegment(point, a, b) / Math.max(EPSILON, pointDistance(a, b))
                };
            }
        }
        if (!best || best.projection.distance > 0.900001) continue;
        assigned.get(best.segmentIndex).push({
            t: quantizePathNumber(best.projection.t),
            signed: quantizePathNumber(best.signed)
        });
    }

    const observations = new Map();
    for (let i = 0; i < baseRing.length; i++) {
        const path = assigned.get(i)
            .filter((entry) => entry.t > EPSILON && entry.t < 1 - EPSILON || Math.abs(entry.signed) > EPSILON)
            .sort((a, b) => {
                const tOrder = a.t - b.t;
                if (Math.abs(tOrder) > 0.000001) return tOrder;
                return Math.abs(a.signed) - Math.abs(b.signed);
            });
        path.push({ t: 1, signed: 0 });
        const cleaned = path.filter((entry, index) => (
            index === 0 ||
            Math.abs(entry.t - path[index - 1].t) > 0.000001 ||
            Math.abs(entry.signed - path[index - 1].signed) > 0.000001
        ));
        observations.set(i, {
            pathKey: pathKey(cleaned)
        });
    }
    return observations;
}

function projectionOnSegment(point, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq <= EPSILON * EPSILON) return { t: 0, distance: pointDistance(point, a) };
    const t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq;
    const nearest = {
        x: a.x + dx * t,
        y: a.y + dy * t
    };
    return {
        t,
        distance: pointDistance(point, nearest)
    };
}

function projectionOnSegmentClamped(point, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq <= EPSILON * EPSILON) return { t: 0, distance: pointDistance(point, a) };
    const rawT = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq;
    const t = Math.max(0, Math.min(1, rawT));
    const nearest = {
        x: a.x + dx * t,
        y: a.y + dy * t
    };
    return {
        t,
        distance: pointDistance(point, nearest)
    };
}

function signedDistanceFromSegment(point, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length <= EPSILON) return 0;
    return ((point.x - a.x) * dy - (point.y - a.y) * dx) / length;
}

function quantizePathNumber(value) {
    return Math.round(Number(value) * 1000000) / 1000000;
}

function pathKey(path) {
    return path.map((entry) => `${entry.t}:${entry.signed}`).join(";");
}

function parsePathKey(key) {
    if (!key) return [];
    return String(key).split(";").map((part) => {
        const [t, signed] = part.split(":").map(Number);
        return { t, signed };
    }).filter((entry) => Number.isFinite(entry.t) && Number.isFinite(entry.signed));
}

function pointFromPathEntry(a, b, entry) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (length <= EPSILON) return roundPoint(a);
    return roundPoint({
        x: a.x + dx * entry.t + dy * entry.signed,
        y: a.y + dy * entry.t - dx * entry.signed
    });
}

function localSegmentContextKey(input, type, a, b) {
    const entries = localSegmentTileEntries(input, type, a, b);
    return `kind:edge|values:${entries.map((entry) => `${entry.role}:${entry.value}`).join(",")}`;
}

function localBoundarySegmentContextKey(input, type, baseRing, index) {
    const previous = baseRing[(index - 1 + baseRing.length) % baseRing.length];
    const a = baseRing[index];
    const b = baseRing[(index + 1) % baseRing.length];
    const next = baseRing[(index + 2) % baseRing.length];
    return [
        localSegmentContextKey(input, type, a, b),
        `prev:${segmentDirectionKey(previous, a)}`,
        `curr:${segmentDirectionKey(a, b)}`,
        `next:${segmentDirectionKey(b, next)}`,
        `turn:${turnKey(previous, a, b)}:${turnKey(a, b, next)}`
    ].join("|");
}

function localSegmentCountKey(input, type, a, b) {
    const values = contextValues(localSegmentContextKey(input, type, a, b)).map(contextEntryValue);
    const countsByValue = new Map([["-1", 0], ["0", 0], ["1", 0], ["x", 0]]);
    for (const value of values) countsByValue.set(value, (countsByValue.get(value) || 0) + 1);
    return `counts:${[...countsByValue].map(([key, value]) => `${key}:${value}`).join(",")}`;
}

function localBoundarySegmentCountKey(contextKey) {
    const values = contextValues(contextKey).map(contextEntryValue);
    const countsByValue = new Map([["-1", 0], ["0", 0], ["1", 0], ["x", 0]]);
    for (const value of values) countsByValue.set(value, (countsByValue.get(value) || 0) + 1);
    const prev = /prev:([^|]+)/.exec(contextKey);
    const curr = /curr:([^|]+)/.exec(contextKey);
    const next = /next:([^|]+)/.exec(contextKey);
    const turn = /turn:([^|]+)/.exec(contextKey);
    return [
        `counts:${[...countsByValue].map(([key, value]) => `${key}:${value}`).join(",")}`,
        prev ? `prev:${prev[1]}` : "prev:x",
        curr ? `curr:${curr[1]}` : "curr:x",
        next ? `next:${next[1]}` : "next:x",
        turn ? `turn:${turn[1]}` : "turn:x"
    ].join("|");
}

function segmentGeometryKey(a, b, path) {
    return `len:${quantizePathNumber(pointDistance(a, b))}|steps:${String(path).split(";").length}`;
}

function segmentDirectionKey(a, b) {
    return String(directionBucket(a, b));
}

function turnKey(a, b, c) {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const bcx = c.x - b.x;
    const bcy = c.y - b.y;
    const cross = abx * bcy - aby * bcx;
    if (Math.abs(cross) <= 0.000001) return "straight";
    return cross > 0 ? "left" : "right";
}

function localSegmentTileEntries(input, type, a, b) {
    const midpoint = roundPoint({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const touchingMidpoint = touchingTileEntries(input, midpoint)
        .map((entry) => {
            const center = axialToModel(entry.coord);
            const side = signedDistanceFromSegment(center, a, b) >= 0 ? "left" : "right";
            return {
                role: `mid-${side}`,
                value: relationValue(input, type, entry.coord),
                coord: entry.coord
            };
        });

    const midpointKeys = new Set(touchingMidpoint.map((entry) => coordKey(entry.coord)));
    const endpointEntries = [];
    for (const [endpointLabel, point] of [["a", a], ["b", b]]) {
        for (const entry of touchingTileEntries(input, point)) {
            const key = coordKey(entry.coord);
            if (midpointKeys.has(key)) continue;
            const center = axialToModel(entry.coord);
            const side = signedDistanceFromSegment(center, a, b) >= 0 ? "left" : "right";
            endpointEntries.push({
                role: `${endpointLabel}-${side}`,
                value: relationValue(input, type, entry.coord),
                coord: entry.coord
            });
        }
    }

    const roles = new Map();
    for (const entry of touchingMidpoint.concat(endpointEntries)) {
        const existing = roles.get(entry.role);
        if (!existing || String(entry.value).localeCompare(String(existing.value)) < 0) {
            roles.set(entry.role, entry);
        }
    }
    return ["mid-left", "mid-right", "a-left", "a-right", "b-left", "b-right"]
        .map((role) => roles.get(role) || { role, value: "x" });
}

function maskedContextKeys(key) {
    const values = contextValues(key);
    const keys = [];
    for (let i = 0; i < values.length; i++) {
        const masked = values.slice();
        masked[i] = "?";
        keys.push(contextKeyFromValues(key, masked));
    }
    return keys;
}

function contextValues(key) {
    const match = /values:([^|]+)/.exec(String(key));
    return match ? match[1].split(",") : [];
}

function contextEntryValue(entry) {
    const parts = String(entry).split(":");
    return parts[parts.length - 1] || "x";
}

function contextKeyFromValues(originalKey, values) {
    return String(originalKey).replace(/values:[^|]+/, `values:${values.join(",")}`);
}

function localCandidateContextKey(input, type, point) {
    const touching = touchingTileEntries(input, point);
    if (touching.length <= 1) return oneTileContextKey(input, type, touching[0] && touching[0].coord);
    if (touching.length === 2) return twoTileContextKey(input, type, touching.map((entry) => entry.coord));
    return threeTileContextKey(input, type, touching.map((entry) => entry.coord));
}

function touchingTileEntries(input, point) {
    const tiles = terrainTilesByKey(input);
    return BUBBLE_COORDS
        .filter((coord) => pointTouchesHex(point, coord))
        .map((coord) => ({
            coord,
            type: tiles.get(coordKey(coord)),
            angle: Math.atan2(axialToModel(coord).y - point.y, axialToModel(coord).x - point.x)
        }))
        .sort((a, b) => a.angle - b.angle);
}

function relationValue(input, type, coord) {
    const tiles = terrainTilesByKey(input);
    const tileType = tiles.get(coordKey(coord));
    if (!tileType) return "x";
    if (tileType === type) return "0";
    return terrainPriority(tileType) > terrainPriority(type) ? "1" : "-1";
}

function oneTileContextKey(input, type, coord) {
    if (!coord) return "shape:1|values:x,x,x,x,x,x,x";
    const values = [relationValue(input, type, coord)];
    for (const direction of DIRECTIONS) values.push(relationValue(input, type, neighborCoord(coord, direction)));
    return `shape:1|values:${canonicalCyclic(values)}`;
}

function twoTileContextKey(input, type, coords) {
    const pair = coords.slice().sort((a, b) => coordKey(a).localeCompare(coordKey(b)));
    const mutual = commonNeighbors(pair[0], pair[1]).sort((a, b) => coordKey(a).localeCompare(coordKey(b)));
    const values = pair.concat(mutual).map((coord) => relationValue(input, type, coord));
    return `shape:2|values:${canonicalCyclic(values)}`;
}

function threeTileContextKey(input, type, coords) {
    const values = coords
        .map((coord) => relationValue(input, type, coord))
        .sort()
        .join(",");
    return `shape:3|values:${values}`;
}

function canonicalCyclic(values) {
    const rotations = [];
    for (let i = 0; i < values.length; i++) {
        rotations.push(values.slice(i).concat(values.slice(0, i)).join(","));
    }
    const reversed = values.slice().reverse();
    for (let i = 0; i < reversed.length; i++) {
        rotations.push(reversed.slice(i).concat(reversed.slice(0, i)).join(","));
    }
    return rotations.sort()[0];
}

function commonNeighbors(a, b) {
    const aNeighbors = DIRECTIONS.map((direction) => neighborCoord(a, direction));
    const bKeys = new Set(DIRECTIONS.map((direction) => coordKey(neighborCoord(b, direction))));
    return aNeighbors.filter((coord) => bKeys.has(coordKey(coord)));
}

function clonePoint(point) {
    return roundPoint(point);
}

function cloneRing(points) {
    return normalizeRing(points).map(clonePoint);
}

function clonePolygons(polygons) {
    return (Array.isArray(polygons) ? polygons : [])
        .map((polygon) => {
            const next = {
                type: polygon.type,
                points: cloneRing(polygon.points || [])
            };
            const holes = Array.isArray(polygon.holes)
                ? polygon.holes.map(cloneRing).filter((hole) => hole.length >= 3)
                : [];
            if (holes.length > 0) next.holes = holes;
            return next;
        })
        .filter((polygon) => polygon.points.length >= 3);
}

function featureDecision(model, feature, threshold) {
    const stat = model && model.features && model.features.get(feature);
    if (!stat || stat.total === 0) return null;
    const probability = stat.selected / stat.total;
    return {
        selected: stat.selected,
        total: stat.total,
        probability,
        source: "exact",
        include: stat.selected > 0 && probability >= threshold
    };
}

function fuzzyFeatureDecision(model, feature, threshold) {
    const exact = featureDecision(model, feature, threshold);
    if (exact) return exact;
    const parts = binaryFeatureParts(feature);
    if (!parts || !model || !model.binaryVertexModel || !model.binaryVertexModel.fuzzyIndex) return null;
    const bucket = model.binaryVertexModel.fuzzyIndex.get(parts.groupKey);
    if (!bucket || bucket.length === 0) return null;

    let bestDistance = Infinity;
    let selected = 0;
    let total = 0;
    for (const entry of bucket) {
        const distance = contextValueDistance(parts.values, entry.values);
        if (distance < bestDistance - 0.000001) {
            bestDistance = distance;
            selected = 0;
            total = 0;
        }
        if (Math.abs(distance - bestDistance) > 0.000001) continue;
        selected += entry.stat.selected;
        total += entry.stat.total;
    }
    if (total === 0 || !Number.isFinite(bestDistance)) return null;
    const probability = selected / total;
    return {
        selected,
        total,
        probability,
        source: `fuzzy:${bestDistance}`,
        include: selected > 0 && probability >= threshold
    };
}

function binaryFeatureParts(feature) {
    const parts = String(feature).split("|");
    const valuesPart = parts.find((part) => part.startsWith("values:"));
    const shapePart = parts.find((part) => part.startsWith("shape:"));
    if (!shapePart || !valuesPart) return null;
    const kind = parts[0].startsWith("shape:") ? "any" : parts[0];
    return {
        kind,
        shape: shapePart,
        groupKey: `${kind}|${shapePart}`,
        values: valuesPart.slice("values:".length).split(",")
    };
}

function contextValueDistance(a, b) {
    const length = Math.max(a.length, b.length);
    let distance = Math.abs(a.length - b.length);
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
        if (a[i] === b[i]) continue;
        distance += (a[i] === "x" || b[i] === "x") ? 0.5 : 1;
    }
    return distance;
}

function innerTerrainTypes(input) {
    const tiles = terrainTilesByKey(input);
    return TERRAIN_TYPES
        .filter((type) => INNER_COORDS.some((coord) => tiles.get(coordKey(coord)) === type))
        .sort((a, b) => terrainPriority(b) - terrainPriority(a) || a.localeCompare(b));
}

function generateCandidateVertexPolygons(input, model, options = {}) {
    return generateBinaryVertexPolygons(input, model, options);
}

function generateBinaryVertexPolygons(input, model, options = {}) {
    const threshold = Number.isFinite(options.threshold) ? options.threshold : 0.5;
    const rawPolygons = [];
    const diagnostics = [];

    for (const type of innerTerrainTypes(input)) {
        const baseRings = baselineRingsForTerrain(input, type);
        const candidates = allowedCandidatesForTerrain(input, type);
        let exactIncluded = 0;
        let fuzzyIncluded = 0;
        let excluded = 0;
        let unknown = 0;
        let outsideBlock = 0;

        for (const baseRing of baseRings) {
            if (baseRing.length < 3) continue;
            const selected = new Map();

            for (const candidate of candidates) {
                const projection = projectionOnRing(candidate.point, baseRing);
                if (!projection || projection.distance > 0.95) continue;
                if (!candidateTouchesTerrainBlock(candidate.point, baseRings)) outsideBlock++;
                const feature = binaryCandidateFeature(input, type, candidate);
                const decision = fuzzyFeatureDecision(model, feature, threshold);
                if (!decision) {
                    unknown++;
                    continue;
                }
                if (decision.include) {
                    selected.set(pointKey(candidate.point), candidate.point);
                    if (decision.source === "exact") exactIncluded++;
                    else fuzzyIncluded++;
                } else {
                    excluded++;
                }
            }

            const ordered = orderSelectedVerticesAroundRing([...selected.values()], baseRing);
            const points = cleanGeneratedRing(ordered);
            if (points.length >= 3 && Math.abs(ringSignedArea(points)) > 0.000001) {
                rawPolygons.push({
                    type,
                    points: orientRing(points, false)
                });
            } else {
                diagnostics.push({
                    type,
                    source: "binary-connect",
                    issue: "too-few-selected-vertices",
                    selected: selected.size
                });
            }
        }
        diagnostics.push({
            type,
            source: "binary-vertex",
            components: baseRings.length,
            candidates: candidates.length,
            exactIncluded,
            fuzzyIncluded,
            excluded,
            unknown,
            outsideBlock
        });
    }

    const partitionOrder = options.partitionOrder || "low-to-high";
    const partitioned = partitionOrder === "raw"
        ? { polygons: deriveContainedHoles(rawPolygons), diagnostics: [] }
        : subtractOverlapsByPriority(rawPolygons, partitionOrder);
    const polygons = deriveContainedHoles(partitioned.polygons);
    return {
        polygons,
        diagnostics: diagnostics
            .concat(partitioned.diagnostics)
            .concat(binaryInvariantDiagnostics(input, polygons))
    };
}

function candidateTouchesTerrainBlock(point, baseRings) {
    return baseRings.some((ring) => pointInsideOrTouchesRing(point, ring));
}

function candidateRelevantToTerrainBlock(point, baseRings) {
    return baseRings.some((ring) => {
        const projection = projectionOnRing(point, ring);
        return projection && projection.distance <= 0.95;
    });
}

function orderSelectedVerticesAroundRing(points, baseRing) {
    return normalizeRing(points
        .map((point) => ({
            point,
            projection: projectionOnRing(point, baseRing)
        }))
        .filter((entry) => entry.projection)
        .sort((a, b) => {
            const positionOrder = a.projection.position - b.projection.position;
            if (Math.abs(positionOrder) > 0.000001) return positionOrder;
            return a.projection.distance - b.projection.distance;
        })
        .map((entry) => entry.point));
}

function subtractOverlapsByPriority(rawPolygons, partitionOrder) {
    const types = [...new Set(rawPolygons.map((polygon) => polygon.type))].sort((a, b) => {
        const diff = terrainPriority(a) - terrainPriority(b);
        return partitionOrder === "high-to-low" ? -diff : diff;
    });
    let occupied = [];
    const out = [];
    const diagnostics = [];
    for (const type of types) {
        const rawUnion = unionAll(rawPolygons
            .filter((polygon) => polygon.type === type)
            .map((polygon) => terrainPolygonToMultiPolygon(polygon)));
        if (multiPolygonArea(rawUnion) <= 0.000001) continue;
        const allocated = multiPolygonArea(occupied) > 0.000001
            ? polygonClipping.difference(rawUnion, occupied)
            : rawUnion;
        out.push(...multiPolygonToTerrainPolygons(type, allocated));
        occupied = unionAll([occupied, allocated]);
        diagnostics.push({
            type,
            source: "binary-priority-subtract",
            rawArea: roundNumber(multiPolygonArea(rawUnion)),
            allocatedArea: roundNumber(multiPolygonArea(allocated))
        });
    }
    return {
        polygons: out,
        diagnostics: diagnostics.concat([{
            type: "all",
            source: "binary-priority-subtract",
            order: partitionOrder,
            rawPolygons: rawPolygons.length,
            outputPolygons: out.length
        }])
    };
}

function binaryInvariantDiagnostics(input, polygons) {
    const diagnostics = [];
    const unioned = unionAll([terrainPolygonsToMultiPolygon(polygons)]);
    const holeCount = multiPolygonHoleCount(unioned);
    diagnostics.push({
        type: "all",
        source: "binary-invariants",
        unionHoleCount: holeCount,
        unionArea: roundNumber(multiPolygonArea(unioned)),
        missingCenterCount: missingTerrainCenters(input, polygons).length
    });
    return diagnostics;
}

function multiPolygonHoleCount(multiPolygon) {
    let count = 0;
    for (const polygon of Array.isArray(multiPolygon) ? multiPolygon : []) {
        if (Array.isArray(polygon)) count += Math.max(0, polygon.length - 1);
    }
    return count;
}

function missingTerrainCenters(input, polygons) {
    const tiles = terrainTilesByKey(input);
    const missing = [];
    for (const coord of INNER_COORDS) {
        const type = tiles.get(coordKey(coord));
        const center = axialToModel(coord);
        const touches = polygons
            .filter((polygon) => polygon.type === type)
            .some((polygon) => pointInsideTerrainPolygon(center, polygon));
        if (!touches) {
            missing.push({
                q: coord.q,
                r: coord.r,
                type
            });
        }
    }
    return missing;
}

function pointInsideTerrainPolygon(point, polygon) {
    if (!pointInsideOrTouchesRing(point, polygon.points || [])) return false;
    for (const hole of Array.isArray(polygon.holes) ? polygon.holes : []) {
        if (pointInPolygon(point, hole) && !pointTouchesRing(point, hole)) return false;
    }
    return true;
}

function generateLocalTransitionPolygons(input, transitionModel, options = {}) {
    const polygons = [];
    const diagnostics = [];
    for (const type of innerTerrainTypes(input)) {
        let componentCount = 0;
        let totalBaseVertices = 0;
        let exactHits = 0;
        let fuzzyHits = 0;
        let fallbackHits = 0;

        for (const baseRing of baselineRingsForTerrain(input, type)) {
            if (baseRing.length < 3) continue;
            componentCount++;
            totalBaseVertices += baseRing.length;
            const points = [roundPoint(baseRing[0])];

            for (let i = 0; i < baseRing.length; i++) {
                const a = baseRing[i];
                const b = baseRing[(i + 1) % baseRing.length];
                const contextKey = localBoundarySegmentContextKey(input, type, baseRing, i);
                const selection = selectLocalPath(contextKey, transitionModel);
                if (selection.source === "exact") exactHits++;
                else if (selection.source === "fallback") fallbackHits++;
                else fuzzyHits++;
                for (const entry of parsePathKey(selection.pathKey)) {
                    const point = pointFromPathEntry(a, b, entry);
                    const previous = points[points.length - 1];
                    if (!previous || pointDistance(previous, point) > 0.000001) points.push(point);
                }
            }

            const ring = cleanGeneratedRing(normalizeRing(points));
            if (ring.length >= 3 && Math.abs(ringSignedArea(ring)) > 0.000001) {
                polygons.push({
                    type,
                    points: orientRing(ring, false)
                });
            }
        }

        diagnostics.push({
            type,
            source: "local-transition",
            components: componentCount,
            baseVertices: totalBaseVertices,
            exactHits,
            fuzzyHits,
            fallbackHits
        });
    }
    const partitionOrder = options.partitionOrder || "low-to-high";
    if (partitionOrder !== "raw") {
        const partitioned = partitionTerrainPolygons(input, polygons, partitionOrder);
        return {
            polygons: partitioned.polygons,
            diagnostics: diagnostics.concat(partitioned.diagnostics)
        };
    }
    return {
        polygons: deriveContainedHoles(polygons),
        diagnostics
    };
}

function generateSharedBoundaryPolygons(input, model, options = {}) {
    const transitionModel = model.localTransitionModel;
    const componentModel = model.localComponentModel;
    const pathByEdge = new Map();
    const ringsByType = new Map();
    const diagnostics = [];
    let componentRecipeHits = 0;
    let componentRecipeMisses = 0;

    for (const type of innerTerrainTypes(input)) {
        const rings = baselineRingsForTerrain(input, type);
        ringsByType.set(type, rings);
        for (const baseRing of rings) {
            const componentRecipe = componentRecipeForRing(input, type, baseRing, componentModel);
            if (componentRecipe) componentRecipeHits++;
            else componentRecipeMisses++;
            for (let i = 0; i < baseRing.length; i++) {
                const a = baseRing[i];
                const b = baseRing[(i + 1) % baseRing.length];
                const key = edgeKey(a, b);
                const recipePath = componentRecipe ? bestPathFromTable(componentRecipe.edgePaths, key, options.pathChoice) : null;
                const contextKey = localBoundarySegmentContextKey(input, type, baseRing, i);
                const useRecipePath = recipePath &&
                    recipePath.count >= (options.minComponentSupport || 1) &&
                    recipePath.probability >= (options.minComponentProbability || 0);
                const selection = useRecipePath
                    ? { pathKey: recipePath.pathKey, source: "component", count: recipePath.count }
                    : selectLocalPath(contextKey, transitionModel, options.pathChoice);
                const points = segmentPathPoints(a, b, selection.pathKey);
                const existing = pathByEdge.get(key);
                const shouldReplace = shouldReplaceSharedPath(existing, type, selection, options);
                if (shouldReplace) {
                    pathByEdge.set(key, {
                        ownerType: type,
                        source: selection.source,
                        count: selection.count,
                        points
                    });
                }
            }
        }
    }

    const polygons = [];
    for (const [type, rings] of ringsByType) {
        let componentCount = 0;
        let sharedSegments = 0;
        for (const baseRing of rings) {
            if (baseRing.length < 3) continue;
            componentCount++;
            const points = [];
            for (let i = 0; i < baseRing.length; i++) {
                const a = baseRing[i];
                const b = baseRing[(i + 1) % baseRing.length];
                const path = pathByEdge.get(edgeKey(a, b));
                if (!path) continue;
                sharedSegments++;
                const oriented = pointDistance(path.points[0], a) <= 0.000001
                    ? path.points
                    : path.points.slice().reverse();
                for (const point of oriented) {
                    const previous = points[points.length - 1];
                    if (!previous || pointDistance(previous, point) > 0.000001) points.push(point);
                }
            }
            const ring = cleanGeneratedRing(normalizeRing(points));
            if (ring.length >= 3 && Math.abs(ringSignedArea(ring)) > 0.000001) {
                polygons.push({
                    type,
                    points: orientRing(ring, false)
                });
            }
        }
        diagnostics.push({
            type,
            source: "shared-boundary",
            components: componentCount,
            sharedSegments
        });
    }

    return {
        polygons: options.sharedRepair
            ? partitionTerrainPolygons(input, polygons, "low-to-high").polygons
            : deriveContainedHoles(polygons),
        diagnostics: diagnostics.concat([{
            type: "all",
            source: "shared-boundary-component-recipes",
            componentRecipeHits,
            componentRecipeMisses,
            repaired: !!options.sharedRepair
        }])
    };
}

function shouldReplaceSharedPath(existing, type, selection, options) {
    if (!existing) return true;
    const pairKey = terrainPairKey([existing.ownerType, type]);
    const highOwnerPairs = new Set(String(options.highOwnerPairs || "").split(",").map((entry) => entry.trim()).filter(Boolean));
    const ownerMode = highOwnerPairs.has(pairKey) ? "high" : options.sharedOwner;
    if (ownerMode === "high") return terrainPriority(type) > terrainPriority(existing.ownerType);
    if (ownerMode === "best") {
        const sourceRank = new Map([
            ["component", 4],
            ["exact", 3],
            ["masked", 2],
            ["counts", 1],
            ["fallback", 0]
        ]);
        const nextRank = sourceRank.get(selection.source) || 0;
        const existingRank = sourceRank.get(existing.source) || 0;
        if (nextRank !== existingRank) return nextRank > existingRank;
        if (selection.count !== existing.count) return selection.count > existing.count;
        return terrainPriority(type) < terrainPriority(existing.ownerType);
    }
    return terrainPriority(type) < terrainPriority(existing.ownerType);
}

function componentRecipeForRing(input, type, baseRing, componentModel) {
    if (!componentModel || !componentModel.bySignature) return null;
    return componentModel.bySignature.get(localComponentSignature(input, type, baseRing)) || null;
}

function segmentPathPoints(a, b, pathKeyValue) {
    const points = [roundPoint(a)];
    for (const entry of parsePathKey(pathKeyValue)) {
        const point = pointFromPathEntry(a, b, entry);
        const previous = points[points.length - 1];
        if (!previous || pointDistance(previous, point) > 0.000001) points.push(point);
    }
    if (pointDistance(points[points.length - 1], b) > 0.000001) points.push(roundPoint(b));
    return points;
}

function cleanGeneratedRing(points) {
    let ring = normalizeRing(points);
    let changed = true;
    let guard = 0;
    while (changed && guard++ < 100) {
        changed = false;
        if (ring.length < 4) break;
        for (let i = 0; i < ring.length; i++) {
            const previousIndex = (i - 1 + ring.length) % ring.length;
            const nextIndex = (i + 1) % ring.length;
            if (pointDistance(ring[previousIndex], ring[nextIndex]) <= 0.00001) {
                const remove = [i, nextIndex].sort((a, b) => b - a);
                for (const index of remove) ring.splice(index, 1);
                ring = normalizeRing(ring);
                changed = true;
                break;
            }
            if (pointOnSegmentForCleanup(ring[i], ring[previousIndex], ring[nextIndex])) {
                ring.splice(i, 1);
                ring = normalizeRing(ring);
                changed = true;
                break;
            }
        }
    }
    return ring;
}

function pointOnSegmentForCleanup(point, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq <= 0.0000000001) return pointDistance(point, a) <= 0.00001;
    const t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq;
    if (t <= 0.00001 || t >= 0.99999) return false;
    const nearest = { x: a.x + dx * t, y: a.y + dy * t };
    return pointDistance(point, nearest) <= 0.00001;
}

function partitionTerrainPolygons(input, rawPolygons, partitionOrder) {
    const presentTypes = innerTerrainTypes(input);
    const orderedTypes = presentTypes.slice().sort((a, b) => {
        const diff = terrainPriority(a) - terrainPriority(b);
        return partitionOrder === "high-to-low" ? -diff : diff;
    });
    let remaining = innerSevenMask();
    const out = [];
    for (let i = 0; i < orderedTypes.length; i++) {
        const type = orderedTypes[i];
        const isLast = i === orderedTypes.length - 1;
        const rawUnion = unionAll(rawPolygons
            .filter((polygon) => polygon.type === type)
            .map((polygon) => terrainPolygonToMultiPolygon(polygon)));
        let allocated = [];
        if (isLast) {
            allocated = remaining;
        } else if (Array.isArray(rawUnion) && rawUnion.length > 0) {
            allocated = polygonClipping.intersection(rawUnion, remaining);
        }
        if (multiPolygonArea(allocated) > 0.000001) {
            out.push(...multiPolygonToTerrainPolygons(type, allocated));
            remaining = polygonClipping.difference(remaining, allocated);
        }
    }
    return {
        polygons: deriveContainedHoles(out),
        diagnostics: [{
            type: "all",
            source: "priority-partition",
            order: partitionOrder,
            rawPolygons: rawPolygons.length,
            outputPolygons: out.length,
            remainingArea: roundNumber(multiPolygonArea(remaining))
        }]
    };
}

function selectLocalPath(contextKey, transitionModel, pathChoice = "frequent") {
    const exact = bestPathFromTable(transitionModel.exact, contextKey, pathChoice);
    if (exact) return { pathKey: exact.pathKey, source: "exact", count: exact.count };

    let best = null;
    for (const key of maskedContextKeys(contextKey)) {
        const candidate = bestPathFromTable(transitionModel.masked, key, pathChoice);
        if (!candidate) continue;
        if (!best || candidate.count > best.count) best = candidate;
    }
    if (best) return { pathKey: best.pathKey, source: "masked", count: best.count };

    const countPath = bestPathFromTable(transitionModel.counts, localBoundarySegmentCountKey(contextKey), pathChoice);
    if (countPath) return { pathKey: countPath.pathKey, source: "counts", count: countPath.count };

    return { pathKey: "1:0", source: "fallback", count: 0 };
}

function bestPathFromTable(table, key, pathChoice = "frequent") {
    const bucket = table && table.get(key);
    if (!bucket) return null;
    let best = null;
    let total = 0;
    for (const count of bucket.values()) total += count;
    for (const [pathKeyValue, count] of bucket) {
        const nextComplexity = pathComplexity(pathKeyValue);
        const bestComplexity = best ? pathComplexity(best.pathKey) : Infinity;
        const choiceOrder = pathChoice === "shortest"
            ? nextComplexity - bestComplexity
            : pathChoice === "longest"
                ? bestComplexity - nextComplexity
                : pathChoice === "rarest"
                    ? (best ? count - best.count : -1)
                : 0;
        if (
            !best ||
            (pathChoice === "frequent" && count > best.count) ||
            (pathChoice === "frequent" && count === best.count && nextComplexity < bestComplexity) ||
            (pathChoice !== "frequent" && choiceOrder < 0) ||
            (pathChoice !== "frequent" && choiceOrder === 0 && count > best.count) ||
            (((pathChoice === "frequent" && count === best.count && nextComplexity === bestComplexity) ||
                (pathChoice !== "frequent" && choiceOrder === 0 && count === best.count)) &&
                pathKeyValue.localeCompare(best.pathKey) < 0)
        ) {
            best = { pathKey: pathKeyValue, count };
        }
    }
    if (best) {
        best.total = total;
        best.probability = total > 0 ? best.count / total : 0;
    }
    return best;
}

function pathComplexity(key) {
    return parsePathKey(key).length;
}

function compareTerrainBubblePolygons(actualPolygons, expectedPolygons) {
    const mask = innerSevenMask();
    const actualByType = polygonsByType(clippedPolygons(actualPolygons, mask));
    const expectedByType = polygonsByType(clippedPolygons(expectedPolygons, mask));
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

function clippedPolygons(polygons, mask) {
    const out = [];
    for (const polygon of Array.isArray(polygons) ? polygons : []) {
        if (!polygon || !TERRAIN_PRIORITY.has(polygon.type)) continue;
        const clipped = polygonClipping.intersection(terrainPolygonToMultiPolygon(polygon), mask);
        out.push(...multiPolygonToTerrainPolygons(polygon.type, clipped));
    }
    return out;
}

function polygonsByType(polygons) {
    const byType = new Map(TERRAIN_TYPES.map((type) => [type, []]));
    for (const polygon of polygons) {
        byType.get(polygon.type).push(terrainPolygonToMultiPolygon(polygon));
    }
    const out = new Map();
    for (const type of TERRAIN_TYPES) out.set(type, unionAll(byType.get(type)));
    return out;
}

function multiPolygonToTerrainPolygons(type, multiPolygon) {
    const out = [];
    for (const polygon of Array.isArray(multiPolygon) ? multiPolygon : []) {
        if (!Array.isArray(polygon) || polygon.length === 0) continue;
        const points = normalizeRing(polygon[0].map(pairToPoint));
        if (points.length < 3 || Math.abs(ringSignedArea(points)) <= 0.000001) continue;
        const terrainPolygon = {
            type,
            points: orientRing(points, false)
        };
        const holes = polygon.slice(1)
            .map((ring) => orientRing(ring.map(pairToPoint), true))
            .filter((ring) => ring.length >= 3 && Math.abs(ringSignedArea(ring)) > 0.000001);
        if (holes.length > 0) terrainPolygon.holes = holes;
        out.push(terrainPolygon);
    }
    return out;
}

function buildSuggestion(input, model, options = {}) {
    const generated = generateCandidateVertexPolygons(input, model, options);
    const now = new Date().toISOString();
    return {
        schema: "terrain-bubble-example-v1",
        id: options.id || `candidate-vertex-suggestion-${Date.now()}`,
        name: options.name || "binary vertex suggestion",
        createdAt: now,
        updatedAt: now,
        input: normalizedInput(input),
        output: {
            schema: "terrain-bubble-output-v1",
            fills: "inner-7",
            polygons: generated.polygons
        },
        editor: {
            edited: false,
            generated: true,
            generatedBy: "terrain-bubble-binary-vertex-solver-v0",
            totalVertices: generated.polygons.reduce((sum, polygon) => (
                sum + polygon.points.length + (polygon.holes || []).reduce((holeSum, hole) => holeSum + hole.length, 0)
            ), 0),
            candidateVertexSolver: {
                schema: model.schema,
                trainedExampleCount: model.trainedExampleCount,
                augmentedExampleCount: model.augmentedExampleCount,
                featureCount: model.featureCount,
                binaryObservations: model.binaryVertexModel.observationCount,
                fuzzyGroupCount: model.binaryVertexModel.fuzzyGroupCount,
                threshold: options.threshold,
                diagnostics: generated.diagnostics
            }
        }
    };
}

function scoreExamples(examples, model, options = {}) {
    const rows = [];
    for (const example of examples) {
        try {
            const generated = generateCandidateVertexPolygons(example.input, model, options);
            const comparison = compareTerrainBubblePolygons(generated.polygons, example.output && example.output.polygons);
            rows.push({
                id: example.id,
                name: example.name,
                totalDiffArea: comparison.totalDiffArea,
                rows: comparison.rows,
                diagnostics: generated.diagnostics
            });
        } catch (error) {
            rows.push({
                id: example.id,
                name: example.name,
                totalDiffArea: null,
                error: error.message
            });
        }
    }
    rows.sort((a, b) => {
        const aValue = Number.isFinite(Number(a.totalDiffArea)) ? Number(a.totalDiffArea) : Infinity;
        const bValue = Number.isFinite(Number(b.totalDiffArea)) ? Number(b.totalDiffArea) : Infinity;
        return bValue - aValue || String(a.id).localeCompare(String(b.id));
    });
    const finiteRows = rows.filter((row) => Number.isFinite(Number(row.totalDiffArea)));
    return {
        schema: "terrain-bubble-binary-vertex-score-v0",
        scoredAt: new Date().toISOString(),
        scoredExampleCount: rows.length,
        finiteCount: finiteRows.length,
        totalDiffArea: roundNumber(finiteRows.reduce((sum, row) => sum + Number(row.totalDiffArea), 0)),
        maxDiffArea: finiteRows.length ? finiteRows[0].totalDiffArea : null,
        rows
    };
}

function readLibrary(examplesPath) {
    const parsed = JSON.parse(fs.readFileSync(examplesPath, "utf8"));
    if (!parsed || parsed.schema !== "terrain-bubble-examples-v1" || !Array.isArray(parsed.examples)) {
        throw new Error(`invalid terrain bubble examples library ${examplesPath}`);
    }
    return parsed;
}

function authoredExamples(library) {
    return library.examples.filter((example) => (
        example &&
        example.input &&
        example.input.schema === "terrain-bubble-19-v1" &&
        example.editor &&
        example.editor.edited &&
        example.output &&
        Array.isArray(example.output.polygons)
    ));
}

function chooseTrainingExamples(examples, fraction) {
    const sorted = examples.slice().sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const count = Math.max(1, Math.floor(sorted.length * fraction));
    return sorted.slice(0, count);
}

function readInputOrExample(inputPath) {
    const parsed = JSON.parse(fs.readFileSync(inputPath, "utf8"));
    return parsed.input && Array.isArray(parsed.input.tiles) ? parsed.input : parsed;
}

function axialToCube(coord) {
    return {
        x: Number(coord.q),
        y: -Number(coord.q) - Number(coord.r),
        z: Number(coord.r)
    };
}

function cubeToAxial(cube) {
    return {
        q: Math.round(cube.x),
        r: Math.round(cube.z)
    };
}

function modelToCube(point) {
    const r = Number(point.y) / 1.5;
    const q = Number(point.x) / SQRT3 - r / 2;
    return {
        x: q,
        y: -q - r,
        z: r
    };
}

function cubeToModel(cube) {
    return roundPoint({
        x: SQRT3 * (cube.x + cube.z / 2),
        y: 1.5 * cube.z
    });
}

function rotateCubeClockwise(cube) {
    return {
        x: -cube.z,
        y: -cube.x,
        z: -cube.y
    };
}

function reflectCube(cube) {
    return {
        x: cube.z,
        y: cube.y,
        z: cube.x
    };
}

function transformCube(cube, transform) {
    let next = { x: cube.x, y: cube.y, z: cube.z };
    if (transform.reflect) next = reflectCube(next);
    for (let i = 0; i < transform.rotation; i++) next = rotateCubeClockwise(next);
    return next;
}

function transformCoord(coord, transform) {
    return cubeToAxial(transformCube(axialToCube(coord), transform));
}

function transformPoint(point, transform) {
    return cubeToModel(transformCube(modelToCube(point), transform));
}

function symmetryTransforms() {
    const transforms = [];
    for (const reflect of [false, true]) {
        for (let rotation = 0; rotation < 6; rotation++) transforms.push({ reflect, rotation });
    }
    return transforms;
}

function transformExample(example, transform) {
    return {
        ...example,
        id: `${example.id || "example"}#${transform.reflect ? "m" : "r"}${transform.rotation}`,
        input: {
            ...(example.input || {}),
            tiles: (example.input.tiles || []).map((tile) => ({
                ...transformCoord(tile, transform),
                type: tile.type
            }))
        },
        output: {
            ...(example.output || {}),
            polygons: (example.output.polygons || []).map((polygon) => ({
                type: polygon.type,
                points: (polygon.points || []).map((point) => transformPoint(point, transform)),
                holes: Array.isArray(polygon.holes)
                    ? polygon.holes.map((hole) => hole.map((point) => transformPoint(point, transform)))
                    : undefined
            }))
        }
    };
}

function printScoreText(report, model, trainingExamples) {
    console.log("terrain bubble binary vertex solver");
    console.log(`trained examples: ${trainingExamples.length}`);
    console.log(`augmented examples: ${model.augmentedExampleCount}`);
    console.log(`features: ${model.featureCount}`);
    console.log(`binary observations: ${model.binaryVertexModel.observationCount}`);
    console.log(`fuzzy groups: ${model.binaryVertexModel.fuzzyGroupCount}`);
    console.log(`scored examples: ${report.scoredExampleCount}`);
    console.log(`total diff area: ${report.totalDiffArea}`);
    console.log(`max diff area: ${report.maxDiffArea}`);
    console.log("");
    console.log("Worst examples:");
    for (const row of report.rows.slice(0, 12)) {
        const value = Number.isFinite(Number(row.totalDiffArea)) ? Number(row.totalDiffArea).toFixed(6) : row.error;
        console.log(`- ${row.id}: ${value}`);
    }
}

function main() {
    const options = parseArgs(process.argv);
    if (options.command === "help") {
        console.log(usage());
        return;
    }

    const library = readLibrary(options.examplesPath);
    const authored = authoredExamples(library);
    if (authored.length === 0) throw new Error("no authored terrain bubble examples found");
    const excludedByName = options.excludeName
        ? new RegExp(options.excludeName, "i")
        : null;
    const scoredByName = options.scoreName
        ? new RegExp(options.scoreName, "i")
        : null;
    const trainingPool = excludedByName
        ? authored.filter((example) => !excludedByName.test(example.name || ""))
        : authored;
    const scorePool = scoredByName
        ? authored.filter((example) => scoredByName.test(example.name || ""))
        : authored;
    const trainingExamples = chooseTrainingExamples(trainingPool, options.trainFraction);
    const model = trainCandidateModel(trainingExamples);

    if (options.command === "score") {
        const report = scoreExamples(scorePool, model, {
            threshold: options.threshold,
            partitionOrder: options.partitionOrder,
            sharedOwner: options.sharedOwner,
            highOwnerPairs: options.highOwnerPairs,
            minComponentSupport: options.minComponentSupport,
            sharedRepair: options.sharedRepair,
            pathChoice: options.pathChoice
        });
        const failedMaxError = options.maxError !== null &&
            Number.isFinite(Number(report.maxDiffArea)) &&
            Number(report.maxDiffArea) >= options.maxError;
        if (options.json) {
            console.log(JSON.stringify({
                model: {
                    schema: model.schema,
                    trainedExampleCount: model.trainedExampleCount,
                    augmentedExampleCount: model.augmentedExampleCount,
                    featureCount: model.featureCount,
                    binaryObservations: model.binaryVertexModel.observationCount,
                    fuzzyGroupCount: model.binaryVertexModel.fuzzyGroupCount
                },
                trainingExampleIds: trainingExamples.map((example) => example.id),
                excludedNamePattern: options.excludeName || null,
                scoreNamePattern: options.scoreName || null,
                report
            }, null, 2));
        } else {
            printScoreText(report, model, trainingExamples);
        }
        if (failedMaxError) {
            console.error(`max error ${report.maxDiffArea} is not below ${options.maxError}`);
            process.exitCode = 1;
        }
        return;
    }

    if (options.command === "suggest") {
        let input = null;
        let name = "binary vertex suggestion";
        if (options.exampleId) {
            const example = library.examples.find((candidate) => candidate.id === options.exampleId);
            if (!example) throw new Error(`example not found: ${options.exampleId}`);
            input = example.input;
            name = `${example.name || example.id} binary vertex suggestion`;
        } else if (options.inputPath) {
            input = readInputOrExample(options.inputPath);
            name = `${path.basename(options.inputPath)} binary vertex suggestion`;
        } else {
            throw new Error("suggest requires --example-id or --input");
        }
        const suggestion = buildSuggestion(input, model, {
            id: options.exampleId ? `${options.exampleId}-binary-vertex-suggestion` : undefined,
            name,
            threshold: options.threshold,
            partitionOrder: options.partitionOrder,
            sharedOwner: options.sharedOwner,
            highOwnerPairs: options.highOwnerPairs,
            minComponentSupport: options.minComponentSupport,
            sharedRepair: options.sharedRepair,
            pathChoice: options.pathChoice
        });
        console.log(JSON.stringify(suggestion, null, 2));
        return;
    }

    throw new Error(`unknown command ${options.command}`);
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(error.message);
        process.exitCode = 1;
    }
}

module.exports = {
    allowedCandidatesForTerrain,
    baselineRingsForTerrain,
    buildSuggestion,
    compareTerrainBubblePolygons,
    deserializeCandidateModel,
    edgeKey,
    generateCandidateVertexPolygons,
    pointKey,
    scoreExamples,
    serializeCandidateModel,
    trainCandidateModel
};
