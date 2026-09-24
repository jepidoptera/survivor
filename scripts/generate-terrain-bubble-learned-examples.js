const fs = require("fs");
const path = require("path");
const {
    buildLearnedExample,
    randomBubbleInput,
    seededRng,
    trainTerrainBubbleLearner
} = require("./terrain-bubble-learner");
const {
    BUBBLE_COORDS,
    DIRECTIONS,
    INNER_COORDS,
    TERRAIN_TYPES,
    axialToModel,
    coordKey,
    compareTerrainBubblePolygons,
    generateTerrainBubblePolygons
} = require("./terrain-bubble-ruleset");

const TOPOLOGY_EPSILON = 0.00001;

const repoRoot = path.join(__dirname, "..");
const examplesPath = path.join(repoRoot, "public", "assets", "data", "terrain-bubble-examples.json");
const modelPath = path.join(repoRoot, "docs", "terrain-bubble-learned-model.json");
const reportPath = path.join(repoRoot, "docs", "terrain-bubble-learned-report.json");

function parseArgs(argv) {
    const args = {
        count: 20,
        seed: "terrain-bubble-learned-1",
        scenario: "random",
        writeLibrary: false,
        prefix: "learned-suggestion"
    };
    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--write-library") {
            args.writeLibrary = true;
        } else if (arg === "--count") {
            args.count = Number(argv[++i]);
        } else if (arg.startsWith("--count=")) {
            args.count = Number(arg.slice("--count=".length));
        } else if (arg === "--seed") {
            args.seed = argv[++i];
        } else if (arg.startsWith("--seed=")) {
            args.seed = arg.slice("--seed=".length);
        } else if (arg === "--prefix") {
            args.prefix = argv[++i];
        } else if (arg.startsWith("--prefix=")) {
            args.prefix = arg.slice("--prefix=".length);
        } else if (arg === "--scenario") {
            args.scenario = argv[++i];
        } else if (arg.startsWith("--scenario=")) {
            args.scenario = arg.slice("--scenario=".length);
        } else {
            throw new Error(`unknown argument ${arg}`);
        }
    }
    if (!Number.isInteger(args.count) || args.count < 1 || args.count > 200) {
        throw new Error("--count must be an integer from 1 to 200");
    }
    if (!args.prefix || !/^[a-zA-Z0-9_.-]+$/.test(args.prefix)) {
        throw new Error("--prefix must be a simple id prefix");
    }
    if (!["random", "natural"].includes(args.scenario)) {
        throw new Error("--scenario must be random or natural");
    }
    return args;
}

function readLibrary() {
    const parsed = JSON.parse(fs.readFileSync(examplesPath, "utf8"));
    if (!parsed || parsed.schema !== "terrain-bubble-examples-v1" || !Array.isArray(parsed.examples)) {
        throw new Error("terrain bubble examples file has invalid schema");
    }
    return parsed;
}

function existingEditedExamples(library) {
    return library.examples.filter((example) => example.editor && example.editor.edited);
}

function splitTrainableExamples(examples) {
    const trainable = [];
    const excluded = [];
    for (const example of examples) {
        try {
            trainTerrainBubbleLearner([example]);
            trainable.push(example);
        } catch (error) {
            excluded.push({
                id: example.id,
                name: example.name,
                reason: error.message
            });
        }
    }
    return { trainable, excluded };
}

function nextSuggestionId(prefix, existingIds, indexHint) {
    let index = indexHint;
    while (existingIds.has(`${prefix}-${String(index).padStart(2, "0")}`)) index++;
    return {
        id: `${prefix}-${String(index).padStart(2, "0")}`,
        nextIndex: index + 1
    };
}

function terrainPair(rng) {
    const first = TERRAIN_TYPES[Math.floor(rng() * TERRAIN_TYPES.length)];
    let second = first;
    while (second === first) second = TERRAIN_TYPES[Math.floor(rng() * TERRAIN_TYPES.length)];
    return [first, second];
}

function terrainTriple(rng) {
    const terrains = [];
    while (terrains.length < 3) {
        const terrain = TERRAIN_TYPES[Math.floor(rng() * TERRAIN_TYPES.length)];
        if (!terrains.includes(terrain)) terrains.push(terrain);
    }
    return terrains;
}

function randomDirection(rng) {
    return DIRECTIONS[Math.floor(rng() * DIRECTIONS.length)];
}

