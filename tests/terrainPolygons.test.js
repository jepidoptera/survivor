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
    vm.runInContext("globalThis.__testExports = { GameMap, MapNode, NativeMap: Map, NativeSet: Set };", context);
    return context.__testExports;
}

const { GameMap, MapNode, NativeMap, NativeSet } = loadGameMap();

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

function getTestPolygonBounds(points) {
    const sourcePoints = Array.isArray(points) ? points : [];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < sourcePoints.length; i++) {
        const x = Number(sourcePoints[i] && sourcePoints[i].x);
        const y = Number(sourcePoints[i] && sourcePoints[i].y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
    }
    return { minX, minY, maxX, maxY };
}

function testBoundsOverlap(a, b) {
    return !(a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY);
}

function testPointSegmentDistanceSq(px, py, ax, ay, bx, by) {
    const abx = bx - ax;
    const aby = by - ay;
    const lenSq = abx * abx + aby * aby;
    const t = lenSq > 1e-12
        ? Math.max(0, Math.min(1, ((px - ax) * abx + (py - ay) * aby) / lenSq))
        : 0;
    const x = ax + abx * t;
    const y = ay + aby * t;
    const dx = px - x;
    const dy = py - y;
    return dx * dx + dy * dy;
}

function testRingCoversPointBoundary(points, x, y, eps = 1e-6) {
    const ring = Array.isArray(points) ? points : [];
    if (ring.length < 2) return false;
    const epsSq = eps * eps;
    for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        if (testPointSegmentDistanceSq(x, y, Number(a.x), Number(a.y), Number(b.x), Number(b.y)) <= epsSq) {
            return true;
        }
    }
    return false;
}

function testTerrainPolygonCoversPoint(map, polygon, x, y) {
    return map.terrainPolygonContainsPoint(polygon, x, y) ||
        testRingCoversPointBoundary(polygon && polygon.points, x, y) ||
        (Array.isArray(polygon && polygon.holes) && polygon.holes.some(hole => (
            testRingCoversPointBoundary(hole, x, y)
        )));
}

function getSectionPolygonForNodes(map, nodes) {
    const points = [];
    for (let i = 0; i < nodes.length; i++) {
        points.push(...map.getGroundTerrainHexCorners(nodes[i]));
    }
    const bounds = getTestPolygonBounds(points);
    return [
        { x: bounds.minX - 0.001, y: bounds.minY - 0.001 },
        { x: bounds.maxX + 0.001, y: bounds.minY - 0.001 },
        { x: bounds.maxX + 0.001, y: bounds.maxY + 0.001 },
        { x: bounds.minX - 0.001, y: bounds.maxY + 0.001 }
    ];
}

function canonicalTerrainRingKey(map, points) {
    const keys = (Array.isArray(points) ? points : [])
        .map(point => map.getGroundTerrainRepairPointKey(point));
    if (keys.length > 1 && keys[0] === keys[keys.length - 1]) {
        keys.pop();
    }
    if (keys.length === 0) return "";
    const candidates = [];
    const addRotations = (source) => {
        for (let i = 0; i < source.length; i++) {
            candidates.push(source.slice(i).concat(source.slice(0, i)).join("|"));
        }
    };
    addRotations(keys);
    addRotations(keys.slice().reverse());
    candidates.sort();
    return candidates[0];
}

function canonicalTerrainPolygonsForType(map, polygons, type) {
    return (Array.isArray(polygons) ? polygons : [])
        .filter(polygon => polygon && polygon.type === type)
        .map(polygon => ({
            points: canonicalTerrainRingKey(map, polygon.points),
            holes: (Array.isArray(polygon.holes) ? polygon.holes : [])
                .map(hole => canonicalTerrainRingKey(map, hole))
                .sort()
        }))
        .sort((a, b) => {
            if (a.points < b.points) return -1;
            if (a.points > b.points) return 1;
            return JSON.stringify(a.holes).localeCompare(JSON.stringify(b.holes));
        });
}

function getTerrainPathNodes(map, startX, startY, directions) {
    let node = map.nodes[startX] && map.nodes[startX][startY];
    assert.ok(node, "terrain path fixture requires a valid start node");
    const nodes = [node];
    for (const direction of directions) {
        node = node.neighbors && node.neighbors[direction];
        assert.ok(node, `terrain path fixture walked off the map at direction ${direction}`);
        nodes.push(node);
    }
    return nodes;
}

