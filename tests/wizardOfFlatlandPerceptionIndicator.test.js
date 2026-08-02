const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const MAIN_PATH = path.join(__dirname, "../public/wizard-of-flatland/main.js");

test("Wizard of Flatland level-one perception draws the active-enemy quota indicator", () => {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    assert.match(source, /function drawPerceptionEnemyIndicator\(\)/);
    assert.match(source, /getWizardSpellLevel\("omnivision"\) < 1/);
    assert.match(source, /agent\.activated === true/);
    assert.match(source, /getMazeRoomMaxEnemyCount\(sectionKey\)/);
    assert.match(source, /drawPerceptionNavigationIndicators\(\);\s*drawPerceptionEnemyIndicator\(\);/);
});

test("Wizard of Flatland level-two perception points to fountains and pyramids outside their sections", () => {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    assert.match(source, /function drawPerceptionNavigationIndicators\(\)[\s\S]*?getWizardSpellLevel\("omnivision"\) < 2/);
    assert.match(source, /nearest\.sectionKey === playerSectionKey/);
    assert.match(source, /function getNearestPyramidIndicatorTarget\(playerCoord\)/);
    assert.match(source, /getMazePyramidRoomDistance\(playerCoord\.q, playerCoord\.r\) !== null/);
    assert.match(source, /drawPerceptionFountainIndicator\(playerSectionKey\);\s*drawPerceptionPyramidIndicator\(playerCoord, playerSectionKey\);/);
});

test("Wizard of Flatland perception indicator has green, yellow-to-red, and over-quota flash states", () => {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    assert.match(source, /activeEnemies === 0[\s\S]*?rgb\(32, 210, 88\)/);
    assert.match(source, /activeEnemies > maxPerRoom[\s\S]*?Math\.sin\(nowSeconds \* Math\.PI \* 2\)/);
    assert.match(source, /\(activeEnemies - 1\) \/ \(maxPerRoom - 1\)/);
    assert.match(source, /Math\.round\(214 \* \(1 - redProgress\)\)/);
});
