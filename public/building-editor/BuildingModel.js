import "../assets/javascript/wallGeometry.js";

const DEFAULTS = Object.freeze({
    floorTexture: "/assets/images/flooring/woodfloor.png",
    wallTexture: "/assets/images/walls/woodwall.png",
    roofTexture: "/assets/images/roofs/slate.png",
    roofMode: "peak",
    roofOverhang: 0,
    roofPeakHeight: 0,
    roofDomeLevels: 4,
    roofElevationOffset: 0,
    roofShedDirection: Object.freeze({ x: 0, y: -1 }),
    wallHeight: 3,
    wallThickness: 0.25,
    stairWidth: 1.2,
    stairDirection: "up",
    stairRiserDepth: null,
    gridSize: 1
});

let stringIdCounter = 1;
let wallIdCounter = 1;
let mountedObjectIdCounter = 1;
let gableIdCounter = 1;
let beamIdCounter = 1;
let columnIdCounter = 1;
let stairIdCounter = 1;

function nextStringId(prefix) {
    return `${prefix}-${stringIdCounter++}`;
}

function nextWallId() {
    return wallIdCounter++;
}

function nextMountedObjectId() {
    return mountedObjectIdCounter++;
}

function nextGableId() {
    return gableIdCounter++;
}

function nextBeamId() {
    return beamIdCounter++;
}

function nextColumnId() {
    return columnIdCounter++;
}

function nextStairId() {
    return stairIdCounter++;
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

function cloneRoofEdgeAttachment(attachment) {
    if (attachment === undefined || attachment === null) return null;
    if (!attachment || typeof attachment !== "object") {
        throw new Error("roof contact vertex edge attachment must be an object");
    }
    const type = String(attachment.type || "");
    if (type !== "renderedRoofEdge") {
        throw new Error(`unknown roof contact vertex edge attachment type: ${attachment.type}`);
    }
    const floorId = String(attachment.floorId || "");
    const roofId = String(attachment.roofId || "");
    const edgeKind = String(attachment.edgeKind || "");
    const edgeIndex = Math.floor(Number(attachment.edgeIndex));
    if (!floorId) throw new Error("roof contact vertex edge attachment requires a floorId");
    if (!roofId) throw new Error("roof contact vertex edge attachment requires a roofId");
    if (edgeKind !== "peakEave") {
        throw new Error(`unknown roof contact vertex edge attachment edgeKind: ${attachment.edgeKind}`);
    }
    if (!Number.isInteger(edgeIndex) || edgeIndex < 0) {
        throw new Error("roof contact vertex edge attachment edgeIndex must be zero or greater");
    }
    return { type, floorId, roofId, edgeKind, edgeIndex };
}

function cloneRoofContactPoint(point, fallbackPrefix = "roof-contact") {
    const cloned = clonePoint(point, fallbackPrefix);
    const attachment = cloneRoofEdgeAttachment(point && point.roofEdgeAttachment);
    if (attachment) cloned.roofEdgeAttachment = attachment;
    return cloned;
}

function cloneRoofContactPoints(points, fallbackPrefix = "roof-contact") {
    return points.map((point) => cloneRoofContactPoint(point, fallbackPrefix));
}

function cloneFinitePoint(point, label) {
    if (!finitePoint(point)) throw new Error(`${label} must be a finite point`);
    return { x: Number(point.x), y: Number(point.y) };
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
    return !!point && typeof point === "object" &&
        Number.isFinite(Number(point.x)) &&
        Number.isFinite(Number(point.y));
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

function polygonCentroidPoint(points) {
    const ring = ringPoints(points);
    if (ring.length < 3) {
        const totals = ring.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
        return ring.length > 0 ? { x: totals.x / ring.length, y: totals.y / ring.length } : { x: 0, y: 0 };
    }
    let doubleArea = 0;
    let cx = 0;
    let cy = 0;
    for (let index = 0; index < ring.length; index++) {
        const current = ring[index];
        const next = ring[(index + 1) % ring.length];
        const crossValue = current.x * next.y - next.x * current.y;
        doubleArea += crossValue;
        cx += (current.x + next.x) * crossValue;
        cy += (current.y + next.y) * crossValue;
    }
    if (Math.abs(doubleArea) <= 0.000001) {
        const totals = ring.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
        return { x: totals.x / ring.length, y: totals.y / ring.length };
    }
    return { x: cx / (3 * doubleArea), y: cy / (3 * doubleArea) };
}

function normalizeRoofMode(mode) {
    const value = String(mode || DEFAULTS.roofMode).trim().toLowerCase();
    if (value === "peak" || value === "shed" || value === "gabled" || value === "dome") return value;
    throw new Error(`unknown roof mode: ${mode}`);
}

function normalizeDirectionPoint(direction, label) {
    const x = Number(direction && direction.x);
    const y = Number(direction && direction.y);
    const length = Math.hypot(x, y);
    if (!Number.isFinite(length) || length <= 0.000001) {
        throw new Error(`${label} requires a non-zero direction`);
    }
    return { x: x / length, y: y / length };
}

function normalizeWallTopProfile(topProfile, fallbackHeight = DEFAULTS.wallHeight) {
    if (topProfile === undefined || topProfile === null) return null;
    if (!topProfile || typeof topProfile !== "object") {
        throw new Error("wall topProfile must be an object");
    }
    const stationsSource = Array.isArray(topProfile.stations)
        ? topProfile.stations
        : (Array.isArray(topProfile.points) ? topProfile.points : []);
    if (stationsSource.length === 0) return null;
    const stations = stationsSource.map((station) => {
        const t = Number(station && station.t);
        const height = Number(station && station.height);
        const leftHeight = Number(station && station.leftHeight !== undefined ? station.leftHeight : height);
        const rightHeight = Number(station && station.rightHeight !== undefined ? station.rightHeight : height);
        if (!Number.isFinite(t) || t < 0 || t > 1) {
            throw new Error("wall topProfile station t must be between zero and one");
        }
        if (!Number.isFinite(leftHeight) || leftHeight < 0 || !Number.isFinite(rightHeight) || rightHeight < 0) {
            throw new Error("wall topProfile station heights must be zero or greater");
        }
        return { t, leftHeight, rightHeight };
    }).sort((a, b) => a.t - b.t);
    const deduped = [];
    stations.forEach((station) => {
        const previous = deduped[deduped.length - 1];
        if (previous && Math.abs(previous.t - station.t) <= 0.000001) {
            previous.leftHeight = station.leftHeight;
            previous.rightHeight = station.rightHeight;
            return;
        }
        deduped.push(station);
    });
    if (deduped.length === 1) {
        const only = deduped[0];
        deduped.unshift({ ...only, t: 0 });
        deduped[1] = { ...only, t: 1 };
    }
    if (deduped[0].t > 0.000001) {
        deduped.unshift({ ...deduped[0], t: 0 });
    } else {
        deduped[0].t = 0;
    }
    const lastIndex = deduped.length - 1;
    if (deduped[lastIndex].t < 0.999999) {
        deduped.push({ ...deduped[lastIndex], t: 1 });
    } else {
        deduped[lastIndex].t = 1;
    }
    const fallback = Number(fallbackHeight);
    const flatHeight = Number.isFinite(fallback) && fallback >= 0 ? fallback : DEFAULTS.wallHeight;
    const flat = deduped.length === 2 &&
        deduped.every((station) => Math.abs(station.leftHeight - flatHeight) <= 0.000001 && Math.abs(station.rightHeight - flatHeight) <= 0.000001);
    if (flat && !topProfile.generatedBy) return null;
    const result = {
        kind: "stations",
        stations: deduped.map((station) => ({
            t: Number(station.t),
            leftHeight: Number(station.leftHeight),
            rightHeight: Number(station.rightHeight)
        }))
    };
    if (topProfile.generatedBy && typeof topProfile.generatedBy === "object") {
        result.generatedBy = clonePlainObject(topProfile.generatedBy);
    }
    return result;
}

function normalizeRoofDomeLevels(levels) {
    const value = Math.floor(Number(levels));
    if (!Number.isInteger(value) || value < 1) {
        throw new Error("building roof dome levels must be a positive integer");
    }
    return value;
}

function normalizeStairDirection(direction) {
    const value = String(direction || DEFAULTS.stairDirection).trim().toLowerCase();
    if (value === "up" || value === "down") return value;
    throw new Error(`stair direction must be up or down: ${direction || "missing"}`);
}

function normalizeStairWidth(width, label = "stair width") {
    const value = Number(width);
    if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`${label} must be a positive number`);
    }
    return value;
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

export function offsetRing(ring, distance) {
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

export function floorVertexWallInsetPoint(floor, ringKind, holeIndex, vertexId, wallThickness = DEFAULTS.wallThickness) {
    if (!floor) return null;
    const thickness = Number(wallThickness);
    if (!Number.isFinite(thickness) || thickness <= 0) {
        throw new Error("inset floor vertex snap requires a positive wall thickness");
    }
    const ring = ringKind === "hole"
        ? (Array.isArray(floor.holes) ? floor.holes[Math.floor(Number(holeIndex))] : null)
        : floor.outerPolygon;
    const vertexIndex = Array.isArray(ring) ? ring.findIndex((point) => point && point.id === vertexId) : -1;
    if (vertexIndex < 0) return null;
    const distance = thickness * 0.5;
    const points = offsetRing(ring, ringKind === "hole" ? distance : -distance);
    const insetPoint = points[vertexIndex];
    return insetPoint && finitePoint(insetPoint)
        ? { x: Number(insetPoint.x), y: Number(insetPoint.y) }
        : null;
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
    const oppositeEndpoint = resolveEndpoint(building, wall[oppositeKey], wall) || wall[oppositeKey];
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
            roofMode: DEFAULTS.roofMode,
            roofOverhang: DEFAULTS.roofOverhang,
            roofPeakHeight: DEFAULTS.roofPeakHeight,
            wallHeight: DEFAULTS.wallHeight,
            wallThickness: DEFAULTS.wallThickness
        },
        floorFragments: [],
        wallSections: [],
        mountedWallObjects: [],
        roof: null
    };
}

function normalizeColumnTopHeights(topHeights, sideCount) {
    if (topHeights === undefined || topHeights === null) return null;
    if (!Array.isArray(topHeights)) throw new Error("column topHeights must be an array");
    const expectedCount = Math.round(Number(sideCount));
    if (!Number.isInteger(expectedCount) || expectedCount < 3) {
        throw new Error("column topHeights requires a valid sideCount");
    }
    if (topHeights.length !== expectedCount) {
        throw new Error(`column topHeights must contain ${expectedCount} entries`);
    }
    return topHeights.map((value, index) => {
        const height = Number(value);
        if (!Number.isFinite(height) || height <= 0) {
            throw new Error(`column topHeights entry ${index} must be a positive finite number`);
        }
        return height;
    });
}

export function getBuildingFloors(building) {
    return Array.isArray(building && building.floorFragments) ? building.floorFragments : [];
}

export function getBuildingWalls(building) {
    return Array.isArray(building && building.wallSections) ? building.wallSections : [];
}

export function getBuildingMountedObjects(building) {
    return Array.isArray(building && building.mountedWallObjects) ? building.mountedWallObjects : [];
}

export function getBuildingBeams(building) {
    return getBuildingFloors(building).flatMap((floor) => Array.isArray(floor.beams) ? floor.beams : []);
}

export function getBuildingColumns(building) {
    return getBuildingFloors(building).flatMap((floor) => Array.isArray(floor.columns) ? floor.columns : []);
}

export function getBuildingStairs(building) {
    return getBuildingFloors(building).flatMap((floor) => Array.isArray(floor.stairs) ? floor.stairs : []);
}

export function getFloorBeams(floor) {
    return Array.isArray(floor && floor.beams) ? floor.beams : [];
}

export function getFloorColumns(floor) {
    return Array.isArray(floor && floor.columns) ? floor.columns : [];
}

export function getFloorStairs(floor) {
    return Array.isArray(floor && floor.stairs) ? floor.stairs : [];
}

