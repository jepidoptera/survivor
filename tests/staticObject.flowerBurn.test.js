"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const STATIC_OBJECTS_MODULE_PATH = require.resolve("../public/assets/javascript/gameobjects/staticObjects.js");

class FakeTexture {
    constructor(baseTexture = null, frame = null) {
        this.baseTexture = baseTexture || {
            valid: true,
            width: 16,
            height: 16,
            realWidth: 16,
            realHeight: 16,
            once() {}
        };
        this.frame = frame;
    }

    static from() {
        return new FakeTexture();
    }
}

FakeTexture.WHITE = new FakeTexture();

class FakeSprite {
    constructor(texture) {
        this.texture = texture;
        this.parent = null;
        this.destroyed = false;
        this.destroyCalls = 0;
        this.alpha = 1;
        this.tint = 0xffffff;
        this.width = 0;
        this.height = 0;
        this.visible = true;
        this.renderable = true;
        this.transform = {};
        this.scale = {};
        this.anchor = {
            x: 0,
            y: 0,
            set: (x, y) => {
                this.anchor.x = x;
                this.anchor.y = y;
            }
        };
    }

    destroy() {
        this.destroyCalls += 1;
        if (this.destroyed) throw new Error("FakeSprite destroyed twice");
        this.destroyed = true;
    }
}

class FakeContainer {
    constructor() {
        this.children = [];
        this.parent = null;
        this.destroyed = false;
    }

    addChild(child) {
        child.parent = this;
        this.children.push(child);
    }

    removeChild(child) {
        const index = this.children.indexOf(child);
        if (index >= 0) this.children.splice(index, 1);
        if (child) child.parent = null;
    }

    destroy(options = {}) {
        if (options && options.children) {
            for (const child of this.children.slice()) {
                if (child && typeof child.destroy === "function") child.destroy(options);
            }
        }
        this.children = [];
        this.destroyed = true;
    }
}

class TestNode {
    constructor() {
        this.objects = [];
    }

    addObject(obj) {
        this.objects.push(obj);
    }

    removeObject(obj) {
        const index = this.objects.indexOf(obj);
        if (index >= 0) this.objects.splice(index, 1);
    }
}

const GLOBAL_KEYS = [
    "PIXI",
    "CircleHitbox",
    "PolygonHitbox",
    "objectLayer",
    "activeSimObjects",
    "frameCount",
    "frameRate",
    "viewscale",
    "xyratio",
    "worldToScreen",
    "StaticObject",
    "Tree",
    "Playground",
    "TriggerArea",
    "Road",
    "getMountedWallFaceCentersForObject"
];

const savedGlobals = new Map();
for (const key of GLOBAL_KEYS) {
    savedGlobals.set(key, globalThis[key]);
}

function restoreGlobals() {
    for (const [key, value] of savedGlobals.entries()) {
        if (typeof value === "undefined") delete globalThis[key];
        else globalThis[key] = value;
    }
}

function installTestGlobals() {
    globalThis.PIXI = {
        Texture: FakeTexture,
        Sprite: FakeSprite,
        Container: FakeContainer,
        Rectangle: class Rectangle {
            constructor(x, y, width, height) {
                this.x = x;
                this.y = y;
                this.width = width;
                this.height = height;
            }
        },
        BLEND_MODES: {
            ADD: "ADD"
        },
        Loader: {
            shared: {
                resources: {}
            }
        }
    };
    globalThis.CircleHitbox = class CircleHitbox {
        constructor(x, y, radius) {
            this.x = x;
            this.y = y;
            this.radius = radius;
        }
    };
    globalThis.PolygonHitbox = class PolygonHitbox {
        constructor(points = []) {
            this.points = points;
        }
    };
    globalThis.objectLayer = {
        children: [],
        addChild(child) {
            child.parent = this;
            this.children.push(child);
        },
        removeChild(child) {
            const index = this.children.indexOf(child);
            if (index >= 0) this.children.splice(index, 1);
            if (child) child.parent = null;
        }
    };
    globalThis.activeSimObjects = new Set();
    globalThis.frameCount = 0;
    globalThis.frameRate = 30;
    globalThis.viewscale = 100;
    globalThis.xyratio = 1;
    globalThis.worldToScreen = ({ x, y }) => ({ x: x * 100, y: y * 100 });
}

