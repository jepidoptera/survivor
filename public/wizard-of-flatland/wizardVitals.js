(function () {
    "use strict";

    function createWizardVitalsSystem(deps) {
        const state = deps && deps.state;
        const constants = deps && deps.constants;
        const callbacks = deps && deps.callbacks ? deps.callbacks : {};
        if (!state || typeof state !== "object") throw new Error("Wizard of Flatland vitals require state");
        if (!constants || typeof constants !== "object") throw new Error("Wizard of Flatland vitals require constants");

        function validateWizardVitals() {
            const vitals = state.wizardVitals;
            if (!vitals || typeof vitals !== "object") {
                throw new Error("Wizard of Flatland vitals are missing");
            }
            for (const field of ["health", "maxHealth", "magic", "maxMagic", "exp", "maxExp"]) {
                if (!Number.isFinite(vitals[field])) {
                    throw new Error(`Wizard of Flatland vitals require finite ${field}`);
                }
            }
            if (vitals.maxHealth <= 0 || vitals.maxMagic <= 0 || vitals.maxExp <= 0) {
                throw new Error("Wizard of Flatland vitals require positive maximums");
            }
            if (vitals.exp < 0 || vitals.exp > vitals.maxExp) {
                throw new Error("Wizard of Flatland exp must stay within its maximum");
            }
        }

        function validateWizardLevelPoints() {
            if (!Number.isInteger(state.levelPoints) || state.levelPoints < 0) {
                throw new Error("Wizard of Flatland levelPoints must be a non-negative integer");
            }
        }

        function resetWizardVitals() {
            state.wizardVitals = {
                health: constants.WIZARD_MAX_HEALTH,
                maxHealth: constants.WIZARD_MAX_HEALTH,
                magic: constants.WIZARD_MAX_MAGIC,
                maxMagic: constants.WIZARD_MAX_MAGIC,
                exp: 0,
                maxExp: constants.WIZARD_MAX_EXP
            };
            state.levelPoints = 0;
            callRequiredCallback("updateStatusBars");
            callOptionalCallback("refreshSpellLevelPanel");
        }

        function regenerateWizardVitals(dt) {
            if (!Number.isFinite(dt) || dt <= 0) return;
            validateWizardVitals();
            const vitals = state.wizardVitals;
            vitals.health = Math.min(vitals.maxHealth, vitals.health + constants.WIZARD_HEALTH_REGEN_PER_SECOND * dt);
            if (callRequiredCallback("canRechargeMagic")) {
                vitals.magic = Math.min(vitals.maxMagic, vitals.magic + constants.WIZARD_MAGIC_REGEN_PER_SECOND * dt);
            }
            callRequiredCallback("updateStatusBars");
        }

        function damageWizard(amount) {
            const damage = Number(amount);
            if (!Number.isFinite(damage) || damage <= 0) return 0;
            validateWizardVitals();
            const previousHealth = state.wizardVitals.health;
            state.wizardVitals.health = Math.max(0, previousHealth - damage);
            const appliedDamage = previousHealth - state.wizardVitals.health;
            callRequiredCallback("updateStatusBars");
            if (previousHealth > 0 && state.wizardVitals.health <= 0) {
                callRequiredCallback("respawnWizardAfterDeath");
            }
            return appliedDamage;
        }

        function healWizard(amount) {
            const healing = Number(amount);
            if (!Number.isFinite(healing) || healing <= 0) return 0;
            validateWizardVitals();
            const previousHealth = state.wizardVitals.health;
            state.wizardVitals.health = Math.min(state.wizardVitals.maxHealth, previousHealth + healing);
            const appliedHealing = state.wizardVitals.health - previousHealth;
            if (appliedHealing > 0) callRequiredCallback("updateStatusBars");
            return appliedHealing;
        }

        function spendWizardMagic(amount) {
            const cost = Number(amount);
            if (!Number.isFinite(cost) || cost <= 0) {
                throw new Error("Wizard of Flatland magic spend requires a positive finite cost");
            }
            validateWizardVitals();
            if (state.wizardVitals.magic < cost) return false;
            state.wizardVitals.magic -= cost;
            callRequiredCallback("updateStatusBars");
            return true;
        }

        function gainWizardExp(amount) {
            const exp = Number(amount);
            if (!Number.isFinite(exp) || exp <= 0) {
                throw new Error("Wizard of Flatland exp gain requires a positive finite amount");
            }
            validateWizardVitals();
            validateWizardLevelPoints();
            const nextExp = state.wizardVitals.exp + exp;
            const gainedLevelPoints = Math.floor(nextExp / state.wizardVitals.maxExp);
            if (gainedLevelPoints > 0) {
                state.wizardVitals.exp = nextExp % state.wizardVitals.maxExp;
                state.levelPoints += gainedLevelPoints;
                callRequiredCallback("updateStatusBars");
                callOptionalCallback("refreshSpellLevelPanel");
                callRequiredCallback("playLevelUpAnnouncement");
                return;
            }
            state.wizardVitals.exp = nextExp;
            callRequiredCallback("updateStatusBars");
        }

        function callRequiredCallback(name) {
            if (typeof callbacks[name] !== "function") {
                throw new Error(`Wizard of Flatland vitals require ${name}`);
            }
            return callbacks[name]();
        }

        function callOptionalCallback(name) {
            if (typeof callbacks[name] === "function") callbacks[name]();
        }

        return Object.freeze({
            validateWizardVitals,
            validateWizardLevelPoints,
            resetWizardVitals,
            regenerateWizardVitals,
            damageWizard,
            healWizard,
            spendWizardMagic,
            gainWizardExp
        });
    }

    window.WizardFlatlandVitals = Object.freeze({
        createWizardVitalsSystem
    });
}());
