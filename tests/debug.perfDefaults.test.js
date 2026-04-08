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
        }
    };
    context.window = context;
    context.globalThis = context;

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