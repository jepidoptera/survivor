const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const sectionWorldBuildings = require("../public/assets/javascript/prototypes/sectionWorldBuildings.js");

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
    if (options.PIXI) context.PIXI = options.PIXI;
    if (options.app) context.app = options.app;
    context.window = context;
    context.globalThis = context;

    vm.createContext(context);
    const stairTraversalSource = fs.readFileSync(
        path.join(__dirname, "../public/assets/javascript/shared/StairTraversal.js"),
        "utf8"
    );
    vm.runInContext(stairTraversalSource, context, { filename: "StairTraversal.js" });
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

test("prototype building exterior bitmap signature includes render data version", () => {
    const source = fs.readFileSync(
        path.join(__dirname, "../public/assets/javascript/prototypes/sectionWorldBuildings.js"),
        "utf8"
    );

    assert.match(source, /const EXTERIOR_BITMAP_RENDER_DATA_VERSION = "depth-rgb-biased-v3";/);
    assert.match(source, /EXTERIOR_BITMAP_RENDER_DATA_VERSION,\s+String\(placement && placement\.buildingSaveName \|\| ""\),/);
});

test("prototype building bitmap bakes use larger defaults with a WebGL max texture diagnostic", () => {
    const source = fs.readFileSync(
        path.join(__dirname, "../public/assets/javascript/prototypes/sectionWorldBuildings.js"),
        "utf8"
    );
    const rendererSource = fs.readFileSync(
        path.join(__dirname, "../public/building-editor/BuildingRenderer.js"),
        "utf8"
    );

    assert.match(source, /const DEFAULT_PROTOTYPE_BUILDING_BITMAP_PADDING_PIXELS = 96;/);
    assert.match(source, /const DEFAULT_PROTOTYPE_BUILDING_BITMAP_MAX_DIMENSION = 4096;/);
    assert.match(source, /paddingPixels: Number\.isFinite\(Number\(options\.paddingPixels\)\)[\s\S]*?: DEFAULT_PROTOTYPE_BUILDING_BITMAP_PADDING_PIXELS,/);
    assert.match(source, /maxDimension: Number\.isFinite\(Number\(options\.maxDimension\)\)[\s\S]*?: DEFAULT_PROTOTYPE_BUILDING_BITMAP_MAX_DIMENSION/);
    assert.match(rendererSource, /const EXTERIOR_BITMAP_DEFAULT_PADDING = 96;/);
    assert.match(rendererSource, /const EXTERIOR_BITMAP_MAX_DIMENSION = 4096;/);
    assert.match(rendererSource, /function resolveBuildingBitmapMaxDimension\(rendererRef, requestedMaxDimension, label\)/);
    assert.match(rendererSource, /exceeds WebGL MAX_TEXTURE_SIZE/);
    assert.match(rendererSource, /function fitBuildingBitmapExportResolution\(setup, projectionPoints, label\)/);
    assert.match(rendererSource, /resolutionScale: pixelsPerWorldUnit \/ requestedPixelsPerWorldUnit/);
    assert.match(rendererSource, /requestedPixelsPerWorldUnit/);
    assert.doesNotMatch(rendererSource, /throw new Error\(`building exterior bitmap \$\{width\}x\$\{height\} exceeds max dimension/);
    assert.doesNotMatch(rendererSource, /throw new Error\(`building interior bitmap \$\{width\}x\$\{height\} exceeds max dimension/);
});

test("prototype building interior bitmap signature includes floor and render data version", () => {
    const source = fs.readFileSync(
        path.join(__dirname, "../public/assets/javascript/prototypes/sectionWorldBuildings.js"),
        "utf8"
    );
    const rendererSource = fs.readFileSync(
        path.join(__dirname, "../public/building-editor/BuildingRenderer.js"),
        "utf8"
    );

    assert.match(source, /const INTERIOR_BITMAP_RENDER_DATA_VERSION = "depth-rgb-interior-v7-lower-floor-openings";/);
    assert.match(source, /INTERIOR_BITMAP_RENDER_DATA_VERSION,\s+String\(placement && placement\.buildingSaveName \|\| ""\),\s+String\(floorId \|\| ""\),/);
    const interiorSignatureBody = source.slice(
        source.indexOf("function interiorBitmapSettingsSignature"),
        source.indexOf("function destroyPrototypeBuildingBitmapEntry")
    );
    assert.match(interiorSignatureBody, /Number\(transform\.rotation \|\| 0\)\.toFixed\(6\),/);
    assert.match(source, /renderBuildingInteriorBitmap\(buildingData,/);
    assert.match(source, /floorId: sourceFloorId,\s+rotation: Number\(placement\.transform && placement\.transform\.rotation\) \|\| 0,/);
    assert.match(rendererSource, /export async function renderBuildingInteriorBitmap\(buildingData, options = \{\}\)/);
    assert.match(rendererSource, /function rotateBuildingDataAroundOrigin\(buildingData, rotation\)/);
    assert.match(rendererSource, /function createBuildingBitmapExportSetup\(buildingData, options = \{\}, config = \{\}\)/);
    assert.match(rendererSource, /config\.rotateModelAroundOrigin === true\s+\? rotateBuildingDataAroundOrigin\(buildingData, rotation\)\s+: buildingData;/);
    assert.match(rendererSource, /renderBuildingExteriorBitmap[\s\S]*?rotateModelAroundOrigin: false,/);
    assert.match(rendererSource, /renderBuildingInteriorBitmap[\s\S]*?rotateModelAroundOrigin: true,/);
    assert.match(rendererSource, /state\.layerSelectionMode = "floor";/);
    assert.match(rendererSource, /floorIdsVisibleThroughFloorOpenings\(floor\)/);
    assert.match(rendererSource, /floorIdsVisibleBelowFloor\(floor\)/);
    assert.match(rendererSource, /collectInteriorBitmapProjectionPoints\(state\.building, floor, interiorBitmapFloors\)/);
    assert.match(rendererSource, /anchorX: originScreen\.x \/ width,/);
    assert.match(rendererSource, /anchorY: originScreen\.y \/ height,/);
    assert.doesNotMatch(rendererSource, /anchorX: Math\.max\(0, Math\.min\(1, originScreen\.x \/ width\)\)/);
    assert.match(rendererSource, /playtestFloorRenderOverride = \{\s+floorIds: interiorBitmapFloorIds,\s+suppressFloorMeshIds: visibleLowerFloorIds,\s+fullHeightWallFloorIds: visibleLowerFloorIds,\s+fullOpacityMountedObjectFloorIds: visibleLowerFloorIds,\s+suppressFade: true\s+\};/);
    assert.match(rendererSource, /assertInteriorBitmapRenderableSurfaces\(floor\)/);
});

test("main game Pixi renderer requests a depth buffer", () => {
    const source = fs.readFileSync(
        path.join(__dirname, "../public/assets/javascript/runaround.js"),
        "utf8"
    );

    assert.match(source, /const gameWebglContextAttributes = \{[\s\S]*?\bdepth:\s*true[\s\S]*?\};/);
    assert.match(source, /gamePixiView\.getContext\("webgl2", gameWebglContextAttributes\)/);
    assert.match(source, /gameContextAttributes\.depth !== true/);
    assert.match(source, /new PIXI\.Application\(\{[\s\S]*?\bview:\s*gamePixiView,[\s\S]*?\bcontext:\s*gamePixiContext,[\s\S]*?\}\);/);
});

test("ground depth billboard mesh signature includes sprite anchor", () => {
    const source = fs.readFileSync(
        path.join(__dirname, "../public/assets/javascript/gameobjects/staticObjects.js"),
        "utf8"
    );

    assert.match(source, /worldX, worldY, groundVisualZ, worldWidth, worldDepthY, angleDeg,\s+anchorX, anchorY, groundLayerNudge/);
});

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

test("building placement footprints remain visible outside the placement tool", () => {
    const drawOps = [];
    class GraphicsStub {
        constructor() {
            this.visible = false;
            this.parent = null;
            this.interactive = true;
        }
        clear() { drawOps.push(["clear"]); }
        lineStyle(width, color, alpha) { drawOps.push(["lineStyle", width, color, alpha]); }
        beginFill(color, alpha) { drawOps.push(["beginFill", color, alpha]); }
        moveTo(x, y) { drawOps.push(["moveTo", x, y]); }
        lineTo(x, y) { drawOps.push(["lineTo", x, y]); }
        closePath() { drawOps.push(["closePath"]); }
        endFill() { drawOps.push(["endFill"]); }
    }
    const RenderingImpl = loadRenderingImpl({ PIXI: { Graphics: GraphicsStub } });
    const renderer = new RenderingImpl();
    const ui = {
        children: [],
        addChild(child) {
            if (!this.children.includes(child)) this.children.push(child);
            child.parent = this;
        }
    };
    renderer.layers = { ui };
    renderer.camera = {
        worldToScreen(x, y, z = 0) {
            return { x: x * 10, y: (y - z) * 10 };
        }
    };
    renderer.promoteInteriorPresentationDisplayObject = () => true;

    renderer.renderBuildingPlacementPreview({
        wizard: { currentSpell: "fireball" },
        map: {
            getPrototypeBuildingPlacements() {
                return [{
                    footprintPolygons: [[
                        { x: 0, y: 0 },
                        { x: 1, y: 0 },
                        { x: 1, y: 1 },
                        { x: 0, y: 1 }
                    ]]
                }];
            }
        }
    });

    assert.equal(renderer.buildingPlacementPreviewGraphics.visible, true);
    assert.equal(ui.children.includes(renderer.buildingPlacementPreviewGraphics), true);
    assert.ok(drawOps.some(op => op[0] === "lineStyle" && op[2] === 0x66aaff));
});

test("building exterior bitmap rendering requires a depth metric texture", () => {
    const RenderingImpl = loadRenderingImpl({
        PIXI: {
            Graphics: class {},
            Sprite: class {
                constructor(texture) {
                    this.texture = texture;
                    this.anchor = { set(x, y) { this.x = x; this.y = y; } };
                    this.visible = true;
                    this.renderable = true;
                }
            },
            BLEND_MODES: { NORMAL: 0 }
        }
    });
    const renderer = new RenderingImpl();

    assert.throws(() => {
        renderer.renderPrototypeBuildingExteriorBitmap(
            { app: { renderer: { gl: { getExtension() { return {}; } } } } },
        {
            id: "building:placed-1",
            transform: { x: 1, y: 2 },
            footprintPolygons: [[
                { x: 0, y: 0 },
                { x: 2, y: 0 },
                { x: 2, y: 2 },
                { x: 0, y: 2 }
            ]]
        },
            {
                id: "building:placed-1",
                status: "ready",
                texture: { width: 10, height: 10 },
                width: 10,
                height: 10,
                depthMetric: { min: -1, span: 2 }
            }
        );
    }, /missing its depth metric texture/);
});

test("building exterior bitmap rendering uses vertical texture anchor", () => {
    let updateThis = null;
    let updateOptions = null;
    let createdState = null;
    const mesh = {
        shader: {
            uniforms: {
                uBuildingExteriorDepthMetricUse: 0,
                uBuildingExteriorDepthMetricSampler: null,
                uBuildingExteriorDepthMetricRange: new Float32Array(2)
            }
        },
        visible: false,
        renderable: false
    };
    const RenderingImpl = loadRenderingImpl({
        PIXI: {
            Graphics: class {},
            Sprite: class {
                constructor(texture) {
                    this.texture = texture;
                    this.anchor = { set(x, y) { this.x = x; this.y = y; } };
                    this.width = 0;
                    this.height = 0;
                    this.visible = true;
                    this.renderable = true;
                    this.alpha = 1;
                }
            },
            State: class {},
            BLEND_MODES: { NORMAL: 0 }
        }
    });
    RenderingImpl.__testContext.PIXI.State = class StateStub {
        constructor() {
            createdState = this;
        }
    };
    RenderingImpl.__testContext.StaticObject = function StaticObject() {};
    RenderingImpl.__testContext.StaticObject.isWebgl2Renderer = () => true;
    RenderingImpl.__testContext.StaticObject.prototype.updateDepthBillboardMesh = function updateDepthBillboardMesh(_ctx, _camera, options) {
        updateThis = this;
        updateOptions = options;
        return mesh;
    };
    RenderingImpl.__testContext.StaticObject.prototype.ensureDepthBillboardMesh = function ensureDepthBillboardMesh() {
        return mesh;
    };
    RenderingImpl.__testContext.StaticObject.prototype.updateDepthBillboardUvsForTexture = function updateDepthBillboardUvsForTexture() {
        return true;
    };

    const renderer = new RenderingImpl();
    renderer.camera = { viewscale: 10, xyratio: 1 };
    const depthObjects = {
        children: [],
        addChild(child) {
            this.children.push(child);
        }
    };
    const objects3d = {
        children: [],
        addChild(child) {
            this.children.push(child);
            child.parent = this;
        }
    };
    renderer.layers = {
        depthObjects,
        objects3d
    };
    let removedPlacementId = null;
    const mapRef = {
        removePrototypeBuildingPlacement(id) {
            removedPlacementId = id;
            return true;
        }
    };

    renderer.renderPrototypeBuildingExteriorBitmap(
        { app: { renderer: { gl: {} } }, map: mapRef },
        {
            id: "building:placed-1",
            transform: { x: 1, y: 2 },
            footprintPolygons: [[
                { x: 1, y: 2 },
                { x: 7, y: 2 },
                { x: 7, y: 6 },
                { x: 1, y: 6 }
            ]]
        },
        {
            id: "building:placed-1",
            status: "ready",
            texture: { width: 100, height: 80 },
            depthMetricTexture: { width: 100, height: 80 },
            width: 100,
            height: 80,
            anchorX: 0.5,
            anchorY: 0.25,
            bounds: { worldWidth: 10, worldHeight: 8 },
            depthMetric: { min: -1, span: 2 }
        }
    );

    assert.equal(updateThis.depthBillboardUseVerticalAnchorY, true);
    assert.equal(updateOptions.useVerticalAnchorY, true);
    assert.equal(updateThis.x, 1);
    assert.equal(updateThis.y, 2);
    assert.equal(updateThis._renderDepthBias, 0);
    assert.equal(mesh.state, createdState);
    assert.equal(mesh.state.depthTest, true);
    assert.equal(mesh.state.depthMask, true);
    assert.equal(mesh.state.blend, true);
    assert.equal(objects3d.children.includes(mesh), true);
    assert.equal(depthObjects.children.includes(mesh), false);
    assert.equal(renderer.pickRenderItems.length, 1);
    assert.equal(renderer.pickRenderItems[0].item.type, "prototypeBuildingPlacement");
    assert.equal(renderer.pickRenderItems[0].item.buildingPlacementId, "building:placed-1");
    assert.equal(renderer.pickRenderItems[0].item.x, 4);
    assert.equal(renderer.pickRenderItems[0].item.y, 4);
    assert.equal(renderer.pickRenderItems[0].displayObj, mesh);
    assert.equal(renderer.pickRenderItems[0].item.removeFromGame(), true);
    assert.equal(removedPlacementId, "building:placed-1");
});

test("building interior bitmap rendering projects a visible ground mesh", () => {
    let updateThis = null;
    let updateOptions = null;
    let uvUpdated = false;
    let createdState = null;
    const uvBuffer = {
        data: new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]),
        update() {
            uvUpdated = true;
        }
    };
    const mesh = {
        shader: {
            uniforms: {
                uTint: new Float32Array([1, 1, 1, 1]),
                uBuildingExteriorDepthMetricUse: 0,
                uBuildingExteriorDepthMetricSampler: null,
                uBuildingExteriorDepthMetricRange: new Float32Array(2)
            }
        },
        geometry: {
            getBuffer(name) {
                return name === "aUvs" ? uvBuffer : null;
            }
        },
        visible: false,
        renderable: false,
        alpha: 0,
        parent: null
    };
    const RenderingImpl = loadRenderingImpl({
        PIXI: {
            Graphics: class {},
            Sprite: class {
                constructor(texture) {
                    this.texture = texture;
                    this.anchor = { set(x, y) { this.x = x; this.y = y; } };
                    this.width = 0;
                    this.height = 0;
                    this.visible = true;
                    this.renderable = true;
                    this.alpha = 1;
                }
            },
            State: class {
                constructor() {
                    createdState = this;
                }
            },
            BLEND_MODES: { NORMAL: 0 }
        }
    });
    RenderingImpl.__testContext.StaticObject = function StaticObject() {};
    RenderingImpl.__testContext.StaticObject.prototype.updateDepthBillboardMesh = function updateDepthBillboardMesh(_ctx, _camera, options) {
        updateThis = this;
        updateOptions = options;
        mesh.shader.uniforms.uTint[3] = Number.isFinite(this.pixiSprite && this.pixiSprite.alpha)
            ? this.pixiSprite.alpha
            : 1;
        return mesh;
    };
    RenderingImpl.__testContext.StaticObject.prototype.ensureDepthBillboardMesh = function ensureDepthBillboardMesh() {
        return mesh;
    };
    RenderingImpl.__testContext.StaticObject.prototype.updateDepthBillboardUvsForTexture = function updateDepthBillboardUvsForTexture() {
        return true;
    };

    const renderer = new RenderingImpl();
    renderer.camera = {
        viewscale: 36,
        xyratio: 0.66
    };
    const objects3d = {
        children: [],
        sortableChildren: false,
        addChild(child) {
            if (!this.children.includes(child)) this.children.push(child);
            child.parent = this;
        }
    };
    renderer.layers = { objects3d };

    const renderedMesh = renderer.renderPrototypeBuildingInteriorBitmap(
        { app: { renderer: { gl: {} } }, map: {} },
        { id: "building:placed-1", transform: { x: 1, y: 2, rotation: Math.PI / 2 } },
        {
            id: "building:placed-1|floor-0",
            status: "ready",
            texture: {
                width: 100,
                height: 80,
                baseTexture: { realWidth: 100, realHeight: 80 },
                frame: { x: 0, y: 0, width: 100, height: 80 }
            },
            depthMetricTexture: { width: 100, height: 80 },
            width: 100,
            height: 80,
            bounds: { worldWidth: 10, worldHeight: 8 },
            pixelsPerWorldUnit: 72,
            xyratio: 0.66,
            level: 1,
            anchorX: 0.25,
            anchorY: 0.75,
            depthMetric: { min: -1, span: 2 }
        },
        { alpha: 0.375 }
    );

    assert.equal(renderedMesh, mesh);
    assert.equal(mesh.visible, true);
    assert.equal(mesh.renderable, true);
    assert.equal(updateThis.rotationAxis, "ground");
    assert.equal(updateThis.x, 1);
    assert.equal(updateThis.y, 2);
    assert.equal(updateThis.z, 0);
    assert.equal(updateThis.width, 10);
    assert.equal(updateThis.height, 8);
    assert.equal(updateThis.placementRotation, 0);
    assert.equal(updateThis.pixiSprite.visible, false);
    assert.equal(updateThis.pixiSprite.renderable, false);
    assert.equal(updateThis.pixiSprite.alpha, 0.375);
    assert.equal(updateThis.pixiSprite.width, 360);
    assert.equal(updateThis.pixiSprite.height, 288);
    assert.equal(updateThis.pixiSprite.anchor.x, 0.25);
    assert.equal(updateThis.pixiSprite.anchor.y, 0.75);
    assert.equal(updateOptions.groundPlaneVisualLift, 0);
    assert.equal(updateOptions.alphaCutoff, 0.01);
    assert.equal(mesh.state, createdState);
    assert.equal(mesh.state.depthTest, true);
    assert.equal(mesh.state.depthMask, true);
    assert.equal(mesh.state.blend, true);
    assert.equal(mesh.shader.uniforms.uBuildingExteriorDepthMetricUse, 1);
    assert.equal(mesh.shader.uniforms.uBuildingExteriorDepthMetricSampler.width, 100);
    assert.equal(mesh.shader.uniforms.uBuildingExteriorDepthMetricRange[0], -1);
    assert.equal(mesh.shader.uniforms.uBuildingExteriorDepthMetricRange[1], 0.5);
    assert.equal(mesh.shader.uniforms.uTint[3], 0.375);
    assert.equal(uvUpdated, true);
    assert.deepEqual(Array.from(uvBuffer.data), [0, 0, 1, 0, 1, 1, 0, 1]);
    assert.equal(mesh.zIndex, 2147483647);
    assert.equal(mesh.alpha, 0.375);
    assert.equal(objects3d.sortableChildren, true);
    assert.equal(objects3d.children.includes(mesh), true);
});

