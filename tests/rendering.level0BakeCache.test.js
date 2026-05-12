const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadRenderingImpl(options = {}) {
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
        polygonClipping: options.polygonClipping || require("polygon-clipping"),
        Character: class {},
        RenderingCamera: class {},
        RenderingLayers: class {}
    };
    context.window = context;
    context.globalThis = context;

    vm.createContext(context);
    const buildingInteriorViewSource = fs.readFileSync(
        path.join(__dirname, "../public/assets/javascript/rendering/BuildingInteriorView.js"),
        "utf8"
    );
    vm.runInContext(buildingInteriorViewSource, context, { filename: "BuildingInteriorView.js" });
    const source = fs.readFileSync(
        path.join(__dirname, "../public/assets/javascript/rendering/Rendering.js"),
        "utf8"
    ).replace(
        "    let singleton = null;",
        "    global.__RenderingImpl = RenderingImpl;\n\n    let singleton = null;"
    );
    vm.runInContext(source, context, { filename: "Rendering.js" });
    context.__RenderingImpl.__testContext = context;
    return context.__RenderingImpl;
}

function makeNode(xindex, yindex) {
    return { xindex, yindex, neighbors: [] };
}

test("level 0 ground bake nodes are expanded once per stable bubble", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    const sectionNode = makeNode(0, 0);
    const neighborNode = makeNode(1, 0);
    sectionNode.neighbors = [neighborNode];
    const map = {
        _prototypeSectionState: {
            activeCenterKey: "0,0",
            loadedNodes: [sectionNode, neighborNode],
            nodesBySectionKey: new Map([["0,0", [sectionNode]]])
        }
    };
    let expandCalls = 0;
    renderer.expandLevel0GroundBakeNodes = (nodes) => {
        expandCalls += 1;
        return nodes.concat(neighborNode);
    };

    const first = renderer.getLevel0GroundSurfaceBakeNodes(map, "0,0");
    const second = renderer.getLevel0GroundSurfaceBakeNodes(map, "0,0");

    assert.equal(expandCalls, 1);
    assert.equal(second, first);

    map._prototypeSectionState.activeCenterKey = "1,0";
    const afterCenterMove = renderer.getLevel0GroundSurfaceBakeNodes(map, "0,0");

    assert.equal(expandCalls, 2);
    assert.notEqual(afterCenterMove, first);
});

test("evicting a level 0 ground texture also evicts its bake-node cache", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    renderer.level0GroundSurfaceCache.set("old", {
        texture: { destroy() {} }
    });
    renderer.level0GroundSurfaceBakeNodeCache.set("old", {
        signature: "stale",
        nodes: []
    });

    renderer.getBakedLevel0SectionKeys({
        map: {
            _prototypeSectionState: {
                sectionAssetsByKey: new Map(),
                nodesBySectionKey: new Map()
            }
        }
    });

    assert.equal(renderer.level0GroundSurfaceCache.has("old"), false);
    assert.equal(renderer.level0GroundSurfaceBakeNodeCache.has("old"), false);
});

test("character render items use absolute world z instead of adding layer base", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    const { Character } = RenderingImpl.__testContext;
    const actor = new Character();
    actor.traversalLayer = -2;
    actor.z = -6;

    assert.equal(renderer.getLayerIndexForObject(actor), -2);
    assert.equal(renderer.getLayerBaseZForObject(actor), 0);
});

test("character overlay projection uses interpolated absolute world z", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    const { Character } = RenderingImpl.__testContext;
    const actor = new Character();
    actor.x = 1;
    actor.y = 2;
    actor.z = 3;
    actor.currentLayerBaseZ = 3;
    actor.getInterpolatedPosition = () => ({ x: 4, y: 5, z: 6 });
    const calls = [];
    renderer.camera = {
        worldToScreen(x, y, z = 0) {
            calls.push({ x, y, z });
            return { x, y: y - z };
        }
    };

    const point = renderer.getRenderItemOverlayScreenPoint(actor, 0.75);

    assert.deepEqual(calls, [{ x: 4, y: 5, z: 6.75 }]);
    assert.deepEqual(point, { x: 4, y: -1.75 });
});

test("non-character render items still use local z plus layer base", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    const item = { traversalLayer: -2, z: 0 };

    assert.equal(renderer.getLayerIndexForObject(item), -2);
    assert.equal(renderer.getLayerBaseZForObject(item), -6);
});

test("upper layer fade does not globally hide layers above the wizard", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    RenderingImpl.__testContext.wizard = { currentLayer: 0 };
    renderer._lastRenderedWizardLayer = 0;

    assert.equal(renderer.getLayerFadeMultiplier(1, 0), 1);
});

test("visible object collection includes objects attached to upper floor nodes", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    renderer.beginFrameMetrics();
    const floorObject = {
        type: "placedObject",
        traversalLayer: 1,
        gone: false,
        vanishing: false
    };
    const floorNode = {
        id: "floor:upper:node",
        xindex: -170,
        yindex: 201,
        x: -147.22,
        y: 201.5,
        traversalLayer: 1,
        objects: [floorObject],
        visibilityObjects: []
    };
    const map = {
        floorNodesById: new Map([["floor:upper", [floorNode]]])
    };
    const visibleObjects = renderer.collectVisibleObjects([], {
        map,
        camera: { x: -150, y: 198 },
        viewport: { width: 20, height: 20 },
        animals: [],
        animalsPreFilteredVisible: true
    });

    assert.equal(visibleObjects.length, 1);
    assert.equal(visibleObjects[0], floorObject);
    assert.equal(floorObject._renderTraversalLayer, 1);
    assert.equal(renderer.currentFrameMetrics.visibleFloorObjectNodes, 1);
});

test("upper-layer ground objects render in the depth layer instead of the ground layer", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    const makeContainer = (name) => ({
        name,
        children: [],
        addChild(child) {
            if (!this.children.includes(child)) this.children.push(child);
            child.parent = this;
            return child;
        }
    });
    const groundObjects = makeContainer("renderingGroundObjects");
    const depthObjects = makeContainer("renderingDepthObjects");
    renderer.layers = {
        groundObjects,
        depthObjects,
        characters: makeContainer("renderingCharacters")
    };
    renderer.getCharacterLayer = () => renderer.layers.characters;
    renderer.isScriptVisible = () => true;
    renderer.applyScriptBrightness = () => {};
    renderer.applyFrozenTint = () => {};
    renderer.applyLayerDarknessForItem = () => {};
    renderer.applySinkClip = () => true;
    renderer.addPickRenderItem = () => {};
    renderer.isLosMazeModeEnabled = () => false;
    renderer.isOmnivisionActive = () => false;
    renderer.beginFrameMetrics();

    const sprite = { visible: true, renderable: true, alpha: 1 };
    const mesh = { visible: false, renderable: false, alpha: 0, parent: null };
    const rug = {
        type: "furniture",
        category: "furniture",
        isPlacedObject: true,
        rotationAxis: "ground",
        traversalLayer: 1,
        _renderLayerIndex: 1,
        _renderLayerAlpha: 1,
        pixiSprite: sprite,
        updateDepthBillboardMesh() {
            return mesh;
        }
    };

    const rendered = renderer.renderDepthBillboardObjects({
        wizard: {},
        map: {},
        app: { screen: { width: 800, height: 600 } }
    }, [rug]);

    assert.equal(rendered.has(rug), true);
    assert.equal(mesh.parent, depthObjects);
    assert.equal(groundObjects.children.includes(mesh), false);
    assert.equal(sprite.visible, false);
});

