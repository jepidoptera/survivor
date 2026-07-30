const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const MAIN_PATH = path.join(__dirname, "../public/wizard-of-flatland/main.js");
const STYLES_PATH = path.join(__dirname, "../public/wizard-of-flatland/styles.css");
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
        extractConst(source, "MAZE_ROOM_EARLY_ENEMY_CAPS"),
        extractConst(source, "MAZE_ROOM_ENEMY_DISTRIBUTION_POWER"),
        extractConst(source, "ENEMY_SCALE_RING_INTERVAL"),
        extractConst(source, "ENEMY_SCALE_INCREMENT"),
        extractConst(source, "MAZE_PYRAMID_COIN_COUNT"),
        extractFunction(mathSource, "hashString", "flatlandMath.js"),
        extractFunction(mathSource, "seededRandom", "flatlandMath.js"),
        extractFunction(mazeSectionsSource, "validateMazeSectionKey", "mazeSections.js"),
        extractFunction(mazeSectionsSource, "parseMazeSectionKey", "mazeSections.js"),
        extractFunction(mazeSectionsSource, "isMazePyramidRoomSectionKey", "mazeSections.js"),
        extractFunction(mazeSectionsSource, "isMazePyramidRoomSectionCoord", "mazeSections.js"),
        extractFunction(mazeSectionsSource, "getMazePyramidRoomDistance", "mazeSections.js"),
        extractFunction(mazeSectionsSource, "isMazeInitialSafeSectionKey", "mazeSections.js"),
        extractFunction(mazeSectionsSource, "getMazeSectionRing", "mazeSections.js"),
        "const constants = { MAZE_SECTION_DIRECTIONS, PYRAMID_FIRST_ROOM_DISTANCE, PYRAMID_ROOM_DISTANCE_STEP, MAZE_ROOM_EMPTY_ENEMY_CHANCE, MAZE_ROOM_MAX_ENEMY_CHANCE, MAZE_ROOM_EARLY_ENEMY_CAPS, MAZE_ROOM_ENEMY_DISTRIBUTION_POWER, ENEMY_SCALE_RING_INTERVAL, ENEMY_SCALE_INCREMENT, MAZE_PYRAMID_COIN_COUNT };",
        "const math = { hashString, seededRandom };",
        "const mazeSections = { isMazePyramidRoomSectionKey, isMazeInitialSafeSectionKey, parseMazeSectionKey, getMazeSectionRing };",
        extractFunction(mazePopulationSource, "validateMazeRoomEnemyBudgetSectionKey", "mazePopulation.js"),
        extractFunction(mazePopulationSource, "getMazeRoomMaxEnemyCount", "mazePopulation.js"),
        extractFunction(mazePopulationSource, "getMazeRoomEnemyCount", "mazePopulation.js"),
        extractFunction(mazePopulationSource, "getMazeCoinCount", "mazePopulation.js"),
        "globalThis.__testExports = { PYRAMID_FIRST_ROOM_DISTANCE, PYRAMID_ROOM_DISTANCE_STEP, getMazePyramidRoomDistance, isMazePyramidRoomSectionKey, getMazeRoomEnemyCount, getMazeCoinCount };"
    ];
    const context = { Math, Number, String };
    vm.createContext(context);
    vm.runInContext(pieces.join("\n"), context, { filename: "wizard-of-flatland-pyramid-rooms.js" });
    return context.__testExports;
}

function loadPyramidLightExports() {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    const pieces = [
        extractConst(source, "FLOOR_HOME_BASE_LIGHT_SECTION_DISTANCE"),
        extractConst(source, "FLOOR_HOME_BASE_LIGHT_BRIGHTNESS"),
        extractConst(source, "FLOOR_HOME_BASE_LIGHT_MIN_VIEWPORT_EXAGGERATION_SECTIONS"),
        extractConst(source, "FLOOR_HOME_BASE_LIGHT_MAX_VIEWPORT_EXAGGERATION_SECTIONS"),
        extractFunction(source, "getHomeBaseFloorLightStops"),
        "globalThis.__testExports = { getHomeBaseFloorLightStops };"
    ];
    const context = { Math, Number, Set };
    vm.createContext(context);
    vm.runInContext(pieces.join("\n"), context, { filename: "wizard-of-flatland-pyramid-light.js" });
    return context.__testExports;
}

