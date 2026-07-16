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
        frameCount: 0,
        setInterval: () => 1,
        clearInterval() {},
        setTimeout: () => 1,
        clearTimeout() {}
    };
    context.globalThis = context;
    context.window = context;
    vm.createContext(context);

    const files = [
        path.join(__dirname, "../public/assets/javascript/gameobjects/hitbox.js"),
        path.join(__dirname, "../public/assets/javascript/shared/FloorSupport.js"),
        path.join(__dirname, "../public/assets/javascript/spells/editor/FloorFragmentEdit.js"),
        path.join(__dirname, "../public/assets/javascript/spells/Spell.js"),
        path.join(__dirname, "../public/assets/javascript/spells/SpellSystem.js")
    ];
    for (const filePath of files) {
        vm.runInContext(fs.readFileSync(filePath, "utf8"), context, { filename: filePath });
    }
    return context;
}

test("building placement rotation adjusts in snapped five degree radians", () => {
    const context = loadSpellContext();
    const wizard = {
        currentSpell: "placebuilding",
        selectedEditorCategory: "buildings",
        selectedBuildingRotation: 0
    };

    const right = context.SpellSystem.adjustBuildingPlacementRotation(wizard, 5);
    assertNearlyEqual(right, Math.PI / 36);
    assertNearlyEqual(wizard.selectedBuildingRotation, Math.PI / 36);
    assert.equal(wizard.selectedEditorCategory, "buildings");

    const left = context.SpellSystem.adjustBuildingPlacementRotation(wizard, -10);
    assertNearlyEqual(left, -Math.PI / 36);
    assertNearlyEqual(wizard.selectedBuildingRotation, -Math.PI / 36);
});

test("building placement rotation wraps around the negative boundary", () => {
    const context = loadSpellContext();
    const wizard = {
        currentSpell: "placebuilding",
        selectedBuildingRotation: -Math.PI
    };

    const next = context.SpellSystem.adjustBuildingPlacementRotation(wizard, -5);

    assertNearlyEqual(next, 35 * Math.PI / 36);
    assertNearlyEqual(wizard.selectedBuildingRotation, 35 * Math.PI / 36);
});

test("move object drag temporarily excludes prototype building objects from interior bakes", () => {
    const context = loadSpellContext();
    context.keysPressed = { " ": true };
    context.MoveObject = class MoveObject extends context.Spell {
        static supportsObjectTargeting = true;
        static isValidObjectTarget(target, wizardRef = null) {
            return !!(
                target &&
                target !== wizardRef &&
                !target.gone &&
                !target.vanishing &&
                Number.isFinite(target.x) &&
                Number.isFinite(target.y)
            );
        }
    };

    let removeCalls = 0;
    let restoreCalls = 0;
    let nodeDirtyCalls = 0;
    const objectState = {
        dirtyRuntimeObjects: new context.Set(),
        captureScanNeeded: false
    };
    const startNode = {
        objects: [],
        removeObject(obj) {
            const idx = this.objects.indexOf(obj);
            if (idx >= 0) this.objects.splice(idx, 1);
            if (obj._suppressBuildingRenderCacheDirty !== true) nodeDirtyCalls += 1;
        }
    };
    const nextNode = {
        objects: [],
        addObject(obj) {
            this.objects.push(obj);
            if (obj._suppressBuildingRenderCacheDirty !== true) nodeDirtyCalls += 1;
        }
    };
    const map = {
        _prototypeObjectState: objectState,
        shortestDeltaX(fromX, toX) { return toX - fromX; },
        shortestDeltaY(fromY, toY) { return toY - fromY; },
        wrapWorldX(x) { return x; },
        wrapWorldY(y) { return y; },
        worldToNode(x) {
            return x >= 5 ? nextNode : startNode;
        },
        removePrototypeBuildingObjectFromInteriorBitmap(obj) {
            removeCalls += 1;
            assert.equal(obj._suppressBuildingRenderCacheDirty, undefined);
            return {
                placementId: "building:test-house",
                floorId: "floor-1",
                recordId: 77,
                changed: true
            };
        },
        restorePrototypeBuildingObjectToInteriorBitmap(obj) {
            restoreCalls += 1;
            assert.equal(obj._suppressBuildingRenderCacheDirty, undefined);
            return {
                placementId: "building:test-house",
                floorId: "floor-1",
                recordId: 77,
                changed: true
            };
        }
    };
    const target = {
        type: "placedObject",
        objectType: "placedObject",
        isPlacedObject: true,
        category: "doors",
        rotationAxis: "spatial",
        x: 2,
        y: 3,
        map,
        node: startNode,
        _prototypeRuntimeRecord: true,
        _prototypeObjectManaged: true,
        _prototypeOwnerType: "building",
        _prototypeOwnerId: "building:test-house",
        _prototypeOwnerSignature: "building:building:test-house",
        _prototypeRecordId: 77,
        fragmentId: "building:test-house:floor:floor-1",
        surfaceId: "building:test-house:surface:floor-1"
    };
    startNode.objects.push(target);
    context.renderingScenePicker = {
        getHoveredObject({ filter }) {
            return filter(target) ? target : null;
        }
    };
    const wizard = {
        currentSpell: "moveobject",
        map,
        castDelay: false
    };

    assert.equal(context.SpellSystem.beginDragSpell(wizard, "moveobject", 2, 3), true);
    assert.equal(removeCalls, 1);
    assert.equal(target._suppressBuildingRenderCacheDirty, true);

    assert.equal(context.SpellSystem.updateDragPreview(wizard, 7, 9), true);
    assert.equal(removeCalls, 1);
    assert.equal(restoreCalls, 0);
    assert.equal(nodeDirtyCalls, 0);
    assert.equal(target.x, 7);
    assert.equal(target.y, 9);
    assert.equal(startNode.objects.includes(target), false);
    assert.equal(nextNode.objects.includes(target), true);

    assert.equal(context.SpellSystem.completeDragSpell(wizard, "moveobject", 8, 10), true);
    assert.equal(removeCalls, 1);
    assert.equal(restoreCalls, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(target, "_suppressBuildingRenderCacheDirty"), false);
    assert.equal(wizard.moveObjectDragState, null);
    assert.equal(target._prototypeDirty, true);
    assert.equal(objectState.dirtyRuntimeObjects.has(target), true);
    assert.equal(objectState.captureScanNeeded, true);
});