export function createRoof({
    floorId = "",
    mode = DEFAULTS.roofMode,
    texture = DEFAULTS.roofTexture,
    overhang = DEFAULTS.roofOverhang,
    peakHeight = DEFAULTS.roofPeakHeight,
    domeLevels = DEFAULTS.roofDomeLevels,
    peakPoint = null,
    elevationOffset = DEFAULTS.roofElevationOffset,
    shedDirection = DEFAULTS.roofShedDirection,
    contactPolygon = [],
    gables = []
} = {}) {
    const roof = {
        type: "roof",
        id: nextStringId("roof"),
        floorId: String(floorId || ""),
        mode: normalizeRoofMode(mode),
        texturePath: texture,
        overhang: Number(overhang),
        peakHeight: Number(peakHeight),
        domeLevels: normalizeRoofDomeLevels(domeLevels),
        peakPoint: peakPoint ? cloneFinitePoint(peakPoint, "building roof peak point") : null,
        elevationOffset: Number(elevationOffset),
        shedDirection: normalizeDirectionPoint(shedDirection, "building shed roof direction"),
        contactPolygon: Array.isArray(contactPolygon) ? cloneRoofContactPoints(contactPolygon, "roof-contact") : [],
        gables: Array.isArray(gables) ? gables.map((gable) => normalizeRoofGable(gable)) : []
    };
    if (typeof roof.texturePath !== "string" || roof.texturePath.length === 0) {
        throw new Error("building roof requires a texture path");
    }
    if (!Number.isFinite(roof.overhang)) {
        throw new Error("building roof overhang must be a finite number");
    }
    if (!Number.isFinite(roof.peakHeight) || roof.peakHeight < 0) {
        throw new Error("building roof peak height must be zero or greater");
    }
    if (!Number.isFinite(roof.elevationOffset)) {
        throw new Error("building roof elevation offset must be a finite number");
    }
    if (!Array.isArray(roof.contactPolygon)) {
        throw new Error("building roof contact polygon must be an array");
    }
    return roof;
}

function normalizeRoofGableEndpoint(endpoint, legacyEdgeIndex, legacyT, label) {
    const source = endpoint && typeof endpoint === "object"
        ? endpoint
        : { edgeIndex: legacyEdgeIndex, t: legacyT };
    const edgeIndex = Math.floor(Number(source.edgeIndex ?? source.faceIndex));
    const t = Number(source.t);
    if (!Number.isInteger(edgeIndex) || edgeIndex < 0) {
        throw new Error(`roof gable ${label} edgeIndex must be a zero or greater integer`);
    }
    if (!Number.isFinite(t)) {
        throw new Error(`roof gable ${label} t must be finite`);
    }
    return {
        edgeIndex,
        t: Math.max(0, Math.min(1, t))
    };
}

export function normalizeRoofGable(gable) {
    if (!gable || typeof gable !== "object") {
        throw new Error("roof gable must be an object");
    }
    const legacyFaceIndex = Math.floor(Number(gable.faceIndex));
    const legacyStartT = Number(gable.startT);
    const legacyEndT = Number(gable.endT);
    const height = Number(gable.height);
    const wallTexturePath = typeof gable.wallTexturePath === "string" && gable.wallTexturePath.length > 0
        ? gable.wallTexturePath
        : DEFAULTS.wallTexture;
    if (!Number.isFinite(height) || height < 0) {
        throw new Error("roof gable height must be zero or greater");
    }
    if (
        (!gable.start || !gable.end) &&
        (!Number.isInteger(legacyFaceIndex) || legacyFaceIndex < 0 || !Number.isFinite(legacyStartT) || !Number.isFinite(legacyEndT))
    ) {
        throw new Error("roof gable endpoints must be finite");
    }
    const legacyMinT = Math.min(legacyStartT, legacyEndT);
    const legacyMaxT = Math.max(legacyStartT, legacyEndT);
    const start = normalizeRoofGableEndpoint(gable.start, legacyFaceIndex, legacyMinT, "start");
    const end = normalizeRoofGableEndpoint(gable.end, legacyFaceIndex, legacyMaxT, "end");
    if (start.edgeIndex === end.edgeIndex && Math.abs(start.t - end.t) < 0.000001) {
        throw new Error("roof gable endpoints must not coincide");
    }
    return {
        type: "gable",
        id: Number.isInteger(Number(gable.id)) ? Number(gable.id) : nextGableId(),
        start,
        end,
        height,
        wallTexturePath,
        roofReturn: gable.roofReturn !== false
    };
}

function normalizeFloorRoof(floor, roof) {
    if (!floor || typeof floor !== "object" || !roof || typeof roof !== "object") return null;
    roof.floorId = getFloorId(floor);
    if (!Array.isArray(roof.contactPolygon) || roof.contactPolygon.length === 0) {
        roof.contactPolygon = cloneRoofContactPoints(floor.outerPolygon || [], "roof-contact");
    } else {
        roof.contactPolygon = cloneRoofContactPoints(roof.contactPolygon, "roof-contact");
    }
    roof.mode = normalizeRoofMode(roof.mode);
    roof.domeLevels = normalizeRoofDomeLevels(roof.domeLevels ?? DEFAULTS.roofDomeLevels);
    roof.shedDirection = normalizeDirectionPoint(roof.shedDirection || DEFAULTS.roofShedDirection, "building shed roof direction");
    if (!finitePoint(roof.peakPoint)) {
        roof.peakPoint = polygonCentroidPoint(roof.contactPolygon || floor.outerPolygon || []);
    } else {
        roof.peakPoint = cloneFinitePoint(roof.peakPoint, "building roof peak point");
    }
    if (!Array.isArray(roof.gables)) roof.gables = [];
    return roof;
}

export function getFloorRoof(floor) {
    if (!floor || typeof floor !== "object") return null;
    return normalizeFloorRoof(floor, floor.roof);
}

export function getFloorRoofs(floor) {
    if (!floor || typeof floor !== "object") return [];
    const roofs = [];
    const seen = new Set();
    const addRoof = (roof) => {
        const normalized = normalizeFloorRoof(floor, roof);
        if (!normalized) return;
        const key = normalized.id ? String(normalized.id) : `object:${roofs.length}`;
        if (seen.has(key)) return;
        seen.add(key);
        roofs.push(normalized);
    };
    addRoof(floor.roof);
    (Array.isArray(floor.roofs) ? floor.roofs : []).forEach(addRoof);
    return roofs;
}

export function findFloorRoof(floor, roofId) {
    const id = String(roofId || "");
    if (!id) return getFloorRoof(floor);
    return getFloorRoofs(floor).find((roof) => String(roof.id) === id) || null;
}

export function getRoofContactPolygon(floorOrRoof) {
    const roof = floorOrRoof && floorOrRoof.type === "roof" ? floorOrRoof : getFloorRoof(floorOrRoof);
    return Array.isArray(roof && roof.contactPolygon) ? roof.contactPolygon : [];
}

export function defaultRoofPeakPointForFloor(floor) {
    const contactPolygon = floor && floor.roof && Array.isArray(floor.roof.contactPolygon) && floor.roof.contactPolygon.length >= 3
        ? floor.roof.contactPolygon
        : (floor && floor.outerPolygon);
    return polygonCentroidPoint(contactPolygon || []);
}

export function getRoofPeakPoint(floorOrRoof) {
    const roof = floorOrRoof && floorOrRoof.type === "roof" ? floorOrRoof : getFloorRoof(floorOrRoof);
    if (!roof) return null;
    if (!finitePoint(roof.peakPoint)) {
        if (floorOrRoof && floorOrRoof.type === "roof") {
            throw new Error(`roof ${roof.id || "(missing id)"} peak point is missing`);
        }
        roof.peakPoint = defaultRoofPeakPointForFloor(floorOrRoof);
    }
    return roof.peakPoint;
}

export function getRoofShedDirection(floorOrRoof) {
    const roof = floorOrRoof && floorOrRoof.type === "roof" ? floorOrRoof : getFloorRoof(floorOrRoof);
    if (!roof) return null;
    roof.shedDirection = normalizeDirectionPoint(roof.shedDirection || DEFAULTS.roofShedDirection, "building shed roof direction");
    return roof.shedDirection;
}

export function getRoofDomeLevels(floorOrRoof) {
    const roof = floorOrRoof && floorOrRoof.type === "roof" ? floorOrRoof : getFloorRoof(floorOrRoof);
    if (!roof) return DEFAULTS.roofDomeLevels;
    roof.domeLevels = normalizeRoofDomeLevels(roof.domeLevels ?? DEFAULTS.roofDomeLevels);
    return roof.domeLevels;
}

export function getRoofGables(floorOrRoof) {
    const roof = floorOrRoof && floorOrRoof.type === "roof" ? floorOrRoof : getFloorRoof(floorOrRoof);
    return Array.isArray(roof && roof.gables) ? roof.gables : [];
}

export function getFloorId(floor) {
    return String((floor && (floor.fragmentId || floor.id)) || "");
}

export function getFloorElevation(floor) {
    return Number.isFinite(Number(floor && floor.nodeBaseZ)) ? Number(floor.nodeBaseZ) : 0;
}

function setDerivedFloorStackLevel(floor, level) {
    if (!floor || typeof floor !== "object") return;
    const resolvedLevel = Math.round(Number(level));
    if (!Number.isInteger(resolvedLevel)) {
        throw new Error("floor stack level must be a finite integer");
    }
    const z = getFloorElevation(floor);
    Object.defineProperty(floor, "level", {
        value: resolvedLevel,
        enumerable: false,
        writable: true,
        configurable: true
    });
    Object.defineProperty(floor, "nodeBaseZOffset", {
        value: 0,
        enumerable: false,
        writable: true,
        configurable: true
    });
}

export function syncFloorStackLevels(building) {
    const floors = getBuildingFloors(building)
        .map((floor, index) => ({ floor, index, z: getFloorElevation(floor) }))
        .sort((a, b) => {
            if (a.z !== b.z) return a.z - b.z;
            return a.index - b.index;
        });
    floors.forEach((entry, level) => setDerivedFloorStackLevel(entry.floor, level));
    return building;
}

export function setFloorElevation(floor, elevation) {
    const z = Number(elevation);
    if (!Number.isFinite(z)) throw new Error("floor elevation must be a finite number");
    floor.nodeBaseZ = z;
    if (Number.isFinite(Number(floor.level))) {
        setDerivedFloorStackLevel(floor, Math.round(Number(floor.level)));
    }
}

export function createFloor({
    elevation = 0,
    footprint,
    holes = [],
    floorTexture = DEFAULTS.floorTexture,
    roofTexture = DEFAULTS.roofTexture,
    roofMode = DEFAULTS.roofMode,
    roofOverhang = DEFAULTS.roofOverhang,
    roofPeakHeight = DEFAULTS.roofPeakHeight,
    roofDomeLevels = DEFAULTS.roofDomeLevels,
    roofElevationOffset = DEFAULTS.roofElevationOffset,
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
        nodeBaseZ: 0,
        outerPolygon: clonePoints(footprint),
        holes: Array.isArray(holes) ? holes.map((ring) => clonePoints(ring, "hole-vertex")).filter((ring) => ring.length >= 3) : [],
        floorTexturePath: floorTexture,
        roof: createRoof({
            floorId: fragmentId,
            mode: roofMode,
            texture: roofTexture,
            overhang: roofOverhang,
            peakHeight: roofPeakHeight,
            domeLevels: roofDomeLevels,
            elevationOffset: roofElevationOffset,
            shedDirection: DEFAULTS.roofShedDirection,
            contactPolygon: []
        }),
        floorHeight: Number(floorHeight),
        defaultWallHeight: Number(defaultWallHeight),
        defaultWallTexturePath: defaultWallTexture,
        posts: [],
        beams: [],
        columns: [],
        stairs: []
    };
    setFloorElevation(floor, elevation);
    floor.roof.contactPolygon = clonePoints(floor.outerPolygon, "roof-contact");
    floor.roof.peakPoint = defaultRoofPeakPointForFloor(floor);
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
    topProfile = null,
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
        topProfile: null,
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
    wall.topProfile = normalizeWallTopProfile(topProfile, wall.height);
    if (!Number.isFinite(wall.bottomZ)) {
        throw new Error("wall section bottomZ must be finite");
    }
    refreshWallEndpointCoordinatesForWall(null, wall);
    return wall;
}

export function createBeam({
    floorId,
    startAttachment = null,
    endAttachment = null,
    startOverhang = 0,
    endOverhang = 0,
    bottomZ = 0,
    thickness = 0.001,
    height = 0.2,
    texturePath = DEFAULTS.wallTexture
}) {
    const resolvedFloorId = String(floorId || "");
    if (!resolvedFloorId) throw new Error("beam requires a floor fragment id");
    const resolvedThickness = Number(thickness);
    if (!Number.isFinite(resolvedThickness) || resolvedThickness < 0.001) {
        throw new Error("beam thickness must be at least 0.001");
    }
    const resolvedHeight = Number(height);
    if (!Number.isFinite(resolvedHeight) || resolvedHeight <= 0) {
        throw new Error("beam height must be a positive number");
    }
    const resolvedBottomZ = Number(bottomZ);
    if (!Number.isFinite(resolvedBottomZ)) throw new Error("beam bottomZ must be finite");
    return {
        type: "beam",
        id: nextBeamId(),
        floorId: resolvedFloorId,
        startAttachment: startAttachment ? JSON.parse(JSON.stringify(startAttachment)) : { kind: "free", x: 0, y: 0 },
        endAttachment: endAttachment ? JSON.parse(JSON.stringify(endAttachment)) : { kind: "free", x: 0, y: 0 },
        startOverhang: Math.max(0, Number(startOverhang) || 0),
        endOverhang: Math.max(0, Number(endOverhang) || 0),
        bottomZ: resolvedBottomZ,
        thickness: resolvedThickness,
        height: resolvedHeight,
        texturePath: String(texturePath || DEFAULTS.wallTexture)
    };
}