test("building interior foreground promotion moves display object temporarily and restores it", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    const mapLayer = {
        children: [],
        sortableChildren: false,
        sortDirty: false,
        addChild(child) {
            if (child.parent && child.parent !== this && typeof child.parent.removeChild === "function") {
                child.parent.removeChild(child);
            }
            if (!this.children.includes(child)) this.children.push(child);
            child.parent = this;
            return child;
        },
        addChildAt(child, index) {
            if (child.parent && child.parent !== this && typeof child.parent.removeChild === "function") {
                child.parent.removeChild(child);
            }
            const existing = this.children.indexOf(child);
            if (existing >= 0) this.children.splice(existing, 1);
            this.children.splice(index, 0, child);
            child.parent = this;
            return child;
        },
        removeChild(child) {
            const index = this.children.indexOf(child);
            if (index >= 0) this.children.splice(index, 1);
            if (child.parent === this) child.parent = null;
            return child;
        },
        getChildIndex(child) {
            return this.children.indexOf(child);
        }
    };
    const overlayLayer = {
        children: [],
        sortableChildren: false,
        sortDirty: false,
        addChild(child) {
            this.children.push(child);
            child.parent = this;
            return child;
        },
        removeChild(child) {
            const index = this.children.indexOf(child);
            if (index >= 0) this.children.splice(index, 1);
            if (child.parent === this) child.parent = null;
            return child;
        }
    };
    const displayObj = {
        parent: mapLayer,
        state: "map-state",
        zIndex: 7,
        visible: false,
        renderable: false
    };
    mapLayer.children.push(displayObj);

    assert.equal(renderer.promoteDisplayObjectForBuildingInterior(displayObj, overlayLayer), true);

    assert.equal(displayObj.parent, overlayLayer);
    assert.equal(overlayLayer.children[0], displayObj);
    assert.equal(displayObj.visible, true);
    assert.equal(displayObj.renderable, true);
    assert.equal(displayObj.zIndex, 2147483650);
    assert.equal(overlayLayer.sortableChildren, true);

    renderer.clearBuildingInteriorForegroundPromotions();

    assert.equal(displayObj.parent, mapLayer);
    assert.equal(overlayLayer.children.length, 0);
    assert.equal(mapLayer.children[0], displayObj);
    assert.equal(displayObj.state, "map-state");
    assert.equal(displayObj.zIndex, 7);
    assert.equal(displayObj.visible, false);
    assert.equal(displayObj.renderable, false);
});

test("building interior foreground restore skips display objects destroyed by vanish", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    const mapLayer = {
        children: [],
        addChildAt() {
            throw new Error("destroyed display objects must not be re-added");
        },
        getChildIndex() {
            return 0;
        },
        removeChild(child) {
            const index = this.children.indexOf(child);
            if (index >= 0) this.children.splice(index, 1);
            if (child.parent === this) child.parent = null;
        }
    };
    const overlayLayer = {
        children: [],
        addChild(child) {
            if (child.parent && child.parent !== this && typeof child.parent.removeChild === "function") {
                child.parent.removeChild(child);
            }
            if (!this.children.includes(child)) this.children.push(child);
            child.parent = this;
        },
        removeChild(child) {
            const index = this.children.indexOf(child);
            if (index >= 0) this.children.splice(index, 1);
            if (child.parent === this) child.parent = null;
        }
    };
    const displayObj = {
        parent: mapLayer,
        state: "map-state",
        zIndex: 7,
        visible: true,
        renderable: true,
        transform: {}
    };
    mapLayer.children.push(displayObj);

    assert.equal(renderer.promoteDisplayObjectForBuildingInterior(displayObj, overlayLayer), true);

    displayObj.destroyed = true;
    displayObj.transform = null;

    assert.doesNotThrow(() => renderer.clearBuildingInteriorForegroundPromotions());
    assert.equal(renderer._buildingInteriorForegroundPromotions.length, 0);
});

test("building interior overlay floor clips real floor texture entries", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    const texture = { id: "floor-texture" };
    const textureBounds = { minX: 0, minY: 0, width: 10, height: 10 };
    renderer.collectFloorVisualEntries = () => [{
        key: "real-floor",
        level: 1,
        baseZ: 3,
        outer: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 }
        ],
        holes: [],
        texture,
        textureBounds,
        textureRepeat: null,
        texturePath: "/floor.png",
        tint: 0xabcdef,
        alpha: 0.1,
        depthBias: 0.001,
        isHoleOverlay: false
    }];

    const entries = renderer.collectBuildingInteriorOverlayFloorEntries({}, {
        id: "active",
        level: 1,
        polygon: {
            outer: [
                { x: 2, y: 2 },
                { x: 8, y: 2 },
                { x: 8, y: 8 },
                { x: 2, y: 8 }
            ],
            holes: []
        }
    }, { buildingId: "house" });

    assert.equal(entries.length, 1);
    assert.equal(entries[0].texture, texture);
    assert.equal(entries[0].textureBounds, textureBounds);
    assert.equal(entries[0].texturePath, "/floor.png");
    assert.equal(entries[0].tint, 0xabcdef);
    assert.equal(entries[0].alpha, 1);
    assert.equal(JSON.stringify(entries[0].outer.map(pt => ({ x: pt.x, y: pt.y }))), JSON.stringify([
        { x: 2, y: 2 },
        { x: 8, y: 2 },
        { x: 8, y: 8 },
        { x: 2, y: 8 }
    ]));
});

test("interior presentation foreground promotes spell and selection overlays", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    const makeContainer = () => ({
        children: [],
        sortableChildren: false,
        sortDirty: false,
        addChild(child) {
            if (child.parent && child.parent !== this && typeof child.parent.removeChild === "function") {
                child.parent.removeChild(child);
            }
            if (!this.children.includes(child)) this.children.push(child);
            child.parent = this;
        },
        removeChild(child) {
            const index = this.children.indexOf(child);
            if (index >= 0) this.children.splice(index, 1);
            if (child.parent === this) child.parent = null;
        }
    });
    const makeDisplay = (name, parent = null) => {
        const obj = { name, visible: true, renderable: true, zIndex: 0, parent: null };
        if (parent) parent.addChild(obj);
        return obj;
    };
    const ui = makeContainer();
    const entities = makeContainer();
    renderer.layers = { ui };
    renderer.getLayerCutawayState = () => ({ active: true, triggers: [{ activeInteriorRegion: { id: "inside" } }] });

    const projectileSprite = makeDisplay("projectileSprite", entities);
    const projectileParticles = makeDisplay("projectileParticles", entities);
    const highlightGraphics = makeDisplay("highlightGraphics", ui);
    const tintedDisplay = makeDisplay("tintedSelection", entities);
    const hiddenHighlight = makeDisplay("hiddenHighlight", ui);
    const wizardBody = makeDisplay("wizardBody", entities);
    const wizardHat = makeDisplay("wizardHat", entities);
    hiddenHighlight.visible = false;
    renderer.activeProjectileDisplayObjects = new Set([projectileSprite, projectileParticles]);
    renderer.scenePicker = {
        highlightGraphics,
        highlightSprite: hiddenHighlight,
        activeTintStates: new Map([[tintedDisplay, { tint: 0xffffff }]])
    };
    const wizard = {
        _renderingDepthMesh: wizardBody,
        pixiSprite: { name: "hiddenWizardSprite", visible: false, renderable: false },
        hatGraphics: wizardHat
    };

    const originalTintParent = tintedDisplay.parent;
    const originalTintZ = tintedDisplay.zIndex;
    const promoted = renderer.promoteInteriorPresentationForeground({ wizard });

    assert.equal(promoted, 5);
    assert.equal(projectileSprite.parent, ui);
    assert.equal(projectileParticles.parent, ui);
    assert.equal(highlightGraphics.parent, ui);
    assert.equal(wizardBody.parent, ui);
    assert.equal(wizardHat.parent, ui);
    assert.equal(tintedDisplay.parent, originalTintParent);
    assert.equal(hiddenHighlight.parent, ui);
    assert.equal(projectileSprite.zIndex, 2147483650);
    assert.equal(highlightGraphics.zIndex, 2147483650);
    assert.equal(wizardBody.zIndex, 2147483650);
    assert.equal(wizardHat.zIndex, 2147483650);
    assert.equal(tintedDisplay.zIndex, originalTintZ);
    assert.equal(hiddenHighlight.zIndex, 0);
});

test("place object center snap guide promotes with render context", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    const testContext = RenderingImpl.__testContext;
    class TestGraphics {
        constructor() {
            this.name = "";
            this.visible = false;
            this.parent = null;
            this.commands = [];
        }
        clear() { this.commands.length = 0; }
        lineStyle(...args) { this.commands.push(["lineStyle", ...args]); }
        beginFill(...args) { this.commands.push(["beginFill", ...args]); }
        moveTo(...args) { this.commands.push(["moveTo", ...args]); }
        lineTo(...args) { this.commands.push(["lineTo", ...args]); }
        closePath() { this.commands.push(["closePath"]); }
        endFill() { this.commands.push(["endFill"]); }
    }
    testContext.PIXI = { Graphics: TestGraphics };
    const ui = {
        children: [],
        addChild(child) {
            if (!this.children.includes(child)) this.children.push(child);
            child.parent = this;
        }
    };
    renderer.layers = { ui };
    renderer.camera = {
        viewscale: 1,
        xyratio: 1,
        worldToScreen(x, y, z = 0) {
            return { x: x + z, y: y - z };
        }
    };
    const renderContext = { map: { id: "test-map" } };
    let promotedCtx = null;
    renderer.promoteInteriorPresentationDisplayObject = (displayObj, ctx) => {
        promotedCtx = ctx;
        return !!displayObj;
    };

    renderer.renderPlaceObjectCenterSnapGuide({
        centerSnapGuide: {
            placementCenterX: 10,
            placementCenterY: 20,
            sectionCenterX: 12,
            sectionCenterY: 20,
            centerSnapActive: true,
            wallHeight: 8,
            wallThickness: 2
        }
    }, renderContext);

    assert.equal(promotedCtx, renderContext);
    assert.equal(renderer.placeObjectCenterSnapGuideGraphics.visible, true);
});

