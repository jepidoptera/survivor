const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function assertNearlyEqual(actual, expected, epsilon = 1e-12) {
    assert.ok(
        Math.abs(actual - expected) <= epsilon,
        `expected ${actual} to be within ${epsilon} of ${expected}`
    );
}

function loadSpellContext() {
    const context = {
        console,
        Math,
        Number,
        String,
        Boolean,
        Array,
        Object,
        Map,
        Set,
        WeakMap,
        Date,
        JSON,
        RegExp,
        Error,
        Infinity,
        NaN,
        isFinite,
        parseInt,
        parseFloat,
        performance: { now: () => 0 },
        polygonClipping: require("polygon-clipping"),
        document: { createElement: () => ({ src: "" }) },
        PIXI: {},
        animals: [],
        paused: false,
        frameRate: 60,
        setInterval: () => 1,
        clearInterval() {},
        setTimeout: () => 1,
        clearTimeout() {}
    };
    context.globalThis = context;
    context.window = context;
    vm.createContext(context);

    const files = [
        path.join(__dirname, "../public/assets/javascript/spells/FloorFragmentEdit.js"),
        path.join(__dirname, "../public/assets/javascript/spells/Spell.js"),
        path.join(__dirname, "../public/assets/javascript/spells.js")
    ];
    for (const filePath of files) {
        vm.runInContext(fs.readFileSync(filePath, "utf8"), context, { filename: filePath });
    }
    return context;
}

function loadVanishContext() {
    const context = {
        console,
        Math,
        Number,
        String,
        Boolean,
        Array,
        Object,
        Map,
        Set,
        WeakMap,
        Date,
        JSON,
        RegExp,
        Error,
        Infinity,
        NaN,
        isFinite,
        parseInt,
        parseFloat,
        performance: { now: () => 0 },
        document: { createElement: () => ({ src: "" }) },
        PIXI: {},
        animals: [],
        paused: false,
        frameRate: 60,
        setInterval: () => 1,
        clearInterval() {},
        setTimeout: () => 1,
        clearTimeout() {},
        message() {}
    };
    context.globalThis = context;
    context.window = context;
    context.wizard = {
        x: 10,
        y: 12,
        z: 0,
        magic: 100,
        currentLayer: 2,
        currentLayerBaseZ: 6,
        map: null
    };
    vm.createContext(context);

    const files = [
        path.join(__dirname, "../public/assets/javascript/spells/Spell.js"),
        path.join(__dirname, "../public/assets/javascript/spells/Vanish.js")
    ];
    for (const filePath of files) {
        vm.runInContext(fs.readFileSync(filePath, "utf8"), context, { filename: filePath });
    }
    return context;
}

function loadTeleportContext() {
    const messages = [];
    const context = {
        console,
        Math,
        Number,
        String,
        Boolean,
        Array,
        Object,
        Map,
        Set,
        WeakMap,
        Date,
        JSON,
        RegExp,
        Error,
        Infinity,
        NaN,
        isFinite,
        parseInt,
        parseFloat,
        performance: { now: () => 0 },
        document: { createElement: () => ({ src: "" }) },
        PIXI: {},
        animals: [],
        paused: false,
        frameRate: 60,
        setInterval: () => 1,
        clearInterval() {},
        setTimeout: () => 1,
        clearTimeout() {},
        centerViewport() {},
        message(text) {
            messages.push(String(text));
        }
    };
    context.globalThis = context;
    context.window = context;
    context.wizard = {
        x: 10,
        y: 12,
        z: -1,
        magic: 100,
        currentLayer: 7,
        traversalLayer: 7,
        currentLayerBaseZ: 21,
        _floorFallState: { active: true },
        map: {
            wrapWorldX: x => x,
            wrapWorldY: y => y
        },
        syncTraversalLayerFromNode(node) {
            this.traversalLayer = Number.isFinite(node && node.traversalLayer) ? Number(node.traversalLayer) : 0;
            this.currentLayer = this.traversalLayer;
            this.currentLayerBaseZ = Number.isFinite(node && node.baseZ) ? Number(node.baseZ) : this.traversalLayer * 3;
        },
        updateHitboxes() {}
    };
    vm.createContext(context);

    const files = [
        path.join(__dirname, "../public/assets/javascript/spells/Spell.js"),
        path.join(__dirname, "../public/assets/javascript/spells/Teleport.js")
    ];
    for (const filePath of files) {
        vm.runInContext(fs.readFileSync(filePath, "utf8"), context, { filename: filePath });
    }
    return { context, messages };
}

function loadProjectileSpellContext() {
    const context = {
        console,
        Math,
        Number,
        String,
        Boolean,
        Array,
        Object,
        Map,
        Set,
        WeakMap,
        Date,
        JSON,
        RegExp,
        Error,
        Infinity,
        NaN,
        isFinite,
        parseInt,
        parseFloat,
        performance: { now: () => 0 },
        document: { createElement: () => ({ src: "" }) },
        PIXI: {
            Loader: { shared: { resources: {} } },
            Texture: { from: () => ({ baseTexture: { valid: false } }) }
        },
        animals: [],
        onscreenObjects: [],
        projectiles: [],
        paused: false,
        frameRate: 60,
        setInterval: () => 1,
        clearInterval() {},
        setTimeout(fn) {
            fn();
            return 1;
        },
        clearTimeout() {},
        message() {},
        distance: (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by)
    };
    context.CircleHitbox = class {
        constructor(x, y, radius) {
            this.type = "circle";
            this.x = x;
            this.y = y;
            this.radius = radius;
        }
        intersects() {
            return false;
        }
    };
    context.globalThis = context;
    context.window = context;
    context.wizard = {
        x: 10,
        y: 12,
        z: 0,
        magic: 100,
        currentLayer: 2,
        currentLayerBaseZ: 6,
        direction: { x: 1, y: 0 },
        map: {}
    };
    vm.createContext(context);

    const files = [
        path.join(__dirname, "../public/assets/javascript/spells/Spell.js"),
        path.join(__dirname, "../public/assets/javascript/spells/Fireball.js"),
        path.join(__dirname, "../public/assets/javascript/spells/Spikes.js")
    ];
    for (const filePath of files) {
        vm.runInContext(fs.readFileSync(filePath, "utf8"), context, { filename: filePath });
    }
    return context;
}

function loadSpawnAnimalContext() {
    const messages = [];
    const context = {
        console,
        Math,
        Number,
        String,
        Boolean,
        Array,
        Object,
        Map,
        Set,
        WeakMap,
        Date,
        JSON,
        RegExp,
        Error,
        Infinity,
        NaN,
        isFinite,
        parseInt,
        parseFloat,
        performance: { now: () => 0 },
        document: { createElement: () => ({ src: "" }) },
        PIXI: {},
        animals: [],
        paused: false,
        frameRate: 60,
        setInterval: () => 1,
        clearInterval() {},
        setTimeout: () => 1,
        clearTimeout() {},
        message(text) {
            messages.push(String(text));
        }
    };
    context.globalThis = context;
    context.window = context;
    context.Squirrel = class {
        constructor(node, map) {
            this.type = "squirrel";
            this.node = node;
            this.map = map;
            this.size = 1;
            this.width = 1;
            this.height = 1;
            this.radius = 1;
            this.groundRadius = 1;
            this.visualRadius = 1;
        }
        syncTraversalLayerFromNode(node) {
            this.traversalLayer = Number.isFinite(node && node.traversalLayer) ? Number(node.traversalLayer) : 0;
            this.currentLayer = this.traversalLayer;
            this.currentLayerBaseZ = Number.isFinite(node && node.baseZ) ? Number(node.baseZ) : this.traversalLayer * 3;
        }
        getNodeStandingZ(node) {
            return Number.isFinite(node && node.baseZ) ? Number(node.baseZ) : 0;
        }
        updateHitboxes() {}
    };
    ["Goat", "Deer", "Bear", "Eagleman", "Fragglegod", "Yeti", "Blodia"].forEach((name) => {
        context[name] = context.Squirrel;
    });
    context.wizard = {
        selectedAnimalType: "squirrel",
        selectedAnimalSizeScale: 1,
        currentLayer: 1,
        currentLayerBaseZ: 3,
        selectedFloorEditLevel: 1,
        map: null
    };
    vm.createContext(context);
    const files = [
        path.join(__dirname, "../public/assets/javascript/spells/Spell.js"),
        path.join(__dirname, "../public/assets/javascript/spells/PlaceObject.js"),
        path.join(__dirname, "../public/assets/javascript/spells/SpawnAnimal.js")
    ];
    for (const filePath of files) {
        vm.runInContext(fs.readFileSync(filePath, "utf8"), context, { filename: filePath });
    }
    return { context, messages };
}