test("building tool space hold shows pre-placement footprint preview", () => {
    const drawOps = [];
    class GraphicsStub {
        constructor() {
            this.visible = false;
            this.parent = null;
            this.interactive = true;
        }
        clear() { drawOps.push(["clear"]); }
        lineStyle(width, color, alpha) { drawOps.push(["lineStyle", width, color, alpha]); }
        beginFill(color, alpha) { drawOps.push(["beginFill", color, alpha]); }
        moveTo(x, y) { drawOps.push(["moveTo", x, y]); }
        lineTo(x, y) { drawOps.push(["lineTo", x, y]); }
        closePath() { drawOps.push(["closePath"]); }
        endFill() { drawOps.push(["endFill"]); }
    }
    const RenderingImpl = loadRenderingImpl({ PIXI: { Graphics: GraphicsStub } });
    const renderer = new RenderingImpl();
    const ui = {
        children: [],
        addChild(child) {
            if (!this.children.includes(child)) this.children.push(child);
            child.parent = this;
        }
    };
    const map = {
        getPrototypeBuildingPlacements() {
            return [];
        }
    };
    renderer.layers = { ui };
    renderer.camera = {
        worldToScreen(x, y, z = 0) {
            return { x: x * 10, y: (y - z) * 10 };
        }
    };
    renderer.promoteInteriorPresentationDisplayObject = () => true;
    renderer.getMousePosRef = () => ({ worldX: 3, worldY: 4, screenX: 30, screenY: 40 });

    renderer.renderBuildingPlacementPreview({
        wizard: { currentSpell: "fireball" },
        map,
        spaceHeld: false
    });
    assert.equal(renderer.buildingPlacementPreviewGraphics.visible, false);

    let previewOptions = null;
    RenderingImpl.__testContext.SpellSystem = {
        getBuildingPlacementPreview(_wizard, options) {
            previewOptions = options;
            if (options.forceActive !== true) return null;
            return {
                footprintPolygons: [[
                    { x: 3, y: 4 },
                    { x: 5, y: 4 },
                    { x: 5, y: 6 },
                    { x: 3, y: 6 }
                ]],
                overlappedSectionKeys: []
            };
        }
    };

    drawOps.length = 0;
    renderer.renderBuildingPlacementPreview({
        wizard: { currentSpell: "placebuilding", editorPlacementActive: false },
        map,
        spaceHeld: true
    });
    assert.equal(renderer.buildingPlacementPreviewGraphics.visible, true);
    assert.equal(previewOptions.forceActive, true);
    assert.equal(previewOptions.spaceHeld, true);
    assert.equal(previewOptions.mouseWorldPos.x, 3);
    assert.equal(previewOptions.mouseWorldPos.y, 4);
    assert.equal(previewOptions.mouseWorldPos.screenX, 30);
    assert.equal(previewOptions.mouseWorldPos.screenY, 40);
    assert.ok(drawOps.some(op => op[0] === "lineStyle" && op[2] === 0xffcc44 && op[3] === 0.95));
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

test("upward layer transitions fade the upper layer into view", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    renderer._layerFadeTransition = {
        fromLayer: 0,
        toLayer: 1,
        fadingLayer: 1,
        startedAtMs: 1000,
        durationMs: 500
    };

    assert.equal(renderer.getLayerFadeMultiplier(1, 1000), 0);
    assert.equal(renderer.getLayerFadeMultiplier(1, 1250), 0.5);
    assert.equal(renderer.getLayerFadeMultiplier(1, 1500), 1);
});

test("falling through a hole reveals lower layer immediately and fades old layer", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    renderer._lastRenderedWizardLayer = 1;
    const wizard = {
        currentLayer: 1,
        currentLayerBaseZ: 3,
        z: 0,
        height: 1,
        _floorFallState: {
            active: true,
            fromLayer: 1,
            targetLayer: 0
        }
    };

    renderer.syncLayerTransitionState({
        wizard,
        renderNowMs: 1000
    });

    assert.equal(renderer._fallRevealLayer, 0);
    assert.equal(renderer._lastRenderedWizardLayer, 0);
    assert.equal(renderer.getCurrentFloorDarknessLayer(), 0);
    assert.equal(renderer._layerFadeTransition.fromLayer, 1);
    assert.equal(renderer._layerFadeTransition.toLayer, 0);
    assert.equal(renderer._layerFadeTransition.fadingLayer, 1);
    assert.equal(renderer._layerFadeTransition.startedAtMs, 1000);
    assert.equal(renderer._layerFadeTransition.durationMs, 500);
    assert.equal(renderer.getLayerFadeMultiplier(1, 1000), 1);
    assert.equal(renderer.getLayerFadeMultiplier(1, 1250), 0.5);
    assert.equal(renderer.getLayerFadeMultiplier(0, 1250), 1);

    renderer.syncLayerTransitionState({
        wizard,
        renderNowMs: 1600
    });

    assert.equal(renderer._layerFadeTransition, null);
    assert.equal(renderer._fallRevealLayer, 0);
    assert.equal(renderer.getLayerFadeMultiplier(1, 1600), 0);
    assert.equal(renderer.getLayerFadeMultiplier(0, 1600), 1);
});

test("fall landing does not start a second visual layer fade", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    renderer._lastRenderedWizardLayer = 1;
    const wizard = {
        currentLayer: 1,
        currentLayerBaseZ: 3,
        z: 0,
        _floorFallState: {
            active: true,
            fromLayer: 1,
            targetLayer: 0
        }
    };

    renderer.syncLayerTransitionState({
        wizard,
        renderNowMs: 1000
    });
    const originalTransition = renderer._layerFadeTransition;
    wizard.currentLayer = 0;
    wizard.currentLayerBaseZ = 0;
    wizard._floorFallState = null;
    wizard._pendingLayerTransition = {
        active: true,
        fromLevel: 1,
        toLevel: 0,
        startedAtMs: 1200,
        durationMs: 500
    };

    renderer.syncLayerTransitionState({
        wizard,
        renderNowMs: 1200
    });

    assert.equal(wizard._pendingLayerTransition.active, false);
    assert.equal(renderer._layerFadeTransition, originalTransition);
    assert.equal(wizard._floorFallLayerRevealTransition, null);
});

test("fall reveal snapshot replaces live outgoing layer while preserving snapshot alpha", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    renderer._layerFadeTransition = {
        fromLayer: 1,
        toLayer: 0,
        fadingLayer: 1,
        startedAtMs: 1000,
        durationMs: 500
    };
    renderer.layerTransitionSnapshot = {
        active: true,
        fromLayer: 1,
        toLayer: 0,
        fadingLayer: 1,
        startedAtMs: 1000,
        durationMs: 500
    };

    assert.equal(renderer.getLayerFadeMultiplier(1, 1250), 0.5);
    assert.equal(renderer.getLiveLayerFadeMultiplier(1, 1250), 0);
    assert.equal(renderer.getLiveLayerFadeMultiplier(0, 1250), 1);

    renderer.hideLayerTransitionSnapshot();

    assert.equal(renderer.getLiveLayerFadeMultiplier(1, 1250), 0.5);
});

test("fall reveal snapshot follows camera z while it fades", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    const root = {
        children: [],
        addChild(child) {
            this.children.push(child);
            child.parent = this;
        },
        getChildIndex(child) {
            return this.children.indexOf(child);
        },
        setChildIndex(child, index) {
            const current = this.children.indexOf(child);
            if (current >= 0) this.children.splice(current, 1);
            this.children.splice(index, 0, child);
        }
    };
    const sprite = {
        texture: { width: 800, height: 600 },
        position: {
            x: 0,
            y: 0,
            set(x, y) {
                this.x = x;
                this.y = y;
            }
        },
        scale: {
            x: 1,
            y: 1,
            set(x, y) {
                this.x = x;
                this.y = y;
            }
        },
        anchor: { set() {} },
        visible: false,
        renderable: false
    };
    renderer.layers = { root };
    renderer.layerTransitionSnapshotSprite = sprite;
    renderer.layerTransitionSnapshotSize = { width: 800, height: 600 };
    renderer.camera = {
        x: 10,
        y: 20,
        z: 2,
        viewscale: 10,
        xyratio: 0.5
    };
    renderer._layerFadeTransition = {
        fromLayer: 1,
        toLayer: 0,
        fadingLayer: 1,
        startedAtMs: 1000,
        durationMs: 500
    };
    renderer.layerTransitionSnapshot = {
        active: true,
        fromLayer: 1,
        toLayer: 0,
        fadingLayer: 1,
        startedAtMs: 1000,
        durationMs: 500,
        width: 800,
        height: 600,
        camera: {
            x: 10,
            y: 20,
            z: 3,
            viewscale: 10,
            xyratio: 0.5
        }
    };

    const rendered = renderer.renderLayerTransitionSnapshot({ renderNowMs: 1250 });

    assert.equal(rendered, sprite);
    assert.equal(sprite.alpha, 0.5);
    assert.equal(sprite.position.x, 0);
    assert.equal(sprite.position.y, 595);
    assert.equal(sprite.scale.x, 1);
    assert.equal(sprite.scale.y, -1);
});

