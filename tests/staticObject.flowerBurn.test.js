"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const STATIC_OBJECTS_MODULE_PATH = require.resolve("../public/assets/javascript/gameobjects/staticObjects.js");
const SECTION_WORLD_ENTITY_SYNC_MODULE_PATH = require.resolve("../public/assets/javascript/prototypes/sectionWorldEntitySync.js");

test("prototype building exterior shader decodes packed RGB depth metric data", () => {
    const source = fs.readFileSync(STATIC_OBJECTS_MODULE_PATH, "utf8");

    assert.match(source, /float decodeExteriorDepthMetric\(vec3 value\)/);
    assert.match(source, /return dot\(value, vec3\(1\.0, 1\.0 \/ 255\.0, 1\.0 \/ 65025\.0\)\);/);
    assert.match(source, /decodeExteriorDepthMetric\(depthData\.rgb\) \* span/);
});

test("webgl2 depth billboard shader writes depth for ordinary billboards", () => {
    const source = fs.readFileSync(STATIC_OBJECTS_MODULE_PATH, "utf8");

    assert.match(source, /out float vDepth;/);
    assert.match(source, /vDepth = nd;/);
    assert.match(source, /in float vDepth;/);
    assert.match(source, /gl_FragDepth = vDepth;/);
    assert.match(source, /if \(uBuildingExteriorDepthMetricUse > 0\.5\)[\s\S]*gl_FragDepth = nd;/);
});

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
        if (frame) {
            const baseW = Number(this.baseTexture.realWidth || this.baseTexture.width || 0);
            const baseH = Number(this.baseTexture.realHeight || this.baseTexture.height || 0);
            if (
                Number(frame.x) + Number(frame.width) > baseW ||
                Number(frame.y) + Number(frame.height) > baseH
            ) {
                throw new Error("FakeTexture frame does not fit inside base texture");
            }
        }
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
        this.x = 0;
        this.y = 0;
        this.alpha = 1;
        this.rotation = 0;
        this.tint = 0xffffff;
        this.visible = false;
        this.renderable = true;
        this.texture = null;
        this.destroyed = false;
    }

    destroy() {
        this.destroyed = true;
    }
}

class FakeMeshMaterial {
    constructor(texture) {
        this.texture = texture;
        this.tint = 0xffffff;
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
        MeshMaterial: FakeMeshMaterial,
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
    globalThis.worldToScreen = ({ x, y, z = 0 }) => ({ x: x * 100, y: (y - (Number(z) || 0)) * 100 });
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
    assert.equal(flower.shadowBox, null);
    assert.equal(flower.touchBox, null);

    globalThis.frameCount = 520;
    flower.update();
    assert.equal(flower.gone, true);
    assert.equal(map.objects.includes(flower), false);
    assert.equal(node.objects.includes(flower), false);
    assert.equal(globalThis.activeSimObjects.has(flower), false);

    delete require.cache[STATIC_OBJECTS_MODULE_PATH];
    restoreGlobals();
});

test("placed object floor fall uses wizard gravity and settles on landing", () => {
    restoreGlobals();
    installTestGlobals();
    delete require.cache[STATIC_OBJECTS_MODULE_PATH];
    require(STATIC_OBJECTS_MODULE_PATH);

    const dirtyRuntimeObjects = new Set();
    let restoreRef = null;
    const map = {
        _prototypeObjectState: {
            dirtyRuntimeObjects,
            captureScanNeeded: false
        },
        restorePrototypeBuildingObjectToInteriorBitmap(ref) {
            restoreRef = ref;
            return { ...ref, changed: true };
        }
    };
    const obj = new globalThis.StaticObject(
        "placedObject",
        { x: 0, y: 0 },
        1,
        1,
        [new globalThis.PIXI.Texture()],
        map
    );
    obj.isPlacedObject = true;
    obj.z = 3;
    obj.prevZ = 3;
    obj.falling = true;
    obj._prototypeRuntimeRecord = true;
    obj._floorFallState = {
        active: true,
        velocityZ: 0,
        gravity: -9,
        landZ: 0,
        bakeExclusion: {
            placementId: "building:test-house",
            floorId: "lower",
            recordId: 12
        }
    };

    globalThis.frameRate = 30;
    obj.update();
    assert.equal(obj._floorFallState.velocityZ, -0.3);
    assert.ok(obj.z < 3);
    assert.equal(obj.falling, true);

    for (let i = 0; i < 60 && obj._floorFallState; i++) {
        obj.update();
    }

    assert.equal(obj.z, 0);
    assert.equal(obj.prevZ, 0);
    assert.equal(obj.falling, false);
    assert.equal(obj._floorFallState, null);
    assert.deepEqual(restoreRef, {
        placementId: "building:test-house",
        floorId: "lower",
        recordId: 12
    });
    assert.equal(dirtyRuntimeObjects.has(obj), true);
    assert.equal(map._prototypeObjectState.captureScanNeeded, true);
});

