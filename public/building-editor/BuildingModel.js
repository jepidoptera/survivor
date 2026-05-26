const DEFAULTS = Object.freeze({
    floorTexture: "/assets/images/flooring/woodfloor.png",
    wallTexture: "/assets/images/walls/woodwall.png",
    roofTexture: "/assets/images/roofs/slate.png",
    wallHeight: 3,
    wallThickness: 0.1,
    gridSize: 1
});

let stringIdCounter = 1;
let wallIdCounter = 1;

function nextStringId(prefix) {
    return `${prefix}-${stringIdCounter++}`;
}

function nextWallId() {
    return wallIdCounter++;
}

function clonePoint(point, fallbackPrefix = "vertex") {
    const id = typeof point.id === "string" && point.id.length > 0
        ? point.id
        : nextStringId(fallbackPrefix);
    return { id, x: Number(point.x), y: Number(point.y) };
}

function clonePoints(points, fallbackPrefix = "vertex") {
    return points.map((point) => clonePoint(point, fallbackPrefix));
}

function cloneEndpoint(endpoint) {
    if (!endpoint || typeof endpoint !== "object") return null;
    return JSON.parse(JSON.stringify(endpoint));
}

function clonePlainObject(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
}

function finitePoint(point) {
    return Number.isFinite(Number(point && point.x)) && Number.isFinite(Number(point && point.y));
}

function ringPoints(ring) {
    return (Array.isArray(ring) ? ring : [])
        .filter((point) => finitePoint(point))
        .map((point) => ({ id: point.id, x: Number(point.x), y: Number(point.y) }));
}

function polygonArea(points) {
    let area = 0;
    for (let index = 0; index < points.length; index++) {
        const current = points[index];
        const next = points[(index + 1) % points.length];
        area += current.x * next.y - next.x * current.y;
    }
    return area * 0.5;
}

function cross(a, b) {
    return Number(a.x) * Number(b.y) - Number(a.y) * Number(b.x);
}

function lineIntersection(lineA, lineB) {
    const denominator = cross(lineA.direction, lineB.direction);
    if (Math.abs(denominator) < 0.000001) return null;
    const delta = {
        x: lineB.point.x - lineA.point.x,
        y: lineB.point.y - lineA.point.y
    };
    const t = cross(delta, lineB.direction) / denominator;
    return {
        x: lineA.point.x + lineA.direction.x * t,
        y: lineA.point.y + lineA.direction.y * t
    };
}

function offsetRing(ring, distance) {
    const points = ringPoints(ring);
    if (points.length < 3 || Math.abs(Number(distance)) < 0.000001) return points;
    const area = polygonArea(points);
    if (Math.abs(area) < 0.000001) return points;
    const windingSign = area >= 0 ? 1 : -1;
    const offsetLines = points.map((point, index) => {
        const next = points[(index + 1) % points.length];
        const dx = next.x - point.x;
        const dy = next.y - point.y;
        const length = Math.hypot(dx, dy);
        if (length < 0.000001) return null;
        const outward = {
            x: windingSign * dy / length,
            y: -windingSign * dx / length
        };
        return {
            point: {
                x: point.x + outward.x * distance,
                y: point.y + outward.y * distance
            },
            direction: { x: dx / length, y: dy / length }
        };
    });
    if (offsetLines.some((line) => !line)) return points;
    return points.map((point, index) => {
        const previousLine = offsetLines[(index - 1 + offsetLines.length) % offsetLines.length];
        const currentLine = offsetLines[index];
        const intersection = lineIntersection(previousLine, currentLine);
        if (intersection && finitePoint(intersection)) return intersection;
        return {
            x: point.x + (currentLine.point.x - points[index].x),
            y: point.y + (currentLine.point.y - points[index].y)
        };
    });
}

function normalizeVector(vector) {
    const x = Number(vector && vector.x);
    const y = Number(vector && vector.y);
    const length = Math.hypot(x, y);
    if (!Number.isFinite(length) || length < 0.000001) {
        throw new Error("line-boundary wall attachment requires a non-zero vector");
    }
    return { x: x / length, y: y / length };
}

function lineProjectionT(point, linePoint, lineVector) {
    return (Number(point.x) - Number(linePoint.x)) * lineVector.x + (Number(point.y) - Number(linePoint.y)) * lineVector.y;
}