export function columnVertices(column) {
    const cx = Number(column && column.position && column.position.x) || 0;
    const cy = Number(column && column.position && column.position.y) || 0;
    const n = Math.round(Number(column && column.sideCount) || 4);
    const legacySize = Number(column && column.size) || 0.125;
    const width = Number.isFinite(Number(column && column.width)) && Number(column.width) > 0
        ? Number(column.width)
        : legacySize * 2;
    const depth = Number.isFinite(Number(column && column.depth)) && Number(column.depth) > 0
        ? Number(column.depth)
        : legacySize * 2;
    const rot = Number(column && column.rotation) || 0;
    const scale = 1 / Math.cos(Math.PI / n);
    const vertices = [];
    for (let i = 0; i < n; i++) {
        const angle = Math.PI / n + (i * 2 * Math.PI) / n;
        const localX = (width * 0.5 * scale) * Math.cos(angle);
        const localY = (depth * 0.5 * scale) * Math.sin(angle);
        vertices.push({
            x: cx + localX * Math.cos(rot) - localY * Math.sin(rot),
            y: cy + localX * Math.sin(rot) + localY * Math.cos(rot)
        });
    }
    return vertices;
}

export function createColumn({
    floorId,
    position,
    sideCount = 4,
    size = 0.125,
    width = null,
    depth = null,
    rotation = 0,
    height = null,
    heightMode = null,
    topHeights = null,
    bottomZ = 0,
    traversalLayer = 0,
    texturePath = DEFAULTS.wallTexture,
    wallId = null,
    floorDefaultWallHeight = null
}) {
    const resolvedFloorId = String(floorId || "");
    if (!resolvedFloorId) throw new Error("column requires a floor fragment id");
    if (!finitePoint(position)) throw new Error("column requires a finite position");
    const resolvedSideCount = Math.round(Number(sideCount) || 4);
    if (resolvedSideCount < 3 || resolvedSideCount > 12) {
        throw new Error("column sideCount must be between 3 and 12");
    }
    const legacySize = Number(size);
    const resolvedWidth = Number(width ?? (Number.isFinite(legacySize) ? legacySize * 2 : 0.25));
    const resolvedDepth = Number(depth ?? (Number.isFinite(legacySize) ? legacySize * 2 : 0.25));
    if (!Number.isFinite(resolvedWidth) || resolvedWidth <= 0 || resolvedWidth > 2) {
        throw new Error("column width must be a positive number no greater than 2");
    }
    if (!Number.isFinite(resolvedDepth) || resolvedDepth <= 0 || resolvedDepth > 2) {
        throw new Error("column depth must be a positive number no greater than 2");
    }
    const resolvedHeight = Number(height ?? floorDefaultWallHeight ?? DEFAULTS.wallHeight);
    if (!Number.isFinite(resolvedHeight) || resolvedHeight <= 0) {
        throw new Error("column height must be a positive number");
    }
    const resolvedBottomZ = Number(bottomZ);
    if (!Number.isFinite(resolvedBottomZ)) throw new Error("column bottomZ must be finite");
    const resolvedWallId = wallId === undefined || wallId === null || wallId === ""
        ? null
        : (Number.isFinite(Number(wallId)) ? Number(wallId) : String(wallId));
    const resolvedHeightMode = String(heightMode || "").trim().toLowerCase() === "fixed"
        ? "fixed"
        : (resolvedWallId !== null ? "wall" : "fixed");
    return {
        type: "column",
        id: nextColumnId(),
        floorId: resolvedFloorId,
        wallId: resolvedWallId,
        heightMode: resolvedHeightMode,
        position: { x: Number(position.x), y: Number(position.y) },
        sideCount: resolvedSideCount,
        size: resolvedWidth * 0.5,
        width: resolvedWidth,
        depth: resolvedDepth,
        rotation: Number(rotation) || 0,
        height: resolvedHeight,
        topHeights: normalizeColumnTopHeights(topHeights, resolvedSideCount),
        bottomZ: resolvedBottomZ,
        traversalLayer: Math.round(Number(traversalLayer) || 0),
        texturePath: String(texturePath || DEFAULTS.wallTexture)
    };
}

export function stairFootprintPoints(stair) {
    if (!stair || typeof stair !== "object") throw new Error("stair footprint requires a stair record");
    if (stair.ladder === true && Array.isArray(stair.footprint) && stair.footprint.length === 4) {
        return stair.footprint.map((point) => cloneFinitePoint(point, "ladder stair footprint point"));
    }
    if (Array.isArray(stair.treads) && stair.treads.length >= 2) {
        const left = [];
        const right = [];
        stair.treads.forEach((tread, index) => {
            if (!finitePoint(tread && tread.left) || !finitePoint(tread && tread.right)) {
                throw new Error(`stair ${stair.id || "(new)"} tread ${index} requires finite endpoints`);
            }
            left.push({ x: Number(tread.left.x), y: Number(tread.left.y) });
            right.push({ x: Number(tread.right.x), y: Number(tread.right.y) });
        });
        return [...left, ...right.reverse()];
    }
    const start = stair.startPoint || stair.lowerPoint;
    const end = stair.endPoint || stair.higherPoint;
    if (!finitePoint(start) || !finitePoint(end)) {
        throw new Error(`stair ${stair.id || "(new)"} requires finite endpoints`);
    }
    const dx = Number(end.x) - Number(start.x);
    const dy = Number(end.y) - Number(start.y);
    const length = Math.hypot(dx, dy);
    if (!Number.isFinite(length) || length <= 0.000001) {
        throw new Error(`stair ${stair.id || "(new)"} requires non-coincident endpoints`);
    }
    const width = normalizeStairWidth(stair.width);
    const nx = -dy / length;
    const ny = dx / length;
    const halfWidth = width * 0.5;
    return [
        { x: Number(start.x) + nx * halfWidth, y: Number(start.y) + ny * halfWidth },
        { x: Number(end.x) + nx * halfWidth, y: Number(end.y) + ny * halfWidth },
        { x: Number(end.x) - nx * halfWidth, y: Number(end.y) - ny * halfWidth },
        { x: Number(start.x) - nx * halfWidth, y: Number(start.y) - ny * halfWidth }
    ];
}

function normalizeStairTreads(treads, width, label = "stair treads") {
    if (!Array.isArray(treads) || treads.length < 2) return null;
    return treads.map((tread, index) => {
        if (!finitePoint(tread && tread.left) || !finitePoint(tread && tread.right)) {
            throw new Error(`${label} ${index} requires finite left and right endpoints`);
        }
        const left = { x: Number(tread.left.x), y: Number(tread.left.y) };
        const right = { x: Number(tread.right.x), y: Number(tread.right.y) };
        const treadWidth = Math.hypot(right.x - left.x, right.y - left.y);
        if (!Number.isFinite(treadWidth) || treadWidth <= 0.000001) {
            throw new Error(`${label} ${index} must have non-coincident endpoints`);
        }
        const targetWidth = Number(width);
        if (Number.isFinite(targetWidth) && targetWidth > 0 && Math.abs(treadWidth - targetWidth) > 0.01) {
            throw new Error(`${label} ${index} width does not match stair width`);
        }
        const normalized = {
            left,
            right,
            center: {
                x: (left.x + right.x) * 0.5,
                y: (left.y + right.y) * 0.5
            }
        };
        if (Object.prototype.hasOwnProperty.call(tread, "arcDeltaAngle")) {
            const value = Number(tread.arcDeltaAngle);
            if (!Number.isFinite(value)) throw new Error(`${label} ${index} arcDeltaAngle must be finite`);
            normalized.arcDeltaAngle = value;
        }
        if (Object.prototype.hasOwnProperty.call(tread, "arcNearDeltaAngle")) {
            const value = Number(tread.arcNearDeltaAngle);
            if (!Number.isFinite(value)) throw new Error(`${label} ${index} arcNearDeltaAngle must be finite`);
            normalized.arcNearDeltaAngle = value;
        }
        return normalized;
    });
}

function defaultStairRiserDepth(height, stepCount) {
    const resolvedHeight = Number(height);
    const resolvedStepCount = Math.max(1, Math.round(Number(stepCount) || 1));
    if (!Number.isFinite(resolvedHeight) || resolvedHeight <= 0) return 0;
    return Math.min(resolvedHeight, resolvedHeight / (resolvedStepCount + 1) + 0.25);
}

function normalizeStairRiserDepth(value, height, stepCount, label = "stair riser depth") {
    if (value === null || value === undefined || value === "") {
        return defaultStairRiserDepth(height, stepCount);
    }
    const depth = Number(value);
    const maxDepth = Number(height);
    if (!Number.isFinite(depth) || depth < 0) {
        throw new Error(`${label} must be zero or greater`);
    }
    if (!Number.isFinite(maxDepth) || maxDepth <= 0) {
        throw new Error(`${label} requires a positive stair height`);
    }
    if (depth > maxDepth) {
        throw new Error(`${label} must be no greater than the stair height`);
    }
    return depth;
}

function defaultTreadsFromCenterline(startPoint, endPoint, width) {
    const dx = Number(endPoint.x) - Number(startPoint.x);
    const dy = Number(endPoint.y) - Number(startPoint.y);
    const length = Math.hypot(dx, dy);
    if (!Number.isFinite(length) || length <= 0.000001) {
        throw new Error("stair endpoints must not coincide");
    }
    const nx = -dy / length;
    const ny = dx / length;
    const halfWidth = Number(width) * 0.5;
    const treadAt = (point) => {
        const center = { x: Number(point.x), y: Number(point.y) };
        const left = { x: center.x + nx * halfWidth, y: center.y + ny * halfWidth };
        const right = { x: center.x - nx * halfWidth, y: center.y - ny * halfWidth };
        return {
            left,
            right,
            center,
            angle: Math.atan2(right.y - left.y, right.x - left.x)
        };
    };
    return [treadAt(startPoint), treadAt(endPoint)];
}

export function createStraightStair({
    floorId,
    startPoint,
    endPoint,
    width = DEFAULTS.stairWidth,
    direction = DEFAULTS.stairDirection,
    texturePath = DEFAULTS.floorTexture,
    treadTexturePath = null,
    riserTexturePath = null,
    bottomZ = 0,
    height = DEFAULTS.wallHeight,
    stepCount = null,
    riserDepth = DEFAULTS.stairRiserDepth,
    treads = null,
    ladder = false,
    footprint = null,
    depth = 1 / 6
}) {
    const resolvedFloorId = String(floorId || "");
    if (!resolvedFloorId) throw new Error("stair requires a floor fragment id");
    const resolvedWidth = normalizeStairWidth(width);
    const resolvedTreads = Array.isArray(treads)
        ? normalizeStairTreads(treads, resolvedWidth)
        : null;
    if (!resolvedTreads && (!finitePoint(startPoint) || !finitePoint(endPoint))) {
        throw new Error("stair requires finite start and end points");
    }
    const generatedTreads = resolvedTreads || defaultTreadsFromCenterline(startPoint, endPoint, resolvedWidth);
    const firstTread = generatedTreads[0];
    const lastTread = generatedTreads[generatedTreads.length - 1];
    const resolvedStartPoint = firstTread.center;
    const resolvedEndPoint = lastTread.center;
    const runLength = Math.hypot(resolvedEndPoint.x - resolvedStartPoint.x, resolvedEndPoint.y - resolvedStartPoint.y);
    if (ladder !== true && (!Number.isFinite(runLength) || runLength <= 0.000001)) {
        throw new Error("stair endpoints must not coincide");
    }
    const resolvedHeight = Number(height);
    if (!Number.isFinite(resolvedHeight) || resolvedHeight <= 0) {
        throw new Error("stair height must be a positive number");
    }
    const resolvedDirection = normalizeStairDirection(direction);
    const resolvedStepCount = stepCount === null || stepCount === undefined
        ? Math.max(3, generatedTreads.length)
        : Math.max(1, Math.round(Number(stepCount)));
    if (!Number.isInteger(resolvedStepCount) || resolvedStepCount < 1) {
        throw new Error("stair stepCount must be a positive integer");
    }
    const resolvedRiserDepth = normalizeStairRiserDepth(riserDepth, resolvedHeight, resolvedStepCount);
    const resolvedBottomZ = Number(bottomZ);
    if (!Number.isFinite(resolvedBottomZ)) throw new Error("stair bottomZ must be finite");
    const resolvedTreadTexture = String(treadTexturePath || texturePath || DEFAULTS.floorTexture);
    const resolvedRiserTexture = String(riserTexturePath || texturePath || resolvedTreadTexture || DEFAULTS.floorTexture);
    if (!resolvedTreadTexture) throw new Error("stair tread texture path must be a non-empty string");
    if (!resolvedRiserTexture) throw new Error("stair riser texture path must be a non-empty string");
    const stair = {
        type: "stairs",
        id: nextStairId(),
        stairKind: "treadPath",
        floorId: resolvedFloorId,
        startPoint: { x: Number(resolvedStartPoint.x), y: Number(resolvedStartPoint.y) },
        endPoint: { x: Number(resolvedEndPoint.x), y: Number(resolvedEndPoint.y) },
        treads: generatedTreads,
        ladder: ladder === true,
        direction: resolvedDirection,
        width: resolvedWidth,
        bottomZ: resolvedBottomZ,
        height: resolvedHeight,
        stepCount: resolvedStepCount,
        riserDepth: resolvedRiserDepth,
        texturePath: resolvedTreadTexture,
        treadTexturePath: resolvedTreadTexture,
        riserTexturePath: resolvedRiserTexture
    };
    if (stair.ladder) {
        const resolvedDepth = Number(depth);
        if (!Number.isFinite(resolvedDepth) || resolvedDepth <= 0) throw new Error("ladder stair depth must be a positive number");
        stair.depth = resolvedDepth;
        if (!Array.isArray(footprint) || footprint.length !== 4) {
            throw new Error("ladder stair requires a four-point footprint");
        }
        stair.footprint = footprint.map((point) => cloneFinitePoint(point, "ladder stair footprint point"));
    } else {
        stair.footprint = stairFootprintPoints(stair);
    }
    return stair;
}

