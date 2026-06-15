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

    class Graphics {
        constructor() {
            this.parent = null;
            this.visible = true;
            this.x = 0;
            this.y = 0;
            this.name = "";
            this.interactive = false;
        }

        clear() {}
        beginFill() {}
        drawRoundedRect() {}
        endFill() {}
    }

    return {
        Texture,
        Sprite,
        Rectangle,
        Graphics
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
    context.window = context;
    context.globalThis = context;
    vm.createContext(context);

    const files = [
        path.join(__dirname, "../public/assets/javascript/gameobjects/hitbox.js"),
        path.join(__dirname, "../public/assets/javascript/shared/FloorSupport.js"),
        path.join(__dirname, "../public/assets/javascript/shared/StairTraversal.js"),
        path.join(__dirname, "../public/assets/javascript/Map.js"),
        path.join(__dirname, "../public/assets/javascript/gameobjects/Character.js"),
        path.join(__dirname, "../public/assets/javascript/gameobjects/Animal.js")
    ];

    for (const filePath of files) {
        const source = fs.readFileSync(filePath, "utf8");
        vm.runInContext(source, context, { filename: filePath });
    }

    vm.runInContext("globalThis.__testExports = { GameMap, Character, Animal, Blodia, StairTraversal };", context);
    return context.__testExports;
}

const { GameMap, Character, Animal, Blodia, StairTraversal } = loadTraversalClasses();

function assertApproxEqual(actual, expected, epsilon = 0.000001) {
    assert.ok(Math.abs(Number(actual) - Number(expected)) <= epsilon, `${actual} should be within ${epsilon} of ${expected}`);
}

test("GameMap applies smaller overlapping floor support after walking from ground into a building", () => {
    const map = Object.create(GameMap.prototype);
    map.width = 1;
    map.height = 1;
    map.wrapX = false;
    map.wrapY = false;
    map.shortestDeltaX = (fromX, toX) => toX - fromX;
    map.shortestDeltaY = (fromY, toY) => toY - fromY;
    map.nodes = [[createNode(0, 0, { x: 0, y: 0 })]];
    map.worldToNode = () => map.nodes[0][0];
    map.resetFloorRuntimeState();

    const ground = map.registerFloorFragment({
        fragmentId: "section:-4,0:ground",
        surfaceId: "overworld_ground_surface",
        ownerSectionKey: "-4,0",
        level: 0,
        nodeBaseZ: 0,
        outerPolygon: [
            { x: -50, y: -50 },
            { x: 50, y: -50 },
            { x: 50, y: 50 },
            { x: -50, y: 50 }
        ],
        holes: []
    });
    const building = map.registerFloorFragment({
        fragmentId: "building:placed-5:floor:floor-fragment-16",
        surfaceId: "building:placed-5:surface:floor-fragment-16",
        ownerSectionKey: "building:placed-5",
        level: 0,
        nodeBaseZ: 0,
        outerPolygon: [
            { x: -2, y: -2 },
            { x: 2, y: -2 },
            { x: 2, y: 2 },
            { x: -2, y: 2 }
        ],
        holes: [],
        renderedByBuildingCutaway: true
    });
    const actor = {
        type: "wizard",
        x: 0,
        y: 0,
        z: 0,
        currentLayer: 0,
        traversalLayer: 0,
        currentLayerBaseZ: 0,
        fragmentId: ground.fragmentId,
        surfaceId: ground.surfaceId,
        currentMovementSupport: {
            type: "floor",
            layer: 0,
            baseZ: 0,
            fragmentId: ground.fragmentId,
            surfaceId: ground.surfaceId
        },
        updateHitboxes() {}
    };
    const options = {
        _movementSupportCache: {
            actor,
            lastCheckedOccupancy: {
                x: 0,
                y: 0,
                result: {
                    handled: false,
                    allowed: false,
                    currentSupport: {
                        type: "floor",
                        layer: 0,
                        baseZ: 0,
                        fragment: ground,
                        fragmentId: ground.fragmentId,
                        surfaceId: ground.surfaceId,
                        node: map.nodes[0][0]
                    }
                }
            }
        }
    };

    const directSupport = map.getFloorSupportAtWorldPosition(0, 0, 0);
    assert.equal(directSupport.fragmentId, building.fragmentId);

    const applied = map.applyActorResolvedMovementSupport(actor, 0, 0, options);
    assert.equal(applied.fragmentId, building.fragmentId);
    assert.equal(actor.fragmentId, building.fragmentId);
    assert.equal(actor.currentMovementSupport.fragmentId, building.fragmentId);
});

test("GameMap floor support exposes owner world unit and notifies scope hook", () => {
    const map = Object.create(GameMap.prototype);
    map.width = 1;
    map.height = 1;
    map.wrapX = false;
    map.wrapY = false;
    map.shortestDeltaX = (fromX, toX) => toX - fromX;
    map.shortestDeltaY = (fromY, toY) => toY - fromY;
    map.nodes = [[createNode(0, 0, { x: 0, y: 0 })]];
    map.worldToNode = () => map.nodes[0][0];
    map.resetFloorRuntimeState();

    const building = map.registerFloorFragment({
        fragmentId: "building:placed-5:floor:floor-fragment-16",
        surfaceId: "building:placed-5:surface:floor-fragment-16",
        ownerSectionKey: "building:placed-5",
        level: 0,
        nodeBaseZ: 0,
        outerPolygon: [
            { x: -2, y: -2 },
            { x: 2, y: -2 },
            { x: 2, y: 2 },
            { x: -2, y: 2 }
        ],
        holes: []
    });
    const actor = {
        x: 0,
        y: 0,
        z: 0,
        currentLayer: 0,
        traversalLayer: 0,
        currentLayerBaseZ: 0
    };
    let scopeUpdate = null;
    map.updatePrototypeWorldScopeForMovementSupport = (updatedActor, support, options) => {
        scopeUpdate = { actor: updatedActor, support, options };
        return { type: "building", id: support.ownerId };
    };

    const support = map.getFloorSupportAtWorldPosition(0, 0, 0);
    const applied = map.setActorCurrentMovementSupport(actor, support);

    assert.equal(building.ownerType, "building");
    assert.equal(building.ownerId, "building:placed-5");
    assert.equal(support.ownerType, "building");
    assert.equal(support.ownerId, "building:placed-5");
    assert.equal(applied.ownerType, "building");
    assert.equal(applied.ownerId, "building:placed-5");
    assert.equal(actor.currentMovementSupport.ownerType, "building");
    assert.equal(actor.currentMovementSupport.ownerId, "building:placed-5");
    assert.equal(scopeUpdate.actor, actor);
    assert.equal(scopeUpdate.support.ownerId, "building:placed-5");
});

function createSupportValidationMap() {
    const map = Object.create(GameMap.prototype);
    map.width = 1;
    map.height = 1;
    map.wrapX = false;
    map.wrapY = false;
    map.shortestDeltaX = (fromX, toX) => toX - fromX;
    map.shortestDeltaY = (fromY, toY) => toY - fromY;
    const node = createNode(0, 0, { x: 0, y: 0 });
    node._prototypeSectionKey = "0,0";
    map.nodes = [[node]];
    map.worldToNode = () => map.nodes[0][0];
    map.resetFloorRuntimeState();
    return map;
}

test("GameMap support validation keeps a still-supported floor fragment", () => {
    const map = createSupportValidationMap();
    const floor = map.registerFloorFragment({
        fragmentId: "building:placed-5:floor:upper",
        surfaceId: "building:placed-5:surface:upper",
        ownerSectionKey: "building:placed-5",
        level: 1,
        nodeBaseZ: 3,
        outerPolygon: [
            { x: -1, y: -1 },
            { x: 1, y: -1 },
            { x: 1, y: 1 },
            { x: -1, y: 1 }
        ],
        holes: []
    });
    const actor = {
        x: 0,
        y: 0,
        z: 3,
        currentLayer: 1,
        traversalLayer: 1,
        currentLayerBaseZ: 3,
        currentMovementSupport: {
            type: "floor",
            layer: 1,
            baseZ: 3,
            fragmentId: floor.fragmentId,
            surfaceId: floor.surfaceId,
            ownerType: floor.ownerType,
            ownerId: floor.ownerId,
            sectionKey: floor.ownerSectionKey
        }
    };

    const result = map.validateActorMovementSupport(actor);

    assert.equal(result.changed, false);
    assert.equal(result.ownerChanged, false);
    assert.equal(result.lost, false);
    assert.equal(actor.currentMovementSupport.fragmentId, floor.fragmentId);
});

test("GameMap support validation falls to highest lower support and reports owner change", () => {
    const map = createSupportValidationMap();
    const lower = map.registerFloorFragment({
        fragmentId: "section:0,0:ground",
        surfaceId: "section:0,0:ground",
        ownerSectionKey: "0,0",
        level: 0,
        nodeBaseZ: 0,
        outerPolygon: [
            { x: -3, y: -3 },
            { x: 3, y: -3 },
            { x: 3, y: 3 },
            { x: -3, y: 3 }
        ],
        holes: []
    });
    const upper = map.registerFloorFragment({
        fragmentId: "building:placed-5:floor:upper",
        surfaceId: "building:placed-5:surface:upper",
        ownerSectionKey: "building:placed-5",
        level: 1,
        nodeBaseZ: 3,
        outerPolygon: [
            { x: -1, y: -1 },
            { x: 1, y: -1 },
            { x: 1, y: 1 },
            { x: -1, y: 1 }
        ],
        holes: []
    });
    const actor = {
        x: 2,
        y: 0,
        z: 3,
        currentLayer: 1,
        traversalLayer: 1,
        currentLayerBaseZ: 3,
        currentMovementSupport: {
            type: "floor",
            layer: 1,
            baseZ: 3,
            fragmentId: upper.fragmentId,
            surfaceId: upper.surfaceId,
            ownerType: upper.ownerType,
            ownerId: upper.ownerId,
            sectionKey: upper.ownerSectionKey
        }
    };
    let scopeSupport = null;
    map.updatePrototypeWorldScopeForMovementSupport = (_actor, support) => {
        scopeSupport = support;
        return { type: "sectionWorld" };
    };

    const result = map.validateActorMovementSupport(actor);

    assert.equal(result.changed, true);
    assert.equal(result.ownerChanged, true);
    assert.equal(result.lost, false);
    assert.equal(result.nextSupport.fragmentId, lower.fragmentId);
    assert.equal(result.nextSupport.ownerType, "section");
    assert.equal(result.nextSupport.ownerId, "0,0");
    assert.equal(actor.currentMovementSupport.fragmentId, lower.fragmentId);
    assert.equal(actor.currentLayer, 0);
    assert.equal(actor.z, 0);
    assert.equal(scopeSupport.ownerType, "section");
});