test("burned trees crumble one second after finishing their fall", () => {
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

    const oddSizedTreeTexture = new globalThis.PIXI.Texture({
        valid: true,
        width: 835,
        height: 720,
        realWidth: 835,
        realHeight: 720,
        once() {}
    });
    const tree = new globalThis.Tree(
        { x: 0, y: 0 },
        [oddSizedTreeTexture],
        map,
        { deferPostLoad: true }
    );
    map.objects.push(tree);
    tree.hp = 0.25;
    tree.fallDirection = "left";
    tree.ignite();

    globalThis.frameCount = 0;
    tree.update();
    assert.equal(tree.burned, true);
    assert.equal(tree.falling, true);
    assert.equal(tree._flowerBurnFragments, null);

    let fallCompleteFrame = null;
    for (let frame = 1; frame < 200; frame++) {
        globalThis.frameCount = frame;
        tree.update();
        if (tree.fallenHitboxCreated) {
            fallCompleteFrame = frame;
            break;
        }
    }
    assert.ok(Number.isFinite(fallCompleteFrame));
    assert.equal(Math.abs(tree.rotation), 90);
    assert.equal(tree._burnedTreeFallCompleteFrame, fallCompleteFrame);
    assert.equal(tree._flowerBurnFragments, null);
    assert.equal(tree.isOnFire, false);

    tree.pixiSprite.width = tree.width * globalThis.viewscale;
    tree.pixiSprite.height = tree.height * globalThis.viewscale;
    tree.updateDepthBillboardMesh(
        { app: { screen: { width: 1200, height: 900 } }, map },
        {
            x: 0,
            y: 0,
            z: 0,
            viewscale: globalThis.viewscale,
            xyratio: globalThis.xyratio,
            worldToScreen(worldX, worldY, worldZ = 0) {
                return globalThis.worldToScreen({ x: worldX, y: worldY, z: worldZ });
            }
        },
        {}
    );
    assert.ok(tree._fallenTreeBurnScreenQuad);
    assert.equal(tree._fallenTreeBurnScreenQuad.diagonal, "br-tl");

    globalThis.frameCount = fallCompleteFrame + globalThis.frameRate - 1;
    tree.update();
    assert.equal(tree._flowerBurnFragments, null);
    assert.equal(tree.pixiSprite.visible, true);

    globalThis.frameCount = fallCompleteFrame + globalThis.frameRate;
    tree.update();
    assert.ok(Array.isArray(tree._flowerBurnFragments));
    assert.equal(tree._flowerBurnFragments.length, 49);
    assert.ok(tree._flowerBurnFragmentContainer);
    const lastFrame = tree._flowerBurnFragments[tree._flowerBurnFragments.length - 1].sprite.texture.frame;
    assert.ok(lastFrame.x + lastFrame.width <= 835);
    assert.ok(lastFrame.y + lastFrame.height <= 720);
    const fragmentXs = tree._flowerBurnFragments.map(frag => frag.sprite.x);
    const fragmentYs = tree._flowerBurnFragments.map(frag => frag.sprite.y);
    assert.ok(Math.max(...fragmentXs) - Math.min(...fragmentXs) > 300);
    assert.ok(Math.min(...fragmentYs) < -100);
    assert.ok(Math.max(...fragmentYs) > 100);
    const firstTreeFragment = tree._flowerBurnFragments[0];
    assert.ok(firstTreeFragment.meshVertexBuffer);
    assert.deepEqual(Array.from(firstTreeFragment.sprite.geometry.index), [1, 2, 3, 0, 1, 3]);
    const firstVertices = Array.from(firstTreeFragment.meshVertexBuffer.data);
    assert.notEqual(firstVertices[0], firstVertices[6]);
    const fallDistances = tree._flowerBurnFragments.map(frag => frag.floorScreenDeltaY);
    assert.ok(Math.max(...fallDistances) > 15);
    const lowerBoundaryYAtX = (quad, x) => {
        const points = [quad.bl, quad.br, quad.tr, quad.tl];
        const intersections = [];
        for (let i = 0; i < points.length; i++) {
            const a = points[i];
            const b = points[(i + 1) % points.length];
            if (x < Math.min(a.x, b.x) - 1e-6 || x > Math.max(a.x, b.x) + 1e-6) continue;
            const dx = b.x - a.x;
            if (Math.abs(dx) <= 1e-6) {
                if (Math.abs(x - a.x) <= 1e-6) intersections.push(a.y, b.y);
                continue;
            }
            const t = Math.max(0, Math.min(1, (x - a.x) / dx));
            intersections.push(a.y + ((b.y - a.y) * t));
        }
        return Math.max(...intersections);
    };
    for (let row = 0; row < 7; row++) {
        for (let col = 0; col < 7; col++) {
            const frag = tree._flowerBurnFragments[(row * 7) + col];
            const vertices = Array.from(frag.meshVertexBuffer.data);
            const bottomPoints = [
                { x: frag.startScreenX + vertices[0], y: frag.startScreenY + vertices[1] },
                { x: frag.startScreenX + vertices[2], y: frag.startScreenY + vertices[3] },
                {
                    x: frag.startScreenX + ((vertices[0] + vertices[2]) * 0.5),
                    y: frag.startScreenY + ((vertices[1] + vertices[3]) * 0.5)
                }
            ];
            const finalBottomDistances = bottomPoints.map(point => (
                lowerBoundaryYAtX(tree._fallenTreeBurnScreenQuad, point.x) - (point.y + frag.floorScreenDeltaY)
            ));
            assert.ok(finalBottomDistances.every(Number.isFinite));
            assert.ok(
                finalBottomDistances.every(distance => distance >= -1e-6),
                `row=${row} col=${col} distances=${finalBottomDistances.join(",")}`
            );
            if (row === 0) {
                assert.ok(
                    Math.min(...finalBottomDistances) < 8,
                    `row=${row} col=${col} distances=${finalBottomDistances.join(",")}`
                );
            }
            if (row === 6) {
                assert.equal(frag.floorScreenDeltaY, 0);
            }
        }
    }
    const average = values => values.reduce((sum, value) => sum + value, 0) / values.length;
    const rowAverageDrops = Array.from({ length: 7 }, (_unused, row) => (
        average(fallDistances.slice(row * 7, (row + 1) * 7))
    ));
    assert.ok(rowAverageDrops[0] > rowAverageDrops[3]);
    assert.ok(rowAverageDrops[3] > rowAverageDrops[6]);
    assert.equal(tree.pixiSprite.visible, false);
    assert.equal(tree.gone, undefined);

    let frame = globalThis.frameCount;
    for (let i = 0; i < 900; i++) {
        frame += 1;
        globalThis.frameCount = frame;
        tree.update();
        if (tree.gone) break;
    }
    assert.equal(tree.gone, true);
    assert.equal(map.objects.includes(tree), false);
    assert.equal(node.objects.includes(tree), false);
    assert.equal(globalThis.activeSimObjects.has(tree), false);

    delete require.cache[STATIC_OBJECTS_MODULE_PATH];
    restoreGlobals();
});

