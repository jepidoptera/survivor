const fs = require("fs");
const path = require("path");
const {
    clipTerrainPolygonsToInnerSeven,
    compareTerrainBubblePolygons,
    generateTerrainBubblePolygons
} = require("./terrain-bubble-ruleset");

const examplesPath = path.join(__dirname, "..", "public", "assets", "data", "terrain-bubble-examples.json");

function loadExamples() {
    const raw = fs.readFileSync(examplesPath, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.schema !== "terrain-bubble-examples-v1" || !Array.isArray(parsed.examples)) {
        throw new Error("terrain bubble examples file has invalid schema");
    }
    return parsed.examples;
}

function loadEditedExamples() {
    return loadExamples().filter((example) => example.editor && example.editor.edited);
}

function evaluateExample(example, options = {}) {
    const actual = generateTerrainBubblePolygons(example.input, options);
    const expected = clipTerrainPolygonsToInnerSeven(example.output.polygons);
    const comparison = compareTerrainBubblePolygons(actual, expected);
    return {
        id: example.id,
        name: example.name,
        edited: !!(example.editor && example.editor.edited),
        actualPolygonCount: actual.length,
        expectedPolygonCount: expected.length,
        actualVertexCount: actual.reduce((sum, polygon) => sum + polygon.points.length, 0),
        expectedVertexCount: expected.reduce((sum, polygon) => sum + polygon.points.length, 0),
        ...comparison
    };
}

function summarizeResults(results) {
    const totalDiffArea = results.reduce((sum, result) => sum + result.totalDiffArea, 0);
    const exactMatches = results.filter((result) => result.totalDiffArea <= 0.000001).length;
    return {
        exactMatches,
        totalDiffArea: Number(totalDiffArea.toFixed(6))
    };
}

function runSuite(examples, suite) {
    const results = examples.map((example) => evaluateExample(example, suite.options));
    return {
        ...suite,
        ...summarizeResults(results),
        results
    };
}

function main() {
    const examples = loadEditedExamples();
    const tripleCandidates = [
        "desert/grass/mud",
        "desert/grass/water",
        "desert/mud/water",
        "grass/mud/water"
    ];
    const tripleSuites = [];
    for (let mask = 1; mask < (1 << tripleCandidates.length); mask++) {
        const triples = tripleCandidates.filter((_, index) => mask & (1 << index));
        tripleSuites.push(runSuite(examples, {
            name: `experimental-three-way:${triples.join("+")}`,
            options: {
                useThreeTerrainJunctionRule: true,
                threeTerrainJunctionTriples: triples
            }
        }));
    }
    const suites = [
        runSuite(examples, { name: "baseline-hex-union", options: {} }),
        runSuite(examples, {
            name: "experimental-three-way:all-triples",
            options: { useThreeTerrainJunctionRule: true }
        }),
        ...tripleSuites.sort((a, b) => a.totalDiffArea - b.totalDiffArea)
    ];
    const primary = suites[0];

    console.log(`terrain bubble ruleset evaluation`);
    console.log(`edited examples: ${primary.results.length}`);
    for (const suite of suites) {
        console.log(`${suite.name}: exact area matches ${suite.exactMatches}/${suite.results.length}, total diff area ${suite.totalDiffArea.toFixed(6)}`);
    }
    console.log("");

    for (const result of primary.results) {
        const rowSummary = result.rows
            .filter((row) => row.diffArea > 0.000001)
            .map((row) => `${row.type}:${row.diffArea}`)
            .join(" ");
        console.log(`${result.id}: diff=${result.totalDiffArea} polygons ${result.actualPolygonCount}/${result.expectedPolygonCount} vertices ${result.actualVertexCount}/${result.expectedVertexCount}${rowSummary ? ` ${rowSummary}` : ""}`);
    }

    const reportPath = path.join(__dirname, "..", "docs", "terrain-bubble-ruleset-report.json");
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify({
        schema: "terrain-bubble-ruleset-report-v1",
        examplesPath: path.relative(path.join(__dirname, ".."), examplesPath),
        generatedAt: new Date().toISOString(),
        primarySuite: primary.name,
        suites: suites.map((suite) => ({
            name: suite.name,
            exactMatches: suite.exactMatches,
            totalExamples: suite.results.length,
            totalDiffArea: suite.totalDiffArea,
            results: suite.results
        }))
    }, null, 2)}\n`, "utf8");
    console.log("");
    console.log(`wrote ${reportPath}`);
}

if (require.main === module) main();

module.exports = {
    evaluateExample,
    loadEditedExamples,
    loadExamples
};
