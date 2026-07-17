const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const polygonClipping = require("polygon-clipping");

const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "docs", "terrain-failure-diagrams");

function loadGameMap() {
    const context = { console, polygonClipping };
    context.window = context;
    context.globalThis = context;
    vm.createContext(context);
    const source = fs.readFileSync(path.join(ROOT, "public/assets/javascript/Map.js"), "utf8");
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

function testPointInPolygon(x, y, points) {
    const ring = Array.isArray(points) ? points : [];
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = Number(ring[i] && ring[i].x);
        const yi = Number(ring[i] && ring[i].y);
        const xj = Number(ring[j] && ring[j].x);
        const yj = Number(ring[j] && ring[j].y);
        if (![xi, yi, xj, yj].every(Number.isFinite)) continue;
        if (((yi > y) !== (yj > y)) && x < (((xj - xi) * (y - yi)) / (yj - yi)) + xi) {
            inside = !inside;
        }
    }
    return inside;
}

function pointSegmentDistanceSq(px, py, ax, ay, bx, by) {
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

function ringCoversPointBoundary(points, x, y, eps = 1e-6) {
    const ring = Array.isArray(points) ? points : [];
    const epsSq = eps * eps;
    for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        if (pointSegmentDistanceSq(x, y, Number(a.x), Number(a.y), Number(b.x), Number(b.y)) <= epsSq) return true;
    }
    return false;
}

function terrainPolygonCoversPoint(map, polygon, x, y) {
    return map.terrainPolygonContainsPoint(polygon, x, y) ||
        ringCoversPointBoundary(polygon && polygon.points, x, y) ||
        (Array.isArray(polygon && polygon.holes) && polygon.holes.some(hole => ringCoversPointBoundary(hole, x, y)));
}

function polygonBounds(points) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const point of Array.isArray(points) ? points : []) {
        const x = Number(point && point.x);
        const y = Number(point && point.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
    }
    return { minX, minY, maxX, maxY };
}

function getSectionPolygonForNodes(map, nodes) {
    const points = [];
    for (const node of nodes) points.push(...map.getGroundTerrainHexCorners(node));
    const bounds = polygonBounds(points);
    return [
        { x: bounds.minX - 0.001, y: bounds.minY - 0.001 },
        { x: bounds.maxX + 0.001, y: bounds.minY - 0.001 },
        { x: bounds.maxX + 0.001, y: bounds.maxY + 0.001 },
        { x: bounds.minX - 0.001, y: bounds.maxY + 0.001 }
    ];
}

function clipTestTerrainPolygonToSection(map, polygon, sectionPolygon) {
    const polygonGeometry = map.groundTerrainPolygonToClipGeometry(polygon);
    const sectionGeometry = [[sectionPolygon.map(point => [Number(point.x), Number(point.y)])]];
    return map.groundTerrainClipGeometryToPolygons(
        polygon.type,
        polygonClipping.intersection(polygonGeometry, sectionGeometry)
    );
}

function getAllTerrainPatchMapBounds(map) {
    const points = [];
    for (let x = 0; x < map.width; x++) {
        for (let y = 0; y < map.height; y++) points.push(...map.getGroundTerrainHexCorners(map.nodes[x][y]));
    }
    const bounds = polygonBounds(points);
    return {
        minX: bounds.minX - 1,
        minY: bounds.minY - 1,
        maxX: bounds.maxX + 1,
        maxY: bounds.maxY + 1
    };
}

function createVerticalSplitSectionTerrainPatchFixture(width, height, boundaryX) {
    const map = createTerrainPatchMap(width, height);
    const sectionLeft = "left";
    const sectionRight = "right";
    const nodesBySectionKey = new NativeMap([[sectionLeft, []], [sectionRight, []]]);
    const allCornerPoints = [];
    for (let x = 0; x < map.width; x++) {
        for (let y = 0; y < map.height; y++) {
            const node = map.nodes[x][y];
            const key = Number(node.x) < boundaryX ? sectionLeft : sectionRight;
            node._prototypeSectionKey = key;
            nodesBySectionKey.get(key).push(node);
            allCornerPoints.push(...map.getGroundTerrainHexCorners(node));
        }
    }
    const bounds = polygonBounds(allCornerPoints);
    const sectionPolygonsByKey = new NativeMap([
        [sectionLeft, [
            { x: bounds.minX - 1, y: bounds.minY - 1 },
            { x: boundaryX, y: bounds.minY - 1 },
            { x: boundaryX, y: bounds.maxY + 1 },
            { x: bounds.minX - 1, y: bounds.maxY + 1 }
        ]],
        [sectionRight, [
            { x: boundaryX, y: bounds.minY - 1 },
            { x: bounds.maxX + 1, y: bounds.minY - 1 },
            { x: bounds.maxX + 1, y: bounds.maxY + 1 },
            { x: boundaryX, y: bounds.maxY + 1 }
        ]]
    ]);
    const makeAsset = (key) => {
        const nodes = nodesBySectionKey.get(key);
        return {
            key,
            tileCoordKeys: nodes.map(node => `${node.xindex},${node.yindex}`),
            groundTiles: {},
            terrainPolygons: [],
            sectionPolygon: sectionPolygonsByKey.get(key),
            _level0GroundSurfaceVersion: 0
        };
    };
    const assetsByKey = new NativeMap([[sectionLeft, makeAsset(sectionLeft)], [sectionRight, makeAsset(sectionRight)]]);
    map._prototypeSectionState = { nodesBySectionKey, sectionAssetsByKey: assetsByKey };
    map.getPrototypeSectionAsset = (key) => assetsByKey.get(key) || null;
    const paintCoords = (coords, terrainType) => {
        for (const [x, y] of coords) {
            const node = map.nodes[x] && map.nodes[x][y];
            if (!node || map.getGroundTerrainTypeForNode(node) === terrainType) continue;
            const sectionKey = node._prototypeSectionKey;
            map.replaceGroundTerrainPolygonPatch(node, terrainType, {
                asset: assetsByKey.get(sectionKey),
                sectionKey
            });
        }
    };
    const rawSectionPolygons = () => Array.from(assetsByKey.values()).flatMap(asset => asset.terrainPolygons);
    return { map, assetsByKey, paintCoords, rawSectionPolygons };
}