test("building interior promotion submits real display objects to the picker", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    const originalLayer = {
        children: [],
        addChild(child) {
            if (!this.children.includes(child)) this.children.push(child);
            child.parent = this;
            return child;
        },
        removeChild(child) {
            const index = this.children.indexOf(child);
            if (index >= 0) this.children.splice(index, 1);
            if (child.parent === this) child.parent = null;
            return child;
        },
        getChildIndex(child) {
            return this.children.indexOf(child);
        },
        addChildAt(child, index) {
            if (child.parent && child.parent !== this && typeof child.parent.removeChild === "function") {
                child.parent.removeChild(child);
            }
            const existing = this.children.indexOf(child);
            if (existing >= 0) this.children.splice(existing, 1);
            this.children.splice(index, 0, child);
            child.parent = this;
            return child;
        }
    };
    const overlayLayer = {
        children: [],
        sortableChildren: false,
        sortDirty: false,
        addChild(child) {
            if (child.parent && child.parent !== this && typeof child.parent.removeChild === "function") {
                child.parent.removeChild(child);
            }
            if (!this.children.includes(child)) this.children.push(child);
            child.parent = this;
            return child;
        },
        removeChild(child) {
            const index = this.children.indexOf(child);
            if (index >= 0) this.children.splice(index, 1);
            if (child.parent === this) child.parent = null;
            return child;
        }
    };
    const displayObj = {
        visible: true,
        renderable: true,
        alpha: 1,
        zIndex: 9,
        parent: originalLayer
    };
    const hiddenFallbackSprite = {
        visible: false,
        renderable: false,
        alpha: 1,
        zIndex: 3,
        parent: originalLayer
    };
    originalLayer.children.push(displayObj);
    originalLayer.children.push(hiddenFallbackSprite);
    const item = {
        type: "furniture",
        category: "furniture",
        traversalLayer: 1,
        _renderingDepthMesh: displayObj,
        pixiSprite: hiddenFallbackSprite
    };
    const region = {
        id: "inside",
        level: 1,
        staticObjects: [{ item, level: 1 }]
    };
    const cutawayState = {
        triggers: [{
            activeInteriorRegion: region,
            renderCache: { interiorRegions: [region] }
        }]
    };
    const picked = [];
    const currentDisplayObjects = new Set();
    renderer.addPickRenderItem = (target, display, options) => {
        picked.push({ target, display, options });
    };

    const promoted = renderer.promoteActiveBuildingInteriorRegions({}, cutawayState, overlayLayer, currentDisplayObjects);

    assert.equal(promoted, 1);
    assert.equal(displayObj.parent, overlayLayer);
    assert.equal(displayObj.zIndex, 2147483650);
    assert.equal(currentDisplayObjects.has(displayObj), true);
    assert.equal(picked.length, 1);
    assert.equal(picked[0].target, item);
    assert.equal(picked[0].display, displayObj);
    assert.equal(picked[0].options.forceInclude, true);
    assert.equal(hiddenFallbackSprite.parent, originalLayer);
    assert.equal(hiddenFallbackSprite.visible, false);

    renderer.clearBuildingInteriorForegroundPromotions();

    assert.equal(displayObj.parent, originalLayer);
    assert.equal(displayObj.zIndex, 9);
});

test("building interior render plan includes active-floor dynamic characters", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    const { Character } = RenderingImpl.__testContext;
    const animal = new Character();
    animal.traversalLayer = 1;
    animal.currentLayer = 1;
    animal.node = {
        surfaceId: "house",
        fragmentId: "house-l1"
    };
    const otherFloorAnimal = new Character();
    otherFloorAnimal.traversalLayer = 2;
    otherFloorAnimal.currentLayer = 2;
    otherFloorAnimal.node = {
        surfaceId: "house",
        fragmentId: "house-l2"
    };
    const wizard = new Character();
    wizard.traversalLayer = 1;
    wizard.currentLayer = 1;
    wizard.node = {
        surfaceId: "house",
        fragmentId: "house-l1"
    };
    const region = {
        id: "fragment:house-l1",
        fragmentId: "house-l1",
        surfaceId: "house",
        level: 1,
        polygon: { outer: [], holes: [] },
        staticObjects: []
    };
    const cutawayState = {
        triggers: [{
            activeInteriorRegion: region,
            renderCache: { interiorRegions: [region] }
        }]
    };

    const plan = renderer.buildBuildingInteriorRenderPlan({
        wizard,
        animals: [animal, otherFloorAnimal]
    }, cutawayState);

    assert.equal(plan.items.has(animal), true);
    assert.equal(plan.items.has(otherFloorAnimal), false);
    assert.equal(plan.items.has(wizard), false);
});

test("building interior promotion lifts foreground plan character meshes", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    const { Character } = RenderingImpl.__testContext;
    const originalLayer = {
        children: [],
        addChild(child) {
            if (!this.children.includes(child)) this.children.push(child);
            child.parent = this;
        },
        removeChild(child) {
            const index = this.children.indexOf(child);
            if (index >= 0) this.children.splice(index, 1);
            if (child.parent === this) child.parent = null;
        },
        getChildIndex(child) {
            return this.children.indexOf(child);
        },
        addChildAt(child, index) {
            const existing = this.children.indexOf(child);
            if (existing >= 0) this.children.splice(existing, 1);
            this.children.splice(index, 0, child);
            child.parent = this;
        }
    };
    const overlayLayer = {
        children: [],
        sortableChildren: false,
        sortDirty: false,
        addChild(child) {
            if (child.parent && child.parent !== this && typeof child.parent.removeChild === "function") {
                child.parent.removeChild(child);
            }
            if (!this.children.includes(child)) this.children.push(child);
            child.parent = this;
        },
        removeChild(child) {
            const index = this.children.indexOf(child);
            if (index >= 0) this.children.splice(index, 1);
            if (child.parent === this) child.parent = null;
        }
    };
    const characterMesh = {
        visible: true,
        renderable: true,
        zIndex: 4,
        parent: originalLayer
    };
    originalLayer.children.push(characterMesh);
    const animal = new Character();
    animal._renderingDepthMesh = characterMesh;
    const picked = [];
    renderer.addPickRenderItem = (target, display, options) => {
        picked.push({ target, display, options });
    };
    const cutawayState = {
        triggers: [{
            activeInteriorRegion: { id: "inside" }
        }]
    };
    const currentDisplayObjects = new Set();

    const promoted = renderer.promoteActiveBuildingInteriorRegions(
        {},
        cutawayState,
        overlayLayer,
        currentDisplayObjects,
        { items: new Set([animal]) }
    );

    assert.equal(promoted, 1);
    assert.equal(characterMesh.parent, overlayLayer);
    assert.equal(characterMesh.zIndex, 2147483650);
    assert.equal(currentDisplayObjects.has(characterMesh), true);
    assert.equal(picked.length, 1);
    assert.equal(picked[0].target, animal);
    assert.equal(picked[0].display, characterMesh);
    assert.equal(picked[0].options.forceInclude, true);

    renderer.clearBuildingInteriorForegroundPromotions();

    assert.equal(characterMesh.parent, originalLayer);
    assert.equal(characterMesh.zIndex, 4);
});

test("building interior wall promotion skips legacy black outline graphics", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    const depthMesh = { name: "wallDepthMesh", visible: true };
    const outlineGraphics = { name: "legacyWallOutline", visible: true };
    const wall = {
        type: "wallSection",
        _depthDisplayMesh: depthMesh,
        pixiSprite: outlineGraphics
    };

    const displayObjects = renderer.collectBuildingInteriorDisplayObjectsForItem(wall);

    assert.equal(displayObjects.length, 1);
    assert.equal(displayObjects[0], depthMesh);
});