function countPyramidsOnRing(api, ring) {
    let count = 0;
    for (let q = -ring; q <= ring; q += 1) {
        for (let r = -ring; r <= ring; r += 1) {
            if (Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r)) !== ring) continue;
            if (api.getMazePyramidRoomDistance(q, r) === ring) count += 1;
        }
    }
    return count;
}

test("Wizard of Flatland floor zones follow a dark, perceptually even rainbow", () => {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    assert.match(source, /const FLOOR_CENTER_COLOR = "#303030";/);
    assert.match(source, /const FLOOR_RED_COLOR = "#5e0906";/);
    assert.match(source, /const FLOOR_ORANGE_COLOR = "#482706";/);
    assert.match(source, /const FLOOR_YELLOW_COLOR = "#373006";/);
    assert.match(source, /const FLOOR_GREEN_COLOR = "#073b0f";/);
    assert.match(source, /const FLOOR_BLUE_COLOR = "#052b69";/);
    assert.match(source, /const FLOOR_PURPLE_COLOR = "#3e0b6f";/);
});

test("Wizard of Flatland pyramid light increases floor saturation with its brightness", () => {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    const drawSource = extractFunction(source, "drawHomeBaseFloorLight");
    assert.match(
        drawSource,
        /saturationGradient\.addColorStop\(position, `rgba\(255,0,0,\$\{stop\.brightness\}\)`\)/
    );
    assert.match(
        drawSource,
        /globalCompositeOperation = "saturation"[\s\S]*?fillStyle = saturationGradient;[\s\S]*?fill\(\)[\s\S]*?globalCompositeOperation = "lighter"[\s\S]*?fillStyle = lightGradient;[\s\S]*?fill\(\)/
    );
    assert.match(drawSource, /requires saturation compositing/);
});

test("Wizard of Flatland darkens three rooms around non-activated pyramids", () => {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    const drawSource = extractFunction(source, "drawInactivePyramidFloorDarkness");
    const gradientSource = extractFunction(source, "drawInactivePyramidFloorDarknessGradient");
    assert.match(source, /const FLOOR_INACTIVE_PYRAMID_DARKNESS_SECTION_DISTANCE = 3;/);
    assert.match(source, /const FLOOR_INACTIVE_PYRAMID_DARKNESS = 0\.5;/);
    assert.match(
        drawSource,
        /getMazePyramidRoomDistance\(q, r\) === null\) continue;/
    );
    assert.match(drawSource, /state\.activatedTalismanSectionKeys\.has\(sectionKey\)\) continue;/);
    assert.doesNotMatch(drawSource, /state\.talismans/);
    assert.match(gradientSource, /gradient\.addColorStop\(0, `rgba\(0,0,0,\$\{FLOOR_INACTIVE_PYRAMID_DARKNESS\}\)`\)/);
    assert.match(gradientSource, /gradient\.addColorStop\(1, "rgba\(0,0,0,0\)"\)/);
});

test("Wizard of Flatland increases visible pyramid-light exaggeration from one to three rooms", () => {
    const { getHomeBaseFloorLightStops } = loadPyramidLightExports();
    const maxBrightness = 0.5;
    const radius = 7;
    const exaggerationBrightnessAt = (centerDistance) =>
        maxBrightness * (1 + 2 * centerDistance / radius) / radius;
    const normalBrightness = (distance) => maxBrightness * (1 - distance / radius);
    const closeView = getHomeBaseFloorLightStops(radius, 2, 3, 4);
    const wideView = getHomeBaseFloorLightStops(radius, 1, 3, 5);
    const brightnessAt = (stops, distance) =>
        stops.find((stop) => stop.distance === distance).brightness;

    assert.ok(Math.abs(brightnessAt(closeView, 2) - (normalBrightness(2) + exaggerationBrightnessAt(3))) < 1e-12);
    assert.ok(Math.abs(brightnessAt(closeView, 3) - normalBrightness(3)) < 1e-12);
    assert.ok(Math.abs(brightnessAt(closeView, 4) - (normalBrightness(4) - exaggerationBrightnessAt(3))) < 1e-12);
    assert.equal(brightnessAt(wideView, 1), maxBrightness);
    assert.ok(Math.abs(brightnessAt(wideView, 5) - (normalBrightness(5) - exaggerationBrightnessAt(3))) < 1e-12);
    const pyramidView = getHomeBaseFloorLightStops(radius, 0, 0, 1);
    assert.ok(Math.abs(brightnessAt(pyramidView, 1) - (normalBrightness(1) - maxBrightness / radius)) < 1e-12);
    const outerEdgeView = getHomeBaseFloorLightStops(radius, 6, 7, 8);
    assert.ok(Math.abs(brightnessAt(outerEdgeView, 6) - (normalBrightness(6) + 3 * maxBrightness / radius)) < 1e-12);
    assert.equal(brightnessAt(getHomeBaseFloorLightStops(radius, 0, 0, 7), 0), maxBrightness);
    assert.equal(brightnessAt(getHomeBaseFloorLightStops(radius, 0, 6, 7), 7), 0);
});