function createTerrainModelFixture(sectionMode = "none", width = 30, height = 24) {
    const map = createTerrainPatchMap(width, height);
    if (sectionMode === "none") {
        return {
            map,
            assetsByKey: new NativeMap(),
            paintNode(node, terrainType) {
                if (map.getGroundTerrainTypeForNode(node) === terrainType) return false;
                return map.replaceGroundTerrainPolygonPatch(node, terrainType);
            },
            rawPolygons() { return map.terrainPolygons; },
            logicalPolygons() { return map.terrainPolygons; }
        };
    }
    const bounds = getAllTerrainPatchMapBounds(map);
    const sectionPolygonsByKey = new NativeMap();
    const nodesBySectionKey = new NativeMap();
    const addSection = (key, polygon) => {
        sectionPolygonsByKey.set(key, polygon);
        nodesBySectionKey.set(key, []);
    };
    const boundaryX = map.nodes[Math.floor(width / 2)][0].x;
    const boundaryY = map.nodes[0][Math.floor(height / 2)].y;
    if (sectionMode === "one") {
        addSection("all", [
            { x: bounds.minX, y: bounds.minY },
            { x: bounds.maxX, y: bounds.minY },
            { x: bounds.maxX, y: bounds.maxY },
            { x: bounds.minX, y: bounds.maxY }
        ]);
    } else if (sectionMode === "two") {
        addSection("left", [
            { x: bounds.minX, y: bounds.minY },
            { x: boundaryX, y: bounds.minY },
            { x: boundaryX, y: bounds.maxY },
            { x: bounds.minX, y: bounds.maxY }
        ]);
        addSection("right", [
            { x: boundaryX, y: bounds.minY },
            { x: bounds.maxX, y: bounds.minY },
            { x: bounds.maxX, y: bounds.maxY },
            { x: boundaryX, y: bounds.maxY }
        ]);
    } else if (sectionMode === "three") {
        addSection("left", [
            { x: bounds.minX, y: bounds.minY },
            { x: boundaryX, y: bounds.minY },
            { x: boundaryX, y: bounds.maxY },
            { x: bounds.minX, y: bounds.maxY }
        ]);
        addSection("upper-right", [
            { x: boundaryX, y: bounds.minY },
            { x: bounds.maxX, y: bounds.minY },
            { x: bounds.maxX, y: boundaryY },
            { x: boundaryX, y: boundaryY }
        ]);
        addSection("lower-right", [
            { x: boundaryX, y: boundaryY },
            { x: bounds.maxX, y: boundaryY },
            { x: bounds.maxX, y: bounds.maxY },
            { x: boundaryX, y: bounds.maxY }
        ]);
    }
    const resolveSectionKey = (node) => {
        if (sectionMode === "one") return "all";
        if (sectionMode === "two") return Number(node.x) < boundaryX ? "left" : "right";
        if (Number(node.x) < boundaryX) return "left";
        return Number(node.y) < boundaryY ? "upper-right" : "lower-right";
    };
    for (let x = 0; x < map.width; x++) {
        for (let y = 0; y < map.height; y++) {
            const node = map.nodes[x][y];
            const sectionKey = resolveSectionKey(node);
            node._prototypeSectionKey = sectionKey;
            nodesBySectionKey.get(sectionKey).push(node);
        }
    }
    const makeAsset = (key) => {
        const nodes = nodesBySectionKey.get(key);
        return {
            key,
            tileCoordKeys: nodes.map(node => `${node.xindex},${node.yindex}`),
            groundTiles: {},
            terrainPolygons: [],
            sectionPolygon: sectionPolygonsByKey.get(key),
            _level0GroundSurfaceVersion: 0
        };
    };
    const assetsByKey = new NativeMap();
    for (const key of sectionPolygonsByKey.keys()) assetsByKey.set(key, makeAsset(key));
    map._prototypeSectionState = { nodesBySectionKey, sectionAssetsByKey: assetsByKey };
    map.getPrototypeSectionAsset = (key) => assetsByKey.get(key) || null;
    return {
        map,
        assetsByKey,
        paintNode(node, terrainType) {
            if (map.getGroundTerrainTypeForNode(node) === terrainType) return false;
            const sectionKey = node._prototypeSectionKey;
            return map.replaceGroundTerrainPolygonPatch(node, terrainType, {
                asset: assetsByKey.get(sectionKey),
                sectionKey
            });
        },
        rawPolygons() { return Array.from(assetsByKey.values()).flatMap(asset => asset.terrainPolygons); },
        logicalPolygons() { return map.mergeGroundTerrainPolygonsByType(this.rawPolygons()); }
    };
}

function rectTerrainEdits(x0, x1, y0, y1, terrainType) {
    const out = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([x, y, terrainType]);
    return out;
}

function lineTerrainEdits(coords, terrainType) {
    return coords.map(([x, y]) => [x, y, terrainType]);
}