test("spell target aim point carries wall traversal height", () => {
    const context = loadSpellContext();
    const aim = context.getSpellTargetAimPoint(
        { map: null },
        {
            type: "wallSection",
            startPoint: { x: 0, y: 0 },
            endPoint: { x: 2, y: 0 },
            bottomZ: 3,
            height: 2
        }
    );

    assert.equal(aim.x, 1);
    assert.equal(aim.y, 0);
    assert.equal(aim.z, 3);
});

test("spawn animal resolves placement to selected nonzero floor layer", () => {
    const { context } = loadSpawnAnimalContext();
    const baseNode = { xindex: 4, yindex: 5, x: 10, y: 20, traversalLayer: 0, baseZ: 0, _prototypeSectionKey: "section-a" };
    const floorNode = {
        xindex: 4,
        yindex: 5,
        x: 10,
        y: 20,
        traversalLayer: 1,
        level: 1,
        baseZ: 3,
        surfaceId: "upper",
        fragmentId: "upper-fragment",
        sourceNode: baseNode,
        ownerSectionKey: "section-a"
    };
    context.wizard.map = {
        worldToNode(x, y) {
            assert.equal(x, 10);
            assert.equal(y, 20);
            return baseNode;
        },
        getFloorNodeAtLayer(x, y, layer, options) {
            assert.equal(x, 4);
            assert.equal(y, 5);
            assert.equal(layer, 1);
            assert.equal(options.sectionKey, "section-a");
            return floorNode;
        }
    };

    const spell = new context.SpawnAnimal();
    spell.cast(10, 20);

    assert.equal(context.animals.length, 1);
    assert.equal(context.animals[0].node, floorNode);
    assert.equal(context.animals[0].traversalLayer, 1);
    assert.equal(context.animals[0].z, 3);
});

test("spawn animal refuses nonzero layer placement without a floor node", () => {
    const { context, messages } = loadSpawnAnimalContext();
    const baseNode = { xindex: 4, yindex: 5, x: 10, y: 20, traversalLayer: 0, baseZ: 0, _prototypeSectionKey: "section-a" };
    context.wizard.map = {
        worldToNode() {
            return baseNode;
        },
        getFloorNodeAtLayer() {
            return null;
        }
    };

    const spell = new context.SpawnAnimal();
    spell.cast(10, 20);

    assert.equal(context.animals.length, 0);
    assert.deepEqual(messages, ["Cannot spawn animal there!"]);
});

test("spell target aim point resolves placed object layer base plus local z", () => {
    const context = loadSpellContext();
    const aim = context.getSpellTargetAimPoint(
        { map: null },
        {
            type: "placedObject",
            x: 4,
            y: 5,
            z: 0.25,
            width: 1,
            height: 1,
            traversalLayer: 1
        }
    );

    assert.equal(aim.x, 4);
    assert.equal(aim.y, 5);
    assert.equal(aim.z, 3.25);
});

test("spell target aim point uses character absolute interpolated z", () => {
    const context = loadSpellContext();
    const aim = context.getSpellTargetAimPoint(
        { map: null },
        {
            type: "human",
            x: 4,
            y: 5,
            z: 6,
            currentLayerBaseZ: 6,
            getInterpolatedPosition() {
                return { x: 4.25, y: 5.5, z: 6.75 };
            }
        }
    );

    assert.equal(aim.x, 4.25);
    assert.equal(aim.y, 5.5);
    assert.equal(aim.z, 6.75);
});

test("spell target point uses depth billboard projected quad coordinates", () => {
    const context = loadSpellContext();
    const aim = context.getSpellTargetAimPoint(
        { map: null },
        {
            type: "placedObject",
            x: 4,
            y: 5,
            z: 0.25,
            width: 1,
            height: 1,
            traversalLayer: 1,
            spellTargetPoint: [0.5, 0.5],
            _depthBillboardWorldPositions: [
                3, 5, 0.25,
                5, 5, 0.25,
                5, 5, 1.75,
                3, 5, 1.75
            ]
        }
    );

    assert.equal(aim.x, 4);
    assert.equal(aim.y, 5);
    assert.equal(aim.z, 4.0);
});

test("spell forced target aim updates projectile visual target z", () => {
    const context = loadSpellContext();
    const spell = new context.Spell(0, 0);
    spell.forcedTarget = {
        type: "human",
        x: 7,
        y: 8,
        z: 0.5,
        currentLayerBaseZ: 3
    };

    const aim = spell.getForcedTargetAimPoint();

    assert.equal(aim.x, 7);
    assert.equal(aim.y, 8);
    assert.equal(aim.z, 3.5);
    assert.equal(spell.visualTargetZ, 3.5);
});

test("vanish projectile starts at wizard world z and stores target world z", () => {
    const context = loadVanishContext();
    const vanish = new context.Vanish();
    vanish.forcedTarget = {
        type: "wallSection",
        startPoint: { x: 14, y: 12 },
        endPoint: { x: 16, y: 12 },
        bottomZ: 6
    };

    vanish.cast(15, 12);

    assert.equal(vanish.zIsWorld, true);
    assert.equal(vanish.visualStartZ, 6);
    assert.equal(vanish.z, 6);
    assert.equal(vanish.targetWorldZ, 6);
});

test("vanish character target uses absolute character z", () => {
    const context = loadVanishContext();
    const vanish = new context.Vanish();
    vanish.forcedTarget = {
        type: "human",
        x: 14,
        y: 12,
        z: 6.5,
        currentLayerBaseZ: 6,
        getInterpolatedPosition() {
            return { x: 14, y: 12, z: 6.5 };
        }
    };

    vanish.cast(14, 12);

    assert.equal(vanish.visualStartZ, 6);
    assert.equal(vanish.targetWorldZ, 6.5);
});

test("vanish travel speed accounts for target z distance", () => {
    const context = loadVanishContext();
    const vanish = new context.Vanish();
    vanish.forcedTarget = {
        type: "wallSection",
        startPoint: { x: 13, y: 16 },
        endPoint: { x: 14, y: 16 },
        bottomZ: 18
    };

    vanish.cast(13, 16);

    assert.equal(vanish.totalDist, 13);
    assertNearlyEqual(vanish.movement.x, 3 / 13 * vanish.speed / context.frameRate);
    assertNearlyEqual(vanish.movement.y, 4 / 13 * vanish.speed / context.frameRate);
    assertNearlyEqual(vanish.movement.z, 12 / 13 * vanish.speed / context.frameRate);
    assertNearlyEqual(
        Math.hypot(vanish.movement.x, vanish.movement.y, vanish.movement.z),
        vanish.speed / context.frameRate
    );
});

test("vanish travel plan supports vertical-only travel", () => {
    const context = loadVanishContext();
    const plan = context.buildVanishTravelPlan(10, 12, 10, 12, {
        originZ: 6,
        targetZ: 18,
        speed: 10,
        frameRateValue: 60
    });

    assert.equal(plan.totalDist, 12);
    assert.equal(plan.stepX, 0);
    assert.equal(plan.stepY, 0);
    assert.equal(plan.stepZ, 10 / 60);
    assert.equal(plan.stepDist, 10 / 60);
});

test("fireball cast initializes floor-relative visual z", () => {
    const context = loadProjectileSpellContext();
    const fireball = new context.Fireball();
    fireball.forcedTarget = {
        type: "human",
        x: 14,
        y: 12,
        z: 6.5,
        currentLayerBaseZ: 6,
        getInterpolatedPosition() {
            return { x: 14, y: 12, z: 6.5 };
        }
    };

    fireball.cast(14, 12);

    assert.equal(fireball.visualStartZ, 6);
    assert.equal(fireball.visualBaseZ, 6);
    assert.equal(fireball.visualTargetZ, 6.5);
    assert.equal(fireball.z, context.Fireball.FLIGHT_Z);
});

