const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const LEVELS_PATH = path.join(ROOT, "public/wizard-of-flatland/spell-levels.json");
const SPELL_DATA_PATH = path.join(ROOT, "public/wizard-of-flatland/spellData.js");
const MAIN_PATH = path.join(ROOT, "public/wizard-of-flatland/main.js");

function getFreezeDefinition() {
    const data = JSON.parse(fs.readFileSync(LEVELS_PATH, "utf8"));
    const freeze = data.spells.find((spell) => spell.id === "freeze");
    assert.ok(freeze, "freeze spell level definition exists");
    return freeze;
}

test("Wizard of Flatland freeze levels match the design table", () => {
    const levels = getFreezeDefinition().levels;
    assert.deepEqual(levels.map((level) => level.damage), [10, 13, 17, 22, 29, 38, 50]);
    assert.deepEqual(levels.map((level) => level.costPerSecond), [10, 10, 10, 10, 10, 10, 10]);
    assert.deepEqual(levels.map((level) => level.coneAngleDegrees), [30, 30, 30, 30, 30, 30, 30]);
    levels.forEach((level, index) => {
        const expectedRange = 3 + index * (4 / 6);
        assert.ok(Math.abs(level.range - expectedRange) < 1e-9, `level ${index + 1} range is linear`);
    });
});

test("Wizard of Flatland resolves freeze stats from the active level", () => {
    const context = { window: null, console, Math };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(SPELL_DATA_PATH, "utf8"), context);
    const levels = JSON.parse(fs.readFileSync(LEVELS_PATH, "utf8")).spells;
    const state = { spellLevels: { freeze: 5 } };
    const system = context.WizardFlatlandSpellData.createSpellDataSystem({
        state,
        constants: { SPELL_LEVEL_MIN: 0, SPELL_LEVEL_MAX: 7 }
    });
    system.normalizeSpellLevelDefinitions({ spells: levels });
    const normalized = system.normalizeSpellLevelDefinitions({ spells: levels });

    // Load through the same normalized definition contract used by the runtime.
    const fetchContext = {
        window: null,
        console,
        Math,
        fetch: async () => ({ ok: true, json: async () => ({ spells: normalized }) })
    };
    fetchContext.window = fetchContext;
    vm.createContext(fetchContext);
    vm.runInContext(fs.readFileSync(SPELL_DATA_PATH, "utf8"), fetchContext);
    const loadedSystem = fetchContext.WizardFlatlandSpellData.createSpellDataSystem({
        state,
        constants: { SPELL_LEVEL_MIN: 0, SPELL_LEVEL_MAX: 7 }
    });
    return loadedSystem.fetchSpellLevelDefinitions().then(() => {
        assert.deepEqual(
            { ...loadedSystem.getActiveFreezeStats() },
            {
                level: 5,
                costPerSecond: 10,
                damagePerSecond: 29,
                range: 5.6666666667,
                coneAngleRadians: Math.PI / 6
            }
        );
    });
});

test("Wizard of Flatland freeze is wired as a held cone with snow particles", () => {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    assert.match(source, /state\.selectedSpell === "freeze"/);
    assert.match(source, /updateFreezeSpell\(dt\)/);
    assert.match(source, /stats\.damagePerSecond \* dt/);
    assert.match(source, /const minimumDot = Math\.cos\(halfAngle\)/);
    assert.match(source, /dot < minimumDot/);
    assert.match(source, /state\.freezeParticles\.push/);
    assert.match(source, /ctx\.fillStyle = "#ffffff"/);
    assert.match(source, /event\.code === "KeyI"/);
});