function getTerrainModelStressEdits() {
    const waterLine = [];
    for (let x = 6; x <= 23; x++) waterLine.push([x, 10]);
    const desertLine = [];
    for (let x = 9; x <= 23; x++) desertLine.push([x, 6 + Math.floor((x - 9) / 2)]);
    const mudReturn = [];
    for (let x = 12; x <= 20; x++) mudReturn.push([x, 13 + (x % 2)]);
    return [
        ...rectTerrainEdits(8, 20, 7, 15, "mud"),
        ...lineTerrainEdits(waterLine, "water"),
        ...lineTerrainEdits(desertLine, "desert"),
        ...rectTerrainEdits(13, 17, 9, 12, "grass"),
        ...lineTerrainEdits(mudReturn, "mud"),
        ...lineTerrainEdits([[11, 8], [12, 8], [13, 8], [14, 8], [15, 8], [16, 8], [17, 8]], "water"),
        ...lineTerrainEdits([[18, 9], [18, 10], [18, 11], [18, 12], [18, 13], [18, 14]], "desert")
    ];
}

function getTerrainModelFinalLayoutEdits(order = ["mud", "water", "desert"]) {
    const finalByCoord = new NativeMap();
    const setRect = (x0, x1, y0, y1, terrainType) => {
        for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) finalByCoord.set(`${x},${y}`, terrainType);
    };
    setRect(8, 13, 7, 11, "mud");
    setRect(14, 18, 7, 11, "water");
    setRect(10, 18, 12, 15, "desert");
    setRect(13, 15, 10, 12, "grass");
    const out = [];
    for (const terrainType of order) {
        for (const [coordKey, finalType] of finalByCoord.entries()) {
            if (finalType !== terrainType) continue;
            const [x, y] = coordKey.split(",").map(Number);
            out.push([x, y, terrainType]);
        }
    }
    return out;
}

function paintTerrainModelEdits(fixture, edits, maxIndex = edits.length - 1) {
    for (let i = 0; i <= maxIndex && i < edits.length; i++) {
        const [x, y, terrainType] = edits[i];
        fixture.paintNode(fixture.map.nodes[x][y], terrainType);
    }
}

function collectSegments(polygons) {
    const out = [];
    for (const polygon of Array.isArray(polygons) ? polygons : []) {
        const rings = [polygon.points].concat(Array.isArray(polygon.holes) ? polygon.holes : []);
        for (const ring of rings) {
            for (let i = 0; i < ring.length; i++) out.push({ type: polygon.type, a: ring[i], b: ring[(i + 1) % ring.length] });
        }
    }
    return out;
}

function getRepairPoint(map, point) {
    const [x, y] = map.getGroundTerrainRepairPointKey(point).split(",").map(Number);
    const scale = Math.round(1 / map.getGroundTerrainVertexRepairEpsilon());
    return { x: x / scale, y: y / scale };
}

function segmentOverlap(map, a, b, c, d, eps = 1e-7) {
    const snappedA = getRepairPoint(map, a);
    const snappedB = getRepairPoint(map, b);
    const snappedC = getRepairPoint(map, c);
    const snappedD = getRepairPoint(map, d);
    const ax = snappedA.x, ay = snappedA.y, bx = snappedB.x, by = snappedB.y;
    const cx = snappedC.x, cy = snappedC.y, dx = snappedD.x, dy = snappedD.y;
    const abx = bx - ax;
    const aby = by - ay;
    const lenSq = abx * abx + aby * aby;
    if (lenSq <= eps * eps) return null;
    const crossC = abx * (cy - ay) - aby * (cx - ax);
    const crossD = abx * (dy - ay) - aby * (dx - ax);
    if (Math.abs(crossC) > eps || Math.abs(crossD) > eps) return null;
    const toT = (x, y) => ((x - ax) * abx + (y - ay) * aby) / lenSq;
    const t0 = toT(cx, cy);
    const t1 = toT(dx, dy);
    const start = Math.max(0, Math.min(t0, t1));
    const end = Math.min(1, Math.max(t0, t1));
    if (end - start <= eps) return null;
    return { a: { x: ax + abx * start, y: ay + aby * start }, b: { x: ax + abx * end, y: ay + aby * end } };
}

function collectSharedBoundarySegments(map, polygons, typeA, typeB) {
    const segments = collectSegments(polygons);
    const aSegments = segments.filter(segment => segment.type === typeA);
    const bSegments = segments.filter(segment => segment.type === typeB);
    const byKey = new NativeMap();
    for (const left of aSegments) {
        for (const right of bSegments) {
            const overlap = segmentOverlap(map, left.a, left.b, right.a, right.b);
            if (!overlap) continue;
            const keyA = map.getGroundTerrainRepairPointKey(overlap.a);
            const keyB = map.getGroundTerrainRepairPointKey(overlap.b);
            if (keyA === keyB) continue;
            const key = keyA < keyB ? `${keyA}:${keyB}` : `${keyB}:${keyA}`;
            if (!byKey.has(key)) byKey.set(key, overlap);
        }
    }
    return Array.from(byKey.values());
}

function segmentsTouchOrIntersect(a, b, c, d, eps = 1e-3) {
    const epsSq = eps * eps;
    return pointSegmentDistanceSq(Number(a.x), Number(a.y), Number(c.x), Number(c.y), Number(d.x), Number(d.y)) <= epsSq ||
        pointSegmentDistanceSq(Number(b.x), Number(b.y), Number(c.x), Number(c.y), Number(d.x), Number(d.y)) <= epsSq ||
        pointSegmentDistanceSq(Number(c.x), Number(c.y), Number(a.x), Number(a.y), Number(b.x), Number(b.y)) <= epsSq ||
        pointSegmentDistanceSq(Number(d.x), Number(d.y), Number(a.x), Number(a.y), Number(b.x), Number(b.y)) <= epsSq;
}

