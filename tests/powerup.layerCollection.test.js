const test = require("node:test");
const assert = require("node:assert/strict");

const savedGlobals = {
    CircleHitbox: globalThis.CircleHitbox,
    PIXI: globalThis.PIXI,
    fetch: globalThis.fetch,
    powerups: globalThis.powerups,
    map: globalThis.map,
    Powerup: globalThis.Powerup,
    loadPowerupItemsDoc: globalThis.loadPowerupItemsDoc,
    getPowerupImageData: globalThis.getPowerupImageData,
    getPowerupImageDataByFile: globalThis.getPowerupImageDataByFile,
    getScaledPowerupOptions: globalThis.getScaledPowerupOptions,
    addPowerup: globalThis.addPowerup,
    dropPowerupNearSource: globalThis.dropPowerupNearSource,
    updatePowerupsForWizard: globalThis.updatePowerupsForWizard
};

function restoreGlobals() {
    for (const [key, value] of Object.entries(savedGlobals)) {
        if (typeof value === "undefined") delete globalThis[key];
        else globalThis[key] = value;
    }
}

class TestCircleHitbox {
    constructor(x, y, radius) {
        this.x = x;
        this.y = y;
        this.radius = radius;
    }

    intersects(other) {
        const dx = this.x - other.x;
        const dy = this.y - other.y;
        const radius = this.radius + other.radius;
        return (dx * dx) + (dy * dy) <= radius * radius;
    }
}

function loadPowerupModule() {
    delete require.cache[require.resolve("../public/assets/javascript/gameobjects/powerup.js")];
    globalThis.CircleHitbox = TestCircleHitbox;
    globalThis.PIXI = { Texture: { from: () => ({}) } };
    globalThis.fetch = () => Promise.resolve({ json: () => Promise.resolve({ defaults: {}, items: [] }) });
    globalThis.powerups = [];
    globalThis.map = null;
    require("../public/assets/javascript/gameobjects/powerup.js");
    return globalThis.Powerup;
}

test("powerups do not intersect a wizard on a different floor layer", () => {
    const Powerup = loadPowerupModule();
    const powerup = new Powerup("black diamond.png", { x: 5, y: 5, z: 0, radius: 0.5 });
    powerup.currentMovementSupport = { type: "floor", layer: 1, baseZ: 3 };
    powerup.currentLayer = 1;
    powerup.traversalLayer = 1;
    const wizard = {
        groundPlaneHitbox: new TestCircleHitbox(5, 5, 0.5),
        currentMovementSupport: { type: "ground", layer: 0, baseZ: 0 },
        currentLayer: 0,
        traversalLayer: 0
    };

    assert.equal(powerup.intersectsWizard(wizard), false);
    restoreGlobals();
});

test("powerups intersect a wizard on the matching floor layer and owner", () => {
    const Powerup = loadPowerupModule();
    const support = { type: "floor", layer: 1, baseZ: 3, ownerType: "building", ownerId: "building:house" };
    const powerup = new Powerup("black diamond.png", { x: 5, y: 5, z: 0, radius: 0.5 });
    powerup.currentMovementSupport = support;
    powerup.currentLayer = 1;
    powerup.traversalLayer = 1;
    const wizard = {
        groundPlaneHitbox: new TestCircleHitbox(5, 5, 0.5),
        currentMovementSupport: support,
        currentLayer: 1,
        traversalLayer: 1
    };

    assert.equal(powerup.intersectsWizard(wizard), true);
    restoreGlobals();
});

test("powerups do not intersect a wizard in a different owner scope on the same layer", () => {
    const Powerup = loadPowerupModule();
    const powerup = new Powerup("black diamond.png", { x: 5, y: 5, z: 0, radius: 0.5 });
    powerup.currentMovementSupport = { type: "floor", layer: 1, baseZ: 3, ownerType: "building", ownerId: "building:house" };
    powerup.currentLayer = 1;
    powerup.traversalLayer = 1;
    const wizard = {
        groundPlaneHitbox: new TestCircleHitbox(5, 5, 0.5),
        currentMovementSupport: { type: "floor", layer: 1, baseZ: 3, ownerType: "building", ownerId: "building:tower" },
        currentLayer: 1,
        traversalLayer: 1
    };

    assert.equal(powerup.intersectsWizard(wizard), false);
    restoreGlobals();
});

test("loadJson defaults missing currentLayerBaseZ to ground baseZ 0", () => {
    const Powerup = loadPowerupModule();

    const powerup = Powerup.loadJson({
        id: 46,
        file: "black diamond.png",
        x: 2,
        y: 3,
        z: 0,
        traversalLayer: 0
    });

    assert.ok(powerup);
    assert.equal(powerup.currentLayerBaseZ, 0);
    assert.equal(powerup._floorBaseZ, 0);

    restoreGlobals();
});