function getOneRingTerrainNodes(nodes) {
    const byKey = new NativeMap();
    const addNode = (node) => {
        if (!node) return;
        byKey.set(`${node.xindex},${node.yindex}`, node);
    };
    for (const node of nodes) {
        addNode(node);
        for (const direction of [1, 3, 5, 7, 9, 11]) {
            addNode(node.neighbors && node.neighbors[direction]);
        }
    }
    return Array.from(byKey.values());
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

test("replaceGroundTerrainPolygonPatch uses local polygon geometry instead of full rebuild", () => {
    const map = createTerrainPatchMap();
    const center = map.nodes[4][4];
    map.nodes[8][8].groundTextureId = map.getGroundTerrainTextureIdForType("water", 8, 8);
    const farPolygon = map.buildGroundTerrainPolygonsFromNodes([map.nodes[8][8]])[0];
    map.terrainPolygons = [farPolygon];
    map.getGroundTerrainPolygonTypeAtPoint = () => {
        throw new Error("terrain painter must not rebuild tile membership from polygons");
    };
    map.collectGroundTerrainPolygonRepairSourceNodes = () => {
        throw new Error("terrain painter must not scan the full map for local paint edits");
    };
    map.buildGroundTerrainPolygonsFromNodes = () => {
        throw new Error("terrain painter must not rebuild terrain polygons from tile nodes");
    };
    map.removeGroundTerrainAffectedPolygonVertices = () => {
        throw new Error("terrain painter must not delete affected vertices before local boolean operations");
    };

    assert.equal(map.replaceGroundTerrainPolygonPatch(center, "water"), true);

    assert.equal(map.getGroundTerrainTypeForNode(center), "water");
    assert.equal(map.terrainPolygons.length, 2);
    const farPolygonJson = JSON.stringify(farPolygon);
    const farPolygonStillPresent = map.terrainPolygons.some(polygon => (
        JSON.stringify(polygon) === farPolygonJson
    ));
    const editedPolygon = map.terrainPolygons.find(polygon => (
        JSON.stringify(polygon) !== farPolygonJson
    ));
    assert.equal(farPolygonStillPresent, true);
    assert.equal(editedPolygon.type, "water");
    assert.ok(editedPolygon.points.length >= 3);
    assert.ok(Array.isArray(map._terrainPaintDebugLastEdit.modifiedSegments));
    assert.ok(map._terrainPaintDebugLastEdit.modifiedSegments.length > 0);
    assert.ok(map._terrainPaintDebugLastEdit.modifiedSegments.every(segment => (
        segment &&
        Number.isFinite(segment.a && segment.a.x) &&
        Number.isFinite(segment.a && segment.a.y) &&
        Number.isFinite(segment.b && segment.b.x) &&
        Number.isFinite(segment.b && segment.b.y)
    )));
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

test("terrain painter preserves manually moved vertices outside the local edit span", () => {
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
    const movedVertex = {
        x: map.terrainPolygons[0].points[0].x - 0.271,
        y: map.terrainPolygons[0].points[0].y + 0.137
    };
    map.terrainPolygons[0].points[0] = movedVertex;

    assert.equal(map.replaceGroundTerrainPolygonPatch(map.nodes[12][8], "water"), true);

    assert.equal(map.terrainPolygons.length, 1);
    assert.equal(map.terrainPolygons[0].points.some(point => (
        point.x === movedVertex.x && point.y === movedVertex.y
    )), true);
    assert.ok(Array.isArray(map._terrainPaintDebugLastEdit.rawReplacementSegments));
    assert.ok(map._terrainPaintDebugLastEdit.rawReplacementSegments.length > 0);
    assert.ok(Array.isArray(map._terrainPaintDebugLastEdit.modifiedSegments));
    assert.ok(map._terrainPaintDebugLastEdit.modifiedSegments.length > 0);
});

test("connecting terrain components preserves unrelated same-type polygons with overlapping bounds", () => {
    const map = createTerrainPatchMap();
    const left = map.nodes[3][4];
    const bridge = map.nodes[4][4];
    const right = map.nodes[5][4];
    const unrelated = map.nodes[2][2];
    const mudId = map.getGroundTerrainTextureIdForType("mud", 0, 0);
    left.groundTextureId = mudId;
    right.groundTextureId = mudId;
    unrelated.groundTextureId = mudId;
    map.terrainPolygons = map.buildGroundTerrainPolygonsFromNodes([left, right, unrelated]);
    const beforePatchBounds = map.getGroundTerrainHexPatchBounds(
        map.collectGroundTerrainLocalPatchNodes(bridge, { radius: 1 })
    );
    const unrelatedPolygon = map.terrainPolygons.find(polygon => (
        map.terrainPolygonContainsPoint(polygon, unrelated.x, unrelated.y)
    ));

    assert.ok(unrelatedPolygon, "fixture should start with an unrelated mud polygon");
    assert.equal(testBoundsOverlap(getTestPolygonBounds(unrelatedPolygon.points), beforePatchBounds), true);

    assert.equal(map.replaceGroundTerrainPolygonPatch(bridge, "mud"), true);

    const mudPolygons = map.terrainPolygons.filter(polygon => polygon.type === "mud");
    assert.equal(mudPolygons.length, 2);
    assert.equal(map.getGroundTerrainTypeForNode(unrelated), "mud");
    assert.equal(mudPolygons.some(polygon => (
        testTerrainPolygonCoversPoint(map, polygon, unrelated.x, unrelated.y)
    )), true);
    assert.equal(mudPolygons.some(polygon => (
        testTerrainPolygonCoversPoint(map, polygon, left.x, left.y) &&
        testTerrainPolygonCoversPoint(map, polygon, bridge.x, bridge.y) &&
        testTerrainPolygonCoversPoint(map, polygon, right.x, right.y)
    )), true);
});

test("terrain local patch splits a polygon when the edited tile is subtracted", () => {
    const map = createTerrainPatchMap();
    const left = map.nodes[3][4];
    const center = map.nodes[4][4];
    const right = map.nodes[5][4];
    const waterId = map.getGroundTerrainTextureIdForType("water", 0, 0);
    left.groundTextureId = waterId;
    center.groundTextureId = waterId;
    right.groundTextureId = waterId;
    map.terrainPolygons = map.buildGroundTerrainPolygonsFromNodes([left, center, right]);

    assert.equal(map.replaceGroundTerrainPolygonPatch(center, "grass"), true);

    const waterPolygons = map.terrainPolygons.filter(polygon => polygon.type === "water");
    assert.equal(waterPolygons.length, 2);
    assert.equal(waterPolygons.some(polygon => (
        map.terrainPolygonContainsPoint(polygon, left.x, left.y) &&
        !map.terrainPolygonContainsPoint(polygon, right.x, right.y)
    )), true);
    assert.equal(waterPolygons.some(polygon => (
        map.terrainPolygonContainsPoint(polygon, right.x, right.y) &&
        !map.terrainPolygonContainsPoint(polygon, left.x, left.y)
    )), true);
});

test("water terrain polygons collide with circular movement hitboxes", () => {
    const map = createTerrainPatchMap();
    map.terrainPolygons = [{
        type: "water",
        points: [
            { x: 1, y: 0 },
            { x: 2, y: 0 },
            { x: 2, y: 2 },
            { x: 1, y: 2 }
        ]
    }];

    const collision = map.resolveGroundTerrainHitboxCollision({
        type: "circle",
        x: 0.85,
        y: 1,
        radius: 0.2
    });

    assert.ok(collision, "water polygon should block overlapping hitbox");
    assert.ok(collision.pushX < 0, "hitbox should be pushed away from water");
    assert.equal(collision.terrainType, "water");
});

test("section terrain edits patch only the edited section", () => {
    const map = createTerrainPatchMap(5, 5);
    const sectionA = "0,0";
    const sectionB = "1,0";
    const sectionANodes = [];
    const sectionBNodes = [];
    for (let x = 0; x < map.width; x++) {
        for (let y = 0; y < map.height; y++) {
            const node = map.nodes[x][y];
            node._prototypeSectionKey = x <= 1 ? sectionA : sectionB;
            if (node._prototypeSectionKey === sectionA) sectionANodes.push(node);
            else sectionBNodes.push(node);
        }
    }
    const getTileCoordKeys = (nodes) => nodes.map(node => `${node.xindex},${node.yindex}`);
    const assetA = {
        key: sectionA,
        tileCoordKeys: getTileCoordKeys(sectionANodes),
        groundTiles: {},
        terrainPolygons: [],
        sectionPolygon: getSectionPolygonForNodes(map, sectionANodes),
        _level0GroundSurfaceVersion: 0
    };
    const assetB = {
        key: sectionB,
        tileCoordKeys: getTileCoordKeys(sectionBNodes),
        groundTiles: {},
        terrainPolygons: [],
        sectionPolygon: getSectionPolygonForNodes(map, sectionBNodes),
        _level0GroundSurfaceVersion: 0
    };
    map._prototypeSectionState = {
        nodesBySectionKey: new NativeMap([
            [sectionA, sectionANodes],
            [sectionB, sectionBNodes]
        ]),
        sectionAssetsByKey: new NativeMap([
            [sectionA, assetA],
            [sectionB, assetB]
        ])
    };
    map.getPrototypeSectionAsset = (key) => map._prototypeSectionState.sectionAssetsByKey.get(key) || null;

    const edited = map.nodes[1][2];
    const borderNeighbor = map.nodes[2][2];
    borderNeighbor.groundTextureId = map.getGroundTerrainTextureIdForType("water", 2, 2);
    assetB.terrainPolygons = map.buildGroundTerrainPolygonsFromNodes([borderNeighbor]);

    assert.equal(map.replaceGroundTerrainPolygonPatch(edited, "water", {
        asset: assetA,
        sectionKey: sectionA
    }), true);

    assert.equal(assetA.terrainPolygons.length > 0, true);
    assert.equal(assetB.terrainPolygons.length > 0, true);
    assert.equal(assetA.terrainPolygons.some(polygon => (
        polygon.type === "water" && map.terrainPolygonContainsPoint(polygon, edited.x, edited.y)
    )), true);
    assert.equal(assetB.terrainPolygons.some(polygon => (
        polygon.type === "water" && map.terrainPolygonContainsPoint(polygon, borderNeighbor.x, borderNeighbor.y)
    )), true);
    assert.equal(assetA.groundTiles["1,2"], map.getGroundTerrainTextureIdForType("water", 1, 2));
    assert.equal(Object.prototype.hasOwnProperty.call(assetB.groundTiles, "2,2"), false);
    assert.equal(assetA._level0GroundSurfaceVersion, 1);
    assert.equal(assetB._level0GroundSurfaceVersion, 1);
});

test("terrain paint spell path does not reset level 0 ground caches", () => {
    const source = fs.readFileSync(path.join(__dirname, "../public/assets/javascript/spells.js"), "utf8");
    const paintStart = source.indexOf("function paintTerrainAtWorldPoint");
    assert.notEqual(paintStart, -1);
    const paintEnd = source.indexOf("function isVisibleFloorInteriorViewActive", paintStart);
    assert.notEqual(paintEnd, -1);
    const paintSource = source.slice(paintStart, paintEnd);

    assert.doesNotMatch(paintSource, /resetLevel0GroundSurfaceCaches/);
    assert.match(paintSource, /Do not[\s/]+reset[\s/]+level-0 ground caches here/);
});

test("terrain local patch treats affected holes as editable polygon rings", () => {
    const map = createTerrainPatchMap();
    const center = map.nodes[4][4];
    const neighbors = [1, 3, 5, 7, 9, 11].map(direction => center.neighbors[direction]);
    for (const neighbor of neighbors) {
        neighbor.groundTextureId = map.getGroundTerrainTextureIdForType("water", neighbor.xindex, neighbor.yindex);
    }
    map.terrainPolygons = map.buildGroundTerrainPolygonsFromNodes(neighbors);
    assert.equal(map.terrainPolygons.length, 1);
    assert.equal(Array.isArray(map.terrainPolygons[0].holes), true);
    assert.equal(map.terrainPolygonContainsPoint(map.terrainPolygons[0], center.x, center.y), false);

    assert.equal(map.replaceGroundTerrainPolygonPatch(center, "water"), true);

    assert.equal(map.terrainPolygons.length, 1);
    assert.equal(map.terrainPolygons[0].type, "water");
    assert.equal(map.terrainPolygonContainsPoint(map.terrainPolygons[0], center.x, center.y), true);
});

test("terrain local patch applies grass priority when closing a tiny water ring", () => {
    const map = createTerrainPatchMap();
    const center = map.nodes[4][4];
    const gapDirection = 1;
    const waterId = map.getGroundTerrainTextureIdForType("water", 0, 0);
    const waterNeighbors = [];
    for (const direction of [1, 3, 5, 7, 9, 11]) {
        const neighbor = center.neighbors[direction];
        if (direction === gapDirection) continue;
        neighbor.groundTextureId = waterId;
        waterNeighbors.push(neighbor);
    }
    map.terrainPolygons = map.buildGroundTerrainPolygonsFromNodes(waterNeighbors);
    assert.equal(map.terrainPolygons.length, 1);
    assert.equal(Array.isArray(map.terrainPolygons[0].holes), false);

    assert.equal(map.replaceGroundTerrainPolygonPatch(center.neighbors[gapDirection], "water"), true);

    assert.equal(map.terrainPolygons.every(polygon => polygon.type === "water"), true);
    assert.equal(map.terrainPolygons.some(polygon => (
        map.terrainPolygonContainsPoint(polygon, center.x, center.y)
    )), false);
    assert.ok(map._terrainPaintDebugLastEdit.modifiedSegments.length > 0);
});

test("terrain local patch separates a new island hole from the outer shore", () => {
    const map = createTerrainPatchMap(14, 12);
    const waterId = map.getGroundTerrainTextureIdForType("water", 0, 0);
    const grassCoords = new Set(["2,5", "3,5", "4,5", "5,5", "6,5", "5,6", "6,6"]);
    const waterNodes = [];
    for (let x = 2; x <= 10; x++) {
        for (let y = 3; y <= 8; y++) {
            if (grassCoords.has(`${x},${y}`)) continue;
            const node = map.nodes[x][y];
            node.groundTextureId = waterId;
            waterNodes.push(node);
        }
    }
    map.terrainPolygons = map.buildGroundTerrainPolygonsFromNodes(waterNodes);

    assert.equal(map.replaceGroundTerrainPolygonPatch(map.nodes[4][5], "water"), true);

    assert.equal(map.terrainPolygons.length, 1);
    const polygon = map.terrainPolygons[0];
    assert.equal(Array.isArray(polygon.holes), true);
    assert.equal(polygon.holes.length, 1);
    assert.equal(map.terrainPolygonContainsPoint(polygon, map.nodes[5][5].x, map.nodes[5][5].y), false);
    assert.equal(map.terrainPolygonContainsPoint(polygon, map.nodes[3][5].x, map.nodes[3][5].y), false);
    const outerKeys = new Set(polygon.points.map(point => map.getGroundTerrainRepairPointKey(point)));
    assert.equal(polygon.holes[0].some(point => outerKeys.has(map.getGroundTerrainRepairPointKey(point))), false);
});

test("terrain local patch removes a hole when an island connects to shore", () => {
    const map = createTerrainPatchMap(14, 12);
    const waterId = map.getGroundTerrainTextureIdForType("water", 0, 0);
    const grassCoords = new Set(["2,5", "3,5", "5,5", "6,5", "5,6", "6,6"]);
    const waterNodes = [];
    for (let x = 2; x <= 10; x++) {
        for (let y = 3; y <= 8; y++) {
            if (grassCoords.has(`${x},${y}`)) continue;
            const node = map.nodes[x][y];
            node.groundTextureId = waterId;
            waterNodes.push(node);
        }
    }
    map.terrainPolygons = map.buildGroundTerrainPolygonsFromNodes(waterNodes);
    assert.equal(map.terrainPolygons.length, 1);
    assert.equal(Array.isArray(map.terrainPolygons[0].holes), true);
    assert.equal(map.terrainPolygons[0].holes.length, 1);

    assert.equal(map.replaceGroundTerrainPolygonPatch(map.nodes[4][5], "grass"), true);

    assert.equal(map.terrainPolygons.length, 1);
    const polygon = map.terrainPolygons[0];
    assert.equal(Array.isArray(polygon.holes), false);
    assert.equal(map.terrainPolygonContainsPoint(polygon, map.nodes[5][5].x, map.nodes[5][5].y), false);
    assert.equal(map.terrainPolygonContainsPoint(polygon, map.nodes[4][5].x, map.nodes[4][5].y), false);
    assert.equal(map.terrainPolygonContainsPoint(polygon, map.nodes[3][5].x, map.nodes[3][5].y), false);
});

test("terrain local patch keeps a polygon when several holes are closed", () => {
    const map = createTerrainPatchMap(24, 24);
    const waterId = map.getGroundTerrainTextureIdForType("water", 0, 0);
    const waterNodes = [];
    for (let x = 3; x <= 20; x++) {
        for (let y = 3; y <= 20; y++) {
            const node = map.nodes[x][y];
            node.groundTextureId = waterId;
            waterNodes.push(node);
        }
    }
    map.terrainPolygons = map.buildGroundTerrainPolygonsFromNodes(waterNodes);

    const holeCoords = [
        [8, 8], [10, 8], [12, 8], [14, 8],
        [9, 11], [11, 11], [13, 11],
        [8, 14], [10, 14], [12, 14], [14, 14]
    ];
    const getCurrentWaterNodes = () => {
        const nodes = [];
        for (let x = 0; x < map.width; x++) {
            for (let y = 0; y < map.height; y++) {
                const node = map.nodes[x][y];
                if (map.getGroundTerrainTypeForNode(node) === "water") nodes.push(node);
            }
        }
        return nodes;
    };
    const assertWaterMatchesTiles = (label) => {
        const waterPolygons = map.terrainPolygons.filter(polygon => polygon.type === "water");
        assert.equal(waterPolygons.length, 1, label);
        assert.deepEqual(
            canonicalTerrainPolygonsForType(map, map.terrainPolygons, "water"),
            canonicalTerrainPolygonsForType(
                map,
                map.buildGroundTerrainPolygonsFromNodes(getCurrentWaterNodes()),
                "water"
            ),
            label
        );
    };

    for (const [x, y] of holeCoords) {
        assert.equal(map.replaceGroundTerrainPolygonPatch(map.nodes[x][y], "grass"), true);
        assertWaterMatchesTiles(`after cutting ${x},${y}`);
    }
    for (const [x, y] of holeCoords) {
        assert.equal(map.replaceGroundTerrainPolygonPatch(map.nodes[x][y], "water"), true);
        assertWaterMatchesTiles(`after filling ${x},${y}`);
    }
});

test("terrain edit priority orders boundary ownership", () => {
    const map = createTerrainPatchMap();

    assert.ok(map.getGroundTerrainEditPriority("desert") > map.getGroundTerrainEditPriority("grass"));
    assert.ok(map.getGroundTerrainEditPriority("grass") > map.getGroundTerrainEditPriority("mud"));
    assert.ok(map.getGroundTerrainEditPriority("mud") > map.getGroundTerrainEditPriority("water"));
});

test("water line on grass matches the water left by a desert negative of the same line", () => {
    const directions = [
        5, 5, 7, 7, 9, 7, 5, 5, 3, 3,
        5, 7, 7, 5, 5, 3, 1, 1, 3, 5,
        5, 7, 9, 9, 7, 5, 3, 3
    ];
    const grassMap = createTerrainPatchMap(28, 20);
    const grassLineNodes = getTerrainPathNodes(grassMap, 4, 10, directions);
    const lineKeys = new NativeSet(grassLineNodes.map(node => `${node.xindex},${node.yindex}`));

    for (const node of grassLineNodes) {
        assert.equal(grassMap.replaceGroundTerrainPolygonPatch(node, "water"), true);
    }

    const negativeMap = createTerrainPatchMap(28, 20);
    const negativeLineNodes = getTerrainPathNodes(negativeMap, 4, 10, directions);
    const negativeRegionNodes = getOneRingTerrainNodes(negativeLineNodes);
    const waterId = negativeMap.getGroundTerrainTextureIdForType("water", 0, 0);
    for (const node of negativeRegionNodes) {
        node.groundTextureId = waterId;
    }
    negativeMap.terrainPolygons = negativeMap.buildGroundTerrainPolygonsFromNodes(negativeRegionNodes);
    for (const node of negativeRegionNodes) {
        if (lineKeys.has(`${node.xindex},${node.yindex}`)) continue;
        assert.equal(negativeMap.replaceGroundTerrainPolygonPatch(node, "desert"), true);
    }

    assert.deepEqual(
        canonicalTerrainPolygonsForType(negativeMap, negativeMap.terrainPolygons, "water"),
        canonicalTerrainPolygonsForType(grassMap, grassMap.terrainPolygons, "water")
    );
});

test("water line painted into an existing body matches the same line painted outward", () => {
    const initialWaterCoords = [
        [18, 13], [18, 14], [18, 15], [18, 16],
        [19, 12], [19, 13], [19, 14], [19, 15], [19, 16],
        [20, 12], [20, 13], [20, 14], [20, 15], [20, 16],
        [21, 12], [21, 13], [21, 14], [21, 15], [21, 16],
        [22, 12], [22, 13], [22, 14], [22, 15]
    ];
    const lineCoords = [
        [19, 17], [19, 18], [20, 18], [19, 19], [19, 20],
        [20, 20], [20, 21], [20, 22], [21, 23], [20, 23],
        [20, 24], [21, 25], [22, 25], [21, 26]
    ];
    const makeMap = () => {
        const map = createTerrainPatchMap(36, 30);
        const waterId = map.getGroundTerrainTextureIdForType("water", 0, 0);
        const initialWaterNodes = [];
        for (const [x, y] of initialWaterCoords) {
            const node = map.nodes[x][y];
            node.groundTextureId = waterId;
            initialWaterNodes.push(node);
        }
        map.terrainPolygons = map.buildGroundTerrainPolygonsFromNodes(initialWaterNodes);
        return map;
    };
    const paintLine = (map, coords) => {
        for (const [x, y] of coords) {
            const node = map.nodes[x][y];
            if (map.getGroundTerrainTypeForNode(node) !== "water") {
                assert.equal(map.replaceGroundTerrainPolygonPatch(node, "water"), true);
            }
        }
    };
    const outwardMap = makeMap();
    const inwardMap = makeMap();

    paintLine(outwardMap, lineCoords);
    paintLine(inwardMap, lineCoords.slice().reverse());

    assert.deepEqual(
        canonicalTerrainPolygonsForType(inwardMap, inwardMap.terrainPolygons, "water"),
        canonicalTerrainPolygonsForType(outwardMap, outwardMap.terrainPolygons, "water")
    );
});

test("water line cut across the middle matches painting the separated segments", () => {
    const waterLineCoords = [
        [8, 14], [9, 14], [10, 14], [11, 14],
        [12, 14], [13, 14], [14, 14], [15, 14],
        [16, 14], [17, 14], [18, 14], [19, 14],
        [20, 14], [21, 14], [22, 14], [23, 14]
    ];
    const cutCoords = [
        [14, 13], [15, 13],
        [14, 14], [15, 14], [16, 14],
        [15, 15], [16, 15]
    ];
    const cutCoordKeys = new NativeSet(cutCoords.map(([x, y]) => `${x},${y}`));
    const paintCoords = (map, coords, terrainType) => {
        for (const [x, y] of coords) {
            const node = map.nodes[x][y];
            if (map.getGroundTerrainTypeForNode(node) !== terrainType) {
                assert.equal(map.replaceGroundTerrainPolygonPatch(node, terrainType), true);
            }
        }
    };
    const cutMap = createTerrainPatchMap(32, 28);
    const separatedMap = createTerrainPatchMap(32, 28);

    paintCoords(cutMap, waterLineCoords, "water");
    paintCoords(cutMap, cutCoords, "grass");
    paintCoords(
        separatedMap,
        waterLineCoords.filter(([x, y]) => !cutCoordKeys.has(`${x},${y}`)),
        "water"
    );

    assert.deepEqual(
        canonicalTerrainPolygonsForType(cutMap, cutMap.terrainPolygons, "water"),
        canonicalTerrainPolygonsForType(separatedMap, separatedMap.terrainPolygons, "water")
    );
    assert.equal(cutMap.terrainPolygons.filter(polygon => polygon.type === "water").length, 2);
    assert.equal(separatedMap.terrainPolygons.filter(polygon => polygon.type === "water").length, 2);
});

test("section water line cut across the middle matches painting separated segments", () => {
    const makeSectionMap = () => {
        const map = createTerrainPatchMap(32, 28);
        const sectionKey = "0,0";
        const sectionNodes = [];
        for (let x = 0; x < map.width; x++) {
            for (let y = 0; y < map.height; y++) {
                const node = map.nodes[x][y];
                node._prototypeSectionKey = sectionKey;
                sectionNodes.push(node);
            }
        }
        const asset = {
            key: sectionKey,
            tileCoordKeys: sectionNodes.map(node => `${node.xindex},${node.yindex}`),
            groundTiles: {},
            terrainPolygons: [],
            sectionPolygon: getSectionPolygonForNodes(map, sectionNodes),
            _level0GroundSurfaceVersion: 0
        };
        map._prototypeSectionState = {
            nodesBySectionKey: new NativeMap([[sectionKey, sectionNodes]]),
            sectionAssetsByKey: new NativeMap([[sectionKey, asset]])
        };
        map.getPrototypeSectionAsset = (key) => map._prototypeSectionState.sectionAssetsByKey.get(key) || null;
        return { map, asset, sectionKey };
    };
    const paintCoords = (fixture, coords, terrainType) => {
        for (const [x, y] of coords) {
            const node = fixture.map.nodes[x][y];
            if (fixture.map.getGroundTerrainTypeForNode(node) !== terrainType) {
                assert.equal(fixture.map.replaceGroundTerrainPolygonPatch(node, terrainType, {
                    asset: fixture.asset,
                    sectionKey: fixture.sectionKey
                }), true);
            }
        }
    };
    const waterLineCoords = [
        [8, 14], [9, 14], [10, 14], [11, 14],
        [12, 14], [13, 14], [14, 14], [15, 14],
        [16, 14], [17, 14], [18, 14], [19, 14],
        [20, 14], [21, 14], [22, 14], [23, 14]
    ];
    const cutCoords = [
        [14, 13], [15, 13],
        [14, 14], [15, 14], [16, 14],
        [15, 15], [16, 15]
    ];
    const cutCoordKeys = new NativeSet(cutCoords.map(([x, y]) => `${x},${y}`));
    const cutFixture = makeSectionMap();
    const separatedFixture = makeSectionMap();

    paintCoords(cutFixture, waterLineCoords, "water");
    paintCoords(cutFixture, cutCoords, "grass");
    paintCoords(
        separatedFixture,
        waterLineCoords.filter(([x, y]) => !cutCoordKeys.has(`${x},${y}`)),
        "water"
    );

    assert.deepEqual(
        canonicalTerrainPolygonsForType(cutFixture.map, cutFixture.asset.terrainPolygons, "water"),
        canonicalTerrainPolygonsForType(separatedFixture.map, separatedFixture.asset.terrainPolygons, "water")
    );
    assert.equal(cutFixture.asset.terrainPolygons.filter(polygon => polygon.type === "water").length, 2);
    assert.equal(separatedFixture.asset.terrainPolygons.filter(polygon => polygon.type === "water").length, 2);
});

test("section water patch remains editable after save and reload", () => {
    const makeSectionMap = (savedAsset = null) => {
        const map = createTerrainPatchMap(18, 16);
        const sectionKey = "0,0";
        const sectionNodes = [];
        for (let x = 0; x < map.width; x++) {
            for (let y = 0; y < map.height; y++) {
                const node = map.nodes[x][y];
                node._prototypeSectionKey = sectionKey;
                sectionNodes.push(node);
            }
        }
        const tileCoordKeys = sectionNodes.map(node => `${node.xindex},${node.yindex}`);
        const asset = savedAsset
            ? {
                ...savedAsset,
                groundTiles: { ...savedAsset.groundTiles },
                terrainPolygons: savedAsset.terrainPolygons.map(polygon => ({
                    type: polygon.type,
                    points: polygon.points.map(point => ({ ...point })),
                    holes: Array.isArray(polygon.holes)
                        ? polygon.holes.map(hole => hole.map(point => ({ ...point })))
                        : undefined
                }))
            }
            : {
                key: sectionKey,
                tileCoordKeys,
                groundTiles: {},
                terrainPolygons: [],
                sectionPolygon: getSectionPolygonForNodes(map, sectionNodes),
                _level0GroundSurfaceVersion: 0
            };
        asset.key = sectionKey;
        asset.tileCoordKeys = tileCoordKeys;
        asset.sectionPolygon = getSectionPolygonForNodes(map, sectionNodes);
        map._prototypeSectionState = {
            nodesBySectionKey: new NativeMap([[sectionKey, sectionNodes]]),
            sectionAssetsByKey: new NativeMap([[sectionKey, asset]])
        };
        map.getPrototypeSectionAsset = (key) => map._prototypeSectionState.sectionAssetsByKey.get(key) || null;
        if (savedAsset) {
            for (const node of sectionNodes) {
                const coordKey = `${node.xindex},${node.yindex}`;
                if (Object.prototype.hasOwnProperty.call(asset.groundTiles, coordKey)) {
                    node.groundTextureId = asset.groundTiles[coordKey];
                }
            }
            asset.terrainPolygons = map.normalizeGroundTerrainPolygons(asset.terrainPolygons);
        }
        return { map, asset, sectionKey };
    };
    const paintCoords = (fixture, coords) => {
        for (const [x, y] of coords) {
            const node = fixture.map.nodes[x][y];
            if (fixture.map.getGroundTerrainTypeForNode(node) !== "water") {
                assert.equal(fixture.map.replaceGroundTerrainPolygonPatch(node, "water", {
                    asset: fixture.asset,
                    sectionKey: fixture.sectionKey
                }), true);
            }
        }
    };
    const cloneSavedAsset = (asset) => JSON.parse(JSON.stringify({
        key: asset.key,
        tileCoordKeys: asset.tileCoordKeys,
        groundTiles: asset.groundTiles,
        terrainPolygons: asset.terrainPolygons,
        sectionPolygon: asset.sectionPolygon,
        _level0GroundSurfaceVersion: asset._level0GroundSurfaceVersion
    }));
    const initialCoords = [
        [7, 7], [8, 7], [9, 7],
        [8, 8], [9, 8],
        [8, 6]
    ];
    const edgeCoord = [10, 7];

    const reloadedFixture = makeSectionMap();
    paintCoords(reloadedFixture, initialCoords);
    const savedAsset = cloneSavedAsset(reloadedFixture.asset);
    const hydratedFixture = makeSectionMap(savedAsset);
    paintCoords(hydratedFixture, [edgeCoord]);

    const continuousFixture = makeSectionMap();
    paintCoords(continuousFixture, initialCoords.concat([edgeCoord]));

    assert.deepEqual(
        canonicalTerrainPolygonsForType(hydratedFixture.map, hydratedFixture.asset.terrainPolygons, "water"),
        canonicalTerrainPolygonsForType(continuousFixture.map, continuousFixture.asset.terrainPolygons, "water")
    );
});

test("water painted through reloaded mud matches direct final terrain", () => {
    const cloneReloadedTerrainMap = (sourceMap) => {
        const reloaded = createTerrainPatchMap(sourceMap.width, sourceMap.height);
        for (let x = 0; x < sourceMap.width; x++) {
            for (let y = 0; y < sourceMap.height; y++) {
                reloaded.nodes[x][y].groundTextureId = sourceMap.nodes[x][y].groundTextureId;
            }
        }
        reloaded.terrainPolygons = reloaded.normalizeGroundTerrainPolygons(
            JSON.parse(JSON.stringify(sourceMap.terrainPolygons))
        );
        return reloaded;
    };
    const paintCoords = (map, coords, terrainType) => {
        for (const [x, y] of coords) {
            const node = map.nodes[x][y];
            if (map.getGroundTerrainTypeForNode(node) !== terrainType) {
                assert.equal(map.replaceGroundTerrainPolygonPatch(node, terrainType), true);
            }
        }
    };
    const waterCoords = [
        [8, 8], [8, 9],
        [9, 8], [9, 9],
        [10, 8], [10, 9]
    ];
    const mudCoords = [
        [11, 7], [11, 8], [11, 9],
        [12, 7], [12, 8], [12, 9],
        [13, 7], [13, 8], [13, 9]
    ];
    const cutWaterCoords = [
        [10, 8], [11, 8], [12, 8], [13, 8]
    ];
    const cutWaterKeys = new NativeSet(cutWaterCoords.map(([x, y]) => `${x},${y}`));
    const finalMudCoords = mudCoords.filter(([x, y]) => !cutWaterKeys.has(`${x},${y}`));

    const reloadedCutMap = createTerrainPatchMap(26, 20);
    paintCoords(reloadedCutMap, waterCoords, "water");
    paintCoords(reloadedCutMap, mudCoords, "mud");
    const hydratedCutMap = cloneReloadedTerrainMap(reloadedCutMap);
    paintCoords(hydratedCutMap, cutWaterCoords, "water");

    const directFinalMap = createTerrainPatchMap(26, 20);
    paintCoords(directFinalMap, waterCoords.concat(cutWaterCoords), "water");
    paintCoords(directFinalMap, finalMudCoords, "mud");

    assert.deepEqual(
        {
            water: canonicalTerrainPolygonsForType(hydratedCutMap, hydratedCutMap.terrainPolygons, "water"),
            mud: canonicalTerrainPolygonsForType(hydratedCutMap, hydratedCutMap.terrainPolygons, "mud")
        },
        {
            water: canonicalTerrainPolygonsForType(directFinalMap, directFinalMap.terrainPolygons, "water"),
            mud: canonicalTerrainPolygonsForType(directFinalMap, directFinalMap.terrainPolygons, "mud")
        }
    );
});

test("water immersion query reports shore distance and slope depth", () => {
    const map = createTerrainPatchMap(16, 16);
    const waterNodes = [];
    for (let x = 5; x <= 9; x++) {
        for (let y = 5; y <= 9; y++) {
            const node = map.nodes[x][y];
            node.groundTextureId = map.getGroundTerrainTextureIdForType("water", x, y);
            waterNodes.push(node);
        }
    }
    map.terrainPolygons = map.buildGroundTerrainPolygonsFromNodes(waterNodes);
    const center = map.nodes[7][7];
    const centerImmersion = map.getGroundTerrainWaterImmersionAtPoint(center.x, center.y, {
        slope: 0.25,
        maxDepth: 10
    });

    assert.equal(centerImmersion.inWater, true);
    assert.ok(centerImmersion.distanceToShore > 0);
    assert.equal(centerImmersion.submergedDepth, centerImmersion.distanceToShore * 0.25);
    assert.equal(centerImmersion.maxDepth, 10);

    const defaultImmersion = map.getGroundTerrainWaterImmersionAtPoint(center.x, center.y);
    assert.equal(defaultImmersion.slope, 2 / 3);
    assert.equal(defaultImmersion.maxDepth, 2 / 3);
    assert.equal(defaultImmersion.submergedDepth, Math.min(2 / 3, defaultImmersion.distanceToShore * (2 / 3)));

    const grass = map.getGroundTerrainWaterImmersionAtPoint(map.nodes[2][2].x, map.nodes[2][2].y);
    assert.equal(grass.inWater, false);
    assert.equal(grass.distanceToShore, 0);
    assert.equal(grass.submergedDepth, 0);
    assert.equal(grass.slope, 2 / 3);
    assert.equal(grass.maxDepth, 2 / 3);

    const upperLayer = map.getGroundTerrainWaterImmersionAtPoint(center.x, center.y, { traversalLayer: 1 });
    assert.equal(upperLayer.inWater, false);

    const rectangularWaterMap = createTerrainPatchMap(8, 8);
    rectangularWaterMap.terrainPolygons = [{
        type: "water",
        points: [
            { x: 0, y: 0 },
            { x: 4, y: 0 },
            { x: 4, y: 4 },
            { x: 0, y: 4 }
        ]
    }];
    const oneMeterImmersion = rectangularWaterMap.getGroundTerrainWaterImmersionAtPoint(1, 1);
    assert.equal(oneMeterImmersion.distanceToShore, 1);
    assert.equal(oneMeterImmersion.submergedDepth, 2 / 3);
});

test("water immersion ignores section boundary when water continues across it", () => {
    const rect = (minX, minY, maxX, maxY) => ({
        type: "water",
        points: [
            { x: minX, y: minY },
            { x: maxX, y: minY },
            { x: maxX, y: maxY },
            { x: minX, y: maxY }
        ]
    });
    const makeMap = (includeRightSection) => {
        const map = createTerrainPatchMap(4, 4);
        map.terrainPolygons = [];
        const leftAsset = {
            key: "left",
            terrainPolygons: [rect(0, 0, 1, 1)]
        };
        const entries = [["left", leftAsset]];
        if (includeRightSection) {
            entries.push(["right", {
                key: "right",
                terrainPolygons: [rect(1, 0, 2, 1)]
            }]);
        }
        map._prototypeSectionState = {
            sectionAssetsByKey: new NativeMap(entries),
            loadedSectionAssetKeys: new NativeSet(entries.map(([key]) => key))
        };
        return map;
    };

    const seamPointX = 0.95;
    const seamPointY = 0.5;
    const leftOnly = makeMap(false).getGroundTerrainWaterImmersionAtPoint(seamPointX, seamPointY);
    const continuous = makeMap(true).getGroundTerrainWaterImmersionAtPoint(seamPointX, seamPointY);

    assert.equal(leftOnly.inWater, true);
    assert.ok(Math.abs(leftOnly.distanceToShore - 0.05) < 1e-6);
    assert.equal(continuous.inWater, true);
    assert.ok(
        Math.abs(continuous.distanceToShore - 0.5) < 1e-6,
        `expected nearest true shore to be 0.5, got ${continuous.distanceToShore}`
    );
});

test("road over water acts as bridge collision depending on swim depth and jump state", () => {
    const map = createTerrainPatchMap(12, 12);
    map.terrainPolygons = [{
        type: "water",
        points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 }
        ]
    }];
    const bridgeRoad = {
        type: "roadPath",
        outlinePolygon: [
            { x: 4, y: 0 },
            { x: 6, y: 0 },
            { x: 6, y: 10 },
            { x: 4, y: 10 }
        ]
    };
    map.objects = [bridgeRoad];

    const deepSwimmer = { currentLayer: 0, _bridgeMovementState: null };
    const deepCollision = map.resolveGroundBridgeHitboxCollision(
        { type: "circle", x: 3.95, y: 5, radius: 0.2 },
        { actor: deepSwimmer }
    );
    assert.ok(deepCollision, "deep water swimmer should collide with bridge edge");
    assert.ok(deepCollision.pushX < 0, "deep water swimmer should be pushed away from the bridge");

    const shallowRoad = {
        type: "roadPath",
        outlinePolygon: [
            { x: 0.4, y: 0 },
            { x: 1.4, y: 0 },
            { x: 1.4, y: 10 },
            { x: 0.4, y: 10 }
        ]
    };
    map.terrainPolygons[0].maxDepth = 0.2;
    if (typeof map.invalidateGroundBridgeBarrierCache === "function") map.invalidateGroundBridgeBarrierCache();
    map.objects = [shallowRoad];
    const shallowCollision = map.resolveGroundBridgeHitboxCollision(
        { type: "circle", x: 0.35, y: 5, radius: 0.2 },
        { actor: { currentLayer: 0 } }
    );
    assert.equal(shallowCollision, null);

    const shallowActor = { currentLayer: 0 };
    const shallowState = map.applyActorBridgeMovementState(shallowActor, 0.5, 5);
    assert.equal(shallowState && shallowState.onBridge, true);

    delete map.terrainPolygons[0].maxDepth;
    if (typeof map.invalidateGroundBridgeBarrierCache === "function") map.invalidateGroundBridgeBarrierCache();
    map.objects = [bridgeRoad];
    const bridgeWalker = {
        currentLayer: 0,
        _bridgeMovementState: { onBridge: true, road: bridgeRoad }
    };
    const edgeCollision = map.resolveGroundBridgeHitboxCollision(
        { type: "circle", x: 4.1, y: 5, radius: 0.25 },
        { actor: bridgeWalker }
    );
    assert.ok(edgeCollision, "bridge walker should collide with bridge edge");
    assert.ok(edgeCollision.pushX > 0, "bridge walker should be pushed back onto the bridge");

    const walkedOffCollision = map.resolveGroundBridgeHitboxCollision(
        { type: "circle", x: 3.95, y: 5, radius: 0.25 },
        { actor: bridgeWalker }
    );
    assert.ok(walkedOffCollision, "bridge walker should be blocked after stepping over a bridge edge");
    assert.ok(walkedOffCollision.pushX > 0, "bridge walker past the edge should be pushed back onto the bridge");

    const walkedAcrossSegmentCollision = map.resolveGroundBridgeMovementSegmentCollision(
        4.5,
        5,
        3.5,
        5,
        0.25,
        { actor: bridgeWalker }
    );
    assert.ok(walkedAcrossSegmentCollision, "bridge walker should be blocked when crossing a bridge edge segment");
    assert.ok(walkedAcrossSegmentCollision.normalX > 0, "bridge walker crossing should be pushed back toward the bridge");

    const roadWalkerWithoutCachedState = { currentLayer: 0 };
    const roadPointSegmentCollision = map.resolveGroundBridgeMovementSegmentCollision(
        4.5,
        5,
        3.5,
        5,
        0.25,
        { actor: roadWalkerWithoutCachedState }
    );
    assert.ok(roadPointSegmentCollision, "road point over water should still be treated as bridge-side movement");
    assert.ok(roadPointSegmentCollision.normalX > 0, "road point crossing should be pushed back toward the bridge");

    const swamAcrossSegmentCollision = map.resolveGroundBridgeMovementSegmentCollision(
        3.5,
        5,
        4.5,
        5,
        0.25,
        { actor: deepSwimmer }
    );
    assert.ok(swamAcrossSegmentCollision, "deep water swimmer should be blocked when crossing onto a bridge segment");
    assert.ok(swamAcrossSegmentCollision.normalX < 0, "deep swimmer crossing should be pushed back into the water");

    bridgeWalker.isJumping = true;
    const jumpCollision = map.resolveGroundBridgeHitboxCollision(
        { type: "circle", x: 4.1, y: 5, radius: 0.25 },
        { actor: bridgeWalker }
    );
    assert.equal(jumpCollision, null);
    const jumpedAcrossSegmentCollision = map.resolveGroundBridgeMovementSegmentCollision(
        4.5,
        5,
        3.5,
        5,
        0.25,
        { actor: bridgeWalker }
    );
    assert.equal(jumpedAcrossSegmentCollision, null);
});

test("road path bridge collision uses section runtime road path registry", () => {
    const map = createTerrainPatchMap(12, 12);
    map.terrainPolygons = [{
        type: "water",
        points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 }
        ]
    }];
    map.objects = [];
    const runtimeRoadPath = {
        type: "roadPath",
        _prototypeRuntimeRecord: true,
        outlinePolygon: [
            { x: 4, y: 0 },
            { x: 6, y: 0 },
            { x: 6, y: 10 },
            { x: 4, y: 10 }
        ]
    };
    map._prototypeObjectState = {
        activeRuntimeObjectsByRecordId: new NativeMap([[42, runtimeRoadPath]]),
        activeRuntimeObjects: [runtimeRoadPath]
    };

    const roads = map.collectGroundBridgeRoadsInBounds({ minX: 3.7, minY: 4, maxX: 4.2, maxY: 6 });
    assert.equal(roads.length, 1);
    assert.equal(roads[0].road, runtimeRoadPath);

    const collision = map.resolveGroundBridgeHitboxCollision(
        { type: "circle", x: 3.95, y: 5, radius: 0.2 },
        { actor: { currentLayer: 0 } }
    );
    assert.ok(collision, "deep-water swimmer should collide with section runtime roadPath bridge");
});

