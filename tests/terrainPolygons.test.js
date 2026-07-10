const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const polygonClipping = require("polygon-clipping");

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

function markWaterNodesInsidePolygon(map, polygon) {
    for (let x = 0; x < map.width; x++) {
        for (let y = 0; y < map.height; y++) {
            const node = map.nodes[x][y];
            if (!node || !testPointInPolygon(node.x, node.y, polygon.points)) continue;
            node.groundTextureId = map.getGroundTerrainTextureIdForType("water", x, y);
        }
    }
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

function testSegmentsProperlyIntersect(a, b, c, d) {
    if (!a || !b || !c || !d) return false;
    const ax = Number(a.x);
    const ay = Number(a.y);
    const bx = Number(b.x);
    const by = Number(b.y);
    const cx = Number(c.x);
    const cy = Number(c.y);
    const dx = Number(d.x);
    const dy = Number(d.y);
    if (![ax, ay, bx, by, cx, cy, dx, dy].every(Number.isFinite)) return false;
    const orient = (px, py, qx, qy, rx, ry) => ((qx - px) * (ry - py)) - ((qy - py) * (rx - px));
    const o1 = orient(ax, ay, bx, by, cx, cy);
    const o2 = orient(ax, ay, bx, by, dx, dy);
    const o3 = orient(cx, cy, dx, dy, ax, ay);
    const o4 = orient(cx, cy, dx, dy, bx, by);
    return o1 * o2 < -1e-9 && o3 * o4 < -1e-9;
}

function collectTestTerrainPolygonSegments(polygons) {
    const out = [];
    const source = Array.isArray(polygons) ? polygons : [];
    for (let p = 0; p < source.length; p++) {
        const polygon = source[p];
        if (!polygon) continue;
        const rings = [polygon.points].concat(Array.isArray(polygon.holes) ? polygon.holes : []);
        for (let r = 0; r < rings.length; r++) {
            const ring = Array.isArray(rings[r]) ? rings[r] : [];
            for (let i = 0; i < ring.length; i++) {
                out.push({
                    polygonIndex: p,
                    ringIndex: r,
                    pointIndex: i,
                    ringLength: ring.length,
                    type: polygon.type,
                    a: ring[i],
                    b: ring[(i + 1) % ring.length]
                });
            }
        }
    }
    return out;
}

function testSegmentsAreAdjacent(a, b) {
    if (!a || !b || a.polygonIndex !== b.polygonIndex || a.ringIndex !== b.ringIndex) return false;
    const diff = Math.abs(a.pointIndex - b.pointIndex);
    return diff === 1 || diff === Math.max(0, a.ringLength - 1);
}

function assertTerrainPolygonsHaveNoProperSegmentCrossings(polygons, label) {
    const segments = collectTestTerrainPolygonSegments(polygons);
    const crossings = [];
    for (let a = 0; a < segments.length; a++) {
        for (let b = a + 1; b < segments.length; b++) {
            if (testSegmentsAreAdjacent(segments[a], segments[b])) continue;
            if (!testSegmentsProperlyIntersect(segments[a].a, segments[a].b, segments[b].a, segments[b].b)) continue;
            crossings.push(`${segments[a].type}[${segments[a].polygonIndex}:${segments[a].pointIndex}] x ${segments[b].type}[${segments[b].polygonIndex}:${segments[b].pointIndex}]`);
        }
    }
    assert.deepEqual(crossings, [], label);
}

function getTestRingSignedArea(points) {
    const ring = Array.isArray(points) ? points : [];
    if (ring.length < 3) return 0;
    let area = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        area += (Number(ring[j].x) * Number(ring[i].y)) - (Number(ring[i].x) * Number(ring[j].y));
    }
    return area * 0.5;
}

