"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createSectionWorldBlockingHelpers } = require("../public/assets/javascript/prototypes/sectionWorldBlocking.js");
const FloorFragmentEdit = require("../public/assets/javascript/spells/editor/FloorFragmentEdit.js");
const FloorStairs = require("../public/assets/javascript/spells/editor/FloorStairs.js");

// ---------------------------------------------------------------------------
// Load GameMap and Character from the same vm context as movement tests.
// ---------------------------------------------------------------------------

function loadGameClasses() {
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
        roof: null,
        roofs: [],
        polygonClipping: require("polygon-clipping"),
        wizard: null,
        player: null,
        objectLayer: [],
        setTimeout: () => 1,
        clearTimeout() {},
        setInterval: () => 1,
        clearInterval() {},
        Inventory: class Inventory {},
        CircleHitbox: class CircleHitbox {
            constructor(x, y, radius) { this.x = x; this.y = y; this.radius = radius; }
            moveTo(x, y) { this.x = x; this.y = y; }
        },
        PIXI: {
            Texture: class Texture {
                constructor() { this.baseTexture = { valid: true, width: 64, height: 64, once() {} }; }
                static from() { return new this(); }
            },
            Sprite: class Sprite {
                constructor() { this.texture = null; this.parent = null; this.anchor = { set() {} }; }
                destroy() {}
            },
            Rectangle: class Rectangle {
                constructor(x, y, w, h) { this.x = x; this.y = y; this.width = w; this.height = h; }
            },
            Graphics: class Graphics {
                constructor() { this.parent = null; this.visible = true; this.x = 0; this.y = 0; this.name = ""; this.interactive = false; }
                clear() {} beginFill() {} drawRoundedRect() {} endFill() {}
            }
        },
        ensureSpriteFrames() {},
        document: {
            createElement() {
                return {
                    width: 0, height: 0,
                    getContext() {
                        return {
                            clearRect() {}, drawImage() {},
                            getImageData() { return { data: new Uint8ClampedArray(4) }; },
                            putImageData() {}
                        };
                    }
                };
            }
        }
    };
    context.globalThis = context;
    vm.createContext(context);

    const files = [
        path.join(__dirname, "../public/assets/javascript/shared/StairTraversal.js"),
        path.join(__dirname, "../public/assets/javascript/Map.js"),
        path.join(__dirname, "../public/assets/javascript/gameobjects/Character.js"),
        path.join(__dirname, "../public/assets/javascript/gameobjects/NpcCharacter.js")
    ];
    for (const filePath of files) {
        const source = fs.readFileSync(filePath, "utf8");
        vm.runInContext(source, context, { filename: filePath });
    }
    vm.runInContext("globalThis.__testExports = { GameMap, Character };", context);
    return context.__testExports;
}

const { GameMap, Character } = loadGameClasses();

// ---------------------------------------------------------------------------
// Helper: build a Character harness with minimal state for movement testing.
// ---------------------------------------------------------------------------
function makeWizard(map, startNode, destination, pathNodes) {
    const actor = Object.create(Character.prototype);
    Object.assign(actor, {
        map,
        node: startNode,
        x: startNode.x,
        y: startNode.y,
        z: Number(startNode.baseZ) || 0,
        prevX: startNode.x,
        prevY: startNode.y,
        prevZ: Number(startNode.baseZ) || 0,
        path: pathNodes.slice(),
        destination,
        nextNode: null,
        currentPathStep: null,
        travelFrames: 0,
        travelX: 0,
        travelY: 0,
        travelZ: 0,
        frameRate: 1,
        speed: 100,
        moving: false,
        dead: false,
        gone: false,
        useExternalScheduler: true,
        casting: false,
        isOnFire: false,
        maxHp: 10,
        hp: 10,
        healRate: 0,
        healRateMultiplier: 1,
        _onScreen: false,
        nodeVisitLog: [],
        nodeVisitLogLimit: 50,
        touchBox: { moveTo() {} },
        shadowBox: { moveTo() {} },
        direction: null,
        _closeCombatState: null,
        isTemperatureFrozen() { return false; },
        isScriptFrozen() { return false; },
        recoverTemperature() {},
        burn() {},
        updateSeePlayerState() {},
        updateHitboxes() {},
        applyFrozenState() {},
        getEffectiveMovementSpeed(speed) { return speed; },
        nextMove() { return null; }
    });
    Object.defineProperty(actor, "onScreen", { value: false, writable: true, configurable: true });
    return actor;
}