export function createWallMountedObject({
    floorId,
    wallId,
    category,
    texturePath,
    wallT,
    width,
    height,
    zOffset,
    placementRotation = 0,
    mountedWallFacingSign = 1,
    placeableAnchorX = 0.5,
    placeableAnchorY = 1,
    renderDepthOffset = 0,
    compositeLayers = null
}) {
    const resolvedFloorId = String(floorId || "");
    if (!resolvedFloorId) throw new Error("mounted wall object requires a floor fragment id");
    const resolvedWallId = Number(wallId);
    if (!Number.isFinite(resolvedWallId)) throw new Error("mounted wall object requires a finite wall id");
    const resolvedCategory = String(category || "").trim().toLowerCase();
    if (resolvedCategory !== "doors" && resolvedCategory !== "windows") {
        throw new Error(`mounted wall object category must be doors or windows: ${resolvedCategory || "missing"}`);
    }
    if (typeof texturePath !== "string" || texturePath.length === 0) {
        throw new Error("mounted wall object requires a texture path");
    }
    const t = Number(wallT);
    if (!Number.isFinite(t)) throw new Error("mounted wall object requires a finite wall position");
    const objectWidth = Number(width);
    const objectHeight = Number(height);
    if (!Number.isFinite(objectWidth) || objectWidth <= 0) {
        throw new Error("mounted wall object width must be a positive number");
    }
    if (!Number.isFinite(objectHeight) || objectHeight <= 0) {
        throw new Error("mounted wall object height must be a positive number");
    }
    const objectZOffset = Number(zOffset);
    if (!Number.isFinite(objectZOffset)) throw new Error("mounted wall object z offset must be finite");
    return {
        type: "placedObject",
        id: nextMountedObjectId(),
        category: resolvedCategory,
        texturePath,
        floorId: resolvedFloorId,
        wallId: resolvedWallId,
        mountedSectionId: resolvedWallId,
        mountedWallLineGroupId: resolvedWallId,
        mountedWallSectionUnitId: resolvedWallId,
        mountedWallFacingSign: Number(mountedWallFacingSign) >= 0 ? 1 : -1,
        wallT: Math.max(0, Math.min(1, t)),
        width: objectWidth,
        height: objectHeight,
        zOffset: objectZOffset,
        rotationAxis: "spatial",
        placementRotation: Number.isFinite(Number(placementRotation)) ? Number(placementRotation) : 0,
        placeableAnchorX: Number.isFinite(Number(placeableAnchorX)) ? Number(placeableAnchorX) : 0.5,
        placeableAnchorY: Number.isFinite(Number(placeableAnchorY)) ? Number(placeableAnchorY) : 1,
        renderDepthOffset: Number.isFinite(Number(renderDepthOffset)) ? Number(renderDepthOffset) : 0,
        compositeLayers: Array.isArray(compositeLayers) ? clonePlainObject(compositeLayers) : null
    };
}

