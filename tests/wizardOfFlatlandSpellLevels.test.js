const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const SPELL_LEVELS_PATH = path.join(__dirname, "../public/wizard-of-flatland/spell-levels.json");
const MAIN_PATH = path.join(__dirname, "../public/wizard-of-flatland/main.js");
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
            { level: 1, damage: 9, manaCost: 10, explosionRadius: 1, projectileRadius: 0.4, castDelay: 1 },
            { level: 2, damage: 12, manaCost: 9.5, explosionRadius: 1.1, projectileRadius: 0.5, castDelay: 0.9 },
            { level: 3, damage: 16, manaCost: 9, explosionRadius: 1.25, projectileRadius: 0.62, castDelay: 0.8 },
            { level: 4, damage: 21, manaCost: 8.5, explosionRadius: 1.4, projectileRadius: 0.75, castDelay: 0.7 },
            { level: 5, damage: 50, manaCost: 8, explosionRadius: 1.8, projectileRadius: 0.9, castDelay: 0.6 },
            { level: 6, damage: 72, manaCost: 7.5, explosionRadius: 2.3, projectileRadius: 1.1, castDelay: 0.5 },
            { level: 7, damage: 100, manaCost: 7, explosionRadius: 3, projectileRadius: 1.37, castDelay: 0.4 }
        ]
    );
});

test("Wizard of Flatland fireball gameplay resolves level stats", () => {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    assert.match(source, /function getActiveFireballStats\(\)/);
    assert.match(source, /spendWizardMagic\(fireballStats\.manaCost\)/);
    assert.match(source, /state\.spellCooldownRemaining = fireballStats\.cooldown/);
    assert.match(source, /fireball\.dirX \* fireball\.speed \* dt/);
    assert.match(source, /fireballStats\.projectileRadius/);
    assert.match(source, /findEarliestFireballWallHit\(previousX, previousY, nextX, nextY, fireball\.projectileRadius\)/);
    assert.match(source, /damageAgentsIntersectingCircle\(fireball\.x, fireball\.y, fireball\.explosionRadius, fireball\.damage\)/);
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
