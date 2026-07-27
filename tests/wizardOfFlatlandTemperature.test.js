const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const MAIN_PATH = path.join(__dirname, "../public/wizard-of-flatland/main.js");

test("Wizard of Flatland freeze damage lowers enemy temperature by health thirds", () => {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    assert.match(source, /const FREEZE_TEMPERATURE_DROP_DEGREES = 10/);
    assert.match(source, /const FREEZE_DAMAGE_FRACTION_PER_TEMPERATURE_DROP = 1 \/ 3/);
    assert.match(source, /agent\.freezeDamageSinceTemperatureDrop \+= appliedDamage/);
    assert.match(source, /const damagePerDrop = agent\.maxHealth \* FREEZE_DAMAGE_FRACTION_PER_TEMPERATURE_DROP/);
    assert.match(source, /agent\.temperature -= dropCount \* FREEZE_TEMPERATURE_DROP_DEGREES/);
    assert.match(source, /damageAgentWithFreezeTemperatureAndMaybeDropCoin\(agent, damage\)/);
});

test("Wizard of Flatland enemy speed follows temperature and recovers one degree per second", () => {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    assert.match(source, /const ENEMY_TEMPERATURE_RECOVERY_PER_SECOND = 1/);
    assert.match(source, /return 1 \/ \(2 \*\* \(-agent\.temperature \/ 10\)\)/);
    assert.match(source, /agent\.speed \* getEnemyTemperatureSpeedMultiplier\(agent\)/);
    assert.match(source, /agent\.temperature \+ ENEMY_TEMPERATURE_RECOVERY_PER_SECOND \* dt/);

    const multiplier = (temperature) => 1 / (2 ** (-temperature / 10));
    assert.equal(multiplier(0), 1);
    assert.equal(multiplier(-10), 0.5);
    assert.equal(multiplier(-20), 0.25);
    assert.equal(multiplier(-30), 0.125);
});

test("Wizard of Flatland checkpoints preserve enemy temperature progress", () => {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    assert.match(source, /temperature: agent\.temperature/);
    assert.match(source, /freezeDamageSinceTemperatureDrop: agent\.freezeDamageSinceTemperatureDrop/);
    assert.match(source, /temperature: Number\.isFinite\(snapshot\.temperature\)/);
    assert.match(source, /freezeDamageSinceTemperatureDrop: Number\.isFinite\(snapshot\.freezeDamageSinceTemperatureDrop\)/);
});