test("move object drag registers fresh prototype building objects before bake exclusion", () => {
    const context = loadSpellContext();
    context.keysPressed = { " ": true };
    context.activeSimObjects = new context.Set();
    context.MoveObject = class MoveObject extends context.Spell {
        static supportsObjectTargeting = true;
        static isValidObjectTarget(target, wizardRef = null) {
            return !!(target && target !== wizardRef && !target.gone && !target.vanishing);
        }
    };

    let ensureCalls = 0;
    let removeCalls = 0;
    const node = {
        objects: [],
        removeObject(obj) {
            const idx = this.objects.indexOf(obj);
            if (idx >= 0) this.objects.splice(idx, 1);
        },
        addObject(obj) {
            if (!this.objects.includes(obj)) this.objects.push(obj);
        }
    };
    const map = {
        shortestDeltaX(fromX, toX) { return toX - fromX; },
        shortestDeltaY(fromY, toY) { return toY - fromY; },
        wrapWorldX(x) { return x; },
        wrapWorldY(y) { return y; },
        worldToNode() { return node; },
        ensurePrototypeObjectRuntimeRecord(obj) {
            ensureCalls += 1;
            assert.equal(obj._prototypeRecordId, undefined);
            obj._prototypeRuntimeRecord = true;
            obj._prototypeRecordId = 88;
            return 88;
        },
        removePrototypeBuildingObjectFromInteriorBitmap(obj) {
            removeCalls += 1;
            assert.equal(obj._prototypeRecordId, 88);
            return {
                placementId: "building:test-house",
                floorId: "floor-1",
                recordId: 88,
                changed: true
            };
        },
        restorePrototypeBuildingObjectToInteriorBitmap() {
            return {
                placementId: "building:test-house",
                floorId: "floor-1",
                recordId: 88,
                changed: true
            };
        }
    };
    const target = {
        type: "placedObject",
        objectType: "placedObject",
        isPlacedObject: true,
        category: "furniture",
        x: 2,
        y: 3,
        map,
        node,
        _prototypeOwnerType: "building",
        _prototypeOwnerId: "building:test-house",
        fragmentId: "building:test-house:floor:floor-1",
        surfaceId: "building:test-house:surface:floor-1"
    };
    node.objects.push(target);
    context.renderingScenePicker = {
        getHoveredObject({ filter }) {
            return filter(target) ? target : null;
        }
    };
    const wizard = {
        currentSpell: "moveobject",
        map,
        castDelay: false
    };

    assert.equal(context.SpellSystem.beginDragSpell(wizard, "moveobject", 2, 3), true);
    assert.equal(ensureCalls, 1);
    assert.equal(removeCalls, 1);
    assert.equal(target._prototypeRecordId, 88);

    assert.equal(context.SpellSystem.completeDragSpell(wizard, "moveobject", 2, 3), true);
    assert.equal(wizard.moveObjectDragState, null);
});

test("move object drag applies force toward the mouse instead of teleporting", () => {
    const context = loadSpellContext();
    context.keysPressed = { " ": true };
    let now = 0;
    context.performance.now = () => now;
    context.MoveObject = class MoveObject extends context.Spell {
        static supportsObjectTargeting = true;
        static isValidObjectTarget(target, wizardRef = null) {
            return !!(target && target !== wizardRef && !target.gone && !target.vanishing);
        }
    };

    const node = { objects: [] };
    const map = {
        shortestDeltaX(fromX, toX) { return toX - fromX; },
        shortestDeltaY(fromY, toY) { return toY - fromY; },
        wrapWorldX(x) { return x; },
        wrapWorldY(y) { return y; },
        worldToNode() { return node; },
        getNodesInIndexWindow() { return [node]; }
    };
    const target = {
        type: "furniture",
        objectType: "placedObject",
        isPlacedObject: true,
        x: 0,
        y: 0,
        map,
        node,
        isPassable: false,
        groundRadius: 0.25,
        shadowBox: new context.CircleHitbox(0, 0, 0.25),
        touchBox: new context.CircleHitbox(0, 0, 0.25)
    };
    node.objects.push(target);
    context.renderingScenePicker = {
        getHoveredObject({ filter }) {
            return filter(target) ? target : null;
        }
    };
    const wizard = {
        currentSpell: "moveobject",
        map,
        castDelay: false
    };

    assert.equal(context.SpellSystem.beginDragSpell(wizard, "moveobject", 0, 0), true);
    now += 16;
    assert.equal(context.SpellSystem.updateDragPreview(wizard, 10, 0), true);
    assert.ok(target.x > 0, "object should begin moving toward the mouse");
    assert.ok(target.x < 10, "object should not teleport to the mouse");
});

test("move object force drag is resisted by wall hitboxes", () => {
    const context = loadSpellContext();
    context.keysPressed = { " ": true };
    let now = 0;
    context.performance.now = () => now;
    context.MoveObject = class MoveObject extends context.Spell {
        static supportsObjectTargeting = true;
        static isValidObjectTarget(target, wizardRef = null) {
            return !!(target && target !== wizardRef && !target.gone && !target.vanishing);
        }
    };

    const node = { objects: [] };
    const map = {
        shortestDeltaX(fromX, toX) { return toX - fromX; },
        shortestDeltaY(fromY, toY) { return toY - fromY; },
        wrapWorldX(x) { return x; },
        wrapWorldY(y) { return y; },
        worldToNode(x) {
            return { ...node, xindex: Math.floor(x), yindex: 0 };
        },
        getNodesInIndexWindow() { return [node]; }
    };
    const target = {
        type: "furniture",
        objectType: "placedObject",
        isPlacedObject: true,
        x: 0,
        y: 0,
        map,
        node,
        isPassable: false,
        groundRadius: 0.25,
        moveObjectForceStrength: 2000,
        moveObjectMaxSpeed: 50,
        moveObjectForceDamping: 0,
        shadowBox: new context.CircleHitbox(0, 0, 0.25),
        touchBox: new context.CircleHitbox(0, 0, 0.25)
    };
    const wall = {
        type: "wallSection",
        isPassable: false,
        traversalLayer: 0,
        shadowBox: new context.PolygonHitbox([
            { x: 1.0, y: -2 },
            { x: 1.2, y: -2 },
            { x: 1.2, y: 2 },
            { x: 1.0, y: 2 }
        ])
    };
    node.objects.push(target, wall);
    context.renderingScenePicker = {
        getHoveredObject({ filter }) {
            return filter(target) ? target : null;
        }
    };
    const wizard = {
        currentSpell: "moveobject",
        map,
        castDelay: false
    };

    assert.equal(context.SpellSystem.beginDragSpell(wizard, "moveobject", 0, 0), true);
    now += 50;
    assert.equal(context.SpellSystem.updateDragPreview(wizard, 5, 0), true);
    assert.ok(target.x > 0, "object should move toward the wall");
    assert.ok(target.x < 1.0, "object should remain on the near side of the wall");
});

