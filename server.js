const express = require('express');
const bodyParser = require('body-parser');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const {
    buildCalculatedExample,
    buildTrainingCalculator,
    calculateVerticesForExample
} = require('./scripts/calculate-terrain-bubble-vertices');
const {
    clipTerrainPolygonsToInnerSeven,
    compareTerrainBubblePolygons
} = require('./scripts/terrain-bubble-ruleset');
const {
    buildSuggestion: buildBinaryVertexSuggestion,
    deserializeCandidateModel: deserializeBinaryVertexModel,
    trainCandidateModel: trainBinaryVertexModel
} = require('./scripts/terrain-bubble-binary-vertex-solver');
const {
    DEFAULT_MODEL: defaultIsoContourModel,
    buildSuggestion: buildIsoContourSuggestion,
    normalizeModel: normalizeIsoContourModel
} = require('./scripts/terrain-bubble-iso-contour-solver');
const {
    annotateExamplesWithScore: annotateTerrainBubbleExamplesWithDeterministicScore,
    buildSuggestion: buildDeterministicTerrainBubbleSuggestion
} = require('./scripts/terrain-bubble-deterministic-solver');
const app = express();

// require ('firebase/database')
require('dotenv').config();

const port = process.env.PORT || 8080;
// const apiKey = process.env.APIKEY || "no_api_key";
const authtokens = {};
const players = [];
// Large world saves can exceed Express defaults, so keep generous parser limits.
const defaultJsonBodyLimit = '100mb';
const sectionWorldJsonBodyLimit = '200mb';

// Serve static files
app.use('/vendor', express.static(path.join(__dirname, 'node_modules')));
app.get('/terrain-bubble-lab', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(__dirname, 'public', 'terrain-bubble-lab', 'index.html'));
})
app.get('/terrain-bubble-lab/:asset', (req, res, next) => {
    const asset = String(req.params.asset || '');
    if (!['index.html', 'main.js', 'styles.css'].includes(asset)) return next();
    res.set('Cache-Control', 'no-store');
    res.sendFile(path.join(__dirname, 'public', 'terrain-bubble-lab', asset));
})
app.get('/assets/javascript/terrain-bubble-deterministic-solver-runtime.js', (req, res) => {
    const modulePaths = {
        'terrain-bubble-ruleset': path.join(__dirname, 'scripts', 'terrain-bubble-ruleset.js'),
        'terrain-bubble-deterministic-solver': path.join(__dirname, 'scripts', 'terrain-bubble-deterministic-solver.js')
    };
    let moduleSources;
    try {
        moduleSources = {
            'terrain-bubble-ruleset': fs.readFileSync(modulePaths['terrain-bubble-ruleset'], 'utf8'),
            'terrain-bubble-deterministic-solver': fs.readFileSync(modulePaths['terrain-bubble-deterministic-solver'], 'utf8')
        };
    } catch (error) {
        return res.status(500).type('text/plain').send(`failed to load deterministic terrain solver: ${error.message}`);
    }
    res.set('Cache-Control', 'no-store');
    res.type('application/javascript').send(`(function(root) {
"use strict";
const moduleSources = ${JSON.stringify(moduleSources)};
const moduleCache = Object.create(null);
function loadModule(id) {
    if (moduleCache[id]) return moduleCache[id].exports;
    const source = moduleSources[id];
    if (typeof source !== "string") throw new Error("unknown terrain bubble module: " + id);
    const module = { exports: {} };
    moduleCache[id] = module;
    const localRequire = function(specifier) {
        if (specifier === "polygon-clipping") {
            if (!root.polygonClipping) throw new Error("terrain bubble deterministic runtime requires polygon-clipping");
            return root.polygonClipping;
        }
        if (specifier === "./terrain-bubble-ruleset") return loadModule("terrain-bubble-ruleset");
        throw new Error("unsupported terrain bubble module dependency: " + specifier);
    };
    const execute = new Function("require", "module", "exports", source + "\\n//# sourceURL=" + id + ".js");
    execute(localRequire, module, module.exports);
    return module.exports;
}
root.TerrainBubbleDeterministicSolver = loadModule("terrain-bubble-deterministic-solver");
})(typeof globalThis !== "undefined" ? globalThis : window);
`);
})
app.use(express.static(__dirname + '/public'));
app.use('/api/sectionworld', bodyParser.json({ limit: sectionWorldJsonBodyLimit }));
app.use(bodyParser.urlencoded({ extended: false, limit: defaultJsonBodyLimit }));
app.use(bodyParser.json({ limit: defaultJsonBodyLimit }));
app.set('view engine', 'ejs');

app.get('/', (req, res) => {
    res.render('sectionworld')
})

app.get('/hunt', (req, res) => {
    res.render('hunt')
})

app.get('/sectiontesting', (req, res) => {
    res.render('sectiontesting')
})

app.get('/sectionworld', (req, res) => {
    res.render('sectionworld')
})

app.get('/twosectionprototype', (req, res) => {
    res.render('sectionworld')
})

app.get('/api/assets/images/:folder', (req, res) => {
    const folder = String(req.params.folder || '');
    const allowedFolders = new Set(['flooring', 'roofs', 'walls']);
    if (!allowedFolders.has(folder)) {
        return res.status(400).json({ ok: false, reason: 'invalid-folder' });
    }
    const dir = path.join(__dirname, 'public', 'assets', 'images', folder);
    fs.readdir(dir, { withFileTypes: true }, (error, entries) => {
        if (error) {
            return res.status(500).json({ ok: false, reason: 'read-failed' });
        }
        const files = entries
            .filter((entry) => entry.isFile())
            .map((entry) => entry.name)
            .filter((name) => /\.(png|jpe?g|webp|gif)$/i.test(name))
            .sort((a, b) => a.localeCompare(b))
            .map((name) => `/assets/images/${folder}/${name}`);
        return res.json({ ok: true, folder, files });
    });
});