function boundaryLineIntersections(floor, linePoint, lineVector) {
    if (!floor || !Array.isArray(floor.outerPolygon) || floor.outerPolygon.length < 3) {
        throw new Error("cannot resolve edge endpoint without a valid floor outer polygon");
    }
    if (!finitePoint(linePoint)) {
        throw new Error("line-boundary wall attachment requires a finite line point");
    }
    const intersections = [];
    const rings = [floor.outerPolygon, ...(Array.isArray(floor.holes) ? floor.holes : [])];
    rings.forEach((ring) => {
        for (let index = 0; index < ring.length; index++) {
            const a = ring[index];
            const b = ring[(index + 1) % ring.length];
            const segmentVector = { x: Number(b.x) - Number(a.x), y: Number(b.y) - Number(a.y) };
            const denominator = cross(lineVector, segmentVector);
            if (Math.abs(denominator) < 0.000001) continue;
            const delta = { x: Number(a.x) - Number(linePoint.x), y: Number(a.y) - Number(linePoint.y) };
            const t = cross(delta, segmentVector) / denominator;
            const u = cross(delta, lineVector) / denominator;
            if (u < -0.000001 || u > 1.000001) continue;
            intersections.push({
                t,
                x: Number(linePoint.x) + lineVector.x * t,
                y: Number(linePoint.y) + lineVector.y * t
            });
        }
    });
    intersections.sort((a, b) => a.t - b.t);
    return intersections.filter((point, index) => {
        if (index === 0) return true;
        const previous = intersections[index - 1];
        return Math.hypot(point.x - previous.x, point.y - previous.y) > 0.0001;
    });
}

function nearestIntersectionToEndpoint(intersections, endpoint, avoidPoint = null) {
    if (!finitePoint(endpoint)) return intersections[0] || null;
    let best = null;
    intersections.forEach((candidate) => {
        if (
            finitePoint(avoidPoint) &&
            Math.hypot(candidate.x - Number(avoidPoint.x), candidate.y - Number(avoidPoint.y)) < 0.0001
        ) {
            return;
        }
        const distance = Math.hypot(candidate.x - Number(endpoint.x), candidate.y - Number(endpoint.y));
        if (!best || distance < best.distance) best = { candidate, distance };
    });
    return best ? best.candidate : null;
}

function refreshLineBoundaryClipEndpoints(building, wall) {
    if (!wall || !wall.attachment || wall.attachment.kind !== "lineBoundaryClip") return false;
    const fragmentId = wall.attachment.fragmentId || wall.fragmentId || wall.floorId;
    const floor = findFloor(building, fragmentId);
    if (!floor) throw new Error(`line-boundary wall ${wall.id} references missing floor fragment: ${fragmentId}`);
    const linePoint = wall.attachment.linePoint;
    const lineVector = normalizeVector(wall.attachment.lineVector);
    const intersections = boundaryLineIntersections(floor, linePoint, lineVector);
    const edgeKeys = ["startPoint", "endPoint"].filter((key) => wall[key] && wall[key].kind === "edge");
    if (!edgeKeys.length) return false;
    if (intersections.length < edgeKeys.length) {
        throw new Error(`line-boundary wall ${wall.id} does not intersect enough floor boundary edges`);
    }

    if (edgeKeys.length === 2) {
        const startT = finitePoint(wall.startPoint) ? lineProjectionT(wall.startPoint, linePoint, lineVector) : -Infinity;
        const endT = finitePoint(wall.endPoint) ? lineProjectionT(wall.endPoint, linePoint, lineVector) : Infinity;
        const first = intersections[0];
        const last = intersections[intersections.length - 1];
        const start = startT <= endT ? first : last;
        const end = startT <= endT ? last : first;
        wall.startPoint.x = start.x;
        wall.startPoint.y = start.y;
        wall.endPoint.x = end.x;
        wall.endPoint.y = end.y;
        return true;
    }

    const key = edgeKeys[0];
    const oppositeKey = key === "startPoint" ? "endPoint" : "startPoint";
    const oppositeEndpoint = resolveEndpoint(building, wall[oppositeKey]) || wall[oppositeKey];
    const intersection = nearestIntersectionToEndpoint(intersections, wall[key], oppositeEndpoint);
    if (!intersection) {
        throw new Error(`line-boundary wall ${wall.id} edge endpoint would coincide with its opposite endpoint`);
    }
    wall[key].x = intersection.x;
    wall[key].y = intersection.y;
    return true;
}

