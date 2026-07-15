const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const polygonClipping = require("polygon-clipping");
const sectionGeometry = require("../public/assets/javascript/map/sectionGeometry.js");

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

function getTestTerrainRepairLatticeCoord(point) {
    const hexWidth = 1 / 0.866;
    const xStep = (hexWidth * 0.5) / 8;
    const yStep = 0.5 / 8;
    const j = Math.round(Number(point && point.y) / yStep);
    const i = Math.round((Number(point && point.x) - (j * xStep * 0.5)) / xStep);
    return { i, j };
}

function getTestTerrainRepairPointForLatticeCoord(coord) {
    const hexWidth = 1 / 0.866;
    const xStep = (hexWidth * 0.5) / 8;
    const yStep = 0.5 / 8;
    return {
        x: (Number(coord.i) + (Number(coord.j) * 0.5)) * xStep,
        y: Number(coord.j) * yStep
    };
}

function assertTestPointOnTerrainRepairLattice(point, label) {
    const coord = getTestTerrainRepairLatticeCoord(point);
    const canonical = getTestTerrainRepairPointForLatticeCoord(coord);
    assert.ok(Math.abs(Number(point.x) - canonical.x) <= 1e-9, `${label} x should be on terrain repair lattice`);
    assert.ok(Math.abs(Number(point.y) - canonical.y) <= 1e-9, `${label} y should be on terrain repair lattice`);
}

function getTestHexVertexLatticeCoord(point) {
    const coord = getTestTerrainRepairLatticeCoord(point);
    return {
        u: (Number(coord.i) - 4) / 8,
        v: Number(coord.j) / 8
    };
}

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

function createTerrainPassabilityMap(width = 3, height = 3) {
    const map = Object.create(GameMap.prototype);
    map.width = width;
    map.height = height;
    map.wrapX = false;
    map.wrapY = false;
    map.hexWidth = 1 / 0.866;
    map.hexHeight = 1;
    map.terrainPolygons = [];
    map.nodes = [];
    map._suppressClearanceUpdates = false;
    map.clearanceUpdates = 0;
    map.snapshotDirtyCount = 0;
    map.updateClearanceAround = () => { map.clearanceUpdates += 1; };
    map.markPathfindingSnapshotDirty = () => { map.snapshotDirtyCount += 1; };
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
    return map.getGroundTerrainCanonicalRepairPoint(point);
}

function assertTestPointOnRepairLattice(map, point, label) {
    const canonical = map.getGroundTerrainCanonicalRepairPoint(point);
    assert.ok(Math.abs(Number(point.x) - canonical.x) <= 1e-9, `${label}: x is not repair-lattice snapped`);
    assert.ok(Math.abs(Number(point.y) - canonical.y) <= 1e-9, `${label}: y is not repair-lattice snapped`);
}

