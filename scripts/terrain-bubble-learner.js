const {
    BUBBLE_COORDS,
    DIRECTIONS,
    INNER_COORDS,
    TERRAIN_TYPES,
    axialToModel,
    clipTerrainPolygonsToInnerSeven,
    coordKey,
    generateTerrainBubblePolygons,
    hexCorners,
    roundPoint,
    terrainTilesByKey
} = require("./terrain-bubble-ruleset");

const SQRT3 = Math.sqrt(3);
const TOPOLOGY_EPSILON = 0.00001;
const ROUND_SCALE = 1000000;
const MAX_VERTEX_MOVE_DISTANCE = 0.5 + TOPOLOGY_EPSILON;
const INNER_KEYS = new Set(INNER_COORDS.map(coordKey));
const TERRAIN_PRIORITY = new Map([
    ["water", 0],
    ["mud", 1],
    ["grass", 2],
    ["mowedgrass", 3],
    ["desert", 4]
]);

function roundNumber(value) {
    return Math.round(Number(value) * ROUND_SCALE) / ROUND_SCALE;
}

function pointKey(point) {
    const rounded = roundPoint(point);
    return `${rounded.x},${rounded.y}`;
}

function pointDistance(a, b) {
    return Math.hypot(Number(a.x) - Number(b.x), Number(a.y) - Number(b.y));
}

function axialDistance(coord) {
    return Math.max(Math.abs(coord.q), Math.abs(coord.r), Math.abs(-coord.q - coord.r));
}

function edgeKey(a, b) {
    const aKey = pointKey(a);
    const bKey = pointKey(b);
    return aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
}

function anchorIdForPoint(point) {
    return `anchor-${pointKey(point).replace(/[^a-zA-Z0-9.-]/g, "_")}`;
}

function canonicalTypeList(types) {
    return [...new Set(types)].sort().join("/");
}

function canonicalRoleList(types, roleMap) {
    return [...new Set(types.map((type) => roleMap.get(type) || "unknown"))].sort().join("/");
}

function localTerrainRoleMap(types) {
    const uniqueTypes = [...new Set(types)].sort((a, b) => (
        (TERRAIN_PRIORITY.get(a) || 0) - (TERRAIN_PRIORITY.get(b) || 0) ||
        a.localeCompare(b)
    ));
    const labelsByCount = {
        1: ["only"],
        2: ["lower", "higher"],
        3: ["lowest", "middle", "highest"],
        4: ["lowest", "lower-middle", "upper-middle", "highest"]
    };
    const labels = labelsByCount[uniqueTypes.length] || uniqueTypes.map((_, index) => `rank-${index}`);
    return new Map(uniqueTypes.map((type, index) => [type, labels[index]]));
}

function terrainPriority(type) {
    if (!TERRAIN_PRIORITY.has(type)) {
        throw new Error(`terrain bubble learner got unknown terrain type ${type}`);
    }
    return TERRAIN_PRIORITY.get(type);
}

function deltaKey(delta) {
    return `${roundNumber(delta.x)},${roundNumber(delta.y)}`;
}

function parseDeltaKey(key) {
    const [x, y] = String(key).split(",").map(Number);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error(`terrain bubble learner got invalid delta key ${key}`);
    }
    return { x, y };
}

function axialToCube(coord) {
    return {
        x: Number(coord.q),
        y: -Number(coord.q) - Number(coord.r),
        z: Number(coord.r)
    };
}

function cubeToAxial(cube) {
    return {
        q: roundNumber(cube.x),
        r: roundNumber(cube.z)
    };
}

function modelToCube(point) {
    const r = Number(point.y) / 1.5;
    const q = Number(point.x) / SQRT3 - r / 2;
    return {
        x: q,
        y: -q - r,
        z: r
    };
}

function cubeToModel(cube) {
    return roundPoint({
        x: SQRT3 * (cube.x + cube.z / 2),
        y: 1.5 * cube.z
    });
}

function rotateCubeClockwise(cube) {
    return {
        x: -cube.z,
        y: -cube.x,
        z: -cube.y
    };
}

function reflectCube(cube) {
    return {
        x: cube.z,
        y: cube.y,
        z: cube.x
    };
}

function transformCube(cube, transform) {
    let next = { x: cube.x, y: cube.y, z: cube.z };
    if (transform.reflect) next = reflectCube(next);
    for (let i = 0; i < transform.rotation; i++) next = rotateCubeClockwise(next);
    return next;
}

function transformCoord(coord, transform) {
    const axial = cubeToAxial(transformCube(axialToCube(coord), transform));
    return {
        q: Math.round(axial.q),
        r: Math.round(axial.r)
    };
}

function transformPoint(point, transform) {
    return cubeToModel(transformCube(modelToCube(point), transform));
}

function symmetryTransforms() {
    const transforms = [];
    for (const reflect of [false, true]) {
        for (let rotation = 0; rotation < 6; rotation++) {
            transforms.push({ reflect, rotation });
        }
    }
    return transforms;
}

function transformExampleForTraining(example, transform) {
    const tiles = example.input.tiles.map((tile) => ({
        ...transformCoord(tile, transform),
        type: tile.type
    }));
    const polygons = Array.isArray(example.output && example.output.polygons)
        ? example.output.polygons.map((polygon) => ({
            ...polygon,
            points: polygon.points.map((point) => transformPoint(point, transform)),
            holes: Array.isArray(polygon.holes)
                ? polygon.holes.map((hole) => hole.map((point) => transformPoint(point, transform)))
                : undefined
        }))
        : [];
    const requiredAnchors = Array.isArray(example.editor && example.editor.requiredAnchors)
        ? example.editor.requiredAnchors.map((anchor) => {
            const source = transformPoint(anchor.source, transform);
            return {
                ...anchor,
                id: anchorIdForPoint(source),
                source,
                point: transformPoint(anchor.point, transform)
            };
        })
        : [];
    return {
        ...example,
        id: `${example.id}#${transform.reflect ? "m" : "r"}${transform.rotation}`,
        input: {
            ...example.input,
            tiles
        },
        output: {
            ...(example.output || {}),
            polygons
        },
        editor: {
            ...(example.editor || {}),
            requiredAnchors
        }
    };
}

function augmentExampleSymmetries(example) {
    return symmetryTransforms().map((transform) => transformExampleForTraining(example, transform));
}

function allSnapPoints() {
    const byKey = new Map();
    function add(point, kind) {
        const rounded = roundPoint(point);
        const key = pointKey(rounded);
        if (!byKey.has(key)) byKey.set(key, { ...rounded, kinds: new Set() });
        byKey.get(key).kinds.add(kind);
    }

    for (const coord of BUBBLE_COORDS) {
        const center = roundPoint(axialToModel(coord));
        const corners = hexCorners(coord).map(roundPoint);
        add(center, "center");
        for (let i = 0; i < corners.length; i++) {
            const corner = corners[i];
            const next = corners[(i + 1) % corners.length];
            add(corner, "vertex");
            add({
                x: (corner.x + next.x) / 2,
                y: (corner.y + next.y) / 2
            }, "edge-midpoint");
            add({
                x: corner.x + (next.x - corner.x) / 3,
                y: corner.y + (next.y - corner.y) / 3
            }, "edge-third");
            add({
                x: corner.x + 2 * (next.x - corner.x) / 3,
                y: corner.y + 2 * (next.y - corner.y) / 3
            }, "edge-third");
            add({
                x: (center.x + corner.x) / 2,
                y: (center.y + corner.y) / 2
            }, "center-vertex-midpoint");
            add({
                x: center.x + (corner.x - center.x) / 3,
                y: center.y + (corner.y - center.y) / 3
            }, "center-vertex-third");
            add({
                x: center.x + 2 * (corner.x - center.x) / 3,
                y: center.y + 2 * (corner.y - center.y) / 3
            }, "center-vertex-third");
        }
    }

    return [...byKey.values()].map((snap) => ({
        x: snap.x,
        y: snap.y,
        kinds: [...snap.kinds].sort()
    }));
}

function pointTouchesSegment(point, a, b, epsilon = TOPOLOGY_EPSILON) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq <= epsilon * epsilon) return pointDistance(point, a) <= epsilon;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq));
    const nearest = {
        x: a.x + dx * t,
        y: a.y + dy * t
    };
    return pointDistance(point, nearest) <= epsilon;
}

function nearestPointOnSegment(point, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    if (lengthSq <= TOPOLOGY_EPSILON * TOPOLOGY_EPSILON) return roundPoint(a);
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq));
    return roundPoint({
        x: a.x + dx * t,
        y: a.y + dy * t
    });
}

function pointDistanceToSegment(point, a, b) {
    return pointDistance(point, nearestPointOnSegment(point, a, b));
}

function pointDistanceToPolyline(point, points) {
    if (!Array.isArray(points) || points.length === 0) return Infinity;
    if (points.length === 1) return pointDistance(point, points[0]);
    let best = Infinity;
    for (let i = 0; i < points.length - 1; i++) {
        best = Math.min(best, pointDistanceToSegment(point, points[i], points[i + 1]));
    }
    return best;
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

function ringSignedArea(points) {
    let area = 0;
    for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        area += Number(a.x) * Number(b.y) - Number(b.x) * Number(a.y);
    }
    return area / 2;
}

function pointTouchesRing(point, ring, epsilon = TOPOLOGY_EPSILON) {
    for (let i = 0; i < ring.length; i++) {
        if (pointTouchesSegment(point, ring[i], ring[(i + 1) % ring.length], epsilon)) return true;
    }
    return false;
}

function pointInsideOrTouchesRing(point, ring) {
    return pointInPolygon(point, ring) || pointTouchesRing(point, ring);
}

function pointInsideTerrainPolygonInterior(point, polygon) {
    if (!pointInPolygon(point, polygon.points || [])) return false;
    if (pointTouchesRing(point, polygon.points || [])) return false;
    for (const hole of polygon.holes || []) {
        if (pointInPolygon(point, hole) || pointTouchesRing(point, hole)) return false;
    }
    return true;
}

function pointInsideOrTouchesTerrainPolygon(point, polygon) {
    if (!pointInsideOrTouchesRing(point, polygon.points || [])) return false;
    for (const hole of polygon.holes || []) {
        if (pointInPolygon(point, hole) && !pointTouchesRing(point, hole)) return false;
    }
    return true;
}

