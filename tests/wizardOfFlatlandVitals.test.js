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
            maxExp: 80
        },
        levelPoints: 0
    };
    let statusUpdates = 0;
    const system = api.createWizardVitalsSystem({
        state,
        constants: {
            WIZARD_MAX_HEALTH: 100,
            WIZARD_MAX_MAGIC: 100,
            WIZARD_MAX_EXP: 80,
            WIZARD_LEVEL_EXP_INCREMENT: 20
        },
        callbacks: {
            canRechargeMagic,
            getMagicRechargeSecondsToFull() {
                return 6.5;
            },
            updateStatusBars() {
                statusUpdates += 1;
            },
            playLevelUpAnnouncement() {},
            respawnWizardAfterDeath() {}
        }
    });
    return { state, system, getStatusUpdates: () => statusUpdates };
}

test("Wizard of Flatland magic recharge pauses while spell cooldown is active without baseline healing", () => {
    const { state, system, getStatusUpdates } = createTestVitalsSystem(() => false);

    system.regenerateWizardVitals(2);

    assert.equal(state.wizardVitals.health, 50);
    assert.equal(state.wizardVitals.magic, 25);
    assert.equal(getStatusUpdates(), 1);
});

test("Wizard of Flatland magic recharge resumes when spell cooldown ends without baseline healing", () => {
    const { state, system } = createTestVitalsSystem(() => true);

    system.regenerateWizardVitals(2);

    assert.equal(state.wizardVitals.health, 50);
    assert.equal(state.wizardVitals.magic, 25 + 100 / 6.5 * 2);
});

test("Wizard of Flatland healing restores health without exceeding the maximum", () => {
    const { state, system, getStatusUpdates } = createTestVitalsSystem(() => true);

    const appliedHealing = system.healWizard(75);

    assert.equal(appliedHealing, 50);
    assert.equal(state.wizardVitals.health, 100);
    assert.equal(getStatusUpdates(), 1);
});

test("Wizard of Flatland first level point costs 80 exp and increases the next cost by 20", () => {
    const { state, system } = createTestVitalsSystem(() => true);

    system.gainWizardExp(79);
    assert.equal(state.levelPoints, 0);
    assert.equal(state.wizardVitals.exp, 79);
    assert.equal(state.wizardVitals.maxExp, 80);

    system.gainWizardExp(1);
    assert.equal(state.levelPoints, 1);
    assert.equal(state.wizardVitals.exp, 0);
    assert.equal(state.wizardVitals.maxExp, 100);
});

test("Wizard of Flatland bulk exp gains apply increasing level costs", () => {
    const { state, system } = createTestVitalsSystem(() => true);

    system.gainWizardExp(190);

    assert.equal(state.levelPoints, 2);
    assert.equal(state.wizardVitals.exp, 10);
    assert.equal(state.wizardVitals.maxExp, 120);
});

test("Wizard of Flatland wires magic recharge to the spell cooldown timer", () => {
    const source = fs.readFileSync(MAIN_PATH, "utf8");

    assert.match(source, /const canRechargeMagic = \(\) => \{/);
    assert.match(source, /return state\.spellCooldownRemaining <= 0/);
    assert.match(source, /canRechargeMagic,/);
    assert.match(source, /getMagicRechargeSecondsToFull: \(\) => getMagicRechargeStats\(\)\.secondsToFullMagic/);
});