test("move object force drag is resisted by prototype building movement blockers", () => {
    const context = loadSpellContext();
    context.keysPressed = { " ": true };
    let now = 0;
    context.performance.now = () => now;
    context.MoveObject = class MoveObject extends context.Spell {
        static supportsObjectTargeting = true;
        static isValidObjectTarget(target, wizardRef = null) {
            return !!(target && target !== wizardRef && !target.gone && !target.vanishing);
        }
    };

    const node = { objects: [] };
    const buildingBlocker = {
        type: "prototypeBuildingMovementBlocker",
        isPassable: false,
        traversalLayer: 0,
        shadowBox: new context.PolygonHitbox([
            { x: 1.0, y: -2 },
            { x: 1.2, y: -2 },
            { x: 1.2, y: 2 },
            { x: 1.0, y: 2 }
        ])
    };
    let buildingBlockerQueries = 0;
    const map = {
        shortestDeltaX(fromX, toX) { return toX - fromX; },
        shortestDeltaY(fromY, toY) { return toY - fromY; },
        wrapWorldX(x) { return x; },
        wrapWorldY(y) { return y; },
        worldToNode(x) {
            return { ...node, xindex: Math.floor(x), yindex: 0 };
        },
        getNodesInIndexWindow() { return [node]; },
        collectPrototypeBuildingMovementBlockersInBounds(bounds, layer) {
            buildingBlockerQueries += 1;
            assert.equal(layer, 0);
            assert.ok(bounds.minX <= 1.0 && bounds.maxX >= 1.2);
            return [buildingBlocker];
        }
    };
    const target = {
        type: "furniture",
        objectType: "placedObject",
        isPlacedObject: true,
        x: 0,
        y: 0,
        map,
        node,
        isPassable: false,
        groundRadius: 0.25,
        moveObjectForceStrength: 2000,
        moveObjectMaxSpeed: 50,
        moveObjectForceDamping: 0,
        shadowBox: new context.CircleHitbox(0, 0, 0.25),
        touchBox: new context.CircleHitbox(0, 0, 0.25)
    };
    node.objects.push(target);
    context.renderingScenePicker = {
        getHoveredObject({ filter }) {
            return filter(target) ? target : null;
        }
    };
    const wizard = {
        currentSpell: "moveobject",
        map,
        castDelay: false
    };

    assert.equal(context.SpellSystem.beginDragSpell(wizard, "moveobject", 0, 0), true);
    now += 50;
    assert.equal(context.SpellSystem.updateDragPreview(wizard, 5, 0), true);
    assert.equal(buildingBlockerQueries, 1);
    assert.ok(target.x > 0, "object should move toward the building wall");
    assert.ok(target.x < 1.0, "object should remain on the near side of the building wall");
});

test("god mode move object drag preserves grab offset and ignores blockers", () => {
    const context = loadSpellContext();
    context.keysPressed = { " ": true };
    let now = 0;
    context.performance.now = () => now;
    context.MoveObject = class MoveObject extends context.Spell {
        static supportsObjectTargeting = true;
        static isValidObjectTarget(target, wizardRef = null) {
            return !!(target && target !== wizardRef && !target.gone && !target.vanishing);
        }
    };

    const node = { objects: [] };
    let buildingBlockerQueries = 0;
    const map = {
        shortestDeltaX(fromX, toX) { return toX - fromX; },
        shortestDeltaY(fromY, toY) { return toY - fromY; },
        wrapWorldX(x) { return x; },
        wrapWorldY(y) { return y; },
        worldToNode(x) {
            return { ...node, xindex: Math.floor(x), yindex: 0 };
        },
        getNodesInIndexWindow() { return [node]; },
        collectPrototypeBuildingMovementBlockersInBounds() {
            buildingBlockerQueries += 1;
            return [{
                type: "prototypeBuildingMovementBlocker",
                isPassable: false,
                traversalLayer: 0,
                shadowBox: new context.PolygonHitbox([
                    { x: 1.0, y: -2 },
                    { x: 1.2, y: -2 },
                    { x: 1.2, y: 2 },
                    { x: 1.0, y: 2 }
                ])
            }];
        }
    };
    const target = {
        type: "furniture",
        objectType: "placedObject",
        isPlacedObject: true,
        x: 0,
        y: 0,
        map,
        node,
        isPassable: false,
        groundRadius: 0.25,
        shadowBox: new context.CircleHitbox(0, 0, 0.25),
        touchBox: new context.CircleHitbox(0, 0, 0.25)
    };
    node.objects.push(target);
    context.renderingScenePicker = {
        getHoveredObject({ filter }) {
            return filter(target) ? target : null;
        }
    };
    const wizard = {
        currentSpell: "moveobject",
        map,
        castDelay: false,
        isGodMode() { return true; }
    };

    assert.equal(context.SpellSystem.beginDragSpell(wizard, "moveobject", 0.75, 0), true);
    now += 50;
    assert.equal(context.SpellSystem.updateDragPreview(wizard, 5, 0), true);
    assert.equal(target.x, 4.25);
    assert.equal(target.y, 0);
    assert.equal(buildingBlockerQueries, 0);
});

