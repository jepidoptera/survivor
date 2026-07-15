const test = require("node:test");
const assert = require("node:assert/strict");
const {
    BUBBLE_COORDS,
    TERRAIN_TYPES,
    axialToModel
} = require("../scripts/terrain-bubble-ruleset");
const {
    buildSuggestion,
    generateDeterministicTerrainBubblePolygons,
    scoreExamples
} = require("../scripts/terrain-bubble-deterministic-solver");

function axialDistance(coord) {
    return Math.max(Math.abs(coord.q), Math.abs(coord.r), Math.abs(-coord.q - coord.r));
}

function makeInput(typeForCoord) {
    return {
        schema: "terrain-bubble-19-v1",
        innerKeys: BUBBLE_COORDS.filter((coord) => axialDistance(coord) <= 1).map((coord) => `${coord.q},${coord.r}`),
        tiles: BUBBLE_COORDS.map((coord) => ({
            q: coord.q,
            r: coord.r,
            type: typeForCoord(coord)
        }))
    };
}

function pointKey(point) {
    return `${point.x},${point.y}`;
}

function assertFinitePolygons(polygons) {
    assert.ok(Array.isArray(polygons));
    for (const polygon of polygons) {
        assert.ok(TERRAIN_TYPES.includes(polygon.type), `unexpected terrain ${polygon.type}`);
        assert.ok(Array.isArray(polygon.points) && polygon.points.length >= 3);
        for (const point of polygon.points) {
            assert.ok(Number.isFinite(point.x));
            assert.ok(Number.isFinite(point.y));
        }
    }
}

test("deterministic solver builds finite clipped polygons", () => {
    const input = makeInput((coord) => axialDistance(coord) <= 1 ? "water" : "desert");
    const polygons = generateDeterministicTerrainBubblePolygons(input);
    assertFinitePolygons(polygons);
    assert.equal(new Set(polygons.map((polygon) => polygon.type)).size, 1);
    assert.equal(polygons[0].type, "water");
});

test("deterministic solver moves a low-priority island inward from higher terrain", () => {
    const input = makeInput((coord) => coord.q === 0 && coord.r === 0 ? "water" : "desert");
    const polygons = generateDeterministicTerrainBubblePolygons(input);
    const water = polygons.find((polygon) => polygon.type === "water");
    assert.ok(water, "expected water polygon");

    const center = axialToModel({ q: 0, r: 0 });
    const corner = { x: 0.866025, y: 0.5 };
    const expectedMidpoint = {
        x: Math.round(((center.x + corner.x) / 2) * 1000000) / 1000000,
        y: Math.round(((center.y + corner.y) / 2) * 1000000) / 1000000
    };
    assert.ok(water.points.map(pointKey).includes(pointKey(expectedMidpoint)));
    assert.ok(!water.points.map(pointKey).includes(pointKey(corner)));
});

test("deterministic two-run keeps side vertices without same-terrain and higher-priority neighbors", () => {
    const lowTiles = new Set(["0,0", "1,0"]);
    const input = makeInput((coord) => lowTiles.has(`${coord.q},${coord.r}`) ? "water" : "desert");
    const polygons = generateDeterministicTerrainBubblePolygons(input);
    const water = polygons.find((polygon) => polygon.type === "water");
    assert.ok(water, "expected water polygon");

    const keys = water.points.map(pointKey);
    assert.ok(keys.includes("0,-0.5"));
    assert.ok(keys.includes("1.732051,-0.5"));
    assert.ok(keys.includes("-0.433012,-0.25"));
    assert.ok(keys.includes("2.165064,-0.25"));
    assert.ok(keys.includes("2.165064,0.25"));
    assert.ok(keys.includes("-0.433012,0.25"));
});

test("deterministic two-run keeps adjacent same-terrain higher-priority vertices", () => {
    const lowTiles = new Set(["0,0", "1,-1", "-1,0"]);
    const input = makeInput((coord) => lowTiles.has(`${coord.q},${coord.r}`) ? "water" : "desert");
    const polygons = generateDeterministicTerrainBubblePolygons(input);
    const water = polygons.find((polygon) => polygon.type === "water");
    assert.ok(water, "expected water polygon");

    const keys = water.points.map(pointKey);
    assert.ok(keys.includes("0.866025,-0.5"));
    assert.ok(keys.includes("-0.866025,0.5"));
});

test("deterministic inserts a shared midpoint for adjacent same-terrain higher-priority vertices", () => {
    const layout = new Map([
        ["0,0", "grass"],
        ["0,-1", "mud"],
        ["1,-1", "grass"],
        ["-1,0", "mud"],
        ["1,0", "desert"],
        ["-1,1", "grass"],
        ["0,1", "desert"],
        ["0,-2", "mud"],
        ["1,-2", "mud"],
        ["2,-2", "grass"],
        ["-1,-1", "mud"],
        ["2,-1", "water"],
        ["-2,0", "mud"],
        ["2,0", "desert"],
        ["-2,1", "grass"],
        ["1,1", "desert"],
        ["-2,2", "grass"],
        ["-1,2", "grass"],
        ["0,2", "mud"]
    ]);
    const input = makeInput((coord) => layout.get(`${coord.q},${coord.r}`) || "desert");
    const polygons = generateDeterministicTerrainBubblePolygons(input);
    const insertedPoint = "-0.125,1.5";

    for (const type of ["grass", "desert"]) {
        const polygon = polygons.find((candidate) => candidate.type === type);
        assert.ok(polygon, `expected ${type} polygon`);
        assert.ok(polygon.points.map(pointKey).includes(insertedPoint), `expected ${type} to include ${insertedPoint}`);
    }
});

test("deterministic three-run keeps center vertex when two other polygons share it", () => {
    const layout = new Map([
        ["0,0", "grass"],
        ["1,0", "mud"],
        ["1,-1", "water"],
        ["0,-1", "water"],
        ["-1,0", "water"],
        ["-1,1", "water"],
        ["0,1", "water"]
    ]);
    const input = makeInput((coord) => layout.get(`${coord.q},${coord.r}`) || "desert");
    const polygons = generateDeterministicTerrainBubblePolygons(input);
    const sharedMovedCenter = "0.866025,1";

    for (const type of ["water", "mud", "grass"]) {
        const polygon = polygons.find((candidate) => candidate.type === type);
        assert.ok(polygon, `expected ${type} polygon`);
        assert.ok(polygon.points.map(pointKey).includes(sharedMovedCenter), `expected ${type} to keep ${sharedMovedCenter}`);
    }
});

test("deterministic suggestion and scoring use deterministic metadata", () => {
    const input = makeInput((coord) => coord.q >= 0 ? "desert" : "water");
    const suggestion = buildSuggestion(input);
    assert.equal(suggestion.editor.generatedBy, "terrain-bubble-deterministic-solver-v1");
    assert.equal(suggestion.editor.deterministicSolver.priorityOrder.join(","), "water,mud,grass,mowedgrass,desert");
    assertFinitePolygons(suggestion.output.polygons);

    const report = scoreExamples([suggestion]);
    assert.equal(report.solver, "deterministic");
    assert.equal(report.scoredExampleCount, 1);
    assert.equal(report.rows[0].totalDiffArea, 0);
});
