const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadTerrainPaintDebugRenderer() {
    const context = {
        console,
        Number,
        Array,
        Math,
        Error,
        debugTerrainPolygonDiagnostics: true
    };
    context.window = context;
    context.globalThis = context;
    vm.createContext(context);
    const source = fs.readFileSync(
        path.join(__dirname, "../public/assets/javascript/rendering/TerrainPaintDebugRendering.js"),
        "utf8"
    );
    vm.runInContext(source, context, { filename: "TerrainPaintDebugRendering.js" });
    return context;
}

function createRendererHarness(context) {
    const calls = [];
    class Graphics {
        constructor() {
            this.visible = false;
            this.parent = null;
        }

        clear() { calls.push(["clear"]); }
        lineStyle(width, color, alpha) { calls.push(["lineStyle", width, color, alpha]); }
        beginFill(color, alpha) { calls.push(["beginFill", color, alpha]); }
        moveTo(x, y) { calls.push(["moveTo", x, y]); }
        lineTo(x, y) { calls.push(["lineTo", x, y]); }
        closePath() { calls.push(["closePath"]); }
        endFill() { calls.push(["endFill"]); }
    }
    context.PIXI = { Graphics };
    const ui = {
        children: [],
        addChild(child) {
            child.parent = this;
            this.children.push(child);
        }
    };
    const renderer = {
        layers: { ui },
        camera: {
            worldToScreen(x, y) {
                return { x, y };
            }
        },
        getLayerBaseZForLevel() {
            return 0;
        }
    };
    return { calls, renderer };
}

function square(x) {
    return [
        { x, y: 0 },
        { x: x + 1, y: 0 },
        { x: x + 1, y: 1 },
        { x, y: 1 }
    ];
}

test("terrain paint debug outline colors follow terrain type", () => {
    const context = loadTerrainPaintDebugRenderer();
    const debugRenderer = context.RenderingTerrainPaintDebugRenderer;

    assert.equal(debugRenderer.getTerrainOutlineColor("water"), 0xffffff);
    assert.equal(debugRenderer.getTerrainOutlineColor("mud"), 0xffa500);
    assert.equal(debugRenderer.getTerrainOutlineColor("grass"), 0x00ff00);
    assert.equal(debugRenderer.getTerrainOutlineColor("desert"), 0xffff00);
    assert.equal(debugRenderer.getTerrainOutlineColor("bog"), 0xffffff);
});

test("terrain paint debug renderer draws terrain polygon outlines with terrain colors", () => {
    const context = loadTerrainPaintDebugRenderer();
    const { calls, renderer } = createRendererHarness(context);
    const entries = [
        { isTerrainPolygon: true, terrainType: "water", outer: square(0) },
        { isTerrainPolygon: true, terrainType: "mud", outer: square(2) },
        { isTerrainPolygon: true, terrainType: "grass", outer: square(4) },
        { isTerrainPolygon: true, terrainType: "desert", outer: square(6) }
    ];

    context.RenderingTerrainPaintDebugRenderer.render(renderer, { map: {} }, entries);

    const lineColors = calls
        .filter(call => call[0] === "lineStyle")
        .map(call => call[2]);
    assert.deepEqual(lineColors, [0xffffff, 0xffa500, 0x00ff00, 0xffff00]);
    assert.equal(renderer.terrainPolygonDiagnosticGraphics.visible, true);
});
