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

test("terrain local patch keeps base grass dominant when closing a tiny water ring", () => {
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

test("terrain replacement path smoothing lets base grass take priority over water", () => {
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
