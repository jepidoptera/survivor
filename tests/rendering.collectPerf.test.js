const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadRenderingImpl() {
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
    context.__RenderingImpl.__testContext = context;
    return context.__RenderingImpl;
}

function buildScene() {
    const fixture = JSON.parse(
        fs.readFileSync(path.join(__dirname, "fixtures/section-0-0.json"), "utf8")
    );

    const nodesByKey = new Map();
    const nodes = fixture.tileCoordKeys.map(k => {
        const [xi, yi] = k.split(",").map(Number);
        const x = xi * 0.866;
        const y = yi + (xi % 2 === 0 ? 0.5 : 0);
        const node = { id: k, xindex: xi, yindex: yi, x, y, traversalLayer: 0, level: 0, objects: [], visibilityObjects: [] };
        nodesByKey.set(k, node);
        return node;
    });
    nodes.sort((a, b) => a.yindex !== b.yindex ? a.yindex - b.yindex : a.xindex - b.xindex);

    for (const obj of fixture.objects) {
        const approxXi = Math.round(obj.x / 0.866);
        const approxYi = Math.round(obj.y - (approxXi % 2 === 0 ? 0.5 : 0));
        let best = null;
        let bestDist = Infinity;
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const n = nodesByKey.get(`${approxXi + dx},${approxYi + dy}`);
                if (!n) continue;
                const d = Math.hypot(n.x - obj.x, n.y - obj.y);
                if (d < bestDist) { bestDist = d; best = n; }
            }
        }
        if (best) best.objects.push(obj);
    }

    const vpW = 36;
    const vpH = 36;
    const camera = {
        x: fixture.centerWorld.x - vpW / 2,
        y: fixture.centerWorld.y - vpH / 2,
        width: vpW,
        height: vpH,
        z: 0,
        viewscale: 16,
        xyratio: 0.66,
    };

    const map = {
        nodes: [],
        _prototypeSectionState: { loadedNodes: nodes },
        floorNodesById: new Map(),
        wrapX: false,
        wrapY: false,
        width: 512,
        height: 512,
    };

    map.getVisibleNodesInViewport = function(cam, xPadding, yPadding) {
        const loadedNodes = this._prototypeSectionState.loadedNodes;
        const padXWorld = Math.max(0, Number(xPadding) || 0) * 0.866;
        const padYWorld = Math.max(0, Number(yPadding) || 0);
        const minX = Number(cam.x) - padXWorld;
        const maxX = Number(cam.x) + (cam.width || 0) + padXWorld;
        const minY = Number(cam.y) - padYWorld;
        const maxY = Number(cam.y) + (cam.height || 0) + padYWorld;
        if (!this._visibleNodesReuse) this._visibleNodesReuse = [];
        const visible = this._visibleNodesReuse;
        visible.length = 0;
        const minYi = Math.floor(minY) - 1;
        const maxYi = Math.ceil(maxY) + 1;
        let low = 0, high = loadedNodes.length;
        while (low < high) {
            const mid = (low + high) >> 1;
            if ((loadedNodes[mid] ? loadedNodes[mid].yindex : 0) < minYi) low = mid + 1;
            else high = mid;
        }
        for (let i = low; i < loadedNodes.length; i++) {
            const node = loadedNodes[i];
            if (!node) continue;
            if (node.yindex > maxYi) break;
            if (node.x < minX || node.x > maxX) continue;
            if (node.y < minY || node.y > maxY) continue;
            visible.push(node);
        }
        return visible;
    };

    return { map, camera, viewport: { width: vpW, height: vpH } };
}

// Baseline ~1.8ms/iteration on dev machine (measured 2026-05-12).
const THRESHOLD_MS = 2;
const WARMUP = 30;
const ITERS = 500;

test("collectVisibleNodes + collectVisibleObjects stay under performance threshold", { timeout: 60000 }, () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    renderer.currentFrameMetrics = {};

    const ctx = buildScene();
    renderer.camera = ctx.camera;

    for (let i = 0; i < WARMUP; i++) {
        const nodes = renderer.collectVisibleNodes(ctx, 4, 4);
        renderer.collectVisibleObjects(nodes, ctx);
    }

    const start = performance.now();
    for (let i = 0; i < ITERS; i++) {
        const nodes = renderer.collectVisibleNodes(ctx, 4, 4);
        renderer.collectVisibleObjects(nodes, ctx);
    }
    const avgMs = (performance.now() - start) / ITERS;

    assert.ok(
        avgMs < THRESHOLD_MS,
        `avg collect time ${avgMs.toFixed(3)}ms exceeded threshold ${THRESHOLD_MS}ms (baseline ~1.8ms, measured 2026-05-12)`
    );
});