test("fall reveal snapshot capture hides wizard display objects", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    const makeDisplay = (name) => ({ name, visible: true, renderable: true });
    const wizard = {
        pixiSprite: makeDisplay("wizardSprite"),
        _renderingDepthMesh: makeDisplay("wizardDepth"),
        _renderingDisplayObject: makeDisplay("wizardDisplay"),
        hatGraphics: makeDisplay("wizardHat"),
        shieldGraphics: makeDisplay("wizardShield"),
        shieldDebrisGraphics: makeDisplay("wizardShieldDebris"),
        shieldWireframeMesh: makeDisplay("wizardShieldWireframe")
    };
    renderer.wizardSprite = wizard.pixiSprite;
    renderer.wizardGhostSprite = makeDisplay("wizardGhost");
    renderer.wizardShadowSprite = makeDisplay("wizardShadowSprite");
    renderer.wizardShadowProxy = {
        pixiSprite: renderer.wizardShadowSprite,
        _renderingDepthMesh: makeDisplay("wizardShadowDepth"),
        _renderingDisplayObject: makeDisplay("wizardShadowDisplay")
    };
    const hidden = [];

    renderer.hidePlayerDisplayObjectsForLayerTransitionSnapshot({ wizard }, (displayObj) => {
        hidden.push(displayObj.name);
    });

    assert.deepEqual(hidden, [
        "wizardSprite",
        "wizardDepth",
        "wizardDisplay",
        "wizardHat",
        "wizardShield",
        "wizardShieldDebris",
        "wizardShieldWireframe",
        "wizardGhost",
        "wizardShadowSprite",
        "wizardShadowDepth",
        "wizardShadowDisplay"
    ]);
});

test("fall reveal cutaway state uses target visual layer before landing", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    const upper = {
        fragmentId: "upper",
        surfaceId: "tower",
        level: 1,
        nodeBaseZ: 3,
        outerPolygon: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 }
        ]
    };
    const map = {
        floorsById: new Map([[upper.fragmentId, upper]])
    };
    const wizard = {
        x: 5,
        y: 5,
        currentLayer: 1,
        currentLayerBaseZ: 3,
        _floorFallState: {
            active: true,
            fromLayer: 1,
            targetLayer: 0
        }
    };

    renderer.syncLayerTransitionState({
        wizard,
        renderNowMs: 1000
    });
    const state = renderer.getLayerCutawayState({
        map,
        wizard,
        renderNowMs: 1250
    });

    assert.equal(state.wizardLayer, 0);
    assert.equal(state.wizardBaseZ, 0);
    assert.equal(state.active, true);
    assert.equal(state.hiddenFromLevel, 1);
    assert.equal(renderer.getFloorFragmentCutawayAlpha(upper, state), 1);
    assert.equal(renderer.getLayerFadeMultiplier(1, 1250), 0.5);
    assert.equal(renderer.isRenderItemHiddenByLayerCutaway({ x: 5, y: 5 }, 1, state, map), false);
    assert.equal(renderer.isRenderItemHiddenByLayerCutaway({ x: 5, y: 5 }, 0, state, map), false);
});

test("wall depth render options include fall reveal layer alpha", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    renderer.camera = {
        worldToScreen: (x, y, z = 0) => ({ x, y: y - z }),
        viewscale: 1,
        xyratio: 1
    };
    const wall = {
        type: "wallSection",
        pixiSprite: {
            alpha: 1,
            tint: 0xffffff
        },
        _renderLayerAlpha: 0.35
    };

    const options = renderer.getBuildingInteriorWallDepthOptions({}, wall, false);

    assert.equal(options.alpha, 0.35);
});

test("building cutaway composite capture preserves layer fade alpha", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    renderer.camera = {
        x: 0,
        y: 0,
        z: 0,
        viewscale: 1,
        xyratio: 1
    };
    const child = {
        alpha: 0.4,
        shader: {
            uniforms: {
                uTint: [1, 1, 1, 0.4]
            }
        },
        children: []
    };
    const root = {
        alpha: 0.8,
        _buildingCutawayCompositeCaptureAlpha: 0.25,
        shader: {
            uniforms: {
                uTint: [1, 1, 1, 0.8]
            }
        },
        children: [child]
    };

    const restore = renderer.applyBuildingCutawayCompositeLocalCaptureState(
        new Set([root]),
        { x: 0, y: 0, width: 10, height: 10 },
        10,
        10
    );

    assert.equal(root.alpha, 0.25);
    assert.equal(root.shader.uniforms.uTint[3], 0.25);
    assert.equal(child.alpha, 1);
    assert.equal(child.shader.uniforms.uTint[3], 1);

    restore();

    assert.equal(root.alpha, 0.8);
    assert.equal(root.shader.uniforms.uTint[3], 0.8);
    assert.equal(child.alpha, 0.4);
    assert.equal(child.shader.uniforms.uTint[3], 0.4);
});

test("building cutaway composite selected objects carry fall reveal capture alpha", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    renderer._layerCutawayFrameId = 7;
    const displayObject = {
        parent: {},
        visible: true,
        renderable: true
    };
    const item = {
        type: "wallSection",
        _cutawayCompositeFrame: 7,
        _renderLayerFadeAlpha: 0.2,
        _renderingDepthMesh: displayObject
    };

    const selected = renderer.getBuildingCutawayCompositeDisplayObjects({
        triggers: [{
            building: {},
            renderCache: {
                renderItems: [{ item }]
            }
        }]
    });

    assert.equal(selected.has(displayObject), true);
    assert.equal(displayObject._buildingCutawayCompositeCaptureAlpha, 0.2);
});

test("building cutaway composite captures wall depth display meshes", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    renderer._layerCutawayFrameId = 11;
    const displayObject = {
        parent: {},
        visible: true,
        renderable: true
    };
    const item = {
        type: "wallSection",
        _cutawayCompositeFrame: 11,
        _depthDisplayMesh: displayObject
    };
    const state = {
        triggers: [{
            building: {},
            renderCache: {
                renderItems: [{ item }]
            }
        }]
    };

    const selected = renderer.getBuildingCutawayCompositeDisplayObjects(state);
    const diagnostics = renderer.getBuildingCutawayCompositeWallSelectionDiagnostics(state, selected);

    assert.equal(selected.has(displayObject), true);
    assert.equal(diagnostics.expectedWalls, 1);
    assert.equal(diagnostics.selectedWalls, 1);
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

test("visible object collection culls inactive far-away global walls", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    renderer.currentFrameMetrics = {};
    renderer.camera = { x: 0, y: 0 };

    const visibleNode = { id: "near-node", xindex: 0, yindex: 0, objects: [], visibilityObjects: [] };
    const activeWall = {
        id: 1,
        type: "wallSection",
        _prototypeOwnerSectionKey: "active",
        startPoint: { x: 100, y: 100 },
        endPoint: { x: 101, y: 100 },
        attachedObjects: []
    };
    const visibleNodeWall = {
        id: 2,
        type: "wallSection",
        _prototypeOwnerSectionKey: "old",
        startPoint: { x: 100, y: 100 },
        endPoint: { x: 101, y: 100 },
        nodes: [visibleNode],
        attachedObjects: []
    };
    const farWall = {
        id: 3,
        type: "wallSection",
        _prototypeOwnerSectionKey: "old",
        startPoint: { x: 500, y: 500 },
        endPoint: { x: 501, y: 500 },
        attachedObjects: []
    };

    RenderingImpl.__testContext.WallSectionUnit = {
        _allSections: new Map([
            [1, activeWall],
            [2, visibleNodeWall],
            [3, farWall]
        ])
    };

    renderer._collectVisibleNodesSeenKeys = new Set(["near-node"]);
    const visibleObjects = renderer.collectVisibleObjects([visibleNode], {
        map: {
            floorNodesById: new Map(),
            getPrototypeActiveSectionKeys: () => new Set(["active"])
        },
        viewport: { width: 10, height: 10 },
        animals: []
    });

    assert.equal(visibleObjects.includes(activeWall), true);
    assert.equal(visibleObjects.includes(visibleNodeWall), true);
    assert.equal(visibleObjects.includes(farWall), false);
    assert.equal(renderer.currentFrameMetrics.visibleGlobalWallsCulled, 1);
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

test("wizard body layer uses shared 3d depth layer while hat remains an overlay", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    const depthObjects = { name: "renderingDepthObjects" };
    const characters = { name: "renderingCharacters" };
    const objects3d = { name: "renderingObjects3d" };
    const entities = { name: "renderingEntities" };
    renderer.layers = { depthObjects, characters, objects3d, entities };

    assert.equal(renderer.getCharacterLayer(), objects3d);

    const source = fs.readFileSync(
        path.join(__dirname, "../public/assets/javascript/rendering/Rendering.js"),
        "utf8"
    );
    assert.match(source, /const overlayContainer = \(this\.layers && \(this\.layers\.entities \|\| this\.layers\.characters \|\| this\.layers\.depthObjects\)\) \|\| null;/);
    assert.match(source, /keepWizardShieldInCharacterLayer\(wizard\.shieldGraphics\)/);
    assert.doesNotMatch(source, /keepWizardShieldInCharacterLayer\(hat\)/);
    assert.match(source, /wizard\._stairSupport[\s\S]+Number\.isFinite\(Number\(wizard\._stairSupport\.localZ\)\)/);
    assert.match(source, /const shadowLocalZ = stairShadowLocalZ !== null[\s\S]+Math\.max\(0, interpolatedJumpHeight - jumpHeight\);/);
    assert.match(source, /shadowProxy\._renderLayerBaseZ = wizardLayerBaseZ;/);
    assert.match(source, /shadowProxy\.z = shadowLocalZ;/);
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

test("building interior overlay skips synthetic lower floor polygons visible through active floor holes", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    renderer.collectFloorVisualEntries = () => [
        {
            key: "fragment:upper",
            level: 2,
            baseZ: 6,
            outer: [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 10, y: 10 },
                { x: 0, y: 10 }
            ],
            holes: [[
                { x: 4, y: 4 },
                { x: 6, y: 4 },
                { x: 6, y: 6 },
                { x: 4, y: 6 }
            ]],
            texture: null,
            textureBounds: null,
            textureRepeat: null,
            texturePath: "/upper.png",
            tint: 0xffffff,
            alpha: 1,
            depthBias: 0.001,
            isHoleOverlay: false
        },
        {
            key: "fragment:lower:through:upper",
            level: 1,
            baseZ: 3,
            outer: [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 10, y: 10 },
                { x: 0, y: 10 }
            ],
            holes: [],
            texture: null,
            textureBounds: null,
            textureRepeat: null,
            texturePath: "/lower.png",
            tint: 0xdddddd,
            alpha: 1,
            depthBias: 0.001,
            isHoleOverlay: false,
            visibleThroughFragmentId: "upper"
        },
        {
            key: "fragment:basement",
            level: 1,
            baseZ: 0,
            outer: [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 10, y: 10 },
                { x: 0, y: 10 }
            ],
            holes: [],
            texture: null,
            textureBounds: null,
            textureRepeat: null,
            texturePath: "/basement.png",
            tint: 0x999999,
            alpha: 1,
            depthBias: 0.001,
            isHoleOverlay: false
        }
    ];

    const entries = renderer.collectBuildingInteriorOverlayFloorEntries({}, {
        id: "active",
        fragmentId: "upper",
        level: 2,
        polygon: {
            outer: [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 10, y: 10 },
                { x: 0, y: 10 }
            ],
            holes: []
        }
    }, { buildingId: "house" });

    assert.equal(entries.some(entry => entry.key.includes("fragment:upper")), true);
    assert.equal(entries.some(entry => entry.key.includes("fragment:lower:through:upper")), false);
    assert.equal(entries.some(entry => entry.key.includes("fragment:basement")), false);
});

test("prototype building interior overlay does not cover exported floor bitmap with world ground", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    renderer.collectFloorVisualEntries = () => {
        throw new Error("prototype interiors should not sample world floor visuals");
    };

    const entries = renderer.collectBuildingInteriorOverlayFloorEntries({}, {
        id: "active",
        level: 0,
        polygon: {
            outer: [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 10, y: 10 },
                { x: 0, y: 10 }
            ],
            holes: []
        }
    }, {
        buildingId: "building:placed-1",
        building: {
            _prototypeBuildingPlacement: {
                id: "building:placed-1"
            }
        }
    });

    assert.equal(entries.length, 0);
});

