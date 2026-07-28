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
    assert.deepEqual(levels.map((level) => level.range), [3, 4, 4.5, 5, 5.5, 6.5, 7.5]);
    assert.deepEqual(levels.map((level) => level.coneAngleDegrees), [30, 30, 30, 30, 30, 30, 45]);
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
                range: 5.5,
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
    assert.match(source, /const FREEZE_CONE_START_WIDTH = 1/);
    assert.match(source, /const startHalfWidth = FREEZE_CONE_START_WIDTH \* 0\.5/);
    assert.match(source, /const halfWidth = startHalfWidth \+ Math\.max\(0, forwardDistance\) \* coneSlope/);
    assert.match(source, /if \(lateralDistance > halfWidth \+ agent\.radius\) return true/);
    assert.match(source, /const halfWidth = FREEZE_CONE_START_WIDTH \* 0\.5 \+ forwardDistance \* Math\.tan\(halfAngle\)/);
    assert.match(source, /maxDistance: stats\.range/);
    assert.match(source, /lateralDistance <= halfWidth/);
    assert.match(source, /FREEZE_PARTICLE_COUNT_MULTIPLIER_PER_LEVEL \*\* \(stats\.level - 1\)/);
    assert.match(source, /state\.freezeParticles\.push/);
    assert.match(source, /color: "#ffffff"/);
    assert.match(source, /event\.code === "KeyI"/);
});

test("Wizard of Flatland freeze particle count grows by 25 percent per level", () => {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    assert.match(source, /const FREEZE_PARTICLES_PER_SECOND_AT_LEVEL_ONE = 132/);
    const particleMultiplier = (level) => 1.25 ** (level - 1);
    for (let level = 2; level <= 7; level++) {
        assert.equal(particleMultiplier(level) / particleMultiplier(level - 1), 1.25);
    }
});

test("Wizard of Flatland enemies killed by freeze explode into ice particles", () => {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    assert.match(source, /const FREEZE_DEATH_PARTICLE_COUNT = 60/);
    assert.match(source, /if \(killed\) emitFreezeDeathParticles\(agent\)/);
    assert.match(source, /for \(let i = 0; i < FREEZE_DEATH_PARTICLE_COUNT; i\+\+\)/);
    assert.match(source, /const angle = Math\.random\(\) \* Math\.PI \* 2/);
    assert.match(source, /const speed = 1\.5 \+ Math\.random\(\) \* 2/);
    assert.match(source, /color: Math\.random\(\) < 0\.5 \? "#8fddff" : "#e8fbff"/);
    assert.match(source, /ctx\.fillStyle = particle\.color/);
});