export function createEmptyBuilding() {
    return {
        schema: "survivor-building-v1",
        id: nextStringId("building"),
        name: "untitled-building",
        origin: { x: 0, y: 0 },
        defaults: {
            floorTexture: DEFAULTS.floorTexture,
            wallTexture: DEFAULTS.wallTexture,
            roofTexture: DEFAULTS.roofTexture,
            wallHeight: DEFAULTS.wallHeight,
            wallThickness: DEFAULTS.wallThickness
        },
        floorFragments: [],
        wallSections: [],
        roof: null
    };
}

export function getBuildingFloors(building) {
    return Array.isArray(building && building.floorFragments) ? building.floorFragments : [];
}

export function getBuildingWalls(building) {
    return Array.isArray(building && building.wallSections) ? building.wallSections : [];
}

export function getFloorId(floor) {
    return String((floor && (floor.fragmentId || floor.id)) || "");
}

export function getFloorElevation(floor) {
    return Number.isFinite(Number(floor && floor.nodeBaseZ)) ? Number(floor.nodeBaseZ) : 0;
}

export function setFloorElevation(floor, elevation) {
    const z = Number(elevation);
    if (!Number.isFinite(z)) throw new Error("floor elevation must be a finite number");
    const level = Math.floor(z / 3);
    floor.level = level;
    floor.nodeBaseZOffset = z - level * 3;
    floor.nodeBaseZ = z;
}

export function createFloor({
    elevation = 0,
    footprint,
    holes = [],
    floorTexture = DEFAULTS.floorTexture,
    roofTexture = DEFAULTS.roofTexture,
    floorHeight = DEFAULTS.wallHeight,
    defaultWallHeight = DEFAULTS.wallHeight,
    defaultWallTexture = DEFAULTS.wallTexture,
    createPerimeterWalls = true
}) {
    if (!Array.isArray(footprint) || footprint.length < 3) {
        throw new Error("building floor fragment requires at least three outer polygon vertices");
    }

    const fragmentId = nextStringId("floor-fragment");
    const floor = {
        fragmentId,
        surfaceId: fragmentId,
        ownerSectionKey: "",
        name: "floor",
        level: 0,
        nodeBaseZOffset: 0,
        nodeBaseZ: 0,
        outerPolygon: clonePoints(footprint),
        holes: Array.isArray(holes) ? holes.map((ring) => clonePoints(ring, "hole-vertex")).filter((ring) => ring.length >= 3) : [],
        floorTexturePath: floorTexture,
        roofTexturePath: roofTexture,
        floorHeight: Number(floorHeight),
        defaultWallHeight: Number(defaultWallHeight),
        defaultWallTexturePath: defaultWallTexture,
        posts: [],
        beams: []
    };
    setFloorElevation(floor, elevation);
    if (!Number.isFinite(floor.defaultWallHeight) || floor.defaultWallHeight <= 0) {
        throw new Error("building floor default wall height must be a positive number");
    }
    if (!Number.isFinite(floor.floorHeight) || floor.floorHeight <= 0) {
        throw new Error("building floor height must be a positive number");
    }
    floor._createPerimeterWalls = createPerimeterWalls === true;
    return floor;
}

export function createWall({
    floorId,
    points = null,
    startPoint = null,
    endPoint = null,
    height = DEFAULTS.wallHeight,
    texture = DEFAULTS.wallTexture,
    thickness = DEFAULTS.wallThickness,
    bottomZ = 0,
    traversalLayer = 0,
    role = "interior",
    attachment = null
}) {
    const resolvedFloorId = String(floorId || "");
    if (!resolvedFloorId) throw new Error("wall section requires a floor fragment id");

    const endpoints = startPoint && endPoint
        ? [cloneEndpoint(startPoint), cloneEndpoint(endPoint)]
        : (Array.isArray(points) && points.length >= 2
            ? [
                { kind: "point", x: Number(points[0].x), y: Number(points[0].y) },
                { kind: "point", x: Number(points[points.length - 1].x), y: Number(points[points.length - 1].y) }
            ]
            : null);
    if (!endpoints) throw new Error("wall section requires two endpoints");

    const wall = {
        type: "wallSection",
        id: nextWallId(),
        floorId: resolvedFloorId,
        fragmentId: resolvedFloorId,
        startPoint: endpoints[0],
        endPoint: endpoints[1],
        height: Number(height),
        thickness: Number(thickness),
        bottomZ: Number(bottomZ),
        traversalLayer: Math.round(Number(traversalLayer) || 0),
        wallTexturePath: texture,
        role,
        attachment: attachment ? JSON.parse(JSON.stringify(attachment)) : null,
        openings: []
    };
    if (!Number.isFinite(wall.height) || wall.height <= 0) {
        throw new Error("wall section height must be a positive number");
    }
    if (!Number.isFinite(wall.thickness) || wall.thickness <= 0) {
        throw new Error("wall section thickness must be a positive number");
    }
    if (!Number.isFinite(wall.bottomZ)) {
        throw new Error("wall section bottomZ must be finite");
    }
    refreshWallEndpointCoordinatesForWall(null, wall);
    return wall;
}