test("building cutaway composite hiding preserves active interior foreground display objects", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    const activeWallMesh = { name: "activeWallMesh", visible: true, renderable: true };
    const cachedRoofMesh = { name: "cachedRoofMesh", visible: true, renderable: true };
    const activeWall = {
        type: "wallSection",
        _depthDisplayMesh: activeWallMesh
    };
    const plan = {
        items: new Set([activeWall])
    };

    const preserve = renderer.getBuildingInteriorCompositePreserveDisplayObjects(plan);
    const hidden = renderer.hideBuildingCutawayCompositeOriginals(
        new Set([activeWallMesh, cachedRoofMesh]),
        preserve
    );

    assert.equal(hidden, 1);
    assert.equal(activeWallMesh.visible, true);
    assert.equal(activeWallMesh.renderable, true);
    assert.equal(cachedRoofMesh.visible, false);
    assert.equal(cachedRoofMesh.renderable, false);
});

test("building cutaway composite presents stale cache while replacement textures are pending", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    const displayObject = { visible: true, renderable: true };
    const upperFloorObject = { visible: true, renderable: true };
    const mesh = { visible: true, renderable: true };
    const building = { buildingId: "building:house" };
    const state = {
        wizardBaseZ: 3,
        triggers: [{
            building,
            buildingId: "building:house",
            renderCache: { cacheKey: "new-cache" }
        }]
    };
    const presentationKey = renderer.getBuildingCutawayCompositePresentationKey(null, state);
    const staleCache = {
        active: true,
        signature: "old-cache",
        presentationKey,
        texture: { label: "oldColor" },
        dataTexture: { label: "oldData" },
        anchor: { worldX: 5, worldY: 5, worldZ: 0 },
        bounds: { projectionSpace: true, worldWidth: 10, worldHeight: 10 },
        textureWidth: 64,
        textureHeight: 64,
        anchorX: 0.5,
        anchorY: 1,
        alpha: 0.1,
        activeInterior: false,
        currentFloorZ: 0
    };
    renderer.buildingCutawayCompositeCache = staleCache;
    renderer.buildingCutawayCompositeSprite = {
        texture: { label: "replacementBlank" },
        width: 1,
        height: 1,
        anchor: {
            set(x, y) {
                this.x = x;
                this.y = y;
            }
        }
    };
    renderer.getBuildingCutawayCompositeDisplayObjects = () => new Set([displayObject]);
    renderer.getBuildingCutawayCompositeOriginalDisplayObjects = () => new Set([displayObject, upperFloorObject]);
    renderer.getBuildingCutawayCompositeAnchor = () => staleCache.anchor;
    renderer.getBuildingCutawayCompositeCaptureBounds = () => staleCache.bounds;
    renderer.ensureBuildingCutawayCompositeRenderTexture = () => {
        throw new Error("replacement render texture should not be touched while stale cache is presentable");
    };
    renderer.getBuildingCutawayCompositeWallSelectionDiagnostics = () => ({ expectedWalls: 0, selectedWalls: 0 });
    renderer.collectBuildingCutawayCompositePendingTextures = () => ({ count: 1, samples: [] });
    renderer.watchBuildingCutawayCompositePendingTextures = () => {};
    renderer.getBuildingCutawayCompositeAlpha = () => 0.42;
    renderer.renderBuildingCutawayCompositeBillboard = (_ctx, resources, cache) => {
        assert.equal(cache, staleCache);
        assert.equal(resources.texture, staleCache.texture);
        assert.equal(resources.sprite.texture, staleCache.texture);
        return mesh;
    };
    renderer.hideBuildingCutawayCompositeBillboard = () => {
        throw new Error("stale cache should remain visible while replacement is pending");
    };

    const result = renderer.renderBuildingCutawayComposites({}, state, {});

    assert.equal(result, mesh);
    assert.equal(renderer.buildingCutawayCompositeCache, staleCache);
    assert.equal(staleCache.signature, "old-cache");
    assert.equal(staleCache.alpha, 0.42);
    assert.equal(staleCache.currentFloorZ, 3);
    assert.equal(displayObject.visible, false);
    assert.equal(displayObject.renderable, false);
    assert.equal(upperFloorObject.visible, false);
    assert.equal(upperFloorObject.renderable, false);
    assert.deepEqual(staleCache.originalDisplayObjects, [displayObject, upperFloorObject]);
});

test("building cutaway pending texture readiness keeps stale cache until rebuild commits", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    const testContext = RenderingImpl.__testContext;
    const staleCache = {
        active: true,
        signature: "old-cache",
        texture: { label: "oldColor" },
        dataTexture: { label: "oldData" }
    };
    let readyHandler = null;
    let presented = 0;
    const baseTexture = {
        valid: false,
        once(_event, handler) {
            readyHandler = handler;
        }
    };
    const previousPresentGameFrame = testContext.presentGameFrame;
    testContext.presentGameFrame = () => {
        presented += 1;
    };
    renderer.buildingCutawayCompositeCache = staleCache;

    try {
        renderer.watchBuildingCutawayCompositePendingTextures({
            baseTextures: [baseTexture]
        });
        assert.equal(typeof readyHandler, "function");

        readyHandler();

        assert.equal(renderer.buildingCutawayCompositeCache, staleCache);
        assert.equal(presented, 1);
    } finally {
        if (previousPresentGameFrame === undefined) {
            delete testContext.presentGameFrame;
        } else {
            testContext.presentGameFrame = previousPresentGameFrame;
        }
    }
});

test("building cutaway composite presents stale cache during one-frame missing trigger gap", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    const displayObject = { visible: true, renderable: true };
    const mesh = { visible: true, renderable: true };
    const staleCache = {
        active: true,
        signature: "old-cache",
        texture: { label: "oldColor" },
        dataTexture: { label: "oldData" },
        anchor: { worldX: 5, worldY: 5, worldZ: 0 },
        bounds: { projectionSpace: true, worldWidth: 10, worldHeight: 10 },
        textureWidth: 64,
        textureHeight: 64,
        anchorX: 0.5,
        anchorY: 1,
        wizardLayer: 1,
        wizardX: 4,
        wizardY: 6,
        displayObjects: [],
        originalDisplayObjects: [displayObject]
    };
    renderer.buildingCutawayCompositeCache = staleCache;
    renderer.buildingCutawayCompositeSprite = {
        texture: staleCache.texture,
        width: 64,
        height: 64,
        anchor: {
            set(x, y) {
                this.x = x;
                this.y = y;
            }
        }
    };
    renderer.renderBuildingCutawayCompositeBillboard = (_ctx, resources, cache) => {
        assert.equal(cache, staleCache);
        assert.equal(resources.texture, staleCache.texture);
        return mesh;
    };
    renderer.hideBuildingCutawayCompositeBillboard = () => {
        throw new Error("stale cache should remain visible during a missing-trigger gap");
    };

    const result = renderer.renderBuildingCutawayComposites({}, {
        active: false,
        wizardLayer: 1,
        wizardX: 4,
        wizardY: 6,
        triggers: []
    }, {});

    assert.equal(result, mesh);
    assert.equal(renderer.buildingCutawayCompositeCache, staleCache);
    assert.equal(renderer.buildingCutawayCompositeMissingTriggerFrames, 1);
    assert.equal(displayObject.visible, false);
    assert.equal(displayObject.renderable, false);
});

test("active building interior walls flatten when camera and player face opposite sides", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    renderer.camera = {
        viewscale: 1,
        xyratio: 1,
        worldToScreen: (x, y, z = 0) => ({ x, y: y - z })
    };
    const wizard = { x: 5, y: 5 };
    const flattenedWall = {
        type: "wallSection",
        bottomZ: 3,
        isVisibleInMazeModeFacingRule: ({ player }) => {
            assert.equal(player, wizard);
            return false;
        }
    };
    const standingWall = {
        type: "wallSection",
        bottomZ: 3,
        isVisibleInMazeModeFacingRule: () => true
    };
    const region = {
        id: "fragment:house-l1",
        level: 1,
        polygon: { outer: [], holes: [] },
        staticObjects: [
            { item: flattenedWall },
            { item: standingWall }
        ]
    };
    const cutawayState = {
        triggers: [{
            activeInteriorRegion: region,
            renderCache: { interiorRegions: [region] }
        }]
    };

    const plan = renderer.buildBuildingInteriorRenderPlan({ wizard }, cutawayState);

    assert.equal(plan.items.has(flattenedWall), true);
    assert.equal(plan.items.has(standingWall), true);
    assert.equal(plan.wallTopFaceOnly.get(flattenedWall), true);
    assert.equal(plan.wallTopFaceOnly.get(standingWall), false);
});

