const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const SPELL_LEVELS_PATH = path.join(__dirname, "../public/wizard-of-flatland/spell-levels.json");
const MAIN_PATH = path.join(__dirname, "../public/wizard-of-flatland/main.js");
const STYLES_PATH = path.join(__dirname, "../public/wizard-of-flatland/styles.css");
const FIREBALL_TEXTURE_PATH = path.join(__dirname, "../public/wizard-of-flatland/hi-fi-fireball.png");

function getFireballLevels() {
    const data = JSON.parse(fs.readFileSync(SPELL_LEVELS_PATH, "utf8"));
    const fireball = data.spells.find((spell) => spell.id === "fireball");
    assert.ok(fireball, "fireball spell level definition exists");
    return fireball.levels;
}

test("Wizard of Flatland fireball levels match the design table", () => {
    const levels = getFireballLevels();
    assert.deepEqual(
        levels.map((level) => ({
            level: level.level,
            damage: level.damage,
            manaCost: level.manaCost,
            explosionRadius: level.explosionRadius,
            projectileRadius: level.projectileRadius,
            castDelay: level.castDelay
        })),
        [
            { level: 1, damage: 10, manaCost: 20, explosionRadius: 1, projectileRadius: 0.4, castDelay: 0.75 },
            { level: 2, damage: 14, manaCost: 19, explosionRadius: 1.1, projectileRadius: 0.5, castDelay: 0.7 },
            { level: 3, damage: 20, manaCost: 17, explosionRadius: 1.25, projectileRadius: 0.62, castDelay: 0.65 },
            { level: 4, damage: 29, manaCost: 17, explosionRadius: 1.4, projectileRadius: 0.75, castDelay: 0.6 },
            { level: 5, damage: 41, manaCost: 16, explosionRadius: 1.8, projectileRadius: 0.9, castDelay: 0.55 },
            { level: 6, damage: 72, manaCost: 15, explosionRadius: 2.3, projectileRadius: 1.1, castDelay: 0.5 },
            { level: 7, damage: 100, manaCost: 12.5, explosionRadius: 3, projectileRadius: 1.37, castDelay: 0.4 }
        ]
    );
});

test("Wizard of Flatland fireball gameplay resolves level stats", () => {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    assert.match(source, /const getActiveFireballStats = spellDataSystem\.getActiveFireballStats/);
    assert.match(source, /spendWizardMagic\(fireballStats\.manaCost\)/);
    assert.match(source, /state\.spellCooldownRemaining = fireballStats\.cooldown/);
    assert.match(source, /fireball\.dirX \* fireball\.speed \* dt/);
    assert.match(source, /fireballStats\.projectileRadius/);
    assert.match(source, /findEarliestFireballWallHit\(previousX, previousY, nextX, nextY, fireball\.projectileRadius \* FIREBALL_WALL_HIT_RADIUS_SCALE\)/);
    assert.match(source, /damageAgentsIntersectingCircle\([\s\S]*?fireball\.x,[\s\S]*?fireball\.losSnapshot[\s\S]*?\)/);
    assert.match(source, /const losSnapshot = getCompletedSpellLosSnapshot\("fireball launch"\)/);
    assert.match(source, /projectileRadius: fireballStats\.projectileRadius,\s*losSnapshot/);
});

