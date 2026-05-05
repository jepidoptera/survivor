const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

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