test("floor visual mesh updates when a non-sampled vertex moves", () => {
    class FakeBuffer {
        constructor(data) {
            this.data = data;
            this.updateCount = 0;
        }
        update() {
            this.updateCount += 1;
        }
    }
    class FakeGeometry {
        constructor() {
            this.buffers = new Map();
            this.index = null;
        }
        addAttribute(name, data) {
            this.buffers.set(name, new FakeBuffer(data));
            return this;
        }
        addIndex(data) {
            this.index = new FakeBuffer(data);
            return this;
        }
        getBuffer(name) {
            return this.buffers.get(name) || null;
        }
    }
    class FakeContainer {
        constructor() {
            this.children = [];
            this.position = { set() {} };
            this.scale = { set() {} };
        }
        addChild(child) {
            if (!this.children.includes(child)) this.children.push(child);
            child.parent = this;
        }
        addChildAt(child) {
            this.addChild(child);
        }
        removeChild(child) {
            const index = this.children.indexOf(child);
            if (index >= 0) this.children.splice(index, 1);
            if (child.parent === this) child.parent = null;
        }
    }
    class FakeMesh {
        constructor(geometry, shader) {
            this.geometry = geometry;
            this.shader = shader;
            this.parent = null;
            this.visible = false;
            this.position = { set() {} };
            this.scale = { set() {} };
        }
        destroy() {}
    }
    const fakePixi = {
        Container: FakeContainer,
        Geometry: FakeGeometry,
        Mesh: FakeMesh,
        Shader: { from: (_vs, _fs, uniforms) => ({ uniforms }) },
        State: class {},
        Texture: {
            WHITE: { id: "white" },
            from: (path) => ({ id: path, baseTexture: {} })
        },
        utils: {
            earcut(vertices) {
                const count = Math.floor(vertices.length / 2);
                const indices = [];
                for (let i = 1; i < count - 1; i++) indices.push(0, i, i + 1);
                return indices;
            }
        }
    };
    const RenderingImpl = loadRenderingImpl({
        PIXI: fakePixi,
        app: { screen: { width: 800, height: 600 } }
    });
    const renderer = new RenderingImpl();
    renderer.layers = { depthObjects: new FakeContainer() };
    renderer.camera = { x: 0, y: 0, z: 0, viewscale: 1, xyratio: 1 };
    const baseEntry = {
        key: "fragment:basement",
        level: -1,
        baseZ: -3,
        holes: [],
        texture: null,
        textureBounds: null,
        textureRepeat: { x: 1, y: 1 },
        texturePath: "/assets/images/flooring/cave.jpg",
        tint: 0xffffff,
        alpha: 1,
        depthBias: 0.001,
        isHoleOverlay: false
    };
    renderer.collectFloorVisualEntries = () => [{
        ...baseEntry,
        outer: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 5, y: 12 },
            { x: 0, y: 10 }
        ]
    }];
    renderer.renderFloorVisualPolygons({});
    const firstEntry = renderer.floorVisualMeshByKey.get("fragment:basement");
    assert.ok(firstEntry);

    renderer.collectFloorVisualEntries = () => [{
        ...baseEntry,
        outer: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 7, y: 12 },
            { x: 0, y: 10 }
        ]
    }];
    renderer.renderFloorVisualPolygons({});

    const secondEntry = renderer.floorVisualMeshByKey.get("fragment:basement");
    assert.ok(secondEntry);
    const positionData = Array.from(secondEntry.mesh.geometry.getBuffer("aVertexPosition").data);
    assert.equal(positionData[6], 7);
    assert.notEqual(secondEntry.signature, firstEntry.signature);
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
    assert.equal(wizardHat.zIndex, 2147483651);
    assert.equal(tintedDisplay.zIndex, originalTintZ);
    assert.equal(hiddenHighlight.zIndex, 0);
});

test("interior presentation keeps wizard hat above body when body is promoted later", () => {
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
    const ui = makeContainer();
    const entities = makeContainer();
    renderer.layers = { ui };
    renderer.getLayerCutawayState = () => ({ active: true, triggers: [{ activeInteriorRegion: { id: "inside" } }] });

    const wizardHat = { name: "wizardHat", visible: true, renderable: true, zIndex: 0, parent: null };
    const wizardBody = { name: "wizardBody", visible: true, renderable: true, zIndex: 0, parent: null };
    ui.addChild(wizardHat);
    entities.addChild(wizardBody);

    const promoted = renderer.promoteInteriorPresentationForeground({
        wizard: {
            _renderingDepthMesh: wizardBody,
            pixiSprite: { name: "hiddenWizardSprite", visible: false, renderable: false },
            hatGraphics: wizardHat
        }
    });

    assert.equal(promoted, 2);
    assert.equal(wizardBody.parent, ui);
    assert.equal(wizardHat.parent, ui);
    assert.equal(wizardBody.zIndex, 2147483650);
    assert.equal(wizardHat.zIndex, 2147483651);
    assert.equal(wizardHat.zIndex > wizardBody.zIndex, true);
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
            renderCache: { interiorRegions: [region], renderItems: [] }
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

test("building interior render plan keeps active-floor doors visible", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    const mountedWall = {
        type: "wallSection",
        bottomZ: 3
    };
    RenderingImpl.__testContext.WallSectionUnit = {
        _allSections: new Map([[42, mountedWall]])
    };
    const activeDoor = {
        type: "door",
        category: "doors",
        rotationAxis: "spatial",
        mountedWallSectionUnitId: 42
    };
    const upperDoor = {
        type: "door",
        category: "doors",
        traversalLayer: 2
    };
    const activeRegion = {
        id: "fragment:house-l1",
        fragmentId: "house-l1",
        surfaceId: "house",
        level: 1,
        polygon: { outer: [], holes: [] },
        staticObjects: []
    };
    const cutawayState = {
        triggers: [{
            activeInteriorRegion: activeRegion,
            renderCache: {
                interiorRegions: [activeRegion],
                renderItems: [
                    { item: activeDoor, level: 0 },
                    { item: upperDoor, level: 2 }
                ]
            }
        }]
    };

    const plan = renderer.buildBuildingInteriorRenderPlan({}, cutawayState);

    assert.equal(plan.items.has(activeDoor), true);
    assert.equal(plan.items.has(upperDoor), false);
});

test("building render cache discovers mounted interior doors without floor refs", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    const mountedWall = {
        id: 42,
        type: "wallSection",
        bottomZ: 3
    };
    RenderingImpl.__testContext.WallSectionUnit = {
        _allSections: new Map([[42, mountedWall]])
    };
    const activeDoor = {
        type: "door",
        category: "doors",
        rotationAxis: "spatial",
        mountedWallSectionUnitId: 42,
        x: 5,
        y: 5
    };
    const fragment = {
        fragmentId: "house-l1",
        surfaceId: "house",
        level: 1,
        outerPolygon: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 }
        ]
    };
    const building = {
        buildingId: "building:house",
        fragmentIds: new Set(["house-l1"]),
        surfaceIds: new Set(["house"])
    };
    const map = {
        floorsById: new Map([["house-l1", fragment]]),
        getGameObjects: () => [activeDoor],
        shortestDeltaX: (fromX, toX) => toX - fromX,
        shortestDeltaY: (fromY, toY) => toY - fromY
    };

    const cache = renderer.getCompiledBuildingRenderCache({ map, roofs: [] }, map, building);
    const activeRegion = cache.interiorRegions.find(region => region.fragmentId === "house-l1");
    const plan = renderer.buildBuildingInteriorRenderPlan({ map }, {
        triggers: [{
            activeInteriorRegion: activeRegion,
            renderCache: cache
        }]
    });

    assert.equal(cache.renderItems.some(entry => entry.item === activeDoor && entry.level === 1), true);
    assert.equal(plan.items.has(activeDoor), true);
});

test("building interior rendering draws active-floor doors even when their wall is collapsed", () => {
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
    const depthObjects = makeContainer("renderingDepthObjects");
    renderer.layers = {
        objects3d: makeContainer("renderingObjects3d"),
        depthObjects,
        groundObjects: makeContainer("renderingGroundObjects"),
        characters: makeContainer("renderingCharacters")
    };
    renderer.getCharacterLayer = () => renderer.layers.characters;
    renderer.clearBuildingInteriorForegroundPromotions = () => {};
    renderer.isOmnivisionActive = () => false;
    renderer.isLosMazeModeEnabled = () => true;
    renderer.isScriptVisible = () => true;
    renderer.getRoofsList = () => [];
    renderer.isBuildingCutawayCompositeCacheUsable = () => false;
    renderer.updateSinkAnimation = () => {};
    renderer.renderGroundObjects = () => new Set();
    renderer.renderBuildingCutawayGroundMasks = () => [];
    renderer.renderBuildingCutawayComposites = () => null;
    renderer.renderActiveBuildingInteriorOverlay = () => 0;
    renderer.promoteActiveBuildingInteriorRegions = () => 0;
    renderer.applyScriptBrightness = () => {};
    renderer.applyFrozenTint = () => {};
    renderer.applyLayerDarknessForItem = () => {};
    renderer.applySinkClip = () => true;
    renderer.addPickRenderItem = () => {};
    renderer.logPlaceObjectRenderDebug = () => {};
    renderer.currentLosState = { visibleObjects: [] };

    const mountedWall = {
        id: 42,
        type: "wallSection",
        bottomZ: 3
    };
    RenderingImpl.__testContext.WallSectionUnit = {
        _allSections: new Map([[42, mountedWall]])
    };
    const mesh = { visible: false, renderable: false, alpha: 0, parent: null };
    let updateCalls = 0;
    let depthOptions = null;
    const activeDoor = {
        type: "door",
        category: "doors",
        rotationAxis: "spatial",
        mountedWallSectionUnitId: 42,
        x: 5,
        y: 5,
        depthBillboardFaceCenters: {
            front: { x: 11, y: 5 },
            back: { x: 5, y: 5 }
        },
        pixiSprite: { visible: true, renderable: true, alpha: 1 },
        texturePath: "/assets/images/doors/door2.png",
        updateDepthBillboardMesh(_ctx, _camera, options) {
            updateCalls += 1;
            depthOptions = options;
            return mesh;
        }
    };
    const activeRegion = {
        id: "fragment:house-l1",
        fragmentId: "house-l1",
        surfaceId: "house",
        level: 1,
        polygon: {
            outer: [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 10, y: 10 },
                { x: 0, y: 10 }
            ],
            holes: []
        },
        staticObjects: []
    };
    const cutawayState = {
        active: true,
        triggers: [{
            activeInteriorRegion: activeRegion,
            renderCache: {
                interiorRegions: [activeRegion],
                renderItems: [{ item: activeDoor, level: 0 }]
            }
        }]
    };
    renderer.prepareLayerCutawayFrame = () => cutawayState;

    renderer.renderObjects3D({
        wizard: { currentLayer: 1 },
        map: {},
        app: { screen: { width: 800, height: 600 } },
        renderNowMs: 1000
    }, [], []);

    assert.equal(updateCalls, 1);
    assert.equal(depthOptions.forceMountedWallSide, "back");
    assert.equal(depthOptions.drawOnlyMountedWallSide, true);
    assert.equal(mesh.visible, true);
    assert.equal(mesh.renderable, true);
    assert.equal(mesh.parent, renderer.layers.objects3d);
});

test("building doorway transition latches interior presentation until threshold is cleared", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    const mountedWall = {
        id: 42,
        type: "wallSection",
        startPoint: { x: 0, y: 0 },
        endPoint: { x: 10, y: 0 },
        bottomZ: 3
    };
    RenderingImpl.__testContext.WallSectionUnit = {
        _allSections: new Map([[42, mountedWall]])
    };
    const door = {
        type: "door",
        category: "doors",
        rotationAxis: "spatial",
        mountedWallSectionUnitId: 42,
        x: 5,
        y: 0,
        width: 2,
        depthBillboardFaceCenters: {
            front: { x: 5, y: 0.25 },
            back: { x: 5, y: -0.25 }
        }
    };
    const activeRegion = {
        id: "fragment:house-l1",
        level: 1,
        polygon: { outer: [], holes: [] }
    };
    const activeState = {
        active: true,
        wizardLayer: 1,
        wizardBaseZ: 3,
        wizardX: 5,
        wizardY: -0.2,
        triggers: [{
            building: { buildingId: "building:house" },
            buildingId: "building:house",
            activeInteriorRegion: activeRegion,
            renderCache: {
                interiorRegions: [activeRegion],
                renderItems: [{ item: door, level: 1 }]
            }
        }],
        hiddenFromLevel: 1,
        hiddenSurfaceIds: new Set(["house"]),
        hiddenFragmentIds: new Set(["house-l1"])
    };
    const latched = renderer.updateBuildingDoorwayPresentationTransition(
        {},
        activeState,
        { shortestDeltaX: (fromX, toX) => toX - fromX, shortestDeltaY: (fromY, toY) => toY - fromY },
        { x: 5, y: -0.2, currentLayer: 1 },
        1000
    );

    assert.equal(!!latched._doorwayPresentationTransition, true);
    assert.equal(latched._doorwayPresentationTransition.presentationWizard.y, -0.2);

    const currentOutsideState = {
        active: false,
        wizardLayer: 1,
        wizardBaseZ: 3,
        wizardX: 5,
        wizardY: 0.6,
        triggers: [],
        hiddenFromLevel: Infinity,
        hiddenSurfaceIds: new Set(),
        hiddenFragmentIds: new Set()
    };
    const stillLatched = renderer.updateBuildingDoorwayPresentationTransition(
        {},
        currentOutsideState,
        { shortestDeltaX: (fromX, toX) => toX - fromX, shortestDeltaY: (fromY, toY) => toY - fromY },
        { x: 5, y: 0.6, currentLayer: 1 },
        1100
    );

    assert.equal(stillLatched.active, true);
    assert.equal(stillLatched.triggers.length, 1);
    assert.equal(stillLatched._doorwayPresentationTransition.presentationWizard.y, -0.2);

    const clearedState = renderer.updateBuildingDoorwayPresentationTransition(
        {},
        { ...currentOutsideState, wizardY: 1.2 },
        { shortestDeltaX: (fromX, toX) => toX - fromX, shortestDeltaY: (fromY, toY) => toY - fromY },
        { x: 5, y: 1.2, currentLayer: 1 },
        1200
    );

    assert.equal(clearedState.active, false);
    assert.equal(!!clearedState._doorwayPresentationTransition, false);
});