test("spikes propagate caster floor z to spawned projectiles", () => {
    const context = loadProjectileSpellContext();
    const spikes = new context.Spikes();

    spikes.cast(13, 12);

    assert.equal(context.projectiles.length, 5);
    for (const projectile of context.projectiles) {
        assert.equal(projectile.visualBaseZ, 6);
        assert.equal(projectile.visualStartZ, 6);
        assert.equal(projectile.currentLayer, 2);
        assert.equal(projectile.z, 0.2);
    }
});

test("vanish cannot target or remove the player wizard", () => {
    const context = loadVanishContext();
    const otherTarget = { type: "road", gone: false, vanishing: false };

    assert.equal(context.Vanish.isValidObjectTarget(context.wizard, context.wizard), false);
    assert.equal(context.EditorVanish.isValidObjectTarget(context.wizard, context.wizard), false);
    assert.equal(context.EditorVanish.isValidObjectTarget(otherTarget, context.wizard), true);

    const vanish = new context.EditorVanish();
    let removed = false;
    context.wizard.removeFromGame = () => {
        removed = true;
        context.wizard.gone = true;
    };

    vanish.vanishTarget(context.wizard, { x: context.wizard.x, y: context.wizard.y });

    assert.equal(removed, false);
    assert.equal(context.wizard.gone, undefined);
    assert.equal(context.wizard.vanishing, undefined);
});

test("floor polygon paint applies selected texture to nonzero fragment and asset record", () => {
    const context = loadSpellContext();
    let presented = 0;
    context.presentGameFrame = () => {
        presented += 1;
    };
    const floorRecord = {
        fragmentId: "floor_area:section-a:1:0",
        surfaceId: "floor_area:section-a:1",
        ownerSectionKey: "section-a",
        level: 1,
        outerPolygon: [
            { x: 0, y: 0 },
            { x: 4, y: 0 },
            { x: 4, y: 4 },
            { x: 0, y: 4 }
        ],
        holes: []
    };
    const assetFloorRecord = { ...floorRecord };
    const floorsById = new context.Map([[floorRecord.fragmentId, floorRecord]]);
    const sectionAssetsByKey = new context.Map([[
        "section-a",
        { key: "section-a", floors: [assetFloorRecord] }
    ]]);
    const wizard = {
        selectedFloorEditLevel: 1,
        selectedFlooringTexture: "/assets/images/flooring/stone.jpg",
        map: {
            floorsById,
            _prototypeSectionState: { sectionAssetsByKey }
        }
    };

    const painted = context.SpellSystem.paintFloorPolygonAtWorldPoint(wizard, 2, 2, { silent: true });

    assert.equal(painted, true);
    assert.equal(floorRecord.texturePath, "/assets/images/flooring/stone.jpg");
    assert.equal(assetFloorRecord.texturePath, "/assets/images/flooring/stone.jpg");
    assert.equal(presented, 1);
});

test("floor shape wall-loop candidate ignores loops already occupied by selected-level floor", () => {
    const context = loadSpellContext();
    context.polygonClipping = require("polygon-clipping");
    const loopPolygon = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 }
    ];
    const loopSections = [
        { startPoint: { x: 0, y: 0 }, endPoint: { x: 10, y: 0 } },
        { startPoint: { x: 10, y: 0 }, endPoint: { x: 10, y: 10 } },
        { startPoint: { x: 10, y: 10 }, endPoint: { x: 0, y: 10 } },
        { startPoint: { x: 0, y: 10 }, endPoint: { x: 0, y: 0 } }
    ];
    function RoofMock() {}
    RoofMock.findWallLoopFromStartSection = () => loopSections;
    RoofMock.extractWallLoopPolygonPoints = () => loopPolygon;
    context.Roof = RoofMock;
    context.WallSectionUnit = { _allSections: new context.Map([["bottom", loopSections[0]]]) };
    const map = {
        wrapWorldX: x => x,
        wrapWorldY: y => y,
        shortestDeltaX: (fromX, toX) => toX - fromX,
        shortestDeltaY: (fromY, toY) => toY - fromY,
        floorsById: new context.Map()
    };
    const wizard = {
        currentSpell: "floorshape",
        selectedFloorEditLevel: 2,
        map
    };

    const emptyCandidate = context.SpellSystem.getFloorShapeWallLoopCandidate(wizard, 5, 0.5);
    assert.ok(emptyCandidate);
    assert.equal(emptyCandidate.polygonPoints.length, 4);

    map.floorsById.set("floor:2", {
        fragmentId: "floor:2",
        level: 2,
        outerPolygon: loopPolygon,
        holes: [[
            { x: 2, y: 2 },
            { x: 4, y: 2 },
            { x: 4, y: 4 },
            { x: 2, y: 4 }
        ]]
    });
    const occupiedCandidate = context.SpellSystem.getFloorShapeWallLoopCandidate(wizard, 5, 0.5);

    assert.equal(occupiedCandidate, null);
});

test("floor polygon paint reprojects screen clicks onto the selected floor level", () => {
    const context = loadSpellContext();
    context.viewport = { x: 0, y: 0, z: 0 };
    context.viewscale = 1;
    context.xyratio = 1;
    const floorRecord = {
        fragmentId: "floor_area:section-a:1:0",
        surfaceId: "floor_area:section-a:1",
        ownerSectionKey: "section-a",
        level: 1,
        outerPolygon: [
            { x: 0, y: 4 },
            { x: 4, y: 4 },
            { x: 4, y: 6 },
            { x: 0, y: 6 }
        ],
        holes: []
    };
    const wizard = {
        selectedFloorEditLevel: 1,
        selectedFlooringTexture: "/assets/images/flooring/stone.jpg",
        map: {
            floorsById: new context.Map([[floorRecord.fragmentId, floorRecord]]),
            _prototypeSectionState: { sectionAssetsByKey: new context.Map() }
        }
    };

    const painted = context.SpellSystem.paintFloorPolygonAtWorldPoint(wizard, 2, 2, {
        screenX: 2,
        screenY: 2,
        silent: true
    });

    assert.equal(painted, true);
    assert.equal(floorRecord.texturePath, "/assets/images/flooring/stone.jpg");
});

test("floor polygon paint targets a visible upper floor even when selected floor edit level is zero", () => {
    const context = loadSpellContext();
    context.viewport = { x: 0, y: 0, z: 0 };
    context.viewscale = 1;
    context.xyratio = 1;
    const floorRecord = {
        fragmentId: "floor_area:section-a:1:0",
        surfaceId: "floor_area:section-a:1",
        ownerSectionKey: "section-a",
        level: 1,
        nodeBaseZ: 3,
        outerPolygon: [
            { x: 0, y: 4 },
            { x: 4, y: 4 },
            { x: 4, y: 6 },
            { x: 0, y: 6 }
        ],
        holes: []
    };
    const wizard = {
        currentLayer: 1,
        selectedFloorEditLevel: 0,
        selectedFlooringTexture: "/assets/images/flooring/woodfloor.png",
        map: {
            floorsById: new context.Map([[floorRecord.fragmentId, floorRecord]]),
            _prototypeSectionState: { sectionAssetsByKey: new context.Map() }
        }
    };

    const target = context.SpellSystem.getVisibleFloorPolygonTargetAtScreenPoint(wizard, 2, 2);
    const painted = context.SpellSystem.paintFloorPolygonAtWorldPoint(wizard, 2, 2, {
        screenX: 2,
        screenY: 2,
        silent: true
    });

    assert.equal(target.fragment, floorRecord);
    assert.equal(painted, true);
    assert.equal(floorRecord.texturePath, "/assets/images/flooring/woodfloor.png");
});

