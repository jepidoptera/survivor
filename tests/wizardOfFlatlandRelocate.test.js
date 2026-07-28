const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..");
const LEVELS_PATH = path.join(ROOT, "public/wizard-of-flatland/spell-levels.json");
const SPELL_DATA_PATH = path.join(ROOT, "public/wizard-of-flatland/spellData.js");
const MAIN_PATH = path.join(ROOT, "public/wizard-of-flatland/main.js");

function loadSpellDataSystem(level) {
    const spells = JSON.parse(fs.readFileSync(LEVELS_PATH, "utf8")).spells;
    const context = {
        window: null,
        console,
        Math,
        fetch: async () => ({ ok: true, json: async () => ({ spells }) })
    };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(SPELL_DATA_PATH, "utf8"), context);
    const system = context.WizardFlatlandSpellData.createSpellDataSystem({
        state: { spellLevels: { teleport: level } },
        constants: { SPELL_LEVEL_MIN: 0, SPELL_LEVEL_MAX: 7 }
    });
    return system.fetchSpellLevelDefinitions().then(() => system);
}

test("Wizard of Flatland Relocate defines both sprint levels", () => {
    const spells = JSON.parse(fs.readFileSync(LEVELS_PATH, "utf8")).spells;
    const relocate = spells.find((spell) => spell.id === "teleport");
    assert.ok(relocate, "Relocate spell level definition exists");
    assert.deepEqual(
        relocate.levels.slice(0, 2).map(({ level, speedMultiplier, costPerSecond }) => ({
            level,
            speedMultiplier,
            costPerSecond
        })),
        [
            { level: 1, speedMultiplier: 1.5, costPerSecond: 10 },
            { level: 2, speedMultiplier: 2.25, costPerSecond: 12.5 }
        ]
    );
});

test("Wizard of Flatland Relocate sprint retains level two stats in later branch levels", async () => {
    const levelOneSystem = await loadSpellDataSystem(1);
    assert.deepEqual(
        { ...levelOneSystem.getActiveRelocateSprintStats() },
        { level: 1, sprintLevel: 1, costPerSecond: 10, speedMultiplier: 1.5 }
    );

    const levelSevenSystem = await loadSpellDataSystem(7);
    assert.deepEqual(
        { ...levelSevenSystem.getActiveRelocateSprintStats() },
        { level: 7, sprintLevel: 2, costPerSecond: 12.5, speedMultiplier: 2.25 }
    );
});

test("Wizard of Flatland Relocate sprint replaces free Shift movement", () => {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    assert.doesNotMatch(source, /TARGET_KEYBOARD_FAST_MOVE_SPEED|fastMovementHeld/);
    assert.match(source, /spendWizardMagic\(stats\.costPerSecond \* dt\)/);
    assert.match(source, /TARGET_KEYBOARD_MOVE_SPEED \*\s*sprintSpeedMultiplier/);
    assert.match(source, /getProjectedCursorMovementSpeedMultiplier\(state\.relocateSprintActive\)/);
    assert.match(source, /const extensionRatio = useMaximumExtension\s*\?\s*1/);
    assert.match(source, /state\.relocateSprintHeld && getWizardSpellLevel\("teleport"\) >= 1/);
    assert.match(source, /framePart\("relocate sprint", \(\) => updateRelocateSprint\(dt\)\)/);
});
