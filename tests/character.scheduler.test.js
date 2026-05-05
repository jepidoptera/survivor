const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadCharacterHarness() {
    let nextTimerId = 1;
    const scheduled = [];
    const cleared = [];
    const context = {
        console,
        Math,
        Date,
        JSON,
        Map,
        Set,
        Array,
        Object,
        Number,
        String,
        Boolean,
        RegExp,
        Error,
        Infinity,
        NaN,
        parseInt,
        parseFloat,
        isFinite,
        paused: false,
        frameRate: 60,
        animals: [],
        setTimeout(callback, delayMs) {
            const id = nextTimerId++;
            scheduled.push({ id, callback, delayMs });
            return id;
        },
        clearTimeout(id) {
            cleared.push(id);
        },
        setInterval() {
            return nextTimerId++;
        },
        clearInterval() {},
        Inventory: class {},
        CircleHitbox: class {
            constructor(x, y, radius) {
                this.x = x;
                this.y = y;
                this.radius = radius;
            }
            moveTo(x, y) {
                this.x = x;
                this.y = y;
            }
        }
    };
    context.window = context;
    context.globalThis = context;

    vm.createContext(context);
    const source = fs.readFileSync(
        path.join(__dirname, "../public/assets/javascript/gameobjects/Character.js"),
        "utf8"
    ) + "\nglobalThis.__Character = Character;";
    vm.runInContext(source, context, { filename: "Character.js" });
    return { Character: context.__Character, scheduled, cleared };
}

function makeMap() {
    const node = {
        x: 0,
        y: 0,
        baseZ: 0,
        neighbors: []
    };
    return {
        width: 1,
        height: 1,
        nodes: [[node]],
        worldToNode() {
            return node;
        },
        registerGameObject() {},
        unregisterGameObject() {}
    };
}

test("Character starts one legacy movement timer by default", () => {
    const { Character, scheduled } = loadCharacterHarness();

    const actor = new Character("test", { x: 0, y: 0 }, 1, makeMap());

    assert.equal(actor.moveTimeout, 1);
    assert.equal(scheduled.length, 1);
});

test("external scheduler characters do not create orphan movement timers", () => {
    const { Character, scheduled } = loadCharacterHarness();
    const actor = new Character("test", { x: 0, y: 0 }, 1, makeMap(), {
        useExternalScheduler: true
    });

    assert.equal(actor.moveTimeout, null);
    assert.equal(scheduled.length, 0);

    actor.move();

    assert.equal(actor.moveTimeout, null);
    assert.equal(scheduled.length, 0);
});

test("externally scheduled characters can regenerate health without movement timers", () => {
    const { Character, scheduled } = loadCharacterHarness();
    const actor = new Character("test", { x: 0, y: 0 }, 1, makeMap(), {
        useExternalScheduler: true
    });
    let statusUpdates = 0;
    actor.hp = 50;
    actor.maxHp = 100;
    actor.healRate = 0.1;
    actor.healRateMultiplier = 2;
    actor.updateStatusBars = () => {
        statusUpdates++;
    };

    const healed = actor.regenerateHealth(1);

    assert.equal(healed, 20);
    assert.equal(actor.hp, 70);
    assert.equal(statusUpdates, 1);
    assert.equal(scheduled.length, 0);
});
