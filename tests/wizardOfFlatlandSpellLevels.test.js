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
            { level: 1, damage: 10, manaCost: 8, explosionRadius: 1, projectileRadius: 0.4, castDelay: 0.7 },
            { level: 2, damage: 14, manaCost: 9, explosionRadius: 1.1, projectileRadius: 0.5, castDelay: 0.65 },
            { level: 3, damage: 20, manaCost: 10, explosionRadius: 1.25, projectileRadius: 0.62, castDelay: 0.6 },
            { level: 4, damage: 29, manaCost: 11, explosionRadius: 1.4, projectileRadius: 0.75, castDelay: 0.55 },
            { level: 5, damage: 41, manaCost: 12, explosionRadius: 1.8, projectileRadius: 0.9, castDelay: 0.5 },
            { level: 6, damage: 72, manaCost: 13, explosionRadius: 2.3, projectileRadius: 1.1, castDelay: 0.45 },
            { level: 7, damage: 100, manaCost: 14, explosionRadius: 3, projectileRadius: 1.37, castDelay: 0.4 }
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
        /function setSelectedSpell\(spellId\) \{[\s\S]*?const learnedLevel = id === "destructobeam"[\s\S]*?if \(learnedLevel < \(id === "destructobeam" \? 2 : 1\)\) return false;[\s\S]*?state\.selectedSpell = id;/
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

test("Wizard of Flatland B+T selects learned construction", () => {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    assert.match(source, /state\.buildTrapChord\.b && state\.buildTrapChord\.t/);
    assert.match(source, /setSelectedSpell\("construction"\)/);
    assert.match(source, /spellId === "construction"/);
    assert.match(source, /state\.selectedSpell === "construction"[\s\S]*TRAP_ICON_PATH/);
    assert.match(source, /state\.selectedSpell === "construction"[\s\S]*startTrapBuild\(\)/);
    assert.match(source, /function updateTraps\(dt\)/);
    assert.match(source, /state\.wizardVitals\.exp < coinCost/);
    assert.match(source, /state\.wizardVitals\.exp -= coinCost;[\s\S]*updateStatusBars\(\)/);
    assert.match(source, /state\.wizardVitals\.magic < manaCost/);
    assert.match(source, /spendWizardMagic\(manaCost\)/);
    assert.match(source, /build\.x = cursor\.x;[\s\S]*build\.y = cursor\.y;[\s\S]*build\.age \+= dt/);
    assert.match(source, /TRAP_TRIGGER_DELAY_SECONDS = 0\.05/);
    assert.match(source, /function scheduleTrapDetonation\(trap\)[\s\S]*trap\.triggerDelayRemaining = TRAP_TRIGGER_DELAY_SECONDS/);
    assert.match(source, /trap\.triggerDelayRemaining -= dt;[\s\S]*detonateTrap\(trap\)/);
    assert.match(source, /function detonateTrap\(trap\)[\s\S]*state\.agents = state\.agents\.filter[\s\S]*damageAgentAndMaybeDropCoin[\s\S]*createFireDeathEffect[\s\S]*return !killed/);
    assert.match(source, /function detonateTrap\(trap\)[\s\S]*damageWizardIntersectingFireballBlast\(trap\.x, trap\.y, stats\.explosionRadius, stats\.damage\)/);
});

test("Wizard of Flatland trap uses a nine-point skip-two star", () => {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    assert.match(source, /step < 9; step \+= 1, index = \(index \+ 2\) % 9/);
    const icon = fs.readFileSync(path.join(__dirname, "../public/assets/images/thumbnails/trap.svg"), "utf8");
    const polygon = icon.match(/<polygon points="([^"]+)"/);
    assert.ok(polygon);
    assert.equal(polygon[1].trim().split(/\s+/).length, 9);
    assert.match(icon, /<circle cx="50" cy="50" r="38"/);
    assert.match(source, /ctx\.arc\(x, y, radius \* 0\.83/);
});

test("every Wizard of Flatland construction level upgrades its trap fireball", () => {
    const data = JSON.parse(fs.readFileSync(SPELL_LEVELS_PATH, "utf8"));
    const construction = data.spells.find((spell) => spell.id === "construction");
    assert.ok(construction);
    assert.deepEqual(construction.levels.map((level) => level.buildings.trap.fireballLevel), [1, 2, 3, 4, 5, 6, 7]);
    assert.deepEqual(construction.levels.map((level) => level.buildings.trap.buildTime), [2, 1.6, 1.4, 1.2, 1, 0.8, 0.6]);
    assert.ok(construction.levels.every((level) => level.buildings.trap.coinCost === 1 && level.buildings.trap.manaCost === 10));
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    assert.match(source, /const coinCost = stats\.coinCost/);
    assert.match(source, /const manaCost = stats\.manaCost/);
    assert.match(source, /levelStats\.buildings\.trap/);
    assert.match(source, /duration: stats\.buildTime/);
});

test("Wizard of Flatland X selects the level-two destructo beam and space channels it", () => {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    assert.match(source, /event\.code === "KeyX"[\s\S]*setSelectedSpell\("destructobeam"\)/);
    assert.match(source, /id === "destructobeam"[\s\S]*getWizardSpellLevel\("construction"\)/);
    assert.match(source, /state\.selectedSpell === "destructobeam"[\s\S]*DESTRUCTO_BEAM_ICON_PATH/);
    assert.match(source, /beam\.held = state\.spaceHeld && state\.selectedSpell === "destructobeam"/);
    assert.match(source, /function updateDestructoBeam\(dt\)[\s\S]*spendWizardMagic\(stats\.costPerSecond \* dt\)[\s\S]*beam\.progress \+= dt/);
    assert.match(source, /getDestructoBeamTargetSegment\(hit\.wallIndex, hit\.x, hit\.y\)[\s\S]*breakWallSegmentForAgent\(\{ id: "destructo-beam" \}, segment\)/);
    assert.match(source, /const colors = \["#ff3030", "#35a7ff", "#38e06f"\]/);
    assert.match(source, /if \(!beam\.held \|\| !Number\.isFinite\(beam\.hitX\) \|\| !Number\.isFinite\(beam\.hitY\)\) return/);
    assert.match(source, /wave \* Math\.PI \* 2 \/ 3 - beam\.progress \* 12/);
    assert.match(source, /ctx\.shadowColor = colors\[wave\][\s\S]*ctx\.shadowBlur = Math\.max\(7, state\.view\.scale \* 0\.18\)/);
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

test("Wizard of Flatland loads spell definitions before starting gameplay", () => {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    assert.match(
        source,
        /async function startNewWizardGame\(playerName\)[\s\S]*?await fetchSpellLevelDefinitions\(\);[\s\S]*?closeStartupMenu\(\);/
    );
    assert.match(
        source,
        /async function loadWizardGame\(playerName\)[\s\S]*?await fetchSpellLevelDefinitions\(\);[\s\S]*?applyWizardCheckpointSnapshot\(snapshot\);[\s\S]*?closeStartupMenu\(\);/
    );
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