// ---------------------------------------------------------------------------
// Bug-reproduction test.
//
// Scenario: wizard on level-1 upper floor with two connected nodes A and B.
// A wall blocks A→B.  After a hole is cut in the floor (triggering
// rematerializeSections) all floor nodes are destroyed and rebuilt from
// asset.floors.  The new nodes start with empty blockedNeighbors.  The test
// asserts that the wizard CAN walk through the wall after the hole — that is,
// it documents the bug in its current broken state.  When the bug is fixed
// this test should be updated to assert the opposite (cannot walk through).
// ---------------------------------------------------------------------------
test("wizard can walk through upper floor wall after hole is cut in floor (bug)", () => {
    // ── 1. Build a real GameMap with a two-node level-1 platform ──────────
    const map = Object.create(GameMap.prototype);
    map.width = 2;
    map.height = 1;
    map.wrapX = false;
    map.wrapY = false;
    map.nodes = null;
    map.shortestDeltaX = (fromX, toX) => toX - fromX;
    map.shortestDeltaY = (fromY, toY) => toY - fromY;
    map.resetFloorRuntimeState();

    const SECTION_KEY = "s";
    const FRAGMENT_ID = "floor_area:s:1:0";
    const SURFACE_ID = "floor_area:s:1";

    const asset = {
        key: SECTION_KEY,
        floors: [{
            fragmentId: FRAGMENT_ID,
            surfaceId: SURFACE_ID,
            ownerSectionKey: SECTION_KEY,
            level: 1,
            nodeBaseZ: 3,
            outerPolygon: [
                { x: -0.5, y: -0.5 },
                { x: 1.5, y: -0.5 },
                { x: 1.5, y: 0.5 },
                { x: -0.5, y: 0.5 }
            ],
            holes: [],
            tileCoordKeys: []
        }],
        blockedEdges: []
    };

    // Register the initial floor fragment.
    let fragment = map.registerFloorFragment(asset.floors[0]);

    const srcA = {
        xindex: 0, yindex: 0, x: 0, y: 0, baseZ: 0, portalEdges: [],
        neighborOffsets: Object.assign(new Array(12).fill(null), { 3: { x: 1, y: 0 } })
    };
    const srcB = {
        xindex: 1, yindex: 0, x: 1, y: 0, baseZ: 0, portalEdges: [],
        neighborOffsets: Object.assign(new Array(12).fill(null), { 9: { x: -1, y: 0 } })
    };

    let nodeA = map.createFloorNodeFromSource(srcA, fragment, { baseZ: 3, traversalLayer: 1 });
    let nodeB = map.createFloorNodeFromSource(srcB, fragment, { baseZ: 3, traversalLayer: 1 });
    nodeA.neighbors[3] = nodeB;
    nodeB.neighbors[9] = nodeA;

    // ── 2. Apply wall blocking between A and B ────────────────────────────
    asset.blockedEdges = [{
        recordId: 1,
        traversalLayer: 1,
        a: { xindex: 0, yindex: 0, traversalLayer: 1, surfaceId: SURFACE_ID, fragmentId: FRAGMENT_ID },
        b: { xindex: 1, yindex: 0, traversalLayer: 1, surfaceId: SURFACE_ID, fragmentId: FRAGMENT_ID }
    }];

    map._prototypeWallState = { activeRecordSignature: "1", activeRuntimeWallsByRecordId: new Map() };
    map.getPrototypeSectionAsset = (key) => key === SECTION_KEY ? asset : null;
    map.getNodeByIndex = () => null;

    const { applyPrototypeBlockedEdgesForSection } = createSectionWorldBlockingHelpers(map, {});
    applyPrototypeBlockedEdgesForSection(map, SECTION_KEY);

    // ── 3. Verify wall blocks BEFORE the hole ─────────────────────────────
    assert.ok(nodeA.blockedNeighbors.size > 0,
        "wall must block A→B before hole (test setup problem if this fails)");
    assert.equal(map.findPathAStar(nodeA, nodeB), null,
        "wizard must not reach B before hole (test setup problem if this fails)");

    // ── 4. Cut a hole in the floor ────────────────────────────────────────
    // Simulate the raw rematerialisation step that the in-game hole spell
    // performs: destroy old nodes and rebuild from asset.floors.  This is the
    // critical half of the production path that loses blocking — new floor
    // nodes start with empty blockedNeighbors and nothing re-applies the wall
    // records to them.  The fix (applyPrototypeBlockedEdgesForSection called
    // inside rematerializeSections) is exercised separately by the test below.
    function rawRematerialize() {
        // Unregister: wipe all index entries for the old nodes.
        map._unindexFloorNodeByLayer(nodeA);
        map._unindexFloorNodeByLayer(nodeB);
        if (map.floorNodeIndex instanceof Map) {
            map.floorNodeIndex.delete(nodeA.id);
            map.floorNodeIndex.delete(nodeB.id);
        }
        if (map.floorNodesById instanceof Map) map.floorNodesById.delete(FRAGMENT_ID);
        if (map.floorsById instanceof Map) map.floorsById.delete(FRAGMENT_ID);
        if (map.floorFragmentsBySurfaceId instanceof Map) {
            const s = map.floorFragmentsBySurfaceId.get(SURFACE_ID);
            if (s) { s.delete(FRAGMENT_ID); if (s.size === 0) map.floorFragmentsBySurfaceId.delete(SURFACE_ID); }
        }
        if (map.floorFragmentsBySectionKey instanceof Map) map.floorFragmentsBySectionKey.delete(SECTION_KEY);

        // Register: create fresh nodes — blockedNeighbors is empty.
        fragment = map.registerFloorFragment(asset.floors[0]);
        nodeA = map.createFloorNodeFromSource(srcA, fragment, { baseZ: 3, traversalLayer: 1 });
        nodeB = map.createFloorNodeFromSource(srcB, fragment, { baseZ: 3, traversalLayer: 1 });
        nodeA.neighbors[3] = nodeB;
        nodeB.neighbors[9] = nodeA;
        // Intentionally NOT calling applyPrototypeBlockedEdgesForSection here.
        // That omission is the bug: floor nodes are rebuilt but wall blocking
        // is never re-attached to them.
    }
    rawRematerialize();

    // ── 5. Verify wizard CAN walk through the wall after hole ─────────────
    // nodeA and nodeB now point to the freshly-created replacement nodes.
    const pathAfterHole = map.findPathAStar(nodeA, nodeB);

    // BUG: blocking was lost — wizard now has a clear path through the wall.
    // When this bug is fixed the raw rematerialisation path will no longer be
    // exercised directly; the production code (rematerializeSections) will
    // call applyPrototypeBlockedEdgesForSection, and the test below will
    // cover that correctly-fixed path.
    assert.notEqual(pathAfterHole, null,
        "BUG: wall no longer blocks after hole is cut — blocking was lost on floor rematerialisation");
});