test("teleport visual target projects empty upper-floor clicks onto visible ground", () => {
    const context = loadSpellContext();
    context.viewport = { x: 0, y: 0, z: 21 };
    context.viewscale = 1;
    context.xyratio = 1;
    const groundNode = { xindex: 2, yindex: -19, traversalLayer: 0, baseZ: 0 };
    const wizard = {
        x: 0,
        y: 0,
        currentLayer: 7,
        map: {
            floorsById: new context.Map(),
            wrapWorldX: x => x,
            wrapWorldY: y => y,
            worldToNode(x, y) {
                assert.equal(x, 2);
                assert.equal(y, -19);
                return groundNode;
            }
        }
    };

    const target = context.SpellSystem.resolveTeleportVisualTarget(wizard, 2, 2, { screenX: 2, screenY: 2 });

    assert.equal(target.x, 2);
    assert.equal(target.y, -19);
    assert.equal(target.layer, 0);
    assert.equal(target.baseZ, 0);
    assert.equal(target.node, groundNode);
});

test("teleport visual target selects the highest visible floor under the cursor", () => {
    const context = loadSpellContext();
    context.viewport = { x: 0, y: 0, z: 21 };
    context.viewscale = 1;
    context.xyratio = 1;
    const floorRecord = {
        fragmentId: "floor_area:section-a:3:0",
        surfaceId: "floor_area:section-a:3",
        ownerSectionKey: "section-a",
        level: 3,
        nodeBaseZ: 9,
        outerPolygon: [
            { x: 0, y: -12 },
            { x: 4, y: -12 },
            { x: 4, y: -8 },
            { x: 0, y: -8 }
        ],
        holes: []
    };
    const baseNode = { xindex: 2, yindex: -10, _prototypeSectionKey: "section-a" };
    const floorNode = {
        xindex: 2,
        yindex: -10,
        traversalLayer: 3,
        baseZ: 9,
        fragmentId: floorRecord.fragmentId,
        surfaceId: floorRecord.surfaceId
    };
    const wizard = {
        x: 0,
        y: 0,
        currentLayer: 7,
        map: {
            floorsById: new context.Map([[floorRecord.fragmentId, floorRecord]]),
            wrapWorldX: x => x,
            wrapWorldY: y => y,
            worldToNode(x, y) {
                assert.equal(x, 2);
                assert.equal(y, -10);
                return baseNode;
            },
            getFloorNodeAtLayer(x, y, layer, options) {
                assert.equal(x, 2);
                assert.equal(y, -10);
                assert.equal(layer, 3);
                assert.equal(options.sectionKey, "section-a");
                assert.equal(options.fragmentId, floorRecord.fragmentId);
                assert.equal(options.surfaceId, floorRecord.surfaceId);
                return floorNode;
            }
        }
    };

    const target = context.SpellSystem.resolveTeleportVisualTarget(wizard, 2, 2, { screenX: 2, screenY: 2 });

    assert.equal(target.x, 2);
    assert.equal(target.y, -10);
    assert.equal(target.layer, 3);
    assert.equal(target.baseZ, 9);
    assert.equal(target.node, floorNode);
});

test("teleport visual target can select upper floors while wizard is on ground", () => {
    const context = loadSpellContext();
    context.viewport = { x: 0, y: 0, z: 0 };
    context.viewscale = 1;
    context.xyratio = 1;
    const lowerFloor = {
        fragmentId: "floor_area:section-a:1:0",
        surfaceId: "floor_area:section-a:1",
        ownerSectionKey: "section-a",
        level: 1,
        nodeBaseZ: 3,
        outerPolygon: [
            { x: 0, y: 4 },
            { x: 4, y: 4 },
            { x: 4, y: 6 },
            { x: 0, y: 6 }
        ],
        holes: []
    };
    const upperFloor = {
        fragmentId: "floor_area:section-a:3:0",
        surfaceId: "floor_area:section-a:3",
        ownerSectionKey: "section-a",
        level: 3,
        nodeBaseZ: 9,
        outerPolygon: [
            { x: 0, y: 10 },
            { x: 4, y: 10 },
            { x: 4, y: 12 },
            { x: 0, y: 12 }
        ],
        holes: []
    };
    const baseNode = { xindex: 2, yindex: 11, _prototypeSectionKey: "section-a" };
    const upperNode = {
        xindex: 2,
        yindex: 11,
        traversalLayer: 3,
        baseZ: 9,
        fragmentId: upperFloor.fragmentId,
        surfaceId: upperFloor.surfaceId
    };
    const wizard = {
        x: 0,
        y: 0,
        currentLayer: 0,
        map: {
            floorsById: new context.Map([
                [lowerFloor.fragmentId, lowerFloor],
                [upperFloor.fragmentId, upperFloor]
            ]),
            wrapWorldX: x => x,
            wrapWorldY: y => y,
            worldToNode(x, y) {
                assert.equal(x, 2);
                assert.equal(y, 11);
                return baseNode;
            },
            getFloorNodeAtLayer(x, y, layer, options) {
                assert.equal(x, 2);
                assert.equal(y, 11);
                assert.equal(layer, 3);
                assert.equal(options.fragmentId, upperFloor.fragmentId);
                assert.equal(options.surfaceId, upperFloor.surfaceId);
                return upperNode;
            }
        }
    };

    const target = context.SpellSystem.resolveTeleportVisualTarget(wizard, 2, 2, { screenX: 2, screenY: 2 });

    assert.equal(target.x, 2);
    assert.equal(target.y, 11);
    assert.equal(target.layer, 3);
    assert.equal(target.baseZ, 9);
    assert.equal(target.node, upperNode);
});

test("teleport visual target ignores upper floors during interior view", () => {
    const context = loadSpellContext();
    context.viewport = { x: 0, y: 0, z: 3 };
    context.viewscale = 1;
    context.xyratio = 1;
    context.Rendering = {
        isBuildingInteriorPresentationActive(ctx) {
            assert.equal(ctx.wizard.currentLayer, 1);
            return true;
        }
    };
    const currentFloor = {
        fragmentId: "floor_area:section-a:1:0",
        surfaceId: "floor_area:section-a:1",
        ownerSectionKey: "section-a",
        level: 1,
        nodeBaseZ: 3,
        outerPolygon: [
            { x: 0, y: 0 },
            { x: 4, y: 0 },
            { x: 4, y: 4 },
            { x: 0, y: 4 }
        ],
        holes: []
    };
    const hiddenUpperFloor = {
        fragmentId: "floor_area:section-a:3:0",
        surfaceId: "floor_area:section-a:3",
        ownerSectionKey: "section-a",
        level: 3,
        nodeBaseZ: 9,
        outerPolygon: [
            { x: 0, y: 6 },
            { x: 4, y: 6 },
            { x: 4, y: 10 },
            { x: 0, y: 10 }
        ],
        holes: []
    };
    const baseNode = { xindex: 2, yindex: 2, _prototypeSectionKey: "section-a" };
    const currentFloorNode = {
        xindex: 2,
        yindex: 2,
        traversalLayer: 1,
        baseZ: 3,
        fragmentId: currentFloor.fragmentId,
        surfaceId: currentFloor.surfaceId
    };
    const wizard = {
        x: 0,
        y: 0,
        currentLayer: 1,
        map: {
            floorsById: new context.Map([
                [currentFloor.fragmentId, currentFloor],
                [hiddenUpperFloor.fragmentId, hiddenUpperFloor]
            ]),
            wrapWorldX: x => x,
            wrapWorldY: y => y,
            worldToNode(x, y) {
                assert.equal(x, 2);
                assert.equal(y, 2);
                return baseNode;
            },
            getFloorNodeAtLayer(x, y, layer, options) {
                assert.equal(x, 2);
                assert.equal(y, 2);
                assert.equal(layer, 1);
                assert.equal(options.fragmentId, currentFloor.fragmentId);
                assert.equal(options.surfaceId, currentFloor.surfaceId);
                return currentFloorNode;
            }
        }
    };

    const target = context.SpellSystem.resolveTeleportVisualTarget(wizard, 2, 2, { screenX: 2, screenY: 2 });

    assert.equal(target.x, 2);
    assert.equal(target.y, 2);
    assert.equal(target.layer, 1);
    assert.equal(target.baseZ, 3);
    assert.equal(target.node, currentFloorNode);
});

