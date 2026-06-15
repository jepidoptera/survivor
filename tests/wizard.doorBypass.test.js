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
        viewport: { x: 0, y: 0, width: 100, height: 100 },
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
        wizardMouseTurnZeroDistanceUnits: 1,
        wizardMouseTurnFullDistanceUnits: 10,
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
                drawEllipse() {}
                drawRect() {}
                beginFill() {}
                endFill() {}
                moveTo() {}
                lineTo() {}
                closePath() {}
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

function createWizardMap(node) {
    return {
        width: 1,
        height: 1,
        nodes: [[node]],
        worldToNode() {
            return node;
        },
        registerGameObject() {},
        unregisterGameObject() {},
        findPath() {
            return [];
        }
    };
}

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

test("wizard selected floor keeps traversal layer synchronized for enemy targeting", () => {
    const floorNode = {
        xindex: 0,
        yindex: 0,
        x: 0,
        y: 0,
        traversalLayer: -2,
        baseZ: -6,
        neighbors: [],
        objects: []
    };
    const wizard = new Wizard({ x: 0, y: 0 }, createWizardMap(floorNode));

    assert.equal(wizard.currentLayer, -2);
    assert.equal(wizard.traversalLayer, -2);
    assert.equal(wizard.currentLayerBaseZ, -6);

    wizard.selectedFloorEditLevel = 1;

    assert.equal(wizard.currentLayer, 1);
    assert.equal(wizard.traversalLayer, 1);
    assert.equal(wizard.currentLayerBaseZ, 3);
});

test("wizard takeDamage calls die when damage is lethal", () => {
    const wizard = Object.create(Wizard.prototype);
    wizard.hp = 5;
    wizard.maxHp = 5;
    wizard.difficulty = 3;
    wizard.dead = false;
    wizard.magic = 0;
    wizard.shieldHp = 0;
    wizard.maxShieldHp = 0;
    wizard.isAdventureMode = () => false;
    let dieCalls = 0;
    wizard.die = () => {
        dieCalls++;
        wizard.dead = true;
    };
    wizard.updateStatusBars = () => {};

    const applied = wizard.takeDamage(10);

    assert.equal(applied, 5);
    assert.equal(wizard.hp, 0);
    assert.equal(wizard.dead, true);
    assert.equal(dieCalls, 1);
});

test("wizard takeDamage routes lethal adventure damage through adventure death state", () => {
    const wizard = Object.create(Wizard.prototype);
    wizard.hp = 5;
    wizard.maxHp = 5;
    wizard.difficulty = 3;
    wizard.dead = false;
    wizard.magic = 0;
    wizard.shieldHp = 0;
    wizard.maxShieldHp = 0;
    wizard.isAdventureMode = () => true;
    wizard.die = () => {
        throw new Error("adventure damage should use updateAdventureDeathState");
    };
    let adventureDeathCalls = 0;
    wizard.updateAdventureDeathState = () => {
        adventureDeathCalls++;
        wizard.dead = true;
        wizard.hp = 0;
        return true;
    };
    wizard.updateStatusBars = () => {};

    const applied = wizard.takeDamage(10);

    assert.equal(applied, 5);
    assert.equal(wizard.hp, 0);
    assert.equal(wizard.dead, true);
    assert.equal(adventureDeathCalls, 1);
});

test("wizard movement context includes direct prototype building blockers without upper floor nodes", () => {
    const baseNode = {
        xindex: 0,
        yindex: 0,
        x: 0,
        y: 0,
        traversalLayer: 0,
        baseZ: 0,
        objects: []
    };
    const blocker = {
        type: "prototypeBuildingMovementBlocker",
        traversalLayer: 1,
        level: 1,
        bottomZ: 3,
        height: 3,
        isPassable: false,
        gone: false,
        groundPlaneHitbox: new PolygonHitbox([
            { x: -1, y: -1 },
            { x: 1, y: -1 },
            { x: 1, y: 1 },
            { x: -1, y: 1 }
        ]),
        _prototypeBuildingMovementBlocker: true
    };
    const wizard = Object.create(Wizard.prototype);
    Object.assign(wizard, {
        x: 0,
        y: 0,
        z: 0,
        currentLayer: 1,
        traversalLayer: 1,
        currentLayerBaseZ: 3,
        map: {
            width: 1,
            height: 1,
            nodes: [[baseNode]],
            worldToNode() {
                return baseNode;
            },
            getNodesInIndexWindow() {
                return [baseNode];
            },
            getFloorNodeAtLayer() {
                return null;
            },
            collectPrototypeBuildingMovementBlockersInBounds(bounds, layer) {
                assert.equal(layer, 1);
                assert.ok(bounds.minX <= 0 && bounds.maxX >= 0);
                return [blocker];
            }
        }
    });

    const context = wizard.prepareVectorMovementContext(0.25, 0, 0.35, {});

    assert.equal(context.nearbyObjects.includes(blocker), true);
});

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