test("tree fire size interpolates when burn damage kills the tree", () => {
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
    const tree = new globalThis.Tree(
        { x: 0, y: 0 },
        [new globalThis.PIXI.Texture()],
        map,
        { deferPostLoad: true }
    );
    map.objects.push(tree);
    tree.maxHP = 10;
    tree.hp = 0.75;
    tree.ignite();

    globalThis.frameCount = 0;
    tree.update();
    assert.equal(tree.burned, false);
    assert.equal(tree.hp, 0.25);
    assert.equal(tree._renderedFireIntensityScale, 4);

    globalThis.frameCount = 1;
    tree.update();
    assert.equal(tree.burned, true);
    assert.ok(tree._renderedFireIntensityScale < 4);
    assert.ok(tree._renderedFireIntensityScale > 1);

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

test("static object indexed node updates skip unchanged memberships", () => {
    restoreGlobals();
    installTestGlobals();
    delete require.cache[STATIC_OBJECTS_MODULE_PATH];
    require(STATIC_OBJECTS_MODULE_PATH);

    let addCount = 0;
    let removeCount = 0;
    let clearVisibilityCount = 0;
    let refreshVisibilityCount = 0;
    const createNode = (xindex, yindex) => ({
        xindex,
        yindex,
        traversalLayer: 1,
        surfaceId: "building:test:surface:floor-1",
        fragmentId: "building:test:floor:floor-1",
        addObject(obj) {
            addCount += 1;
            if (!this.objects) this.objects = [];
            this.objects.push(obj);
        },
        removeObject(obj) {
            removeCount += 1;
            if (!this.objects) return;
            const index = this.objects.indexOf(obj);
            if (index >= 0) this.objects.splice(index, 1);
        },
        objects: []
    });
    const nodeA = createNode(1, 2);
    const nodeB = createNode(1, 3);
    const obj = Object.create(globalThis.StaticObject.prototype);
    obj._indexedNodes = [];
    obj.node = null;
    obj.clearVisibilityRegistration = () => {
        clearVisibilityCount += 1;
    };
    obj.refreshVisibilityRegistration = () => {
        refreshVisibilityCount += 1;
    };

    obj.setIndexedNodes([nodeA, nodeB], nodeA);
    assert.equal(addCount, 2);
    assert.equal(removeCount, 0);
    assert.equal(clearVisibilityCount, 1);
    assert.equal(refreshVisibilityCount, 1);

    obj.setIndexedNodes([nodeA, nodeB], nodeA);
    assert.equal(addCount, 2);
    assert.equal(removeCount, 0);
    assert.equal(clearVisibilityCount, 1);
    assert.equal(refreshVisibilityCount, 1);

    obj.setIndexedNodes([nodeB, nodeA], nodeB);
    assert.equal(addCount, 4);
    assert.equal(removeCount, 2);
    assert.equal(clearVisibilityCount, 2);
    assert.equal(refreshVisibilityCount, 2);

    delete require.cache[STATIC_OBJECTS_MODULE_PATH];
    restoreGlobals();
});

test("generated building exterior depth billboard honors vertical texture anchor", () => {
    restoreGlobals();
    installTestGlobals();
    delete require.cache[STATIC_OBJECTS_MODULE_PATH];
    require(STATIC_OBJECTS_MODULE_PATH);

    const obj = Object.create(globalThis.StaticObject.prototype);
    obj.type = "prototypeBuildingExterior";
    obj.category = "";
    obj.rotationAxis = "billboard";
    obj.x = 10;
    obj.y = 20;
    obj.z = 0;
    obj.depthBillboardUseVerticalAnchorY = true;
    obj.pixiSprite = new globalThis.PIXI.Sprite(new globalThis.PIXI.Texture());
    obj.pixiSprite.width = 400;
    obj.pixiSprite.height = 200;
    obj.pixiSprite.anchor.set(0.5, 0.25);

    const mesh = obj.updateDepthBillboardMesh(
        { app: { screen: { width: 800, height: 600 } } },
        { x: 0, y: 0, z: 0, viewscale: 100, xyratio: 1 },
        {
            alphaCutoff: 0.01,
            useVerticalAnchorY: true
        }
    );

    assert.ok(mesh);
    const positions = Array.from(mesh.geometry.getBuffer("aWorldPosition").data);
    assert.deepEqual(positions.slice(0, 12), [
        8, 20, -1.5,
        12, 20, -1.5,
        12, 20, 0.5,
        8, 20, 0.5
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
        currentLayerBaseZ: 0,
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

test("placed object load recenters hitboxes and node index after saved position restore", () => {
    restoreGlobals();
    installTestGlobals();
    delete require.cache[STATIC_OBJECTS_MODULE_PATH];
    require(STATIC_OBJECTS_MODULE_PATH);

    const constructorGroundNode = new TestNode();
    constructorGroundNode.xindex = 4;
    constructorGroundNode.yindex = 5;
    constructorGroundNode.x = 4;
    constructorGroundNode.y = 5;
    const constructorUpperNode = new TestNode();
    constructorUpperNode.xindex = 4;
    constructorUpperNode.yindex = 5;
    constructorUpperNode.x = 4;
    constructorUpperNode.y = 5;
    constructorUpperNode.traversalLayer = 1;
    constructorUpperNode.level = 1;
    constructorUpperNode.surfaceId = "upper-surface";
    constructorUpperNode.fragmentId = "upper-fragment";

    const savedGroundNode = new TestNode();
    savedGroundNode.xindex = 8;
    savedGroundNode.yindex = 9;
    savedGroundNode.x = 8;
    savedGroundNode.y = 9;
    const savedUpperNode = new TestNode();
    savedUpperNode.xindex = 8;
    savedUpperNode.yindex = 9;
    savedUpperNode.x = 8;
    savedUpperNode.y = 9;
    savedUpperNode.traversalLayer = 1;
    savedUpperNode.level = 1;
    savedUpperNode.surfaceId = "upper-surface";
    savedUpperNode.fragmentId = "upper-fragment";

    const map = {
        objects: [],
        scenery: {},
        worldToNode(x, y) {
            if (x === 8 && y === 9) return savedGroundNode;
            return constructorGroundNode;
        },
        getFloorNodeAtLayer(x, y, layer, options) {
            assert.equal(layer, 1);
            assert.equal(options.surfaceId, "upper-surface");
            assert.equal(options.fragmentId, "upper-fragment");
            if (x === 8 && y === 9) return savedUpperNode;
            return constructorUpperNode;
        },
        registerFloorObject() {
            return {};
        },
        addObjectToFloorBuildingManifest() {
            return true;
        }
    };

    const obj = globalThis.StaticObject.loadJson({
        type: "placedObject",
        category: "furniture",
        texturePath: "/assets/images/furniture/crystal%20ball.png",
        x: 8,
        y: 9,
        z: 0,
        zMode: "local",
        traversalLayer: 1,
        level: 1,
        currentLayerBaseZ: 0,
        surfaceId: "upper-surface",
        fragmentId: "upper-fragment",
        floorMembership: {
            ownerType: "building",
            ownerId: "building:placed-9",
            floorId: "upper-fragment"
        }
    }, map);

    assert.ok(obj);
    assert.equal(obj.shadowBox.x, 8);
    assert.equal(obj.shadowBox.y, 9);
    assert.equal(obj.touchBox.x, 8);
    assert.equal(obj.touchBox.y, 9 - obj.height * 0.25);
    assert.equal(obj.node, savedUpperNode);
    assert.equal(savedUpperNode.objects.includes(obj), true);
    assert.equal(constructorUpperNode.objects.includes(obj), false);
    assert.equal(constructorGroundNode.objects.includes(obj), false);

    delete require.cache[STATIC_OBJECTS_MODULE_PATH];
    restoreGlobals();
});

test("placed object load skips legacy floor manifest for prototype building fragments", () => {
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
    upperNode.surfaceId = "building:placed-4:surface:floor-fragment-34";
    upperNode.fragmentId = "building:placed-4:floor:floor-fragment-34";

    const map = {
        objects: [],
        scenery: {},
        floorsById: new Map([[
            upperNode.fragmentId,
            {
                fragmentId: upperNode.fragmentId,
                surfaceId: upperNode.surfaceId,
                ownerType: "building",
                ownerId: "building:placed-4",
                renderedByBuildingCutaway: true,
                level: 1
            }
        ]]),
        worldToNode() {
            return groundNode;
        },
        getFloorNodeAtLayer(x, y, layer, options) {
            assert.equal(x, 4);
            assert.equal(y, 5);
            assert.equal(layer, 1);
            assert.equal(options.surfaceId, upperNode.surfaceId);
            assert.equal(options.fragmentId, upperNode.fragmentId);
            return upperNode;
        },
        addObjectToFloorBuildingManifest() {
            throw new Error("prototype building cutaway objects should not use the legacy floor manifest");
        }
    };

    const obj = globalThis.StaticObject.loadJson({
        type: "placedObject",
        category: "furniture",
        texturePath: "/assets/images/furniture/chair.png",
        x: 4,
        y: 5,
        z: 0,
        zMode: "local",
        traversalLayer: 1,
        level: 1,
        currentLayerBaseZ: 0,
        surfaceId: upperNode.surfaceId,
        fragmentId: upperNode.fragmentId
    }, map);

    assert.ok(obj);
    assert.equal(obj.node, upperNode);
    assert.equal(obj.surfaceId, upperNode.surfaceId);
    assert.equal(obj.fragmentId, upperNode.fragmentId);
    assert.equal(upperNode.objects.includes(obj), true);
    assert.equal(groundNode.objects.includes(obj), false);

    delete require.cache[STATIC_OBJECTS_MODULE_PATH];
    restoreGlobals();
});

test("prototype building placed object support restore preserves local z", () => {
    const source = fs.readFileSync(SECTION_WORLD_ENTITY_SYNC_MODULE_PATH, "utf8");

    assert.match(source, /entry\.record\.type === "placedObject"/);
    assert.match(source, /entry\.record\.zMode === "local"/);
    assert.match(source, /Math\.abs\(savedLocalZ - baseZ\) <= 0\.001/);
    assert.match(source, /corrected placed object local z that matched floor base/);
    assert.match(source, /runtimeObj\.z = correctedLocalZ;/);
    assert.match(source, /runtimeObj\._renderLayerBaseZ = baseZ;/);
});