export function createGableMountedObject({
    floorId,
    gableId,
    gableSegmentIndex,
    category,
    texturePath,
    wallT,
    width,
    height,
    zOffset,
    placementRotation = 0,
    mountedWallFacingSign = 1,
    placeableAnchorX = 0.5,
    placeableAnchorY = 0.5,
    renderDepthOffset = 0,
    compositeLayers = null
}) {
    const resolvedFloorId = String(floorId || "");
    if (!resolvedFloorId) throw new Error("gable-mounted window requires a floor fragment id");
    const resolvedGableId = Number(gableId);
    if (!Number.isInteger(resolvedGableId)) throw new Error("gable-mounted window requires an integer gable id");
    const segmentIndex = Number(gableSegmentIndex);
    if (!Number.isInteger(segmentIndex) || segmentIndex < 0) {
        throw new Error("gable-mounted window requires a zero or greater gable segment index");
    }
    const resolvedCategory = String(category || "").trim().toLowerCase();
    if (resolvedCategory !== "windows") {
        throw new Error(`gable-mounted object category must be windows: ${resolvedCategory || "missing"}`);
    }
    if (typeof texturePath !== "string" || texturePath.length === 0) {
        throw new Error("gable-mounted window requires a texture path");
    }
    const t = Number(wallT);
    if (!Number.isFinite(t)) throw new Error("gable-mounted window requires a finite wall position");
    const objectWidth = Number(width);
    const objectHeight = Number(height);
    if (!Number.isFinite(objectWidth) || objectWidth <= 0) {
        throw new Error("gable-mounted window width must be a positive number");
    }
    if (!Number.isFinite(objectHeight) || objectHeight <= 0) {
        throw new Error("gable-mounted window height must be a positive number");
    }
    const objectZOffset = Number(zOffset);
    if (!Number.isFinite(objectZOffset)) throw new Error("gable-mounted window z offset must be finite");
    return {
        type: "placedObject",
        id: nextMountedObjectId(),
        mountKind: "gable",
        category: resolvedCategory,
        texturePath,
        floorId: resolvedFloorId,
        gableId: resolvedGableId,
        gableSegmentIndex: segmentIndex,
        wallId: null,
        mountedSectionId: null,
        mountedWallLineGroupId: null,
        mountedWallSectionUnitId: null,
        mountedWallFacingSign: Number(mountedWallFacingSign) >= 0 ? 1 : -1,
        wallT: Math.max(0, Math.min(1, t)),
        width: objectWidth,
        height: objectHeight,
        zOffset: objectZOffset,
        rotationAxis: "spatial",
        placementRotation: Number.isFinite(Number(placementRotation)) ? Number(placementRotation) : 0,
        placeableAnchorX: Number.isFinite(Number(placeableAnchorX)) ? Number(placeableAnchorX) : 0.5,
        placeableAnchorY: Number.isFinite(Number(placeableAnchorY)) ? Number(placeableAnchorY) : 0.5,
        renderDepthOffset: Number.isFinite(Number(renderDepthOffset)) ? Number(renderDepthOffset) : 0,
        compositeLayers: Array.isArray(compositeLayers) ? clonePlainObject(compositeLayers) : null
    };
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

function insetVertexEndpoint(floor, vertex) {
    return {
        ...vertexEndpoint(floor, vertex),
        inset: true
    };
}

function perimeterWallSettings(wall, preserveIdentity = false) {
    const settings = {
        height: Number(wall.height),
        thickness: Number(wall.thickness),
        topProfile: normalizeWallTopProfile(wall.topProfile, wall.height),
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
    wall.topProfile = normalizeWallTopProfile(settings.topProfile, wall.height);
    if (typeof settings.wallTexturePath === "string" && settings.wallTexturePath.length > 0) {
        wall.wallTexturePath = settings.wallTexturePath;
    }
    if (Number.isFinite(Number(settings.texturePhaseA))) wall.texturePhaseA = Number(settings.texturePhaseA);
    if (Number.isFinite(Number(settings.texturePhaseB))) wall.texturePhaseB = Number(settings.texturePhaseB);
    if (Array.isArray(settings.openings)) wall.openings = clonePlainObject(settings.openings);
    return wall;
}

function perimeterWallForEdge(building, floor, startVertex, endVertex) {
    const fragmentId = getFloorId(floor);
    const startId = startVertex && startVertex.id;
    const endId = endVertex && endVertex.id;
    return getBuildingWalls(building).find((wall) => {
        const attachment = wall && wall.attachment;
        return wall.role === "perimeter" &&
            wall.fragmentId === fragmentId &&
            attachment &&
            attachment.kind === "fragmentEdge" &&
            attachment.ring === "outer" &&
            attachment.startVertexId === startId &&
            attachment.endVertexId === endId;
    }) || null;
}

function setPerimeterWallEdge(building, floor, wall, startVertex, endVertex) {
    const fragmentId = getFloorId(floor);
    wall.floorId = fragmentId;
    wall.fragmentId = fragmentId;
    wall.startPoint = insetVertexEndpoint(floor, startVertex);
    wall.endPoint = insetVertexEndpoint(floor, endVertex);
    wall.attachment = {
        kind: "fragmentEdge",
        fragmentId,
        ring: "outer",
        startVertexId: startVertex.id,
        endVertexId: endVertex.id
    };
    wall.bottomZ = getFloorElevation(floor);
    wall.traversalLayer = Math.round(Number(floor.level) || 0);
    refreshWallEndpointCoordinatesForWall(building, wall);
    return wall;
}

function createPerimeterWallForEdge(building, floor, startVertex, endVertex, settings = null) {
    const wall = createWall({
        floorId: getFloorId(floor),
        startPoint: insetVertexEndpoint(floor, startVertex),
        endPoint: insetVertexEndpoint(floor, endVertex),
        height: settings && Number.isFinite(Number(settings.height)) ? Number(settings.height) : floor.floorHeight,
        texture: settings && typeof settings.wallTexturePath === "string" ? settings.wallTexturePath : floor.defaultWallTexturePath,
        thickness: settings && Number.isFinite(Number(settings.thickness)) ? Number(settings.thickness) : DEFAULTS.wallThickness,
        bottomZ: getFloorElevation(floor),
        traversalLayer: floor.level,
        role: "perimeter",
        attachment: {
            kind: "fragmentEdge",
            fragmentId: getFloorId(floor),
            ring: "outer",
            startVertexId: startVertex.id,
            endVertexId: endVertex.id
        }
    });
    applyPerimeterWallSettings(wall, settings);
    building.wallSections.push(wall);
    refreshWallEndpointCoordinatesForWall(building, wall);
    return wall;
}

function placeWallRelativeToWall(building, wall, referenceWall, after = true) {
    const walls = getBuildingWalls(building);
    const wallIndex = walls.findIndex((candidate) => candidate === wall || candidate.id === wall.id);
    const referenceIndex = walls.findIndex((candidate) => candidate === referenceWall || candidate.id === referenceWall.id);
    if (wallIndex < 0) throw new Error(`cannot order missing perimeter wall: ${wall && wall.id}`);
    if (referenceIndex < 0) throw new Error(`cannot order relative to missing perimeter wall: ${referenceWall && referenceWall.id}`);
    const [removed] = walls.splice(wallIndex, 1);
    const nextReferenceIndex = walls.findIndex((candidate) => candidate === referenceWall || candidate.id === referenceWall.id);
    if (nextReferenceIndex < 0) throw new Error(`cannot order relative to removed perimeter wall: ${referenceWall && referenceWall.id}`);
    walls.splice(nextReferenceIndex + (after ? 1 : 0), 0, removed);
}

function mountedObjectsForWall(building, wall) {
    const wallId = String(wall && wall.id);
    return getBuildingMountedObjects(building)
        .filter((object) => String(object.wallId ?? object.mountedWallSectionUnitId) === wallId)
        .sort((a, b) => Number(a.wallT) - Number(b.wallT));
}

function setMountedObjectWall(object, wall, floor) {
    object.wallId = wall.id;
    object.mountedSectionId = wall.id;
    object.mountedWallLineGroupId = wall.id;
    object.mountedWallSectionUnitId = wall.id;
    object.floorId = getFloorId(floor);
}

function segmentLength(a, b) {
    return Math.hypot(Number(b.x) - Number(a.x), Number(b.y) - Number(a.y));
}

function clampMountedObjectT(object, wallLength) {
    const length = Number(wallLength);
    const width = Number(object && object.width);
    if (!Number.isFinite(length) || length <= 0 || !Number.isFinite(width) || width <= 0 || width >= length) {
        return 0.5;
    }
    const margin = width / (2 * length);
    return Math.max(margin, Math.min(1 - margin, Number(object.wallT)));
}

function updateMountedObjectWorldPosition(building, floor, wall, object) {
    const points = wallCenterlinePoints(building, wall, floor);
    if (points.length !== 2) {
        throw new Error(`cannot update mounted object ${object && object.id}: wall ${wall && wall.id} has no centerline`);
    }
    const t = Math.max(0, Math.min(1, Number(object.wallT)));
    const dx = Number(points[1].x) - Number(points[0].x);
    const dy = Number(points[1].y) - Number(points[0].y);
    const length = Math.hypot(dx, dy);
    if (length <= 0.000001) {
        throw new Error(`cannot update mounted object ${object && object.id}: wall ${wall && wall.id} has a degenerate centerline`);
    }
    const ux = dx / length;
    const uy = dy / length;
    const nx = -uy;
    const ny = ux;
    const facingSign = Number(object.mountedWallFacingSign) >= 0 ? 1 : -1;
    const halfThickness = Math.max(0.001, Number(wall.thickness) || DEFAULTS.wallThickness) * 0.5;
    const center = {
        x: Number(points[0].x) + dx * t,
        y: Number(points[0].y) + dy * t
    };
    object.x = center.x + nx * halfThickness * facingSign;
    object.y = center.y + ny * halfThickness * facingSign;
    object.z = getFloorElevation(floor) + (Number(object.zOffset) || 0);
    object.placementRotation = Math.atan2(uy, ux) * 180 / Math.PI;
    const halfWidth = Number(object.width) * 0.5;
    const hitboxHalfT = halfThickness * (String(object.category || "").trim().toLowerCase() === "doors" ? 1.1 : 1);
    object.groundPlaneHitboxOverridePoints = [
        { x: center.x - ux * halfWidth + nx * hitboxHalfT, y: center.y - uy * halfWidth + ny * hitboxHalfT },
        { x: center.x + ux * halfWidth + nx * hitboxHalfT, y: center.y + uy * halfWidth + ny * hitboxHalfT },
        { x: center.x + ux * halfWidth - nx * hitboxHalfT, y: center.y + uy * halfWidth - ny * hitboxHalfT },
        { x: center.x - ux * halfWidth - nx * hitboxHalfT, y: center.y - uy * halfWidth - ny * hitboxHalfT }
    ];
}

function resolveMountedObjectIntervals(building, floor, wall) {
    const objects = mountedObjectsForWall(building, wall)
        .map((object) => ({
            object,
            width: Number(object.width),
            desiredCenter: Number(object.wallT)
    }))
        .filter((entry) => Number.isFinite(entry.width) && entry.width > 0 && Number.isFinite(entry.desiredCenter))
        .sort((a, b) => a.desiredCenter - b.desiredCenter);
    if (!objects.length) return;
    const points = wallCenterlinePoints(building, wall, floor);
    if (points.length !== 2) throw new Error(`cannot resolve mounted object intervals: wall ${wall && wall.id} has no centerline`);
    const length = segmentLength(points[0], points[1]);
    if (!Number.isFinite(length) || length <= 0.000001) {
        throw new Error(`cannot resolve mounted object intervals: wall ${wall && wall.id} has a degenerate centerline`);
    }
    const totalWidth = objects.reduce((sum, entry) => sum + entry.width, 0);
    const assignPacked = (entries, start) => {
        let cursor = start;
        entries.forEach((entry) => {
            entry.center = cursor + entry.width * 0.5;
            cursor += entry.width;
        });
    };
    if (totalWidth >= length) {
        let cursor = 0;
        objects.forEach((entry) => {
            const segment = length * (entry.width / totalWidth);
            entry.center = cursor + segment * 0.5;
            cursor += segment;
        });
    } else {
        objects.forEach((entry) => {
            entry.center = Math.max(entry.width * 0.5, Math.min(length - entry.width * 0.5, entry.desiredCenter * length));
        });
        let changed = true;
        while (changed) {
            changed = false;
            for (let index = 0; index < objects.length;) {
                const cluster = [objects[index]];
                let clusterRight = objects[index].center + objects[index].width * 0.5;
                let cursor = index + 1;
                while (cursor < objects.length) {
                    const candidateLeft = objects[cursor].center - objects[cursor].width * 0.5;
                    if (candidateLeft >= clusterRight - 0.000001) break;
                    cluster.push(objects[cursor]);
                    clusterRight = Math.max(clusterRight, objects[cursor].center + objects[cursor].width * 0.5);
                    cursor += 1;
                }
                if (cluster.length > 1) {
                    changed = true;
                    const clusterWidth = cluster.reduce((sum, entry) => sum + entry.width, 0);
                    const weightedCenter = cluster.reduce((sum, entry) => sum + entry.center * entry.width, 0) / clusterWidth;
                    const left = Math.max(0, Math.min(length - clusterWidth, weightedCenter - clusterWidth * 0.5));
                    assignPacked(cluster, left);
                }
                index = cursor;
            }
        }
    }
    objects.forEach((entry) => {
        entry.object.wallT = Math.max(0, Math.min(1, entry.center / length));
        setMountedObjectWall(entry.object, wall, floor);
        updateMountedObjectWorldPosition(building, floor, wall, entry.object);
    });
}

function removeWallSection(building, wall) {
    const walls = getBuildingWalls(building);
    const index = walls.findIndex((candidate) => candidate === wall || candidate.id === wall.id);
    if (index < 0) throw new Error(`cannot remove missing perimeter wall: ${wall && wall.id}`);
    walls.splice(index, 1);
}

function remountObjectOnWall(building, floor, wall, object, wallT) {
    object.wallT = Number(wallT);
    const points = wallCenterlinePoints(building, wall, floor);
    if (points.length !== 2) throw new Error(`cannot remount object ${object && object.id}: wall ${wall && wall.id} has no centerline`);
    const length = segmentLength(points[0], points[1]);
    object.wallT = clampMountedObjectT(object, length);
    setMountedObjectWall(object, wall, floor);
    updateMountedObjectWorldPosition(building, floor, wall, object);
}

function normalizedMountedObjectWallT(object, action) {
    const t = Number(object && object.wallT);
    if (!Number.isFinite(t)) throw new Error(`cannot ${action} mounted object ${object && object.id}: wallT is not finite`);
    return Math.max(0, Math.min(1, t));
}

export function splitPerimeterWallAtVertex(building, floor, startVertex, insertedVertex, endVertex) {
    if (!building || !Array.isArray(building.wallSections)) throw new Error("cannot split perimeter wall without a building wall section list");
    if (!floor) throw new Error("cannot split perimeter wall without a floor");
    if (!startVertex || !startVertex.id || !insertedVertex || !insertedVertex.id || !endVertex || !endVertex.id) {
        throw new Error("cannot split perimeter wall without stable floor vertex ids");
    }
    const oldWall = perimeterWallForEdge(building, floor, startVertex, endVertex);
    if (!oldWall) {
        throw new Error(`cannot split missing perimeter wall edge ${startVertex.id}->${endVertex.id} on floor ${getFloorId(floor)}`);
    }
    const oldLength = segmentLength(startVertex, endVertex);
    const firstLength = segmentLength(startVertex, insertedVertex);
    const secondLength = segmentLength(insertedVertex, endVertex);
    if (oldLength <= 0.000001 || firstLength <= 0.000001 || secondLength <= 0.000001) {
        throw new Error(`cannot split degenerate perimeter wall edge ${startVertex.id}->${endVertex.id}`);
    }
    const splitT = firstLength / oldLength;
    const oldObjects = mountedObjectsForWall(building, oldWall)
        .map((object) => ({ object, oldT: normalizedMountedObjectWallT(object, "split wall with") }));
    const firstObjects = oldObjects.filter((entry) => entry.oldT <= splitT);
    const secondObjects = oldObjects.filter((entry) => entry.oldT > splitT);
    const keepOldOnFirst = secondObjects.length === 0 || firstObjects.length >= secondObjects.length;
    const settings = perimeterWallSettings(oldWall, false);
    let firstWall;
    let secondWall;
    if (keepOldOnFirst) {
        firstWall = setPerimeterWallEdge(building, floor, oldWall, startVertex, insertedVertex);
        secondWall = createPerimeterWallForEdge(building, floor, insertedVertex, endVertex, settings);
        placeWallRelativeToWall(building, secondWall, firstWall, true);
    } else {
        firstWall = createPerimeterWallForEdge(building, floor, startVertex, insertedVertex, settings);
        secondWall = setPerimeterWallEdge(building, floor, oldWall, insertedVertex, endVertex);
        placeWallRelativeToWall(building, firstWall, secondWall, false);
    }
    firstObjects.forEach((entry) => {
        remountObjectOnWall(building, floor, firstWall, entry.object, entry.oldT / splitT);
    });
    secondObjects.forEach((entry) => {
        remountObjectOnWall(building, floor, secondWall, entry.object, (entry.oldT - splitT) / (1 - splitT));
    });
    resolveMountedObjectIntervals(building, floor, firstWall);
    resolveMountedObjectIntervals(building, floor, secondWall);
    return { firstWall, secondWall };
}

export function mergePerimeterWallsAcrossDeletedVertex(building, floor, previousVertex, deletedVertex, nextVertex) {
    if (!building || !Array.isArray(building.wallSections)) throw new Error("cannot merge perimeter walls without a building wall section list");
    if (!floor) throw new Error("cannot merge perimeter walls without a floor");
    if (!previousVertex || !previousVertex.id || !deletedVertex || !deletedVertex.id || !nextVertex || !nextVertex.id) {
        throw new Error("cannot merge perimeter walls without stable floor vertex ids");
    }
    const firstWall = perimeterWallForEdge(building, floor, previousVertex, deletedVertex);
    const secondWall = perimeterWallForEdge(building, floor, deletedVertex, nextVertex);
    if (!firstWall) {
        throw new Error(`cannot merge missing perimeter wall edge ${previousVertex.id}->${deletedVertex.id} on floor ${getFloorId(floor)}`);
    }
    if (!secondWall) {
        throw new Error(`cannot merge missing perimeter wall edge ${deletedVertex.id}->${nextVertex.id} on floor ${getFloorId(floor)}`);
    }
    const firstLength = segmentLength(previousVertex, deletedVertex);
    const secondLength = segmentLength(deletedVertex, nextVertex);
    const combinedLength = firstLength + secondLength;
    if (firstLength <= 0.000001 || secondLength <= 0.000001 || combinedLength <= 0.000001) {
        throw new Error(`cannot merge degenerate perimeter wall edges around vertex ${deletedVertex.id}`);
    }
    const firstObjects = mountedObjectsForWall(building, firstWall);
    const secondObjects = mountedObjectsForWall(building, secondWall);
    const keepFirstWall = secondObjects.length === 0 || firstObjects.length > 0;
    const survivor = keepFirstWall ? firstWall : secondWall;
    const removed = keepFirstWall ? secondWall : firstWall;
    const remounts = [
        ...firstObjects.map((object) => ({ object, distance: normalizedMountedObjectWallT(object, "merge wall with") * firstLength })),
        ...secondObjects.map((object) => ({ object, distance: firstLength + normalizedMountedObjectWallT(object, "merge wall with") * secondLength }))
    ];
    setPerimeterWallEdge(building, floor, survivor, previousVertex, nextVertex);
    remounts.forEach((entry) => {
        setMountedObjectWall(entry.object, survivor, floor);
        entry.object.wallT = entry.distance / combinedLength;
    });
    removeWallSection(building, removed);
    resolveMountedObjectIntervals(building, floor, survivor);
    return survivor;
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
            startPoint: insetVertexEndpoint(floor, vertex),
            endPoint: insetVertexEndpoint(floor, next),
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
        refreshWallEndpointCoordinatesForWall(building, wall);
        building.wallSections.push(wall);
    });
    refreshWallResolvedGeometry(building, floor);
}

