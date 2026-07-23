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

function loadPyramidRoomExports() {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    const mathSource = fs.readFileSync(MATH_PATH, "utf8");
    const mazeSectionsSource = fs.readFileSync(MAZE_SECTIONS_PATH, "utf8");
    const mazePopulationSource = fs.readFileSync(MAZE_POPULATION_PATH, "utf8");
    const pieces = [
        extractConst(source, "PYRAMID_FIRST_ROOM_DISTANCE"),
        extractConst(source, "PYRAMID_ROOM_DISTANCE_STEP"),
        "const MAZE_SECTION_DIRECTIONS = [{ q: 1, r: 0 }, { q: 0, r: 1 }, { q: -1, r: 1 }, { q: -1, r: 0 }, { q: 0, r: -1 }, { q: 1, r: -1 }];",
        extractConst(source, "MAZE_ROOM_EMPTY_ENEMY_CHANCE"),
        extractConst(source, "MAZE_ROOM_MAX_ENEMY_CHANCE"),
        extractConst(source, "MAZE_ROOM_BASE_ENEMY_CAP"),
        extractConst(source, "MAZE_ROOM_BASE_ENEMY_CAP_RING"),
        extractConst(source, "MAZE_ROOM_ENEMY_DISTRIBUTION_POWER"),
        extractConst(source, "ENEMY_SCALE_RING_INTERVAL"),
        extractConst(source, "ENEMY_SCALE_INCREMENT"),
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
        extractFunction(mazePopulationSource, "getMazeRoomEnemyCount", "mazePopulation.js"),
        extractFunction(mazePopulationSource, "createMazeCoinsForSection", "mazePopulation.js"),
        "globalThis.__testExports = { PYRAMID_FIRST_ROOM_DISTANCE, PYRAMID_ROOM_DISTANCE_STEP, getMazePyramidRoomDistance, isMazePyramidRoomSectionKey, getMazeRoomEnemyCount, createMazeCoinsForSection };"
    ];
    const context = { Math, Number, String };
    vm.createContext(context);
    vm.runInContext(pieces.join("\n"), context, { filename: "wizard-of-flatland-pyramid-rooms.js" });
    return context.__testExports;
}

test("Wizard of Flatland pyramid rooms generate no coins or enemies", () => {
    const api = loadPyramidRoomExports();
    const options = { seed: "pyramid-room-contents" };

    assert.equal(api.PYRAMID_FIRST_ROOM_DISTANCE, 8);
    assert.equal(api.PYRAMID_ROOM_DISTANCE_STEP, 7);
    assert.equal(api.isMazePyramidRoomSectionKey("0,0"), true);
    assert.equal(api.isMazePyramidRoomSectionKey("8,0"), true);
    assert.equal(api.isMazePyramidRoomSectionKey("0,8"), true);
    assert.equal(api.isMazePyramidRoomSectionKey("-8,8"), true);
    assert.equal(api.isMazePyramidRoomSectionKey("-8,0"), true);
    assert.equal(api.isMazePyramidRoomSectionKey("0,-8"), true);
    assert.equal(api.isMazePyramidRoomSectionKey("8,-8"), true);
    assert.equal(api.getMazePyramidRoomDistance(15, 0), 15);
    assert.equal(api.isMazePyramidRoomSectionKey("14,0"), false);
    assert.equal(api.isMazePyramidRoomSectionKey("8,1"), false);

    assert.equal(api.createMazeCoinsForSection("8,0", options, []).length, 0);
    assert.equal(api.getMazeRoomEnemyCount("8,0", options), 0);
});