test("building cutaway capture temporarily restores flattened active walls to full geometry", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    renderer.camera = {
        viewscale: 1,
        xyratio: 1,
        worldToScreen: (x, y, z = 0) => ({ x, y: y - z })
    };
    const calls = [];
    const wall = {
        type: "wallSection",
        getDepthMeshDisplayObject(options) {
            calls.push(options.topFaceOnly);
            return { visible: true, renderable: true };
        }
    };
    const restore = renderer.applyBuildingCutawayCompositeFullWallCaptureGeometry({}, {
        wallTopFaceOnly: new Map([[wall, true]])
    });

    assert.deepEqual(calls, [false]);

    restore();

    assert.deepEqual(calls, [false, true]);
});

test("building interior item promotion prefers depth mesh over flat fallback sprite", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    const depthMesh = { name: "projectedDepthMesh", visible: true, renderable: true };
    const flatSprite = { name: "flatFallbackSprite", visible: false, renderable: false };
    const item = {
        type: "furniture",
        rotationAxis: "ground",
        _renderingDepthMesh: depthMesh,
        _renderingDisplayObject: depthMesh,
        pixiSprite: flatSprite
    };

    const displayObjects = renderer.collectBuildingInteriorDisplayObjectsForItem(item);

    assert.equal(displayObjects.length, 1);
    assert.equal(displayObjects[0], depthMesh);
});

test("layer cutaway hides overhead floor stack by visibility polygon", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    const houseUpper = {
        fragmentId: "house-upper",
        surfaceId: "house",
        level: 1,
        nodeBaseZ: 3,
        outerPolygon: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 }
        ],
        visibilityPolygon: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 }
        ],
        visibilityHoles: [[
            { x: 2, y: 2 },
            { x: 4, y: 2 },
            { x: 4, y: 4 },
            { x: 2, y: 4 }
        ]]
    };
    const towerUpper = {
        fragmentId: "tower-upper",
        surfaceId: "tower",
        level: 1,
        nodeBaseZ: 3,
        outerPolygon: [
            { x: 20, y: 20 },
            { x: 30, y: 20 },
            { x: 30, y: 30 },
            { x: 20, y: 30 }
        ],
        visibilityPolygon: [
            { x: 20, y: 20 },
            { x: 30, y: 20 },
            { x: 30, y: 30 },
            { x: 20, y: 30 }
        ],
        visibilityHoles: []
    };
    const map = {
        floorsById: new Map([
            [houseUpper.fragmentId, houseUpper],
            [towerUpper.fragmentId, towerUpper]
        ])
    };

    const state = renderer.getLayerCutawayState({
        map,
        wizard: { x: 5, y: 5, currentLayer: 0 }
    });

    assert.equal(state.active, true);
    assert.equal(state.hiddenFromLevel, 1);
    assert.equal(renderer.isFloorFragmentHiddenByLayerCutaway(houseUpper, state), true);
    assert.equal(renderer.isFloorFragmentHiddenByLayerCutaway(towerUpper, state), false);
    assert.equal(renderer.isRenderItemHiddenByLayerCutaway({ x: 6, y: 6 }, 1, state, map), true);
    assert.equal(renderer.isRenderItemHiddenByLayerCutaway({ x: 25, y: 25 }, 1, state, map), false);
    assert.equal(renderer.isRenderItemHiddenByLayerCutaway({ x: 6, y: 6 }, 0, state, map), false);
    assert.equal(
        renderer.isRenderItemHiddenByLayerCutaway({
            type: "wallSection",
            bottomZ: 3,
            traversalLayer: 0,
            startPoint: { x: 50, y: 50 },
            endPoint: { x: 51, y: 50 },
            nodes: [{ surfaceId: "house", fragmentId: "house-upper" }]
        }, renderer.getLayerIndexForObject({ type: "wallSection", bottomZ: 3, traversalLayer: 0 }), state, map),
        true
    );
    assert.equal(
        renderer.isRenderItemHiddenByLayerCutaway({
            type: "wallSection",
            bottomZ: 3,
            traversalLayer: 1,
            startPoint: { x: 6, y: 6 },
            endPoint: { x: 7, y: 6 },
            nodes: [{ surfaceId: "tower", fragmentId: "tower-upper" }]
        }, 1, state, map),
        false
    );

    const visuallyShiftedState = renderer.getLayerCutawayState({
        map,
        wizard: { x: 5, y: -2, currentLayer: 0, currentLayerBaseZ: 0 }
    });
    assert.equal(visuallyShiftedState.active, true);

    const rawPolygonOnlyState = renderer.getLayerCutawayState({
        map,
        wizard: { x: 5, y: 8, currentLayer: 0, currentLayerBaseZ: 0 }
    });
    assert.equal(rawPolygonOnlyState.active, false);

    const holeState = renderer.getLayerCutawayState({
        map,
        wizard: { x: 3, y: 0, currentLayer: 0, currentLayerBaseZ: 0 }
    });
    assert.equal(holeState.active, false);
});