function vertexEndpoint(floor, vertex) {
    return {
        kind: "vertex",
        fragmentId: getFloorId(floor),
        ring: "outer",
        holeIndex: -1,
        vertexId: vertex.id,
        x: Number(vertex.x),
        y: Number(vertex.y)
    };
}

function perimeterWallSettings(wall, preserveIdentity = false) {
    const settings = {
        height: Number(wall.height),
        thickness: Number(wall.thickness),
        wallTexturePath: wall.wallTexturePath,
        texturePhaseA: Number.isFinite(Number(wall.texturePhaseA)) ? Number(wall.texturePhaseA) : undefined,
        texturePhaseB: Number.isFinite(Number(wall.texturePhaseB)) ? Number(wall.texturePhaseB) : undefined,
        openings: clonePlainObject(Array.isArray(wall.openings) ? wall.openings : [])
    };
    if (preserveIdentity && Number.isInteger(Number(wall.id))) settings.id = Number(wall.id);
    return settings;
}

function applyPerimeterWallSettings(wall, settings) {
    if (!settings) return wall;
    if (Number.isInteger(Number(settings.id))) wall.id = Number(settings.id);
    if (Number.isFinite(Number(settings.height)) && Number(settings.height) > 0) wall.height = Number(settings.height);
    if (Number.isFinite(Number(settings.thickness)) && Number(settings.thickness) > 0) wall.thickness = Number(settings.thickness);
    if (typeof settings.wallTexturePath === "string" && settings.wallTexturePath.length > 0) {
        wall.wallTexturePath = settings.wallTexturePath;
    }
    if (Number.isFinite(Number(settings.texturePhaseA))) wall.texturePhaseA = Number(settings.texturePhaseA);
    if (Number.isFinite(Number(settings.texturePhaseB))) wall.texturePhaseB = Number(settings.texturePhaseB);
    if (Array.isArray(settings.openings)) wall.openings = clonePlainObject(settings.openings);
    return wall;
}

function perimeterWallSettingMaps(walls) {
    const exact = new Map();
    const byStart = new Map();
    const byEnd = new Map();
    walls.forEach((wall) => {
        const attachment = wall && wall.attachment;
        if (!attachment || attachment.kind !== "fragmentEdge" || attachment.ring !== "outer") return;
        const start = attachment.startVertexId;
        const end = attachment.endVertexId;
        if (!start || !end) return;
        const exactSettings = perimeterWallSettings(wall, true);
        const adjacentSettings = perimeterWallSettings(wall, false);
        exact.set(`${start}->${end}`, exactSettings);
        byStart.set(start, adjacentSettings);
        byEnd.set(end, adjacentSettings);
    });
    return { exact, byStart, byEnd };
}

export function createPerimeterWallsForFloor(building, floor) {
    if (!building || !Array.isArray(building.wallSections)) {
        throw new Error("cannot create perimeter walls without a building wall section list");
    }
    if (!floor || !Array.isArray(floor.outerPolygon) || floor.outerPolygon.length < 3) {
        throw new Error("cannot create perimeter walls without a valid floor fragment outer polygon");
    }
    const fragmentId = getFloorId(floor);
    const existingPerimeterWalls = building.wallSections
        .filter((wall) => wall.role === "perimeter" && wall.fragmentId === fragmentId);
    const settingMaps = perimeterWallSettingMaps(existingPerimeterWalls);
    building.wallSections = building.wallSections.filter((wall) => !(wall.role === "perimeter" && wall.fragmentId === fragmentId));
    floor.outerPolygon.forEach((vertex, edgeIndex) => {
        const next = floor.outerPolygon[(edgeIndex + 1) % floor.outerPolygon.length];
        const preservedSettings = settingMaps.exact.get(`${vertex.id}->${next.id}`) ||
            settingMaps.byStart.get(vertex.id) ||
            settingMaps.byEnd.get(next.id) ||
            null;
        const wall = createWall({
            floorId: fragmentId,
            startPoint: vertexEndpoint(floor, vertex),
            endPoint: vertexEndpoint(floor, next),
            height: preservedSettings && Number.isFinite(Number(preservedSettings.height))
                ? Number(preservedSettings.height)
                : floor.floorHeight,
            texture: floor.defaultWallTexturePath,
            bottomZ: getFloorElevation(floor),
            traversalLayer: floor.level,
            role: "perimeter",
            attachment: {
                kind: "fragmentEdge",
                fragmentId,
                ring: "outer",
                startVertexId: vertex.id,
                endVertexId: next.id
            }
        });
        applyPerimeterWallSettings(wall, preservedSettings);
        building.wallSections.push(wall);
    });
}