function assertTerrainAlphaBlendRingPreflight(points, label, amount = 0.08) {
    const ring = Array.isArray(points) ? points : [];
    assert.ok(ring.length >= 3, `${label}: terrain alpha blend requires at least three points`);
    for (let i = 0; i < ring.length; i++) {
        assert.ok(
            Number.isFinite(Number(ring[i] && ring[i].x)) &&
            Number.isFinite(Number(ring[i] && ring[i].y)),
            `${label}: terrain alpha blend ring contains a non-finite point`
        );
    }
    const signedArea = getTestRingSignedArea(ring);
    assert.ok(
        Number.isFinite(signedArea) && Math.abs(signedArea) > 1e-9,
        `${label}: terrain alpha blend requires a non-degenerate polygon ring`
    );
    const outwardSign = signedArea >= 0 ? 1 : -1;
    const edgeNormal = (a, b) => {
        const dx = Number(b.x) - Number(a.x);
        const dy = Number(b.y) - Number(a.y);
        const length = Math.hypot(dx, dy);
        assert.ok(length > 1e-9, `${label}: terrain alpha blend cannot offset a polygon ring with zero-length edges`);
        return {
            x: outwardSign * dy / length,
            y: -outwardSign * dx / length
        };
    };
    const intersectLines = (p1, p2, p3, p4) => {
        const x1 = Number(p1.x);
        const y1 = Number(p1.y);
        const x2 = Number(p2.x);
        const y2 = Number(p2.y);
        const x3 = Number(p3.x);
        const y3 = Number(p3.y);
        const x4 = Number(p4.x);
        const y4 = Number(p4.y);
        const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
        if (Math.abs(den) <= 1e-9) return null;
        const det12 = x1 * y2 - y1 * x2;
        const det34 = x3 * y4 - y3 * x4;
        return {
            x: (det12 * (x3 - x4) - (x1 - x2) * det34) / den,
            y: (det12 * (y3 - y4) - (y1 - y2) * det34) / den
        };
    };
    const distance = Number(amount);
    const maxMiter = Math.max(Math.abs(distance) * 6, Math.abs(distance) + 0.001);
    for (let i = 0; i < ring.length; i++) {
        const prev = ring[(i + ring.length - 1) % ring.length];
        const cur = ring[i];
        const next = ring[(i + 1) % ring.length];
        const prevNormal = edgeNormal(prev, cur);
        const nextNormal = edgeNormal(cur, next);
        const prevA = { x: prev.x + prevNormal.x * distance, y: prev.y + prevNormal.y * distance };
        const prevB = { x: cur.x + prevNormal.x * distance, y: cur.y + prevNormal.y * distance };
        const nextA = { x: cur.x + nextNormal.x * distance, y: cur.y + nextNormal.y * distance };
        const nextB = { x: next.x + nextNormal.x * distance, y: next.y + nextNormal.y * distance };
        let point = intersectLines(prevA, prevB, nextA, nextB);
        if (!point) {
            const nx = prevNormal.x + nextNormal.x;
            const ny = prevNormal.y + nextNormal.y;
            const length = Math.hypot(nx, ny);
            point = length > 1e-9
                ? { x: cur.x + (nx / length) * distance, y: cur.y + (ny / length) * distance }
                : { x: cur.x + nextNormal.x * distance, y: cur.y + nextNormal.y * distance };
        }
        const dx = point.x - cur.x;
        const dy = point.y - cur.y;
        const miterLength = Math.hypot(dx, dy);
        if (miterLength > maxMiter) {
            point = {
                x: cur.x + (dx / miterLength) * maxMiter,
                y: cur.y + (dy / miterLength) * maxMiter
            };
        }
        assert.ok(
            Number.isFinite(point.x) && Number.isFinite(point.y),
            `${label}: terrain alpha blend produced a non-finite offset vertex`
        );
    }
}

function assertTerrainPolygonsPassRendererPreflight(polygons, label) {
    const source = Array.isArray(polygons) ? polygons : [];
    for (let p = 0; p < source.length; p++) {
        const polygon = source[p];
        assertTerrainAlphaBlendRingPreflight(polygon && polygon.points, `${label}: ${polygon && polygon.type}[${p}] outer`);
        const holes = Array.isArray(polygon && polygon.holes) ? polygon.holes : [];
        for (let h = 0; h < holes.length; h++) {
            assertTerrainAlphaBlendRingPreflight(holes[h], `${label}: ${polygon && polygon.type}[${p}] hole ${h}`, -0.08);
        }
    }
}

function getTestRepairPoint(map, point) {
    const key = map.getGroundTerrainRepairPointKey(point);
    const [x, y] = key.split(",").map(Number);
    const scale = Math.round(1 / map.getGroundTerrainVertexRepairEpsilon());
    return { x: x / scale, y: y / scale };
}

function getTestSegmentOverlap(map, a, b, c, d, eps = 1e-7) {
    if (!a || !b || !c || !d) return null;
    const snappedA = getTestRepairPoint(map, a);
    const snappedB = getTestRepairPoint(map, b);
    const snappedC = getTestRepairPoint(map, c);
    const snappedD = getTestRepairPoint(map, d);
    const ax = Number(snappedA.x);
    const ay = Number(snappedA.y);
    const bx = Number(snappedB.x);
    const by = Number(snappedB.y);
    const cx = Number(snappedC.x);
    const cy = Number(snappedC.y);
    const dx = Number(snappedD.x);
    const dy = Number(snappedD.y);
    if (![ax, ay, bx, by, cx, cy, dx, dy].every(Number.isFinite)) return null;
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
    return {
        a: { x: ax + abx * start, y: ay + aby * start },
        b: { x: ax + abx * end, y: ay + aby * end }
    };
}

