const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadGameMap() {
    const context = {
        console,
        polygonClipping: require("polygon-clipping")
    };
    context.window = context;
    context.globalThis = context;
    vm.createContext(context);
    const source = fs.readFileSync(path.join(__dirname, "../public/assets/javascript/Map.js"), "utf8");
    vm.runInContext(source, context, { filename: "Map.js" });
    vm.runInContext("globalThis.__testExports = { GameMap, MapNode, NativeSet: Set };", context);
    return context.__testExports;
}

const { GameMap, MapNode, NativeSet } = loadGameMap();

function createTerrainPatchMap(width = 10, height = 10) {
    const map = Object.create(GameMap.prototype);
    map.width = width;
    map.height = height;
    map.wrapX = false;
    map.wrapY = false;
    map.hexWidth = 1 / 0.866;
    map.hexHeight = 1;
    map.terrainPolygons = [];
    map.nodes = [];
    map._suppressClearanceUpdates = true;
    map.isNodeTerrainImpassableForTraversal = () => false;
    map.markPathfindingSnapshotDirty = () => {};
    for (let x = 0; x < width; x++) {
        map.nodes[x] = [];
        for (let y = 0; y < height; y++) {
            map.nodes[x][y] = new MapNode(x, y, width, height);
        }
    }
    for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
            map.nodes[x][y].setNeighbors(map.nodes, map);
        }
    }
    return map;
}

test("buildGroundTerrainPolygonsFromNodes preserves polygon holes", () => {
    const map = Object.create(GameMap.prototype);
    map.hexWidth = 1 / 0.866;
    map.hexHeight = 1;
    map.smoothGroundTerrainPolygonPoints = function smoothForFixture(points) {
        return this.simplifyGroundTerrainPolygonPoints(points);
    };

    const w = map.hexWidth;
    const h = map.hexHeight;
    const nodes = [
        { x: 0.75 * w, y: 0, xindex: 1, yindex: 0 },
        { x: 0.375 * w, y: 0.5 * h, xindex: 0, yindex: 1 },
        { x: -0.375 * w, y: 0.5 * h, xindex: -1, yindex: 1 },
        { x: -0.75 * w, y: 0, xindex: -1, yindex: 0 },
        { x: -0.375 * w, y: -0.5 * h, xindex: 0, yindex: -1 },
        { x: 0.375 * w, y: -0.5 * h, xindex: 1, yindex: -1 }
    ];
    map.collectGroundTerrainPolygonGroups = () => [{
        type: "water",
        nodes,
        nodeKeys: new Set(nodes.map(node => map.getGroundTerrainNodeKey(node)))
    }];

    const polygons = map.buildGroundTerrainPolygonsFromNodes(nodes);

    assert.equal(polygons.length, 1);
    assert.equal(polygons[0].type, "water");
    assert.ok(polygons[0].points.length >= 3);
    assert.equal(Array.isArray(polygons[0].holes), true);
    assert.equal(polygons[0].holes.length, 1);
    assert.ok(polygons[0].holes[0].length >= 3);
});

test("replaceGroundTerrainPolygonPatch repairs only polygons touching the edited hex neighborhood", () => {
    const map = createTerrainPatchMap();
    const center = map.nodes[4][4];
    map.nodes[8][8].groundTextureId = map.getGroundTerrainTextureIdForType("water", 8, 8);
    const farPolygon = map.buildGroundTerrainPolygonsFromNodes([map.nodes[8][8]])[0];
    map.terrainPolygons = [farPolygon];
    map.groundTerrainClipGeometryToPolygons = () => {
        throw new Error("terrain painter must not commit clipped polygon vertices");
    };
    map.getGroundTerrainPolygonTypeAtPoint = () => {
        throw new Error("terrain painter must not rebuild tile membership from polygons");
    };
    const originalBuild = map.buildGroundTerrainPolygonsFromNodes;
    const buildSizes = [];
    map.buildGroundTerrainPolygonsFromNodes = function buildLocal(nodes, options) {
        buildSizes.push(Array.isArray(nodes) ? nodes.length : 0);
        return originalBuild.call(this, nodes, options);
    };

    assert.equal(map.replaceGroundTerrainPolygonPatch(center, "water"), true);

    assert.equal(buildSizes.length, 1);
    assert.equal(buildSizes[0], map.width * map.height);
    assert.equal(map.getGroundTerrainTypeForNode(center), "water");
    assert.equal(map.terrainPolygons.length, 2);
    assert.deepEqual(map.terrainPolygons[0], farPolygon);
    assert.equal(map.terrainPolygons[1].type, "water");
    assert.ok(map.terrainPolygons[1].points.length >= 3);
});

test("replaceGroundTerrainPolygonPatch changes only the clicked tile terrain value", () => {
    const map = createTerrainPatchMap();
    const center = map.nodes[4][4];
    const neighbor = map.nodes[5][4];
    neighbor.groundTextureId = map.getGroundTerrainTextureIdForType("desert", 5, 4);
    const beforeNeighborTextureId = neighbor.groundTextureId;

    assert.equal(map.replaceGroundTerrainPolygonPatch(center, "water"), true);

    assert.equal(map.getGroundTerrainTypeForNode(center), "water");
    assert.equal(neighbor.groundTextureId, beforeNeighborTextureId);
});

test("terrain polygon repair treats rounded hex-corner vertices as affected", () => {
    const map = createTerrainPatchMap(20, 20);
    const waterNodes = [
        [4, 7], [5, 6], [5, 7], [5, 8],
        [6, 5], [6, 6], [6, 7], [6, 8],
        [7, 5], [7, 6], [7, 7], [7, 8],
        [8, 5], [8, 6], [8, 7], [8, 8],
        [9, 5], [9, 6], [9, 7], [9, 8],
        [10, 6], [10, 7], [10, 8],
        [11, 7], [11, 8], [11, 9]
    ];
    for (const [x, y] of waterNodes) {
        map.nodes[x][y].groundTextureId = map.getGroundTerrainTextureIdForType("water", x, y);
    }
    map.terrainPolygons = map.buildGroundTerrainPolygonsFromNodes(
        waterNodes.map(([x, y]) => map.nodes[x][y])
    );

    assert.equal(map.replaceGroundTerrainPolygonPatch(map.nodes[12][8], "water"), true);

    assert.equal(map.terrainPolygons.length, 1);
    assert.equal(map.terrainPolygons[0].type, "water");
    assert.ok(map.terrainPolygons[0].points.some(point => (
        Math.abs(point.x - 10.680683602771362) < 1e-6 &&
        Math.abs(point.y - 8) < 1e-6
    )));
});

test("terrain affected-region detection tolerates saved rounded hex corners", () => {
    const map = createTerrainPatchMap(20, 20);
    const edited = map.nodes[12][8];
    const patchNodes = map.collectGroundTerrainLocalPatchNodes(edited);
    const affectedNodeKeys = new NativeSet(patchNodes.map(node => map.getGroundTerrainNodeKey(node)));
    const vertexSlotsByPointKey = map.buildGroundTerrainVertexSlotMap({ nodes: patchNodes });

    assert.equal(
        map.groundTerrainPointTouchesNodeKeys(
            { x: 10.103, y: 7 },
            affectedNodeKeys,
            vertexSlotsByPointKey,
            patchNodes
        ),
        true
    );
});