function terrainOwnershipProblems(input, polygons) {
    const tiles = terrainTilesByKey(input);
    const problems = [];
    const innerTypes = new Set(INNER_COORDS.map((coord) => tiles.get(coordKey(coord))));
    const outputTypes = new Set((Array.isArray(polygons) ? polygons : []).map((polygon) => polygon.type));

    for (const type of innerTypes) {
        if (!outputTypes.has(type)) problems.push(`${type} polygon missing from output`);
    }
    for (const type of outputTypes) {
        if (!innerTypes.has(type)) problems.push(`${type} polygon exists but no inner tile has that terrain`);
    }

    for (const coord of INNER_COORDS) {
        const type = tiles.get(coordKey(coord));
        const center = axialToModel(coord);
        const matching = polygons.filter((polygon) => polygon.type === type);
        if (!matching.some((polygon) => pointInsideOrTouchesTerrainPolygon(center, polygon))) {
            problems.push(`${type} polygon does not contain or touch center of tile ${coordKey(coord)}`);
        }
        for (const polygon of polygons) {
            if (polygon.type === type) continue;
            if (pointInsideTerrainPolygonInterior(center, polygon)) {
                problems.push(`${polygon.type} polygon contains center of ${type} tile ${coordKey(coord)}`);
            }
        }
    }

    return problems;
}

function terrainComponentMergeProblems(input, polygons) {
    const tiles = terrainTilesByKey(input);
    const componentByCoordKey = new Map();
    const components = [];

    for (const coord of INNER_COORDS) {
        const key = coordKey(coord);
        if (componentByCoordKey.has(key)) continue;
        const type = tiles.get(key);
        const component = {
            id: components.length,
            type,
            coords: []
        };
        components.push(component);
        componentByCoordKey.set(key, component);
        const queue = [coord];
        for (let i = 0; i < queue.length; i++) {
            const current = queue[i];
            component.coords.push(current);
            for (const direction of DIRECTIONS) {
                const next = {
                    q: current.q + direction.q,
                    r: current.r + direction.r
                };
                const nextKey = coordKey(next);
                if (!INNER_KEYS.has(nextKey) || componentByCoordKey.has(nextKey)) continue;
                if (tiles.get(nextKey) !== type) continue;
                componentByCoordKey.set(nextKey, component);
                queue.push(next);
            }
        }
    }

    const problems = [];
    for (const polygon of Array.isArray(polygons) ? polygons : []) {
        if (!polygon || !TERRAIN_TYPES.includes(polygon.type)) continue;
        const touchedComponents = new Set();
        for (const component of components) {
            if (component.type !== polygon.type) continue;
            for (const coord of component.coords) {
                if (pointInsideOrTouchesTerrainPolygon(axialToModel(coord), polygon)) {
                    touchedComponents.add(component.id);
                    break;
                }
            }
        }
        if (touchedComponents.size > 1) {
            problems.push(`${polygon.type} polygon connects ${touchedComponents.size} disconnected inner components`);
        }
    }
    return problems;
}

function assertTerrainOwnership(input, polygons, label) {
    const problems = terrainOwnershipProblems(input, polygons);
    if (problems.length > 0) {
        throw new Error(`${label}: ${problems[0]}`);
    }
}

function ringInsideRing(inner, outer) {
    return inner.every((point) => pointInsideOrTouchesRing(point, outer));
}

function orientRing(points, clockwise) {
    const ring = normalizePolygonRing(points.map(roundPoint));
    const isClockwise = ringSignedArea(ring) < 0;
    return isClockwise === clockwise ? ring : ring.slice().reverse();
}

function deriveContainedHoles(polygons) {
    const out = polygons.map((polygon) => ({
        ...polygon,
        points: orientRing(polygon.points || [], false)
    }));

    for (const polygon of out) {
        delete polygon.holes;
        const holes = [];
        for (const other of out) {
            if (other === polygon || other.type === polygon.type) continue;
            if (!Array.isArray(other.points) || other.points.length < 3) continue;
            if (!ringInsideRing(other.points, polygon.points)) continue;
            if (pointTouchesRing(other.points[0], polygon.points)) continue;
            holes.push(orientRing(other.points, true));
        }
        if (holes.length > 0) polygon.holes = holes;
    }

    return out;
}

function centerVertexInsetHex(coord) {
    const center = roundPoint(axialToModel(coord));
    return hexCorners(coord).map((corner) => roundPoint({
        x: (center.x + corner.x) / 2,
        y: (center.y + corner.y) / 2
    }));
}

function deterministicCenterIsland(input) {
    const tiles = terrainTilesByKey(input);
    const centerCoord = { q: 0, r: 0 };
    const centerType = tiles.get(coordKey(centerCoord));
    const ringTypes = DIRECTIONS.map((direction) => tiles.get(coordKey(direction)));
    const surroundingTypes = new Set(ringTypes);
    if (surroundingTypes.size !== 1) return null;

    const surroundingType = ringTypes[0];
    if (surroundingType === centerType) return null;

    const surroundingInput = {
        ...input,
        tiles: input.tiles.map((tile) => (
            INNER_KEYS.has(coordKey(tile))
                ? { ...tile, type: surroundingType }
                : { ...tile }
        ))
    };
    const surroundingPolygon = generateTerrainBubblePolygons(surroundingInput)
        .find((polygon) => polygon.type === surroundingType);
    if (!surroundingPolygon) {
        throw new Error("terrain bubble deterministic island could not build surrounding polygon");
    }

    const islandIsLowerPriority = terrainPriority(centerType) < terrainPriority(surroundingType);
    const islandPoints = islandIsLowerPriority
        ? centerVertexInsetHex(centerCoord)
        : hexCorners(centerCoord).map(roundPoint);

    return {
        centerType,
        surroundingType,
        islandPoints,
        surroundingPoints: surroundingPolygon.points.map(roundPoint)
    };
}

function deterministicCenterIslandPolygons(input) {
    const island = deterministicCenterIsland(input);
    if (!island) return null;
    return deriveContainedHoles([
        { type: island.surroundingType, points: island.surroundingPoints },
        { type: island.centerType, points: island.islandPoints }
    ]);
}

function applyDeterministicCenterIsland(input, polygons) {
    const island = deterministicCenterIsland(input);
    if (!island) return polygons;

    const out = polygons.filter((polygon) => {
        if (polygon.type !== island.centerType) return true;
        const center = axialToModel({ q: 0, r: 0 });
        return !pointInsideOrTouchesTerrainPolygon(center, polygon);
    });

    out.push({
        type: island.centerType,
        points: island.islandPoints
    });

    return deriveContainedHoles(out);
}

function pointInsideOrTouchesAnyInnerHex(point) {
    for (const coord of INNER_COORDS) {
        const corners = hexCorners(coord).map(roundPoint);
        if (pointInPolygon(point, corners)) return true;
        for (let i = 0; i < corners.length; i++) {
            if (pointTouchesSegment(point, corners[i], corners[(i + 1) % corners.length])) return true;
        }
    }
    return false;
}

function outputSnapPoints() {
    return allSnapPoints().filter(pointInsideOrTouchesAnyInnerHex);
}

function baseHexVertexKeys() {
    const tiles = new Map(BUBBLE_COORDS.map((coord) => [coordKey(coord), TERRAIN_TYPES[0]]));
    return new Set([...tileVertexGroups(tiles).keys()]);
}

function anchorCanJumpToAdjacentVertex(anchor) {
    return Array.isArray(anchor.requiredOutputTypes)
        ? anchor.requiredOutputTypes.length >= 2
        : anchor.requiredOutputTypes && anchor.requiredOutputTypes.size >= 2;
}

function anchorLowestPriorityTiles(anchor) {
    const adjacentTiles = Array.isArray(anchor.adjacentTiles) ? anchor.adjacentTiles : [];
    if (adjacentTiles.length === 0) return [];
    const lowestPriority = Math.min(...adjacentTiles.map((tile) => terrainPriority(tile.type)));
    return adjacentTiles.filter((tile) => terrainPriority(tile.type) === lowestPriority);
}

function expandedAnchorTargetKeys(anchor) {
    const keys = new Set();
    for (const tile of anchorLowestPriorityTiles(anchor)) {
        const center = roundPoint(tile.center || axialToModel(tile.coord));
        keys.add(pointKey({
            x: (anchor.source.x + center.x) / 2,
            y: (anchor.source.y + center.y) / 2
        }));

        for (const corner of hexCorners(tile.coord).map(roundPoint)) {
            keys.add(pointKey(corner));
            keys.add(pointKey({
                x: (center.x + corner.x) / 2,
                y: (center.y + corner.y) / 2
            }));
        }
    }
    return keys;
}

function perimeterSlideTargetKeys(anchor) {
    const requiredTypes = Array.isArray(anchor.requiredOutputTypes) ? anchor.requiredOutputTypes : [];
    if (requiredTypes.length !== 2) return new Set();
    const perimeter = innerPerimeterVertices();
    const sourceKey = pointKey(anchor.source);
    const index = perimeter.findIndex((point) => pointKey(point) === sourceKey);
    if (index < 0) return new Set();

    const keys = new Set();
    for (const direction of [-1, 1]) {
        for (const distance of [1, 2]) {
            const target = perimeter[(index + direction * distance + perimeter.length) % perimeter.length];
            keys.add(pointKey(target));
        }
    }
    return keys;
}

function lowestRequiredTerrainType(anchor) {
    const requiredTypes = Array.isArray(anchor.requiredOutputTypes) ? anchor.requiredOutputTypes : [];
    if (requiredTypes.length === 0) return null;
    return requiredTypes.slice().sort((a, b) => terrainPriority(a) - terrainPriority(b))[0];
}

function highestRequiredTerrainType(anchor) {
    const requiredTypes = Array.isArray(anchor.requiredOutputTypes) ? anchor.requiredOutputTypes : [];
    if (requiredTypes.length === 0) return null;
    return requiredTypes.slice().sort((a, b) => terrainPriority(b) - terrainPriority(a))[0];
}