// ---------------------------------------------------------------------------
// The failing test.
//
// Scenario: level-1 platform with two nodes.  A wall blocks movement between
// them.  A hole is then cut in the floor (simulated via rematerializeSections),
// which rebuilds the floor nodes from scratch.  The test asserts that the wall
// STILL blocks the wizard.  It currently FAILS because new floor nodes have
// empty blockedNeighbors — no code re-applies wall blocking after rematerialization
// when syncPrototypeWalls is absent or broken.
// ---------------------------------------------------------------------------
test("wizard cannot walk through platform wall after a hole is cut in the floor", () => {
    // ── 1. Build a real GameMap with a two-node level-1 platform ──────────
    const map = Object.create(GameMap.prototype);
    map.width = 2;
    map.height = 1;
    map.wrapX = false;
    map.wrapY = false;
    map.nodes = null;
    map.shortestDeltaX = (fromX, toX) => toX - fromX;
    map.shortestDeltaY = (fromY, toY) => toY - fromY;
    map.resetFloorRuntimeState();

    const SECTION_KEY = "s";
    const FRAGMENT_ID = "platform";
    const SURFACE_ID = "platform-surface";

    // Register the upper-floor fragment.
    let fragment = map.registerFloorFragment({
        fragmentId: FRAGMENT_ID,
        surfaceId: SURFACE_ID,
        ownerSectionKey: SECTION_KEY,
        level: 1,
        nodeBaseZ: 3,
        outerPolygon: [
            { x: -0.5, y: -0.5 },
            { x: 1.5, y: -0.5 },
            { x: 1.5, y: 0.5 },
            { x: -0.5, y: 0.5 }
        ]
    });

    // Source nodes carry neighborOffsets so _connectFloorNodesIncremental can
    // re-link the replacement nodes after rematerialization.
    // Direction 3 = east (+x), direction 9 = west (-x).
    const srcA = {
        xindex: 0, yindex: 0, x: 0, y: 0, baseZ: 0, portalEdges: [],
        neighborOffsets: Object.assign(new Array(12).fill(null), { 3: { x: 1, y: 0 } })
    };
    const srcB = {
        xindex: 1, yindex: 0, x: 1, y: 0, baseZ: 0, portalEdges: [],
        neighborOffsets: Object.assign(new Array(12).fill(null), { 9: { x: -1, y: 0 } })
    };

    // Create the initial floor nodes and wire up neighbors.
    let nodeA = map.createFloorNodeFromSource(srcA, fragment, { baseZ: 3, traversalLayer: 1 });
    let nodeB = map.createFloorNodeFromSource(srcB, fragment, { baseZ: 3, traversalLayer: 1 });
    nodeA.neighbors[3] = nodeB;
    nodeB.neighbors[9] = nodeA;

    // ── 2. Apply wall blocking between A and B ────────────────────────────
    const sectionAsset = {
        key: SECTION_KEY,
        blockedEdges: [{
            recordId: 1,
            traversalLayer: 1,
            a: { xindex: 0, yindex: 0, traversalLayer: 1, surfaceId: SURFACE_ID, fragmentId: FRAGMENT_ID },
            b: { xindex: 1, yindex: 0, traversalLayer: 1, surfaceId: SURFACE_ID, fragmentId: FRAGMENT_ID }
        }]
    };

    map._prototypeWallState = { activeRecordSignature: "1" };
    map.getPrototypeSectionAsset = (key) => key === SECTION_KEY ? sectionAsset : null;
    map.getNodeByIndex = () => null;

    const { applyPrototypeBlockedEdgesForSection } = createSectionWorldBlockingHelpers(map, {});
    applyPrototypeBlockedEdgesForSection(map, SECTION_KEY);

    // Sanity: wall must block before the hole is cut.
    assert.ok(nodeA.blockedNeighbors.size > 0, "wall should block A→B before hole placement");
    const pathBefore = map.findPathAStar(nodeA, nodeB);
    assert.equal(pathBefore, null, "wizard must not reach B before hole placement — wall is blocking");

    // ── 3. Cut a hole in the floor (simulated via rematerializeSections) ──
    //
    // We provide unregister/register hooks that update the real GameMap indexes
    // so getFloorNodeAtLayer works correctly after the swap.  We deliberately do
    // NOT install syncPrototypeWalls on the map, so the code that should re-apply
    // wall blocking has no way to do so.  This is exactly the production scenario
    // where syncPrototypeWalls is unavailable or fails to re-apply blocking.
    map.unregisterSectionFloorNodes = function () {
        map._unindexFloorNodeByLayer(nodeA);
        map._unindexFloorNodeByLayer(nodeB);
        if (map.floorNodeIndex instanceof Map) {
            map.floorNodeIndex.delete(nodeA.id);
            map.floorNodeIndex.delete(nodeB.id);
        }
        if (map.floorNodesById instanceof Map) map.floorNodesById.delete(FRAGMENT_ID);
        if (map.floorsById instanceof Map) map.floorsById.delete(FRAGMENT_ID);
        if (map.floorFragmentsBySurfaceId instanceof Map) {
            const s = map.floorFragmentsBySurfaceId.get(SURFACE_ID);
            if (s) { s.delete(FRAGMENT_ID); if (s.size === 0) map.floorFragmentsBySurfaceId.delete(SURFACE_ID); }
        }
        if (map.floorFragmentsBySectionKey instanceof Map) map.floorFragmentsBySectionKey.delete(SECTION_KEY);
    };
    map.registerSectionFloorNodes = function () {
        fragment = map.registerFloorFragment({
            fragmentId: FRAGMENT_ID, surfaceId: SURFACE_ID,
            ownerSectionKey: SECTION_KEY, level: 1, nodeBaseZ: 3,
            outerPolygon: [
                { x: -0.5, y: -0.5 }, { x: 1.5, y: -0.5 },
                { x: 1.5, y: 0.5 }, { x: -0.5, y: 0.5 }
            ]
        });
        // Fresh nodes — blockedNeighbors starts empty.
        nodeA = map.createFloorNodeFromSource(srcA, fragment, { baseZ: 3, traversalLayer: 1 });
        nodeB = map.createFloorNodeFromSource(srcB, fragment, { baseZ: 3, traversalLayer: 1 });
        // Reconnect neighbors so pathfinding can traverse the platform.
        nodeA.neighbors[3] = nodeB;
        nodeB.neighbors[9] = nodeA;
    };

    // This simulates what happens in-game when a hole is placed in a floor.
    FloorStairs._test.rematerializeSections(map, new Set([SECTION_KEY]));

    // ── 4. Direct the wizard to walk through the wall ─────────────────────
    //
    // findPathAStar uses the real getTraversalInfo which checks blockedNeighbors.
    // If the wall was re-applied to the new nodes it will return null.
    // If it was not re-applied (the bug) it will return a path.
    const pathAfterHole = map.findPathAStar(nodeA, nodeB);

    if (pathAfterHole !== null && Array.isArray(pathAfterHole)) {
        // Wall is broken: wizard has a path to nodeB.  Simulate the wizard
        // actually walking through the wall so the failure message is concrete.
        const wizard = makeWizard(map, nodeA, nodeB, pathAfterHole);
        wizard.move(); // pick up path step
        wizard.move(); // arrive at nodeB
        assert.notEqual(wizard.node, nodeA,
            "wizard reached nodeB — fell off the platform (wall did not block after hole placement)");
    }

    // Primary assertion: no path should exist through the wall.
    assert.equal(pathAfterHole, null,
        "wall must still block after hole placement — wizard must not be able to walk through it");
});