test("moved placed object falls to lower support after leaving its original surface", () => {
    const context = loadSpellContext();
    context.keysPressed = { " ": true };
    context.activeSimObjects = new context.Set();
    context.MoveObject = class MoveObject extends context.Spell {
        static supportsObjectTargeting = true;
        static isValidObjectTarget(target, wizardRef = null) {
            return !!(target && target !== wizardRef && !target.gone && !target.vanishing);
        }
    };

    let validateCalls = 0;
    let captureCalls = 0;
    let restoreRef = null;
    const node = {
        objects: [],
        removeObject(obj) {
            const idx = this.objects.indexOf(obj);
            if (idx >= 0) this.objects.splice(idx, 1);
        },
        addObject(obj) {
            if (!this.objects.includes(obj)) this.objects.push(obj);
        }
    };
    const objectState = {
        dirtyRuntimeObjects: new context.Set(),
        captureScanNeeded: false
    };
    const map = {
        _prototypeObjectState: objectState,
        shortestDeltaX(fromX, toX) { return toX - fromX; },
        shortestDeltaY(fromY, toY) { return toY - fromY; },
        wrapWorldX(x) { return x; },
        wrapWorldY(y) { return y; },
        worldToNode() { return node; },
        removePrototypeBuildingObjectFromInteriorBitmap(obj) {
            return {
                placementId: obj._prototypeOwnerId,
                floorId: "upper",
                recordId: obj._prototypeRecordId,
                changed: true
            };
        },
        restorePrototypeBuildingObjectToInteriorBitmap(ref) {
            restoreRef = ref;
            return {
                placementId: ref.placementId,
                floorId: ref.floorId,
                recordId: ref.recordId,
                changed: true
            };
        },
        validateActorMovementSupport(actor) {
            validateCalls += 1;
            const previousSupport = actor.currentMovementSupport;
            actor.currentMovementSupport = {
                type: "floor",
                layer: 0,
                baseZ: 0,
                fragmentId: "section:0,0:ground",
                surfaceId: "section:0,0:ground",
                ownerType: "section",
                ownerId: "0,0",
                sectionKey: "0,0"
            };
            actor.currentLayer = 0;
            actor.traversalLayer = 0;
            actor.currentLayerBaseZ = 0;
            actor.fragmentId = actor.currentMovementSupport.fragmentId;
            actor.surfaceId = actor.currentMovementSupport.surfaceId;
            actor.z = 0;
            return {
                changed: true,
                ownerChanged: true,
                lost: false,
                previousSupport,
                nextSupport: actor.currentMovementSupport,
                previousOwner: "building:building:test-house",
                nextOwner: "section:0,0"
            };
        },
        capturePendingPrototypeObjects() {
            captureCalls += 1;
            assert.equal(target._prototypeDirty, true);
            assert.equal(objectState.dirtyRuntimeObjects.has(target), true);
            return true;
        }
    };
    const target = {
        type: "placedObject",
        objectType: "placedObject",
        isPlacedObject: true,
        category: "furniture",
        x: 0,
        y: 0,
        z: 0,
        map,
        node,
        _prototypeRuntimeRecord: true,
        _prototypeObjectManaged: true,
        _prototypeRecordId: 99,
        _prototypeOwnerType: "building",
        _prototypeOwnerId: "building:test-house",
        _prototypeOwnerSignature: "building:building:test-house",
        fragmentId: "building:test-house:floor:upper",
        surfaceId: "building:test-house:surface:upper",
        currentLayer: 1,
        traversalLayer: 1,
        currentLayerBaseZ: 3,
        currentMovementSupport: {
            type: "floor",
            layer: 1,
            baseZ: 3,
            fragmentId: "building:test-house:floor:upper",
            surfaceId: "building:test-house:surface:upper",
            ownerType: "building",
            ownerId: "building:test-house"
        }
    };
    node.objects.push(target);
    context.renderingScenePicker = {
        getHoveredObject({ filter }) {
            return filter(target) ? target : null;
        }
    };
    const wizard = {
        currentSpell: "moveobject",
        map,
        castDelay: false,
        isGodMode() { return true; }
    };

    assert.equal(context.SpellSystem.beginDragSpell(wizard, "moveobject", 0, 0), true);
    assert.equal(context.SpellSystem.updateDragPreview(wizard, 5, 0), true);
    assert.equal(target.x, 5);
    assert.equal(validateCalls, 0);
    assert.equal(captureCalls, 0);
    assert.equal(target.currentLayer, 1);
    assert.equal(target.currentLayerBaseZ, 3);
    assert.equal(target.z, 0);
    assert.equal(target._prototypeOwnerType, "building");
    assert.equal(target._prototypeOwnerId, "building:test-house");
    assert.equal(target._prototypeOwnerSignature, "building:building:test-house");
    assert.equal(objectState.dirtyRuntimeObjects.has(target), false);
    assert.equal(objectState.captureScanNeeded, false);

    assert.equal(context.SpellSystem.completeDragSpell(wizard, "moveobject", 5, 0), true);
    assert.equal(validateCalls, 1);
    assert.equal(target.currentLayer, 0);
    assert.equal(target.currentLayerBaseZ, 0);
    assert.equal(target.z, 3);
    assert.equal(target.falling, true);
    assert.equal(target._floorFallState.active, true);
    assert.equal(context.activeSimObjects.has(target), true);
    assert.equal(target._prototypeOwnerType, "section");
    assert.equal(target._prototypeOwnerId, "0,0");
    assert.equal(target._prototypeOwnerSignature, "section:0,0");
    assert.equal(objectState.dirtyRuntimeObjects.has(target), true);
    assert.equal(objectState.captureScanNeeded, true);
    assert.equal(captureCalls, 1);
    assert.deepEqual(restoreRef, {
        placementId: "building:test-house",
        floorId: "upper",
        recordId: 99,
        changed: true
    });
});

test("simulation loop advances active move object drags without pointer movement", () => {
    const source = fs.readFileSync(
        path.join(__dirname, "../public/assets/javascript/runaround.js"),
        "utf8"
    );
    const runStep = source.slice(
        source.indexOf("function runSimulationStep()"),
        source.indexOf("// Calculate desired movement direction from input")
    );

    assert.match(runStep, /SpellSystem\.updateDragPreview\(wizard,\s*mousePos\.worldX,\s*mousePos\.worldY\)/);
});

test("map node building cache dirtying honors transient move suppression flag", () => {
    const source = fs.readFileSync(
        path.join(__dirname, "../public/assets/javascript/Map.js"),
        "utf8"
    );

    assert.match(source, /obj\._suppressBuildingRenderCacheDirty !== true/);
    assert.match(source, /removed\._suppressBuildingRenderCacheDirty !== true/);
});

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
        frameCount: 0,
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
        path.join(__dirname, "../public/assets/javascript/shared/FloorSupport.js"),
        path.join(__dirname, "../public/assets/javascript/spells/Spell.js"),
        path.join(__dirname, "../public/assets/javascript/spells/editor/PlaceObject.js"),
        path.join(__dirname, "../public/assets/javascript/spells/editor/SpawnAnimal.js")
    ];
    for (const filePath of files) {
        vm.runInContext(fs.readFileSync(filePath, "utf8"), context, { filename: filePath });
    }
    return { context, messages };
}

function loadPlaceObjectContext() {
    const messages = [];
    const createdObjects = [];
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
        clearTimeout() {},
        message(text) {
            messages.push(String(text));
        }
    };
    context.globalThis = context;
    context.window = context;
    context.PlacedObject = class {
        constructor(location, map, options) {
            Object.assign(this, location);
            Object.assign(this, options);
            this.map = map;
            this.type = "placedObject";
            createdObjects.push(this);
        }
    };
    context.wizard = {
        selectedPlaceableCategory: "furniture",
        selectedPlaceableTexturePath: "/assets/images/furniture/chair.png",
        selectedPlaceableScale: 1,
        selectedPlaceableAnchorX: 0.5,
        selectedPlaceableAnchorY: 1,
        selectedPlaceableRotation: 0,
        selectedPlaceableRotationAxis: "visual",
        currentLayer: 0,
        currentLayerBaseZ: 0,
        traversalLayer: 0,
        map: null
    };
    vm.createContext(context);
    const files = [
        path.join(__dirname, "../public/assets/javascript/shared/FloorSupport.js"),
        path.join(__dirname, "../public/assets/javascript/spells/editor/FloorFragmentEdit.js"),
        path.join(__dirname, "../public/assets/javascript/spells/Spell.js"),
        path.join(__dirname, "../public/assets/javascript/spells/editor/PlaceObject.js"),
        path.join(__dirname, "../public/assets/javascript/spells/SpellSystem.js")
    ];
    for (const filePath of files) {
        vm.runInContext(fs.readFileSync(filePath, "utf8"), context, { filename: filePath });
    }
    return { context, messages, createdObjects };
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