function testPointOnRepairLattice(map, point, eps = 1e-9) {
    const canonical = map.getGroundTerrainCanonicalRepairPoint(point);
    return Math.abs(Number(point.x) - canonical.x) <= eps &&
        Math.abs(Number(point.y) - canonical.y) <= eps;
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
        const tileCoordKeys = nodes.map(node => `${node.xindex},${node.yindex}`);
        return {
            key,
            tileCoordKeys,
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
        const tileCoordKeys = nodes.map(node => `${node.xindex},${node.yindex}`);
        return {
            key,
            tileCoordKeys,
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

function createDiagonalSectionTerrainModelFixture(width = 30, height = 24) {
    const map = createTerrainPatchMap(width, height);
    const bounds = getAllTerrainPatchMapBounds(map);
    const sharedA = { x: map.nodes[11][0].x, y: bounds.minY };
    const sharedB = { x: map.nodes[18][0].x, y: bounds.maxY };
    const sideOfSharedEdge = (point) => (
        (sharedB.x - sharedA.x) * (Number(point.y) - sharedA.y) -
        (sharedB.y - sharedA.y) * (Number(point.x) - sharedA.x)
    );
    const nodesBySectionKey = new NativeMap([
        ["left", []],
        ["right", []]
    ]);
    for (let x = 0; x < map.width; x++) {
        for (let y = 0; y < map.height; y++) {
            const node = map.nodes[x][y];
            const sectionKey = sideOfSharedEdge(node) >= 0 ? "left" : "right";
            node._prototypeSectionKey = sectionKey;
            nodesBySectionKey.get(sectionKey).push(node);
        }
    }
    const sectionPolygonsByKey = new NativeMap([
        ["left", [
            { x: bounds.minX, y: bounds.minY },
            sharedA,
            sharedB,
            { x: bounds.minX, y: bounds.maxY }
        ]],
        ["right", [
            sharedA,
            { x: bounds.maxX, y: bounds.minY },
            { x: bounds.maxX, y: bounds.maxY },
            sharedB
        ]]
    ]);
    const assetsByKey = new NativeMap();
    for (const key of sectionPolygonsByKey.keys()) {
        const nodes = nodesBySectionKey.get(key);
        const tileCoordKeys = nodes.map(node => `${node.xindex},${node.yindex}`);
        assetsByKey.set(key, {
            key,
            tileCoordKeys,
            groundTiles: {},
            terrainPolygons: [],
            sectionPolygon: sectionPolygonsByKey.get(key),
            _level0GroundSurfaceVersion: 0
        });
    }
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

function getRetainedWaterUnionPrecisionReproGeometries() {
    return [
        [[[
            [122.69053117782909, 226],
            [122.76270207852193, 225.625],
            [122.97921478060046, 225.25],
            [123.26789838337181, 225],
            [124.1339491916859, 224.5],
            [124.49480369515011, 224.375],
            [124.92782909930715, 224.375],
            [125.28868360277136, 224.5],
            [125.5412817551963, 224.5625],
            [125.86605080831409, 224.5],
            [126.04647806004618, 224.3125],
            [126.15473441108544, 224],
            [126.22690531177828, 223.625],
            [126.4434180138568, 223.25],
            [126.73210161662817, 223],
            [126.91252886836027, 222.8125],
            [127.02078521939953, 222.5],
            [127.09295612009237, 222.125],
            [127.3094688221709, 221.75],
            [127.59815242494226, 221.5],
            [128.46420323325634, 221],
            [128.82505773672054, 220.875],
            [129.11374133949192, 220.875],
            [129.33025404157044, 221],
            [129.33025404157044, 221.5],
            [129.4385103926097, 221.8125],
            [129.6189376443418, 222],
            [130.20442231040514, 222.29825277694755],
            [130.19744880467718, 223.49405601089737],
            [130.1602193995381, 223.6875],
            [130.1602193995381, 224.3125],
            [130.1894304446586, 224.8690288316357],
            [130.18866666666665, 225],
            [129.33974601833197, 225.48355989624903],
            [129.36633949191685, 225.4375],
            [128.7168013856813, 225.8125],
            [128.69451961694145, 225.8510920234574],
            [128.6525476190476, 225.875],
            [128.60854503464202, 225.875],
            [126.4434180138568, 227.125],
            [123.2318129330254, 228.9375],
            [122.97921478060046, 228.75],
            [122.76270207852193, 228.375],
            [122.69053117782909, 228]
        ]]],
        [[[
            [130.18866666666668, 225],
            [130.19157077703758, 224.50200878743675],
            [130.1963048498845, 224.625],
            [130.1963048498845, 223.6902191595286],
            [130.20419118113833, 222.33788637524387],
            [130.48498845265587, 222.5],
            [136.54734411085448, 226],
            [136.83602771362587, 226.25],
            [137.05254041570439, 226.625],
            [137.12471131639722, 227],
            [137.12471131639722, 229],
            [137.09935212781855, 229.04392211461823],
            [131.24684119890156, 225.61921142498608],
            [130.1963048498845, 225],
            [130.19246001476338, 225.0022197514766]
        ]]],
        [[[
            [130.1974488046772, 223.4940560108972],
            [130.20442231040516, 222.29825277694758],
            [130.23239030023095, 222.3125],
            [130.23239030023095, 223.3125]
        ]]],
        [[[
            [128.46420323325634, 222],
            [128.7528868360277, 221.5],
            [128.46420323325634, 221],
            [128.82505773672054, 220.875],
            [129.2580831408776, 220.875],
            [129.6189376443418, 221],
            [129.90762124711316, 221.25],
            [130.12413394919167, 221.625],
            [130.1963048498845, 222],
            [130.30456120092379, 222.3125],
            [130.48498845265587, 222.5],
            [130.1963048498845, 223],
            [129.6189376443418, 223],
            [129.33025404157044, 222.5],
            [128.7528868360277, 222.5]
        ]]]
    ];
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

function getTestNearBoundarySummary(ringDiagnostic, nearDistance = 1, onBoundaryDistance = 1e-3) {
    const distances = Array.isArray(ringDiagnostic && ringDiagnostic.boundaryDistances)
        ? ringDiagnostic.boundaryDistances
        : [];
    const near = distances.filter(record => (
        Number.isFinite(Number(record && record.distance)) &&
        Number(record.distance) <= nearDistance
    ));
    const off = near.filter(record => Number(record.distance) > onBoundaryDistance);
    const on = near.filter(record => Number(record.distance) <= onBoundaryDistance);
    return {
        nearCount: near.length,
        onCount: on.length,
        offCount: off.length,
        maxOffDistance: off.reduce((max, record) => Math.max(max, Number(record.distance)), 0),
        firstOff: off.length > 0 ? off[0] : null
    };
}

function ringDiagnosticHasMixedSectionBoundaryRun(ringDiagnostic, nearDistance = 1, onBoundaryDistance = 1e-3) {
    const distances = Array.isArray(ringDiagnostic && ringDiagnostic.boundaryDistances)
        ? ringDiagnostic.boundaryDistances
        : [];
    const pointCount = Number(ringDiagnostic && ringDiagnostic.pointCount);
    if (!Number.isFinite(pointCount) || pointCount < 3) return false;
    const segments = [];
    for (let i = 0; i < pointCount; i++) {
        const a = distances[i];
        const b = distances[(i + 1) % pointCount];
        if (!a || !b) continue;
        const distanceA = Number(a.distance);
        const distanceB = Number(b.distance);
        if (!Number.isFinite(distanceA) || !Number.isFinite(distanceB)) continue;
        if (distanceA > nearDistance || distanceB > nearDistance) continue;
        if (Number(a.edgeIndex) !== Number(b.edgeIndex)) continue;
        segments.push({
            index: i,
            exact: distanceA <= onBoundaryDistance && distanceB <= onBoundaryDistance
        });
    }
    const byIndex = new NativeMap(segments.map(segment => [segment.index, segment]));
    const seen = new NativeSet();
    for (const segment of segments) {
        if (seen.has(segment.index)) continue;
        const stack = [segment.index];
        const component = [];
        seen.add(segment.index);
        while (stack.length > 0) {
            const index = stack.pop();
            const current = byIndex.get(index);
            if (current) component.push(current);
            const neighbors = [
                (index + 1) % pointCount,
                (index - 1 + pointCount) % pointCount
            ];
            for (const neighbor of neighbors) {
                if (!byIndex.has(neighbor) || seen.has(neighbor)) continue;
                seen.add(neighbor);
                stack.push(neighbor);
            }
        }
        if (component.some(record => record.exact) && component.some(record => !record.exact)) {
            return true;
        }
    }
    return false;
}

function clippedGeometryDiagnosticHasMixedSectionBoundaryRun(clippedGeometryDiagnostic) {
    const polygons = Array.isArray(clippedGeometryDiagnostic && clippedGeometryDiagnostic.polygons)
        ? clippedGeometryDiagnostic.polygons
        : [];
    return polygons.some(polygon => (
        Array.isArray(polygon.rings) &&
        polygon.rings.some(ring => ringDiagnosticHasMixedSectionBoundaryRun(ring && ring.diagnostic))
    ));
}

function splitOutputDiagnosticHasMixedSectionBoundaryRun(record) {
    const polygons = Array.isArray(record && record.polygons) ? record.polygons : [];
    return polygons.some(polygon => ringDiagnosticHasMixedSectionBoundaryRun(polygon && polygon.outer));
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

function maskTerrainEdits(x0, x1, y0, y1, terrainType, predicate) {
    const out = [];
    for (let x = x0; x <= x1; x++) {
        for (let y = y0; y <= y1; y++) {
            if (predicate(x, y)) out.push([x, y, terrainType]);
        }
    }
    return out;
}

function ellipseTerrainEdits(cx, cy, rx, ry, terrainType) {
    return maskTerrainEdits(
        Math.floor(cx - rx),
        Math.ceil(cx + rx),
        Math.floor(cy - ry),
        Math.ceil(cy + ry),
        terrainType,
        (x, y) => (((x - cx) * (x - cx)) / (rx * rx)) + (((y - cy) * (y - cy)) / (ry * ry)) <= 1
    );
}

function diamondTerrainEdits(cx, cy, radiusX, radiusY, terrainType) {
    return maskTerrainEdits(
        Math.floor(cx - radiusX),
        Math.ceil(cx + radiusX),
        Math.floor(cy - radiusY),
        Math.ceil(cy + radiusY),
        terrainType,
        (x, y) => (Math.abs(x - cx) / radiusX) + (Math.abs(y - cy) / radiusY) <= 1
    );
}

function diagonalBandTerrainEdits(x0, x1, y0, y1, slope, intercept, halfWidth, terrainType) {
    return maskTerrainEdits(
        x0,
        x1,
        y0,
        y1,
        terrainType,
        (x, y) => Math.abs(y - ((slope * x) + intercept)) <= halfWidth
    );
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

function terrainPolygonsContainingNode(map, polygons, node, terrainType) {
    return (Array.isArray(polygons) ? polygons : []).filter(polygon => (
        polygon &&
        polygon.type === terrainType &&
        map.terrainPolygonContainsPoint(polygon, Number(node.x), Number(node.y))
    ));
}

function assertTerrainModelFixtureInvariants(fixture, label, nodes = null) {
    const rawPolygons = fixture.rawPolygons();
    assertTerrainPolygonsPassRendererPreflight(rawPolygons, label);
    assertTerrainPolygonsHaveNoProperSegmentCrossings(rawPolygons, `${label}: raw terrain polygons should not cross`);
    assertNonGrassTerrainTilesCoveredByPolygons(fixture.map, label, rawPolygons);
    assertAllAdjacentNonGrassTerrainPairsSharePolygonBorders(fixture.map, rawPolygons, `${label}: adjacent terrain pairs should share polygon borders`, nodes);
}

function getTestSectionEdgeProjection(point, a, b, maxDistance = Infinity) {
    const px = Number(point && point.x);
    const py = Number(point && point.y);
    const ax = Number(a && a.x);
    const ay = Number(a && a.y);
    const bx = Number(b && b.x);
    const by = Number(b && b.y);
    if (![px, py, ax, ay, bx, by].every(Number.isFinite)) return null;
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    if (!(lengthSq > 1e-12)) return null;
    const t = ((px - ax) * dx + (py - ay) * dy) / lengthSq;
    if (t < -1e-6 || t > 1 + 1e-6) return null;
    const clampedT = Math.max(0, Math.min(1, t));
    const projected = { x: ax + dx * clampedT, y: ay + dy * clampedT };
    const distance = Math.hypot(px - projected.x, py - projected.y);
    if (distance > maxDistance) return null;
    return { t: clampedT, distance, point: projected };
}

function getTestSectionSegmentOverlap(a0, a1, b0, b1, eps = 1e-6) {
    const b0Projection = getTestSectionEdgeProjection(b0, a0, a1, eps);
    const b1Projection = getTestSectionEdgeProjection(b1, a0, a1, eps);
    if (!b0Projection || !b1Projection) return null;
    const a0Projection = getTestSectionEdgeProjection(a0, b0, b1, eps);
    const a1Projection = getTestSectionEdgeProjection(a1, b0, b1, eps);
    if (!a0Projection || !a1Projection) return null;
    const start = Math.max(0, Math.min(b0Projection.t, b1Projection.t));
    const end = Math.min(1, Math.max(b0Projection.t, b1Projection.t));
    if (end - start <= eps) return null;
    return { start, end };
}

function getTestClipRingSignedArea(ring) {
    let area = 0;
    const source = Array.isArray(ring) ? ring : [];
    for (let i = 0; i < source.length; i++) {
        const a = source[i];
        const b = source[(i + 1) % source.length];
        area += Number(a && a[0]) * Number(b && b[1]) - Number(b && b[0]) * Number(a && a[1]);
    }
    return area / 2;
}

function getTestClipGeometryArea(geometry) {
    let area = 0;
    for (const polygon of Array.isArray(geometry) ? geometry : []) {
        if (!Array.isArray(polygon) || !Array.isArray(polygon[0])) continue;
        let polygonArea = Math.abs(getTestClipRingSignedArea(polygon[0]));
        for (let h = 1; h < polygon.length; h++) {
            polygonArea -= Math.abs(getTestClipRingSignedArea(polygon[h]));
        }
        area += Math.max(0, polygonArea);
    }
    return area;
}

function collectTestSharedSectionEdges(assetsByKey) {
    const assets = Array.from(assetsByKey.values()).filter(asset => (
        asset && typeof asset.key === "string" && Array.isArray(asset.sectionPolygon)
    ));
    const out = [];
    for (let a = 0; a < assets.length; a++) {
        const assetA = assets[a];
        const ringA = assetA.sectionPolygon;
        for (let b = a + 1; b < assets.length; b++) {
            const assetB = assets[b];
            const ringB = assetB.sectionPolygon;
            for (let i = 0; i < ringA.length; i++) {
                const a0 = ringA[i];
                const a1 = ringA[(i + 1) % ringA.length];
                for (let j = 0; j < ringB.length; j++) {
                    const b0 = ringB[j];
                    const b1 = ringB[(j + 1) % ringB.length];
                    const overlap = getTestSectionSegmentOverlap(a0, a1, b0, b1);
                    if (!overlap) continue;
                    const edgeStart = {
                        x: Number(a0.x) + (Number(a1.x) - Number(a0.x)) * overlap.start,
                        y: Number(a0.y) + (Number(a1.y) - Number(a0.y)) * overlap.start
                    };
                    const edgeEnd = {
                        x: Number(a0.x) + (Number(a1.x) - Number(a0.x)) * overlap.end,
                        y: Number(a0.y) + (Number(a1.y) - Number(a0.y)) * overlap.end
                    };
                    out.push({
                        keyA: assetA.key,
                        keyB: assetB.key,
                        a: edgeStart,
                        b: edgeEnd
                    });
                }
            }
        }
    }
    return out;
}

function collectTestSectionBoundaryEdges(assetsByKey) {
    const assets = Array.from(assetsByKey.values()).filter(asset => (
        asset && typeof asset.key === "string" && Array.isArray(asset.sectionPolygon)
    ));
    const out = [];
    for (const asset of assets) {
        const ring = asset.sectionPolygon;
        for (let i = 0; i < ring.length; i++) {
            out.push({
                sectionKey: asset.key,
                edgeIndex: i,
                a: ring[i],
                b: ring[(i + 1) % ring.length]
            });
        }
    }
    return out;
}

function collectTestPolygonRings(polygon) {
    const rings = [{ kind: "outer", index: 0, points: polygon && polygon.points }];
    const holes = Array.isArray(polygon && polygon.holes) ? polygon.holes : [];
    for (let h = 0; h < holes.length; h++) {
        rings.push({ kind: "hole", index: h, points: holes[h] });
    }
    return rings.filter(record => Array.isArray(record.points));
}

function collectTestSectionSeamIntervalsForAsset(asset, sharedEdge, options = {}) {
    const onDistance = Number.isFinite(options.onDistance) ? Number(options.onDistance) : 1e-6;
    const terrainPolygons = Array.isArray(asset && asset.terrainPolygons) ? asset.terrainPolygons : [];
    const intervalsByType = new NativeMap();
    for (let p = 0; p < terrainPolygons.length; p++) {
        const polygon = terrainPolygons[p];
        if (!polygon || typeof polygon.type !== "string") continue;
        for (const ringRecord of collectTestPolygonRings(polygon)) {
            const ring = ringRecord.points;
            for (let i = 0; i < ring.length; i++) {
                const pointA = ring[i];
                const pointB = ring[(i + 1) % ring.length];
                const projectionA = getTestSectionEdgeProjection(pointA, sharedEdge.a, sharedEdge.b, onDistance);
                const projectionB = getTestSectionEdgeProjection(pointB, sharedEdge.a, sharedEdge.b, onDistance);
                if (!projectionA || !projectionB) continue;
                const start = Math.min(projectionA.t, projectionB.t);
                const end = Math.max(projectionA.t, projectionB.t);
                if (end - start <= 1e-6) continue;
                if (!intervalsByType.has(polygon.type)) intervalsByType.set(polygon.type, []);
                intervalsByType.get(polygon.type).push([
                    Number(start.toFixed(7)),
                    Number(end.toFixed(7))
                ]);
            }
        }
    }
    const normalized = new NativeMap();
    for (const [type, intervals] of intervalsByType.entries()) {
        const mergedIntervals = intervals
            .slice()
            .sort((a, b) => a[0] - b[0] || a[1] - b[1])
            .reduce((merged, interval) => {
                const previous = merged[merged.length - 1];
                if (previous && interval[0] <= previous[1] + 1e-7) {
                    previous[1] = Math.max(previous[1], interval[1]);
                } else {
                    merged.push(interval.slice());
                }
                return merged;
            }, []);
        const keys = Array.from(new NativeSet(mergedIntervals
            .map(([start, end]) => `${start.toFixed(7)}:${end.toFixed(7)}`)
        ))
            .sort();
        normalized.set(type, keys);
    }
    return normalized;
}

function collectTestSectionSeamDriftSegments(asset, sharedEdge, options = {}) {
    const nearDistance = Number.isFinite(options.nearDistance) ? Number(options.nearDistance) : 0.01;
    const onDistance = Number.isFinite(options.onDistance) ? Number(options.onDistance) : 1e-6;
    const minProjectedLength = Number.isFinite(options.minProjectedLength) ? Number(options.minProjectedLength) : 0.05;
    const terrainPolygons = Array.isArray(asset && asset.terrainPolygons) ? asset.terrainPolygons : [];
    const out = [];
    for (let p = 0; p < terrainPolygons.length; p++) {
        const polygon = terrainPolygons[p];
        if (!polygon || typeof polygon.type !== "string") continue;
        for (const ringRecord of collectTestPolygonRings(polygon)) {
            const ring = ringRecord.points;
            for (let i = 0; i < ring.length; i++) {
                const pointA = ring[i];
                const pointB = ring[(i + 1) % ring.length];
                const projectionA = getTestSectionEdgeProjection(pointA, sharedEdge.a, sharedEdge.b, nearDistance);
                const projectionB = getTestSectionEdgeProjection(pointB, sharedEdge.a, sharedEdge.b, nearDistance);
                if (!projectionA || !projectionB) continue;
                const projectedLength = Math.abs(projectionB.t - projectionA.t) *
                    Math.hypot(Number(sharedEdge.b.x) - Number(sharedEdge.a.x), Number(sharedEdge.b.y) - Number(sharedEdge.a.y));
                if (!(projectedLength > minProjectedLength)) continue;
                if (projectionA.distance <= onDistance && projectionB.distance <= onDistance) continue;
                out.push({
                    sectionKey: asset.key,
                    terrainType: polygon.type,
                    polygonIndex: p,
                    ringKind: ringRecord.kind,
                    ringIndex: ringRecord.index,
                    segmentIndex: i,
                    distanceA: projectionA.distance,
                    distanceB: projectionB.distance,
                    a: { x: Number(pointA.x), y: Number(pointA.y) },
                    b: { x: Number(pointB.x), y: Number(pointB.y) },
                    projectedA: projectionA.point,
                    projectedB: projectionB.point
                });
            }
        }
    }
    return out;
}

function testPointOnSectionBoundary(point, sectionBoundaryEdges, eps = 1e-9) {
    return sectionBoundaryEdges.some(edge => (
        getTestSectionEdgeProjection(point, edge.a, edge.b, eps) !== null
    ));
}

function assertFinishedTerrainVerticesAreCanonicalOrSectionBoundary(fixture, label) {
    const sectionBoundaryEdges = collectTestSectionBoundaryEdges(fixture.assetsByKey);
    const failures = [];
    const rawPolygons = fixture.rawPolygons();
    for (let p = 0; p < rawPolygons.length; p++) {
        const polygon = rawPolygons[p];
        for (const ringRecord of collectTestPolygonRings(polygon)) {
            const ring = ringRecord.points;
            for (let i = 0; i < ring.length; i++) {
                const point = ring[i];
                if (testPointOnRepairLattice(fixture.map, point)) continue;
                if (testPointOnSectionBoundary(point, sectionBoundaryEdges)) continue;
                failures.push(
                    `${polygon && polygon.type}[${p}] ${ringRecord.kind}:${ringRecord.index}:${i} ` +
                    `${Number(point.x).toFixed(12)},${Number(point.y).toFixed(12)}`
                );
            }
        }
    }
    assert.deepEqual(
        failures,
        [],
        `${label}: finished terrain vertices must be exactly on the repair grid or section boundary`
    );
}

function assertCrossSectionTerrainSeamsAreExact(fixture, label) {
    assertTerrainModelFixtureInvariants(fixture, label);
    assertFinishedTerrainVerticesAreCanonicalOrSectionBoundary(fixture, label);
    const assetsByKey = fixture.assetsByKey;
    const sharedEdges = collectTestSharedSectionEdges(assetsByKey);
    assert.ok(sharedEdges.length > 0, `${label}: expected shared section edges`);
    const driftSegments = [];
    const intervalFailures = [];
    let sharedTerrainIntervalCount = 0;
    for (const sharedEdge of sharedEdges) {
        const assetA = assetsByKey.get(sharedEdge.keyA);
        const assetB = assetsByKey.get(sharedEdge.keyB);
        driftSegments.push(...collectTestSectionSeamDriftSegments(assetA, sharedEdge));
        driftSegments.push(...collectTestSectionSeamDriftSegments(assetB, sharedEdge));
        const intervalsA = collectTestSectionSeamIntervalsForAsset(assetA, sharedEdge);
        const intervalsB = collectTestSectionSeamIntervalsForAsset(assetB, sharedEdge);
        const types = new NativeSet([...intervalsA.keys(), ...intervalsB.keys()]);
        for (const type of types) {
            const left = intervalsA.get(type) || [];
            const right = intervalsB.get(type) || [];
            sharedTerrainIntervalCount += Math.max(left.length, right.length);
            if (JSON.stringify(left) !== JSON.stringify(right)) {
                intervalFailures.push(
                    `${sharedEdge.keyA}/${sharedEdge.keyB} ${type}: ` +
                    `${left.join("|") || "(none)"} != ${right.join("|") || "(none)"}`
                );
            }
        }
    }
    assert.ok(sharedTerrainIntervalCount > 0, `${label}: expected terrain to cross at least one section seam`);
    assert.deepEqual(
        intervalFailures,
        [],
        `${label}: section seam intervals must match exactly on both sides`
    );
    assert.deepEqual(
        driftSegments.map(segment => (
            `${segment.sectionKey}:${segment.terrainType}[${segment.polygonIndex}:${segment.segmentIndex}] ` +
            `${segment.distanceA.toFixed(6)},${segment.distanceB.toFixed(6)}`
        )),
        [],
        `${label}: section seam-adjacent segments must lie exactly on the section boundary`
    );
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

test("terrain repair lattice preserves hex corners and snaps emitted rings", () => {
    const map = createTerrainPatchMap();
    const hexCorners = map.getGroundTerrainHexCorners(map.nodes[4][4]);
    for (let i = 0; i < hexCorners.length; i++) {
        assertTestPointOnRepairLattice(map, hexCorners[i], `hex corner ${i}`);
    }

    const basis = map.getGroundTerrainRepairLatticeBasis();
    const minEdgeLength = map.getGroundTerrainRepairMinimumEdgeLength();
    const rawRing = [
        { x: basis.xStep * 0.1, y: basis.yStep * 0.1 },
        { x: basis.xStep * 0.2, y: basis.yStep * 0.2 },
        { x: basis.xStep * 8.1, y: basis.yStep * 0.1 },
        { x: basis.xStep * 8.1, y: basis.yStep * 8.1 },
        { x: basis.xStep * 0.1, y: basis.yStep * 8.1 }
    ];
    const snapped = map.getGroundTerrainRepairSnappedRingPoints(rawRing);

    assert.equal(snapped.length, 4);
    for (let i = 0; i < snapped.length; i++) {
        assertTestPointOnRepairLattice(map, snapped[i], `snapped ring point ${i}`);
        const next = snapped[(i + 1) % snapped.length];
        const length = Math.hypot(next.x - snapped[i].x, next.y - snapped[i].y);
        assert.ok(length >= minEdgeLength - 1e-9, `snapped ring edge ${i} is below repair-lattice length`);
    }
});

test("prototype section coarse hexes meet exactly at shared edges", () => {
    const basis = sectionGeometry.getSectionBasisVectors(50);
    const rawSectionCorners = (axial) => {
        const selfWorld = sectionGeometry.offsetToWorld(sectionGeometry.axialToEvenQOffset(axial));
        const neighborWorlds = sectionGeometry.SECTION_DIRECTIONS.map(direction => sectionGeometry.offsetToWorld(
            sectionGeometry.axialToEvenQOffset({
                q: Number(axial.q) + (Number(direction.q) * Number(basis.qAxis.q)) + (Number(direction.r) * Number(basis.rAxis.q)),
                r: Number(axial.r) + (Number(direction.q) * Number(basis.qAxis.r)) + (Number(direction.r) * Number(basis.rAxis.r))
            })
        ));
        return sectionGeometry.SECTION_DIRECTIONS.map((_, index) => {
            const n1 = neighborWorlds[index];
            const n2 = neighborWorlds[(index + 1) % neighborWorlds.length];
            return {
                x: (Number(selfWorld.x) + Number(n1.x) + Number(n2.x)) / 3,
                y: (Number(selfWorld.y) + Number(n1.y) + Number(n2.y)) / 3
            };
        });
    };
    const pointKey = (point) => `${Math.round(Number(point.x) * 1000000)},${Math.round(Number(point.y) * 1000000)}`;
    const edgeKey = (a, b) => {
        const ak = pointKey(a);
        const bk = pointKey(b);
        return ak < bk ? `${ak}:${bk}` : `${bk}:${ak}`;
    };
    const sectionAxialForCoord = (coord) => sectionGeometry.computeSectionCenterAxial(coord, basis, { q: 0, r: 0 });
    const polygonCache = new NativeMap();
    const getSectionCornersForCoord = (coord) => {
        const key = `${coord.q},${coord.r}`;
        if (!polygonCache.has(key)) {
            polygonCache.set(key, sectionGeometry.getSectionHexagonCorners(sectionAxialForCoord(coord), basis));
        }
        return polygonCache.get(key);
    };
    const originAxial = sectionAxialForCoord({ q: 0, r: 0 });
    const originRawCorners = rawSectionCorners(originAxial);
    const originCorners = getSectionCornersForCoord({ q: 0, r: 0 });
    assert.equal(originCorners.length, 6);
    for (let i = 0; i < originCorners.length; i++) {
        assert.ok(
            Math.abs(Number(originCorners[i].x) - Number(originRawCorners[i].x)) <= 1e-9,
            `section corner ${i} x should use the original centroid boundary`
        );
        assert.ok(
            Math.abs(Number(originCorners[i].y) - Number(originRawCorners[i].y)) <= 1e-9,
            `section corner ${i} y should use the original centroid boundary`
        );
    }
    for (let q = -2; q <= 2; q++) {
        for (let r = -2; r <= 2; r++) {
            const sectionCorners = getSectionCornersForCoord({ q, r });
            const sectionEdges = new NativeSet(sectionCorners.map((point, index) => (
                edgeKey(point, sectionCorners[(index + 1) % sectionCorners.length])
            )));
            for (let directionIndex = 0; directionIndex < sectionGeometry.SECTION_DIRECTIONS.length; directionIndex++) {
                const direction = sectionGeometry.SECTION_DIRECTIONS[directionIndex];
                const neighborCoord = { q: q + direction.q, r: r + direction.r };
                const neighborSectionCorners = getSectionCornersForCoord(neighborCoord);
                let sharedEdgeCount = 0;
                for (let i = 0; i < neighborSectionCorners.length; i++) {
                    if (sectionEdges.has(edgeKey(neighborSectionCorners[i], neighborSectionCorners[(i + 1) % neighborSectionCorners.length]))) {
                        sharedEdgeCount += 1;
                    }
                }
                assert.equal(
                    sharedEdgeCount,
                    1,
                    `section ${q},${r} should share exactly one complete edge with adjacent section ${neighborCoord.q},${neighborCoord.r}`
                );
            }
        }
    }
});

test("terrain section clip polygons preserve raw section boundary coordinates", () => {
    const { map, assetsByKey } = createTerrainModelFixture("two", 30, 24);
    const leftAsset = assetsByKey.get("left");
    const rightAsset = assetsByKey.get("right");
    const leftClip = map.getGroundTerrainSectionClipPolygonPoints("left", leftAsset);
    const rightClip = map.getGroundTerrainSectionClipPolygonPoints("right", rightAsset);
    const sharedEdge = collectTestSharedSectionEdges(assetsByKey).find(edge => (
        (edge.keyA === "left" && edge.keyB === "right") ||
        (edge.keyA === "right" && edge.keyB === "left")
    ));
    assert.ok(sharedEdge, "two-section fixture should have at least one shared tile edge");
    const rawSharedA = sharedEdge.a;
    const rawSharedB = sharedEdge.b;
    const hasBoundaryPoint = (ring, point) => testRingCoversPointBoundary(ring, Number(point.x), Number(point.y), 1e-9);

    assert.ok(hasBoundaryPoint(leftClip, rawSharedA), "left terrain clip should use raw shared section endpoint A");
    assert.ok(hasBoundaryPoint(leftClip, rawSharedB), "left terrain clip should use raw shared section endpoint B");
    assert.ok(hasBoundaryPoint(rightClip, rawSharedA), "right terrain clip should use raw shared section endpoint A");
    assert.ok(hasBoundaryPoint(rightClip, rawSharedB), "right terrain clip should use raw shared section endpoint B");

    const rawOffLattice = [
        { x: 0.013, y: 0.017 },
        { x: 10.333333333333, y: 0.017 },
        { x: 10.333333333333, y: 8.666666666667 },
        { x: 0.013, y: 8.666666666667 }
    ];
    const offLatticeClip = map.getGroundTerrainSectionClipPolygonPoints("raw-off-lattice", {
        sectionPolygon: rawOffLattice
    });
    assert.equal(offLatticeClip.length, rawOffLattice.length);
    for (let i = 0; i < rawOffLattice.length; i++) {
        assert.equal(Number(offLatticeClip[i].x), Number(rawOffLattice[i].x));
        assert.equal(Number(offLatticeClip[i].y), Number(rawOffLattice[i].y));
    }
    assert.notDeepEqual(
        offLatticeClip[0],
        map.getGroundTerrainCanonicalRepairPoint(rawOffLattice[0]),
        "section clip endpoints must not be repair-lattice snapped"
    );
});

test("terrain section split edges carry section-boundary metadata", () => {
    const { map, assetsByKey } = createTerrainModelFixture("two", 30, 24);
    const leftAsset = assetsByKey.get("left");
    const sectionRing = map.getGroundTerrainSectionClipPolygonPoints("left", leftAsset);
    const sharedEdge = collectTestSharedSectionEdges(assetsByKey).find(edge => (
        (edge.keyA === "left" && edge.keyB === "right") ||
        (edge.keyA === "right" && edge.keyB === "left")
    ));
    assert.ok(sharedEdge, "two-section fixture should have at least one shared tile edge");
    const sharedA = sharedEdge.a;
    const sharedB = sharedEdge.b;
    const dx = Number(sharedB.x) - Number(sharedA.x);
    const dy = Number(sharedB.y) - Number(sharedA.y);
    const length = Math.hypot(dx, dy);
    assert.ok(length > 0.1, "shared section edge should have useful length");
    const ux = dx / length;
    const uy = dy / length;
    const nx = -uy;
    const ny = ux;
    const center = {
        x: (Number(sharedA.x) + Number(sharedB.x)) * 0.5,
        y: (Number(sharedA.y) + Number(sharedB.y)) * 0.5
    };
    const along = Math.min(0.08, length * 0.2);
    const across = 0.25;
    const crossingGeometry = [[[
        [center.x - ux * along - nx * across, center.y - uy * along - ny * across],
        [center.x + ux * along - nx * across, center.y + uy * along - ny * across],
        [center.x + ux * along + nx * across, center.y + uy * along + ny * across],
        [center.x - ux * along + nx * across, center.y - uy * along + ny * across],
        [center.x - ux * along - nx * across, center.y - uy * along - ny * across]
    ]]];
    const clipped = polygonClipping.intersection(
        crossingGeometry,
        map.getGroundTerrainSectionClipGeometry("left", leftAsset)
    );
    const splitPolygons = map.groundTerrainSectionSplitClipGeometryToPolygons("water", clipped, {
        sectionKey: "left",
        sectionRing
    });
    assert.equal(splitPolygons.length, 1);
    const split = splitPolygons[0];
    assert.equal(split._groundTerrainPreserveBoundaryVertices, true);
    assert.equal(split._groundTerrainSectionKey, "left");
    assert.ok(Array.isArray(split._groundTerrainSectionBoundaryEdges));
    const projectedEdgeLiesOnSharedEdge = (edge) => (
        getTestSectionEdgeProjection(edge && edge.projectedA, sharedA, sharedB, 1e-6) &&
        getTestSectionEdgeProjection(edge && edge.projectedB, sharedA, sharedB, 1e-6)
    );
    const sharedEdgeRecords = split._groundTerrainSectionBoundaryEdges.filter(edge => (
        edge.ringKind === "outer" &&
        projectedEdgeLiesOnSharedEdge(edge)
    ));
    assert.equal(sharedEdgeRecords.length, 1, "section split should tag the exact shared section edge");
    assert.ok(sharedEdgeRecords[0].distanceA <= 1e-9);
    assert.ok(sharedEdgeRecords[0].distanceB <= 1e-9);
    assert.equal(Object.keys(split).includes("_groundTerrainSectionBoundaryEdges"), false);

    const sanitized = map.sanitizeGroundTerrainPatchPolygons([split]);
    assert.equal(sanitized.length, 1);
    assert.ok(
        sanitized[0]._groundTerrainSectionBoundaryEdges.some(edge => (
            edge.ringKind === "outer" &&
            projectedEdgeLiesOnSharedEdge(edge)
        )),
        "terrain patch sanitization should preserve section-boundary edge metadata"
    );

    const persisted = JSON.parse(JSON.stringify(split));
    const normalized = map.normalizeGroundTerrainSectionSourcePolygons("left", leftAsset, [persisted]);
    assert.equal(normalized.length, 1);
    const rehydrated = normalized[0];
    assert.equal(rehydrated._groundTerrainSectionKey, "left");
    assert.ok(
        rehydrated._groundTerrainSectionBoundaryEdges.some(edge => (
            edge.ringKind === "outer" &&
            projectedEdgeLiesOnSharedEdge(edge) &&
            edge.distanceA <= 1e-9 &&
            edge.distanceB <= 1e-9
        )),
        "section source normalization should rebuild section-boundary edge metadata"
    );
});

const CROSS_SECTION_SEAM_CASES = [
    {
        name: "vertical wide water rectangle",
        createFixture: () => createTerrainModelFixture("two", 30, 24),
        edits: () => rectTerrainEdits(11, 19, 6, 12, "water")
    },
    {
        name: "vertical tall water rectangle",
        createFixture: () => createTerrainModelFixture("two", 30, 24),
        edits: () => rectTerrainEdits(13, 17, 3, 18, "water")
    },
    {
        name: "vertical water ellipse",
        createFixture: () => createTerrainModelFixture("two", 30, 24),
        edits: () => ellipseTerrainEdits(15, 11, 6, 5, "water")
    },
    {
        name: "vertical water diamond",
        createFixture: () => createTerrainModelFixture("two", 30, 24),
        edits: () => diamondTerrainEdits(15, 11, 7, 6, "water")
    },
    {
        name: "vertical diagonal water band",
        createFixture: () => createTerrainModelFixture("two", 30, 24),
        edits: () => diagonalBandTerrainEdits(8, 22, 5, 16, 0.45, 3.25, 2.25, "water")
    },
    {
        name: "vertical water lake with mud island",
        createFixture: () => createTerrainModelFixture("two", 30, 24),
        edits: () => [
            ...rectTerrainEdits(10, 20, 5, 15, "water"),
            ...ellipseTerrainEdits(15, 10, 2, 2, "mud")
        ]
    },
    {
        name: "diagonal wide water rectangle",
        createFixture: () => createDiagonalSectionTerrainModelFixture(30, 24),
        edits: () => rectTerrainEdits(11, 19, 6, 12, "water")
    },
    {
        name: "diagonal shifted water rectangle",
        createFixture: () => createDiagonalSectionTerrainModelFixture(30, 24),
        edits: () => rectTerrainEdits(10, 21, 8, 14, "water")
    },
    {
        name: "diagonal water lake with mud island",
        createFixture: () => createDiagonalSectionTerrainModelFixture(30, 24),
        edits: () => [
            ...rectTerrainEdits(9, 21, 5, 15, "water"),
            ...diamondTerrainEdits(15, 10, 3, 3, "mud")
        ]
    },
    {
        name: "three-section water blob across corner",
        createFixture: () => createTerrainModelFixture("three", 30, 24),
        edits: () => ellipseTerrainEdits(15, 12, 7, 6, "water")
    }
];

for (const scenario of CROSS_SECTION_SEAM_CASES) {
    test(`terrain cross-section seam edges stay exact: ${scenario.name}`, () => {
        const fixture = scenario.createFixture();
        const deterministicSolver = require("../scripts/terrain-bubble-deterministic-solver");
        fixture.map.getGroundTerrainDeterministicSolver = () => deterministicSolver;

        paintTerrainModelEdits(fixture, scenario.edits());

        assertCrossSectionTerrainSeamsAreExact(fixture, scenario.name);
    });
}

test("terrain one-tile diagonal seam extension does not subtract nonmatching geometry outside repair bubble", () => {
    const initialEdits = rectTerrainEdits(11, 19, 6, 12, "water");
    const candidates = [
        [19, 13],
        [20, 13],
        [19, 14],
        [20, 14],
        [18, 13],
        [21, 13],
        [18, 14],
        [21, 14]
    ];
    const failures = [];

    for (const [x, y] of candidates) {
        const fixture = createDiagonalSectionTerrainModelFixture(30, 24);
        const deterministicSolver = require("../scripts/terrain-bubble-deterministic-solver");
        fixture.map.getGroundTerrainDeterministicSolver = () => deterministicSolver;
        paintTerrainModelEdits(fixture, initialEdits);
        assertCrossSectionTerrainSeamsAreExact(fixture, `before one-tile seam extension ${x},${y}`);

        const map = fixture.map;
        let currentPatch = null;
        const outsideCutters = [];
        const originalBuildPatch = map.buildGroundTerrainDeterministicBubblePatch;
        const originalUnion = map.unionGroundTerrainClipGeometries;
        map.buildGroundTerrainDeterministicBubblePatch = function(node, terrainType, sourceRecords) {
            currentPatch = originalBuildPatch.call(this, node, terrainType, sourceRecords);
            return currentPatch;
        };
        map.unionGroundTerrainClipGeometries = function(geometries, label) {
            const result = originalUnion.call(this, geometries, label);
            if (/^terrain deterministic patch nonmatching /.test(String(label || "")) && currentPatch) {
                const outside = polygonClipping.difference(result, currentPatch.repairGeometry);
                const outsideArea = getTestClipGeometryArea(outside);
                if (outsideArea > 1e-9) {
                    outsideCutters.push({
                        label: String(label),
                        outsideArea: Number(outsideArea.toFixed(9))
                    });
                }
            }
            return result;
        };

        const node = map.nodes[x] && map.nodes[x][y];
        assert.ok(node, `candidate node ${x},${y} should exist`);
        if (fixture.paintNode(node, "water") === false) continue;
        if (outsideCutters.length > 0) {
            failures.push(`${x},${y}: ${outsideCutters.map(record => `${record.label} outside=${record.outsideArea}`).join("; ")}`);
        }
    }

    assert.deepEqual(
        failures,
        [],
        "one-tile diagonal seam extensions must not subtract nonmatching 19-tile bubble geometry outside the 7-tile repair bubble"
    );
});

test("terrain diagonal shifted lake keeps seam exact after each one-tile paint", () => {
    const fixture = createDiagonalSectionTerrainModelFixture(30, 24);
    const deterministicSolver = require("../scripts/terrain-bubble-deterministic-solver");
    fixture.map.getGroundTerrainDeterministicSolver = () => deterministicSolver;
    const edits = rectTerrainEdits(10, 21, 8, 14, "water");
    const failures = [];
    const getSharedIntervalSummary = () => {
        const records = [];
        for (const sharedEdge of collectTestSharedSectionEdges(fixture.assetsByKey)) {
            const assetA = fixture.assetsByKey.get(sharedEdge.keyA);
            const assetB = fixture.assetsByKey.get(sharedEdge.keyB);
            const intervalsA = collectTestSectionSeamIntervalsForAsset(assetA, sharedEdge);
            const intervalsB = collectTestSectionSeamIntervalsForAsset(assetB, sharedEdge);
            const types = new NativeSet([...intervalsA.keys(), ...intervalsB.keys()]);
            for (const type of types) {
                records.push(
                    `${sharedEdge.keyA}/${sharedEdge.keyB} ${type}: ` +
                    `${(intervalsA.get(type) || []).join("|") || "(none)"} != ` +
                    `${(intervalsB.get(type) || []).join("|") || "(none)"}`
                );
            }
        }
        return records.sort();
    };
    const hasSharedTerrainInterval = () => {
        for (const sharedEdge of collectTestSharedSectionEdges(fixture.assetsByKey)) {
            const assetA = fixture.assetsByKey.get(sharedEdge.keyA);
            const assetB = fixture.assetsByKey.get(sharedEdge.keyB);
            const intervalsA = collectTestSectionSeamIntervalsForAsset(assetA, sharedEdge);
            const intervalsB = collectTestSectionSeamIntervalsForAsset(assetB, sharedEdge);
            for (const intervals of [...intervalsA.values(), ...intervalsB.values()]) {
                if (intervals.length > 0) return true;
            }
        }
        return false;
    };

    for (let i = 0; i < edits.length; i++) {
        const [x, y, terrainType] = edits[i];
        const map = fixture.map;
        const paintDiagnostics = {
            editIndex: i,
            coord: `${x},${y}`,
            nodeSection: "",
            repairSections: [],
            bubbleTypes: [],
            nonmatchingWaterSubtractions: 0,
            beforeIntervals: getSharedIntervalSummary(),
            afterIntervals: [],
            splitOutputs: []
        };
        const originalBuildPatch = map.buildGroundTerrainDeterministicBubblePatch;
        const originalUnion = map.unionGroundTerrainClipGeometries;
        map.buildGroundTerrainDeterministicBubblePatch = function(node, nextType, sourceRecords) {
            const patch = originalBuildPatch.call(this, node, nextType, sourceRecords);
            const countsByType = new NativeMap();
            for (const polygon of Array.isArray(patch && patch.polygons) ? patch.polygons : []) {
                countsByType.set(polygon.type, (countsByType.get(polygon.type) || 0) + 1);
            }
            const repairSectionKeys = new NativeSet();
            for (const repairNode of Array.isArray(patch && patch.repairNodes) ? patch.repairNodes : []) {
                const key = typeof repairNode._prototypeSectionKey === "string" && repairNode._prototypeSectionKey.length > 0
                    ? repairNode._prototypeSectionKey
                    : "";
                if (key) repairSectionKeys.add(key);
            }
            paintDiagnostics.repairSections = Array.from(repairSectionKeys).sort();
            paintDiagnostics.bubbleTypes = Array.from(countsByType.entries())
                .map(([type, count]) => `${type}:${count}`)
                .sort();
            return patch;
        };
        map.unionGroundTerrainClipGeometries = function(geometries, label) {
            if (String(label || "") === "terrain deterministic patch nonmatching water") {
                paintDiagnostics.nonmatchingWaterSubtractions += 1;
            }
            return originalUnion.call(this, geometries, label);
        };
        map._debugGroundTerrainPatchDiagnosticHook = (record) => {
            if (record && record.stage === "section-split-output") {
                paintDiagnostics.splitOutputs.push(
                    `${record.sectionKey}:${record.terrainType}:${(record.polygons || []).length}`
                );
            }
        };

        try {
            const node = map.nodes[x] && map.nodes[x][y];
            assert.ok(node, `candidate node ${x},${y} should exist`);
            paintDiagnostics.nodeSection = node._prototypeSectionKey || "";
            fixture.paintNode(map.nodes[x][y], terrainType);
            paintDiagnostics.afterIntervals = getSharedIntervalSummary();
            if (hasSharedTerrainInterval()) {
                assertCrossSectionTerrainSeamsAreExact(fixture, `diagonal shifted lake after edit ${i} ${x},${y}`);
            }
        } catch (err) {
            failures.push(
                `${paintDiagnostics.coord}: ${err && err.message ? err.message : err}; ` +
                `nodeSection=${paintDiagnostics.nodeSection || "(none)"}; ` +
                `repairSections=${paintDiagnostics.repairSections.join(",") || "(none)"}; ` +
                `bubble=${paintDiagnostics.bubbleTypes.join(",") || "(none)"}; ` +
                `nonmatchingWaterSubtractions=${paintDiagnostics.nonmatchingWaterSubtractions}; ` +
                `before=${paintDiagnostics.beforeIntervals.join(" / ") || "(none)"}; ` +
                `after=${paintDiagnostics.afterIntervals.join(" / ") || "(none)"}; ` +
                `splitOutputs=${paintDiagnostics.splitOutputs.join(",") || "(none)"}`
            );
            break;
        } finally {
            map.buildGroundTerrainDeterministicBubblePatch = originalBuildPatch;
            map.unionGroundTerrainClipGeometries = originalUnion;
            map._debugGroundTerrainPatchDiagnosticHook = null;
        }
    }

    assert.deepEqual(
        failures,
        [],
        "painting a diagonal shifted lake one tile at a time must not move the opposite section seam"
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

test("terrain patch sanitization drops holes collapsed by repair-lattice snapping", () => {
    const map = createTerrainPatchMap();
    const polygons = map.sanitizeGroundTerrainPatchPolygons([{
        type: "mud",
        points: [
            { x: 0, y: 0 },
            { x: 4, y: 0 },
            { x: 4, y: 4 },
            { x: 0, y: 4 }
        ],
        holes: [[
            { x: 1.0001, y: 1.0001 },
            { x: 1.0002, y: 1.0001 },
            { x: 1.0001, y: 1.0002 }
        ]]
    }]);

    assert.equal(polygons.length, 1);
    assert.equal(Array.isArray(polygons[0].holes), false);
    assert.doesNotThrow(() => map.groundTerrainPolygonToClipGeometry(polygons[0]));
});

test("terrain polygon tile assignment paints hexes with centers inside", () => {
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

test("terrain polygon tile assignment paints hexes even when only their centers are inside", () => {
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
    assert.equal(result.assignedCount, 1);
    assert.equal(map.getGroundTerrainTypeForNode(node), "mud");
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

test("terrain brush batch uses two repair rings plus one context ring", () => {
    const fixture = createTerrainModelFixture("none", 34, 34);
    const { map } = fixture;
    const deterministicSolver = require("../scripts/terrain-bubble-deterministic-solver");
    let solverInput = null;
    map.getGroundTerrainDeterministicSolver = () => ({
        generateDeterministicTerrainBubblePolygons(input) {
            solverInput = input;
            return deterministicSolver.generateDeterministicTerrainBubblePolygons(input);
        }
    });

    const center = map.nodes[17][17];
    const brushNodes = map.collectGroundTerrainDeterministicBubbleNodes(center, 2)
        .map(record => record.node);
    assert.equal(brushNodes.length, 19);

    assert.equal(map.replaceGroundTerrainPolygonPatch(center, "water", {
        editedNodes: brushNodes,
        repairRadius: 4
    }), true);

    assert.ok(solverInput, "terrain brush batch should call the deterministic solver once");
    assert.equal(solverInput.innerKeys.length, 61, "size-3 brush should repair the footprint plus two rings");
    assert.equal(solverInput.tiles.length, 91, "repair bubble should include one additional context ring");
    for (const node of brushNodes) {
        assert.equal(map.getGroundTerrainTypeForNode(node), "water");
    }
});

test("terrain polygon patch repair excludes off-repair source polygons", () => {
    const fixture = createTerrainModelFixture("one", 30, 24);
    const { map, assetsByKey } = fixture;
    const deterministicSolver = require("../scripts/terrain-bubble-deterministic-solver");
    map.getGroundTerrainDeterministicSolver = () => deterministicSolver;
    const asset = assetsByKey.get("all");
    const farPolygon = {
        type: "mud",
        points: [
            { x: map.nodes[24][18].x - 0.2, y: map.nodes[24][18].y - 0.2 },
            { x: map.nodes[27][18].x + 0.2, y: map.nodes[27][18].y - 0.2 },
            { x: map.nodes[27][21].x + 0.2, y: map.nodes[27][21].y + 0.2 },
            { x: map.nodes[24][21].x - 0.2, y: map.nodes[24][21].y + 0.2 }
        ]
    };
    asset.terrainPolygons = [farPolygon];
    const farSignature = JSON.stringify(map.sanitizeGroundTerrainPatchPolygons([farPolygon])[0].points);
    const originalSynchronize = map.synchronizeGroundTerrainAdjacentPairBoundaryPaths;
    let farPolygonReachedRepair = false;
    map.synchronizeGroundTerrainAdjacentPairBoundaryPaths = function(polygons, nodes, bounds, options) {
        const source = Array.isArray(polygons) ? polygons : [];
        if (source.some(polygon => polygon && JSON.stringify(polygon.points) === farSignature)) {
            farPolygonReachedRepair = true;
        }
        return originalSynchronize.call(this, polygons, nodes, bounds, options);
    };

    const editedNode = map.nodes[4][4];
    assert.equal(map.replaceGroundTerrainPolygonPatch(editedNode, "desert", {
        asset,
        sectionKey: "all"
    }), true);

    assert.equal(farPolygonReachedRepair, false);
    assert.ok(asset.terrainPolygons.some(polygon => (
        polygon.type === "mud" &&
        JSON.stringify(polygon.points) === farSignature
    )));
});

test("terrain edits preserve explicit grass island when mud or mowed grass touches it", () => {
    const cases = ["mud", "mowedgrass"];
    for (const terrainType of cases) {
        const fixture = createTerrainModelFixture("none", 24, 20);
        const { map } = fixture;
        const deterministicSolver = require("../scripts/terrain-bubble-deterministic-solver");
        map.getGroundTerrainDeterministicSolver = () => deterministicSolver;

        paintTerrainModelEdits(fixture, [
            ...rectTerrainEdits(6, 17, 5, 14, "water"),
            ...rectTerrainEdits(10, 13, 8, 10, "grass"),
            [10, 8, terrainType]
        ]);

        const untouchedIslandNode = map.nodes[13][10];
        assert.equal(
            terrainPolygonsContainingNode(map, map.terrainPolygons, untouchedIslandNode, "water").length,
            0,
            `${terrainType}: untouched grass island node should not be covered by water`
        );
        assert.ok(
            terrainPolygonsContainingNode(map, map.terrainPolygons, untouchedIslandNode, "grass").length > 0,
            `${terrainType}: untouched island area should have explicit grass topology`
        );
        assert.ok(
            terrainPolygonsContainingNode(map, map.terrainPolygons, map.nodes[10][8], terrainType).length > 0,
            `${terrainType}: edited island edge should be covered by the painted terrain`
        );
        assertTerrainModelFixtureInvariants(fixture, `${terrainType} touching grass island`);
    }
});

test("cross-section lake with mud island preserves raw section water/mud borders", () => {
    const fixture = createTerrainModelFixture("two", 30, 24);
    const deterministicSolver = require("../scripts/terrain-bubble-deterministic-solver");
    fixture.map.getGroundTerrainDeterministicSolver = () => deterministicSolver;
    const originalUnion = fixture.map.unionGroundTerrainClipGeometries;
    fixture.map.unionGroundTerrainClipGeometries = function(geometries, label) {
        assert.doesNotMatch(
            String(label || ""),
            /^terrain deterministic patch old /,
            "terrain edits should subtract the repair bubble from old section fragments individually"
        );
        return originalUnion.call(this, geometries, label);
    };

    paintTerrainModelEdits(fixture, [
        ...rectTerrainEdits(11, 19, 6, 12, "water"),
        ...rectTerrainEdits(14, 16, 7, 9, "mud")
    ]);

    assertAllAdjacentNonGrassTerrainPairsSharePolygonBorders(
        fixture.map,
        fixture.logicalPolygons(),
        "cross-section lake island: merged logical polygons should share water/mud borders"
    );
    assertAllAdjacentNonGrassTerrainPairsSharePolygonBorders(
        fixture.map,
        fixture.rawPolygons(),
        "cross-section lake island: raw section polygons should share water/mud borders"
    );
    assertAdjacentTerrainPairCenterlinesCoveredByPolygons(
        fixture.map,
        fixture.rawPolygons(),
        null,
        "cross-section lake island: raw section polygons should cover water/mud centerlines"
    );
});

test("nested terrain polygons keep outer holes contiguous with inner polygon boundaries for every type pair", () => {
    const terrainTypes = ["water", "mud", "grass", "mowedgrass", "desert"];
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
    assert.ok(map.getGroundTerrainEditPriority("desert") > map.getGroundTerrainEditPriority("mowedgrass"));
    assert.ok(map.getGroundTerrainEditPriority("mowedgrass") > map.getGroundTerrainEditPriority("grass"));
    assert.ok(map.getGroundTerrainEditPriority("grass") > map.getGroundTerrainEditPriority("mud"));
    assert.ok(map.getGroundTerrainEditPriority("mud") > map.getGroundTerrainEditPriority("water"));
});

test("mowed grass is a distinct plain grass terrain material", () => {
    const map = createTerrainPatchMap();
    const node = map.nodes[3][3];
    const textureId = map.getGroundTerrainTextureIdForType("mowedgrass", node.xindex, node.yindex);

    assert.equal(textureId, 55);
    node.groundTextureId = textureId;
    assert.equal(map.getGroundTerrainTypeForNode(node), "mowedgrass");
    assert.equal(map.getGroundPolygonMaterialPathForType("mowedgrass"), "/assets/images/terrain/materials/grass.png");
    map.groundPalette = Array.from({ length: 61 }, (_unused, index) => `test-${index}`);
    map.groundTexturePaths = Array.from({ length: 61 }, () => "/assets/images/terrain/materials/grass.png");
    assert.equal(map.getGroundTexturePathForNode(node), "/assets/images/terrain/materials/grass.png");
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

test("water immersion treats exact polygon boundaries as covered water", () => {
    const map = createTerrainPatchMap(4, 4);
    const water = {
        type: "water",
        points: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
            { x: 0, y: 1 }
        ]
    };
    map.terrainPolygons = [water];
    markWaterNodesInsidePolygon(map, water);

    const edge = map.getGroundTerrainWaterImmersionAtPoint(1, 0.5);
    const corner = map.getGroundTerrainWaterImmersionAtPoint(1, 1);

    assert.equal(edge.inWater, true);
    assert.equal(edge.distanceToShore, 0);
    assert.equal(edge.submergedDepth, 0);
    assert.equal(corner.inWater, true);
    assert.equal(corner.distanceToShore, 0);
    assert.equal(corner.submergedDepth, 0);
});

test("road coverage overrides water terrain passability until the road is removed", () => {
    const map = createTerrainPassabilityMap();
    const node = map.nodes[1][1];
    node.groundTextureId = map.getGroundTerrainTextureIdForType("water", node.xindex, node.yindex);

    assert.equal(map.isNodeTerrainImpassableForTraversal(node), true);
    assert.equal(map.recomputeGroundTerrainPassabilityForNode(node), true);
    assert.equal(node.blocked, true);
    assert.equal(node._groundTerrainBlockedForNpcTraversal, true);

    const road = {
        type: "road",
        gone: false,
        blocksTile: false,
        isPassable: true,
        node,
        getNode() { return node; }
    };
    node.addObject(road);
    assert.equal(map.recomputeGroundTerrainPassabilityForRoad(road), true);
    assert.equal(node.blocked, false);
    assert.equal(node._groundTerrainBlockedForNpcTraversal, false);
    assert.equal(map.isNodeTerrainImpassableForTraversal(node), false);

    node.removeObject(road);
    assert.equal(map.recomputeGroundTerrainPassabilityForRoad(road, [node]), true);
    assert.equal(node.blocked, true);
    assert.equal(node._groundTerrainBlockedForNpcTraversal, true);
    assert.equal(map.isNodeTerrainImpassableForTraversal(node), true);

    node.groundTextureId = map.getGroundTerrainTextureIdForType("grass", node.xindex, node.yindex);
    assert.equal(map.recomputeGroundTerrainPassabilityForNode(node), true);
    assert.equal(node.blocked, false);
    assert.equal(node._groundTerrainBlockedForNpcTraversal, false);
    assert.ok(map.clearanceUpdates >= 4);
    assert.ok(map.snapshotDirtyCount >= 4);
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