function dotCoord(coord, direction) {
    return coord.q * direction.q + coord.r * direction.r;
}

function makeInputFromTileMap(tileMap) {
    return {
        schema: "terrain-bubble-19-v1",
        innerKeys: [
            "0,0",
            "1,0",
            "1,-1",
            "0,-1",
            "-1,0",
            "-1,1",
            "0,1"
        ],
        tiles: BUBBLE_COORDS.map((coord) => ({
            q: coord.q,
            r: coord.r,
            type: tileMap.get(coordKey(coord))
        }))
    };
}

function pointDistance(a, b) {
    return Math.hypot(Number(a.x) - Number(b.x), Number(a.y) - Number(b.y));
}

function roundNumber(value) {
    return Math.round(Number(value) * 1000000) / 1000000;
}

function pointKey(point) {
    return `${roundNumber(point.x)},${roundNumber(point.y)}`;
}

function nearestPointOnSegment(point, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq <= TOPOLOGY_EPSILON * TOPOLOGY_EPSILON) return { x: a.x, y: a.y };
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq));
    return {
        x: a.x + dx * t,
        y: a.y + dy * t
    };
}

function pointOnSegment(point, a, b, epsilon = TOPOLOGY_EPSILON) {
    return pointDistance(point, nearestPointOnSegment(point, a, b)) <= epsilon;
}

