const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadRenderingImpl(options = {}) {
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
        performance: { now: () => 0 },
        polygonClipping: options.polygonClipping || require("polygon-clipping"),
        RenderingCamera: class {},
        RenderingLayers: class {}
    };
    context.window = context;
    context.globalThis = context;

    vm.createContext(context);
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

function makeNode(xindex, yindex) {
    return { xindex, yindex, neighbors: [] };
}

test("level 0 ground bake nodes are expanded once per stable bubble", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    const sectionNode = makeNode(0, 0);
    const neighborNode = makeNode(1, 0);
    sectionNode.neighbors = [neighborNode];
    const map = {
        _prototypeSectionState: {
            activeCenterKey: "0,0",
            loadedNodes: [sectionNode, neighborNode],
            nodesBySectionKey: new Map([["0,0", [sectionNode]]])
        }
    };
    let expandCalls = 0;
    renderer.expandLevel0GroundBakeNodes = (nodes) => {
        expandCalls += 1;
        return nodes.concat(neighborNode);
    };

    const first = renderer.getLevel0GroundSurfaceBakeNodes(map, "0,0");
    const second = renderer.getLevel0GroundSurfaceBakeNodes(map, "0,0");

    assert.equal(expandCalls, 1);
    assert.equal(second, first);

    map._prototypeSectionState.activeCenterKey = "1,0";
    const afterCenterMove = renderer.getLevel0GroundSurfaceBakeNodes(map, "0,0");

    assert.equal(expandCalls, 2);
    assert.notEqual(afterCenterMove, first);
});

test("evicting a level 0 ground texture also evicts its bake-node cache", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    renderer.level0GroundSurfaceCache.set("old", {
        texture: { destroy() {} }
    });
    renderer.level0GroundSurfaceBakeNodeCache.set("old", {
        signature: "stale",
        nodes: []
    });

    renderer.getBakedLevel0SectionKeys({
        map: {
            _prototypeSectionState: {
                sectionAssetsByKey: new Map(),
                nodesBySectionKey: new Map()
            }
        }
    });

    assert.equal(renderer.level0GroundSurfaceCache.has("old"), false);
    assert.equal(renderer.level0GroundSurfaceBakeNodeCache.has("old"), false);
});

test("level 0 surface chunks map world bounds to stable 1024px tiles", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();

    assert.equal(renderer.getLevel0GroundSurfaceChunkWorldSize(), 32);
    assert.equal(
        renderer.getLevel0GroundSurfaceChunkCoordsForBounds({
            minX: -0.1,
            minY: 0,
            maxX: 32.1,
            maxY: 63.9
        }).map((coord) => `${coord.chunkX},${coord.chunkY}`).join("|"),
        "-1,0|-1,1|0,0|0,1|1,0|1,1"
    );
});

test("level 0 chunk floor visuals preserve interior holes", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    const map = { hexWidth: 1 / 0.866, hexHeight: 1 };
    const asset = { key: "0,0", tileCoordKeys: ["0,0"] };
    const fragment = { ownerSectionKey: "0,0" };
    const outer = [
        { x: 1, y: 1 },
        { x: 31, y: 1 },
        { x: 31, y: 31 },
        { x: 1, y: 31 }
    ];
    const holes = [[
        { x: 10, y: 10 },
        { x: 20, y: 10 },
        { x: 20, y: 20 },
        { x: 10, y: 20 }
    ]];
    let textureRequests = 0;
    renderer.getLevel0GroundSurfaceChunkTexture = function getLevel0GroundSurfaceChunkTexture(_ctx, sectionKey, _asset, chunkX, chunkY) {
        textureRequests += 1;
        return {
            texture: { sectionKey, chunkX, chunkY },
            bounds: this.getLevel0GroundSurfaceChunkBounds(chunkX, chunkY, map)
        };
    };

    const entries = renderer.collectLevel0ChunkFloorVisualEntries(
        { map },
        "floor_area:0,0:0:0",
        fragment,
        asset,
        outer,
        holes,
        0,
        1
    );

    assert.equal(Array.isArray(entries), true);
    assert.equal(entries.length, 1);
    assert.equal(textureRequests, 1);
    assert.equal(entries[0].texturePath, "level0chunk:0,0:0,0");
    assert.equal(entries[0].holes.length, 1);
    assert.equal(entries[0].holes[0].length, 4);
});

