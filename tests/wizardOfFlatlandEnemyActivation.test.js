const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ACTIVATION_PATH = path.join(__dirname, "../public/wizard-of-flatland/enemyActivation.js");

function loadActivationSystem() {
    const context = {};
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(ACTIVATION_PATH, "utf8"), context);
    const mazeSections = {
        worldToMazeSectionCoord(x) {
            return { q: Math.floor(x / 100), r: 0 };
        },
        mazeSectionKey(q, r) {
            return `${q},${r}`;
        },
        parseMazeSectionKey(key) {
            const [q, r] = key.split(",").map(Number);
            return { q, r };
        }
    };
    return context.getWizardFlatlandEnemyActivationApi().createEnemyActivationSystem({
        constants: {
            ENEMY_WAKE_DISTANCE_METERS: 50,
            ENEMY_SLEEP_SECTION_DISTANCE: 3
        },
        mazeSections
    });
}

test("Wizard of Flatland wakes every enemy in a section when one is within fifty meters", () => {
    const system = loadActivationSystem();
    const agents = [
        { id: 1, x: 49, y: 0, zoneLevel: 0, activated: false },
        { id: 2, x: 90, y: 0, zoneLevel: 0, activated: false },
        { id: 3, x: 101, y: 0, zoneLevel: 0, activated: false }
    ];

    system.updateEnemyActivation(agents, { x: 0, y: 0 }, {}, true, 0);

    assert.deepEqual(agents.map((agent) => agent.activated), [true, true, false]);
});

test("Wizard of Flatland keeps enemies awake until they are three sections away", () => {
    const system = loadActivationSystem();
    const agents = [
        { id: 1, x: 299, y: 0, zoneLevel: 0, activated: true },
        { id: 2, x: 300, y: 0, zoneLevel: 0, activated: true }
    ];

    system.updateEnemyActivation(agents, { x: 0, y: 0 }, {}, true, 0);

    assert.deepEqual(agents.map((agent) => agent.activated), [true, false]);
});

test("Wizard of Flatland keeps non-maze scenario enemies active", () => {
    const system = loadActivationSystem();
    const agents = [{ x: 1000, y: 0, activated: false }];

    system.updateEnemyActivation(agents, { x: 0, y: 0 }, {}, false);

    assert.equal(agents[0].activated, true);
});

test("Wizard of Flatland keeps higher-zone enemies hibernating until their zone is entered", () => {
    const system = loadActivationSystem();
    const agents = [
        { id: 1, x: 10, y: 0, zoneLevel: 1, activated: true },
        { id: 2, x: 20, y: 0, zoneLevel: 0, activated: false }
    ];

    system.updateEnemyActivation(agents, { x: 0, y: 0 }, {}, true, 0);
    assert.deepEqual(agents.map((agent) => agent.activated), [false, true]);

    system.updateEnemyActivation(agents, { x: 0, y: 0 }, {}, true, 1);
    assert.deepEqual(agents.map((agent) => agent.activated), [true, true]);
});