function collectMissingSharedBorders(map, polygons, nodes = null) {
    const scopeNodes = Array.isArray(nodes) ? nodes : [];
    const scopeKeys = new NativeSet(scopeNodes.map(node => map.getGroundTerrainNodeKey(node)));
    const shouldCheckNode = (node) => scopeKeys.size === 0 || scopeKeys.has(map.getGroundTerrainNodeKey(node));
    const dirs = [1, 3, 5, 7, 9, 11];
    const checkedEdges = new NativeSet();
    const sharedSegmentsByPair = new NativeMap();
    const getSharedSegments = (typeA, typeB) => {
        const pairKey = typeA < typeB ? `${typeA}:${typeB}` : `${typeB}:${typeA}`;
        if (!sharedSegmentsByPair.has(pairKey)) sharedSegmentsByPair.set(pairKey, collectSharedBoundarySegments(map, polygons, typeA, typeB));
        return sharedSegmentsByPair.get(pairKey);
    };
    const failures = [];
    for (let x = 0; x < map.width; x++) {
        for (let y = 0; y < map.height; y++) {
            const node = map.nodes[x] && map.nodes[x][y];
            if (!node || node._prototypeVoid === true || !shouldCheckNode(node)) continue;
            const nodeType = map.getGroundTerrainTypeForNode(node);
            if (nodeType === "grass") continue;
            for (const direction of dirs) {
                const neighbor = node.neighbors && node.neighbors[direction];
                if (!neighbor || neighbor._prototypeVoid === true) continue;
                const neighborType = map.getGroundTerrainTypeForNode(neighbor);
                if (neighborType === "grass" || neighborType === nodeType) continue;
                const nodeKey = map.getGroundTerrainNodeKey(node);
                const neighborKey = map.getGroundTerrainNodeKey(neighbor);
                const edgeKey = nodeKey < neighborKey ? `${nodeKey}:${neighborKey}` : `${neighborKey}:${nodeKey}`;
                if (checkedEdges.has(edgeKey)) continue;
                checkedEdges.add(edgeKey);
                const sharedSegments = getSharedSegments(nodeType, neighborType);
                const centerA = { x: Number(node.x), y: Number(node.y) };
                const centerB = { x: Number(neighbor.x), y: Number(neighbor.y) };
                const hasSharedBorder = sharedSegments.some(segment => segmentsTouchOrIntersect(centerA, centerB, segment.a, segment.b));
                if (!hasSharedBorder) failures.push({ label: `${nodeType}/${neighborType} ${edgeKey}`, node, neighbor, nodeType, neighborType });
            }
        }
    }
    return failures;
}

function collectCenterlineGaps(map, polygons, nodes) {
    const scope = Array.isArray(nodes) ? nodes : [];
    const scopeKeys = new NativeSet(scope.map(node => map.getGroundTerrainNodeKey(node)));
    const checkedEdges = new NativeSet();
    const dirs = [1, 3, 5, 7, 9, 11];
    const gaps = [];
    for (let x = 0; x < map.width; x++) {
        for (let y = 0; y < map.height; y++) {
            const node = map.nodes[x] && map.nodes[x][y];
            if (!node || node._prototypeVoid === true || (scopeKeys.size && !scopeKeys.has(map.getGroundTerrainNodeKey(node)))) continue;
            const nodeType = map.getGroundTerrainTypeForNode(node);
            if (nodeType === "grass") continue;
            for (const direction of dirs) {
                const neighbor = node.neighbors && node.neighbors[direction];
                if (!neighbor || neighbor._prototypeVoid === true) continue;
                const neighborType = map.getGroundTerrainTypeForNode(neighbor);
                if (neighborType === "grass" || neighborType === nodeType) continue;
                const edgeKey = [map.getGroundTerrainNodeKey(node), map.getGroundTerrainNodeKey(neighbor)].sort().join(":");
                if (checkedEdges.has(edgeKey)) continue;
                checkedEdges.add(edgeKey);
                for (let step = 1; step < 10; step++) {
                    const t = step / 10;
                    const px = Number(node.x) + ((Number(neighbor.x) - Number(node.x)) * t);
                    const py = Number(node.y) + ((Number(neighbor.y) - Number(node.y)) * t);
                    const covered = polygons.some(polygon => (
                        (polygon.type === nodeType || polygon.type === neighborType) &&
                        terrainPolygonCoversPoint(map, polygon, px, py)
                    ));
                    if (!covered) {
                        gaps.push({ label: `${nodeType}/${neighborType} ${edgeKey}`, node, neighbor, point: { x: px, y: py } });
                        break;
                    }
                }
            }
        }
    }
    return gaps;
}

function collectUncoveredNodes(map, polygons) {
    const out = [];
    for (let x = 0; x < map.width; x++) {
        for (let y = 0; y < map.height; y++) {
            const node = map.nodes[x] && map.nodes[x][y];
            if (!node || node._prototypeVoid === true) continue;
            const type = map.getGroundTerrainTypeForNode(node);
            if (type === "grass") continue;
            const covered = polygons.some(polygon => polygon.type === type && terrainPolygonCoversPoint(map, polygon, node.x, node.y));
            if (!covered) out.push({ node, type, label: `${type} ${x},${y}` });
        }
    }
    return out;
}

const colors = {
    grass: "#d9e7c6",
    water: "#4f9ed8",
    mud: "#7b5a43",
    desert: "#d6b45d"
};