function collectTerrainPairSharedBoundarySegments(map, polygons, typeA, typeB) {
    const segments = collectTestTerrainPolygonSegments(polygons);
    const aSegments = segments.filter(segment => segment.type === typeA);
    const bSegments = segments.filter(segment => segment.type === typeB);
    const byKey = new NativeMap();
    for (let a = 0; a < aSegments.length; a++) {
        for (let b = 0; b < bSegments.length; b++) {
            const overlap = getTestSegmentOverlap(
                map,
                aSegments[a].a,
                aSegments[a].b,
                bSegments[b].a,
                bSegments[b].b
            );
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

function testSegmentsTouchOrIntersect(a, b, c, d, eps = 1e-3) {
    if (testSegmentsProperlyIntersect(a, b, c, d)) return true;
    const epsSq = eps * eps;
    const ax = Number(a && a.x);
    const ay = Number(a && a.y);
    const bx = Number(b && b.x);
    const by = Number(b && b.y);
    const cx = Number(c && c.x);
    const cy = Number(c && c.y);
    const dx = Number(d && d.x);
    const dy = Number(d && d.y);
    if (![ax, ay, bx, by, cx, cy, dx, dy].every(Number.isFinite)) return false;
    return testPointSegmentDistanceSq(ax, ay, cx, cy, dx, dy) <= epsSq ||
        testPointSegmentDistanceSq(bx, by, cx, cy, dx, dy) <= epsSq ||
        testPointSegmentDistanceSq(cx, cy, ax, ay, bx, by) <= epsSq ||
        testPointSegmentDistanceSq(dx, dy, ax, ay, bx, by) <= epsSq;
}

function assertAllAdjacentNonGrassTerrainPairsSharePolygonBorders(map, polygons, label, nodes = null) {
    const scopeNodes = Array.isArray(nodes) ? nodes : [];
    const scopeKeys = new NativeSet(scopeNodes.map(node => map.getGroundTerrainNodeKey(node)));
    const shouldCheckNode = (node) => scopeKeys.size === 0 || scopeKeys.has(map.getGroundTerrainNodeKey(node));
    const dirs = [1, 3, 5, 7, 9, 11];
    const checkedEdges = new NativeSet();
    const sharedSegmentsByPair = new NativeMap();
    const getSharedSegments = (typeA, typeB) => {
        const pairKey = typeA < typeB ? `${typeA}:${typeB}` : `${typeB}:${typeA}`;
        if (!sharedSegmentsByPair.has(pairKey)) {
            sharedSegmentsByPair.set(pairKey, collectTerrainPairSharedBoundarySegments(map, polygons, typeA, typeB));
        }
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
                const centerA = { x: Number(node.x), y: Number(node.y) };
                const centerB = { x: Number(neighbor.x), y: Number(neighbor.y) };
                const sharedSegments = getSharedSegments(nodeType, neighborType);
                const hasSharedBorder = sharedSegments.some(segment => (
                    testSegmentsTouchOrIntersect(centerA, centerB, segment.a, segment.b)
                ));
                if (!hasSharedBorder) {
                    failures.push(`${nodeType}/${neighborType} ${edgeKey}`);
                }
            }
        }
    }
    assert.deepEqual(failures, [], label);
}

function assertTerrainPairSharedBoundaryIsSimpleChain(map, polygons, typeA, typeB, label) {
    const sharedSegments = collectTerrainPairSharedBoundarySegments(map, polygons, typeA, typeB);
    assert.ok(sharedSegments.length > 0, `${label}: expected shared ${typeA}/${typeB} boundary segments`);
    const adjacency = new NativeMap();
    const addEndpoint = (from, to) => {
        if (!adjacency.has(from)) adjacency.set(from, new NativeSet());
        adjacency.get(from).add(to);
    };
    for (const segment of sharedSegments) {
        const keyA = map.getGroundTerrainRepairPointKey(segment.a);
        const keyB = map.getGroundTerrainRepairPointKey(segment.b);
        addEndpoint(keyA, keyB);
        addEndpoint(keyB, keyA);
    }
    const branchPoints = [];
    for (const [key, neighbors] of adjacency.entries()) {
        if (neighbors.size > 2) branchPoints.push(key);
    }
    assert.deepEqual(branchPoints, [], `${label}: shared ${typeA}/${typeB} boundary should not branch`);
    const start = adjacency.keys().next().value;
    const seen = new NativeSet([start]);
    const queue = [start];
    for (let i = 0; i < queue.length; i++) {
        const key = queue[i];
        for (const neighbor of adjacency.get(key) || []) {
            if (seen.has(neighbor)) continue;
            seen.add(neighbor);
            queue.push(neighbor);
        }
    }
    assert.equal(
        seen.size,
        adjacency.size,
        `${label}: shared ${typeA}/${typeB} boundary should be one connected chain`
    );
}

function canonicalTerrainPairSharedBoundaryKey(map, polygons, typeA, typeB) {
    return collectTerrainPairSharedBoundarySegments(map, polygons, typeA, typeB)
        .map(segment => {
            const keyA = map.getGroundTerrainRepairPointKey(segment.a);
            const keyB = map.getGroundTerrainRepairPointKey(segment.b);
            return keyA < keyB ? `${keyA}:${keyB}` : `${keyB}:${keyA}`;
        })
        .sort()
        .join("|");
}

function assertNonGrassTerrainTilesCoveredByPolygons(map, label, polygons = map.terrainPolygons) {
    const sourcePolygons = Array.isArray(polygons) ? polygons : [];
    for (let x = 0; x < map.width; x++) {
        for (let y = 0; y < map.height; y++) {
            const node = map.nodes[x] && map.nodes[x][y];
            if (!node || node._prototypeVoid === true) continue;
            const terrainType = map.getGroundTerrainTypeForNode(node);
            if (terrainType === "grass") continue;
            assert.ok(
                sourcePolygons.some(polygon => (
                    polygon.type === terrainType &&
                    testTerrainPolygonCoversPoint(map, polygon, node.x, node.y)
                )),
                `${label}: expected ${terrainType} tile ${x},${y} to be covered by a terrain polygon`
            );
        }
    }
}

function assertAdjacentTerrainPairCenterlinesCoveredByPolygons(map, polygons, nodes, label) {
    const sourcePolygons = Array.isArray(polygons) ? polygons : [];
    const nodeScope = Array.isArray(nodes) ? nodes : [];
    const scopedNodeKeys = new NativeSet(nodeScope.map(node => map.getGroundTerrainNodeKey(node)));
    const checkedEdges = new NativeSet();
    const gaps = [];
    const dirs = [1, 3, 5, 7, 9, 11];
    const shouldCheckNode = (node) => scopedNodeKeys.size === 0 || scopedNodeKeys.has(map.getGroundTerrainNodeKey(node));

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
                for (let step = 1; step < 10; step++) {
                    const t = step / 10;
                    const px = Number(node.x) + ((Number(neighbor.x) - Number(node.x)) * t);
                    const py = Number(node.y) + ((Number(neighbor.y) - Number(node.y)) * t);
                    const covered = sourcePolygons.some(polygon => (
                        (polygon.type === nodeType || polygon.type === neighborType) &&
                        testTerrainPolygonCoversPoint(map, polygon, px, py)
                    ));
                    if (!covered) {
                        gaps.push(`${nodeType}/${neighborType} ${edgeKey} at ${px.toFixed(3)},${py.toFixed(3)}`);
                        break;
                    }
                }
            }
        }
    }
    assert.deepEqual(gaps, [], label);
}