function perimeterSlideCandidateMap(input, anchor) {
    const requiredTypes = Array.isArray(anchor.requiredOutputTypes) ? anchor.requiredOutputTypes : [];
    const candidates = new Map();
    if (requiredTypes.length !== 2) return candidates;
    const snapByKey = new Map(outputSnapPoints().map((snap) => [pointKey(snap), snap]));
    const tiles = terrainTilesByKey(input);
    const groups = tileVertexGroups(tiles);
    const lowerType = lowestRequiredTerrainType(anchor);

    function add(label, point) {
        const snap = resolveOutputSnap(roundPoint(point), snapByKey);
        if (!snap || !pointInsideOrTouchesAnyInnerHex(snap)) return;
        candidates.set(label, roundPoint(snap));
    }

    add("slide:0", anchor.source);
    for (const offset of [-2, -1, 1, 2]) {
        const vertex = perimeterSlidePoint(anchor, offset);
        if (!vertex) continue;
        add(`slide:${offset}`, vertex);

        const group = groups.get(pointKey(vertex));
        const lowerInnerTiles = group
            ? group.tiles.filter((tile) => (
                INNER_KEYS.has(coordKey(tile.coord)) &&
                tile.type === lowerType
            ))
            : [];
        if (lowerInnerTiles.length === 1) {
            add(`inset:${offset}`, {
                x: (vertex.x + lowerInnerTiles[0].center.x) / 2,
                y: (vertex.y + lowerInnerTiles[0].center.y) / 2
            });
        }
    }
    return candidates;
}

function perimeterSlideCandidateLabel(input, anchor, point) {
    for (const [label, candidate] of perimeterSlideCandidateMap(input, anchor)) {
        if (pointDistance(point, candidate) <= TOPOLOGY_EPSILON * 2) return label;
    }
    return null;
}

function perimeterSlideCandidatePoint(input, anchor, label) {
    return perimeterSlideCandidateMap(input, anchor).get(label) || null;
}

function parsePerimeterSlideCandidateLabel(label) {
    const match = /^(slide|inset):(-?\d+)$/.exec(String(label));
    if (!match) return null;
    const offset = Number(match[2]);
    if (!Number.isInteger(offset) || Math.abs(offset) > 2) return null;
    return {
        kind: match[1],
        offset
    };
}

function perimeterBridgeIntermediatePoints(anchor, label) {
    const parsed = parsePerimeterSlideCandidateLabel(label);
    if (!parsed || parsed.offset === 0) return [];
    const perimeter = innerPerimeterVertices();
    const sourceKey = pointKey(anchor.source);
    const sourceIndex = perimeter.findIndex((point) => pointKey(point) === sourceKey);
    if (sourceIndex < 0) return [];
    const step = parsed.offset > 0 ? 1 : -1;
    const targetIndex = (sourceIndex + parsed.offset + perimeter.length) % perimeter.length;
    const out = [];
    let index = (sourceIndex + step + perimeter.length) % perimeter.length;
    while (index !== targetIndex) {
        out.push(roundPoint(perimeter[index]));
        index = (index + step + perimeter.length) % perimeter.length;
        if (out.length > perimeter.length) {
            throw new Error("terrain bubble perimeter bridge did not reach its target");
        }
    }
    if (parsed.kind === "slide") out.push(roundPoint(perimeter[targetIndex]));
    return out;
}

function highPriorityPerimeterBridge(anchor, movedPoint, label, previousPoint, nextPoint) {
    const intermediates = perimeterBridgeIntermediatePoints(anchor, label);
    const source = roundPoint(anchor.source);
    const moved = roundPoint(movedPoint);
    const optionMovedFirst = [moved].concat(intermediates.slice().reverse(), [source]);
    const optionSourceFirst = [source].concat(intermediates, [moved]);
    const movedFirstCost = pointDistance(previousPoint, moved) + pointDistance(source, nextPoint);
    const sourceFirstCost = pointDistance(previousPoint, source) + pointDistance(moved, nextPoint);
    return movedFirstCost <= sourceFirstCost ? optionMovedFirst : optionSourceFirst;
}

function perimeterSlideOffset(anchor, target) {
    const requiredTypes = Array.isArray(anchor.requiredOutputTypes) ? anchor.requiredOutputTypes : [];
    if (requiredTypes.length !== 2) return null;
    const perimeter = innerPerimeterVertices();
    const sourceKey = pointKey(anchor.source);
    const targetKey = pointKey(target);
    const sourceIndex = perimeter.findIndex((point) => pointKey(point) === sourceKey);
    const targetIndex = perimeter.findIndex((point) => pointKey(point) === targetKey);
    if (sourceIndex < 0 || targetIndex < 0) return null;

    const clockwise = (targetIndex - sourceIndex + perimeter.length) % perimeter.length;
    const counterClockwise = (sourceIndex - targetIndex + perimeter.length) % perimeter.length;
    return clockwise <= counterClockwise ? clockwise : -counterClockwise;
}

function perimeterSlidePoint(anchor, offset) {
    const requiredTypes = Array.isArray(anchor.requiredOutputTypes) ? anchor.requiredOutputTypes : [];
    if (requiredTypes.length !== 2) return null;
    const perimeter = innerPerimeterVertices();
    const sourceKey = pointKey(anchor.source);
    const sourceIndex = perimeter.findIndex((point) => pointKey(point) === sourceKey);
    if (sourceIndex < 0) return null;
    const targetIndex = (sourceIndex + offset + perimeter.length) % perimeter.length;
    return roundPoint(perimeter[targetIndex]);
}

function isTrainablePerimeterSlide(anchor, point) {
    const offset = perimeterSlideOffset(anchor, point);
    return Number.isInteger(offset) && Math.abs(offset) <= 2;
}

function anchorMoveAllowed(anchor, target) {
    const distance = pointDistance(anchor.source, target);
    if (distance <= MAX_VERTEX_MOVE_DISTANCE) return true;
    if (!anchorCanJumpToAdjacentVertex(anchor)) return false;
    if ((anchor.requiredOutputTypes || []).length === 2) {
        return perimeterSlideTargetKeys(anchor).has(pointKey(target)) ||
            expandedAnchorTargetKeys(anchor).has(pointKey(target));
    }
    return expandedAnchorTargetKeys(anchor).has(pointKey(target));
}

function resolveOutputSnap(point, snapByKeyOrPoints) {
    const key = pointKey(point);
    if (snapByKeyOrPoints instanceof Map) {
        const exact = snapByKeyOrPoints.get(key);
        if (exact) return exact;
        for (const snap of snapByKeyOrPoints.values()) {
            if (pointDistance(point, snap) <= TOPOLOGY_EPSILON * 2) return snap;
        }
        return null;
    }
    for (const snap of snapByKeyOrPoints) {
        if (pointDistance(point, snap) <= TOPOLOGY_EPSILON * 2) return snap;
    }
    return null;
}