// ---------------------------------------------------------------------------
// Kept for reference: the earlier unit test that checks blockedNeighbors
// directly on replacement nodes (passes when syncPrototypeWalls is mocked).
// ---------------------------------------------------------------------------
function prototypeHasActiveDirectionalBlockers(blockers) {
    if (!(blockers instanceof Set)) return false;
    for (const b of blockers) {
        if (b && !b.gone) return true;
    }
    return false;
}

function makeFloorNode(xi, yi, layer = 1) {
    return {
        xindex: xi, yindex: yi, x: xi, y: yi,
        traversalLayer: layer,
        neighbors: new Array(12).fill(null),
        blockedNeighbors: new Map(),
        surfaceId: "surf",
        fragmentId: "frag"
    };
}

test("rematerializeSections re-applies wall blocked edges when syncPrototypeWalls is provided", () => {
    let nodeA = makeFloorNode(0, 0);
    let nodeB = makeFloorNode(1, 0);
    nodeA.neighbors[3] = nodeB;
    nodeB.neighbors[9] = nodeA;
    let current = { "0,0": nodeA, "1,0": nodeB };

    const sectionAsset = {
        key: "s",
        blockedEdges: [{
            recordId: 1,
            traversalLayer: 1,
            a: { xindex: 0, yindex: 0, traversalLayer: 1, surfaceId: "surf", fragmentId: "frag" },
            b: { xindex: 1, yindex: 0, traversalLayer: 1, surfaceId: "surf", fragmentId: "frag" }
        }]
    };

    const wallState = { activeRecordSignature: "1" };

    const map = {
        _prototypeBlockedEdgeState: null,
        _prototypeWallState: wallState,
        getPrototypeSectionAsset: (key) => key === "s" ? sectionAsset : null,
        getFloorNodeAtLayer: (xi, yi) => current[`${xi},${yi}`] ?? null,
        getNodeByIndex: () => null,
        unregisterSectionFloorNodes(key) { current = {}; },
        registerSectionFloorNodes(key) {
            const newA = makeFloorNode(0, 0);
            const newB = makeFloorNode(1, 0);
            newA.neighbors[3] = newB;
            newB.neighbors[9] = newA;
            current = { "0,0": newA, "1,0": newB };
        }
    };

    const helpers = createSectionWorldBlockingHelpers(map, { prototypeHasActiveDirectionalBlockers });
    const { applyPrototypeBlockedEdgesForSection, ensurePrototypeBlockedEdgeState } = helpers;

    map.syncPrototypeWalls = function () {
        const bState = ensurePrototypeBlockedEdgeState(map);
        if (!bState.activeEntriesBySectionKey.has("s")) {
            applyPrototypeBlockedEdgesForSection(map, "s");
        }
        wallState.activeRecordSignature = "1";
    };

    applyPrototypeBlockedEdgesForSection(map, "s");
    assert.ok(nodeA.blockedNeighbors.size > 0, "wall blocks before rematerialization");

    FloorStairs._test.rematerializeSections(map, new Set(["s"]));

    const newA = current["0,0"];
    const newB = current["1,0"];
    assert.ok(newA, "new nodeA exists after rematerialization");
    assert.ok(newB, "new nodeB exists after rematerialization");
    assert.ok(newA.blockedNeighbors.size > 0,
        "wall must still block after floor hole placement (new floor nodes must have blocked edges applied)");
    assert.ok(newB.blockedNeighbors.size > 0,
        "wall must still block (other side) after floor hole placement");
});

