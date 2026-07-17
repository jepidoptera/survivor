const fs = require("fs");
const path = require("path");
const {
    buildTrainingCalculator,
    calculateVerticesForExample
} = require("./calculate-terrain-bubble-vertices");
const {
    clipTerrainPolygonsToInnerSeven,
    compareTerrainBubblePolygons
} = require("./terrain-bubble-ruleset");
const {
    serializeCandidateModel,
    trainCandidateModel: trainBinaryVertexModel
} = require("./terrain-bubble-binary-vertex-solver");
const {
    trainIsoContourModel
} = require("./terrain-bubble-iso-contour-solver");

const repoRoot = path.join(__dirname, "..");
const examplesPath = path.join(repoRoot, "public", "assets", "data", "terrain-bubble-examples.json");
const reportPath = path.join(repoRoot, "docs", "terrain-bubble-learning-errors.json");
const calculatorModelPath = path.join(repoRoot, "docs", "terrain-bubble-trained-calculator.json");
const binaryVertexModelPath = path.join(repoRoot, "docs", "terrain-bubble-trained-binary-vertex-model.json");
const isoContourModelPath = path.join(repoRoot, "docs", "terrain-bubble-trained-iso-contour-model.json");

function readLibrary() {
    const parsed = JSON.parse(fs.readFileSync(examplesPath, "utf8"));
    if (!parsed || parsed.schema !== "terrain-bubble-examples-v1" || !Array.isArray(parsed.examples)) {
        throw new Error("terrain bubble examples file has invalid schema");
    }
    return parsed;
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
        totalDiffArea: Math.round(totalDiffArea * 1000000) / 1000000
    };
}

function main() {
    const library = readLibrary();
    const editedExamples = library.examples.filter((example) => example.editor && example.editor.edited);
    if (editedExamples.length === 0) throw new Error("no edited examples for terrain bubble vertex calculator");

    const calculator = buildTrainingCalculator(editedExamples);
    const rows = [];

    for (const example of library.examples) {
        const editor = example.editor || {};
        try {
            const actual = calculateVerticesForExample(example, calculator);
            const expected = clipTerrainPolygonsToInnerSeven(example.output.polygons || []);
            const comparison = compareTerrainBubblePolygons(actual, expected);
            const learningError = {
                schema: "terrain-bubble-learning-error-v1",
                mode: "vertex-calculator",
                trainedExampleCount: calculator.trainedExampleCount,
                excludedExampleCount: calculator.excludedExamples.length,
                conflictCount: calculator.conflicts.length,
                totalDiffArea: comparison.totalDiffArea,
                rows: comparison.rows,
                scoredAt: new Date().toISOString()
            };
            example.editor = {
                ...editor,
                learningError
            };
            rows.push({
                id: example.id,
                name: example.name,
                edited: !!editor.edited,
                totalDiffArea: comparison.totalDiffArea,
                rows: comparison.rows
            });
        } catch (error) {
            example.editor = {
                ...editor,
                learningError: {
                    schema: "terrain-bubble-learning-error-v1",
                    mode: "vertex-calculator",
                    trainedExampleCount: calculator.trainedExampleCount,
                    excludedExampleCount: calculator.excludedExamples.length,
                    conflictCount: calculator.conflicts.length,
                    totalDiffArea: null,
                    error: error.message
                }
            };
            rows.push({
                id: example.id,
                name: example.name,
                edited: !!editor.edited,
                totalDiffArea: null,
                error: error.message
            });
        }
    }

    rows.sort((a, b) => {
        const aValue = Number.isFinite(a.totalDiffArea) ? a.totalDiffArea : -Infinity;
        const bValue = Number.isFinite(b.totalDiffArea) ? b.totalDiffArea : -Infinity;
        return bValue - aValue || String(a.id).localeCompare(String(b.id));
    });

    const ranked = new Map(rows.map((row, index) => [row.id, index + 1]));
    for (const example of library.examples) {
        if (example.editor && example.editor.learningError) {
            example.editor.learningError.rank = ranked.get(example.id) || null;
        }
    }

    const binaryVertexModel = trainBinaryVertexModel(editedExamples);
    const isoContourModel = trainIsoContourModel(editedExamples);
    const report = {
        schema: "terrain-bubble-learning-errors-v1",
        generatedAt: new Date().toISOString(),
        operation: "score-existing-examples",
        examplesPath: path.relative(repoRoot, examplesPath),
        editedExampleCount: editedExamples.length,
        scoredExampleCount: library.examples.length,
        trainingExampleCount: calculator.trainedExampleCount,
        trainableExampleCount: calculator.trainedExampleCount,
        calculator: {
            schema: calculator.schema,
            trainedExampleCount: calculator.trainedExampleCount,
            excludedExampleCount: calculator.excludedExamples.length,
            conflictCount: calculator.conflicts.length,
            excludedExamples: calculator.excludedExamples,
            conflicts: calculator.conflicts
        },
        isoContour: {
            schema: isoContourModel.schema,
            trainedExampleCount: isoContourModel.trainedExampleCount,
            priorityBiasStep: isoContourModel.priorityBiasStep,
            quantizationSteps: isoContourModel.quantizationSteps,
            trainingError: isoContourModel.trainingError
        },
        exampleCount: library.examples.length,
        errorSummary: summarizeRows(rows),
        rows
    };
    const generatedAt = new Date().toISOString();
    const calculatorArtifact = {
        schema: "terrain-bubble-trained-calculator-artifact-v1",
        generatedAt,
        examplesPath: path.relative(repoRoot, examplesPath),
        editedExampleCount: editedExamples.length,
        calculator: {
            ...calculator,
            examples: []
        }
    };
    const binaryVertexArtifact = {
        schema: "terrain-bubble-trained-binary-vertex-model-artifact-v1",
        generatedAt,
        examplesPath: path.relative(repoRoot, examplesPath),
        editedExampleCount: editedExamples.length,
        model: serializeCandidateModel(binaryVertexModel)
    };
    const isoContourArtifact = {
        schema: "terrain-bubble-trained-iso-contour-model-artifact-v1",
        generatedAt,
        examplesPath: path.relative(repoRoot, examplesPath),
        editedExampleCount: editedExamples.length,
        model: isoContourModel
    };

    fs.writeFileSync(examplesPath, `${JSON.stringify(library, null, 2)}\n`, "utf8");
    fs.mkdirSync(path.dirname(reportPath), { recursive: true });
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    fs.writeFileSync(calculatorModelPath, `${JSON.stringify(calculatorArtifact)}\n`, "utf8");
    fs.writeFileSync(binaryVertexModelPath, `${JSON.stringify(binaryVertexArtifact)}\n`, "utf8");
    fs.writeFileSync(isoContourModelPath, `${JSON.stringify(isoContourArtifact)}\n`, "utf8");

    console.log(`scored ${library.examples.length} examples`);
    console.log(`calculator trained on ${calculator.trainedExampleCount} unique edited inputs`);
    console.log(`highest error: ${rows[0] ? `${rows[0].id} ${rows[0].totalDiffArea}` : "none"}`);
    console.log(`wrote ${examplesPath}`);
    console.log(`wrote ${reportPath}`);
    console.log(`wrote ${calculatorModelPath}`);
    console.log(`wrote ${binaryVertexModelPath}`);
    console.log(`wrote ${isoContourModelPath}`);
}

if (require.main === module) main();
