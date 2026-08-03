"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
    path.join(__dirname, "../public/wizard-of-flatland/main.js"),
    "utf8"
);

test("Wizard of Flatland trees ignite from fireballs and traps", () => {
    assert.match(source, /const TREE_MAX_HEALTH = 1000/);
    assert.match(source, /function detonateTrap[\s\S]*damageTreesIntersectingFireBlast\(trap\.x, trap\.y, stats\.explosionRadius, stats\.damage\)/);
    assert.match(source, /function detonateFireball[\s\S]*damageTreesIntersectingFireBlast\(fireball\.x, fireball\.y, fireball\.explosionRadius, fireball\.damage\)/);
    assert.match(source, /tree\.burnState\.health = Math\.max\(0, tree\.burnState\.health - damage\);[\s\S]*tree\.burnState\.burning = true/);
});

test("Wizard of Flatland burning trees lose 50 health per second and crumble for one second", () => {
    assert.match(source, /const TREE_BURN_DAMAGE_PER_SECOND = 50/);
    assert.match(source, /const TREE_CRUMBLE_SECONDS = 1/);
    assert.match(source, /burnState\.health = Math\.max\(0, burnState\.health - TREE_BURN_DAMAGE_PER_SECOND \* dt\)/);
    assert.match(source, /burnState\.crumbleAge >= TREE_CRUMBLE_SECONDS/);
    assert.match(source, /framePart\("burning trees", \(\) => updateBurningTrees\(dt\)\)/);
});

test("Wizard of Flatland tree flames and LOS blockers scale with burn damage", () => {
    assert.match(source, /const damageRatio = Math\.max\(0, Math\.min\(1, 1 - burnState\.health \/ TREE_MAX_HEALTH\)\)/);
    assert.match(source, /const flameRadius = treeRadius \* damageRatio \* crumbleScale/);
    assert.match(source, /const healthRatio = Math\.max\(0, Math\.min\(1, tree\.burnState\.health \/ TREE_MAX_HEALTH\)\)/);
    assert.match(source, /walls\[base \+ WALL_X1\] = tree\.centerX \+ \(walls\[base \+ WALL_X1\] - tree\.centerX\) \* scale/);
});

test("Wizard of Flatland advances tree blockers before requesting LOS", () => {
    const burnUpdate = source.indexOf('framePart("burning trees", () => updateBurningTrees(dt))');
    const losUpdate = source.indexOf('framePart("line of sight", () => updateLosAndExploration())');
    assert.ok(burnUpdate >= 0, "tree burn frame update exists");
    assert.ok(losUpdate >= 0, "LOS frame update exists");
    assert.ok(burnUpdate < losUpdate, "tree blocker revision must settle before the LOS request");
});

test("Wizard of Flatland tree fire uses orange and yellow diamond flames", () => {
    const drawTreeStart = source.indexOf("function drawLiveTreePolygons");
    const drawTreeEnd = source.indexOf("function getHomeBaseFloorLightStops", drawTreeStart);
    const drawTreeSource = source.slice(drawTreeStart, drawTreeEnd);
    assert.match(drawTreeSource, /ctx\.fillStyle = "rgba\(255,92,16,0\.86\)"[\s\S]*ctx\.moveTo\(0, 0\)[\s\S]*ctx\.lineTo\(sway, -height \* 2\)/);
    assert.match(drawTreeSource, /ctx\.fillStyle = "rgba\(255,209,72,0\.92\)"[\s\S]*ctx\.moveTo\(0, 0\)[\s\S]*ctx\.lineTo\(sway \* 0\.45, -height \* 1\.12\)/);
});

test("Wizard of Flatland tree flames grow and shrink over varied five-second lives", () => {
    assert.match(source, /const TREE_FLAME_LIFETIME_SECONDS = 5/);
    assert.match(source, /const TREE_FLAME_LIFETIME_VARIATION = 0\.2/);
    assert.match(source, /const lifeEnvelope = Math\.sin\(lifeProgress \* Math\.PI\)/);
    assert.match(source, /burnState\.flames\[flameIndex\] = createTreeFlameLifecycle\(flameIndex\)/);
    assert.match(source, /return \{\s*age: 0,/);
});

test("Wizard of Flatland tree fire grows to ten flames across the tree width", () => {
    assert.match(source, /const TREE_FLAME_MAX_COUNT = 10/);
    assert.match(source, /Math\.ceil\(damageRatio \* TREE_FLAME_MAX_COUNT\)/);
    assert.match(source, /const slotX = side \* \(0\.1 \+ pairIndex \* 0\.2\)/);
    assert.match(source, /const spread = treeRadius \* damageRatio/);
});

test("Wizard of Flatland diamond flames flicker and waver above a fixed bottom point", () => {
    assert.match(source, /const flicker = 0\.86 \+ Math\.sin\(phase \* 1\.9\) \* 0\.14/);
    assert.match(source, /const sway = Math\.sin\(phase \* 2\.3\) \* width \* 0\.24/);
    assert.match(source, /ctx\.moveTo\(0, 0\);\s*ctx\.lineTo\(-width, -height\);\s*ctx\.lineTo\(sway, -height \* 2\)/);
});