test("building cutaway ghosts all fragments in active building", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    renderer.camera = {
        worldToScreen: (x, y, z = 0) => ({ x, y: y - z })
    };
    const lower = {
        fragmentId: "house-l1",
        surfaceId: "house",
        buildingId: "building:house",
        level: 1,
        nodeBaseZ: 3,
        outerPolygon: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 }
        ],
        visibilityPolygon: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 }
        ],
        visibilityHoles: []
    };
    const upper = {
        fragmentId: "house-l2",
        surfaceId: "house",
        buildingId: "building:house",
        level: 2,
        nodeBaseZ: 6,
        outerPolygon: [
            { x: 2, y: 2 },
            { x: 8, y: 2 },
            { x: 8, y: 8 },
            { x: 2, y: 8 }
        ],
        visibilityPolygon: [
            { x: 2, y: 2 },
            { x: 8, y: 2 },
            { x: 8, y: 8 },
            { x: 2, y: 8 }
        ],
        visibilityHoles: []
    };
    const tower = {
        fragmentId: "tower-l1",
        surfaceId: "tower",
        buildingId: "building:tower",
        level: 1,
        nodeBaseZ: 3,
        outerPolygon: [
            { x: 20, y: 0 },
            { x: 30, y: 0 },
            { x: 30, y: 10 },
            { x: 20, y: 10 }
        ],
        visibilityPolygon: [
            { x: 20, y: 0 },
            { x: 30, y: 0 },
            { x: 30, y: 10 },
            { x: 20, y: 10 }
        ],
        visibilityHoles: []
    };
    const houseBuilding = {
        buildingId: "building:house",
        fragmentIds: new Set(["house-l1", "house-l2"]),
        surfaceIds: new Set(["house"]),
        minLevel: 1,
        maxLevel: 2
    };
    const towerBuilding = {
        buildingId: "building:tower",
        fragmentIds: new Set(["tower-l1"]),
        surfaceIds: new Set(["tower"]),
        minLevel: 1,
        maxLevel: 1
    };
    const roof = {
        type: "roof",
        x: 5,
        y: 5,
        z: 6,
        vertices: [
            { x: -3, y: -3, z: 0 },
            { x: 3, y: -3, z: 0 },
            { x: 0, y: 3, z: 2 }
        ],
        faces: [[0, 1, 2]],
        wallSections: [{
            nodes: [{ surfaceId: "house", fragmentId: "house-l2" }]
        }]
    };
    const map = {
        floorsById: new Map([
            [lower.fragmentId, lower],
            [upper.fragmentId, upper],
            [tower.fragmentId, tower]
        ]),
        ensureFloorBuildings: () => new Map([
            [houseBuilding.buildingId, houseBuilding],
            [towerBuilding.buildingId, towerBuilding]
        ]),
        doFloorFragmentsOverlapXY: (a, b) => a.surfaceId === b.surfaceId
    };

    const state = renderer.getLayerCutawayState({
        map,
        roofs: [roof],
        wizard: { x: 1, y: 5, currentLayer: 0, currentLayerBaseZ: 0 },
        renderNowMs: 1000
    });

    assert.equal(state.active, true);
    assert.equal(state.triggers[0].buildingId, "building:house");
    assert.equal(state.triggers[0].visibleThroughLevel, 0);
    assert.equal(state.triggers[0].activeInteriorRegion.kind, "groundFootprint");
    assert.equal(renderer.isFloorFragmentHiddenByLayerCutaway(lower, state), false);
    assert.equal(renderer.isFloorFragmentHiddenByLayerCutaway(upper, state), false);
    assert.equal(renderer.getFloorFragmentCutawayAlpha(lower, state), 1);
    assert.equal(renderer.getFloorFragmentCutawayAlpha(upper, state), 1);
    assert.equal(renderer.isFloorFragmentHiddenByLayerCutaway(tower, state), false);
    assert.equal(renderer.getFloorFragmentCutawayAlpha(tower, state), 1);
    assert.equal(renderer.getLayerIndexForRoof(roof, 0), 3);
    assert.equal(renderer.getLayerIndexForRoof({ ...roof, z: 21, heightFromGround: 21 }, 0), 8);
    assert.equal(renderer.getLayerIndexForRoof({ ...roof, traversalLayer: 7 }, 0), 8);
    assert.equal(renderer.getLayerIndexForRoof({ ...roof, level: 7 }, 0), 8);
    assert.equal(renderer.isRenderItemHiddenByLayerCutaway(roof, 3, state, map), false);
    const nearState = renderer.getLayerCutawayState({
        map,
        roofs: [roof],
        wizard: { x: -0.5, y: 5, currentLayer: 0, currentLayerBaseZ: 0 },
        renderNowMs: 1100
    });
    assert.equal(nearState.active, false);
    const fadeStartState = renderer.getLayerCutawayState({
        map,
        roofs: [roof],
        wizard: { x: 5, y: -2, currentLayer: 0, currentLayerBaseZ: 0 },
        renderNowMs: 2000
    });
    assert.equal(fadeStartState.active, true);
    assert.equal(fadeStartState.triggers[0].buildingId, "building:house");
    assert.equal(fadeStartState.triggers[0].activeInteriorRegion, null);
    assert.equal(fadeStartState.triggers[0].alpha, 1);
    const fadeMidState = renderer.getLayerCutawayState({
        map,
        roofs: [roof],
        wizard: { x: 5, y: -2, currentLayer: 0, currentLayerBaseZ: 0 },
        renderNowMs: 2250
    });
    assert.equal(fadeMidState.active, true);
    assert.equal(fadeMidState.triggers[0].alpha, 0.55);
    const fadeDoneState = renderer.getLayerCutawayState({
        map,
        roofs: [roof],
        wizard: { x: 5, y: -2, currentLayer: 0, currentLayerBaseZ: 0 },
        renderNowMs: 2500
    });
    assert.equal(fadeDoneState.active, true);
    assert.equal(fadeDoneState.triggers[0].alpha, 0.1);
    assert.equal(renderer.isRenderItemHiddenByLayerCutaway({
        x: 25,
        y: 5,
        traversalLayer: 1,
        node: { surfaceId: "tower", fragmentId: "tower-l1" }
    }, 1, state, map), false);
    const initialCompositeAnchor = renderer.getBuildingCutawayCompositeAnchor(state);
    assert.equal(initialCompositeAnchor.worldX, 5);
    assert.equal(initialCompositeAnchor.worldY, 10);
    renderer.camera = {
        x: 100,
        y: 200,
        z: 3,
        viewscale: 2,
        xyratio: 0.5,
        worldToScreen(x, y, z = 0) {
            return {
                x: (x - this.x) * this.viewscale,
                y: (y - this.y - (z - this.z)) * this.viewscale * this.xyratio
            };
        }
    };
    const movedCameraCompositeAnchor = renderer.getBuildingCutawayCompositeAnchor(state);
    assert.equal(movedCameraCompositeAnchor.worldX, 5);
    assert.equal(movedCameraCompositeAnchor.worldY, 10);
    assert.equal(movedCameraCompositeAnchor.centerX, initialCompositeAnchor.centerX);
    assert.equal(movedCameraCompositeAnchor.bottomY, initialCompositeAnchor.bottomY);
    assert.equal(
        renderer.getBuildingCutawayCompositeSignature(null, fadeDoneState),
        renderer.getBuildingCutawayCompositeSignature(null, state)
    );
    const projectedCompositeBounds = renderer.getBuildingCutawayCompositeCaptureBounds(state, initialCompositeAnchor);
    assert.equal(projectedCompositeBounds.projectionSpace, true);
    assert.equal(projectedCompositeBounds.pxPerWorld, 64);
    const localBillboardBounds = renderer.getBuildingCutawayCompositeScreenBounds({
        triggers: [{
            building: houseBuilding,
            occlusionPolygons: [{
                outer: [
                    { x: 0, y: -4 },
                    { x: 10, y: -4 },
                    { x: 10, y: 10 },
                    { x: 0, y: 10 }
                ],
                holes: []
            }]
        }]
    }, 0);
    assert.equal(localBillboardBounds.x, -200);
    assert.equal(localBillboardBounds.y, -201);
    assert.equal(localBillboardBounds.width, 20);
    assert.equal(localBillboardBounds.height, 14);
    renderer.camera = {
        worldToScreen: (x, y, z = 0) => ({ x, y: y - z })
    };

    const groundProjectionWizard = { x: 1, y: 5, currentLayer: 0, currentLayerBaseZ: 0 };
    const projectedGroundWall = {
        type: "wallSection",
        bottomZ: 0,
        startPoint: { x: 1, y: 4 },
        endPoint: { x: 1, y: 6 },
        isVisibleInMazeModeFacingRule: () => false
    };
    const outsideProjectedGroundWall = {
        type: "wallSection",
        bottomZ: 0,
        startPoint: { x: 40, y: 4 },
        endPoint: { x: 40, y: 6 },
        isVisibleInMazeModeFacingRule: () => false
    };
    const sameSideProjectedGroundWall = {
        type: "wallSection",
        bottomZ: 0,
        startPoint: { x: 2, y: 4 },
        endPoint: { x: 2, y: 6 },
        nodes: [{ surfaceId: "house", fragmentId: "house-l1" }],
        isVisibleInMazeModeFacingRule: () => true
    };
    const projectedGroundDoor = {
        type: "door",
        bottomZ: 0,
        startPoint: { x: 3, y: 4 },
        endPoint: { x: 3, y: 6 },
        isVisibleInMazeModeFacingRule: () => false
    };
    const freestandingInteriorObject = {
        type: "placedObject",
        x: 5,
        y: 5,
        traversalLayer: 1,
        level: 1
    };
    const interiorFloorTile = {
        type: "road",
        rotationAxis: "ground",
        x: 5,
        y: 5,
        traversalLayer: 1,
        level: 1
    };
    const interiorRug = {
        type: "placedObject",
        category: "furniture",
        texturePath: "/assets/images/furniture/hexrug.png",
        rotationAxis: "ground",
        x: 5,
        y: 5,
        traversalLayer: 1,
        level: 1
    };
    map.getGameObjects = () => [
        projectedGroundWall,
        outsideProjectedGroundWall,
        sameSideProjectedGroundWall,
        projectedGroundDoor,
        freestandingInteriorObject,
        interiorFloorTile,
        interiorRug
    ];
    houseBuilding.renderCache = null;
    state.triggers[0].renderCache = renderer.getCompiledBuildingRenderCache(
        { map, roofs: [roof], wizard: groundProjectionWizard, renderNowMs: 2500 },
        map,
        houseBuilding
    );
    const groundInteriorRegion = state.triggers[0].renderCache.interiorRegions.find(region => region.kind === "groundFootprint");
    assert.equal(!!groundInteriorRegion, true);
    assert.equal(groundInteriorRegion.staticObjects.some(entry => entry.item === projectedGroundWall), true);
    assert.equal(groundInteriorRegion.staticObjects.some(entry => entry.item === sameSideProjectedGroundWall), true);
    assert.equal(groundInteriorRegion.staticObjects.some(entry => entry.item === outsideProjectedGroundWall), false);
    const lowerInteriorRegion = state.triggers[0].renderCache.interiorRegions.find(region => region.fragmentId === "house-l1");
    assert.equal(!!lowerInteriorRegion, true);
    assert.equal(lowerInteriorRegion.staticObjects.some(entry => entry.item === freestandingInteriorObject), true);
    assert.equal(lowerInteriorRegion.staticObjects.some(entry => entry.item === interiorFloorTile), false);
    assert.equal(lowerInteriorRegion.staticObjects.some(entry => entry.item === interiorRug), true);
    assert.equal(renderer.renderItemMatchesBuildingInteriorRegion(state.triggers[0].renderCache, interiorFloorTile, 1, map), false);
    assert.equal(renderer.renderItemMatchesBuildingInteriorRegion(state.triggers[0].renderCache, interiorRug, 1, map), true);
    assert.equal(renderer.renderItemMatchesCutawayVisibleThroughArea(projectedGroundWall, state.triggers[0], map), true);
    assert.equal(renderer.renderItemMatchesCutawayVisibleThroughArea(outsideProjectedGroundWall, state.triggers[0], map), false);
    assert.equal(renderer.getBuildingCutawayGroundMaskPolygons(state).length, 0);
    assert.equal(state.triggers[0].renderCache.groundProjectionWalls.length, 2);
    renderer.beginLayerCutawayFrame();
    renderer.applyBuildingCutawayFrameFlags({ map, roofs: [roof], wizard: groundProjectionWizard, renderNowMs: 2500 }, fadeDoneState, map, groundProjectionWizard);
    assert.equal(renderer.getBuildingCutawayCompositeAlphaForItem(roof), 0.1);

    const undergroundState = renderer.getLayerCutawayState({
        map,
        roofs: [roof],
        wizard: { x: 5, y: 5, currentLayer: -1, currentLayerBaseZ: -3 }
    });
    assert.equal(undergroundState.active, true);
    assert.equal(undergroundState.triggers.length, 0);
    assert.equal(undergroundState.globalHiddenFromLevel, 0);
    assert.equal(renderer.isFloorFragmentHiddenByLayerCutaway(lower, undergroundState), true);
    assert.equal(renderer.isFloorFragmentHiddenByLayerCutaway(upper, undergroundState), true);
    assert.equal(renderer.isFloorFragmentHiddenByLayerCutaway(tower, undergroundState), true);
    assert.equal(renderer.isRenderItemHiddenByLayerCutaway({ x: 99, y: 99 }, 0, undergroundState, map), true);
    assert.equal(renderer.isRenderItemHiddenByLayerCutaway({ x: 99, y: 99 }, -1, undergroundState, map), false);
    assert.equal(renderer.getBuildingCutawayGroundMaskPolygons(undergroundState).length, 0);

    const interiorState = renderer.getLayerCutawayState({
        map,
        roofs: [roof],
        wizard: { x: 5, y: 5, currentLayer: 1, currentLayerBaseZ: 3 }
    });

    assert.equal(interiorState.active, true);
    assert.equal(interiorState.triggers[0].buildingId, "building:house");
    assert.equal(interiorState.triggers[0].level, 2);
    assert.equal(interiorState.triggers[0].visibleThroughLevel, 1);
    assert.equal(interiorState.triggers[0].activeInteriorRegion.kind, "floorFragment");
    assert.equal(interiorState.triggers[0].activeInteriorRegion.fragmentId, "house-l1");
    assert.equal(
        renderer.getBuildingCutawayCompositeSignature(null, interiorState),
        renderer.getBuildingCutawayCompositeSignature(null, state)
    );
    assert.equal(renderer.getBuildingCutawayCompositeAlpha(interiorState), 0.5);
    assert.equal(
        JSON.stringify(renderer.getBuildingInteriorOverlayRegionsForTrigger(interiorState.triggers[0]).map(region => region.id)),
        JSON.stringify(["fragment:house-l1"])
    );
    assert.equal(renderer.getFloorFragmentBuildingCutawayTrigger(lower, interiorState).buildingId, "building:house");
    assert.equal(renderer.getBuildingCutawayGroundMaskPolygons(interiorState).length, 0);
    assert.equal(renderer.isFloorFragmentHiddenByLayerCutaway(lower, interiorState), false);
    assert.equal(renderer.isFloorFragmentHiddenByLayerCutaway(upper, interiorState), false);
    assert.equal(renderer.getFloorFragmentCutawayAlpha(upper, interiorState), 0.1);
    assert.equal(renderer.isRenderItemHiddenByLayerCutaway({
        x: 5,
        y: 5,
        traversalLayer: 1,
        node: { surfaceId: "house", fragmentId: "house-l1" }
    }, 1, interiorState, map), false);
    assert.equal(renderer.isRenderItemHiddenByLayerCutaway({
        x: 5,
        y: 5,
        traversalLayer: 2,
        node: { surfaceId: "house", fragmentId: "house-l2" }
    }, 2, interiorState, map), false);

    const topFloorUnderRoofState = renderer.getLayerCutawayState({
        map,
        roofs: [roof],
        wizard: { x: 5, y: 5, currentLayer: 2, currentLayerBaseZ: 6 }
    });
    assert.equal(topFloorUnderRoofState.active, true);
    assert.equal(topFloorUnderRoofState.triggers[0].buildingId, "building:house");
    assert.equal(topFloorUnderRoofState.triggers[0].level, 3);
    assert.equal(topFloorUnderRoofState.triggers[0].visibleThroughLevel, 2);
    assert.equal(topFloorUnderRoofState.triggers[0].activeInteriorRegion.kind, "floorFragment");
    assert.equal(topFloorUnderRoofState.triggers[0].activeInteriorRegion.fragmentId, "house-l2");
    assert.equal(renderer.getBuildingCutawayCompositeAlpha(topFloorUnderRoofState), 0.5);
    assert.equal(
        JSON.stringify(renderer.getBuildingInteriorOverlayRegionsForTrigger(topFloorUnderRoofState.triggers[0]).map(region => region.id)),
        JSON.stringify(["fragment:house-l2"])
    );

});