function assertAdjacentEditedTerrainPairsShareBoundary(map, node, label) {
    const dirs = [1, 3, 5, 7, 9, 11];
    const nodeType = map.getGroundTerrainTypeForNode(node);
    if (nodeType === "grass") return;
    const checkedPairs = new NativeSet();
    for (const direction of dirs) {
        const neighbor = node.neighbors && node.neighbors[direction];
        if (!neighbor || neighbor._prototypeVoid === true) continue;
        const neighborType = map.getGroundTerrainTypeForNode(neighbor);
        if (neighborType === "grass" || neighborType === nodeType) continue;
        const pairKey = nodeType < neighborType ? `${nodeType}:${neighborType}` : `${neighborType}:${nodeType}`;
        if (checkedPairs.has(pairKey)) continue;
        checkedPairs.add(pairKey);
        assert.ok(
            collectTerrainPairSharedBoundarySegments(map, map.terrainPolygons, nodeType, neighborType).length > 0,
            `${label}: expected adjacent ${nodeType}/${neighborType} tiles to have shared polygon boundary`
        );
    }
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

function clipTestTerrainPolygonToSection(map, polygon, sectionPolygon) {
    const polygonGeometry = map.groundTerrainPolygonToClipGeometry(polygon);
    const sectionGeometry = [[sectionPolygon.map(point => [Number(point.x), Number(point.y)])]];
    return map.groundTerrainClipGeometryToPolygons(
        polygon.type,
        polygonClipping.intersection(polygonGeometry, sectionGeometry)
    );
}

function createVerticalSplitSectionTerrainPatchFixture(width, height, boundaryX) {
    const map = createTerrainPatchMap(width, height);
    const sectionLeft = "left";
    const sectionRight = "right";
    const nodesBySectionKey = new NativeMap([
        [sectionLeft, []],
        [sectionRight, []]
    ]);
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
    const bounds = getTestPolygonBounds(allCornerPoints);
    const minX = bounds.minX - 1;
    const minY = bounds.minY - 1;
    const maxX = bounds.maxX + 1;
    const maxY = bounds.maxY + 1;
    const sectionPolygonsByKey = new NativeMap([
        [sectionLeft, [
            { x: minX, y: minY },
            { x: boundaryX, y: minY },
            { x: boundaryX, y: maxY },
            { x: minX, y: maxY }
        ]],
        [sectionRight, [
            { x: boundaryX, y: minY },
            { x: maxX, y: minY },
            { x: maxX, y: maxY },
            { x: boundaryX, y: maxY }
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
    const assetsByKey = new NativeMap([
        [sectionLeft, makeAsset(sectionLeft)],
        [sectionRight, makeAsset(sectionRight)]
    ]);
    map._prototypeSectionState = {
        nodesBySectionKey,
        sectionAssetsByKey: assetsByKey
    };
    map.getPrototypeSectionAsset = (key) => assetsByKey.get(key) || null;

    const paintCoords = (coords, terrainType) => {
        for (const [x, y] of coords) {
            const node = map.nodes[x] && map.nodes[x][y];
            assert.ok(node, `section terrain fixture cannot paint missing node ${x},${y}`);
            if (map.getGroundTerrainTypeForNode(node) === terrainType) continue;
            const sectionKey = node._prototypeSectionKey;
            assert.equal(map.replaceGroundTerrainPolygonPatch(node, terrainType, {
                asset: assetsByKey.get(sectionKey),
                sectionKey
            }), true);
        }
    };
    const rawSectionPolygons = () => Array.from(assetsByKey.values()).flatMap(asset => asset.terrainPolygons);

    return { map, assetsByKey, paintCoords, rawSectionPolygons };
}

function getAllTerrainPatchMapBounds(map) {
    const points = [];
    for (let x = 0; x < map.width; x++) {
        for (let y = 0; y < map.height; y++) {
            points.push(...map.getGroundTerrainHexCorners(map.nodes[x][y]));
        }
    }
    const bounds = getTestPolygonBounds(points);
    return {
        minX: bounds.minX - 1,
        minY: bounds.minY - 1,
        maxX: bounds.maxX + 1,
        maxY: bounds.maxY + 1
    };
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
            rawPolygons() {
                return map.terrainPolygons;
            },
            logicalPolygons() {
                return map.terrainPolygons;
            }
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
    } else {
        throw new Error(`unknown terrain model section fixture mode "${sectionMode}"`);
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
    map._prototypeSectionState = {
        nodesBySectionKey,
        sectionAssetsByKey: assetsByKey
    };
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
        rawPolygons() {
            return Array.from(assetsByKey.values()).flatMap(asset => asset.terrainPolygons);
        },
        logicalPolygons() {
            return map.mergeGroundTerrainPolygonsByType(this.rawPolygons());
        }
    };
}

function canonicalTerrainGridKey(map) {
    const entries = [];
    for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
            const node = map.nodes[x][y];
            const type = map.getGroundTerrainTypeForNode(node);
            if (type !== "grass") entries.push(`${x},${y}:${type}`);
        }
    }
    return entries.join("|");
}

function canonicalAllTerrainPairBoundaryKey(map, polygons) {
    const terrainTypes = ["water", "mud", "desert"];
    const entries = [];
    for (let a = 0; a < terrainTypes.length; a++) {
        for (let b = a + 1; b < terrainTypes.length; b++) {
            const typeA = terrainTypes[a];
            const typeB = terrainTypes[b];
            const boundary = canonicalTerrainPairSharedBoundaryKey(map, polygons, typeA, typeB);
            if (boundary) entries.push(`${typeA}/${typeB}:${boundary}`);
        }
    }
    entries.sort();
    return entries.join("\n");
}

function rectTerrainEdits(x0, x1, y0, y1, terrainType) {
    const out = [];
    for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) out.push([x, y, terrainType]);
    }
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
        for (let x = x0; x <= x1; x++) {
            for (let y = y0; y <= y1; y++) finalByCoord.set(`${x},${y}`, terrainType);
        }
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

function paintTerrainModelEdits(fixture, edits, options = {}) {
    for (let i = 0; i < edits.length; i++) {
        const [x, y, terrainType] = edits[i];
        const node = fixture.map.nodes[x] && fixture.map.nodes[x][y];
        assert.ok(node, `terrain model edit ${i} cannot find node ${x},${y}`);
        try {
            fixture.paintNode(node, terrainType);
        } catch (err) {
            assert.fail(`terrain model edit ${i} ${x},${y}->${terrainType} crashed: ${err && err.message ? err.message : err}`);
        }
        if (options.validateEachEdit === true) {
            assertTerrainModelFixtureInvariants(fixture, `terrain model after edit ${i} ${x},${y}->${terrainType}`);
        }
    }
}

function assertTerrainModelFixtureInvariants(fixture, label, nodes = null) {
    const rawPolygons = fixture.rawPolygons();
    assertTerrainPolygonsPassRendererPreflight(rawPolygons, label);
    assertTerrainPolygonsHaveNoProperSegmentCrossings(rawPolygons, `${label}: raw terrain polygons should not cross`);
    assertNonGrassTerrainTilesCoveredByPolygons(fixture.map, label, rawPolygons);
    assertAllAdjacentNonGrassTerrainPairsSharePolygonBorders(fixture.map, rawPolygons, `${label}: adjacent terrain pairs should share polygon borders`, nodes);
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

function canonicalTerrainRingSegmentKeys(map, points) {
    const ring = map.simplifyGroundTerrainPolygonPoints(points);
    const out = [];
    for (let i = 0; i < ring.length; i++) {
        const a = map.getGroundTerrainRepairPointKey(ring[i]);
        const b = map.getGroundTerrainRepairPointKey(ring[(i + 1) % ring.length]);
        out.push(a < b ? `${a}:${b}` : `${b}:${a}`);
    }
    out.sort();
    return out;
}

function assertNestedTerrainPolygonsShareBoundary(map, outerType, innerType, label) {
    const outerPolygons = map.terrainPolygons.filter(polygon => polygon.type === outerType);
    const innerPolygons = map.terrainPolygons.filter(polygon => polygon.type === innerType);
    assert.equal(outerPolygons.length, 1, `${label}: expected one outer polygon`);
    assert.equal(innerPolygons.length, 1, `${label}: expected one inner polygon`);
    const outer = outerPolygons[0];
    const inner = innerPolygons[0];
    assert.equal(Array.isArray(outer.holes), true, `${label}: expected outer holes`);
    assert.equal(outer.holes.length, 1, `${label}: expected one outer hole`);
    assert.deepEqual(
        canonicalTerrainRingSegmentKeys(map, outer.holes[0]),
        canonicalTerrainRingSegmentKeys(map, inner.points),
        `${label}: hole boundary does not match inner boundary`
    );
}

function terrainRingHasPointKey(map, points, pointKey) {
    return map.simplifyGroundTerrainPolygonPoints(points)
        .some(point => map.getGroundTerrainRepairPointKey(point) === pointKey);
}

const LIVE_NESTED_OUTER_COORDS = (() => {
    const coords = [];
    const rows = {
        4: [7, 10],
        5: [5, 11],
        6: [4, 11],
        7: [4, 12],
        8: [4, 13],
        9: [5, 12],
        10: [6, 11],
        11: [8, 10]
    };
    for (const [yText, range] of Object.entries(rows)) {
        const y = Number(yText);
        for (let x = range[0]; x <= range[1]; x++) {
            coords.push([x, y]);
        }
    }
    return coords;
})();

const LIVE_NESTED_INNER_COORDS = [
    [8, 6], [9, 6],
    [7, 7], [8, 7], [10, 7],
    [7, 8], [9, 8], [10, 8],
    [8, 9], [9, 9]
];

function getInteriorThreeHexJunction(map, x = 8, y = 8) {
    const node = map.nodes[x] && map.nodes[x][y];
    assert.ok(node, "three-way terrain fixture requires an interior node");
    const slotMap = map.buildGroundTerrainVertexSlotMap({ nodes: [node] });
    const corners = map.getGroundTerrainHexCorners(node);
    for (const corner of corners) {
        const pointKey = map.getGroundTerrainPointKey(corner);
        const slots = slotMap.get(pointKey);
        if (!(slots instanceof NativeSet) || slots.size !== 3) continue;
        const nodes = Array.from(slots).map(slotKey => {
            const [sx, sy] = String(slotKey).split(",").map(Number);
            return map.nodes[sx] && map.nodes[sx][sy];
        }).filter(Boolean);
        if (nodes.length === 3) {
            return {
                point: corner,
                pointKey: map.getGroundTerrainRepairPointKey(corner),
                nodes
            };
        }
    }
    assert.fail("three-way terrain fixture could not find an interior shared vertex");
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

test("terrain polygon normalization rejects degenerate stored rings", () => {
    const map = createTerrainPatchMap();

    assert.throws(
        () => map.normalizeGroundTerrainPolygons([{
            type: "mud",
            points: [
                { x: 0, y: 0 },
                { x: 1, y: 0 },
                { x: 2, y: 0 }
            ]
        }]),
        /degenerate outer ring/
    );
    assert.throws(
        () => map.normalizeGroundTerrainPolygons([{
            type: "water",
            points: [
                { x: 0, y: 0 },
                { x: 3, y: 0 },
                { x: 3, y: 3 },
                { x: 0, y: 3 }
            ],
            holes: [[
                { x: 1, y: 1 },
                { x: 2, y: 1 },
                { x: 3, y: 1 }
            ]]
        }]),
        /degenerate hole/
    );
});

test("terrain clipping drops degenerate section-boundary artifacts", () => {
    const map = createTerrainPatchMap();
    const polygons = map.groundTerrainClipGeometryToPolygons("mud", [[[
        [1, 1],
        [2, 1],
        [3, 1],
        [1, 1]
    ]]]);

    assert.equal(polygons.length, 0);
});

test("terrain polygon tile assignment paints only fully contained hexes", () => {
    const map = createTerrainPatchMap(8, 8);
    const insideNodes = [map.nodes[3][3], map.nodes[3][4]];
    const polygon = map.groundTerrainClipGeometryToPolygons(
        "water",
        map.buildGroundTerrainHexPatchGeometry(insideNodes)
    )[0];
    map.terrainPolygons = [polygon];

    const result = map.assignGroundTerrainTilesFullyInsidePolygonAtPoint(
        insideNodes[0].x,
        insideNodes[0].y
    );

    assert.equal(result.foundPolygon, true);
    assert.equal(result.terrainType, "water");
    assert.equal(result.assignedCount, 2);
    assert.equal(map.getGroundTerrainTypeForNode(map.nodes[3][3]), "water");
    assert.equal(map.getGroundTerrainTypeForNode(map.nodes[3][4]), "water");
    assert.equal(map.getGroundTerrainTypeForNode(map.nodes[2][3]), "grass");
    assert.equal(map.getGroundTerrainTypeForNode(map.nodes[4][3]), "grass");
});

test("terrain polygon tile assignment ignores hexes that only have centers inside", () => {
    const map = createTerrainPatchMap(8, 8);
    const node = map.nodes[3][3];
    const polygon = {
        type: "mud",
        points: [
            { x: node.x - 0.1, y: node.y - 0.1 },
            { x: node.x + 0.1, y: node.y - 0.1 },
            { x: node.x + 0.1, y: node.y + 0.1 },
            { x: node.x - 0.1, y: node.y + 0.1 }
        ]
    };
    map.terrainPolygons = [polygon];
    assert.equal(map.terrainPolygonContainsPoint(polygon, node.x, node.y), true);

    const result = map.assignGroundTerrainTilesFullyInsidePolygonAtPoint(node.x, node.y);

    assert.equal(result.foundPolygon, true);
    assert.equal(result.terrainType, "mud");
    assert.equal(result.assignedCount, 0);
    assert.equal(map.getGroundTerrainTypeForNode(node), "grass");
});

test("terrain double-click polygon tile assignment is wired through the terrain painter", () => {
    const spellSource = fs.readFileSync(path.join(__dirname, "../public/assets/javascript/spells.js"), "utf8");
    assert.match(spellSource, /function assignTerrainPolygonTilesAtWorldPoint/);
    assert.match(spellSource, /target\.terrainType !== selectedTerrainType/);
    assert.match(spellSource, /assignGroundTerrainTilesFullyInsidePolygonAtPoint/);

    const runaroundSource = fs.readFileSync(path.join(__dirname, "../public/assets/javascript/runaround.js"), "utf8");
    assert.match(runaroundSource, /wizard\.currentSpell === "terrainedit"/);
    assert.match(runaroundSource, /assignTerrainPolygonTilesAtWorldPoint/);
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

test("nested terrain polygons keep outer holes contiguous with inner polygon boundaries for every type pair", () => {
    const terrainTypes = ["water", "mud", "grass", "desert"];
    const failures = [];

    for (const outerType of terrainTypes) {
        for (const innerType of terrainTypes) {
            if (outerType === innerType) continue;
            try {
                const map = createTerrainPatchMap(14, 12);
                const nodes = [];
                const innerCoordKeys = new NativeSet();
                const backgroundType = terrainTypes.find(type => type !== outerType && type !== innerType);
                for (let x = 5; x <= 8; x++) {
                    for (let y = 5; y <= 6; y++) {
                        innerCoordKeys.add(`${x},${y}`);
                    }
                }
                const backgroundId = map.getGroundTerrainTextureIdForType(backgroundType, 0, 0);
                const outerId = map.getGroundTerrainTextureIdForType(outerType, 0, 0);
                const innerId = map.getGroundTerrainTextureIdForType(innerType, 0, 0);
                for (let x = 0; x < map.width; x++) {
                    for (let y = 0; y < map.height; y++) {
                        map.nodes[x][y].groundTextureId = backgroundId;
                    }
                }
                for (let x = 2; x <= 11; x++) {
                    for (let y = 2; y <= 9; y++) {
                        const node = map.nodes[x][y];
                        if (innerCoordKeys.has(`${x},${y}`)) {
                            node.groundTextureId = innerId;
                        } else {
                            node.groundTextureId = outerId;
                        }
                        nodes.push(node);
                    }
                }

                map.terrainPolygons = map.buildGroundTerrainPolygonsFromNodes(nodes, { includeGrass: true });
                const outerPolygons = map.terrainPolygons.filter(polygon => polygon.type === outerType);
                const innerPolygons = map.terrainPolygons.filter(polygon => polygon.type === innerType);
                if (outerPolygons.length !== 1 || innerPolygons.length !== 1) {
                    failures.push(`${innerType} inside ${outerType}: expected one outer and one inner polygon`);
                    continue;
                }

                const outer = outerPolygons[0];
                const inner = innerPolygons[0];
                if (!Array.isArray(outer.holes) || outer.holes.length !== 1) {
                    failures.push(`${innerType} inside ${outerType}: expected one outer hole`);
                    continue;
                }
                const holeSegments = canonicalTerrainRingSegmentKeys(map, outer.holes[0]);
                const innerSegments = canonicalTerrainRingSegmentKeys(map, inner.points);
                if (JSON.stringify(holeSegments) !== JSON.stringify(innerSegments)) {
                    failures.push(`${innerType} inside ${outerType}: hole boundary does not match inner boundary`);
                }
            } catch (err) {
                failures.push(`${innerType} inside ${outerType}: ${err && err.message ? err.message : err}`);
            }
        }
    }

    assert.deepEqual(failures, []);
});

test("terrain nested boundary canonicalization handles legacy holes containing multiple polygons", () => {
    const map = createTerrainPatchMap();
    const waterOuter = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 }
    ];
    const legacyLargeHole = [
        { x: 2, y: 2 },
        { x: 8, y: 2 },
        { x: 8, y: 8 },
        { x: 2, y: 8 }
    ];
    const nestedInner = [
        { x: 4, y: 4 },
        { x: 6, y: 4 },
        { x: 6, y: 6 },
        { x: 4, y: 6 }
    ];

    const nested = map.canonicalizeGroundTerrainNestedPolygonBoundaries([
        { type: "water", points: waterOuter, holes: [legacyLargeHole] },
        { type: "mud", points: legacyLargeHole, holes: [nestedInner] },
        { type: "desert", points: nestedInner }
    ]);
    const nestedWater = nested.find(polygon => polygon.type === "water");
    const nestedMud = nested.find(polygon => polygon.type === "mud");
    assert.equal(nestedWater.holes.length, 1);
    assert.deepEqual(
        canonicalTerrainRingSegmentKeys(map, nestedWater.holes[0]),
        canonicalTerrainRingSegmentKeys(map, legacyLargeHole)
    );
    assert.equal(nestedMud.holes.length, 1);
    assert.deepEqual(
        canonicalTerrainRingSegmentKeys(map, nestedMud.holes[0]),
        canonicalTerrainRingSegmentKeys(map, nestedInner)
    );

    const siblingA = [
        { x: 2, y: 2 },
        { x: 4, y: 2 },
        { x: 4, y: 4 },
        { x: 2, y: 4 }
    ];
    const siblingB = [
        { x: 6, y: 6 },
        { x: 8, y: 6 },
        { x: 8, y: 8 },
        { x: 6, y: 8 }
    ];
    const siblings = map.canonicalizeGroundTerrainNestedPolygonBoundaries([
        { type: "water", points: waterOuter, holes: [legacyLargeHole] },
        { type: "mud", points: siblingA },
        { type: "desert", points: siblingB }
    ]);
    const siblingWater = siblings.find(polygon => polygon.type === "water");
    assert.equal(siblingWater.holes.length, 2);
    assert.equal(
        JSON.stringify(siblingWater.holes
            .map(hole => canonicalTerrainRingSegmentKeys(map, hole))
            .sort()),
        JSON.stringify([
            canonicalTerrainRingSegmentKeys(map, siblingA),
            canonicalTerrainRingSegmentKeys(map, siblingB)
        ].sort())
    );
});

test("terrain edit priority orders boundary ownership", () => {
    const map = createTerrainPatchMap();

    assert.ok(map.getGroundTerrainEditPriority("desert") > map.getGroundTerrainEditPriority("grass"));
    assert.ok(map.getGroundTerrainEditPriority("grass") > map.getGroundTerrainEditPriority("mud"));
    assert.ok(map.getGroundTerrainEditPriority("mud") > map.getGroundTerrainEditPriority("water"));
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
    markWaterNodesInsidePolygon(rectangularWaterMap, rectangularWaterMap.terrainPolygons[0]);
    const oneMeterImmersion = rectangularWaterMap.getGroundTerrainWaterImmersionAtPoint(1, 1);
    assert.equal(
        oneMeterImmersion.distanceToShore,
        rectangularWaterMap.getGroundTerrainWaterDistanceToNearestNonWaterTile(1, 1)
    );
    assert.equal(oneMeterImmersion.submergedDepth, Math.min(2 / 3, oneMeterImmersion.distanceToShore * (2 / 3)));
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
        for (const [, asset] of entries) {
            markWaterNodesInsidePolygon(map, asset.terrainPolygons[0]);
        }
        return map;
    };

    const seamPointX = 0.95;
    const seamPointY = 0.5;
    const leftOnly = makeMap(false).getGroundTerrainWaterImmersionAtPoint(seamPointX, seamPointY);
    const continuous = makeMap(true).getGroundTerrainWaterImmersionAtPoint(seamPointX, seamPointY);

    assert.equal(leftOnly.inWater, true);
    assert.equal(continuous.inWater, true);
    assert.ok(continuous.distanceToShore >= leftOnly.distanceToShore);
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
    markWaterNodesInsidePolygon(map, map.terrainPolygons[0]);
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
    const deepActor = { currentLayer: 0 };
    const deepState = map.applyActorBridgeMovementState(deepActor, 4.5, 5);
    assert.equal(deepState, null, "normal movement should not climb onto a deep-water bridge from swimming");
    const restoredDeepActor = { currentLayer: 0 };
    const restoredDeepState = map.applyActorBridgeMovementState(restoredDeepActor, 4.5, 5, {
        allowExistingBridgePosition: true
    });
    assert.equal(restoredDeepState && restoredDeepState.onBridge, true, "load restore should keep an actor standing on a deep-water bridge");

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
    markWaterNodesInsidePolygon(map, map.terrainPolygons[0]);
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