test("Wizard of Flatland pyramid rooms generate fourteen coins and no enemies", () => {
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
    assert.equal(api.isMazePyramidRoomSectionKey("8,7"), true);
    assert.equal(api.getMazePyramidRoomDistance(8, 7), 15);
    assert.equal(api.isMazePyramidRoomSectionKey("8,8"), false);
    assert.equal(api.isMazePyramidRoomSectionKey("14,0"), false);
    assert.equal(api.isMazePyramidRoomSectionKey("8,1"), false);
    assert.equal(countPyramidsOnRing(api, 8), 6);
    assert.equal(countPyramidsOnRing(api, 15), 12);
    assert.equal(countPyramidsOnRing(api, 22), 18);

    assert.equal(api.getMazeCoinCount("0,0", options), 14);
    assert.equal(api.getMazeCoinCount("8,0", options), 14);
    assert.equal(api.getMazeCoinCount("-15,15", options), 14);
    assert.equal(api.getMazeRoomEnemyCount("8,0", options), 0);
    const populationSource = fs.readFileSync(MAZE_POPULATION_PATH, "utf8");
    assert.match(
        populationSource,
        /function shouldCreateMazeTrophyForCoin\(sectionKey, coinKey\) \{\s*if \(mazeSections\.isMazePyramidRoomSectionKey\(sectionKey\)\) return false;/
    );
});

test("Wizard of Flatland labels the untouched opening pyramid", () => {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    assert.match(
        source,
        /talisman\.pyramidDistance === 0[\s\S]*?!state\.activatedTalismanSectionKeys\.has\(talisman\.sectionKey\)/
    );
    assert.match(
        source,
        /drawInitialTalismanPrompt\(projection, radius, "touch the pyramid"\)/
    );
    assert.match(
        source,
        /function drawInitialTalismanPrompt\(projection, radius, message\)[\s\S]*?strokeText\(message[\s\S]*?fillText\(message/
    );
});

test("Wizard of Flatland confirms the opening-pyramid save for three seconds", () => {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    assert.match(source, /const TALISMAN_GAME_SAVED_PROMPT_SECONDS = 3;/);
    assert.match(
        source,
        /saveWizardCheckpointToSlot\(\)[\s\S]*?talisman\.gameSavedPromptSeconds = TALISMAN_GAME_SAVED_PROMPT_SECONDS;/
    );
    assert.match(
        source,
        /talisman\.gameSavedPromptSeconds = Math\.max\(0, talisman\.gameSavedPromptSeconds - dt\);/
    );
    assert.match(
        source,
        /talisman\.gameSavedPromptSeconds > 0[\s\S]*?drawInitialTalismanPrompt\(projection, radius, "game saved"\)/
    );
});

test("Wizard of Flatland flashes restored talisman vitals and warns on low health", () => {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    const styles = fs.readFileSync(STYLES_PATH, "utf8");
    assert.match(source, /healthBar\.classList\.toggle\("lowHealthWarning", healthRatio < 0\.2\);/);
    assert.match(
        source,
        /const restoredHealth = state\.wizardVitals\.health < state\.wizardVitals\.maxHealth;[\s\S]*?const restoredMagic = state\.wizardVitals\.magic < state\.wizardVitals\.maxMagic;[\s\S]*?if \(restoredHealth\) flashTalismanRestoredBar\(healthBar\);[\s\S]*?if \(restoredMagic\) flashTalismanRestoredBar\(magicBar\);/
    );
    assert.match(styles, /#healthBar\.lowHealthWarning\s*\{\s*animation: lowHealthWarningPulse 1s ease-in-out infinite;/);
    assert.match(styles, /@keyframes lowHealthWarningPulse\s*\{[\s\S]*?0%,[\s\S]*?100%[\s\S]*?50%/);
    assert.match(styles, /\.statusBar-fill\.talismanRechargeFlash\s*\{\s*animation: talismanRechargeFlash/);
});