test("teleport visual target keeps ground above underground fragments", () => {
    const context = loadSpellContext();
    context.viewport = { x: 0, y: 0, z: 0 };
    context.viewscale = 1;
    context.xyratio = 1;
    const groundFloor = {
        fragmentId: "floor_area:section-a:0:0",
        surfaceId: "floor_area:section-a:0",
        ownerSectionKey: "section-a",
        level: 0,
        nodeBaseZ: 0,
        _prototypeGroundFloor: true,
        outerPolygon: [
            { x: 0, y: 0 },
            { x: 4, y: 0 },
            { x: 4, y: 4 },
            { x: 0, y: 4 }
        ],
        holes: []
    };
    const basementFloor = {
        fragmentId: "floor_area:section-a:-1:0",
        surfaceId: "floor_area:section-a:-1",
        ownerSectionKey: "section-a",
        level: -1,
        nodeBaseZ: -3,
        outerPolygon: [
            { x: 0, y: -2 },
            { x: 4, y: -2 },
            { x: 4, y: 0 },
            { x: 0, y: 0 }
        ],
        holes: []
    };
    const groundNode = { xindex: 2, yindex: 2, traversalLayer: 0, baseZ: 0, _prototypeSectionKey: "section-a" };
    const wizard = {
        x: 0,
        y: 0,
        currentLayer: 0,
        map: {
            floorsById: new context.Map([
                [groundFloor.fragmentId, groundFloor],
                [basementFloor.fragmentId, basementFloor]
            ]),
            wrapWorldX: x => x,
            wrapWorldY: y => y,
            worldToNode(x, y) {
                assert.equal(x, 2);
                assert.equal(y, 2);
                return groundNode;
            },
            getFloorNodeAtLayer() {
                assert.fail("ground teleport should not resolve an underground floor node");
            }
        }
    };

    const target = context.SpellSystem.resolveTeleportVisualTarget(wizard, 2, 2, { screenX: 2, screenY: 2 });

    assert.equal(target.x, 2);
    assert.equal(target.y, 2);
    assert.equal(target.layer, 0);
    assert.equal(target.baseZ, 0);
    assert.equal(target.node, groundNode);
});

test("teleport visual target fails underground clicks with no floor fragment", () => {
    const context = loadSpellContext();
    context.viewport = { x: 0, y: 0, z: -3 };
    context.viewscale = 1;
    context.xyratio = 1;
    const groundFloor = {
        fragmentId: "floor_area:section-a:0:0",
        surfaceId: "floor_area:section-a:0",
        ownerSectionKey: "section-a",
        level: 0,
        nodeBaseZ: 0,
        outerPolygon: [
            { x: 0, y: 0 },
            { x: 4, y: 0 },
            { x: 4, y: 4 },
            { x: 0, y: 4 }
        ],
        holes: []
    };
    const wizard = {
        x: 0,
        y: 0,
        currentLayer: -1,
        traversalLayer: -1,
        currentLayerBaseZ: -3,
        map: {
            floorsById: new context.Map([[groundFloor.fragmentId, groundFloor]]),
            wrapWorldX: x => x,
            wrapWorldY: y => y,
            worldToNode() {
                assert.fail("underground teleport without a floor fragment should not resolve a destination node");
            }
        }
    };

    const target = context.SpellSystem.resolveTeleportVisualTarget(wizard, 2, 2, { screenX: 2, screenY: 2 });

    assert.equal(target.x, 2);
    assert.equal(target.y, 2);
    assert.equal(target.layer, -1);
    assert.equal(target.baseZ, -3);
    assert.equal(target.node, null);
    assert.equal(target.floorTarget, null);
});

test("teleport visual target stays on the current underground floor", () => {
    const context = loadSpellContext();
    context.viewport = { x: 0, y: 0, z: -3 };
    context.viewscale = 1;
    context.xyratio = 1;
    const groundFloor = {
        fragmentId: "floor_area:section-a:0:0",
        surfaceId: "floor_area:section-a:0",
        ownerSectionKey: "section-a",
        level: 0,
        nodeBaseZ: 0,
        outerPolygon: [
            { x: 0, y: 0 },
            { x: 8, y: 0 },
            { x: 8, y: 8 },
            { x: 0, y: 8 }
        ],
        holes: []
    };
    const basementFloor = {
        fragmentId: "floor_area:section-a:-1:0",
        surfaceId: "floor_area:section-a:-1",
        ownerSectionKey: "section-a",
        level: -1,
        nodeBaseZ: -3,
        outerPolygon: [
            { x: 0, y: 0 },
            { x: 4, y: 0 },
            { x: 4, y: 4 },
            { x: 0, y: 4 }
        ],
        holes: []
    };
    const upperFloor = {
        fragmentId: "floor_area:section-a:1:0",
        surfaceId: "floor_area:section-a:1",
        ownerSectionKey: "section-a",
        level: 1,
        nodeBaseZ: 3,
        outerPolygon: [
            { x: 0, y: 8 },
            { x: 4, y: 8 },
            { x: 4, y: 12 },
            { x: 0, y: 12 }
        ],
        holes: []
    };
    const baseNode = { xindex: 2, yindex: 2, _prototypeSectionKey: "section-a" };
    const basementNode = {
        xindex: 2,
        yindex: 2,
        traversalLayer: -1,
        baseZ: -3,
        fragmentId: basementFloor.fragmentId,
        surfaceId: basementFloor.surfaceId
    };
    const wizard = {
        x: 0,
        y: 0,
        currentLayer: -1,
        traversalLayer: -1,
        currentLayerBaseZ: -3,
        map: {
            floorsById: new context.Map([
                [groundFloor.fragmentId, groundFloor],
                [basementFloor.fragmentId, basementFloor],
                [upperFloor.fragmentId, upperFloor]
            ]),
            wrapWorldX: x => x,
            wrapWorldY: y => y,
            worldToNode(x, y) {
                assert.equal(x, 2);
                assert.equal(y, 2);
                return baseNode;
            },
            getFloorNodeAtLayer(x, y, layer, options) {
                assert.equal(x, 2);
                assert.equal(y, 2);
                assert.equal(layer, -1);
                assert.equal(options.fragmentId, basementFloor.fragmentId);
                assert.equal(options.surfaceId, basementFloor.surfaceId);
                return basementNode;
            }
        }
    };

    const target = context.SpellSystem.resolveTeleportVisualTarget(wizard, 2, 2, { screenX: 2, screenY: 2 });

    assert.equal(target.x, 2);
    assert.equal(target.y, 2);
    assert.equal(target.layer, -1);
    assert.equal(target.baseZ, -3);
    assert.equal(target.node, basementNode);
    assert.equal(target.floorTarget.fragment, basementFloor);
});

test("teleport cast synchronizes wizard to the destination node layer", () => {
    const { context } = loadTeleportContext();
    const destinationNode = { xindex: 2, yindex: 3, traversalLayer: 0, baseZ: 0 };
    const spell = new context.Teleport();

    spell.cast(2, 3, { destinationNode, destinationLayer: 0, destinationBaseZ: 0 });

    assert.equal(context.wizard.x, 2);
    assert.equal(context.wizard.y, 3);
    assert.equal(context.wizard.node, destinationNode);
    assert.equal(context.wizard.currentLayer, 0);
    assert.equal(context.wizard.traversalLayer, 0);
    assert.equal(context.wizard.currentLayerBaseZ, 0);
    assert.equal(context.wizard.z, 0);
    assert.equal(context.wizard._floorFallState, null);
    assert.equal(context.wizard.magic, 75);
});

