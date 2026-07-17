const fs = require('fs');
const path = require('path');

const outputPath = path.join(__dirname, '..', 'public', 'assets', 'data', 'terrain-bubble-examples.json');
const terrainTypes = ['grass', 'mowedgrass', 'water', 'mud', 'desert'];
const directions = [
    { q: 1, r: 0 },
    { q: 1, r: -1 },
    { q: 0, r: -1 },
    { q: -1, r: 0 },
    { q: -1, r: 1 },
    { q: 0, r: 1 }
];
const innerCoords = [{ q: 0, r: 0 }, ...directions];
const bubbleCoords = createBubbleCoords(2);
const innerKeys = new Set(innerCoords.map(coordKey));
const sqrt3 = Math.sqrt(3);

function coordKey(coord) {
    return `${coord.q},${coord.r}`;
}

function roundNumber(value) {
    return Math.round(value * 1000000) / 1000000;
}

function roundPoint(point) {
    return { x: roundNumber(point.x), y: roundNumber(point.y) };
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

function axialToModel(coord) {
    return {
        x: sqrt3 * (coord.q + coord.r / 2),
        y: 1.5 * coord.r
    };
}

function hexCorners(coord) {
    const center = axialToModel(coord);
    const corners = [];
    for (let i = 0; i < 6; i++) {
        const angle = Math.PI / 180 * (30 + i * 60);
        corners.push({
            x: center.x + Math.cos(angle),
            y: center.y + Math.sin(angle)
        });
    }
    return corners;
}

function pointKey(point) {
    return `${roundNumber(point.x)},${roundNumber(point.y)}`;
}

function edgeKey(a, b) {
    const aKey = pointKey(a);
    const bKey = pointKey(b);
    return aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
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

function normalizePolygonPoints(points) {
    const normalized = [];
    for (const point of points) {
        const rounded = roundPoint(point);
        const previous = normalized[normalized.length - 1];
        if (!previous || Math.hypot(previous.x - rounded.x, previous.y - rounded.y) > 0.000001) {
            normalized.push(rounded);
        }
    }
    if (normalized.length > 1) {
        const first = normalized[0];
        const last = normalized[normalized.length - 1];
        if (Math.hypot(first.x - last.x, first.y - last.y) <= 0.000001) normalized.pop();
    }
    return normalized;
}

function traceBoundaryLoops(edges) {
    const unused = new Map(edges.map((edge, index) => [index, edge]));
    const loops = [];
    while (unused.size > 0) {
        const firstIndex = unused.keys().next().value;
        const first = unused.get(firstIndex);
        unused.delete(firstIndex);
        const loop = [first.a, first.b];
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
            loop.push(nextPoint);
            currentKey = pointKey(nextPoint);
        }
        const normalized = normalizePolygonPoints(loop);
        if (normalized.length >= 3) loops.push(normalized);
    }
    return loops;
}

function generateDefaultPolygons(tileTypes) {
    const polygons = [];
    for (const terrain of terrainTypes) {
        const boundaryEdges = new Map();
        for (const coord of innerCoords) {
            if (tileTypes.get(coordKey(coord)) !== terrain) continue;
            const corners = hexCorners(coord);
            for (let i = 0; i < corners.length; i++) {
                const a = roundPoint(corners[i]);
                const b = roundPoint(corners[(i + 1) % corners.length]);
                const key = edgeKey(a, b);
                if (boundaryEdges.has(key)) {
                    boundaryEdges.delete(key);
                } else {
                    boundaryEdges.set(key, { a, b });
                }
            }
        }
        for (const loop of traceBoundaryLoops([...boundaryEdges.values()])) {
            polygons.push({
                type: terrain,
                points: polygonSignedArea(loop) < 0 ? loop.slice().reverse() : loop
            });
        }
    }
    return polygons;
}

function tileVertexGroups() {
    const groups = new Map();
    for (const coord of bubbleCoords) {
        for (const corner of hexCorners(coord)) {
            const point = roundPoint(corner);
            const key = pointKey(point);
            if (!groups.has(key)) groups.set(key, { point, tiles: [] });
            groups.get(key).tiles.push(coord);
        }
    }
    return groups;
}

function innerBoundaryEdges() {
    const edges = new Map();
    for (const coord of bubbleCoords) {
        const corners = hexCorners(coord).map(roundPoint);
        for (let i = 0; i < corners.length; i++) {
            const a = corners[i];
            const b = corners[(i + 1) % corners.length];
            const key = edgeKey(a, b);
            if (!edges.has(key)) edges.set(key, { endpoints: [a, b], tiles: [] });
            edges.get(key).tiles.push(coord);
        }
    }
    return [...edges.values()].filter((edge) => {
        const innerTiles = edge.tiles.filter((tile) => innerKeys.has(coordKey(tile)));
        const outerTiles = edge.tiles.filter((tile) => !innerKeys.has(coordKey(tile)));
        return innerTiles.length === 1 && outerTiles.length >= 1;
    });
}

function createRequiredAnchors(tileTypes) {
    const groups = tileVertexGroups();
    const anchorsByKey = new Map();

    function addAnchor(point, kind) {
        const key = pointKey(point);
        const group = groups.get(key);
        const adjacentTiles = group ? group.tiles : [];
        const adjacentTypes = new Set(adjacentTiles.map((tile) => tileTypes.get(coordKey(tile))));
        const requiredOutputTypes = new Set(
            adjacentTiles
                .filter((tile) => innerKeys.has(coordKey(tile)))
                .map((tile) => tileTypes.get(coordKey(tile)))
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
            id: `anchor-${key.replace(/[^a-zA-Z0-9.-]/g, '_')}`,
            kind,
            source: roundPoint(point),
            point: roundPoint(point),
            adjacentTypes,
            requiredOutputTypes
        });
    }

    for (const group of groups.values()) {
        const hasInnerTile = group.tiles.some((tile) => innerKeys.has(coordKey(tile)));
        const types = new Set(group.tiles.map((tile) => tileTypes.get(coordKey(tile))));
        if (hasInnerTile && types.size >= 3) addAnchor(group.point, 'three-way');
    }

    for (const edge of innerBoundaryEdges()) {
        const types = new Set(edge.tiles.map((tile) => tileTypes.get(coordKey(tile))));
        if (types.size >= 2) {
            addAnchor(edge.endpoints[0], 'outer-edge');
            addAnchor(edge.endpoints[1], 'outer-edge');
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

function seededRandom(seed) {
    let value = seed >>> 0;
    return () => {
        value += 0x6D2B79F5;
        let next = value;
        next = Math.imul(next ^ next >>> 15, next | 1);
        next ^= next + Math.imul(next ^ next >>> 7, next | 61);
        return ((next ^ next >>> 14) >>> 0) / 4294967296;
    };
}

function randomTerrain(random, preferred) {
    if (preferred && random() < 0.58) return preferred;
    return terrainTypes[Math.floor(random() * terrainTypes.length)];
}

function randomTiles(seed) {
    const random = seededRandom(seed);
    const tileTypes = new Map();
    const centerType = terrainTypes[Math.floor(random() * terrainTypes.length)];
    for (const coord of bubbleCoords) {
        const distance = axialDistance(coord);
        const preferred = distance <= 1 ? centerType : tileTypes.get(coordKey({ q: coord.q / 2, r: coord.r / 2 }));
        tileTypes.set(coordKey(coord), randomTerrain(random, preferred));
    }

    const innerTypes = new Set(innerCoords.map((coord) => tileTypes.get(coordKey(coord))));
    if (innerTypes.size < 2) {
        const coord = innerCoords[1 + Math.floor(random() * (innerCoords.length - 1))];
        const nextType = terrainTypes[(terrainTypes.indexOf(centerType) + 1 + Math.floor(random() * 3)) % terrainTypes.length];
        tileTypes.set(coordKey(coord), nextType);
    }

    return tileTypes;
}

function buildExample(index) {
    const tileTypes = randomTiles(1000 + index * 97);
    const createdAt = new Date(Date.UTC(2026, 6, 6, 19, index, 0)).toISOString();
    return {
        schema: 'terrain-bubble-example-v1',
        id: `random-bubble-${String(index).padStart(2, '0')}`,
        name: `random bubble ${String(index).padStart(2, '0')}`,
        createdAt,
        input: {
            schema: 'terrain-bubble-19-v1',
            innerKeys: innerCoords.map(coordKey),
            tiles: bubbleCoords.map((coord) => ({
                q: coord.q,
                r: coord.r,
                type: tileTypes.get(coordKey(coord))
            }))
        },
        output: {
            schema: 'terrain-bubble-output-v1',
            fills: 'inner-7',
            polygons: generateDefaultPolygons(tileTypes)
        },
        editor: {
            edited: false,
            generated: true,
            requiredAnchors: createRequiredAnchors(tileTypes)
        }
    };
}

const library = {
    schema: 'terrain-bubble-examples-v1',
    examples: Array.from({ length: 20 }, (_, index) => buildExample(index + 1))
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(library, null, 2)}\n`, 'utf8');
console.log(`Wrote ${library.examples.length} terrain bubble examples to ${outputPath}`);