test("rematerializeSections reattaches managed loaded wall hitboxes to replacement floor nodes", () => {
    const SECTION_KEY = "s";
    const RECORD_ID = 42;
    let currentNode = makeFloorNode(0, 0);
    currentNode._prototypeSectionKey = SECTION_KEY;
    currentNode.addObject = function addObject(obj) {
        if (!this.objects) this.objects = [];
        if (!this.objects.includes(obj)) this.objects.push(obj);
    };
    currentNode.removeObject = function removeObject(obj) {
        if (!Array.isArray(this.objects)) return;
        const index = this.objects.indexOf(obj);
        if (index >= 0) this.objects.splice(index, 1);
    };
    currentNode.objects = [];

    let addToMapNodesOptions = null;
    const wall = {
        type: "wallSection",
        gone: false,
        _prototypeRuntimeRecord: true,
        _prototypeRecordId: RECORD_ID,
        _prototypeOwnerSectionKey: SECTION_KEY,
        _prototypeUsesSectionBlockedEdges: true,
        nodes: [currentNode],
        addToMapNodes(options = {}) {
            addToMapNodesOptions = options;
            for (const node of this.nodes.slice()) {
                if (node && typeof node.removeObject === "function") node.removeObject(this);
            }
            this.nodes = [currentNode];
            currentNode.addObject(this);
        }
    };
    currentNode.addObject(wall);

    const sectionAsset = {
        key: SECTION_KEY,
        walls: [{ id: RECORD_ID, type: "wallSection" }],
        blockedEdges: []
    };
    const wallState = {
        activeRecordSignature: String(RECORD_ID),
        activeRuntimeWallsByRecordId: new Map([[RECORD_ID, wall]])
    };
    const oldNode = currentNode;
    const map = {
        _prototypeBlockedEdgeState: null,
        _prototypeWallState: wallState,
        getPrototypeSectionAsset: (key) => key === SECTION_KEY ? sectionAsset : null,
        unregisterSectionFloorNodes() {
            currentNode = null;
        },
        registerSectionFloorNodes() {
            currentNode = makeFloorNode(0, 0);
            currentNode._prototypeSectionKey = SECTION_KEY;
            currentNode.objects = [];
            currentNode.addObject = oldNode.addObject;
            currentNode.removeObject = oldNode.removeObject;
        },
        syncPrototypeWalls() {
            wallState.activeRecordSignature = String(RECORD_ID);
        }
    };

    FloorStairs._test.rematerializeSections(map, new Set([SECTION_KEY]));

    assert.equal(oldNode.objects.includes(wall), false,
        "managed loaded wall must be removed from stale floor node");
    assert.equal(currentNode.objects.includes(wall), true,
        "managed loaded wall must be attached to replacement floor node for wizard hitbox discovery");
    assert.deepEqual(addToMapNodesOptions, { applyDirectionalBlocking: false },
        "section-blocked-edge walls should not recompute directional blockers while refreshing hitbox registration");
});