test("building doorway transition latches exterior presentation when entering", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    const mountedWall = {
        id: 42,
        type: "wallSection",
        startPoint: { x: 0, y: 0 },
        endPoint: { x: 10, y: 0 },
        bottomZ: 3
    };
    RenderingImpl.__testContext.WallSectionUnit = {
        _allSections: new Map([[42, mountedWall]])
    };
    const door = {
        type: "door",
        category: "doors",
        rotationAxis: "spatial",
        mountedWallSectionUnitId: 42,
        x: 5,
        y: 0,
        width: 2,
        depthBillboardFaceCenters: {
            front: { x: 5, y: 0.25 },
            back: { x: 5, y: -0.25 }
        }
    };
    const map = {
        shortestDeltaX: (fromX, toX) => toX - fromX,
        shortestDeltaY: (fromY, toY) => toY - fromY
    };
    const exteriorState = {
        active: false,
        wizardLayer: 1,
        wizardBaseZ: 3,
        wizardX: 5,
        wizardY: 0.2,
        triggers: [],
        hiddenFromLevel: Infinity,
        hiddenSurfaceIds: new Set(),
        hiddenFragmentIds: new Set()
    };
    assert.equal(renderer.updateBuildingDoorwayPresentationTransition(
        {},
        exteriorState,
        map,
        { x: 5, y: 0.2, currentLayer: 1 },
        1000
    ), exteriorState);

    const activeRegion = {
        id: "fragment:house-l1",
        level: 1,
        polygon: { outer: [], holes: [] }
    };
    const interiorState = {
        active: true,
        wizardLayer: 1,
        wizardBaseZ: 3,
        wizardX: 5,
        wizardY: -0.2,
        triggers: [{
            building: { buildingId: "building:house" },
            buildingId: "building:house",
            activeInteriorRegion: activeRegion,
            renderCache: {
                interiorRegions: [activeRegion],
                renderItems: [{ item: door, level: 1 }]
            }
        }],
        hiddenFromLevel: 1,
        hiddenSurfaceIds: new Set(["house"]),
        hiddenFragmentIds: new Set(["house-l1"])
    };
    const latchedExterior = renderer.updateBuildingDoorwayPresentationTransition(
        {},
        interiorState,
        map,
        { x: 5, y: -0.2, currentLayer: 1 },
        1100
    );

    assert.equal(latchedExterior.active, false);
    assert.equal(latchedExterior.triggers.length, 0);
    assert.equal(!!latchedExterior._doorwayPresentationTransition, true);
    assert.equal(latchedExterior._doorwayPresentationTransition.presentationWizard.y, 0.2);

    const stillLatchedExterior = renderer.updateBuildingDoorwayPresentationTransition(
        {},
        { ...interiorState, wizardY: -0.6 },
        map,
        { x: 5, y: -0.6, currentLayer: 1 },
        1200
    );

    assert.equal(stillLatchedExterior.active, false);
    assert.equal(stillLatchedExterior.triggers.length, 0);

    const committedInterior = renderer.updateBuildingDoorwayPresentationTransition(
        {},
        { ...interiorState, wizardY: -1.2 },
        map,
        { x: 5, y: -1.2, currentLayer: 1 },
        1300
    );

    assert.equal(committedInterior.active, true);
    assert.equal(committedInterior.triggers.length, 1);
    assert.equal(!!committedInterior._doorwayPresentationTransition, false);
});

test("prototype building doorway transitions into interior presentation after entry", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    const map = {
        floorsById: new Map(),
        shortestDeltaX: (fromX, toX) => toX - fromX,
        shortestDeltaY: (fromY, toY) => toY - fromY,
        _buildingRenderCacheVersion: 0,
        markBuildingRenderCacheDirty() {
            this._buildingRenderCacheVersion += 1;
        }
    };
    sectionWorldBuildings.installSectionWorldBuildingApis(map);
    const buildingData = {
        schema: "survivor-building-v1",
        floorFragments: [{
            fragmentId: "floor-0",
            surfaceId: "floor-0",
            level: 0,
            nodeBaseZ: 0,
            outerPolygon: [
                { x: 0, y: -5 },
                { x: 10, y: -5 },
                { x: 10, y: 2 },
                { x: 0, y: 2 }
            ],
            holes: []
        }],
        wallSections: [{
            id: 42,
            floorId: "floor-0",
            fragmentId: "floor-0",
            startPoint: { x: 0, y: 0 },
            endPoint: { x: 10, y: 0 },
            thickness: 0.25,
            bottomZ: 0,
            traversalLayer: 0,
            role: "perimeter"
        }, {
            id: 43,
            floorId: "floor-0",
            fragmentId: "floor-0",
            startPoint: { x: 10, y: 0 },
            endPoint: { x: 10, y: -5 },
            thickness: 0.25,
            bottomZ: 0,
            traversalLayer: 0,
            role: "perimeter"
        }, {
            id: 44,
            floorId: "floor-0",
            fragmentId: "floor-0",
            startPoint: { x: 10, y: -5 },
            endPoint: { x: 0, y: -5 },
            thickness: 0.25,
            bottomZ: 0,
            traversalLayer: 0,
            role: "perimeter"
        }, {
            id: 45,
            floorId: "floor-0",
            fragmentId: "floor-0",
            startPoint: { x: 0, y: -5 },
            endPoint: { x: 0, y: 0 },
            thickness: 0.25,
            bottomZ: 0,
            traversalLayer: 0,
            role: "perimeter"
        }],
        mountedWallObjects: [{
            id: 7,
            type: "placedObject",
            category: "doors",
            wallId: 42,
            wallT: 0.5,
            width: 2,
            height: 3,
            rotationAxis: "spatial",
            isPassable: true
        }]
    };
    map.addPrototypeBuildingPlacement({
        id: "building:placed-test-house",
        buildingSaveName: "test house",
        transform: { x: 0, y: 0, rotation: 0 }
    }, { buildingData });

    const outsideState = renderer.getLayerCutawayState({
        map,
        wizard: { x: 5, y: 0.2, currentLayer: 0, currentLayerBaseZ: 0 },
        renderNowMs: 1000
    });
    assert.equal(outsideState.active, false);
    assert.equal(outsideState.triggers.length, 0);

    const thresholdState = renderer.getLayerCutawayState({
        map,
        wizard: { x: 5, y: -0.2, currentLayer: 0, currentLayerBaseZ: 0 },
        renderNowMs: 1100
    });
    assert.equal(thresholdState.active, false);
    assert.equal(thresholdState.triggers.length, 0);
    assert.equal(!!thresholdState._doorwayPresentationTransition, true);

    const interiorState = renderer.getLayerCutawayState({
        map,
        wizard: { x: 5, y: -1.2, currentLayer: 0, currentLayerBaseZ: 0 },
        renderNowMs: 1300
    });
    assert.equal(interiorState.active, true);
    assert.equal(interiorState.triggers.length, 1);
    assert.equal(interiorState.triggers[0].buildingId, "building:placed-test-house");
    assert.equal(!!interiorState.triggers[0].activeInteriorRegion, true);
    assert.equal(!!interiorState._doorwayPresentationTransition, false);
    assert.equal(renderer.isPrototypeBuildingExteriorHiddenByInteriorCutaway(
        { id: "building:placed-test-house" },
        { _renderingLayerCutawayState: outsideState }
    ), false);
    assert.equal(renderer.isPrototypeBuildingExteriorHiddenByInteriorCutaway(
        { id: "building:placed-test-house" },
        { _renderingLayerCutawayState: interiorState }
    ), true);
});

test("prototype building active interior requests and renders source floor bitmap", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    const placement = {
        id: "building:placed-test-house",
        buildingSaveName: "test house",
        transform: { x: 3, y: 4, rotation: 0.25 }
    };
    const cache = {
        id: "building:placed-test-house|floor-0",
        placementId: placement.id,
        floorId: "floor-0",
        status: "ready",
        texture: {},
        depthMetricTexture: {},
        depthMetric: { min: -1, span: 2 },
        bounds: { worldWidth: 8, worldHeight: 6 }
    };
    let requested = null;
    let rendered = null;
    let hiddenIds = null;
    const map = {
        getPrototypeBuildingInteriorBitmap(id, floorId) {
            requested = { phase: "get", id, floorId };
            return null;
        },
        requestPrototypeBuildingInteriorBitmap(requestPlacement, floorId, options) {
            requested = {
                phase: "request",
                placementId: requestPlacement && requestPlacement.id,
                floorId,
                hasApp: !!options.app,
                hasRenderer: !!options.renderer
            };
            return cache;
        }
    };
    const trigger = {
        buildingId: placement.id,
        building: {
            buildingId: placement.id,
            _prototypeBuildingPlacement: placement
        },
        activeInteriorRegion: {
            fragmentId: `${placement.id}:floor:floor-0`,
            fragment: {
                _prototypeBuildingSourceFragmentId: "floor-0"
            }
        }
    };
    renderer.getLayerCutawayState = () => ({
        active: true,
        triggers: [trigger]
    });
    renderer.renderPrototypeBuildingInteriorBitmap = (ctx, renderedPlacement, renderedCache) => {
        rendered = { ctx, placement: renderedPlacement, cache: renderedCache };
        return { name: "interior bitmap mesh" };
    };
    renderer.hideUnusedPrototypeBuildingInteriors = (activeIds) => {
        hiddenIds = new Set(activeIds);
    };

    const renderedMeshes = renderer.renderPrototypeBuildingInteriors({
        map,
        app: { renderer: {} }
    });

    assert.deepEqual(requested, {
        phase: "request",
        placementId: placement.id,
        floorId: "floor-0",
        hasApp: true,
        hasRenderer: true
    });
    assert.equal(rendered.placement, placement);
    assert.equal(rendered.cache, cache);
    assert.deepEqual([...hiddenIds], [cache.id]);
    assert.deepEqual([...renderedMeshes].map((mesh) => mesh.name), ["interior bitmap mesh"]);
});

test("ready prototype interior bitmap suppresses duplicate live interior geometry", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    const placement = {
        id: "building:placed-test-house",
        buildingSaveName: "test house",
        transform: { x: 3, y: 4, rotation: 0.25 }
    };
    const wallItem = {
        id: "wall-1",
        type: "wallSection",
        gone: false,
        vanishing: false
    };
    const stairItem = {
        id: "stair-1",
        type: "treadPathStair",
        gone: false,
        vanishing: false,
        visible: true
    };
    const region = {
        id: "floor-region-0",
        fragmentId: `${placement.id}:floor:floor-0`,
        level: 0,
        polygon: {
            outer: [
                { x: 0, y: 0 },
                { x: 1, y: 0 },
                { x: 1, y: 1 }
            ],
            holes: []
        },
        staticObjects: [
            { item: wallItem, level: 0 },
            { item: stairItem, level: 0 }
        ]
    };
    const trigger = {
        buildingId: placement.id,
        building: {
            buildingId: placement.id,
            _prototypeBuildingPlacement: placement
        },
        activeInteriorRegion: {
            ...region,
            fragment: {
                _prototypeBuildingSourceFragmentId: "floor-0"
            }
        },
        renderCache: {
            renderItems: [
                { item: wallItem, level: 0 },
                { item: stairItem, level: 0 }
            ],
            interiorRegions: [region]
        }
    };
    const cache = {
        id: "building:placed-test-house|floor-0",
        placementId: placement.id,
        floorId: "floor-0",
        status: "ready",
        texture: {}
    };
    const bitmapLookups = [];
    const map = {
        getPrototypeBuildingInteriorBitmap(id, floorId) {
            bitmapLookups.push({ id, floorId });
            return cache;
        }
    };
    renderer.getBuildingInteriorDynamicCharacterCandidates = () => [];

    const plan = renderer.buildBuildingInteriorRenderPlan(
        { map, wizard: { x: 0, y: 0 } },
        { active: true, triggers: [trigger] }
    );

    assert.deepEqual(bitmapLookups, [{ id: placement.id, floorId: "floor-0" }]);
    assert.equal(plan.active, false);
    assert.equal(plan.items.has(wallItem), false);
    assert.equal(plan.items.has(stairItem), false);
});

test("ready prototype interior bitmap does not promote stale live interior display objects", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    const placement = {
        id: "building:placed-test-house",
        buildingSaveName: "test house",
        transform: { x: 3, y: 4, rotation: 0.25 }
    };
    const staleDisplayObject = {
        visible: true,
        renderable: true,
        parent: null
    };
    const stairItem = {
        id: "stair-1",
        type: "treadPathStair",
        gone: false,
        vanishing: false,
        _renderingDisplayObject: staleDisplayObject
    };
    const region = {
        id: "floor-region-0",
        fragmentId: `${placement.id}:floor:floor-0`,
        level: 0,
        polygon: {
            outer: [
                { x: 0, y: 0 },
                { x: 1, y: 0 },
                { x: 1, y: 1 }
            ],
            holes: []
        },
        staticObjects: [
            { item: stairItem, level: 0 }
        ]
    };
    const trigger = {
        buildingId: placement.id,
        building: {
            buildingId: placement.id,
            _prototypeBuildingPlacement: placement
        },
        activeInteriorRegion: {
            ...region,
            fragment: {
                _prototypeBuildingSourceFragmentId: "floor-0"
            }
        },
        renderCache: {
            interiorRegions: [region]
        }
    };
    const map = {
        getPrototypeBuildingInteriorBitmap(id, floorId) {
            assert.equal(id, placement.id);
            assert.equal(floorId, "floor-0");
            return {
                id: `${placement.id}|floor-0`,
                placementId: placement.id,
                floorId: "floor-0",
                status: "ready",
                texture: {}
            };
        }
    };
    let promoted = 0;
    renderer.promoteDisplayObjectForBuildingInterior = () => {
        promoted += 1;
        return true;
    };

    const promotedCount = renderer.promoteActiveBuildingInteriorRegions(
        { map, wizard: { x: 0, y: 0 } },
        { active: true, triggers: [trigger] },
        { addChild() {} },
        new Set(),
        { items: new Set(), wallTopFaceOnly: new Map(), doorInteriorSide: new Map() }
    );

    assert.equal(promotedCount, 0);
    assert.equal(promoted, 0);
});

