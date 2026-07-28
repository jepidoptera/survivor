const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const MAIN_PATH = path.join(__dirname, "../public/wizard-of-flatland/main.js");
const MATH_PATH = path.join(__dirname, "../public/wizard-of-flatland/flatlandMath.js");
const MAZE_SECTIONS_PATH = path.join(__dirname, "../public/wizard-of-flatland/mazeSections.js");
const MAZE_POPULATION_PATH = path.join(__dirname, "../public/wizard-of-flatland/mazePopulation.js");

function extractFunction(source, name, sourceLabel = "main.js") {
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `${name} exists in ${sourceLabel}`);
    const bodyStart = source.indexOf("{", start);
    let depth = 0;
    for (let i = bodyStart; i < source.length; i++) {
        if (source[i] === "{") depth++;
        if (source[i] === "}") depth--;
        if (depth === 0) return source.slice(start, i + 1);
    }
    throw new Error(`Unterminated function ${name}`);
}

function extractConst(source, name) {
    const match = source.match(new RegExp(`const ${name} = [^;]+;`));
    assert.ok(match, `${name} exists in main.js`);
    return match[0];
}

function loadEnemyBudgetExports() {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    const mathSource = fs.readFileSync(MATH_PATH, "utf8");
    const mazeSectionsSource = fs.readFileSync(MAZE_SECTIONS_PATH, "utf8");
    const mazePopulationSource = fs.readFileSync(MAZE_POPULATION_PATH, "utf8");
    const pieces = [
        extractConst(source, "MAZE_ROOM_EMPTY_ENEMY_CHANCE"),
        extractConst(source, "MAZE_ROOM_MAX_ENEMY_CHANCE"),
        extractConst(source, "MAZE_ROOM_EARLY_ENEMY_CAPS"),
        extractConst(source, "MAZE_ROOM_ENEMY_DISTRIBUTION_POWER"),
        extractConst(source, "ENEMY_SCALE_RING_INTERVAL"),
        extractConst(source, "ENEMY_SCALE_INCREMENT"),
        extractConst(source, "ENEMY_DAMAGE_BASE_SCALE"),
        extractConst(source, "ENEMY_DAMAGE_ZONE_MULTIPLIER"),
        extractConst(source, "MAZE_COIN_AVERAGE_COUNT"),
        extractConst(source, "MAZE_COIN_MIN_COUNT"),
        extractConst(source, "MAZE_COIN_MAX_COUNT"),
        extractConst(source, "MAZE_PYRAMID_COIN_COUNT"),
        extractConst(source, "MAZE_COIN_ZONE_MULTIPLIER"),
        extractConst(source, "MAZE_RING_BOUNDARY_INTERVAL"),
        extractConst(source, "PYRAMID_FIRST_ROOM_DISTANCE"),
        extractConst(source, "PYRAMID_ROOM_DISTANCE_STEP"),
        "const MAZE_SECTION_DIRECTIONS = [{ q: 1, r: 0 }, { q: 0, r: 1 }, { q: -1, r: 1 }, { q: -1, r: 0 }, { q: 0, r: -1 }, { q: 1, r: -1 }];",
        extractFunction(mathSource, "hashString", "flatlandMath.js"),
        extractFunction(mathSource, "seededRandom", "flatlandMath.js"),
        extractFunction(mazeSectionsSource, "validateMazeSectionKey", "mazeSections.js"),
        extractFunction(mazeSectionsSource, "parseMazeSectionKey", "mazeSections.js"),
        extractFunction(mazeSectionsSource, "isMazePyramidRoomSectionKey", "mazeSections.js"),
        extractFunction(mazeSectionsSource, "isMazePyramidRoomSectionCoord", "mazeSections.js"),
        extractFunction(mazeSectionsSource, "getMazePyramidRoomDistance", "mazeSections.js"),
        extractFunction(mazeSectionsSource, "isMazeInitialSafeSectionKey", "mazeSections.js"),
        extractFunction(mazeSectionsSource, "getMazeSectionRing", "mazeSections.js"),
        "const constants = { MAZE_SECTION_DIRECTIONS, PYRAMID_FIRST_ROOM_DISTANCE, PYRAMID_ROOM_DISTANCE_STEP, MAZE_ROOM_EMPTY_ENEMY_CHANCE, MAZE_ROOM_MAX_ENEMY_CHANCE, MAZE_ROOM_EARLY_ENEMY_CAPS, MAZE_ROOM_ENEMY_DISTRIBUTION_POWER, ENEMY_SCALE_RING_INTERVAL, ENEMY_SCALE_INCREMENT, ENEMY_DAMAGE_BASE_SCALE, ENEMY_DAMAGE_ZONE_MULTIPLIER, MAZE_COIN_AVERAGE_COUNT, MAZE_COIN_MIN_COUNT, MAZE_COIN_MAX_COUNT, MAZE_PYRAMID_COIN_COUNT, MAZE_COIN_ZONE_MULTIPLIER, MAZE_RING_BOUNDARY_INTERVAL };",
        "const math = { hashString, seededRandom };",
        "const mazeSections = { isMazePyramidRoomSectionKey, isMazeInitialSafeSectionKey, parseMazeSectionKey, getMazeSectionRing };",
        extractFunction(mazePopulationSource, "validateMazeRoomEnemyBudgetSectionKey", "mazePopulation.js"),
        extractFunction(mazePopulationSource, "getMazeRoomMaxEnemyCount", "mazePopulation.js"),
        extractFunction(mazePopulationSource, "getEnemyScaleForMazeSectionKey", "mazePopulation.js"),
        extractFunction(mazePopulationSource, "getEnemyDamageScaleForMazeSectionKey", "mazePopulation.js"),
        extractFunction(mazePopulationSource, "getMazeRoomEnemyCount", "mazePopulation.js"),
        extractFunction(mazePopulationSource, "getMazeCoinCount", "mazePopulation.js"),
        "globalThis.__testExports = { getMazeRoomEnemyCount, getMazeRoomMaxEnemyCount, getEnemyScaleForMazeSectionKey, getEnemyDamageScaleForMazeSectionKey, getMazeCoinCount };"
    ];
    const context = { Math, Number, String };
    vm.createContext(context);
    vm.runInContext(pieces.join("\n"), context, { filename: "wizard-of-flatland-enemy-budget.js" });
    return context.__testExports;
}