test("wizard save/load preserves stair support until runtime stairs are rebuilt", () => {
    const savingWizard = Object.create(Wizard.prototype);
    Object.assign(savingWizard, {
        x: 1.25,
        y: 2.5,
        z: 1.25,
        currentLayer: 0,
        traversalLayer: 0,
        currentLayerBaseZ: 0,
        surfaceId: "lower_surface",
        fragmentId: "lower_fragment",
        hp: 100,
        maxHp: 100,
        map: {
            wrapWorldX(value) { return value; },
            wrapWorldY(value) { return value; }
        },
        _stairSupport: {
            stairId: "building:stairs-a",
            treadIndex: 1,
            upDown: 0.4166667,
            leftRight: 0.25,
            baseZ: 1,
            localZ: 1,
            continuousBaseZ: 1.25,
            continuousLocalZ: 1.25
        },
        getTemperature() { return 0; },
        getTemperatureBaseline() { return 0; },
        serializeInventory() { return []; }
    });

    const saved = savingWizard.saveJson();
    assert.equal(saved.z, 1.25);
    assert.equal(saved.currentLayer, 0);
    assert.equal(saved.currentLayerBaseZ, 0);
    assert.deepEqual(JSON.parse(JSON.stringify(saved.stairSupport)), {
        stairId: "building:stairs-a",
        treadIndex: 1,
        upDown: 0.4166667,
        leftRight: 0.25,
        baseZ: 1,
        localZ: 1,
        continuousBaseZ: 1.25,
        continuousLocalZ: 1.25
    });

    const loadMap = {
        stairsById: new Map(),
        wrapWorldX(value) { return value; },
        wrapWorldY(value) { return value; },
        worldToNode() {
            return { traversalLayer: 0, baseZ: 0, objects: [] };
        },
        shortestDeltaX(fromX, toX) { return toX - fromX; },
        shortestDeltaY(fromY, toY) { return toY - fromY; },
        getActorStairSupportFromState(actor) {
            const state = actor._stairSupport;
            assert.equal(state.stairId, "building:stairs-a");
            return {
                type: "stair",
                stairId: state.stairId,
                treadIndex: state.treadIndex,
                upDown: state.upDown,
                leftRight: state.leftRight,
                baseZ: state.baseZ,
                point: { x: 4.5, y: 6.25 },
                stair: {
                    id: state.stairId,
                    lowerLevel: 0,
                    higherLevel: 1,
                    lowerZ: 0,
                    higherZ: 3
                }
            };
        },
        applyActorResolvedMovementSupport(actor, x, y) {
            const support = actor._pendingVectorMovementSupport;
            actor._pendingVectorMovementSupport = null;
            actor.x = x;
            actor.y = y;
            actor._stairSupport = {
                stairId: support.stairId,
                treadIndex: support.treadIndex,
                upDown: support.upDown,
                leftRight: support.leftRight,
                baseZ: support.baseZ,
                localZ: support.baseZ,
                continuousBaseZ: 1.25,
                continuousLocalZ: 1.25
            };
            actor.z = support.baseZ;
            actor.currentLayer = 0;
            actor.traversalLayer = 0;
            actor.currentLayerBaseZ = 0;
            return support;
        }
    };
    const loadedWizard = Object.create(Wizard.prototype);
    Object.assign(loadedWizard, {
        map: loadMap,
        node: null,
        x: 0,
        y: 0,
        z: 0,
        currentLayer: 0,
        traversalLayer: 0,
        currentLayerBaseZ: 0,
        ensureMagicPointsInitialized() {},
        getTemperatureBaseline() { return 0; },
        setTemperature() {},
        isFrozen() { return false; },
        applyFrozenState() {},
        setGameMode(value) { this.gameMode = value; },
        setDifficulty(value) { this.difficulty = value; },
        loadInventory() {},
        updateHitboxes() {},
        refreshSpellSelector() {},
        refreshEditorSelector() {},
        updateModeToggleUi() {}
    });

    loadedWizard.loadJson({
        x: saved.x,
        y: saved.y,
        z: saved.z,
        currentLayer: saved.currentLayer,
        traversalLayer: saved.traversalLayer,
        currentLayerBaseZ: saved.currentLayerBaseZ,
        stairSupport: saved.stairSupport,
        viewport: { x: 0, y: 0 }
    });

    assert.equal(loadedWizard.hasPendingSavedMovementSupport(), true);
    assert.equal(loadedWizard._stairSupport.stairId, "building:stairs-a");
    loadMap.stairsById.set("building:stairs-a", { id: "building:stairs-a" });
    loadedWizard.restoreSavedMovementSupport();
    assert.equal(loadedWizard.hasPendingSavedMovementSupport(), false);
    assert.equal(loadedWizard.x, 4.5);
    assert.equal(loadedWizard.y, 6.25);
    assert.equal(loadedWizard._stairSupport.stairId, "building:stairs-a");
});