test("prototype building interior floor transitions fade upper floor bitmaps in and out", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    const placement = {
        id: "building:placed-test-house",
        buildingSaveName: "test house",
        transform: { x: 3, y: 4, rotation: 0.25 }
    };
    const caches = new Map([
        ["floor-0", {
            id: "building:placed-test-house|floor-0",
            placementId: placement.id,
            floorId: "floor-0",
            status: "ready",
            texture: {},
            depthMetricTexture: {},
            depthMetric: { min: -1, span: 2 },
            bounds: { worldWidth: 8, worldHeight: 6 }
        }],
        ["floor-1", {
            id: "building:placed-test-house|floor-1",
            placementId: placement.id,
            floorId: "floor-1",
            status: "ready",
            texture: {},
            depthMetricTexture: {},
            depthMetric: { min: -1, span: 2 },
            bounds: { worldWidth: 8, worldHeight: 6 }
        }]
    ]);
    const requested = [];
    const rendered = [];
    const capturedSnapshots = [];
    const renderedSnapshots = [];
    let hiddenSnapshots = 0;
    let hiddenIds = null;
    const map = {
        getPrototypeBuildingInteriorBitmap(id, floorId) {
            requested.push({ phase: "get", id, floorId });
            return caches.get(floorId) || null;
        },
        requestPrototypeBuildingInteriorBitmap() {
            throw new Error("ready prototype interior bitmap should not be requested");
        }
    };
    const trigger = {
        buildingId: placement.id,
        building: {
            buildingId: placement.id,
            _prototypeBuildingPlacement: placement
        },
        activeInteriorRegion: {
            fragmentId: `${placement.id}:floor:floor-1`,
            fragment: {
                _prototypeBuildingSourceFragmentId: "floor-1"
            }
        },
        interiorFloorTransition: {
            fromTriggerLevel: 1,
            toTriggerLevel: 2,
            fromSourceFloorId: "floor-0",
            toSourceFloorId: "floor-1",
            progress: 0.25
        }
    };
    renderer.getLayerCutawayState = () => ({
        active: true,
        triggers: [trigger]
    });
    renderer.renderPrototypeBuildingInteriorBitmap = (ctx, renderedPlacement, renderedCache, options) => {
        rendered.push({
            ctx,
            placement: renderedPlacement,
            cache: renderedCache,
            alpha: options && options.alpha,
            zIndexOffset: options && options.zIndexOffset
        });
        return { name: `interior bitmap mesh ${renderedCache.floorId}` };
    };
    renderer.capturePrototypeBuildingInteriorFloorSnapshot = (ctx, renderedPlacement, renderedCache, transition) => {
        capturedSnapshots.push({
            ctx,
            placement: renderedPlacement,
            floorId: renderedCache.floorId,
            fromSourceFloorId: transition && transition.fromSourceFloorId,
            toSourceFloorId: transition && transition.toSourceFloorId,
            progress: transition && transition.progress
        });
        renderer.prototypeBuildingInteriorFloorSnapshot = {
            active: true,
            signature: renderer.getPrototypeBuildingInteriorFloorSnapshotSignature(ctx, renderedPlacement, transition)
        };
        renderer.prototypeBuildingInteriorFloorSnapshotSprite = { visible: true };
        return true;
    };
    renderer.renderPrototypeBuildingInteriorFloorSnapshot = (ctx, transition) => {
        const alpha = renderer.getPrototypeBuildingInteriorBitmapTransitionAlphas(transition).fromAlpha;
        renderedSnapshots.push({
            ctx,
            fromSourceFloorId: transition && transition.fromSourceFloorId,
            toSourceFloorId: transition && transition.toSourceFloorId,
            alpha
        });
        renderer.prototypeBuildingInteriorFloorSnapshotSprite = { visible: true };
        return { name: `snapshot:${transition && transition.fromSourceFloorId}` };
    };
    renderer.hidePrototypeBuildingInteriorFloorSnapshot = () => {
        hiddenSnapshots += 1;
        renderer.prototypeBuildingInteriorFloorSnapshot = null;
        if (renderer.prototypeBuildingInteriorFloorSnapshotSprite) {
            renderer.prototypeBuildingInteriorFloorSnapshotSprite.visible = false;
        }
    };
    renderer.hideUnusedPrototypeBuildingInteriors = (activeIds) => {
        hiddenIds = new Set(activeIds);
    };

    const renderedMeshes = renderer.renderPrototypeBuildingInteriors({
        map,
        app: { renderer: {} }
    });

    assert.deepEqual(requested.map(entry => entry.floorId), ["floor-0", "floor-1"]);
    assert.deepEqual(rendered.map(entry => ({
        floorId: entry.cache.floorId,
        alpha: entry.alpha,
        zIndexOffset: entry.zIndexOffset
    })), [
        { floorId: "floor-1", alpha: 1, zIndexOffset: 0 }
    ]);
    assert.deepEqual(capturedSnapshots.map(entry => ({
        floorId: entry.floorId,
        fromSourceFloorId: entry.fromSourceFloorId,
        toSourceFloorId: entry.toSourceFloorId,
        progress: entry.progress
    })), [
        { floorId: "floor-0", fromSourceFloorId: "floor-0", toSourceFloorId: "floor-1", progress: 0.25 }
    ]);
    assert.deepEqual(renderedSnapshots.map(entry => ({
        fromSourceFloorId: entry.fromSourceFloorId,
        toSourceFloorId: entry.toSourceFloorId,
        alpha: entry.alpha
    })), [
        { fromSourceFloorId: "floor-0", toSourceFloorId: "floor-1", alpha: 0.75 }
    ]);
    assert.deepEqual([...hiddenIds], [
        "building:placed-test-house|floor-1"
    ]);
    assert.deepEqual([...renderedMeshes].map((mesh) => mesh.name), [
        "interior bitmap mesh floor-1"
    ]);

    requested.length = 0;
    rendered.length = 0;
    capturedSnapshots.length = 0;
    renderedSnapshots.length = 0;
    hiddenIds = null;
    trigger.activeInteriorRegion.fragmentId = `${placement.id}:floor:floor-0`;
    trigger.activeInteriorRegion.fragment._prototypeBuildingSourceFragmentId = "floor-0";
    trigger.interiorFloorTransition = {
        fromTriggerLevel: 2,
        toTriggerLevel: 1,
        fromSourceFloorId: "floor-1",
        toSourceFloorId: "floor-0",
        progress: 0.25
    };

    renderer.renderPrototypeBuildingInteriors({
        map,
        app: { renderer: {} }
    });

    assert.deepEqual(rendered.map(entry => ({
        floorId: entry.cache.floorId,
        alpha: entry.alpha,
        zIndexOffset: entry.zIndexOffset
    })), [
        { floorId: "floor-0", alpha: 1, zIndexOffset: 0 },
    ]);
    assert.deepEqual(capturedSnapshots.map(entry => ({
        floorId: entry.floorId,
        fromSourceFloorId: entry.fromSourceFloorId,
        toSourceFloorId: entry.toSourceFloorId,
        progress: entry.progress
    })), [
        { floorId: "floor-1", fromSourceFloorId: "floor-1", toSourceFloorId: "floor-0", progress: 0.25 }
    ]);
    assert.deepEqual(renderedSnapshots.map(entry => ({
        fromSourceFloorId: entry.fromSourceFloorId,
        toSourceFloorId: entry.toSourceFloorId,
        alpha: entry.alpha
    })), [
        { fromSourceFloorId: "floor-1", toSourceFloorId: "floor-0", alpha: 0.75 }
    ]);

    rendered.length = 0;
    renderedSnapshots.length = 0;
    hiddenSnapshots = 0;
    delete trigger.interiorFloorTransition;
    renderer.prototypeBuildingInteriorFloorSnapshot = { active: true, signature: "old-transition" };
    renderer.prototypeBuildingInteriorFloorSnapshotSprite = { visible: true };

    renderer.renderPrototypeBuildingInteriors({
        map,
        app: { renderer: {} }
    });

    assert.deepEqual(rendered.map(entry => ({
        floorId: entry.cache.floorId,
        alpha: entry.alpha,
        zIndexOffset: entry.zIndexOffset
    })), [
        { floorId: "floor-0", alpha: 1, zIndexOffset: 0 }
    ]);
    assert.deepEqual(renderedSnapshots, []);
    assert.equal(hiddenSnapshots, 1);
});

test("building interior visual region switches one meter below the upper floor", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    const lowerFragment = {
        fragmentId: "house-l1",
        level: 1,
        nodeBaseZ: 3,
        outerPolygon: [
            { x: 0, y: 0 },
            { x: 8, y: 0 },
            { x: 8, y: 8 },
            { x: 0, y: 8 }
        ],
        holes: []
    };
    const upperFragment = {
        fragmentId: "house-l2",
        level: 2,
        nodeBaseZ: 6,
        outerPolygon: [
            { x: 0, y: 0 },
            { x: 8, y: 0 },
            { x: 8, y: 8 },
            { x: 0, y: 8 }
        ],
        holes: [[
            { x: 3, y: 3 },
            { x: 5, y: 3 },
            { x: 5, y: 5 },
            { x: 3, y: 5 }
        ]]
    };
    const renderCache = {
        interiorRegions: [
            {
                id: "fragment:house-l1",
                kind: "floorFragment",
                level: 1,
                fragment: lowerFragment,
                fragmentId: "house-l1",
                polygon: renderer.getFloorFragmentInteriorPolygon(lowerFragment)
            },
            {
                id: "fragment:house-l2",
                kind: "floorFragment",
                level: 2,
                fragment: upperFragment,
                fragmentId: "house-l2",
                polygon: renderer.getFloorFragmentInteriorPolygon(upperFragment)
            }
        ]
    };

    const belowThreshold = renderer.getBuildingInteriorVisualRegionAtPoint(renderCache, 4, 4, 1, 4.99);
    const atThreshold = renderer.getBuildingInteriorVisualRegionAtPoint(renderCache, 4, 4, 1, 5);

    assert.equal(belowThreshold.fragmentId, "house-l1");
    assert.equal(atThreshold.fragmentId, "house-l2");
});

test("building interior visual region prefers bitmap-backed floor over ground footprint", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    const lowerFragment = {
        fragmentId: "house-l0",
        level: 0,
        nodeBaseZ: 0,
        outerPolygon: [
            { x: 0, y: 0 },
            { x: 8, y: 0 },
            { x: 8, y: 8 },
            { x: 0, y: 8 }
        ],
        holes: [[
            { x: 3, y: 3 },
            { x: 5, y: 3 },
            { x: 5, y: 5 },
            { x: 3, y: 5 }
        ]]
    };
    const renderCache = {
        interiorRegions: [
            {
                id: "fragment:house-l0",
                kind: "floorFragment",
                level: 0,
                fragment: lowerFragment,
                fragmentId: "house-l0",
                polygon: renderer.getFloorFragmentInteriorPolygon(lowerFragment)
            },
            {
                id: "groundFootprint:0",
                kind: "groundFootprint",
                level: 0,
                polygon: {
                    outer: [
                        { x: 0, y: 0 },
                        { x: 8, y: 0 },
                        { x: 8, y: 8 },
                        { x: 0, y: 8 }
                    ],
                    holes: []
                }
            }
        ]
    };

    const region = renderer.getBuildingInteriorVisualRegionAtPoint(renderCache, 4, 4, 0, 0.5);

    assert.equal(region.kind, "floorFragment");
    assert.equal(region.fragmentId, "house-l0");
});

test("prototype ground-footprint interior trigger does not require a source floor bitmap", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    const placement = {
        id: "building:placed-ground",
        buildingSaveName: "test house",
        transform: { x: 0, y: 0, rotation: 0 }
    };
    const trigger = {
        buildingId: placement.id,
        building: {
            buildingId: placement.id,
            _prototypeBuildingPlacement: placement
        },
        level: 0,
        activeInteriorRegion: {
            id: "groundFootprint:0",
            kind: "groundFootprint",
            level: 0,
            polygon: {
                outer: [
                    { x: 0, y: 0 },
                    { x: 1, y: 0 },
                    { x: 1, y: 1 },
                    { x: 0, y: 1 }
                ],
                holes: []
            }
        }
    };
    const map = {
        getPrototypeBuildingInteriorBitmap() {
            throw new Error("ground-footprint prototype region should not request an interior bitmap");
        },
        requestPrototypeBuildingInteriorBitmap() {
            throw new Error("ground-footprint prototype region should not render an interior bitmap");
        }
    };
    let hiddenIds = null;
    renderer.getLayerCutawayState = () => ({
        active: true,
        triggers: [trigger]
    });
    renderer.hideUnusedPrototypeBuildingInteriors = (activeIds) => {
        hiddenIds = new Set(activeIds);
    };

    assert.equal(renderer.getBuildingInteriorFloorTransitionSourceId(trigger), "groundFootprint:0");
    renderer.updateBuildingInteriorFloorTransitions([trigger], 1000);
    const renderedMeshes = renderer.renderPrototypeBuildingInteriors({
        map,
        app: { renderer: {} }
    });

    assert.deepEqual([...renderedMeshes], []);
    assert.deepEqual([...hiddenIds], []);
});

test("prototype interior transition skips ground-footprint outgoing bitmap source", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    const placement = {
        id: "building:placed-ground-transition",
        buildingSaveName: "test house",
        transform: { x: 0, y: 0, rotation: 0 }
    };
    const cache = {
        id: `${placement.id}|floor-1`,
        placementId: placement.id,
        floorId: "floor-1",
        status: "ready",
        texture: {},
        depthMetricTexture: {},
        depthMetric: { min: -1, span: 2 },
        bounds: { worldWidth: 8, worldHeight: 6 }
    };
    const requestedFloorIds = [];
    const rendered = [];
    const trigger = {
        buildingId: placement.id,
        building: {
            buildingId: placement.id,
            _prototypeBuildingPlacement: placement
        },
        activeInteriorRegion: {
            fragmentId: `${placement.id}:floor:floor-1`,
            fragment: {
                _prototypeBuildingSourceFragmentId: "floor-1"
            }
        },
        interiorFloorTransition: {
            fromTriggerLevel: 0,
            toTriggerLevel: 1,
            fromSourceFloorId: "groundFootprint:0",
            toSourceFloorId: "floor-1",
            progress: 0.25
        }
    };
    const map = {
        getPrototypeBuildingInteriorBitmap(_id, floorId) {
            requestedFloorIds.push(floorId);
            return floorId === "floor-1" ? cache : null;
        },
        requestPrototypeBuildingInteriorBitmap(_placement, floorId) {
            requestedFloorIds.push(floorId);
            if (floorId === "groundFootprint:0") {
                throw new Error("ground-footprint transition source should not request an interior bitmap");
            }
            return cache;
        }
    };
    renderer.getLayerCutawayState = () => ({
        active: true,
        triggers: [trigger]
    });
    renderer.renderPrototypeBuildingInteriorBitmap = (_ctx, _placement, renderedCache, options) => {
        rendered.push({
            floorId: renderedCache.floorId,
            alpha: options && options.alpha
        });
        return { name: `mesh:${renderedCache.floorId}` };
    };
    renderer.hideUnusedPrototypeBuildingInteriors = () => {};

    renderer.renderPrototypeBuildingInteriors({
        map,
        app: { renderer: {} }
    });

    assert.deepEqual(requestedFloorIds, ["floor-1"]);
    assert.deepEqual(rendered, [{ floorId: "floor-1", alpha: 1 }]);
});

