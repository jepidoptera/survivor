const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadProfiler() {
    let now = 0;
    let timerCallback = null;
    const tables = [];
    const context = {
        console: {
            log() {},
            table(rows) { tables.push(rows); },
            groupCollapsed() {},
            groupEnd() {}
        },
        performance: { now: () => now },
        PerformanceObserver: undefined,
        setTimeout(callback) {
            timerCallback = callback;
            return 1;
        },
        clearTimeout() {
            timerCallback = null;
        }
    };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(
        fs.readFileSync(path.join(__dirname, "../public/wizard-of-flatland/profiler.js"), "utf8"),
        context,
        { filename: "profiler.js" }
    );
    const profiler = context.WizardFlatlandProfiler.createWizardOfFlatlandProfiler({
        state: { debug: {} },
        labels: {}
    });
    return {
        profiler,
        tables,
        advance(ms) { now += ms; },
        finishTimer() {
            const callback = timerCallback;
            timerCallback = null;
            callback();
        }
    };
}

test("main-thread profiler starts automatically and aggregates frame sections", () => {
    const harness = loadProfiler();
    assert.ok(harness.profiler.getMainThreadProfile());

    harness.profiler.noteFrame(10, [
        { label: "simulation", duration: 3 },
        { label: "draw", duration: 5 }
    ], { frameIntervalMs: 16.7 });
    harness.profiler.noteFrame(20, [
        { label: "simulation", duration: 4 },
        { label: "draw", duration: 12 }
    ], { frameIntervalMs: 42 });
    harness.advance(60000);
    harness.finishTimer();

    const result = harness.profiler.getLastMainThreadProfile();
    assert.equal(result.frameCount, 2);
    assert.equal(result.frameTimeMs, 30);
    assert.equal(result.averageFrameMs, 15);
    assert.equal(result.maxFrameMs, 20);
    assert.equal(result.maxFrameIntervalMs, 42);
    assert.equal(result.hitches.length, 1);
    assert.equal(result.hitches[0].outsideFrameWorkMs, 22);
    assert.equal(result.hitches[0].topParts[0].section, "draw");
    assert.deepEqual(
        Array.from(result.rows, (row) => [row.section, row.totalMs]),
        [["draw", 17], ["simulation", 7], ["unaccounted frame overhead", 6]]
    );
    assert.equal(harness.profiler.getMainThreadProfile(), null);
});

test("main-thread profiler can be restarted with a custom duration", () => {
    const harness = loadProfiler();
    harness.profiler.startMainThreadProfile(5);
    harness.profiler.noteFrame(8, [{ label: "draw", duration: 6 }]);
    harness.advance(5000);
    harness.finishTimer();

    assert.equal(harness.profiler.getLastMainThreadProfile().frameCount, 1);
    assert.equal(harness.profiler.getLastMainThreadProfile().elapsedMs, 5000);
});

test("main-thread profiler rejects invalid durations", () => {
    const harness = loadProfiler();
    assert.throws(
        () => harness.profiler.startMainThreadProfile(0),
        /positive number of seconds/
    );
});

test("main-thread profiler attributes work outside animation frames", () => {
    const harness = loadProfiler();
    harness.profiler.task("solver worker message", () => {
        harness.advance(205);
    });
    harness.advance(1000);
    harness.finishTimer();

    const result = harness.profiler.getLastMainThreadProfile();
    assert.equal(result.externalTasks.length, 1);
    assert.equal(result.externalTasks[0].task, "solver worker message");
    assert.equal(result.externalTasks[0].totalMs, 205);
    assert.equal(result.slowExternalTasks.length, 1);
    assert.equal(result.slowExternalTasks[0].durationMs, 205);
});

test("hitch profiler records nested sections and workload details", () => {
    const harness = loadProfiler();
    harness.profiler.startHitchProfile(30, 16);
    harness.profiler.hitchTask("solver worker message", () => {
        harness.profiler.hitchSpan("apply solver result", () => {
            harness.advance(28);
        });
        harness.profiler.hitchSpan("resolve target npc contacts", () => {
            harness.advance(4);
        });
    }, () => ({ packedAgents: 120 }));

    const result = harness.profiler.stopHitchProfile();
    assert.equal(result.hitches.length, 1);
    assert.equal(result.hitches[0].task, "solver worker message");
    assert.equal(result.hitches[0].durationMs, 32);
    assert.equal(result.hitches[0].details.packedAgents, 120);
    assert.match(result.hitches[0].topSpans, /apply solver result 28\.000ms/);
    assert.equal(result.taskRows[0].hitches, 1);
    assert.equal(result.spanRows[0].section, "solver worker message > apply solver result");
    assert.equal(harness.profiler.getHitchProfile(), null);
});

test("hitch profiler rejects overlapping recordings", () => {
    const harness = loadProfiler();
    harness.profiler.startHitchProfile(30);
    assert.throws(
        () => harness.profiler.startHitchProfile(30),
        /already running/
    );
    harness.profiler.stopHitchProfile();
});