export function addFloor(building, floor) {
    if (!building || !Array.isArray(building.floorFragments)) {
        throw new Error("cannot add floor fragment to missing building model");
    }
    building.floorFragments.push(floor);
    building.floorFragments.sort((a, b) => getFloorElevation(a) - getFloorElevation(b));
    syncFloorStackLevels(building);
    if (floor._createPerimeterWalls === true) {
        delete floor._createPerimeterWalls;
        createPerimeterWallsForFloor(building, floor);
    }
    return floor;
}

export function duplicateFloor(building, sourceFloorId, elevation) {
    const source = findFloor(building, sourceFloorId);
    if (!source) throw new Error(`cannot duplicate missing source floor fragment: ${sourceFloorId}`);
    const sourceRoof = getFloorRoof(source);
    const floor = createFloor({
        elevation,
        footprint: source.outerPolygon,
        holes: source.holes || [],
        floorTexture: source.floorTexturePath,
        roofTexture: sourceRoof ? sourceRoof.texturePath : DEFAULTS.roofTexture,
        roofMode: sourceRoof ? sourceRoof.mode : DEFAULTS.roofMode,
        roofOverhang: sourceRoof ? sourceRoof.overhang : DEFAULTS.roofOverhang,
        roofPeakHeight: sourceRoof ? sourceRoof.peakHeight : DEFAULTS.roofPeakHeight,
        roofDomeLevels: sourceRoof ? sourceRoof.domeLevels : DEFAULTS.roofDomeLevels,
        roofElevationOffset: sourceRoof ? sourceRoof.elevationOffset : DEFAULTS.roofElevationOffset,
        floorHeight: source.floorHeight,
        defaultWallHeight: source.defaultWallHeight,
        defaultWallTexture: source.defaultWallTexturePath,
        createPerimeterWalls: false
    });
    const gableIdMap = new Map();
    if (sourceRoof) {
        floor.roof.gables = getRoofGables(sourceRoof).map((gable) => {
            const copy = normalizeRoofGable({ ...gable, id: undefined });
            gableIdMap.set(Number(gable.id), Number(copy.id));
            return copy;
        });
        floor.roof.contactPolygon = clonePoints(floor.outerPolygon, "roof-contact");
        floor.roof.peakPoint = defaultRoofPeakPointForFloor(floor);
        floor.roof.shedDirection = normalizeDirectionPoint(getRoofShedDirection(sourceRoof), "duplicated shed roof direction");
        floor.roof.domeLevels = normalizeRoofDomeLevels(sourceRoof.domeLevels ?? DEFAULTS.roofDomeLevels);
    } else {
        floor.roof = null;
    }
    floor.roofs = getFloorRoofs(source).slice(1).map((extraRoof) => createRoof({
        floorId: floor.fragmentId,
        mode: extraRoof.mode,
        texture: extraRoof.texturePath,
        overhang: extraRoof.overhang,
        peakHeight: extraRoof.peakHeight,
        domeLevels: extraRoof.domeLevels,
        peakPoint: getRoofPeakPoint(extraRoof),
        elevationOffset: extraRoof.elevationOffset,
        shedDirection: getRoofShedDirection(extraRoof),
        contactPolygon: getRoofContactPolygon(extraRoof),
        gables: getRoofGables(extraRoof).map((gable) => ({ ...gable, id: undefined }))
    }));
    floor.stairs = getFloorStairs(source).map((stair) => createStraightStair({
        floorId: floor.fragmentId,
        startPoint: stair.startPoint,
        endPoint: stair.endPoint,
        width: stair.width,
        direction: stair.direction,
        texturePath: stair.texturePath,
        treadTexturePath: stair.treadTexturePath || stair.texturePath,
        riserTexturePath: stair.riserTexturePath || stair.texturePath,
        bottomZ: getFloorElevation(floor),
        height: stair.height,
        stepCount: stair.stepCount,
        riserDepth: stair.riserDepth,
        treads: stair.treads,
        ladder: stair.ladder === true,
        footprint: stair.footprint,
        depth: stair.depth
    }));
    floor.name = `${source.name} copy`;
    addFloor(building, floor);
    const wallIdMap = duplicateWallsForFloor(building, source, floor);
    duplicateMountedObjectsForFloor(building, source, floor, wallIdMap, gableIdMap);
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
    if (copy.kind === "vertex" || copy.kind === "insetVertex") {
        if (copy.kind === "insetVertex") {
            copy.kind = "vertex";
            copy.inset = true;
        }
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
    const wallIdMap = new Map();

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
        wallIdMap.set(Number(sourceWall.id), Number(wall.id));
    });

    refreshWallSectionEndpoints(building, targetFloor);
    return wallIdMap;
}

function duplicateMountedObjectsForFloor(building, sourceFloor, targetFloor, wallIdMap, gableIdMap = new Map()) {
    if (!building || !Array.isArray(building.mountedWallObjects)) return;
    const sourceFloorId = getFloorId(sourceFloor);
    const targetFloorId = getFloorId(targetFloor);
    getBuildingMountedObjects(building)
        .filter((object) => object.floorId === sourceFloorId)
        .forEach((sourceObject) => {
            if (sourceObject.mountKind === "gable") {
                const targetGableId = gableIdMap.get(Number(sourceObject.gableId));
                if (!Number.isInteger(targetGableId)) {
                    throw new Error(`cannot duplicate mounted object ${sourceObject.id}: missing duplicated gable ${sourceObject.gableId}`);
                }
                const object = clonePlainObject(sourceObject);
                object.id = nextMountedObjectId();
                object.floorId = targetFloorId;
                object.gableId = targetGableId;
                building.mountedWallObjects.push(object);
                return;
            }
            const targetWallId = wallIdMap.get(Number(sourceObject.wallId));
            if (!Number.isFinite(targetWallId)) {
                throw new Error(`cannot duplicate mounted object ${sourceObject.id}: missing duplicated wall ${sourceObject.wallId}`);
            }
            const object = clonePlainObject(sourceObject);
            object.id = nextMountedObjectId();
            object.floorId = targetFloorId;
            object.wallId = targetWallId;
            object.mountedSectionId = targetWallId;
            object.mountedWallLineGroupId = targetWallId;
            object.mountedWallSectionUnitId = targetWallId;
            building.mountedWallObjects.push(object);
        });
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
    if (options.refreshWallEndpoints !== false) {
        refreshWallSectionEndpoints(building, floor);
    }
}

export function findFloor(building, floorId) {
    const id = String(floorId || "");
    return getBuildingFloors(building).find((floor) => getFloorId(floor) === id) || null;
}

export function findWall(building, wallId) {
    const id = Number(wallId);
    return getBuildingWalls(building).find((wall) => Number(wall.id) === id) || null;
}

