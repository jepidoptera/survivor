const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadWizardClass() {
    const context = {
        console,
        Math,
        Date,
        JSON,
        Map,
        Set,
        WeakMap,
        WeakSet,
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
        performance: { now: () => 0 },
        paused: false,
        frameRate: 60,
        textures: {},
        animals: [],
        powerups: [],
        roofs: [],
        roof: null,
        wizard: null,
        player: null,
        viewport: { x: 0, y: 0 },
        viewscale: 1,
        xyratio: 1,
        objectLayer: [],
        characterLayer: { addChild() {}, children: [], setChildIndex() {} },
        overlayContainer: { addChild() {}, children: [], setChildIndex() {} },
        centerViewport() {},
        applyViewportWrapShift() {},
        worldToScreen(point) { return { x: point.x, y: point.y }; },
        renderNowMs: 0,
        showPerfReadout: false,
        wizardFrames: Array.from({ length: 36 }, (_, index) => ({ frame: index })),
        setTimeout: () => 1,
        clearTimeout() {},
        setInterval: () => 1,
        clearInterval() {},
        Inventory: class Inventory {},
        PIXI: {
            Texture: { WHITE: { frame: "white" } },
            Sprite: class Sprite {
                constructor(texture) {
                    this.texture = texture;
                    this.parent = null;
                    this.x = 0;
                    this.y = 0;
                    this.width = 0;
                    this.height = 0;
                    this.anchor = { set() {} };
                }
            },
            Graphics: class Graphics {
                constructor() {
                    this.parent = null;
                    this.visible = false;
                    this.scale = { set() {} };
                }
                clear() {}
                lineStyle() {}
                drawCircle() {}
                beginFill() {}
                endFill() {}
            },
            State: class State {},
            Geometry: class Geometry {
                addAttribute() { return this; }
                addIndex() { return this; }
            },
            Shader: { from() { return { uniforms: {} }; } },
            Mesh: class Mesh {
                constructor() {
                    this.parent = null;
                    this.visible = false;
                    this.destroyed = false;
                }
            },
            DRAW_MODES: { TRIANGLES: 0 }
        }
    };
    context.window = context;
    context.globalThis = context;
    vm.createContext(context);

    const files = [
        path.join(__dirname, "../public/assets/javascript/gameobjects/hitbox.js"),
        path.join(__dirname, "../public/assets/javascript/gameobjects/Character.js"),
        path.join(__dirname, "../public/assets/javascript/gameobjects/Wizard.js")
    ];

    for (const filePath of files) {
        const source = fs.readFileSync(filePath, "utf8");
        vm.runInContext(source, context, { filename: filePath });
    }

    vm.runInContext("globalThis.__testExports = { Wizard, PolygonHitbox, wizardFrames };", context);
    return context.__testExports;
}

const { Wizard, PolygonHitbox, wizardFrames } = loadWizardClass();

function createDoorEntry(hitbox, canTraverse = true) {
    return {
        obj: {
            type: "placedObject",
            category: "doors",
            gone: false
        },
        hitbox,
        canTraverse
    };
}

test("wizard does not bypass wall collisions just because the current position is inside a door", () => {
    const wallHitbox = new PolygonHitbox([
        { x: -6, y: -3 },
        { x: 6, y: -3 },
        { x: 6, y: 3 },
        { x: -6, y: 3 }
    ]);
    const doorHitbox = new PolygonHitbox([
        { x: -1.5, y: -3 },
        { x: 1.5, y: -3 },
        { x: 1.5, y: 3 },
        { x: -1.5, y: 3 }
    ]);

    const wizard = Object.create(Wizard.prototype);
    const context = {
        nearbyDoors: [createDoorEntry(doorHitbox, true)],
        nearbyObjects: [{ groundPlaneHitbox: wallHitbox, isPassable: false }],
        isPointInDoorHitboxFn(hitbox, x, y, radius = 0) {
            const probe = { type: "circle", x, y, radius };
            if (typeof hitbox.intersects === "function") {
                return !!hitbox.intersects(probe);
            }
            return !!hitbox.containsPoint(x, y);
        }
    };

    const bypass = wizard.canBypassVectorMovementCollisions(0, 0, 4, 0, 0.5, context, {});

    assert.equal(bypass, false);
});

test("wizard still bypasses wall collisions when the candidate position remains inside the door opening", () => {
    const wallHitbox = new PolygonHitbox([
        { x: -6, y: -3 },
        { x: 6, y: -3 },
        { x: 6, y: 3 },
        { x: -6, y: 3 }
    ]);
    const doorHitbox = new PolygonHitbox([
        { x: -1.5, y: -3 },
        { x: 1.5, y: -3 },
        { x: 1.5, y: 3 },
        { x: -1.5, y: 3 }
    ]);

    const wizard = Object.create(Wizard.prototype);
    const context = {
        nearbyDoors: [createDoorEntry(doorHitbox, true)],
        nearbyObjects: [{ groundPlaneHitbox: wallHitbox, isPassable: false }],
        isPointInDoorHitboxFn(hitbox, x, y, radius = 0) {
            const probe = { type: "circle", x, y, radius };
            if (typeof hitbox.intersects === "function") {
                return !!hitbox.intersects(probe);
            }
            return !!hitbox.containsPoint(x, y);
        }
    };

    const bypass = wizard.canBypassVectorMovementCollisions(0, 0, 1, 0, 0.5, context, {});

    assert.equal(bypass, true);
});