test("building render cache includes roofs by footprint when wall ids are unavailable", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    const fragment = {
        fragmentId: "house-l1",
        surfaceId: "house",
        buildingId: "building:house",
        level: 1,
        nodeBaseZ: 3,
        outerPolygon: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 }
        ],
        visibilityPolygon: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 }
        ],
        visibilityHoles: []
    };
    const building = {
        buildingId: "building:house",
        fragmentIds: new Set(["house-l1"]),
        surfaceIds: new Set(["house"]),
        minLevel: 1,
        maxLevel: 1
    };
    const roof = {
        type: "roof",
        x: 5,
        y: 5,
        z: 3,
        placed: true,
        vertices: [
            { x: -3, y: -3, z: 0 },
            { x: 3, y: -3, z: 0 },
            { x: 3, y: 3, z: 0 },
            { x: -3, y: 3, z: 0 }
        ],
        faces: [[0, 1, 2], [0, 2, 3]],
        wallLoopSectionIds: [],
        groundPlaneHitbox: {
            points: [
                { x: 2, y: 2 },
                { x: 8, y: 2 },
                { x: 8, y: 8 },
                { x: 2, y: 8 }
            ]
        }
    };
    const map = {
        floorsById: new Map([[fragment.fragmentId, fragment]]),
        _buildingRenderCacheVersion: 1,
        _floorBuildingVersion: 1,
        ensureFloorBuildings: () => new Map([[building.buildingId, building]]),
        getGameObjects: () => []
    };

    const cache = renderer.getCompiledBuildingRenderCache({ map, roofs: [roof] }, map, building);

    assert.equal(cache.roofs.includes(roof), true);
    assert.equal(cache.renderItems.some(entry => entry && entry.item === roof), true);
    assert.equal(roof._buildingRenderCacheId, "building:house");
});

test("building render cache consumes placed object manifest entries", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    renderer.camera = {
        worldToScreen: (x, y, z = 0) => ({ x, y: y - z })
    };
    const fragment = {
        fragmentId: "house-l1",
        surfaceId: "house",
        buildingId: "building:house",
        level: 1,
        nodeBaseZ: 3,
        outerPolygon: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 }
        ],
        visibilityPolygon: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 }
        ],
        visibilityHoles: []
    };
    const rug = {
        type: "furniture",
        category: "furniture",
        traversalLayer: 1,
        fragmentId: "house-l1",
        surfaceId: "house",
        x: 5,
        y: 5
    };
    const building = {
        buildingId: "building:house",
        fragmentIds: new Set(["house-l1"]),
        surfaceIds: new Set(["house"]),
        minLevel: 1,
        maxLevel: 1,
        staticObjects: [{
            item: rug,
            level: 1,
            refs: [{ surfaceId: "house", fragmentId: "house-l1" }]
        }]
    };
    const map = {
        floorsById: new Map([[fragment.fragmentId, fragment]]),
        _buildingRenderCacheVersion: 1,
        _floorBuildingVersion: 1,
        ensureFloorBuildings: () => new Map([[building.buildingId, building]]),
        getGameObjects: () => []
    };

    const cache = renderer.getCompiledBuildingRenderCache({ map, roofs: [] }, map, building);

    assert.equal(cache.renderItems.some(entry => entry && entry.item === rug), true);
    assert.equal(cache.interiorRegions.some(region => (
        region.kind === "floorFragment" &&
        Array.isArray(region.staticObjects) &&
        region.staticObjects.some(entry => entry.item === rug)
    )), true);
    assert.equal(rug._buildingRenderCacheId, "building:house");
});