test("spawn animal uses visible building floor support for editor placement", () => {
    const { context } = loadSpawnAnimalContext();
    const floorRecord = {
        fragmentId: "building:house:floor:upper",
        surfaceId: "building:house:surface:upper",
        ownerType: "building",
        ownerId: "building:house",
        ownerSectionKey: "building:house",
        renderedByBuildingCutaway: true,
        level: 1,
        nodeBaseZ: 3
    };
    const baseNode = { xindex: 2, yindex: 2, x: 2, y: 2 };
    const floorNode = {
        xindex: 2,
        yindex: 2,
        traversalLayer: 1,
        level: 1,
        baseZ: 3,
        surfaceId: floorRecord.surfaceId,
        fragmentId: floorRecord.fragmentId,
        sourceNode: baseNode
    };
    context.resolveEditorPlacementTarget = () => ({
        x: 2,
        y: 2,
        layer: 1,
        baseZ: 3,
        node: floorNode,
        floorTarget: { fragment: floorRecord, point: { x: 2, y: 2 }, level: 1, baseZ: 3 }
    });
    context.wizard.map = {
        floorsById: new context.Map([[floorRecord.fragmentId, floorRecord]]),
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
            assert.equal(options.sectionKey, "building:house");
            assert.equal(options.fragmentId, floorRecord.fragmentId);
            assert.equal(options.surfaceId, floorRecord.surfaceId);
            return floorNode;
        },
        setActorCurrentMovementSupport(actor, support) {
            const fragment = support.fragment || floorRecord;
            actor.currentMovementSupport = {
                type: support.type,
                layer: support.layer,
                baseZ: support.baseZ,
                fragmentId: support.fragmentId,
                surfaceId: support.surfaceId,
                ownerType: fragment.ownerType,
                ownerId: fragment.ownerId,
                sectionKey: fragment.ownerSectionKey
            };
            actor.currentLayer = support.layer;
            actor.traversalLayer = support.layer;
            actor.currentLayerBaseZ = support.baseZ;
            actor.surfaceId = support.surfaceId || fragment.surfaceId;
            actor.fragmentId = support.fragmentId || fragment.fragmentId;
            actor.node = support.node;
            actor.z = support.baseZ;
            return actor.currentMovementSupport;
        }
    };

    const spell = new context.SpawnAnimal();
    spell.cast(10, 20, { screenX: 2, screenY: 2 });

    assert.equal(context.animals.length, 1);
    assert.equal(context.animals[0].x, 2);
    assert.equal(context.animals[0].y, 2);
    assert.equal(context.animals[0].node, floorNode);
    assert.equal(context.animals[0].currentMovementSupport.ownerType, "building");
    assert.equal(context.animals[0].currentMovementSupport.ownerId, "building:house");
    assert.equal(context.animals[0]._floorMembership.ownerType, "building");
    assert.equal(context.animals[0]._floorMembership.ownerId, "building:house");
    assert.equal(context.animals[0]._floorMembership.floorId, "upper");
    assert.equal(context.animals[0]._floorMembership.level, 1);
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

test("spell target aim point uses prototype building geometric center", () => {
    const context = loadSpellContext();
    const aim = context.getSpellTargetAimPoint(
        { map: null },
        {
            type: "prototypeBuildingPlacement",
            x: 4,
            y: 5,
            z: 0,
            rotationAxis: "ground",
            width: 10,
            height: 8,
            _depthBillboardWorldPositions: [
                1, 2, 0,
                9, 2, 0,
                9, 2, 6,
                1, 2, 6
            ],
            spellTargetPoint: null
        }
    );

    assert.equal(aim.x, 4);
    assert.equal(aim.y, 5);
    assert.equal(aim.z, 0);
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

test("fireball can ignite a directly picked building placement", () => {
    const context = loadProjectileSpellContext();
    const fireball = new context.Fireball();
    const target = {
        type: "prototypeBuildingPlacement",
        x: 11,
        y: 12,
        z: 0,
        hp: 100,
        maxHp: 100,
        flamability: 1,
        isOnFire: false,
        ignite() {
            this.isOnFire = true;
        }
    };
    fireball.x = 11;
    fireball.y = 12;
    fireball.radius = 0.25;
    fireball.forcedTarget = target;
    context.onscreenObjects = [];

    fireball.land();

    assert.equal(target.hp < 100, true);
    assert.equal(target.isOnFire, true);
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

test("vanish invalidates prototype building interior bitmap when target starts vanishing", () => {
    const context = loadVanishContext();
    const vanish = new context.Vanish();
    let invalidation = null;
    const target = {
        type: "furniture",
        gone: false,
        vanishing: false,
        _floorMembership: {
            ownerType: "building",
            ownerId: "building:placed-1",
            floorId: "floor-fragment-2"
        },
        map: {
            invalidatePrototypeBuildingInteriorBitmap(ref) {
                invalidation = ref;
            }
        }
    };

    assert.equal(vanish.beginTargetVanish(target, { x: 1, y: 2 }), true);

    assert.equal(invalidation.placementId, "building:placed-1");
    assert.equal(invalidation.floorId, "floor-fragment-2");
    assert.equal(target.vanishing, true);
});

test("editor vanish invalidates prototype building interior bitmap before removal", () => {
    const context = loadVanishContext();
    const vanish = new context.EditorVanish();
    const calls = [];
    const target = {
        type: "furniture",
        gone: false,
        vanishing: false,
        _floorMembership: {
            ownerType: "building",
            ownerId: "building:placed-1",
            floorId: "floor-fragment-2"
        },
        map: {
            invalidatePrototypeBuildingInteriorBitmap(ref) {
                calls.push({
                    ref,
                    vanishing: target.vanishing,
                    gone: target.gone
                });
            }
        },
        removeFromGame() {
            this.gone = true;
        }
    };

    vanish.vanishTarget(target, { x: 1, y: 2 });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].ref.placementId, "building:placed-1");
    assert.equal(calls[0].ref.floorId, "floor-fragment-2");
    assert.equal(calls[0].vanishing, true);
    assert.equal(calls[0].gone, false);
    assert.equal(target.gone, true);
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

test("visible floor target projects empty upper-floor clicks onto visible ground", () => {
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

    const target = context.SpellSystem.resolveVisibleFloorTarget(wizard, 2, 2, { screenX: 2, screenY: 2 });

    assert.equal(target.x, 2);
    assert.equal(target.y, -19);
    assert.equal(target.layer, 0);
    assert.equal(target.baseZ, 0);
    assert.equal(target.node, groundNode);
});

test("teleport visual target remains a compatibility wrapper for visible floor targeting", () => {
    const context = loadSpellContext();
    context.viewport = { x: 0, y: 0, z: 0 };
    context.viewscale = 1;
    context.xyratio = 1;
    const groundNode = { xindex: 2, yindex: 2, traversalLayer: 0, baseZ: 0 };
    const wizard = {
        x: 0,
        y: 0,
        currentLayer: 0,
        map: {
            floorsById: new context.Map(),
            wrapWorldX: x => x,
            wrapWorldY: y => y,
            worldToNode() {
                return groundNode;
            }
        }
    };

    const visibleTarget = context.SpellSystem.resolveVisibleFloorTarget(wizard, 2, 2, { screenX: 2, screenY: 2 });
    const teleportTarget = context.SpellSystem.resolveTeleportVisualTarget(wizard, 2, 2, { screenX: 2, screenY: 2 });

    assert.equal(context.resolveVisibleFloorTarget, context.SpellSystem.resolveVisibleFloorTarget);
    assert.equal(visibleTarget.x, teleportTarget.x);
    assert.equal(visibleTarget.y, teleportTarget.y);
    assert.equal(visibleTarget.layer, teleportTarget.layer);
    assert.equal(visibleTarget.baseZ, teleportTarget.baseZ);
    assert.equal(visibleTarget.node, teleportTarget.node);
});

test("visible floor target selects the highest visible floor under the cursor", () => {
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
                assert.equal(options.worldX, 2);
                assert.equal(options.worldY, -10);
                return floorNode;
            }
        }
    };

    const target = context.SpellSystem.resolveVisibleFloorTarget(wizard, 2, 2, { screenX: 2, screenY: 2 });

    assert.equal(target.x, 2);
    assert.equal(target.y, -10);
    assert.equal(target.layer, 3);
    assert.equal(target.baseZ, 9);
    assert.equal(target.node, floorNode);
});

test("visible floor target can select upper floors while wizard is on ground", () => {
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
                assert.equal(options.worldX, 2);
                assert.equal(options.worldY, 11);
                return upperNode;
            }
        }
    };

    const target = context.SpellSystem.resolveVisibleFloorTarget(wizard, 2, 2, { screenX: 2, screenY: 2 });

    assert.equal(target.x, 2);
    assert.equal(target.y, 11);
    assert.equal(target.layer, 3);
    assert.equal(target.baseZ, 9);
    assert.equal(target.node, upperNode);
});

