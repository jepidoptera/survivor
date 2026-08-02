const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");

function loadDestructoBeam() {
    class SpellStub {
        constructor() {
            this.image = { src: "" };
        }
        static getTargetWorldBaseZ() { return 0; }
        static spendMagicCost(cost, wizard) {
            if (wizard.magic < cost) return false;
            wizard.magic -= cost;
            return true;
        }
        static indicateInsufficientMagic() {}
    }
    const context = {
        globalThis: null,
        Spell: SpellStub,
        document: { createElement: () => ({ src: "" }) },
        console
    };
    context.globalThis = context;
    vm.runInNewContext(
        fs.readFileSync(path.join(root, "public/assets/javascript/spells/DestructoBeam.js"), "utf8"),
        context
    );
    return context;
}

test("construction level two defines the requested trap and beam stats", () => {
    const data = JSON.parse(fs.readFileSync(path.join(root, "public/assets/data/spell-levels.json"), "utf8"));
    const construction = data.spells.find(spell => spell.id === "construction");
    assert.ok(construction);
    assert.deepEqual(
        {
            buildTime: construction.levels[1].buildTime,
            trapFireballLevel: construction.levels[1].trapFireballLevel,
            beamRange: construction.levels[1].beamRange,
            beamDuration: construction.levels[1].beamDuration,
            costPerSecond: construction.levels[1].costPerSecond
        },
        { buildTime: 1.6, trapFireballLevel: 2, beamRange: 10, beamDuration: 5, costPerSecond: 10 }
    );
});

test("destructo beam resets on a different wall and crumbles the final target", () => {
    const context = loadDestructoBeam();
    const crumbled = [];
    context.Scripting = { crumbleWall: (wall, x, y) => crumbled.push({ wall, x, y }) };
    const wizard = { x: 0, y: 0, magic: 100, map: null };
    const wallA = { type: "wallSection", brightness: 0, bottomZ: 0, height: 1 };
    const wallB = { type: "wallSection", brightness: 0, bottomZ: 0, height: 1 };
    const beam = new context.DestructoBeam();

    beam.updateChannel(wizard, wallA, 5, 0, 0);
    for (let time = 100; time <= 1000; time += 100) {
        beam.updateChannel(wizard, wallA, 5, 0, time);
    }
    assert.ok(beam.progress > 0);
    beam.updateChannel(wizard, wallB, 6, 0, 1100);
    assert.equal(beam.progress, 0);
    assert.equal(wallA.brightness, 0);

    for (let time = 1200; time <= 6100; time += 100) {
        beam.updateChannel(wizard, wallB, 6, 0, time);
    }
    assert.equal(crumbled.length, 1);
    assert.equal(crumbled[0].wall, wallB);
    assert.equal(wizard.magic, 40);
});