test("building render cache invalidates when prototype wall state changes", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    renderer.camera = {
        worldToScreen: (x, y, z = 0) => ({ x, y: y - z })
    };
    const fragment = {
        fragmentId: "house-l1",
        surfaceId: "house",
        buildingId: "building:house",
        level: 1,
        nodeBaseZ: 3,
        outerPolygon: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 }
        ],
        visibilityPolygon: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 }
        ],
        visibilityHoles: []
    };
    const building = {
        buildingId: "building:house",
        fragmentIds: new Set(["house-l1"]),
        surfaceIds: new Set(["house"]),
        minLevel: 1,
        maxLevel: 1
    };
    const map = {
        floorsById: new Map([[fragment.fragmentId, fragment]]),
        _buildingRenderCacheVersion: 1,
        _floorBuildingVersion: 1,
        _prototypeWallState: {
            activeRecordSignature: "",
            activeRuntimeWallsByRecordId: new Map()
        },
        ensureFloorBuildings: () => new Map([[building.buildingId, building]]),
        getGameObjects: () => []
    };
    const first = renderer.getCompiledBuildingRenderCache({ map, roofs: [] }, map, building);
    assert.equal(first.wallSections.length, 0);

    const wall = {
        type: "wallSection",
        bottomZ: 3,
        traversalLayer: 1,
        startPoint: { x: 2, y: 2 },
        endPoint: { x: 8, y: 2 },
        nodes: [{ surfaceId: "house", fragmentId: "house-l1" }]
    };
    RenderingImpl.__testContext.WallSectionUnit = {
        _allSections: new Map([[1, wall]])
    };
    map._prototypeWallState.activeRuntimeWallsByRecordId.set(1, wall);
    map._prototypeWallState.activeRecordSignature = "1";

    const second = renderer.getCompiledBuildingRenderCache({ map, roofs: [] }, map, building);

    assert.notEqual(second, first);
    assert.equal(second.wallSections.length, 1);
    assert.equal(second.interiorRegions.some(region => (
        region.kind === "floorFragment" &&
        Array.isArray(region.staticObjects) &&
        region.staticObjects.some(entry => entry.item === wall)
    )), true);
});

test("level 0 surface chunks map world bounds to stable 1024px tiles", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();

    assert.equal(renderer.getLevel0GroundSurfaceChunkWorldSize(), 32);
    assert.equal(
        renderer.getLevel0GroundSurfaceChunkCoordsForBounds({
            minX: -0.1,
            minY: 0,
            maxX: 32.1,
            maxY: 63.9
        }).map((coord) => `${coord.chunkX},${coord.chunkY}`).join("|"),
        "-1,0|-1,1|0,0|0,1|1,0|1,1"
    );
});

test("level 0 chunk floor visuals preserve interior holes", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    const map = { hexWidth: 1 / 0.866, hexHeight: 1 };
    const asset = { key: "0,0", tileCoordKeys: ["0,0"] };
    const fragment = { ownerSectionKey: "0,0" };
    const outer = [
        { x: 1, y: 1 },
        { x: 31, y: 1 },
        { x: 31, y: 31 },
        { x: 1, y: 31 }
    ];
    const holes = [[
        { x: 10, y: 10 },
        { x: 20, y: 10 },
        { x: 20, y: 20 },
        { x: 10, y: 20 }
    ]];
    let textureRequests = 0;
    renderer.getLevel0GroundSurfaceChunkTexture = function getLevel0GroundSurfaceChunkTexture(_ctx, sectionKey, _asset, chunkX, chunkY) {
        textureRequests += 1;
        return {
            texture: { sectionKey, chunkX, chunkY },
            bounds: this.getLevel0GroundSurfaceChunkBounds(chunkX, chunkY, map)
        };
    };

    const entries = renderer.collectLevel0ChunkFloorVisualEntries(
        { map },
        "floor_area:0,0:0:0",
        fragment,
        asset,
        outer,
        holes,
        0,
        1
    );

    assert.equal(Array.isArray(entries), true);
    assert.equal(entries.length, 1);
    assert.equal(textureRequests, 1);
    assert.equal(entries[0].texturePath, "level0chunk:0,0:0,0");
    assert.equal(entries[0].holes.length, 1);
    assert.equal(entries[0].holes[0].length, 4);
});

test("level 0 chunk hole clipping is cached across frames", () => {
    const polygonClipping = require("polygon-clipping");
    let intersectionCalls = 0;
    const RenderingImpl = loadRenderingImpl({
        polygonClipping: {
            ...polygonClipping,
            intersection(...args) {
                intersectionCalls += 1;
                return polygonClipping.intersection(...args);
            }
        }
    });
    const renderer = new RenderingImpl();
    const map = { hexWidth: 1 / 0.866, hexHeight: 1 };
    renderer.getLevel0GroundSurfaceChunkTexture = function getLevel0GroundSurfaceChunkTexture(_ctx, sectionKey, _asset, chunkX, chunkY) {
        return {
            texture: { sectionKey, chunkX, chunkY },
            bounds: this.getLevel0GroundSurfaceChunkBounds(chunkX, chunkY, map)
        };
    };
    const args = [
        { map },
        "floor_area:0,0:0:0",
        { ownerSectionKey: "0,0" },
        { key: "0,0", tileCoordKeys: ["0,0"] },
        [
            { x: 1, y: 1 },
            { x: 31, y: 1 },
            { x: 31, y: 31 },
            { x: 1, y: 31 }
        ],
        [[
            { x: 10, y: 10 },
            { x: 20, y: 10 },
            { x: 20, y: 20 },
            { x: 10, y: 20 }
        ]],
        0,
        1
    ];

    const first = renderer.collectLevel0ChunkFloorVisualEntries(...args);
    const second = renderer.collectLevel0ChunkFloorVisualEntries(...args);

    assert.equal(first.length, 1);
    assert.equal(second.length, 1);
    assert.equal(intersectionCalls, 1);
    assert.equal(renderer.floorVisualChunkClipCache.size, 1);
});

test("roads are considered baked only when every covering chunk is current and ready", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    const asset = {
        tileCoordKeys: ["0,0"],
        _level0SurfaceVersion: 1,
        _level0RoadSurfaceModelVersion: 2,
        _level0RoadSurfaceVersion: 0,
        _level0GroundSurfaceVersion: 0,
        _level0SurfaceTextureReadyVersion: 0
    };
    const node = { x: 31.9, y: 1, _prototypeSectionKey: "0,0" };
    const road = { type: "road", x: 31.9, y: 1, width: 1, height: 1, node };
    const ctx = {
        map: {
            _prototypeSectionState: {
                sectionAssetsByKey: new Map([["0,0", asset]])
            }
        }
    };
    const coords = renderer.getLevel0GroundSurfaceChunkCoordsForBounds({
        minX: 31.9 - 0.57735,
        minY: 0.5,
        maxX: 31.9 + 0.57735,
        maxY: 1.5
    });

    assert.equal(coords.length, 2);
    assert.equal(renderer.isRoadBakedIntoLevel0Surface(ctx, road), false);

    for (const coord of coords) {
        const key = renderer.getLevel0GroundSurfaceChunkKey("0,0", coord.chunkX, coord.chunkY);
        renderer.level0GroundSurfaceChunkCache.set(key, {
            ready: true,
            texture: {},
            bounds: {},
            signature: renderer.getLevel0GroundSurfaceChunkSignature(asset, coord.chunkX, coord.chunkY)
        });
    }
    assert.equal(renderer.isRoadBakedIntoLevel0Surface(ctx, road), true);

    asset._level0RoadSurfaceModelVersion += 1;
    assert.equal(renderer.isRoadBakedIntoLevel0Surface(ctx, road), false);
});
