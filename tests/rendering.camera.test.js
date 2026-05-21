"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadCameraContext() {
    const context = {
        Math,
        Number,
        Object,
        Map,
        Set,
        console
    };
    context.globalThis = context;
    context.window = context;
    vm.createContext(context);
    vm.runInContext(
        fs.readFileSync(path.join(__dirname, "../public/assets/javascript/rendering/Camera.js"), "utf8"),
        context,
        { filename: "Camera.js" }
    );
    return context;
}

function loadRenderRuntimeContext() {
    const context = {
        Math,
        Number,
        Object,
        Map,
        Set,
        console,
        setTimeout: () => 1,
        clearTimeout() {},
        viewport: { x: 0, y: 0, z: 0, prevZ: 0, width: 40, height: 30 },
        viewscale: 1,
        xyratio: 1,
        renderAlpha: 1,
        map: null,
        wizard: null
    };
    context.globalThis = context;
    context.window = context;
    vm.createContext(context);
    vm.runInContext(
        fs.readFileSync(path.join(__dirname, "../public/assets/javascript/rendering/RenderRuntime.js"), "utf8"),
        context,
        { filename: "RenderRuntime.js" }
    );
    return context;
}

test("RenderingCamera initializes fallback camera z from wizard layer base", () => {
    const context = loadCameraContext();
    const camera = new context.RenderingCamera();

    camera.update({
        camera: null,
        wizard: { x: 100, y: 200, currentLayer: 2, currentLayerBaseZ: 7 },
        viewport: { width: 40, height: 30 },
        viewscale: 1,
        xyratio: 1,
        map: null,
        renderAlpha: 1
    });

    assert.equal(camera.z, 7);
    assert.equal(camera.prevZ, 7);
});

test("centerViewport seeds viewport z from wizard layer before first movement tick", () => {
    const context = loadRenderRuntimeContext();
    context.wizard = { x: 100, y: 200, currentLayer: 2, currentLayerBaseZ: 7 };

    context.centerViewport(context.wizard, 0, 0);

    assert.equal(context.viewport.z, 7);
    assert.equal(context.viewport.prevZ, 7);
});

test("centerViewport resyncs stale ground-level viewport z from wizard layer", () => {
    const context = loadRenderRuntimeContext();
    context.viewport._cameraZInitializedFromFollow = true;
    context.viewport.z = 0;
    context.viewport.prevZ = 0;
    context.wizard = { x: 100, y: 200, currentLayer: 2, currentLayerBaseZ: 7 };

    context.centerViewport(context.wizard, 0, 0);

    assert.equal(context.viewport.z, 7);
    assert.equal(context.viewport.prevZ, 7);
});
