const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const SPELL_DATA_PATH = path.join(__dirname, "../public/wizard-of-flatland/spellData.js");
const SPELL_LEVELS_PATH = path.join(__dirname, "../public/wizard-of-flatland/spell-levels.json");
const MAIN_PATH = path.join(__dirname, "../public/wizard-of-flatland/main.js");

function loadSpellDataApi(payload) {
    const context = {
        window: {},
        fetch: async () => ({
            ok: true,
            json: async () => payload
        }),
        console
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(SPELL_DATA_PATH, "utf8"), context, { filename: SPELL_DATA_PATH });
    return context.window.WizardFlatlandSpellData;
}

test("Wizard of Flatland healing stats resolve from the spell level table", async () => {
    const payload = JSON.parse(fs.readFileSync(SPELL_LEVELS_PATH, "utf8"));
    const api = loadSpellDataApi(payload);
    const state = {
        spellLevels: {
            healing: 3
        }
    };
    const system = api.createSpellDataSystem({
        state,
        constants: {
            SPELL_LEVEL_DATA_URL: "/wizard-of-flatland/spell-levels.json",
            SPELL_LEVEL_MIN: 0,
            SPELL_LEVEL_MAX: 7
        }
    });

    await system.fetchSpellLevelDefinitions();

    const stats = system.getActiveHealingStats();
    assert.equal(stats.level, 3);
    assert.equal(stats.secondsToFullHealth, 26);
    assert.equal(Object.prototype.hasOwnProperty.call(stats, "healthPerSecond"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(stats, "costPerSecond"), false);
});

test("Wizard of Flatland healing levels measure seconds to full health", () => {
    const payload = JSON.parse(fs.readFileSync(SPELL_LEVELS_PATH, "utf8"));
    const healing = payload.spells.find((spell) => spell.id === "healing");
    assert.ok(healing, "healing spell level definition exists");

    assert.deepEqual(
        healing.levels.map((level) => ({
            level: level.level,
            secondsToFullHealth: level.secondsToFullHealth
        })),
        [
            { level: 1, secondsToFullHealth: 50 },
            { level: 2, secondsToFullHealth: 36 },
            { level: 3, secondsToFullHealth: 26 },
            { level: 4, secondsToFullHealth: 18.5 },
            { level: 5, secondsToFullHealth: 13.5 },
            { level: 6, secondsToFullHealth: 9.5 },
            { level: 7, secondsToFullHealth: 7 }
        ]
    );

    for (const level of healing.levels) {
        assert.equal(Object.prototype.hasOwnProperty.call(level, "healthPerSecond"), false);
    }
});

test("Wizard of Flatland healing levels do not define a mana cost", () => {
    const payload = JSON.parse(fs.readFileSync(SPELL_LEVELS_PATH, "utf8"));
    const healing = payload.spells.find((spell) => spell.id === "healing");
    assert.ok(healing, "healing spell level definition exists");

    for (const level of healing.levels) {
        assert.equal(Object.prototype.hasOwnProperty.call(level, "costPerSecond"), false);
        assert.equal(Object.prototype.hasOwnProperty.call(level, "manaCost"), false);
    }
});

test("Wizard of Flatland magic recharge levels measure seconds to full magic", async () => {
    const payload = JSON.parse(fs.readFileSync(SPELL_LEVELS_PATH, "utf8"));
    const api = loadSpellDataApi(payload);
    const state = {
        spellLevels: {
            magicrecharge: 0
        }
    };
    const system = api.createSpellDataSystem({
        state,
        constants: {
            SPELL_LEVEL_DATA_URL: "/wizard-of-flatland/spell-levels.json",
            SPELL_LEVEL_MIN: 0,
            SPELL_LEVEL_MAX: 7,
            WIZARD_MAGIC_RECHARGE_SECONDS_LEVEL_0: 14
        }
    });

    await system.fetchSpellLevelDefinitions();

    let stats = system.getMagicRechargeStats();
    assert.equal(stats.level, 0);
    assert.equal(stats.secondsToFullMagic, 14);

    const magicRecharge = payload.spells.find((spell) => spell.id === "magicrecharge");
    assert.ok(magicRecharge, "magic recharge spell level definition exists");
    assert.deepEqual(
        magicRecharge.levels.map((level) => ({
            level: level.level,
            secondsToFullMagic: level.secondsToFullMagic
        })),
        [
            { level: 1, secondsToFullMagic: 9.5 },
            { level: 2, secondsToFullMagic: 6.5 },
            { level: 3, secondsToFullMagic: 4.5 },
            { level: 4, secondsToFullMagic: 3 },
            { level: 5, secondsToFullMagic: 2 },
            { level: 6, secondsToFullMagic: 1.5 },
            { level: 7, secondsToFullMagic: 1 }
        ]
    );

    state.spellLevels.magicrecharge = 4;
    stats = system.getMagicRechargeStats();
    assert.equal(stats.level, 4);
    assert.equal(stats.secondsToFullMagic, 3);
});

test("Wizard of Flatland applies healing as a passive spell", () => {
    const source = fs.readFileSync(MAIN_PATH, "utf8");

    assert.match(source, /function updatePassiveHealing\(dt\)/);
    assert.match(source, /getWizardSpellLevel\("healing"\) < 1/);
    assert.match(source, /getActiveHealingStats\(\)/);
    assert.match(source, /state\.wizardVitals\.maxHealth \/ healingStats\.secondsToFullHealth \* dt/);
    assert.match(source, /healWizard\(healingAmount\)/);
    assert.match(source, /framePart\("passive healing", \(\) => updatePassiveHealing\(dt\)\)/);
    assert.doesNotMatch(source, /const magicCost = healingStats\.costPerSecond/);
    assert.doesNotMatch(source, /spendWizardMagic\(magicCost\)/);
});
