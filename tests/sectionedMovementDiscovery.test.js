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

test("wizard movement discovers blockers on the wizard's current floor layer", () => {
    const baseNode = {
        xindex: 100,
        yindex: 100,
        x: 86.6,
        y: 100.5,
        traversalLayer: 0,
        objects: []
    };
    const upperNode = {
        xindex: 100,
        yindex: 100,
        x: 86.6,
        y: 100.5,
        traversalLayer: 1,
        baseZ: 3,
        sourceNode: baseNode,
        objects: []
    };
    const map = {
        width: 1,
        height: 1,
        nodes: [[baseNode]],
        worldToNode() {
            return baseNode;
        },
        getNodesInIndexWindow() {
            return [baseNode];
        },
        getFloorNodeAtLayer(xindex, yindex, layer) {
            return Number(xindex) === 100 && Number(yindex) === 100 && Number(layer) === 1
                ? upperNode
                : null;
        }
    };
    const groundWall = {
        gone: false,
        isPassable: false,
        traversalLayer: 0,
        bottomZ: 0,
        height: 3,
        groundPlaneHitbox: createRectHitbox(baseNode.x - 0.5, baseNode.y - 0.5, baseNode.x + 0.5, baseNode.y + 0.5)
    };
    const upperWall = {
        gone: false,
        isPassable: false,
        traversalLayer: 1,
        bottomZ: 3,
        height: 3,
        groundPlaneHitbox: createRectHitbox(upperNode.x - 0.5, upperNode.y - 0.5, upperNode.x + 0.5, upperNode.y + 0.5)
    };
    baseNode.objects.push(groundWall);
    upperNode.objects.push(upperWall);

    const wizard = Object.create(Wizard.prototype);
    wizard.map = map;
    wizard.z = 0;
    wizard.currentLayer = 1;
    wizard.currentLayerBaseZ = 3;
    wizard._movementNearbyObjects = [];
    wizard._movementNearbyDoors = [];
    wizard._movementForceTouchedObjects = new Set();

    const context = wizard.prepareVectorMovementContext(upperNode.x, upperNode.y, 0.5, {});

    assert.equal(context.nearbyObjects.length, 1);
    assert.equal(context.nearbyObjects[0], upperWall);
});

test("wizard can jump over short blockers on upper floor layers", () => {
    const wizard = Object.create(Wizard.prototype);
    wizard.currentLayer = 1;
    wizard.currentLayerBaseZ = 3;
    wizard.z = 0.5;

    const shortUpperWall = {
        gone: false,
        isPassable: false,
        traversalLayer: 1,
        bottomZ: 3,
        height: 0.5,
        groundPlaneHitbox: createRectHitbox(0, 0, 1, 1)
    };
    const tallerUpperWall = {
        gone: false,
        isPassable: false,
        traversalLayer: 1,
        bottomZ: 3,
        height: 1,
        groundPlaneHitbox: createRectHitbox(0, 0, 1, 1)
    };

    assert.equal(wizard.doesObjectBlockVectorMovement(shortUpperWall), false);
    assert.equal(wizard.doesObjectBlockVectorMovement(tallerUpperWall), true);
});

test("wizard movement only collision-tests each upper-layer blocker once", () => {
    const baseNode = {
        xindex: 100,
        yindex: 100,
        x: 86.6,
        y: 100.5,
        traversalLayer: 0,
        objects: []
    };
    const upperNode = {
        xindex: 100,
        yindex: 100,
        x: 86.6,
        y: 100.5,
        traversalLayer: 1,
        baseZ: 3,
        sourceNode: baseNode,
        objects: []
    };
    const map = {
        width: 1,
        height: 1,
        nodes: [[baseNode]],
        worldToNode() {
            return baseNode;
        },
        getNodesInIndexWindow() {
            return [baseNode, baseNode];
        },
        getFloorNodeAtLayer(xindex, yindex, layer) {
            return Number(xindex) === 100 && Number(yindex) === 100 && Number(layer) === 1
                ? upperNode
                : null;
        }
    };
    const upperWall = {
        gone: false,
        isPassable: false,
        traversalLayer: 1,
        bottomZ: 3,
        height: 3,
        groundPlaneHitbox: createRectHitbox(upperNode.x - 0.5, upperNode.y - 0.5, upperNode.x + 0.5, upperNode.y + 0.5)
    };
    upperNode.objects.push(upperWall, upperWall);

    const wizard = Object.create(Wizard.prototype);
    wizard.map = map;
    wizard.z = 0;
    wizard.currentLayer = 1;
    wizard.currentLayerBaseZ = 3;
    wizard._movementNearbyObjects = [];
    wizard._movementNearbyDoors = [];
    wizard._movementForceTouchedObjects = new Set();

    const context = wizard.prepareVectorMovementContext(upperNode.x, upperNode.y, 0.5, {});

    assert.equal(context.nearbyObjects.length, 1);
    assert.equal(context.nearbyObjects[0], upperWall);
});