export function addFloor(building, floor) {
    if (!building || !Array.isArray(building.floorFragments)) {
        throw new Error("cannot add floor fragment to missing building model");
    }
    building.floorFragments.push(floor);
    building.floorFragments.sort((a, b) => getFloorElevation(a) - getFloorElevation(b));
    if (floor._createPerimeterWalls === true) {
        delete floor._createPerimeterWalls;
        createPerimeterWallsForFloor(building, floor);
    }
    return floor;
}

export function duplicateFloor(building, sourceFloorId, elevation) {
    const source = findFloor(building, sourceFloorId);
    if (!source) throw new Error(`cannot duplicate missing source floor fragment: ${sourceFloorId}`);
    const floor = createFloor({
        elevation,
        footprint: source.outerPolygon,
        holes: source.holes || [],
        floorTexture: source.floorTexturePath,
        roofTexture: source.roofTexturePath,
        floorHeight: source.floorHeight,
        defaultWallHeight: source.defaultWallHeight,
        defaultWallTexture: source.defaultWallTexturePath,
        createPerimeterWalls: false
    });
    floor.name = `${source.name} copy`;
    addFloor(building, floor);
    duplicateWallsForFloor(building, source, floor);
    return floor;
}

function buildDuplicatedVertexIdMap(sourceFloor, targetFloor) {
    const vertexIdMap = new Map();
    const mapRing = (sourceRing, targetRing, label) => {
        if (!Array.isArray(sourceRing) || !Array.isArray(targetRing)) {
            throw new Error(`cannot duplicate floor walls without matching ${label} vertex rings`);
        }
        if (sourceRing.length !== targetRing.length) {
            throw new Error(`cannot duplicate floor walls because ${label} vertex counts differ`);
        }
        sourceRing.forEach((sourceVertex, index) => {
            const targetVertex = targetRing[index];
            if (!sourceVertex || !sourceVertex.id || !targetVertex || !targetVertex.id) {
                throw new Error(`cannot duplicate floor walls because ${label} vertex ${index} is missing an id`);
            }
            vertexIdMap.set(sourceVertex.id, targetVertex.id);
        });
    };

    mapRing(sourceFloor.outerPolygon, targetFloor.outerPolygon, "outer polygon");
    const sourceHoles = Array.isArray(sourceFloor.holes) ? sourceFloor.holes : [];
    const targetHoles = Array.isArray(targetFloor.holes) ? targetFloor.holes : [];
    if (sourceHoles.length !== targetHoles.length) {
        throw new Error("cannot duplicate floor walls because hole counts differ");
    }
    sourceHoles.forEach((ring, index) => mapRing(ring, targetHoles[index], `hole ${index}`));
    return vertexIdMap;
}

function remapDuplicatedVertexId(vertexIdMap, sourceWallId, fieldName, vertexId) {
    if (!vertexId) return vertexId;
    const remapped = vertexIdMap.get(vertexId);
    if (!remapped) {
        throw new Error(`cannot duplicate wall ${sourceWallId}: ${fieldName} references missing source floor vertex ${vertexId}`);
    }
    return remapped;
}

function remapDuplicatedEndpoint(endpoint, sourceFloorId, targetFloorId, vertexIdMap, sourceWallId, endpointKey) {
    const copy = cloneEndpoint(endpoint);
    if (!copy) throw new Error(`cannot duplicate wall ${sourceWallId}: ${endpointKey} is missing`);
    if (copy.fragmentId === sourceFloorId) copy.fragmentId = targetFloorId;
    if (copy.kind === "vertex") {
        if (!copy.vertexId) throw new Error(`cannot duplicate wall ${sourceWallId}: ${endpointKey} vertex endpoint is missing vertexId`);
        const remapped = vertexIdMap.get(copy.vertexId);
        if (!remapped) {
            throw new Error(`cannot duplicate wall ${sourceWallId}: ${endpointKey} references missing source floor vertex ${copy.vertexId}`);
        }
        copy.fragmentId = targetFloorId;
        copy.vertexId = remapped;
    } else if (copy.kind === "edge") {
        copy.fragmentId = targetFloorId;
    }
    return copy;
}