const saveFilePath = path.join(__dirname, 'public', 'assets', 'saves', 'savefile.json');
const saveBackupsDir = path.join(__dirname, 'public', 'assets', 'saves', 'backups');
const sectionWorldSavesRoot = path.join(__dirname, 'public', 'assets', 'saves');
const buildingEditorSavesDir = path.join(__dirname, 'public', 'assets', 'saves', 'building-editor');
const debugCapturesDir = path.join(__dirname, 'public', 'assets', 'debug-captures');
const terrainBubbleExamplesPath = path.join(__dirname, 'public', 'assets', 'data', 'terrain-bubble-examples.json');
const terrainBubbleLearningErrorsPath = path.join(__dirname, 'docs', 'terrain-bubble-learning-errors.json');
const terrainBubbleCalculatorModelPath = path.join(__dirname, 'docs', 'terrain-bubble-trained-calculator.json');
const terrainBubbleBinaryVertexModelPath = path.join(__dirname, 'docs', 'terrain-bubble-trained-binary-vertex-model.json');
const terrainBubbleIsoContourModelPath = path.join(__dirname, 'docs', 'terrain-bubble-trained-iso-contour-model.json');
const annotateTerrainBubbleLearningErrorsScript = path.join(__dirname, 'scripts', 'annotate-terrain-bubble-learning-errors.js');
let terrainBubbleVertexCalculatorCache = null;
let terrainBubbleBinaryVertexModelCache = null;
let terrainBubbleIsoContourModelCache = null;
const sectionWorldBuildingDirName = 'buildings';
const sectionWorldBuildingIndexFileName = 'index.json';

function normalizeSaveSlotName(rawSlot) {
    const slot = String(rawSlot === undefined || rawSlot === null ? '' : rawSlot).trim();
    if (!slot) return '';
    const safe = slot.replace(/[^a-zA-Z0-9_-]/g, '');
    return safe === slot ? safe : '';
}

function resolveSavePathsForSlot(slotName) {
    const normalizedSlot = normalizeSaveSlotName(slotName);
    if (!normalizedSlot || normalizedSlot === 'savefile') {
        return {
            normalizedSlot: '',
            savePath: saveFilePath,
            responsePath: '/assets/saves/savefile.json',
            backupPrefix: 'savefile'
        };
    }
    return {
        normalizedSlot,
        savePath: path.join(__dirname, 'public', 'assets', 'saves', `${normalizedSlot}.json`),
        responsePath: `/assets/saves/${encodeURIComponent(normalizedSlot)}.json`,
        backupPrefix: normalizedSlot
    };
}

function resolveSectionWorldDirForSlot(slotName) {
    const normalizedSlot = normalizeSaveSlotName(slotName);
    if (!normalizedSlot) return null;
    return path.join(sectionWorldSavesRoot, normalizedSlot);
}

function normalizeBuildingEditorBuildingName(rawName) {
    const name = String(rawName === undefined || rawName === null ? '' : rawName).trim();
    if (!name || name.length > 80) return '';
    if (!/^[a-zA-Z0-9][a-zA-Z0-9 _-]*$/.test(name)) return '';
    if (name.endsWith('.json')) return '';
    return name;
}

function resolveBuildingEditorSavePath(rawName) {
    const name = normalizeBuildingEditorBuildingName(rawName);
    if (!name) return null;
    return {
        name,
        fileName: `${name}.json`,
        savePath: path.join(buildingEditorSavesDir, `${name}.json`),
        responsePath: `/assets/saves/building-editor/${encodeURIComponent(name)}.json`
    };
}

function isValidBuildingEditorPayload(payload) {
    return !!(
        payload &&
        typeof payload === 'object' &&
        !Array.isArray(payload) &&
        payload.schema === 'survivor-building-v1' &&
        Array.isArray(payload.floorFragments) &&
        Array.isArray(payload.wallSections) &&
        Array.isArray(payload.mountedWallObjects)
    );
}

const terrainBubbleTerrainTypes = new Set(['grass', 'water', 'mud', 'desert']);
const terrainBubbleExpectedTileKeys = createTerrainBubbleExpectedTileKeys(2);

function isPlainObject(value) {
    return !!(value && typeof value === 'object' && !Array.isArray(value));
}

function isFiniteTerrainBubbleNumber(value) {
    return Number.isFinite(Number(value));
}

function isValidTerrainBubbleId(rawId) {
    const id = String(rawId === undefined || rawId === null ? '' : rawId).trim();
    return !!(id && id.length <= 140 && /^[a-zA-Z0-9_.-]+$/.test(id));
}

function terrainBubbleCoordKey(tile) {
    return `${Number(tile.q)},${Number(tile.r)}`;
}

function terrainBubbleAxialDistance(q, r) {
    return Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r));
}

function createTerrainBubbleExpectedTileKeys(radius) {
    const keys = new Set();
    for (let q = -radius; q <= radius; q++) {
        for (let r = -radius; r <= radius; r++) {
            if (terrainBubbleAxialDistance(q, r) <= radius) keys.add(`${q},${r}`);
        }
    }
    return keys;
}

function validateTerrainBubbleInput(input) {
    if (!isPlainObject(input) || input.schema !== 'terrain-bubble-19-v1') {
        return 'invalid-input';
    }
    if (!Array.isArray(input.tiles) || input.tiles.length !== terrainBubbleExpectedTileKeys.size) {
        return 'invalid-input-tiles';
    }

    const tileKeys = new Set();
    for (const tile of input.tiles) {
        if (!isPlainObject(tile)) return 'invalid-input-tile';
        if (!Number.isInteger(Number(tile.q)) || !Number.isInteger(Number(tile.r))) return 'invalid-input-coord';
        if (!terrainBubbleTerrainTypes.has(tile.type)) return 'invalid-input-terrain';
        const key = terrainBubbleCoordKey(tile);
        if (!terrainBubbleExpectedTileKeys.has(key) || tileKeys.has(key)) return 'invalid-input-tile-set';
        tileKeys.add(key);
    }

    return '';
}

function validateTerrainBubbleExample(payload) {
    if (!isPlainObject(payload)) return 'invalid-payload';
    if (payload.schema !== 'terrain-bubble-example-v1') return 'invalid-schema';
    if (!isValidTerrainBubbleId(payload.id)) return 'invalid-id';
    if (typeof payload.name !== 'string' || payload.name.trim().length === 0 || payload.name.length > 80) {
        return 'invalid-name';
    }
    if (typeof payload.createdAt !== 'string' || !Number.isFinite(Date.parse(payload.createdAt))) {
        return 'invalid-created-at';
    }
    const inputReason = validateTerrainBubbleInput(payload.input);
    if (inputReason) return inputReason;

    if (!isPlainObject(payload.output) || payload.output.schema !== 'terrain-bubble-output-v1') {
        return 'invalid-output';
    }
    if (payload.output.fills !== 'inner-7') return 'invalid-output-fill';
    if (!Array.isArray(payload.output.polygons)) return 'invalid-output-polygons';
    for (const polygon of payload.output.polygons) {
        if (!isPlainObject(polygon)) return 'invalid-output-polygon';
        if (!terrainBubbleTerrainTypes.has(polygon.type)) return 'invalid-output-terrain';
        if (!Array.isArray(polygon.points) || polygon.points.length < 3 || polygon.points.length > 200) {
            return 'invalid-output-points';
        }
        for (const point of polygon.points) {
            if (!isPlainObject(point) || !isFiniteTerrainBubbleNumber(point.x) || !isFiniteTerrainBubbleNumber(point.y)) {
                return 'invalid-output-point';
            }
        }
    }

    return '';
}