function pointIsSegmentEndpoint(point, a, b, epsilon = TOPOLOGY_EPSILON) {
    return pointDistance(point, a) <= epsilon || pointDistance(point, b) <= epsilon;
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

function pointTouchesPolygonBoundary(point, polygonPoints, epsilon = TOPOLOGY_EPSILON) {
    for (let i = 0; i < polygonPoints.length; i++) {
        const a = polygonPoints[i];
        const b = polygonPoints[(i + 1) % polygonPoints.length];
        if (pointDistance(point, nearestPointOnSegment(point, a, b)) <= epsilon) return true;
    }
    return false;
}

function pointInsideOrTouchingPolygon(point, polygonPoints) {
    return pointInPolygon(point, polygonPoints) || pointTouchesPolygonBoundary(point, polygonPoints);
}

function pointInsideOrTouchingTerrainPolygon(point, polygon) {
    if (!pointInsideOrTouchingPolygon(point, polygon.points || [])) return false;
    for (const hole of polygon.holes || []) {
        if (pointInPolygon(point, hole) && !pointTouchesPolygonBoundary(point, hole)) return false;
    }
    return true;
}

function pointInsideTerrainPolygonInterior(point, polygon) {
    if (!pointInPolygon(point, polygon.points || [])) return false;
    if (pointTouchesPolygonBoundary(point, polygon.points || [])) return false;
    for (const hole of polygon.holes || []) {
        if (pointInPolygon(point, hole) || pointTouchesPolygonBoundary(point, hole)) return false;
    }
    return true;
}

function polygonHasVertexAt(polygon, point) {
    return (polygon.points || []).some((candidate) => pointDistance(candidate, point) <= TOPOLOGY_EPSILON);
}

function validateGeneratedExample(example) {
    const problems = [];
    const tiles = new Map((example.input.tiles || []).map((tile) => [coordKey(tile), tile.type]));
    const innerTypes = new Set(INNER_COORDS.map((coord) => tiles.get(coordKey(coord))));
    const outputTypes = new Set((example.output.polygons || []).map((polygon) => polygon.type));

    for (const type of innerTypes) {
        if (!outputTypes.has(type)) problems.push(`${type} polygon missing from output`);
    }
    for (const type of outputTypes) {
        if (!innerTypes.has(type)) problems.push(`${type} polygon exists but no inner tile has that terrain`);
    }

    for (const polygon of example.output.polygons || []) {
        if (!TERRAIN_TYPES.includes(polygon.type)) {
            problems.push(`invalid output terrain ${polygon.type}`);
            continue;
        }
        if (!Array.isArray(polygon.points) || polygon.points.length < 3) {
            problems.push(`${polygon.type} polygon has fewer than 3 points`);
        }
        for (const hole of polygon.holes || []) {
            if (!Array.isArray(hole) || hole.length < 3) {
                problems.push(`${polygon.type} polygon has invalid hole`);
            }
        }
    }

    for (const coord of INNER_COORDS) {
        const key = coordKey(coord);
        const type = tiles.get(key);
        const center = axialToModel(coord);
        const matchingPolygons = (example.output.polygons || []).filter((polygon) => polygon.type === type);
        if (!matchingPolygons.some((polygon) => pointInsideOrTouchingTerrainPolygon(center, polygon))) {
            problems.push(`${type} polygon does not contain or touch center of tile ${key}`);
        }
        for (const polygon of example.output.polygons || []) {
            if (polygon.type === type) continue;
            if (pointInsideTerrainPolygonInterior(center, polygon)) {
                problems.push(`${polygon.type} polygon contains center of ${type} tile ${key}`);
            }
        }
    }

    const unsharedVertexProblems = new Set();
    const polygons = example.output.polygons || [];
    for (const polygon of polygons) {
        for (const point of polygon.points || []) {
            for (const otherPolygon of polygons) {
                if (otherPolygon === polygon) continue;
                const otherPoints = otherPolygon.points || [];
                const rings = [otherPoints].concat(otherPolygon.holes || []);
                for (const ring of rings) {
                    for (let i = 0; i < ring.length; i++) {
                        const a = ring[i];
                        const b = ring[(i + 1) % ring.length];
                        if (!pointOnSegment(point, a, b)) continue;
                        if (pointIsSegmentEndpoint(point, a, b)) continue;
                        const ringHasVertex = ring.some((candidate) => pointDistance(candidate, point) <= TOPOLOGY_EPSILON);
                        if (ringHasVertex) continue;
                        unsharedVertexProblems.add(`unshared vertex on ${polygon.type}/${otherPolygon.type} boundary at ${pointKey(point)}`);
                    }
                }
            }
        }
    }
    for (const problem of unsharedVertexProblems) problems.push(problem);

    return problems;
}

function naturalBubbleInput(rng, index) {
    const variant = index % 8;
    const tileMap = new Map();

    if (variant === 0 || variant === 1) {
        const [lowSide, highSide] = terrainPair(rng);
        const direction = randomDirection(rng);
        const threshold = variant === 0 ? 0 : 1;
        for (const coord of BUBBLE_COORDS) {
            tileMap.set(coordKey(coord), dotCoord(coord, direction) >= threshold ? highSide : lowSide);
        }
        return makeInputFromTileMap(tileMap);
    }

    if (variant === 2 || variant === 3) {
        const [background, island] = terrainPair(rng);
        for (const coord of BUBBLE_COORDS) tileMap.set(coordKey(coord), background);
        tileMap.set("0,0", island);
        if (variant === 3) {
            const direction = randomDirection(rng);
            tileMap.set(coordKey(direction), island);
        }
        return makeInputFromTileMap(tileMap);
    }

    if (variant === 4 || variant === 5) {
        const [background, band] = terrainPair(rng);
        const direction = randomDirection(rng);
        for (const coord of BUBBLE_COORDS) {
            tileMap.set(coordKey(coord), Math.abs(dotCoord(coord, direction)) <= (variant === 4 ? 0 : 1) ? band : background);
        }
        return makeInputFromTileMap(tileMap);
    }

    const [a, b, c] = terrainTriple(rng);
    const primary = randomDirection(rng);
    const secondary = DIRECTIONS[(DIRECTIONS.indexOf(primary) + 2) % DIRECTIONS.length];
    for (const coord of BUBBLE_COORDS) {
        const first = dotCoord(coord, primary);
        const second = dotCoord(coord, secondary);
        const type = first >= 1 ? a : second >= 1 ? b : c;
        tileMap.set(coordKey(coord), type);
    }
    return makeInputFromTileMap(tileMap);
}

function buildSuggestions(model, args, existingIds = new Set()) {
    const rng = seededRng(args.seed);
    const suggestions = [];
    const rejected = [];
    let idIndex = 1;
    let attempts = 0;
    const maxAttempts = args.count * 50;
    while (suggestions.length < args.count && attempts < maxAttempts) {
        attempts++;
        const suggestionNumber = suggestions.length + 1;
        const input = args.scenario === "natural"
            ? naturalBubbleInput(rng, attempts - 1)
            : randomBubbleInput(rng);
        const idInfo = nextSuggestionId(args.prefix, existingIds, idIndex);
        idIndex = idInfo.nextIndex;
        const example = buildLearnedExample(input, model, {
            id: idInfo.id,
            name: `${args.scenario === "natural" ? "natural" : "learned"} suggestion ${String(suggestionNumber).padStart(2, "0")}`,
            createdAt: "2026-07-06T00:00:00.000Z"
        });
        const problems = validateGeneratedExample(example);
        if (problems.length > 0) {
            rejected.push({
                attemptedId: idInfo.id,
                attempt: attempts,
                problems: problems.slice(0, 6)
            });
            continue;
        }
        existingIds.add(idInfo.id);
        suggestions.push(example);
    }
    if (suggestions.length < args.count) {
        throw new Error(`only generated ${suggestions.length}/${args.count} valid suggestions after ${attempts} attempts`);
    }
    return { suggestions, rejected };
}

function summarizeSuggestion(example) {
    const baseline = generateTerrainBubblePolygons(example.input);
    const comparison = compareTerrainBubblePolygons(baseline, example.output.polygons);
    const movedAnchors = (example.editor.requiredAnchors || [])
        .filter((anchor) => anchor.source.x !== anchor.point.x || anchor.source.y !== anchor.point.y)
        .length;
    return {
        id: example.id,
        polygonCount: example.output.polygons.length,
        vertexCount: example.editor.totalVertices,
        movedAnchors,
        baselineDiffArea: comparison.totalDiffArea
    };
}

function main() {
    const args = parseArgs(process.argv);
    const library = readLibrary();
    const editedExamples = existingEditedExamples(library);
    const trainingSplit = splitTrainableExamples(editedExamples);
    const trainingExamples = trainingSplit.trainable;
    if (trainingExamples.length === 0) {
        throw new Error("no edited terrain bubble examples available for training");
    }

    const model = trainTerrainBubbleLearner(trainingExamples);
    const keptForWrite = library.examples.filter((example) => {
        const id = String(example.id || "");
        const edited = !!(example.editor && example.editor.edited);
        return edited || !id.startsWith(`${args.prefix}-`);
    });
    const existingIds = new Set(keptForWrite.map((example) => example.id));
    const { suggestions, rejected } = buildSuggestions(model, args, existingIds);
    const report = {
        schema: "terrain-bubble-learned-report-v1",
        generatedAt: new Date().toISOString(),
        examplesPath: path.relative(repoRoot, examplesPath),
        trainingExampleCount: trainingExamples.length,
        anchorRecordCount: model.anchorRecordCount,
        vertexRecordCount: model.vertexRecordCount || 0,
        pathRecordCount: model.pathRecordCount || 0,
        modelPath: path.relative(repoRoot, modelPath),
        scenario: args.scenario,
        editedExampleCount: editedExamples.length,
        excludedTrainingExampleCount: trainingSplit.excluded.length,
        excludedTrainingExamples: trainingSplit.excluded,
        suggestionCount: suggestions.length,
        rejectedSuggestionCount: rejected.length,
        rejectedSuggestions: rejected.slice(0, 100),
        suggestions: suggestions.map(summarizeSuggestion)
    };

    fs.mkdirSync(path.dirname(modelPath), { recursive: true });
    fs.writeFileSync(modelPath, `${JSON.stringify(model, null, 2)}\n`, "utf8");
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

    if (args.writeLibrary) {
        const nextLibrary = {
            ...library,
            examples: keptForWrite.concat(suggestions)
        };
        fs.writeFileSync(examplesPath, `${JSON.stringify(nextLibrary, null, 2)}\n`, "utf8");
    }

    console.log(`trained anchor learner on ${trainingExamples.length}/${editedExamples.length} edited examples`);
    console.log(`excluded training examples: ${trainingSplit.excluded.length}`);
    console.log(`anchor records: ${model.anchorRecordCount}`);
    console.log(`vertex records: ${model.vertexRecordCount || 0}`);
    console.log(`path records: ${model.pathRecordCount || 0}`);
    console.log(`scenario: ${args.scenario}`);
    console.log(`generated suggestions: ${suggestions.length}`);
    console.log(`rejected invalid suggestions: ${rejected.length}`);
    console.log(`wrote ${modelPath}`);
    console.log(`wrote ${reportPath}`);
    if (args.writeLibrary) console.log(`updated ${examplesPath}`);
    else console.log("library unchanged; pass --write-library to add suggestions to the lab");
}

if (require.main === module) main();
