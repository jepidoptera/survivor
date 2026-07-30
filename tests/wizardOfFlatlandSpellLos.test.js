const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const MAIN_PATH = path.join(__dirname, "../public/wizard-of-flatland/main.js");

function extractFunction(source, name) {
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `${name} exists in main.js`);
    const bodyStart = source.indexOf("{", start);
    let depth = 0;
    for (let index = bodyStart; index < source.length; index++) {
        if (source[index] === "{") depth++;
        if (source[index] === "}") depth--;
        if (depth === 0) return source.slice(start, index + 1);
    }
    throw new Error(`Unterminated function ${name}`);
}

function createHarness() {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    const bins = 3600;
    const snapshot = {
        originX: 0,
        originY: 0,
        bins,
        maxDistance: 20,
        depths: new Float32Array(bins)
    };
    snapshot.depths.fill(snapshot.maxDistance);
    const context = {
        Error,
        Float32Array,
        Math,
        Number,
        state: {
            wallVersion: 7,
            los: {
                enabled: true,
                inFlightRequestId: 12,
                inFlightWallRevision: 7,
                workerInstalledWallRevision: 7,
                staleResultCount: 0,
                workerError: null
            }
        }
    };
    vm.createContext(context);
    vm.runInContext(
        `${extractFunction(source, "getLosDepthBinIndex")}
        ${extractFunction(source, "validateSpellLosSnapshot")}
        ${extractFunction(source, "getCircularTargetLosVisibilityScale")}
        this.binFor = getLosDepthBinIndex;
        this.visibilityScale = getCircularTargetLosVisibilityScale;`,
        context
    );
    return { ...context, snapshot };
}

test("Wizard of Flatland spell LOS gives fully exposed targets full damage", () => {
    const harness = createHarness();
    assert.equal(harness.visibilityScale(harness.snapshot, 2, 0, 0.5), 1);
});

test("Wizard of Flatland spell LOS blocks targets behind walls", () => {
    const harness = createHarness();
    harness.snapshot.depths.fill(1);
    assert.equal(harness.visibilityScale(harness.snapshot, 2, 0, 0.5), 0);
});

test("Wizard of Flatland spell LOS scales damage over five fixed profile samples", () => {
    const harness = createHarness();
    const distance = 2;
    const radius = 0.5;
    const angularRadius = Math.asin(radius / distance);
    for (const profileOffset of [-1, -0.5]) {
        const bin = harness.binFor(angularRadius * profileOffset, harness.snapshot.bins);
        harness.snapshot.depths[bin] = 1;
    }
    assert.equal(harness.visibilityScale(harness.snapshot, distance, 0, radius), 0.6);
});

test("Wizard of Flatland spell LOS diagnostics identify a missing snapshot and worker state", () => {
    const harness = createHarness();
    assert.throws(
        () => harness.visibilityScale(null, 2, 0, 0.5),
        /has no completed LOS snapshot \(enabled=true, inFlightRequestId=12,.*wallVersion=7/
    );
});

test("Wizard of Flatland spell LOS diagnostics identify a detached depth buffer", () => {
    const harness = createHarness();
    structuredClone(harness.snapshot.depths, { transfer: [harness.snapshot.depths.buffer] });
    assert.throws(
        () => harness.visibilityScale(harness.snapshot, 2, 0, 0.5),
        /depth length 0 does not match 3600 bins \(bufferBytes=0, detached=true/
    );
});

test("Wizard of Flatland fireballs retain launch-time LOS while freeze uses the latest result", () => {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    assert.match(source, /const losSnapshot = getCompletedSpellLosSnapshot\("fireball launch"\)/);
    assert.match(source, /projectileRadius: fireballStats\.projectileRadius,\s*losSnapshot/);
    assert.match(source, /const losSnapshot = getCompletedSpellLosSnapshot\("freeze damage"\)/);
    assert.match(
        source,
        /damageAgentsIntersectingCircle\([\s\S]*?fireball\.losSnapshot[\s\S]*?\)/
    );
});

test("Wizard of Flatland spell casting waits for the first post-reset LOS snapshot", () => {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    assert.match(
        source,
        /function getCompletedSpellLosSnapshot\(context\) \{\s*const snapshot = state\.los && state\.los\.lastResult;\s*if \(!snapshot\) return null;/
    );
    assert.match(
        source,
        /const losSnapshot = getCompletedSpellLosSnapshot\("freeze damage"\);\s*if \(!losSnapshot\) return;/
    );
    assert.match(
        source,
        /const losSnapshot = getCompletedSpellLosSnapshot\("fireball launch"\);\s*if \(!losSnapshot\) return;/
    );
});

test("Wizard of Flatland world resets cancel held spell casting", () => {
    const source = fs.readFileSync(MAIN_PATH, "utf8");
    const createScenario = extractFunction(source, "createScenario");
    const applyCheckpoint = extractFunction(source, "applyWizardCheckpointSnapshot");
    assert.match(createScenario, /state\.spaceHeld = false;/);
    assert.match(applyCheckpoint, /state\.spaceHeld = false;/);
});
