const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadDebugContext() {
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

test("debug hitbox projection keeps character z absolute on floor layers", () => {
    const context = loadDebugContext();
    const actor = new context.Character();
    actor.z = -6;
    actor.traversalLayer = -2;

    assert.equal(context.resolveDebugHitboxWorldZ(actor), -6);
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