test("Wizard of Flatland first five ring caps scale zero, one, two, four, eight", () => {
    const api = loadEnemyBudgetExports();
    assert.deepEqual(
        ["0,0", "1,0", "2,0", "3,0", "4,0"].map((sectionKey) => api.getMazeRoomMaxEnemyCount(sectionKey)),
        [0, 1, 2, 4, 8]
    );
});

test("Wizard of Flatland room enemy caps increase by one per ring after ring four", () => {
    const api = loadEnemyBudgetExports();

    assert.equal(api.getMazeRoomMaxEnemyCount("5,0"), 9);
    assert.equal(api.getMazeRoomMaxEnemyCount("6,0"), 10);
    assert.equal(api.getMazeRoomMaxEnemyCount("7,0"), 11);
});

test("Wizard of Flatland enemy scale increases ten percent per seven rings", () => {
    const api = loadEnemyBudgetExports();

    assert.equal(api.getEnemyScaleForMazeSectionKey("6,0"), 1);
    assert.equal(api.getEnemyScaleForMazeSectionKey("7,0"), 1.1);
    assert.equal(api.getEnemyScaleForMazeSectionKey("14,0"), 1.2);
});

test("Wizard of Flatland enemy damage starts at 75 percent and compounds 25 percent per zone", () => {
    const api = loadEnemyBudgetExports();

    const expectedScales = [
        0.75,
        0.9375,
        1.171875,
        1.46484375,
        1.8310546875,
        2.288818359375,
        2.86102294921875
    ];
    for (let zone = 0; zone < expectedScales.length; zone++) {
        assert.equal(
            api.getEnemyDamageScaleForMazeSectionKey(`${zone * 7},0`),
            expectedScales[zone]
        );
    }
});

test("Wizard of Flatland ground coin average increases seventeen percent per zone", () => {
    const api = loadEnemyBudgetExports();
    const sampleCount = 10000;

    for (const [sectionKey, zone] of [["1,0", 0], ["7,-1", 1], ["14,-1", 2]]) {
        let total = 0;
        for (let seedIndex = 0; seedIndex < sampleCount; seedIndex++) {
            total += api.getMazeCoinCount(sectionKey, { seed: `ground-coin-average-${seedIndex}` });
        }
        const expectedAverage = 10 * 1.17 ** zone;
        assert.ok(
            Math.abs(total / sampleCount - expectedAverage) < 0.08,
            `${sectionKey} average should be approximately ${expectedAverage}`
        );
    }
});
