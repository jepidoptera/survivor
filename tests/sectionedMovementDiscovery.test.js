const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadMovementClasses() {
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
        renderNowMs: 0,
        showPerfReadout: false,
        setTimeout: () => 1,
        clearTimeout() {},
        setInterval: () => 1,
        clearInterval() {},
        Inventory: class Inventory {},
        PIXI: {
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
        },
        Scripting: {
            isDoorPlacedObject(obj) {
                return !!(obj && obj.category === "doors");
            },
            isDoorLocked(obj) {
                return !!(obj && obj.isPassable === false);
            },
            isPointInDoorHitbox(hitbox, x, y, radius = 0) {
                const probe = { type: "circle", x, y, radius };
                if (hitbox && typeof hitbox.intersects === "function") {
                    return !!hitbox.intersects(probe);
                }
                return !!(hitbox && typeof hitbox.containsPoint === "function" && hitbox.containsPoint(x, y));
            }
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

    vm.runInContext("globalThis.__testExports = { Character, Wizard, PolygonHitbox };", context);
    return context.__testExports;
}

const { Character, Wizard, PolygonHitbox } = loadMovementClasses();

function createSparseSectionMap(activeNode) {
    const inactiveNode = {
        xindex: 0,
        yindex: 0,
        x: 0,
        y: 0.5,
        objects: []
    };

    return {
        width: 1,
        height: 1,
        nodes: [[inactiveNode]],
        worldToNode(worldX, worldY) {
            const distance = Math.hypot(Number(worldX) - Number(activeNode.x), Number(worldY) - Number(activeNode.y));
            return distance <= 1.05 ? activeNode : null;
        },
        getNodesInIndexWindow(xStart, xEnd, yStart, yEnd) {
            if (
                activeNode.xindex >= xStart && activeNode.xindex <= xEnd &&
                activeNode.yindex >= yStart && activeNode.yindex <= yEnd
            ) {
                return [activeNode];
            }
            return [];
        }
    };
}

function createRectHitbox(left, top, right, bottom) {
    return {
        containsPoint(x, y) {
            return x >= left && x <= right && y >= top && y <= bottom;
        },
        intersects(probe) {
            if (!probe || probe.type !== "circle") return false;
            const nearestX = Math.max(left, Math.min(right, Number(probe.x) || 0));
            const nearestY = Math.max(top, Math.min(bottom, Number(probe.y) || 0));
            const dx = (Number(probe.x) || 0) - nearestX;
            const dy = (Number(probe.y) || 0) - nearestY;
            const resolvedRadius = Math.max(0, Number(probe.radius) || 0);
            return (dx * dx) + (dy * dy) <= resolvedRadius * resolvedRadius;
        }
    };
}

test("sparse section maps still return nearby blocking objects when one padded corner is missing", () => {
    const activeNode = {
        xindex: 100,
        yindex: 100,
        x: 86.6,
        y: 100.5,
        objects: []
    };
    const map = createSparseSectionMap(activeNode);
    const blockingRock = {
        gone: false,
        isPassable: false,
        groundPlaneHitbox: createRectHitbox(activeNode.x - 0.5, activeNode.y - 0.5, activeNode.x + 0.5, activeNode.y + 0.5)
    };
    activeNode.objects.push(blockingRock);

    const actor = Object.create(Character.prototype);
    actor.map = map;
    actor.z = 0;

    const nearbyObjects = actor.collectNearbyBlockingObjects(activeNode.x, activeNode.y, 0.5, {});

    assert.equal(nearbyObjects.length, 1);
    assert.equal(nearbyObjects[0], blockingRock);
});

test("wizard still discovers nearby doors on sparse section maps when one padded corner is missing", () => {
    const activeNode = {
        xindex: 100,
        yindex: 100,
        x: 86.6,
        y: 100.5,
        objects: []
    };
    const map = createSparseSectionMap(activeNode);
    const doorHitbox = new PolygonHitbox([
        { x: activeNode.x - 0.5, y: activeNode.y - 1.5 },
        { x: activeNode.x + 0.5, y: activeNode.y - 1.5 },
        { x: activeNode.x + 0.5, y: activeNode.y + 1.5 },
        { x: activeNode.x - 0.5, y: activeNode.y + 1.5 }
    ]);
    const door = {
        gone: false,
        category: "doors",
        isPassable: true,
        groundPlaneHitbox: doorHitbox
    };
    activeNode.objects.push(door);

    const wizard = Object.create(Wizard.prototype);
    wizard.map = map;
    wizard.z = 0;
    wizard._movementNearbyObjects = [];
    wizard._movementNearbyDoors = [];
    wizard._movementForceTouchedObjects = new Set();

    const context = wizard.prepareVectorMovementContext(activeNode.x, activeNode.y, 0.5, {});

    assert.equal(context.nearbyDoors.length, 1);
    assert.equal(context.nearbyDoors[0].obj, door);
    assert.equal(context.nearbyDoors[0].canTraverse, true);
});