export function findMountedObject(building, objectId) {
    const id = Number(objectId);
    return getBuildingMountedObjects(building).find((object) => Number(object.id) === id) || null;
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

export function resolveEndpoint(building, endpoint, wall = null) {
    if (!endpoint || typeof endpoint !== "object") return null;
    if (endpoint.kind === "vertex" || endpoint.kind === "insetVertex") {
        const ring = ringForEndpoint(building, endpoint);
        const vertexIndex = Array.isArray(ring) ? ring.findIndex((point) => point.id === endpoint.vertexId) : -1;
        const vertex = vertexIndex >= 0 ? ring[vertexIndex] : null;
        if (!vertex) {
            return Number.isFinite(Number(endpoint.x)) && Number.isFinite(Number(endpoint.y))
                ? { x: Number(endpoint.x), y: Number(endpoint.y) }
                : null;
        }
        if (endpoint.inset === true || endpoint.kind === "insetVertex") {
            const floor = findFloor(building, endpoint.fragmentId);
            const thickness = Number.isFinite(Number(wall && wall.thickness))
                ? Number(wall.thickness)
                : (Number.isFinite(Number(endpoint.thickness)) ? Number(endpoint.thickness) : DEFAULTS.wallThickness);
            return floorVertexWallInsetPoint(floor, endpoint.ring, endpoint.holeIndex, endpoint.vertexId, thickness);
        }
        return { x: Number(vertex.x), y: Number(vertex.y) };
    }
    if (Number.isFinite(Number(endpoint.x)) && Number.isFinite(Number(endpoint.y))) {
        return { x: Number(endpoint.x), y: Number(endpoint.y) };
    }
    return null;
}

export function wallPoints(building, wall) {
    const start = resolveEndpoint(building, wall && wall.startPoint, wall);
    const end = resolveEndpoint(building, wall && wall.endPoint, wall);
    if (!start || !end) return [];
    return [start, end];
}

export function wallCenterlinePoints(building, wall, floor = null) {
    return wallPoints(building, wall);
}

export function refreshWallEndpointCoordinatesForWall(building, wall) {
    if (!wall) return false;
    if (building) refreshLineBoundaryClipEndpoints(building, wall);
    ["startPoint", "endPoint"].forEach((key) => {
        const endpoint = wall[key];
        const resolved = building ? resolveEndpoint(building, endpoint, wall) : endpoint;
        if (endpoint && resolved && Number.isFinite(resolved.x) && Number.isFinite(resolved.y)) {
            endpoint.x = Number(resolved.x);
            endpoint.y = Number(resolved.y);
        }
    });
    return true;
}

export function wallMiterEndpointKey(wall, endpointKey, point, floor) {
    const endpoint = wall && wall[endpointKey];
    const floorId = getFloorId(floor);
    if (endpoint && (endpoint.kind === "vertex" || endpoint.kind === "insetVertex")) {
        if (!endpoint.vertexId || !endpoint.fragmentId || !endpoint.ring) {
            throw new Error(`wall ${wall && wall.id} ${endpointKey} vertex endpoint is missing miter metadata`);
        }
        return [
            endpoint.inset === true || endpoint.kind === "insetVertex" ? "vertex-inset" : "vertex",
            endpoint.fragmentId,
            endpoint.ring,
            Number.isFinite(Number(endpoint.holeIndex)) ? Number(endpoint.holeIndex) : -1,
            endpoint.vertexId
        ].join(":");
    }
    if (!finitePoint(point)) {
        throw new Error(`wall ${wall && wall.id} ${endpointKey} cannot be mitered without a finite endpoint`);
    }
    return `point:${floorId}:${Number(point.x).toFixed(6)},${Number(point.y).toFixed(6)}`;
}

function cloneResolvedPoint(point) {
    if (!finitePoint(point)) throw new Error("resolved wall geometry point must be finite");
    return { x: Number(point.x), y: Number(point.y) };
}

function applyResolvedJoineryStore(profile, store) {
    if (!profile || !store) return;
    if (store.sharedEnd === "start") {
        if (finitePoint(store.posN)) profile.aLeft = cloneResolvedPoint(store.posN);
        if (finitePoint(store.negN)) profile.aRight = cloneResolvedPoint(store.negN);
        return;
    }
    if (store.sharedEnd === "end") {
        if (finitePoint(store.posN)) profile.bLeft = cloneResolvedPoint(store.posN);
        if (finitePoint(store.negN)) profile.bRight = cloneResolvedPoint(store.negN);
    }
}

function wallProfilePointAt(profile, side, t) {
    const clampedT = Math.max(0, Math.min(1, Number(t)));
    const start = side === "left" ? profile.aLeft : profile.aRight;
    const end = side === "left" ? profile.bLeft : profile.bRight;
    return {
        x: Number(start.x) + (Number(end.x) - Number(start.x)) * clampedT,
        y: Number(start.y) + (Number(end.y) - Number(start.y)) * clampedT
    };
}

function resolvedWallTopStations(wall, profile) {
    const bottomZ = Number(wall && wall.bottomZ);
    if (!Number.isFinite(bottomZ)) throw new Error(`wall ${wall && wall.id} resolved geometry requires finite bottomZ`);
    const topProfile = normalizeWallTopProfile(wall && wall.topProfile, wall && wall.height);
    const stations = topProfile && Array.isArray(topProfile.stations)
        ? topProfile.stations
        : [
            { t: 0, leftHeight: Number(wall.height), rightHeight: Number(wall.height) },
            { t: 1, leftHeight: Number(wall.height), rightHeight: Number(wall.height) }
        ];
    return stations.map((station) => {
        const t = Number(station.t);
        const leftHeight = Number(station.leftHeight);
        const rightHeight = Number(station.rightHeight);
        if (!Number.isFinite(t) || !Number.isFinite(leftHeight) || !Number.isFinite(rightHeight)) {
            throw new Error(`wall ${wall && wall.id} resolved geometry top stations must be finite`);
        }
        const left = wallProfilePointAt(profile, "left", t);
        const right = wallProfilePointAt(profile, "right", t);
        return {
            t,
            left: { x: left.x, y: left.y, z: bottomZ + leftHeight },
            right: { x: right.x, y: right.y, z: bottomZ + rightHeight }
        };
    });
}

function wallResolvedGeometrySignature(wall, floor, profile, topStations) {
    return [
        wall && wall.id,
        getFloorId(floor),
        Number(wall && wall.bottomZ).toFixed(6),
        Number(wall && wall.height).toFixed(6),
        Number(wall && wall.thickness).toFixed(6),
        ["aLeft", "bLeft", "bRight", "aRight"].map((key) => `${Number(profile[key].x).toFixed(6)},${Number(profile[key].y).toFixed(6)}`).join("|"),
        topStations.map((station) => [
            Number(station.t).toFixed(6),
            Number(station.left.x).toFixed(6),
            Number(station.left.y).toFixed(6),
            Number(station.left.z).toFixed(6),
            Number(station.right.x).toFixed(6),
            Number(station.right.y).toFixed(6),
            Number(station.right.z).toFixed(6)
        ].join(",")).join("|")
    ].join(";");
}

function setWallResolvedGeometry(wall, floor, profile) {
    const resolvedProfile = {
        aLeft: cloneResolvedPoint(profile.aLeft),
        aRight: cloneResolvedPoint(profile.aRight),
        bLeft: cloneResolvedPoint(profile.bLeft),
        bRight: cloneResolvedPoint(profile.bRight)
    };
    const topStations = resolvedWallTopStations(wall, resolvedProfile);
    wall.resolvedGeometry = {
        version: 1,
        profile: resolvedProfile,
        bottomZ: Number(wall.bottomZ),
        topStations,
        signature: wallResolvedGeometrySignature(wall, floor, resolvedProfile, topStations)
    };
}

export function getWallResolvedGeometry(wall) {
    const geometry = wall && wall.resolvedGeometry;
    const profile = geometry && geometry.profile;
    if (!geometry || geometry.version !== 1 || !profile) {
        throw new Error(`wall ${wall && wall.id} is missing resolved geometry`);
    }
    ["aLeft", "aRight", "bLeft", "bRight"].forEach((key) => {
        if (!finitePoint(profile[key])) throw new Error(`wall ${wall && wall.id} resolved geometry is missing ${key}`);
    });
    if (!Array.isArray(geometry.topStations) || geometry.topStations.length < 2) {
        throw new Error(`wall ${wall && wall.id} resolved geometry requires top stations`);
    }
    return geometry;
}

export function refreshWallResolvedGeometry(building, floor = null) {
    if (!building) return;
    const targetFloorIds = floor ? new Set([getFloorId(floor)]) : null;
    const profilesByWall = new Map();
    const groups = new Map();
    getBuildingWalls(building).forEach((wall) => {
        const wallFloorId = String(wall && (wall.fragmentId || wall.floorId) || "");
        if (targetFloorIds && !targetFloorIds.has(wallFloorId)) return;
        const wallFloor = floor && getFloorId(floor) === wallFloorId ? floor : findFloor(building, wallFloorId);
        if (!wallFloor) {
            throw new Error(`wall ${wall && wall.id} resolved geometry requires a floor fragment`);
        }
        const points = wallPoints(building, wall);
        if (points.length !== 2) {
            throw new Error(`wall ${wall && wall.id} resolved geometry requires exactly two endpoints`);
        }
        const wallGeometry = globalThis.WallGeometry;
        if (!wallGeometry || typeof wallGeometry.baseProfileFromEndpoints !== "function" || typeof wallGeometry.solveEndpointJoinery !== "function") {
            throw new Error("resolved wall geometry requires WallGeometry helpers");
        }
        const profile = wallGeometry.baseProfileFromEndpoints(points[0], points[1], wall.thickness);
        if (!profile) {
            throw new Error(`wall ${wall && wall.id} resolved geometry requires non-coincident endpoints`);
        }
        profilesByWall.set(wall, { floor: wallFloor, profile });
        [
            { endpointKey: "startPoint", sharedEnd: "start", sharedPoint: points[0], farPoint: points[1] },
            { endpointKey: "endPoint", sharedEnd: "end", sharedPoint: points[1], farPoint: points[0] }
        ].forEach((entry) => {
            const groupKey = wallMiterEndpointKey(wall, entry.endpointKey, entry.sharedPoint, wallFloor);
            const layer = Number.isFinite(Number(wall.traversalLayer))
                ? Math.round(Number(wall.traversalLayer))
                : (Number.isFinite(Number(wallFloor && wallFloor.level)) ? Math.round(Number(wallFloor.level)) : null);
            if (!Number.isFinite(layer)) {
                throw new Error(`wall ${wall && wall.id} cannot resolve miter layer without a floor stack level`);
            }
            const indexKey = `${groupKey}|layer:${layer}`;
            if (!groups.has(indexKey)) groups.set(indexKey, []);
            groups.get(indexKey).push({
                wall,
                wallId: wall.id,
                sharedEnd: entry.sharedEnd,
                sharedPoint: entry.sharedPoint,
                farPoint: entry.farPoint,
                thickness: wall.thickness
            });
        });
    });
    const wallGeometry = globalThis.WallGeometry;
    groups.forEach((group) => {
        if (group.length < 2) return;
        const solved = wallGeometry.solveEndpointJoinery(group, { center: group[0].sharedPoint });
        solved.stores.forEach(({ entry, store }) => {
            const target = profilesByWall.get(entry.wall);
            if (!target) return;
            applyResolvedJoineryStore(target.profile, store);
        });
    });
    profilesByWall.forEach(({ floor: wallFloor, profile }, wall) => {
        setWallResolvedGeometry(wall, wallFloor, profile);
    });
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
    refreshWallResolvedGeometry(building, floor);
}

export function fallbackDeletedVertexEndpointsToPoint(building, fragmentId, vertexId) {
    getBuildingWalls(building).forEach((wall) => {
        if (wall.role === "perimeter") return;
        ["startPoint", "endPoint"].forEach((key) => {
            const endpoint = wall[key];
            if (
                endpoint &&
                (endpoint.kind === "vertex" || endpoint.kind === "insetVertex") &&
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

function buildingSourceSavePayload(building) {
    const payload = JSON.parse(JSON.stringify(building));
    (payload.floorFragments || []).forEach((floor) => {
        delete floor.level;
        delete floor.nodeBaseZOffset;
        (floor.columns || []).forEach((column) => {
            delete column.traversalLayer;
        });
    });
    (payload.wallSections || []).forEach((wall) => {
        delete wall.traversalLayer;
    });
    (payload.mountedWallObjects || []).forEach((object) => {
        delete object.traversalLayer;
    });
    return payload;
}

export function serializeBuilding(building) {
    syncFloorStackLevels(building);
    return JSON.stringify(buildingSourceSavePayload(building), null, 2);
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
            roofOverhang: floor.roofOverhang ?? DEFAULTS.roofOverhang,
            roofPeakHeight: floor.roofPeakHeight ?? DEFAULTS.roofPeakHeight,
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
    if (!Array.isArray(building.mountedWallObjects)) building.mountedWallObjects = [];

    building.floorFragments.forEach((floor) => {
        if (!floor.fragmentId) floor.fragmentId = floor.id || nextStringId("floor-fragment");
        if (!floor.surfaceId) floor.surfaceId = floor.fragmentId;
        if (!Array.isArray(floor.outerPolygon) && Array.isArray(floor.footprint)) floor.outerPolygon = floor.footprint;
        floor.outerPolygon = clonePoints(floor.outerPolygon || []);
        floor.holes = Array.isArray(floor.holes) ? floor.holes.map((ring) => clonePoints(ring, "hole-vertex")).filter((ring) => ring.length >= 3) : [];
        floor.name = String(floor.name || "").trim() || "floor";
        floor.floorTexturePath = floor.floorTexturePath || floor.floorTexture || DEFAULTS.floorTexture;
        const sourceRoof = floor.roof && typeof floor.roof === "object" ? floor.roof : null;
        const normalizeFloorRoofSource = (roofSourceInput = {}) => {
            const roofSource = roofSourceInput || {};
            const roof = createRoof({
                floorId: floor.fragmentId,
                mode: roofSource.mode || roofSource.roofMode || floor.roofMode || (floor.defaults && floor.defaults.roofMode) || (building.defaults && building.defaults.roofMode) || DEFAULTS.roofMode,
                texture: roofSource.texturePath || roofSource.roofTexturePath || floor.roofTexturePath || floor.roofTexture || (floor.defaults && floor.defaults.roofTexture) || (building.defaults && building.defaults.roofTexture) || DEFAULTS.roofTexture,
                overhang: Number.isFinite(Number(roofSource.overhang ?? roofSource.roofOverhang))
                    ? Number(roofSource.overhang ?? roofSource.roofOverhang)
                    : (Number.isFinite(Number(floor.roofOverhang)) ? Number(floor.roofOverhang) : DEFAULTS.roofOverhang),
                peakHeight: Number.isFinite(Number(roofSource.peakHeight ?? roofSource.roofPeakHeight)) && Number(roofSource.peakHeight ?? roofSource.roofPeakHeight) >= 0
                    ? Number(roofSource.peakHeight ?? roofSource.roofPeakHeight)
                    : (Number.isFinite(Number(floor.roofPeakHeight)) && Number(floor.roofPeakHeight) >= 0 ? Number(floor.roofPeakHeight) : DEFAULTS.roofPeakHeight),
                domeLevels: roofSource.domeLevels ?? roofSource.roofDomeLevels ?? DEFAULTS.roofDomeLevels,
                elevationOffset: Number.isFinite(Number(roofSource.elevationOffset ?? roofSource.roofElevationOffset))
                    ? Number(roofSource.elevationOffset ?? roofSource.roofElevationOffset)
                    : (Number.isFinite(Number(floor.roofElevationOffset)) ? Number(floor.roofElevationOffset) : DEFAULTS.roofElevationOffset),
                peakPoint: finitePoint(roofSource.peakPoint)
                    ? roofSource.peakPoint
                    : defaultRoofPeakPointForFloor({ ...floor, roof: { contactPolygon: roofSource.contactPolygon || floor.outerPolygon } }),
                shedDirection: roofSource.shedDirection || roofSource.slopeDirection || roofSource.direction || DEFAULTS.roofShedDirection,
                contactPolygon: Array.isArray(roofSource.contactPolygon) && roofSource.contactPolygon.length > 0
                    ? roofSource.contactPolygon
                    : floor.outerPolygon,
                gables: Array.isArray(roofSource.gables) ? roofSource.gables : []
            });
            if (typeof roofSource.id === "string" && roofSource.id.length > 0) roof.id = roofSource.id;
            return roof;
        };
        const hasLegacyRoofFields = floor.roofTexturePath !== undefined || floor.roofTexture !== undefined || floor.roofMode !== undefined || floor.roofOverhang !== undefined || floor.roofPeakHeight !== undefined || floor.roofElevationOffset !== undefined;
        if (sourceRoof || floor.roof !== null || hasLegacyRoofFields) {
            floor.roof = normalizeFloorRoofSource(sourceRoof || {});
        } else {
            floor.roof = null;
        }
        floor.roofs = Array.isArray(floor.roofs)
            ? floor.roofs
                .filter((roof) => roof && typeof roof === "object")
                .map((roof) => normalizeFloorRoofSource(roof))
            : [];
        delete floor.roofTexturePath;
        delete floor.roofTexture;
        delete floor.roofMode;
        delete floor.roofOverhang;
        delete floor.roofPeakHeight;
        delete floor.roofElevationOffset;
        floor.floorHeight = Number.isFinite(Number(floor.floorHeight)) && Number(floor.floorHeight) > 0
            ? Number(floor.floorHeight)
            : (floor.defaults && Number.isFinite(Number(floor.defaults.wallHeight)) ? Number(floor.defaults.wallHeight) : DEFAULTS.wallHeight);
        floor.defaultWallHeight = Number.isFinite(Number(floor.defaultWallHeight))
            ? Number(floor.defaultWallHeight)
            : (floor.defaults && Number.isFinite(Number(floor.defaults.wallHeight)) ? Number(floor.defaults.wallHeight) : DEFAULTS.wallHeight);
        floor.defaultWallTexturePath = floor.defaultWallTexturePath || (floor.defaults && floor.defaults.wallTexture) || DEFAULTS.wallTexture;
        delete floor.wallInset;
        if (!Number.isFinite(Number(floor.nodeBaseZ))) setFloorElevation(floor, Number(floor.elevation) || 0);
        if (!Array.isArray(floor.beams)) floor.beams = [];
        if (!Array.isArray(floor.columns)) floor.columns = [];
        if (!Array.isArray(floor.stairs)) floor.stairs = [];
        floor.beams = floor.beams.map((raw) => {
            const beam = {
                type: "beam",
                id: Number.isInteger(Number(raw.id)) ? Number(raw.id) : nextBeamId(),
                floorId: floor.fragmentId,
                startAttachment: raw.startAttachment ? JSON.parse(JSON.stringify(raw.startAttachment)) : { kind: "free", x: 0, y: 0 },
                endAttachment: raw.endAttachment ? JSON.parse(JSON.stringify(raw.endAttachment)) : { kind: "free", x: 0, y: 0 },
                startOverhang: Math.max(0, Number(raw.startOverhang) || 0),
                endOverhang: Math.max(0, Number(raw.endOverhang) || 0),
                bottomZ: Number.isFinite(Number(raw.bottomZ)) ? Number(raw.bottomZ) : 0,
                thickness: Number(raw.thickness) >= 0.001 ? Number(raw.thickness) : 0.001,
                height: Number(raw.height) > 0 ? Number(raw.height) : 0.2,
                texturePath: String(raw.texturePath || DEFAULTS.wallTexture)
            };
            return beam;
        });
        floor.columns = floor.columns.map((raw) => {
            const sc = Math.round(Number(raw.sideCount) || 4);
            const legacySize = Number(raw.size) > 0 ? Number(raw.size) : 0.125;
            const width = Number(raw.width) > 0 ? Math.min(2, Number(raw.width)) : legacySize * 2;
            const depth = Number(raw.depth) > 0 ? Math.min(2, Number(raw.depth)) : legacySize * 2;
            const column = {
                type: "column",
                id: Number.isInteger(Number(raw.id)) ? Number(raw.id) : nextColumnId(),
                floorId: floor.fragmentId,
                wallId: raw.wallId === undefined || raw.wallId === null || raw.wallId === ""
                    ? null
                    : (Number.isFinite(Number(raw.wallId)) ? Number(raw.wallId) : String(raw.wallId)),
                heightMode: String(raw.heightMode || "").trim().toLowerCase() === "fixed"
                    ? "fixed"
                    : (raw.wallId === undefined || raw.wallId === null || raw.wallId === "" ? "fixed" : "wall"),
                position: finitePoint(raw.position) ? { x: Number(raw.position.x), y: Number(raw.position.y) } : { x: 0, y: 0 },
                sideCount: sc >= 3 && sc <= 12 ? sc : 4,
                size: width * 0.5,
                width,
                depth,
                rotation: Number.isFinite(Number(raw.rotation)) ? Number(raw.rotation) : 0,
                height: Number(raw.height) > 0 ? Number(raw.height) : floor.defaultWallHeight,
                topHeights: normalizeColumnTopHeights(raw.topHeights, sc >= 3 && sc <= 12 ? sc : 4),
                bottomZ: Number.isFinite(Number(raw.bottomZ)) ? Number(raw.bottomZ) : getFloorElevation(floor),
                traversalLayer: Number.isFinite(Number(raw.traversalLayer))
                    ? Math.round(Number(raw.traversalLayer))
                    : Math.round(Number(floor.level) || 0),
                texturePath: String(raw.texturePath || DEFAULTS.wallTexture)
            };
            return column;
        });
        floor.stairs = floor.stairs.map((raw) => {
            const stair = createStraightStair({
                floorId: floor.fragmentId,
                startPoint: finitePoint(raw.startPoint) ? raw.startPoint : raw.lowerPoint,
                endPoint: finitePoint(raw.endPoint) ? raw.endPoint : raw.higherPoint,
                width: raw.width ?? DEFAULTS.stairWidth,
                direction: raw.direction || DEFAULTS.stairDirection,
                texturePath: raw.texturePath || DEFAULTS.floorTexture,
                treadTexturePath: raw.treadTexturePath || raw.texturePath || DEFAULTS.floorTexture,
                riserTexturePath: raw.riserTexturePath || raw.texturePath || raw.treadTexturePath || DEFAULTS.floorTexture,
                bottomZ: Number.isFinite(Number(raw.bottomZ)) ? Number(raw.bottomZ) : getFloorElevation(floor),
                height: Number(raw.height) > 0 ? Number(raw.height) : floor.floorHeight,
                stepCount: raw.stepCount,
                riserDepth: raw.riserDepth,
                treads: raw.treads,
                ladder: raw.ladder === true,
                footprint: raw.footprint,
                depth: raw.depth
            });
            if (Number.isInteger(Number(raw.id))) stair.id = Number(raw.id);
            return stair;
        });
    });
    syncFloorStackLevels(building);

    building.wallSections.forEach((wall) => {
        wall.topProfile = normalizeWallTopProfile(wall.topProfile, wall.height);
        if (!Number.isFinite(Number(wall.thickness)) || Number(wall.thickness) <= 0) {
            wall.thickness = Number(building.defaults && building.defaults.wallThickness) || DEFAULTS.wallThickness;
        }
        ["startPoint", "endPoint"].forEach((endpointKey) => {
            const endpoint = wall[endpointKey];
            if (endpoint && endpoint.kind === "insetVertex") {
                endpoint.kind = "vertex";
                endpoint.inset = true;
            }
        });
        const attachment = wall && wall.attachment;
        if (wall.role === "perimeter" && attachment && attachment.kind === "fragmentEdge") {
            ["startPoint", "endPoint"].forEach((endpointKey) => {
                const endpoint = wall[endpointKey];
                if (endpoint && (endpoint.kind === "vertex" || endpoint.kind === "insetVertex")) {
                    endpoint.kind = "vertex";
                    endpoint.inset = endpoint.inset === false ? false : true;
                }
            });
        }
    });
    building.mountedWallObjects = building.mountedWallObjects.map((object) => {
        const rawMountKind = String(object && object.mountKind || "").trim().toLowerCase();
        const wallId = Number(object && (object.wallId ?? object.mountedWallSectionUnitId ?? object.mountedSectionId));
        if (rawMountKind === "gable" || (!Number.isFinite(wallId) && object && object.gableId !== undefined && object.gableId !== null)) {
            const floor = findFloor(building, object.floorId);
            if (!floor) {
                throw new Error(`gable-mounted window references missing floor: ${object && object.floorId}`);
            }
            const gableId = Number(object.gableId);
            const gable = getRoofGables(floor).find((candidate) => Number(candidate.id) === gableId);
            if (!gable) {
                throw new Error(`gable-mounted window references missing gable: ${gableId}`);
            }
            const category = String(object.category || object.type || "").trim().toLowerCase();
            const resolvedCategory = category === "window" ? "windows" : category;
            const normalized = createGableMountedObject({
                floorId: getFloorId(floor),
                gableId,
                gableSegmentIndex: object.gableSegmentIndex ?? 0,
                category: resolvedCategory,
                texturePath: object.texturePath,
                wallT: object.wallT ?? 0.5,
                width: object.width ?? 1,
                height: object.height ?? 1,
                zOffset: object.zOffset ?? object.z ?? 0,
                placementRotation: object.placementRotation,
                mountedWallFacingSign: object.mountedWallFacingSign,
                placeableAnchorX: object.placeableAnchorX,
                placeableAnchorY: object.placeableAnchorY,
                renderDepthOffset: object.renderDepthOffset,
                compositeLayers: object.compositeLayers
            });
            if (Number.isInteger(Number(object.id))) normalized.id = Number(object.id);
            if (Number.isFinite(Number(object.x))) normalized.x = Number(object.x);
            if (Number.isFinite(Number(object.y))) normalized.y = Number(object.y);
            if (Number.isFinite(Number(object.z))) normalized.z = Number(object.z);
            if (object.isOpen !== undefined) normalized.isOpen = object.isOpen === true;
            if (object.isPassable !== undefined) normalized.isPassable = object.isPassable !== false;
            if (object.blocksTile !== undefined) normalized.blocksTile = object.blocksTile === true;
            if (object.castsLosShadows !== undefined) normalized.castsLosShadows = object.castsLosShadows === true;
            if (Array.isArray(object.groundPlaneHitboxOverridePoints)) {
                normalized.groundPlaneHitboxOverridePoints = object.groundPlaneHitboxOverridePoints
                    .filter((point) => finitePoint(point))
                    .map((point) => ({ x: Number(point.x), y: Number(point.y) }));
            }
            return normalized;
        }
        const wall = findWall(building, wallId);
        if (!wall) {
            throw new Error(`mounted wall object references missing wall: ${wallId}`);
        }
        const category = String(object.category || object.type || "").trim().toLowerCase();
        const resolvedCategory = category === "door" ? "doors" : (category === "window" ? "windows" : category);
        const normalized = createWallMountedObject({
            floorId: object.floorId || wall.fragmentId || wall.floorId,
            wallId,
            category: resolvedCategory,
            texturePath: object.texturePath,
            wallT: object.wallT ?? 0.5,
            width: object.width ?? 1,
            height: object.height ?? 1,
            zOffset: object.zOffset ?? object.z ?? 0,
            placementRotation: object.placementRotation,
            mountedWallFacingSign: object.mountedWallFacingSign,
            placeableAnchorX: object.placeableAnchorX,
            placeableAnchorY: object.placeableAnchorY,
            renderDepthOffset: object.renderDepthOffset,
            compositeLayers: object.compositeLayers
        });
        if (Number.isInteger(Number(object.id))) normalized.id = Number(object.id);
        if (Number.isFinite(Number(object.x))) normalized.x = Number(object.x);
        if (Number.isFinite(Number(object.y))) normalized.y = Number(object.y);
        if (Number.isFinite(Number(object.z))) normalized.z = Number(object.z);
        if (object.isOpen !== undefined) normalized.isOpen = object.isOpen === true;
        if (object.isPassable !== undefined) normalized.isPassable = object.isPassable !== false;
        if (object.blocksTile !== undefined) normalized.blocksTile = object.blocksTile === true;
        if (object.castsLosShadows !== undefined) normalized.castsLosShadows = object.castsLosShadows === true;
        if (Array.isArray(object.groundPlaneHitboxOverridePoints)) {
            normalized.groundPlaneHitboxOverridePoints = object.groundPlaneHitboxOverridePoints
                .filter((point) => finitePoint(point))
                .map((point) => ({ x: Number(point.x), y: Number(point.y) }));
        }
        return normalized;
    });
    ensureUniqueRoofIds(building);
    refreshWallSectionEndpoints(building);
    bumpIdCountersFromBuilding(building);
    return building;
}

function ensureUniqueRoofIds(building) {
    const seen = new Set();
    getBuildingFloors(building).forEach((floor) => {
        const roofs = [
            floor && floor.roof,
            ...(Array.isArray(floor && floor.roofs) ? floor.roofs : [])
        ];
        roofs.forEach((roof) => {
            if (!roof) return;
            const rawId = typeof roof.id === "string" ? roof.id.trim() : "";
            if (rawId && !seen.has(rawId)) {
                roof.id = rawId;
                seen.add(rawId);
                return;
            }
            let nextId = "";
            do {
                nextId = nextStringId("roof");
            } while (seen.has(nextId));
            roof.id = nextId;
            seen.add(nextId);
        });
    });
}

function bumpIdCountersFromBuilding(building) {
    [building.id, ...getBuildingFloors(building).flatMap((floor) => [
        floor.fragmentId,
        ...getFloorRoofs(floor).flatMap((roof) => [
            roof && roof.id,
            ...(getRoofContactPolygon(roof) || []).map((point) => point.id)
        ]),
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
    getBuildingMountedObjects(building).forEach((object) => {
        if (Number.isInteger(Number(object.id))) mountedObjectIdCounter = Math.max(mountedObjectIdCounter, Number(object.id) + 1);
    });
    getBuildingFloors(building).forEach((floor) => {
        getFloorRoofs(floor).forEach((roof) => getRoofGables(roof).forEach((gable) => {
            if (Number.isInteger(Number(gable.id))) gableIdCounter = Math.max(gableIdCounter, Number(gable.id) + 1);
        }));
        getFloorBeams(floor).forEach((beam) => {
            if (Number.isInteger(Number(beam.id))) beamIdCounter = Math.max(beamIdCounter, Number(beam.id) + 1);
        });
        getFloorColumns(floor).forEach((column) => {
            if (Number.isInteger(Number(column.id))) columnIdCounter = Math.max(columnIdCounter, Number(column.id) + 1);
        });
        getFloorStairs(floor).forEach((stair) => {
            if (Number.isInteger(Number(stair.id))) stairIdCounter = Math.max(stairIdCounter, Number(stair.id) + 1);
        });
    });
}

export { DEFAULTS };