test("fragment rematerialization preserves untouched floor fragment nodes", () => {
    const map = Object.create(GameMap.prototype);
    map.width = 4;
    map.height = 1;
    map.wrapX = false;
    map.wrapY = false;
    map.nodes = null;
    map.resetFloorRuntimeState();

    const sourceNodes = [
        {
            xindex: 0, yindex: 0, x: 0, y: 0, baseZ: 0, portalEdges: [],
            neighborOffsets: Object.assign(new Array(12).fill(null), { 3: { x: 1, y: 0 } }),
            _prototypeSectionKey: "s"
        },
        {
            xindex: 1, yindex: 0, x: 1, y: 0, baseZ: 0, portalEdges: [],
            neighborOffsets: Object.assign(new Array(12).fill(null), { 9: { x: -1, y: 0 } }),
            _prototypeSectionKey: "s"
        }
    ];
    const state = {
        sectionAssetsByKey: new Map([["s", { key: "s" }]]),
        nodesBySectionKey: new Map([["s", sourceNodes]]),
        allNodesByCoordKey: new Map(sourceNodes.map(node => [`${node.xindex},${node.yindex}`, node]))
    };
    const fragmentA = {
        fragmentId: "frag:a",
        surfaceId: "surf",
        ownerSectionKey: "s",
        level: 1,
        nodeBaseZ: 3,
        outerPolygon: [],
        holes: [],
        tileCoordKeys: ["0,0"]
    };
    const fragmentB = {
        fragmentId: "frag:b",
        surfaceId: "surf",
        ownerSectionKey: "s",
        level: 1,
        nodeBaseZ: 3,
        outerPolygon: [],
        holes: [],
        tileCoordKeys: ["1,0"]
    };

    map.registerFloorFragmentsForSection("s", state, [fragmentA, fragmentB]);
    const untouchedNode = map.floorNodesById.get("frag:b")[0];
    assert.ok(untouchedNode, "untouched fragment starts materialized");

    map.unregisterFloorFragments(["frag:a"]);
    map.registerFloorFragmentsForSection("s", state, [{
        ...fragmentA,
        fragmentId: "frag:a:replacement",
        tileCoordKeys: ["0,0"]
    }]);

    const replacementNode = map.floorNodesById.get("frag:a:replacement")[0];
    assert.ok(replacementNode, "replacement fragment is materialized");
    assert.equal(map.floorNodesById.get("frag:b")[0], untouchedNode,
        "unaffected fragment node object should survive fragment-scoped rematerialization");
    assert.equal(replacementNode.neighbors[3], untouchedNode,
        "replacement nodes reconnect to preserved neighboring floor nodes");
    assert.equal(untouchedNode.neighbors[9], replacementNode,
        "preserved nodes get back-links to replacement floor nodes");
});

