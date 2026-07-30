const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const MAIN_PATH = path.join(__dirname, "../public/wizard-of-flatland/main.js");

test("Wizard of Flatland freeze damage lowers enemy temperature by health quarters", () => {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    assert.match(source, /const FREEZE_TEMPERATURE_DROP_DEGREES = 10/);
    assert.match(source, /const FREEZE_DAMAGE_FRACTION_PER_TEMPERATURE_DROP = 1 \/ 4/);
    assert.match(source, /agent\.freezeDamageSinceTemperatureDrop \+= appliedDamage/);
    assert.match(source, /const damagePerDrop = agent\.maxHealth \* FREEZE_DAMAGE_FRACTION_PER_TEMPERATURE_DROP/);
    assert.match(source, /agent\.temperature -= dropCount \* FREEZE_TEMPERATURE_DROP_DEGREES/);
    assert.match(source, /damageAgentWithFreezeTemperatureAndMaybeDropCoin\(agent, damage\)/);
    assert.match(source, /hitchSpan\("apply enemy damage"/);
    assert.match(source, /hitchSpan\("generate enemy death coin drop"/);
    assert.match(source, /hitchSpan\("create enemy death path cost"/);
    assert.match(source, /hitchSpan\("create enemy death blocker"/);
    assert.match(source, /killedAgents: Math\.max\(0, agentsBeforeCasting - state\.agents\.length\)/);
});

test("Wizard of Flatland enemy speed follows temperature and recovers one degree per second", () => {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    assert.match(source, /const ENEMY_TEMPERATURE_RECOVERY_PER_SECOND = 1/);
    assert.match(source, /return 1 \/ \(2 \*\* \(-agent\.temperature \/ 10\)\)/);
    assert.match(source, /agent\.speed\s*\* getEnemyZoneSpeedMultiplier\(agent\)\s*\* getEnemyTemperatureSpeedMultiplier\(agent\)/);
    assert.match(source, /agent\.temperature \+ ENEMY_TEMPERATURE_RECOVERY_PER_SECOND \* dt/);

    const multiplier = (temperature) => 1 / (2 ** (-temperature / 10));
    assert.equal(multiplier(0), 1);
    assert.equal(multiplier(-10), 0.5);
    assert.equal(multiplier(-20), 0.25);
    assert.equal(multiplier(-30), 0.125);
});

test("Wizard of Flatland enemy speed starts ten percent slower and gains ten percentage points per zone", () => {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    assert.match(source, /const ENEMY_SPEED_ZONE_ZERO_SCALE = 0\.9/);
    assert.match(source, /const ENEMY_SPEED_SCALE_PER_ZONE = 0\.1/);
    assert.match(
        source,
        /return ENEMY_SPEED_ZONE_ZERO_SCALE \+ agent\.zoneLevel \* ENEMY_SPEED_SCALE_PER_ZONE/
    );

    const multiplier = (zone) => 0.9 + zone * 0.1;
    assert.equal(multiplier(0), 0.9);
    assert.equal(multiplier(1), 1);
    assert.equal(multiplier(2), 1.1);
    assert.ok(Math.abs(multiplier(3) - 1.2) < Number.EPSILON * 2);
});

test("Wizard of Flatland enemy color cools to full blue at -20 and full white at -40", () => {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    assert.match(source, /const redGreenProgress = Math\.min\(1, coldDegrees \/ 40\)/);
    assert.match(source, /const blueProgress = Math\.min\(1, coldDegrees \/ 20\)/);
    assert.match(source, /ctx\.fillStyle = getAgentTemperatureColor\(warmColor, agent\.temperature\)/);

    const coolChannel = (warmValue, coldDegrees, fullAt) =>
        Math.round(warmValue + (255 - warmValue) * Math.min(1, coldDegrees / fullAt));
    assert.equal(coolChannel(0, 20, 20), 255);
    assert.equal(coolChannel(0, 20, 40), 128);
    assert.equal(coolChannel(0, 40, 40), 255);
    assert.equal(coolChannel(0, 10, 20), 128);
    assert.equal(coolChannel(0, 0, 20), 0);
});

test("Wizard of Flatland checkpoints preserve enemy temperature progress", () => {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    assert.match(source, /temperature: agent\.temperature/);
    assert.match(source, /freezeDamageSinceTemperatureDrop: agent\.freezeDamageSinceTemperatureDrop/);
    assert.match(source, /temperature: Number\.isFinite\(snapshot\.temperature\)/);
    assert.match(source, /freezeDamageSinceTemperatureDrop: Number\.isFinite\(snapshot\.freezeDamageSinceTemperatureDrop\)/);
});