test("wizard cannot keep bypassing by clipping the door endcap while sliding into the wall", () => {
    const wallHitbox = new PolygonHitbox([
        { x: -6, y: -3 },
        { x: 6, y: -3 },
        { x: 6, y: 3 },
        { x: -6, y: 3 }
    ]);
    const doorHitbox = new PolygonHitbox([
        { x: -1.5, y: -3 },
        { x: 1.5, y: -3 },
        { x: 1.5, y: 3 },
        { x: -1.5, y: 3 }
    ]);

    const wizard = Object.create(Wizard.prototype);
    const context = {
        nearbyDoors: [{
            ...createDoorEntry(doorHitbox, true),
            obj: {
                type: "placedObject",
                category: "doors",
                gone: false,
                width: 3
            }
        }],
        nearbyObjects: [{ groundPlaneHitbox: wallHitbox, isPassable: false }],
        isPointInDoorHitboxFn(hitbox, x, y, radius = 0) {
            const probe = { type: "circle", x, y, radius };
            if (typeof hitbox.intersects === "function") {
                return !!hitbox.intersects(probe);
            }
            return !!hitbox.containsPoint(x, y);
        }
    };

    const positions = [0, 0.4, 0.8, 1.2];
    const results = [];
    for (let i = 1; i < positions.length; i++) {
        results.push(
            wizard.canBypassVectorMovementCollisions(
                positions[i - 1],
                0,
                positions[i],
                0,
                0.5,
                context,
                {}
            )
        );
    }

    assert.deepEqual(results, [true, true, false]);
});

test("wizard can still bypass through a narrow mounted door opening", () => {
    const wallHitbox = new PolygonHitbox([
        { x: -6, y: -3 },
        { x: 6, y: -3 },
        { x: 6, y: 3 },
        { x: -6, y: 3 }
    ]);
    const doorHitbox = new PolygonHitbox([
        { x: -0.21, y: -3 },
        { x: 0.21, y: -3 },
        { x: 0.21, y: 3 },
        { x: -0.21, y: 3 }
    ]);

    const wizard = Object.create(Wizard.prototype);
    const context = {
        nearbyDoors: [{
            ...createDoorEntry(doorHitbox, true),
            obj: {
                type: "placedObject",
                category: "doors",
                gone: false,
                width: 0.42
            }
        }],
        nearbyObjects: [{ groundPlaneHitbox: wallHitbox, isPassable: false }],
        isPointInDoorHitboxFn(hitbox, x, y, radius = 0) {
            const probe = { type: "circle", x, y, radius };
            if (typeof hitbox.intersects === "function") {
                return !!hitbox.intersects(probe);
            }
            return !!hitbox.containsPoint(x, y);
        }
    };

    const bypass = wizard.canBypassVectorMovementCollisions(0, 0, 0.1, 0, 0.3, context, {});

    assert.equal(bypass, true);
});

test("wizard draw keeps dead wizard on standing frame", () => {
    const wizard = Object.create(Wizard.prototype);
    wizard.pixiSprite = null;
    wizard.shadowGraphics = {
        parent: true,
        clear() {},
        beginFill() {},
        drawEllipse() {},
        endFill() {}
    };
    wizard.getInterpolatedPosition = () => ({ x: 12, y: 8, z: 0 });
    wizard.drawShield = () => {};
    wizard.drawHat = () => {};
    wizard.movementVector = { x: 2, y: 0 };
    wizard.moving = true;
    wizard.dead = true;
    wizard.hp = 0;
    wizard.lastDirectionRow = 1;
    wizard.isJumping = false;
    wizard.isMovingBackward = false;
    wizard.animationSpeedMultiplier = 1;
    wizard.speed = 2.5;

    wizard.draw();

    assert.deepEqual(wizard.pixiSprite.texture, wizardFrames[9]);
});

test("wizard can enter a thin mounted door opening before the center reaches the wall plane", () => {
    const wallHitbox = new PolygonHitbox([
        { x: -6, y: -0.22 },
        { x: 6, y: -0.22 },
        { x: 6, y: 0.22 },
        { x: -6, y: 0.22 }
    ]);
    const doorHitbox = new PolygonHitbox([
        { x: -0.375, y: -0.22 },
        { x: 0.375, y: -0.22 },
        { x: 0.375, y: 0.22 },
        { x: -0.375, y: 0.22 }
    ]);

    const wizard = Object.create(Wizard.prototype);
    const context = {
        nearbyDoors: [{
            ...createDoorEntry(doorHitbox, true),
            obj: {
                type: "placedObject",
                category: "doors",
                gone: false,
                width: 0.75
            }
        }],
        nearbyObjects: [{ groundPlaneHitbox: wallHitbox, isPassable: false }],
        isPointInDoorHitboxFn(hitbox, x, y, radius = 0) {
            const probe = { type: "circle", x, y, radius };
            if (typeof hitbox.intersects === "function") {
                return !!hitbox.intersects(probe);
            }
            return !!hitbox.containsPoint(x, y);
        }
    };

    const bypass = wizard.canBypassVectorMovementCollisions(0, -0.6, 0, -0.25, 0.3, context, {});

    assert.equal(bypass, true);
});