function esc(value) {
    return String(value).replace(/[&<>"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[ch]));
}

function ringPoints(points) {
    return (Array.isArray(points) ? points : []).map(point => `${Number(point.x).toFixed(3)},${Number(point.y).toFixed(3)}`).join(" ");
}

function polygonPath(polygon) {
    const parts = [];
    const rings = [polygon.points].concat(Array.isArray(polygon.holes) ? polygon.holes : []);
    for (const ring of rings) {
        if (!Array.isArray(ring) || ring.length === 0) continue;
        parts.push(`M ${ring.map(point => `${Number(point.x).toFixed(3)} ${Number(point.y).toFixed(3)}`).join(" L ")} Z`);
    }
    return parts.join(" ");
}

function sceneBounds(map, polygons, highlights = []) {
    const points = [];
    for (let x = 0; x < map.width; x++) {
        for (let y = 0; y < map.height; y++) points.push(...map.getGroundTerrainHexCorners(map.nodes[x][y]));
    }
    for (const polygon of polygons || []) {
        points.push(...(polygon.points || []));
        for (const hole of polygon.holes || []) points.push(...hole);
    }
    for (const item of highlights) {
        if (item.node) points.push(...map.getGroundTerrainHexCorners(item.node));
        if (item.neighbor) points.push(...map.getGroundTerrainHexCorners(item.neighbor));
        if (item.point) points.push(item.point);
    }
    const bounds = polygonBounds(points);
    return {
        minX: bounds.minX - 0.8,
        minY: bounds.minY - 0.8,
        maxX: bounds.maxX + 0.8,
        maxY: bounds.maxY + 0.8
    };
}

function drawSceneContent(map, polygons, options = {}) {
    const bounds = options.bounds || sceneBounds(map, polygons, options.highlights || []);
    const sx = 1;
    const parts = [];
    parts.push(`<rect x="${bounds.minX}" y="${bounds.minY}" width="${bounds.maxX - bounds.minX}" height="${bounds.maxY - bounds.minY}" fill="#f8f7f2"/>`);
    for (let x = 0; x < map.width; x++) {
        for (let y = 0; y < map.height; y++) {
            const node = map.nodes[x][y];
            const corners = map.getGroundTerrainHexCorners(node);
            const type = map.getGroundTerrainTypeForNode(node);
            parts.push(`<polygon points="${ringPoints(corners)}" fill="${colors[type] || colors.grass}" fill-opacity="${type === "grass" ? "0.16" : "0.28"}" stroke="#9aa0a6" stroke-width="${0.018 * sx}"/>`);
        }
    }
    for (const section of options.sections || []) {
        parts.push(`<polygon points="${ringPoints(section.points)}" fill="none" stroke="#2f3a4a" stroke-width="${0.06 * sx}" stroke-dasharray="0.18 0.14"/>`);
        if (section.label) {
            const b = polygonBounds(section.points);
            parts.push(`<text x="${b.minX + 0.2}" y="${b.minY + 0.5}" font-size="0.45" fill="#2f3a4a">${esc(section.label)}</text>`);
        }
    }
    for (const polygon of polygons || []) {
        const color = colors[polygon.type] || "#999";
        parts.push(`<path d="${polygonPath(polygon)}" fill="${color}" fill-opacity="0.28" fill-rule="evenodd" stroke="${color}" stroke-width="${0.09 * sx}" stroke-linejoin="round"/>`);
    }
    for (const edge of options.missingEdges || []) {
        parts.push(`<line x1="${edge.node.x}" y1="${edge.node.y}" x2="${edge.neighbor.x}" y2="${edge.neighbor.y}" stroke="#e11d48" stroke-width="${0.16 * sx}" stroke-linecap="round"/>`);
        const mx = (Number(edge.node.x) + Number(edge.neighbor.x)) * 0.5;
        const my = (Number(edge.node.y) + Number(edge.neighbor.y)) * 0.5;
        parts.push(`<circle cx="${mx}" cy="${my}" r="0.18" fill="#e11d48"/>`);
    }
    for (const gap of options.gaps || []) {
        parts.push(`<line x1="${gap.node.x}" y1="${gap.node.y}" x2="${gap.neighbor.x}" y2="${gap.neighbor.y}" stroke="#ef4444" stroke-width="${0.13 * sx}" stroke-dasharray="0.18 0.12"/>`);
        parts.push(`<circle cx="${gap.point.x}" cy="${gap.point.y}" r="0.18" fill="#ef4444"/>`);
    }
    for (const marker of options.markers || []) {
        if (marker.node) {
            parts.push(`<polygon points="${ringPoints(map.getGroundTerrainHexCorners(marker.node))}" fill="${marker.fill || "none"}" fill-opacity="0.25" stroke="${marker.stroke || "#111827"}" stroke-width="${0.14 * sx}"/>`);
            parts.push(`<text x="${Number(marker.node.x) + 0.12}" y="${Number(marker.node.y) - 0.18}" font-size="0.42" fill="${marker.stroke || "#111827"}">${esc(marker.label || "")}</text>`);
        } else if (marker.point) {
            parts.push(`<circle cx="${marker.point.x}" cy="${marker.point.y}" r="0.22" fill="${marker.fill || "#111827"}"/>`);
            parts.push(`<text x="${Number(marker.point.x) + 0.18}" y="${Number(marker.point.y) - 0.18}" font-size="0.42" fill="${marker.fill || "#111827"}">${esc(marker.label || "")}</text>`);
        }
    }
    return parts.join("\n");
}

function writeSceneSvg(filename, title, map, polygons, options = {}) {
    const bounds = options.bounds || sceneBounds(map, polygons, [
        ...(options.missingEdges || []),
        ...(options.gaps || []),
        ...(options.markers || [])
    ]);
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bounds.minX} ${bounds.minY - 1.2} ${width} ${height + 1.2}" width="${Math.round(width * 38)}" height="${Math.round((height + 1.2) * 38)}">
<style>text{font-family:Arial,sans-serif;font-weight:600}.caption{font-size:0.52px;fill:#111827}</style>
<text x="${bounds.minX}" y="${bounds.minY - 0.35}" class="caption">${esc(title)}</text>
${drawSceneContent(map, polygons, { ...options, bounds })}
</svg>
`;
    fs.writeFileSync(path.join(OUT_DIR, filename), svg);
}

function writeTwoPanelSvg(filename, title, left, right) {
    const leftBounds = sceneBounds(left.map, left.polygons, left.markers || []);
    const rightBounds = sceneBounds(right.map, right.polygons, right.markers || []);
    const panelW = Math.max(leftBounds.maxX - leftBounds.minX, rightBounds.maxX - rightBounds.minX);
    const panelH = Math.max(leftBounds.maxY - leftBounds.minY, rightBounds.maxY - rightBounds.minY);
    const gap = 2;
    const view = { minX: 0, minY: -1.2, maxX: (panelW * 2) + gap, maxY: panelH + 0.8 };
    const leftTransform = `translate(${-leftBounds.minX}, ${-leftBounds.minY})`;
    const rightTransform = `translate(${panelW + gap - rightBounds.minX}, ${-rightBounds.minY})`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${view.minX} ${view.minY} ${view.maxX} ${view.maxY - view.minY}" width="${Math.round(view.maxX * 38)}" height="${Math.round((view.maxY - view.minY) * 38)}">
<style>text{font-family:Arial,sans-serif;font-weight:600}.caption{font-size:0.52px;fill:#111827}</style>
<text x="0" y="-0.35" class="caption">${esc(title)}</text>
<text x="0" y="0.35" class="caption">${esc(left.label)}</text>
<text x="${panelW + gap}" y="0.35" class="caption">${esc(right.label)}</text>
<g transform="${leftTransform}">${drawSceneContent(left.map, left.polygons, left)}</g>
<g transform="${rightTransform}">${drawSceneContent(right.map, right.polygons, right)}</g>
</svg>
`;
    fs.writeFileSync(path.join(OUT_DIR, filename), svg);
}

function buildThreeSectionNonCanon() {
    const map = createTerrainPatchMap(26, 20);
    const sectionLeft = "left";
    const sectionRight = "right";
    const sectionUpper = "upper";
    const diagTop = { x: 9, y: -1 };
    const diagBottom = { x: 13.4, y: 21 };
    const horizontalY = 5.5;
    const sectionPolygonsByKey = new NativeMap([
        [sectionLeft, [{ x: -1, y: horizontalY }, diagTop, diagBottom, { x: -1, y: 21 }]],
        [sectionRight, [diagTop, { x: 24, y: -1 }, { x: 24, y: 21 }, diagBottom]],
        [sectionUpper, [{ x: -1, y: -1 }, diagTop, { x: -1, y: horizontalY }]]
    ]);
    const nodesBySectionKey = new NativeMap([[sectionLeft, []], [sectionRight, []], [sectionUpper, []]]);
    const sectionSide = (point) => ((diagBottom.x - diagTop.x) * (Number(point.y) - diagTop.y)) -
        ((diagBottom.y - diagTop.y) * (Number(point.x) - diagTop.x));
    for (let x = 0; x < map.width; x++) {
        for (let y = 0; y < map.height; y++) {
            const node = map.nodes[x][y];
            const key = node.y < horizontalY && sectionSide(node) > 0
                ? sectionUpper
                : (sectionSide(node) <= 0 ? sectionRight : sectionLeft);
            node._prototypeSectionKey = key;
            nodesBySectionKey.get(key).push(node);
        }
    }
    const makeAsset = (key) => {
        const nodes = nodesBySectionKey.get(key);
        return {
            key,
            tileCoordKeys: nodes.map(node => `${node.xindex},${node.yindex}`),
            groundTiles: {},
            terrainPolygons: [],
            sectionPolygon: sectionPolygonsByKey.get(key),
            _level0GroundSurfaceVersion: 0
        };
    };
    const assetsByKey = new NativeMap([[sectionLeft, makeAsset(sectionLeft)], [sectionRight, makeAsset(sectionRight)], [sectionUpper, makeAsset(sectionUpper)]]);
    map._prototypeSectionState = { nodesBySectionKey, sectionAssetsByKey: assetsByKey };
    map.getPrototypeSectionAsset = (key) => assetsByKey.get(key) || null;
    const shore = [
        { x: 15.9, y: 0 }, { x: 15.2, y: 2.0 }, { x: 14.5, y: 3.8 }, { x: 13.7, y: 5.2 },
        { x: 13.0, y: 7.0 }, { x: 12.0, y: 8.0 }, { x: 11.1, y: 9.0 }, { x: 10.6, y: 10.4 },
        { x: 9.7, y: 11.8 }, { x: 8.9, y: 13.2 }, { x: 8.3, y: 15.0 }, { x: 7.5, y: 18.8 }
    ];
    const authoredWater = { type: "water", points: [{ x: 24, y: -1 }, { x: 24, y: 21 }, shore[shore.length - 1], ...shore.slice().reverse(), shore[0]] };
    const authoredMud = {
        type: "mud",
        points: [...shore, { x: 6.5, y: 20.5 }, { x: 4, y: 17 }, { x: 5.2, y: 14.8 }, { x: 6.2, y: 12 }, { x: 7.5, y: 9 }, { x: 8, y: 7 }, { x: 8.7, y: 4 }, { x: 9.6, y: 1 }, { x: 11, y: -1 }, shore[0]]
    };
    for (const [key, asset] of assetsByKey.entries()) {
        asset.terrainPolygons = [
            ...clipTestTerrainPolygonToSection(map, authoredWater, sectionPolygonsByKey.get(key)),
            ...clipTestTerrainPolygonToSection(map, authoredMud, sectionPolygonsByKey.get(key))
        ];
    }
    const waterId = map.getGroundTerrainTextureIdForType("water", 0, 0);
    const mudId = map.getGroundTerrainTextureIdForType("mud", 0, 0);
    const grassId = map.getGroundTerrainTextureIdForType("grass", 0, 0);
    for (let x = 0; x < map.width; x++) {
        for (let y = 0; y < map.height; y++) {
            const node = map.nodes[x][y];
            node.groundTextureId = testPointInPolygon(node.x, node.y, authoredWater.points)
                ? waterId
                : (testPointInPolygon(node.x, node.y, authoredMud.points) ? mudId : grassId);
        }
    }
    const edited = map.nodes[13][10];
    map.replaceGroundTerrainPolygonPatch(edited, "mud", { asset: assetsByKey.get(sectionRight), sectionKey: sectionRight });
    const rawPolygons = () => Array.from(assetsByKey.values()).flatMap(asset => asset.terrainPolygons);
    return {
        map,
        assetsByKey,
        rawPolygons,
        edited,
        sections: Array.from(sectionPolygonsByKey.entries()).map(([label, points]) => ({ label, points }))
    };
}

function buildStaleGrassSectionCase() {
    const fixture = createVerticalSplitSectionTerrainPatchFixture(26, 20, 10);
    const map = fixture.map;
    const authoredWater = {
        type: "water",
        points: [{ x: -1.0, y: -1.0 }, { x: 18.5, y: -1.0 }, { x: 17.6, y: 3.2 }, { x: 14.1, y: 5.2 }, { x: 10.5, y: 7.0 }, { x: 6.4, y: 9.4 }, { x: 1.4, y: 11.8 }, { x: -1.0, y: 12.8 }]
    };
    const authoredMud = {
        type: "mud",
        points: [{ x: 17.6, y: 3.2 }, { x: 19.4, y: 5.0 }, { x: 16.8, y: 7.0 }, { x: 12.9, y: 9.1 }, { x: 8.8, y: 11.4 }, { x: 3.5, y: 14.0 }, { x: -1.0, y: 16.4 }, { x: -1.0, y: 12.8 }, { x: 1.4, y: 11.8 }, { x: 6.4, y: 9.4 }, { x: 10.5, y: 7.0 }, { x: 14.1, y: 5.2 }]
    };
    for (const asset of fixture.assetsByKey.values()) {
        asset.terrainPolygons = [
            ...clipTestTerrainPolygonToSection(map, authoredWater, asset.sectionPolygon),
            ...clipTestTerrainPolygonToSection(map, authoredMud, asset.sectionPolygon)
        ];
    }
    const grassId = map.getGroundTerrainTextureIdForType("grass", 0, 0);
    for (let x = 0; x < map.width; x++) for (let y = 0; y < map.height; y++) map.nodes[x][y].groundTextureId = grassId;
    const dirs = [1, 3, 5, 7, 9, 11];
    let edited = null;
    let preservedWaterNode = null;
    for (let x = 0; x < map.width && !edited; x++) {
        for (let y = 0; y < map.height && !edited; y++) {
            const node = map.nodes[x][y];
            if (node._prototypeSectionKey !== "right") continue;
            if (!testPointInPolygon(node.x, node.y, authoredMud.points)) continue;
            const waterNeighbor = dirs.map(direction => node.neighbors && node.neighbors[direction])
                .find(neighbor => neighbor && testPointInPolygon(neighbor.x, neighbor.y, authoredWater.points));
            if (!waterNeighbor) continue;
            edited = node;
            preservedWaterNode = waterNeighbor;
        }
    }
    map.replaceGroundTerrainPolygonPatch(edited, "water", {
        asset: fixture.assetsByKey.get(edited._prototypeSectionKey),
        sectionKey: edited._prototypeSectionKey
    });
    return { ...fixture, edited, preservedWaterNode, worldPolygons: () => map.mergeGroundTerrainPolygonsByType(fixture.rawSectionPolygons()) };
}

function buildSectionWaterLineCase() {
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
                fixture.map.replaceGroundTerrainPolygonPatch(node, terrainType, {
                    asset: fixture.asset,
                    sectionKey: fixture.sectionKey
                });
            }
        }
    };
    const waterLineCoords = [[8, 14], [9, 14], [10, 14], [11, 14], [12, 14], [13, 14], [14, 14], [15, 14], [16, 14], [17, 14], [18, 14], [19, 14], [20, 14], [21, 14], [22, 14], [23, 14]];
    const cutCoords = [[14, 13], [15, 13], [14, 14], [15, 14], [16, 14], [15, 15], [16, 15]];
    const cutCoordKeys = new NativeSet(cutCoords.map(([x, y]) => `${x},${y}`));
    const cutFixture = makeSectionMap();
    const separatedFixture = makeSectionMap();
    paintCoords(cutFixture, waterLineCoords, "water");
    paintCoords(cutFixture, cutCoords, "grass");
    paintCoords(separatedFixture, waterLineCoords.filter(([x, y]) => !cutCoordKeys.has(`${x},${y}`)), "water");
    return { cutFixture, separatedFixture, cutCoords };
}