function summarizeTerrainBubbleLearningError(library) {
    const examples = Array.isArray(library && library.examples) ? library.examples : [];
    let finiteCount = 0;
    let missingCount = 0;
    let totalDiffArea = 0;
    for (const example of examples) {
        const value = example &&
            example.editor &&
            example.editor.learningError &&
            example.editor.learningError.totalDiffArea;
        if (Number.isFinite(Number(value))) {
            finiteCount++;
            totalDiffArea += Number(value);
        } else {
            missingCount++;
        }
    }
    return {
        schema: 'terrain-bubble-learning-error-summary-v1',
        exampleCount: examples.length,
        finiteCount,
        missingCount,
        totalDiffArea: Math.round(totalDiffArea * 1000000) / 1000000
    };
}

function readTerrainBubbleExampleLibrary() {
    if (!fs.existsSync(terrainBubbleExamplesPath)) {
        return { schema: 'terrain-bubble-examples-v1', examples: [] };
    }
    const raw = fs.readFileSync(terrainBubbleExamplesPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!isPlainObject(parsed) || parsed.schema !== 'terrain-bubble-examples-v1' || !Array.isArray(parsed.examples)) {
        throw new Error('terrain bubble example library has invalid schema');
    }
    return parsed;
}

function buildTerrainBubbleVertexCalculator(examples) {
    const editedExamples = examples.filter(example => example && example.editor && example.editor.edited);
    if (editedExamples.length === 0) {
        throw new Error('no edited terrain bubble examples for vertex calculator');
    }
    return {
        editedExamples,
        calculator: buildTrainingCalculator(editedExamples)
    };
}

function readTerrainBubbleVertexCalculator() {
    if (!fs.existsSync(terrainBubbleCalculatorModelPath)) {
        throw new Error('missing trained terrain bubble calculator model; click Retrain first');
    }
    const stats = fs.statSync(terrainBubbleCalculatorModelPath);
    if (
        terrainBubbleVertexCalculatorCache &&
        terrainBubbleVertexCalculatorCache.mtimeMs === stats.mtimeMs
    ) {
        return terrainBubbleVertexCalculatorCache.value;
    }
    const artifact = JSON.parse(fs.readFileSync(terrainBubbleCalculatorModelPath, 'utf8'));
    if (!isPlainObject(artifact) || artifact.schema !== 'terrain-bubble-trained-calculator-artifact-v1') {
        throw new Error('trained terrain bubble calculator model has invalid schema');
    }
    if (!isPlainObject(artifact.calculator)) {
        throw new Error('trained terrain bubble calculator model is missing calculator');
    }
    const value = {
        artifact,
        calculator: artifact.calculator
    };
    terrainBubbleVertexCalculatorCache = {
        mtimeMs: stats.mtimeMs,
        value
    };
    return value;
}

function buildTerrainBubbleBinaryVertexModel(examples) {
    const editedExamples = examples.filter(example => example && example.editor && example.editor.edited);
    if (editedExamples.length === 0) {
        throw new Error('no edited terrain bubble examples for binary vertex solver');
    }
    return {
        editedExamples,
        model: trainBinaryVertexModel(editedExamples)
    };
}

function readTerrainBubbleBinaryVertexModel() {
    if (!fs.existsSync(terrainBubbleBinaryVertexModelPath)) {
        throw new Error('missing trained terrain bubble binary vertex model; click Retrain first');
    }
    const stats = fs.statSync(terrainBubbleBinaryVertexModelPath);
    if (
        terrainBubbleBinaryVertexModelCache &&
        terrainBubbleBinaryVertexModelCache.mtimeMs === stats.mtimeMs
    ) {
        return terrainBubbleBinaryVertexModelCache.value;
    }
    const artifact = JSON.parse(fs.readFileSync(terrainBubbleBinaryVertexModelPath, 'utf8'));
    if (!isPlainObject(artifact) || artifact.schema !== 'terrain-bubble-trained-binary-vertex-model-artifact-v1') {
        throw new Error('trained terrain bubble binary vertex model has invalid schema');
    }
    const value = {
        artifact,
        model: deserializeBinaryVertexModel(artifact.model)
    };
    terrainBubbleBinaryVertexModelCache = {
        mtimeMs: stats.mtimeMs,
        value
    };
    return value;
}

function readTerrainBubbleIsoContourModel() {
    if (!fs.existsSync(terrainBubbleIsoContourModelPath)) {
        return {
            artifact: null,
            model: normalizeIsoContourModel(defaultIsoContourModel)
        };
    }
    const stats = fs.statSync(terrainBubbleIsoContourModelPath);
    if (
        terrainBubbleIsoContourModelCache &&
        terrainBubbleIsoContourModelCache.mtimeMs === stats.mtimeMs
    ) {
        return terrainBubbleIsoContourModelCache.value;
    }
    const artifact = JSON.parse(fs.readFileSync(terrainBubbleIsoContourModelPath, 'utf8'));
    if (!isPlainObject(artifact) || artifact.schema !== 'terrain-bubble-trained-iso-contour-model-artifact-v1') {
        throw new Error('trained terrain bubble iso-contour model has invalid schema');
    }
    if (!isPlainObject(artifact.model)) {
        throw new Error('trained terrain bubble iso-contour model is missing model');
    }
    const value = {
        artifact,
        model: normalizeIsoContourModel(artifact.model, { requirePriorityBiasMode: true })
    };
    terrainBubbleIsoContourModelCache = {
        mtimeMs: stats.mtimeMs,
        value
    };
    return value;
}

function scoreTerrainBubbleExampleWithVertexCalculator(example) {
    const { calculator } = readTerrainBubbleVertexCalculator();
    const actual = calculateVerticesForExample(example, calculator);
    const expected = clipTerrainPolygonsToInnerSeven(example.output.polygons || []);
    const comparison = compareTerrainBubblePolygons(actual, expected);
    return {
        ...example,
        editor: {
            ...(example.editor || {}),
            learningError: {
                schema: 'terrain-bubble-learning-error-v1',
                mode: 'vertex-calculator',
                trainedExampleCount: calculator.trainedExampleCount,
                excludedExampleCount: calculator.excludedExamples.length,
                conflictCount: calculator.conflicts.length,
                totalDiffArea: comparison.totalDiffArea,
                rows: comparison.rows,
                scoredAt: new Date().toISOString()
            }
        }
    };
}

