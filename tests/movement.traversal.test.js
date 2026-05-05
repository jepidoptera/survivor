const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function createPixiStub() {
    class Texture {
        constructor(baseTexture = { valid: true, width: 64, height: 64 }, rectangle = null) {
            this.baseTexture = baseTexture;
            this.rectangle = rectangle;
        }

        static from() {
            return new Texture({ valid: true, width: 64, height: 64, once() {} });
        }
    }

    Texture.WHITE = new Texture({ valid: true, width: 1, height: 1, once() {} });

    class Sprite {
        constructor(texture = Texture.WHITE) {
            this.texture = texture;
            this.parent = null;
            this.anchor = { set() {} };
        }

        destroy() {}
    }

    class Rectangle {
        constructor(x, y, width, height) {
            this.x = x;
            this.y = y;
            this.width = width;
            this.height = height;
        }
    }

    return {
        Texture,
        Sprite,
        Rectangle
    };
}

function loadTraversalClasses() {
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
        wizard: null,
        player: null,
        objectLayer: [],
        setTimeout: () => 1,
        clearTimeout() {},
        setInterval: () => 1,
        clearInterval() {},
        Inventory: class Inventory {},
        CircleHitbox: class CircleHitbox {
            constructor(x, y, radius) {
                this.x = x;
                this.y = y;
                this.radius = radius;
            }

            moveTo(x, y) {
                this.x = x;
                this.y = y;
            }
        },
        PIXI: createPixiStub(),
        ensureSpriteFrames() {},
        document: {
            createElement() {
                return {
                    width: 0,
                    height: 0,
                    getContext() {
                        return {
                            clearRect() {},
                            drawImage() {},
                            getImageData() {
                                return { data: new Uint8ClampedArray(4) };
                            },
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
        path.join(__dirname, "../public/assets/javascript/Map.js"),
        path.join(__dirname, "../public/assets/javascript/gameobjects/Character.js"),
        path.join(__dirname, "../public/assets/javascript/gameobjects/Animal.js")
    ];

    for (const filePath of files) {
        const source = fs.readFileSync(filePath, "utf8");
        vm.runInContext(source, context, { filename: filePath });
    }

    vm.runInContext("globalThis.__testExports = { GameMap, Character, Animal, Blodia };", context);
    return context.__testExports;
}

const { GameMap, Character, Blodia } = loadTraversalClasses();

function createNode(xindex, yindex, overrides = {}) {
    return {
        xindex,
        yindex,
        x: overrides.x ?? xindex,
        y: overrides.y ?? yindex,
        baseZ: overrides.baseZ ?? 0,
        traversalLayer: overrides.traversalLayer ?? 0,
        neighborOffsets: overrides.neighborOffsets ?? new Array(12).fill(null),
        neighbors: overrides.neighbors ?? new Array(12).fill(null),
        portalEdges: overrides.portalEdges ?? [],
        objects: [],
        visibilityObjects: [],
        blockedNeighbors: new Map(),
        isBlocked() {
            return false;
        }
    };
}

function createMovementMap(nodes) {
    return {
        width: nodes.length,
        height: 1,
        nodes: [nodes],
        worldToNode(x) {
            return x < 0.5 ? nodes[0] : nodes[nodes.length - 1];
        },
        shortestDeltaX(fromX, toX) {
            return toX - fromX;
        },
        shortestDeltaY(fromY, toY) {
            return toY - fromY;
        },
        wrapWorldX(x) {
            return x;
        },
        wrapWorldY(y) {
            return y;
        },
        getNodeBaseZ(node) {
            return Number.isFinite(node && node.baseZ) ? Number(node.baseZ) : 0;
        },
        registerGameObject() {}
    };
}

function createCharacterHarness(ClassRef, map, startNode, overrides = {}) {
    const actor = Object.create(ClassRef.prototype);
    const defaultState = {
        map,
        node: startNode,
        x: startNode.x,
        y: startNode.y,
        z: Number(startNode.baseZ) || 0,
        prevX: startNode.x,
        prevY: startNode.y,
        prevZ: Number(startNode.baseZ) || 0,
        path: [],
        destination: null,
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
        visualHitbox: { moveTo() {} },
        groundPlaneHitbox: { moveTo() {} },
        direction: null,
        _closeCombatState: null,
        _blodiaAi() {},
        isTemperatureFrozen() {
            return false;
        },
        isScriptFrozen() {
            return false;
        },
        recoverTemperature() {},
        burn() {},
        updateSeePlayerState() {},
        updateHitboxes() {},
        applyFrozenState() {},
        getEffectiveMovementSpeed(speed) {
            return speed;
        },
        nextMove() {
            return null;
        }
    };
    const mergedState = { ...defaultState, ...overrides };
    const onScreen = Object.prototype.hasOwnProperty.call(mergedState, "onScreen")
        ? mergedState.onScreen
        : mergedState._onScreen;
    delete mergedState.onScreen;
    Object.assign(actor, mergedState);
    Object.defineProperty(actor, "onScreen", {
        value: !!onScreen,
        writable: true,
        configurable: true,
        enumerable: true
    });
    return actor;
}

test("Character.move follows legacy node paths and lands on node baseZ", () => {
    const start = createNode(0, 0, { x: 0, y: 0, baseZ: 0 });
    const end = createNode(1, 0, { x: 1, y: 0, baseZ: 4 });
    start.neighbors[3] = end;
    const map = createMovementMap([start, end]);
    const actor = createCharacterHarness(Character, map, start, {
        destination: end,
        path: [end]
    });

    actor.move();

    assert.equal(actor.currentPathStep.type, "planar");
    assert.equal(actor.nextNode, end);
    assert.equal(actor.x, 1);
    assert.equal(actor.y, 0);
    assert.equal(actor.z, 4);
    assert.equal(actor.travelZ, 4);

    actor.move();

    assert.equal(actor.node, end);
    assert.equal(actor.destination, null);
    assert.equal(actor.currentPathStep, null);
    assert.equal(actor.moving, false);
  });

test("Character.move interpolates traversal-step world positions and z", () => {
    const start = createNode(0, 0, { x: 0, y: 0, baseZ: 0 });
    const end = createNode(1, 0, { x: 4, y: 0, baseZ: 6 });
    const map = createMovementMap([start, end]);
    const step = {
        fromNode: start,
        toNode: end,
        type: "stairs",
        directionIndex: 5,
        getWorldPositionAt(progress = 1) {
            return {
                x: 4 * progress,
                y: 0,
                z: 6 * progress
            };
        }
    };
    const actor = createCharacterHarness(Character, map, start, {
        destination: end,
        path: [step],
        speed: 2,
        frameRate: 1
    });

    actor.move();

    assert.equal(actor.currentPathStep, step);
    assert.equal(actor.nextNode, end);
    assert.equal(actor.travelFrames, 1);
    assert.equal(actor.x, 2);
    assert.equal(actor.z, 3);
    assert.equal(actor.travelZ, 3);

    actor.move();
    actor.move();

    assert.equal(actor.node, end);
    assert.equal(actor.x, 4);
    assert.equal(actor.z, 6);
    assert.equal(actor.destination, null);
});

test("Character.cancelPathMovement clears traversal-step state", () => {
    const start = createNode(0, 0, { x: 0, y: 0, baseZ: 1 });
    const end = createNode(1, 0, { x: 1, y: 0, baseZ: 3 });
    const map = createMovementMap([start, end]);
    const actor = createCharacterHarness(Character, map, start, {
        destination: end,
        path: [end],
        nextNode: end,
        currentPathStep: { fromNode: start, toNode: end },
        travelFrames: 2,
        travelX: 0.5,
        travelY: 0,
        travelZ: 1
    });

    actor.cancelPathMovement();

    assert.equal(actor.destination, null);
    assert.equal(Array.isArray(actor.path), true);
    assert.equal(actor.path.length, 0);
    assert.equal(actor.nextNode, null);
    assert.equal(actor.currentPathStep, null);
    assert.equal(actor.travelFrames, 0);
    assert.equal(actor.travelX, 0);
    assert.equal(actor.travelY, 0);
    assert.equal(actor.travelZ, 0);
});

test("Blodia.move uses traversal-step interpolation like Character.move", () => {
    const start = createNode(0, 0, { x: 0, y: 0, baseZ: 0 });
    const end = createNode(1, 0, { x: 2, y: 0, baseZ: 6 });
    start.neighbors[7] = end;
    const map = createMovementMap([start, end]);
    const step = {
        fromNode: start,
        toNode: end,
        type: "stairs",
        directionIndex: 7,
        getWorldPositionAt(progress = 1) {
            return {
                x: 2 * progress,
                y: 0,
                z: 6 * progress
            };
        }
    };
    const blodia = createCharacterHarness(Blodia, map, start, {
        destination: end,
        path: [step],
        speed: 100,
        onScreen: false
    });

    blodia.move();

    assert.equal(blodia.currentPathStep, step);
    assert.equal(blodia.nextNode, end);
    assert.equal(blodia.frameRate, 100);
    assert.equal(blodia.travelFrames, 1);
    assert.equal(blodia.x, 1);
    assert.equal(blodia.z, 3);

    blodia.move();
    blodia.move();

    assert.equal(blodia.node, end);
    assert.equal(blodia.x, 2);
    assert.equal(blodia.z, 6);
    assert.equal(blodia.destination, null);
});

test("GameMap traversal helpers sample positions and preserve edge metadata", () => {
    const map = Object.create(GameMap.prototype);
    map.shortestDeltaX = (fromX, toX) => toX - fromX;
    map.shortestDeltaY = (fromY, toY) => toY - fromY;

    const fromNode = createNode(0, 0, { x: 0, y: 0, baseZ: 2 });
    const toNode = createNode(1, 0, { x: 4, y: 2, baseZ: 6 });
    const blockers = [{ type: "gate" }];
    const edge = map.createTraversalEdge(fromNode, toNode, {
        type: "stairs",
        directionIndex: 9,
        penalty: 2,
        blockers,
        metadata: { kind: "stairs" }
    });
    const step = map.createPathStep(edge);
    const sample = step.getWorldPositionAt(0.25);

    assert.equal(edge.id, "0,0,0->1,0,0:9");
    assert.equal(step.type, "stairs");
    assert.equal(step.metadata.kind, "stairs");
    assert.notEqual(step.blockers, blockers);
    assert.equal(step.blockers.length, 1);
    assert.equal(step.blockers[0].type, "gate");
    assert.equal(sample.x, 1);
    assert.equal(sample.y, 0.5);
    assert.equal(sample.z, 3);
});

test("GameMap.finalizeTraversalPath converts node paths into steps and keeps blockers", () => {
    const map = Object.create(GameMap.prototype);
    map.shortestDeltaX = (fromX, toX) => toX - fromX;
    map.shortestDeltaY = (fromY, toY) => toY - fromY;

    const start = createNode(0, 0, { x: 0, y: 0, baseZ: 0 });
    const middle = createNode(1, 0, { x: 2, y: 0, baseZ: 2 });
    const end = createNode(2, 0, { x: 4, y: 0, baseZ: 4 });
    start.neighbors[3] = middle;
    middle.neighbors[3] = end;

    const rawPath = [middle, end];
    rawPath.blockers = [{ type: "door" }];

    const finalized = map.finalizeTraversalPath(start, rawPath, { returnPathSteps: true });

    assert.equal(finalized.length, 2);
    assert.equal(finalized[0].fromNode, start);
    assert.equal(finalized[0].toNode, middle);
    assert.equal(finalized[1].fromNode, middle);
    assert.equal(finalized[1].toNode, end);
    assert.equal(finalized.blockers.length, 1);
    assert.equal(finalized.blockers[0].type, "door");
    assert.equal(finalized[1].getWorldPositionAt(0.5).z, 3);
});

test("GameMap.getOutgoingEdges keeps portal edges and optionally includes blocked planar edges", () => {
    const map = Object.create(GameMap.prototype);
    const planarNode = createNode(0, 0, { x: 0, y: 0, baseZ: 0 });
    const neighborNode = createNode(1, 0, { x: 1, y: 0, baseZ: 0 });
    const portalNode = createNode(0, 1, { x: 0, y: 1, baseZ: 5 });
    planarNode.neighbors[1] = neighborNode;
    planarNode.portalEdges = [{
        fromNode: planarNode,
        toNode: portalNode,
        type: "stairs",
        directionIndex: 11,
        penalty: 4,
        metadata: { portal: true }
    }];
    map.getTraversalInfo = (node, directionIndex) => ({
        allowed: false,
        penalty: directionIndex,
        blockers: [{ node, directionIndex }]
    });

    const allowedOnly = map.getOutgoingEdges(planarNode);
    const withBlocked = map.getOutgoingEdges(planarNode, { includeBlocked: true });

    assert.equal(allowedOnly.length, 1);
    assert.equal(allowedOnly[0].type, "stairs");
    assert.equal(withBlocked.length, 2);
    assert.equal(withBlocked[0].type, "planar");
    assert.equal(withBlocked[0].allowed, false);
    assert.equal(withBlocked[1].type, "stairs");
    assert.equal(withBlocked[1].metadata.portal, true);
});

test("GameMap.getOutgoingEdges includes object-provided portal edges", () => {
    const map = Object.create(GameMap.prototype);
    const start = createNode(0, 0, { x: 0, y: 0, baseZ: 0 });
    const upper = createNode(0, 1, { x: 0, y: 1, baseZ: 4 });
    start.objects.push({
        gone: false,
        getTraversalPortalEdges(node) {
            if (node !== start) return [];
            return [{
                fromNode: start,
                toNode: upper,
                type: "stairs",
                penalty: 3,
                movementCost: 1.5,
                metadata: { source: "object" }
            }];
        }
    });

    const edges = map.getOutgoingEdges(start);

    assert.equal(edges.length, 1);
    assert.equal(edges[0].type, "stairs");
    assert.equal(edges[0].toNode, upper);
    assert.equal(edges[0].metadata.source, "object");
});

test("GameMap.findPathAStar preserves portal edge steps when returnPathSteps is enabled", () => {
    const map = Object.create(GameMap.prototype);
    map.width = 3;
    map.height = 1;
    map.shortestDeltaX = (fromX, toX) => toX - fromX;
    map.shortestDeltaY = (fromY, toY) => toY - fromY;

    const start = createNode(0, 0, { x: 0, y: 0, baseZ: 0 });
    const goal = createNode(2, 0, { x: 2, y: 0, baseZ: 6 });
    start.objects.push({
        gone: false,
        getTraversalPortalEdges(node) {
            if (node !== start) return [];
            return [{
                fromNode: start,
                toNode: goal,
                type: "stairs",
                movementCost: 1,
                zProfile: "linear",
                metadata: { source: "object-portal" }
            }];
        }
    });

    const path = map.findPathAStar(start, goal, { returnPathSteps: true });

    assert.equal(Array.isArray(path), true);
    assert.equal(path.length, 1);
    assert.equal(path[0].type, "stairs");
    assert.equal(path[0].fromNode, start);
    assert.equal(path[0].toNode, goal);
    assert.equal(path[0].metadata.source, "object-portal");
    assert.equal(path[0].getWorldPositionAt(0.5).z, 3);
});

test("GameMap.findPathAStar routes from a ground source node onto a floor transition and across stitched floor neighbors", () => {
    const map = Object.create(GameMap.prototype);
    map.width = 4;
    map.height = 1;
    map.wrapX = false;
    map.wrapY = false;
    map.shortestDeltaX = (fromX, toX) => toX - fromX;
    map.shortestDeltaY = (fromY, toY) => toY - fromY;
    map.getTraversalInfo = (node, directionIndex) => ({
        allowed: !!(node && Array.isArray(node.neighbors) && node.neighbors[directionIndex]),
        neighborNode: node && Array.isArray(node.neighbors) ? node.neighbors[directionIndex] : null,
        penalty: 0,
        blockers: []
    });
    map.resetFloorRuntimeState();

    const groundSource = createNode(0, 0, {
        x: 0,
        y: 0,
        baseZ: 0,
        neighborOffsets: [null, null, null, { x: 1, y: 0 }, null, null, null, null, null, null, null, null]
    });
    const upperNeighborSource = createNode(1, 0, {
        x: 1,
        y: 0,
        baseZ: 0,
        neighborOffsets: [null, null, null, null, null, null, null, null, null, null, null, { x: -1, y: 0 }]
    });

    const groundFragment = map.registerFloorFragment({
        fragmentId: "house_ground",
        surfaceId: "house_ground_surface",
        ownerSectionKey: "0,0",
        level: 0,
        nodeBaseZ: 0
    });
    const upperFragment = map.registerFloorFragment({
        fragmentId: "house_upper",
        surfaceId: "house_upper_surface",
        ownerSectionKey: "0,0",
        level: 1,
        nodeBaseZ: 3
    });

    map.createFloorNodeFromSource(groundSource, groundFragment, {
        baseZ: 0,
        traversalLayer: 0
    });
    const upperStart = map.createFloorNodeFromSource(groundSource, upperFragment, {
        baseZ: 3,
        traversalLayer: 1
    });
    const upperEnd = map.createFloorNodeFromSource(upperNeighborSource, upperFragment, {
        baseZ: 3,
        traversalLayer: 1
    });

    map.registerFloorTransition({
        id: "house_stairs",
        type: "stairs",
        from: { x: 0, y: 0, floorId: "house_ground" },
        to: { x: 0, y: 0, floorId: "house_upper" },
        bidirectional: true,
        zProfile: "linear"
    });

    map.connectFloorNodeNeighbors();
    map.connectFloorTransitions();

    const path = map.findPathAStar(groundSource, upperEnd, { returnPathSteps: true });

    assert.equal(Array.isArray(path), true);
    assert.equal(path.length, 2);
    assert.equal(path[0].type, "stairs");
    assert.equal(path[0].fromNode, groundSource);
    assert.equal(path[0].toNode, upperStart);
    assert.equal(path[1].type, "planar");
    assert.equal(path[1].fromNode, upperStart);
    assert.equal(path[1].toNode, upperEnd);
    assert.equal(path[0].getWorldPositionAt(0.5).z, 1.5);
});

test("GameMap.getNode resolves materialized floor nodes for nonzero traversal layers", () => {
    const map = Object.create(GameMap.prototype);
    map.width = 1;
    map.height = 1;
    map.wrapX = false;
    map.wrapY = false;
    map.nodes = [[createNode(0, 0, { x: 0, y: 0, traversalLayer: 0 })]];
    map.resetFloorRuntimeState();

    const upperFragment = map.registerFloorFragment({
        fragmentId: "upper",
        surfaceId: "upper_surface",
        ownerSectionKey: "0,0",
        level: 1,
        nodeBaseZ: 3
    });
    const upperNode = map.createFloorNodeFromSource(map.nodes[0][0], upperFragment, {
        baseZ: 3,
        traversalLayer: 1
    });

    assert.equal(map.getNode(0, 0, 0), map.nodes[0][0]);
    assert.equal(map.getNode(0, 0, 1), upperNode);
});

test("GameMap.getNode skips full floor scans for missing nonzero layer nodes", () => {
    const map = Object.create(GameMap.prototype);
    map.width = 1;
    map.height = 1;
    map.wrapX = false;
    map.wrapY = false;
    map.nodes = [[createNode(0, 0, { x: 0, y: 0, traversalLayer: 0 })]];
    map.resetFloorRuntimeState();

    const upperFragment = map.registerFloorFragment({
        fragmentId: "upper",
        surfaceId: "upper_surface",
        ownerSectionKey: "0,0",
        level: 1,
        nodeBaseZ: 3
    });
    const upperNode = map.createFloorNodeFromSource(map.nodes[0][0], upperFragment, {
        baseZ: 3,
        traversalLayer: 1
    });
    map.floorNodeLayerIndex.delete(map.getFloorLayerNodeKey(upperNode));

    assert.equal(map.getFloorNodeAtLayer(0, 0, 1), upperNode);
    assert.equal(map.getNode(0, 0, 1), null);
});

test("GameMap.findPathAStar handles improved paths after stale queue entries", () => {
    const map = Object.create(GameMap.prototype);
    map.width = 4;
    map.height = 1;
    map.shortestDeltaX = () => 0;
    map.shortestDeltaY = () => 0;

    const start = createNode(0, 0, { x: 0, y: 0 });
    const a = createNode(1, 0, { x: 0, y: 0 });
    const b = createNode(2, 0, { x: 0, y: 0 });
    const goal = createNode(3, 0, { x: 0, y: 0 });

    map.getOutgoingEdges = (node) => {
        if (node === start) {
            return [
                map.createTraversalEdge(start, a, { penalty: 10 }),
                map.createTraversalEdge(start, b, { penalty: 1 })
            ];
        }
        if (node === b) {
            return [
                map.createTraversalEdge(b, a, { penalty: 1 }),
                map.createTraversalEdge(b, goal, { penalty: 100 })
            ];
        }
        if (node === a) {
            return [map.createTraversalEdge(a, goal, { penalty: 1 })];
        }
        return [];
    };

    const path = map.findPathAStar(start, goal);

    assert.equal(Array.isArray(path), true);
    assert.equal(path.length, 3);
    assert.equal(path[0], b);
    assert.equal(path[1], a);
    assert.equal(path[2], goal);
});

test("GameMap.findPathAStar skips blocker collection when collectBlockers is false", () => {
    const map = Object.create(GameMap.prototype);
    map.width = 2;
    map.height = 1;
    map.shortestDeltaX = (fromX, toX) => toX - fromX;
    map.shortestDeltaY = (fromY, toY) => toY - fromY;

    const start = createNode(0, 0, { x: 0, y: 0 });
    const goal = createNode(1, 0, { x: 1, y: 0 });
    start.neighbors[3] = goal;

    map.getTraversalInfo = () => ({
        allowed: true,
        neighborNode: goal,
        penalty: 0,
        blockers: [{ type: "door" }]
    });

    const path = map.findPathAStar(start, goal, {
        returnPathSteps: true,
        collectBlockers: false
    });

    assert.equal(Array.isArray(path), true);
    assert.equal(path.length, 1);
    assert.equal(Array.isArray(path.blockers), false);
});