function tileVertexGroups(tiles) {
    const groups = new Map();
    for (const coord of BUBBLE_COORDS) {
        const type = tiles.get(coordKey(coord));
        for (const corner of hexCorners(coord)) {
            const point = roundPoint(corner);
            const key = pointKey(point);
            if (!groups.has(key)) {
                groups.set(key, {
                    point,
                    tiles: []
                });
            }
            groups.get(key).tiles.push({
                coord,
                type,
                center: roundPoint(axialToModel(coord))
            });
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

function innerPerimeterVertices() {
    const neighbors = new Map();
    for (const edge of innerBoundaryEdges()) {
        if (edge.tiles.length !== 1) continue;
        const [a, b] = edge.endpoints.map(roundPoint);
        const aKey = pointKey(a);
        const bKey = pointKey(b);
        if (!neighbors.has(aKey)) neighbors.set(aKey, { point: a, neighbors: new Set() });
        if (!neighbors.has(bKey)) neighbors.set(bKey, { point: b, neighbors: new Set() });
        neighbors.get(aKey).neighbors.add(bKey);
        neighbors.get(bKey).neighbors.add(aKey);
    }

    if (neighbors.size === 0) return [];
    for (const [key, vertex] of neighbors) {
        if (vertex.neighbors.size !== 2) {
            throw new Error(`terrain bubble inner perimeter vertex ${key} has ${vertex.neighbors.size} neighbors`);
        }
    }

    const startKey = [...neighbors.keys()].sort((a, b) => {
        const aPoint = neighbors.get(a).point;
        const bPoint = neighbors.get(b).point;
        return aPoint.y - bPoint.y || aPoint.x - bPoint.x;
    })[0];
    const ordered = [];
    let previousKey = null;
    let currentKey = startKey;
    while (currentKey && !ordered.includes(currentKey)) {
        ordered.push(currentKey);
        const choices = [...neighbors.get(currentKey).neighbors].sort();
        const nextKey = choices.find((key) => key !== previousKey) || null;
        previousKey = currentKey;
        currentKey = nextKey;
        if (ordered.length > neighbors.size) {
            throw new Error("terrain bubble inner perimeter loop did not close");
        }
    }
    if (ordered.length !== neighbors.size || currentKey !== startKey) {
        throw new Error("terrain bubble inner perimeter loop is not contiguous");
    }
    return ordered.map((key) => neighbors.get(key).point);
}

function terrainPairKey(types) {
    return types.slice().sort().join("|");
}

function innerTerrainBoundaryGraphs(tiles) {
    const graphs = new Map();
    for (const edge of innerBoundaryEdges()) {
        if (edge.tiles.length !== 2) continue;
        const types = edge.tiles.map((tile) => tiles.get(coordKey(tile)));
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

function createRequiredAnchors(input) {
    const tiles = terrainTilesByKey(input);
    const groups = tileVertexGroups(tiles);
    const anchorsByKey = new Map();

    function addAnchor(point, kind) {
        const key = pointKey(point);
        const group = groups.get(key);
        const adjacentTiles = group ? group.tiles : [];
        const adjacentTypes = new Set(adjacentTiles.map((tile) => tile.type));
        const requiredOutputTypes = new Set(
            adjacentTiles
                .filter((tile) => INNER_KEYS.has(coordKey(tile.coord)))
                .map((tile) => tile.type)
        );
        if (requiredOutputTypes.size === 0) return;
        const existing = anchorsByKey.get(key);
        if (existing) {
            existing.kind = existing.kind === kind ? kind : "junction";
            for (const tile of adjacentTiles) existing.adjacentTiles.set(coordKey(tile.coord), tile);
            for (const type of adjacentTypes) existing.adjacentTypes.add(type);
            for (const type of requiredOutputTypes) existing.requiredOutputTypes.add(type);
            return;
        }
        anchorsByKey.set(key, {
            id: anchorIdForPoint(point),
            kind,
            source: roundPoint(point),
            point: roundPoint(point),
            adjacentTiles: new Map(adjacentTiles.map((tile) => [coordKey(tile.coord), tile])),
            adjacentTypes,
            requiredOutputTypes
        });
    }

    for (const group of groups.values()) {
        const innerTiles = group.tiles.filter((tile) => INNER_KEYS.has(coordKey(tile.coord)));
        const terrainTypes = new Set(innerTiles.map((tile) => tile.type));
        if (terrainTypes.size >= 3) addAnchor(group.point, "three-way");
    }

    for (const graph of innerTerrainBoundaryGraphs(tiles).values()) {
        for (const vertex of graph.values()) {
            if (vertex.neighbors.size !== 2) {
                addAnchor(vertex.point, "outer-edge");
            }
        }
    }

    return [...anchorsByKey.values()].map((anchor) => {
        const adjacentTiles = [...anchor.adjacentTiles.values()].sort((a, b) => (
            coordKey(a.coord).localeCompare(coordKey(b.coord))
        ));
        return {
            id: anchor.id,
            kind: anchor.kind,
            source: anchor.source,
            point: anchor.point,
            adjacentTiles,
            adjacentTypes: [...anchor.adjacentTypes].sort(),
            requiredOutputTypes: [...anchor.requiredOutputTypes].sort()
        };
    });
}

function snapLabelForPoint(point) {
    const snaps = outputSnapPoints();
    const exact = resolveOutputSnap(point, snaps);
    if (!exact) {
        throw new Error(`terrain bubble learner saw off-lattice output point ${pointKey(point)}`);
    }
    return pointKey(exact);
}

function buildAnchorFeature(input, anchor) {
    const tiles = terrainTilesByKey(input);
    const roleMap = localTerrainRoleMap(anchor.adjacentTypes);
    const tileEntries = anchor.adjacentTiles.map((tile) => ({
        coord: coordKey(tile.coord),
        type: tile.type,
        role: roleMap.get(tile.type) || "unknown",
        inner: INNER_KEYS.has(coordKey(tile.coord))
    }));
    const innerTypes = tileEntries.filter((tile) => tile.inner).map((tile) => tile.type);
    const outerTypes = tileEntries.filter((tile) => !tile.inner).map((tile) => tile.type);
    const ringTypes = BUBBLE_COORDS
        .filter((coord) => axialDistance(coord) === 2)
        .map((coord) => `${coordKey(coord)}:${tiles.get(coordKey(coord))}`)
        .join("|");
    const innerLayout = INNER_COORDS
        .map((coord) => `${coordKey(coord)}:${tiles.get(coordKey(coord))}`)
        .join("|");

    return {
        kind: anchor.kind,
        sourceKey: pointKey(anchor.source),
        adjacentTypes: canonicalTypeList(anchor.adjacentTypes),
        requiredTypes: canonicalTypeList(anchor.requiredOutputTypes),
        adjacentRoles: canonicalRoleList(anchor.adjacentTypes, roleMap),
        requiredRoles: canonicalRoleList(anchor.requiredOutputTypes, roleMap),
        innerRoles: canonicalRoleList(innerTypes, roleMap),
        outerRoles: canonicalRoleList(outerTypes, roleMap),
        innerTypes: canonicalTypeList(innerTypes),
        outerTypes: canonicalTypeList(outerTypes),
        tileEntries,
        innerLayout,
        ringTypes
    };
}

function anchorFeatureKey(feature) {
    return [
        feature.kind,
        feature.sourceKey,
        feature.requiredTypes,
        feature.adjacentTypes,
        feature.tileEntries.map((tile) => `${tile.coord}:${tile.type}`).join(",")
    ].join("||");
}

function roleAnchorFeatureKey(feature) {
    return [
        feature.kind,
        feature.sourceKey,
        feature.requiredRoles,
        feature.adjacentRoles,
        feature.tileEntries.map((tile) => `${tile.coord}:${tile.role}`).join(",")
    ].join("||");
}

function relativePriorityRoleForType(type, referenceTypes) {
    const priorities = referenceTypes.map(terrainPriority).sort((a, b) => a - b);
    const priority = terrainPriority(type);
    const lowest = priorities[0];
    const highest = priorities[priorities.length - 1];
    if (priority < lowest) return "below-lowest";
    if (priority > highest) return "above-highest";
    if (priority === lowest) return "lowest";
    if (priority === highest) return "highest";
    return "between";
}

function relativePriorityLayout(input, referenceTypes, coords) {
    const tiles = terrainTilesByKey(input);
    return coords.map((coord) => (
        `${coordKey(coord)}:${relativePriorityRoleForType(tiles.get(coordKey(coord)), referenceTypes)}`
    )).join("|");
}

function perimeterAnchorFeature(input, anchor) {
    const requiredTypes = Array.isArray(anchor.requiredOutputTypes) ? anchor.requiredOutputTypes : [];
    const context = vertexActionContext(input, anchor.source, "outer-edge");
    return {
        kind: anchor.kind,
        sourceKey: pointKey(anchor.source),
        requiredRoles: canonicalRoleList(requiredTypes, localTerrainRoleMap(requiredTypes)),
        adjacentPriorityRoles: context.firstLayer.map((tile) => `${tile.role}:${tile.inner ? "i" : "o"}`).join(","),
        secondPriorityRoles: context.secondLayer.map((tile) => `${tile.role}:${tile.inner ? "i" : "o"}`).join(","),
        innerPriorityLayout: relativePriorityLayout(input, requiredTypes, INNER_COORDS),
        ringPriorityLayout: relativePriorityLayout(
            input,
            requiredTypes,
            BUBBLE_COORDS.filter((coord) => axialDistance(coord) === 2)
        )
    };
}

function perimeterAnchorFeatureKey(feature) {
    return [
        feature.kind,
        feature.sourceKey,
        feature.requiredRoles,
        feature.adjacentPriorityRoles,
        feature.secondPriorityRoles,
        feature.innerPriorityLayout,
        feature.ringPriorityLayout
    ].join("||");
}

function rolePerimeterAnchorFeatureKey(feature) {
    return [
        feature.kind,
        feature.requiredRoles,
        feature.adjacentPriorityRoles,
        feature.secondPriorityRoles,
        feature.innerPriorityLayout,
        feature.ringPriorityLayout
    ].join("||");
}

function terrainRoleForType(type, anchors) {
    const adjacentTypes = [];
    for (const anchor of anchors) adjacentTypes.push(...anchor.adjacentTypes);
    const roleMap = localTerrainRoleMap(adjacentTypes);
    return roleMap.get(type) || "unknown";
}

function createPathFeature(input, startAnchor, endAnchor, polygonType) {
    const start = buildAnchorFeature(input, startAnchor);
    const end = buildAnchorFeature(input, endAnchor);
    const pathTypes = [...new Set(startAnchor.adjacentTypes.concat(endAnchor.adjacentTypes))];
    const roleMap = localTerrainRoleMap(pathTypes);
    return {
        terrainType: polygonType,
        terrainRole: roleMap.get(polygonType) || "unknown",
        startAnchorKey: anchorFeatureKey(start),
        endAnchorKey: anchorFeatureKey(end),
        startRoleKey: roleAnchorFeatureKey(start),
        endRoleKey: roleAnchorFeatureKey(end),
        startKind: startAnchor.kind,
        endKind: endAnchor.kind,
        startSourceKey: pointKey(startAnchor.source),
        endSourceKey: pointKey(endAnchor.source),
        startAdjacentTypes: start.adjacentTypes,
        endAdjacentTypes: end.adjacentTypes,
        startAdjacentRoles: start.adjacentRoles,
        endAdjacentRoles: end.adjacentRoles,
        startRequiredTypes: start.requiredTypes,
        endRequiredTypes: end.requiredTypes,
        startRequiredRoles: start.requiredRoles,
        endRequiredRoles: end.requiredRoles
    };
}

function priorityRole(priority, orderedPriorities) {
    const unique = [...new Set(orderedPriorities)].sort((a, b) => a - b);
    if (unique.length === 1) return "same";
    const labelsByCount = {
        2: ["lower", "higher"],
        3: ["lowest", "middle", "highest"],
        4: ["lowest", "lower-middle", "upper-middle", "highest"]
    };
    const labels = labelsByCount[unique.length] || unique.map((_, index) => `rank-${index}`);
    const index = unique.indexOf(priority);
    return index >= 0 ? labels[index] : "outside";
}

function secondLayerPriorityRole(priority, firstPriorities) {
    const unique = [...new Set(firstPriorities)].sort((a, b) => a - b);
    const lowest = unique[0];
    const highest = unique[unique.length - 1];
    if (priority < lowest) return "below-lowest";
    if (priority > highest) return "above-highest";
    if (priority === lowest) return "at-lowest";
    if (priority === highest) return "at-highest";
    return "between";
}

function sortTilesAroundPoint(point, tiles) {
    return tiles.slice().sort((a, b) => {
        const angleA = Math.atan2(a.center.y - point.y, a.center.x - point.x);
        const angleB = Math.atan2(b.center.y - point.y, b.center.x - point.x);
        if (Math.abs(angleA - angleB) > TOPOLOGY_EPSILON) return angleA - angleB;
        return coordKey(a.coord).localeCompare(coordKey(b.coord));
    });
}

function vertexActionContext(input, point, boundaryKind = "shared", polygonType = null) {
    const tiles = terrainTilesByKey(input);
    const group = tileVertexGroups(tiles).get(pointKey(point));
    const firstLayer = sortTilesAroundPoint(point, group ? group.tiles : []);
    if (firstLayer.length !== 3) {
        throw new Error(`terrain bubble learner expected exactly three tiles at vertex ${pointKey(point)} and found ${firstLayer.length}`);
    }
    const firstPriorities = firstLayer.map((tile) => terrainPriority(tile.type));
    const lowestPriority = Math.min(...firstPriorities);
    const lowestTiles = firstLayer.filter((tile) => terrainPriority(tile.type) === lowestPriority);
    const firstKeys = new Set(firstLayer.map((tile) => coordKey(tile.coord)));
    const secondByKey = new Map();

    for (const tile of firstLayer) {
        for (const direction of DIRECTIONS) {
            const coord = {
                q: tile.coord.q + direction.q,
                r: tile.coord.r + direction.r
            };
            const key = coordKey(coord);
            if (firstKeys.has(key) || !tiles.has(key)) continue;
            secondByKey.set(key, {
                coord,
                type: tiles.get(key),
                center: roundPoint(axialToModel(coord))
            });
        }
    }

    const secondLayer = sortTilesAroundPoint(point, [...secondByKey.values()]);
    let moveTarget = null;
    if (lowestTiles.length === 1) {
        moveTarget = roundPoint({
            x: (point.x + lowestTiles[0].center.x) / 2,
            y: (point.y + lowestTiles[0].center.y) / 2
        });
    } else if (boundaryKind === "outer-edge" && lowestTiles.length === 2) {
        moveTarget = roundPoint({
            x: (lowestTiles[0].center.x + lowestTiles[1].center.x) / 2,
            y: (lowestTiles[0].center.y + lowestTiles[1].center.y) / 2
        });
    }
    if (moveTarget && !pointInsideOrTouchesAnyInnerHex(moveTarget)) moveTarget = null;

    return {
        sourceKey: pointKey(point),
        boundaryKind,
        firstLayer: firstLayer.map((tile) => ({
            type: tile.type,
            role: priorityRole(terrainPriority(tile.type), firstPriorities),
            inner: INNER_KEYS.has(coordKey(tile.coord))
        })),
        secondLayer: secondLayer.map((tile) => ({
            type: tile.type,
            role: secondLayerPriorityRole(terrainPriority(tile.type), firstPriorities),
            inner: INNER_KEYS.has(coordKey(tile.coord))
        })),
        polygonRole: polygonType ? priorityRole(terrainPriority(polygonType), firstPriorities) : "any",
        polygonTouchesVertex: polygonType ? firstLayer.some((tile) => tile.type === polygonType) : true,
        firstPriorities,
        uniqueLowest: lowestTiles.length === 1,
        movableLowest: !!moveTarget,
        forcedAction: !moveTarget && boundaryKind === "shared" ? "stay" : null,
        moveTarget
    };
}

function vertexActionFeatureKey(feature) {
    return [
        `source:${feature.sourceKey || "*"}`,
        `kind:${feature.boundaryKind}`,
        `polygon:${feature.polygonRole}:${feature.polygonTouchesVertex ? "touches" : "remote"}`,
        `first-types:${feature.firstLayer.map((tile) => `${tile.type || "?"}:${tile.inner ? "i" : "o"}`).join(",")}`,
        `first:${feature.firstLayer.map((tile) => `${tile.role}:${tile.inner ? "i" : "o"}`).join(",")}`,
        `second-types:${feature.secondLayer.map((tile) => `${tile.type || "?"}:${tile.inner ? "i" : "o"}`).join(",")}`,
        `second:${feature.secondLayer.map((tile) => `${tile.role}:${tile.inner ? "i" : "o"}`).join(",")}`
    ].join("||");
}

function legalVertexActions(feature) {
    if (feature.forcedAction) return [feature.forcedAction];
    return feature.moveTarget ? ["delete", "stay", "move-into-lowest"] : ["delete", "stay"];
}

function outputVertexSetForTraining(polygons, polygonType = null) {
    const filtered = polygonType
        ? (Array.isArray(polygons) ? polygons.filter((polygon) => polygon.type === polygonType) : [])
        : polygons;
    return new Set(outputVerticesForTraining(filtered).map(pointKey));
}

function extractVertexAction(input, source, outputVertexKeys, boundaryKind = "shared", polygonType = null) {
    const feature = vertexActionContext(input, source, boundaryKind, polygonType);
    if (feature.forcedAction) return { action: feature.forcedAction, feature };
    const moveKey = feature.moveTarget ? pointKey(feature.moveTarget) : null;
    if (moveKey && outputVertexKeys.has(moveKey)) return { action: "move-into-lowest", feature };
    if (outputVertexKeys.has(pointKey(source))) return { action: "stay", feature };
    return { action: "delete", feature };
}

function pathFeatureKey(feature) {
    return [
        feature.terrainType,
        feature.startAnchorKey,
        feature.endAnchorKey
    ].join("||");
}

function rolePathFeatureKey(feature) {
    return [
        feature.terrainRole,
        feature.startRoleKey,
        feature.endRoleKey
    ].join("||");
}

function pointDeltaFrom(start, point) {
    return {
        x: roundNumber(point.x - start.x),
        y: roundNumber(point.y - start.y)
    };
}

function sequenceKeyFromPoints(startPoint, points) {
    return points.map(pointKey).join(";");
}

function parseSequenceKey(sequenceKey) {
    if (!sequenceKey) return [];
    return String(sequenceKey).split(";").filter(Boolean).map((key) => {
        const [x, y] = key.split(",").map(Number);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            throw new Error(`terrain bubble learner got invalid path point key ${key}`);
        }
        return { x, y };
    });
}

function polygonAnchorEntries(polygon, anchors) {
    const entries = [];
    for (let i = 0; i < polygon.points.length; i++) {
        const point = polygon.points[i];
        const anchor = anchors.find((candidate) => (
            candidate.requiredOutputTypes.includes(polygon.type) &&
            pointDistance(point, candidate.point) <= TOPOLOGY_EPSILON
        ));
        if (anchor) entries.push({ index: i, anchor });
    }
    return entries;
}

function cyclicPathPoints(points, startIndex, endIndex) {
    const out = [];
    let index = (startIndex + 1) % points.length;
    while (index !== endIndex) {
        out.push(roundPoint(points[index]));
        index = (index + 1) % points.length;
        if (out.length > points.length) {
            throw new Error("terrain bubble learner could not trace polygon path between anchors");
        }
    }
    return out;
}

function removeEndpointDuplicates(points, start, end) {
    return points
        .map(roundPoint)
        .filter((point) => (
            pointDistance(point, start) > TOPOLOGY_EPSILON &&
            pointDistance(point, end) > TOPOLOGY_EPSILON
        ));
}

function addCount(counts, key) {
    counts.set(key, (counts.get(key) || 0) + 1);
}

function anchorProtectedPointKeys(input, anchors) {
    const keys = new Set();
    for (const anchor of anchors) {
        keys.add(pointKey(anchor.source));
        keys.add(pointKey(anchor.point));
        const label = perimeterSlideCandidateLabel(input, anchor, anchor.point);
        if (!label) continue;
        for (const intermediate of perimeterBridgeIntermediatePoints(anchor, label)) {
            keys.add(pointKey(intermediate));
        }
    }
    return keys;
}

function outerEdgeLocalVertexCandidate(input, entry) {
    if (entry.polygonTypes.size !== 1) return false;
    const polygonType = [...entry.polygonTypes][0];
    const tiles = terrainTilesByKey(input);
    const group = tileVertexGroups(tiles).get(pointKey(entry.point));
    if (!group || group.tiles.length !== 3) return false;

    const innerTiles = group.tiles.filter((tile) => INNER_KEYS.has(coordKey(tile.coord)));
    const outerTiles = group.tiles.filter((tile) => !INNER_KEYS.has(coordKey(tile.coord)));
    if (innerTiles.length === 0 || outerTiles.length === 0) return false;

    const innerTypes = new Set(innerTiles.map((tile) => tile.type));
    if (innerTypes.size !== 1 || !innerTypes.has(polygonType)) return false;

    const polygonPriority = terrainPriority(polygonType);
    return outerTiles.some((tile) => terrainPriority(tile.type) > polygonPriority);
}

function baselineBoundaryVertexPoints(input, polygons, anchors) {
    const baseKeys = baseHexVertexKeys();
    const protectedKeys = anchorProtectedPointKeys(input, anchors);
    const byKey = new Map();
    function addPolygonPoint(polygon, point) {
        const rounded = roundPoint(point);
        const key = pointKey(rounded);
        if (protectedKeys.has(key)) return;
        if (!baseKeys.has(key)) return;
        if (!byKey.has(key)) {
            byKey.set(key, {
                point: rounded,
                polygonTypes: new Set()
            });
        }
        byKey.get(key).polygonTypes.add(polygon.type);
    }

    for (const polygon of polygons) {
        for (const point of polygon.points || []) {
            addPolygonPoint(polygon, point);
        }
        for (const hole of polygon.holes || []) {
            for (const point of hole) addPolygonPoint(polygon, point);
        }
    }
    return [...byKey.values()].flatMap((entry) => {
        if (entry.polygonTypes.size >= 2) {
            return [{ ...entry, boundaryKind: "shared" }];
        }
        if (outerEdgeLocalVertexCandidate(input, entry)) {
            return [{ ...entry, boundaryKind: "outer-edge" }];
        }
        return [];
    });
}

function outputVerticesForTraining(polygons) {
    const vertices = [];
    for (const polygon of polygons) {
        for (const point of polygon.points || []) {
            vertices.push(roundPoint(point));
        }
        for (const hole of polygon.holes || []) {
            for (const point of hole) vertices.push(roundPoint(point));
        }
    }
    return vertices;
}

function majorityLabel(counts) {
    let bestLabel = "";
    let bestCount = -1;
    for (const [label, count] of counts) {
        if (count > bestCount || (count === bestCount && label < bestLabel)) {
            bestLabel = label;
            bestCount = count;
        }
    }
    return bestLabel;
}

function trainTerrainBubbleLearner(examples, options = {}) {
    const anchorRecords = [];
    const vertexRecords = [];
    const pathRecords = [];
    const exactAnchorVotes = new Map();
    const roleAnchorVotes = new Map();
    const perimeterAnchorVotes = new Map();
    const rolePerimeterAnchorVotes = new Map();
    const localVertexActionVotes = new Map();
    const exactPathVotes = new Map();
    const rolePathVotes = new Map();
    const snapKeys = new Set(outputSnapPoints().map(pointKey));

    for (const example of examples) {
        if (!example || !example.input || !example.output) continue;
        const trainingExamples = options.augmentSymmetries === false
            ? [example]
            : augmentExampleSymmetries(example);
        for (const trainingExample of trainingExamples) {
            const anchors = createRequiredAnchors(trainingExample.input);
            const savedAnchors = new Map(
                Array.isArray(trainingExample.editor && trainingExample.editor.requiredAnchors)
                    ? trainingExample.editor.requiredAnchors.map((anchor) => [anchor.id, anchor])
                    : []
            );
            const anchorsWithSavedPoints = anchors.map((anchor) => {
                const saved = savedAnchors.get(anchor.id);
                return {
                    ...anchor,
                    point: saved && saved.point ? roundPoint(saved.point) : anchor.source
                };
            });

            for (const anchor of anchorsWithSavedPoints) {
                const point = anchor.point;
                const label = snapLabelForPoint(point);
                if (!snapKeys.has(label)) {
                    throw new Error(`terrain bubble learner produced non-output snap label ${label}`);
                }
                const feature = buildAnchorFeature(trainingExample.input, anchor);
                const featureKey = anchorFeatureKey(feature);
                const roleFeatureKey = roleAnchorFeatureKey(feature);
                const delta = {
                    x: roundNumber(point.x - anchor.source.x),
                    y: roundNumber(point.y - anchor.source.y)
                };
                if (!exactAnchorVotes.has(featureKey)) exactAnchorVotes.set(featureKey, new Map());
                if (!roleAnchorVotes.has(roleFeatureKey)) roleAnchorVotes.set(roleFeatureKey, new Map());
                addCount(exactAnchorVotes.get(featureKey), label);
                addCount(roleAnchorVotes.get(roleFeatureKey), deltaKey(delta));

                const perimeterSlideLabel = perimeterSlideCandidateLabel(trainingExample.input, anchor, point);
                if (perimeterSlideLabel) {
                    const perimeterFeature = perimeterAnchorFeature(trainingExample.input, anchor);
                    const perimeterKey = perimeterAnchorFeatureKey(perimeterFeature);
                    const rolePerimeterKey = rolePerimeterAnchorFeatureKey(perimeterFeature);
                    if (!perimeterAnchorVotes.has(perimeterKey)) perimeterAnchorVotes.set(perimeterKey, new Map());
                    if (!rolePerimeterAnchorVotes.has(rolePerimeterKey)) rolePerimeterAnchorVotes.set(rolePerimeterKey, new Map());
                    addCount(perimeterAnchorVotes.get(perimeterKey), perimeterSlideLabel);
                    addCount(rolePerimeterAnchorVotes.get(rolePerimeterKey), perimeterSlideLabel);
                }

                anchorRecords.push({
                    exampleId: trainingExample.id,
                    feature,
                    featureKey,
                    roleFeatureKey,
                    source: roundPoint(anchor.source),
                    label,
                    delta
                });
            }

            const baselinePolygons = generateTerrainBubblePolygons(trainingExample.input);
            const outputPolygons = clipTerrainPolygonsToInnerSeven(trainingExample.output.polygons || []);
            for (const entry of baselineBoundaryVertexPoints(trainingExample.input, baselinePolygons, anchorsWithSavedPoints)) {
                const source = roundPoint(entry.point);
                const polygonType = entry.boundaryKind === "outer-edge" && entry.polygonTypes.size === 1
                    ? [...entry.polygonTypes][0]
                    : null;
                const outputVertexKeys = outputVertexSetForTraining(outputPolygons, polygonType);
                const { action, feature } = extractVertexAction(
                    trainingExample.input,
                    source,
                    outputVertexKeys,
                    entry.boundaryKind,
                    polygonType
                );
                const featureKey = vertexActionFeatureKey(feature);
                if (!localVertexActionVotes.has(featureKey)) localVertexActionVotes.set(featureKey, new Map());
                addCount(localVertexActionVotes.get(featureKey), action);
                vertexRecords.push({
                    exampleId: trainingExample.id,
                    feature,
                    featureKey,
                    source,
                    polygonType,
                    action,
                    legalActions: legalVertexActions(feature)
                });
            }

            for (const polygon of outputPolygons) {
                if (!TERRAIN_TYPES.includes(polygon.type) || !Array.isArray(polygon.points)) continue;
                const points = polygon.points.map(roundPoint);
                const anchorEntries = polygonAnchorEntries({ ...polygon, points }, anchorsWithSavedPoints);
                if (anchorEntries.length < 2) continue;
                for (let i = 0; i < anchorEntries.length; i++) {
                    const start = anchorEntries[i];
                    const end = anchorEntries[(i + 1) % anchorEntries.length];
                    if (start.index === end.index) continue;
                    const internalPoints = removeEndpointDuplicates(
                        cyclicPathPoints(points, start.index, end.index),
                        start.anchor.point,
                        end.anchor.point
                    );
                    for (const point of internalPoints) snapLabelForPoint(point);
                    const feature = createPathFeature(trainingExample.input, start.anchor, end.anchor, polygon.type);
                    const featureKey = pathFeatureKey(feature);
                    const roleFeatureKey = rolePathFeatureKey(feature);
                    const sequenceKey = sequenceKeyFromPoints(start.anchor.point, internalPoints);
                    if (!exactPathVotes.has(featureKey)) exactPathVotes.set(featureKey, new Map());
                    if (!rolePathVotes.has(roleFeatureKey)) rolePathVotes.set(roleFeatureKey, new Map());
                    addCount(exactPathVotes.get(featureKey), sequenceKey);
                    addCount(rolePathVotes.get(roleFeatureKey), sequenceKey);
                    pathRecords.push({
                        exampleId: trainingExample.id,
                        feature,
                        featureKey,
                        roleFeatureKey,
                        sequence: sequenceKey
                    });
                }
            }
        }
    }

    return {
        schema: "terrain-bubble-anchor-learner-v1",
        trainedAt: new Date().toISOString(),
        trainingExampleCount: examples.length,
        augmentedExampleCount: options.augmentSymmetries === false ? examples.length : examples.length * symmetryTransforms().length,
        anchorRecordCount: anchorRecords.length,
        vertexRecordCount: vertexRecords.length,
        pathRecordCount: pathRecords.length,
        exactAnchorRules: [...exactAnchorVotes.entries()].map(([key, counts]) => ({
            key,
            label: majorityLabel(counts),
            counts: Object.fromEntries([...counts.entries()].sort())
        })),
        roleAnchorRules: [...roleAnchorVotes.entries()].map(([key, counts]) => ({
            key,
            delta: majorityLabel(counts),
            counts: Object.fromEntries([...counts.entries()].sort())
        })),
        perimeterAnchorRules: [...perimeterAnchorVotes.entries()].map(([key, counts]) => ({
            key,
            target: majorityLabel(counts),
            counts: Object.fromEntries([...counts.entries()].sort())
        })),
        rolePerimeterAnchorRules: [...rolePerimeterAnchorVotes.entries()].map(([key, counts]) => ({
            key,
            target: majorityLabel(counts),
            counts: Object.fromEntries([...counts.entries()].sort())
        })),
        localVertexActionRules: [...localVertexActionVotes.entries()].map(([key, counts]) => ({
            key,
            action: majorityLabel(counts),
            counts: Object.fromEntries([...counts.entries()].sort())
        })),
        exactVertexRules: [],
        roleVertexRules: [],
        exactPathRules: [...exactPathVotes.entries()].map(([key, counts]) => ({
            key,
            sequence: majorityLabel(counts),
            counts: Object.fromEntries([...counts.entries()].sort())
        })),
        rolePathRules: [...rolePathVotes.entries()].map(([key, counts]) => ({
            key,
            sequence: majorityLabel(counts),
            counts: Object.fromEntries([...counts.entries()].sort())
        })),
        pathRecords,
        vertexRecords,
        records: anchorRecords
    };
}

function scoreAnchorRecord(feature, record) {
    let score = 0;
    if (feature.kind === record.feature.kind) score += 10;
    if (feature.sourceKey === record.feature.sourceKey) score += 8;
    if (feature.requiredTypes === record.feature.requiredTypes) score += 7;
    if (feature.adjacentTypes === record.feature.adjacentTypes) score += 6;
    if (feature.requiredRoles === record.feature.requiredRoles) score += 7;
    if (feature.adjacentRoles === record.feature.adjacentRoles) score += 6;
    if (feature.innerRoles === record.feature.innerRoles) score += 4;
    if (feature.outerRoles === record.feature.outerRoles) score += 2;
    if (feature.innerTypes === record.feature.innerTypes) score += 4;
    if (feature.outerTypes === record.feature.outerTypes) score += 2;
    if (feature.innerLayout === record.feature.innerLayout) score += 10;
    if (feature.ringTypes === record.feature.ringTypes) score += 2;

    const byCoord = new Map(record.feature.tileEntries.map((tile) => [tile.coord, tile]));
    for (const tile of feature.tileEntries) {
        const other = byCoord.get(tile.coord);
        if (!other) continue;
        if (tile.type === other.type) score += tile.inner ? 2 : 1;
        if (tile.role === other.role) score += tile.inner ? 2 : 1;
    }
    return score;
}

function predictPerimeterAnchorLabel(model, input, anchor) {
    const requiredTypes = Array.isArray(anchor.requiredOutputTypes) ? anchor.requiredOutputTypes : [];
    if (requiredTypes.length !== 2) return null;

    function pointFromRule(rule) {
        if (!rule) return null;
        if (rule.target) return perimeterSlideCandidatePoint(input, anchor, rule.target);
        const offset = Number(rule.offset);
        return Number.isInteger(offset) ? perimeterSlidePoint(anchor, offset) : null;
    }

    const feature = perimeterAnchorFeature(input, anchor);
    const exactKey = perimeterAnchorFeatureKey(feature);
    const exactRule = Array.isArray(model.perimeterAnchorRules)
        ? model.perimeterAnchorRules.find((rule) => rule.key === exactKey)
        : null;
    if (exactRule) {
        const point = pointFromRule(exactRule);
        if (point) {
            return { label: pointKey(point), source: "perimeter-rule", score: null };
        }
    }

    const roleKey = rolePerimeterAnchorFeatureKey(feature);
    const roleRule = Array.isArray(model.rolePerimeterAnchorRules)
        ? model.rolePerimeterAnchorRules.find((rule) => rule.key === roleKey)
        : null;
    if (roleRule) {
        const point = pointFromRule(roleRule);
        if (point) {
            return { label: pointKey(point), source: "role-perimeter-rule", score: null };
        }
    }

    return null;
}

function predictAnchorLabel(model, input, anchor) {
    const snapByKey = new Map(outputSnapPoints().map((snap) => [pointKey(snap), snap]));
    const perimeterPrediction = predictPerimeterAnchorLabel(model, input, anchor);
    if (perimeterPrediction) return perimeterPrediction;

    const feature = buildAnchorFeature(input, anchor);
    const exactKey = anchorFeatureKey(feature);
    const exactRule = Array.isArray(model.exactAnchorRules)
        ? model.exactAnchorRules.find((rule) => rule.key === exactKey)
        : null;
    if (exactRule) return { label: exactRule.label, source: "exact-rule", score: null };

    const roleKey = roleAnchorFeatureKey(feature);
    const roleRule = Array.isArray(model.roleAnchorRules)
        ? model.roleAnchorRules.find((rule) => rule.key === roleKey)
        : null;
    if (roleRule) {
        const delta = parseDeltaKey(roleRule.delta);
        const translatedKey = pointKey({
            x: anchor.source.x + delta.x,
            y: anchor.source.y + delta.y
        });
        if (snapByKey.has(translatedKey)) {
            return { label: translatedKey, source: "role-rule", score: null };
        }
    }

    let best = null;
    for (const record of Array.isArray(model.records) ? model.records : []) {
        if (feature.kind !== record.feature.kind) continue;
        if (feature.requiredRoles !== record.feature.requiredRoles) continue;
        if (feature.adjacentRoles !== record.feature.adjacentRoles) continue;
        const score = scoreAnchorRecord(feature, record);
        if (!best || score > best.score) best = { record, score };
    }
    if (best && best.score >= 34) {
        const translated = roundPoint({
            x: anchor.source.x + best.record.delta.x,
            y: anchor.source.y + best.record.delta.y
        });
        const translatedKey = pointKey(translated);
        if (snapByKey.has(translatedKey)) {
            return { label: translatedKey, source: best.record.exampleId, score: best.score };
        }
    }
    return { label: pointKey(anchor.source), source: "identity", score: null };
}

function majorityAction(counts, fallbackAction) {
    let bestAction = fallbackAction;
    let bestCount = -1;
    for (const action of ["move-into-lowest", "stay", "delete"]) {
        const count = counts.get(action) || 0;
        if (count > bestCount) {
            bestAction = action;
            bestCount = count;
        }
    }
    return bestAction;
}

function defaultVertexAction(feature) {
    if (feature.moveTarget) return "move-into-lowest";
    return feature.boundaryKind === "outer-edge" ? "delete" : "stay";
}

function predictVertexAction(model, input, source, boundaryKind = "shared", polygonType = null) {
    const feature = vertexActionContext(input, source, boundaryKind, polygonType);
    const legalActions = new Set(legalVertexActions(feature));
    if (feature.forcedAction) {
        return {
            action: feature.forcedAction,
            target: source,
            feature,
            source: "forced-tied-lowest"
        };
    }

    const featureKey = vertexActionFeatureKey(feature);
    const rule = Array.isArray(model.localVertexActionRules)
        ? model.localVertexActionRules.find((candidate) => candidate.key === featureKey)
        : null;
    let action = defaultVertexAction(feature);
    let sourceName = "default-priority-rule";

    if (rule && rule.counts) {
        action = majorityAction(new Map(Object.entries(rule.counts)), action);
        sourceName = "local-action-rule";
    } else if (rule && rule.action) {
        action = rule.action;
        sourceName = "local-action-rule";
    }

    if (!legalActions.has(action)) {
        action = defaultVertexAction(feature);
        sourceName = "illegal-action-corrected";
    }

    return {
        action,
        target: action === "move-into-lowest" ? feature.moveTarget : source,
        feature,
        source: sourceName
    };
}

function applyAnchorPredictions(input, model, polygons) {
    const snapByKey = new Map(outputSnapPoints().map((snap) => [pointKey(snap), snap]));
    const anchors = createRequiredAnchors(input);
    const predictions = anchors.map((anchor) => {
        const prediction = predictAnchorLabel(model, input, anchor);
        let snap = snapByKey.get(prediction.label);
        if (!snap) {
            throw new Error(`terrain bubble learner predicted unavailable output snap ${prediction.label}`);
        }
        const perimeterCandidate = perimeterSlideCandidateLabel(input, anchor, snap);
        if (!perimeterCandidate && !anchorMoveAllowed(anchor, snap)) {
            snap = anchor.source;
            prediction.label = pointKey(anchor.source);
            prediction.source = "movement-limit";
            prediction.score = null;
        }
        return {
            ...anchor,
            point: roundPoint(snap),
            prediction
        };
    });

    const out = polygons.map((polygon) => {
        const points = polygon.points || [];
        return {
            ...polygon,
            points: normalizePolygonRing(points.flatMap((point, index) => {
                const anchor = predictions.find((candidate) => (
                    candidate.requiredOutputTypes.includes(polygon.type) &&
                    (
                        pointDistance(point, candidate.source) <= TOPOLOGY_EPSILON ||
                        pointDistance(point, candidate.point) <= TOPOLOGY_EPSILON
                    )
                ));
                if (!anchor) return [roundPoint(point)];

                const candidateLabel = perimeterSlideCandidateLabel(input, anchor, anchor.point);
                const lowerType = lowestRequiredTerrainType(anchor);
                const higherType = highestRequiredTerrainType(anchor);
                if (
                    candidateLabel &&
                    polygon.type === higherType &&
                    polygon.type !== lowerType &&
                    pointDistance(anchor.source, anchor.point) > TOPOLOGY_EPSILON
                ) {
                    const previousPoint = roundPoint(points[(index - 1 + points.length) % points.length]);
                    const nextPoint = roundPoint(points[(index + 1) % points.length]);
                    return highPriorityPerimeterBridge(anchor, anchor.point, candidateLabel, previousPoint, nextPoint);
                }

                return [roundPoint(anchor.point)];
            }))
        };
    });

    return { polygons: out, anchors: predictions };
}

function applyLocalVertexPredictions(input, model, polygons, anchors) {
    const snapByKey = new Map(outputSnapPoints().map((snap) => [pointKey(snap), snap]));
    const boundaryVertices = baselineBoundaryVertexPoints(input, polygons, anchors);
    const moves = new Map();
    function moveKey(point, polygonType = null) {
        return `${polygonType || "*"}|${pointKey(point)}`;
    }
    function entryPolygonType(entry) {
        if (entry.boundaryKind !== "outer-edge" || entry.polygonTypes.size !== 1) return null;
        return [...entry.polygonTypes][0];
    }
    for (const entry of boundaryVertices) {
        const source = roundPoint(entry.point);
        const polygonType = entryPolygonType(entry);
        const prediction = predictVertexAction(model, input, source, entry.boundaryKind, polygonType);
        let target = prediction.target ? roundPoint(prediction.target) : source;
        if (prediction.action === "move-into-lowest") {
            const snap = resolveOutputSnap(target, snapByKey);
            if (!snap) {
                throw new Error(`terrain bubble local vertex learner predicted unavailable output snap ${pointKey(target)}`);
            }
            if (pointDistance(source, snap) > MAX_VERTEX_MOVE_DISTANCE) {
                throw new Error(`terrain bubble local vertex learner moved ${pointKey(source)} too far to ${pointKey(snap)}`);
            }
            target = roundPoint(snap);
        }
        moves.set(moveKey(source, polygonType), {
            source,
            target,
            polygonType,
            prediction
        });
    }

    function moveForPolygonPoint(polygonType, point) {
        return moves.get(moveKey(point, polygonType)) || moves.get(moveKey(point));
    }

    const out = polygons.map((polygon) => ({
        ...polygon,
        points: normalizePolygonRing((polygon.points || []).flatMap((point) => {
            const move = moveForPolygonPoint(polygon.type, point);
            if (!move) return [roundPoint(point)];
            if (move.prediction.action === "delete") return [];
            return [roundPoint(move.target)];
        })),
        holes: (polygon.holes || []).map((hole) => normalizePolygonRing(hole.flatMap((point) => {
            const move = moveForPolygonPoint(polygon.type, point);
            if (!move) return [roundPoint(point)];
            if (move.prediction.action === "delete") return [];
            return [roundPoint(move.target)];
        }))).filter((hole) => hole.length >= 3)
    }));

    return {
        polygons: out,
        moves: [...moves.values()]
    };
}

function normalizePolygonRing(points) {
    const out = [];
    for (const point of points) {
        const rounded = roundPoint(point);
        const previous = out[out.length - 1];
        if (!previous || pointDistance(previous, rounded) > TOPOLOGY_EPSILON) out.push(rounded);
    }
    if (out.length > 1 && pointDistance(out[0], out[out.length - 1]) <= TOPOLOGY_EPSILON) out.pop();
    return removeBacktrackSpikes(out);
}

function removeBacktrackSpikes(points) {
    let ring = points.slice();
    let changed = true;
    while (changed && ring.length >= 3) {
        changed = false;
        const next = [];
        for (let i = 0; i < ring.length; i++) {
            const previous = ring[(i - 1 + ring.length) % ring.length];
            const current = ring[i];
            const after = ring[(i + 1) % ring.length];
            if (pointDistance(previous, after) <= TOPOLOGY_EPSILON) {
                changed = true;
                continue;
            }
            next.push(current);
        }
        ring = next;
    }
    return ring;
}

function pathPredictionPriority(prediction) {
    if (!prediction) return 0;
    if (prediction.source === "exact-path-rule") return 4;
    if (prediction.source === "role-path-rule") return 3;
    return 1;
}

function predictPathSequence(model, feature) {
    const exactKey = pathFeatureKey(feature);
    const exactRule = Array.isArray(model.exactPathRules)
        ? model.exactPathRules.find((rule) => rule.key === exactKey)
        : null;
    if (exactRule) return { sequence: exactRule.sequence, source: "exact-path-rule" };

    const roleKey = rolePathFeatureKey(feature);
    const roleRule = Array.isArray(model.rolePathRules)
        ? model.rolePathRules.find((rule) => rule.key === roleKey)
        : null;
    if (roleRule) return { sequence: roleRule.sequence, source: "role-path-rule" };

    return null;
}

function sequencePointsFromPrediction(startPoint, endPoint, prediction, fallbackPoints, snapByKey) {
    if (!prediction) return removeEndpointDuplicates(fallbackPoints, startPoint, endPoint);
    const points = [];
    for (const sequencePoint of parseSequenceKey(prediction.sequence)) {
        const point = roundPoint(sequencePoint);
        const snap = resolveOutputSnap(point, snapByKey);
        if (!snap) {
            if (prediction.source !== "exact-path-rule") {
                return removeEndpointDuplicates(fallbackPoints, startPoint, endPoint);
            }
            throw new Error(`terrain bubble path learner predicted unavailable output snap ${pointKey(point)}`);
        }
        points.push(roundPoint(snap));
    }
    return removeEndpointDuplicates(points, startPoint, endPoint);
}

function constrainedSequencePointsFromPrediction(startPoint, endPoint, prediction, fallbackPoints, snapByKey) {
    const fallback = removeEndpointDuplicates(fallbackPoints, startPoint, endPoint);
    if (!prediction) return fallback;
    const sourcePolyline = [startPoint].concat(fallbackPoints.map(roundPoint), [endPoint]);
    const predicted = sequencePointsFromPrediction(startPoint, endPoint, prediction, fallbackPoints, snapByKey);
    const constrained = [];
    for (const point of predicted) {
        if (pointDistanceToPolyline(point, sourcePolyline) > MAX_VERTEX_MOVE_DISTANCE) return fallback;
        constrained.push(point);
    }
    return constrained;
}

function pathGroupKey(a, b) {
    return a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
}

function pathGroupIsForward(plan) {
    return plan.startAnchor.id < plan.endAnchor.id;
}

function pathSequenceFitsPlan(plan, sequencePoints) {
    const polyline = Array.isArray(plan.fallbackPolyline) ? plan.fallbackPolyline : [];
    return sequencePoints.every((point) => (
        pointDistanceToPolyline(point, polyline) <= MAX_VERTEX_MOVE_DISTANCE
    ));
}

function applyPathPredictions(input, model, polygons, anchors) {
    const snapByKey = new Map(outputSnapPoints().map((snap) => [pointKey(snap), snap]));
    const plansByPolygon = new Map();
    const groups = new Map();

    for (let polygonIndex = 0; polygonIndex < polygons.length; polygonIndex++) {
        const polygon = polygons[polygonIndex];
        const anchorEntries = polygonAnchorEntries(polygon, anchors);
        if (anchorEntries.length < 2) continue;

        const plans = [];
        for (let i = 0; i < anchorEntries.length; i++) {
            const start = anchorEntries[i];
            const end = anchorEntries[(i + 1) % anchorEntries.length];
            if (start.index === end.index) continue;
            const fallbackPoints = cyclicPathPoints(polygon.points, start.index, end.index);
            const feature = createPathFeature(input, start.anchor, end.anchor, polygon.type);
            const prediction = predictPathSequence(model, feature);
            const fallbackPolyline = [start.anchor.point].concat(
                fallbackPoints.map(roundPoint),
                [end.anchor.point]
            );
            const sequencePoints = constrainedSequencePointsFromPrediction(
                start.anchor.point,
                end.anchor.point,
                prediction,
                fallbackPoints,
                snapByKey
            );
            const plan = {
                polygonIndex,
                terrainType: polygon.type,
                startAnchor: start.anchor,
                endAnchor: end.anchor,
                fallbackPolyline,
                sequencePoints,
                prediction,
                groupKey: pathGroupKey(start.anchor, end.anchor)
            };
            plans.push(plan);

            const canonicalSequence = pathGroupIsForward(plan)
                ? sequencePoints
                : sequencePoints.slice().reverse();
            const candidate = {
                priority: pathPredictionPriority(prediction),
                sequencePoints: canonicalSequence,
                prediction
            };
            const existing = groups.get(plan.groupKey);
            if (!existing ||
                candidate.priority > existing.priority ||
                (candidate.priority === existing.priority && candidate.sequencePoints.length > existing.sequencePoints.length)) {
                groups.set(plan.groupKey, candidate);
            }
        }
        plansByPolygon.set(polygonIndex, plans);
    }

    return polygons.map((polygon, polygonIndex) => {
        const plans = plansByPolygon.get(polygonIndex);
        if (!plans || plans.length === 0) return polygon;

        const points = [];
        for (const plan of plans) {
            const group = groups.get(plan.groupKey);
            const groupedSequence = group
                ? (pathGroupIsForward(plan) ? group.sequencePoints : group.sequencePoints.slice().reverse())
                : null;
            const sequence = groupedSequence && pathSequenceFitsPlan(plan, groupedSequence)
                ? groupedSequence
                : plan.sequencePoints;
            points.push(roundPoint(plan.startAnchor.point));
            for (const point of sequence) points.push(roundPoint(point));
        }
        const ring = normalizePolygonRing(points);
        if (ring.length < 3) return polygon;
        return {
            ...polygon,
            points: ring
        };
    });
}

function identityAnchors(input) {
    return createRequiredAnchors(input).map((anchor) => ({
        ...anchor,
        point: roundPoint(anchor.source),
        prediction: {
            label: pointKey(anchor.source),
            source: "identity",
            score: null
        }
    }));
}

function validateOwnershipForStage(input, polygons, stage, diagnostics) {
    const problems = terrainOwnershipProblems(input, polygons);
    if (problems.length > 0) {
        diagnostics.push({
            stage,
            status: "rejected",
            reason: problems[0]
        });
        return false;
    }
    const topologyProblems = terrainComponentMergeProblems(input, polygons);
    if (topologyProblems.length > 0) {
        diagnostics.push({
            stage,
            status: "rejected",
            reason: topologyProblems[0]
        });
        return false;
    }
    diagnostics.push({
        stage,
        status: "accepted"
    });
    return true;
}

function generateLearnedTerrainBubbleResult(input, model, options = {}) {
    const diagnostics = [];
    const baseline = applyDeterministicCenterIsland(input, generateTerrainBubblePolygons(input));
    assertTerrainOwnership(input, baseline, "terrain bubble baseline ownership");

    const anchored = applyAnchorPredictions(input, model, baseline);
    const anchoredPolygons = applyDeterministicCenterIsland(input, deriveContainedHoles(anchored.polygons));
    let selectedPolygons = baseline;
    let selectedAnchors = identityAnchors(input);
    let selectedStage = "baseline";

    if (validateOwnershipForStage(input, anchoredPolygons, "anchors", diagnostics)) {
        selectedPolygons = anchoredPolygons;
        selectedAnchors = anchored.anchors;
        selectedStage = "anchors";
    }

    const localVertexResult = applyLocalVertexPredictions(input, model, selectedPolygons, selectedAnchors);
    const localVertexPolygons = applyDeterministicCenterIsland(input, deriveContainedHoles(localVertexResult.polygons));
    if (validateOwnershipForStage(input, localVertexPolygons, "local-vertices", diagnostics)) {
        selectedPolygons = localVertexPolygons;
        selectedStage = "local-vertices";
    }

    const smoothedPolygons = applyDeterministicCenterIsland(
        input,
        deriveContainedHoles(applyPathPredictions(input, model, selectedPolygons, selectedAnchors))
    );
    if (validateOwnershipForStage(input, smoothedPolygons, "paths", diagnostics)) {
        selectedPolygons = smoothedPolygons;
        selectedStage = "paths";
    } else if (options.allowRejectedPathStage) {
        selectedPolygons = smoothedPolygons;
        selectedStage = "paths-rejected-accepted";
    }

    return {
        polygons: selectedPolygons,
        anchors: selectedAnchors,
        stage: selectedStage,
        diagnostics
    };
}

function generateLearnedTerrainBubblePolygons(input, model, options = {}) {
    return generateLearnedTerrainBubbleResult(input, model, options).polygons;
}

function buildLearnedExample(input, model, fields = {}) {
    const result = generateLearnedTerrainBubbleResult(input, model);
    const polygons = result.polygons;
    const anchors = result.anchors;
    const now = new Date().toISOString();
    const id = fields.id || `learned-suggestion-${Date.now()}`;
    const name = fields.name || id.replace(/-/g, " ");
    return {
        schema: "terrain-bubble-example-v1",
        id,
        name,
        createdAt: fields.createdAt || now,
        updatedAt: now,
        input: {
            schema: "terrain-bubble-19-v1",
            innerKeys: INNER_COORDS.map(coordKey),
            tiles: BUBBLE_COORDS.map((coord) => ({
                q: coord.q,
                r: coord.r,
                type: terrainTilesByKey(input).get(coordKey(coord))
            }))
        },
        output: {
            schema: "terrain-bubble-output-v1",
            fills: "inner-7",
            polygons: polygons.map((polygon) => ({
                type: polygon.type,
                points: polygon.points.map(roundPoint),
                holes: (polygon.holes || []).map((hole) => hole.map(roundPoint))
            }))
        },
        editor: {
            edited: false,
            generated: true,
            generatedBy: model.schema,
            generationStage: result.stage,
            generationDiagnostics: result.diagnostics,
            savedAt: now,
            totalVertices: polygons.reduce((sum, polygon) => (
                sum + polygon.points.length + (polygon.holes || []).reduce((holeSum, hole) => holeSum + hole.length, 0)
            ), 0),
            polygonVertexCounts: polygons.map((polygon, index) => ({
                index,
                type: polygon.type,
                points: polygon.points.length + (polygon.holes || []).reduce((holeSum, hole) => holeSum + hole.length, 0)
            })),
            requiredAnchors: anchors.map((anchor) => ({
                id: anchor.id,
                kind: anchor.kind,
                source: roundPoint(anchor.source),
                point: roundPoint(anchor.point),
                adjacentTypes: anchor.adjacentTypes.slice(),
                requiredOutputTypes: anchor.requiredOutputTypes.slice(),
                prediction: anchor.prediction
            }))
        }
    };
}

function randomBubbleInput(rng = Math.random) {
    return {
        schema: "terrain-bubble-19-v1",
        innerKeys: INNER_COORDS.map(coordKey),
        tiles: BUBBLE_COORDS.map((coord) => ({
            q: coord.q,
            r: coord.r,
            type: TERRAIN_TYPES[Math.floor(rng() * TERRAIN_TYPES.length)]
        }))
    };
}

function seededRng(seedText) {
    let seed = 2166136261;
    for (let i = 0; i < String(seedText).length; i++) {
        seed ^= String(seedText).charCodeAt(i);
        seed = Math.imul(seed, 16777619);
    }
    return function rng() {
        seed += 0x6D2B79F5;
        let t = seed;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

module.exports = {
    allSnapPoints,
    buildLearnedExample,
    createRequiredAnchors,
    generateLearnedTerrainBubbleResult,
    generateLearnedTerrainBubblePolygons,
    outputSnapPoints,
    randomBubbleInput,
    seededRng,
    transformCoord,
    transformPoint,
    trainTerrainBubbleLearner
};