test("prototype building interior bitmaps are tracked by the objects3d lifecycle", () => {
    const source = fs.readFileSync(
        path.join(__dirname, "../public/assets/javascript/rendering/Rendering.js"),
        "utf8"
    );
    const renderObjectsStart = source.indexOf("renderObjects3D(ctx, visibleNodes");
    assert.ok(renderObjectsStart >= 0, "renderObjects3D source not found");
    const interiorCall = source.indexOf("this.renderPrototypeBuildingInteriors(ctx)", renderObjectsStart);
    const previousFrameCleanup = source.indexOf("for (const obj of this._currentDisplayObjectSets", renderObjectsStart);
    assert.ok(interiorCall > renderObjectsStart, "prototype interior render call missing from renderObjects3D");
    assert.ok(previousFrameCleanup > renderObjectsStart, "objects3d display cleanup missing");
    assert.ok(interiorCall < previousFrameCleanup, "prototype interiors must be added before objects3d display cleanup");
    assert.doesNotMatch(source, /profileDrawPassSection\("renderPrototypeBuildingInteriors"/);
});

test("outside building cutaway renders only exterior face for mounted windows", () => {
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
    const depthObjects = makeContainer("renderingDepthObjects");
    renderer.layers = {
        depthObjects,
        groundObjects: makeContainer("renderingGroundObjects"),
        characters: makeContainer("renderingCharacters")
    };
    renderer.getCharacterLayer = () => renderer.layers.characters;
    renderer.isOmnivisionActive = () => false;
    renderer.isLosMazeModeEnabled = () => false;
    renderer.isScriptVisible = () => true;
    renderer.applyScriptBrightness = () => {};
    renderer.applyFrozenTint = () => {};
    renderer.applyLayerDarknessForItem = () => {};
    renderer.applySinkClip = () => true;
    renderer.addPickRenderItem = () => {};

    const mountedWall = {
        id: 77,
        type: "wallSection",
        bottomZ: 3
    };
    RenderingImpl.__testContext.WallSectionUnit = {
        _allSections: new Map([[77, mountedWall]])
    };
    const mesh = { visible: false, renderable: false, alpha: 0, parent: null };
    let depthOptions = null;
    const windowItem = {
        type: "window",
        category: "windows",
        rotationAxis: "spatial",
        mountedWallSectionUnitId: 77,
        x: 5,
        y: 5,
        depthBillboardFaceCenters: {
            front: { x: 11, y: 5 },
            back: { x: 5, y: 5 }
        },
        pixiSprite: { visible: true, renderable: true, alpha: 1 },
        texturePath: "/assets/images/windows/window.png",
        updateDepthBillboardMesh(_ctx, _camera, options) {
            depthOptions = options;
            return mesh;
        }
    };
    const region = {
        id: "fragment:house-l1",
        level: 1,
        polygon: {
            outer: [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 10, y: 10 },
                { x: 0, y: 10 }
            ],
            holes: []
        }
    };
    const cutawayState = {
        active: true,
        triggers: [{
            building: { buildingId: "building:house" },
            buildingId: "building:house",
            level: 1,
            renderCache: {
                interiorRegions: [region],
                renderItems: [{ item: windowItem, level: 1 }]
            }
        }]
    };

    const rendered = renderer.renderDepthBillboardObjects({
        wizard: { x: 20, y: 5, currentLayer: 1 },
        map: {},
        app: { screen: { width: 800, height: 600 } }
    }, [windowItem], null, cutawayState);

    assert.equal(rendered.has(windowItem), true);
    assert.equal(depthOptions.forceMountedWallSide, "front");
    assert.equal(depthOptions.drawOnlyMountedWallSide, true);
    assert.equal(mesh.parent, depthObjects);
});

test("outside building cutaway does not force side selection for unrelated mounted windows", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    const windowItem = {
        type: "window",
        category: "windows",
        rotationAxis: "spatial",
        mountedWallSectionUnitId: 77,
        depthBillboardFaceCenters: {
            front: { x: 11, y: 5 },
            back: { x: 5, y: 5 }
        }
    };
    const region = {
        id: "fragment:house-l1",
        level: 1,
        polygon: {
            outer: [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 10, y: 10 },
                { x: 0, y: 10 }
            ],
            holes: []
        }
    };
    const cutawayState = {
        active: true,
        triggers: [{
            building: { buildingId: "building:house" },
            buildingId: "building:house",
            level: 1,
            renderCache: {
                interiorRegions: [region],
                renderItems: []
            }
        }]
    };

    const side = renderer.getBuildingCutawayMountedExteriorSide(
        windowItem,
        cutawayState,
        { wizard: { x: 20, y: 5 } },
        {}
    );

    assert.equal(side, null);
});

test("building interior picker draws only active-floor building entries", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    const parent = {};
    const activeFloorItem = {
        type: "furniture",
        category: "furniture"
    };
    const activeFloorSurface = {
        type: "road",
        category: "roads"
    };
    const inactiveFloorItem = {
        type: "furniture",
        category: "furniture"
    };
    const externalItem = {
        type: "tree",
        category: "trees"
    };
    const displayObj = {
        visible: true,
        parent
    };
    const activeRegion = {
        id: "fragment:house-l1",
        level: 1
    };
    const cutawayState = {
        triggers: [{
            activeInteriorRegion: activeRegion,
            renderCache: {
                renderItems: [
                    { item: activeFloorItem, level: 1 },
                    { item: activeFloorSurface, level: 1 },
                    { item: inactiveFloorItem, level: 2 }
                ],
                interiorRegions: []
            }
        }]
    };

    renderer.prepareBuildingInteriorPickerFrame(
        {},
        cutawayState,
        { items: new Set([activeFloorItem]) }
    );
    renderer.addPickRenderItem(activeFloorItem, displayObj);
    renderer.addPickRenderItem(activeFloorSurface, displayObj);
    renderer.addPickRenderItem(inactiveFloorItem, displayObj);
    renderer.addPickRenderItem(externalItem, displayObj);

    assert.equal(renderer.pickRenderItems.length, 3);
    assert.equal(renderer.pickRenderItems.some(entry => entry.item === activeFloorItem), true);
    assert.equal(renderer.pickRenderItems.some(entry => entry.item === activeFloorSurface), true);
    assert.equal(renderer.pickRenderItems.some(entry => entry.item === inactiveFloorItem), false);
    assert.equal(renderer.pickRenderItems.some(entry => entry.item === externalItem), true);
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

test("building cutaway composite skips prototype placement triggers without live capture objects", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    renderer.buildingCutawayCompositeCache = {
        active: true,
        texture: {},
        dataTexture: {},
        wizardLayer: 0,
        wizardX: 5,
        wizardY: 5
    };
    const state = {
        active: true,
        wizardLayer: 0,
        wizardX: 5,
        wizardY: 5,
        triggers: [{
            buildingId: "building:placed-1",
            building: {
                buildingId: "building:placed-1",
                _prototypeBuildingPlacement: { id: "building:placed-1" }
            },
            renderCache: {
                renderItems: [{
                    item: {
                        type: "wallSection",
                        _cutawayCompositeFrame: Number(renderer._layerCutawayFrameId) || 0
                    },
                    level: 0
                }]
            }
        }]
    };

    assert.deepEqual(renderer.getBuildingCutawayCompositeTriggers(state), []);
    assert.equal(renderer.getBuildingCutawayCompositeSignature(null, state), "");
    assert.equal(renderer.renderBuildingCutawayComposites({}, state, {}), null);
    assert.equal(renderer.buildingCutawayCompositeCache, null);
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

test("building cutaway composite marks floors visible through holes", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    renderer.beginLayerCutawayFrame();
    const upper = {
        fragmentId: "upper",
        surfaceId: "house",
        buildingId: "building:house",
        level: 2,
        nodeBaseZ: 6,
        outerPolygon: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 }
        ],
        holes: [[
            { x: 3, y: 3 },
            { x: 7, y: 3 },
            { x: 7, y: 7 },
            { x: 3, y: 7 }
        ]],
        texturePath: "/assets/images/flooring/woodfloor.png"
    };
    const lower = {
        fragmentId: "lower",
        surfaceId: "house",
        buildingId: "building:house",
        level: 1,
        nodeBaseZ: 3,
        outerPolygon: [
            { x: 2, y: 2 },
            { x: 8, y: 2 },
            { x: 8, y: 8 },
            { x: 2, y: 8 }
        ],
        texturePath: "/assets/images/flooring/woodfloor.png"
    };
    const building = {
        buildingId: "building:house",
        holeVisibleFragments: new Map([["upper", new Set(["lower"])]])
    };
    const cutawayState = {
        active: true,
        triggers: [{
            building,
            buildingId: "building:house",
            level: 1,
            alpha: 0.25,
            fragmentIds: new Set(["upper", "lower"]),
            surfaceIds: new Set(["house"])
        }]
    };
    renderer.getLayerCutawayState = () => cutawayState;

    const entries = renderer.collectFloorVisualEntries({
        map: {
            floorsById: new Map([
                ["upper", upper],
                ["lower", lower]
            ]),
            ensureFloorBuildings: () => new Map([[building.buildingId, building]])
        },
        wizard: { currentLayer: 0 }
    });

    const throughEntry = entries.find(entry => entry && entry.key === "fragment:lower:through:upper");
    assert.ok(throughEntry);
    assert.equal(throughEntry.buildingCutawayCompositeFrame, renderer._layerCutawayFrameId);
    assert.equal(throughEntry.buildingCutawayCompositeAlpha, 0.25);
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
    const flattenedWall = {
        id: 101,
        type: "wallSection",
        bottomZ: 3,
        isVisibleInMazeModeFacingRule: () => false
    };
    const standingWall = {
        id: 102,
        type: "wallSection",
        bottomZ: 3,
        isVisibleInMazeModeFacingRule: () => true
    };
    const latchedWall = {
        type: "wallSection",
        bottomZ: 3,
        isVisibleInMazeModeFacingRule: ({ player }) => player && player.x < 0
    };
    RenderingImpl.__testContext.WallSectionUnit = {
        _allSections: new Map([
            [101, flattenedWall],
            [102, standingWall]
        ])
    };
    const hiddenWindow = {
        type: "window",
        category: "windows",
        rotationAxis: "spatial",
        mountedWallSectionUnitId: 101,
        traversalLayer: 1
    };
    const visibleWindow = {
        type: "window",
        category: "windows",
        rotationAxis: "spatial",
        mountedWallSectionUnitId: 102,
        traversalLayer: 1
    };
    const region = {
        id: "fragment:house-l1",
        level: 1,
        polygon: { outer: [], holes: [] },
        staticObjects: [
            { item: flattenedWall },
            { item: standingWall },
            { item: latchedWall },
            { item: hiddenWindow },
            { item: visibleWindow }
        ]
    };
    const cutawayState = {
        _doorwayPresentationTransition: {
            presentationWizard: { x: -1, y: 5, currentLayer: 1 }
        },
        triggers: [{
            activeInteriorRegion: region,
            renderCache: { interiorRegions: [region] }
        }]
    };

    const plan = renderer.buildBuildingInteriorRenderPlan({ wizard: { x: 1, y: 5 } }, cutawayState);

    assert.equal(plan.items.has(flattenedWall), true);
    assert.equal(plan.items.has(standingWall), true);
    assert.equal(plan.wallTopFaceOnly.get(flattenedWall), true);
    assert.equal(plan.wallTopFaceOnly.get(standingWall), false);
    assert.equal(plan.wallTopFaceOnly.get(latchedWall), false);
    assert.equal(plan.items.has(hiddenWindow), false);
    assert.equal(plan.items.has(visibleWindow), true);
});

test("building interior render plan keeps below-hole floor walls full height", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    const upperWall = {
        type: "wallSection",
        bottomZ: 6,
        isVisibleInMazeModeFacingRule: () => false
    };
    const lowerWall = {
        type: "wallSection",
        bottomZ: 3,
        isVisibleInMazeModeFacingRule: () => false
    };
    const lowerDoor = {
        type: "door",
        category: "doors",
        traversalLayer: 1
    };
    const lowerWindow = {
        type: "window",
        category: "windows",
        traversalLayer: 1
    };
    const upperRegion = {
        id: "fragment:upper",
        fragmentId: "upper",
        level: 2,
        polygon: { outer: [], holes: [] },
        staticObjects: [{ item: upperWall }]
    };
    const lowerRegion = {
        id: "fragment:lower",
        fragmentId: "lower",
        level: 1,
        polygon: { outer: [], holes: [] },
        staticObjects: [{ item: lowerWall }, { item: lowerDoor }, { item: lowerWindow }]
    };
    const building = {
        buildingId: "building:house",
        holeVisibleFragments: new Map([["upper", new Set(["lower"])]])
    };
    const cutawayState = {
        triggers: [{
            building,
            activeInteriorRegion: upperRegion,
            renderCache: { interiorRegions: [upperRegion, lowerRegion] }
        }]
    };

    const plan = renderer.buildBuildingInteriorRenderPlan({ wizard: { x: 1, y: 1 } }, cutawayState);

    assert.equal(plan.items.has(upperWall), true);
    assert.equal(plan.items.has(lowerWall), true);
    assert.equal(plan.items.has(lowerDoor), true);
    assert.equal(plan.items.has(lowerWindow), true);
    assert.equal(plan.wallTopFaceOnly.get(upperWall), true);
    assert.equal(plan.wallTopFaceOnly.get(lowerWall), false);
});