test("visible floor target ignores upper floors during interior view", () => {
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

    const target = context.SpellSystem.resolveVisibleFloorTarget(wizard, 2, 2, { screenX: 2, screenY: 2 });

    assert.equal(target.x, 2);
    assert.equal(target.y, 2);
    assert.equal(target.layer, 1);
    assert.equal(target.baseZ, 3);
    assert.equal(target.node, currentFloorNode);
});

test("visible floor target uses rendered prototype interior floor fragments", () => {
    const context = loadSpellContext();
    context.viewport = { x: 0, y: 0, z: 0 };
    context.viewscale = 1;
    context.xyratio = 1;
    const upperFloor = {
        fragmentId: "tower-placement:floor:upper",
        surfaceId: "tower-placement:surface:upper",
        ownerSectionKey: "tower-placement",
        renderedByBuildingCutaway: true,
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
    const baseNode = { xindex: 2, yindex: 2 };
    const upperNode = {
        xindex: 2,
        yindex: 2,
        traversalLayer: 1,
        baseZ: 3,
        fragmentId: upperFloor.fragmentId,
        surfaceId: upperFloor.surfaceId
    };
    context.Rendering = {
        isBuildingInteriorPresentationActive(ctx) {
            assert.equal(ctx.wizard.currentLayer, 0);
            return true;
        },
        getBuildingInteriorVisibleFloorFragmentIds(ctx) {
            assert.equal(ctx.wizard.currentLayer, 0);
            return new context.Set([upperFloor.fragmentId]);
        }
    };
    const wizard = {
        x: 0,
        y: 0,
        currentLayer: 0,
        map: {
            floorsById: new context.Map([[upperFloor.fragmentId, upperFloor]]),
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
                assert.equal(options.sectionKey, "tower-placement");
                assert.equal(options.fragmentId, upperFloor.fragmentId);
                assert.equal(options.surfaceId, upperFloor.surfaceId);
                assert.equal(options.worldX, 2);
                assert.equal(options.worldY, 2);
                return upperNode;
            }
        }
    };

    const target = context.SpellSystem.resolveVisibleFloorTarget(wizard, 2, 2, { screenX: 2, screenY: 2 });

    assert.equal(target.x, 2);
    assert.equal(target.y, 2);
    assert.equal(target.layer, 1);
    assert.equal(target.baseZ, 3);
    assert.equal(target.node, upperNode);
    assert.equal(target.floorTarget.fragment, upperFloor);
});

