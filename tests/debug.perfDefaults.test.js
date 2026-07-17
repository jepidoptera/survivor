const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function createLocalStorageMock(initial = {}) {
    const store = new Map(Object.entries(initial));
    return {
        getItem(key) {
            return store.has(String(key)) ? store.get(String(key)) : null;
        },
        setItem(key, value) {
            store.set(String(key), String(value));
        },
        removeItem(key) {
            store.delete(String(key));
        },
        snapshot() {
            return Object.fromEntries(store.entries());
        }
    };
}

function loadDebugContext(options = {}) {
    let nowMs = 0;
    const context = {
        console: {
            log() {},
            table() {},
            groupCollapsed() {},
            groupEnd() {}
        },
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
        performance: {
            now() {
                nowMs += 1;
                return nowMs;
            }
        },
        FLOOR_LAYER_DEFAULT_HEIGHT_UNITS: 3,
        Character: class Character {},
        WallSectionUnit: {
            _showDirectionalBlockingDebug: false,
            _showBottomFaceOnlyDebug: false,
            setShowDirectionalBlockingDebug(enabled) {
                this._showDirectionalBlockingDebug = !!enabled;
            },
            setShowBottomFaceOnlyDebug(enabled) {
                this._showBottomFaceOnlyDebug = !!enabled;
            }
        }
    };
    context.window = context;
    context.globalThis = context;
    context.Wizard = class Wizard extends context.Character {};
    if (options.localStorage) {
        context.localStorage = options.localStorage;
    }

    vm.createContext(context);
    const debugSource = fs.readFileSync(
        path.join(__dirname, "../public/assets/javascript/debug.js"),
        "utf8"
    );
    vm.runInContext(debugSource, context, { filename: "debug.js" });
    return context;
}

test("performance instrumentation stays off by default and exposes re-enable help", () => {
    const context = loadDebugContext();

    assert.equal(context.DebugView.isPerfInstrumentationEnabled(), false);
    assert.equal(context.getPerfAccumulatorSnapshot().enabled, false);

    const helpText = context.DebugView.describePerfInstrumentation();
    assert.match(helpText, /OFF by default/);
    assert.match(helpText, /Ctrl\+F/);
    assert.match(helpText, /DebugView\.setPerfInstrumentationEnabled\(true\)/);
});

test("terrain paint diagnostic outlines stay on by default", () => {
    const context = loadDebugContext();

    assert.equal(context.debugTerrainPolygonDiagnostics, true);
    assert.equal(context.debugTerrainPaintRepairPaths, false);
    assert.equal(context.DebugView.settings.showTerrainPaintDiagnostics, true);
    assert.equal(context.DebugView.settings.showTerrainPaintRepairPaths, false);

    assert.equal(context.DebugView.setTerrainPaintDiagnosticsVisible(false), false);
    assert.equal(context.debugTerrainPolygonDiagnostics, false);
    assert.equal(context.DebugView.toggleTerrainPaintDiagnostics(), true);
    assert.equal(context.debugTerrainPolygonDiagnostics, true);
    assert.equal(context.DebugView.toggleTerrainPaintRepairPaths(), true);
    assert.equal(context.debugTerrainPaintRepairPaths, true);
    assert.equal(context.DebugView.setTerrainPaintRepairPathsVisible(false), false);
    assert.equal(context.debugTerrainPaintRepairPaths, false);
});

test("terrain polygon outline console command persists to localStorage", () => {
    const localStorage = createLocalStorageMock();
    const firstContext = loadDebugContext({ localStorage });

    assert.equal(firstContext.terrainPolygonOutlines(), true);
    assert.equal(firstContext.terrainPolygonOutlines(false), false);
    assert.equal(firstContext.debugTerrainPolygonDiagnostics, false);
    assert.equal(localStorage.getItem("survivor-terrain-polygon-outlines"), "0");

    const secondContext = loadDebugContext({ localStorage });
    assert.equal(secondContext.terrainPolygonOutlines(), false);
    assert.equal(secondContext.debugTerrainPolygonDiagnostics, false);

    assert.equal(secondContext.toggleTerrainPolygonOutlines(), true);
    assert.equal(localStorage.getItem("survivor-terrain-polygon-outlines"), "1");

    const thirdContext = loadDebugContext({ localStorage });
    assert.equal(thirdContext.DebugView.terrainPolygonOutlines(), true);
    assert.equal(thirdContext.DebugView.setTerrainPolygonOutlinesVisible(false), false);
    assert.equal(localStorage.getItem("survivor-terrain-polygon-outlines"), "0");
});