function writeAll() {
    fs.mkdirSync(OUT_DIR, { recursive: true });

    const three = buildThreeSectionNonCanon();
    const threeGaps = collectCenterlineGaps(three.map, three.rawPolygons(), three.map.collectGroundTerrainLocalPatchNodes(three.edited));
    writeSceneSvg("01-three-section-noncanon-shore.svg", "Three-section non-canon shore: red marks centerline gaps after 13,10 -> mud", three.map, three.rawPolygons(), {
        sections: three.sections,
        gaps: threeGaps,
        markers: [{ node: three.edited, label: "edit", stroke: "#111827", fill: "#fbbf24" }]
    });

    const stress = createTerrainModelFixture("three");
    paintTerrainModelEdits(stress, getTerrainModelStressEdits(), 120);
    const stressMissing = collectMissingSharedBorders(stress.map, stress.rawPolygons());
    writeSceneSvg("02-terrain-model-stress-edit-120.svg", "Terrain model stress after edit 120 (9,10 -> water): missing raw shared borders in red", stress.map, stress.rawPolygons(), {
        missingEdges: stressMissing,
        markers: [{ node: stress.map.nodes[9][10], label: "edit 120", stroke: "#111827", fill: "#fbbf24" }]
    });

    const none = createTerrainModelFixture("none");
    paintTerrainModelEdits(none, getTerrainModelFinalLayoutEdits());
    const uncovered = collectUncoveredNodes(none.map, none.rawPolygons());
    writeSceneSvg("03-terrain-model-partition-none-coverage.svg", "Terrain model final layout without sections: uncovered non-grass tile centers in red", none.map, none.rawPolygons(), {
        markers: uncovered.map(item => ({ node: item.node, label: item.label, stroke: "#e11d48", fill: "#e11d48" }))
    });

    const finalThree = createTerrainModelFixture("three");
    paintTerrainModelEdits(finalThree, getTerrainModelFinalLayoutEdits());
    const finalMissing = collectMissingSharedBorders(finalThree.map, finalThree.rawPolygons());
    writeSceneSvg("04-terrain-model-three-final-raw-border.svg", "Three-section final layout: neighboring non-grass tiles missing raw shared polygon borders", finalThree.map, finalThree.rawPolygons(), {
        missingEdges: finalMissing
    });

    const orderFixture = createTerrainModelFixture("three");
    paintTerrainModelEdits(orderFixture, getTerrainModelFinalLayoutEdits(["mud", "water", "desert"]));
    const orderMissing = collectMissingSharedBorders(orderFixture.map, orderFixture.rawPolygons());
    writeSceneSvg("05-terrain-model-edit-order-mud-water-desert.svg", "Edit order mud/water/desert: same final tiles, missing raw shared border in red", orderFixture.map, orderFixture.rawPolygons(), {
        missingEdges: orderMissing
    });

    const stale = buildStaleGrassSectionCase();
    const staleType = stale.map.getGroundTerrainPolygonTypeAtPoint(stale.preservedWaterNode.x, stale.preservedWaterNode.y, stale.worldPolygons());
    writeSceneSvg("06-stale-grass-authored-water.svg", `Stale grass section edit: preserved authored-water point now resolves as ${staleType}`, stale.map, stale.worldPolygons(), {
        sections: Array.from(stale.assetsByKey.values()).map(asset => ({ label: asset.key, points: asset.sectionPolygon })),
        markers: [
            { node: stale.edited, label: "edit", stroke: "#111827", fill: "#fbbf24" },
            { node: stale.preservedWaterNode, label: `should stay water, got ${staleType}`, stroke: "#e11d48", fill: "#e11d48" }
        ]
    });

    const waterLine = buildSectionWaterLineCase();
    writeTwoPanelSvg("07-section-water-line-cut-vs-separated.svg", "Section water line cut across middle: actual cut result vs separated-paint result", {
        label: "Cut existing line, then erase middle",
        map: waterLine.cutFixture.map,
        polygons: waterLine.cutFixture.asset.terrainPolygons,
        markers: waterLine.cutCoords.map(([x, y]) => ({ node: waterLine.cutFixture.map.nodes[x][y], label: "", stroke: "#e11d48", fill: "#e11d48" }))
    }, {
        label: "Paint separated segments directly",
        map: waterLine.separatedFixture.map,
        polygons: waterLine.separatedFixture.asset.terrainPolygons,
        markers: []
    });

    const readme = `# Terrain Failure Diagrams

Generated by \`node scripts/generate-terrain-failure-diagrams.js\`.

These diagrams use the current \`GameMap\` terrain geometry code and SVG drawing, not WebGL. Tile fills show the current tile terrain values; translucent polygon overlays show stored terrain polygons. Red lines or marks identify the observed failing edge, gap, or stale point.

## 01-three-section-noncanon-shore.svg

Test: \`three-section local edit preserves raw section borders on non-canon shore\`

After painting node \`13,10\` from water to mud in the right section, the raw section polygons remain non-crossing, but water/mud adjacent tile centerlines near \`12,8:13,9\`, \`13,8:13,9\`, and \`13,10:13,9\` pass through uncovered space. The dashed outlines are the three section polygons.

## 02-terrain-model-stress-edit-120.svg

Test: \`terrain model three-section multi-terrain stress preserves raw shared borders after every edit\`

This reproduces the stress fixture through edit 120, \`9,10 -> water\`. Red marks show the adjacent water/mud pair \`7,10:8,10\` whose tile values touch but whose raw section polygons do not share a border segment.

## 03-terrain-model-partition-none-coverage.svg

Test: \`terrain model section partitions do not change final logical terrain boundaries\`

This shows the unpartitioned final-layout fixture. Red marked tiles are non-grass tile centers that are not covered by a same-type terrain polygon. In the current run this exposes the mud coverage failure around \`13,9\`.

## 04-terrain-model-three-final-raw-border.svg

Test: \`terrain model every neighboring non-grass terrain pair has a raw shared polygon border\`

This is the three-section final-layout fixture. Red marks show adjacent non-grass tile pairs, currently water/desert around \`16,10:16,11\`, whose raw section polygons fail to share a boundary.

## 05-terrain-model-edit-order-mud-water-desert.svg

Test: \`terrain model edit order does not change shared boundaries for the same final layout\`

This uses the \`mud/water/desert\` edit order. The final tile grid matches the intended layout, but the same water/desert raw-border gap appears, so edit order still changes the polygon-boundary result.

## 06-stale-grass-authored-water.svg

Test: \`section local edit preserves non-canon polygon terrain over stale grass tiles\`

The tile grid is intentionally stale grass while authored polygons already cover water and mud. The red marked neighbor starts inside authored water, but after the local edit the merged world polygons resolve it as grass. That is the exposed authored-water regression.

## 07-section-water-line-cut-vs-separated.svg

Test: \`section water line cut across the middle matches painting separated segments\`

The left panel paints a water line and then erases the middle. The right panel paints the separated water segments directly. They should produce the same section water polygons, but the left result has an extra small fragment and a shortened first segment.
`;
    fs.writeFileSync(path.join(OUT_DIR, "README.md"), readme);
}

writeAll();
console.log(`Wrote terrain failure diagrams to ${OUT_DIR}`);