test("GameMap support validation reports void loss when no lower support exists", () => {
    const map = createSupportValidationMap();
    const upper = map.registerFloorFragment({
        fragmentId: "building:placed-5:floor:upper",
        surfaceId: "building:placed-5:surface:upper",
        ownerSectionKey: "building:placed-5",
        level: 1,
        nodeBaseZ: 3,
        outerPolygon: [
            { x: -1, y: -1 },
            { x: 1, y: -1 },
            { x: 1, y: 1 },
            { x: -1, y: 1 }
        ],
        holes: []
    });
    const actor = {
        x: 2,
        y: 0,
        z: 3,
        currentLayer: 1,
        traversalLayer: 1,
        currentLayerBaseZ: 3,
        gone: false,
        currentMovementSupport: {
            type: "floor",
            layer: 1,
            baseZ: 3,
            fragmentId: upper.fragmentId,
            surfaceId: upper.surfaceId,
            ownerType: upper.ownerType,
            ownerId: upper.ownerId,
            sectionKey: upper.ownerSectionKey
        }
    };

    const result = map.validateActorMovementSupport(actor, {
        allowOutdoorGround: false,
        markLost: true
    });

    assert.equal(result.changed, false);
    assert.equal(result.ownerChanged, false);
    assert.equal(result.lost, true);
    assert.equal(result.nextSupport, null);
    assert.equal(actor.gone, true);
    assert.equal(actor.lostToVoid, true);
});

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

test("Animal.attack allows blocked player destination for large monster pursuit", () => {
    const animal = Object.create(Animal.prototype);
    const startNode = createNode(0, 0, { x: 0, y: 0 });
    const targetNode = createNode(1, 0, { x: 1, y: 0 });
    let routeOptions = null;
    let appliedDestination = null;

    Object.assign(animal, {
        map: {},
        node: startNode,
        x: 0,
        y: 0,
        z: 0,
        size: 4,
        speed: 1,
        runSpeed: 2,
        walkSpeed: 1,
        lungeRadius: 0.25,
        lungeSpeed: 5,
        attackCooldown: 1,
        lastAttackTimeMs: -Infinity,
        attackState: "idle",
        attacking: false,
        spriteCols: 1,
        travelFrames: 0,
        moving: false,
        path: [],
        destination: null,
        nextNode: null,
        _closeCombatState: null,
        _aggroUntilMs: 0,
        getCombatRouteToTarget(target, options) {
            routeOptions = options;
            return { path: [targetNode], targetNode };
        },
        getPriorityBlockerFromRoute() {
            return null;
        },
        _applyPursuitPath(_path, destination) {
            appliedDestination = destination;
        },
        shouldReengageCloseCombat() {
            return false;
        },
        distanceToPoint() {
            return 5;
        },
        updateHitboxes() {}
    });

    animal.attack({ x: 1, y: 0, hp: 100 });

    assert.equal(routeOptions.allowBlockedDestination, true);
    assert.equal(appliedDestination, targetNode);
    assert.equal(animal.attackState, "approach");
});

test("Animal line of sight is blocked across traversal layers", () => {
    const animal = Object.create(Animal.prototype);
    const startNode = createNode(0, 0, { x: 0, y: 0, traversalLayer: -2 });
    Object.assign(animal, {
        node: startNode,
        x: 0,
        y: 0,
        traversalLayer: -2,
        map: {
            worldToNode() {
                return createNode(1, 0, { x: 1, y: 0, traversalLayer: 0 });
            },
            hasLineOfSight() {
                return true;
            }
        }
    });

    const hasLos = animal.hasAttackLineOfSight({ x: 1, y: 0, traversalLayer: 0 });

    assert.equal(hasLos, false);
});

test("Animal.attack clears pursuit instead of interacting across traversal layers", () => {
    const animal = Object.create(Animal.prototype);
    const startNode = createNode(0, 0, { x: 0, y: 0, traversalLayer: -2 });
    Object.assign(animal, {
        node: startNode,
        x: 0,
        y: 0,
        traversalLayer: -2,
        attackTarget: null,
        attackState: "approach",
        attacking: true,
        _closeCombatState: null,
        _aggroUntilMs: Date.now() + 1000,
        _committedToAttack: true,
        _corneredAttackPending: true,
        path: [createNode(1, 0, { x: 1, y: 0, traversalLayer: -2 })],
        destination: createNode(1, 0, { x: 1, y: 0, traversalLayer: -2 }),
        nextNode: createNode(1, 0, { x: 1, y: 0, traversalLayer: -2 }),
        travelFrames: 3,
        spriteCols: 1,
        map: {
            worldToNode() {
                return startNode;
            }
        }
    });

    animal.attack({ x: 1, y: 0, traversalLayer: 0, hp: 100 });

    assert.equal(animal.attackState, "idle");
    assert.equal(animal.attacking, false);
    assert.equal(animal.attackTarget, null);
    assert.equal(Array.isArray(animal.path), true);
    assert.equal(animal.path.length, 0);
    assert.equal(animal.destination, null);
    assert.equal(animal.nextNode, null);
    assert.equal(animal.travelFrames, 0);
    assert.equal(animal._committedToAttack, false);
    assert.equal(animal._corneredAttackPending, false);
});