test("level 0 chunk hole clipping is cached across frames", () => {
    const polygonClipping = require("polygon-clipping");
    let intersectionCalls = 0;
    const RenderingImpl = loadRenderingImpl({
        polygonClipping: {
            ...polygonClipping,
            intersection(...args) {
                intersectionCalls += 1;
                return polygonClipping.intersection(...args);
            }
        }
    });
    const renderer = new RenderingImpl();
    const map = { hexWidth: 1 / 0.866, hexHeight: 1 };
    renderer.getLevel0GroundSurfaceChunkTexture = function getLevel0GroundSurfaceChunkTexture(_ctx, sectionKey, _asset, chunkX, chunkY) {
        return {
            texture: { sectionKey, chunkX, chunkY },
            bounds: this.getLevel0GroundSurfaceChunkBounds(chunkX, chunkY, map)
        };
    };
    const args = [
        { map },
        "floor_area:0,0:0:0",
        { ownerSectionKey: "0,0" },
        { key: "0,0", tileCoordKeys: ["0,0"] },
        [
            { x: 1, y: 1 },
            { x: 31, y: 1 },
            { x: 31, y: 31 },
            { x: 1, y: 31 }
        ],
        [[
            { x: 10, y: 10 },
            { x: 20, y: 10 },
            { x: 20, y: 20 },
            { x: 10, y: 20 }
        ]],
        0,
        1
    ];

    const first = renderer.collectLevel0ChunkFloorVisualEntries(...args);
    const second = renderer.collectLevel0ChunkFloorVisualEntries(...args);

    assert.equal(first.length, 1);
    assert.equal(second.length, 1);
    assert.equal(intersectionCalls, 1);
    assert.equal(renderer.floorVisualChunkClipCache.size, 1);
});

test("roads are considered baked only when every covering chunk is current and ready", () => {
    const RenderingImpl = loadRenderingImpl();
    const renderer = new RenderingImpl();
    const asset = {
        tileCoordKeys: ["0,0"],
        _level0SurfaceVersion: 1,
        _level0RoadSurfaceModelVersion: 2,
        _level0RoadSurfaceVersion: 0,
        _level0GroundSurfaceVersion: 0,
        _level0SurfaceTextureReadyVersion: 0
    };
    const node = { x: 31.9, y: 1, _prototypeSectionKey: "0,0" };
    const road = { type: "road", x: 31.9, y: 1, width: 1, height: 1, node };
    const ctx = {
        map: {
            _prototypeSectionState: {
                sectionAssetsByKey: new Map([["0,0", asset]])
            }
        }
    };
    const coords = renderer.getLevel0GroundSurfaceChunkCoordsForBounds({
        minX: 31.9 - 0.57735,
        minY: 0.5,
        maxX: 31.9 + 0.57735,
        maxY: 1.5
    });

    assert.equal(coords.length, 2);
    assert.equal(renderer.isRoadBakedIntoLevel0Surface(ctx, road), false);

    for (const coord of coords) {
        const key = renderer.getLevel0GroundSurfaceChunkKey("0,0", coord.chunkX, coord.chunkY);
        renderer.level0GroundSurfaceChunkCache.set(key, {
            ready: true,
            texture: {},
            bounds: {},
            signature: renderer.getLevel0GroundSurfaceChunkSignature(asset, coord.chunkX, coord.chunkY)
        });
    }
    assert.equal(renderer.isRoadBakedIntoLevel0Surface(ctx, road), true);

    asset._level0RoadSurfaceModelVersion += 1;
    assert.equal(renderer.isRoadBakedIntoLevel0Surface(ctx, road), false);
});