test("debug hitbox projection keeps character z absolute on floor layers", () => {
    const context = loadDebugContext();
    const actor = new context.Character();
    actor.z = -6;
    actor.traversalLayer = -2;

    assert.equal(context.resolveDebugHitboxWorldZ(actor), -6);
});

test("debug hitbox projection uses floor support when character z is local zero", () => {
    const context = loadDebugContext();
    const actor = new context.Character();
    actor.z = 0;
    actor.currentMovementSupport = { type: "floor", layer: 1, baseZ: 3 };

    assert.equal(context.resolveDebugHitboxWorldZ(actor), 3);
});

test("debug hitbox projection adds wizard floor base to local jump z", () => {
    const context = loadDebugContext();
    const wizard = new context.Wizard();
    wizard.z = 0.5;
    wizard.currentLayer = -2;
    wizard.currentLayerBaseZ = -6;

    assert.equal(context.resolveDebugHitboxWorldZ(wizard), -5.5);
});

test("debug hitbox projection adds layer base for non-character objects", () => {
    const context = loadDebugContext();

    assert.equal(context.resolveDebugHitboxWorldZ({ z: 0, traversalLayer: -2 }), -6);
    assert.equal(context.resolveDebugHitboxWorldZ({ z: 0.5, traversalLayer: 1 }), 3.5);
});

test("performance samples are collected only after instrumentation is enabled", () => {
    const context = loadDebugContext();

    context.recordPerfAccumulatorSample({
        fps: 60,
        loopMs: 16,
        cpuMs: 8,
        simMs: 4,
        drawMs: 4,
        idleMs: 8,
        simSteps: 1
    });
    assert.equal(context.getPerfAccumulatorSnapshot().samples, 0);

    context.DebugView.setPerfInstrumentationEnabled(true);
    assert.equal(context.DebugView.isPerfInstrumentationEnabled(), true);
    assert.equal(context.getPerfAccumulatorSnapshot().enabled, true);

    context.recordPerfAccumulatorSample({
        fps: 60,
        loopMs: 16,
        cpuMs: 8,
        simMs: 4,
        drawMs: 4,
        idleMs: 8,
        simSteps: 1
    });
    assert.equal(context.getPerfAccumulatorSnapshot().samples, 1);

    context.DebugView.setPerfInstrumentationEnabled(false, { resetAccumulator: false });
    context.recordPerfAccumulatorSample({
        fps: 30,
        loopMs: 33,
        cpuMs: 12,
        simMs: 6,
        drawMs: 6,
        idleMs: 21,
        simSteps: 1
    });
    assert.equal(context.DebugView.isPerfInstrumentationEnabled(), false);
    assert.equal(context.getPerfAccumulatorSnapshot().samples, 1);
});

test("debugViewSettings exposes console-friendly debug toggles", () => {
    const context = loadDebugContext();

    assert.ok(context.debugViewSettings);
    assert.equal(typeof context.debugViewSettings.snapshot, "function");
    assert.equal(context.DebugView.settings, context.debugViewSettings);

    const listedKeys = Object.keys(context.debugViewSettings);
    assert.ok(listedKeys.includes("showFpsCounter"));
    assert.ok(listedKeys.includes("showSectionWorldSeams"));
    assert.ok(listedKeys.includes("showWallBlockers"));
    assert.ok(listedKeys.includes("showWallGroundHitboxesOnly"));
    assert.ok(listedKeys.includes("showAnimalHitboxes"));

    context.debugViewSettings.showFpsCounter = true;
    assert.equal(context.debugViewSettings.showPerfReadout, true);

    context.debugViewSettings.showWallBlockers = true;
    assert.equal(context.WallSectionUnit._showDirectionalBlockingDebug, true);

    context.debugViewSettings.showWallGroundHitboxesOnly = true;
    assert.equal(context.WallSectionUnit._showBottomFaceOnlyDebug, true);

    context.debugViewSettings.showSectionWorldSeams = false;
    assert.equal(context.renderingShowSectionWorldSeams, false);
    assert.equal(context.debugViewSettings.showSectionSeams, false);

    context.debugViewSettings.debugMode = true;
    assert.equal(context.debugMode, true);
    assert.equal(context.renderingShowPickerScreen, true);
    assert.equal(context.debugViewSettings.showAnimalHitboxes, true);
});