test("placed objects use rendered building floor support under the cursor", () => {
    const { context, createdObjects } = loadPlaceObjectContext();
    context.viewport = { x: 0, y: 0, z: 0 };
    context.viewscale = 1;
    context.xyratio = 1;
    const floorRecord = {
        fragmentId: "building:house:floor:upper",
        surfaceId: "building:house:surface:upper",
        ownerType: "building",
        ownerId: "building:house",
        ownerSectionKey: "building:house",
        renderedByBuildingCutaway: true,
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
    const baseNode = { xindex: 2, yindex: 2, x: 2, y: 2 };
    const floorNode = {
        xindex: 2,
        yindex: 2,
        traversalLayer: 1,
        level: 1,
        baseZ: 3,
        surfaceId: floorRecord.surfaceId,
        fragmentId: floorRecord.fragmentId,
        sourceNode: baseNode
    };
    let manifestObject = null;
    context.Rendering = {
        isBuildingInteriorPresentationActive(ctx) {
            assert.equal(ctx.wizard.currentLayer, 0);
            return true;
        },
        getBuildingInteriorVisibleFloorFragmentIds(ctx) {
            assert.equal(ctx.wizard.currentLayer, 0);
            return new context.Set([floorRecord.fragmentId]);
        }
    };
    context.wizard.selectedPlaceableAnchorY = 0.5;
    context.wizard.map = {
        floorsById: new context.Map([[floorRecord.fragmentId, floorRecord]]),
        objects: [],
        _prototypeObjectState: { dirtyRuntimeObjects: new context.Set(), captureScanNeeded: false },
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
            assert.equal(options.sectionKey, "building:house");
            assert.equal(options.fragmentId, floorRecord.fragmentId);
            assert.equal(options.surfaceId, floorRecord.surfaceId);
            assert.equal(options.worldX, 2);
            assert.equal(options.worldY, 2);
            return floorNode;
        },
        setActorCurrentMovementSupport(actor, support) {
            if (!Number.isFinite(actor.currentLayerBaseZ)) {
                throw new Error("actor placedObject movement support requires currentLayerBaseZ");
            }
            const fragment = support.fragment || floorRecord;
            actor.currentMovementSupport = {
                type: support.type,
                layer: support.layer,
                baseZ: support.baseZ,
                fragmentId: support.fragmentId,
                surfaceId: support.surfaceId,
                ownerType: fragment.ownerType,
                ownerId: fragment.ownerId || "",
                sectionKey: fragment.ownerSectionKey
            };
            actor.currentLayer = support.layer;
            actor.traversalLayer = support.layer;
            actor.currentLayerBaseZ = support.baseZ;
            actor.surfaceId = support.surfaceId || fragment.surfaceId;
            actor.fragmentId = support.fragmentId || fragment.fragmentId;
            actor.node = support.node;
            actor.z = support.baseZ;
            return actor.currentMovementSupport;
        },
        addObjectToFloorBuildingManifest(object, placement) {
            manifestObject = { object, placement };
        },
        markBuildingRenderCacheDirty() {}
    };

    const spell = new context.PlaceObject();
    spell.cast(10, 20, { screenX: 2, screenY: 2 });

    assert.equal(createdObjects.length, 1);
    const placed = createdObjects[0];
    assert.equal(placed.x, 2);
    assert.equal(placed.y, 2);
    assert.equal(placed.z, 0);
    assert.equal(placed.traversalLayer, 1);
    assert.equal(placed.currentLayerBaseZ, 3);
    assert.equal(placed.node, floorNode);
    assert.equal(placed.surfaceId, floorRecord.surfaceId);
    assert.equal(placed.fragmentId, floorRecord.fragmentId);
    assert.equal(placed.currentMovementSupport.ownerType, "building");
    assert.equal(placed.currentMovementSupport.ownerId, "building:house");
    assert.equal(context.wizard.map._prototypeObjectState.dirtyRuntimeObjects.has(placed), true);
    assert.equal(context.wizard.map._prototypeObjectState.captureScanNeeded, true);
    assert.equal(manifestObject, null);
});