function remapDuplicatedAttachment(attachment, sourceFloorId, targetFloorId, vertexIdMap, sourceWall) {
    const copy = clonePlainObject(attachment);
    if (!copy || typeof copy !== "object") return copy || null;
    if (copy.fragmentId === sourceFloorId) copy.fragmentId = targetFloorId;
    if (copy.kind === "fragmentEdge") {
        if (!copy.startVertexId || !copy.endVertexId) {
            throw new Error(`cannot duplicate wall ${sourceWall.id}: fragmentEdge attachment is missing vertex ids`);
        }
        copy.fragmentId = targetFloorId;
        copy.startVertexId = remapDuplicatedVertexId(vertexIdMap, sourceWall.id, "startVertexId", copy.startVertexId);
        copy.endVertexId = remapDuplicatedVertexId(vertexIdMap, sourceWall.id, "endVertexId", copy.endVertexId);
    } else if (copy.kind === "lineBoundaryClip") {
        copy.fragmentId = targetFloorId;
    }
    return copy;
}

function duplicateWallsForFloor(building, sourceFloor, targetFloor) {
    if (!building || !Array.isArray(building.wallSections)) {
        throw new Error("cannot duplicate floor walls without a building wall section list");
    }
    const sourceFloorId = getFloorId(sourceFloor);
    const targetFloorId = getFloorId(targetFloor);
    const vertexIdMap = buildDuplicatedVertexIdMap(sourceFloor, targetFloor);
    const targetElevation = getFloorElevation(targetFloor);
    const targetTraversalLayer = Math.round(Number(targetFloor.level) || 0);
    const sourceWalls = building.wallSections.filter((wall) => (wall.fragmentId || wall.floorId) === sourceFloorId);

    sourceWalls.forEach((sourceWall) => {
        const wall = clonePlainObject(sourceWall);
        if (!wall || typeof wall !== "object") {
            throw new Error(`cannot duplicate invalid wall on floor ${sourceFloorId}`);
        }
        wall.id = nextWallId();
        wall.floorId = targetFloorId;
        wall.fragmentId = targetFloorId;
        wall.startPoint = remapDuplicatedEndpoint(sourceWall.startPoint, sourceFloorId, targetFloorId, vertexIdMap, sourceWall.id, "startPoint");
        wall.endPoint = remapDuplicatedEndpoint(sourceWall.endPoint, sourceFloorId, targetFloorId, vertexIdMap, sourceWall.id, "endPoint");
        wall.attachment = remapDuplicatedAttachment(sourceWall.attachment, sourceFloorId, targetFloorId, vertexIdMap, sourceWall);
        wall.bottomZ = targetElevation;
        wall.traversalLayer = targetTraversalLayer;
        building.wallSections.push(wall);
    });

    refreshWallSectionEndpoints(building, targetFloor);
}

export function replaceFloorShape(building, floor, outerPolygon, holes = [], options = {}) {
    if (!floor) throw new Error("cannot replace shape for missing floor fragment");
    if (!Array.isArray(outerPolygon) || outerPolygon.length < 3) {
        throw new Error("replacement floor fragment outer polygon requires at least three vertices");
    }
    floor.outerPolygon = clonePoints(outerPolygon);
    floor.holes = Array.isArray(holes) ? holes.map((ring) => clonePoints(ring, "hole-vertex")).filter((ring) => ring.length >= 3) : [];
    if (options.regeneratePerimeterWalls !== false) {
        createPerimeterWallsForFloor(building, floor);
    }
    refreshWallSectionEndpoints(building, floor);
}

export function findFloor(building, floorId) {
    const id = String(floorId || "");
    return getBuildingFloors(building).find((floor) => getFloorId(floor) === id) || null;
}

export function findWall(building, wallId) {
    const id = Number(wallId);
    return getBuildingWalls(building).find((wall) => Number(wall.id) === id) || null;
}