function buildTerrainBubbleLearningError(example, actualPolygons, mode, metadata = {}) {
    const expected = clipTerrainPolygonsToInnerSeven(example.output.polygons || []);
    const actual = clipTerrainPolygonsToInnerSeven(actualPolygons || []);
    const comparison = compareTerrainBubblePolygons(actual, expected);
    return {
        ...example,
        editor: {
            ...(example.editor || {}),
            learningError: {
                schema: 'terrain-bubble-learning-error-v1',
                mode,
                ...metadata,
                totalDiffArea: comparison.totalDiffArea,
                rows: comparison.rows,
                scoredAt: new Date().toISOString()
            }
        }
    };
}

function scoreTerrainBubbleExampleWithSolver(example, solver) {
    if (solver === 'calculator') {
        return scoreTerrainBubbleExampleWithVertexCalculator(example);
    }
    if (solver === 'binary-vertex') {
        const { model } = readTerrainBubbleBinaryVertexModel();
        const suggestion = buildBinaryVertexSuggestion(example.input, model, {
            id: `${example.id || 'saved'}-binary-vertex-score`,
            name: `${example.name || 'saved'} binary vertex score`
        });
        return buildTerrainBubbleLearningError(example, suggestion.output.polygons, 'binary-vertex', {
            trainedExampleCount: model.trainedExampleCount,
            augmentedExampleCount: model.augmentedExampleCount,
            featureCount: model.featureCount,
            binaryObservations: model.binaryVertexModel.observationCount,
            fuzzyGroupCount: model.binaryVertexModel.fuzzyGroupCount
        });
    }
    if (solver === 'iso-contour') {
        const { model } = readTerrainBubbleIsoContourModel();
        const suggestion = buildIsoContourSuggestion(example.input, model, {
            id: `${example.id || 'saved'}-iso-contour-score`,
            name: `${example.name || 'saved'} iso-contour score`
        });
        return buildTerrainBubbleLearningError(example, suggestion.output.polygons, 'iso-contour', {
            trainedExampleCount: model.trainedExampleCount,
            priorityBiasMode: model.priorityBiasMode,
            priorityBiasStep: model.priorityBiasStep,
            quantizationSteps: model.quantizationSteps,
            trainingError: model.trainingError
        });
    }
    if (solver === 'deterministic') {
        const suggestion = buildDeterministicTerrainBubbleSuggestion(example.input, {
            id: `${example.id || 'saved'}-deterministic-score`,
            name: `${example.name || 'saved'} deterministic score`
        });
        return buildTerrainBubbleLearningError(example, suggestion.output.polygons, 'deterministic-solver', {
            priorityOrder: ['water', 'mud', 'grass', 'desert']
        });
    }
    throw new Error(`invalid terrain bubble scoring solver ${solver}`);
}

function scoreTerrainBubbleExamplesWithDeterministicSolver() {
    const library = readTerrainBubbleExampleLibrary();
    const { library: scoredLibrary, report } = annotateTerrainBubbleExamplesWithDeterministicScore(library);
    fs.mkdirSync(path.dirname(terrainBubbleExamplesPath), { recursive: true });
    fs.writeFileSync(terrainBubbleExamplesPath, JSON.stringify(scoredLibrary, null, 2), 'utf8');
    fs.mkdirSync(path.dirname(terrainBubbleLearningErrorsPath), { recursive: true });
    fs.writeFileSync(terrainBubbleLearningErrorsPath, JSON.stringify({
        schema: 'terrain-bubble-learning-errors-v1',
        generatedAt: report.generatedAt,
        operation: 'score-existing-examples',
        solver: 'deterministic',
        examplesPath: path.relative(__dirname, terrainBubbleExamplesPath),
        exampleCount: scoredLibrary.examples.length,
        scoredExampleCount: report.scoredExampleCount,
        errorSummary: report.errorSummary,
        rows: report.rows
    }, null, 2), 'utf8');
    return report;
}

function listBuildingEditorSaves() {
    if (!fs.existsSync(buildingEditorSavesDir)) return [];
    return fs.readdirSync(buildingEditorSavesDir, { withFileTypes: true })
        .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
        .map(entry => {
            const name = entry.name.slice(0, -'.json'.length);
            const normalizedName = normalizeBuildingEditorBuildingName(name);
            if (!normalizedName || normalizedName !== name) return null;
            const filePath = path.join(buildingEditorSavesDir, entry.name);
            const stats = fs.statSync(filePath);
            return {
                name,
                file: entry.name,
                path: `/assets/saves/building-editor/${encodeURIComponent(entry.name)}`,
                modifiedTime: stats.mtime.toISOString(),
                size: stats.size
            };
        })
        .filter(Boolean)
        .sort((a, b) => a.name.localeCompare(b.name));
}

function isValidSectionCoordRecord(section) {
    return !!(
        section &&
        typeof section === 'object' &&
        section.coord &&
        Number.isFinite(Number(section.coord.q)) &&
        Number.isFinite(Number(section.coord.r))
    );
}

function buildSectionFileName(section) {
    const q = Math.trunc(Number(section.coord.q) || 0);
    const r = Math.trunc(Number(section.coord.r) || 0);
    return `${q},${r}.json`;
}

function normalizeSectionWorldBuildingId(rawId) {
    const id = String(rawId === undefined || rawId === null ? '' : rawId).trim();
    if (!id || id.length > 160) return '';
    if (id.includes('/') || id.includes('\\')) return '';
    return id;
}

function buildSectionWorldBuildingFileName(buildingId) {
    const id = normalizeSectionWorldBuildingId(buildingId);
    if (!id) return '';
    return `${encodeURIComponent(id)}.json`;
}

function resolveSectionWorldBuildingDir(slotDir) {
    return path.join(slotDir, sectionWorldBuildingDirName);
}