test("floor polygon paint ignores level zero fragments", () => {
    const context = loadSpellContext();
    const floorRecord = {
        fragmentId: "floor_area:section-a:0:0",
        surfaceId: "floor_area:section-a:0",
        ownerSectionKey: "section-a",
        level: 0,
        outerPolygon: [
            { x: 0, y: 0 },
            { x: 4, y: 0 },
            { x: 4, y: 4 },
            { x: 0, y: 4 }
        ],
        holes: []
    };
    const wizard = {
        selectedFloorEditLevel: 0,
        selectedFlooringTexture: "/assets/images/flooring/stone.jpg",
        map: {
            floorsById: new context.Map([[floorRecord.fragmentId, floorRecord]]),
            _prototypeSectionState: { sectionAssetsByKey: new context.Map() }
        }
    };

    const painted = context.SpellSystem.paintFloorPolygonAtWorldPoint(wizard, 2, 2, { silent: true });

    assert.equal(painted, false);
    assert.equal(floorRecord.texturePath, undefined);
});

test("floor vertex drag inside owner section uses fragment rematerialization", () => {
    const context = loadSpellContext();
    context.worldToScreen = point => ({ x: Number(point.x), y: Number(point.y) });
    context.presentGameFrame = () => {
        context.presentCount = (context.presentCount || 0) + 1;
    };
    context.__sectionGeometry = {
        getSectionHexagonCorners() {
            return [
                { x: -100, y: -100 },
                { x: 100, y: -100 },
                { x: 100, y: 100 },
                { x: -100, y: 100 }
            ];
        }
    };
    const assetFloor = {
        fragmentId: "floor_area:section-a:1:0",
        surfaceId: "floor_area:section-a:1",
        ownerSectionKey: "section-a",
        level: 1,
        nodeBaseZ: 3,
        outerPolygon: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 }
        ],
        holes: [],
        tileCoordKeys: []
    };
    const runtimeFloor = {
        ...assetFloor,
        outerPolygon: assetFloor.outerPolygon.map(point => ({ ...point })),
        holes: []
    };
    let unregistered = 0;
    let registered = 0;
    let registeredRecord = null;
    const map = {
        floorsById: new context.Map([[runtimeFloor.fragmentId, runtimeFloor]]),
        floorNodesById: new context.Map([[runtimeFloor.fragmentId, []]]),
        _prototypeSectionState: {
            basis: {},
            sectionAssetsByKey: new context.Map([["section-a", {
                key: "section-a",
                centerAxial: { q: 0, r: 0 },
                floors: [assetFloor],
                tileCoordKeys: []
            }]]),
            nodesBySectionKey: new context.Map([["section-a", []]]),
            allNodesByCoordKey: new context.Map()
        },
        unregisterFloorFragments(ids) {
            unregistered += Array.isArray(ids) ? ids.length : 0;
            for (const id of ids) this.floorsById.delete(id);
            return ids.length;
        },
        registerFloorFragmentsForSection(sectionKey, _state, records) {
            assert.equal(sectionKey, "section-a");
            registered += records.length;
            registeredRecord = records[0];
            this.floorsById.set(registeredRecord.fragmentId, registeredRecord);
            return { fragmentCount: records.length, nodeCount: 0 };
        },
        syncPrototypeWalls() {
            assert.fail("same-section vertex drag should not rebuild whole section walls");
        },
        wrapWorldX: x => x,
        wrapWorldY: y => y
    };
    const wizard = {
        currentSpell: "flooredit",
        selectedFloorEditLevel: 1,
        map
    };

    assert.equal(context.SpellSystem.beginFloorEditorVertexDrag(wizard, 10, 10), true);
    assert.equal(context.SpellSystem.updateFloorEditorVertexDrag(wizard, 9, 9), true);
    assert.equal(context.SpellSystem.endFloorEditorVertexDrag(wizard), true);

    assert.equal(unregistered, 1);
    assert.equal(registered, 1);
    assert.equal(registeredRecord.fragmentId, runtimeFloor.fragmentId);
    assert.equal(registeredRecord.outerPolygon[2].x, 9);
    assert.equal(registeredRecord.outerPolygon[2].y, 9);
});

test("floor selected vertex shift-click inserts toward the closer previous neighbor", () => {
    const context = loadSpellContext();
    context.worldToScreen = point => ({ x: Number(point.x), y: Number(point.y) });
    context.presentGameFrame = () => {};
    context.__sectionGeometry = {
        getSectionHexagonCorners() {
            return [
                { x: -100, y: -100 },
                { x: 100, y: -100 },
                { x: 100, y: 100 },
                { x: -100, y: 100 }
            ];
        }
    };
    const assetFloor = {
        fragmentId: "floor_area:section-a:1:0",
        surfaceId: "floor_area:section-a:1",
        ownerSectionKey: "section-a",
        level: 1,
        nodeBaseZ: 3,
        outerPolygon: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 }
        ],
        holes: [],
        tileCoordKeys: []
    };
    const runtimeFloor = {
        ...assetFloor,
        outerPolygon: assetFloor.outerPolygon.map(point => ({ ...point })),
        holes: []
    };
    let registeredRecord = null;
    const map = {
        floorsById: new context.Map([[runtimeFloor.fragmentId, runtimeFloor]]),
        floorNodesById: new context.Map([[runtimeFloor.fragmentId, []]]),
        _prototypeSectionState: {
            basis: {},
            sectionAssetsByKey: new context.Map([["section-a", {
                key: "section-a",
                centerAxial: { q: 0, r: 0 },
                floors: [assetFloor],
                tileCoordKeys: []
            }]])
        },
        unregisterFloorFragments(ids) {
            for (const id of ids) this.floorsById.delete(id);
            return ids.length;
        },
        registerFloorFragmentsForSection(_sectionKey, _state, records) {
            registeredRecord = records[0];
            this.floorsById.set(registeredRecord.fragmentId, registeredRecord);
            return { fragmentCount: records.length, nodeCount: 0 };
        },
        wrapWorldX: x => x,
        wrapWorldY: y => y
    };
    const wizard = {
        currentSpell: "flooredit",
        selectedFloorEditLevel: 1,
        map
    };

    assert.equal(context.SpellSystem.beginFloorEditorVertexDrag(wizard, 10, 0), true);
    assert.equal(context.SpellSystem.endFloorEditorVertexDrag(wizard), true);
    assert.equal(context.SpellSystem.insertFloorEditorVertexFromSelectedNeighbor(wizard, 2, 2, 2, 2), true);
    assert.equal(context.SpellSystem.endFloorEditorVertexDrag(wizard), true);

    assert.equal(registeredRecord.outerPolygon.length, 5);
    assert.equal(registeredRecord.outerPolygon[1].x, 2);
    assert.equal(registeredRecord.outerPolygon[1].y, 2);
    assert.equal(registeredRecord.outerPolygon[2].x, 10);
    assert.equal(registeredRecord.outerPolygon[2].y, 0);
});

test("floor selected vertex shift-click inserts toward the closer next neighbor", () => {
    const context = loadSpellContext();
    context.worldToScreen = point => ({ x: Number(point.x), y: Number(point.y) });
    context.presentGameFrame = () => {};
    context.__sectionGeometry = {
        getSectionHexagonCorners() {
            return [
                { x: -100, y: -100 },
                { x: 100, y: -100 },
                { x: 100, y: 100 },
                { x: -100, y: 100 }
            ];
        }
    };
    const assetFloor = {
        fragmentId: "floor_area:section-a:1:0",
        surfaceId: "floor_area:section-a:1",
        ownerSectionKey: "section-a",
        level: 1,
        nodeBaseZ: 3,
        outerPolygon: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 }
        ],
        holes: [],
        tileCoordKeys: []
    };
    const runtimeFloor = {
        ...assetFloor,
        outerPolygon: assetFloor.outerPolygon.map(point => ({ ...point })),
        holes: []
    };
    let registeredRecord = null;
    const map = {
        floorsById: new context.Map([[runtimeFloor.fragmentId, runtimeFloor]]),
        floorNodesById: new context.Map([[runtimeFloor.fragmentId, []]]),
        _prototypeSectionState: {
            basis: {},
            sectionAssetsByKey: new context.Map([["section-a", {
                key: "section-a",
                centerAxial: { q: 0, r: 0 },
                floors: [assetFloor],
                tileCoordKeys: []
            }]])
        },
        unregisterFloorFragments(ids) {
            for (const id of ids) this.floorsById.delete(id);
            return ids.length;
        },
        registerFloorFragmentsForSection(_sectionKey, _state, records) {
            registeredRecord = records[0];
            this.floorsById.set(registeredRecord.fragmentId, registeredRecord);
            return { fragmentCount: records.length, nodeCount: 0 };
        },
        wrapWorldX: x => x,
        wrapWorldY: y => y
    };
    const wizard = {
        currentSpell: "flooredit",
        selectedFloorEditLevel: 1,
        map
    };

    assert.equal(context.SpellSystem.beginFloorEditorVertexDrag(wizard, 10, 0), true);
    assert.equal(context.SpellSystem.endFloorEditorVertexDrag(wizard), true);
    assert.equal(context.SpellSystem.insertFloorEditorVertexFromSelectedNeighbor(wizard, 9, 8, 9, 8), true);
    assert.equal(context.SpellSystem.endFloorEditorVertexDrag(wizard), true);

    assert.equal(registeredRecord.outerPolygon.length, 5);
    assert.equal(registeredRecord.outerPolygon[1].x, 10);
    assert.equal(registeredRecord.outerPolygon[1].y, 0);
    assert.equal(registeredRecord.outerPolygon[2].x, 9);
    assert.equal(registeredRecord.outerPolygon[2].y, 8);
});