export function ringForEndpoint(building, endpoint) {
    const floor = findFloor(building, endpoint && endpoint.fragmentId);
    if (!floor) return null;
    if (endpoint.ring === "outer") return floor.outerPolygon;
    if (endpoint.ring === "hole") {
        const index = Math.floor(Number(endpoint.holeIndex));
        return Array.isArray(floor.holes) && index >= 0 ? floor.holes[index] : null;
    }
    return null;
}

export function resolveEndpoint(building, endpoint) {
    if (!endpoint || typeof endpoint !== "object") return null;
    if (endpoint.kind === "vertex") {
        const ring = ringForEndpoint(building, endpoint);
        const vertex = Array.isArray(ring) ? ring.find((point) => point.id === endpoint.vertexId) : null;
        if (!vertex) return null;
        return { x: Number(vertex.x), y: Number(vertex.y) };
    }
    if (Number.isFinite(Number(endpoint.x)) && Number.isFinite(Number(endpoint.y))) {
        return { x: Number(endpoint.x), y: Number(endpoint.y) };
    }
    return null;
}

export function wallPoints(building, wall) {
    const start = resolveEndpoint(building, wall && wall.startPoint);
    const end = resolveEndpoint(building, wall && wall.endPoint);
    if (!start || !end) return [];
    return [start, end];
}

export function wallCenterlinePoints(building, wall, floor = null) {
    const points = wallPoints(building, wall);
    if (points.length !== 2) return points;
    if (!wall || wall.role !== "perimeter") return points;
    const resolvedFloor = floor || findFloor(building, wall.fragmentId || wall.floorId);
    if (!resolvedFloor) {
        throw new Error(`perimeter wall ${wall && wall.id} references missing floor fragment: ${wall && (wall.fragmentId || wall.floorId)}`);
    }
    const attachment = wall.attachment;
    if (!attachment || attachment.kind !== "fragmentEdge" || attachment.ring !== "outer") {
        throw new Error(`perimeter wall ${wall.id} requires a fragmentEdge outer attachment`);
    }
    const outer = Array.isArray(resolvedFloor.outerPolygon) ? resolvedFloor.outerPolygon : [];
    if (outer.length < 3) {
        throw new Error(`perimeter wall ${wall.id} references a floor without an outer polygon`);
    }
    const thickness = Number(wall.thickness);
    if (!Number.isFinite(thickness) || thickness <= 0) {
        throw new Error(`perimeter wall ${wall.id} requires a positive thickness`);
    }
    const insetRing = offsetRing(outer, -thickness * 0.5);
    if (insetRing.length !== outer.length) {
        throw new Error(`perimeter wall ${wall.id} could not resolve inset wall centerline`);
    }
    const startIndex = outer.findIndex((point) => point && point.id === attachment.startVertexId);
    const endIndex = outer.findIndex((point) => point && point.id === attachment.endVertexId);
    if (startIndex < 0 || endIndex < 0) {
        throw new Error(`perimeter wall ${wall.id} attachment references missing floor vertices`);
    }
    return [
        { x: insetRing[startIndex].x, y: insetRing[startIndex].y },
        { x: insetRing[endIndex].x, y: insetRing[endIndex].y }
    ];
}

export function refreshWallEndpointCoordinatesForWall(building, wall) {
    if (!wall) return false;
    if (building) refreshLineBoundaryClipEndpoints(building, wall);
    ["startPoint", "endPoint"].forEach((key) => {
        const endpoint = wall[key];
        const resolved = building ? resolveEndpoint(building, endpoint) : endpoint;
        if (endpoint && resolved && Number.isFinite(resolved.x) && Number.isFinite(resolved.y)) {
            endpoint.x = Number(resolved.x);
            endpoint.y = Number(resolved.y);
        }
    });
    return true;
}

export function refreshWallSectionEndpoints(building, floor = null) {
    const fragmentId = floor ? getFloorId(floor) : "";
    getBuildingWalls(building).forEach((wall) => {
        if (fragmentId && wall.fragmentId !== fragmentId) return;
        refreshWallEndpointCoordinatesForWall(building, wall);
        if (floor && wall.fragmentId === fragmentId) {
            wall.bottomZ = getFloorElevation(floor);
            wall.traversalLayer = Math.round(Number(floor.level) || 0);
        }
    });
}

export function fallbackDeletedVertexEndpointsToPoint(building, fragmentId, vertexId) {
    getBuildingWalls(building).forEach((wall) => {
        if (wall.role === "perimeter") return;
        ["startPoint", "endPoint"].forEach((key) => {
            const endpoint = wall[key];
            if (
                endpoint &&
                endpoint.kind === "vertex" &&
                endpoint.fragmentId === fragmentId &&
                endpoint.vertexId === vertexId
            ) {
                wall[key] = {
                    kind: "point",
                    x: Number(endpoint.x),
                    y: Number(endpoint.y)
                };
            }
        });
    });
}

