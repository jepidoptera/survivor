(function () {
    'use strict';

    const TERRAIN_TYPES = [
        { key: 'grass', label: 'Tall Grass', color: '#4ca044', outline: '#9fe293' },
        { key: 'mowedgrass', label: 'Mowed Grass', color: '#6ebf48', outline: '#c8f0a8' },
        { key: 'water', label: 'Water', color: '#2f91d7', outline: '#d9f3ff' },
        { key: 'mud', label: 'Mud', color: '#8a5b36', outline: '#ffad3d' },
        { key: 'desert', label: 'Desert', color: '#d9bd55', outline: '#fff13f' }
    ];

    const TERRAIN_BY_KEY = new Map(TERRAIN_TYPES.map((type) => [type.key, type]));
    const DIRECTIONS = [
        { q: 1, r: 0 },
        { q: 1, r: -1 },
        { q: 0, r: -1 },
        { q: -1, r: 0 },
        { q: -1, r: 1 },
        { q: 0, r: 1 }
    ];
    const INNER_COORDS = [
        { q: 0, r: 0 },
        ...DIRECTIONS
    ];
    const BUBBLE_COORDS = createBubbleCoords(2);
    const INNER_KEYS = new Set(INNER_COORDS.map(coordKey));
    const HEX_RADIUS = 1;
    const SQRT3 = Math.sqrt(3);
    const VERTEX_HIT_PIXELS = 12;
    const EDGE_HIT_PIXELS = 14;
    const TOPOLOGY_EPSILON = 0.00001;

    const canvas = document.getElementById('bubbleCanvas');
    const ctx = canvas.getContext('2d');
    const terrainButtons = document.getElementById('terrainButtons');
    const togglePolygonListButton = document.getElementById('togglePolygonListButton');
    const polygonList = document.getElementById('polygonList');
    const invariantList = document.getElementById('invariantList');
    const exampleList = document.getElementById('exampleList');
    const jsonPreview = document.getElementById('jsonPreview');
    const statusLine = document.getElementById('statusLine');
    const exampleName = document.getElementById('exampleName');

    const state = {
        mode: 'paint',
        selectedTerrain: 'grass',
        tiles: new Map(BUBBLE_COORDS.map((coord) => [coordKey(coord), 'grass'])),
        polygons: [],
        requiredAnchors: [],
        currentExampleId: '',
        currentExampleName: '',
        currentExampleCreatedAt: '',
        currentExampleEdited: false,
        currentExampleDirty: false,
        selectedPolygonId: null,
        selectedVertexIndex: -1,
        polygonsExpanded: false,
        dragging: null,
        examples: [],
        view: {
            scale: 1,
            offsetX: 0,
            offsetY: 0,
            width: 0,
            height: 0,
            devicePixelRatio: 1
        }
    };

    function coordKey(coord) {
        return `${coord.q},${coord.r}`;
    }

    function axialDistance(coord) {
        return Math.max(Math.abs(coord.q), Math.abs(coord.r), Math.abs(-coord.q - coord.r));
    }

    function createBubbleCoords(radius) {
        const coords = [];
        for (let q = -radius; q <= radius; q++) {
            for (let r = -radius; r <= radius; r++) {
                const coord = { q, r };
                if (axialDistance(coord) <= radius) coords.push(coord);
            }
        }
        return coords.sort((a, b) => axialDistance(a) - axialDistance(b) || a.r - b.r || a.q - b.q);
    }

    function randomItem(items) {
        return items[Math.floor(Math.random() * items.length)];
    }

    function randomTerrainPair() {
        const first = randomItem(TERRAIN_TYPES).key;
        let second = first;
        while (second === first) second = randomItem(TERRAIN_TYPES).key;
        return [first, second];
    }

    function randomTerrainTriple() {
        const terrains = [];
        while (terrains.length < 3) {
            const terrain = randomItem(TERRAIN_TYPES).key;
            if (!terrains.includes(terrain)) terrains.push(terrain);
        }
        return terrains;
    }

    function dotCoord(coord, direction) {
        return coord.q * direction.q + coord.r * direction.r;
    }

    function createNaturalRandomTileMap() {
        const variant = Math.floor(Math.random() * 8);
        const tileMap = new Map();

        if (variant === 0 || variant === 1) {
            const [lowSide, highSide] = randomTerrainPair();
            const direction = randomItem(DIRECTIONS);
            const threshold = variant === 0 ? 0 : 1;
            for (const coord of BUBBLE_COORDS) {
                tileMap.set(coordKey(coord), dotCoord(coord, direction) >= threshold ? highSide : lowSide);
            }
            return tileMap;
        }

        if (variant === 2 || variant === 3) {
            const [background, island] = randomTerrainPair();
            for (const coord of BUBBLE_COORDS) tileMap.set(coordKey(coord), background);
            tileMap.set('0,0', island);
            if (variant === 3) tileMap.set(coordKey(randomItem(DIRECTIONS)), island);
            return tileMap;
        }

        if (variant === 4 || variant === 5) {
            const [background, band] = randomTerrainPair();
            const direction = randomItem(DIRECTIONS);
            for (const coord of BUBBLE_COORDS) {
                tileMap.set(coordKey(coord), Math.abs(dotCoord(coord, direction)) <= (variant === 4 ? 0 : 1) ? band : background);
            }
            return tileMap;
        }

        const [a, b, c] = randomTerrainTriple();
        const primary = randomItem(DIRECTIONS);
        const secondary = DIRECTIONS[(DIRECTIONS.indexOf(primary) + 2) % DIRECTIONS.length];
        for (const coord of BUBBLE_COORDS) {
            const first = dotCoord(coord, primary);
            const second = dotCoord(coord, secondary);
            tileMap.set(coordKey(coord), first >= 1 ? a : second >= 1 ? b : c);
        }
        return tileMap;
    }

    function clonePoint(point) {
        const copy = { x: point.x, y: point.y };
        if (point.anchorId) copy.anchorId = point.anchorId;
        return copy;
    }

    function cloneRing(points) {
        return (Array.isArray(points) ? points : []).map(clonePoint);
    }

    function outputPoint(point) {
        return roundPoint(point);
    }

    function roundNumber(value) {
        return Math.round(value * 1000000) / 1000000;
    }

    function roundPoint(point) {
        return {
            x: roundNumber(point.x),
            y: roundNumber(point.y)
        };
    }

    function axialToModel(coord) {
        return {
            x: SQRT3 * (coord.q + coord.r / 2),
            y: 1.5 * coord.r
        };
    }

    function hexCorners(coord) {
        const center = axialToModel(coord);
        const corners = [];
        for (let i = 0; i < 6; i++) {
            const angle = Math.PI / 180 * (30 + i * 60);
            corners.push({
                x: center.x + Math.cos(angle) * HEX_RADIUS,
                y: center.y + Math.sin(angle) * HEX_RADIUS
            });
        }
        return corners;
    }

    function modelToScreen(point) {
        return {
            x: point.x * state.view.scale + state.view.offsetX,
            y: point.y * state.view.scale + state.view.offsetY
        };
    }

    function screenToModel(point) {
        return {
            x: (point.x - state.view.offsetX) / state.view.scale,
            y: (point.y - state.view.offsetY) / state.view.scale
        };
    }

    function getCanvasPoint(event) {
        const rect = canvas.getBoundingClientRect();
        return {
            x: event.clientX - rect.left,
            y: event.clientY - rect.top
        };
    }

    function pointDistance(a, b) {
        return Math.hypot(a.x - b.x, a.y - b.y);
    }

    function pointKey(point) {
        return `${roundNumber(point.x)},${roundNumber(point.y)}`;
    }

    function edgeKey(a, b) {
        const aKey = pointKey(a);
        const bKey = pointKey(b);
        return aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
    }

    function anchorIdForPoint(point) {
        return `anchor-${pointKey(point).replace(/[^a-zA-Z0-9.-]/g, '_')}`;
    }

    function allSnapPoints() {
        const byKey = new Map();
        for (const coord of BUBBLE_COORDS) {
            const center = roundPoint(axialToModel(coord));
            byKey.set(pointKey(center), center);
            const corners = hexCorners(coord);
            for (let i = 0; i < corners.length; i++) {
                const corner = roundPoint(corners[i]);
                const nextCorner = roundPoint(corners[(i + 1) % corners.length]);
                const midpoint = roundPoint({
                    x: (corner.x + nextCorner.x) / 2,
                    y: (corner.y + nextCorner.y) / 2
                });
                const centerVertexMidpoint = roundPoint({
                    x: (center.x + corner.x) / 2,
                    y: (center.y + corner.y) / 2
                });
                byKey.set(pointKey(corner), corner);
                byKey.set(pointKey(midpoint), midpoint);
                byKey.set(pointKey(centerVertexMidpoint), centerVertexMidpoint);
            }
        }
        return [...byKey.values()];
    }

    function snapPoint(point) {
        const threshold = VERTEX_HIT_PIXELS / state.view.scale;
        let best = null;
        let bestDistance = Infinity;
        for (const snap of allSnapPoints()) {
            const distance = pointDistance(point, snap);
            if (distance < bestDistance) {
                best = snap;
                bestDistance = distance;
            }
        }
        return best && bestDistance <= threshold ? clonePoint(best) : roundPoint(point);
    }

    function pointInPolygon(point, polygonPoints) {
        let inside = false;
        for (let i = 0, j = polygonPoints.length - 1; i < polygonPoints.length; j = i++) {
            const pi = polygonPoints[i];
            const pj = polygonPoints[j];
            const intersects = ((pi.y > point.y) !== (pj.y > point.y)) &&
                (point.x < (pj.x - pi.x) * (point.y - pi.y) / (pj.y - pi.y) + pi.x);
            if (intersects) inside = !inside;
        }
        return inside;
    }

    function pointTouchesPolygonBoundary(point, polygonPoints, epsilon) {
        for (let i = 0; i < polygonPoints.length; i++) {
            const a = polygonPoints[i];
            const b = polygonPoints[(i + 1) % polygonPoints.length];
            if (pointDistance(point, nearestPointOnSegment(point, a, b)) <= epsilon) return true;
        }
        return false;
    }

    function pointInsideOrTouchingPolygon(point, polygonPoints) {
        return pointInPolygon(point, polygonPoints) || pointTouchesPolygonBoundary(point, polygonPoints, 0.00001);
    }

    function pointInsideOrTouchingTerrainPolygon(point, polygon) {
        if (!pointInsideOrTouchingPolygon(point, polygon.points || [])) return false;
        for (const hole of polygon.holes || []) {
            if (pointInPolygon(point, hole) && !pointTouchesPolygonBoundary(point, hole, 0.00001)) return false;
        }
        return true;
    }

    function pointInsideTerrainPolygonInterior(point, polygon) {
        if (!pointInPolygon(point, polygon.points || [])) return false;
        if (pointTouchesPolygonBoundary(point, polygon.points || [], 0.00001)) return false;
        for (const hole of polygon.holes || []) {
            if (pointInPolygon(point, hole) || pointTouchesPolygonBoundary(point, hole, 0.00001)) return false;
        }
        return true;
    }

    function findTileAt(point) {
        for (const coord of BUBBLE_COORDS) {
            if (pointInPolygon(point, hexCorners(coord))) return coord;
        }
        return null;
    }

    function normalizePolygonPoints(points) {
        const normalized = [];
        for (const point of points) {
            const rounded = roundPoint(point);
            const previous = normalized[normalized.length - 1];
            if (!previous || pointDistance(previous, rounded) > 0.000001) {
                normalized.push(rounded);
            }
        }
        if (normalized.length > 1 && pointDistance(normalized[0], normalized[normalized.length - 1]) <= 0.000001) {
            normalized.pop();
        }
        return normalized;
    }

    function polygonSignedArea(points) {
        let area = 0;
        for (let i = 0; i < points.length; i++) {
            const a = points[i];
            const b = points[(i + 1) % points.length];
            area += a.x * b.y - b.x * a.y;
        }
        return area / 2;
    }

    function absolutePolygonArea(points) {
        return Math.abs(polygonSignedArea(points));
    }

    function traceBoundaryLoops(edges) {
        const unused = new Map(edges.map((edge, index) => [index, edge]));
        const loops = [];

        while (unused.size > 0) {
            const firstIndex = unused.keys().next().value;
            const first = unused.get(firstIndex);
            unused.delete(firstIndex);

            const loop = [clonePoint(first.a), clonePoint(first.b)];
            let currentKey = pointKey(first.b);
            const startKey = pointKey(first.a);
            let guard = 0;

            while (currentKey !== startKey && guard < 200) {
                guard++;
                let nextIndex = null;
                let nextEdge = null;
                let reversed = false;

                for (const [index, edge] of unused) {
                    if (pointKey(edge.a) === currentKey) {
                        nextIndex = index;
                        nextEdge = edge;
                        break;
                    }
                    if (pointKey(edge.b) === currentKey) {
                        nextIndex = index;
                        nextEdge = edge;
                        reversed = true;
                        break;
                    }
                }

                if (nextIndex === null) break;
                unused.delete(nextIndex);
                const nextPoint = reversed ? nextEdge.a : nextEdge.b;
                loop.push(clonePoint(nextPoint));
                currentKey = pointKey(nextPoint);
            }

            const normalized = normalizePolygonPoints(loop);
            if (normalized.length >= 3) loops.push(normalized);
        }

        return loops;
    }

    function loopsToTerrainPolygons(type, loops, nextIdStart) {
        const loopRecords = loops
            .map((loop) => ({
                points: polygonSignedArea(loop) < 0 ? loop.slice().reverse() : loop,
                area: absolutePolygonArea(loop)
            }))
            .filter((record) => record.points.length >= 3 && record.area > 0.000001)
            .sort((a, b) => b.area - a.area);

        const polygons = [];
        let nextId = nextIdStart;

        for (const record of loopRecords) {
            const container = loopRecords
                .filter((candidate) => candidate !== record && candidate.area > record.area)
                .sort((a, b) => a.area - b.area)
                .find((candidate) => pointInPolygon(record.points[0], candidate.points));
            if (container) continue;

            polygons.push({
                id: `poly-${nextId++}`,
                type,
                points: record.points,
                holes: []
            });
        }

        for (const record of loopRecords) {
            const owner = polygons
                .filter((polygon) => polygon.points !== record.points && pointInPolygon(record.points[0], polygon.points))
                .sort((a, b) => absolutePolygonArea(a.points) - absolutePolygonArea(b.points))[0];
            if (!owner) continue;
            owner.holes.push(record.points.slice().reverse());
        }

        for (const polygon of polygons) {
            if (polygon.holes.length === 0) delete polygon.holes;
        }

        return { polygons, nextId };
    }

    function tileVertexGroups() {
        const groups = new Map();
        for (const coord of BUBBLE_COORDS) {
            for (const corner of hexCorners(coord)) {
                const point = roundPoint(corner);
                const key = pointKey(point);
                if (!groups.has(key)) {
                    groups.set(key, {
                        point,
                        tiles: []
                    });
                }
                groups.get(key).tiles.push(coord);
            }
        }
        return groups;
    }

    function innerBoundaryEdges() {
        const edges = new Map();
        for (const coord of INNER_COORDS) {
            const corners = hexCorners(coord).map(roundPoint);
            for (let i = 0; i < corners.length; i++) {
                const a = corners[i];
                const b = corners[(i + 1) % corners.length];
                const key = edgeKey(a, b);
                if (!edges.has(key)) {
                    edges.set(key, {
                        endpoints: [a, b],
                        tiles: []
                    });
                }
                edges.get(key).tiles.push(coord);
            }
        }
        return [...edges.values()];
    }

    function terrainPairKey(types) {
        return types.slice().sort().join('|');
    }

    function innerTerrainBoundaryGraphs() {
        const graphs = new Map();
        for (const edge of innerBoundaryEdges()) {
            if (edge.tiles.length !== 2) continue;
            const types = edge.tiles.map((tile) => state.tiles.get(coordKey(tile)));
            if (types[0] === types[1]) continue;
            const pairKey = terrainPairKey(types);
            if (!graphs.has(pairKey)) graphs.set(pairKey, new Map());
            const graph = graphs.get(pairKey);
            const endpointKeys = edge.endpoints.map(pointKey);
            for (const endpoint of edge.endpoints) {
                const key = pointKey(endpoint);
                if (!graph.has(key)) {
                    graph.set(key, {
                        point: endpoint,
                        neighbors: new Set()
                    });
                }
            }
            graph.get(endpointKeys[0]).neighbors.add(endpointKeys[1]);
            graph.get(endpointKeys[1]).neighbors.add(endpointKeys[0]);
        }
        return graphs;
    }

    function createRequiredAnchors() {
        const groups = tileVertexGroups();
        const anchorsByKey = new Map();

        function addAnchor(point, kind) {
            const key = pointKey(point);
            const group = groups.get(key);
            const adjacentTiles = group ? group.tiles : [];
            const adjacentTypes = new Set(adjacentTiles.map((tile) => state.tiles.get(coordKey(tile))));
            const requiredOutputTypes = new Set(
                adjacentTiles
                    .filter((tile) => INNER_KEYS.has(coordKey(tile)))
                    .map((tile) => state.tiles.get(coordKey(tile)))
            );
            if (requiredOutputTypes.size === 0) return;
            const existing = anchorsByKey.get(key);
            if (existing) {
                existing.kind = existing.kind === kind ? kind : 'junction';
                for (const type of adjacentTypes) existing.adjacentTypes.add(type);
                for (const type of requiredOutputTypes) existing.requiredOutputTypes.add(type);
                return;
            }
            anchorsByKey.set(key, {
                id: anchorIdForPoint(point),
                kind,
                source: roundPoint(point),
                point: roundPoint(point),
                adjacentTypes,
                requiredOutputTypes
            });
        }

        for (const group of groups.values()) {
            const innerTiles = group.tiles.filter((tile) => INNER_KEYS.has(coordKey(tile)));
            const terrainTypes = new Set(innerTiles.map((tile) => state.tiles.get(coordKey(tile))));
            if (terrainTypes.size >= 3) {
                addAnchor(group.point, 'three-way');
            }
        }

        for (const graph of innerTerrainBoundaryGraphs().values()) {
            for (const vertex of graph.values()) {
                if (vertex.neighbors.size !== 2) {
                    addAnchor(vertex.point, 'outer-edge');
                }
            }
        }

        return [...anchorsByKey.values()].map((anchor) => ({
            id: anchor.id,
            kind: anchor.kind,
            source: anchor.source,
            point: anchor.point,
            adjacentTypes: [...anchor.adjacentTypes].sort(),
            requiredOutputTypes: [...anchor.requiredOutputTypes].sort()
        }));
    }

    function applyRequiredAnchorsToPolygons(options) {
        const shouldMovePoints = !(options && options.movePoints === false);
        const shouldInsertMissing = !(options && options.insertMissing === false);
        const matchDistance = 0.00001;
        for (const polygon of state.polygons) {
            for (const point of polygon.points) {
                delete point.anchorId;
                const anchor = state.requiredAnchors.find((candidate) => (
                    candidate.requiredOutputTypes.includes(polygon.type) &&
                    (shouldMovePoints
                        ? (
                            pointDistance(point, candidate.source) <= matchDistance ||
                            pointDistance(point, candidate.point) <= matchDistance
                        )
                        : pointDistance(point, candidate.point) <= matchDistance)
                ));
                if (!anchor) continue;
                if (shouldMovePoints) {
                    point.x = anchor.point.x;
                    point.y = anchor.point.y;
                }
                point.anchorId = anchor.id;
            }
        }
        if (!shouldInsertMissing) return;

        for (const polygon of state.polygons) {
            const insertions = [];
            for (const anchor of state.requiredAnchors) {
                if (!anchor.requiredOutputTypes.includes(polygon.type)) continue;
                const hasVertex = polygon.points.some((point) => point.anchorId === anchor.id);
                if (hasVertex) continue;
                for (let i = 0; i < polygon.points.length; i++) {
                    const a = polygon.points[i];
                    const b = polygon.points[(i + 1) % polygon.points.length];
                    if (!pointOnSegment(anchor.point, a, b, matchDistance)) continue;
                    if (pointIsSegmentEndpoint(anchor.point, a, b, matchDistance)) continue;
                    insertions.push({
                        insertAfter: i,
                        anchor
                    });
                    break;
                }
            }
            insertions.sort((a, b) => b.insertAfter - a.insertAfter);
            for (const insertion of insertions) {
                const point = {
                    x: insertion.anchor.point.x,
                    y: insertion.anchor.point.y,
                    anchorId: insertion.anchor.id
                };
                polygon.points.splice(insertion.insertAfter + 1, 0, point);
            }
        }
    }

    function refreshDerivedHoles() {
        for (const polygon of state.polygons) delete polygon.holes;
        for (const polygon of state.polygons) {
            const holes = [];
            for (const other of state.polygons) {
                if (other === polygon || other.type === polygon.type) continue;
                if (!Array.isArray(other.points) || other.points.length < 3) continue;
                if (ringsShareBoundarySegment(other.points, polygon.points || [])) continue;
                const contained = other.points.every((point) => pointInsideOrTouchingPolygon(point, polygon.points || []));
                if (!contained) continue;
                const hole = polygonSignedArea(other.points) > 0
                    ? other.points.slice().reverse().map(clonePoint)
                    : other.points.map(clonePoint);
                holes.push(hole);
            }
            if (holes.length > 0) polygon.holes = holes;
        }
    }

    function ringsShareBoundarySegment(aPoints, bPoints) {
        for (let i = 0; i < aPoints.length; i++) {
            const a0 = aPoints[i];
            const a1 = aPoints[(i + 1) % aPoints.length];
            for (let j = 0; j < bPoints.length; j++) {
                const b0 = bPoints[j];
                const b1 = bPoints[(j + 1) % bPoints.length];
                if (segmentsOverlapWithLength(a0, a1, b0, b1, TOPOLOGY_EPSILON)) return true;
            }
        }
        return false;
    }

    function segmentsOverlapWithLength(a0, a1, b0, b1, epsilon) {
        const adx = a1.x - a0.x;
        const ady = a1.y - a0.y;
        const aLengthSq = adx * adx + ady * ady;
        if (aLengthSq <= epsilon * epsilon) return false;
        const cross0 = adx * (b0.y - a0.y) - ady * (b0.x - a0.x);
        const cross1 = adx * (b1.y - a0.y) - ady * (b1.x - a0.x);
        if (Math.abs(cross0) > epsilon || Math.abs(cross1) > epsilon) return false;

        const t0 = ((b0.x - a0.x) * adx + (b0.y - a0.y) * ady) / aLengthSq;
        const t1 = ((b1.x - a0.x) * adx + (b1.y - a0.y) * ady) / aLengthSq;
        const overlapMin = Math.max(0, Math.min(t0, t1));
        const overlapMax = Math.min(1, Math.max(t0, t1));
        return overlapMax - overlapMin > epsilon;
    }

    function moveAnchor(anchorId, nextPoint) {
        const anchor = state.requiredAnchors.find((candidate) => candidate.id === anchorId);
        if (anchor) anchor.point = roundPoint(nextPoint);
        for (const polygon of state.polygons) {
            for (const point of polygon.points) {
                if (point.anchorId === anchorId) {
                    point.x = nextPoint.x;
                    point.y = nextPoint.y;
                }
            }
        }
    }

    function anchorForPoint(point, terrainType) {
        return state.requiredAnchors.find((anchor) => (
            anchor.requiredOutputTypes.includes(terrainType) &&
            (
                pointDistance(point, anchor.source) <= TOPOLOGY_EPSILON ||
                pointDistance(point, anchor.point) <= TOPOLOGY_EPSILON
            )
        )) || null;
    }

    function attachAnchorIfNeeded(point, polygon) {
        const anchor = anchorForPoint(point, polygon.type);
        if (!anchor) return point;
        point.x = anchor.point.x;
        point.y = anchor.point.y;
        point.anchorId = anchor.id;
        return point;
    }

    function claimAnchorForVertex(polygon, point) {
        const anchor = anchorForPoint(point, polygon.type);
        if (!anchor) return null;
        for (const candidatePolygon of state.polygons) {
            if (!anchor.requiredOutputTypes.includes(candidatePolygon.type)) continue;
            for (const candidatePoint of candidatePolygon.points) {
                const matchesAnchor = (
                    candidatePoint.anchorId === anchor.id ||
                    pointDistance(candidatePoint, point) <= TOPOLOGY_EPSILON ||
                    pointDistance(candidatePoint, anchor.source) <= TOPOLOGY_EPSILON ||
                    pointDistance(candidatePoint, anchor.point) <= TOPOLOGY_EPSILON
                );
                if (!matchesAnchor) continue;
                candidatePoint.x = anchor.point.x;
                candidatePoint.y = anchor.point.y;
                candidatePoint.anchorId = anchor.id;
            }
        }
        point.x = anchor.point.x;
        point.y = anchor.point.y;
        point.anchorId = anchor.id;
        return anchor;
    }

    function refreshAnchorPositionsFromAttachedVertices() {
        for (const anchor of state.requiredAnchors) {
            const attachedPoints = [];
            for (const polygon of state.polygons) {
                for (const point of polygon.points) {
                    if (point.anchorId === anchor.id) attachedPoints.push(point);
                }
            }
            if (attachedPoints.length === 0) continue;
            const first = attachedPoints[0];
            const allTogether = attachedPoints.every((point) => pointDistance(point, first) <= TOPOLOGY_EPSILON);
            if (!allTogether) continue;
            if (pointDistance(first, anchor.point) > TOPOLOGY_EPSILON) {
                anchor.point = roundPoint(first);
            }
        }
    }

    function generateDefaultPolygons() {
        const polygons = [];
        let nextId = 1;

        for (const terrain of TERRAIN_TYPES) {
            const boundaryEdges = new Map();
            for (const coord of INNER_COORDS) {
                const key = coordKey(coord);
                if (state.tiles.get(key) !== terrain.key) continue;
                const corners = hexCorners(coord);
                for (let i = 0; i < corners.length; i++) {
                    const a = roundPoint(corners[i]);
                    const b = roundPoint(corners[(i + 1) % corners.length]);
                    const keyForEdge = edgeKey(a, b);
                    if (boundaryEdges.has(keyForEdge)) {
                        boundaryEdges.delete(keyForEdge);
                    } else {
                        boundaryEdges.set(keyForEdge, { a, b });
                    }
                }
            }

            const loops = traceBoundaryLoops([...boundaryEdges.values()]);
            const terrainPolygons = loopsToTerrainPolygons(terrain.key, loops, nextId);
            polygons.push(...terrainPolygons.polygons);
            nextId = terrainPolygons.nextId;
        }

        state.polygons = polygons;
        refreshDerivedHoles();
        state.requiredAnchors = createRequiredAnchors();
        applyRequiredAnchorsToPolygons();
        state.selectedPolygonId = polygons[0] ? polygons[0].id : null;
        state.selectedVertexIndex = -1;
        refreshUi();
        draw();
    }

    function createNewRandomExample() {
        state.tiles = createNaturalRandomTileMap();
        state.currentExampleId = '';
        state.currentExampleName = '';
        state.currentExampleCreatedAt = '';
        state.currentExampleEdited = false;
        state.currentExampleDirty = true;
        state.selectedPolygonId = null;
        state.selectedVertexIndex = -1;
        exampleName.value = `simple random ${new Date().toISOString().slice(11, 19).replace(/:/g, '')}`;
        generateDefaultPolygons();
        setStatus('New random simple example generated.');
        setMode('edit');
    }

    function selectedPolygon() {
        return state.polygons.find((polygon) => polygon.id === state.selectedPolygonId) || null;
    }

    function findNearestVertex(point) {
        const threshold = VERTEX_HIT_PIXELS / state.view.scale;
        let best = null;
        let bestDistance = Infinity;
        for (const polygon of state.polygons) {
            for (let i = 0; i < polygon.points.length; i++) {
                const distance = pointDistance(point, polygon.points[i]);
                if (distance < bestDistance) {
                    best = { polygon, vertexIndex: i, distance };
                    bestDistance = distance;
                }
            }
        }
        return best && bestDistance <= threshold ? best : null;
    }

    function nearestPointOnSegment(point, a, b) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const lengthSq = dx * dx + dy * dy;
        if (lengthSq <= 0.0000001) return clonePoint(a);
        const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq));
        return {
            x: a.x + dx * t,
            y: a.y + dy * t
        };
    }

    function pointOnSegment(point, a, b, epsilon) {
        const nearest = nearestPointOnSegment(point, a, b);
        return pointDistance(point, nearest) <= epsilon;
    }

    function pointIsSegmentEndpoint(point, a, b, epsilon) {
        return pointDistance(point, a) <= epsilon || pointDistance(point, b) <= epsilon;
    }

    function findSharedVerticesAt(point) {
        const anchorId = point.anchorId || '';
        const shared = [];
        for (const polygon of state.polygons) {
            for (let i = 0; i < polygon.points.length; i++) {
                const candidate = polygon.points[i];
                const matches = anchorId
                    ? candidate.anchorId === anchorId
                    : pointDistance(candidate, point) <= TOPOLOGY_EPSILON;
                if (matches) shared.push({ polygon, vertexIndex: i, point: candidate });
            }
        }
        return shared;
    }

    function findEdgesContainingPoint(point, includeEndpoints) {
        const edges = [];
        for (const polygon of state.polygons) {
            for (let i = 0; i < polygon.points.length; i++) {
                const a = polygon.points[i];
                const b = polygon.points[(i + 1) % polygon.points.length];
                if (!pointOnSegment(point, a, b, TOPOLOGY_EPSILON)) continue;
                if (!includeEndpoints && pointIsSegmentEndpoint(point, a, b, TOPOLOGY_EPSILON)) continue;
                edges.push({ polygon, insertAfter: i, a, b });
            }
        }
        return edges;
    }

    function ensureSharedVertexAt(point) {
        const edges = findEdgesContainingPoint(point, false)
            .sort((a, b) => {
                if (a.polygon.id !== b.polygon.id) return a.polygon.id.localeCompare(b.polygon.id);
                return b.insertAfter - a.insertAfter;
            });
        for (const edge of edges) {
            const alreadyHasPoint = edge.polygon.points.some((candidate) => (
                candidate.anchorId && point.anchorId
                    ? candidate.anchorId === point.anchorId
                    : pointDistance(candidate, point) <= TOPOLOGY_EPSILON
            ));
            if (alreadyHasPoint) continue;
            const inserted = attachAnchorIfNeeded(clonePoint(point), edge.polygon);
            edge.polygon.points.splice(edge.insertAfter + 1, 0, inserted);
        }
        return findSharedVerticesAt(point);
    }

    function findNearestEdge(point) {
        const threshold = EDGE_HIT_PIXELS / state.view.scale;
        const candidatePolygons = selectedPolygon() ? [selectedPolygon()] : state.polygons;
        let best = null;
        let bestDistance = Infinity;

        for (const polygon of candidatePolygons) {
            for (let i = 0; i < polygon.points.length; i++) {
                const a = polygon.points[i];
                const b = polygon.points[(i + 1) % polygon.points.length];
                const closest = nearestPointOnSegment(point, a, b);
                const distance = pointDistance(point, closest);
                if (distance < bestDistance) {
                    best = { polygon, insertAfter: i, point: closest, distance };
                    bestDistance = distance;
                }
            }
        }

        return best && bestDistance <= threshold ? best : null;
    }

    function selectPolygonContaining(point) {
        for (let i = state.polygons.length - 1; i >= 0; i--) {
            const polygon = state.polygons[i];
            if (pointInPolygon(point, polygon.points)) {
                state.selectedPolygonId = polygon.id;
                state.selectedVertexIndex = -1;
                refreshUi();
                draw();
                return true;
            }
        }
        return false;
    }

    function insertVertex(point) {
        const edge = findNearestEdge(point);
        if (!edge) {
            setStatus('No edge nearby.', true);
            return;
        }
        const beforeTotal = countOutputVertices(state.polygons);
        const insertedPoint = snapPoint(edge.point);
        const affectedEdges = findEdgesContainingPoint(edge.point, false);
        if (affectedEdges.length === 0) affectedEdges.push(edge);
        affectedEdges.sort((a, b) => {
            if (a.polygon.id !== b.polygon.id) return a.polygon.id.localeCompare(b.polygon.id);
            return b.insertAfter - a.insertAfter;
        });
        let selectedIndex = -1;
        let insertedCount = 0;
        for (const affectedEdge of affectedEdges) {
            const alreadyHasPoint = affectedEdge.polygon.points.some((candidate) => pointDistance(candidate, insertedPoint) <= TOPOLOGY_EPSILON);
            if (alreadyHasPoint) continue;
            const nextPoint = attachAnchorIfNeeded(clonePoint(insertedPoint), affectedEdge.polygon);
            affectedEdge.polygon.points.splice(affectedEdge.insertAfter + 1, 0, nextPoint);
            insertedCount++;
            if (affectedEdge.polygon.id === edge.polygon.id) selectedIndex = affectedEdge.insertAfter + 1;
        }
        for (const polygon of state.polygons) {
            for (const point of polygon.points) {
                if (pointDistance(point, insertedPoint) <= TOPOLOGY_EPSILON) {
                    claimAnchorForVertex(polygon, point);
                }
            }
        }
        state.selectedPolygonId = edge.polygon.id;
        state.selectedVertexIndex = selectedIndex >= 0 ? selectedIndex : edge.insertAfter + 1;
        if (insertedCount === 0) {
            const existing = findNearestVertex(insertedPoint);
            if (existing) {
                state.selectedPolygonId = existing.polygon.id;
                state.selectedVertexIndex = existing.vertexIndex;
            }
            setStatus(`No new vertex added; snap point already exists at ${pointKey(insertedPoint)}.`, true);
            refreshUi();
            draw();
            return;
        }
        markDirty();
        setStatus(`Vertex added to ${insertedCount} boundary ${insertedCount === 1 ? 'copy' : 'copies'} (${beforeTotal} -> ${countOutputVertices(state.polygons)} vertices).`);
        refreshUi();
        draw();
    }

    function removeSelectedVertex() {
        const polygon = selectedPolygon();
        if (!polygon || state.selectedVertexIndex < 0) return;
        const point = polygon.points[state.selectedVertexIndex];
        claimAnchorForVertex(polygon, point);
        const sharedVertices = ensureSharedVertexAt(point);
        if (sharedVertices.some((entry) => entry.point.anchorId)) {
            setStatus('Required boundary vertex cannot be deleted.', true);
            return;
        }
        const removalsByPolygon = new Map();
        for (const entry of sharedVertices) {
            if (!removalsByPolygon.has(entry.polygon)) removalsByPolygon.set(entry.polygon, []);
            removalsByPolygon.get(entry.polygon).push(entry.vertexIndex);
        }
        for (const [targetPolygon, indices] of removalsByPolygon) {
            const uniqueCount = new Set(indices).size;
            if (targetPolygon.points.length - uniqueCount < 3) {
                setStatus('A polygon needs at least three vertices.', true);
                return;
            }
        }
        for (const [targetPolygon, indices] of removalsByPolygon) {
            const sorted = [...new Set(indices)].sort((a, b) => b - a);
            for (const index of sorted) targetPolygon.points.splice(index, 1);
        }
        state.selectedVertexIndex = Math.min(state.selectedVertexIndex, Math.max(0, polygon.points.length - 1));
        markDirty();
        setStatus(`Removed shared vertex from ${sharedVertices.length} boundary copies.`);
        refreshUi();
        draw();
    }

    function moveSharedVertices(sharedVertices, nextPoint) {
        const moved = new Set();
        for (const entry of sharedVertices) {
            if (moved.has(entry.point)) continue;
            entry.point.x = nextPoint.x;
            entry.point.y = nextPoint.y;
            moved.add(entry.point);
        }
    }

    function prepareDragForVertex(vertex) {
        const point = vertex.polygon.points[vertex.vertexIndex];
        claimAnchorForVertex(vertex.polygon, point);
        const sharedVertices = ensureSharedVertexAt(point);
        if (point.anchorId) {
            for (const entry of sharedVertices) {
                claimAnchorForVertex(entry.polygon, entry.point);
            }
        }
        const refreshedVertexIndex = vertex.polygon.points.findIndex((candidate) => candidate === point);
        if (refreshedVertexIndex < 0) {
            setStatus('Could not find selected vertex after sharing update.', true);
            return null;
        }
        return {
            polygonId: vertex.polygon.id,
            vertexIndex: refreshedVertexIndex,
            anchorId: point.anchorId || '',
            sharedVertices: point.anchorId ? [] : sharedVertices
        };
    }

    function setMode(mode) {
        state.mode = mode;
        for (const button of document.querySelectorAll('.mode-button')) {
            button.classList.toggle('is-active', button.dataset.mode === mode);
        }
        canvas.style.cursor = mode === 'edit' ? 'default' : 'crosshair';
        setStatus(mode === 'edit' ? 'Edit mode.' : 'Paint mode.');
    }

    function setStatus(message, isError) {
        statusLine.textContent = message || '';
        statusLine.classList.toggle('is-error', !!isError);
    }

    function markDirty() {
        state.currentExampleDirty = true;
    }

    function validateInvariants() {
        refreshAnchorPositionsFromAttachedVertices();
        refreshDerivedHoles();
        const problems = [];

        for (const coord of INNER_COORDS) {
            const type = state.tiles.get(coordKey(coord));
            const center = axialToModel(coord);
            const matchingPolygons = state.polygons.filter((polygon) => polygon.type === type);
            if (!matchingPolygons.some((polygon) => pointInsideOrTouchingTerrainPolygon(center, polygon))) {
                problems.push(`${type} polygon does not contain or touch center of tile ${coordKey(coord)}.`);
            }
            for (const polygon of state.polygons) {
                if (polygon.type === type) continue;
                if (pointInsideTerrainPolygonInterior(center, polygon)) {
                    problems.push(`${polygon.type} polygon contains center of ${type} tile ${coordKey(coord)}.`);
                }
            }
        }

        return problems;
    }

    function buildExamplePayload(options) {
        refreshDerivedHoles();
        const forSave = !!(options && options.forSave);
        const name = exampleName.value.trim() || `terrain-bubble-${new Date().toISOString().slice(0, 19)}`;
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'terrain-bubble';
        const edited = forSave ? true : state.currentExampleEdited;
        return {
            schema: 'terrain-bubble-example-v1',
            id: state.currentExampleId || `${slug}-${Date.now()}`,
            name,
            createdAt: state.currentExampleCreatedAt || new Date().toISOString(),
            updatedAt: forSave ? new Date().toISOString() : undefined,
            input: buildCurrentInput(),
            output: {
                schema: 'terrain-bubble-output-v1',
                fills: 'inner-7',
                polygons: state.polygons.map((polygon) => ({
                    type: polygon.type,
                    points: normalizePolygonPoints(polygon.points).map(outputPoint),
                    holes: (polygon.holes || [])
                        .map((hole) => normalizePolygonPoints(hole).map(outputPoint))
                        .filter((hole) => hole.length >= 3)
                }))
            },
            editor: {
                edited,
                generated: !edited,
                savedAt: forSave ? new Date().toISOString() : undefined,
                totalVertices: countOutputVertices(state.polygons),
                polygonVertexCounts: state.polygons.map((polygon, index) => ({
                    index,
                    type: polygon.type,
                    points: normalizePolygonPoints(polygon.points).length
                })),
                requiredAnchors: state.requiredAnchors.map((anchor) => ({
                    id: anchor.id,
                    kind: anchor.kind,
                    source: outputPoint(anchor.source),
                    point: outputPoint(anchor.point),
                    adjacentTypes: anchor.adjacentTypes.slice(),
                    requiredOutputTypes: anchor.requiredOutputTypes.slice()
                }))
            }
        };
    }

    function buildCurrentInput() {
        return {
            schema: 'terrain-bubble-19-v1',
            innerKeys: INNER_COORDS.map(coordKey),
            tiles: BUBBLE_COORDS.map((coord) => ({
                q: coord.q,
                r: coord.r,
                type: state.tiles.get(coordKey(coord))
            }))
        };
    }

    function countOutputVertices(polygons) {
        return polygons.reduce((total, polygon) => (
            total +
            normalizePolygonPoints(polygon.points).length +
            (polygon.holes || []).reduce((holeTotal, hole) => holeTotal + normalizePolygonPoints(hole).length, 0)
        ), 0);
    }

    function exampleVertexSignature(example) {
        if (!example || !example.output || !Array.isArray(example.output.polygons)) return '';
        return example.output.polygons
            .map((polygon) => `${polygon.type}:${Array.isArray(polygon.points) ? polygon.points.length : 0}`)
            .join('|');
    }

    function exampleGeometrySignature(example) {
        if (!example || !example.output || !Array.isArray(example.output.polygons)) return '';
        return example.output.polygons
            .map((polygon) => {
                const points = Array.isArray(polygon.points) ? polygon.points : [];
                const holes = Array.isArray(polygon.holes) ? polygon.holes : [];
                const outer = points.map((point) => {
                    const rounded = roundPoint(point);
                    return `${rounded.x},${rounded.y}`;
                }).join(';');
                const holeSignature = holes.map((hole) => hole.map((point) => {
                    const rounded = roundPoint(point);
                    return `${rounded.x},${rounded.y}`;
                }).join(';')).join('/');
                return `${polygon.type}:${outer}:${holeSignature}`;
            })
            .join('|');
    }

    function updateJsonPreview() {
        jsonPreview.value = JSON.stringify(buildExamplePayload(), null, 2);
    }

    async function saveExample() {
        try {
            const invariantProblems = validateInvariants();
            if (invariantProblems.length > 0) {
                setStatus(`Cannot save: ${invariantProblems[0]}`, true);
                renderInvariantList();
                return;
            }
            const payload = buildExamplePayload({ forSave: true });
            const suggestSolver = document.getElementById('suggestSolver');
            const solver = suggestSolver ? suggestSolver.value : 'calculator';
            const response = await fetch('/api/terrain-bubble-examples', {
                method: 'POST',
                cache: 'no-store',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    example: payload,
                    solver
                })
            });
            const result = await response.json();
            if (!response.ok || !result.ok) {
                throw new Error(result.reason || 'save-failed');
            }
            state.currentExampleId = payload.id;
            state.currentExampleName = payload.name;
            state.currentExampleCreatedAt = payload.createdAt;
            state.currentExampleEdited = true;
            state.currentExampleDirty = false;
            upsertExampleInMemory(result.data || payload);
            await loadExamples();
            const savedExample = state.examples.find((example) => example.id === payload.id);
            const payloadSignature = exampleVertexSignature(payload);
            const savedSignature = exampleVertexSignature(savedExample);
            if (savedExample && payloadSignature !== savedSignature) {
                setStatus(`Save mismatch: sent ${payloadSignature}, loaded ${savedSignature}.`, true);
                return;
            }
            const payloadGeometry = exampleGeometrySignature(payload);
            const savedGeometry = exampleGeometrySignature(savedExample);
            if (savedExample && payloadGeometry !== savedGeometry) {
                setStatus('Save mismatch: loaded geometry differs from saved payload.', true);
                return;
            }
            const learningError = savedExample && savedExample.editor && savedExample.editor.learningError;
            const errorText = learningError && Number.isFinite(Number(learningError.totalDiffArea))
                ? ` Current error ${formatLearningError(Number(learningError.totalDiffArea))}.`
                : '';
            setStatus(`Saved ${payload.name} (${countOutputVertices(payload.output.polygons)} vertices).${errorText}`);
        } catch (error) {
            setStatus(`Save failed: ${error.message}`, true);
        }
    }

    async function loadExamples() {
        try {
            const response = await fetch(`/api/terrain-bubble-examples?t=${Date.now()}`, {
                cache: 'no-store'
            });
            const result = await response.json();
            if (!response.ok || !result.ok) {
                throw new Error(result.reason || 'read-failed');
            }
            state.examples = Array.isArray(result.data.examples) ? result.data.examples : [];
            const current = state.examples.find((example) => example.id === state.currentExampleId);
            if (current) {
                state.currentExampleEdited = !!(current.editor && current.editor.edited);
                state.currentExampleCreatedAt = current.createdAt || state.currentExampleCreatedAt;
            }
            renderExampleList();
        } catch (error) {
            setStatus(`Could not load examples: ${error.message}`, true);
        }
    }

    async function retrainExamples() {
        const retrainButton = document.getElementById('retrainButton');
        const suggestSolver = document.getElementById('suggestSolver');
        const solver = suggestSolver ? suggestSolver.value : 'calculator';
        const solverLabel = solverDisplayLabel(solver);
        try {
            retrainButton.disabled = true;
            setStatus(`Scoring existing examples with ${solverLabel}...`);
            const response = await fetch('/api/terrain-bubble-examples/retrain', {
                method: 'POST',
                cache: 'no-store',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ solver })
            });
            const result = await response.json();
            if (!response.ok || !result.ok) {
                throw new Error(result.reason || 'retrain-failed');
            }
            await loadExamples();
            const highest = result.report && Array.isArray(result.report.rows) && result.report.rows[0]
                ? ` Highest: ${result.report.rows[0].id} (${formatLearningError(result.report.rows[0].totalDiffArea)}).`
                : '';
            const beforeTotal = result.beforeErrorSummary && Number(result.beforeErrorSummary.totalDiffArea);
            const afterTotal = result.afterErrorSummary && Number(result.afterErrorSummary.totalDiffArea);
            const totalText = Number.isFinite(beforeTotal) && Number.isFinite(afterTotal)
                ? ` Total error ${formatLearningError(beforeTotal)} -> ${formatLearningError(afterTotal)} (${formatSignedLearningError(afterTotal - beforeTotal)}).`
                : '';
            const scoredCount = result.report && Number.isFinite(Number(result.report.scoredExampleCount))
                ? Number(result.report.scoredExampleCount)
                : (result.report && Number.isFinite(Number(result.report.exampleCount)) ? Number(result.report.exampleCount) : 0);
            setStatus(`Scored ${scoredCount} existing examples with ${solverLabel}.${totalText}${highest}`);
        } catch (error) {
            setStatus(`Scoring failed: ${error.message}`, true);
        } finally {
            retrainButton.disabled = false;
        }
    }

    async function suggestPolygons() {
        const suggestButton = document.getElementById('suggestButton');
        const suggestSolver = document.getElementById('suggestSolver');
        const solver = suggestSolver ? suggestSolver.value : 'calculator';
        const solverLabel = solverDisplayLabel(solver);
        try {
            suggestButton.disabled = true;
            setStatus(`Generating ${solverLabel} suggestion...`);
            const response = await fetch('/api/terrain-bubble-examples/suggest', {
                method: 'POST',
                cache: 'no-store',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    input: buildCurrentInput(),
                    solver
                })
            });
            const result = await response.json();
            if (!response.ok || !result.ok) {
                throw new Error(result.reason || 'suggest-failed');
            }
            applySuggestedExample(result.data);
            const trainingCount = result.model && result.model.trainedExampleCount
                ? ` trained on ${result.model.trainedExampleCount} examples`
                : '';
            const appliedSolverLabel = solverDisplayLabel(result.solver);
            setStatus(`Applied ${appliedSolverLabel} suggestion${trainingCount}.`);
            setMode('edit');
        } catch (error) {
            setStatus(`Suggest failed: ${error.message}`, true);
        } finally {
            suggestButton.disabled = false;
        }
    }

    function solverDisplayLabel(solver) {
        if (solver === 'binary-vertex') return 'binary vertex';
        if (solver === 'iso-contour') return 'iso-contour';
        if (solver === 'deterministic') return 'deterministic solver';
        return 'calculator';
    }

    function applySuggestedExample(example) {
        if (!example || !example.output || !Array.isArray(example.output.polygons)) {
            throw new Error('invalid-suggestion');
        }
        const suggestedAnchors = Array.isArray(example.editor && example.editor.requiredAnchors)
            ? example.editor.requiredAnchors
            : [];
        state.requiredAnchors = createRequiredAnchors();
        for (const suggestedAnchor of suggestedAnchors) {
            const anchor = state.requiredAnchors.find((candidate) => candidate.id === suggestedAnchor.id);
            if (anchor && suggestedAnchor.point) {
                anchor.point = roundPoint(suggestedAnchor.point);
            }
        }
        state.polygons = example.output.polygons.map((polygon, index) => ({
            id: `poly-${index + 1}`,
            type: polygon.type,
            points: Array.isArray(polygon.points) ? polygon.points.map(clonePoint) : [],
            holes: Array.isArray(polygon.holes) ? polygon.holes.map(cloneRing) : []
        })).filter((polygon) => polygon.points.length >= 3);
        refreshDerivedHoles();
        applyRequiredAnchorsToPolygons({ movePoints: false });
        state.selectedPolygonId = state.polygons[0] ? state.polygons[0].id : null;
        state.selectedVertexIndex = -1;
        markDirty();
        refreshUi();
        draw();
    }

    function upsertExampleInMemory(example) {
        if (!example || !example.id) return;
        const index = state.examples.findIndex((candidate) => candidate.id === example.id);
        if (index >= 0) {
            state.examples[index] = example;
        } else {
            state.examples.push(example);
        }
        renderExampleList();
    }

    function loadExample(example) {
        if (!isCurrentExampleInput(example.input)) {
            setStatus('That example uses the old 13-tile input schema.', true);
            return;
        }
        const tileMap = new Map(BUBBLE_COORDS.map((coord) => [coordKey(coord), 'grass']));
        for (const tile of example.input.tiles) {
            tileMap.set(coordKey(tile), tile.type);
        }
        state.tiles = tileMap;
        state.requiredAnchors = createRequiredAnchors();
        const savedAnchors = Array.isArray(example.editor && example.editor.requiredAnchors)
            ? example.editor.requiredAnchors
            : [];
        for (const savedAnchor of savedAnchors) {
            const anchor = state.requiredAnchors.find((candidate) => candidate.id === savedAnchor.id);
            if (anchor && savedAnchor.point) {
                anchor.point = roundPoint(savedAnchor.point);
            }
        }
        state.polygons = example.output.polygons.map((polygon, index) => ({
            id: `poly-${index + 1}`,
            type: polygon.type,
            points: polygon.points.map(clonePoint),
            holes: Array.isArray(polygon.holes) ? polygon.holes.map(cloneRing) : []
        }));
        refreshDerivedHoles();
        applyRequiredAnchorsToPolygons({ movePoints: false });
        state.selectedPolygonId = state.polygons[0] ? state.polygons[0].id : null;
        state.selectedVertexIndex = -1;
        exampleName.value = example.name || '';
        state.currentExampleId = example.id || '';
        state.currentExampleName = example.name || '';
        state.currentExampleCreatedAt = example.createdAt || '';
        state.currentExampleEdited = !!(example.editor && example.editor.edited);
        state.currentExampleDirty = false;
        setStatus(`Loaded ${example.name || example.id} (${example.editor && example.editor.totalVertices ? example.editor.totalVertices : countOutputVertices(state.polygons)} vertices).`);
        refreshUi();
        draw();
    }

    function isCurrentExampleInput(input) {
        if (!input || input.schema !== 'terrain-bubble-19-v1' || !Array.isArray(input.tiles)) return false;
        const keys = new Set(input.tiles.map(coordKey));
        return BUBBLE_COORDS.every((coord) => keys.has(coordKey(coord)));
    }

    function refreshUi() {
        renderTerrainButtons();
        renderPolygonList();
        renderInvariantList();
        updateJsonPreview();
    }

    function renderTerrainButtons() {
        terrainButtons.innerHTML = '';
        for (const terrain of TERRAIN_TYPES) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'terrain-button';
            button.classList.toggle('is-active', terrain.key === state.selectedTerrain);
            button.dataset.terrain = terrain.key;
            button.innerHTML = `<span class="swatch" style="background:${terrain.color}"></span><span>${terrain.label}</span>`;
            button.addEventListener('click', () => {
                state.selectedTerrain = terrain.key;
                renderTerrainButtons();
            });
            terrainButtons.appendChild(button);
        }
    }

    function renderPolygonList() {
        togglePolygonListButton.textContent = state.polygonsExpanded
            ? `Hide Polygons (${state.polygons.length})`
            : `Show Polygons (${state.polygons.length})`;
        togglePolygonListButton.classList.toggle('is-expanded', state.polygonsExpanded);
        polygonList.classList.toggle('is-collapsed', !state.polygonsExpanded);
        polygonList.innerHTML = '';
        if (!state.polygonsExpanded) return;
        if (state.polygons.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'count-pill';
            empty.textContent = 'No polygons yet.';
            polygonList.appendChild(empty);
            return;
        }
        for (const polygon of state.polygons) {
            const terrain = TERRAIN_BY_KEY.get(polygon.type);
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'polygon-button';
            button.classList.toggle('is-active', polygon.id === state.selectedPolygonId);
            button.innerHTML = `<span><span class="swatch" style="background:${terrain.color}"></span> ${terrain.label}</span><span class="count-pill">${countOutputVertices([polygon])} pts</span>`;
            button.addEventListener('click', () => {
                state.selectedPolygonId = polygon.id;
                state.selectedVertexIndex = -1;
                refreshUi();
                draw();
            });
            polygonList.appendChild(button);
        }
    }

    function renderInvariantList() {
        invariantList.innerHTML = '';
        const problems = validateInvariants();
        if (problems.length === 0) {
            const ok = document.createElement('div');
            ok.className = 'invariant-row is-ok';
            ok.textContent = 'Tile centers covered.';
            invariantList.appendChild(ok);
            return;
        }
        for (const problem of problems.slice(0, 6)) {
            const row = document.createElement('div');
            row.className = 'invariant-row is-error';
            row.textContent = problem;
            invariantList.appendChild(row);
        }
        if (problems.length > 6) {
            const more = document.createElement('div');
            more.className = 'invariant-row is-error';
            more.textContent = `${problems.length - 6} more invariant failures.`;
            invariantList.appendChild(more);
        }
    }

    function renderExampleList() {
        exampleList.innerHTML = '';
        if (state.examples.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'count-pill';
            empty.textContent = 'No saved examples yet.';
            exampleList.appendChild(empty);
            return;
        }
        const sortedExamples = state.examples.slice().sort((a, b) => {
            const aError = exampleLearningErrorValue(a);
            const bError = exampleLearningErrorValue(b);
            if (aError !== bError) return bError - aError;
            return String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''));
        });
        for (const example of sortedExamples) {
            const isCurrent = isCurrentExampleInput(example.input);
            const isEdited = !!(example.editor && example.editor.edited);
            const statusText = isEdited ? 'edited' : 'not edited';
            const errorValue = exampleLearningErrorValue(example);
            const errorBadge = errorValue > 0
                ? `<span class="error-pill" title="learning error">${formatLearningError(errorValue)}</span>`
                : '';
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'example-button';
            button.innerHTML = `<span class="example-title"><span class="status-icon ${isEdited ? 'is-edited' : 'is-unedited'}" title="${statusText}"></span><span>${example.name || example.id}</span></span><span class="example-meta">${errorBadge}<span class="count-pill">${isCurrent ? `${example.output.polygons.length} polygons` : 'old schema'}</span></span>`;
            button.addEventListener('click', () => loadExample(example));
            exampleList.appendChild(button);
        }
    }

    function exampleLearningErrorValue(example) {
        const value = example && example.editor && example.editor.learningError && example.editor.learningError.totalDiffArea;
        return Number.isFinite(Number(value)) ? Number(value) : -1;
    }

    function formatLearningError(value) {
        const absValue = Math.abs(value);
        if (absValue >= 100) return String(Math.round(value));
        if (absValue >= 10) return value.toFixed(1);
        return value.toFixed(2);
    }

    function formatSignedLearningError(value) {
        const sign = value > 0 ? '+' : '';
        return `${sign}${formatLearningError(value)}`;
    }

    function fitView() {
        const bounds = modelBounds();
        const padding = 80;
        const scaleX = (state.view.width - padding * 2) / (bounds.maxX - bounds.minX);
        const scaleY = (state.view.height - padding * 2) / (bounds.maxY - bounds.minY);
        state.view.scale = Math.max(28, Math.min(scaleX, scaleY));
        state.view.offsetX = (state.view.width - (bounds.minX + bounds.maxX) * state.view.scale) / 2;
        state.view.offsetY = (state.view.height - (bounds.minY + bounds.maxY) * state.view.scale) / 2;
    }

    function modelBounds() {
        const points = [];
        for (const coord of BUBBLE_COORDS) points.push(...hexCorners(coord));
        return points.reduce((bounds, point) => ({
            minX: Math.min(bounds.minX, point.x),
            minY: Math.min(bounds.minY, point.y),
            maxX: Math.max(bounds.maxX, point.x),
            maxY: Math.max(bounds.maxY, point.y)
        }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
    }

    function resizeCanvas() {
        const rect = canvas.getBoundingClientRect();
        const devicePixelRatio = window.devicePixelRatio || 1;
        state.view.width = rect.width;
        state.view.height = rect.height;
        state.view.devicePixelRatio = devicePixelRatio;
        canvas.width = Math.max(1, Math.floor(rect.width * devicePixelRatio));
        canvas.height = Math.max(1, Math.floor(rect.height * devicePixelRatio));
        ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
        fitView();
        draw();
    }

    function drawPath(points) {
        if (points.length === 0) return;
        const start = modelToScreen(points[0]);
        ctx.moveTo(start.x, start.y);
        for (let i = 1; i < points.length; i++) {
            const point = modelToScreen(points[i]);
            ctx.lineTo(point.x, point.y);
        }
        ctx.closePath();
    }

    function drawTerrainPolygonPath(polygon) {
        ctx.beginPath();
        drawPath(polygon.points || []);
        for (const hole of polygon.holes || []) drawPath(hole);
    }

    function draw() {
        ctx.clearRect(0, 0, state.view.width, state.view.height);
        refreshDerivedHoles();
        drawTileBubble();
        drawOutputPolygons();
        drawHexGrid();
        drawRequiredAnchors();
        drawSnapVertices();
        updateJsonPreview();
    }

    function drawTileBubble() {
        for (const coord of BUBBLE_COORDS) {
            const typeKey = state.tiles.get(coordKey(coord));
            const terrain = TERRAIN_BY_KEY.get(typeKey);
            ctx.beginPath();
            drawPath(hexCorners(coord));
            ctx.fillStyle = terrain.color;
            ctx.globalAlpha = INNER_KEYS.has(coordKey(coord)) ? 0.22 : 0.2;
            ctx.fill();
            ctx.globalAlpha = 1;
        }
    }

    function drawOutputPolygons() {
        for (const polygon of state.polygons) {
            const terrain = TERRAIN_BY_KEY.get(polygon.type);
            drawTerrainPolygonPath(polygon);
            ctx.fillStyle = terrain.color;
            ctx.globalAlpha = 0.38;
            ctx.fill('evenodd');
            ctx.globalAlpha = 1;
            ctx.lineWidth = polygon.id === state.selectedPolygonId ? 4 : 2;
            ctx.strokeStyle = terrain.outline;
            ctx.stroke();
        }
    }

    function drawHexGrid() {
        for (const coord of BUBBLE_COORDS) {
            const isInner = INNER_KEYS.has(coordKey(coord));
            ctx.beginPath();
            drawPath(hexCorners(coord));
            ctx.lineWidth = isInner ? 1.5 : 1;
            ctx.strokeStyle = isInner ? 'rgba(255,255,255,0.48)' : 'rgba(255,255,255,0.36)';
            ctx.stroke();
        }
    }

    function drawSnapVertices() {
        const polygon = selectedPolygon();
        if (!polygon) return;
        for (let i = 0; i < polygon.points.length; i++) {
            const screen = modelToScreen(polygon.points[i]);
            ctx.beginPath();
            ctx.arc(screen.x, screen.y, i === state.selectedVertexIndex ? 6 : 4, 0, Math.PI * 2);
            ctx.fillStyle = i === state.selectedVertexIndex ? '#ffffff' : '#68b9ff';
            ctx.fill();
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = '#0c1116';
            ctx.stroke();
        }
    }

    function drawRequiredAnchors() {
        for (const anchor of state.requiredAnchors) {
            const screen = modelToScreen(anchor.point);
            ctx.save();
            ctx.translate(screen.x, screen.y);
            ctx.rotate(Math.PI / 4);
            ctx.beginPath();
            ctx.rect(-5, -5, 10, 10);
            ctx.fillStyle = anchor.kind === 'three-way' ? '#ffffff' : '#68b9ff';
            ctx.globalAlpha = 0.92;
            ctx.fill();
            ctx.globalAlpha = 1;
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = '#0c1116';
            ctx.stroke();
            ctx.restore();
        }
    }

    canvas.addEventListener('pointerdown', (event) => {
        const modelPoint = screenToModel(getCanvasPoint(event));
        if (state.mode === 'paint') {
            const tile = findTileAt(modelPoint);
            if (!tile) return;
            state.tiles.set(coordKey(tile), state.selectedTerrain);
            markDirty();
            generateDefaultPolygons();
            setStatus(`Painted ${coordKey(tile)} ${state.selectedTerrain}.`);
            return;
        }

        if (event.shiftKey) {
            insertVertex(modelPoint);
            return;
        }

        const vertex = findNearestVertex(modelPoint);
        if (vertex) {
            const dragState = prepareDragForVertex(vertex);
            if (!dragState) return;
            state.selectedPolygonId = vertex.polygon.id;
            state.selectedVertexIndex = dragState.vertexIndex;
            state.dragging = dragState;
            canvas.setPointerCapture(event.pointerId);
            refreshUi();
            draw();
            return;
        }

        selectPolygonContaining(modelPoint);
    });

    canvas.addEventListener('pointermove', (event) => {
        if (!state.dragging) return;
        const polygon = state.polygons.find((candidate) => candidate.id === state.dragging.polygonId);
        if (!polygon) return;
        const modelPoint = screenToModel(getCanvasPoint(event));
        const nextPoint = snapPoint(modelPoint);
        if (state.dragging.anchorId) {
            moveAnchor(state.dragging.anchorId, nextPoint);
        } else {
            moveSharedVertices(state.dragging.sharedVertices, nextPoint);
        }
        markDirty();
        state.selectedVertexIndex = state.dragging.vertexIndex;
        refreshUi();
        draw();
    });

    canvas.addEventListener('pointerup', (event) => {
        if (state.dragging) {
            canvas.releasePointerCapture(event.pointerId);
            state.dragging = null;
            setStatus('Vertex moved.');
        }
    });

    canvas.addEventListener('pointercancel', () => {
        state.dragging = null;
    });

    window.addEventListener('keydown', (event) => {
        if (event.key === 'Delete' || event.key === 'Backspace') {
            const active = document.activeElement;
            if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
            event.preventDefault();
            removeSelectedVertex();
        }
    });

    for (const button of document.querySelectorAll('.mode-button')) {
        button.addEventListener('click', () => setMode(button.dataset.mode));
    }

    document.getElementById('regenerateButton').addEventListener('click', () => {
        markDirty();
        generateDefaultPolygons();
        setStatus('Default polygons regenerated.');
    });

    document.getElementById('clearSelectionButton').addEventListener('click', () => {
        state.selectedPolygonId = null;
        state.selectedVertexIndex = -1;
        refreshUi();
        draw();
    });

    togglePolygonListButton.addEventListener('click', () => {
        state.polygonsExpanded = !state.polygonsExpanded;
        refreshUi();
    });

    document.getElementById('saveButton').addEventListener('click', saveExample);
    document.getElementById('suggestButton').addEventListener('click', suggestPolygons);
    document.getElementById('newRandomExampleButton').addEventListener('click', createNewRandomExample);
    document.getElementById('retrainButton').addEventListener('click', retrainExamples);
    exampleName.addEventListener('input', updateJsonPreview);
    window.addEventListener('resize', resizeCanvas);

    renderTerrainButtons();
    generateDefaultPolygons();
    loadExamples();
    resizeCanvas();
    setMode('paint');
})();
