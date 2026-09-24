const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const LOS_PATH = path.join(__dirname, "../public/wizard-of-flatland/los.js");
const WORKER_PATH = path.join(__dirname, "../public/wizard-of-flatland/losWorker.js");

function loadWorker() {
    const messages = [];
    let messageHandler = null;
    const context = {
        Float32Array,
        Float64Array,
        Int32Array,
        Uint8Array,
        Math,
        Number,
        Object,
        Array,
        performance: { now: () => 0 }
    };
    context.self = {
        addEventListener(type, handler) {
            if (type === "message") messageHandler = handler;
        },
        postMessage(message) {
            messages.push(message);
        }
    };
    context.globalThis = context.self;
    vm.createContext(context);
    context.importScripts = (scriptPath) => {
        if (scriptPath.includes("wallGeometry.js")) {
            const wallGeometryPath = path.join(__dirname, "../public/wizard-of-flatland/wallGeometry.js");
            vm.runInContext(fs.readFileSync(wallGeometryPath, "utf8"), context, { filename: wallGeometryPath });
            return;
        }
        if (!scriptPath.includes("los.js")) throw new Error(`Unexpected LOS worker import ${scriptPath}`);
        vm.runInContext(fs.readFileSync(LOS_PATH, "utf8"), context, { filename: LOS_PATH });
    };
    vm.runInContext(fs.readFileSync(WORKER_PATH, "utf8"), context, { filename: WORKER_PATH });
    if (typeof messageHandler !== "function") throw new Error("LOS worker did not install a message handler");
    return {
        messages,
        send(data) {
            messageHandler({ data });
        }
    };
}

test("Wizard of Flatland LOS worker installs walls and returns packed transferable results", () => {
    const worker = loadWorker();
    worker.send({
        type: "set-walls",
        wallRevision: 1,
        walls: Float32Array.from([5, -10, 5, 10, 1, 0, 0, 0])
    });
    worker.send({
        type: "compute",
        requestId: 7,
        wallRevision: 1,
        options: {
            x: 0,
            y: 0,
            wallStride: 8,
            bins: 64,
            maxDistance: 20,
            enemyTargets: Float64Array.from([101, 4, 0, 0.5, 102, 8, 0, 0.5]),
            enemyWallThickness: 0.3,
            enemyWallFaceExtend: 0
        }
    });

    assert.equal(worker.messages.length, 1);
    const result = worker.messages[0];
    assert.equal(result.type, "result");
    assert.equal(result.requestId, 7);
    assert.equal(result.wallRevision, 1);
    assert.ok(result.points instanceof Float32Array);
    assert.equal(result.points.length, 128);
    assert.equal(result.depths.length, 64);
    assert.equal(result.hitWallIndices.length, 64);
    assert.equal(result.hitWallTs.length, 64);
    assert.deepEqual(Array.from(result.enemyVisibility), [1, 0]);
    assert.deepEqual(Array.from(result.enemyTargets), [101, 4, 0, 0.5, 102, 8, 0, 0.5]);
});

test("Wizard of Flatland LOS worker reports wall revision mismatches explicitly", () => {
    const worker = loadWorker();
    worker.send({
        type: "set-walls",
        wallRevision: 2,
        walls: new Float32Array(0)
    });
    worker.send({
        type: "compute",
        requestId: 1,
        wallRevision: 1,
        options: { x: 0, y: 0, wallStride: 8, bins: 64, maxDistance: 20 }
    });

    assert.equal(worker.messages.length, 1);
    assert.equal(worker.messages[0].type, "error");
    assert.match(worker.messages[0].message, /wall revision mismatch/);
});