test("wizard collision resolver pushes back from zero-vector wall overlaps", () => {
    const wizard = Object.create(Wizard.prototype);
    wizard.x = 0;
    wizard.y = 0;
    wizard.movementVector = { x: 1, y: 0 };
    wizard.frameRate = 1;

    const wall = {
        groundPlaneHitbox: {
            getBounds() {
                return { x: 0.9, y: -1, width: 0.2, height: 2 };
            },
            intersects() {
                return { pushX: 0, pushY: 0 };
            }
        }
    };

    const result = wizard._resolveStaticVectorMovementCandidate(1, 0, 0.25, {
        nearbyObjects: [wall],
        forceTouchedObjects: new Set()
    });

    assert.equal(result.collided, true);
    assert.ok(result.x < 1);
});

test("wizard collision resolver blocks movement swept through thin walls", () => {
    const wizard = Object.create(Wizard.prototype);
    wizard.x = 0;
    wizard.y = 0;
    wizard.movementVector = { x: 1.4, y: 0 };
    wizard.frameRate = 1;

    const wall = {
        groundPlaneHitbox: new PolygonHitbox([
            { x: 0.9, y: -1 },
            { x: 1.1, y: -1 },
            { x: 1.1, y: 1 },
            { x: 0.9, y: 1 }
        ])
    };

    const result = wizard._resolveStaticVectorMovementCandidate(1.4, 0, 0.25, {
        nearbyObjects: [wall],
        forceTouchedObjects: new Set()
    });

    assert.equal(result.collided, true);
    assert.ok(result.x < 0.9);
    assert.ok(wizard.movementVector.x <= 0.01);
});

test("wizard collision resolver does not push through a wall from an inside overlap", () => {
    const wizard = Object.create(Wizard.prototype);
    wizard.x = 0.6;
    wizard.y = 0;
    wizard.movementVector = { x: 1, y: 0 };
    wizard.frameRate = 1;

    const wall = {
        groundPlaneHitbox: new PolygonHitbox([
            { x: 0.9, y: -1 },
            { x: 1.1, y: -1 },
            { x: 1.1, y: 1 },
            { x: 0.9, y: 1 }
        ])
    };

    const result = wizard._resolveStaticVectorMovementCandidate(1, 0, 0.25, {
        nearbyObjects: [wall],
        forceTouchedObjects: new Set()
    });

    assert.equal(result.collided, true);
    assert.ok(result.x < 0.9);
    assert.ok(wizard.movementVector.x <= 0.01);
});

test("wizard can carry airborne movement over unsupported upper-floor positions", () => {
    const wizard = Object.create(Wizard.prototype);
    wizard.x = 0;
    wizard.y = 0;
    wizard.movementVector = { x: 1, y: 0 };
    wizard.updateHitboxes = () => {};
    let occupyChecks = 0;
    wizard.map = {
        canOccupyWorldPosition() {
            occupyChecks += 1;
            return false;
        }
    };

    assert.equal(wizard._applyVectorMovementPosition(1, 0), false);
    assert.equal(wizard.x, 0);
    assert.equal(occupyChecks, 1);

    assert.equal(wizard._applyVectorMovementPosition(1, 0, { allowUnsupportedPosition: true }), true);
    assert.equal(wizard.x, 1);
    assert.equal(wizard.y, 0);
    assert.equal(occupyChecks, 1);
});