test("Animal health bar projects from interpolated world z", () => {
    const start = createNode(0, 0, { x: 2, y: 3, baseZ: 6, traversalLayer: 2 });
    const map = createMovementMap([start]);
    const animal = createCharacterHarness(Animal, map, start, {
        x: 2,
        y: 3,
        z: 6,
        prevX: 2,
        prevY: 3,
        prevZ: 6,
        height: 1,
        width: 1,
        size: 1,
        maxHp: 10,
        hp: 7,
        _healthBarVisibleUntilMs: Date.now() + 10000,
        getInterpolatedPosition() {
            return { x: 2, y: 3, z: 6 };
        }
    });
    const worldToScreenCalls = [];
    const camera = {
        viewscale: 10,
        worldToScreen(x, y, z = 0) {
            worldToScreenCalls.push({ x, y, z });
            return { x: x * 10, y: (y - z) * 10 };
        }
    };
    const container = {
        children: [],
        addChild(child) {
            this.children.push(child);
            child.parent = this;
        }
    };

    animal.updateHealthBarOverlay(camera, container);

    assert.equal(worldToScreenCalls.length, 1);
    assert.deepEqual(worldToScreenCalls[0], { x: 2, y: 3, z: 6 });
    assert.equal(animal._healthBarGraphics.visible, true);
    assert.equal(container.children[0], animal._healthBarGraphics);
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

test("tread path stair records sample endpoint baseZ values", () => {
    const map = Object.create(GameMap.prototype);
    map.width = 5;
    map.height = 1;
    map.wrapX = false;
    map.wrapY = false;
    map.shortestDeltaX = (fromX, toX) => toX - fromX;
    map.shortestDeltaY = (fromY, toY) => toY - fromY;
    map.resetFloorRuntimeState();

    const lowerSource = createNode(0, 0, { x: 0, y: 0, baseZ: 1 });
    const higherSource = createNode(4, 0, { x: 4, y: 0, baseZ: 0 });
    const lowerFragment = map.registerFloorFragment({
        fragmentId: "custom_lower",
        surfaceId: "custom_lower_surface",
        ownerSectionKey: "0,0",
        level: 0,
        nodeBaseZ: 1
    });
    const higherFragment = map.registerFloorFragment({
        fragmentId: "custom_higher",
        surfaceId: "custom_higher_surface",
        ownerSectionKey: "0,0",
        level: 2,
        nodeBaseZ: 8
    });
    const lowerNode = map.createFloorNodeFromSource(lowerSource, lowerFragment, {
        baseZ: 1,
        traversalLayer: 0
    });
    const higherNode = map.createFloorNodeFromSource(higherSource, higherFragment, {
        baseZ: 8,
        traversalLayer: 2
    });

    map.registerStairRuntimeRecord({
        id: "custom_stairs",
        lowerPoint: { x: 0, y: 0 },
        higherPoint: { x: 4, y: 0 },
        lowerZ: 1,
        higherZ: 8,
        lowerLevel: 0,
        higherLevel: 2,
        lowerFragmentId: "custom_lower",
        higherFragmentId: "custom_higher",
        lowerSurfaceId: "custom_lower_surface",
        higherSurfaceId: "custom_higher_surface",
        width: 1,
        stepCount: 4,
        riserDepth: 0,
        texturePath: "/assets/images/flooring/woodfloor.png",
        treads: [
            { left: { x: 0, y: -0.5 }, right: { x: 0, y: 0.5 } },
            { left: { x: 4, y: -0.5 }, right: { x: 4, y: 0.5 } }
        ]
    });

    const stair = map.stairsById.get("custom_stairs");
    assert.ok(stair);
    assert.equal(stair.stairKind, "treadPath");
    assert.equal(stair.lowerZ, 1);
    assert.equal(stair.higherZ, 8);
    assert.equal(stair.treads.length, 2);

    const edge = {
        fromNode: lowerNode,
        toNode: higherNode,
        type: "stairs",
        metadata: { stairId: "custom_stairs" }
    };
    assert.equal(edge.type, "stairs");
    assert.equal(map.createPathStep(edge).getWorldPositionAt(0.5).z, 4.5);

    const reverseEdge = {
        fromNode: higherNode,
        toNode: lowerNode,
        type: "stairs",
        metadata: { stairId: "custom_stairs" }
    };
    assert.equal(map.createPathStep(reverseEdge).getWorldPositionAt(0.5).z, 4.5);
});

test("StairTraversal tread path preserves local coordinates on bent saved treads", () => {
    const stair = {
        id: "bent_stair",
        lowerZ: 0,
        higherZ: 4,
        stepCount: 4,
        treads: [
            {
                left: { x: 0, y: 0 },
                right: { x: 1, y: 0 }
            },
            {
                left: { x: 0, y: 1 },
                right: { x: 1, y: 1 }
            },
            {
                left: { x: 0, y: 1 },
                right: { x: 0, y: 2 }
            }
        ]
    };
    const frame = StairTraversal.createTreadPathFrame(stair);
    assert.equal(frame.sections.length, 2);

    const turnSection = frame.sections[1];
    const upDown = (turnSection.startU + turnSection.endU) * 0.5;
    const point = StairTraversal.pointFromPathLocal(frame, upDown, 0.5);
    const local = StairTraversal.localPointForPathFrame(frame, point);
    assertApproxEqual(local.upDown, upDown, 0.00001);
    assertApproxEqual(local.leftRight, 0.5, 0.00001);
    assert.equal(StairTraversal.localInsidePathFrame(frame, local, 0.1), true);
    assertApproxEqual(local.baseZ, 4 * upDown, 0.0001);

    const straightMidpoint = { x: 0.25, y: 1 };
    assert.ok(Math.hypot(point.x - straightMidpoint.x, point.y - straightMidpoint.y) > 0.1);

    const lowerBlocker = StairTraversal.pathPolygonForUpDownRange(frame, 0, 0.5);
    assert.ok(lowerBlocker.length >= 6);
    assert.deepEqual(lowerBlocker[0], StairTraversal.pointFromPathLocal(frame, 0, 0));
    assert.deepEqual(lowerBlocker[lowerBlocker.length - 1], StairTraversal.pointFromPathLocal(frame, 0, 1));

    const lowerLine = StairTraversal.endpointLineForPathFrame(frame, "lower");
    assert.equal(lowerLine.a.x, 0);
    assert.equal(lowerLine.a.y, 0);
    assert.equal(lowerLine.b.x, 1);
    assert.equal(lowerLine.b.y, 0);
    assert.equal(
        StairTraversal.endpointLineCrossed(frame, { x: 0.5, y: -0.2 }, { x: 0.5, y: 0.2 }, "lower"),
        true
    );
    assert.equal(
        StairTraversal.endpointLineCrossed(frame, { x: 0.5, y: -0.2 }, { x: 0.5, y: 0.2 }, "higher"),
        false
    );

    const beforeLowerMouth = StairTraversal.localPointForPathFrame(frame, { x: 0.5, y: -0.75 });
    assert.equal(beforeLowerMouth.leftRight >= 0 && beforeLowerMouth.leftRight <= 1, true);
    assert.equal(StairTraversal.localInsidePathFrame(frame, beforeLowerMouth, 0), false);
});

test("StairTraversal tread path keeps leftRight continuous across connected turn sections", () => {
    const stair = {
        id: "right_hinge_turn_stair",
        lowerZ: 0,
        higherZ: 4,
        stepCount: 4,
        treads: [
            {
                left: { x: 0, y: 0 },
                right: { x: 0, y: 2 }
            },
            {
                left: { x: 2, y: 2 },
                right: { x: 2, y: 0 }
            },
            {
                left: { x: 4, y: 2 },
                right: { x: 2, y: 2 },
                arcDeltaAngle: Math.PI / 2
            },
            {
                left: { x: 4, y: 4 },
                right: { x: 4, y: 2 }
            }
        ]
    };
    const frame = StairTraversal.createTreadPathFrame(stair);
    assert.equal(frame.sections.length, 3);

    const firstJoin = frame.sections[1].startU;
    const pointBeforeTurn = StairTraversal.pointFromPathLocal(frame, firstJoin - 0.000001, 0.25);
    const pointAfterTurn = StairTraversal.pointFromPathLocal(frame, firstJoin + 0.000001, 0.25);
    assert.ok(
        Math.hypot(pointBeforeTurn.x - pointAfterTurn.x, pointBeforeTurn.y - pointAfterTurn.y) < 0.01,
        "leftRight should not mirror when entering a connected turn"
    );

    const localAfterTurn = StairTraversal.localPointForPathFrame(frame, pointAfterTurn);
    assertApproxEqual(localAfterTurn.leftRight, 0.25, 0.0001);
});

test("StairTraversal uses arc metadata for parallel connected full-turn treads", () => {
    const stair = {
        id: "full_turn_stair",
        lowerZ: 0,
        higherZ: 4,
        stepCount: 8,
        treads: [
            {
                left: { x: 0, y: 0 },
                right: { x: 2, y: 0 }
            },
            {
                left: { x: 0, y: 0 },
                right: { x: 2, y: 0 },
                arcDeltaAngle: Math.PI * 2
            }
        ]
    };
    const frame = StairTraversal.createTreadPathFrame(stair);
    const lowerPoint = StairTraversal.pointFromPathLocal(frame, 0, 1);
    const higherPoint = StairTraversal.pointFromPathLocal(frame, 1, 1);
    const lowerLocal = StairTraversal.localPointForPathFrame(frame, lowerPoint, { upDownHint: 0 });
    const higherLocal = StairTraversal.localPointForPathFrame(frame, higherPoint, { upDownHint: 1 });

    assert.ok(frame.pathLength > 5, "full-turn connected tread should not collapse into a straight section");
    assertApproxEqual(lowerPoint.x, higherPoint.x, 0.000001);
    assertApproxEqual(lowerPoint.y, higherPoint.y, 0.000001);
    assertApproxEqual(lowerLocal.upDown, 0, 0.0001);
    assertApproxEqual(higherLocal.upDown, 1, 0.0001);
});

test("StairTraversal endpoint projection can be constrained to the stair mouth", () => {
    const stair = {
        id: "overlapping_spiral",
        lowerZ: 0,
        higherZ: 4,
        stepCount: 40,
        treads: [
            {
                left: { x: 0, y: 0 },
                right: { x: 2, y: 0 }
            },
            {
                left: { x: 0, y: 0 },
                right: { x: 2, y: 0 },
                arcDeltaAngle: Math.PI * 2
            },
            {
                left: { x: 0, y: 0 },
                right: { x: 0, y: 2 },
                arcDeltaAngle: Math.PI / 2
            }
        ]
    };
    const frame = StairTraversal.createTreadPathFrame(stair);
    const lowerMid = StairTraversal.pointFromPathLocal(frame, 0, 0.5);
    const nearLower = StairTraversal.pointFromPathLocal(frame, 0.01, 0.5);
    const dx = nearLower.x - lowerMid.x;
    const dy = nearLower.y - lowerMid.y;
    const length = Math.hypot(dx, dy);
    const outsideLower = {
        x: lowerMid.x - dx / length * 0.2,
        y: lowerMid.y - dy / length * 0.2
    };
    const insideLower = {
        x: lowerMid.x + dx / length * 0.2,
        y: lowerMid.y + dy / length * 0.2
    };

    const outsideLocal = StairTraversal.localPointForPathFrame(frame, outsideLower, { upDownHint: 0, maxUpDown: 0.05 });
    const insideLocal = StairTraversal.localPointForPathFrame(frame, insideLower, { upDownHint: 0, maxUpDown: 0.05 });

    assert.ok(outsideLocal.upDown < 0);
    assert.ok(insideLocal.upDown > outsideLocal.upDown);
    assert.ok(insideLocal.upDown < 0.05);
});

test("GameMap trusts stored stair-local support on overlapping spiral turns", () => {
    const map = Object.create(GameMap.prototype);
    map.stairsById = new Map();
    const stair = {
        id: "overlapping_runtime_spiral",
        stairKind: "treadPath",
        lowerZ: 0,
        higherZ: 4,
        lowerLevel: 0,
        higherLevel: 1,
        stepCount: 40,
        treads: [
            {
                left: { x: 0, y: 0 },
                right: { x: 2, y: 0 }
            },
            {
                left: { x: 0, y: 0 },
                right: { x: 2, y: 0 },
                arcDeltaAngle: Math.PI * 2
            }
        ]
    };
    stair.traversalFrame = StairTraversal.createTreadPathFrame(stair);
    map.stairsById.set(stair.id, stair);
    map.requireStairTraversal = () => StairTraversal;
    map.getStairTraversalFrame = () => stair.traversalFrame;

    const support = map.getActorStairSupportFromState({
        currentMovementSupport: {
            type: "stair",
            stairId: stair.id,
            upDown: 0.99,
            leftRight: 1
        }
    });

    assertApproxEqual(support.upDown, 0.99, 0.000001);
    assertApproxEqual(support.leftRight, 1, 0.000001);
});

test("Character applies pending stair exit support without recomputing stale stair state", () => {
    const actor = Object.create(Character.prototype);
    let occupancyCalls = 0;
    let appliedSupport = null;
    Object.assign(actor, {
        map: {
            resolveActorStairMovementOccupancy() {
                occupancyCalls++;
                return {
                    handled: true,
                    allowed: true,
                    support: {
                        type: "stair",
                        stairId: "wrong_recomputed_stair",
                        point: { x: 9, y: 9 }
                    }
                };
            },
            applyActorResolvedMovementSupport(target) {
                appliedSupport = target._pendingVectorMovementSupport || null;
                target._pendingVectorMovementSupport = null;
                target._stairSupport = null;
                return appliedSupport;
            }
        },
        x: 0,
        y: 0,
        z: 0,
        prevX: 0,
        prevY: 0,
        movementVector: { x: 1, y: 0 },
        currentMovementSupport: { type: "stair", stairId: "old_stair", upDown: 0.99, leftRight: 0.5 },
        _stairSupport: { stairId: "old_stair", upDown: 0.99, leftRight: 0.5 },
        _pendingVectorMovementSupport: {
            type: "floor",
            floorId: "upper_floor",
            layer: 1,
            baseZ: 4,
            point: { x: 1, y: 0 }
        },
        updateHitboxes() {},
        onVectorMovementApplied() {},
        _setVectorMovementPositionRaw(x, y) {
            this.x = x;
            this.y = y;
            return { wrappedX: x, wrappedY: y };
        }
    });

    assert.equal(actor._applyVectorMovementPosition(1, 0, {}), true);
    assert.equal(occupancyCalls, 0);
    assert.equal(appliedSupport.type, "floor");
    assert.equal(actor.x, 1);
    assert.equal(actor.y, 0);
});

test("tread path stair occupancy uses endpoint crossing and rendered tread-height support", () => {
    const map = Object.create(GameMap.prototype);
    map.width = 6;
    map.height = 3;
    map.wrapX = false;
    map.wrapY = false;
    map.shortestDeltaX = (fromX, toX) => toX - fromX;
    map.shortestDeltaY = (fromY, toY) => toY - fromY;
    map.nodes = [[
        createNode(0, 0, { x: -0.5, y: 0 }),
        createNode(1, 0, { x: 0.5, y: 0 }),
        createNode(2, 0, { x: 1.5, y: 0 }),
        createNode(3, 0, { x: 2.5, y: 0 }),
        createNode(4, 0, { x: 3.5, y: 0 }),
        createNode(5, 0, { x: 4.5, y: 0 })
    ]];
    map.worldToNode = (x) => {
        const index = Math.max(0, Math.min(5, Math.round(Number(x) + 0.5)));
        return map.nodes[0][index];
    };
    map.resetFloorRuntimeState();

    const lowerFragment = map.registerFloorFragment({
        fragmentId: "lower",
        surfaceId: "lower_surface",
        ownerSectionKey: "0,0",
        level: 0,
        nodeBaseZ: 0,
        outerPolygon: [
            { x: -1, y: -1 },
            { x: 4, y: -1 },
            { x: 4, y: 1 },
            { x: -1, y: 1 }
        ],
        holes: []
    });
    const higherFragment = map.registerFloorFragment({
        fragmentId: "higher",
        surfaceId: "higher_surface",
        ownerSectionKey: "0,0",
        level: 1,
        nodeBaseZ: 3,
        outerPolygon: [
            { x: 3, y: -1 },
            { x: 5, y: -1 },
            { x: 5, y: 1 },
            { x: 3, y: 1 }
        ],
        holes: []
    });
    const lowerNode = map.createFloorNodeFromSource(map.nodes[0][0], lowerFragment, { baseZ: 0, traversalLayer: 0 });
    const higherNode = map.createFloorNodeFromSource(map.nodes[0][4], higherFragment, { baseZ: 3, traversalLayer: 1 });
    map.registerStairRuntimeRecord({
        id: "walkable_stairs",
        lowerPoint: { x: 0, y: 0 },
        higherPoint: { x: 3, y: 0 },
        lowerZ: 0,
        higherZ: 3,
        lowerLevel: 0,
        higherLevel: 1,
        lowerSurfaceId: "lower_surface",
        higherSurfaceId: "higher_surface",
        width: 1,
        stepCount: 3,
        riserDepth: 0,
        treads: [
            { left: { x: 0, y: -0.5 }, right: { x: 0, y: 0.5 } },
            { left: { x: 3, y: -0.5 }, right: { x: 3, y: 0.5 } }
        ]
    });

    const actor = {
        x: -0.5,
        y: 0,
        z: 0,
        currentLayer: 0,
        traversalLayer: 0,
        currentLayerBaseZ: 0,
        node: lowerNode
    };

    const firstEntry = map.resolveActorStairMovementOccupancy(0.5, 0, actor);
    assert.equal(firstEntry.allowed, true);
    assertApproxEqual(firstEntry.support.upDown, 0, 0.00001);
    assert.equal(firstEntry.support.leftRight, 0.5);
    const lowerFirstStepEntry = map.resolveActorStairMovementOccupancy(0.95, 0, actor);
    assert.equal(lowerFirstStepEntry.handled, true);
    assert.equal(lowerFirstStepEntry.allowed, true);
    assertApproxEqual(lowerFirstStepEntry.support.upDown, 0, 0.00001);
    assert.equal(map.resolveActorStairMovementOccupancy(1.5, 0, actor).allowed, true);

    const mouthActor = {
        x: 0,
        y: 0,
        z: 0,
        currentLayer: 0,
        traversalLayer: 0,
        currentLayerBaseZ: 0,
        node: lowerNode
    };
    const mouthEntry = map.resolveActorStairMovementOccupancy(0.25, 0, mouthActor);
    assert.equal(mouthEntry.handled, true);
    assert.equal(mouthEntry.allowed, true);
    assertApproxEqual(mouthEntry.support.upDown, 0, 0.00001);

    const preMouthActor = {
        x: -1,
        y: 0,
        z: 0,
        currentLayer: 0,
        traversalLayer: 0,
        currentLayerBaseZ: 0,
        node: lowerNode
    };
    const preMouthEntry = map.resolveActorStairMovementOccupancy(-0.5, 0, preMouthActor);
    assert.equal(preMouthEntry.handled, false);

    actor._pendingVectorMovementSupport = firstEntry.support;
    map.applyActorResolvedMovementSupport(actor, 0.5, 0);
    actor.x = 0.5;
    actor.y = 0;
    assertApproxEqual(actor.z, 0, 0.0001);
    assert.equal(actor.currentLayer, 0);
    const firstStepTargetX = 0.5 + Math.hypot(3, 3) / 3;
    assert.equal(map.resolveActorStairMovementOccupancy(firstStepTargetX, 0, actor).allowed, true);

    const firstStepSupport = map.resolveActorStairMovementOccupancy(firstStepTargetX, 0, actor).support;
    actor._pendingVectorMovementSupport = firstStepSupport;
    map.applyActorResolvedMovementSupport(actor, firstStepTargetX, 0);
    actor.x = firstStepSupport.point.x;
    actor.y = 0;
    assertApproxEqual(actor.z, 1, 0.0001);
    assertApproxEqual(actor.x, 1, 0.0001);
    assert.equal(actor.currentLayer, 0);
    const stairSideSlide = map.resolveActorStairMovementOccupancy(actor.x, 0.75, actor);
    assert.equal(stairSideSlide.allowed, true);
    assert.equal(stairSideSlide.support.leftRight, 1);
    assert.equal(stairSideSlide.support.point.y, 0.5);
    const stairCharacter = Object.create(Character.prototype);
    Object.assign(stairCharacter, {
        type: "wizard",
        map,
        x: actor.x,
        y: 0,
        z: actor.z,
        prevX: actor.x,
        prevY: 0,
        currentLayer: 0,
        traversalLayer: 0,
        currentLayerBaseZ: 0,
        groundRadius: 0,
        movementVector: { x: 0, y: 1 },
        currentMovementSupport: actor.currentMovementSupport ? { ...actor.currentMovementSupport } : null,
        _stairSupport: { ...actor._stairSupport },
        updateHitboxes() {}
    });
    assert.equal(stairCharacter._applyVectorMovementPosition(actor.x, 0.75, {}), true);
    assertApproxEqual(stairCharacter.x, 1, 0.0001);
    assertApproxEqual(stairCharacter.y, 0.5, 0.0001);
    assert.equal(stairCharacter._stairSupport.leftRight, 1);
    const earlyStairCharacter = Object.create(Character.prototype);
    Object.assign(earlyStairCharacter, {
        type: "wizard",
        map,
        x: actor.x,
        y: 0,
        z: actor.z,
        prevX: actor.x,
        prevY: 0,
        currentLayer: 0,
        traversalLayer: 0,
        currentLayerBaseZ: 0,
        groundRadius: 0,
        speed: 1,
        frameRate: 1,
        moving: false,
        movementVector: { x: 0, y: 0.75 },
        currentMovementSupport: actor.currentMovementSupport ? { ...actor.currentMovementSupport } : null,
        _stairSupport: { ...actor._stairSupport },
        isFrozen: () => false,
        getVectorMovementMaxSpeed: () => 1,
        prepareVectorMovementContext() {
            throw new Error("stair movement should resolve before static collision collection");
        },
        updateHitboxes() {}
    });
    assert.equal(earlyStairCharacter.moveDirection({ x: 0, y: 1 }, { lockMovementVector: true }), true);
    assertApproxEqual(earlyStairCharacter.x, 1, 0.0001);
    assertApproxEqual(earlyStairCharacter.y, 0.5, 0.0001);
    const unsupportedLowerWizard = {
        type: "wizard",
        x: 1.5,
        y: 0,
        z: 1,
        currentLayer: 0,
        traversalLayer: 0,
        currentLayerBaseZ: 0,
        groundRadius: 0.3
    };
    const unsupportedLowerEntry = map.resolveActorStairMovementOccupancy(1.9, 0, unsupportedLowerWizard);
    assert.equal(unsupportedLowerEntry.allowed, false);
    assert.notEqual(unsupportedLowerEntry.support && unsupportedLowerEntry.support.type, "stair");
    const unsupportedUpperWizard = {
        type: "wizard",
        x: 2.5,
        y: 0,
        z: 3,
        currentLayer: 1,
        traversalLayer: 1,
        currentLayerBaseZ: 3,
        groundRadius: 0.3
    };
    const unsupportedUpperEntry = map.resolveActorStairMovementOccupancy(2.1, 0, unsupportedUpperWizard);
    assert.equal(unsupportedUpperEntry.allowed, false);
    assert.notEqual(unsupportedUpperEntry.support && unsupportedUpperEntry.support.type, "stair");
    assert.equal(map.resolveActorStairMovementOccupancy(3.5, 0, actor).allowed, true);

    actor._pendingVectorMovementSupport = map.resolveActorStairMovementOccupancy(2.5, 0, actor).support;
    map.applyActorResolvedMovementSupport(actor, 2.5, 0);
    actor.x = 2.5;
    actor.y = 0;
    assertApproxEqual(actor.z, 2, 0.0001);
    assert.equal(actor.currentLayer, 0);
    assert.equal(map.resolveActorStairMovementOccupancy(3.5, 0, actor).allowed, true);

    const topActor = {
        x: 3.5,
        y: 0,
        z: 0,
        currentLayer: 1,
        traversalLayer: 1,
        currentLayerBaseZ: 3,
        node: higherNode
    };
    assert.equal(map.resolveActorStairMovementOccupancy(2.5, 0, topActor).allowed, true);
    const upperFirstStepEntry = map.resolveActorStairMovementOccupancy(2.05, 0, topActor);
    assert.equal(upperFirstStepEntry.handled, true);
    assert.equal(upperFirstStepEntry.allowed, true);
    assertApproxEqual(upperFirstStepEntry.support.upDown, 1, 0.00001);

    const topMouthActor = {
        x: 3,
        y: 0,
        z: 3,
        currentLayer: 1,
        traversalLayer: 1,
        currentLayerBaseZ: 3,
        node: higherNode
    };
    const topMouthEntry = map.resolveActorStairMovementOccupancy(2.75, 0, topMouthActor);
    assert.equal(topMouthEntry.handled, true);
    assert.equal(topMouthEntry.allowed, true);
    assertApproxEqual(topMouthEntry.support.upDown, 1, 0.00001);

    const sideActor = {
        x: 1.5,
        y: 0.75,
        z: 0,
        currentLayer: 0,
        traversalLayer: 0,
        currentLayerBaseZ: 0,
        node: lowerNode
    };
    const sideEntry = map.resolveActorStairMovementOccupancy(1.5, 0.25, sideActor);
    assert.equal(sideEntry.handled, true);
    assert.equal(sideEntry.allowed, false);
    assert.equal(sideEntry.slideAlongStairFootprint, true);

    const wideActor = {
        x: -0.5,
        y: 0,
        z: 0,
        groundRadius: 0.3,
        currentLayer: 0,
        traversalLayer: 0,
        currentLayerBaseZ: 0,
        node: lowerNode
    };
    assert.equal(map.resolveActorStairMovementOccupancy(0.5, 0, wideActor).allowed, true);
    const bottomSideEntry = map.resolveActorStairMovementOccupancy(0.5, 0.25, wideActor);
    assert.equal(bottomSideEntry.handled, true);
    assert.equal(bottomSideEntry.allowed, true);
    assertApproxEqual(bottomSideEntry.support.leftRight, 0.7, 0.0001);
    assertApproxEqual(bottomSideEntry.support.point.y, 0.2, 0.0001);
    const nearMouthWideActor = { ...wideActor, x: -0.25, y: 0 };
    const nearMouthEntry = map.resolveActorStairMovementOccupancy(-0.2, 0, nearMouthWideActor);
    assert.equal(nearMouthEntry.handled, true);
    assert.equal(nearMouthEntry.allowed, true);
    assert.equal(nearMouthEntry.support.type, "floor");
    const lowerMouthFloorActor = {
        ...wideActor,
        x: 0,
        y: 0,
        _stairSupport: null
    };
    const lowerMouthStraightAway = map.resolveActorStairMovementOccupancy(-0.05, 0, lowerMouthFloorActor);
    assert.equal(lowerMouthStraightAway.handled, true);
    assert.equal(lowerMouthStraightAway.allowed, true);
    assert.equal(lowerMouthStraightAway.support.type, "floor");
    const walkableStair = map.stairsById.get("walkable_stairs");
    const implicitUpperBlockers = map.getStairFootprintMovementBlockers(walkableStair, {
        type: "floor",
        fragmentId: "higher",
        surfaceId: "higher_surface",
        layer: 1,
        baseZ: 3
    });
    assert.equal(implicitUpperBlockers.length, 1);
    assert.equal(map.actorFootprintOverlapsPolygon(implicitUpperBlockers[0]._movementPolygon, 1.5, 0, { groundRadius: 0 }), true);
    assert.equal(map.actorFootprintOverlapsPolygon(implicitUpperBlockers[0]._movementPolygon, 2.5, 0, { groundRadius: 0 }), false);
    const lowerBlockers = map.getStairFootprintMovementBlockers(walkableStair, {
        type: "floor",
        fragmentId: "lower_floor",
        surfaceId: "lower_floor",
        layer: 0,
        baseZ: 0
    });
    assert.ok(map.getStairLowClearanceUpDownRanges(walkableStair).some((range) => range.min <= 0));
    const originalFloorSupportAtWorldPosition = map.getFloorSupportAtWorldPosition.bind(map);
    map.getFloorSupportAtWorldPosition = (x, y, layer, options = {}) => {
        if (Math.round(Number(layer) || 0) === 0 && Number(x) > -0.05 && Number(x) < 0.15) {
            return null;
        }
        return originalFloorSupportAtWorldPosition(x, y, layer, options);
    };
    const cutoutMouthActor = { ...wideActor, x: 0.02, y: 0 };
    const cutoutMouthEntry = map.resolveActorStairMovementOccupancy(0.1, 0, cutoutMouthActor);
    if (cutoutMouthEntry.handled && cutoutMouthEntry.allowed) {
        assertApproxEqual(cutoutMouthEntry.support.upDown, 0, 0.00001);
    }
    map.getFloorSupportAtWorldPosition = originalFloorSupportAtWorldPosition;
    const sideOverlapEntry = map.resolveActorStairMovementOccupancy(1.5, 0.75, wideActor);
    assert.equal(sideOverlapEntry.handled, true);
    assert.equal(sideOverlapEntry.allowed, false);
    assert.equal(sideOverlapEntry.slideAlongStairFootprint, true);
    const clearSideActor = { ...wideActor, x: 1.5, y: 0.95 };
    const sideClearEntry = map.resolveActorStairMovementOccupancy(1.5, 0.9, clearSideActor);
    assert.equal(sideClearEntry.handled, false);
    const highClearanceSideEntry = map.resolveActorStairMovementOccupancy(2.5, 0.75, wideActor);
    assert.equal(highClearanceSideEntry.handled, false);
    walkableStair.riserDepth = 0.25;
    const riserDepthSideEntry = map.resolveActorStairMovementOccupancy(2.5, 0.75, wideActor);
    assert.equal(riserDepthSideEntry.handled, true);
    assert.equal(riserDepthSideEntry.allowed, false);
    assert.equal(riserDepthSideEntry.slideAlongStairFootprint, true);
    walkableStair.riserDepth = 0;
    higherFragment.holes = [[
        { x: 2.5, y: -0.5 },
        { x: 3.5, y: -0.5 },
        { x: 3.5, y: 0.5 },
        { x: 2.5, y: 0.5 }
    ]];
    const upperCutoutBlockers = map.getStairFootprintMovementBlockers(walkableStair, {
        type: "floor",
        layer: 1,
        baseZ: 3,
        fragmentId: "higher",
        surfaceId: "higher_surface"
    });
    assert.equal(upperCutoutBlockers.length, 1);
    assert.equal(upperCutoutBlockers[0].endpoint, "higher");
    assert.equal(map.actorFootprintOverlapsPolygon(upperCutoutBlockers[0]._movementPolygon, 3.25, 0, { groundRadius: 0.3 }), true);
    const upperCutoutActor = {
        x: 3.75,
        y: 0,
        z: 3,
        currentLayer: 1,
        traversalLayer: 1,
        currentLayerBaseZ: 3,
        groundRadius: 0.3,
        node: higherNode
    };
    const upperApproachBlockers = map.collectStairFootprintMovementBlockersInBounds({
        minX: 3.1,
        minY: -0.4,
        maxX: 3.8,
        maxY: 0.4
    }, upperCutoutActor, {
        candidateX: 3.25,
        candidateY: 0
    });
    assert.equal(upperApproachBlockers.length, 0);
    const upperCutoutEntry = map.resolveActorStairMovementOccupancy(3.25, 0, upperCutoutActor);
    assert.equal(upperCutoutEntry.handled, true);
    assert.equal(upperCutoutEntry.allowed, true);
    assert.equal(upperCutoutEntry.support.type, "stair");
    assertApproxEqual(upperCutoutEntry.support.upDown, 1, 0.00001);
    const upperCrossingActor = { ...upperCutoutActor, x: 3.25 };
    const upperCrossingEntry = map.resolveActorStairMovementOccupancy(2.95, 0, upperCrossingActor);
    assert.equal(upperCrossingEntry.handled, true);
    assert.equal(upperCrossingEntry.allowed, true);
    assert.equal(upperCrossingEntry.support.type, "stair");
    assertApproxEqual(upperCrossingEntry.support.upDown, 1, 0.00001);
    const stairExitWizard = {
        type: "wizard",
        map,
        x: 2.95,
        y: 0,
        z: 2.5,
        prevZ: 2.5,
        currentLayer: 0,
        traversalLayer: 0,
        currentLayerBaseZ: 0,
        _pendingVectorMovementSupport: {
            type: "floor",
            layer: 1,
            baseZ: 3,
            fragmentId: "higher",
            surfaceId: "higher_surface",
            node: higherNode,
            point: { x: 3.05, y: 0 }
        }
    };
    map.applyActorResolvedMovementSupport(stairExitWizard, 3.05, 0);
    assert.equal(stairExitWizard.z, 0);
    assert.equal(stairExitWizard.currentLayerBaseZ, 3);
    assertApproxEqual(stairExitWizard.currentLayerBaseZ + stairExitWizard.prevZ, 2.5, 0.00001);
    higherFragment.outerPolygon = [
        { x: 2.5, y: -1 },
        { x: 5, y: -1 },
        { x: 5, y: 1 },
        { x: 2.5, y: 1 }
    ];
    const upperSideEntryActor = {
        ...upperCutoutActor,
        x: 2.95,
        y: 0.75
    };
    const upperSideEntry = map.resolveActorStairMovementOccupancy(2.9, 0.4, upperSideEntryActor);
    assert.equal(upperSideEntry.handled, true);
    assert.equal(upperSideEntry.allowed, true);
    assert.equal(upperSideEntry.support.type, "stair");
    assert.ok(upperSideEntry.support.upDown >= 2 / 3 - 0.00001);
    assert.ok(upperSideEntry.support.upDown < 1 - 0.00001);
    higherFragment.outerPolygon = [
        { x: 3, y: -1 },
        { x: 5, y: -1 },
        { x: 5, y: 1 },
        { x: 3, y: 1 }
    ];
    const upperMouthCharacter = Object.create(Character.prototype);
    Object.assign(upperMouthCharacter, {
        type: "wizard",
        map,
        x: 3.75,
        y: 0,
        z: 0,
        prevX: 3.75,
        prevY: 0,
        currentLayer: 1,
        traversalLayer: 1,
        currentLayerBaseZ: 3,
        node: higherNode,
        groundRadius: 0.3,
        speed: 1,
        frameRate: 1,
        moving: false,
        movementVector: { x: -0.5, y: 0 },
        isFrozen: () => false,
        getVectorMovementMaxSpeed: () => 1,
        updateHitboxes() {}
    });
    assert.equal(upperMouthCharacter.moveDirection({ x: -1, y: 0 }, { lockMovementVector: true }), true);
    assert.ok(upperMouthCharacter.x < 3.75);
    assert.ok(upperMouthCharacter._stairSupport);
    assertApproxEqual(upperMouthCharacter._stairSupport.upDown, 1, 0.00001);
    const slowUpperMouthCharacter = Object.create(Character.prototype);
    Object.assign(slowUpperMouthCharacter, {
        type: "wizard",
        map,
        x: 3.75,
        y: 0,
        z: 0,
        prevX: 3.75,
        prevY: 0,
        currentLayer: 1,
        traversalLayer: 1,
        currentLayerBaseZ: 3,
        node: higherNode,
        groundRadius: 0.3,
        speed: 1,
        frameRate: 1,
        moving: false,
        movementVector: { x: -0.05, y: 0 },
        isFrozen: () => false,
        getVectorMovementMaxSpeed: () => 1,
        updateHitboxes() {}
    });
    for (let i = 0; i < 20 && !slowUpperMouthCharacter._stairSupport; i++) {
        slowUpperMouthCharacter.movementVector = { x: -0.05, y: 0 };
        assert.equal(slowUpperMouthCharacter.moveDirection({ x: -1, y: 0 }, { lockMovementVector: true }), true);
    }
    assert.ok(slowUpperMouthCharacter._stairSupport);
    assertApproxEqual(slowUpperMouthCharacter._stairSupport.upDown, 1, 0.00001);
    higherFragment.holes = [];
    const floorSideCharacter = Object.create(Character.prototype);
    Object.assign(floorSideCharacter, {
        type: "wizard",
        map,
        x: 1.0,
        y: 0.86,
        z: 0,
        prevX: 1.0,
        prevY: 0.86,
        currentLayer: 0,
        traversalLayer: 0,
        currentLayerBaseZ: 0,
        groundRadius: 0.3,
        speed: 1,
        frameRate: 1,
        moving: false,
        movementVector: { x: 0.2, y: -0.4 },
        isFrozen: () => false,
        getVectorMovementMaxSpeed: () => 1,
        updateHitboxes() {}
    });
    assert.equal(floorSideCharacter.moveDirection({ x: 0.4472, y: -0.8944 }, { lockMovementVector: true }), true);
    assert.ok(floorSideCharacter.x > 1.0, "stair side collision should preserve tangential motion");
    assert.ok(Math.hypot(floorSideCharacter.movementVector.x, floorSideCharacter.movementVector.y) > 0.01);

    wideActor._pendingVectorMovementSupport = map.resolveActorStairMovementOccupancy(0.5, 0, wideActor).support;
    map.applyActorResolvedMovementSupport(wideActor, 0.5, 0);
    wideActor.x = 0.5;
    wideActor.y = 0;
    const stairSideExit = map.resolveActorStairMovementOccupancy(0.5, 0.25, wideActor);
    assert.equal(stairSideExit.handled, true);
    assert.equal(stairSideExit.allowed, true);
    assertApproxEqual(stairSideExit.support.leftRight, 0.7, 0.0001);
    assertApproxEqual(stairSideExit.support.point.y, 0.2, 0.0001);

    const higherSplitFragment = map.registerFloorFragment({
        fragmentId: "higher_split",
        surfaceId: "higher_surface",
        ownerSectionKey: "0,0",
        level: 1,
        nodeBaseZ: 3,
        outerPolygon: [
            { x: 3.25, y: -0.5 },
            { x: 3.75, y: -0.5 },
            { x: 3.75, y: 0.5 },
            { x: 3.25, y: 0.5 }
        ],
        holes: []
    });
    const higherSplitNode = map.createFloorNodeFromSource(map.nodes[0][4], higherSplitFragment, { baseZ: 3, traversalLayer: 1 });
    const splitTopActor = {
        x: 3.5,
        y: 0,
        z: 0,
        currentLayer: 1,
        traversalLayer: 1,
        currentLayerBaseZ: 3,
        node: higherSplitNode
    };
    assert.equal(map.resolveActorStairMovementOccupancy(2.5, 0, splitTopActor).allowed, true);

    const overheadFragment = map.registerFloorFragment({
        fragmentId: "overhead",
        surfaceId: "overhead_surface",
        ownerSectionKey: "0,0",
        level: 2,
        nodeBaseZ: 6,
        outerPolygon: [
            { x: -1, y: -1 },
            { x: 5, y: -1 },
            { x: 5, y: 1 },
            { x: -1, y: 1 }
        ],
        holes: []
    });
    const overheadNode = map.createFloorNodeFromSource(map.nodes[0][1], overheadFragment, { baseZ: 6, traversalLayer: 2 });
    const overheadActor = {
        x: 0.25,
        y: 0,
        z: 0,
        currentLayer: 2,
        traversalLayer: 2,
        currentLayerBaseZ: 6,
        node: overheadNode
    };
    const overheadOccupancy = map.resolveActorStairMovementOccupancy(0.5, 0, overheadActor);
    assert.equal(overheadOccupancy.handled, false);
    overheadActor.x = 0.5;
    map.applyActorResolvedMovementSupport(overheadActor, 0.5, 0);
    assert.equal(overheadActor._stairSupport, null);
    assert.equal(overheadActor.currentLayer, 2);
    assert.equal(overheadActor.currentLayerBaseZ, 6);
    assert.equal(overheadActor.z, 6);

    const upperFloorOverStairsFragment = map.registerFloorFragment({
        fragmentId: "upper_floor_over_stairs",
        surfaceId: "higher_surface",
        ownerSectionKey: "0,0",
        level: 1,
        nodeBaseZ: 3,
        outerPolygon: [
            { x: 1, y: -1 },
            { x: 2, y: -1 },
            { x: 2, y: 1 },
            { x: 1, y: 1 }
        ],
        holes: []
    });
    const upperFloorOverStairsNode = map.createFloorNodeFromSource(
        map.nodes[0][2],
        upperFloorOverStairsFragment,
        { baseZ: 3, traversalLayer: 1 }
    );
    const upperFloorOverStairsActor = {
        type: "wizard",
        x: 1.5,
        y: 0,
        z: 0,
        currentLayer: 1,
        traversalLayer: 1,
        currentLayerBaseZ: 3,
        node: upperFloorOverStairsNode
    };
    const upperFloorOverStairsOccupancy = map.resolveActorStairMovementOccupancy(1.6, 0, upperFloorOverStairsActor);
    assert.equal(upperFloorOverStairsOccupancy.handled, true);
    assert.equal(upperFloorOverStairsOccupancy.allowed, false);
    assert.equal(upperFloorOverStairsOccupancy.slideAlongStairFootprint, true);
    assert.equal(upperFloorOverStairsActor._stairSupport == null, true);
    assert.equal(upperFloorOverStairsActor.currentLayer, 1);
    assert.equal(upperFloorOverStairsActor.currentLayerBaseZ, 3);
    assert.equal(upperFloorOverStairsActor.z, 0);

    const wizardActor = {
        type: "wizard",
        x: -0.5,
        y: 0,
        z: 0,
        currentLayer: 0,
        traversalLayer: 0,
        currentLayerBaseZ: 0,
        node: lowerNode
    };
    wizardActor._pendingVectorMovementSupport = map.resolveActorStairMovementOccupancy(0.5, 0, wizardActor).support;
    map.applyActorResolvedMovementSupport(wizardActor, 0.5, 0);
    wizardActor.x = 0.5;
    wizardActor.y = 0;
    assertApproxEqual(wizardActor._stairSupport.baseZ, 0, 0.0001);
    assertApproxEqual(wizardActor._stairSupport.localZ, 0, 0.0001);
    assertApproxEqual(wizardActor._stairSupport.upDown, 0, 0.0001);
    assertApproxEqual(wizardActor._stairSupport.continuousBaseZ, 0, 0.0001);
    assertApproxEqual(wizardActor._stairSupport.continuousLocalZ, 0, 0.0001);
    assertApproxEqual(wizardActor.z, 0, 0.0001);
    assert.equal(wizardActor.currentLayerBaseZ, 0);

    wizardActor._pendingVectorMovementSupport = map.resolveActorStairMovementOccupancy(firstStepTargetX, 0, wizardActor).support;
    map.applyActorResolvedMovementSupport(wizardActor, firstStepTargetX, 0);
    assertApproxEqual(wizardActor._stairSupport.baseZ, 1, 0.0001);
    assertApproxEqual(wizardActor._stairSupport.localZ, 1, 0.0001);
    assertApproxEqual(wizardActor._stairSupport.continuousBaseZ, 1, 0.0001);
    assertApproxEqual(wizardActor._stairSupport.continuousLocalZ, 1, 0.0001);
    assertApproxEqual(wizardActor.z, 1, 0.0001);
    assert.equal(wizardActor.currentLayerBaseZ, 0);
});

test("upper floor support rejects actor footprints that clip holes or edges", () => {
    const map = Object.create(GameMap.prototype);
    map.width = 1;
    map.height = 1;
    map.wrapX = false;
    map.wrapY = false;
    map.shortestDeltaX = (fromX, toX) => toX - fromX;
    map.shortestDeltaY = (fromY, toY) => toY - fromY;
    map.resetFloorRuntimeState();
    map.registerFloorFragment({
        fragmentId: "roof",
        surfaceId: "roof_surface",
        ownerSectionKey: "0,0",
        level: 1,
        nodeBaseZ: 3,
        outerPolygon: [
            { x: 0, y: 0 },
            { x: 5, y: 0 },
            { x: 5, y: 5 },
            { x: 0, y: 5 }
        ],
        holes: [[
            { x: 2, y: 2 },
            { x: 3, y: 2 },
            { x: 3, y: 3 },
            { x: 2, y: 3 }
        ]]
    });
    const actor = { groundRadius: 0.3 };

    assert.equal(map.isActorFootprintSupportedAtWorldPosition(1, 1, 1, actor), true);
    assert.equal(map.isActorFootprintSupportedAtWorldPosition(1.9, 2.5, 1, actor), false);
    assert.equal(map.isActorFootprintSupportedAtWorldPosition(2.5, 2.5, 1, actor), false);
    assert.equal(map.isActorFootprintSupportedAtWorldPosition(0.15, 1, 1, actor), false);
    assert.equal(map.isActorFootprintSupportedAtWorldPosition(1.9, 2.5, 1, { groundRadius: 0 }), true);
});

test("worker path reconciliation preserves live stair portal metadata", () => {
    const map = Object.create(GameMap.prototype);
    map.width = 1;
    map.height = 1;
    map.wrapX = false;
    map.wrapY = false;
    map.shortestDeltaX = (fromX, toX) => toX - fromX;
    map.shortestDeltaY = (fromY, toY) => toY - fromY;
    map.resetFloorRuntimeState();

    const lower = createNode(0, 0, { x: 0, y: 0, baseZ: 0, traversalLayer: 0 });
    lower.id = map.getFloorNodeKey(0, 0, "lower_surface", "lower");
    lower.surfaceId = "lower_surface";
    lower.fragmentId = "lower";
    const higher = createNode(0, 1, { x: 0, y: 2, baseZ: 5, traversalLayer: 1 });
    higher.id = map.getFloorNodeKey(0, 1, "higher_surface", "higher");
    higher.surfaceId = "higher_surface";
    higher.fragmentId = "higher";
    map.floorNodeIndex.set(lower.id, lower);
    map.floorNodeIndex.set(higher.id, higher);
    map.registerStairRuntimeRecord({
        id: "async_stairs",
        lowerNodeId: lower.id,
        higherNodeId: higher.id,
        lowerPoint: { x: 0, y: 0 },
        higherPoint: { x: 0, y: 2 },
        lowerZ: 0,
        higherZ: 5,
        lowerLevel: 0,
        higherLevel: 1,
        lowerSurfaceId: "lower_surface",
        higherSurfaceId: "higher_surface",
        stepCount: 4,
        riserDepth: 0,
        treads: [
            { left: { x: -0.5, y: 0 }, right: { x: 0.5, y: 0 } },
            { left: { x: -0.5, y: 2 }, right: { x: 0.5, y: 2 } }
        ]
    });
    lower.portalEdges = [{
        fromNode: lower,
        toNode: higher,
        type: "stairs",
        metadata: { transitionId: "async_stairs", stairId: "async_stairs" }
    }];

    const path = map.resolveWorkerPathResult({
        ok: true,
        startNodeKey: lower.id,
        pathNodeKeys: [higher.id],
        pathEdgeIds: [`${lower.id}->portal:${higher.id}:async_stairs`]
    }, { returnPathSteps: true });

    assert.equal(Array.isArray(path), true);
    assert.equal(path.length, 1);
    assert.equal(path[0].type, "stairs");
    assert.equal(path[0].metadata.stairId, "async_stairs");
    assert.equal(path[0].getWorldPositionAt(0.5).z, 2.5);
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

test("GameMap.getFloorNodeAtLayer resolves upper floor node from placement base node", () => {
    const map = Object.create(GameMap.prototype);
    map.width = 3;
    map.height = 3;
    map.wrapX = false;
    map.wrapY = false;
    map.nodes = [
        [
            createNode(0, 0, { x: 0, y: 0 }),
            createNode(0, 1, { x: 0, y: 1 }),
            createNode(0, 2, { x: 0, y: 2 })
        ],
        [
            createNode(1, 0, { x: 0.866, y: 0.5 }),
            createNode(1, 1, { x: 0.866, y: 1.5 }),
            createNode(1, 2, { x: 0.866, y: 2.5 })
        ],
        [
            createNode(2, 0, { x: 1.732, y: 0 }),
            createNode(2, 1, { x: 1.732, y: 1 }),
            createNode(2, 2, { x: 1.732, y: 2 })
        ]
    ];
    map.resetFloorRuntimeState();

    const upperFragment = map.registerFloorFragment({
        fragmentId: "upper-fragment",
        surfaceId: "upper-surface",
        ownerSectionKey: "section-a",
        level: 2,
        outerPolygon: [
            { x: 0.25, y: 0.75 },
            { x: 1.25, y: 0.75 },
            { x: 1.25, y: 1.75 },
            { x: 0.25, y: 1.75 }
        ],
    });
    const baseNode = map.nodes[1][1];
    const upperNode = map.createFloorNodeFromSource(baseNode, upperFragment, {
        baseZ: 6,
        traversalLayer: 2
    });

    const placementBaseNode = map.worldToNode(baseNode.x, baseNode.y);
    assert.equal(placementBaseNode, baseNode);
    assert.equal(map.getFloorNodeAtLayer(placementBaseNode.xindex, placementBaseNode.yindex, 2), upperNode);
    assert.equal(map.getFloorNodeAtLayer(placementBaseNode.xindex, placementBaseNode.yindex, 2, {
        surfaceId: "upper-surface",
        fragmentId: "upper-fragment",
        allowScan: true
    }), upperNode);
    assert.equal(map.getFloorNodeAtLayer(placementBaseNode.xindex, placementBaseNode.yindex, 2, {
        sectionKey: "section-a",
        allowScan: true
    }), upperNode);
});

test("GameMap.getFloorNodeAtLayer materializes placed-building floor nodes on demand", () => {
    const map = Object.create(GameMap.prototype);
    map.width = 3;
    map.height = 3;
    map.wrapX = false;
    map.wrapY = false;
    map.nodes = [
        [
            createNode(0, 0, { x: 0, y: 0 }),
            createNode(0, 1, { x: 0, y: 1 }),
            createNode(0, 2, { x: 0, y: 2 })
        ],
        [
            createNode(1, 0, { x: 0.866, y: 0.5 }),
            createNode(1, 1, { x: 0.866, y: 1.5 }),
            createNode(1, 2, { x: 0.866, y: 2.5 })
        ],
        [
            createNode(2, 0, { x: 1.732, y: 0 }),
            createNode(2, 1, { x: 1.732, y: 1 }),
            createNode(2, 2, { x: 1.732, y: 2 })
        ]
    ];
    map.resetFloorRuntimeState();

    const upperFragment = map.registerFloorFragment({
        fragmentId: "building:tower:floor:upper",
        surfaceId: "building:tower:surface:upper",
        ownerSectionKey: "building:tower",
        level: 2,
        nodeBaseZ: 6,
        outerPolygon: [
            { x: 0.25, y: 0.75 },
            { x: 1.25, y: 0.75 },
            { x: 1.25, y: 1.75 },
            { x: 0.25, y: 1.75 }
        ],
        holes: []
    });
    const baseNode = map.nodes[1][1];

    assert.equal(map.floorNodesById.get(upperFragment.fragmentId).length, 0);
    assert.equal(map.getFloorNodeAtLayer(baseNode.xindex, baseNode.yindex, 2, {
        fragmentId: upperFragment.fragmentId,
        surfaceId: upperFragment.surfaceId,
        sectionKey: upperFragment.ownerSectionKey,
        worldX: 2,
        worldY: 2,
        allowScan: true
    }), null);

    const created = map.getFloorNodeAtLayer(baseNode.xindex, baseNode.yindex, 2, {
        fragmentId: upperFragment.fragmentId,
        surfaceId: upperFragment.surfaceId,
        sectionKey: upperFragment.ownerSectionKey,
        worldX: 0.8,
        worldY: 1.2,
        allowScan: true
    });

    assert.ok(created);
    assert.equal(created.sourceNode, baseNode);
    assert.equal(created.traversalLayer, 2);
    assert.equal(created.baseZ, 6);
    assert.equal(created.fragmentId, upperFragment.fragmentId);
    assert.equal(created.surfaceId, upperFragment.surfaceId);
    assert.equal(map.floorNodesById.get(upperFragment.fragmentId).length, 1);
    assert.equal(map.getFloorNodeAtLayer(baseNode.xindex, baseNode.yindex, 2, {
        fragmentId: upperFragment.fragmentId,
        surfaceId: upperFragment.surfaceId,
        sectionKey: upperFragment.ownerSectionKey,
        worldX: 0.8,
        worldY: 1.2,
        allowScan: true
    }), created);
});

test("GameMap.getFloorNodeAtLayer materializes from explicit prototype source node", () => {
    const map = Object.create(GameMap.prototype);
    map.width = 0;
    map.height = 0;
    map.wrapX = false;
    map.wrapY = false;
    map.nodes = [];
    map.resetFloorRuntimeState();

    const upperFragment = map.registerFloorFragment({
        fragmentId: "building:placed-5:floor:floor-fragment-26",
        surfaceId: "building:placed-5:surface:floor-fragment-26",
        ownerSectionKey: "building:placed-5",
        level: 1,
        nodeBaseZ: 4,
        outerPolygon: [
            { x: -156, y: 208 },
            { x: -155, y: 208 },
            { x: -155, y: 209 },
            { x: -156, y: 209 }
        ],
        holes: []
    });
    const prototypeBaseNode = {
        xindex: 512,
        yindex: 384,
        x: -155.6,
        y: 208.7,
        clearance: 1,
        _prototypeSectionKey: "building:placed-5"
    };

    assert.equal(map.getNode(prototypeBaseNode.xindex, prototypeBaseNode.yindex, 0), null);

    const created = map.getFloorNodeAtLayer(prototypeBaseNode.xindex, prototypeBaseNode.yindex, 1, {
        fragmentId: upperFragment.fragmentId,
        surfaceId: upperFragment.surfaceId,
        sectionKey: upperFragment.ownerSectionKey,
        sourceNode: prototypeBaseNode,
        worldX: -155.58889172819775,
        worldY: 208.6960504173884,
        allowScan: true
    });

    assert.ok(created);
    assert.equal(created.sourceNode, prototypeBaseNode);
    assert.equal(created.traversalLayer, 1);
    assert.equal(created.baseZ, 4);
    assert.equal(created.fragmentId, upperFragment.fragmentId);
    assert.equal(created.surfaceId, upperFragment.surfaceId);
    assert.equal(map.floorNodesById.get(upperFragment.fragmentId).length, 1);
});

test("GameMap groups overlapping upper floor fragments into buildings", () => {
    const map = Object.create(GameMap.prototype);
    map.resetFloorRuntimeState();
    const makeFragment = (fragmentId, level, minX, minY, maxX, maxY) => ({
        fragmentId,
        surfaceId: fragmentId,
        level,
        outerPolygon: [
            { x: minX, y: minY },
            { x: maxX, y: minY },
            { x: maxX, y: maxY },
            { x: minX, y: maxY }
        ],
    });

    const lower = map.registerFloorFragment(makeFragment("lower", 1, 0, 0, 10, 10));
    const upper = map.registerFloorFragment(makeFragment("upper", 2, 5, 5, 12, 12));
    const neighbor = map.registerFloorFragment(makeFragment("neighbor", 1, 30, 0, 40, 10));
    const buildings = map.ensureFloorBuildings();

    assert.equal(buildings.size, 2);
    assert.equal(lower.buildingId, upper.buildingId);
    assert.notEqual(lower.buildingId, neighbor.buildingId);
    assert.equal(map.floorBuildingByFragmentId.get("upper"), lower.buildingId);
    const building = buildings.get(lower.buildingId);
    assert.ok(building.fragmentGraph instanceof Map);
    assert.deepEqual(Array.from(building.fragmentGraph.get("lower").above), ["upper"]);
    assert.deepEqual(Array.from(building.fragmentGraph.get("upper").below), ["lower"]);
});

test("GameMap excludes cutaway-rendered building fragments from generic floor buildings", () => {
    const map = Object.create(GameMap.prototype);
    map.resetFloorRuntimeState();
    map.registerFloorFragment({
        fragmentId: "building-floor",
        surfaceId: "building-surface",
        level: 1,
        nodeBaseZ: 3,
        outerPolygon: [
            { x: 0, y: 0 },
            { x: 4, y: 0 },
            { x: 4, y: 4 },
            { x: 0, y: 4 }
        ],
        renderedByBuildingCutaway: true
    });

    const buildings = map.ensureFloorBuildings();

    assert.equal(buildings.size, 0);
    assert.equal(map.floorBuildingByFragmentId.has("building-floor"), false);
    assert.equal(map.floorsById.get("building-floor").buildingId, undefined);
});

test("GameMap attaches placed upper-floor scenery to the owning building manifest", () => {
    const map = Object.create(GameMap.prototype);
    map.resetFloorRuntimeState();
    const fragment = map.registerFloorFragment({
        fragmentId: "upper",
        surfaceId: "upper-surface",
        level: 1,
        outerPolygon: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 }
        ],
    });
    const item = {
        type: "furniture",
        fragmentId: fragment.fragmentId,
        surfaceId: fragment.surfaceId,
        traversalLayer: 1
    };

    const versionBeforeAdd = map._buildingRenderCacheVersion;
    assert.equal(map.addObjectToFloorBuildingManifest(item), true);
    assert.equal(map._buildingRenderCacheVersion > versionBeforeAdd, true);

    const buildingId = map.floorBuildingByFragmentId.get(fragment.fragmentId);
    const building = map.buildingsById.get(buildingId);
    assert.ok(building);
    assert.equal(Array.isArray(building.staticObjects), true);
    assert.equal(building.staticObjects.length, 1);
    assert.equal(building.staticObjects[0].item, item);
    assert.equal(building.staticObjects[0].refs.length, 1);
    assert.equal(building.staticObjects[0].refs[0].surfaceId, "upper-surface");
    assert.equal(building.staticObjects[0].refs[0].fragmentId, "upper");
    assert.equal(building.staticObjectsByFragment instanceof Map, true);
    assert.equal(building.staticObjectsByFragment.get("upper").length, 1);
    assert.equal(building.staticObjectsByFragment.get("upper")[0].item, item);
    assert.equal(map.getFloorBuildingStaticObjectsForFragment(building, "upper").length, 1);
    assert.equal(map.getFloorBuildingStaticObjectsForFragment(building, "upper")[0].item, item);
    assert.equal(item._floorBuildingManifestId, building.buildingId);

    const versionBeforeRemove = map._buildingRenderCacheVersion;
    assert.equal(map.removeObjectFromFloorBuildingManifest(item), true);
    assert.equal(map._buildingRenderCacheVersion, versionBeforeRemove + 1);
    assert.equal(building.staticObjects.length, 0);
    assert.equal(building.staticObjectsByFragment.get("upper"), undefined);
    assert.equal(building._staticObjectManifestSet.has(item), false);
    assert.equal(item._floorBuildingManifestId, undefined);
});

test("GameMap preserves upper-floor scenery manifests when floor buildings rebuild", () => {
    const map = Object.create(GameMap.prototype);
    map.resetFloorRuntimeState();
    const fragment = map.registerFloorFragment({
        fragmentId: "upper",
        surfaceId: "upper-surface",
        level: 1,
        outerPolygon: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 }
        ],
    });
    const item = {
        type: "furniture",
        fragmentId: fragment.fragmentId,
        surfaceId: fragment.surfaceId,
        traversalLayer: 1
    };

    assert.equal(map.addObjectToFloorBuildingManifest(item), true);
    const originalBuildingId = item._floorBuildingManifestId;
    assert.ok(originalBuildingId);

    map._floorBuildingsDirty = true;
    const rebuiltBuildings = map.rebuildFloorBuildings();
    const rebuiltBuildingId = map.floorBuildingByFragmentId.get(fragment.fragmentId);
    const rebuiltBuilding = rebuiltBuildings.get(rebuiltBuildingId);

    assert.ok(rebuiltBuilding);
    assert.equal(Array.isArray(rebuiltBuilding.staticObjects), true);
    assert.equal(rebuiltBuilding.staticObjects.length, 1);
    assert.equal(rebuiltBuilding.staticObjects[0].item, item);
    assert.equal(rebuiltBuilding.staticObjects[0].refs.length, 1);
    assert.equal(rebuiltBuilding.staticObjects[0].refs[0].surfaceId, "upper-surface");
    assert.equal(rebuiltBuilding.staticObjects[0].refs[0].fragmentId, "upper");
    assert.equal(rebuiltBuilding.staticObjectsByFragment.get("upper").length, 1);
    assert.equal(rebuiltBuilding.staticObjectsByFragment.get("upper")[0].item, item);
    assert.equal(item._floorBuildingManifestId, rebuiltBuildingId);
    assert.equal(item._floorBuildingManifestFragmentId, "upper");
});