test("Wizard of Flatland spell hotkeys cannot select unlearned spells", () => {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    assert.match(
        source,
        /function setSelectedSpell\(spellId\) \{[\s\S]*?if \(getWizardSpellLevel\(id\) < 1\) return false;[\s\S]*?state\.selectedSpell = id;/
    );
});

test("Wizard of Flatland spell-level button stays visible when no upgrade is available", () => {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    assert.match(
        source,
        /const hasAvailableSpellUpgrade = state\.levelPoints > 0 && hasSpellBelowMaxLevel;[\s\S]*?expLevelUpButton\.classList\.remove\("hidden"\);[\s\S]*?expLevelUpButton\.classList\.toggle\("unavailable", !hasAvailableSpellUpgrade\);/
    );
    assert.match(
        source,
        /expLevelUpButton\.addEventListener\("click", showSpellLevelPanel\)/
    );
});

test("Wizard of Flatland spell-level panel closes on an outside pointer press", () => {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    assert.match(
        source,
        /document\.addEventListener\("pointerdown", \(event\) => \{[\s\S]*?spellLevelPanel\.contains\(event\.target\)[\s\S]*?expLevelUpButton\.contains\(event\.target\)[\s\S]*?hideSpellLevelPanel\(\);[\s\S]*?\}\);/
    );
});

test("Wizard of Flatland spell-level header summarizes player progression", () => {
    const panelSource = fs.readFileSync(
        path.join(__dirname, "../public/wizard-of-flatland/spellLevelPanel.js"),
        "utf8"
    );
    const indexSource = fs.readFileSync(
        path.join(__dirname, "../public/wizard-of-flatland/index.html"),
        "utf8"
    );
    const styles = fs.readFileSync(STYLES_PATH, "utf8");
    assert.match(
        panelSource,
        /Object\.values\(spellLevels\)\.reduce\(\(total, level\) => total \+ level, state\.levelPoints\)/
    );
    assert.match(panelSource, /api\.getHighestVisitedMazeZone\(\)/);
    assert.match(panelSource, /spellLevelPointCoin\.classList\.toggle\("unavailable", state\.levelPoints === 0\)/);
    assert.match(indexSource, /id="spellLevelPlayerName"[\s\S]*?id="spellLevelTotalLevel"[\s\S]*?id="spellLevelHighestZone"[\s\S]*?id="spellLevelPointCoin"/);
    assert.match(indexSource, /class="spellLevelPointCountGraphic"[\s\S]*?id="spellLevelPointCount" x="50" y="45"/);
    assert.match(styles, /\.spellLevelPointCoin\s*\{[\s\S]*?border-radius: 50%[\s\S]*?radial-gradient/);
    assert.match(styles, /\.spellLevelPointCoin\.unavailable\s*\{[\s\S]*?radial-gradient/);
    assert.match(styles, /\.spellLevelPointCountGraphic text\s*\{[\s\S]*?dominant-baseline: central;[\s\S]*?text-anchor: middle;[\s\S]*?text-shadow:/);
});

test("Wizard of Flatland magic recharge level 0 explains the baseline recharge time", () => {
    const panelSource = fs.readFileSync(
        path.join(__dirname, "../public/wizard-of-flatland/spellLevelPanel.js"),
        "utf8"
    );
    assert.match(
        panelSource,
        /spellId !== "magicrecharge"[\s\S]*?At level 0, magic fully recharges in \$\{secondsToFullMagic\} seconds\./
    );
    assert.match(
        fs.readFileSync(MAIN_PATH, "utf8"),
        /constants:\s*\{[\s\S]*?SPELL_LEVEL_STAT_LABELS,\s*WIZARD_MAGIC_RECHARGE_SECONDS_LEVEL_0/
    );
});

test("Wizard of Flatland requires a first spell upgrade before a new game starts", () => {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    const styles = fs.readFileSync(STYLES_PATH, "utf8");
    assert.match(
        source,
        /state\.spellLevels = Object\.fromEntries\([\s\S]*?state\.levelPoints = 1;[\s\S]*?state\.initialSpellChoiceRequired = true;[\s\S]*?showSpellLevelPanel\(\);/
    );
    assert.match(
        source,
        /if \(state\.initialSpellChoiceRequired\) \{[\s\S]*?state\.initialSpellChoiceRequired = false;[\s\S]*?hideSpellLevelPanel\(\);[\s\S]*?closeStartupMenu\(\);/
    );
    assert.match(styles, /\.startupMenu\.choosingInitialSpell\s*\{\s*background: #000000;/);
    assert.match(styles, /#spellLevelPanel\.initialSpellChoice\s*\{[\s\S]*?left: 50%;[\s\S]*?top: 50%;[\s\S]*?translate\(-50%, -50%\)/);
});

test("Wizard of Flatland new games begin at ten health", () => {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    assert.match(source, /const WIZARD_NEW_GAME_STARTING_HEALTH = 10;/);
    assert.match(
        source,
        /async function startNewWizardGame\(playerName\)[\s\S]*?createScenario\(\);[\s\S]*?state\.wizardVitals\.health = WIZARD_NEW_GAME_STARTING_HEALTH;[\s\S]*?updateStatusBars\(\);/
    );
});

test("Wizard of Flatland fireballs use the copied main-game animation sheet", () => {
    assert.ok(fs.existsSync(FIREBALL_TEXTURE_PATH), "copied fireball spritesheet exists");
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    assert.match(source, /const FIREBALL_ANIMATION_TEXTURE_PATH = "\/wizard-of-flatland\/hi-fi-fireball\.png"/);
    assert.match(source, /const FIREBALL_ANIMATION_FRAME_COLUMNS = 5/);
    assert.match(source, /const FIREBALL_ANIMATION_FRAME_ROWS = 2/);
    assert.match(source, /function drawAnimatedFireball\(fireball\)/);
    assert.match(source, /const animationRadius = fireball\.impactActive \? fireball\.explosionRadius : fireball\.projectileRadius/);
    assert.match(source, /const drawSize = animationRadius \* 2 \* state\.view\.scale/);
    assert.match(source, /ctx\.drawImage\(/);
});

test("Wizard of Flatland fireball impact finishes remaining animation at 10x", () => {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    assert.match(source, /const FIREBALL_IMPACT_ANIMATION_SPEED_MULTIPLIER = 10/);
    assert.match(source, /impactActive: false/);
    assert.match(source, /if \(fireball\.impactActive\) \{/);
    assert.match(source, /fireball\.age \+= dt \* FIREBALL_IMPACT_ANIMATION_SPEED_MULTIPLIER/);
    assert.match(source, /if \(fireball\.impactActive\) return/);
    assert.match(source, /fireball\.impactActive = true/);
});