export function serializeBuilding(building) {
    return JSON.stringify(building, null, 2);
}

export function normalizeImportedBuilding(raw) {
    const building = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!building || typeof building !== "object") {
        throw new Error("imported building JSON must be an object");
    }
    if (building.schema !== "survivor-building-v1") {
        throw new Error(`unsupported building schema: ${building.schema || "missing"}`);
    }

    if (!Array.isArray(building.floorFragments) && Array.isArray(building.floors)) {
        building.floorFragments = building.floors.map((floor) => createFloor({
            elevation: Number(floor.elevation) || 0,
            footprint: floor.footprint,
            holes: floor.holes || [],
            floorTexture: floor.floorTexture || DEFAULTS.floorTexture,
            roofTexture: floor.roofTexture || DEFAULTS.roofTexture,
            floorHeight: floor.floorHeight || (floor.defaults && Number(floor.defaults.wallHeight)) || DEFAULTS.wallHeight,
            defaultWallHeight: floor.defaults && Number(floor.defaults.wallHeight) || DEFAULTS.wallHeight,
            defaultWallTexture: floor.defaults && floor.defaults.wallTexture || DEFAULTS.wallTexture,
            createPerimeterWalls: false
        }));
    }
    if (!Array.isArray(building.floorFragments)) {
        throw new Error("imported building is missing floorFragments array");
    }
    if (!Array.isArray(building.wallSections)) building.wallSections = [];

    building.floorFragments.forEach((floor) => {
        if (!floor.fragmentId) floor.fragmentId = floor.id || nextStringId("floor-fragment");
        if (!floor.surfaceId) floor.surfaceId = floor.fragmentId;
        if (!Array.isArray(floor.outerPolygon) && Array.isArray(floor.footprint)) floor.outerPolygon = floor.footprint;
        floor.outerPolygon = clonePoints(floor.outerPolygon || []);
        floor.holes = Array.isArray(floor.holes) ? floor.holes.map((ring) => clonePoints(ring, "hole-vertex")).filter((ring) => ring.length >= 3) : [];
        floor.floorTexturePath = floor.floorTexturePath || floor.floorTexture || DEFAULTS.floorTexture;
        floor.roofTexturePath = floor.roofTexturePath || floor.roofTexture || (floor.defaults && floor.defaults.roofTexture) || (building.defaults && building.defaults.roofTexture) || DEFAULTS.roofTexture;
        floor.floorHeight = Number.isFinite(Number(floor.floorHeight)) && Number(floor.floorHeight) > 0
            ? Number(floor.floorHeight)
            : (floor.defaults && Number.isFinite(Number(floor.defaults.wallHeight)) ? Number(floor.defaults.wallHeight) : DEFAULTS.wallHeight);
        floor.defaultWallHeight = Number.isFinite(Number(floor.defaultWallHeight))
            ? Number(floor.defaultWallHeight)
            : (floor.defaults && Number.isFinite(Number(floor.defaults.wallHeight)) ? Number(floor.defaults.wallHeight) : DEFAULTS.wallHeight);
        floor.defaultWallTexturePath = floor.defaultWallTexturePath || (floor.defaults && floor.defaults.wallTexture) || DEFAULTS.wallTexture;
        if (!Number.isFinite(Number(floor.nodeBaseZ))) setFloorElevation(floor, Number(floor.elevation) || 0);
    });
    refreshWallSectionEndpoints(building);
    bumpIdCountersFromBuilding(building);
    return building;
}

function bumpIdCountersFromBuilding(building) {
    [building.id, ...getBuildingFloors(building).flatMap((floor) => [
        floor.fragmentId,
        ...(floor.outerPolygon || []).map((point) => point.id),
        ...(floor.holes || []).flatMap((ring) => ring.map((point) => point.id))
    ])].forEach((id) => {
        const match = /-(\d+)$/.exec(String(id || ""));
        if (!match) return;
        stringIdCounter = Math.max(stringIdCounter, Number(match[1]) + 1);
    });
    getBuildingWalls(building).forEach((wall) => {
        if (Number.isInteger(Number(wall.id))) wallIdCounter = Math.max(wallIdCounter, Number(wall.id) + 1);
    });
}

export { DEFAULTS };