test("placed objects keep legacy floor building manifest support for ad-hoc upper floors", () => {
    const { context, createdObjects } = loadPlaceObjectContext();
    context.viewport = { x: 0, y: 0, z: 0 };
    context.viewscale = 1;
    context.xyratio = 1;
    const floorRecord = {
        fragmentId: "ad-hoc-upper-floor",
        surfaceId: "ad-hoc-upper-surface",
        ownerType: "section",
        ownerSectionKey: "0,0",
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
    const baseNode = { xindex: 2, yindex: 2, x: 2, y: 2 };
    const floorNode = {
        xindex: 2,
        yindex: 2,
        traversalLayer: 1,
        level: 1,
        baseZ: 3,
        surfaceId: floorRecord.surfaceId,
        fragmentId: floorRecord.fragmentId,
        sourceNode: baseNode
    };
    let manifestObject = null;
    context.Rendering = {
        isBuildingInteriorPresentationActive() {
            return true;
        },
        getBuildingInteriorVisibleFloorFragmentIds() {
            return new context.Set([floorRecord.fragmentId]);
        }
    };
    context.wizard.selectedPlaceableAnchorY = 0.5;
    context.wizard.currentLayer = 1;
    context.wizard.currentLayerBaseZ = 3;
    context.wizard.traversalLayer = 1;
    context.wizard.map = {
        floorsById: new context.Map([[floorRecord.fragmentId, floorRecord]]),
        objects: [],
        _prototypeObjectState: { dirtyRuntimeObjects: new context.Set(), captureScanNeeded: false },
        wrapWorldX: x => x,
        wrapWorldY: y => y,
        worldToNode() {
            return baseNode;
        },
        getFloorNodeAtLayer() {
            return floorNode;
        },
        setActorCurrentMovementSupport(actor, support) {
            const fragment = support.fragment || floorRecord;
            actor.currentMovementSupport = {
                type: support.type,
                layer: support.layer,
                baseZ: support.baseZ,
                fragmentId: support.fragmentId,
                surfaceId: support.surfaceId,
                ownerType: fragment.ownerType,
                ownerId: fragment.ownerId || "",
                sectionKey: fragment.ownerSectionKey
            };
            actor.currentLayer = support.layer;
            actor.traversalLayer = support.layer;
            actor.currentLayerBaseZ = support.baseZ;
            actor.surfaceId = support.surfaceId || fragment.surfaceId;
            actor.fragmentId = support.fragmentId || fragment.fragmentId;
            actor.node = support.node;
            actor.z = support.baseZ;
            return actor.currentMovementSupport;
        },
        addObjectToFloorBuildingManifest(object, placement) {
            manifestObject = { object, placement };
        },
        markBuildingRenderCacheDirty() {}
    };

    const spell = new context.PlaceObject();
    spell.cast(10, 20, { screenX: 2, screenY: 2, useVisibleFloorTarget: false });

    assert.equal(createdObjects.length, 1);
    const placed = createdObjects[0];
    assert.equal(manifestObject.object, placed);
    assert.equal(manifestObject.placement.fragmentId, floorRecord.fragmentId);
    assert.equal(manifestObject.placement.surfaceId, floorRecord.surfaceId);
    assert.equal(manifestObject.placement.level, 1);
});

test("powerup placement uses rendered building floor support under the cursor", () => {
    const { context } = loadPlaceObjectContext();
    context.viewport = { x: 0, y: 0, z: 0 };
    context.viewscale = 1;
    context.xyratio = 1;
    const placedPowerups = [];
    const floorRecord = {
        fragmentId: "building:house:floor:upper",
        surfaceId: "building:house:surface:upper",
        ownerType: "building",
        ownerId: "building:house",
        ownerSectionKey: "building:house",
        renderedByBuildingCutaway: true,
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
    const baseNode = { xindex: 2, yindex: 2, x: 2, y: 2 };
    const floorNode = {
        xindex: 2,
        yindex: 2,
        traversalLayer: 1,
        level: 1,
        baseZ: 3,
        surfaceId: floorRecord.surfaceId,
        fragmentId: floorRecord.fragmentId,
        sourceNode: baseNode
    };
    context.Rendering = {
        isBuildingInteriorPresentationActive() {
            return true;
        },
        getBuildingInteriorVisibleFloorFragmentIds() {
            return new context.Set([floorRecord.fragmentId]);
        }
    };
    context.addPowerup = (fileName, options) => {
        const powerup = { type: "powerup", fileName, ...options };
        placedPowerups.push(powerup);
        return powerup;
    };
    context.wizard.currentSpell = "blackdiamond";
    context.wizard.cooldownTime = 0.1;
    context.wizard.selectedPowerupPlacementScale = 1;
    context.wizard.map = {
        floorsById: new context.Map([[floorRecord.fragmentId, floorRecord]]),
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
            assert.equal(options.fragmentId, floorRecord.fragmentId);
            assert.equal(options.surfaceId, floorRecord.surfaceId);
            return floorNode;
        },
        setActorCurrentMovementSupport(actor, support) {
            actor.currentMovementSupport = {
                type: support.type,
                layer: support.layer,
                baseZ: support.baseZ,
                fragmentId: support.fragmentId,
                surfaceId: support.surfaceId,
                ownerType: support.fragment.ownerType,
                ownerId: support.fragment.ownerId,
                sectionKey: support.fragment.ownerSectionKey
            };
            actor.currentLayer = support.layer;
            actor.traversalLayer = support.layer;
            actor.currentLayerBaseZ = support.baseZ;
            actor.node = support.node;
            actor.z = support.baseZ;
            return actor.currentMovementSupport;
        }
    };

    context.SpellSystem.castWizardSpell(context.wizard, 10, 20, { screenX: 2, screenY: 2 });

    assert.equal(placedPowerups.length, 1);
    const placed = placedPowerups[0];
    assert.equal(placed.x, 2);
    assert.equal(placed.y, 2);
    assert.equal(placed.z, 0);
    assert.equal(placed.traversalLayer, 1);
    assert.equal(placed.currentLayerBaseZ, 3);
    assert.equal(placed.node, floorNode);
    assert.equal(placed.surfaceId, floorRecord.surfaceId);
    assert.equal(placed.fragmentId, floorRecord.fragmentId);
    assert.equal(placed.currentMovementSupport.ownerType, "building");
    assert.equal(placed.currentMovementSupport.ownerId, "building:house");
});

test("visible floor target keeps ground above underground fragments", () => {
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

    const target = context.SpellSystem.resolveVisibleFloorTarget(wizard, 2, 2, { screenX: 2, screenY: 2 });

    assert.equal(target.x, 2);
    assert.equal(target.y, 2);
    assert.equal(target.layer, 0);
    assert.equal(target.baseZ, 0);
    assert.equal(target.node, groundNode);
});

test("visible floor target fails underground clicks with no floor fragment", () => {
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

    const target = context.SpellSystem.resolveVisibleFloorTarget(wizard, 2, 2, { screenX: 2, screenY: 2 });

    assert.equal(target.x, 2);
    assert.equal(target.y, 2);
    assert.equal(target.layer, -1);
    assert.equal(target.baseZ, -3);
    assert.equal(target.node, null);
    assert.equal(target.floorTarget, null);
});

test("visible floor target stays on the current underground floor", () => {
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

    const target = context.SpellSystem.resolveVisibleFloorTarget(wizard, 2, 2, { screenX: 2, screenY: 2 });

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

test("teleport cast refreshes the outdoor prototype bubble after leaving building scope", () => {
    const { context } = loadTeleportContext();
    const bubbleUpdates = [];
    context.wizard.map.getPrototypeWorldScope = () => ({ type: "sectionWorld" });
    context.wizard.map.updatePrototypeSectionBubble = (actor, options) => {
        bubbleUpdates.push({ actor, options });
        return true;
    };
    const destinationNode = { xindex: 2, yindex: 3, traversalLayer: 0, baseZ: 0 };
    const spell = new context.Teleport();

    spell.cast(2, 3, { destinationNode, destinationLayer: 0, destinationBaseZ: 0 });

    assert.equal(bubbleUpdates.length, 1);
    assert.equal(bubbleUpdates[0].actor, context.wizard);
    assert.equal(bubbleUpdates[0].options.force, true);
    assert.equal(bubbleUpdates[0].options.advanceImmediately, true);
    assert.equal(bubbleUpdates[0].options.reason, "teleport");
});

test("teleport cast preserves building-scope bubble suspension after entering a building", () => {
    const { context } = loadTeleportContext();
    const bubbleUpdates = [];
    context.wizard.map.getPrototypeWorldScope = () => ({ type: "building", id: "building:placed-3" });
    context.wizard.map.updatePrototypeSectionBubble = (actor, options) => {
        bubbleUpdates.push({ actor, options });
        return false;
    };
    const destinationNode = {
        xindex: 2,
        yindex: 3,
        traversalLayer: 1,
        baseZ: 30,
        fragmentId: "building:placed-3:floor:floor-fragment-90",
        surfaceId: "building:placed-3:surface:floor-fragment-90"
    };
    const spell = new context.Teleport();

    spell.cast(2, 3, { destinationNode, destinationLayer: 1, destinationBaseZ: 30 });

    assert.equal(bubbleUpdates.length, 1);
    assert.equal(bubbleUpdates[0].actor, context.wizard);
    assert.equal(bubbleUpdates[0].options.force, undefined);
    assert.equal(bubbleUpdates[0].options.advanceImmediately, undefined);
    assert.equal(bubbleUpdates[0].options.reason, "teleport");
});

test("teleport cast accepts a floor fragment destination without a node", () => {
    const { context } = loadTeleportContext();
    const spell = new context.Teleport();

    spell.cast(-145.5, 191.25, {
        destinationNode: null,
        destinationLayer: 1,
        destinationBaseZ: 30,
        destinationFragmentId: "building:placed-3:floor:floor-fragment-90",
        destinationSurfaceId: "building:placed-3:surface:floor-fragment-90"
    });

    assert.equal(context.wizard.x, -145.5);
    assert.equal(context.wizard.y, 191.25);
    assert.equal(context.wizard.node, null);
    assert.equal(context.wizard.currentLayer, 1);
    assert.equal(context.wizard.traversalLayer, 1);
    assert.equal(context.wizard.currentLayerBaseZ, 30);
    assert.equal(context.wizard.fragmentId, "building:placed-3:floor:floor-fragment-90");
    assert.equal(context.wizard.surfaceId, "building:placed-3:surface:floor-fragment-90");
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