test("floor vertex drag clamps to the owner section boundary", () => {
    const context = loadSpellContext();
    context.worldToScreen = point => ({ x: Number(point.x), y: Number(point.y) });
    context.presentGameFrame = () => {};
    context.__sectionGeometry = {
        getSectionHexagonCorners() {
            return [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 10, y: 10 },
                { x: 0, y: 10 }
            ];
        }
    };
    const assetFloor = {
        fragmentId: "floor_area:section-a:1:0",
        surfaceId: "floor_area:section-a:1",
        ownerSectionKey: "section-a",
        level: 1,
        nodeBaseZ: 3,
        outerPolygon: [
            { x: 1, y: 1 },
            { x: 9, y: 1 },
            { x: 9, y: 9 },
            { x: 1, y: 9 }
        ],
        holes: [],
        tileCoordKeys: []
    };
    const runtimeFloor = {
        ...assetFloor,
        outerPolygon: assetFloor.outerPolygon.map(point => ({ ...point })),
        holes: []
    };
    let registeredRecord = null;
    const map = {
        floorsById: new context.Map([[runtimeFloor.fragmentId, runtimeFloor]]),
        floorNodesById: new context.Map([[runtimeFloor.fragmentId, []]]),
        _prototypeSectionState: {
            basis: {},
            sectionAssetsByKey: new context.Map([["section-a", {
                key: "section-a",
                centerAxial: { q: 0, r: 0 },
                floors: [assetFloor],
                tileCoordKeys: []
            }]]),
            nodesBySectionKey: new context.Map([["section-a", []]]),
            allNodesByCoordKey: new context.Map()
        },
        unregisterFloorFragments(ids) {
            for (const id of ids) this.floorsById.delete(id);
            return ids.length;
        },
        registerFloorFragmentsForSection(sectionKey, _state, records) {
            assert.equal(sectionKey, "section-a");
            registeredRecord = records[0];
            this.floorsById.set(registeredRecord.fragmentId, registeredRecord);
            return { fragmentCount: records.length, nodeCount: 0 };
        },
        syncPrototypeWalls() {
            assert.fail("clamped vertex drag should not rebuild whole section walls");
        },
        wrapWorldX: x => x,
        wrapWorldY: y => y
    };
    const wizard = {
        currentSpell: "flooredit",
        selectedFloorEditLevel: 1,
        map
    };

    assert.equal(context.SpellSystem.beginFloorEditorVertexDrag(wizard, 9, 9), true);
    assert.equal(context.SpellSystem.updateFloorEditorVertexDrag(wizard, 14, 5), true);
    assert.equal(context.SpellSystem.endFloorEditorVertexDrag(wizard), true);

    assert.equal(registeredRecord.outerPolygon[2].x, 10);
    assert.equal(registeredRecord.outerPolygon[2].y, 5);
});

test("floor vertex drag merges overlapping same-section fragments on release", () => {
    const context = loadSpellContext();
    context.worldToScreen = point => ({ x: Number(point.x), y: Number(point.y) });
    context.presentGameFrame = () => {};
    context.__sectionGeometry = {
        getSectionHexagonCorners() {
            return [
                { x: -20, y: -20 },
                { x: 20, y: -20 },
                { x: 20, y: 20 },
                { x: -20, y: 20 }
            ];
        }
    };
    const leftFloor = {
        fragmentId: "floor_area:section-a:1:left",
        surfaceId: "left-surface",
        ownerSectionKey: "section-a",
        level: 1,
        nodeBaseZ: 3,
        outerPolygon: [
            { x: 0, y: 0 },
            { x: 4, y: 0 },
            { x: 4, y: 4 },
            { x: 0, y: 4 }
        ],
        holes: [],
        tileCoordKeys: []
    };
    const rightFloor = {
        fragmentId: "floor_area:section-a:1:right",
        surfaceId: "right-surface",
        ownerSectionKey: "section-a",
        level: 1,
        nodeBaseZ: 3,
        outerPolygon: [
            { x: 5, y: 0 },
            { x: 9, y: 0 },
            { x: 9, y: 4 },
            { x: 5, y: 4 }
        ],
        holes: [],
        tileCoordKeys: []
    };
    const runtimeLeft = {
        ...leftFloor,
        outerPolygon: leftFloor.outerPolygon.map(point => ({ ...point })),
        holes: []
    };
    const runtimeRight = {
        ...rightFloor,
        outerPolygon: rightFloor.outerPolygon.map(point => ({ ...point })),
        holes: []
    };
    let unregisteredIds = [];
    let registeredRecords = [];
    const sectionAsset = {
        key: "section-a",
        centerAxial: { q: 0, r: 0 },
        floors: [leftFloor, rightFloor],
        tileCoordKeys: []
    };
    const map = {
        floorsById: new context.Map([
            [runtimeLeft.fragmentId, runtimeLeft],
            [runtimeRight.fragmentId, runtimeRight]
        ]),
        floorNodesById: new context.Map([
            [runtimeLeft.fragmentId, []],
            [runtimeRight.fragmentId, []]
        ]),
        _prototypeSectionState: {
            basis: {},
            sectionAssetsByKey: new context.Map([["section-a", sectionAsset]]),
            nodesBySectionKey: new context.Map([["section-a", []]]),
            allNodesByCoordKey: new context.Map()
        },
        unregisterFloorFragments(ids) {
            unregisteredIds = ids.slice();
            for (const id of ids) this.floorsById.delete(id);
            return ids.length;
        },
        registerFloorFragmentsForSection(sectionKey, _state, records) {
            assert.equal(sectionKey, "section-a");
            registeredRecords = records.slice();
            for (const record of records) this.floorsById.set(record.fragmentId, record);
            return { fragmentCount: records.length, nodeCount: 0 };
        },
        syncPrototypeWalls() {
            assert.fail("overlap merge should use fragment rematerialization");
        },
        wrapWorldX: x => x,
        wrapWorldY: y => y
    };
    const wizard = {
        currentSpell: "flooredit",
        selectedFloorEditLevel: 1,
        map
    };

    assert.equal(context.SpellSystem.beginFloorEditorVertexDrag(wizard, 4, 0), true);
    assert.equal(context.SpellSystem.updateFloorEditorVertexDrag(wizard, 6, 0), true);
    assert.equal(context.SpellSystem.endFloorEditorVertexDrag(wizard), true);

    assert.deepEqual(new Set(unregisteredIds), new Set([leftFloor.fragmentId, rightFloor.fragmentId]));
    assert.equal(registeredRecords.length, 1);
    assert.equal(registeredRecords[0].fragmentId, leftFloor.fragmentId);
    assert.equal(registeredRecords[0].surfaceId, leftFloor.surfaceId);
    assert.equal(sectionAsset.floors.length, 1);
    assert.equal(sectionAsset.floors[0].fragmentId, leftFloor.fragmentId);
});

