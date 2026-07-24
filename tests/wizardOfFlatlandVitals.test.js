const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const VITALS_PATH = path.join(__dirname, "../public/wizard-of-flatland/wizardVitals.js");
const MAIN_PATH = path.join(__dirname, "../public/wizard-of-flatland/main.js");

function loadWizardVitalsApi() {
    const context = { window: {} };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(VITALS_PATH, "utf8"), context, { filename: VITALS_PATH });
    return context.window.WizardFlatlandVitals;
}

function createTestVitalsSystem(canRechargeMagic) {
    const api = loadWizardVitalsApi();
    const state = {
        wizardVitals: {
            health: 50,
            maxHealth: 100,
            magic: 25,
            maxMagic: 100,
            exp: 0,
            maxExp: 100
        },
        levelPoints: 0
    };
    let statusUpdates = 0;
    const system = api.createWizardVitalsSystem({
        state,
        constants: {
            WIZARD_MAX_HEALTH: 100,
            WIZARD_MAX_MAGIC: 100,
            WIZARD_MAX_EXP: 100,
            WIZARD_HEALTH_REGEN_PER_SECOND: 5,
            WIZARD_MAGIC_REGEN_PER_SECOND: 7
        },
        callbacks: {
            canRechargeMagic,
            updateStatusBars() {
                statusUpdates += 1;
            },
            playLevelUpAnnouncement() {},
            respawnWizardAfterDeath() {}
        }
    });
    return { state, system, getStatusUpdates: () => statusUpdates };
}

test("Wizard of Flatland magic recharge pauses while spell cooldown is active", () => {
    const { state, system, getStatusUpdates } = createTestVitalsSystem(() => false);

    system.regenerateWizardVitals(2);

    assert.equal(state.wizardVitals.health, 60);
    assert.equal(state.wizardVitals.magic, 25);
    assert.equal(getStatusUpdates(), 1);
});

test("Wizard of Flatland magic recharge resumes when spell cooldown ends", () => {
    const { state, system } = createTestVitalsSystem(() => true);

    system.regenerateWizardVitals(2);

    assert.equal(state.wizardVitals.health, 60);
    assert.equal(state.wizardVitals.magic, 39);
});

test("Wizard of Flatland wires magic recharge to the spell cooldown timer", () => {
    const source = fs.readFileSync(MAIN_PATH, "utf8");

    assert.match(source, /const canRechargeMagic = \(\) => \{/);
    assert.match(source, /return state\.spellCooldownRemaining <= 0/);
    assert.match(source, /canRechargeMagic,/);
});