test("GameMap prunes stale gone objects from building manifests", () => {
    const map = Object.create(GameMap.prototype);
    map.resetFloorRuntimeState();
    const fragment = map.registerFloorFragment({
        fragmentId: "upper",
        surfaceId: "upper-surface",
        level: 1,
        outerPolygon: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 }
        ],
    });
    const oldItem = {
        type: "furniture",
        fragmentId: fragment.fragmentId,
        surfaceId: fragment.surfaceId,
        traversalLayer: 1
    };
    const liveItem = {
        type: "furniture",
        fragmentId: fragment.fragmentId,
        surfaceId: fragment.surfaceId,
        traversalLayer: 1
    };

    assert.equal(map.addObjectToFloorBuildingManifest(oldItem), true);
    oldItem.gone = true;
    assert.equal(map.addObjectToFloorBuildingManifest(liveItem), true);

    const buildingId = map.floorBuildingByFragmentId.get(fragment.fragmentId);
    const building = map.buildingsById.get(buildingId);
    assert.equal(building.staticObjects.length, 1);
    assert.equal(building.staticObjects[0].item, liveItem);
    assert.equal(building.staticObjectsByFragment.get("upper").length, 1);
    assert.equal(building.staticObjectsByFragment.get("upper")[0].item, liveItem);
    assert.equal(building._staticObjectManifestSet.has(oldItem), false);
    assert.equal(building._staticObjectManifestSet.has(liveItem), true);
});