test("building interior foreground openings ignore lower-layer ghost alpha", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    const lowerWindow = {
        type: "window",
        category: "windows",
        rotationAxis: "spatial",
        mountedWallSectionUnitId: 101
    };
    const ordinaryItem = {
        type: "table"
    };
    const plan = {
        items: new Set([lowerWindow, ordinaryItem])
    };

    assert.equal(renderer.getRenderAlphaForObjectItem(lowerWindow, 0.1, 1, plan), 1);
    assert.equal(renderer.getRenderAlphaForObjectItem(ordinaryItem, 0.1, 1, plan), 0.1);
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

test("building cutaway roof capture keeps pitched roof projection", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    renderer.camera = { xyratio: 0.5, viewscale: 2, x: 10, y: 20, z: 3 };
    const roof = {
        type: "roof",
        x: 5,
        y: 7,
        z: 6,
        vertices: [{ x: 2, y: 3, z: 2 }]
    };
    const projected = renderer.projectRoofVertexToCutawayCompositePlane(roof, roof.vertices[0], 0.5);
    const rotationRadians = Math.atan(1.15547);
    const expectedRotatedY = (3 * Math.cos(rotationRadians)) - (2 * Math.sin(rotationRadians));
    assert.equal(projected.x, 7);
    assert.equal(Math.abs(projected.y - (1 + (expectedRotatedY / 0.5))) < 1e-9, true);

    const uniforms = {
        uScreenSize: new Float32Array([800, 600]),
        uCameraWorld: new Float32Array([10, 20]),
        uCameraZ: 3,
        uViewScale: 2,
        uXyRatio: 0.5,
        uBuildingCutawayProjectionPass: 0,
        uBuildingCutawayPresentationXyRatio: 1,
        uTint: new Float32Array([1, 1, 1, 0.25])
    };
    const displayObj = {
        alpha: 0.25,
        shader: { uniforms },
        children: []
    };
    const restore = renderer.applyBuildingCutawayCompositeLocalCaptureState(
        new Set([displayObj]),
        { projectionSpace: true, minX: 4, minY: 5, pxPerWorld: 64, width: 256, height: 256 },
        256,
        256
    );

    assert.equal(uniforms.uBuildingCutawayProjectionPass, 1);
    assert.equal(uniforms.uBuildingCutawayPresentationXyRatio, 0.5);
    assert.equal(uniforms.uXyRatio, 1);
    assert.equal(uniforms.uTint[3], 1);
    assert.equal(displayObj.alpha, 1);

    restore();

    assert.equal(uniforms.uBuildingCutawayProjectionPass, 0);
    assert.equal(uniforms.uBuildingCutawayPresentationXyRatio, 1);
    assert.equal(uniforms.uXyRatio, 0.5);
    assert.equal(uniforms.uTint[3], 0.25);
    assert.equal(displayObj.alpha, 0.25);
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
        holes: [[
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

    const aboveBuildingState = renderer.getLayerCutawayState({
        map,
        roofs: [roof],
        wizard: { x: 5, y: 5, currentLayer: 3, currentLayerBaseZ: 9 }
    });
    assert.equal(aboveBuildingState.active, false);
    assert.equal(aboveBuildingState.triggers.length, 0);

    const exitFadeEntryStartState = renderer.getLayerCutawayState({
        map,
        roofs: [roof],
        wizard: { x: 5, y: -2, currentLayer: 0, currentLayerBaseZ: 0 },
        renderNowMs: 4000
    });
    assert.equal(exitFadeEntryStartState.active, true);
    assert.equal(exitFadeEntryStartState.triggers[0].alpha, 1);
    const exitFadeEntryDoneState = renderer.getLayerCutawayState({
        map,
        roofs: [roof],
        wizard: { x: 5, y: -2, currentLayer: 0, currentLayerBaseZ: 0 },
        renderNowMs: 4500
    });
    assert.equal(exitFadeEntryDoneState.active, true);
    assert.equal(exitFadeEntryDoneState.triggers[0].alpha, 0.1);
    const fadeExitStartState = renderer.getLayerCutawayState({
        map,
        roofs: [roof],
        wizard: { x: -0.5, y: 5, currentLayer: 0, currentLayerBaseZ: 0 },
        renderNowMs: 4600
    });
    assert.equal(fadeExitStartState.active, true);
    assert.equal(fadeExitStartState.triggers[0].buildingId, "building:house");
    assert.equal(fadeExitStartState.triggers[0].exitingCutaway, true);
    assert.equal(fadeExitStartState.triggers[0].alpha, 0.1);
    const fadeExitMidState = renderer.getLayerCutawayState({
        map,
        roofs: [roof],
        wizard: { x: -0.5, y: 5, currentLayer: 0, currentLayerBaseZ: 0 },
        renderNowMs: 4850
    });
    assert.equal(fadeExitMidState.active, true);
    assert.equal(fadeExitMidState.triggers[0].alpha, 0.55);
    const fadeExitDoneState = renderer.getLayerCutawayState({
        map,
        roofs: [roof],
        wizard: { x: -0.5, y: 5, currentLayer: 0, currentLayerBaseZ: 0 },
        renderNowMs: 5100
    });
    assert.equal(fadeExitDoneState.active, false);
    assert.equal(fadeExitDoneState.triggers.length, 0);
});

test("building cutaway fades upper floor fragments during interior floor changes", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    const upper = {
        fragmentId: "house-l2",
        surfaceId: "house",
        buildingId: "building:house",
        level: 2
    };
    const building = { buildingId: "building:house" };
    const makeTrigger = (level) => ({
        building,
        buildingId: "building:house",
        activeInteriorRegion: { id: `fragment:house-l${level - 1}` },
        level,
        alpha: 0.1,
        fragmentIds: new Set(["house-l1", "house-l2"]),
        surfaceIds: new Set(["house"])
    });

    const lowerTrigger = makeTrigger(2);
    renderer.updateBuildingInteriorFloorTransitions([lowerTrigger], 1000);
    assert.equal(renderer.getFloorFragmentCutawayAlpha(upper, {
        active: true,
        triggers: [lowerTrigger]
    }), 0.1);

    const upperFadeStart = makeTrigger(3);
    renderer.updateBuildingInteriorFloorTransitions([upperFadeStart], 2000);
    assert.equal(renderer.getFloorFragmentCutawayAlpha(upper, {
        active: true,
        triggers: [upperFadeStart]
    }), 0.1);

    const upperFadeMid = makeTrigger(3);
    renderer.updateBuildingInteriorFloorTransitions([upperFadeMid], 2250);
    assert.equal(renderer.getFloorFragmentCutawayAlpha(upper, {
        active: true,
        triggers: [upperFadeMid]
    }), 0.55);

    const upperFadeDone = makeTrigger(3);
    renderer.updateBuildingInteriorFloorTransitions([upperFadeDone], 2500);
    assert.equal(renderer.getFloorFragmentCutawayAlpha(upper, {
        active: true,
        triggers: [upperFadeDone]
    }), 1);

    const lowerFadeStart = makeTrigger(2);
    renderer.updateBuildingInteriorFloorTransitions([lowerFadeStart], 3000);
    assert.equal(renderer.getFloorFragmentCutawayAlpha(upper, {
        active: true,
        triggers: [lowerFadeStart]
    }), 1);

    const lowerFadeMid = makeTrigger(2);
    renderer.updateBuildingInteriorFloorTransitions([lowerFadeMid], 3250);
    assert.equal(renderer.getFloorFragmentCutawayAlpha(upper, {
        active: true,
        triggers: [lowerFadeMid]
    }), 0.55);

    const lowerFadeDone = makeTrigger(2);
    renderer.updateBuildingInteriorFloorTransitions([lowerFadeDone], 3500);
    assert.equal(renderer.getFloorFragmentCutawayAlpha(upper, {
        active: true,
        triggers: [lowerFadeDone]
    }), 0.1);
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

test("straight stairs build a full 3d mesh with treads, risers, and sides", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    renderer.camera = {
        map: {
            shortestDeltaX: (fromX, toX) => toX - fromX,
            shortestDeltaY: (fromY, toY) => toY - fromY
        }
    };

    const geometry = renderer.buildStraightStairMeshGeometry({
        id: "stairs-a",
        stairKind: "straight",
        lowerPoint: { x: 0, y: 0 },
        higherPoint: { x: 4, y: 0 },
        lowerZ: 1,
        higherZ: 3,
        lowerLevel: 0,
        higherLevel: 1,
        width: 2,
        stepCount: 4,
        texturePath: "/assets/images/flooring/woodfloor.png"
    });

    assert.ok(geometry);
    assert.equal(geometry.faceTypes.filter(type => type === "tread").length, 4);
    assert.equal(geometry.faceTypes.filter(type => type === "riser").length, 4);
    assert.equal(geometry.faceTypes.filter(type => type === "side").length, 8);
    assert.equal(geometry.triangleCount, 32);
    const zValues = [];
    for (let i = 2; i < geometry.positions.length; i += 3) zValues.push(geometry.positions[i]);
    assert.equal(Math.min(...zValues), 1);
    assert.equal(Math.max(...zValues), 3);
});

test("tread path stairs render a floor-height entry tread and final upper riser", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();

    const geometry = renderer.buildTreadPathStairMeshGeometry({
        id: "path-stairs-a",
        stairKind: "treadPath",
        lowerPoint: { x: 0, y: 0 },
        higherPoint: { x: 3, y: 0 },
        lowerZ: 0,
        higherZ: 3,
        lowerLevel: 0,
        higherLevel: 1,
        width: 1,
        stepCount: 3,
        treads: [
            { left: { x: 0, y: -0.5 }, right: { x: 0, y: 0.5 } },
            { left: { x: 3, y: -0.5 }, right: { x: 3, y: 0.5 } }
        ]
    });

    assert.ok(geometry);
    assert.equal(geometry.faceTypes.filter(type => type === "tread").length, 3);
    assert.equal(geometry.faceTypes.filter(type => type === "riser").length, 3);
    const treadZValues = [];
    for (let faceIndex = 0; faceIndex < geometry.faceTypes.length; faceIndex++) {
        if (geometry.faceTypes[faceIndex] !== "tread") continue;
        const vertexStart = faceIndex * 4 * 3;
        treadZValues.push(geometry.positions[vertexStart + 2]);
    }
    assert.deepEqual(treadZValues.map(z => Number(z.toFixed(6))), [0, 1, 2]);
    assert.equal(Math.max(...Array.from(geometry.positions).filter((_, index) => index % 3 === 2)), 3);
});

test("straight stair records are not collected as floor visual polygons", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    const entries = renderer.collectFloorVisualEntries({
        map: {
            floorsById: new Map(),
            stairsById: new Map([["stairs-a", {
                id: "stairs-a",
                stairKind: "straight",
                lowerLevel: 0,
                higherLevel: 1,
                lowerPoint: { x: 0, y: 0 },
                higherPoint: { x: 4, y: 0 },
                lowerZ: 0,
                higherZ: 3,
                width: 1.2,
                stepCount: 6,
                footprint: [
                    { x: 0, y: 0.6 },
                    { x: 4, y: 0.6 },
                    { x: 4, y: -0.6 },
                    { x: 0, y: -0.6 }
                ]
            }]])
        },
        wizard: { currentLayer: 0 }
    });

    assert.equal(Array.isArray(entries), true);
    assert.equal(entries.length, 0);
});

test("building cutaway-rendered floor fragments are not collected as floor visual polygons", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    const entries = renderer.collectFloorVisualEntries({
        map: {
            floorsById: new Map([["building-floor", {
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
                holes: [],
                renderedByBuildingCutaway: true
            }]])
        },
        wizard: { currentLayer: 0 }
    });

    assert.equal(entries.length, 0);
});

test("straight stairs are collected as render objects on their lower floor fragment", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    renderer.beginFrameMetrics();
    const lowerFragment = {
        fragmentId: "floor-low",
        surfaceId: "surface-low",
        level: 0,
        nodeBaseZ: 1
    };
    const stair = {
        id: "stairs-a",
        stairKind: "straight",
        lowerFragmentId: "floor-low",
        higherFragmentId: "floor-high",
        lowerLevel: 0,
        higherLevel: 1,
        lowerPoint: { x: 2, y: 3 },
        higherPoint: { x: 6, y: 3 },
        lowerZ: 1,
        higherZ: 5,
        width: 1.2,
        stepCount: 6,
        footprint: [
            { x: 2, y: 3.6 },
            { x: 6, y: 3.6 },
            { x: 6, y: 2.4 },
            { x: 2, y: 2.4 }
        ]
    };
    const map = {
        floorsById: new Map([["floor-low", lowerFragment]]),
        stairsById: new Map([["stairs-a", stair]]),
        shortestDeltaX: (fromX, toX) => toX - fromX,
        shortestDeltaY: (fromY, toY) => toY - fromY
    };

    const visibleObjects = renderer.collectVisibleObjects([], {
        map,
        camera: { x: 0, y: 0 },
        viewport: { width: 20, height: 20 },
        animals: [],
        animalsPreFilteredVisible: true
    });

    assert.equal(visibleObjects.length, 1);
    const item = visibleObjects[0];
    assert.equal(item.type, "straightStair");
    assert.equal(item.stairId, "stairs-a");
    assert.equal(item.stair, stair);
    assert.equal(item.fragmentId, "floor-low");
    assert.equal(item.surfaceId, "surface-low");
    assert.equal(item._renderTraversalLayer, 0);
    assert.equal(item.x, 4);
    assert.equal(item.y, 3);
    assert.equal(renderer.currentFrameMetrics.cvoStairsAdded, 1);
});

test("building interior render plan includes active-floor stair render items outside the building cache", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    const lowerFragment = {
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
        ]
    };
    const upperFragment = {
        fragmentId: "house-l2",
        surfaceId: "house",
        buildingId: "building:house",
        level: 2,
        nodeBaseZ: 6,
        outerPolygon: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 }
        ],
        holes: [[
            { x: 3, y: 3 },
            { x: 7, y: 3 },
            { x: 7, y: 7 },
            { x: 3, y: 7 }
        ]]
    };
    const stair = {
        id: "stairs-a",
        stairKind: "straight",
        lowerFragmentId: "house-l1",
        higherFragmentId: "house-l2",
        lowerLevel: 1,
        higherLevel: 2,
        lowerPoint: { x: 4, y: 5 },
        higherPoint: { x: 6, y: 5 },
        lowerZ: 3,
        higherZ: 6,
        width: 1.2,
        stepCount: 6,
        footprint: [
            { x: 4, y: 5.6 },
            { x: 6, y: 5.6 },
            { x: 6, y: 4.4 },
            { x: 4, y: 4.4 }
        ]
    };
    const map = {
        _floorBuildingVersion: 1,
        floorsById: new Map([
            ["house-l1", lowerFragment],
            ["house-l2", upperFragment]
        ]),
        stairsById: new Map([["stairs-a", stair]]),
        shortestDeltaX: (fromX, toX) => toX - fromX,
        shortestDeltaY: (fromY, toY) => toY - fromY
    };

    const stairItem = renderer.getStraightStairRenderObject(stair, map);
    const renderCache = {
        interiorRegions: [
            {
                id: "fragment:house-l1",
                kind: "floorFragment",
                level: 1,
                fragmentId: "house-l1",
                surfaceId: "house",
                polygon: renderer.getFloorFragmentInteriorPolygon(lowerFragment),
                staticObjects: []
            },
            {
                id: "fragment:house-l2",
                kind: "floorFragment",
                level: 2,
                fragmentId: "house-l2",
                surfaceId: "house",
                polygon: renderer.getFloorFragmentInteriorPolygon(upperFragment),
                staticObjects: []
            }
        ],
        renderItems: []
    };
    const lowerRegion = renderCache.interiorRegions[0];
    const upperRegion = renderCache.interiorRegions[1];
    const plan = renderer.buildBuildingInteriorRenderPlan({ map }, {
        triggers: [{
            activeInteriorRegion: lowerRegion,
            renderCache
        }]
    });
    const lowerPlanHasStair = plan.items.has(stairItem);
    const upperPlan = renderer.buildBuildingInteriorRenderPlan({ map }, {
        triggers: [{
            activeInteriorRegion: upperRegion,
            renderCache
        }]
    });

    assert.equal(renderCache.renderItems.length, 0);
    assert.equal(lowerPlanHasStair, true);
    assert.equal(upperPlan.items.has(stairItem), false);
});