test("floor vertex drag merges same-section fragments that share two vertices", () => {
    const context = loadSpellContext();
    context.worldToScreen = point => ({ x: Number(point.x), y: Number(point.y) });
    context.presentGameFrame = () => {};
    context.__sectionGeometry = {
        getSectionHexagonCorners() {
            return [
                { x: -20, y: -20 },
                { x: 20, y: -20 },
                { x: 20, y: 20 },
                { x: -20, y: 20 }
            ];
        }
    };
    const leftFloor = {
        fragmentId: "floor_area:section-a:1:left",
        surfaceId: "left-surface",
        ownerSectionKey: "section-a",
        level: 1,
        nodeBaseZ: 3,
        outerPolygon: [
            { x: 0, y: 0 },
            { x: 5, y: 0 },
            { x: 4, y: 4 },
            { x: 0, y: 4 }
        ],
        holes: [],
        tileCoordKeys: []
    };
    const rightFloor = {
        fragmentId: "floor_area:section-a:1:right",
        surfaceId: "right-surface",
        ownerSectionKey: "section-a",
        level: 1,
        nodeBaseZ: 3,
        outerPolygon: [
            { x: 5, y: 0 },
            { x: 9, y: 0 },
            { x: 9, y: 4 },
            { x: 5, y: 4 }
        ],
        holes: [],
        tileCoordKeys: []
    };
    const runtimeLeft = {
        ...leftFloor,
        outerPolygon: leftFloor.outerPolygon.map(point => ({ ...point })),
        holes: []
    };
    const runtimeRight = {
        ...rightFloor,
        outerPolygon: rightFloor.outerPolygon.map(point => ({ ...point })),
        holes: []
    };
    let unregisteredIds = [];
    let registeredRecords = [];
    const sectionAsset = {
        key: "section-a",
        centerAxial: { q: 0, r: 0 },
        floors: [leftFloor, rightFloor],
        tileCoordKeys: []
    };
    const map = {
        floorsById: new context.Map([
            [runtimeLeft.fragmentId, runtimeLeft],
            [runtimeRight.fragmentId, runtimeRight]
        ]),
        floorNodesById: new context.Map([
            [runtimeLeft.fragmentId, []],
            [runtimeRight.fragmentId, []]
        ]),
        _prototypeSectionState: {
            basis: {},
            sectionAssetsByKey: new context.Map([["section-a", sectionAsset]]),
            nodesBySectionKey: new context.Map([["section-a", []]]),
            allNodesByCoordKey: new context.Map()
        },
        unregisterFloorFragments(ids) {
            unregisteredIds = ids.slice();
            for (const id of ids) this.floorsById.delete(id);
            return ids.length;
        },
        registerFloorFragmentsForSection(sectionKey, _state, records) {
            assert.equal(sectionKey, "section-a");
            registeredRecords = records.slice();
            for (const record of records) this.floorsById.set(record.fragmentId, record);
            return { fragmentCount: records.length, nodeCount: 0 };
        },
        syncPrototypeWalls() {
            assert.fail("shared-edge merge should use fragment rematerialization");
        },
        wrapWorldX: x => x,
        wrapWorldY: y => y
    };
    const wizard = {
        currentSpell: "flooredit",
        selectedFloorEditLevel: 1,
        map
    };

    assert.equal(context.SpellSystem.beginFloorEditorVertexDrag(wizard, 4, 4), true);
    assert.equal(context.SpellSystem.updateFloorEditorVertexDrag(wizard, 5, 4), true);
    assert.equal(context.SpellSystem.endFloorEditorVertexDrag(wizard), true);

    assert.deepEqual(new Set(unregisteredIds), new Set([leftFloor.fragmentId, rightFloor.fragmentId]));
    assert.equal(registeredRecords.length, 1);
    assert.equal(registeredRecords[0].fragmentId, leftFloor.fragmentId);
    assert.equal(sectionAsset.floors.length, 1);
});

test("floor shape started from boundary vertices inherits surface after side is chosen", () => {
    const context = loadSpellContext();
    context.worldToScreen = point => ({ x: Number(point.x), y: Number(point.y) });
    context.presentGameFrame = () => {};
    context.message = () => {};
    context.__sectionGeometry = {
        resolvePrototypeSectionCoordForWorldPosition(_state, x) {
            return { q: Number(x) < 10 ? 0 : 1, r: 0 };
        },
        makeSectionKey(coord) {
            return `${Number(coord.q)},${Number(coord.r)}`;
        },
        getSectionHexagonCorners(centerAxial) {
            const left = Number(centerAxial && centerAxial.q) === 0;
            const x0 = left ? 0 : 10;
            const x1 = left ? 10 : 20;
            return [
                { x: x0, y: 0 },
                { x: x1, y: 0 },
                { x: x1, y: 10 },
                { x: x0, y: 10 }
            ];
        }
    };
    const leftFloor = {
        fragmentId: "floor_area:0,0:1:0",
        surfaceId: "shared-bridge",
        ownerSectionKey: "0,0",
        level: 1,
        nodeBaseZ: 3,
        outerPolygon: [
            { x: 6, y: 2 },
            { x: 10, y: 2 },
            { x: 10, y: 8 },
            { x: 6, y: 8 }
        ],
        holes: [],
        tileCoordKeys: []
    };
    const runtimeLeft = {
        ...leftFloor,
        outerPolygon: leftFloor.outerPolygon.map(point => ({ ...point })),
        holes: []
    };
    let registeredSectionKey = "";
    let registeredRecord = null;
    const map = {
        floorsById: new context.Map([[runtimeLeft.fragmentId, runtimeLeft]]),
        floorNodesById: new context.Map([[runtimeLeft.fragmentId, []]]),
        _prototypeSectionState: {
            basis: {},
            sectionAssetsByKey: new context.Map([
                ["0,0", {
                    key: "0,0",
                    centerAxial: { q: 0, r: 0 },
                    floors: [leftFloor],
                    tileCoordKeys: []
                }],
                ["1,0", {
                    key: "1,0",
                    centerAxial: { q: 1, r: 0 },
                    floors: [],
                    tileCoordKeys: ["12,2", "12,4", "12,6", "14,4"]
                }]
            ]),
            nodesBySectionKey: new context.Map(),
            allNodesByCoordKey: new context.Map()
        },
        unregisterFloorFragments(ids) {
            for (const id of ids) this.floorsById.delete(id);
            return ids.length;
        },
        registerFloorFragmentsForSection(sectionKey, _state, records) {
            registeredSectionKey = sectionKey;
            registeredRecord = records[0];
            this.floorsById.set(registeredRecord.fragmentId, registeredRecord);
            return { fragmentCount: records.length, nodeCount: 0 };
        },
        syncPrototypeWalls() {
            assert.fail("single-section floor authoring should not rebuild whole section walls");
        },
        wrapWorldX: x => x,
        wrapWorldY: y => y
    };
    const wizard = {
        currentSpell: "floorshape",
        selectedFloorEditLevel: 1,
        map
    };

    context.SpellSystem.castWizardSpell(wizard, 10, 2, { screenX: 10, screenY: 2 });
    context.SpellSystem.castWizardSpell(wizard, 10, 8, { screenX: 10, screenY: 8 });
    assert.equal(wizard._floorShapePlacementDraft.sectionKey, undefined);
    context.SpellSystem.castWizardSpell(wizard, 18, 8, { screenX: 100, screenY: 100 });
    assert.equal(wizard._floorShapePlacementDraft.sectionKey, "1,0");
    context.SpellSystem.castWizardSpell(wizard, 20, 10, { screenX: 120, screenY: 120 });
    context.SpellSystem.castWizardSpell(wizard, 20, 10, { screenX: 120, screenY: 120, clickCount: 2 });

    assert.equal(registeredSectionKey, "1,0");
    assert.equal(registeredRecord.surfaceId, "shared-bridge");
    assert.equal(registeredRecord.ownerSectionKey, "1,0");
    const vertexKeys = new Set(registeredRecord.outerPolygon.map(point => `${point.x},${point.y}`));
    assert.ok(vertexKeys.has("10,2"));
    assert.ok(vertexKeys.has("10,8"));
    assert.ok(registeredRecord.outerPolygon.every(point => point.x >= 10 && point.x <= 20));
});