test("terrain replacement path smoothing applies absolute terrain priority", () => {
    const map = createTerrainPatchMap();
    const center = map.nodes[4][4];
    const neighbor = center.neighbors[1];
    center.groundTextureId = map.getGroundTerrainTextureIdForType("water", center.xindex, center.yindex);
    neighbor.groundTextureId = map.getGroundTerrainTextureIdForType("water", neighbor.xindex, neighbor.yindex);
    const affectedNodes = map.collectGroundTerrainLocalPatchNodes(center);
    const vertexSlotsByPointKey = map.buildGroundTerrainVertexSlotMap({ nodes: affectedNodes });
    const group = map.buildGroundTerrainLocalSmoothingGroup("water", affectedNodes, vertexSlotsByPointKey);
    const candidatesByKey = new NativeMap();
    for (const node of affectedNodes) {
        for (const point of map.getGroundTerrainHexCorners(node)) {
            const key = map.getGroundTerrainPointKey(point);
            if (candidatesByKey.has(key)) continue;
            const slots = vertexSlotsByPointKey.get(key);
            if (!(slots instanceof NativeSet)) continue;
            let groupCount = 0;
            for (const slotKey of slots) {
                if (group.nodeKeys.has(slotKey)) groupCount += 1;
            }
            candidatesByKey.set(key, { point, nonGroupCount: 3 - groupCount });
        }
    }
    const skipCandidate = Array.from(candidatesByKey.values()).find(candidate => candidate.nonGroupCount === 1);
    const keepCandidate = Array.from(candidatesByKey.values()).find(candidate => candidate.nonGroupCount === 2);
    assert.ok(skipCandidate, "fixture should find a two-water/one-grass vertex");
    assert.ok(keepCandidate, "fixture should find a one-water/two-grass vertex");

    const smoothed = map.smoothGroundTerrainReplacementPathPoints([
        { x: skipCandidate.point.x - 0.25, y: skipCandidate.point.y - 0.25 },
        skipCandidate.point,
        keepCandidate.point,
        { x: keepCandidate.point.x + 0.25, y: keepCandidate.point.y + 0.25 }
    ], group, vertexSlotsByPointKey, affectedNodes, { isHole: false });

    assert.equal(smoothed.some(point => (
        Math.abs(point.x - skipCandidate.point.x) < 1e-7 &&
        Math.abs(point.y - skipCandidate.point.y) < 1e-7
    )), true);
    assert.equal(smoothed.some(point => (
        Math.abs(point.x - keepCandidate.point.x) < 1e-7 &&
        Math.abs(point.y - keepCandidate.point.y) < 1e-7
    )), false);

    const smoothedWithLegacySuppression = map.smoothGroundTerrainReplacementPathPoints([
        { x: skipCandidate.point.x - 0.25, y: skipCandidate.point.y - 0.25 },
        skipCandidate.point,
        keepCandidate.point,
        { x: keepCandidate.point.x + 0.25, y: keepCandidate.point.y + 0.25 }
    ], group, vertexSlotsByPointKey, affectedNodes, { isHole: false, suppressPriorityInversion: true });

    assert.deepEqual(smoothedWithLegacySuppression, smoothed);
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
    const expectedPolygons = map.buildGroundTerrainPolygonsFromNodes(
        waterNodes.concat([[12, 8]]).map(([x, y]) => map.nodes[x][y])
    );
    assert.deepEqual(
        canonicalTerrainPolygonsForType(map, map.terrainPolygons, "water"),
        canonicalTerrainPolygonsForType(map, expectedPolygons, "water")
    );
    assert.ok(map._terrainPaintDebugLastEdit.rawReplacementSegments.length > map._terrainPaintDebugLastEdit.modifiedSegments.length);
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
