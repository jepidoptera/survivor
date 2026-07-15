const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadRenderingImpl() {
    class Animal {}
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
        performance,
        polygonClipping: require("polygon-clipping"),
        Animal,
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
    return context.__RenderingImpl;
}

test("hasShadow=false excludes static objects from LOS occluders", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();

    assert.equal(renderer.isLosOccluder({
        type: "tree",
        groundPlaneHitbox: {},
        hasShadow: true
    }), true);

    assert.equal(renderer.isLosOccluder({
        type: "tree",
        groundPlaneHitbox: {},
        hasShadow: false
    }), false);
});