test("flowers burn into falling fragments and remove themselves from the game", () => {
    restoreGlobals();
    installTestGlobals();
    delete require.cache[STATIC_OBJECTS_MODULE_PATH];
    require(STATIC_OBJECTS_MODULE_PATH);

    const node = new TestNode();
    const map = {
        objects: [],
        worldToNode() {
            return node;
        }
    };

    const flower = new globalThis.StaticObject(
        "flower",
        { x: 0, y: 0 },
        1,
        1,
        [new globalThis.PIXI.Texture()],
        map
    );
    map.objects.push(flower);
    flower.hp = 0.25;
    flower.ignite();

    globalThis.frameCount = 0;
    flower.update();
    assert.equal(flower.burned, true);
    assert.equal(flower.isOnFire, false);
    assert.equal(flower.pixiSprite.tint, 0x000000);
    assert.equal(flower.pixiSprite.visible, false);
    assert.ok(Array.isArray(flower._flowerBurnFragments));
    assert.equal(flower._flowerBurnFragments.length, 49);
    assert.ok(flower._flowerBurnFragmentContainer);
    assert.equal(flower.gone, undefined);

    const firstFragment = flower._flowerBurnFragments[0];
    const lastFragment = flower._flowerBurnFragments[flower._flowerBurnFragments.length - 1];
    const initialFragmentY = firstFragment.sprite.y;
    const initialLastFragmentY = lastFragment.sprite.y;

    globalThis.frameCount = 10;
    flower.update();
    assert.notEqual(firstFragment.sprite.y, initialFragmentY);
    assert.ok(Math.abs(firstFragment.sprite.rotation) > 0);
    assert.ok(firstFragment.sprite.alpha > 0);
    assert.equal(lastFragment.sprite.visible, true);
    assert.equal(lastFragment.sprite.y, initialLastFragmentY);
    assert.equal(Math.abs(lastFragment.sprite.rotation), 0);
    assert.ok(map.objects.includes(flower));
    assert.ok(node.objects.includes(flower));

    globalThis.frameCount = 29;
    flower.update();
    assert.ok(firstFragment.sprite.alpha < 1);
    assert.equal(lastFragment.sprite.visible, true);
    assert.equal(lastFragment.sprite.y, initialLastFragmentY);

    globalThis.frameCount = 35;
    flower.update();
    assert.equal(lastFragment.sprite.visible, true);
    assert.notEqual(lastFragment.sprite.y, initialLastFragmentY);

    let landingFrame = globalThis.frameCount;
    for (let i = 0; i < 200; i++) {
        landingFrame += 1;
        globalThis.frameCount = landingFrame;
        flower.update();
        if (flower._flowerBurnDetachedFromGame) break;
    }
    assert.equal(flower._flowerBurnDetachedFromGame, true);
    assert.equal(map.objects.includes(flower), true);
    assert.equal(node.objects.includes(flower), true);
    assert.notEqual(flower.gone, true);
    assert.ok(Array.isArray(flower._flowerBurnFragments));
    assert.ok(flower._flowerBurnFragments.every(frag => frag.landed === true));
    assert.equal(flower.blocksTile, false);
    assert.equal(flower.isPassable, true);
    assert.equal(flower.groundPlaneHitbox, null);
    assert.equal(flower.visualHitbox, null);

    globalThis.frameCount = 520;
    flower.update();
    assert.equal(flower.gone, true);
    assert.equal(map.objects.includes(flower), false);
    assert.equal(node.objects.includes(flower), false);
    assert.equal(globalThis.activeSimObjects.has(flower), false);

    delete require.cache[STATIC_OBJECTS_MODULE_PATH];
    restoreGlobals();
});

test("removeFromGame does not double-destroy renderer display object aliases", () => {
    restoreGlobals();
    installTestGlobals();
    delete require.cache[STATIC_OBJECTS_MODULE_PATH];
    require(STATIC_OBJECTS_MODULE_PATH);

    const node = new TestNode();
    const map = {
        objects: [],
        worldToNode() {
            return node;
        }
    };

    const object = new globalThis.StaticObject(
        "rock",
        { x: 0, y: 0 },
        1,
        1,
        [new globalThis.PIXI.Texture()],
        map
    );
    map.objects.push(object);

    const sprite = object.pixiSprite;
    object._renderingDisplayObject = sprite;

    assert.doesNotThrow(() => object.removeFromGame());
    assert.equal(sprite.destroyCalls, 1);
    assert.equal(sprite.destroyed, true);
    assert.equal(object._renderingDisplayObject, null);

    delete require.cache[STATIC_OBJECTS_MODULE_PATH];
    restoreGlobals();
});