test("additive floor edit fills an existing fragment hole instead of creating an unrelated island", () => {
    const asset = {
        key: "s",
        tileCoordKeys: [],
        floors: [{
            fragmentId: "floor:2:0",
            surfaceId: "floor:2",
            ownerSectionKey: "s",
            level: 2,
            nodeBaseZ: 6,
            outerPolygon: [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 10, y: 10 },
                { x: 0, y: 10 }
            ],
            holes: [[
                { x: 2, y: 2 },
                { x: 8, y: 2 },
                { x: 8, y: 8 },
                { x: 2, y: 8 }
            ]]
        }]
    };
    const editGeometry = FloorFragmentEdit.geometryFromPoints([
        { x: 2, y: 2 },
        { x: 8, y: 2 },
        { x: 8, y: 8 },
        { x: 2, y: 8 }
    ]);

    const result = FloorFragmentEdit.applyAssetGeometryDelta(asset, 2, editGeometry, "add");

    assert.equal(result.changed, true);
    assert.deepEqual(result.removedFragmentIds, ["floor:2:0"],
        "filling a hole should edit the containing fragment");
    assert.equal(result.fragmentRecords.length, 1);
    assert.equal(result.fragmentRecords[0].fragmentId, "floor:2:0",
        "the containing fragment id should be reused");
    assert.deepEqual(result.fragmentRecords[0].holes, [],
        "the filled hole should be removed from the replacement fragment");
});

