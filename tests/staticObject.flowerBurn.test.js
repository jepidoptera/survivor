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

class FakeBuffer {
    constructor(data) {
        this.data = data;
        this.updateCalls = 0;
    }

    update() {
        this.updateCalls += 1;
    }
}

class FakeGeometry {
    constructor() {
        this.buffers = new Map();
        this.index = null;
    }

    addAttribute(name, data) {
        this.buffers.set(name, new FakeBuffer(data));
        return this;
    }

    addIndex(index) {
        this.index = index;
        return this;
    }

    getBuffer(name) {
        return this.buffers.get(name) || null;
    }
}

class FakeMesh {
    constructor(geometry, shader, state, drawMode) {
        this.geometry = geometry;
        this.shader = shader;
        this.state = state;
        this.drawMode = drawMode;
        this.parent = null;
        this.visible = false;
        this.destroyed = false;
    }

    destroy() {
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
        Geometry: FakeGeometry,
        Mesh: FakeMesh,
        Shader: {
            from(_vs, _fs, uniforms) {
                return { uniforms };
            }
        },
        State: class State {},
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
        DRAW_MODES: {
            TRIANGLES: "TRIANGLES"
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

test("wall-mounted preview depth billboard draws only the camera-side wall plane", () => {
    restoreGlobals();
    installTestGlobals();
    delete require.cache[STATIC_OBJECTS_MODULE_PATH];
    require(STATIC_OBJECTS_MODULE_PATH);

    const obj = Object.create(globalThis.StaticObject.prototype);
    obj.type = "door";
    obj.category = "doors";
    obj.rotationAxis = "spatial";
    obj.mountedWallSectionUnitId = 10;
    obj.map = null;
    obj.x = 0;
    obj.y = 0;
    obj.z = 0;
    obj.width = 4;
    obj.height = 6;
    obj.placeableAnchorX = 0.5;
    obj.placeableAnchorY = 1;
    obj.placementRotation = 0;
    obj.pixiSprite = new globalThis.PIXI.Sprite(new globalThis.PIXI.Texture());
    obj.depthBillboardFaceCenters = {
        front: { x: 0, y: 1 },
        back: { x: 0, y: -1 }
    };

    const mesh = obj.updateDepthBillboardMesh(
        { app: { screen: { width: 800, height: 600 } } },
        { x: -10, y: -10, z: 0, viewscale: 100, xyratio: 1 },
        {
            alphaCutoff: 0.08,
            drawOnlyMountedWallSide: true,
            forceMountedWallSide: "front"
        }
    );

    assert.ok(mesh);
    const positions = Array.from(mesh.geometry.getBuffer("aWorldPosition").data);
    assert.deepEqual(positions.slice(0, 12), [
        -2, 1, 0,
        2, 1, 0,
        2, 1, 6,
        -2, 1, 6
    ]);
    assert.deepEqual(positions.slice(12, 24), [
        -2, 1, 0,
        -2, 1, 0,
        -2, 1, 0,
        -2, 1, 0
    ]);

    delete require.cache[STATIC_OBJECTS_MODULE_PATH];
    restoreGlobals();
});

test("placed object load restores upper-floor building manifest membership", () => {
    restoreGlobals();
    installTestGlobals();
    delete require.cache[STATIC_OBJECTS_MODULE_PATH];
    require(STATIC_OBJECTS_MODULE_PATH);

    const groundNode = new TestNode();
    groundNode.xindex = 4;
    groundNode.yindex = 5;
    groundNode.x = 4;
    groundNode.y = 5;
    const upperNode = new TestNode();
    upperNode.xindex = 4;
    upperNode.yindex = 5;
    upperNode.x = 4;
    upperNode.y = 5;
    upperNode.traversalLayer = 1;
    upperNode.level = 1;
    upperNode.surfaceId = "upper-surface";
    upperNode.fragmentId = "upper-fragment";

    const manifestCalls = [];
    const map = {
        objects: [],
        scenery: {},
        worldToNode() {
            return groundNode;
        },
        getFloorNodeAtLayer(x, y, layer, options) {
            assert.equal(x, 4);
            assert.equal(y, 5);
            assert.equal(layer, 1);
            assert.equal(options.surfaceId, "upper-surface");
            assert.equal(options.fragmentId, "upper-fragment");
            return upperNode;
        },
        addObjectToFloorBuildingManifest(obj, options) {
            manifestCalls.push({ obj, options });
            return true;
        }
    };

    const obj = globalThis.StaticObject.loadJson({
        type: "placedObject",
        category: "furniture",
        texturePath: "/assets/images/furniture/chair.png",
        x: 4,
        y: 5,
        z: 3,
        traversalLayer: 1,
        level: 1,
        surfaceId: "upper-surface",
        fragmentId: "upper-fragment"
    }, map);

    assert.ok(obj);
    assert.equal(obj.node, upperNode);
    assert.equal(obj.surfaceId, "upper-surface");
    assert.equal(obj.fragmentId, "upper-fragment");
    assert.equal(upperNode.objects.includes(obj), true);
    assert.equal(groundNode.objects.includes(obj), false);
    assert.equal(manifestCalls.length, 1);
    assert.equal(manifestCalls[0].obj, obj);
    assert.deepEqual(manifestCalls[0].options, {
        fragmentId: "upper-fragment",
        surfaceId: "upper-surface",
        level: 1
    });

    delete require.cache[STATIC_OBJECTS_MODULE_PATH];
    restoreGlobals();
});