test("wizard save omits generated outdoor ground floor fragment support", () => {
    const groundFragment = {
        fragmentId: "section:0,0:ground",
        surfaceId: "section:0,0:ground",
        level: 0,
        ownerType: "section",
        ownerId: "0,0",
        _prototypeGroundFloor: true,
        outerPolygon: [
            { x: -10, y: -10 },
            { x: 10, y: -10 },
            { x: 10, y: 10 },
            { x: -10, y: 10 }
        ]
    };
    const wizard = Object.create(Wizard.prototype);
    Object.assign(wizard, {
        x: 1,
        y: 2,
        z: 0,
        currentLayer: 0,
        traversalLayer: 0,
        currentLayerBaseZ: 0,
        surfaceId: groundFragment.surfaceId,
        fragmentId: groundFragment.fragmentId,
        currentMovementSupport: {
            type: "floor",
            layer: 0,
            baseZ: 0,
            fragment: groundFragment,
            fragmentId: groundFragment.fragmentId,
            surfaceId: groundFragment.surfaceId
        },
        hp: 100,
        maxHp: 100,
        map: {
            floorsById: new Map([[groundFragment.fragmentId, groundFragment]]),
            wrapWorldX(value) { return value; },
            wrapWorldY(value) { return value; },
            isPointSupportedByFloorFragment() { return true; }
        },
        getTemperature() { return 0; },
        getTemperatureBaseline() { return 0; },
        serializeInventory() { return []; }
    });

    const saved = wizard.saveJson();

    assert.equal(saved.currentLayer, 0);
    assert.equal(saved.surfaceId, undefined);
    assert.equal(saved.fragmentId, undefined);
});

test("wizard load restores stale generated outdoor ground fragment as ground support", () => {
    const groundFragment = {
        fragmentId: "section:0,0:ground",
        surfaceId: "section:0,0:ground",
        level: 0,
        ownerType: "section",
        ownerId: "0,0",
        _prototypeGroundFloor: true,
        outerPolygon: [
            { x: -10, y: -10 },
            { x: 10, y: -10 },
            { x: 10, y: 10 },
            { x: -10, y: 10 }
        ]
    };
    const node = { xindex: 2, yindex: 3, traversalLayer: 0, baseZ: 0, objects: [] };
    const loadedWizard = Object.create(Wizard.prototype);
    Object.assign(loadedWizard, {
        map: {
            floorsById: new Map([[groundFragment.fragmentId, groundFragment]]),
            wrapWorldX(value) { return value; },
            wrapWorldY(value) { return value; },
            worldToNode() { return node; },
            getFloorSupportAtWorldPosition() { return null; },
            isPointSupportedByFloorFragment() { return false; },
            setActorCurrentMovementSupport(actor, support) {
                actor.currentMovementSupport = support;
                actor.currentLayer = support.layer;
                actor.traversalLayer = support.layer;
                actor.currentLayerBaseZ = support.baseZ;
                if (support.type === "ground") {
                    actor.surfaceId = "";
                    actor.fragmentId = "";
                }
                return support;
            }
        },
        node: null,
        x: 0,
        y: 0,
        z: 0,
        currentLayer: 0,
        traversalLayer: 0,
        currentLayerBaseZ: 0,
        ensureMagicPointsInitialized() {},
        getTemperatureBaseline() { return 0; },
        setTemperature() {},
        isFrozen() { return false; },
        applyFrozenState() {},
        setGameMode(value) { this.gameMode = value; },
        setDifficulty(value) { this.difficulty = value; },
        loadInventory() {},
        updateHitboxes() {},
        refreshSpellSelector() {},
        refreshEditorSelector() {},
        updateModeToggleUi() {}
    });
    const warnings = [];
    const originalWarn = console.warn;
    console.warn = (...args) => warnings.push(args);
    try {
        loadedWizard.loadJson({
            x: 50,
            y: 50,
            z: 0,
            currentLayer: 0,
            traversalLayer: 0,
            currentLayerBaseZ: 0,
            surfaceId: groundFragment.surfaceId,
            fragmentId: groundFragment.fragmentId,
            viewport: { x: 0, y: 0 }
        });
    } finally {
        console.warn = originalWarn;
    }

    assert.equal(loadedWizard.hasPendingSavedMovementSupport(), false);
    assert.equal(loadedWizard.currentMovementSupport.type, "ground");
    assert.equal(loadedWizard.fragmentId, "");
    assert.equal(loadedWizard.surfaceId, "");
    assert.equal(warnings.length, 1);
    assert.match(warnings[0][0], /generated outdoor ground fragment/);
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