test("additive floor edit entirely inside solid floor is treated as a no-op", () => {
    const asset = {
        key: "s",
        tileCoordKeys: [],
        floors: [{
            fragmentId: "floor:2:0",
            surfaceId: "floor:2",
            ownerSectionKey: "s",
            level: 2,
            nodeBaseZ: 6,
            outerPolygon: [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 10, y: 10 },
                { x: 0, y: 10 }
            ],
            holes: []
        }]
    };
    const editGeometry = FloorFragmentEdit.geometryFromPoints([
        { x: 2, y: 2 },
        { x: 4, y: 2 },
        { x: 4, y: 4 },
        { x: 2, y: 4 }
    ]);

    const result = FloorFragmentEdit.applyAssetGeometryDelta(asset, 2, editGeometry, "add");

    assert.equal(result.changed, false);
    assert.equal(result.fragmentRecords.length, 0);
    assert.equal(asset.floors.length, 1,
        "no-op additive edits should not rewrite/rematerialize the fragment");
});

test("FloorStairs fragment rematerialization avoids whole-section floor rebuild", () => {
    const calls = [];
    let touchedRefreshes = 0;
    let unrelatedRefreshes = 0;
    const touchedObj = {
        addToMapNodes() {
            touchedRefreshes += 1;
        }
    };
    const unrelatedObj = {
        addToMapNodes() {
            unrelatedRefreshes += 1;
        }
    };
    const map = {
        floorNodesById: new Map([
            ["old-frag", [{ objects: [touchedObj], visibilityObjects: [] }]],
            ["other-frag", [{ objects: [unrelatedObj], visibilityObjects: [] }]]
        ]),
        _prototypeSectionState: {
            sectionAssetsByKey: new Map([["s", { key: "s", walls: [] }]])
        },
        _prototypeBlockedEdgeState: null,
        _prototypeWallState: null,
        unregisterSectionFloorNodes() {
            throw new Error("whole-section unregister should not be used for fragment rematerialization");
        },
        registerSectionFloorNodes() {
            throw new Error("whole-section register should not be used for fragment rematerialization");
        },
        unregisterFloorFragments(ids) {
            calls.push(["unregister", ids.slice()]);
            return ids.length;
        },
        registerFloorFragmentsForSection(sectionKey, state, records) {
            calls.push(["register", sectionKey, records.map(record => record.fragmentId)]);
            return { fragmentCount: records.length, nodeCount: records.length };
        },
        getPrototypeSectionAsset(key) {
            return key === "s" ? this._prototypeSectionState.sectionAssetsByKey.get("s") : null;
        },
        syncPrototypeWalls() {
            throw new Error("fragment rematerialization should not resync all prototype walls");
        }
    };
    const changes = new Map([["s", {
        removedFragmentIds: ["old-frag"],
        fragmentRecords: [{ fragmentId: "new-frag", ownerSectionKey: "s", tileCoordKeys: ["0,0"] }]
    }]]);

    const count = FloorStairs._test.rematerializeFragmentChanges(map, changes);

    assert.equal(count, 1);
    assert.deepEqual(calls, [
        ["unregister", ["old-frag"]],
        ["register", "s", ["new-frag"]]
    ]);
    assert.equal(touchedRefreshes, 1,
        "only objects already attached to the edited fragment should be refreshed");
    assert.equal(unrelatedRefreshes, 0,
        "objects attached only to untouched fragments should not be refreshed");
});