function writeSectionWorldBuildingRecords(slotDir, buildings) {
    const buildingDir = resolveSectionWorldBuildingDir(slotDir);
    fs.mkdirSync(buildingDir, { recursive: true });

    const indexRecords = [];
    const nextFileNames = new Set([sectionWorldBuildingIndexFileName]);
    for (let i = 0; i < buildings.length; i++) {
        const building = buildings[i];
        if (!building || typeof building !== 'object' || Array.isArray(building)) {
            throw new Error('sectionworld building record must be an object');
        }
        const buildingId = normalizeSectionWorldBuildingId(building.id);
        if (!buildingId) {
            throw new Error('sectionworld building record is missing id');
        }
        const fileName = buildSectionWorldBuildingFileName(buildingId);
        if (!fileName) {
            throw new Error(`sectionworld building ${buildingId} has invalid file name`);
        }
        const filePath = path.join(buildingDir, fileName);
        fs.writeFileSync(filePath, JSON.stringify(building, null, 2), 'utf8');
        indexRecords.push({ id: buildingId, file: fileName });
        nextFileNames.add(fileName);
    }

    fs.writeFileSync(
        path.join(buildingDir, sectionWorldBuildingIndexFileName),
        JSON.stringify(indexRecords, null, 2),
        'utf8'
    );

    for (const entry of fs.readdirSync(buildingDir, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        if (nextFileNames.has(entry.name)) continue;
        fs.unlinkSync(path.join(buildingDir, entry.name));
    }
}

function readSectionWorldBuildingRecords(slotDir) {
    const buildingDir = resolveSectionWorldBuildingDir(slotDir);
    if (!fs.existsSync(buildingDir)) return null;

    const readBuildingFile = (fileName) => {
        if (typeof fileName !== 'string' || !fileName.endsWith('.json') || fileName.includes('/') || fileName.includes('\\')) {
            return null;
        }
        const filePath = path.join(buildingDir, fileName);
        if (!fs.existsSync(filePath)) return null;
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    };

    const indexPath = path.join(buildingDir, sectionWorldBuildingIndexFileName);
    if (fs.existsSync(indexPath)) {
        const parsedIndex = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
        if (!Array.isArray(parsedIndex)) {
            throw new Error('sectionworld building index must be an array');
        }
        const buildings = [];
        for (let i = 0; i < parsedIndex.length; i++) {
            const entry = parsedIndex[i];
            const fileName = entry && typeof entry.file === 'string'
                ? entry.file
                : buildSectionWorldBuildingFileName(entry && entry.id);
            const building = readBuildingFile(fileName);
            if (building) buildings.push(building);
        }
        return buildings;
    }

    return fs.readdirSync(buildingDir, { withFileTypes: true })
        .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
        .map(entry => entry.name)
        .sort((a, b) => a.localeCompare(b))
        .map(readBuildingFile)
        .filter(Boolean);
}

function formatTimestampToSecond(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    return `${y}-${m}-${d}_${hh}-${mm}-${ss}`;
}

function saveSectionWorldSlot(requestedSlot, payload) {
    const slotDir = resolveSectionWorldDirForSlot(requestedSlot);
    if (!slotDir) {
        return { status: 400, body: { ok: false, reason: 'invalid-slot' } };
    }
    const sections = Array.isArray(payload && payload.sections) ? payload.sections : null;
    if (!sections) {
        return { status: 400, body: { ok: false, reason: 'invalid-payload' } };
    }
    const manifest = (payload && payload.manifest && typeof payload.manifest === 'object')
        ? payload.manifest
        : {};
    const hasTriggers = Object.prototype.hasOwnProperty.call(payload || {}, 'triggers');
    const triggers = Array.isArray(payload && payload.triggers) ? payload.triggers : [];
    const hasBuildings = Object.prototype.hasOwnProperty.call(payload || {}, 'buildings');
    const buildings = Array.isArray(payload && payload.buildings) ? payload.buildings : [];

    fs.mkdirSync(slotDir, { recursive: true });
    const manifestPath = path.join(slotDir, 'manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    if (hasTriggers) {
        const triggersPath = path.join(slotDir, 'triggers.json');
        fs.writeFileSync(triggersPath, JSON.stringify(triggers, null, 2), 'utf8');
    }
    if (hasBuildings) {
        writeSectionWorldBuildingRecords(slotDir, buildings);
        const legacyBuildingsPath = path.join(slotDir, 'buildings.json');
        if (fs.existsSync(legacyBuildingsPath)) {
            fs.unlinkSync(legacyBuildingsPath);
        }
    }
    const validSections = sections.filter(isValidSectionCoordRecord);
    for (let i = 0; i < validSections.length; i++) {
        const section = validSections[i];
        const fileName = buildSectionFileName(section);
        const filePath = path.join(slotDir, fileName);
        fs.writeFileSync(filePath, JSON.stringify(section, null, 2), 'utf8');
    }

    return {
        status: 200,
        body: {
            ok: true,
            slot: requestedSlot,
            count: validSections.length,
            path: `/assets/saves/${encodeURIComponent(requestedSlot)}/`
        }
    };
}

function loadSectionWorldSlot(requestedSlot) {
    const slotDir = resolveSectionWorldDirForSlot(requestedSlot);
    if (!slotDir) {
        return { status: 400, body: { ok: false, reason: 'invalid-slot' } };
    }
    if (!fs.existsSync(slotDir)) {
        return { status: 404, body: { ok: false, reason: 'missing' } };
    }

    const sectionFiles = fs.readdirSync(slotDir, { withFileTypes: true })
        .filter(entry => entry.isFile() && entry.name.endsWith('.json') && entry.name !== 'manifest.json' && entry.name !== 'triggers.json' && entry.name !== 'buildings.json')
        .map(entry => entry.name)
        .sort((a, b) => a.localeCompare(b));

    const manifestPath = path.join(slotDir, 'manifest.json');
    let manifest = {};
    if (fs.existsSync(manifestPath)) {
        const rawManifest = fs.readFileSync(manifestPath, 'utf8');
        const parsedManifest = JSON.parse(rawManifest);
        if (parsedManifest && typeof parsedManifest === 'object' && !Array.isArray(parsedManifest)) {
            manifest = parsedManifest;
        }
    }

    const triggersPath = path.join(slotDir, 'triggers.json');
    let triggers = [];
    if (fs.existsSync(triggersPath)) {
        const rawTriggers = fs.readFileSync(triggersPath, 'utf8');
        const parsedTriggers = JSON.parse(rawTriggers);
        if (Array.isArray(parsedTriggers)) {
            triggers = parsedTriggers;
        }
    } else if (Array.isArray(manifest.triggers)) {
        triggers = manifest.triggers;
    }

    const buildingsPath = path.join(slotDir, 'buildings.json');
    const fileBackedBuildings = readSectionWorldBuildingRecords(slotDir);
    let buildings = Array.isArray(fileBackedBuildings) ? fileBackedBuildings : [];
    if (!Array.isArray(fileBackedBuildings) && fs.existsSync(buildingsPath)) {
        const rawBuildings = fs.readFileSync(buildingsPath, 'utf8');
        const parsedBuildings = JSON.parse(rawBuildings);
        if (Array.isArray(parsedBuildings)) {
            buildings = parsedBuildings;
        }
    } else if (!Array.isArray(fileBackedBuildings) && Array.isArray(manifest.buildings)) {
        buildings = manifest.buildings;
    }

    const sections = [];
    for (let i = 0; i < sectionFiles.length; i++) {
        const fileName = sectionFiles[i];
        const filePath = path.join(slotDir, fileName);
        const raw = fs.readFileSync(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (isValidSectionCoordRecord(parsed)) {
            sections.push(parsed);
        }
    }

    return {
        status: 200,
        body: {
            ok: true,
            slot: requestedSlot,
            manifest,
            triggers,
            buildings,
            sections
        }
    };
}

app.post('/api/savefile', (req, res) => {
    try {
        const payload = req.body;
        if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
            return res.status(400).json({ ok: false, reason: 'invalid-payload' });
        }
        const requestedSlot = (typeof req.query.slot === 'string') ? req.query.slot : '';
        const paths = resolveSavePathsForSlot(requestedSlot);
        if (requestedSlot && !paths.normalizedSlot) {
            return res.status(400).json({ ok: false, reason: 'invalid-slot' });
        }

        fs.mkdirSync(path.dirname(paths.savePath), { recursive: true });
        if (fs.existsSync(paths.savePath)) {
            fs.mkdirSync(saveBackupsDir, { recursive: true });
            const timestamp = formatTimestampToSecond(new Date());
            let backupName = `${paths.backupPrefix}_${timestamp}.json`;
            let backupPath = path.join(saveBackupsDir, backupName);
            let suffix = 1;
            while (fs.existsSync(backupPath)) {
                backupName = `${paths.backupPrefix}_${timestamp}_${suffix}.json`;
                backupPath = path.join(saveBackupsDir, backupName);
                suffix++;
            }
            fs.copyFileSync(paths.savePath, backupPath);
        }
        fs.writeFileSync(paths.savePath, JSON.stringify(payload, null, 2), 'utf8');
        return res.json({ ok: true, path: paths.responsePath, slot: paths.normalizedSlot || 'savefile' });
    } catch (e) {
        console.error('Failed to write save file:', e);
        return res.status(500).json({ ok: false, reason: 'write-failed' });
    }
});

app.get('/api/savefile', (req, res) => {
    try {
        const requestedFile = (typeof req.query.file === 'string') ? req.query.file.trim() : '';
        const requestedSlot = (typeof req.query.slot === 'string') ? req.query.slot : '';
        const slotPaths = resolveSavePathsForSlot(requestedSlot);
        if (requestedSlot && !slotPaths.normalizedSlot) {
            return res.status(400).json({ ok: false, reason: 'invalid-slot' });
        }
        let resolvedPath = slotPaths.savePath;
        let responsePath = slotPaths.responsePath;

        if (requestedFile) {
            if (requestedFile === 'savefile.json') {
                resolvedPath = saveFilePath;
                responsePath = '/assets/saves/savefile.json';
            } else {
                const safeName = path.basename(requestedFile);
                const isValidName = (
                    safeName === requestedFile &&
                    safeName.length > 0 &&
                    safeName.endsWith('.json') &&
                    !safeName.includes('/') &&
                    !safeName.includes('\\')
                );
                if (!isValidName) {
                    return res.status(400).json({ ok: false, reason: 'invalid-file' });
                }
                resolvedPath = path.join(saveBackupsDir, safeName);
                responsePath = `/assets/saves/backups/${encodeURIComponent(safeName)}`;
            }
        }

        if (!fs.existsSync(resolvedPath)) {
            return res.status(404).json({ ok: false, reason: 'missing' });
        }
        const raw = fs.readFileSync(resolvedPath, 'utf8');
        const parsed = JSON.parse(raw);
        return res.json({ ok: true, data: parsed, path: responsePath });
    } catch (e) {
        console.error('Failed to read save file:', e);
        return res.status(500).json({ ok: false, reason: 'read-failed' });
    }
});

app.get('/api/terrain-bubble-examples', (req, res) => {
    try {
        res.set('Cache-Control', 'no-store');
        return res.json({ ok: true, data: readTerrainBubbleExampleLibrary() });
    } catch (e) {
        console.error('Failed to read terrain bubble examples:', e);
        return res.status(500).json({ ok: false, reason: 'read-failed' });
    }
});

app.post('/api/terrain-bubble-examples', (req, res) => {
    try {
        res.set('Cache-Control', 'no-store');
        const payload = isPlainObject(req.body) && isPlainObject(req.body.example)
            ? req.body.example
            : req.body;
        const solver = isPlainObject(req.body) && typeof req.body.solver === 'string'
            ? req.body.solver
            : 'calculator';
        if (!['calculator', 'binary-vertex', 'iso-contour', 'deterministic'].includes(solver)) {
            return res.status(400).json({ ok: false, reason: 'invalid-solver' });
        }
        const reason = validateTerrainBubbleExample(payload);
        if (reason) {
            return res.status(400).json({ ok: false, reason });
        }

        const scoredExample = scoreTerrainBubbleExampleWithSolver(payload, solver);
        const library = readTerrainBubbleExampleLibrary();
        const existingIndex = library.examples.findIndex(example => example.id === scoredExample.id);
        const didUpdate = existingIndex >= 0;
        if (didUpdate) {
            library.examples[existingIndex] = scoredExample;
        } else {
            library.examples.push(scoredExample);
        }
        fs.mkdirSync(path.dirname(terrainBubbleExamplesPath), { recursive: true });
        fs.writeFileSync(terrainBubbleExamplesPath, JSON.stringify(library, null, 2), 'utf8');
        return res.json({
            ok: true,
            id: scoredExample.id,
            path: '/assets/data/terrain-bubble-examples.json',
            count: library.examples.length,
            updated: didUpdate,
            data: scoredExample
        });
    } catch (e) {
        console.error('Failed to write terrain bubble example:', e);
        return res.status(500).json({ ok: false, reason: 'write-failed' });
    }
});

app.post('/api/terrain-bubble-examples/suggest', (req, res) => {
    try {
        res.set('Cache-Control', 'no-store');
        const input = isPlainObject(req.body) && isPlainObject(req.body.input)
            ? req.body.input
            : req.body;
        const solver = isPlainObject(req.body) && typeof req.body.solver === 'string'
            ? req.body.solver
            : 'calculator';
        if (!['calculator', 'binary-vertex', 'iso-contour', 'deterministic'].includes(solver)) {
            return res.status(400).json({ ok: false, reason: 'invalid-solver' });
        }
        const reason = validateTerrainBubbleInput(input);
        if (reason) {
            return res.status(400).json({ ok: false, reason });
        }

        if (solver === 'binary-vertex') {
            const { artifact, model } = readTerrainBubbleBinaryVertexModel();
            const suggestion = buildBinaryVertexSuggestion(input, model, {
                id: 'current-binary-vertex-suggestion',
                name: 'current binary vertex suggestion'
            });
            return res.json({
                ok: true,
                solver,
                model: {
                    schema: model.schema,
                    trainedExampleCount: model.trainedExampleCount,
                    augmentedExampleCount: model.augmentedExampleCount,
                    featureCount: model.featureCount,
                    binaryObservations: model.binaryVertexModel.observationCount,
                    fuzzyGroupCount: model.binaryVertexModel.fuzzyGroupCount,
                    generatedAt: artifact.generatedAt || null
                },
                data: suggestion
            });
        }

        if (solver === 'iso-contour') {
            const { artifact, model } = readTerrainBubbleIsoContourModel();
            const suggestion = buildIsoContourSuggestion(input, model, {
                id: 'current-iso-contour-suggestion',
                name: 'current iso-contour suggestion'
            });
            return res.json({
                ok: true,
                solver,
                model: {
                    schema: model.schema,
                    trainedExampleCount: model.trainedExampleCount,
                    priorityBiasMode: model.priorityBiasMode,
                    priorityBiasStep: model.priorityBiasStep,
                    quantizationSteps: model.quantizationSteps,
                    trainingError: model.trainingError,
                    generatedAt: artifact && artifact.generatedAt || null
                },
                data: suggestion
            });
        }

        if (solver === 'deterministic') {
            const suggestion = buildDeterministicTerrainBubbleSuggestion(input, {
                id: 'current-deterministic-suggestion',
                name: 'current deterministic solver suggestion'
            });
            return res.json({
                ok: true,
                solver,
                model: {
                    schema: 'terrain-bubble-deterministic-solver-v1',
                    priorityOrder: ['water', 'mud', 'grass', 'desert']
                },
                data: suggestion
            });
        }

        const { artifact, calculator } = readTerrainBubbleVertexCalculator();
        const suggestion = buildCalculatedExample(input, calculator, {
            id: 'current-calculator-suggestion',
            name: 'current calculator suggestion'
        });
        return res.json({
            ok: true,
            solver,
            model: {
                schema: calculator.schema,
                trainedExampleCount: calculator.trainedExampleCount,
                excludedExampleCount: calculator.excludedExamples.length,
                conflictCount: calculator.conflicts.length,
                generatedAt: artifact.generatedAt || null
            },
            data: suggestion
        });
    } catch (e) {
        console.error('Failed to suggest terrain bubble polygons:', e);
        if (e && /^no terrain bubble vertex recipe/.test(e.message || '')) {
            return res.status(409).json({ ok: false, reason: 'missing-calculator-recipe', detail: e.message });
        }
        if (e && /^missing trained terrain bubble/.test(e.message || '')) {
            return res.status(409).json({ ok: false, reason: 'missing-trained-model', detail: e.message });
        }
        return res.status(500).json({ ok: false, reason: 'suggest-failed' });
    }
});

app.post('/api/terrain-bubble-examples/retrain', (req, res) => {
    try {
        res.set('Cache-Control', 'no-store');
        const beforeErrorSummary = summarizeTerrainBubbleLearningError(readTerrainBubbleExampleLibrary());
        const solver = isPlainObject(req.body) && typeof req.body.solver === 'string'
            ? req.body.solver
            : 'calculator';
        if (solver === 'deterministic') {
            const report = scoreTerrainBubbleExamplesWithDeterministicSolver();
            const afterErrorSummary = summarizeTerrainBubbleLearningError(readTerrainBubbleExampleLibrary());
            return res.json({
                ok: true,
                operation: 'score-existing-examples',
                solver,
                report,
                beforeErrorSummary,
                afterErrorSummary
            });
        }
        if (!['calculator', 'binary-vertex', 'iso-contour'].includes(solver)) {
            return res.status(400).json({ ok: false, reason: 'invalid-solver' });
        }
        execFile(process.execPath, [annotateTerrainBubbleLearningErrorsScript], {
            cwd: __dirname,
            timeout: 180000,
            maxBuffer: 1024 * 1024 * 20
        }, (error, stdout, stderr) => {
            if (error) {
                console.error('Terrain bubble scoring failed:', error, stderr || stdout);
                return res.status(500).json({
                    ok: false,
                    reason: 'score-failed',
                    detail: stderr || stdout || error.message
                });
            }
            try {
                terrainBubbleVertexCalculatorCache = null;
                terrainBubbleBinaryVertexModelCache = null;
                terrainBubbleIsoContourModelCache = null;
                const report = JSON.parse(fs.readFileSync(terrainBubbleLearningErrorsPath, 'utf8'));
                const afterErrorSummary = summarizeTerrainBubbleLearningError(readTerrainBubbleExampleLibrary());
                return res.json({
                    ok: true,
                    operation: 'score-existing-examples',
                    report,
                    beforeErrorSummary,
                    afterErrorSummary,
                    modelArtifacts: {
                        calculator: path.relative(__dirname, terrainBubbleCalculatorModelPath),
                        binaryVertex: path.relative(__dirname, terrainBubbleBinaryVertexModelPath),
                        isoContour: path.relative(__dirname, terrainBubbleIsoContourModelPath)
                    },
                    stdout
                });
            } catch (readError) {
                console.error('Terrain bubble scoring report read failed:', readError);
                return res.status(500).json({ ok: false, reason: 'report-read-failed' });
            }
        });
    } catch (e) {
        console.error('Failed to score terrain bubble examples:', e);
        return res.status(500).json({ ok: false, reason: 'score-start-failed' });
    }
});

app.get('/api/building-editor/buildings', (req, res) => {
    try {
        return res.json({ ok: true, buildings: listBuildingEditorSaves() });
    } catch (e) {
        console.error('Failed to list building editor saves:', e);
        return res.status(500).json({ ok: false, reason: 'list-failed' });
    }
});

app.get('/api/building-editor/buildings/:name', (req, res) => {
    try {
        const paths = resolveBuildingEditorSavePath(req.params.name);
        if (!paths) {
            return res.status(400).json({ ok: false, reason: 'invalid-name' });
        }
        if (!fs.existsSync(paths.savePath)) {
            return res.status(404).json({ ok: false, reason: 'missing' });
        }
        const raw = fs.readFileSync(paths.savePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (!isValidBuildingEditorPayload(parsed)) {
            return res.status(500).json({ ok: false, reason: 'invalid-building-file' });
        }
        return res.json({ ok: true, name: paths.name, path: paths.responsePath, data: parsed });
    } catch (e) {
        console.error('Failed to read building editor save:', e);
        return res.status(500).json({ ok: false, reason: 'read-failed' });
    }
});

app.post('/api/building-editor/buildings/:name', (req, res) => {
    try {
        const paths = resolveBuildingEditorSavePath(req.params.name);
        if (!paths) {
            return res.status(400).json({ ok: false, reason: 'invalid-name' });
        }
        const payload = req.body;
        if (!isValidBuildingEditorPayload(payload)) {
            return res.status(400).json({ ok: false, reason: 'invalid-payload' });
        }
        fs.mkdirSync(buildingEditorSavesDir, { recursive: true });
        fs.writeFileSync(paths.savePath, JSON.stringify(payload, null, 2), 'utf8');
        return res.json({ ok: true, name: paths.name, path: paths.responsePath });
    } catch (e) {
        console.error('Failed to write building editor save:', e);
        return res.status(500).json({ ok: false, reason: 'write-failed' });
    }
});

app.post('/api/sectionworld', (req, res) => {
    try {
        const requestedSlot = (typeof req.query.slot === 'string') ? req.query.slot : '';
        const result = saveSectionWorldSlot(requestedSlot, req.body);
        return res.status(result.status).json(result.body);
    } catch (e) {
        console.error('Failed to write section world:', e);
        return res.status(500).json({ ok: false, reason: 'write-failed' });
    }
});

app.get('/api/sectionworld', (req, res) => {
    try {
        const requestedSlot = (typeof req.query.slot === 'string') ? req.query.slot : '';
        const result = loadSectionWorldSlot(requestedSlot);
        return res.status(result.status).json(result.body);
    } catch (e) {
        console.error('Failed to read section world:', e);
        return res.status(500).json({ ok: false, reason: 'read-failed' });
    }
});

app.get('/api/flooring', (req, res) => {
    try {
        const flooringDir = path.join(__dirname, 'public', 'assets', 'images', 'flooring');
        if (!fs.existsSync(flooringDir)) {
            return res.json({ ok: true, files: [] });
        }
        const files = fs.readdirSync(flooringDir, { withFileTypes: true })
            .filter(entry => entry.isFile())
            .map(entry => entry.name)
            .filter(name => /\.(png|jpg|jpeg|webp|gif)$/i.test(name))
            .sort((a, b) => a.localeCompare(b))
            .map(name => `/assets/images/flooring/${name}`);
        return res.json({ ok: true, files });
    } catch (e) {
        console.error('Failed to read flooring directory:', e);
        return res.status(500).json({ ok: false, reason: 'read-failed' });
    }
});

app.get('/api/placeables', (req, res) => {
    try {
        const imageRoot = path.join(__dirname, 'public', 'assets', 'images');
        const categories = ['flowers', 'windows', 'doors', 'furniture', 'signs', 'roof', 'walls'];
        const categoryDirByKey = {
            flowers: 'flowers',
            windows: 'windows',
            doors: 'doors',
            furniture: 'furniture',
            signs: 'signs',
            roof: 'roofs',
            walls: 'walls'
        };
        const out = {};
        categories.forEach(category => {
            const dirName = categoryDirByKey[category] || category;
            const dir = path.join(imageRoot, dirName);
            if (!fs.existsSync(dir)) {
                out[category] = [];
                return;
            }
            const files = fs.readdirSync(dir, { withFileTypes: true })
                .filter(entry => entry.isFile())
                .map(entry => entry.name)
                .filter(name => /\.(png|jpg|jpeg|webp|gif)$/i.test(name))
                .sort((a, b) => a.localeCompare(b))
                .map(name => `/assets/images/${dirName}/${encodeURIComponent(name)}`);
            out[category] = files;
        });
        return res.json({ ok: true, categories: out });
    } catch (e) {
        console.error('Failed to read placeables directories:', e);
        return res.status(500).json({ ok: false, reason: 'read-failed' });
    }
});

function normalizeDebugCaptureId(rawId) {
    const id = String(rawId === undefined || rawId === null ? '' : rawId).trim();
    const safe = id.replace(/[^a-zA-Z0-9_.-]/g, '_').slice(0, 160);
    return safe || `debug-capture-${Date.now()}`;
}

app.post('/api/debug/frame-capture', (req, res) => {
    try {
        const body = req.body || {};
        const dataUrl = typeof body.dataUrl === 'string' ? body.dataUrl : '';
        const match = dataUrl.match(/^data:image\/png;base64,([a-zA-Z0-9+/=]+)$/);
        if (!match) {
            return res.status(400).json({ ok: false, reason: 'invalid-data-url' });
        }
        fs.mkdirSync(debugCapturesDir, { recursive: true });
        const id = normalizeDebugCaptureId(body.id);
        const pngName = `${id}.png`;
        const jsonName = `${id}.json`;
        const pngPath = path.join(debugCapturesDir, pngName);
        const jsonPath = path.join(debugCapturesDir, jsonName);
        const pngBytes = Buffer.from(match[1], 'base64');
        fs.writeFileSync(pngPath, pngBytes);
        const metadata = { ...body };
        delete metadata.dataUrl;
        metadata.savedAt = new Date().toISOString();
        metadata.png = `/assets/debug-captures/${pngName}`;
        fs.writeFileSync(jsonPath, JSON.stringify(metadata, null, 2), 'utf8');
        return res.json({
            ok: true,
            id,
            url: `/assets/debug-captures/${pngName}`,
            metadataUrl: `/assets/debug-captures/${jsonName}`,
            bytes: pngBytes.length
        });
    } catch (e) {
        console.error('Failed to write debug frame capture:', e);
        return res.status(500).json({ ok: false, reason: 'write-failed' });
    }
});

if (require.main === module) {
    app.listen(port, () => {
        console.log('Listening on: http://localhost:' + port);
    });
}

module.exports = {
    app,
    buildingEditorSavesDir,
    defaultJsonBodyLimit,
    listBuildingEditorSaves,
    loadSectionWorldSlot,
    normalizeBuildingEditorBuildingName,
    normalizeSaveSlotName,
    resolveBuildingEditorSavePath,
    resolveSectionWorldDirForSlot,
    saveSectionWorldSlot,
    sectionWorldJsonBodyLimit
};

function generateToken() {
    let chars = "abcdefghijklmnopqrstuvwxyz1234567890";
    // string some random numbers and letters together
    return [1, 2, 3, 4, 5, 6, 7].map(n => chars[Math.floor(Math.random() * chars.length)]).join('');
}

function validateAuth(username, authtoken, res) {
    if (authtoken !== authtokens[username]) {
        console.log(`got auth token ${authtoken} vs expected ${authtokens[username]}`);
        res.render('logout');
        return false;
    }
    else return true;
}
