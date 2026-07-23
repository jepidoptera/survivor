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
        extractConst(source, "MAZE_ROOM_BASE_ENEMY_CAP"),
        extractConst(source, "MAZE_ROOM_BASE_ENEMY_CAP_RING"),
        extractConst(source, "MAZE_ROOM_ENEMY_DISTRIBUTION_POWER"),
        extractConst(source, "ENEMY_SCALE_RING_INTERVAL"),
        extractConst(source, "ENEMY_SCALE_INCREMENT"),
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
        "const constants = { MAZE_SECTION_DIRECTIONS, PYRAMID_FIRST_ROOM_DISTANCE, PYRAMID_ROOM_DISTANCE_STEP, MAZE_ROOM_EMPTY_ENEMY_CHANCE, MAZE_ROOM_MAX_ENEMY_CHANCE, MAZE_ROOM_BASE_ENEMY_CAP, MAZE_ROOM_BASE_ENEMY_CAP_RING, MAZE_ROOM_ENEMY_DISTRIBUTION_POWER, ENEMY_SCALE_RING_INTERVAL, ENEMY_SCALE_INCREMENT };",
        "const math = { hashString, seededRandom };",
        "const mazeSections = { isMazePyramidRoomSectionKey, isMazeInitialSafeSectionKey, parseMazeSectionKey, getMazeSectionRing };",
        extractFunction(mazePopulationSource, "validateMazeRoomEnemyBudgetSectionKey", "mazePopulation.js"),
        extractFunction(mazePopulationSource, "getMazeRoomMaxEnemyCount", "mazePopulation.js"),
        extractFunction(mazePopulationSource, "getEnemyScaleForMazeSectionKey", "mazePopulation.js"),
        extractFunction(mazePopulationSource, "getMazeRoomEnemyCount", "mazePopulation.js"),
        "globalThis.__testExports = { getMazeRoomEnemyCount, getMazeRoomMaxEnemyCount, getEnemyScaleForMazeSectionKey };"
    ];
    const context = { Math, Number, String };
    vm.createContext(context);
    vm.runInContext(pieces.join("\n"), context, { filename: "wizard-of-flatland-enemy-budget.js" });
    return context.__testExports;
}

test("Wizard of Flatland second ring rooms cap at two enemies", () => {
    const api = loadEnemyBudgetExports();
    const options = { seed: "second-ring-test" };
    const secondRingKeys = [
        "2,0",
        "2,-1",
        "1,1",
        "0,2",
        "-2,0",
        "-1,-1",
        "0,-2"
    ];

    for (const sectionKey of secondRingKeys) {
        assert.equal(api.getMazeRoomMaxEnemyCount(sectionKey), 2, `${sectionKey} should be capped at two enemies`);
        assert.ok(api.getMazeRoomEnemyCount(sectionKey, options) <= 2, `${sectionKey} spawned more than two enemies`);
    }
});

test("Wizard of Flatland room enemy caps increase by one per ring", () => {
    const api = loadEnemyBudgetExports();

    assert.equal(api.getMazeRoomMaxEnemyCount("3,0"), 3);
    assert.equal(api.getMazeRoomMaxEnemyCount("4,0"), 4);
});

test("Wizard of Flatland enemy scale increases ten percent per seven rings", () => {
    const api = loadEnemyBudgetExports();

    assert.equal(api.getEnemyScaleForMazeSectionKey("6,0"), 1);
    assert.equal(api.getEnemyScaleForMazeSectionKey("7,0"), 1.1);
    assert.equal(api.getEnemyScaleForMazeSectionKey("14,0"), 1.2);
});
