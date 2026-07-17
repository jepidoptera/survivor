const test = require("node:test");
const assert = require("node:assert/strict");
const {
    BUBBLE_COORDS,
    TERRAIN_TYPES
} = require("../scripts/terrain-bubble-ruleset");
const {
    buildSuggestion,
    generateIsoContourPolygons,
    trainIsoContourModel,
    validateIsoContourPolygons
} = require("../scripts/terrain-bubble-iso-contour-solver");

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

test("iso-contour suggestion builds finite polygons for a uniform seven-hex blob", () => {
    const input = makeInput((coord) => axialDistance(coord) <= 1 ? "water" : "mud");
    const suggestion = buildSuggestion(input);
    assert.equal(suggestion.editor.generatedBy, "terrain-bubble-iso-contour-solver-v1");
    assert.equal(suggestion.editor.isoContour.trainedExampleCount, 0);
    assertFinitePolygons(suggestion.output.polygons);
    validateIsoContourPolygons(input, suggestion.output.polygons);
    assert.ok(suggestion.output.polygons.some((polygon) => polygon.type === "water"));
});

test("iso-contour suggestion keeps an isolated tile terrain touching a tile edge", () => {
    const input = makeInput((coord) => coord.q === 0 && coord.r === 0 ? "water" : "mud");
    const suggestion = buildSuggestion(input);
    assertFinitePolygons(suggestion.output.polygons);
    validateIsoContourPolygons(input, suggestion.output.polygons);
    assert.ok(suggestion.output.polygons.some((polygon) => polygon.type === "water"));
});

test("iso-contour priority bias cannot create absent local terrain", () => {
    const input = makeInput((coord) => axialDistance(coord) <= 1 ? "water" : "mud");
    const polygons = generateIsoContourPolygons(input, {
        priorityBiasStep: 0.3,
        quantizationSteps: 0
    });
    assertFinitePolygons(polygons);
    validateIsoContourPolygons(input, polygons);
    assert.deepEqual([...new Set(polygons.map((polygon) => polygon.type))].sort(), ["water"]);
});

test("iso-contour priority shrink is constant across lower-priority terrain ranks", () => {
    function makeSplitInput(lowTerrain) {
        return makeInput((coord) => coord.q >= 0 ? "desert" : lowTerrain);
    }
    function desertFootprintAgainst(lowTerrain) {
        return generateIsoContourPolygons(makeSplitInput(lowTerrain), {
            priorityBiasStep: 0.12,
            quantizationSteps: 0
        })
            .filter((polygon) => polygon.type === "desert")
            .map((polygon) => polygon.points);
    }

    assert.deepEqual(desertFootprintAgainst("grass"), desertFootprintAgainst("water"));
});

test("iso-contour keeps a symmetric center island symmetric at the stale artifact bias", () => {
    const input = makeInput((coord) => coord.q === 0 && coord.r === 0 ? "desert" : "grass");
    const polygons = generateIsoContourPolygons(input, {
        priorityBiasStep: 0.105,
        quantizationSteps: 0
    });
    const desert = polygons.find((polygon) => polygon.type === "desert");
    assert.ok(desert, "expected desert island polygon");
    const points = desert.points.map((point) => `${point.x},${point.y}`);
    assert.ok(points.includes("-0.866025,-0.5"));
    assert.ok(points.includes("-0.866025,0.5"));
    assert.ok(points.includes("0.866025,-0.5"));
    assert.ok(points.includes("0.866025,0.5"));
});

test("iso-contour training chooses a finite priority bias candidate", () => {
    const input = makeInput((coord) => axialDistance(coord) <= 1 ? "water" : "mud");
    const baseline = buildSuggestion(input);
    const edited = {
        ...baseline,
        editor: {
            ...(baseline.editor || {}),
            edited: true
        }
    };
    const model = trainIsoContourModel([edited], {
        priorityBiasStepCandidates: [0, 0.1]
    });
    assert.equal(model.schema, "terrain-bubble-iso-contour-model-v1");
    assert.equal(model.trainedExampleCount, 1);
    assert.ok([0, 0.1].includes(model.priorityBiasStep));
    assert.ok(Number.isFinite(model.trainingError));
});

test("iso-contour validator rejects off-grid vertices", () => {
    const input = makeInput(() => "water");
    const suggestion = buildSuggestion(input);
    const polygons = suggestion.output.polygons.map((polygon, index) => index === 0
        ? {
            ...polygon,
            points: polygon.points.map((point, pointIndex) => pointIndex === 0
                ? { x: point.x + 0.1, y: point.y }
                : point)
        }
        : polygon);
    assert.throws(
        () => validateIsoContourPolygons(input, polygons),
        /off the half-side triangle grid/
    );
});

test("iso-contour validator rejects overlapping terrain regions", () => {
    const input = makeInput((coord) => coord.q === 0 && coord.r === 0 ? "water" : "mud");
    const suggestion = buildSuggestion(input);
    const duplicate = {
        ...suggestion.output.polygons[0],
        type: suggestion.output.polygons[0].type === "water" ? "mud" : "water"
    };
    assert.throws(
        () => validateIsoContourPolygons(input, suggestion.output.polygons.concat([duplicate])),
        /overlapping terrain area/
    );
});