test("GameMap building fragment graph links multiple direct upper fragments after clipping covered area", () => {
    const map = Object.create(GameMap.prototype);
    map.resetFloorRuntimeState();
    const makeFragment = (fragmentId, level, minX, minY, maxX, maxY) => ({
        fragmentId,
        surfaceId: fragmentId,
        level,
        outerPolygon: [
            { x: minX, y: minY },
            { x: maxX, y: minY },
            { x: maxX, y: maxY },
            { x: minX, y: maxY }
        ],
    });

    map.registerFloorFragment(makeFragment("base", 1, 0, 0, 10, 10));
    map.registerFloorFragment(makeFragment("left-tower", 2, 0, 0, 4, 10));
    map.registerFloorFragment(makeFragment("right-tower", 2, 6, 0, 10, 10));
    map.registerFloorFragment(makeFragment("left-top", 3, 0, 0, 4, 10));

    const building = Array.from(map.ensureFloorBuildings().values())[0];
    const graph = building.fragmentGraph;
    assert.deepEqual(Array.from(graph.get("base").above).sort(), ["left-tower", "right-tower"]);
    assert.deepEqual(Array.from(graph.get("left-tower").above), ["left-top"]);
    assert.deepEqual(Array.from(graph.get("right-tower").above), []);
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
