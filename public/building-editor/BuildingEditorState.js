import "../assets/javascript/wallGeometry.js";
import {
    addFloor,
    columnVertices,
    createBeam,
    createColumn,
    createEmptyBuilding,
    createFloor,
    createRoof,
    createStraightStair,
    createGableMountedObject,
    createPerimeterWallsForFloor,
    createWall,
    createWallMountedObject,
    DEFAULTS,
    duplicateFloor,
    fallbackDeletedVertexEndpointsToPoint,
    findFloor,
    findFloorRoof,
    findMountedObject,
    findWall,
    floorVertexWallInsetPoint,
    getBuildingBeams,
    getBuildingColumns,
    getBuildingMountedObjects,
    getBuildingFloors,
    getBuildingWalls,
    getFloorBeams,
    getFloorColumns,
    getFloorStairs,
    getFloorRoof,
    getFloorRoofs,
    getRoofContactPolygon,
    getRoofDomeLevels,
    getRoofPeakPoint,
    getRoofShedDirection,
    stairFootprintPoints,
    defaultRoofPeakPointForFloor,
    getFloorElevation,
    getFloorId,
    getRoofGables,
    getWallResolvedGeometry,
    normalizeRoofGable,
    mergePerimeterWallsAcrossDeletedVertex,
    normalizeImportedBuilding,
    offsetRing,
    replaceFloorShape,
    refreshWallResolvedGeometry,
    refreshWallSectionEndpoints,
    serializeBuilding,
    splitPerimeterWallAtVertex,
    setFloorElevation,
    wallMiterEndpointKey,
    wallPoints
} from "./BuildingModel.js";
import { distance, distanceToSegment, nearestFloorVertex, nearestWall, pointInPolygon, repairSimplePolygonRing, simplePolygonRingError } from "./BuildingGeometry.js";
import { polygonCentroid } from "./BuildingGeometry.js";
import { validateBuilding } from "./BuildingValidation.js";
import { normalizeWallSnapPointsPerSection, quantizeWallPlacementSnap, wallPlacementPointAtScreen } from "./WallScreenPlacement.js";
import { nearestHexAnchor, snapToHexAnchor } from "./BuildingHexGrid.js";
import {
    applyFloorPolygonEdit,
    findRingEdgeAtPoint,
    findRingVertexAtPoint,
    getFloorRing,
    insertVertexNearSelectedNeighbor,
    insertVertexOnRingEdge,
    ringsForFloor,
    setFloorRing
} from "./BuildingPolygonEditing.js";

const STORAGE_KEY = "survivor-building-editor-current";
const EDITOR_SETTINGS_STORAGE_KEY = "survivor-building-editor-settings";
const MOUNTED_OBJECT_TOOL_STORAGE_KEY = "survivor-building-editor-mounted-object-tools";
const WALL_TOOL_STORAGE_KEY = "survivor-building-editor-wall-tool";
const COLUMN_TOOL_STORAGE_KEY = "survivor-building-editor-column-tool";
const STAIR_TOOL_STORAGE_KEY = "survivor-building-editor-stair-tool";
const CORRUPT_SAVE_BACKUP_KEY_PREFIX = `${STORAGE_KEY}-corrupt-backup`;
const STACKED_VERTEX_TOLERANCE = 0.0001;
const LOWER_FLOOR_VERTEX_SNAP_DISTANCE = 0.25;
const FLOOR_MIDPOINT_SNAP_DISTANCE = 0.25;
const WALL_THICKNESS_MIN = 0.125;
const WALL_THICKNESS_MAX = 1;
const CANONICAL_DIRECTION_COUNT = 12;
const WALL_SNAP_IMPORTANCE = Object.freeze({
    floorVertex: 4,
    wallEndpoint: 2,
    floorEdge: 1
});
const ROOF_SNAP_DISTANCE = 0.35;
const ROOF_PEAK_SNAP_DISTANCE = 0.35;
const ROOF_SHED_DIRECTION_HANDLE_LENGTH = 1.25;
const ROOF_SHED_DIRECTION_SNAP_DISTANCE = 0.25;
const ROOF_RENDER_Z_LIFT = 0.03;
const SHED_WALL_ROOF_GAP = 0.001;
const ROOF_SUPPORT_HEIGHT_EPSILON = 0.0001;
const ROOF_SUPPORT_POINT_EPSILON = 0.0001;
const DEFAULT_COLUMN_EXTRA_THICKNESS = 0.001;
const DEFAULT_COLUMN_WIDTH = 0.25;
const COLUMN_DIMENSION_MAX = 1;
const STAIR_WIDTH_MIN = 0.2;
const STAIR_WIDTH_MAX = 5;
const ROOF_SNAP_IMPORTANCE = Object.freeze({
    perimeterWallOuterCorner: 4,
    lowerFloorVertex: 3,
    columnCorner: 2,
    interiorWallCorner: 1,
    renderedRoofEdge: 3
});

function closestPointOnSegment(point, a, b) {
    const dx = Number(b.x) - Number(a.x);
    const dy = Number(b.y) - Number(a.y);
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) return { x: Number(a.x), y: Number(a.y) };
    const t = Math.max(0, Math.min(1, ((Number(point.x) - Number(a.x)) * dx + (Number(point.y) - Number(a.y)) * dy) / lengthSquared));
    return {
        x: Number(a.x) + t * dx,
        y: Number(a.y) + t * dy
    };
}

function perimeterCumulativeLengths(ring) {
    const lengths = [0];
    let total = 0;
    for (let index = 0; index < ring.length; index++) {
        const current = ring[index];
        const next = ring[(index + 1) % ring.length];
        total += Math.hypot(Number(next.x) - Number(current.x), Number(next.y) - Number(current.y));
        lengths.push(total);
    }
    return lengths;
}

function normalizeGablePerimeterPosition(value, fallbackEdgeIndex = 0, fallbackT = 0) {
    if (value && typeof value === "object") {
        const edgeIndex = Math.floor(Number(value.edgeIndex ?? value.faceIndex));
        const t = Number(value.t);
        if (!Number.isInteger(edgeIndex) || edgeIndex < 0 || !Number.isFinite(t)) {
            throw new Error("gable endpoint drag requires a finite roof outline position");
        }
        return { edgeIndex, t: Math.max(0, Math.min(1, t)) };
    }
    const t = Number(value);
    if (!Number.isFinite(t)) throw new Error("gable endpoint drag requires a finite roof outline position");
    return {
        edgeIndex: Math.max(0, Math.floor(Number(fallbackEdgeIndex)) || 0),
        t: Math.max(0, Math.min(1, t))
    };
}

function normalizeColumnExtraThickness(value, label = "column thickness") {
    const thickness = Number(value);
    if (!Number.isFinite(thickness) || thickness <= 0) {
        throw new Error(`${label} must be a positive number`);
    }
    return Math.min(COLUMN_DIMENSION_MAX, thickness);
}

function normalizeColumnWidth(value, label = "column width") {
    const width = Number(value);
    if (!Number.isFinite(width) || width <= 0) {
        throw new Error(`${label} must be a positive number`);
    }
    return Math.min(COLUMN_DIMENSION_MAX, width);
}

function normalizeColumnSideCount(value, label = "column side count") {
    const sideCount = Math.round(Number(value));
    if (!Number.isInteger(sideCount) || sideCount < 3 || sideCount > 12) {
        throw new Error(`${label} must be an integer between 3 and 12`);
    }
    return sideCount;
}

function normalizeColumnHeight(value, label = "column height") {
    const height = Number(value);
    if (!Number.isFinite(height) || height <= 0) {
        throw new Error(`${label} must be a positive number`);
    }
    return height;
}

function normalizeStairToolWidth(value, label = "stair width") {
    const width = Number(value);
    if (!Number.isFinite(width) || width < STAIR_WIDTH_MIN || width > STAIR_WIDTH_MAX) {
        throw new Error(`${label} must be between ${STAIR_WIDTH_MIN} and ${STAIR_WIDTH_MAX}`);
    }
    return width;
}

function normalizeStairDirection(value, label = "stair direction") {
    const direction = String(value || "").trim().toLowerCase();
    if (direction === "up" || direction === "down") return direction;
    throw new Error(`${label} must be up or down`);
}

function normalizeStairStepCount(value, label = "stair step count") {
    const stepCount = Math.round(Number(value));
    if (!Number.isInteger(stepCount) || stepCount < 1 || stepCount > 200) {
        throw new Error(`${label} must be an integer between 1 and 200`);
    }
    return stepCount;
}

function defaultStairRiserDepth(height, stepCount) {
    const resolvedHeight = Number(height);
    const resolvedStepCount = Math.max(1, Math.round(Number(stepCount) || 1));
    if (!Number.isFinite(resolvedHeight) || resolvedHeight <= 0) return 0;
    return Math.min(resolvedHeight, resolvedHeight / (resolvedStepCount + 1) + 0.25);
}

function normalizeStairRiserDepth(value, height, stepCount, label = "stair riser depth") {
    if (value === null || value === undefined || String(value).trim() === "") {
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

function gablePositionScalar(floor, position) {
    const ring = getRoofContactPolygon(floor);
    if (ring.length < 3) throw new Error(`roof ${getFloorId(floor)} gable endpoints require a valid floor outline`);
    const edgeIndex = Math.floor(Number(position && position.edgeIndex));
    if (!Number.isInteger(edgeIndex) || edgeIndex < 0 || edgeIndex >= ring.length) {
        throw new Error(`roof ${getFloorId(floor)} gable endpoint references missing outline edge`);
    }
    const t = Number(position && position.t);
    if (!Number.isFinite(t) || t < 0 || t > 1) {
        throw new Error(`roof ${getFloorId(floor)} gable endpoint t must be between zero and one`);
    }
    const cumulative = perimeterCumulativeLengths(ring);
    return cumulative[edgeIndex] + (cumulative[edgeIndex + 1] - cumulative[edgeIndex]) * t;
}

function gableIntervalLength(floor, gable) {
    const ring = getRoofContactPolygon(floor);
    const cumulative = perimeterCumulativeLengths(ring);
    const total = cumulative[cumulative.length - 1];
    const start = gablePositionScalar(floor, gable.start);
    const end = gablePositionScalar(floor, gable.end);
    return end >= start ? end - start : total - start + end;
}

function gableIntervalParts(floor, gable) {
    const ring = getRoofContactPolygon(floor);
    const cumulative = perimeterCumulativeLengths(ring);
    const total = cumulative[cumulative.length - 1];
    const start = gablePositionScalar(floor, gable.start);
    const end = gablePositionScalar(floor, gable.end);
    if (end >= start) return [{ start, end }];
    return [
        { start, end: total },
        { start: 0, end }
    ];
}

function canonicalizeGableSpanToShortest(floor, gable) {
    const ring = getRoofContactPolygon(floor);
    const cumulative = perimeterCumulativeLengths(ring);
    const total = cumulative[cumulative.length - 1];
    if (!Number.isFinite(total) || total <= 0) return;
    const forward = gableIntervalLength(floor, gable);
    if (forward > total * 0.5) {
        const previousStart = gable.start;
        gable.start = gable.end;
        gable.end = previousStart;
    }
}

function pointIsNearSegmentEndpoint(point, a, b, threshold) {
    return distance(point, a) <= threshold || distance(point, b) <= threshold;
}

function pointIsNearNonIgnoredSegmentEndpoint(point, a, b, threshold, ignoredVertexEndpoint, ring, floorId) {
    const endpointIsIgnored = (vertex) => !!(
        ignoredVertexEndpoint &&
        isFloorVertexEndpoint(ignoredVertexEndpoint) &&
        vertex &&
        vertex.id === ignoredVertexEndpoint.vertexId &&
        String(ignoredVertexEndpoint.fragmentId) === String(floorId) &&
        String(ignoredVertexEndpoint.ring || "outer") === String(ring.ringKind || "outer") &&
        Number(ignoredVertexEndpoint.holeIndex ?? -1) === Number(ring.holeIndex ?? -1)
    );
    if (!endpointIsIgnored(a) && distance(point, a) <= threshold) return true;
    if (!endpointIsIgnored(b) && distance(point, b) <= threshold) return true;
    return false;
}

function sameXY(a, b, tolerance = STACKED_VERTEX_TOLERANCE) {
    return Math.abs(Number(a && a.x) - Number(b && b.x)) <= tolerance &&
        Math.abs(Number(a && a.y) - Number(b && b.y)) <= tolerance;
}

function isFloorVertexEndpoint(endpoint) {
    return endpoint && (endpoint.kind === "vertex" || endpoint.kind === "insetVertex");
}

function wallHasFloorVertexEndpoint(wall) {
    return isFloorVertexEndpoint(wall && wall.startPoint) || isFloorVertexEndpoint(wall && wall.endPoint);
}

function endpointVertexKey(endpoint) {
    if (!isFloorVertexEndpoint(endpoint) || !endpoint.vertexId) return "";
    return [
        endpoint.fragmentId || "",
        endpoint.ring || "",
        Number.isFinite(Number(endpoint.holeIndex)) ? Number(endpoint.holeIndex) : -1,
        endpoint.vertexId
    ].join(":");
}

function endpointsShareVertex(a, b) {
    const aKey = endpointVertexKey(a);
    const bKey = endpointVertexKey(b);
    if (aKey && bKey && aKey === bKey) return true;
    return sameXY(a, b);
}

function interpolatePoint(a, b, t) {
    const clamped = Math.max(0, Math.min(1, Number(t)));
    return {
        x: Number(a.x) + (Number(b.x) - Number(a.x)) * clamped,
        y: Number(a.y) + (Number(b.y) - Number(a.y)) * clamped
    };
}

function pointInOrOnPolygon(point, polygon, tolerance = ROOF_SUPPORT_POINT_EPSILON) {
    if (!Array.isArray(polygon) || polygon.length < 3) return false;
    if (pointInPolygon(point, polygon)) return true;
    return polygon.some((current, index) => distanceToSegment(point, current, polygon[(index + 1) % polygon.length]) <= tolerance);
}

function cross2d(a, b, c) {
    return (Number(b.x) - Number(a.x)) * (Number(c.y) - Number(a.y)) -
        (Number(b.y) - Number(a.y)) * (Number(c.x) - Number(a.x));
}

function pointOnSegment2d(point, a, b, tolerance = ROOF_SUPPORT_POINT_EPSILON) {
    return distanceToSegment(point, a, b) <= tolerance;
}

function segmentsIntersectOrTouch2d(a, b, c, d, tolerance = ROOF_SUPPORT_POINT_EPSILON) {
    if (
        pointOnSegment2d(a, c, d, tolerance) ||
        pointOnSegment2d(b, c, d, tolerance) ||
        pointOnSegment2d(c, a, b, tolerance) ||
        pointOnSegment2d(d, a, b, tolerance)
    ) {
        return true;
    }
    const abC = cross2d(a, b, c);
    const abD = cross2d(a, b, d);
    const cdA = cross2d(c, d, a);
    const cdB = cross2d(c, d, b);
    return ((abC > tolerance && abD < -tolerance) || (abC < -tolerance && abD > tolerance)) &&
        ((cdA > tolerance && cdB < -tolerance) || (cdA < -tolerance && cdB > tolerance));
}

function polygonsIntersectOrTouch2d(a, b, tolerance = ROOF_SUPPORT_POINT_EPSILON) {
    if (!Array.isArray(a) || a.length < 3 || !Array.isArray(b) || b.length < 3) return false;
    if (a.some((point) => pointInOrOnPolygon(point, b, tolerance))) return true;
    if (b.some((point) => pointInOrOnPolygon(point, a, tolerance))) return true;
    return a.some((aPoint, aIndex) => {
        const aNext = a[(aIndex + 1) % a.length];
        return b.some((bPoint, bIndex) => {
            const bNext = b[(bIndex + 1) % b.length];
            return segmentsIntersectOrTouch2d(aPoint, aNext, bPoint, bNext, tolerance);
        });
    });
}

function polygonClipper(label = "building editor geometry") {
    const clipper = globalThis.polygonClipping;
    if (!clipper || typeof clipper.union !== "function" || typeof clipper.intersection !== "function") {
        throw new Error(`${label} requires polygon-clipping`);
    }
    return clipper;
}

function closedClipRing(points, label) {
    if (!Array.isArray(points) || points.length < 3) {
        throw new Error(`${label} requires at least three points`);
    }
    const ring = points.map((point, index) => {
        const x = Number(point && point.x);
        const y = Number(point && point.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            throw new Error(`${label} contains a non-finite point at index ${index}`);
        }
        return [x, y];
    });
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) > 0.000001) {
        ring.push([first[0], first[1]]);
    }
    return ring;
}

function clipRingSignedArea(ring) {
    let area = 0;
    for (let index = 0; index < ring.length - 1; index++) {
        const current = ring[index];
        const next = ring[index + 1];
        area += Number(current[0]) * Number(next[1]) - Number(next[0]) * Number(current[1]);
    }
    return area * 0.5;
}

function clipGeometryArea(geometry) {
    return (Array.isArray(geometry) ? geometry : []).reduce((total, polygon) => {
        if (!Array.isArray(polygon) || polygon.length === 0) return total;
        const outerArea = Math.abs(clipRingSignedArea(polygon[0]));
        const holeArea = polygon.slice(1).reduce((sum, ring) => sum + Math.abs(clipRingSignedArea(ring)), 0);
        return total + Math.max(0, outerArea - holeArea);
    }, 0);
}

function floorClipPolygon(floor, label = `floor ${getFloorId(floor)} polygon`) {
    return [
        closedClipRing(floor && floor.outerPolygon, `${label} outer`),
        ...(Array.isArray(floor && floor.holes) ? floor.holes : [])
            .map((ring, index) => closedClipRing(ring, `${label} hole ${index}`))
    ];
}

function wallFootprintPolygonFromResolvedGeometry(wall) {
    const resolvedProfile = getWallResolvedGeometry(wall).profile;
    return [
        resolvedProfile.aLeft,
        resolvedProfile.bLeft,
        resolvedProfile.bRight,
        resolvedProfile.aRight
    ];
}

function normalizeRadians(angle) {
    let out = Number(angle) % (Math.PI * 2);
    if (out <= -Math.PI) out += Math.PI * 2;
    if (out > Math.PI) out -= Math.PI * 2;
    return out;
}

function shortestAngleDelta(from, to) {
    return normalizeRadians(Number(to) - Number(from));
}

function unwrapDeltaNear(delta, referenceDelta) {
    let unwrapped = Number(delta);
    const reference = Number(referenceDelta);
    if (!Number.isFinite(unwrapped)) throw new Error("stair arc delta must be finite");
    if (!Number.isFinite(reference)) return unwrapped;
    while (unwrapped - reference > Math.PI) unwrapped -= Math.PI * 2;
    while (unwrapped - reference <= -Math.PI) unwrapped += Math.PI * 2;
    return unwrapped;
}

function treadStoredArcDelta(tread, key, label) {
    if (!Object.prototype.hasOwnProperty.call(tread || {}, key)) return null;
    const value = Number(tread[key]);
    if (!Number.isFinite(value)) throw new Error(`${label} ${key} must be finite`);
    return value;
}

function stairArcDelta(startAngle, endAngle, tread, key, label, referenceDelta = null) {
    const rawDelta = shortestAngleDelta(startAngle, endAngle);
    const storedDelta = treadStoredArcDelta(tread, key, label);
    if (storedDelta === null) {
        return referenceDelta === null ? rawDelta : unwrapDeltaNear(rawDelta, referenceDelta);
    }
    const unwrapped = unwrapDeltaNear(rawDelta, storedDelta);
    if (Math.abs(unwrapped - storedDelta) > 0.0001) {
        throw new Error(`${label} ${key} does not match tread endpoint geometry`);
    }
    return storedDelta;
}

function arcPoint(center, radius, startAngle, deltaAngle, t) {
    const angle = Number(startAngle) + Number(deltaAngle) * Math.max(0, Math.min(1, Number(t)));
    return {
        x: Number(center.x) + Math.cos(angle) * Number(radius),
        y: Number(center.y) + Math.sin(angle) * Number(radius)
    };
}

function pointDistance(a, b) {
    return Math.hypot(Number(a.x) - Number(b.x), Number(a.y) - Number(b.y));
}

function samePoint2d(a, b, epsilon = 0.000001) {
    return pointDistance(a, b) <= epsilon;
}

function lineIntersectionPoint(a, b, c, d) {
    const ax = Number(a.x);
    const ay = Number(a.y);
    const bx = Number(b.x);
    const by = Number(b.y);
    const cx = Number(c.x);
    const cy = Number(c.y);
    const dx = Number(d.x);
    const dy = Number(d.y);
    const abx = bx - ax;
    const aby = by - ay;
    const cdx = dx - cx;
    const cdy = dy - cy;
    const denominator = abx * cdy - aby * cdx;
    if (Math.abs(denominator) <= 0.000001) return null;
    const acx = cx - ax;
    const acy = cy - ay;
    const t = (acx * cdy - acy * cdx) / denominator;
    return { x: ax + abx * t, y: ay + aby * t };
}

function polygonSignedArea(points) {
    let area = 0;
    for (let index = 0; index < points.length; index++) {
        const current = points[index];
        const next = points[(index + 1) % points.length];
        area += Number(current.x) * Number(next.y) - Number(next.x) * Number(current.y);
    }
    return area * 0.5;
}

function positiveAreaRing(points) {
    const ring = (Array.isArray(points) ? points : [])
        .map((point) => ({ x: Number(point.x), y: Number(point.y) }));
    return polygonSignedArea(ring) < 0 ? ring.reverse() : ring;
}

function normalizedStairTread(tread, label = "stair tread") {
    if (!tread || !Number.isFinite(Number(tread.left && tread.left.x)) || !Number.isFinite(Number(tread.left && tread.left.y)) ||
        !Number.isFinite(Number(tread.right && tread.right.x)) || !Number.isFinite(Number(tread.right && tread.right.y))) {
        throw new Error(`${label} requires finite left and right endpoints`);
    }
    const left = { x: Number(tread.left.x), y: Number(tread.left.y) };
    const right = { x: Number(tread.right.x), y: Number(tread.right.y) };
    const length = pointDistance(left, right);
    if (!Number.isFinite(length) || length <= 0.000001) {
        throw new Error(`${label} requires non-coincident endpoints`);
    }
    const normalized = {
        left,
        right,
        center: {
            x: (left.x + right.x) * 0.5,
            y: (left.y + right.y) * 0.5
        },
        angle: Math.atan2(right.y - left.y, right.x - left.x),
        length
    };
    if (Object.prototype.hasOwnProperty.call(tread, "arcDeltaAngle")) {
        const value = Number(tread.arcDeltaAngle);
        if (!Number.isFinite(value)) throw new Error(`${label} arcDeltaAngle must be finite`);
        normalized.arcDeltaAngle = value;
    }
    if (Object.prototype.hasOwnProperty.call(tread, "arcNearDeltaAngle")) {
        const value = Number(tread.arcNearDeltaAngle);
        if (!Number.isFinite(value)) throw new Error(`${label} arcNearDeltaAngle must be finite`);
        normalized.arcNearDeltaAngle = value;
    }
    return normalized;
}

function connectedStairTreadEndpoint(a, b) {
    const endpoints = [
        { aPoint: a.left, bPoint: b.left, aOther: a.right, bOther: b.right },
        { aPoint: a.left, bPoint: b.right, aOther: a.right, bOther: b.left },
        { aPoint: a.right, bPoint: b.left, aOther: a.left, bOther: b.right },
        { aPoint: a.right, bPoint: b.right, aOther: a.left, bOther: b.left }
    ];
    return endpoints.find((entry) => samePoint2d(entry.aPoint, entry.bPoint)) || null;
}

function chooseParallelStairTreadPairing(a, b) {
    const sameSideScore = pointDistance(a.left, b.left) + pointDistance(a.right, b.right);
    const crossedScore = pointDistance(a.left, b.right) + pointDistance(a.right, b.left);
    if (crossedScore < sameSideScore) {
        return {
            side0Start: a.left,
            side0End: b.right,
            side1Start: a.right,
            side1End: b.left
        };
    }
    return {
        side0Start: a.left,
        side0End: b.left,
        side1Start: a.right,
        side1End: b.right
    };
}

function allocateCountsByArea(sections, totalCount) {
    const count = Math.max(1, Math.round(Number(totalCount) || 1));
    const active = sections
        .map((section, index) => ({ section, index, area: Math.max(0, Number(section && section.area) || 0) }))
        .filter((entry) => entry.area > 0.000001);
    const counts = new Array(sections.length).fill(0);
    if (!active.length) {
        counts[0] = count;
        return counts;
    }
    const totalArea = active.reduce((sum, entry) => sum + entry.area, 0);
    if (count >= active.length) active.forEach((entry) => { counts[entry.index] = 1; });
    const remaining = count - counts.reduce((sum, value) => sum + value, 0);
    const shares = active.map((entry) => {
        const exact = remaining * entry.area / totalArea;
        return { ...entry, exact, floor: Math.floor(exact), remainder: exact - Math.floor(exact) };
    });
    let assigned = 0;
    shares.forEach((entry) => {
        counts[entry.index] += entry.floor;
        assigned += entry.floor;
    });
    shares
        .sort((a, b) => b.remainder - a.remainder || b.area - a.area || a.index - b.index)
        .slice(0, remaining - assigned)
        .forEach((entry) => { counts[entry.index] += 1; });
    return counts;
}

function endpointIsInsetFloorVertex(endpoint) {
    return isFloorVertexEndpoint(endpoint) && (endpoint.inset === true || endpoint.kind === "insetVertex");
}

function endpointMatchesFloorRing(endpoint, ring, floorId) {
    return isFloorVertexEndpoint(endpoint) &&
        String(endpoint.fragmentId) === String(floorId) &&
        String(endpoint.ring || "outer") === String((ring && ring.ringKind) || "outer") &&
        Number(endpoint.holeIndex ?? -1) === Number((ring && ring.holeIndex) ?? -1);
}

function previousRingIndex(ring, index) {
    return (Math.floor(Number(index)) - 1 + ring.length) % ring.length;
}

function nextRingIndex(ring, index) {
    return (Math.floor(Number(index)) + 1) % ring.length;
}

function findMatchingDirectedEdgeIndex(ring, startPoint, endPoint) {
    if (!Array.isArray(ring) || ring.length < 3) return -1;
    for (let index = 0; index < ring.length; index++) {
        const next = ring[(index + 1) % ring.length];
        if (sameXY(ring[index], startPoint) && sameXY(next, endPoint)) return index;
    }
    return -1;
}

function findMatchingVertexWithNeighbors(ring, previousPoint, vertexPoint, nextPoint) {
    if (!Array.isArray(ring) || ring.length < 4) return -1;
    for (let index = 0; index < ring.length; index++) {
        if (
            sameXY(ring[index], vertexPoint) &&
            sameXY(ring[previousRingIndex(ring, index)], previousPoint) &&
            sameXY(ring[nextRingIndex(ring, index)], nextPoint)
        ) {
            return index;
        }
    }
    return -1;
}

function cloneEndpoint(endpoint) {
    return JSON.parse(JSON.stringify(endpoint));
}

function pointEndpoint(point) {
    return {
        kind: "point",
        x: Number(point.x),
        y: Number(point.y)
    };
}

function floorVertexKey(floorId, ring, holeIndex, vertexId) {
    return `${floorId}:${ring || "outer"}:${Number.isFinite(Number(holeIndex)) ? Number(holeIndex) : -1}:${vertexId || ""}`;
}

function floorVertexKeyForEndpoint(endpoint) {
    if (!isFloorVertexEndpoint(endpoint) || !endpoint.fragmentId || !endpoint.vertexId) return "";
    return floorVertexKey(endpoint.fragmentId, endpoint.ring, endpoint.holeIndex, endpoint.vertexId);
}

function originalFloorVertexMap(floor) {
    const floorId = getFloorId(floor);
    const vertices = new Map();
    (Array.isArray(floor && floor.outerPolygon) ? floor.outerPolygon : []).forEach((point) => {
        if (point && point.id) vertices.set(floorVertexKey(floorId, "outer", -1, point.id), point);
    });
    (Array.isArray(floor && floor.holes) ? floor.holes : []).forEach((ring, holeIndex) => {
        (Array.isArray(ring) ? ring : []).forEach((point) => {
            if (point && point.id) vertices.set(floorVertexKey(floorId, "hole", holeIndex, point.id), point);
        });
    });
    return vertices;
}

function survivingFloorVertexKeys(floor, polygonEditResult) {
    const floorId = getFloorId(floor);
    const keys = new Set();
    (Array.isArray(polygonEditResult && polygonEditResult.footprint) ? polygonEditResult.footprint : []).forEach((point) => {
        if (point && point.id) keys.add(floorVertexKey(floorId, "outer", -1, point.id));
    });
    (Array.isArray(polygonEditResult && polygonEditResult.holes) ? polygonEditResult.holes : []).forEach((ring, holeIndex) => {
        (Array.isArray(ring) ? ring : []).forEach((point) => {
            if (point && point.id) keys.add(floorVertexKey(floorId, "hole", holeIndex, point.id));
        });
    });
    return keys;
}

function resultFloorVertexMap(floor, polygonEditResult) {
    const floorId = getFloorId(floor);
    const vertices = new Map();
    (Array.isArray(polygonEditResult && polygonEditResult.footprint) ? polygonEditResult.footprint : []).forEach((point) => {
        if (point && point.id) vertices.set(floorVertexKey(floorId, "outer", -1, point.id), point);
    });
    (Array.isArray(polygonEditResult && polygonEditResult.holes) ? polygonEditResult.holes : []).forEach((ring, holeIndex) => {
        (Array.isArray(ring) ? ring : []).forEach((point) => {
            if (point && point.id) vertices.set(floorVertexKey(floorId, "hole", holeIndex, point.id), point);
        });
    });
    return vertices;
}

function endpointLandsOnResultVertex(endpoint, resultVertex) {
    return endpoint &&
        resultVertex &&
        Math.abs(Number(endpoint.x) - Number(resultVertex.x)) <= 0.000001 &&
        Math.abs(Number(endpoint.y) - Number(resultVertex.y)) <= 0.000001;
}

function resultOuterEdgeSurvives(polygonEditResult, startVertexId, endVertexId) {
    const ring = Array.isArray(polygonEditResult && polygonEditResult.footprint) ? polygonEditResult.footprint : [];
    if (!startVertexId || !endVertexId || ring.length < 2) return false;
    for (let index = 0; index < ring.length; index++) {
        const start = ring[index];
        const end = ring[(index + 1) % ring.length];
        if (start && end && start.id === startVertexId && end.id === endVertexId) return true;
    }
    return false;
}

function downgradeWallToPointEndpoints(wall, originalVertices) {
    ["startPoint", "endPoint"].forEach((endpointKey) => {
        const endpoint = wall[endpointKey];
        if (!isFloorVertexEndpoint(endpoint)) return;
        const point = originalVertices.get(floorVertexKeyForEndpoint(endpoint)) || endpoint;
        if (!Number.isFinite(Number(point && point.x)) || !Number.isFinite(Number(point && point.y))) {
            throw new Error(`cannot preserve wall ${wall.id} endpoint after floor add without finite vertex coordinates`);
        }
        wall[endpointKey] = pointEndpoint(point);
    });
    wall.role = "interior";
    wall.attachment = null;
}

function downgradeMovedWallVertexEndpoints(building, floor, polygonEditResult) {
    const floorId = getFloorId(floor);
    const originalVertices = originalFloorVertexMap(floor);
    const survivingVertices = survivingFloorVertexKeys(floor, polygonEditResult);
    const resultVertices = resultFloorVertexMap(floor, polygonEditResult);
    getBuildingWalls(building).forEach((wall) => {
        if (String(wall && (wall.fragmentId || wall.floorId)) !== floorId) return;
        const attachment = wall.attachment;
        if (
            wall.role === "perimeter" &&
            attachment &&
            attachment.kind === "fragmentEdge" &&
            attachment.ring === "outer" &&
            !resultOuterEdgeSurvives(polygonEditResult, attachment.startVertexId, attachment.endVertexId)
        ) {
            downgradeWallToPointEndpoints(wall, originalVertices);
            return;
        }
        ["startPoint", "endPoint"].forEach((endpointKey) => {
            const endpoint = wall[endpointKey];
            if (!isFloorVertexEndpoint(endpoint) || String(endpoint.fragmentId) !== floorId) return;
            const key = floorVertexKeyForEndpoint(endpoint);
            const resultVertex = resultVertices.get(key) || null;
            if (survivingVertices.has(key) && endpointLandsOnResultVertex(endpoint, resultVertex)) return;
            const point = originalVertices.get(key) || endpoint;
            if (!Number.isFinite(Number(point && point.x)) || !Number.isFinite(Number(point && point.y))) {
                throw new Error(`cannot preserve wall ${wall.id} endpoint after floor add without finite vertex coordinates`);
            }
            wall[endpointKey] = pointEndpoint(point);
        });
    });
}

function translatePoint(point, dx, dy) {
    return {
        ...point,
        x: Number(point.x) + dx,
        y: Number(point.y) + dy
    };
}

function translateEndpoint(endpoint, dx, dy) {
    if (!endpoint || typeof endpoint !== "object") return endpoint;
    if (!Number.isFinite(Number(endpoint.x)) || !Number.isFinite(Number(endpoint.y))) return cloneEndpoint(endpoint);
    return {
        ...cloneEndpoint(endpoint),
        x: Number(endpoint.x) + dx,
        y: Number(endpoint.y) + dy
    };
}

function endpointIsFinite(endpoint) {
    return Number.isFinite(Number(endpoint && endpoint.x)) && Number.isFinite(Number(endpoint && endpoint.y));
}

function syncWallLineBoundaryAttachment(wall) {
    const edgeEndpoints = [wall.startPoint, wall.endPoint].filter((endpoint) => endpoint && endpoint.kind === "edge");
    const hasLineClippedEdgeEndpoint = edgeEndpoints.some((endpoint) => endpoint.boundaryPoint !== true);
    if (!hasLineClippedEdgeEndpoint) {
        wall.attachment = null;
        return;
    }
    if (!endpointIsFinite(wall.startPoint) || !endpointIsFinite(wall.endPoint)) {
        throw new Error(`cannot update wall ${wall.id} edge attachment without finite endpoints`);
    }
    wall.attachment = {
        kind: "lineBoundaryClip",
        fragmentId: wall.fragmentId || wall.floorId,
        linePoint: { x: Number(wall.startPoint.x), y: Number(wall.startPoint.y) },
        lineVector: {
            x: Number(wall.endPoint.x) - Number(wall.startPoint.x),
            y: Number(wall.endPoint.y) - Number(wall.startPoint.y)
        }
    };
}

function normalizeEditorWallThickness(value, context) {
    const thickness = Number(value);
    if (!Number.isFinite(thickness) || thickness < WALL_THICKNESS_MIN || thickness > WALL_THICKNESS_MAX) {
        throw new Error(`${context} must be between ${WALL_THICKNESS_MIN} and ${WALL_THICKNESS_MAX}`);
    }
    return thickness;
}

function snapPointToCanonicalDirection(origin, point) {
    if (!origin || !point) return point;
    const ox = Number(origin.x);
    const oy = Number(origin.y);
    const px = Number(point.x);
    const py = Number(point.y);
    if (!Number.isFinite(ox) || !Number.isFinite(oy) || !Number.isFinite(px) || !Number.isFinite(py)) {
        throw new Error("direction snapping requires finite points");
    }
    const dx = px - ox;
    const dy = py - oy;
    const length = Math.hypot(dx, dy);
    if (length <= 0.000001) return { x: px, y: py };
    const step = (Math.PI * 2) / CANONICAL_DIRECTION_COUNT;
    const snappedAngle = Math.round(Math.atan2(dy, dx) / step) * step;
    return {
        x: ox + Math.cos(snappedAngle) * length,
        y: oy + Math.sin(snappedAngle) * length
    };
}

function roofSnapPlaneElevation(floor) {
    const floorHeight = Number(floor && floor.floorHeight);
    if (!Number.isFinite(floorHeight) || floorHeight <= 0) {
        throw new Error(`roof snap plane requires a positive floor height for ${getFloorId(floor)}`);
    }
    return getFloorElevation(floor) + floorHeight;
}

function floorRoofView(floor, roof) {
    if (!roof || getFloorRoof(floor) === roof) return floor;
    return { ...floor, roof };
}

function roofModeValue(roof) {
    return String(roof && roof.mode || DEFAULTS.roofMode).trim().toLowerCase();
}

function roofUsesSlopeDirection(roof) {
    const mode = roofModeValue(roof);
    return mode === "shed" || mode === "gabled";
}

function normalizeRoofElevationOffset(value, context = "roof elevation offset") {
    const offset = Number(value);
    if (!Number.isFinite(offset)) throw new Error(`${context} must be a finite number`);
    return offset;
}

function wallFootprintCornersFromCenterline(points, thickness, label) {
    if (!Array.isArray(points) || points.length !== 2) {
        throw new Error(`${label} requires two wall points`);
    }
    const wallThickness = Number(thickness);
    if (!Number.isFinite(wallThickness) || wallThickness <= 0) {
        throw new Error(`${label} requires a positive wall thickness`);
    }
    const [a, b] = points;
    const dx = Number(b.x) - Number(a.x);
    const dy = Number(b.y) - Number(a.y);
    const length = Math.hypot(dx, dy);
    if (length <= 0.000001) throw new Error(`${label} requires non-coincident wall points`);
    const nx = -dy / length;
    const ny = dx / length;
    const half = wallThickness * 0.5;
    return [
        { x: Number(a.x) + nx * half, y: Number(a.y) + ny * half },
        { x: Number(b.x) + nx * half, y: Number(b.y) + ny * half },
        { x: Number(b.x) - nx * half, y: Number(b.y) - ny * half },
        { x: Number(a.x) - nx * half, y: Number(a.y) - ny * half }
    ];
}

function dedupeCandidates(candidates) {
    const byKey = new Map();
    candidates.forEach((candidate) => {
        const key = `${Number(candidate.point.x).toFixed(6)},${Number(candidate.point.y).toFixed(6)}`;
        const existing = byKey.get(key);
        if (!existing || Number(candidate.importance) > Number(existing.importance)) {
            byKey.set(key, candidate);
        }
    });
    return Array.from(byKey.values());
}

function browserLocalStorage() {
    if (typeof globalThis === "undefined" || !globalThis.localStorage) return null;
    const hasGetItem = typeof globalThis.localStorage.getItem === "function";
    const hasSetItem = typeof globalThis.localStorage.setItem === "function";
    if (!hasGetItem && !hasSetItem) return null;
    if (
        !hasGetItem ||
        !hasSetItem
    ) {
        throw new Error("building editor settings require a valid localStorage object");
    }
    return globalThis.localStorage;
}

function readEditorSettingsFromBrowser() {
    const storage = browserLocalStorage();
    if (!storage) return {};
    const stored = storage.getItem(EDITOR_SETTINGS_STORAGE_KEY);
    if (stored === null) return {};
    let settings;
    try {
        settings = JSON.parse(stored);
    } catch (_error) {
        throw new Error(`invalid building editor settings in localStorage: ${EDITOR_SETTINGS_STORAGE_KEY}`);
    }
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
        throw new Error(`building editor settings must be an object: ${EDITOR_SETTINGS_STORAGE_KEY}`);
    }
    return settings;
}

function storedBooleanSetting(settings, key, defaultValue) {
    if (!Object.hasOwn(settings, key)) return defaultValue;
    if (settings[key] === true || settings[key] === false) return settings[key];
    throw new Error(`building editor setting ${key} must be true or false`);
}

function createSelection(kind, fields = {}) {
    const wallIds = Array.isArray(fields.wallIds)
        ? fields.wallIds.map((id) => Number.isFinite(Number(id)) ? Number(id) : String(id))
        : (fields.wallId !== undefined && fields.wallId !== null ? [fields.wallId] : []);
    const wallId = fields.wallId !== undefined && fields.wallId !== null
        ? fields.wallId
        : (wallIds.length === 1 ? wallIds[0] : null);
    const mountedObjectIds = Array.isArray(fields.mountedObjectIds)
        ? fields.mountedObjectIds.map((id) => Number.isFinite(Number(id)) ? Number(id) : String(id))
        : (fields.mountedObjectId !== undefined && fields.mountedObjectId !== null ? [fields.mountedObjectId] : []);
    const mountedObjectId = fields.mountedObjectId !== undefined && fields.mountedObjectId !== null
        ? fields.mountedObjectId
        : (mountedObjectIds.length === 1 ? mountedObjectIds[0] : null);
    const columnIds = Array.isArray(fields.columnIds)
        ? fields.columnIds.map((id) => Number.isFinite(Number(id)) ? Number(id) : String(id))
        : (fields.columnId !== undefined && fields.columnId !== null ? [fields.columnId] : []);
    const columnId = fields.columnId !== undefined && fields.columnId !== null
        ? fields.columnId
        : (columnIds.length === 1 ? columnIds[0] : null);
    const beamIds = Array.isArray(fields.beamIds)
        ? fields.beamIds.map((id) => Number.isFinite(Number(id)) ? Number(id) : String(id))
        : (fields.beamId !== undefined && fields.beamId !== null ? [fields.beamId] : []);
    const beamId = fields.beamId !== undefined && fields.beamId !== null
        ? fields.beamId
        : (beamIds.length === 1 ? beamIds[0] : null);
    const stairIds = Array.isArray(fields.stairIds)
        ? fields.stairIds.map((id) => Number.isFinite(Number(id)) ? Number(id) : String(id))
        : (fields.stairId !== undefined && fields.stairId !== null ? [fields.stairId] : []);
    const stairId = fields.stairId !== undefined && fields.stairId !== null
        ? fields.stairId
        : (stairIds.length === 1 ? stairIds[0] : null);
    const floorId = fields.floorId !== undefined && fields.floorId !== null
        ? String(fields.floorId)
        : (fields.levelId !== undefined && fields.levelId !== null ? String(fields.levelId) : null);
    const roofFloorIds = Array.isArray(fields.roofFloorIds)
        ? fields.roofFloorIds.map((id) => String(id))
        : (kind === "roof" && floorId ? [floorId] : []);
    return {
        kind,
        floorId,
        levelId: floorId,
        roofFloorIds,
        roofId: fields.roofId !== undefined && fields.roofId !== null ? String(fields.roofId) : null,
        wallId,
        wallIds,
        mountedObjectId,
        mountedObjectIds,
        gableId: fields.gableId !== undefined && fields.gableId !== null ? Number(fields.gableId) : null,
        gableHandle: fields.gableHandle || null,
        wallEndpointKey: fields.wallEndpointKey || null,
        beamId: beamId !== undefined && beamId !== null ? Number(beamId) : null,
        beamIds,
        beamEndpointKey: fields.beamEndpointKey || null,
        stairId: stairId !== undefined && stairId !== null ? Number(stairId) : null,
        stairIds,
        columnId: columnId !== undefined && columnId !== null ? Number(columnId) : null,
        columnIds,
        ringKind: fields.ringKind || null,
        holeIndex: Number.isFinite(Number(fields.holeIndex)) ? Number(fields.holeIndex) : -1,
        vertexIndex: Number.isFinite(Number(fields.vertexIndex)) ? Number(fields.vertexIndex) : -1
    };
}

export class BuildingEditorState extends EventTarget {
    constructor() {
        super();
        this.building = createEmptyBuilding();
        this.tool = "select";
        this.selectedFloorIds = new Set();
        this.layerSelectionMode = "floor";
        this.selection = createSelection("building");
        const editorSettings = readEditorSettingsFromBrowser();
        this.snapToGrid = storedBooleanSetting(editorSettings, "snapToGrid", false);
        this.snapDirection = false;
        this.showSnapAnchors = false;
        this.shiftKeyDown = false;
        this.paintTextures = {
            floor: DEFAULTS.floorTexture,
            roofs: DEFAULTS.roofTexture,
            walls: DEFAULTS.wallTexture
        };
        this.mountedObjectTool = {
            category: "doors",
            assets: {
                doors: null,
                windows: null
            },
            settings: {
                doors: { size: 1, aspectRatio: 0.75, snapPointsPerSection: 1 },
                windows: { size: 1, aspectRatio: 1, snapPointsPerSection: 1 }
            }
        };
        this.wallTool = {
            height: DEFAULTS.wallHeight,
            texture: DEFAULTS.wallTexture,
            thickness: DEFAULTS.wallThickness
        };
        this.columnTool = {
            thickness: DEFAULT_COLUMN_EXTRA_THICKNESS,
            width: DEFAULT_COLUMN_WIDTH,
            height: null,
            heightMode: "wall",
            sideCount: 4,
            texture: DEFAULTS.wallTexture,
            snapPointsPerSection: 1
        };
        this.stairTool = {
            width: DEFAULTS.stairWidth,
            direction: DEFAULTS.stairDirection,
            texture: DEFAULTS.floorTexture,
            treadTexture: DEFAULTS.floorTexture,
            riserTexture: DEFAULTS.floorTexture,
            stepCount: null,
            riserDepth: DEFAULTS.stairRiserDepth
        };
        this.gridSize = DEFAULTS.gridSize;
        this.camera = { x: 0, y: 0, z: 0, zoom: 72, rotation: 0, pitch: Math.PI / 4, rotationCenter: { x: 0, y: 0 } };
        this.draft = null;
        this.floorVertexDrag = null;
        this.hoverWorldPoint = null;
        this.renderError = "";
        this.polygonToolElevation = 0;
        this.inputs = {
            floorElevation: 0,
            floorHeight: DEFAULTS.wallHeight,
            floorTexture: DEFAULTS.floorTexture,
            roofTexture: DEFAULTS.roofTexture,
            roofMode: DEFAULTS.roofMode,
            roofOverhang: DEFAULTS.roofOverhang,
            roofPeakHeight: DEFAULTS.roofPeakHeight,
            roofDomeLevels: DEFAULTS.roofDomeLevels,
            wallHeight: DEFAULTS.wallHeight,
            wallTexture: DEFAULTS.wallTexture,
            wallThickness: DEFAULTS.wallThickness,
            columnThickness: DEFAULT_COLUMN_EXTRA_THICKNESS,
            columnWidth: DEFAULT_COLUMN_WIDTH,
            columnHeight: null,
            columnSideCount: 4,
            columnTexture: DEFAULTS.wallTexture,
            columnSnapPointsPerSection: 1,
            stairWidth: DEFAULTS.stairWidth,
            stairDirection: DEFAULTS.stairDirection,
            stairTexture: DEFAULTS.floorTexture,
            stairTreadTexture: DEFAULTS.floorTexture,
            stairRiserTexture: DEFAULTS.floorTexture,
            stairStepCount: null,
            stairRiserDepth: DEFAULTS.stairRiserDepth,
            mountedObjectSnapPointsPerSection: 1
        };
        this.createStarterFloor();
    }

    createStarterFloor() {
        const floor = createFloor({
            elevation: 0,
            footprint: [
                { x: -2.598, y: -1.5 },
                { x: 2.598, y: -1.5 },
                { x: 2.598, y: 1.5 },
                { x: -2.598, y: 1.5 }
            ],
            defaultWallHeight: 3,
            createPerimeterWalls: true
        });
        addFloor(this.building, floor);
        this.selectFloor(getFloorId(floor));
    }

    emitChange() {
        this.syncGeneratedWallTopProfiles();
        refreshWallResolvedGeometry(this.building);
        this.dispatchEvent(new CustomEvent("change"));
    }

    saveEditorSettingsToBrowser() {
        const storage = browserLocalStorage();
        if (!storage) return false;
        storage.setItem(EDITOR_SETTINGS_STORAGE_KEY, JSON.stringify({
            snapToGrid: this.snapToGrid === true
        }));
        return true;
    }

    setSnapToGrid(enabled, options = {}) {
        this.snapToGrid = enabled === true;
        if (options.persist !== false) this.saveEditorSettingsToBrowser();
        this.emitChange();
    }

    setTool(tool) {
        if (tool === "wall") {
            this.setWallToolActive();
            return;
        }
        if (tool === "column") {
            this.setColumnToolActive();
            return;
        }
        if (tool === "stair") {
            this.setStairToolActive();
            return;
        }
        if (tool === "polygon" || tool === "scissors") {
            const selectedFloor = this.selectedFloor();
            if (selectedFloor) this.polygonToolElevation = getFloorElevation(selectedFloor);
        }
        this.tool = tool;
        this.draft = null;
        if (this.selection && this.selection.kind === "stair") this.clearSelectionForTool();
        this.emitChange();
    }

    setStairToolActive() {
        const selectedFloor = this.selectedFloor();
        this.tool = "stair";
        this.draft = null;
        this.syncStairToolDirectionWithFloor(selectedFloor, { emit: false });
        if (this.selection && this.selection.kind === "stair") this.clearSelectionForTool();
        this.inputs.stairWidth = this.stairTool.width;
        this.inputs.stairDirection = this.stairTool.direction;
        this.inputs.stairTexture = this.stairTool.treadTexture;
        this.inputs.stairTreadTexture = this.stairTool.treadTexture;
        this.inputs.stairRiserTexture = this.stairTool.riserTexture;
        this.inputs.stairStepCount = this.stairTool.stepCount;
        this.inputs.stairRiserDepth = this.stairTool.riserDepth;
        this.paintTextures.floor = this.stairTool.treadTexture;
        this.saveStairToolSettingsToBrowser();
        this.emitChange();
    }

    setWallToolActive() {
        const selectedWall = this.selectedWall();
        const targetFloorId = this.selection && this.selection.floorId ? this.selection.floorId : null;
        if (selectedWall) {
            this.copyWallToTool(selectedWall);
        }
        this.tool = "wall";
        this.draft = null;
        if (targetFloorId && findFloor(this.building, targetFloorId)) {
            this.focusWallToolFloor(targetFloorId, { emit: false });
        } else {
            this.clearSelectionForTool();
        }
        this.inputs.wallHeight = this.wallTool.height;
        this.inputs.wallTexture = this.wallTool.texture;
        this.inputs.wallThickness = this.wallTool.thickness;
        this.paintTextures.walls = this.wallTool.texture;
        this.saveWallToolSettingsToBrowser();
        this.emitChange();
    }

    focusWallToolFloor(floorId, options = {}) {
        const floor = findFloor(this.building, floorId);
        if (!floor) {
            throw new Error(`cannot target missing floor for wall tool: ${floorId}`);
        }
        const selectedFloorId = getFloorId(floor);
        this.selectedFloorIds = new Set([selectedFloorId]);
        this.layerSelectionMode = "floor";
        this.selection = createSelection("floor", { floorId: selectedFloorId });
        this.syncInputsFromFloor(floor);
        if (this.tool === "wall") {
            this.inputs.wallHeight = this.wallTool.height;
            this.inputs.wallTexture = this.wallTool.texture;
            this.inputs.wallThickness = this.wallTool.thickness;
            this.paintTextures.walls = this.wallTool.texture;
        }
        if (options.emit !== false) this.emitChange();
    }

    isWallToolFocusedOnFloor(floorId) {
        const selectedFloorId = String(floorId || "");
        return this.tool === "wall" &&
            this.layerSelectionMode === "floor" &&
            this.selectedFloorIds.size === 1 &&
            this.selectedFloorIds.has(selectedFloorId);
    }

    copyWallToTool(wall) {
        if (!wall) throw new Error("cannot copy missing wall to wall tool");
        const height = Number(wall.height);
        if (!Number.isFinite(height) || height <= 0) {
            throw new Error(`cannot copy wall ${wall.id} to wall tool without a positive height`);
        }
        if (typeof wall.wallTexturePath !== "string" || wall.wallTexturePath.length === 0) {
            throw new Error(`cannot copy wall ${wall.id} to wall tool without a texture`);
        }
        this.wallTool.height = height;
        this.wallTool.texture = wall.wallTexturePath;
        this.wallTool.thickness = normalizeEditorWallThickness(wall.thickness, `wall ${wall.id} thickness`);
    }

    updateWallToolHeight(value) {
        const height = Number(value);
        if (!Number.isFinite(height) || height <= 0) {
            throw new Error("wall tool height must be a positive number");
        }
        this.wallTool.height = height;
        this.inputs.wallHeight = height;
        this.saveWallToolSettingsToBrowser();
        this.emitChange();
    }

    updateWallToolTexture(texture) {
        if (typeof texture !== "string" || texture.length === 0) {
            throw new Error("wall tool texture path must be a non-empty string");
        }
        this.wallTool.texture = texture;
        this.inputs.wallTexture = texture;
        this.paintTextures.walls = texture;
        this.saveWallToolSettingsToBrowser();
        this.emitChange();
    }

    updateWallToolThickness(value) {
        const thickness = normalizeEditorWallThickness(value, "wall tool thickness");
        this.wallTool.thickness = thickness;
        this.inputs.wallThickness = thickness;
        this.saveWallToolSettingsToBrowser();
        this.emitChange();
    }

    wallToolSettingsSnapshot() {
        return {
            height: this.wallTool.height,
            texture: this.wallTool.texture,
            thickness: this.wallTool.thickness
        };
    }

    saveWallToolSettingsToBrowser() {
        localStorage.setItem(WALL_TOOL_STORAGE_KEY, JSON.stringify(this.wallToolSettingsSnapshot()));
    }

    loadWallToolSettingsFromBrowser() {
        const stored = localStorage.getItem(WALL_TOOL_STORAGE_KEY);
        if (!stored) return false;
        const payload = JSON.parse(stored);
        if (!payload || typeof payload !== "object") {
            throw new Error("stored wall tool settings must be an object");
        }
        const height = Number(payload.height);
        const texture = String(payload.texture || "");
        const thickness = payload.thickness === undefined
            ? DEFAULTS.wallThickness
            : normalizeEditorWallThickness(payload.thickness, "stored wall tool thickness");
        if (!Number.isFinite(height) || height <= 0) {
            throw new Error("stored wall tool settings require a positive height");
        }
        if (!texture) {
            throw new Error("stored wall tool settings require a texture path");
        }
        this.wallTool.height = height;
        this.wallTool.texture = texture;
        this.wallTool.thickness = thickness;
        if (this.tool === "wall") {
            this.inputs.wallHeight = height;
            this.inputs.wallTexture = texture;
            this.inputs.wallThickness = thickness;
            this.paintTextures.walls = texture;
        }
        this.emitChange();
        return true;
    }

    clearSelectionForTool() {
        const floors = getBuildingFloors(this.building);
        if (this.layerSelectionMode === "all" || this.selectedFloorIds.size !== 1) {
            this.selection = createSelection("building");
            this.syncInputsFromFloor(floors[0] || null);
            return;
        }
        const selectedFloorId = [...this.selectedFloorIds][0];
        const floor = findFloor(this.building, selectedFloorId);
        if (!floor) {
            this.selection = createSelection("building");
            this.syncInputsFromFloor(floors[0] || null);
            return;
        }
        this.selection = createSelection("level", { floorId: getFloorId(floor) });
        this.syncInputsFromFloor(floor);
    }

    paintTextureForMode(mode) {
        if (mode === "walls") return this.paintTextures.walls;
        if (mode === "roofs") return this.paintTextures.roofs;
        return this.paintTextures.floor;
    }

    setPaintTexture(mode, texture) {
        if (typeof texture !== "string" || texture.length === 0) {
            throw new Error("paint texture path must be a non-empty string");
        }
        if (mode === "walls") this.paintTextures.walls = texture;
        else if (mode === "roofs") this.paintTextures.roofs = texture;
        else this.paintTextures.floor = texture;
        this.emitChange();
    }

    setMountedObjectToolCategory(category) {
        const resolved = String(category || "").trim().toLowerCase();
        if (resolved !== "doors" && resolved !== "windows") {
            throw new Error(`unknown mounted object category: ${category}`);
        }
        const selectedObject = this.selectedMountedObject();
        if (selectedObject && String(selectedObject.category || "").trim().toLowerCase() === resolved) {
            this.copyMountedObjectToTool(selectedObject);
        }
        this.mountedObjectTool.category = resolved;
        this.tool = "mountObject";
        this.draft = null;
        this.clearSelectionForTool();
        this.saveMountedObjectToolSettingsToBrowser();
        this.emitChange();
    }

    copyMountedObjectToTool(object) {
        if (!object) throw new Error("cannot copy missing mounted object to tool");
        const category = String(object.category || "").trim().toLowerCase();
        if (category !== "doors" && category !== "windows") {
            throw new Error(`cannot copy mounted object category to tool: ${category || "missing"}`);
        }
        const width = Number(object.width);
        const height = Number(object.height);
        if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
            throw new Error("cannot copy door/window tool settings without positive width and height");
        }
        if (typeof object.texturePath !== "string" || object.texturePath.length === 0) {
            throw new Error("cannot copy door/window tool settings without a texture path");
        }
        this.mountedObjectTool.assets[category] = {
            ...object,
            category,
            texturePath: object.texturePath,
            width,
            height,
            baseWidth: width,
            baseHeight: height,
            anchorX: Number.isFinite(Number(object.placeableAnchorX ?? object.anchorX))
                ? Number(object.placeableAnchorX ?? object.anchorX)
                : 0.5,
            anchorY: Number.isFinite(Number(object.placeableAnchorY ?? object.anchorY))
                ? Number(object.placeableAnchorY ?? object.anchorY)
                : (category === "windows" ? 0.5 : 1)
        };
        this.mountedObjectTool.settings[category] = {
            size: height,
            aspectRatio: width / height,
            snapPointsPerSection: this.mountedObjectSnapPointsPerSection(category)
        };
    }

    setMountedObjectAsset(category, asset) {
        const resolved = String(category || "").trim().toLowerCase();
        if (resolved !== "doors" && resolved !== "windows") {
            throw new Error(`unknown mounted object category: ${category}`);
        }
        if (!asset || typeof asset.texturePath !== "string" || asset.texturePath.length === 0) {
            throw new Error("mounted object asset requires a texture path");
        }
        const width = Number(asset.width);
        const height = Number(asset.height);
        if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
            throw new Error("mounted object asset requires positive width and height");
        }
        this.mountedObjectTool.category = resolved;
        this.mountedObjectTool.assets[resolved] = { ...asset, category: resolved, baseWidth: width, baseHeight: height };
        this.mountedObjectTool.settings[resolved] = {
            size: height,
            aspectRatio: width / height,
            snapPointsPerSection: this.mountedObjectSnapPointsPerSection(resolved)
        };
        this.tool = "mountObject";
        this.draft = null;
        this.clearSelectionForTool();
        this.saveMountedObjectToolSettingsToBrowser();
        this.emitChange();
    }

    updateMountedObjectSize(value) {
        const selectedObjects = this.selectedMountedObjects();
        if (this.tool !== "mountObject" && selectedObjects.length > 0) {
            const size = Number(value);
            if (!Number.isFinite(size) || size <= 0) {
                throw new Error("door/window size must be a positive number");
            }
            selectedObjects.forEach((object) => {
                const currentHeight = Number(object.height);
                const currentWidth = Number(object.width);
                const aspectRatio = Number.isFinite(currentWidth) && currentWidth > 0 && Number.isFinite(currentHeight) && currentHeight > 0
                    ? currentWidth / currentHeight
                    : 1;
                object.height = size;
                object.width = size * aspectRatio;
            });
            this.emitChange();
            return;
        }
        const category = this.mountedObjectTool.category || "doors";
        const size = Number(value);
        if (!Number.isFinite(size) || size <= 0) {
            throw new Error("door/window size must be a positive number");
        }
        this.mountedObjectTool.settings[category] = {
            ...(this.mountedObjectTool.settings[category] || {}),
            size
        };
        this.saveMountedObjectToolSettingsToBrowser();
        this.emitChange();
    }

    updateMountedObjectAspectRatio(value) {
        const selectedObjects = this.selectedMountedObjects();
        if (this.tool !== "mountObject" && selectedObjects.length > 0) {
            const aspectRatio = Number(value);
            if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
                throw new Error("door/window aspect ratio must be a positive number");
            }
            selectedObjects.forEach((object) => {
                const height = Number(object.height);
                if (!Number.isFinite(height) || height <= 0) {
                    throw new Error("selected door/window height must be a positive number");
                }
                object.width = height * aspectRatio;
            });
            this.emitChange();
            return;
        }
        const category = this.mountedObjectTool.category || "doors";
        const aspectRatio = Number(value);
        if (!Number.isFinite(aspectRatio) || aspectRatio <= 0) {
            throw new Error("door/window aspect ratio must be a positive number");
        }
        this.mountedObjectTool.settings[category] = {
            ...(this.mountedObjectTool.settings[category] || {}),
            aspectRatio
        };
        this.saveMountedObjectToolSettingsToBrowser();
        this.emitChange();
    }

    mountedObjectSnapPointsPerSection(category = null) {
        const resolved = String(category || this.mountedObjectTool.category || "doors").trim().toLowerCase();
        const settings = this.mountedObjectTool.settings[resolved] || {};
        return normalizeWallSnapPointsPerSection(settings.snapPointsPerSection ?? 1, "door/window snap points per section");
    }

    updateMountedObjectSnapPointsPerSection(value) {
        const selectedObject = this.selectedMountedObject();
        const category = selectedObject
            ? String(selectedObject.category || "").trim().toLowerCase()
            : (this.mountedObjectTool.category || "doors");
        if (category !== "doors" && category !== "windows") {
            throw new Error(`door/window snap points require a door or window category: ${category || "missing"}`);
        }
        const snapPointsPerSection = normalizeWallSnapPointsPerSection(value, "door/window snap points per section");
        this.mountedObjectTool.settings[category] = {
            ...(this.mountedObjectTool.settings[category] || {}),
            snapPointsPerSection
        };
        this.inputs.mountedObjectSnapPointsPerSection = snapPointsPerSection;
        this.saveMountedObjectToolSettingsToBrowser();
        this.emitChange();
    }

    mountedObjectToolSettingsSnapshot() {
        return {
            category: this.mountedObjectTool.category,
            assets: {
                doors: this.mountedObjectTool.assets.doors || null,
                windows: this.mountedObjectTool.assets.windows || null
            },
            settings: {
                doors: this.mountedObjectTool.settings.doors || null,
                windows: this.mountedObjectTool.settings.windows || null
            }
        };
    }

    saveMountedObjectToolSettingsToBrowser() {
        localStorage.setItem(MOUNTED_OBJECT_TOOL_STORAGE_KEY, JSON.stringify(this.mountedObjectToolSettingsSnapshot()));
    }

    loadMountedObjectToolSettingsFromBrowser() {
        const stored = localStorage.getItem(MOUNTED_OBJECT_TOOL_STORAGE_KEY);
        if (!stored) return false;
        const payload = JSON.parse(stored);
        if (!payload || typeof payload !== "object") {
            throw new Error("stored door/window tool settings must be an object");
        }
        ["doors", "windows"].forEach((category) => {
            const asset = payload.assets && payload.assets[category];
            if (asset) {
                const width = Number(asset.width);
                const height = Number(asset.height);
                if (typeof asset.texturePath !== "string" || asset.texturePath.length === 0) {
                    throw new Error(`stored ${category} tool asset is missing a texture path`);
                }
                if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
                    throw new Error(`stored ${category} tool asset requires positive width and height`);
                }
                this.mountedObjectTool.assets[category] = {
                    ...asset,
                    category,
                    width,
                    height,
                    baseWidth: Number.isFinite(Number(asset.baseWidth)) ? Number(asset.baseWidth) : width,
                    baseHeight: Number.isFinite(Number(asset.baseHeight)) ? Number(asset.baseHeight) : height
                };
            }
            const settings = payload.settings && payload.settings[category];
            if (settings) {
                const size = Number(settings.size);
                const aspectRatio = Number(settings.aspectRatio);
                if (!Number.isFinite(size) || size <= 0 || !Number.isFinite(aspectRatio) || aspectRatio <= 0) {
                    throw new Error(`stored ${category} tool settings require positive size and aspect ratio`);
                }
                const snapPointsPerSection = settings.snapPointsPerSection === undefined
                    ? 1
                    : normalizeWallSnapPointsPerSection(settings.snapPointsPerSection, `stored ${category} snap points per section`);
                this.mountedObjectTool.settings[category] = { size, aspectRatio, snapPointsPerSection };
            }
        });
        const category = String(payload.category || "").trim().toLowerCase();
        if (category === "doors" || category === "windows") {
            this.mountedObjectTool.category = category;
        }
        this.inputs.mountedObjectSnapPointsPerSection = this.mountedObjectSnapPointsPerSection();
        this.emitChange();
        return true;
    }

    selectedMountedObjectAsset() {
        const selectedObject = this.selectedMountedObjects()[0] || null;
        if (selectedObject) {
            const width = Number(selectedObject.width);
            const height = Number(selectedObject.height);
            if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
                throw new Error("selected door/window requires positive width and height");
            }
            return {
                ...selectedObject,
                texturePath: selectedObject.texturePath,
                size: height,
                aspectRatio: width / height,
                snapPointsPerSection: this.mountedObjectSnapPointsPerSection(selectedObject.category)
            };
        }
        const category = this.mountedObjectTool.category || "doors";
        const asset = this.mountedObjectTool.assets[category] || null;
        if (!asset) return null;
        const settings = this.mountedObjectTool.settings[category] || {};
        const size = Number.isFinite(Number(settings.size)) && Number(settings.size) > 0
            ? Number(settings.size)
            : Number(asset.baseHeight || asset.height);
        const aspectRatio = Number.isFinite(Number(settings.aspectRatio)) && Number(settings.aspectRatio) > 0
            ? Number(settings.aspectRatio)
            : Number(asset.baseWidth || asset.width) / Number(asset.baseHeight || asset.height);
        return {
            ...asset,
            width: size * aspectRatio,
            height: size,
            size,
            aspectRatio,
            snapPointsPerSection: this.mountedObjectSnapPointsPerSection(category)
        };
    }

    updateStairToolWidth(value) {
        const width = normalizeStairToolWidth(value, "stair tool width");
        this.stairTool.width = width;
        this.inputs.stairWidth = width;
        this.saveStairToolSettingsToBrowser();
        this.emitChange();
    }

    updateStairToolDirection(value) {
        const direction = normalizeStairDirection(value, "stair tool direction");
        this.stairTool.direction = direction;
        this.inputs.stairDirection = direction;
        this.saveStairToolSettingsToBrowser();
        this.emitChange();
    }

    updateStairToolTexture(texture, part = "tread") {
        if (typeof texture !== "string" || texture.length === 0) {
            throw new Error("stair tool texture path must be a non-empty string");
        }
        const resolvedPart = part === "riser" ? "riser" : "tread";
        if (resolvedPart === "riser") {
            this.stairTool.riserTexture = texture;
            this.inputs.stairRiserTexture = texture;
        } else {
            this.stairTool.texture = texture;
            this.stairTool.treadTexture = texture;
            this.inputs.stairTexture = texture;
            this.inputs.stairTreadTexture = texture;
            this.paintTextures.floor = texture;
        }
        this.saveStairToolSettingsToBrowser();
        this.emitChange();
    }

    updateStairToolTreadTexture(texture) {
        this.updateStairToolTexture(texture, "tread");
    }

    updateStairToolRiserTexture(texture) {
        this.updateStairToolTexture(texture, "riser");
    }

    updateSelectedStairTexture(texture, part = "tread") {
        if (typeof texture !== "string" || texture.length === 0) {
            throw new Error("stair texture path must be a non-empty string");
        }
        const stairs = this.selectedStairs();
        if (!stairs.length) throw new Error("cannot update stair texture without a selected stair");
        const resolvedPart = part === "riser" ? "riser" : "tread";
        stairs.forEach((stair) => {
            if (resolvedPart === "riser") {
                stair.riserTexturePath = texture;
            } else {
                stair.texturePath = texture;
                stair.treadTexturePath = texture;
            }
        });
        if (resolvedPart === "riser") {
            this.inputs.stairRiserTexture = texture;
        } else {
            this.inputs.stairTexture = texture;
            this.inputs.stairTreadTexture = texture;
            this.paintTextures.floor = texture;
        }
        this.emitChange();
    }

    updateSelectedStairTreadTexture(texture) {
        this.updateSelectedStairTexture(texture, "tread");
    }

    updateSelectedStairRiserTexture(texture) {
        this.updateSelectedStairTexture(texture, "riser");
    }

    resizeStairRecordWidth(stair, width) {
        const resolvedWidth = normalizeStairToolWidth(width, "stair width");
        stair.width = resolvedWidth;
        if (Array.isArray(stair.treads) && stair.treads.length > 0) {
            stair.treads = stair.treads.map((tread, index) => {
                const normalized = normalizedStairTread(tread, `stair ${stair.id} tread ${index}`);
                const half = resolvedWidth * 0.5;
                const ux = Math.cos(normalized.angle);
                const uy = Math.sin(normalized.angle);
                return {
                    ...tread,
                    left: {
                        x: normalized.center.x - ux * half,
                        y: normalized.center.y - uy * half
                    },
                    right: {
                        x: normalized.center.x + ux * half,
                        y: normalized.center.y + uy * half
                    },
                    center: { ...normalized.center },
                    angle: normalized.angle
                };
            });
            const firstTread = stair.treads[0];
            const lastTread = stair.treads[stair.treads.length - 1];
            stair.startPoint = { ...firstTread.center };
            stair.endPoint = { ...lastTread.center };
        }
        if (stair.ladder === true && Array.isArray(stair.footprint) && stair.footprint.length === 4) {
            const points = stair.footprint.map((point, index) => {
                if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) {
                    throw new Error(`ladder stair ${stair.id} footprint point ${index} must be finite`);
                }
                return { x: Number(point.x), y: Number(point.y) };
            });
            const dx = points[1].x - points[0].x;
            const dy = points[1].y - points[0].y;
            const length = Math.hypot(dx, dy);
            if (!Number.isFinite(length) || length <= 0.000001) {
                throw new Error(`ladder stair ${stair.id} width edit requires a non-degenerate footprint edge`);
            }
            const ux = dx / length;
            const uy = dy / length;
            const resizeEdge = (a, b) => {
                const center = {
                    x: (Number(a.x) + Number(b.x)) * 0.5,
                    y: (Number(a.y) + Number(b.y)) * 0.5
                };
                const half = resolvedWidth * 0.5;
                return [
                    { x: center.x - ux * half, y: center.y - uy * half },
                    { x: center.x + ux * half, y: center.y + uy * half }
                ];
            };
            const [bottomLeft, bottomRight] = resizeEdge(points[0], points[1]);
            const [topLeft, topRight] = resizeEdge(points[3], points[2]);
            stair.footprint = [bottomLeft, bottomRight, topRight, topLeft];
        } else {
            stair.footprint = stairFootprintPoints(stair);
        }
        return stair;
    }

    updateSelectedStairWidth(value) {
        const width = normalizeStairToolWidth(value, "selected stair width");
        const stairs = this.selectedStairs();
        if (!stairs.length) throw new Error("cannot update stair width without a selected stair");
        const candidates = stairs.map((stair) => this.resizeStairRecordWidth(this.cloneStairForDrag(stair), width));
        if (!candidates.every((stair) => this.stairMoveIsLegal(stair))) return false;
        stairs.forEach((stair, index) => {
            Object.keys(stair).forEach((key) => delete stair[key]);
            Object.assign(stair, candidates[index]);
        });
        this.inputs.stairWidth = width;
        this.emitChange();
        return true;
    }

    updateSelectedStairStepCount(value) {
        const stepCount = normalizeStairStepCount(value, "selected stair step count");
        const stairs = this.selectedStairs();
        if (!stairs.length) throw new Error("cannot update stair step count without a selected stair");
        stairs.forEach((stair) => {
            stair.stepCount = stepCount;
            stair.riserDepth = normalizeStairRiserDepth(stair.riserDepth, stair.height, stepCount, "selected stair riser depth");
        });
        this.inputs.stairStepCount = stepCount;
        this.emitChange();
        return true;
    }

    updateSelectedStairRiserDepth(value) {
        const stairs = this.selectedStairs();
        if (!stairs.length) throw new Error("cannot update stair riser depth without a selected stair");
        const riserDepths = stairs.map((stair) => (
            normalizeStairRiserDepth(value, stair.height, stair.stepCount, "selected stair riser depth")
        ));
        stairs.forEach((stair, index) => {
            stair.riserDepth = riserDepths[index];
        });
        this.inputs.stairRiserDepth = riserDepths[0];
        this.emitChange();
        return true;
    }

    updateStairToolStepCount(value) {
        const raw = String(value ?? "").trim();
        if (raw === "") {
            this.stairTool.stepCount = null;
            this.inputs.stairStepCount = null;
            this.saveStairToolSettingsToBrowser();
            this.emitChange();
            return;
        }
        const stepCount = normalizeStairStepCount(raw, "stair tool step count");
        this.stairTool.stepCount = stepCount;
        this.inputs.stairStepCount = stepCount;
        this.saveStairToolSettingsToBrowser();
        this.emitChange();
    }

    updateStairToolRiserDepth(value) {
        const raw = String(value ?? "").trim();
        if (raw === "") {
            this.stairTool.riserDepth = null;
            this.inputs.stairRiserDepth = null;
            this.saveStairToolSettingsToBrowser();
            this.emitChange();
            return;
        }
        const selectedFloor = this.selectedFloor();
        const direction = this.viableStairDirectionForFloor(selectedFloor, this.stairTool.direction);
        const height = Math.abs(this.stairHeightDifferenceForFloor(selectedFloor, direction));
        const stepCount = this.stairTool.stepCount || this.defaultStairStepCountForFloor(selectedFloor, direction);
        const riserDepth = normalizeStairRiserDepth(raw, height, stepCount, "stair tool riser depth");
        this.stairTool.riserDepth = riserDepth;
        this.inputs.stairRiserDepth = riserDepth;
        this.saveStairToolSettingsToBrowser();
        this.emitChange();
    }

    stairTargetFloor(sourceFloor, direction = this.stairTool.direction) {
        if (!sourceFloor) throw new Error("stair placement requires a source floor");
        const sourceZ = getFloorElevation(sourceFloor);
        const floors = getBuildingFloors(this.building)
            .filter((floor) => floor !== sourceFloor)
            .map((floor) => ({ floor, z: getFloorElevation(floor) }))
            .filter((entry) => direction === "down" ? entry.z < sourceZ : entry.z > sourceZ)
            .sort((a, b) => direction === "down" ? b.z - a.z : a.z - b.z);
        if (!floors.length) {
            throw new Error(`stair ${direction} placement requires another floor ${direction === "down" ? "below" : "above"} the source floor`);
        }
        return floors[0].floor;
    }

    stairDirectionAvailability(sourceFloor = this.selectedFloor()) {
        if (!sourceFloor) return { up: false, down: false };
        const sourceZ = getFloorElevation(sourceFloor);
        const floors = getBuildingFloors(this.building).filter((floor) => floor !== sourceFloor);
        return {
            up: floors.some((floor) => getFloorElevation(floor) > sourceZ),
            down: floors.some((floor) => getFloorElevation(floor) < sourceZ)
        };
    }

    viableStairDirectionForFloor(sourceFloor = this.selectedFloor(), preferred = this.stairTool.direction) {
        const direction = normalizeStairDirection(preferred, "stair tool direction");
        const availability = this.stairDirectionAvailability(sourceFloor);
        if (availability[direction]) return direction;
        if (availability.up) return "up";
        if (availability.down) return "down";
        return direction;
    }

    syncStairToolDirectionWithFloor(sourceFloor = this.selectedFloor(), options = {}) {
        const direction = this.viableStairDirectionForFloor(sourceFloor, this.stairTool.direction);
        const changed = direction !== this.stairTool.direction;
        if (changed) {
            this.stairTool.direction = direction;
            this.inputs.stairDirection = direction;
            this.saveStairToolSettingsToBrowser();
            if (options.emit !== false) this.emitChange();
        }
        return {
            direction,
            changed,
            availability: this.stairDirectionAvailability(sourceFloor)
        };
    }

    stairHeightDifferenceForFloor(sourceFloor, direction = this.stairTool.direction) {
        const targetFloor = this.stairTargetFloor(sourceFloor, direction);
        return getFloorElevation(targetFloor) - getFloorElevation(sourceFloor);
    }

    defaultStairStepCountForFloor(sourceFloor, direction = this.stairTool.direction) {
        const heightDifference = Math.abs(this.stairHeightDifferenceForFloor(sourceFloor, direction));
        return Math.max(1, Math.round(heightDifference * 5));
    }

    defaultStairRiserDepthForFloor(sourceFloor, direction = this.stairTool.direction, stepCount = null) {
        const heightDifference = Math.abs(this.stairHeightDifferenceForFloor(sourceFloor, direction));
        return defaultStairRiserDepth(heightDifference, stepCount || this.defaultStairStepCountForFloor(sourceFloor, direction));
    }

    stairCreationSettingsForFloor(sourceFloor, requestedDirection = this.stairTool.direction) {
        const direction = normalizeStairDirection(requestedDirection, "stair tool direction");
        const heightDifference = this.stairHeightDifferenceForFloor(sourceFloor, direction);
        return {
            width: this.stairTool.width,
            direction,
            texturePath: this.stairTool.treadTexture || this.stairTool.texture,
            treadTexturePath: this.stairTool.treadTexture || this.stairTool.texture,
            riserTexturePath: this.stairTool.riserTexture || this.stairTool.treadTexture || this.stairTool.texture,
            height: Math.abs(heightDifference),
            stepCount: this.stairTool.stepCount || this.defaultStairStepCountForFloor(sourceFloor, direction),
            riserDepth: normalizeStairRiserDepth(
                this.stairTool.riserDepth,
                Math.abs(heightDifference),
                this.stairTool.stepCount || this.defaultStairStepCountForFloor(sourceFloor, direction),
                "stair tool riser depth"
            )
        };
    }

    stairToolSettingsSnapshot() {
        return {
            width: this.stairTool.width,
            direction: this.stairTool.direction,
            texture: this.stairTool.treadTexture || this.stairTool.texture,
            treadTexture: this.stairTool.treadTexture || this.stairTool.texture,
            riserTexture: this.stairTool.riserTexture || this.stairTool.treadTexture || this.stairTool.texture,
            stepCount: this.stairTool.stepCount,
            riserDepth: this.stairTool.riserDepth
        };
    }

    saveStairToolSettingsToBrowser() {
        const storage = browserLocalStorage();
        if (!storage) return false;
        storage.setItem(STAIR_TOOL_STORAGE_KEY, JSON.stringify(this.stairToolSettingsSnapshot()));
        return true;
    }

    loadStairToolSettingsFromBrowser() {
        const storage = browserLocalStorage();
        if (!storage) return false;
        const stored = storage.getItem(STAIR_TOOL_STORAGE_KEY);
        if (!stored) return false;
        const payload = JSON.parse(stored);
        if (!payload || typeof payload !== "object") {
            throw new Error("stored stair tool settings must be an object");
        }
        const width = normalizeStairToolWidth(payload.width ?? DEFAULTS.stairWidth, "stored stair width");
        const direction = normalizeStairDirection(payload.direction ?? DEFAULTS.stairDirection, "stored stair direction");
        const treadTexture = String(payload.treadTexture || payload.texture || DEFAULTS.floorTexture);
        const riserTexture = String(payload.riserTexture || payload.texture || treadTexture || DEFAULTS.floorTexture);
        if (!treadTexture) throw new Error("stored stair tool settings require a tread texture path");
        if (!riserTexture) throw new Error("stored stair tool settings require a riser texture path");
        const stepCount = payload.stepCount === null || payload.stepCount === undefined || payload.stepCount === ""
            ? null
            : normalizeStairStepCount(payload.stepCount, "stored stair step count");
        const riserDepth = payload.riserDepth === null || payload.riserDepth === undefined || payload.riserDepth === ""
            ? null
            : Number(payload.riserDepth);
        if (riserDepth !== null && (!Number.isFinite(riserDepth) || riserDepth < 0)) {
            throw new Error("stored stair riser depth must be zero or greater");
        }
        this.stairTool = { width, direction, texture: treadTexture, treadTexture, riserTexture, stepCount, riserDepth };
        this.inputs.stairWidth = width;
        this.inputs.stairDirection = direction;
        this.inputs.stairTexture = treadTexture;
        this.inputs.stairTreadTexture = treadTexture;
        this.inputs.stairRiserTexture = riserTexture;
        this.inputs.stairStepCount = stepCount;
        this.inputs.stairRiserDepth = riserDepth;
        if (this.tool === "stair") {
            this.syncStairToolDirectionWithFloor(this.selectedFloor(), { emit: false });
            this.paintTextures.floor = treadTexture;
        }
        this.emitChange();
        return true;
    }

    addStairToFloor(floorId, stairOptions = {}) {
        const floor = findFloor(this.building, floorId);
        if (!floor) throw new Error(`cannot add stair to missing floor: ${floorId}`);
        const requestedDirection = stairOptions.direction || this.stairTool.direction;
        const settings = this.stairCreationSettingsForFloor(floor, requestedDirection);
        const targetFloor = this.stairTargetFloor(floor, settings.direction);
        const owningFloor = settings.direction === "down" ? targetFloor : floor;
        const stair = createStraightStair({
            floorId: getFloorId(owningFloor),
            bottomZ: getFloorElevation(floor),
            height: settings.height,
            width: settings.width,
            direction: settings.direction,
            texturePath: settings.texturePath,
            treadTexturePath: settings.treadTexturePath,
            riserTexturePath: settings.riserTexturePath,
            stepCount: settings.stepCount,
            riserDepth: settings.riserDepth,
            ...stairOptions
        });
        stair.floorId = getFloorId(owningFloor);
        if (!Array.isArray(owningFloor.stairs)) owningFloor.stairs = [];
        owningFloor.stairs.push(stair);
        this.selection = createSelection("floor", { floorId: getFloorId(owningFloor) });
        this.selectedFloorIds = new Set([getFloorId(owningFloor)]);
        this.layerSelectionMode = "floor";
        this.emitChange();
        return stair;
    }

    setRenderError(message) {
        this.renderError = message;
    }

    selectedFloor() {
        return findFloor(this.building, this.selection.floorId) || null;
    }

    selectedWall() {
        const wallIds = this.selectedWallIds();
        return wallIds.length === 1 ? findWall(this.building, wallIds[0]) : null;
    }

    selectedMountedObject() {
        const objectIds = this.selectedMountedObjectIds();
        return objectIds.length === 1 ? findMountedObject(this.building, objectIds[0]) : null;
    }

    selectedRoofFloorIds() {
        const kind = this.selection && this.selection.kind;
        if (kind !== "roof" && kind !== "roofVertex" && kind !== "roofPeak" && kind !== "roofShedDirection") return [];
        if (kind !== "roof") return this.selection.floorId ? [String(this.selection.floorId)] : [];
        if (Array.isArray(this.selection.roofFloorIds) && this.selection.roofFloorIds.length > 0) {
            return this.selection.roofFloorIds.map((id) => String(id));
        }
        return this.selection.floorId ? [String(this.selection.floorId)] : [];
    }

    selectedRoofEntries() {
        const selection = this.selection || {};
        if (selection.roofId) {
            const floor = findFloor(this.building, selection.floorId);
            if (!floor) throw new Error(`selected roof is missing its floor: ${selection.floorId}`);
            const roof = findFloorRoof(floor, selection.roofId);
            if (!roof) throw new Error(`selected roof is missing from floor: ${selection.floorId}/${selection.roofId}`);
            return [{ floor, roof }];
        }
        return this.selectedRoofFloorIds().map((floorId) => {
            const floor = findFloor(this.building, floorId);
            if (!floor) throw new Error(`selected roof is missing its floor: ${floorId}`);
            const roof = getFloorRoof(floor);
            if (!roof) throw new Error(`selected roof is missing from floor: ${floorId}`);
            return { floor, roof };
        });
    }

    editableRoofEntries(label = "selected roof") {
        const kind = this.selection && this.selection.kind;
        if (kind === "roof" || kind === "roofVertex" || kind === "roofPeak" || kind === "roofShedDirection") {
            const entries = this.selectedRoofEntries();
            if (!entries.length) throw new Error(`${label} is missing`);
            return entries;
        }
        const floor = this.selectedFloor();
        if (!floor) throw new Error(`${label} requires a selected floor`);
        const roof = getFloorRoof(floor);
        if (!roof) throw new Error(`${label} is missing`);
        return [{ floor, roof }];
    }

    selectedRoofFloors() {
        return this.selectedRoofEntries().map((entry) => entry.floor);
    }

    selectedRoofVertex() {
        const selection = this.selection || {};
        if (selection.kind !== "roofVertex") return null;
        const floor = findFloor(this.building, selection.floorId);
        if (!floor) throw new Error(`selected roof vertex is missing its floor: ${selection.floorId}`);
        const roof = findFloorRoof(floor, selection.roofId);
        if (!roof) throw new Error(`selected roof vertex is missing its roof: ${selection.floorId}`);
        const ring = getRoofContactPolygon(roof);
        const vertexIndex = Math.floor(Number(selection.vertexIndex));
        if (!Number.isInteger(vertexIndex) || vertexIndex < 0 || vertexIndex >= ring.length) {
            throw new Error(`selected roof vertex index is invalid: ${selection.vertexIndex}`);
        }
        return { floor, roof, ring, vertexIndex, point: ring[vertexIndex] };
    }

    isRoofSelected(floorId, roofId = null) {
        const selection = this.selection || {};
        if (roofId !== null && roofId !== undefined && selection.roofId) {
            return String(selection.floorId) === String(floorId) && String(selection.roofId) === String(roofId);
        }
        return this.selectedRoofFloorIds().some((id) => id === String(floorId));
    }

    selectedMountedObjectIds() {
        const kind = this.selection && this.selection.kind;
        if (kind !== "mountedObject") return [];
        if (Array.isArray(this.selection.mountedObjectIds) && this.selection.mountedObjectIds.length > 0) {
            return this.selection.mountedObjectIds;
        }
        return this.selection.mountedObjectId !== null && this.selection.mountedObjectId !== undefined ? [this.selection.mountedObjectId] : [];
    }

    selectedMountedObjects() {
        return this.selectedMountedObjectIds().map((objectId) => {
            const object = findMountedObject(this.building, objectId);
            if (!object) throw new Error(`selected mounted object is missing from building: ${objectId}`);
            return object;
        });
    }

    selectedWallIds() {
        const kind = this.selection && this.selection.kind;
        if (kind !== "wall" && kind !== "wallEndpoint") return [];
        if (Array.isArray(this.selection.wallIds) && this.selection.wallIds.length > 0) {
            return this.selection.wallIds;
        }
        return this.selection.wallId !== null && this.selection.wallId !== undefined ? [this.selection.wallId] : [];
    }

    selectedWalls() {
        return this.selectedWallIds().map((wallId) => {
            const wall = findWall(this.building, wallId);
            if (!wall) throw new Error(`selected wall is missing from building: ${wallId}`);
            return wall;
        });
    }

    selectedWallsCanToggleVertexInset() {
        const walls = this.selectedWalls();
        return walls.length > 0 && walls.every((wall) => wallHasFloorVertexEndpoint(wall));
    }

    isWallSelected(wall) {
        if (!wall) return false;
        const ids = new Set(this.selectedWallIds().map((id) => String(id)));
        return ids.has(String(wall.id));
    }

    syncInputsFromFloor(floor) {
        if (!floor) return;
        const roof = getFloorRoof(floor);
        this.inputs.floorElevation = getFloorElevation(floor);
        this.polygonToolElevation = getFloorElevation(floor);
        this.inputs.floorHeight = floor.floorHeight;
        this.inputs.floorTexture = floor.floorTexturePath;
        if (roof) {
            this.inputs.roofTexture = roof.texturePath;
            this.inputs.roofMode = roof.mode || DEFAULTS.roofMode;
            this.inputs.roofOverhang = roof.overhang;
            this.inputs.roofPeakHeight = roof.peakHeight;
            this.inputs.roofDomeLevels = getRoofDomeLevels(roof);
        }
        this.inputs.wallHeight = floor.defaultWallHeight;
        this.inputs.wallTexture = floor.defaultWallTexturePath;
        this.inputs.wallThickness = Number.isFinite(Number(this.building.defaults && this.building.defaults.wallThickness))
            ? Number(this.building.defaults.wallThickness)
            : DEFAULTS.wallThickness;
    }

    buildingCenter() {
        const points = [];
        getBuildingFloors(this.building).forEach((floor) => {
            if (Array.isArray(floor.outerPolygon)) {
                floor.outerPolygon.forEach((point) => {
                    if (Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y))) {
                        points.push(point);
                    }
                });
            }
        });
        if (!points.length) return { x: 0, y: 0 };
        const bounds = points.reduce((acc, point) => ({
            minX: Math.min(acc.minX, Number(point.x)),
            maxX: Math.max(acc.maxX, Number(point.x)),
            minY: Math.min(acc.minY, Number(point.y)),
            maxY: Math.max(acc.maxY, Number(point.y))
        }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
        return {
            x: (bounds.minX + bounds.maxX) * 0.5,
            y: (bounds.minY + bounds.maxY) * 0.5
        };
    }

    updateCameraRotationCenter() {
        this.camera.rotationCenter = this.buildingCenter();
        return this.camera.rotationCenter;
    }

    selectFloor(floorId, options = {}) {
        const floor = findFloor(this.building, floorId);
        if (!floor) {
            throw new Error(`cannot select missing floor: ${floorId}`);
        }
        const selectedFloorId = getFloorId(floor);
        if (!options.preserveView) {
            this.selectedFloorIds = new Set([selectedFloorId]);
            this.layerSelectionMode = "floor";
        }
        this.selection = createSelection("floor", { floorId: selectedFloorId });
        this.syncInputsFromFloor(floor);
        if (this.tool === "stair") this.syncStairToolDirectionWithFloor(floor, { emit: false });
        this.emitChange();
    }

    selectAllFloors() {
        this.selectBuilding();
    }

    selectBuilding() {
        const floors = getBuildingFloors(this.building);
        this.selectedFloorIds = new Set(floors.map((floor) => getFloorId(floor)));
        this.layerSelectionMode = "all";
        this.selection = createSelection("building");
        this.syncInputsFromFloor(floors[0] || null);
        this.emitChange();
    }

    selectFloorLayer(floorId) {
        this.selectFloor(floorId);
    }

    renameFloor(floorId, name) {
        const floor = findFloor(this.building, floorId);
        if (!floor) throw new Error(`cannot rename missing floor: ${floorId}`);
        const nextName = String(name || "").trim();
        if (!nextName) throw new Error("floor name must not be empty");
        floor.name = nextName;
        this.emitChange();
    }

    moveFloorInLayerPanel(floorId, targetFloorId, position = "before") {
        const floors = [...getBuildingFloors(this.building)].sort((a, b) => getFloorElevation(a) - getFloorElevation(b));
        if (!Array.isArray(this.building.floorFragments)) {
            throw new Error("cannot reorder floors without a floor fragment list");
        }
        const movingIndex = floors.findIndex((floor) => getFloorId(floor) === String(floorId || ""));
        if (movingIndex < 0) throw new Error(`cannot reorder missing floor: ${floorId}`);
        const targetIndex = floors.findIndex((floor) => getFloorId(floor) === String(targetFloorId || ""));
        if (targetIndex < 0) throw new Error(`cannot reorder before missing floor: ${targetFloorId}`);
        const baseElevation = floors.length > 0 ? getFloorElevation(floors[0]) : 0;
        const [moving] = floors.splice(movingIndex, 1);
        const targetIndexAfterRemoval = floors.findIndex((floor) => getFloorId(floor) === String(targetFloorId || ""));
        const insertIndex = position === "after" ? targetIndexAfterRemoval + 1 : targetIndexAfterRemoval;
        floors.splice(insertIndex, 0, moving);
        let elevation = baseElevation;
        floors.forEach((floor) => {
            setFloorElevation(floor, elevation);
            elevation += Number(floor.floorHeight);
        });
        this.building.floorFragments = floors;
        floors.forEach((floor) => refreshWallSectionEndpoints(this.building, floor));
        this.emitChange();
    }

    selectLevel(floorId, options = {}) {
        const floor = findFloor(this.building, floorId);
        if (!floor) {
            throw new Error(`cannot select missing floor layer: ${floorId}`);
        }
        const selectedFloorId = getFloorId(floor);
        if (!options.preserveView) {
            this.selectedFloorIds = new Set([selectedFloorId]);
            this.layerSelectionMode = "floor";
        }
        this.selection = createSelection("level", { floorId: selectedFloorId });
        this.syncInputsFromFloor(floor);
        this.emitChange();
    }

    resolveRoofSelection(floorIds, label = "roof selection") {
        const uniqueIds = [];
        (Array.isArray(floorIds) ? floorIds : []).forEach((floorId) => {
            if (!uniqueIds.some((id) => String(id) === String(floorId))) uniqueIds.push(String(floorId));
        });
        if (!uniqueIds.length) return { floorIds: [], floors: [], roofs: [] };
        const floors = uniqueIds.map((floorId) => {
            const floor = findFloor(this.building, floorId);
            if (!floor) throw new Error(`${label} references missing floor: ${floorId}`);
            const roof = getFloorRoof(floor);
            if (!roof) throw new Error(`${label} references missing roof for level: ${floorId}`);
            return floor;
        });
        return {
            floorIds: floors.map((floor) => getFloorId(floor)),
            floors,
            roofs: floors.map((floor) => getFloorRoof(floor))
        };
    }

    applyRoofSelection(floorIds, options = {}) {
        const resolved = this.resolveRoofSelection(floorIds, "roof selection");
        if (!resolved.floorIds.length) {
            this.selectBuilding();
            return false;
        }
        const roofId = options.roofId !== undefined && options.roofId !== null ? String(options.roofId) : "";
        if (roofId && resolved.floorIds.length !== 1) {
            throw new Error("specific roof selection can only target one floor");
        }
        if (roofId && !findFloorRoof(resolved.floors[0], roofId)) {
            throw new Error(`roof selection references missing roof: ${resolved.floorIds[0]}/${roofId}`);
        }
        if (!options.preserveView) {
            this.selectedFloorIds = new Set(resolved.floorIds);
            this.layerSelectionMode = "floor";
        }
        this.selection = createSelection("roof", {
            floorId: resolved.floorIds[0],
            roofFloorIds: resolved.floorIds,
            ...(roofId ? { roofId } : {})
        });
        this.syncInputsFromFloor(resolved.floors[0]);
        this.emitChange();
        return true;
    }

    selectRoof(floorId, options = {}) {
        return this.applyRoofSelection([floorId], options);
    }

    selectRoofs(floorIds, options = {}) {
        return this.applyRoofSelection(floorIds, options);
    }

    addRoofToSelection(floorId, options = {}) {
        const floor = findFloor(this.building, floorId);
        if (!floor) throw new Error(`cannot add roof for missing level: ${floorId}`);
        if (!getFloorRoof(floor)) throw new Error(`cannot add missing roof for level: ${floorId}`);
        const nextFloorIds = [...this.selectedRoofFloorIds()];
        const selectedFloorId = getFloorId(floor);
        if (!nextFloorIds.some((id) => id === selectedFloorId)) nextFloorIds.push(selectedFloorId);
        return this.applyRoofSelection(nextFloorIds, options);
    }

    removeRoofFromSelection(floorId, options = {}) {
        const floor = findFloor(this.building, floorId);
        if (!floor) throw new Error(`cannot remove roof for missing level: ${floorId}`);
        if (!getFloorRoof(floor)) throw new Error(`cannot remove missing roof for level: ${floorId}`);
        const removeId = getFloorId(floor);
        const previousFloorIds = this.selectedRoofFloorIds();
        const nextFloorIds = previousFloorIds.filter((id) => id !== removeId);
        if (nextFloorIds.length === previousFloorIds.length) return false;
        if (!nextFloorIds.length) {
            this.selectLevel(removeId, options);
            return true;
        }
        return this.applyRoofSelection(nextFloorIds, options);
    }

    defaultRoofContactPolygon(floor) {
        const source = Array.isArray(floor && floor.outerPolygon) ? floor.outerPolygon : [];
        if (source.length < 3) throw new Error(`cannot create roof contact polygon without a valid floor outline: ${getFloorId(floor)}`);
        return source.map((point) => ({
            ...point,
            ...(
                this.roofVertexSnapPoint(floor, point, 1) ||
                { x: Number(point.x), y: Number(point.y) }
            )
        }));
    }

    defaultRoofPeakPoint(floor) {
        return defaultRoofPeakPointForFloor(floor);
    }

    selectRoofPeak(floorId, options = {}) {
        const floor = findFloor(this.building, floorId);
        if (!floor) throw new Error(`cannot select roof peak for missing level: ${floorId}`);
        const roofId = options.roofId || (this.selection && String(this.selection.floorId) === String(floorId) ? this.selection.roofId : "");
        const roof = findFloorRoof(floor, roofId);
        if (!roof) throw new Error(`cannot select roof peak without a roof: ${floorId}`);
        getRoofPeakPoint(roof);
        const selectedFloorId = getFloorId(floor);
        if (!options.preserveView) {
            this.selectedFloorIds = new Set([selectedFloorId]);
            this.layerSelectionMode = "floor";
        }
        this.selection = createSelection("roofPeak", {
            floorId: selectedFloorId,
            ...(roofId ? { roofId: String(roofId) } : {})
        });
        this.syncInputsFromFloor(floor);
        this.emitChange();
    }

    roofShedDirectionPoint(floor) {
        if (!floor) throw new Error("shed roof direction handle requires a floor");
        const center = this.roofShedBaseCenter(floor);
        const direction = getRoofShedDirection(floor);
        return {
            x: Number(center.x) + Number(direction.x) * ROOF_SHED_DIRECTION_HANDLE_LENGTH,
            y: Number(center.y) + Number(direction.y) * ROOF_SHED_DIRECTION_HANDLE_LENGTH
        };
    }

    roofShedBasePolygon(floor) {
        const roof = getFloorRoof(floor);
        if (!roof) throw new Error("shed roof base polygon requires a roof");
        const ring = getRoofContactPolygon(floor);
        if (!Array.isArray(ring) || ring.length < 3) {
            throw new Error(`shed roof ${getFloorId(floor)} requires a valid contact polygon`);
        }
        return ring.map((point) => ({ x: Number(point.x), y: Number(point.y) }));
    }

    roofShedProjectionRange(floor) {
        const ring = this.roofShedBasePolygon(floor);
        const direction = getRoofShedDirection(floor);
        let min = Infinity;
        let max = -Infinity;
        ring.forEach((point) => {
            const value = Number(point.x) * Number(direction.x) + Number(point.y) * Number(direction.y);
            min = Math.min(min, value);
            max = Math.max(max, value);
        });
        if (!Number.isFinite(min) || !Number.isFinite(max) || max - min <= 0.000001) {
            throw new Error(`shed roof ${getFloorId(floor)} direction has no run across the roof polygon`);
        }
        return { min, max, direction };
    }

    roofShedWallPlane(floor, range = null) {
        const roof = getFloorRoof(floor);
        if (!roof) throw new Error("roof slope wall clipping requires a roof");
        const mode = roofModeValue(roof);
        if (mode !== "shed" && mode !== "gabled") {
            throw new Error(`roof slope wall clipping requires a shed or gabled roof, got ${mode}`);
        }
        const resolvedRange = range || this.roofShedProjectionRange(floor);
        return {
            kind: "shedPlane",
            mode,
            direction: {
                x: Number(resolvedRange.direction.x),
                y: Number(resolvedRange.direction.y)
            },
            minProjection: Number(resolvedRange.min),
            maxProjection: Number(resolvedRange.max),
            baseZ: roofSnapPlaneElevation(floor) + normalizeRoofElevationOffset(roof.elevationOffset, "shed roof elevation offset") + ROOF_RENDER_Z_LIFT - SHED_WALL_ROOF_GAP,
            peakHeight: Number(roof.peakHeight),
            clearance: SHED_WALL_ROOF_GAP
        };
    }

    roofShedTopZAt(floor, point, range = null) {
        const plane = this.roofShedWallPlane(floor, range);
        const projection = Number(point.x) * Number(plane.direction.x) + Number(point.y) * Number(plane.direction.y);
        const t = (projection - plane.minProjection) / (plane.maxProjection - plane.minProjection);
        if (plane.mode === "gabled") {
            return plane.baseZ + Number(plane.peakHeight) * (1 - Math.abs(2 * t - 1));
        }
        return plane.baseZ + Number(plane.peakHeight) * t;
    }

    roofRenderBaseElevation(floor) {
        const roof = getFloorRoof(floor);
        if (!roof) throw new Error(`roof base elevation requires a roof on floor ${getFloorId(floor)}`);
        return roofSnapPlaneElevation(floor) +
            normalizeRoofElevationOffset(roof.elevationOffset, "roof base elevation offset") +
            ROOF_RENDER_Z_LIFT;
    }

    peakRoofRenderedEaveRing(floor) {
        const roof = getFloorRoof(floor);
        if (!roof) throw new Error(`peak roof edge snapping requires a roof on floor ${getFloorId(floor)}`);
        if (roofModeValue(roof) !== "peak") {
            throw new Error(`roof ${roof.id || "(missing id)"} rendered edge snapping requires peak mode`);
        }
        const contactRing = getRoofContactPolygon(roof);
        if (!Array.isArray(contactRing) || contactRing.length < 3) {
            throw new Error(`roof ${roof.id || "(missing id)"} rendered edge snapping requires a valid contact polygon`);
        }
        const overhang = Number(roof.overhang);
        const baseZ = this.roofRenderBaseElevation(floor);
        const peakHeight = Number(roof.peakHeight);
        const peak = getRoofPeakPoint(roof);
        const eaveRing = Math.abs(overhang) > ROOF_SUPPORT_POINT_EPSILON
            ? offsetRing(contactRing, overhang)
            : contactRing.map((point) => ({ x: Number(point.x), y: Number(point.y) }));
        if (!Array.isArray(eaveRing) || eaveRing.length !== contactRing.length) {
            throw new Error(`roof ${roof.id || "(missing id)"} rendered edge snapping requires a valid eave ring`);
        }
        return eaveRing.map((point, index) => {
            const contactPoint = contactRing[index];
            const run = Math.hypot(Number(contactPoint.x) - Number(peak.x), Number(contactPoint.y) - Number(peak.y));
            if (run <= ROOF_SUPPORT_POINT_EPSILON) {
                throw new Error(`roof ${roof.id || "(missing id)"} contact vertex ${index} coincides with its peak`);
            }
            const slopeLength = Math.hypot(run, peakHeight);
            if (slopeLength <= ROOF_SUPPORT_POINT_EPSILON) {
                throw new Error(`roof ${roof.id || "(missing id)"} contact vertex ${index} has no peak-to-eave run`);
            }
            return {
                x: Number(point.x),
                y: Number(point.y),
                z: baseZ - peakHeight * (overhang / slopeLength)
            };
        });
    }

    roofPeakEaveEdgePointAtZ(sourceFloor, sourceRoof, edgeIndex, targetZ, options = {}) {
        const roofView = floorRoofView(sourceFloor, sourceRoof);
        const eaveRing = this.peakRoofRenderedEaveRing(roofView);
        const index = Math.floor(Number(edgeIndex));
        if (!Number.isInteger(index) || index < 0 || index >= eaveRing.length) {
            throw new Error(`roof ${sourceRoof && sourceRoof.id || "(missing id)"} edge attachment references missing peak-eave edge ${edgeIndex}`);
        }
        const peak = getRoofPeakPoint(sourceRoof);
        const peakPoint = {
            x: Number(peak.x),
            y: Number(peak.y),
            z: this.roofRenderBaseElevation(roofView) + Number(sourceRoof.peakHeight)
        };
        const eave = eaveRing[index];
        const dz = peakPoint.z - Number(eave.z);
        if (Math.abs(dz) <= ROOF_SUPPORT_POINT_EPSILON) {
            throw new Error(`roof ${sourceRoof && sourceRoof.id || "(missing id)"} edge attachment cannot use a horizontal edge`);
        }
        const t = (Number(targetZ) - Number(eave.z)) / dz;
        if (options.requireSegment === true && (t < -ROOF_SUPPORT_POINT_EPSILON || t > 1 + ROOF_SUPPORT_POINT_EPSILON)) {
            return null;
        }
        return {
            x: Number(eave.x) + (peakPoint.x - Number(eave.x)) * t,
            y: Number(eave.y) + (peakPoint.y - Number(eave.y)) * t
        };
    }

    resolveRoofEdgeAttachmentPoint(targetFloor, targetRoof, attachment) {
        if (!attachment || attachment.type !== "renderedRoofEdge") {
            throw new Error("roof contact vertex attachment must reference a rendered roof edge");
        }
        const sourceFloor = findFloor(this.building, attachment.floorId);
        if (!sourceFloor) throw new Error(`roof contact vertex attachment references missing floor: ${attachment.floorId}`);
        const sourceRoof = findFloorRoof(sourceFloor, attachment.roofId);
        if (!sourceRoof) throw new Error(`roof contact vertex attachment references missing roof: ${attachment.floorId}/${attachment.roofId}`);
        if (attachment.edgeKind !== "peakEave") {
            throw new Error(`roof contact vertex attachment references unsupported edge kind: ${attachment.edgeKind}`);
        }
        if (roofModeValue(sourceRoof) !== "peak") {
            throw new Error(`roof contact vertex attachment source roof must be peak mode: ${attachment.roofId}`);
        }
        const targetZ = this.roofRenderBaseElevation(floorRoofView(targetFloor, targetRoof));
        return this.roofPeakEaveEdgePointAtZ(sourceFloor, sourceRoof, attachment.edgeIndex, targetZ);
    }

    roofRenderedEdgeSnapCandidates(targetFloor, targetRoof) {
        const targetRoofId = targetRoof && targetRoof.id ? String(targetRoof.id) : "";
        const targetFloorId = getFloorId(targetFloor);
        const targetZ = this.roofRenderBaseElevation(floorRoofView(targetFloor, targetRoof));
        const candidates = [];
        getBuildingFloors(this.building).forEach((sourceFloor) => {
            const sourceFloorId = getFloorId(sourceFloor);
            getFloorRoofs(sourceFloor).forEach((sourceRoof) => {
                const sourceRoofId = sourceRoof && sourceRoof.id ? String(sourceRoof.id) : "";
                if (sourceFloorId === targetFloorId && sourceRoofId === targetRoofId) return;
                if (roofModeValue(sourceRoof) !== "peak") return;
                if (Number(sourceRoof.peakHeight) <= ROOF_SUPPORT_POINT_EPSILON) return;
                const roofView = floorRoofView(sourceFloor, sourceRoof);
                const eaveRing = this.peakRoofRenderedEaveRing(roofView);
                eaveRing.forEach((_eave, edgeIndex) => {
                    const point = this.roofPeakEaveEdgePointAtZ(sourceFloor, sourceRoof, edgeIndex, targetZ, { requireSegment: true });
                    if (!point) return;
                    candidates.push({
                        point,
                        kind: "renderedRoofEdge",
                        importance: ROOF_SNAP_IMPORTANCE.renderedRoofEdge,
                        roofEdgeAttachment: {
                            type: "renderedRoofEdge",
                            floorId: sourceFloorId,
                            roofId: sourceRoofId,
                            edgeKind: "peakEave",
                            edgeIndex
                        }
                    });
                });
            });
        });
        return candidates;
    }

    roofVertexMatchesWallEndpoint(floor, vertex, endpoint) {
        if (isFloorVertexEndpoint(endpoint) && vertex && vertex.id !== undefined && vertex.id !== null) {
            return String(endpoint.fragmentId) === getFloorId(floor) &&
                String(endpoint.vertexId) === String(vertex.id);
        }
        return false;
    }

    roofIsAttachedToWall(floor, roof, wall) {
        const ring = getRoofContactPolygon(roof);
        if (!Array.isArray(ring) || ring.length < 3) {
            throw new Error(`roof ${roof && roof.id || "(missing id)"} wall attachment requires a valid contact polygon`);
        }
        const points = wallPoints(this.building, wall);
        if (!Array.isArray(points) || points.length !== 2) {
            throw new Error(`wall ${wall && wall.id} roof attachment requires two endpoints`);
        }
        const a = points[0];
        const b = points[1];
        const startEndpoint = wall && wall.startPoint;
        const endEndpoint = wall && wall.endPoint;
        return ring.some((point, index) => {
            const next = ring[(index + 1) % ring.length];
            const matchesEndpointIds = (
                this.roofVertexMatchesWallEndpoint(floor, point, startEndpoint) &&
                this.roofVertexMatchesWallEndpoint(floor, next, endEndpoint)
            ) || (
                this.roofVertexMatchesWallEndpoint(floor, point, endEndpoint) &&
                this.roofVertexMatchesWallEndpoint(floor, next, startEndpoint)
            );
            return matchesEndpointIds ||
                (sameXY(point, a, ROOF_SUPPORT_POINT_EPSILON) && sameXY(next, b, ROOF_SUPPORT_POINT_EPSILON)) ||
                (sameXY(point, b, ROOF_SUPPORT_POINT_EPSILON) && sameXY(next, a, ROOF_SUPPORT_POINT_EPSILON));
        });
    }

    roofIntersectsWallFootprint(roof, wall) {
        const ring = getRoofContactPolygon(roof);
        if (!Array.isArray(ring) || ring.length < 3) {
            throw new Error(`roof ${roof && roof.id || "(missing id)"} wall coverage requires a valid contact polygon`);
        }
        const points = wallPoints(this.building, wall);
        if (!Array.isArray(points) || points.length !== 2) {
            throw new Error(`wall ${wall && wall.id} roof coverage requires two endpoints`);
        }
        const resolvedProfile = getWallResolvedGeometry(wall).profile;
        const wallFootprint = [
            resolvedProfile.aLeft,
            resolvedProfile.bLeft,
            resolvedProfile.bRight,
            resolvedProfile.aRight
        ];
        return polygonsIntersectOrTouch2d(ring, wallFootprint);
    }

    roofIntersectsColumnFootprint(roof, column) {
        const contactRing = getRoofContactPolygon(roof);
        if (!Array.isArray(contactRing) || contactRing.length < 3) {
            throw new Error(`roof ${roof && roof.id || "(missing id)"} column coverage requires a valid contact polygon`);
        }
        const overhang = Number(roof && roof.overhang);
        if (!Number.isFinite(overhang)) throw new Error(`roof ${roof && roof.id || "(missing id)"} column coverage requires finite overhang`);
        const ring = Math.abs(overhang) > ROOF_SUPPORT_POINT_EPSILON ? offsetRing(contactRing, overhang) : contactRing;
        if (!Array.isArray(ring) || ring.length !== contactRing.length) {
            throw new Error(`roof ${roof && roof.id || "(missing id)"} column coverage requires a valid overhang polygon`);
        }
        const footprint = columnVertices(column);
        if (!Array.isArray(footprint) || footprint.length < 3) {
            throw new Error(`column ${column && column.id} roof coverage requires at least three footprint vertices`);
        }
        return polygonsIntersectOrTouch2d(ring, footprint);
    }

    roofShouldProfileWall(floor, roof, wall) {
        if (this.roofIsAttachedToWall(floor, roof, wall)) return true;
        return roofModeValue(roof) === "gabled" && this.roofIntersectsWallFootprint(roof, wall);
    }

    shedWallTopProfileForWall(floor, wall, range = null) {
        const points = wallPoints(this.building, wall);
        if (!Array.isArray(points) || points.length !== 2) return null;
        const profile = wallFootprintCornersFromCenterline(points, Number(wall.thickness), `wall ${wall.id} shed top profile`);
        const bottomZ = getFloorElevation(floor);
        const priorGeneratedHeight = wall.topProfile && wall.topProfile.generatedBy
            ? Number(wall.topProfile.generatedBy.originalHeight)
            : NaN;
        const zAt = (point) => Math.max(0, this.roofShedTopZAt(floor, point, range) - bottomZ);
        const plane = this.roofShedWallPlane(floor, range);
        const stationTValues = [0, 1];
        if (plane.mode === "gabled") {
            const ridgeProjection = (Number(plane.minProjection) + Number(plane.maxProjection)) * 0.5;
            const addRidgeStationForSide = (start, end) => {
                const startProjection = Number(start.x) * Number(plane.direction.x) + Number(start.y) * Number(plane.direction.y);
                const endProjection = Number(end.x) * Number(plane.direction.x) + Number(end.y) * Number(plane.direction.y);
                const denominator = endProjection - startProjection;
                if (Math.abs(denominator) <= ROOF_SUPPORT_POINT_EPSILON) return;
                const t = (ridgeProjection - startProjection) / denominator;
                if (t > ROOF_SUPPORT_POINT_EPSILON && t < 1 - ROOF_SUPPORT_POINT_EPSILON) stationTValues.push(t);
            };
            [
                [profile[0], profile[1]],
                [profile[3], profile[2]]
            ].forEach(([start, end]) => addRidgeStationForSide(start, end));
            const resolvedProfile = getWallResolvedGeometry(wall).profile;
            [
                [resolvedProfile.aLeft, resolvedProfile.bLeft],
                [resolvedProfile.aRight, resolvedProfile.bRight]
            ].forEach(([start, end]) => addRidgeStationForSide(start, end));
        }
        const stations = [...new Set(stationTValues.map((value) => Number(value).toFixed(6)))]
            .map(Number)
            .sort((a, b) => a - b)
            .map((t) => ({
                t,
                leftHeight: zAt(interpolatePoint(profile[0], profile[1], t)),
                rightHeight: zAt(interpolatePoint(profile[3], profile[2], t))
            }));
        return {
            kind: "stations",
            generatedBy: {
                type: "roof",
                mode: roofModeValue(getFloorRoof(floor)),
                roofId: String(getFloorRoof(floor).id || ""),
                floorId: getFloorId(floor),
                plane,
                originalHeight: Number.isFinite(priorGeneratedHeight)
                    ? priorGeneratedHeight
                    : Number(wall.height)
            },
            stations
        };
    }

    wallProfileHeightAtT(wall, t) {
        const profile = wall && wall.topProfile;
        if (!profile) {
            const height = Number(wall && wall.height);
            if (!Number.isFinite(height) || height <= 0) {
                throw new Error(`wall ${wall && wall.id} requires a positive height for hosted columns`);
            }
            return height;
        }
        const stations = Array.isArray(profile.stations) ? profile.stations : [];
        if (stations.length < 2) {
            throw new Error(`wall ${wall && wall.id} topProfile requires at least two stations for hosted columns`);
        }
        const clampedT = Math.max(0, Math.min(1, Number(t)));
        let previous = stations[0];
        for (let index = 1; index < stations.length; index++) {
            const next = stations[index];
            const previousT = Number(previous.t);
            const nextT = Number(next.t);
            if (!Number.isFinite(previousT) || !Number.isFinite(nextT) || nextT <= previousT) {
                throw new Error(`wall ${wall && wall.id} topProfile stations must have increasing finite t values`);
            }
            if (clampedT <= nextT || index === stations.length - 1) {
                const localT = Math.max(0, Math.min(1, (clampedT - previousT) / (nextT - previousT)));
                const leftA = Number(previous.leftHeight);
                const rightA = Number(previous.rightHeight);
                const leftB = Number(next.leftHeight);
                const rightB = Number(next.rightHeight);
                if (![leftA, rightA, leftB, rightB].every(Number.isFinite)) {
                    throw new Error(`wall ${wall && wall.id} topProfile station heights must be finite`);
                }
                const leftHeight = leftA + (leftB - leftA) * localT;
                const rightHeight = rightA + (rightB - rightA) * localT;
                return Math.max(0.001, leftHeight, rightHeight);
            }
            previous = next;
        }
        throw new Error(`wall ${wall && wall.id} topProfile could not be evaluated for hosted columns`);
    }

    wallTopProfilePlane(wall) {
        const generatedBy = wall && wall.topProfile && wall.topProfile.generatedBy;
        const generatedMode = String(generatedBy && generatedBy.mode || "").trim().toLowerCase();
        const plane = generatedBy && (generatedMode === "shed" || generatedMode === "gabled") && generatedBy.plane;
        if (!plane || typeof plane !== "object") return null;
        const direction = plane.direction || {};
        const normalized = {
            kind: String(plane.kind || ""),
            mode: String(plane.mode || generatedMode || "shed").trim().toLowerCase(),
            direction: {
                x: Number(direction.x),
                y: Number(direction.y)
            },
            minProjection: Number(plane.minProjection),
            maxProjection: Number(plane.maxProjection),
            baseZ: Number(plane.baseZ),
            peakHeight: Number(plane.peakHeight)
        };
        if (
            normalized.kind !== "shedPlane" ||
            (normalized.mode !== "shed" && normalized.mode !== "gabled") ||
            !Number.isFinite(normalized.direction.x) ||
            !Number.isFinite(normalized.direction.y) ||
            !Number.isFinite(normalized.minProjection) ||
            !Number.isFinite(normalized.maxProjection) ||
            !Number.isFinite(normalized.baseZ) ||
            !Number.isFinite(normalized.peakHeight) ||
            normalized.maxProjection - normalized.minProjection <= ROOF_SUPPORT_POINT_EPSILON
        ) {
            throw new Error(`wall ${wall && wall.id} generated roof topProfile has an invalid plane`);
        }
        return normalized;
    }

    wallTopHeightAtPoint(wall, point, fallbackHeight, bottomZ) {
        const plane = this.wallTopProfilePlane(wall);
        if (!plane) return fallbackHeight;
        const projection = Number(point.x) * plane.direction.x + Number(point.y) * plane.direction.y;
        const t = (projection - plane.minProjection) / (plane.maxProjection - plane.minProjection);
        const heightZ = plane.mode === "gabled"
            ? plane.baseZ + plane.peakHeight * (1 - Math.abs(2 * t - 1))
            : plane.baseZ + plane.peakHeight * t;
        return Math.max(0.001, heightZ - bottomZ);
    }

    hostedColumnHeightForWall(column, wall) {
        if (!column || !wall) throw new Error("hosted column height requires a column and wall");
        const points = wallPoints(this.building, wall);
        if (!Array.isArray(points) || points.length !== 2) {
            throw new Error(`column ${column.id} host wall ${wall.id} requires a two-point centerline`);
        }
        const a = points[0];
        const b = points[1];
        const dx = Number(b.x) - Number(a.x);
        const dy = Number(b.y) - Number(a.y);
        const lenSq = dx * dx + dy * dy;
        if (!Number.isFinite(lenSq) || lenSq <= 0.000001) {
            throw new Error(`column ${column.id} host wall ${wall.id} cannot have zero length`);
        }
        const position = column.position || {};
        const t = ((Number(position.x) - Number(a.x)) * dx + (Number(position.y) - Number(a.y)) * dy) / lenSq;
        return this.wallProfileHeightAtT(wall, t);
    }

    syncWallHostedColumnHeights() {
        const wallsById = new Map(getBuildingWalls(this.building).map((wall) => [String(wall.id), wall]));
        getBuildingFloors(this.building).forEach((floor) => {
            const floorId = getFloorId(floor);
            getFloorColumns(floor).forEach((column) => {
                if (column.wallId === undefined || column.wallId === null || column.wallId === "") return;
                if (String(column.heightMode || "wall").trim().toLowerCase() === "fixed") return;
                const wall = wallsById.get(String(column.wallId));
                if (!wall) throw new Error(`column ${column.id} references missing host wall ${column.wallId}`);
                if (String(wall.fragmentId || wall.floorId) !== String(floorId)) {
                    throw new Error(`column ${column.id} host wall ${column.wallId} is not on floor ${floorId}`);
                }
                column.height = this.hostedColumnHeightForWall(column, wall);
            });
        });
    }

    columnTopHeightsFromWallProfile(column, floor, wall) {
        const verts = columnVertices(column);
        if (!Array.isArray(verts) || verts.length < 3) {
            throw new Error(`column ${column && column.id} wall top clipping requires at least three vertices`);
        }
        const bottomZ = Number(column.bottomZ);
        if (!Number.isFinite(bottomZ)) throw new Error(`column ${column && column.id} wall top clipping requires finite bottomZ`);
        return verts.map((point) => Math.max(0.001, this.wallTopHeightAtPoint(wall, point, Number(column.height), bottomZ)));
    }

    columnTopHeightsFromRoof(column, roofView, range) {
        const verts = columnVertices(column);
        if (!Array.isArray(verts) || verts.length < 3) {
            throw new Error(`column ${column && column.id} roof clipping requires at least three vertices`);
        }
        const bottomZ = Number(column.bottomZ);
        if (!Number.isFinite(bottomZ)) throw new Error(`column ${column && column.id} roof clipping requires finite bottomZ`);
        return verts.map((point) => Math.max(0.001, Number(this.roofShedTopZAt(roofView, point, range)) - bottomZ));
    }

    syncRoofClippedColumnTopHeights() {
        const wallsById = new Map(getBuildingWalls(this.building).map((wall) => [String(wall.id), wall]));
        getBuildingFloors(this.building).forEach((floor) => {
            const floorId = getFloorId(floor);
            const roofEntries = getFloorRoofs(floor)
                .filter((roof) => roofUsesSlopeDirection(roof))
                .map((roof) => {
                    const roofView = floorRoofView(floor, roof);
                    return {
                        roof,
                        roofView,
                        range: this.roofShedProjectionRange(roofView)
                    };
                });
            getFloorColumns(floor).forEach((column) => {
                const wall = column.wallId !== undefined && column.wallId !== null && column.wallId !== ""
                    ? wallsById.get(String(column.wallId))
                    : null;
                if (wall) {
                    if (String(wall.fragmentId || wall.floorId) !== floorId) {
                        throw new Error(`column ${column.id} host wall ${column.wallId} is not on floor ${floorId}`);
                    }
                    if (this.wallTopProfilePlane(wall)) {
                        column.topHeights = this.columnTopHeightsFromWallProfile(column, floor, wall);
                        return;
                    }
                }
                const clippingRoofs = roofEntries.filter(({ roof }) => this.roofIntersectsColumnFootprint(roof, column));
                if (clippingRoofs.length > 1) {
                    throw new Error(`column ${column && column.id} passes under multiple sloped roofs`);
                }
                if (clippingRoofs.length === 1) {
                    const { roofView, range } = clippingRoofs[0];
                    column.topHeights = this.columnTopHeightsFromRoof(column, roofView, range);
                    return;
                }
                column.topHeights = null;
            });
        });
    }

    syncGeneratedWallTopProfiles() {
        refreshWallResolvedGeometry(this.building);
        getBuildingFloors(this.building).forEach((floor) => {
            const floorId = getFloorId(floor);
            const shedRoofEntries = getFloorRoofs(floor)
                .filter((roof) => roofUsesSlopeDirection(roof))
                .map((roof) => {
                    const roofView = floorRoofView(floor, roof);
                    return {
                        roof,
                        roofView,
                        range: this.roofShedProjectionRange(roofView)
                    };
                });
            getBuildingWalls(this.building).forEach((wall) => {
                if (String(wall.fragmentId || wall.floorId) !== floorId) return;
                const attachedShedRoofs = shedRoofEntries.filter(({ roof }) => this.roofShouldProfileWall(floor, roof, wall));
                if (attachedShedRoofs.length > 1) {
                    throw new Error(`wall ${wall && wall.id} is attached to multiple shed roofs`);
                }
                if (attachedShedRoofs.length === 1) {
                    const { roofView, range } = attachedShedRoofs[0];
                    wall.topProfile = this.shedWallTopProfileForWall(roofView, wall, range);
                    const maxHeight = wall.topProfile.stations.reduce((max, station) => Math.max(max, station.leftHeight, station.rightHeight), 0);
                    wall.height = Math.max(0.001, maxHeight);
                    return;
                }
                const generated = wall.topProfile && wall.topProfile.generatedBy && wall.topProfile.generatedBy.type === "roof";
                if (generated) {
                    const originalHeight = Number(wall.topProfile.generatedBy.originalHeight);
                    wall.topProfile = null;
                    if (Number.isFinite(originalHeight) && originalHeight > 0) {
                        wall.height = originalHeight;
                    } else if (Number.isFinite(Number(floor.defaultWallHeight)) && Number(floor.defaultWallHeight) > 0) {
                        wall.height = Number(floor.defaultWallHeight);
                    }
                }
            });
        });
        this.syncWallHostedColumnHeights();
        this.syncRoofClippedColumnTopHeights();
    }

    roofShedBaseCenter(floor) {
        return polygonCentroid(this.roofShedBasePolygon(floor));
    }

    roofShedDirectionSnapCandidates(floor) {
        const base = this.roofShedBasePolygon(floor);
        const center = this.roofShedBaseCenter(floor);
        const candidates = [];
        for (let index = 0; index < base.length; index++) {
            const a = base[index];
            const b = base[(index + 1) % base.length];
            const dx = Number(b.x) - Number(a.x);
            const dy = Number(b.y) - Number(a.y);
            const lengthSquared = dx * dx + dy * dy;
            if (lengthSquared <= 0.000001) continue;
            const t = ((Number(center.x) - Number(a.x)) * dx + (Number(center.y) - Number(a.y)) * dy) / lengthSquared;
            if (t < -0.000001 || t > 1.000001) continue;
            const intersection = {
                x: Number(a.x) + dx * Math.max(0, Math.min(1, t)),
                y: Number(a.y) + dy * Math.max(0, Math.min(1, t))
            };
            const vx = intersection.x - Number(center.x);
            const vy = intersection.y - Number(center.y);
            const distanceToCenter = Math.hypot(vx, vy);
            if (distanceToCenter <= 0.000001) continue;
            const direction = { x: vx / distanceToCenter, y: vy / distanceToCenter };
            candidates.push({
                edgeIndex: index,
                direction,
                intersection,
                point: {
                    x: Number(center.x) + direction.x * ROOF_SHED_DIRECTION_HANDLE_LENGTH,
                    y: Number(center.y) + direction.y * ROOF_SHED_DIRECTION_HANDLE_LENGTH
                }
            });
        }
        return candidates;
    }

    selectRoofShedDirection(floorId, options = {}) {
        const floor = findFloor(this.building, floorId);
        if (!floor) throw new Error(`cannot select shed roof direction for missing level: ${floorId}`);
        const roofId = options.roofId || (this.selection && String(this.selection.floorId) === String(floorId) ? this.selection.roofId : "");
        const roof = findFloorRoof(floor, roofId);
        if (!roof) throw new Error(`cannot select shed roof direction without a roof: ${floorId}`);
        if (!roofUsesSlopeDirection(roof)) throw new Error("cannot select roof direction on a roof without a slope direction");
        getRoofShedDirection(roof);
        const selectedFloorId = getFloorId(floor);
        if (!options.preserveView) {
            this.selectedFloorIds = new Set([selectedFloorId]);
            this.layerSelectionMode = "floor";
        }
        this.selection = createSelection("roofShedDirection", {
            floorId: selectedFloorId,
            ...(roofId ? { roofId: String(roofId) } : {})
        });
        this.syncInputsFromFloor(floor);
        this.emitChange();
    }

    selectRoofVertex(floorId, vertexIndex, options = {}) {
        const floor = findFloor(this.building, floorId);
        if (!floor) throw new Error(`cannot select roof vertex for missing level: ${floorId}`);
        const roofId = options.roofId || (this.selection && String(this.selection.floorId) === String(floorId) ? this.selection.roofId : "");
        const roof = findFloorRoof(floor, roofId);
        if (!roof) throw new Error(`cannot select roof vertex without a roof: ${floorId}`);
        const ring = getRoofContactPolygon(roof);
        const index = Math.floor(Number(vertexIndex));
        if (!Number.isInteger(index) || index < 0 || index >= ring.length) {
            throw new Error(`cannot select missing roof vertex: ${vertexIndex}`);
        }
        const selectedFloorId = getFloorId(floor);
        if (!options.preserveView) {
            this.selectedFloorIds = new Set([selectedFloorId]);
            this.layerSelectionMode = "floor";
        }
        this.selection = createSelection("roofVertex", {
            floorId: selectedFloorId,
            vertexIndex: index,
            ...(roofId ? { roofId: String(roofId) } : {})
        });
        this.syncInputsFromFloor(floor);
        this.emitChange();
    }

    selectedRoofPeak() {
        const selection = this.selection || {};
        if (selection.kind !== "roofPeak") return null;
        const floor = findFloor(this.building, selection.floorId);
        if (!floor) throw new Error(`selected roof peak is missing its floor: ${selection.floorId}`);
        const roof = findFloorRoof(floor, selection.roofId);
        if (!roof) throw new Error(`selected roof peak is missing its roof: ${selection.floorId}`);
        return { floor, roof, point: getRoofPeakPoint(roof) };
    }

    selectedRoofShedDirection() {
        const selection = this.selection || {};
        if (selection.kind !== "roofShedDirection") return null;
        const floor = findFloor(this.building, selection.floorId);
        if (!floor) throw new Error(`selected shed roof direction is missing its floor: ${selection.floorId}`);
        const roof = findFloorRoof(floor, selection.roofId);
        if (!roof) throw new Error(`selected shed roof direction is missing its roof: ${selection.floorId}`);
        if (!roofUsesSlopeDirection(roof)) throw new Error("selected roof direction requires a shed or gabled roof");
        return { floor, roof, direction: getRoofShedDirection(roof) };
    }

    findGable(floorOrId, gableId) {
        const floor = typeof floorOrId === "string" ? findFloor(this.building, floorOrId) : floorOrId;
        if (!floor) return null;
        const id = Number(gableId);
        const roofId = this.selection && String(this.selection.floorId) === String(getFloorId(floor))
            ? this.selection.roofId
            : null;
        const roofs = roofId ? [findFloorRoof(floor, roofId)].filter(Boolean) : getFloorRoofs(floor);
        return roofs.flatMap((roof) => getRoofGables(roof)).find((gable) => Number(gable.id) === id) || null;
    }

    selectedGable() {
        const selection = this.selection || {};
        if (selection.kind !== "gable" && selection.kind !== "gableHandle") return null;
        return this.findGable(selection.floorId, selection.gableId);
    }

    selectGable(floorId, gableId, options = {}) {
        const floor = findFloor(this.building, floorId);
        if (!floor) throw new Error(`cannot select gable for missing level: ${floorId}`);
        const roof = findFloorRoof(floor, options.roofId);
        if (!roof) throw new Error(`cannot select gable for missing roof on level: ${floorId}`);
        const gable = getRoofGables(roof).find((candidate) => Number(candidate.id) === Number(gableId)) || null;
        if (!gable) throw new Error(`cannot select missing roof gable: ${gableId}`);
        const selectedFloorId = getFloorId(floor);
        if (!options.preserveView) {
            this.selectedFloorIds = new Set([selectedFloorId]);
            this.layerSelectionMode = "floor";
        }
        this.selection = createSelection("gable", {
            floorId: selectedFloorId,
            gableId: gable.id,
            ...(options.roofId ? { roofId: String(options.roofId) } : {})
        });
        this.syncInputsFromFloor(floor);
        this.emitChange();
    }

    selectGableHandle(floorId, gableId, handle, options = {}) {
        if (handle !== "start" && handle !== "end" && handle !== "height") {
            throw new Error(`unknown gable handle: ${handle}`);
        }
        const floor = findFloor(this.building, floorId);
        if (!floor) throw new Error(`cannot select gable handle for missing level: ${floorId}`);
        const roof = findFloorRoof(floor, options.roofId || (this.selection && this.selection.roofId));
        if (!roof) throw new Error(`cannot select handle for missing roof on level: ${floorId}`);
        const gable = getRoofGables(roof).find((candidate) => Number(candidate.id) === Number(gableId)) || null;
        if (!gable) throw new Error(`cannot select handle for missing roof gable: ${gableId}`);
        const selectedFloorId = getFloorId(floor);
        if (!options.preserveView) {
            this.selectedFloorIds = new Set([selectedFloorId]);
            this.layerSelectionMode = "floor";
        }
        const roofId = options.roofId || (this.selection && this.selection.roofId);
        this.selection = createSelection("gableHandle", {
            floorId: selectedFloorId,
            gableId: gable.id,
            gableHandle: handle,
            ...(roofId ? { roofId: String(roofId) } : {})
        });
        this.syncInputsFromFloor(floor);
        this.emitChange();
    }

    gableIntervalsOverlap(floor, first, second) {
        if (!floor || !first || !second) return false;
        const firstParts = gableIntervalParts(floor, first);
        const secondParts = gableIntervalParts(floor, second);
        return firstParts.some((left) => secondParts.some((right) => Math.max(left.start, right.start) < Math.min(left.end, right.end) - 0.000001));
    }

    assertGableDoesNotOverlap(floor, gable, ignoredGableId = null) {
        canonicalizeGableSpanToShortest(floor, gable);
        if (gableIntervalLength(floor, gable) <= 0.000001) {
            throw new Error(`roof gable ${gable.id} endpoints must not coincide`);
        }
        const overlap = getRoofGables(floor).find((candidate) => {
            if (ignoredGableId !== null && String(candidate.id) === String(ignoredGableId)) return false;
            return this.gableIntervalsOverlap(floor, candidate, gable);
        });
        if (overlap) {
            throw new Error(`roof gable ${gable.id} overlaps gable ${overlap.id}`);
        }
    }

    addGableToRoof(floorId, faceIndex, options = {}) {
        const floor = findFloor(this.building, floorId);
        if (!floor) throw new Error(`cannot add gable to missing roof level: ${floorId}`);
        const roof = findFloorRoof(floor, options.roofId);
        if (!roof) throw new Error(`cannot add gable to missing roof on level: ${floorId}`);
        const roofView = floorRoofView(floor, roof);
        if (String(roof.mode || "peak") !== "peak") throw new Error("gables can only be added to peak roofs");
        if (Number(roof.overhang) < 0) {
            throw new Error("cannot add gable to a roof with negative overhang yet");
        }
        const resolvedFaceIndex = Math.floor(Number(faceIndex));
        const faceCount = getRoofContactPolygon(roofView).length;
        if (!Number.isInteger(resolvedFaceIndex) || resolvedFaceIndex < 0 || resolvedFaceIndex >= faceCount) {
            throw new Error(`cannot add gable to missing roof face: ${faceIndex}`);
        }
        const height = Math.min(3, Number(roof.peakHeight));
        if (!Number.isFinite(height) || height <= 0) {
            throw new Error("cannot add gable to a roof without positive peak height");
        }
        const start = options.start
            ? normalizeGablePerimeterPosition(options.start)
            : { edgeIndex: resolvedFaceIndex, t: Number.isFinite(Number(options.startT)) ? Number(options.startT) : 0 };
        const end = options.end
            ? normalizeGablePerimeterPosition(options.end)
            : { edgeIndex: resolvedFaceIndex, t: Number.isFinite(Number(options.endT)) ? Number(options.endT) : 1 };
        const gable = normalizeRoofGable({
            start,
            end,
            height,
            wallTexturePath: floor.defaultWallTexturePath,
            roofReturn: options.roofReturn !== false
        });
        this.assertGableDoesNotOverlap(roofView, gable);
        roof.gables.push(gable);
        this.selectGable(getFloorId(floor), gable.id, options);
        return gable;
    }

    moveSelectedGableHandle(value, options = {}) {
        const selection = this.selection || {};
        if (selection.kind !== "gableHandle") return false;
        const floor = findFloor(this.building, selection.floorId);
        if (!floor) throw new Error(`cannot move gable handle for missing level: ${selection.floorId}`);
        const roof = findFloorRoof(floor, selection.roofId);
        if (!roof) throw new Error(`cannot move gable handle without a roof on level: ${selection.floorId}`);
        const roofView = floorRoofView(floor, roof);
        const gable = this.findGable(floor, selection.gableId);
        if (!gable) throw new Error(`selected roof gable is missing: ${selection.gableId}`);
        const previous = JSON.parse(JSON.stringify(gable));
        if (selection.gableHandle === "height") {
            const height = Number(value);
            if (!Number.isFinite(height)) throw new Error("gable height drag requires a finite height");
            gable.height = Math.max(0, Math.min(Number(roof.peakHeight), height));
        } else {
            const fallback = gable[selection.gableHandle] || { edgeIndex: 0, t: 0 };
            const position = normalizeGablePerimeterPosition(value, fallback.edgeIndex, fallback.t);
            if (selection.gableHandle === "start") {
                gable.start = position;
            } else {
                gable.end = position;
            }
        }
        try {
            this.assertGableDoesNotOverlap(roofView, gable, gable.id);
        } catch (error) {
            Object.assign(gable, previous);
            throw error;
        }
        this.emitChange();
        return true;
    }

    deleteSelectedGable() {
        const selection = this.selection || {};
        if (selection.kind !== "gable" && selection.kind !== "gableHandle") return false;
        const floor = findFloor(this.building, selection.floorId);
        if (!floor) throw new Error(`cannot delete gable for missing level: ${selection.floorId}`);
        const roof = findFloorRoof(floor, selection.roofId);
        if (!roof) throw new Error(`cannot delete gable without a roof on level: ${selection.floorId}`);
        const before = roof.gables.length;
        roof.gables = roof.gables.filter((gable) => String(gable.id) !== String(selection.gableId));
        if (roof.gables.length === before) throw new Error(`cannot delete missing roof gable: ${selection.gableId}`);
        this.building.mountedWallObjects = getBuildingMountedObjects(this.building)
            .filter((object) => object.mountKind !== "gable" || String(object.floorId) !== String(selection.floorId) || String(object.gableId) !== String(selection.gableId));
        this.selectRoof(getFloorId(floor), { preserveView: true, ...(selection.roofId ? { roofId: selection.roofId } : {}) });
        return true;
    }

    deleteSelectedRoof() {
        const selection = this.selection || {};
        if (selection.kind !== "roof") return false;
        const entries = this.selectedRoofEntries();
        if (!entries.length) return false;
        const floorIds = new Set(entries.map((entry) => getFloorId(entry.floor)));
        entries.forEach((entry) => {
            const roofId = String(entry.roof && entry.roof.id || "");
            if (entry.floor.roof === entry.roof || (roofId && entry.floor.roof && String(entry.floor.roof.id) === roofId)) {
                const extras = Array.isArray(entry.floor.roofs) ? entry.floor.roofs.filter((roof) => !roofId || String(roof.id) !== roofId) : [];
                entry.floor.roof = extras.shift() || null;
                entry.floor.roofs = extras;
                return;
            }
            if (!Array.isArray(entry.floor.roofs)) {
                throw new Error(`cannot delete roof ${roofId || "(missing id)"} because it is not attached to floor ${getFloorId(entry.floor)}`);
            }
            const before = entry.floor.roofs.length;
            entry.floor.roofs = entry.floor.roofs.filter((roof) => String(roof && roof.id) !== roofId);
            if (entry.floor.roofs.length === before) {
                throw new Error(`cannot delete missing roof ${roofId || "(missing id)"} from floor ${getFloorId(entry.floor)}`);
            }
        });
        this.building.mountedWallObjects = getBuildingMountedObjects(this.building)
            .filter((object) => object.mountKind !== "gable" || !floorIds.has(String(object.floorId)));
        if (floorIds.size === 1) {
            this.selectFloor([...floorIds][0], { preserveView: true });
        } else {
            this.selectBuilding();
        }
        return true;
    }

    roofSupportWallEndpointElevation(wall, endpointKey) {
        if (endpointKey !== "startPoint" && endpointKey !== "endPoint") {
            throw new Error(`unknown wall endpoint key for roof support: ${endpointKey}`);
        }
        const endpointT = endpointKey === "startPoint" ? 0 : 1;
        const geometry = getWallResolvedGeometry(wall);
        const station = geometry.topStations.find((candidate) => Math.abs(Number(candidate.t) - endpointT) <= 0.000001);
        if (!station) throw new Error(`wall ${wall && wall.id} is missing top station ${endpointT} for roof support`);
        const leftZ = Number(station.left && station.left.z);
        const rightZ = Number(station.right && station.right.z);
        if (!Number.isFinite(leftZ) || !Number.isFinite(rightZ)) {
            throw new Error(`wall ${wall && wall.id} endpoint ${endpointKey} has non-finite roof support height`);
        }
        return Math.max(leftZ, rightZ);
    }

    roofSupportWallElevationAt(wall, t) {
        const baseZ = Number(wall && wall.bottomZ);
        if (!Number.isFinite(baseZ)) throw new Error(`wall ${wall && wall.id} has non-finite bottomZ for roof support`);
        return baseZ + this.wallProfileHeightAtT(wall, t);
    }

    roofSupportColumnElevation(column) {
        const bottomZ = Number(column && column.bottomZ);
        const height = Number(column && column.height);
        if (!Number.isFinite(bottomZ) || !Number.isFinite(height) || height <= 0) {
            throw new Error(`column ${column && column.id} has invalid roof support height`);
        }
        return bottomZ + height;
    }

    roofSupportTargetElevation(hit, options = {}) {
        if (!hit || !hit.floor) throw new Error("roof placement requires a wall or column target");
        if (hit.type === "column") return this.roofSupportColumnElevation(hit.column);
        if (hit.type !== "wall") throw new Error(`cannot place roof from unsupported target: ${hit.type}`);
        const wall = hit.wall;
        const hasGeneratedProfile = !!(wall && wall.topProfile && Array.isArray(wall.topProfile.stations));
        if (options.screenPoint && options.renderer) {
            const snap = wallPlacementPointAtScreen(this, wall, hit.floor, options.screenPoint, options.renderer);
            if (!snap) throw new Error(`cannot resolve hovered point on wall ${wall && wall.id} for roof placement`);
            return this.roofSupportWallElevationAt(wall, snap.t);
        }
        if (hasGeneratedProfile) {
            throw new Error(`wall ${wall && wall.id} roof placement needs a screen point to resolve its sloped top height`);
        }
        return this.roofSupportWallElevationAt(wall, 0.5);
    }

    orderRoofSupportPoints(points) {
        const unique = [];
        const seen = new Set();
        (Array.isArray(points) ? points : []).forEach((point) => {
            const x = Number(point && point.x);
            const y = Number(point && point.y);
            if (!Number.isFinite(x) || !Number.isFinite(y)) return;
            const key = `${Math.round(x / ROOF_SUPPORT_POINT_EPSILON)},${Math.round(y / ROOF_SUPPORT_POINT_EPSILON)}`;
            if (seen.has(key)) return;
            seen.add(key);
            unique.push({ x, y });
        });
        if (unique.length < 3) throw new Error("roof placement requires at least three same-height wall or column endpoints");
        const center = unique.reduce((sum, point) => ({
            x: sum.x + point.x,
            y: sum.y + point.y
        }), { x: 0, y: 0 });
        center.x /= unique.length;
        center.y /= unique.length;
        const ring = unique
            .sort((a, b) => Math.atan2(a.y - center.y, a.x - center.x) - Math.atan2(b.y - center.y, b.x - center.x))
            .map((point) => ({ x: point.x, y: point.y }));
        const error = simplePolygonRingError(ring, "roof support polygon");
        if (error) throw new Error(`cannot place roof from same-height supports: ${error}`);
        return ring;
    }

    roofPlacementFromSupportHit(hit, options = {}) {
        if (!hit || !hit.floor || (hit.type !== "wall" && hit.type !== "column")) {
            throw new Error("roof placement requires hovering over a wall or column");
        }
        refreshWallResolvedGeometry(this.building);
        const floor = hit.floor;
        const floorId = getFloorId(floor);
        const targetElevation = this.roofSupportTargetElevation(hit, options);
        const supportPoints = [];
        getBuildingWalls(this.building).forEach((wall) => {
            if (String(wall && (wall.fragmentId || wall.floorId)) !== floorId) return;
            const points = wallPoints(this.building, wall);
            if (!Array.isArray(points) || points.length !== 2) {
                throw new Error(`wall ${wall && wall.id} roof support requires two endpoints`);
            }
            [
                { key: "startPoint", point: points[0] },
                { key: "endPoint", point: points[1] }
            ].forEach((entry) => {
                const elevation = this.roofSupportWallEndpointElevation(wall, entry.key);
                if (Math.abs(elevation - targetElevation) <= ROOF_SUPPORT_HEIGHT_EPSILON) {
                    supportPoints.push(entry.point);
                }
            });
        });
        getFloorColumns(floor).forEach((column) => {
            const elevation = this.roofSupportColumnElevation(column);
            if (Math.abs(elevation - targetElevation) > ROOF_SUPPORT_HEIGHT_EPSILON) return;
            const position = column && column.position;
            const x = Number(position && position.x);
            const y = Number(position && position.y);
            if (!Number.isFinite(x) || !Number.isFinite(y)) {
                throw new Error(`column ${column && column.id} roof support requires a finite center position`);
            }
            supportPoints.push({ x, y });
        });
        return {
            floor,
            floorId,
            elevation: targetElevation,
            contactPolygon: this.orderRoofSupportPoints(supportPoints)
        };
    }

    createRoofFromSupportHit(hit, options = {}) {
        const placement = this.roofPlacementFromSupportHit(hit, options);
        return this.createRoofForFloor(placement.floor, {
            ...options,
            contactPolygon: placement.contactPolygon,
            elevation: placement.elevation,
            allowMultiple: true
        });
    }

    createRoofForFloor(floor, options = {}) {
        if (!floor) throw new Error("cannot create roof without a floor");
        const floorId = getFloorId(floor);
        const existingRoof = getFloorRoof(floor);
        if (existingRoof && options.allowMultiple !== true) {
            this.selectRoof(floorId, { preserveView: options.preserveView === true });
            return existingRoof;
        }
        const texture = typeof options.texture === "string" && options.texture.length > 0
            ? options.texture
            : (typeof this.paintTextures.roofs === "string" && this.paintTextures.roofs.length > 0 ? this.paintTextures.roofs : this.inputs.roofTexture);
        if (typeof texture !== "string" || texture.length === 0) {
            throw new Error("cannot create roof without a roof texture");
        }
        const overhang = Number(options.overhang ?? this.inputs.roofOverhang);
        if (!Number.isFinite(overhang)) {
            throw new Error("roof overhang must be a finite number");
        }
        const peakHeight = Number(options.peakHeight ?? this.inputs.roofPeakHeight);
        if (!Number.isFinite(peakHeight) || peakHeight < 0) {
            throw new Error("roof peak height must be zero or greater");
        }
        const elevationOffset = options.elevation !== undefined
            ? normalizeRoofElevationOffset(Number(options.elevation) - roofSnapPlaneElevation(floor), "roof elevation offset")
            : normalizeRoofElevationOffset(options.elevationOffset ?? DEFAULTS.roofElevationOffset, "roof elevation offset");
        const roof = createRoof({
            floorId,
            mode: options.mode || this.inputs.roofMode || DEFAULTS.roofMode,
            texture,
            overhang,
            peakHeight,
            domeLevels: options.domeLevels ?? this.inputs.roofDomeLevels,
            peakPoint: options.peakPoint || this.defaultRoofPeakPoint(floor),
            elevationOffset,
            contactPolygon: Array.isArray(options.contactPolygon) ? options.contactPolygon : this.defaultRoofContactPolygon(floor)
        });
        if (!existingRoof) {
            floor.roof = roof;
        } else {
            if (!Array.isArray(floor.roofs)) floor.roofs = [];
            floor.roofs.push(roof);
        }
        this.inputs.roofTexture = texture;
        this.inputs.roofMode = roof.mode || DEFAULTS.roofMode;
        this.inputs.roofOverhang = overhang;
        this.inputs.roofPeakHeight = peakHeight;
        this.inputs.roofDomeLevels = getRoofDomeLevels(roof);
        this.paintTextures.roofs = texture;
        this.selectRoof(floorId, {
            preserveView: options.preserveView === true,
            roofId: existingRoof ? roof.id : undefined
        });
        return roof;
    }

    createRoofForSelectedFloor(options = {}) {
        return this.createRoofForFloor(this.selectedFloor(), options);
    }

    updateSelectedGableWallTexture(texture) {
        if (typeof texture !== "string" || texture.length === 0) {
            throw new Error("gable wall texture path must be a non-empty string");
        }
        const gable = this.selectedGable();
        if (!gable) throw new Error("cannot update gable wall texture without a selected gable");
        gable.wallTexturePath = texture;
        this.inputs.wallTexture = texture;
        this.paintTextures.walls = texture;
        this.emitChange();
    }

    updateSelectedGableHeight(value) {
        const floor = this.selectedFloor();
        if (!floor) throw new Error("cannot update gable height without a selected roof");
        const roof = findFloorRoof(floor, this.selection && this.selection.roofId);
        if (!roof) throw new Error("cannot update gable height without a selected roof");
        const gable = this.selectedGable();
        if (!gable) throw new Error("cannot update gable height without a selected gable");
        const height = Number(value);
        if (!Number.isFinite(height)) throw new Error("gable height must be finite");
        gable.height = Math.max(0, Math.min(Number(roof.peakHeight), height));
        this.emitChange();
    }

    updateSelectedGableRoofReturn(enabled) {
        const gable = this.selectedGable();
        if (!gable) throw new Error("cannot update roof return without a selected gable");
        gable.roofReturn = enabled !== false;
        this.emitChange();
    }

    paintGable(floorOrId, gableId, texture, options = {}) {
        const floor = typeof floorOrId === "string" ? findFloor(this.building, floorOrId) : floorOrId;
        if (!floor) throw new Error("cannot paint gable on a missing roof");
        const roof = findFloorRoof(floor, options.roofId);
        if (!roof) throw new Error("cannot paint gable on a missing roof");
        const gable = getRoofGables(roof).find((candidate) => Number(candidate.id) === Number(gableId)) || null;
        if (!gable) throw new Error(`cannot paint missing roof gable: ${gableId}`);
        gable.wallTexturePath = texture;
        this.inputs.wallTexture = texture;
        this.paintTextures.walls = texture;
        this.selectGable(getFloorId(floor), gable.id, {
            ...(options.roofId ? { roofId: String(options.roofId) } : {})
        });
    }

    isFloorSelected(floorId) {
        return this.selectedFloorIds.has(String(floorId || ""));
    }

    highlightedLayerFloorIds() {
        const selection = this.selection || {};
        const floorIds = new Set();
        const addFloorId = (floorId) => {
            if (floorId !== undefined && floorId !== null && floorId !== "") floorIds.add(String(floorId));
        };
        if (selection.kind === "wall" || selection.kind === "wallEndpoint") {
            this.selectedWalls().forEach((wall) => addFloorId(wall.fragmentId || wall.floorId));
            return floorIds;
        }
        if (selection.kind === "mountedObject") {
            this.selectedMountedObjects().forEach((object) => {
                if (object.mountKind === "gable") {
                    addFloorId(object.floorId);
                    return;
                }
                const wall = findWall(this.building, object.wallId ?? object.mountedWallSectionUnitId);
                if (wall) addFloorId(wall.fragmentId || wall.floorId);
                else addFloorId(object.floorId);
            });
            return floorIds;
        }
        if (selection.kind === "roof" || selection.kind === "roofVertex" || selection.kind === "roofPeak") {
            this.selectedRoofFloorIds().forEach(addFloorId);
            return floorIds;
        }
        if (selection.kind === "building") return floorIds;
        addFloorId(selection.floorId || selection.levelId);
        return floorIds;
    }

    isLayerFloorHighlighted(floorId) {
        return this.highlightedLayerFloorIds().has(String(floorId || ""));
    }

    allFloorsSelected() {
        const floors = getBuildingFloors(this.building);
        return this.layerSelectionMode === "all" && floors.length > 0 && this.selectedFloorIds.size === floors.length &&
            floors.every((floor) => this.selectedFloorIds.has(getFloorId(floor)));
    }

    renderStyle() {
        return this.allFloorsSelected() ? "exterior" : "interior";
    }

    visibleFloorIds() {
        return new Set(this.selectedFloorIds);
    }

    floorBelow(floorOrId) {
        const floor = typeof floorOrId === "string" ? findFloor(this.building, floorOrId) : floorOrId;
        if (!floor) return null;
        const elevation = getFloorElevation(floor);
        return getBuildingFloors(this.building)
            .filter((candidateFloor) => getFloorId(candidateFloor) !== getFloorId(floor))
            .filter((candidateFloor) => getFloorElevation(candidateFloor) < elevation - 0.000001)
            .sort((a, b) => getFloorElevation(b) - getFloorElevation(a))[0] || null;
    }

    floorUnderlay() {
        if (this.allFloorsSelected()) return null;
        if (this.layerSelectionMode !== "floor" || this.selectedFloorIds.size !== 1) return null;
        const floor = this.selectedFloor();
        return this.floorBelow(floor);
    }

    lowerFloorVertexSnapPoint(point) {
        const underlay = this.floorUnderlay();
        if (!underlay) return null;
        return this.floorVertexSnapPoint(underlay, point);
    }

    floorVertexSnapPoint(floor, point) {
        if (!floor) return null;
        let best = null;
        ringsForFloor(floor).forEach((ring) => {
            ring.points.forEach((vertex) => {
                const candidate = { x: Number(vertex.x), y: Number(vertex.y) };
                const snapDistance = distance(point, candidate);
                if (snapDistance > LOWER_FLOOR_VERTEX_SNAP_DISTANCE) return;
                if (!best || snapDistance < best.distance) {
                    best = { point: candidate, distance: snapDistance };
                }
            });
        });
        return best ? best.point : null;
    }

    selectedFloorVertexSnapPoint(point) {
        return this.floorVertexSnapPoint(this.selectedFloor(), point);
    }

    floorAtElevation(elevation) {
        const targetElevation = Number(elevation);
        if (!Number.isFinite(targetElevation)) {
            throw new Error("floor elevation lookup requires a finite elevation");
        }
        return getBuildingFloors(this.building).find((floor) => Math.abs(getFloorElevation(floor) - targetElevation) <= 0.000001) || null;
    }

    polygonToolFloor() {
        return this.floorAtElevation(this.polygonToolElevation);
    }

    beginFloorFragmentDrag(startPoint) {
        const floor = this.selectedFloor();
        if (!floor || !Array.isArray(floor.outerPolygon) || floor.outerPolygon.length < 3) return null;
        const floorId = getFloorId(floor);
        const wallIds = new Set(getBuildingWalls(this.building)
            .filter((wall) => String(wall.fragmentId || wall.floorId) === floorId)
            .map((wall) => String(wall.id)));
        return {
            floorId,
            startPoint: { x: Number(startPoint.x), y: Number(startPoint.y) },
            midpoint: polygonCentroid(floor.outerPolygon),
            outerPolygon: floor.outerPolygon.map((point) => ({ ...point })),
            holes: (Array.isArray(floor.holes) ? floor.holes : []).map((ring) => ring.map((point) => ({ ...point }))),
            walls: getBuildingWalls(this.building)
                .filter((wall) => String(wall.fragmentId || wall.floorId) === floorId)
                .map((wall) => ({
                    id: wall.id,
                    startPoint: cloneEndpoint(wall.startPoint),
                    endPoint: cloneEndpoint(wall.endPoint)
                })),
            mountedObjects: getBuildingMountedObjects(this.building)
                .filter((object) => wallIds.has(String(object.wallId ?? object.mountedWallSectionUnitId)) || String(object.floorId) === floorId)
                .map((object) => ({
                    id: object.id,
                    x: Number(object.x),
                    y: Number(object.y),
                    groundPlaneHitboxOverridePoints: Array.isArray(object.groundPlaneHitboxOverridePoints)
                        ? object.groundPlaneHitboxOverridePoints.map((point) => ({ x: Number(point.x), y: Number(point.y) }))
                        : null
                }))
        };
    }

    floorFragmentMoveDelta(drag, point, options = {}) {
        const dx = Number(point.x) - Number(drag.startPoint.x);
        const dy = Number(point.y) - Number(drag.startPoint.y);
        if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
            throw new Error("floor fragment drag requires finite coordinates");
        }
        const floor = findFloor(this.building, drag.floorId);
        const underlay = this.floorBelow(floor);
        if (!underlay || !Array.isArray(underlay.outerPolygon) || underlay.outerPolygon.length < 3) {
            return { dx, dy, snapped: false };
        }
        const snapDistance = Number.isFinite(Number(options.snapDistance)) && Number(options.snapDistance) > 0
            ? Number(options.snapDistance)
            : FLOOR_MIDPOINT_SNAP_DISTANCE;
        const movedMidpoint = {
            x: Number(drag.midpoint.x) + dx,
            y: Number(drag.midpoint.y) + dy
        };
        const targetMidpoint = polygonCentroid(underlay.outerPolygon);
        if (distance(movedMidpoint, targetMidpoint) > snapDistance) {
            return { dx, dy, snapped: false };
        }
        return {
            dx: dx + Number(targetMidpoint.x) - Number(movedMidpoint.x),
            dy: dy + Number(targetMidpoint.y) - Number(movedMidpoint.y),
            snapped: true
        };
    }

    moveFloorFragmentDrag(drag, point, options = {}) {
        if (!drag || !drag.floorId) return false;
        const floor = findFloor(this.building, drag.floorId);
        if (!floor) throw new Error(`cannot move missing floor fragment: ${drag.floorId}`);
        const delta = this.floorFragmentMoveDelta(drag, point, options);
        floor.outerPolygon = drag.outerPolygon.map((vertex) => translatePoint(vertex, delta.dx, delta.dy));
        floor.holes = drag.holes.map((ring) => ring.map((vertex) => translatePoint(vertex, delta.dx, delta.dy)));
        const wallSnapshots = new Map(drag.walls.map((wall) => [String(wall.id), wall]));
        getBuildingWalls(this.building).forEach((wall) => {
            const snapshot = wallSnapshots.get(String(wall.id));
            if (!snapshot) return;
            wall.startPoint = translateEndpoint(snapshot.startPoint, delta.dx, delta.dy);
            wall.endPoint = translateEndpoint(snapshot.endPoint, delta.dx, delta.dy);
            const hasEdgeEndpoint = (wall.startPoint && wall.startPoint.kind === "edge") ||
                (wall.endPoint && wall.endPoint.kind === "edge");
            if (hasEdgeEndpoint || (wall.attachment && wall.attachment.kind === "lineBoundaryClip")) {
                syncWallLineBoundaryAttachment(wall);
            }
        });
        const mountedSnapshots = new Map(drag.mountedObjects.map((object) => [String(object.id), object]));
        getBuildingMountedObjects(this.building).forEach((object) => {
            const snapshot = mountedSnapshots.get(String(object.id));
            if (!snapshot) return;
            if (Number.isFinite(snapshot.x)) object.x = snapshot.x + delta.dx;
            if (Number.isFinite(snapshot.y)) object.y = snapshot.y + delta.dy;
            if (Array.isArray(snapshot.groundPlaneHitboxOverridePoints)) {
                object.groundPlaneHitboxOverridePoints = snapshot.groundPlaneHitboxOverridePoints
                    .map((hitboxPoint) => translatePoint(hitboxPoint, delta.dx, delta.dy));
            }
        });
        refreshWallSectionEndpoints(this.building, floor);
        this.emitChange();
        return true;
    }

    selectWall(wallId, options = {}) {
        this.selectWalls([wallId], options);
    }

    selectMountedObject(objectId, options = {}) {
        this.selectMountedObjects([objectId], options);
    }

    updateSelectedMountedObjectAsset(asset) {
        const objects = this.selectedMountedObjects();
        if (!objects.length) throw new Error("cannot update texture without a selected door/window");
        if (!asset || typeof asset.texturePath !== "string" || asset.texturePath.length === 0) {
            throw new Error("mounted object asset requires a texture path");
        }
        objects.forEach((object) => {
            object.texturePath = asset.texturePath;
            object.placeableAnchorX = Number.isFinite(Number(asset.anchorX)) ? Number(asset.anchorX) : object.placeableAnchorX;
            object.placeableAnchorY = Number.isFinite(Number(asset.anchorY)) ? Number(asset.anchorY) : object.placeableAnchorY;
            object.renderDepthOffset = Number.isFinite(Number(asset.renderDepthOffset)) ? Number(asset.renderDepthOffset) : object.renderDepthOffset;
            object.compositeLayers = Array.isArray(asset.compositeLayers) ? asset.compositeLayers : object.compositeLayers;
            object.isOpen = asset.isOpen === true;
            object.isPassable = asset.isPassable !== false;
            object.blocksTile = asset.blocksTile === true;
            object.castsLosShadows = asset.castsLosShadows === true;
        });
        this.emitChange();
    }

    resolveMountedObjectSelection(objectIds, label = "mounted object selection") {
        const uniqueIds = [];
        (Array.isArray(objectIds) ? objectIds : []).forEach((id) => {
            if (!uniqueIds.some((candidate) => String(candidate) === String(id))) uniqueIds.push(id);
        });
        if (!uniqueIds.length) return { objectIds: [], objects: [], walls: [], floors: [] };
        const objects = uniqueIds.map((id) => {
            const object = findMountedObject(this.building, id);
            if (!object) throw new Error(`${label} references missing mounted object: ${id}`);
            return object;
        });
        const walls = [];
        const floors = objects.map((object) => {
            if (object.mountKind === "gable") {
                const floor = findFloor(this.building, object.floorId);
                if (!floor) throw new Error(`${label} object ${object.id} is missing its gable floor`);
                const gable = getRoofGables(floor).find((candidate) => String(candidate.id) === String(object.gableId));
                if (!gable) throw new Error(`${label} object ${object.id} is missing its gable`);
                return floor;
            }
            const wall = findWall(this.building, object.wallId ?? object.mountedWallSectionUnitId);
            if (!wall) throw new Error(`${label} object ${object.id} is missing its wall`);
            walls.push(wall);
            const floor = findFloor(this.building, wall.fragmentId || wall.floorId);
            if (!floor) throw new Error(`${label} object ${object.id} wall ${wall.id} is missing its floor`);
            return floor;
        });
        return {
            objectIds: objects.map((object) => object.id),
            objects,
            walls,
            floors
        };
    }

    applyMountedObjectSelection(objectIds, options = {}) {
        const resolved = this.resolveMountedObjectSelection(objectIds, "mounted object selection");
        if (!resolved.objectIds.length) {
            this.selectBuilding();
            return false;
        }
        if (!options.preserveView) {
            this.selectedFloorIds = new Set(resolved.floors.map((floor) => getFloorId(floor)));
            this.layerSelectionMode = "floor";
        }
        const firstCategory = String(resolved.objects[0].category || "").trim().toLowerCase();
        if (firstCategory === "doors" || firstCategory === "windows") {
            this.mountedObjectTool.category = firstCategory;
        }
        const selectedWallIds = new Set(resolved.walls.map((wall) => String(wall.id)));
        this.selection = createSelection("mountedObject", {
            floorId: getFloorId(resolved.floors[0]),
            wallId: selectedWallIds.size === 1 ? resolved.walls[0].id : null,
            mountedObjectIds: resolved.objectIds
        });
        this.emitChange();
        return true;
    }

    selectMountedObjects(objectIds, options = {}) {
        return this.applyMountedObjectSelection(objectIds, options);
    }

    addMountedObjectsToSelection(objectIds, options = {}) {
        const nextObjectIds = [...this.selectedMountedObjectIds()];
        (Array.isArray(objectIds) ? objectIds : []).forEach((objectId) => {
            const object = findMountedObject(this.building, objectId);
            if (!object) throw new Error(`cannot add missing mounted object to selection: ${objectId}`);
            if (!nextObjectIds.some((id) => String(id) === String(object.id))) nextObjectIds.push(object.id);
        });
        return this.applyMountedObjectSelection(nextObjectIds, options);
    }

    removeMountedObjectsFromSelection(objectIds, options = {}) {
        const removeIds = new Set((Array.isArray(objectIds) ? objectIds : []).map((id) => String(id)));
        removeIds.forEach((objectId) => {
            if (!findMountedObject(this.building, objectId)) {
                throw new Error(`cannot remove missing mounted object from selection: ${objectId}`);
            }
        });
        const previousIds = this.selectedMountedObjectIds();
        const nextObjectIds = previousIds.filter((id) => !removeIds.has(String(id)));
        if (nextObjectIds.length === previousIds.length) return false;
        if (nextObjectIds.length === 0) {
            const firstRemoved = [...removeIds][0];
            const object = firstRemoved !== undefined ? findMountedObject(this.building, firstRemoved) : null;
            const wall = object ? findWall(this.building, object.wallId ?? object.mountedWallSectionUnitId) : null;
            if (wall) this.selectLevel(wall.floorId, options);
            else if (object && object.mountKind === "gable" && object.floorId) this.selectLevel(object.floorId, options);
            else this.selectBuilding();
            return true;
        }
        return this.applyMountedObjectSelection(nextObjectIds, options);
    }

    addMountedObjectToSelection(objectId, options = {}) {
        this.addMountedObjectsToSelection([objectId], options);
        return true;
    }

    removeMountedObjectFromSelection(objectId, options = {}) {
        return this.removeMountedObjectsFromSelection([objectId], options);
    }

    resolveWallSelection(wallIds, label = "wall selection") {
        const uniqueIds = [];
        (Array.isArray(wallIds) ? wallIds : []).forEach((id) => {
            if (!uniqueIds.some((candidate) => String(candidate) === String(id))) uniqueIds.push(id);
        });
        if (!uniqueIds.length) return { wallIds: [], walls: [] };
        const walls = uniqueIds.map((id) => {
            const wall = findWall(this.building, id);
            if (!wall) throw new Error(`${label} references missing wall: ${id}`);
            return wall;
        });
        return {
            wallIds: walls.map((wall) => wall.id),
            walls
        };
    }

    applyWallSelection(wallIds, options = {}) {
        const resolved = this.resolveWallSelection(wallIds, "wall selection");
        if (!resolved.wallIds.length) {
            this.selectBuilding();
            return false;
        }
        if (!options.preserveView) {
            this.selectedFloorIds = new Set(resolved.walls.map((wall) => wall.floorId));
            this.layerSelectionMode = "floor";
        }
        this.selection = createSelection("wall", {
            floorId: resolved.walls[0].floorId,
            wallIds: resolved.wallIds
        });
        this.inputs.wallHeight = resolved.walls[0].height;
        this.inputs.wallTexture = resolved.walls[0].wallTexturePath;
        this.inputs.wallThickness = resolved.walls[0].thickness;
        this.emitChange();
        return true;
    }

    selectWalls(wallIds, options = {}) {
        return this.applyWallSelection(wallIds, options);
    }

    addWallsToSelection(wallIds, options = {}) {
        const nextWallIds = [...this.selectedWallIds()];
        (Array.isArray(wallIds) ? wallIds : []).forEach((wallId) => {
            const wall = findWall(this.building, wallId);
            if (!wall) throw new Error(`cannot add missing wall to selection: ${wallId}`);
            if (!nextWallIds.some((id) => String(id) === String(wall.id))) nextWallIds.push(wall.id);
        });
        return this.applyWallSelection(nextWallIds, options);
    }

    removeWallsFromSelection(wallIds, options = {}) {
        const removeIds = new Set((Array.isArray(wallIds) ? wallIds : []).map((id) => String(id)));
        removeIds.forEach((wallId) => {
            if (!findWall(this.building, wallId)) {
                throw new Error(`cannot remove missing wall from selection: ${wallId}`);
            }
        });
        const previousIds = this.selectedWallIds();
        const nextWallIds = previousIds.filter((id) => !removeIds.has(String(id)));
        if (nextWallIds.length === previousIds.length) return false;
        if (nextWallIds.length === 0) {
            const firstRemoved = [...removeIds][0];
            const wall = firstRemoved !== undefined ? findWall(this.building, firstRemoved) : null;
            if (wall) this.selectLevel(wall.floorId, options);
            else this.selectBuilding();
            return true;
        }
        return this.applyWallSelection(nextWallIds, options);
    }

    addWallToSelection(wallId, options = {}) {
        this.addWallsToSelection([wallId], options);
    }

    removeWallFromSelection(wallId, options = {}) {
        return this.removeWallsFromSelection([wallId], options);
    }

    selectWallEndpoint(wallId, endpointKey) {
        if (endpointKey !== "startPoint" && endpointKey !== "endPoint") {
            throw new Error(`unknown wall endpoint: ${endpointKey}`);
        }
        const wall = findWall(this.building, wallId);
        if (!wall) {
            throw new Error(`cannot select endpoint on missing wall: ${wallId}`);
        }
        if (!wall[endpointKey]) {
            throw new Error(`cannot select missing wall endpoint: ${endpointKey}`);
        }
        this.selection = createSelection("wallEndpoint", { floorId: wall.floorId, wallId: wall.id, wallEndpointKey: endpointKey });
        this.inputs.wallHeight = wall.height;
        this.inputs.wallTexture = wall.wallTexturePath;
        this.inputs.wallThickness = wall.thickness;
        this.emitChange();
    }

    selectParentSelection() {
        const selection = this.selection || createSelection("building");
        const preserveView = this.renderStyle() === "exterior";
        switch (selection.kind) {
            case "floorVertex":
                this.selectFloor(selection.floorId, { preserveView });
                return true;
            case "roofVertex":
            case "roofPeak":
            case "roofShedDirection":
                this.selectRoof(selection.floorId, {
                    preserveView,
                    ...(selection.roofId ? { roofId: selection.roofId } : {})
                });
                return true;
            case "wallEndpoint":
                this.selectWall(selection.wallId, { preserveView });
                return true;
            case "mountedObject":
                if (selection.wallId !== null && selection.wallId !== undefined) {
                    this.selectWall(selection.wallId, { preserveView });
                } else if (selection.floorId) {
                    this.selectLevel(selection.floorId, { preserveView });
                } else {
                    this.selectBuilding();
                }
                return true;
            case "gableHandle":
                this.selectGable(selection.floorId, selection.gableId, {
                    preserveView,
                    ...(selection.roofId ? { roofId: selection.roofId } : {})
                });
                return true;
            case "gable":
                this.selectRoof(selection.floorId, {
                    preserveView,
                    ...(selection.roofId ? { roofId: selection.roofId } : {})
                });
                return true;
            case "wall":
            case "floor":
            case "roof":
            case "stair":
                this.selectLevel(selection.floorId, { preserveView });
                return true;
            case "level":
                this.selectBuilding();
                return true;
            case "building":
                return false;
            default:
                if (selection.floorId) {
                    this.selectLevel(selection.floorId, { preserveView });
                    return true;
                }
                this.selectBuilding();
                return true;
        }
    }

    addWall(points) {
        const floor = this.selectedFloor();
        if (!floor) {
            throw new Error("cannot add wall without a selected floor");
        }
        const wallSettings = this.wallCreationSettings();
        const wall = createWall({
            floorId: getFloorId(floor),
            points,
            height: wallSettings.height,
            texture: wallSettings.texture,
            thickness: wallSettings.thickness,
            bottomZ: getFloorElevation(floor),
            traversalLayer: floor.level,
            role: "interior"
        });
        this.building.wallSections.push(wall);
        this.selectWall(wall.id);
        return wall;
    }

    wallCreationSettings() {
        if (this.tool === "wall") {
            return {
                height: this.wallTool.height,
                texture: this.wallTool.texture,
                thickness: this.wallTool.thickness
            };
        }
        return {
            height: this.inputs.wallHeight,
            texture: this.inputs.wallTexture,
            thickness: this.inputs.wallThickness
        };
    }

    addWallBetweenEndpoints(startEndpoint, endEndpoint, options = {}) {
        const floor = this.selectedFloor();
        if (!floor) {
            throw new Error("cannot add wall without a selected floor");
        }
        const wallSettings = this.wallCreationSettings();
        const start = { x: Number(startEndpoint.x), y: Number(startEndpoint.y) };
        const end = { x: Number(endEndpoint.x), y: Number(endEndpoint.y) };
        if (!Number.isFinite(start.x) || !Number.isFinite(start.y) || !Number.isFinite(end.x) || !Number.isFinite(end.y)) {
            throw new Error("wall endpoints must have finite coordinates");
        }
        if (distance(start, end) < 0.000001) {
            throw new Error("wall endpoints must not be coincident");
        }
        const floorId = getFloorId(floor);
        const wall = createWall({
            floorId,
            startPoint: cloneEndpoint(startEndpoint),
            endPoint: cloneEndpoint(endEndpoint),
            height: wallSettings.height,
            texture: wallSettings.texture,
            thickness: wallSettings.thickness,
            bottomZ: getFloorElevation(floor),
            traversalLayer: floor.level,
            role: "interior",
            attachment: null
        });
        syncWallLineBoundaryAttachment(wall);
        this.building.wallSections.push(wall);
        refreshWallSectionEndpoints(this.building, floor);
        if (options.select !== false) {
            this.selectWall(wall.id);
        }
        return wall;
    }

    addMountedWallObject(placement, asset) {
        if (!placement || !placement.floor || (!placement.wall && !placement.gable)) {
            throw new Error("cannot place door or window without a wall or gable placement");
        }
        if (!asset || typeof asset.texturePath !== "string" || asset.texturePath.length === 0) {
            throw new Error("cannot place door or window without a selected asset");
        }
        if (!placement.valid) {
            throw new Error(placement.reason || "door or window does not fit on this wall");
        }
        if (!Array.isArray(this.building.mountedWallObjects)) this.building.mountedWallObjects = [];
        const category = String(asset.category || this.mountedObjectTool.category || "").trim().toLowerCase();
        const object = placement.mountKind === "gable"
            ? createGableMountedObject({
                floorId: getFloorId(placement.floor),
                gableId: placement.gable.id,
                gableSegmentIndex: placement.gableSegmentIndex,
                category,
                texturePath: asset.texturePath,
                wallT: placement.wallT,
                width: asset.width,
                height: asset.height,
                zOffset: placement.zOffset,
                placementRotation: placement.placementRotation,
                mountedWallFacingSign: placement.mountedWallFacingSign,
                placeableAnchorX: asset.anchorX,
                placeableAnchorY: asset.anchorY,
                renderDepthOffset: asset.renderDepthOffset,
                compositeLayers: asset.compositeLayers
            })
            : createWallMountedObject({
                floorId: getFloorId(placement.floor),
                wallId: placement.wall.id,
                category,
                texturePath: asset.texturePath,
                wallT: placement.wallT,
                width: asset.width,
                height: asset.height,
                zOffset: placement.zOffset,
                placementRotation: placement.placementRotation,
                mountedWallFacingSign: placement.mountedWallFacingSign,
                placeableAnchorX: asset.anchorX,
                placeableAnchorY: asset.anchorY,
                renderDepthOffset: asset.renderDepthOffset,
                compositeLayers: asset.compositeLayers
            });
        object.x = Number(placement.faceCenter.x);
        object.y = Number(placement.faceCenter.y);
        object.z = getFloorElevation(placement.floor) + Number(placement.zOffset);
        object.isOpen = asset.isOpen === true;
        object.isPassable = asset.isPassable !== false;
        object.blocksTile = asset.blocksTile === true;
        object.castsLosShadows = asset.castsLosShadows === true;
        object.groundPlaneHitboxOverridePoints = Array.isArray(placement.groundPlaneHitboxOverridePoints)
            ? placement.groundPlaneHitboxOverridePoints.map((point) => ({ x: Number(point.x), y: Number(point.y) }))
            : undefined;
        this.building.mountedWallObjects.push(object);
        this.draft = null;
        this.emitChange();
        return object;
    }

    snapWallEndpoint(point, threshold, options = {}) {
        const floor = this.selectedFloor();
        if (!floor) {
            const prepared = this.preparePoint(point);
            return { point: prepared, endpoint: pointEndpoint(prepared), kind: "point" };
        }
        const floorId = getFloorId(floor);
        const ignoredVertexEndpoint = options.ignoreVertexEndpoint || null;
        const wallSettings = this.wallCreationSettings();
        const snapThickness = Number.isFinite(Number(options.wallThickness))
            ? Number(options.wallThickness)
            : (Number.isFinite(Number(wallSettings.thickness)) ? Number(wallSettings.thickness) : DEFAULTS.wallThickness);
        const directionOriginEndpoint = options.directionOriginEndpoint || null;
        const matchesIgnoredVertex = (endpoint, ringKind = null, holeIndex = -1, vertexId = null) => (
            ignoredVertexEndpoint &&
            isFloorVertexEndpoint(ignoredVertexEndpoint) &&
            endpoint &&
            isFloorVertexEndpoint(endpoint) &&
            endpoint.fragmentId === ignoredVertexEndpoint.fragmentId &&
            endpoint.fragmentId === floorId &&
            endpoint.ring === (ringKind || ignoredVertexEndpoint.ring) &&
            Number(endpoint.holeIndex) === Number(holeIndex ?? ignoredVertexEndpoint.holeIndex) &&
            endpoint.vertexId === (vertexId || ignoredVertexEndpoint.vertexId)
        );
        let best = null;
        const consider = (candidate) => {
            if (!candidate || !Number.isFinite(candidate.distance) || candidate.distance > threshold) return;
            const importance = Number.isFinite(Number(candidate.importance)) && Number(candidate.importance) > 0
                ? Number(candidate.importance)
                : 1;
            const weightedDistance = candidate.distance / importance;
            if (
                !best ||
                weightedDistance < best.weightedDistance - 0.000001 ||
                (Math.abs(weightedDistance - best.weightedDistance) <= 0.000001 && importance > best.importance) ||
                (Math.abs(weightedDistance - best.weightedDistance) <= 0.000001 && importance === best.importance && candidate.distance < best.distance - 0.000001)
            ) {
                best = { ...candidate, importance, weightedDistance };
            }
        };
        const snapLinePointsForRing = (ring) => {
            if (!endpointIsInsetFloorVertex(directionOriginEndpoint) || !endpointMatchesFloorRing(directionOriginEndpoint, ring, floorId)) {
                return ring.points;
            }
            const insetDistance = snapThickness * 0.5;
            const insetRing = offsetRing(ring.points, ring.ringKind === "hole" ? insetDistance : -insetDistance);
            if (!Array.isArray(insetRing) || insetRing.length !== ring.points.length) {
                throw new Error(`wall endpoint snap could not resolve inset line for ${floorId} ${ring.ringKind} ring`);
            }
            return insetRing;
        };

        ringsForFloor(floor).forEach((ring) => {
            ring.points.forEach((vertex) => {
                const baseEndpoint = {
                    fragmentId: floorId,
                    ring: ring.ringKind,
                    holeIndex: ring.holeIndex,
                    vertexId: vertex.id
                };
                const rawEndpoint = { kind: "vertex", ...baseEndpoint };
                if (!matchesIgnoredVertex(rawEndpoint, ring.ringKind, ring.holeIndex, vertex.id)) {
                    const candidatePoint = { x: Number(vertex.x), y: Number(vertex.y) };
                    consider({
                        importance: WALL_SNAP_IMPORTANCE.floorVertex,
                        distance: distance(point, candidatePoint),
                        point: candidatePoint,
                        endpoint: {
                            ...rawEndpoint,
                            x: candidatePoint.x,
                            y: candidatePoint.y
                        },
                        kind: "vertex"
                    });
                }

                const insetEndpoint = { kind: "vertex", inset: true, ...baseEndpoint };
                if (matchesIgnoredVertex(insetEndpoint, ring.ringKind, ring.holeIndex, vertex.id)) return;
                const insetVertex = floorVertexWallInsetPoint(floor, ring.ringKind, ring.holeIndex, vertex.id, snapThickness);
                if (!insetVertex) return;
                const candidatePoint = { x: Number(insetVertex.x), y: Number(insetVertex.y) };
                consider({
                    importance: WALL_SNAP_IMPORTANCE.floorVertex,
                    distance: distance(point, candidatePoint),
                    point: candidatePoint,
                    endpoint: {
                        ...insetEndpoint,
                        x: candidatePoint.x,
                        y: candidatePoint.y
                    },
                    kind: "vertex"
                });
            });
        });

        getBuildingWalls(this.building).forEach((wall) => {
            if ((wall.fragmentId || wall.floorId) !== floorId) return;
            if (Number(options.ignoreWallId) === Number(wall.id)) return;
            const points = wallPoints(this.building, wall);
            if (points.length !== 2) return;
            [
                { endpoint: wall.startPoint, point: points[0] },
                { endpoint: wall.endPoint, point: points[1] }
            ].forEach((entry) => {
                const candidatePoint = { x: Number(entry.point.x), y: Number(entry.point.y) };
                const endpoint = isFloorVertexEndpoint(entry.endpoint)
                    ? cloneEndpoint(entry.endpoint)
                    : pointEndpoint(candidatePoint);
                consider({
                    importance: WALL_SNAP_IMPORTANCE.wallEndpoint,
                    distance: distance(point, candidatePoint),
                    point: candidatePoint,
                    endpoint,
                    kind: "wallEndpoint"
                });
            });
        });

        ringsForFloor(floor).forEach((ring) => {
            const snapLinePoints = snapLinePointsForRing(ring);
            for (let index = 0; index < ring.points.length; index++) {
                const a = snapLinePoints[index];
                const b = snapLinePoints[(index + 1) % snapLinePoints.length];
                const candidatePoint = closestPointOnSegment(point, a, b);
                if (distance(candidatePoint, a) <= threshold || distance(candidatePoint, b) <= threshold) continue;
                if (pointIsNearNonIgnoredSegmentEndpoint(candidatePoint, a, b, threshold, ignoredVertexEndpoint, ring, floorId)) continue;
                consider({
                    importance: WALL_SNAP_IMPORTANCE.floorEdge,
                    distance: distanceToSegment(point, a, b),
                    point: candidatePoint,
                    endpoint: {
                        kind: "edge",
                        fragmentId: floorId,
                        ring: ring.ringKind,
                        holeIndex: ring.holeIndex,
                        boundaryPoint: options.boundaryPointEdgeSnap === true,
                        x: candidatePoint.x,
                        y: candidatePoint.y
                    },
                    kind: "edge"
                });
            }
        });

        const result = best
            ? { point: best.point, endpoint: best.endpoint, kind: best.kind }
            : (() => {
                const prepared = this.preparePoint(point);
                return { point: prepared, endpoint: pointEndpoint(prepared), kind: "point" };
            })();
        return this.applyDirectionSnapToEndpoint(result, options.directionOrigin);
    }

    applyDirectionSnapToEndpoint(result, origin) {
        if (!this.snapDirection || !origin || !result || !result.point) return result;
        const snappedPoint = snapPointToCanonicalDirection(origin, result.point);
        if (distance(snappedPoint, result.point) <= 0.000001) return result;
        return {
            point: snappedPoint,
            endpoint: pointEndpoint(snappedPoint),
            kind: "point"
        };
    }

    pickWallEndpoint(point, threshold) {
        const selectedWall = this.selectedWall();
        if (!selectedWall) return null;
        let best = null;
        [selectedWall].forEach((wall) => {
            const points = wallPoints(this.building, wall);
            if (points.length !== 2) return;
            [
                { endpointKey: "startPoint", point: points[0] },
                { endpointKey: "endPoint", point: points[1] }
            ].forEach((entry) => {
                const d = distance(point, entry.point);
                if (d <= threshold && (!best || d < best.distance)) {
                    best = { wall, endpointKey: entry.endpointKey, point: entry.point, distance: d };
                }
            });
        });
        return best;
    }

    moveSelectedWallEndpoint(point, threshold, options = {}) {
        const wall = this.selectedWall();
        const endpointKey = this.selection.wallEndpointKey;
        if (!wall || (endpointKey !== "startPoint" && endpointKey !== "endPoint")) return false;
        const detachVertexEndpoint = options.detachVertexEndpoint === true ||
            (wall.role === "perimeter" && isFloorVertexEndpoint(wall[endpointKey]));
        const previousEndpoint = cloneEndpoint(wall[endpointKey]);
        const currentPoints = wallPoints(this.building, wall);
        const directionOrigin = currentPoints.length === 2
            ? (endpointKey === "startPoint" ? currentPoints[1] : currentPoints[0])
            : null;
        const directionOriginEndpoint = endpointKey === "startPoint" ? wall.endPoint : wall.startPoint;
        const nextEndpoint = this.snapWallEndpoint(point, threshold, {
            ignoreWallId: wall.id,
            ignoreVertexEndpoint: detachVertexEndpoint ? previousEndpoint : null,
            directionOrigin,
            directionOriginEndpoint,
            wallThickness: wall.thickness,
            boundaryPointEdgeSnap: true
        }).endpoint;
        const previousAttachment = wall.attachment ? JSON.parse(JSON.stringify(wall.attachment)) : null;
        const previousRole = wall.role;
        if (detachVertexEndpoint && wall.role === "perimeter") {
            wall.role = "interior";
            wall.attachment = null;
        }
        wall[endpointKey] = cloneEndpoint(nextEndpoint);
        const points = wallPoints(this.building, wall);
        if (points.length !== 2 || distance(points[0], points[1]) < 0.000001) {
            wall[endpointKey] = previousEndpoint;
            wall.attachment = previousAttachment;
            wall.role = previousRole;
            return false;
        }
        syncWallLineBoundaryAttachment(wall);
        const floor = findFloor(this.building, wall.fragmentId || wall.floorId);
        if (!floor) throw new Error(`selected wall has missing floor: ${wall.floorId}`);
        refreshWallSectionEndpoints(this.building, floor);
        this.emitChange();
        return true;
    }

    reflowFloorsAbove(floor) {
        const floors = [...getBuildingFloors(this.building)].sort((a, b) => getFloorElevation(a) - getFloorElevation(b));
        const startIndex = floors.findIndex((candidate) => getFloorId(candidate) === getFloorId(floor));
        if (startIndex < 0) throw new Error(`cannot reflow stack from missing floor: ${getFloorId(floor)}`);
        const changedFloors = new Set([getFloorId(floor)]);
        for (let index = startIndex + 1; index < floors.length; index++) {
            const previous = floors[index - 1];
            const nextElevation = getFloorElevation(previous) + Number(previous.floorHeight);
            if (!Number.isFinite(nextElevation)) {
                throw new Error(`cannot reflow floor above ${getFloorId(previous)} without finite floor height`);
            }
            if (Math.abs(getFloorElevation(floors[index]) - nextElevation) > 0.000001) {
                setFloorElevation(floors[index], nextElevation);
                changedFloors.add(getFloorId(floors[index]));
            }
        }
        this.building.floorFragments.sort((a, b) => getFloorElevation(a) - getFloorElevation(b));
        getBuildingFloors(this.building).forEach((candidateFloor) => {
            if (changedFloors.has(getFloorId(candidateFloor))) {
                refreshWallSectionEndpoints(this.building, candidateFloor);
            }
        });
    }

    duplicateSelectedFloor() {
        const source = this.selectedFloor();
        if (!source) throw new Error("cannot duplicate floor without a selected floor");
        const sourceElevation = getFloorElevation(source);
        const duplicateHeight = Number(source.floorHeight);
        if (!Number.isFinite(duplicateHeight) || duplicateHeight <= 0) {
            throw new Error("cannot duplicate floor without a positive floor height");
        }
        getBuildingFloors(this.building).forEach((floor) => {
            if (getFloorElevation(floor) > sourceElevation) {
                setFloorElevation(floor, getFloorElevation(floor) + duplicateHeight);
            }
        });
        const floor = duplicateFloor(this.building, getFloorId(source), sourceElevation + Number(source.floorHeight));
        this.building.floorFragments.sort((a, b) => getFloorElevation(a) - getFloorElevation(b));
        getBuildingFloors(this.building).forEach((candidateFloor) => refreshWallSectionEndpoints(this.building, candidateFloor));
        this.selectFloor(getFloorId(floor));
        return floor;
    }

    duplicateSelectedFloorAtElevation(elevation) {
        const source = this.selectedFloor();
        if (!source) throw new Error("cannot duplicate floor without a selected floor");
        const floor = duplicateFloor(this.building, getFloorId(source), Number(elevation));
        this.selectFloor(getFloorId(floor));
        return floor;
    }

    deleteFloor(floorId) {
        const floor = findFloor(this.building, floorId);
        if (!floor) throw new Error(`cannot delete missing floor: ${floorId}`);
        const deletedFloorId = getFloorId(floor);
        const deletedElevation = getFloorElevation(floor);
        this.building.floorFragments = getBuildingFloors(this.building)
            .filter((candidate) => getFloorId(candidate) !== deletedFloorId);
        this.building.wallSections = getBuildingWalls(this.building)
            .filter((wall) => wall.floorId !== deletedFloorId && wall.fragmentId !== deletedFloorId);
        this.building.mountedWallObjects = getBuildingMountedObjects(this.building)
            .filter((object) => object.floorId !== deletedFloorId);
        this.selectedFloorIds.delete(deletedFloorId);

        const remainingFloors = getBuildingFloors(this.building);
        if (!remainingFloors.length) {
            this.selectedFloorIds = new Set();
            this.layerSelectionMode = "floor";
            this.selection = createSelection("building");
            this.draft = null;
            this.floorVertexDrag = null;
            this.emitChange();
            return true;
        }

        const floorBelow = [...remainingFloors]
            .filter((candidate) => getFloorElevation(candidate) < deletedElevation)
            .sort((a, b) => getFloorElevation(b) - getFloorElevation(a))[0] || null;
        if (floorBelow) {
            this.reflowFloorsAbove(floorBelow);
        }

        if (this.layerSelectionMode === "all") {
            this.selectedFloorIds = new Set(getBuildingFloors(this.building).map((candidate) => getFloorId(candidate)));
            const primaryFloor = remainingFloors[0];
            this.selection = createSelection("building");
            this.inputs.floorElevation = getFloorElevation(primaryFloor);
            this.inputs.floorHeight = primaryFloor.floorHeight;
            this.inputs.floorTexture = primaryFloor.floorTexturePath;
            const primaryRoof = getFloorRoof(primaryFloor);
            if (primaryRoof) {
                this.inputs.roofTexture = primaryRoof.texturePath;
                this.inputs.roofMode = primaryRoof.mode || DEFAULTS.roofMode;
                this.inputs.roofOverhang = primaryRoof.overhang;
                this.inputs.roofPeakHeight = primaryRoof.peakHeight;
                this.inputs.roofDomeLevels = getRoofDomeLevels(primaryRoof);
            }
            this.inputs.wallHeight = primaryFloor.defaultWallHeight;
            this.inputs.wallTexture = primaryFloor.defaultWallTexturePath;
            this.inputs.wallThickness = Number.isFinite(Number(this.building.defaults && this.building.defaults.wallThickness))
                ? Number(this.building.defaults.wallThickness)
                : DEFAULTS.wallThickness;
            this.draft = null;
            this.floorVertexDrag = null;
            this.emitChange();
            return true;
        }

        const currentFloor = findFloor(this.building, this.selection.floorId);
        if (currentFloor && this.selectedFloorIds.has(getFloorId(currentFloor))) {
            this.draft = null;
            this.floorVertexDrag = null;
            this.emitChange();
            return true;
        }
        this.selectFloor(getFloorId(remainingFloors[0]));
        return true;
    }

    updateSelectedFloorElevation(value) {
        const floor = this.selectedFloor();
        if (!floor) throw new Error("cannot update elevation without a selected floor");
        const elevation = Number(value);
        if (!Number.isFinite(elevation)) {
            throw new Error("floor elevation must be a finite number");
        }
        setFloorElevation(floor, elevation);
        this.building.floorFragments.sort((a, b) => getFloorElevation(a) - getFloorElevation(b));
        refreshWallSectionEndpoints(this.building, floor);
        this.inputs.floorElevation = elevation;
        if (this.tool === "stair") this.syncStairToolDirectionWithFloor(floor, { emit: false });
        this.emitChange();
    }

    updatePolygonToolElevation(value) {
        const elevation = Number(value);
        if (!Number.isFinite(elevation)) {
            throw new Error("polygon elevation must be a finite number");
        }
        this.polygonToolElevation = elevation;
        if (this.draft && this.draft.kind === "polygonEdit") {
            this.draft.elevation = elevation;
        }
        this.emitChange();
    }

    updateSelectedFloorHeight(value) {
        const floor = this.selectedFloor();
        if (!floor) throw new Error("cannot update floor height without a selected floor");
        const height = Number(value);
        if (!Number.isFinite(height) || height <= 0) {
            throw new Error("floor height must be a positive number");
        }
        const previousHeight = Number(floor.floorHeight);
        floor.floorHeight = height;
        getBuildingWalls(this.building).forEach((wall) => {
            if ((wall.fragmentId || wall.floorId) !== getFloorId(floor)) return;
            if (Math.abs(Number(wall.height) - previousHeight) <= 0.000001) {
                wall.height = height;
            }
        });
        this.reflowFloorsAbove(floor);
        this.inputs.floorHeight = height;
        this.emitChange();
    }

    updateSelectedWallHeight(value) {
        const height = Number(value);
        if (!Number.isFinite(height) || height <= 0) {
            throw new Error("wall height must be a positive number");
        }
        if (this.tool === "wall") {
            this.updateWallToolHeight(height);
            return;
        }
        const walls = this.selectedWalls();
        if (walls.length > 0) {
            walls.forEach((wall) => {
                wall.height = height;
            });
        } else {
            const floor = this.selectedFloor();
            if (!floor) throw new Error("cannot update wall defaults without a selected floor");
            floor.defaultWallHeight = height;
        }
        this.inputs.wallHeight = height;
        this.emitChange();
    }

    updateSelectedWallThickness(value) {
        const thickness = normalizeEditorWallThickness(value, "wall thickness");
        if (this.tool === "wall") {
            this.updateWallToolThickness(thickness);
            return;
        }
        const walls = this.selectedWalls();
        if (!walls.length) {
            throw new Error("cannot update wall thickness without a selected wall");
        }
        walls.forEach((wall) => {
            wall.thickness = thickness;
            const floor = findFloor(this.building, wall.fragmentId || wall.floorId);
            if (floor) refreshWallSectionEndpoints(this.building, floor);
        });
        this.inputs.wallThickness = thickness;
        this.emitChange();
    }

    updateSelectedWallVertexInset(inset) {
        const walls = this.selectedWalls();
        if (!walls.length || !walls.every((wall) => wallHasFloorVertexEndpoint(wall))) {
            throw new Error("cannot change vertex inset without selected walls that have vertex endpoints");
        }
        const changedFloorIds = new Set();
        walls.forEach((wall) => {
            ["startPoint", "endPoint"].forEach((endpointKey) => {
                const endpoint = wall[endpointKey];
                if (!isFloorVertexEndpoint(endpoint)) return;
                endpoint.kind = "vertex";
                if (inset === true) {
                    endpoint.inset = true;
                } else {
                    endpoint.inset = false;
                }
            });
            changedFloorIds.add(wall.fragmentId || wall.floorId);
        });
        changedFloorIds.forEach((floorId) => {
            const floor = findFloor(this.building, floorId);
            if (floor) refreshWallSectionEndpoints(this.building, floor);
        });
        this.emitChange();
    }

    updateSelectedWallTexture(texture) {
        if (this.tool === "wall") {
            this.updateWallToolTexture(texture);
            return;
        }
        const walls = this.selectedWalls();
        if (walls.length > 0) {
            walls.forEach((wall) => {
                wall.wallTexturePath = texture;
            });
        } else {
            const floor = this.selectedFloor();
            if (!floor) throw new Error("cannot update wall defaults without a selected floor");
            floor.defaultWallTexturePath = texture;
        }
        this.inputs.wallTexture = texture;
        this.paintTextures.walls = texture;
        this.emitChange();
    }

    updateSelectedFloorTexture(texture) {
        const floor = this.selectedFloor();
        if (!floor) throw new Error("cannot update floor texture without a selected floor");
        floor.floorTexturePath = texture;
        this.inputs.floorTexture = texture;
        this.paintTextures.floor = texture;
        this.emitChange();
    }

    updateSelectedRoofTexture(texture) {
        const entries = this.editableRoofEntries("cannot update roof texture");
        if (!entries.length) throw new Error("cannot update roof texture without a selected roof");
        entries.forEach(({ roof }) => {
            roof.texturePath = texture;
        });
        this.inputs.roofTexture = texture;
        this.paintTextures.roofs = texture;
        this.emitChange();
    }

    updateRoofToolTexture(texture) {
        if (typeof texture !== "string" || texture.length === 0) {
            throw new Error("roof tool texture path must be a non-empty string");
        }
        this.inputs.roofTexture = texture;
        this.paintTextures.roofs = texture;
        this.emitChange();
    }

    updateRoofToolMode(value) {
        const mode = String(value || "").trim().toLowerCase();
        if (mode !== "peak" && mode !== "shed" && mode !== "gabled" && mode !== "dome") {
            throw new Error(`unknown roof mode: ${value}`);
        }
        this.inputs.roofMode = mode;
        this.emitChange();
    }

    updateRoofToolOverhang(value) {
        const overhang = Number(value);
        if (!Number.isFinite(overhang)) {
            throw new Error("roof overhang must be a finite number");
        }
        this.inputs.roofOverhang = overhang;
        this.emitChange();
    }

    updateRoofToolPeakHeight(value) {
        const peakHeight = Number(value);
        if (!Number.isFinite(peakHeight) || peakHeight < 0) {
            throw new Error("roof peak height must be zero or greater");
        }
        this.inputs.roofPeakHeight = peakHeight;
        this.emitChange();
    }

    updateRoofToolDomeLevels(value) {
        const levels = Math.floor(Number(value));
        if (!Number.isInteger(levels) || levels < 1) {
            throw new Error("roof dome levels must be a positive integer");
        }
        this.inputs.roofDomeLevels = levels;
        this.emitChange();
    }

    updateSelectedRoofMode(value) {
        const entries = this.editableRoofEntries("cannot update roof mode");
        const mode = String(value || "").trim().toLowerCase();
        if (mode !== "peak" && mode !== "shed" && mode !== "gabled" && mode !== "dome") {
            throw new Error(`unknown roof mode: ${value}`);
        }
        const changedFloorIds = new Set();
        entries.forEach(({ floor, roof }) => {
            roof.mode = mode;
            if (mode !== "peak") {
                roof.gables = [];
                changedFloorIds.add(getFloorId(floor));
            }
            if (mode === "shed" || mode === "gabled") {
                roof.shedDirection = getRoofShedDirection(roof);
            }
            if (mode === "dome") {
                roof.domeLevels = getRoofDomeLevels(roof);
            }
        });
        if (changedFloorIds.size > 0) {
            this.building.mountedWallObjects = getBuildingMountedObjects(this.building)
                .filter((object) => object.mountKind !== "gable" || !changedFloorIds.has(String(object.floorId)));
        }
        this.inputs.roofMode = mode;
        this.emitChange();
    }

    updateSelectedRoofOverhang(value) {
        const entries = this.editableRoofEntries("cannot update roof overhang");
        if (!entries.length) throw new Error("cannot update roof overhang without a selected roof");
        const overhang = Number(value);
        if (!Number.isFinite(overhang)) {
            throw new Error("roof overhang must be a finite number");
        }
        if (overhang < 0 && entries.some(({ roof }) => getRoofGables(roof).length > 0)) {
            throw new Error("roof gables cannot be used with negative overhang yet");
        }
        entries.forEach(({ roof }) => {
            roof.overhang = overhang;
        });
        this.inputs.roofOverhang = overhang;
        this.emitChange();
    }

    updateSelectedRoofPeakHeight(value) {
        const entries = this.editableRoofEntries("cannot update roof peak height");
        if (!entries.length) throw new Error("cannot update roof peak height without a selected roof");
        const peakHeight = Number(value);
        if (!Number.isFinite(peakHeight) || peakHeight < 0) {
            throw new Error("roof peak height must be zero or greater");
        }
        if (peakHeight <= 0 && entries.some(({ roof }) => getRoofGables(roof).length > 0)) {
            throw new Error("roof gables require positive peak height");
        }
        entries.forEach(({ roof }) => {
            roof.peakHeight = peakHeight;
            getRoofGables(roof).forEach((gable) => {
                gable.height = Math.min(Number(gable.height), peakHeight);
            });
        });
        this.inputs.roofPeakHeight = peakHeight;
        this.emitChange();
    }

    updateSelectedRoofDomeLevels(value) {
        const entries = this.editableRoofEntries("cannot update roof dome levels");
        if (!entries.length) throw new Error("cannot update roof dome levels without a selected roof");
        const levels = Math.floor(Number(value));
        if (!Number.isInteger(levels) || levels < 1) {
            throw new Error("roof dome levels must be a positive integer");
        }
        entries.forEach(({ roof }) => {
            roof.domeLevels = levels;
        });
        this.inputs.roofDomeLevels = levels;
        this.emitChange();
    }

    moveSelectedRoofsVerticalDelta(originalOffsets, deltaZ, options = {}) {
        const originalKey = (entry) => `${String(entry.floorId)}:${String(entry.roofId || "")}`;
        const originalsByKey = new Map((Array.isArray(originalOffsets) ? originalOffsets : [])
            .map((entry) => [originalKey(entry), normalizeRoofElevationOffset(entry.elevationOffset, "roof drag starting elevation offset")]));
        if (!originalsByKey.size) throw new Error("roof drag requires starting offsets");
        const snapDistance = Number.isFinite(Number(options.snapDistance)) ? Math.max(0, Number(options.snapDistance)) : 0;
        this.selectedRoofEntries().forEach(({ floor, roof }) => {
            const key = originalKey({ floorId: getFloorId(floor), roofId: roof && roof.id });
            const fallbackKey = originalKey({ floorId: getFloorId(floor), roofId: "" });
            const offsetKey = originalsByKey.has(key) ? key : fallbackKey;
            if (!originalsByKey.has(offsetKey)) throw new Error(`roof drag is missing starting offset for ${key}`);
            let nextOffset = originalsByKey.get(offsetKey) + Number(deltaZ);
            if (!Number.isFinite(nextOffset)) throw new Error("roof drag produced a non-finite elevation offset");
            if (snapDistance > 0 && Math.abs(nextOffset) <= snapDistance) nextOffset = 0;
            roof.elevationOffset = nextOffset;
        });
        this.updateRoofEdgeAttachedContactVertices();
        this.emitChange();
    }

    paintRoof(floorOrId, texture, options = {}) {
        const floor = typeof floorOrId === "string" ? findFloor(this.building, floorOrId) : floorOrId;
        if (!floor) throw new Error("cannot paint missing roof");
        const roof = findFloorRoof(floor, options.roofId);
        if (!roof) throw new Error("cannot paint missing roof");
        roof.texturePath = texture;
        this.inputs.roofTexture = texture;
        this.paintTextures.roofs = texture;
        this.selection = createSelection("roof", {
            floorId: getFloorId(floor),
            ...(options.roofId ? { roofId: String(options.roofId) } : {})
        });
        this.selectedFloorIds = new Set([getFloorId(floor)]);
        this.layerSelectionMode = "floor";
        this.emitChange();
    }

    paintFloor(floorOrId, texture) {
        const floor = typeof floorOrId === "string" ? findFloor(this.building, floorOrId) : floorOrId;
        if (!floor) throw new Error("cannot paint missing floor");
        floor.floorTexturePath = texture;
        this.inputs.floorTexture = texture;
        this.paintTextures.floor = texture;
        this.selection = createSelection("floor", { floorId: getFloorId(floor) });
        this.selectedFloorIds = new Set([getFloorId(floor)]);
        this.layerSelectionMode = "floor";
        this.emitChange();
    }

    paintWall(wallId, texture) {
        const wall = findWall(this.building, wallId);
        if (!wall) throw new Error(`cannot paint missing wall: ${wallId}`);
        wall.wallTexturePath = texture;
        this.inputs.wallTexture = texture;
        this.paintTextures.walls = texture;
        this.selectWall(wall.id);
    }

    moveFootprintVertex(floorId, vertexIndex, point) {
        const floor = findFloor(this.building, floorId);
        if (!floor) throw new Error(`cannot edit missing floor: ${floorId}`);
        if (!floor.outerPolygon[vertexIndex]) {
            throw new Error(`cannot edit missing footprint vertex: ${vertexIndex}`);
        }
        floor.outerPolygon[vertexIndex] = { ...floor.outerPolygon[vertexIndex], ...this.preparePoint(point) };
        refreshWallSectionEndpoints(this.building, floor);
        this.emitChange();
    }

    selectFloorVertex(floorId, ringKind, holeIndex, vertexIndex, options = {}) {
        const floor = findFloor(this.building, floorId);
        if (!floor) throw new Error(`cannot select vertex on missing floor: ${floorId}`);
        const ring = getFloorRing(floor, ringKind, holeIndex);
        if (!Array.isArray(ring) || !ring[vertexIndex]) {
            throw new Error(`cannot select missing floor vertex: ${vertexIndex}`);
        }
        const selectedFloorId = getFloorId(floor);
        if (!options.preserveView) {
            this.selectedFloorIds = new Set([selectedFloorId]);
            this.layerSelectionMode = "floor";
        }
        this.selection = createSelection("floorVertex", { floorId: selectedFloorId, ringKind, holeIndex, vertexIndex });
        this.emitChange();
    }

    clearVertexSelection() {
        const floor = this.selectedFloor();
        if (floor) {
            this.selection = createSelection("floor", { floorId: getFloorId(floor) });
            this.floorVertexDrag = null;
            this.emitChange();
        }
    }

    beginFloorVertexDrag() {
        const floor = this.selectedFloor();
        const selection = this.selection;
        if (!floor || !selection.ringKind || selection.vertexIndex < 0) {
            this.floorVertexDrag = null;
            return null;
        }
        const ring = getFloorRing(floor, selection.ringKind, selection.holeIndex);
        const vertex = Array.isArray(ring) ? ring[selection.vertexIndex] : null;
        if (!vertex) {
            throw new Error("cannot begin drag for missing floor vertex");
        }
        const origin = { x: Number(vertex.x), y: Number(vertex.y) };
        const baseElevation = getFloorElevation(floor);
        const linkedVertices = [];
        getBuildingFloors(this.building)
            .filter((candidateFloor) => getFloorElevation(candidateFloor) > baseElevation)
            .sort((a, b) => getFloorElevation(a) - getFloorElevation(b))
            .forEach((candidateFloor) => {
                const candidateRing = getFloorRing(candidateFloor, selection.ringKind, selection.holeIndex);
                if (!Array.isArray(candidateRing)) return;
                const candidateIndex = candidateRing.findIndex((candidateVertex) => sameXY(candidateVertex, origin));
                if (candidateIndex < 0) return;
                linkedVertices.push({
                    floor: candidateFloor,
                    floorId: getFloorId(candidateFloor),
                    ringKind: selection.ringKind,
                    holeIndex: selection.holeIndex,
                    vertexIndex: candidateIndex,
                    origin: {
                        x: Number(candidateRing[candidateIndex].x),
                        y: Number(candidateRing[candidateIndex].y)
                    }
                });
            });
        this.floorVertexDrag = {
            floorId: getFloorId(floor),
            ringKind: selection.ringKind,
            holeIndex: selection.holeIndex,
            vertexIndex: selection.vertexIndex,
            origin,
            linkedVertices
        };
        return this.floorVertexDrag;
    }

    endFloorVertexDrag() {
        this.floorVertexDrag = null;
    }

    moveSelectedFloorVertex(point) {
        const floor = this.selectedFloor();
        const selection = this.selection;
        if (!floor || !selection.ringKind || selection.vertexIndex < 0) return false;
        const ring = getFloorRing(floor, selection.ringKind, selection.holeIndex);
        if (!Array.isArray(ring) || !ring[selection.vertexIndex]) {
            throw new Error("selected floor vertex is no longer valid");
        }
        const nextRing = ring.map((vertex, index) => (
            index === selection.vertexIndex ? { ...vertex, ...this.preparePoint(point) } : { ...vertex }
        ));
        const movedPoint = nextRing[selection.vertexIndex];
        const activeDrag = this.floorVertexDrag &&
            this.floorVertexDrag.floorId === getFloorId(floor) &&
            this.floorVertexDrag.ringKind === selection.ringKind &&
            Number(this.floorVertexDrag.holeIndex) === Number(selection.holeIndex) &&
            Number(this.floorVertexDrag.vertexIndex) === Number(selection.vertexIndex)
            ? this.floorVertexDrag
            : null;
        const ringUpdates = [{
            floor,
            floorId: getFloorId(floor),
            ringKind: selection.ringKind,
            holeIndex: selection.holeIndex,
            ring: nextRing
        }];
        const changedFloors = new Set([getFloorId(floor)]);
        if (activeDrag) {
            const dx = Number(movedPoint.x) - Number(activeDrag.origin.x);
            const dy = Number(movedPoint.y) - Number(activeDrag.origin.y);
            activeDrag.linkedVertices.forEach((linked) => {
                const linkedRing = getFloorRing(linked.floor, linked.ringKind, linked.holeIndex);
                if (!Array.isArray(linkedRing) || !linkedRing[linked.vertexIndex]) return;
                const linkedNextRing = linkedRing.map((vertex, index) => (
                    index === linked.vertexIndex
                        ? { ...vertex, x: Number(linked.origin.x) + dx, y: Number(linked.origin.y) + dy }
                        : { ...vertex }
                ));
                ringUpdates.push({
                    floor: linked.floor,
                    floorId: linked.floorId,
                    ringKind: linked.ringKind,
                    holeIndex: linked.holeIndex,
                    ring: linkedNextRing
                });
                changedFloors.add(linked.floorId);
            });
        }
        ringUpdates.forEach((update) => {
            const error = simplePolygonRingError(update.ring, `floor ${update.floorId} ${update.ringKind} polygon`);
            if (error) throw new Error(`cannot move floor vertex: ${error}`);
        });
        ringUpdates.forEach((update) => {
            setFloorRing(update.floor, update.ringKind, update.holeIndex, update.ring);
        });
        if (selection.ringKind === "outer") {
            getBuildingFloors(this.building).forEach((candidateFloor) => {
                if (changedFloors.has(getFloorId(candidateFloor))) {
                    refreshWallSectionEndpoints(this.building, candidateFloor);
                }
            });
        }
        this.emitChange();
        return true;
    }

    floorsAbove(floor) {
        const baseElevation = getFloorElevation(floor);
        return getBuildingFloors(this.building)
            .filter((candidateFloor) => getFloorElevation(candidateFloor) > baseElevation)
            .sort((a, b) => getFloorElevation(a) - getFloorElevation(b));
    }

    refreshChangedFloorWalls(changedFloorIds) {
        getBuildingFloors(this.building).forEach((candidateFloor) => {
            const floorId = getFloorId(candidateFloor);
            if (!changedFloorIds.has(floorId)) return;
            createPerimeterWallsForFloor(this.building, candidateFloor);
            refreshWallSectionEndpoints(this.building, candidateFloor);
        });
    }

    propagateInsertedFloorVertex(floor, ringKind, holeIndex, edgeStart, edgeEnd, point) {
        const changedFloorIds = new Set();
        this.floorsAbove(floor).forEach((candidateFloor) => {
            const candidateRing = getFloorRing(candidateFloor, ringKind, holeIndex);
            const edgeIndex = findMatchingDirectedEdgeIndex(candidateRing, edgeStart, edgeEnd);
            if (edgeIndex < 0) return;
            const candidateEdgeStart = candidateRing[edgeIndex];
            const candidateEdgeEnd = candidateRing[(edgeIndex + 1) % candidateRing.length];
            const result = insertVertexOnRingEdge(candidateRing, edgeIndex, point);
            setFloorRing(candidateFloor, ringKind, holeIndex, result.ring);
            if (ringKind === "outer") {
                const updatedRing = getFloorRing(candidateFloor, ringKind, holeIndex);
                splitPerimeterWallAtVertex(
                    this.building,
                    candidateFloor,
                    candidateEdgeStart,
                    updatedRing[result.vertexIndex],
                    candidateEdgeEnd
                );
            }
            changedFloorIds.add(getFloorId(candidateFloor));
        });
        return changedFloorIds;
    }

    propagateDeletedFloorVertex(floor, ringKind, holeIndex, previousPoint, deletedPoint, nextPoint) {
        const changedFloorIds = new Set();
        this.floorsAbove(floor).forEach((candidateFloor) => {
            const candidateRing = getFloorRing(candidateFloor, ringKind, holeIndex);
            const vertexIndex = findMatchingVertexWithNeighbors(candidateRing, previousPoint, deletedPoint, nextPoint);
            if (vertexIndex < 0 || candidateRing.length <= 3) return;
            const candidatePreviousPoint = candidateRing[previousRingIndex(candidateRing, vertexIndex)];
            const candidateDeletedVertex = candidateRing[vertexIndex];
            const candidateNextPoint = candidateRing[nextRingIndex(candidateRing, vertexIndex)];
            if (ringKind === "outer" && candidateDeletedVertex && candidateDeletedVertex.id) {
                fallbackDeletedVertexEndpointsToPoint(this.building, getFloorId(candidateFloor), candidateDeletedVertex.id);
            }
            const nextRing = candidateRing
                .filter((_point, index) => index !== vertexIndex)
                .map((point) => ({ ...point, x: Number(point.x), y: Number(point.y) }));
            setFloorRing(candidateFloor, ringKind, holeIndex, nextRing);
            if (ringKind === "outer") {
                mergePerimeterWallsAcrossDeletedVertex(
                    this.building,
                    candidateFloor,
                    candidatePreviousPoint,
                    candidateDeletedVertex,
                    candidateNextPoint
                );
            }
            changedFloorIds.add(getFloorId(candidateFloor));
        });
        return changedFloorIds;
    }

    insertFloorVertexOnKnownEdge(floorId, ringKind, holeIndex, insertAfterIndex, point) {
        const floor = findFloor(this.building, floorId);
        if (!floor) throw new Error(`cannot insert vertex on missing floor: ${floorId}`);
        const points = getFloorRing(floor, ringKind, holeIndex);
        if (!Array.isArray(points) || points.length < 3) {
            throw new Error(`cannot insert vertex on missing ${ringKind} ring`);
        }
        const edgeIndex = Math.floor(Number(insertAfterIndex));
        if (!Number.isInteger(edgeIndex) || edgeIndex < 0 || edgeIndex >= points.length) {
            throw new Error(`cannot insert vertex on missing edge: ${insertAfterIndex}`);
        }
        const preparedPoint = this.preparePoint(point);
        const edgeStart = points[edgeIndex];
        const edgeEnd = points[(edgeIndex + 1) % points.length];
        const result = insertVertexOnRingEdge(points, edgeIndex, preparedPoint);
        setFloorRing(floor, ringKind, holeIndex, result.ring);
        const changedFloorIds = new Set([getFloorId(floor)]);
        if (ringKind === "outer") {
            const updatedRing = getFloorRing(floor, ringKind, holeIndex);
            splitPerimeterWallAtVertex(this.building, floor, edgeStart, updatedRing[result.vertexIndex], edgeEnd);
        }
        this.propagateInsertedFloorVertex(floor, ringKind, holeIndex, edgeStart, edgeEnd, preparedPoint)
            .forEach((changedFloorId) => changedFloorIds.add(changedFloorId));
        if (ringKind === "outer") {
            getBuildingFloors(this.building).forEach((candidateFloor) => {
                if (changedFloorIds.has(getFloorId(candidateFloor))) {
                    refreshWallSectionEndpoints(this.building, candidateFloor);
                }
            });
        }
        this.selection = createSelection("floorVertex", {
            floorId: getFloorId(floor),
            ringKind,
            holeIndex,
            vertexIndex: result.vertexIndex
        });
        this.emitChange();
        return true;
    }

    insertFloorVertexOnEdge(point, threshold) {
        const floor = this.selectedFloor();
        if (!floor) return false;
        const hit = findRingEdgeAtPoint(floor, point, threshold);
        if (!hit) return false;
        return this.insertFloorVertexOnKnownEdge(
            getFloorId(floor),
            hit.ringKind,
            hit.holeIndex,
            hit.insertAfterIndex,
            hit.point
        );
    }

    insertFloorVertexNearSelected(point) {
        const floor = this.selectedFloor();
        const selection = this.selection;
        if (!floor || !selection.ringKind || selection.vertexIndex < 0) return false;
        const ring = getFloorRing(floor, selection.ringKind, selection.holeIndex);
        if (!Array.isArray(ring)) return false;
        const preparedPoint = this.preparePoint(point);
        const selectedIndex = Math.floor(Number(selection.vertexIndex));
        const prevIndex = previousRingIndex(ring, selectedIndex);
        const nextIndex = nextRingIndex(ring, selectedIndex);
        const splitPrevEdge = (
            (Number(preparedPoint.x) - Number(ring[prevIndex].x)) ** 2 +
            (Number(preparedPoint.y) - Number(ring[prevIndex].y)) ** 2
        ) <= (
            (Number(preparedPoint.x) - Number(ring[nextIndex].x)) ** 2 +
            (Number(preparedPoint.y) - Number(ring[nextIndex].y)) ** 2
        );
        const edgeStart = splitPrevEdge ? ring[prevIndex] : ring[selectedIndex];
        const edgeEnd = splitPrevEdge ? ring[selectedIndex] : ring[nextIndex];
        const result = insertVertexNearSelectedNeighbor(ring, selection.vertexIndex, preparedPoint);
        setFloorRing(floor, selection.ringKind, selection.holeIndex, result.ring);
        const changedFloorIds = new Set([getFloorId(floor)]);
        if (selection.ringKind === "outer") {
            const updatedRing = getFloorRing(floor, selection.ringKind, selection.holeIndex);
            splitPerimeterWallAtVertex(this.building, floor, edgeStart, updatedRing[result.vertexIndex], edgeEnd);
        }
        this.propagateInsertedFloorVertex(floor, selection.ringKind, selection.holeIndex, edgeStart, edgeEnd, preparedPoint)
            .forEach((floorId) => changedFloorIds.add(floorId));
        if (selection.ringKind === "outer") {
            getBuildingFloors(this.building).forEach((candidateFloor) => {
                if (changedFloorIds.has(getFloorId(candidateFloor))) {
                    refreshWallSectionEndpoints(this.building, candidateFloor);
                }
            });
        }
        this.selection = createSelection("floorVertex", {
            floorId: getFloorId(floor),
            ringKind: selection.ringKind,
            holeIndex: selection.holeIndex,
            vertexIndex: result.vertexIndex
        });
        this.emitChange();
        return true;
    }

    roofVertexSnapCandidates(floor, options = {}) {
        if (!floor) throw new Error("roof vertex snapping requires a floor");
        const floorId = getFloorId(floor);
        const floorCenter = polygonCentroid(floor.outerPolygon || []);
        const candidates = [];
        const perimeterMiterGroups = new Map();
        const coveredLowerVertexKeys = new Set();
        const addCandidate = (point, kind, importance, extra = {}) => {
            if (!Number.isFinite(Number(point && point.x)) || !Number.isFinite(Number(point && point.y))) return;
            candidates.push({
                point: { x: Number(point.x), y: Number(point.y) },
                kind,
                importance,
                ...extra
            });
        };
        const addPerimeterMiterEndpoint = (wall, endpointKey, sharedPoint, corners) => {
            const endpoint = wall && wall[endpointKey];
            const groupKey = wallMiterEndpointKey(wall, endpointKey, sharedPoint, floor);
            const layer = Number.isFinite(Number(wall.traversalLayer))
                ? Math.round(Number(wall.traversalLayer))
                : Math.round(getFloorElevation(floor) / 3);
            const indexKey = `${groupKey}|layer:${layer}`;
            const lowerVertexKey = isFloorVertexEndpoint(endpoint) &&
                String(endpoint.fragmentId) === floorId &&
                endpoint.ring === "outer" &&
                endpoint.vertexId
                ? floorVertexKey(floorId, "outer", -1, endpoint.vertexId)
                : "";
            if (!perimeterMiterGroups.has(indexKey)) perimeterMiterGroups.set(indexKey, []);
            perimeterMiterGroups.get(indexKey).push({
                wallId: wall.id,
                sharedPoint,
                corners,
                lowerVertexKey
            });
        };
        getBuildingWalls(this.building).forEach((wall) => {
            const wallFloorId = wall.fragmentId || wall.floorId;
            if (wallFloorId !== floorId) return;
            const points = wallPoints(this.building, wall);
            if (points.length !== 2) return;
            if (wall.role === "perimeter") {
                const profile = getWallResolvedGeometry(wall).profile;
                addPerimeterMiterEndpoint(wall, "startPoint", points[0], [profile.aLeft, profile.aRight]);
                addPerimeterMiterEndpoint(wall, "endPoint", points[1], [profile.bLeft, profile.bRight]);
                return;
            }
            const corners = wallFootprintCornersFromCenterline(points, wall.thickness, `wall ${wall.id} roof snap corners`);
            corners.forEach((corner) => addCandidate(corner, "interiorWallCorner", ROOF_SNAP_IMPORTANCE.interiorWallCorner));
        });
        perimeterMiterGroups.forEach((group) => {
            if (group.length < 2) return;
            let outerCorner = null;
            group.forEach((entry) => {
                (Array.isArray(entry.corners) ? entry.corners : []).forEach((corner) => {
                    if (!Number.isFinite(Number(corner && corner.x)) || !Number.isFinite(Number(corner && corner.y))) return;
                    const distanceFromCenter = Math.hypot(
                        Number(corner.x) - Number(floorCenter.x),
                        Number(corner.y) - Number(floorCenter.y)
                    );
                    if (!outerCorner || distanceFromCenter > outerCorner.distanceFromCenter) {
                        outerCorner = { point: corner, distanceFromCenter };
                    }
                });
            });
            if (!outerCorner) {
                throw new Error(`roof vertex snapping could not resolve perimeter wall miter at ${group[0].sharedPoint.x},${group[0].sharedPoint.y}`);
            }
            group.forEach((entry) => {
                if (entry.lowerVertexKey) coveredLowerVertexKeys.add(entry.lowerVertexKey);
            });
            addCandidate(outerCorner.point, "perimeterWallOuterCorner", ROOF_SNAP_IMPORTANCE.perimeterWallOuterCorner);
        });
        (Array.isArray(floor.outerPolygon) ? floor.outerPolygon : []).forEach((point) => {
            if (point && point.id && coveredLowerVertexKeys.has(floorVertexKey(floorId, "outer", -1, point.id))) return;
            addCandidate(point, "lowerFloorVertex", ROOF_SNAP_IMPORTANCE.lowerFloorVertex);
        });
        if (options.includeRenderedRoofEdges === true) {
            const targetRoof = options.roof || getFloorRoof(floor);
            if (!targetRoof) throw new Error(`roof vertex snapping requires a target roof on floor ${floorId}`);
            this.roofRenderedEdgeSnapCandidates(floor, targetRoof).forEach((candidate) => candidates.push(candidate));
        }
        return dedupeCandidates(candidates);
    }

    roofVertexSnapPoint(floor, point, threshold = ROOF_SNAP_DISTANCE, options = {}) {
        let best = null;
        this.roofVertexSnapCandidates(floor, options).forEach((candidate) => {
            const d = distance(point, candidate.point);
            if (d > threshold) return;
            const weightedDistance = d / candidate.importance;
            if (
                !best ||
                weightedDistance < best.weightedDistance - 0.000001 ||
                (Math.abs(weightedDistance - best.weightedDistance) <= 0.000001 && candidate.importance > best.importance)
            ) {
                best = { ...candidate, distance: d, weightedDistance };
            }
        });
        return best
            ? {
                ...best.point,
                ...(best.roofEdgeAttachment ? { roofEdgeAttachment: { ...best.roofEdgeAttachment } } : {})
            }
            : null;
    }

    prepareRoofVertexPoint(floor, point, options = {}) {
        const snapped = this.roofVertexSnapPoint(floor, point, ROOF_SNAP_DISTANCE, {
            ...options,
            includeRenderedRoofEdges: true
        });
        if (snapped) return snapped;
        return this.snapToGrid ? snapToHexAnchor(point) : { x: point.x, y: point.y };
    }

    prepareRoofPeakPoint(floor, point) {
        if (!floor) throw new Error("roof peak snapping requires a floor");
        const center = this.defaultRoofPeakPoint(floor);
        if (distance(point, center) <= ROOF_PEAK_SNAP_DISTANCE) return center;
        return this.snapToGrid ? snapToHexAnchor(point) : { x: point.x, y: point.y };
    }

    deleteGablesTouchingRoofVertex(roof, deletedVertexIndex, originalRingLength) {
        const index = Math.floor(Number(deletedVertexIndex));
        const ringLength = Math.floor(Number(originalRingLength));
        if (!Number.isInteger(index) || !Number.isInteger(ringLength) || ringLength < 3) {
            throw new Error("roof vertex deletion requires a valid original ring");
        }
        const previousEdge = (index - 1 + ringLength) % ringLength;
        roof.gables = getRoofGables(roof).filter((gable) => {
            const startEdge = Math.floor(Number(gable.start && gable.start.edgeIndex));
            const endEdge = Math.floor(Number(gable.end && gable.end.edgeIndex));
            return startEdge !== previousEdge && startEdge !== index && endEdge !== previousEdge && endEdge !== index;
        }).map((gable) => {
            const remap = (position) => {
                const edgeIndex = Math.floor(Number(position.edgeIndex));
                return {
                    ...position,
                    edgeIndex: edgeIndex > index ? edgeIndex - 1 : edgeIndex
                };
            };
            return { ...gable, start: remap(gable.start), end: remap(gable.end) };
        });
    }

    updateRoofEdgeAttachedContactVertices() {
        getBuildingFloors(this.building).forEach((floor) => {
            getFloorRoofs(floor).forEach((roof) => {
                const ring = getRoofContactPolygon(roof);
                let changed = false;
                const nextRing = ring.map((vertex) => {
                    const attachment = vertex && vertex.roofEdgeAttachment;
                    if (!attachment) return { ...vertex };
                    const point = this.resolveRoofEdgeAttachmentPoint(floor, roof, attachment);
                    changed = true;
                    return {
                        ...vertex,
                        x: Number(point.x),
                        y: Number(point.y),
                        roofEdgeAttachment: { ...attachment }
                    };
                });
                if (!changed) return;
                const error = simplePolygonRingError(nextRing, `roof ${getFloorId(floor)} contact polygon`);
                if (error) throw new Error(`cannot update roof edge-attached contact vertices: ${error}`);
                roof.contactPolygon = nextRing;
            });
        });
    }

    moveSelectedRoofVertex(point) {
        const selected = this.selectedRoofVertex();
        const nextPoint = this.prepareRoofVertexPoint(selected.floor, point, { roof: selected.roof });
        const nextRing = selected.ring.map((vertex, index) => {
            if (index !== selected.vertexIndex) return { ...vertex };
            const { roofEdgeAttachment: _previousAttachment, ...rest } = vertex;
            return {
                ...rest,
                x: Number(nextPoint.x),
                y: Number(nextPoint.y),
                ...(nextPoint.roofEdgeAttachment ? { roofEdgeAttachment: { ...nextPoint.roofEdgeAttachment } } : {})
            };
        });
        const error = simplePolygonRingError(nextRing, `roof ${getFloorId(selected.floor)} contact polygon`);
        if (error) throw new Error(`cannot move roof vertex: ${error}`);
        selected.roof.contactPolygon = nextRing;
        this.emitChange();
        return true;
    }

    moveSelectedRoofPeak(point) {
        const selected = this.selectedRoofPeak();
        if (!selected) return false;
        const nextPoint = this.prepareRoofPeakPoint(floorRoofView(selected.floor, selected.roof), point);
        selected.roof.peakPoint = { x: Number(nextPoint.x), y: Number(nextPoint.y) };
        this.emitChange();
        return true;
    }

    moveSelectedRoofShedDirection(point) {
        const selected = this.selectedRoofShedDirection();
        if (!selected) return false;
        const roofView = floorRoofView(selected.floor, selected.roof);
        const center = this.roofShedBaseCenter(roofView);
        const dx = Number(point.x) - Number(center.x);
        const dy = Number(point.y) - Number(center.y);
        const length = Math.hypot(dx, dy);
        if (!Number.isFinite(length) || length <= 0.000001) return false;
        const rawDirection = { x: dx / length, y: dy / length };
        const rawHandlePoint = {
            x: Number(center.x) + rawDirection.x * ROOF_SHED_DIRECTION_HANDLE_LENGTH,
            y: Number(center.y) + rawDirection.y * ROOF_SHED_DIRECTION_HANDLE_LENGTH
        };
        const snap = this.roofShedDirectionSnapCandidates(roofView)
            .map((candidate) => ({ ...candidate, distance: distance(rawHandlePoint, candidate.point) }))
            .filter((candidate) => candidate.distance <= ROOF_SHED_DIRECTION_SNAP_DISTANCE)
            .sort((a, b) => a.distance - b.distance)[0] || null;
        selected.roof.shedDirection = snap ? snap.direction : rawDirection;
        this.emitChange();
        return true;
    }

    remapGablesForInsertedRoofVertex(roof, edgeIndex, edgeT) {
        const insertionEdge = Math.floor(Number(edgeIndex));
        const t = Number(edgeT);
        if (!Number.isInteger(insertionEdge) || insertionEdge < 0 || !Number.isFinite(t) || t <= 0 || t >= 1) {
            throw new Error("roof vertex insertion requires a valid edge split point");
        }
        roof.gables = getRoofGables(roof).map((gable) => {
            const remap = (position) => {
                const positionEdge = Math.floor(Number(position.edgeIndex));
                const positionT = Number(position.t);
                if (positionEdge < insertionEdge) return { ...position };
                if (positionEdge > insertionEdge) return { ...position, edgeIndex: positionEdge + 1 };
                if (positionT <= t) return { edgeIndex: positionEdge, t: Math.max(0, Math.min(1, positionT / t)) };
                return { edgeIndex: positionEdge + 1, t: Math.max(0, Math.min(1, (positionT - t) / (1 - t))) };
            };
            return { ...gable, start: remap(gable.start), end: remap(gable.end) };
        });
    }

    insertRoofVertexOnKnownEdge(floorId, insertAfterIndex, point, edgeT = null, options = {}) {
        const floor = findFloor(this.building, floorId);
        if (!floor) throw new Error(`cannot insert roof vertex on missing floor: ${floorId}`);
        const roofId = options.roofId || (this.selection && String(this.selection.floorId) === String(floorId) ? this.selection.roofId : "");
        const roof = findFloorRoof(floor, roofId);
        if (!roof) throw new Error(`cannot insert roof vertex without a roof: ${floorId}`);
        const ring = getRoofContactPolygon(roof);
        if (!Array.isArray(ring) || ring.length < 3) throw new Error(`cannot insert roof vertex into invalid contact polygon: ${floorId}`);
        const edgeIndex = Math.floor(Number(insertAfterIndex));
        if (!Number.isInteger(edgeIndex) || edgeIndex < 0 || edgeIndex >= ring.length) {
            throw new Error(`cannot insert roof vertex on missing edge: ${insertAfterIndex}`);
        }
        const edgeStart = ring[edgeIndex];
        const edgeEnd = ring[(edgeIndex + 1) % ring.length];
        const dx = Number(edgeEnd.x) - Number(edgeStart.x);
        const dy = Number(edgeEnd.y) - Number(edgeStart.y);
        const lengthSquared = dx * dx + dy * dy;
        if (lengthSquared <= 0.000001) throw new Error("cannot insert roof vertex on a zero-length edge");
        const t = edgeT === null || edgeT === undefined
            ? ((Number(point.x) - Number(edgeStart.x)) * dx + (Number(point.y) - Number(edgeStart.y)) * dy) / lengthSquared
            : Number(edgeT);
        if (!Number.isFinite(t) || t <= 0.000001 || t >= 0.999999) {
            throw new Error("cannot insert roof vertex at an existing roof vertex");
        }
        const preparedPoint = {
            x: Number(edgeStart.x) + dx * t,
            y: Number(edgeStart.y) + dy * t
        };
        const result = insertVertexOnRingEdge(ring, edgeIndex, preparedPoint);
        const error = simplePolygonRingError(result.ring, `roof ${getFloorId(floor)} contact polygon`);
        if (error) throw new Error(`cannot insert roof vertex: ${error}`);
        roof.contactPolygon = result.ring;
        this.remapGablesForInsertedRoofVertex(roof, edgeIndex, t);
        this.selection = createSelection("roofVertex", {
            floorId: getFloorId(floor),
            vertexIndex: result.vertexIndex,
            ...(roofId ? { roofId: String(roofId) } : {})
        });
        this.emitChange();
        return true;
    }

    deleteSelectedRoofVertex() {
        const selection = this.selection || {};
        if (selection.kind !== "roofVertex") return false;
        const selected = this.selectedRoofVertex();
        const floorId = getFloorId(selected.floor);
        if (selected.ring.length - 1 < 3) {
            selected.floor.roof = null;
            this.building.mountedWallObjects = getBuildingMountedObjects(this.building)
                .filter((object) => object.mountKind !== "gable" || String(object.floorId) !== floorId);
            this.selectFloor(floorId, { preserveView: true });
            return true;
        }
        this.deleteGablesTouchingRoofVertex(selected.roof, selected.vertexIndex, selected.ring.length);
        selected.roof.contactPolygon = selected.ring
            .filter((_point, index) => index !== selected.vertexIndex)
            .map((point) => ({ ...point, x: Number(point.x), y: Number(point.y) }));
        const nextIndex = Math.min(selected.vertexIndex, selected.roof.contactPolygon.length - 1);
        this.selection = createSelection("roofVertex", {
            floorId,
            vertexIndex: nextIndex,
            ...(selected.roof && selected.roof.id ? { roofId: String(selected.roof.id) } : {})
        });
        this.emitChange();
        return true;
    }

    deleteSelectedFloorVertex() {
        const floor = this.selectedFloor();
        const selection = this.selection;
        if (!floor || !selection.ringKind || selection.vertexIndex < 0) return false;
        const ring = getFloorRing(floor, selection.ringKind, selection.holeIndex);
        if (!Array.isArray(ring) || ring.length <= 3) return false;
        const previousPoint = ring[previousRingIndex(ring, selection.vertexIndex)];
        const deletedVertex = ring[selection.vertexIndex];
        const nextPoint = ring[nextRingIndex(ring, selection.vertexIndex)];
        const nextRing = ring
            .filter((_point, index) => index !== selection.vertexIndex)
            .map((point) => ({ ...point, x: Number(point.x), y: Number(point.y) }));
        if (selection.ringKind === "outer" && deletedVertex && deletedVertex.id) {
            fallbackDeletedVertexEndpointsToPoint(this.building, getFloorId(floor), deletedVertex.id);
        }
        setFloorRing(floor, selection.ringKind, selection.holeIndex, nextRing);
        const changedFloorIds = new Set([getFloorId(floor)]);
        if (selection.ringKind === "outer") {
            mergePerimeterWallsAcrossDeletedVertex(this.building, floor, previousPoint, deletedVertex, nextPoint);
        }
        this.propagateDeletedFloorVertex(floor, selection.ringKind, selection.holeIndex, previousPoint, deletedVertex, nextPoint)
            .forEach((floorId) => changedFloorIds.add(floorId));
        if (selection.ringKind === "outer") {
            getBuildingFloors(this.building).forEach((candidateFloor) => {
                if (changedFloorIds.has(getFloorId(candidateFloor))) {
                    refreshWallSectionEndpoints(this.building, candidateFloor);
                }
            });
        }
        this.selection = createSelection("floorVertex", {
            floorId: getFloorId(floor),
            ringKind: selection.ringKind,
            holeIndex: selection.holeIndex,
            vertexIndex: Math.min(selection.vertexIndex, nextRing.length - 1)
        });
        this.emitChange();
        return true;
    }

    applyPolygonDraftToFloor(floor, points, operation) {
        if (!floor) throw new Error("cannot edit polygon without a target floor");
        const result = applyFloorPolygonEdit(floor, points, operation);
        const reconfigureWalls = operation !== "add";
        if (!reconfigureWalls) {
            downgradeMovedWallVertexEndpoints(this.building, floor, result);
        }
        replaceFloorShape(this.building, floor, result.footprint, result.holes, {
            regeneratePerimeterWalls: reconfigureWalls,
            refreshWallEndpoints: reconfigureWalls
        });
        this.selection = createSelection("floor", { floorId: getFloorId(floor) });
        this.emitChange();
    }

    applyPolygonDraftAtElevation(points, operation, elevation) {
        const targetElevation = Number(elevation);
        if (!Number.isFinite(targetElevation)) {
            throw new Error("polygon finalize requires a finite elevation");
        }
        const floor = this.floorAtElevation(targetElevation);
        if (!floor) {
            if (operation !== "add") {
                throw new Error(`cannot subtract polygon without a floor at elevation ${targetElevation}`);
            }
            const error = simplePolygonRingError(points, "new floor polygon");
            if (error) throw new Error(`cannot create floor from polygon draft: ${error}`);
            const nextFloor = createFloor({
                elevation: targetElevation,
                footprint: points,
                defaultWallHeight: Number(this.inputs.wallHeight) || DEFAULTS.wallHeight,
                floorHeight: Number(this.inputs.floorHeight) || DEFAULTS.wallHeight,
                floorTexture: this.paintTextures.floor,
                roofTexture: this.paintTextures.roofs,
                defaultWallTexture: this.paintTextures.walls,
                createPerimeterWalls: true
            });
            addFloor(this.building, nextFloor);
            this.selectFloor(getFloorId(nextFloor));
            return;
        }
        this.applyPolygonDraftToFloor(floor, points, operation);
    }

    applyPolygonDraftToSelectedFloor(points, operation) {
        const floor = this.selectedFloor();
        if (!floor) throw new Error("cannot edit polygon without a selected floor");
        this.applyPolygonDraftToFloor(floor, points, operation);
    }

    activePolygonDraft() {
        return this.draft && this.draft.kind === "polygonEdit" ? this.draft : null;
    }

    canFinalizePolygonDraft() {
        const draft = this.activePolygonDraft();
        if (draft) return !!(draft.completed === true && Array.isArray(draft.points) && draft.points.length >= 3);
        const stairDraft = this.draft && this.draft.kind === "stair" ? this.draft : null;
        if (!stairDraft) return false;
        if (stairDraft.ladder === true) return stairDraft.completed === true;
        return !!(stairDraft.completed === true && Array.isArray(stairDraft.treads) && stairDraft.treads.length >= 2);
    }

    pickPolygonDraftVertex(point, threshold) {
        const draft = this.activePolygonDraft();
        if (!draft || !Array.isArray(draft.points)) return null;
        let best = null;
        draft.points.forEach((vertex, vertexIndex) => {
            const d = distance(point, vertex);
            if (d <= threshold && (!best || d < best.distance)) {
                best = { vertexIndex, vertex, distance: d };
            }
        });
        return best;
    }

    selectPolygonDraftVertex(vertexIndex) {
        const draft = this.activePolygonDraft();
        if (!draft || !Array.isArray(draft.points)) return false;
        const index = Math.floor(Number(vertexIndex));
        if (!Number.isInteger(index) || index < 0 || index >= draft.points.length) {
            throw new Error(`cannot select missing polygon draft vertex: ${vertexIndex}`);
        }
        draft.selectedVertexIndex = index;
        this.emitChange();
        return true;
    }

    clearPolygonDraftVertexSelection() {
        const draft = this.activePolygonDraft();
        if (!draft) return false;
        draft.selectedVertexIndex = -1;
        this.emitChange();
        return true;
    }

    moveSelectedPolygonDraftVertex(point) {
        const draft = this.activePolygonDraft();
        if (!draft || !Array.isArray(draft.points)) return false;
        const index = Math.floor(Number(draft.selectedVertexIndex));
        if (!Number.isInteger(index) || index < 0 || index >= draft.points.length) return false;
        draft.points[index] = this.preparePoint(point, { preferFloorVertices: true });
        this.emitChange();
        return true;
    }

    polygonDraftEdgeAt(point, threshold) {
        const draft = this.activePolygonDraft();
        if (!draft || !Array.isArray(draft.points) || draft.points.length < 2) return null;
        let best = null;
        for (let index = 0; index < draft.points.length; index++) {
            const nextIndex = (index + 1) % draft.points.length;
            const hit = distanceToSegment(point, draft.points[index], draft.points[nextIndex]);
            if (hit <= threshold && (!best || hit < best.distance)) {
                best = { insertAfterIndex: index, distance: hit };
            }
        }
        return best;
    }

    insertPolygonDraftVertexOnEdge(point, threshold) {
        const draft = this.activePolygonDraft();
        if (!draft || !Array.isArray(draft.points) || draft.completed !== true) return false;
        const edge = this.polygonDraftEdgeAt(point, threshold);
        if (!edge) return false;
        const nextPoint = this.preparePoint(point, { preferFloorVertices: true });
        draft.points.splice(edge.insertAfterIndex + 1, 0, nextPoint);
        draft.selectedVertexIndex = edge.insertAfterIndex + 1;
        this.emitChange();
        return true;
    }

    deleteSelectedPolygonDraftVertex() {
        const draft = this.activePolygonDraft();
        if (!draft || !Array.isArray(draft.points)) return false;
        const index = Math.floor(Number(draft.selectedVertexIndex));
        if (!Number.isInteger(index) || index < 0 || index >= draft.points.length) return false;
        draft.points.splice(index, 1);
        if (draft.points.length < 3) draft.completed = false;
        draft.selectedVertexIndex = Math.min(index, draft.points.length - 1);
        this.emitChange();
        return true;
    }

    preparePoint(point, options = {}) {
        const preferFloorVertices = options.preferFloorVertices === true ||
            this.tool === "polygon" ||
            this.tool === "scissors";
        if (preferFloorVertices) {
            const targetFloor = (this.tool === "polygon" || this.tool === "scissors")
                ? this.polygonToolFloor()
                : this.selectedFloor();
            const targetFloorSnap = this.floorVertexSnapPoint(targetFloor, point);
            if (targetFloorSnap) return targetFloorSnap;
        }
        const lowerFloorSnap = this.lowerFloorVertexSnapPoint(point);
        if (lowerFloorSnap) return lowerFloorSnap;
        return this.snapToGrid ? snapToHexAnchor(point) : { x: point.x, y: point.y };
    }

    prepareLinePoint(point, origin, options = {}) {
        const prepared = this.preparePoint(point, options);
        return this.snapDirection && origin
            ? snapPointToCanonicalDirection(origin, prepared)
            : prepared;
    }

    updateHoverPoint(point) {
        if (!point) {
            this.hoverWorldPoint = null;
            this.emitChange();
            return;
        }
        const draft = this.draft;
        const origin = draft &&
            draft.kind === "polygonEdit" &&
            Array.isArray(draft.points) &&
            draft.points.length > 0
            ? draft.points[draft.points.length - 1]
            : null;
        this.hoverWorldPoint = origin
            ? this.prepareLinePoint(point, origin, { preferFloorVertices: true })
            : this.preparePoint(point);
        this.emitChange();
    }

    describeHexAt(point) {
        const anchor = nearestHexAnchor(point);
        if (anchor.kind === "node") return `hex ${anchor.xindex},${anchor.yindex}`;
        return `midpoint ${anchor.a.xindex},${anchor.a.yindex} / ${anchor.b.xindex},${anchor.b.yindex}`;
    }

    pickSelectedFloorVertex(point, threshold) {
        const selectedFloor = this.selectedFloor();
        if (!selectedFloor) return null;
        const ringVertex = findRingVertexAtPoint(selectedFloor, point, threshold);
        if (ringVertex) return { type: "floorVertex", floor: selectedFloor, ...ringVertex };
        const vertex = nearestFloorVertex(selectedFloor, point, threshold);
        return vertex ? { type: "floorVertex", ...vertex } : null;
    }

    pick(point, threshold) {
        const vertexHit = this.pickSelectedFloorVertex(point, threshold);
        if (vertexHit) return vertexHit;
        const wallHit = nearestWall(this.building, point, threshold, (_wall, floor) => this.isFloorSelected(getFloorId(floor)));
        if (wallHit) return { type: "wall", ...wallHit };
        const floors = getBuildingFloors(this.building);
        for (let index = floors.length - 1; index >= 0; index--) {
            const floor = floors[index];
            if (!this.isFloorSelected(getFloorId(floor))) continue;
            const inOuter = pointInPolygon(point, floor.outerPolygon);
            const inHole = (floor.holes || []).some((ring) => pointInPolygon(point, ring));
            if (inOuter && !inHole) {
                return { type: "floor", floor };
            }
        }
        return null;
    }

    pickWallAt(point, threshold) {
        return nearestWall(this.building, point, threshold, (_wall, floor) => this.isFloorSelected(getFloorId(floor)));
    }

    pickFloorAt(point) {
        const floors = getBuildingFloors(this.building);
        for (let index = floors.length - 1; index >= 0; index--) {
            const floor = floors[index];
            if (!this.isFloorSelected(getFloorId(floor))) continue;
            const inOuter = pointInPolygon(point, floor.outerPolygon);
            const inHole = (floor.holes || []).some((ring) => pointInPolygon(point, ring));
            if (inOuter && !inHole) return { type: "floor", floor };
        }
        return null;
    }

    deleteSelectedWall() {
        const walls = this.selectedWalls();
        if (!walls.length) return false;
        const wallIds = new Set(walls.map((wall) => String(wall.id)));
        const floorIds = new Set(walls.map((wall) => String(wall.fragmentId || wall.floorId)));
        walls.forEach((wall) => {
            if (!findFloor(this.building, wall.fragmentId || wall.floorId)) {
                throw new Error(`selected wall has missing floor: ${wall.floorId}`);
            }
        });
        const adjacentWall = walls.length === 1
            ? (() => {
                const wall = walls[0];
                const deletedEndpoints = [wall.startPoint, wall.endPoint];
                return getBuildingWalls(this.building).find((candidate) => {
                    if (wallIds.has(String(candidate.id))) return false;
                    if (String(candidate.floorId || candidate.fragmentId) !== String(wall.floorId || wall.fragmentId)) return false;
                    return deletedEndpoints.some((deletedEndpoint) => (
                        endpointsShareVertex(deletedEndpoint, candidate.startPoint) ||
                        endpointsShareVertex(deletedEndpoint, candidate.endPoint)
                    ));
                }) || null;
            })()
            : null;
        this.building.wallSections = getBuildingWalls(this.building).filter((candidate) => !wallIds.has(String(candidate.id)));
        this.building.mountedWallObjects = getBuildingMountedObjects(this.building)
            .filter((object) => !wallIds.has(String(object.wallId ?? object.mountedWallSectionUnitId)));
        getBuildingFloors(this.building).forEach((floor) => {
            getFloorColumns(floor).forEach((column) => {
                if (wallIds.has(String(column.wallId))) column.wallId = null;
            });
            const beamsToDelete = new Set();
            getFloorBeams(floor).forEach((beam) => {
                const startOnDeleted = beam.startAttachment && beam.startAttachment.kind === "wall" && wallIds.has(String(beam.startAttachment.hostId));
                const endOnDeleted = beam.endAttachment && beam.endAttachment.kind === "wall" && wallIds.has(String(beam.endAttachment.hostId));
                if (startOnDeleted && endOnDeleted) {
                    beamsToDelete.add(Number(beam.id));
                } else {
                    if (startOnDeleted) {
                        const pts = this.beamWorldPoints(beam);
                        beam.startAttachment = pts ? { kind: "free", x: pts.start.x, y: pts.start.y } : { kind: "free", x: 0, y: 0 };
                    }
                    if (endOnDeleted) {
                        const pts = this.beamWorldPoints(beam);
                        beam.endAttachment = pts ? { kind: "free", x: pts.end.x, y: pts.end.y } : { kind: "free", x: 0, y: 0 };
                    }
                }
            });
            if (beamsToDelete.size) floor.beams = getFloorBeams(floor).filter((b) => !beamsToDelete.has(Number(b.id)));
        });
        if (adjacentWall) {
            this.selectWall(adjacentWall.id, { preserveView: this.renderStyle() === "exterior" });
            return true;
        }
        if (floorIds.size === 1) {
            const floorId = [...floorIds][0];
            this.selectedFloorIds = new Set([floorId]);
            this.layerSelectionMode = "floor";
            this.selection = createSelection("floor", { floorId });
        } else {
            this.selectedFloorIds = new Set(getBuildingFloors(this.building).map((floor) => getFloorId(floor)));
            this.layerSelectionMode = "all";
            this.selection = createSelection("building");
        }
        this.emitChange();
        return true;
    }

    deleteSelectedMountedObject() {
        const objects = this.selectedMountedObjects();
        if (!objects.length) return false;
        const objectIds = new Set(objects.map((object) => String(object.id)));
        const walls = objects
            .map((object) => findWall(this.building, object.wallId ?? object.mountedWallSectionUnitId))
            .filter(Boolean);
        const gableFloors = objects
            .filter((object) => object.mountKind === "gable")
            .map((object) => findFloor(this.building, object.floorId))
            .filter(Boolean);
        this.building.mountedWallObjects = getBuildingMountedObjects(this.building)
            .filter((candidate) => !objectIds.has(String(candidate.id)));
        const wallIds = new Set(walls.map((wall) => String(wall.id)));
        if (walls.length === 1 || wallIds.size === 1) {
            const wall = walls[0];
            this.selection = createSelection("wall", { floorId: wall.floorId, wallId: wall.id });
        } else if (walls.length > 0) {
            this.selection = createSelection("level", { floorId: walls[0].floorId });
        } else if (gableFloors.length > 0) {
            this.selection = createSelection("level", { floorId: getFloorId(gableFloors[0]) });
        } else {
            this.selection = createSelection("building");
        }
        this.emitChange();
        return true;
    }

    // ── Beam helpers ────────────────────────────────────────────────────────

    findBeam(floorId, beamId) {
        const floor = findFloor(this.building, floorId);
        return (floor && getFloorBeams(floor).find((b) => Number(b.id) === Number(beamId))) || null;
    }

    findBeamById(beamId) {
        for (const floor of getBuildingFloors(this.building)) {
            const beam = getFloorBeams(floor).find((b) => Number(b.id) === Number(beamId));
            if (beam) return { beam, floor };
        }
        return null;
    }

    selectedBeam() {
        const beamIds = this.selectedBeamIds();
        if (!beamIds.length) return null;
        const found = this.findBeamById(beamIds[0]);
        return found ? found.beam : null;
    }

    selectedBeamIds() {
        if (!this.selection || this.selection.kind !== "beam") return [];
        if (Array.isArray(this.selection.beamIds) && this.selection.beamIds.length > 0) {
            return this.selection.beamIds;
        }
        return this.selection.beamId !== null && this.selection.beamId !== undefined ? [this.selection.beamId] : [];
    }

    selectedBeams() {
        return this.selectedBeamIds().map((beamId) => {
            const entry = this.findBeamById(beamId);
            if (!entry) throw new Error(`selected beam is missing from building: ${beamId}`);
            return entry.beam;
        });
    }

    isBeamSelected(beamId) {
        return this.selectedBeamIds().some((id) => Number(id) === Number(beamId));
    }

    selectBeam(floorId, beamId, options = {}) {
        return this.selectBeams([beamId], options);
    }

    resolveBeamSelection(beamIds, label = "beam selection") {
        const uniqueIds = [];
        (Array.isArray(beamIds) ? beamIds : []).forEach((id) => {
            if (!uniqueIds.some((candidate) => String(candidate) === String(id))) uniqueIds.push(id);
        });
        if (!uniqueIds.length) return { beamIds: [], beams: [], floors: [] };
        const entries = uniqueIds.map((id) => {
            const entry = this.findBeamById(id);
            if (!entry) throw new Error(`${label} references missing beam: ${id}`);
            return entry;
        });
        return {
            beamIds: entries.map((entry) => entry.beam.id),
            beams: entries.map((entry) => entry.beam),
            floors: entries.map((entry) => entry.floor)
        };
    }

    applyBeamSelection(beamIds, options = {}) {
        const resolved = this.resolveBeamSelection(beamIds, "beam selection");
        if (!resolved.beamIds.length) {
            this.selectBuilding();
            return false;
        }
        if (!options.preserveView) {
            this.selectedFloorIds = new Set(resolved.floors.map((floor) => getFloorId(floor)));
            this.layerSelectionMode = "floor";
        }
        this.selection = createSelection("beam", {
            floorId: getFloorId(resolved.floors[0]),
            beamIds: resolved.beamIds
        });
        this.emitChange();
        return true;
    }

    selectBeams(beamIds, options = {}) {
        return this.applyBeamSelection(beamIds, options);
    }

    addBeamsToSelection(beamIds, options = {}) {
        const nextBeamIds = [...this.selectedBeamIds()];
        (Array.isArray(beamIds) ? beamIds : []).forEach((beamId) => {
            const entry = this.findBeamById(beamId);
            if (!entry) throw new Error(`cannot add missing beam to selection: ${beamId}`);
            if (!nextBeamIds.some((id) => String(id) === String(entry.beam.id))) nextBeamIds.push(entry.beam.id);
        });
        return this.applyBeamSelection(nextBeamIds, options);
    }

    removeBeamsFromSelection(beamIds, options = {}) {
        const removeIds = new Set((Array.isArray(beamIds) ? beamIds : []).map((id) => String(id)));
        removeIds.forEach((beamId) => {
            if (!this.findBeamById(beamId)) throw new Error(`cannot remove missing beam from selection: ${beamId}`);
        });
        const previousIds = this.selectedBeamIds();
        const nextBeamIds = previousIds.filter((id) => !removeIds.has(String(id)));
        if (nextBeamIds.length === previousIds.length) return false;
        if (!nextBeamIds.length) {
            const firstRemoved = [...removeIds][0];
            const entry = firstRemoved !== undefined ? this.findBeamById(firstRemoved) : null;
            if (entry) this.selectLevel(getFloorId(entry.floor), options);
            else this.selectBuilding();
            return true;
        }
        return this.applyBeamSelection(nextBeamIds, options);
    }

    addBeamToSelection(beamId, options = {}) {
        this.addBeamsToSelection([beamId], options);
        return true;
    }

    removeBeamFromSelection(beamId, options = {}) {
        return this.removeBeamsFromSelection([beamId], options);
    }

    // ── Stair helpers ───────────────────────────────────────────────────────

    findStairById(stairId) {
        for (const floor of getBuildingFloors(this.building)) {
            const stair = getFloorStairs(floor).find((candidate) => String(candidate.id) === String(stairId));
            if (stair) return { stair, floor };
        }
        return null;
    }

    selectedStairIds() {
        if (!this.selection || this.selection.kind !== "stair") return [];
        if (Array.isArray(this.selection.stairIds) && this.selection.stairIds.length > 0) {
            return this.selection.stairIds;
        }
        return this.selection.stairId !== null && this.selection.stairId !== undefined ? [this.selection.stairId] : [];
    }

    selectedStairs() {
        return this.selectedStairIds().map((stairId) => {
            const entry = this.findStairById(stairId);
            if (!entry) throw new Error(`selected stair is missing from building: ${stairId}`);
            return entry.stair;
        });
    }

    isStairSelected(stairId) {
        return this.selectedStairIds().some((id) => String(id) === String(stairId));
    }

    selectStair(floorId, stairId, options = {}) {
        const entry = this.findStairById(stairId);
        if (!entry) throw new Error(`cannot select missing stair: ${stairId}`);
        const resolvedFloorId = getFloorId(entry.floor);
        if (floorId !== undefined && floorId !== null && String(floorId) !== resolvedFloorId) {
            throw new Error(`stair ${stairId} is not on floor ${floorId}`);
        }
        if (!options.preserveView) {
            this.selectedFloorIds = new Set([resolvedFloorId]);
            this.layerSelectionMode = "floor";
        }
        this.tool = "select";
        this.draft = null;
        this.selection = createSelection("stair", { floorId: resolvedFloorId, stairId: entry.stair.id });
        this.emitChange();
        return true;
    }

    cloneStairForDrag(stair) {
        return JSON.parse(JSON.stringify(stair));
    }

    beginSelectedStairMove(startPoint) {
        if (!startPoint || !Number.isFinite(Number(startPoint.x)) || !Number.isFinite(Number(startPoint.y))) {
            throw new Error("stair drag requires a finite start point");
        }
        const entries = this.selectedStairIds().map((stairId) => this.findStairById(stairId)).filter(Boolean);
        if (!entries.length) return null;
        return {
            startPoint: { x: Number(startPoint.x), y: Number(startPoint.y) },
            originals: entries.map((entry) => ({
                stairId: entry.stair.id,
                floorId: getFloorId(entry.floor),
                stair: this.cloneStairForDrag(entry.stair)
            }))
        };
    }

    translateStairRecord(stair, dx, dy) {
        const movePoint = (point) => ({
            ...point,
            x: Number(point.x) + dx,
            y: Number(point.y) + dy
        });
        if (stair.startPoint) stair.startPoint = movePoint(stair.startPoint);
        if (stair.endPoint) stair.endPoint = movePoint(stair.endPoint);
        if (stair.lowerPoint) stair.lowerPoint = movePoint(stair.lowerPoint);
        if (stair.higherPoint) stair.higherPoint = movePoint(stair.higherPoint);
        if (Array.isArray(stair.treads)) {
            stair.treads = stair.treads.map((tread) => ({
                ...tread,
                left: movePoint(tread.left),
                right: movePoint(tread.right),
                center: tread.center ? movePoint(tread.center) : {
                    x: (Number(tread.left.x) + Number(tread.right.x)) * 0.5 + dx,
                    y: (Number(tread.left.y) + Number(tread.right.y)) * 0.5 + dy
                }
            }));
        }
        if (Array.isArray(stair.footprint)) {
            stair.footprint = stair.footprint.map(movePoint);
        } else {
            stair.footprint = stairFootprintPoints(stair);
        }
        return stair;
    }

    stairTopAndBottomFloors(stair) {
        const sourceZ = Number(stair && stair.bottomZ);
        const height = Number(stair && stair.height);
        if (!Number.isFinite(sourceZ) || !Number.isFinite(height) || height <= 0) {
            throw new Error(`stair ${stair && stair.id} move requires finite elevation data`);
        }
        const topZ = String(stair.direction || "up") === "down" ? sourceZ : sourceZ + height;
        const bottomZ = String(stair.direction || "up") === "down" ? sourceZ - height : sourceZ;
        const topFloor = this.floorAtElevation(topZ);
        const bottomFloor = this.floorAtElevation(bottomZ);
        if (!topFloor) throw new Error(`stair ${stair && stair.id} move requires a floor at top elevation ${topZ}`);
        if (!bottomFloor) throw new Error(`stair ${stair && stair.id} move requires a floor at bottom elevation ${bottomZ}`);
        return { topFloor, bottomFloor, topZ, bottomZ };
    }

    stairSectionBetweenTreads(previousTread, nextTread, label = "stair section") {
        const previous = normalizedStairTread(previousTread, `${label} previous tread`);
        const next = normalizedStairTread(nextTread, `${label} next tread`);
        const directionCross = Math.sin(next.angle - previous.angle);
        if (Math.abs(directionCross) <= 0.000001) {
            const paired = chooseParallelStairTreadPairing(previous, next);
            const ring = positiveAreaRing([
                paired.side0Start,
                paired.side0End,
                paired.side1End,
                paired.side1Start
            ]);
            return {
                area: Math.abs(polygonSignedArea(ring)),
                pointOuter: (t) => interpolatePoint(paired.side0Start, paired.side0End, t),
                pointInner: (t) => interpolatePoint(paired.side1Start, paired.side1End, t)
            };
        }
        const connected = connectedStairTreadEndpoint(previous, next);
        if (connected) {
            const center = { x: Number(connected.aPoint.x), y: Number(connected.aPoint.y) };
            const radius = pointDistance(center, connected.aOther);
            const startAngle = Math.atan2(connected.aOther.y - center.y, connected.aOther.x - center.x);
            const endAngle = Math.atan2(connected.bOther.y - center.y, connected.bOther.x - center.x);
            const deltaAngle = stairArcDelta(startAngle, endAngle, next, "arcDeltaAngle", `${label} next tread`);
            return {
                area: Math.abs(0.5 * radius * radius * deltaAngle),
                pointOuter: (t) => arcPoint(center, radius, startAngle, deltaAngle, t),
                pointInner: () => ({ ...center })
            };
        }
        const crossing = lineIntersectionPoint(previous.left, previous.right, next.left, next.right);
        if (!crossing) throw new Error(`${label} treads are neither parallel, connected, nor intersecting`);
        const sortedPrevious = [previous.left, previous.right]
            .map((point) => ({ point, distance: pointDistance(crossing, point) }))
            .sort((a, b) => a.distance - b.distance);
        const sortedNext = [next.left, next.right]
            .map((point) => ({ point, distance: pointDistance(crossing, point) }))
            .sort((a, b) => a.distance - b.distance);
        const nearRadius = (sortedPrevious[0].distance + sortedNext[0].distance) * 0.5;
        const farRadius = (sortedPrevious[1].distance + sortedNext[1].distance) * 0.5;
        const farStartAngle = Math.atan2(sortedPrevious[1].point.y - crossing.y, sortedPrevious[1].point.x - crossing.x);
        const farEndAngle = Math.atan2(sortedNext[1].point.y - crossing.y, sortedNext[1].point.x - crossing.x);
        const farDeltaAngle = stairArcDelta(farStartAngle, farEndAngle, next, "arcDeltaAngle", `${label} next tread`);
        const nearStartAngle = Math.atan2(sortedPrevious[0].point.y - crossing.y, sortedPrevious[0].point.x - crossing.x);
        const nearEndAngle = Math.atan2(sortedNext[0].point.y - crossing.y, sortedNext[0].point.x - crossing.x);
        const nearDeltaAngle = stairArcDelta(nearStartAngle, nearEndAngle, next, "arcNearDeltaAngle", `${label} next tread`, farDeltaAngle);
        return {
            area: Math.abs(0.5 * Math.abs(farDeltaAngle) * (farRadius * farRadius - nearRadius * nearRadius)),
            pointOuter: (t) => arcPoint(crossing, farRadius, farStartAngle, farDeltaAngle, t),
            pointInner: (t) => arcPoint(crossing, nearRadius, nearStartAngle, nearDeltaAngle, t)
        };
    }

    stairStepPolygonsForValidation(stair) {
        const totalSteps = Math.max(1, Math.round(Number(stair.stepCount) || 1));
        const baseZ = Number(stair.bottomZ);
        const height = Number(stair.height);
        const rise = String(stair.direction || "up") === "down" ? -height : height;
        if (stair.ladder === true) {
            const polygon = positiveAreaRing(stairFootprintPoints(stair));
            return Array.from({ length: totalSteps }, (_unused, index) => ({
                polygon,
                z: baseZ + rise * ((index + 1) / (totalSteps + 1)),
                globalStepIndex: index
            }));
        }
        const treads = Array.isArray(stair.treads) ? stair.treads : [];
        if (treads.length < 2) throw new Error(`stair ${stair.id} move requires at least two treads`);
        const sections = [];
        for (let index = 1; index < treads.length; index++) {
            sections.push(this.stairSectionBetweenTreads(treads[index - 1], treads[index], `stair ${stair.id} section ${index - 1}`));
        }
        const counts = allocateCountsByArea(sections, totalSteps);
        const steps = [];
        sections.forEach((section, sectionIndex) => {
            const count = counts[sectionIndex];
            for (let local = 0; local < count; local++) {
                const t0 = local / count;
                const t1 = (local + 1) / count;
                const globalStepIndex = steps.length;
                steps.push({
                    polygon: positiveAreaRing([
                        section.pointOuter(t0),
                        section.pointOuter(t1),
                        section.pointInner(t1),
                        section.pointInner(t0)
                    ]),
                    z: baseZ + rise * ((globalStepIndex + 1) / (totalSteps + 1)),
                    globalStepIndex
                });
            }
        });
        return steps;
    }

    stairOpeningPolygonsForValidation(stair, topFloor) {
        const floorZ = getFloorElevation(topFloor);
        const thresholdZ = floorZ - 2;
        return this.stairStepPolygonsForValidation(stair)
            .filter((step) => Number(step.z) >= thresholdZ - 0.000001 && Number(step.z) <= floorZ + 0.000001)
            .map((step) => positiveAreaRing(step.polygon));
    }

    stairLandingRectangles(stair) {
        const treads = Array.isArray(stair.treads) ? stair.treads.map((tread, index) => normalizedStairTread(tread, `stair ${stair.id} tread ${index}`)) : [];
        if (treads.length < 2 || stair.ladder === true) return [];
        const { topFloor, bottomFloor } = this.stairTopAndBottomFloors(stair);
        const topIndex = String(stair.direction || "up") === "down" ? 0 : treads.length - 1;
        const bottomIndex = String(stair.direction || "up") === "down" ? treads.length - 1 : 0;
        const rectFor = (index, neighborIndex, floor, label) => {
            const tread = treads[index];
            const neighbor = treads[neighborIndex];
            const dx = tread.center.x - neighbor.center.x;
            const dy = tread.center.y - neighbor.center.y;
            const length = Math.hypot(dx, dy);
            if (!Number.isFinite(length) || length <= 0.000001) {
                throw new Error(`stair ${stair.id} ${label} landing requires separated tread centers`);
            }
            const ux = dx / length;
            const uy = dy / length;
            return {
                floor,
                label,
                polygon: positiveAreaRing([
                    tread.left,
                    tread.right,
                    { x: tread.right.x + ux, y: tread.right.y + uy },
                    { x: tread.left.x + ux, y: tread.left.y + uy }
                ])
            };
        };
        return [
            rectFor(topIndex, topIndex === 0 ? 1 : topIndex - 1, topFloor, "top"),
            rectFor(bottomIndex, bottomIndex === 0 ? 1 : bottomIndex - 1, bottomFloor, "bottom")
        ];
    }

    polygonFitsFloor(polygon, floor, label) {
        const clipper = polygonClipper(label);
        const source = [[closedClipRing(polygon, `${label} polygon`)]];
        const clipped = clipper.intersection(source, [floorClipPolygon(floor, `${label} floor ${getFloorId(floor)}`)]);
        return Math.abs(clipGeometryArea(source) - clipGeometryArea(clipped)) <= 0.000001;
    }

    polygonIntersectsFloorWalls(polygon, floor, label) {
        const floorId = getFloorId(floor);
        return getBuildingWalls(this.building)
            .filter((wall) => String(wall.fragmentId || wall.floorId) === floorId)
            .some((wall) => polygonsIntersectOrTouch2d(polygon, wallFootprintPolygonFromResolvedGeometry(wall), ROOF_SUPPORT_POINT_EPSILON));
    }

    stairMoveIsLegal(stair) {
        const { topFloor } = this.stairTopAndBottomFloors(stair);
        const openingPolygons = this.stairOpeningPolygonsForValidation(stair, topFloor);
        if (!openingPolygons.length) return false;
        for (const polygon of openingPolygons) {
            if (!this.polygonFitsFloor(polygon, topFloor, `stair ${stair.id} upper-floor opening`)) return false;
            if (this.polygonIntersectsFloorWalls(polygon, topFloor, `stair ${stair.id} upper-floor opening`)) return false;
        }
        for (const landing of this.stairLandingRectangles(stair)) {
            if (!this.polygonFitsFloor(landing.polygon, landing.floor, `stair ${stair.id} ${landing.label} landing`)) return false;
            if (this.polygonIntersectsFloorWalls(landing.polygon, landing.floor, `stair ${stair.id} ${landing.label} landing`)) return false;
        }
        return true;
    }

    moveSelectedStair(snapshot, point) {
        if (!snapshot || !Array.isArray(snapshot.originals)) return false;
        if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) {
            throw new Error("stair drag move requires a finite point");
        }
        const dx = Number(point.x) - Number(snapshot.startPoint.x);
        const dy = Number(point.y) - Number(snapshot.startPoint.y);
        const candidates = snapshot.originals.map((entry) => ({
            ...entry,
            stair: this.translateStairRecord(this.cloneStairForDrag(entry.stair), dx, dy)
        }));
        if (!candidates.every((entry) => this.stairMoveIsLegal(entry.stair))) return false;
        candidates.forEach((entry) => {
            const current = this.findStairById(entry.stairId);
            if (!current) throw new Error(`cannot move missing stair: ${entry.stairId}`);
            Object.keys(current.stair).forEach((key) => delete current.stair[key]);
            Object.assign(current.stair, entry.stair);
        });
        this.emitChange();
        return true;
    }

    deleteSelectedStair() {
        const stairIds = this.selectedStairIds();
        if (!stairIds.length) return false;
        const selectedIds = new Set(stairIds.map((id) => String(id)));
        const entries = stairIds.map((stairId) => this.findStairById(stairId)).filter(Boolean);
        if (!entries.length) return false;
        const floors = new Set(entries.map((entry) => entry.floor));
        floors.forEach((floor) => {
            floor.stairs = getFloorStairs(floor).filter((stair) => !selectedIds.has(String(stair.id)));
        });
        const firstFloor = entries[0].floor;
        this.selection = createSelection("floor", { floorId: getFloorId(firstFloor) });
        this.selectedFloorIds = new Set([getFloorId(firstFloor)]);
        this.layerSelectionMode = "floor";
        this.emitChange();
        return true;
    }

    addBeamToFloor(floorId, beamOptions = {}) {
        const floor = findFloor(this.building, floorId);
        if (!floor) throw new Error(`cannot add beam to missing floor: ${floorId}`);
        const beam = createBeam({ floorId: getFloorId(floor), ...beamOptions });
        if (!Array.isArray(floor.beams)) floor.beams = [];
        floor.beams.push(beam);
        this.selection = createSelection("beam", { floorId: getFloorId(floor), beamId: beam.id });
        this.selectedFloorIds = new Set([getFloorId(floor)]);
        this.layerSelectionMode = "floor";
        this.emitChange();
        return beam;
    }

    deleteSelectedBeam() {
        const beamIds = this.selectedBeamIds();
        if (!beamIds.length) return false;
        const selectedIds = new Set(beamIds.map((id) => String(id)));
        const entries = beamIds.map((beamId) => this.findBeamById(beamId)).filter(Boolean);
        if (!entries.length) return false;
        const floors = new Set(entries.map((entry) => entry.floor));
        floors.forEach((floor) => {
            floor.beams = getFloorBeams(floor).filter((b) => !selectedIds.has(String(b.id)));
        });
        this.selection = createSelection("floor", { floorId: getFloorId(entries[0].floor) });
        this.emitChange();
        return true;
    }

    moveSelectedBeamVertical(originalStates, deltaZ, options = {}) {
        const beams = this.selectedBeams();
        if (!beams.length) return false;
        const snapDistance = Number.isFinite(Number(options.snapDistance)) ? Math.max(0, Number(options.snapDistance)) : 0;
        let changed = false;
        beams.forEach((beam) => {
            const origEntry = Array.isArray(originalStates)
                ? originalStates.find((e) => Number(e.beamId) === Number(beam.id))
                : null;
            if (!origEntry) return;
            let nextZ = Number(origEntry.bottomZ) + Number(deltaZ);
            if (!Number.isFinite(nextZ)) return;
            if (snapDistance > 0) {
                const snapped = this._snapBeamBottomZ(beam, nextZ, snapDistance);
                if (snapped !== null) nextZ = snapped;
            }
            beam.bottomZ = nextZ;
            changed = true;
        });
        if (!changed) return false;
        this.emitChange();
        return true;
    }

    _snapBeamBottomZ(beam, candidateZ, threshold) {
        const snapPoints = [];
        const addHostSnaps = (attachment) => {
            if (!attachment) return;
            if (attachment.kind === "wall") {
                const wall = findWall(this.building, attachment.hostId);
                if (wall) {
                    snapPoints.push(Number(wall.bottomZ));
                    snapPoints.push(Number(wall.bottomZ) + Number(wall.height) - Number(beam.height));
                }
            } else if (attachment.kind === "column") {
                const col = this._findColumnById(attachment.hostId);
                if (col) {
                    snapPoints.push(Number(col.bottomZ));
                    snapPoints.push(Number(col.bottomZ) + Number(col.height) - Number(beam.height));
                }
            }
        };
        addHostSnaps(beam.startAttachment);
        addHostSnaps(beam.endAttachment);
        const startAttKey = this._beamAttachmentMatchKey(beam.startAttachment);
        const endAttKey = this._beamAttachmentMatchKey(beam.endAttachment);
        getBuildingBeams(this.building).forEach((other) => {
            if (Number(other.id) === Number(beam.id)) return;
            const otherStartKey = this._beamAttachmentMatchKey(other.startAttachment);
            const otherEndKey = this._beamAttachmentMatchKey(other.endAttachment);
            if ((startAttKey && (otherStartKey === startAttKey || otherEndKey === startAttKey)) ||
                (endAttKey && (otherStartKey === endAttKey || otherEndKey === endAttKey))) {
                snapPoints.push(Number(other.bottomZ));
            }
        });
        let best = null;
        let bestDist = Infinity;
        for (const sp of snapPoints) {
            if (!Number.isFinite(sp)) continue;
            const d = Math.abs(candidateZ - sp);
            if (d < threshold && d < bestDist) { bestDist = d; best = sp; }
        }
        return best;
    }

    _beamAttachmentMatchKey(attachment) {
        if (!attachment || attachment.kind === "free") return null;
        if (attachment.kind === "column") return `column:${attachment.hostId}`;
        if (attachment.kind === "wall") return `wall:${attachment.hostId}:${Number(attachment.t).toFixed(6)}`;
        return null;
    }

    selectBeamEndpoint(floorId, beamId, endpointKey, options = {}) {
        const floor = findFloor(this.building, floorId);
        if (!floor) throw new Error(`cannot select beam endpoint for missing floor: ${floorId}`);
        const beam = this.findBeam(floorId, beamId);
        if (!beam) throw new Error(`cannot select endpoint of missing beam: ${beamId}`);
        if (endpointKey !== "startAttachment" && endpointKey !== "endAttachment") {
            throw new Error(`unknown beam endpoint key: ${endpointKey}`);
        }
        if (!options.preserveView) {
            this.selectedFloorIds = new Set([getFloorId(floor)]);
            this.layerSelectionMode = "floor";
        }
        this.selection = createSelection("beam", { floorId: getFloorId(floor), beamId: beam.id, beamEndpointKey: endpointKey });
        this.emitChange();
    }

    moveSelectedBeamEndpoint(worldPoint, threshold, options = {}) {
        const beam = this.selectedBeam();
        const endpointKey = this.selection && this.selection.beamEndpointKey;
        if (!beam || (endpointKey !== "startAttachment" && endpointKey !== "endAttachment")) return false;
        const floor = this.findBeamById(beam.id);
        if (!floor) return false;
        const snap = this.resolveBeamEndpointSnap(worldPoint, threshold, beam.floorId, options);
        const previousAttachment = JSON.parse(JSON.stringify(beam[endpointKey]));
        if (snap) {
            if (snap.snapKind === "columnTop") {
                beam[endpointKey] = { kind: "column", hostId: snap.hostId };
            } else if (snap.snapKind === "wallEndpoint" || snap.snapKind === "wallCenterline") {
                beam[endpointKey] = { kind: "wall", hostId: snap.hostId, t: Number(snap.t) };
            } else if (snap.snapKind === "beamEndpoint") {
                const otherBeam = getFloorBeams(findFloor(this.building, beam.floorId) || {}).find((b) => Number(b.id) === Number(snap.beamId));
                if (otherBeam) {
                    const pts = this.beamWorldPoints(otherBeam);
                    if (pts) beam[endpointKey] = { kind: "free", x: snap.x, y: snap.y };
                }
            } else {
                beam[endpointKey] = { kind: "free", x: snap.x, y: snap.y };
            }
        } else {
            beam[endpointKey] = { kind: "free", x: Number(worldPoint.x), y: Number(worldPoint.y) };
        }
        const pts = this.beamWorldPoints(beam);
        if (!pts || Math.hypot(pts.end.x - pts.start.x, pts.end.y - pts.start.y) < 0.000001) {
            beam[endpointKey] = previousAttachment;
            return false;
        }
        this.emitChange();
        return true;
    }

    beamWorldPoints(beam) {
        const resolveAttachment = (attachment, overhang, otherAttachment) => {
            if (!attachment) return null;
            if (attachment.kind === "wall") {
                const wall = findWall(this.building, attachment.hostId);
                if (!wall) return null;
                const pts = wallPoints(this.building, wall);
                if (!pts || pts.length < 2) return null;
                const t = Number.isFinite(Number(attachment.t)) ? Number(attachment.t) : 0;
                return {
                    x: pts[0].x + (pts[1].x - pts[0].x) * t,
                    y: pts[0].y + (pts[1].y - pts[0].y) * t,
                    z: Number(beam.bottomZ)
                };
            }
            if (attachment.kind === "column") {
                const col = this._findColumnById(attachment.hostId);
                if (!col) return null;
                return { x: col.position.x, y: col.position.y, z: Number(beam.bottomZ) };
            }
            if (attachment.kind === "free") {
                return { x: Number(attachment.x) || 0, y: Number(attachment.y) || 0, z: Number(beam.bottomZ) };
            }
            return null;
        };
        const start = resolveAttachment(beam.startAttachment, beam.startOverhang, beam.endAttachment);
        const end = resolveAttachment(beam.endAttachment, beam.endOverhang, beam.startAttachment);
        if (!start || !end) return null;
        const dx = end.x - start.x;
        const dy = end.y - start.y;
        const len = Math.hypot(dx, dy);
        if (len < 0.000001) return { start, end };
        const ux = dx / len;
        const uy = dy / len;
        return {
            start: { x: start.x - ux * Number(beam.startOverhang), y: start.y - uy * Number(beam.startOverhang), z: start.z },
            end: { x: end.x + ux * Number(beam.endOverhang), y: end.y + uy * Number(beam.endOverhang), z: end.z }
        };
    }

    snapBeamEndpoint(point, threshold, floorId) {
        const floor = findFloor(this.building, floorId);
        if (!floor) return null;
        let best = null;
        let bestDist = Infinity;

        const trySnap = (candidate) => {
            if (!candidate) return;
            const d = Math.hypot(Number(point.x) - candidate.x, Number(point.y) - candidate.y);
            if (d < bestDist) { bestDist = d; best = candidate; }
        };

        if (bestDist > threshold) {
            getFloorColumns(floor).forEach((col) => {
                trySnap({ x: col.position.x, y: col.position.y, snapKind: "columnTop", hostId: col.id });
            });
        }

        if (bestDist > threshold) {
            getBuildingWalls(this.building)
                .filter((w) => String(w.fragmentId || w.floorId) === String(getFloorId(floor)))
                .forEach((wall) => {
                    const pts = wallPoints(this.building, wall);
                    if (!pts || pts.length < 2) return;
                    for (let i = 0; i < pts.length; i++) {
                        const p = pts[i];
                        const d = Math.hypot(Number(point.x) - p.x, Number(point.y) - p.y);
                        if (d < threshold && d < bestDist) {
                            bestDist = d;
                            best = { x: p.x, y: p.y, snapKind: "wallEndpoint", hostId: wall.id, t: i === 0 ? 0 : 1 };
                        }
                    }
                });
        }

        if (bestDist > threshold) {
            getBuildingWalls(this.building)
                .filter((w) => String(w.fragmentId || w.floorId) === String(getFloorId(floor)))
                .forEach((wall) => {
                    const pts = wallPoints(this.building, wall);
                    if (!pts || pts.length < 2) return;
                    const ax = pts[0].x, ay = pts[0].y, bx = pts[1].x, by = pts[1].y;
                    const dx = bx - ax, dy = by - ay;
                    const lenSq = dx * dx + dy * dy;
                    if (lenSq < 0.000001) return;
                    const t = Math.max(0, Math.min(1, ((point.x - ax) * dx + (point.y - ay) * dy) / lenSq));
                    const px = ax + t * dx, py = ay + t * dy;
                    const d = Math.hypot(Number(point.x) - px, Number(point.y) - py);
                    if (d < threshold && d < bestDist) {
                        bestDist = d;
                        best = { x: px, y: py, snapKind: "wallCenterline", hostId: wall.id, t };
                    }
                });
        }

        if (bestDist > threshold) {
            getFloorBeams(floor).forEach((other) => {
                const pts = this.beamWorldPoints(other);
                if (!pts) return;
                for (const p of [pts.start, pts.end]) {
                    const d = Math.hypot(Number(point.x) - p.x, Number(point.y) - p.y);
                    if (d < threshold && d < bestDist) {
                        bestDist = d;
                        best = { x: p.x, y: p.y, snapKind: "beamEndpoint", beamId: other.id };
                    }
                }
            });
        }

        return best;
    }

    screenPickedWall(options = {}, floorId = null) {
        const screenHit = options.renderer &&
            options.screenPoint &&
            typeof options.renderer.pickAtScreen === "function"
            ? options.renderer.pickAtScreen(options.screenPoint, {
                includeMountedObjects: false,
                includeColumns: false,
                includeBeams: false
            })
            : null;
        if (!screenHit || screenHit.type !== "wall" || !screenHit.wall) return null;
        const wallFloorId = screenHit.floor
            ? getFloorId(screenHit.floor)
            : (screenHit.wall.fragmentId || screenHit.wall.floorId);
        if (floorId !== null && floorId !== undefined && String(wallFloorId) !== String(floorId)) return null;
        return screenHit.wall;
    }

    snapBeamEndpointToWall(point, wall, threshold = 0) {
        if (!wall) throw new Error("beam wall snapping requires a wall");
        const pts = wallPoints(this.building, wall);
        if (!pts || pts.length < 2) {
            throw new Error(`beam wall snapping requires two-point wall centerline for wall ${wall.id}`);
        }
        const snapThreshold = Math.max(0, Number(threshold) || 0);
        let bestEndpoint = null;
        let bestEndpointDist = Infinity;
        if (snapThreshold > 0) {
            for (let i = 0; i < pts.length; i++) {
                const p = pts[i];
                const d = Math.hypot(Number(point.x) - Number(p.x), Number(point.y) - Number(p.y));
                if (d < snapThreshold && d < bestEndpointDist) {
                    bestEndpointDist = d;
                    bestEndpoint = { point: p, t: i === 0 ? 0 : 1 };
                }
            }
            if (bestEndpoint) {
                return {
                    x: Number(bestEndpoint.point.x),
                    y: Number(bestEndpoint.point.y),
                    snapKind: "wallEndpoint",
                    hostId: wall.id,
                    t: bestEndpoint.t
                };
            }
        }
        const a = pts[0];
        const b = pts[1];
        const dx = Number(b.x) - Number(a.x);
        const dy = Number(b.y) - Number(a.y);
        const lenSq = dx * dx + dy * dy;
        if (!Number.isFinite(lenSq) || lenSq <= 0.000001) {
            throw new Error(`beam wall snapping cannot use zero-length wall ${wall.id}`);
        }
        const t = Math.max(0, Math.min(1, ((Number(point.x) - Number(a.x)) * dx + (Number(point.y) - Number(a.y)) * dy) / lenSq));
        return {
            x: Number(a.x) + dx * t,
            y: Number(a.y) + dy * t,
            snapKind: "wallCenterline",
            hostId: wall.id,
            t
        };
    }

    resolveBeamEndpointSnap(point, threshold, floorId, options = {}) {
        const wall = this.screenPickedWall(options, floorId);
        const floor = wall ? findFloor(this.building, wall.fragmentId || wall.floorId || floorId) : null;
        const screenSnap = wall && floor
            ? wallPlacementPointAtScreen(this, wall, floor, options.screenPoint, options.renderer, {
                worldX: Number(point.x),
                worldY: Number(point.y)
            })
            : null;
        if (!wall) return this.snapBeamEndpoint(point, threshold, floorId);
        const snap = screenSnap || this.snapBeamEndpointToWall(point, wall, threshold);
        return { ...snap, hostId: wall.id };
    }

    resolveColumnSnap(point, threshold, floorId, options = {}) {
        const wall = this.screenPickedWall(options, floorId);
        const floor = wall ? findFloor(this.building, wall.fragmentId || wall.floorId || floorId) : null;
        const screenSnap = wall && floor
            ? wallPlacementPointAtScreen(this, wall, floor, options.screenPoint, options.renderer, {
                worldX: Number(point.x),
                worldY: Number(point.y),
                ...(options.snapPointsPerSection === undefined ? {} : { snapPointsPerSection: options.snapPointsPerSection })
            })
            : null;
        return wall
            ? (screenSnap || this.snapColumnToWall(point, wall, threshold, options))
            : this.snapColumnPosition(point, threshold, floorId, options);
    }

    snapColumnPosition(point, threshold, floorId, options = {}) {
        const floor = findFloor(this.building, floorId);
        if (!floor) return null;
        let best = null;
        let bestDist = Infinity;

        getBuildingWalls(this.building)
            .filter((w) => String(w.fragmentId || w.floorId) === String(getFloorId(floor)))
            .forEach((wall) => {
                const pts = wallPoints(this.building, wall);
                if (!pts || pts.length < 2) return;
                for (const p of pts) {
                    const d = Math.hypot(Number(point.x) - p.x, Number(point.y) - p.y);
                    if (d < threshold && d < bestDist) {
                        bestDist = d;
                        best = { x: p.x, y: p.y, snapKind: "wallEndpoint", wall };
                    }
                }
            });

        if (bestDist > threshold) {
            getBuildingWalls(this.building)
                .filter((w) => String(w.fragmentId || w.floorId) === String(getFloorId(floor)))
                .forEach((wall) => {
                    const pts = wallPoints(this.building, wall);
                    if (!pts || pts.length < 2) return;
                    const ax = pts[0].x, ay = pts[0].y, bx = pts[1].x, by = pts[1].y;
                    const dx = bx - ax, dy = by - ay;
                    const lenSq = dx * dx + dy * dy;
                    if (lenSq < 0.000001) return;
                    const t = Math.max(0, Math.min(1, ((point.x - ax) * dx + (point.y - ay) * dy) / lenSq));
                    const px = ax + t * dx, py = ay + t * dy;
                    const d = Math.hypot(Number(point.x) - px, Number(point.y) - py);
                    if (d < threshold && d < bestDist) {
                        bestDist = d;
                        const snap = {
                            x: px,
                            y: py,
                            t,
                            snapKind: "wallCenterline",
                            wall,
                            floor,
                            points: pts
                        };
                        best = options.snapPointsPerSection === undefined
                            ? snap
                            : quantizeWallPlacementSnap(snap, options.snapPointsPerSection);
                    }
                });
        }

        if (bestDist > threshold) {
            for (const v of (floor.outerPolygon || [])) {
                const d = Math.hypot(Number(point.x) - v.x, Number(point.y) - v.y);
                if (d < threshold && d < bestDist) {
                    bestDist = d;
                    best = { x: v.x, y: v.y, snapKind: "floorVertex", vertexId: v.id };
                }
            }
        }

        if (bestDist > threshold) {
            const ring = floor.outerPolygon || [];
            for (let i = 0; i < ring.length; i++) {
                const a = ring[i], b = ring[(i + 1) % ring.length];
                const dx = b.x - a.x, dy = b.y - a.y;
                const lenSq = dx * dx + dy * dy;
                if (lenSq < 0.000001) continue;
                const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lenSq));
                const px = a.x + t * dx, py = a.y + t * dy;
                const d = Math.hypot(Number(point.x) - px, Number(point.y) - py);
                if (d < threshold && d < bestDist) {
                    bestDist = d;
                    best = { x: px, y: py, snapKind: "floorEdge" };
                }
            }
        }

        return best;
    }

    snapColumnToWall(point, wall, threshold = 0, options = {}) {
        if (!wall) throw new Error("column wall snapping requires a wall");
        const pts = wallPoints(this.building, wall);
        if (!pts || pts.length < 2) {
            throw new Error(`column wall snapping requires two-point wall centerline for wall ${wall.id}`);
        }
        const a = pts[0];
        const b = pts[1];
        const snapThreshold = Math.max(0, Number(threshold) || 0);
        let bestEndpoint = null;
        let bestEndpointDist = Infinity;
        if (snapThreshold > 0) {
            for (const p of pts) {
                const d = Math.hypot(Number(point.x) - Number(p.x), Number(point.y) - Number(p.y));
                if (d < snapThreshold && d < bestEndpointDist) {
                    bestEndpointDist = d;
                    bestEndpoint = p;
                }
            }
            if (bestEndpoint) {
                return {
                    x: Number(bestEndpoint.x),
                    y: Number(bestEndpoint.y),
                    snapKind: "wallEndpoint",
                    wall
                };
            }
        }
        const dx = Number(b.x) - Number(a.x);
        const dy = Number(b.y) - Number(a.y);
        const lenSq = dx * dx + dy * dy;
        if (!Number.isFinite(lenSq) || lenSq <= 0.000001) {
            throw new Error(`column wall snapping cannot use zero-length wall ${wall.id}`);
        }
        const t = Math.max(0, Math.min(1, ((Number(point.x) - Number(a.x)) * dx + (Number(point.y) - Number(a.y)) * dy) / lenSq));
        const snap = {
            x: Number(a.x) + dx * t,
            y: Number(a.y) + dy * t,
            t,
            snapKind: "wallCenterline",
            wall,
            points: pts
        };
        return options.snapPointsPerSection === undefined
            ? snap
            : quantizeWallPlacementSnap(snap, options.snapPointsPerSection);
    }

    isExteriorWall(wall) {
        return !!(
            wall &&
            wall.role === "perimeter" &&
            wall.attachment &&
            wall.attachment.kind === "fragmentEdge" &&
            wall.attachment.ring === "outer"
        );
    }

    columnRotationForFloorVertex(floor, vertexId) {
        const ring = floor && floor.outerPolygon;
        if (!Array.isArray(ring)) return 0;
        const idx = ring.findIndex((v) => v.id === vertexId);
        if (idx < 0) return 0;
        const prev = ring[(idx - 1 + ring.length) % ring.length];
        const curr = ring[idx];
        const next = ring[(idx + 1) % ring.length];
        const angleIn = Math.atan2(curr.y - prev.y, curr.x - prev.x);
        const angleOut = Math.atan2(next.y - curr.y, next.x - curr.x);
        const bisector = (angleIn + angleOut) / 2;
        return bisector + Math.PI / 2;
    }

    columnRotationForWall(wall) {
        const pts = wallPoints(this.building, wall);
        if (!pts || pts.length < 2) throw new Error(`column rotation requires two-point wall centerline for wall ${wall && wall.id}`);
        return Math.atan2(Number(pts[1].y) - Number(pts[0].y), Number(pts[1].x) - Number(pts[0].x));
    }

    // ── Column helpers ───────────────────────────────────────────────────────

    _findColumnById(columnId) {
        const entry = this._findColumnEntryById(columnId);
        return entry ? entry.column : null;
    }

    _findColumnEntryById(columnId) {
        for (const floor of getBuildingFloors(this.building)) {
            const col = getFloorColumns(floor).find((c) => Number(c.id) === Number(columnId));
            if (col) return { column: col, floor };
        }
        return null;
    }

    findColumnInFloor(floorId, columnId) {
        const floor = findFloor(this.building, floorId);
        return (floor && getFloorColumns(floor).find((c) => Number(c.id) === Number(columnId))) || null;
    }

    selectedColumn() {
        const columnIds = this.selectedColumnIds();
        return columnIds.length ? this._findColumnById(columnIds[0]) : null;
    }

    selectedColumnIds() {
        if (!this.selection || this.selection.kind !== "column") return [];
        if (Array.isArray(this.selection.columnIds) && this.selection.columnIds.length > 0) {
            return this.selection.columnIds;
        }
        return this.selection.columnId !== null && this.selection.columnId !== undefined ? [this.selection.columnId] : [];
    }

    selectedColumns() {
        return this.selectedColumnIds().map((columnId) => {
            const entry = this._findColumnEntryById(columnId);
            if (!entry) throw new Error(`selected column is missing from building: ${columnId}`);
            return entry.column;
        });
    }

    isColumnSelected(columnId) {
        return this.selectedColumnIds().some((id) => Number(id) === Number(columnId));
    }

    selectColumn(floorId, columnId, options = {}) {
        this.selectColumns([columnId], options);
    }

    resolveColumnSelection(columnIds, label = "column selection") {
        const uniqueIds = [];
        (Array.isArray(columnIds) ? columnIds : []).forEach((id) => {
            if (!uniqueIds.some((candidate) => String(candidate) === String(id))) uniqueIds.push(id);
        });
        if (!uniqueIds.length) return { columnIds: [], columns: [], floors: [] };
        const entries = uniqueIds.map((id) => {
            const entry = this._findColumnEntryById(id);
            if (!entry) throw new Error(`${label} references missing column: ${id}`);
            return entry;
        });
        return {
            columnIds: entries.map((entry) => entry.column.id),
            columns: entries.map((entry) => entry.column),
            floors: entries.map((entry) => entry.floor)
        };
    }

    applyColumnSelection(columnIds, options = {}) {
        const resolved = this.resolveColumnSelection(columnIds, "column selection");
        if (!resolved.columnIds.length) {
            this.selectBuilding();
            return false;
        }
        if (!options.preserveView) {
            this.selectedFloorIds = new Set(resolved.floors.map((floor) => getFloorId(floor)));
            this.layerSelectionMode = "floor";
        }
        this.selection = createSelection("column", {
            floorId: getFloorId(resolved.floors[0]),
            columnIds: resolved.columnIds
        });
        this.emitChange();
        return true;
    }

    selectColumns(columnIds, options = {}) {
        return this.applyColumnSelection(columnIds, options);
    }

    addColumnsToSelection(columnIds, options = {}) {
        const nextColumnIds = [...this.selectedColumnIds()];
        (Array.isArray(columnIds) ? columnIds : []).forEach((columnId) => {
            const entry = this._findColumnEntryById(columnId);
            if (!entry) throw new Error(`cannot add missing column to selection: ${columnId}`);
            if (!nextColumnIds.some((id) => String(id) === String(entry.column.id))) nextColumnIds.push(entry.column.id);
        });
        return this.applyColumnSelection(nextColumnIds, options);
    }

    removeColumnsFromSelection(columnIds, options = {}) {
        const removeIds = new Set((Array.isArray(columnIds) ? columnIds : []).map((id) => String(id)));
        removeIds.forEach((columnId) => {
            if (!this._findColumnById(columnId)) throw new Error(`cannot remove missing column from selection: ${columnId}`);
        });
        const previousIds = this.selectedColumnIds();
        const nextColumnIds = previousIds.filter((id) => !removeIds.has(String(id)));
        if (nextColumnIds.length === previousIds.length) return false;
        if (!nextColumnIds.length) {
            const firstRemoved = [...removeIds][0];
            const entry = firstRemoved !== undefined ? this._findColumnEntryById(firstRemoved) : null;
            if (entry) this.selectLevel(getFloorId(entry.floor), options);
            else this.selectBuilding();
            return true;
        }
        return this.applyColumnSelection(nextColumnIds, options);
    }

    addColumnToSelection(columnId, options = {}) {
        this.addColumnsToSelection([columnId], options);
        return true;
    }

    removeColumnFromSelection(columnId, options = {}) {
        return this.removeColumnsFromSelection([columnId], options);
    }

    columnCreationSettings(hostWall = null) {
        const hostFloor = hostWall
            ? findFloor(this.building, hostWall.fragmentId || hostWall.floorId)
            : this.selectedFloor();
        const fallbackHeight = hostFloor && Number.isFinite(Number(hostFloor.defaultWallHeight)) && Number(hostFloor.defaultWallHeight) > 0
            ? Number(hostFloor.defaultWallHeight)
            : DEFAULTS.wallHeight;
        return {
            height: this.columnTool.heightMode === "fixed" && Number.isFinite(Number(this.columnTool.height)) && Number(this.columnTool.height) > 0
                ? Number(this.columnTool.height)
                : (hostWall && Number.isFinite(Number(hostWall.height)) && Number(hostWall.height) > 0
                    ? Number(hostWall.height)
                    : fallbackHeight),
            heightMode: this.columnTool.heightMode === "fixed" ? "fixed" : (hostWall ? "wall" : "fixed"),
            thickness: this.columnTool.thickness,
            width: this.columnTool.width,
            sideCount: this.columnTool.sideCount,
            texture: this.columnTool.texture
        };
    }

    minimumColumnDepthForWall(wall) {
        if (!wall) return DEFAULT_COLUMN_EXTRA_THICKNESS;
        const wallThickness = Number.isFinite(Number(wall.thickness))
            ? Number(wall.thickness)
            : DEFAULTS.wallThickness;
        return Math.min(COLUMN_DIMENSION_MAX, wallThickness + DEFAULT_COLUMN_EXTRA_THICKNESS);
    }

    minimumColumnDepth(column) {
        const wall = column && column.wallId !== undefined && column.wallId !== null && column.wallId !== ""
            ? findWall(this.building, column.wallId)
            : null;
        return this.minimumColumnDepthForWall(wall);
    }

    clampColumnDepthForWall(value, wall, label = "column depth") {
        return Math.max(this.minimumColumnDepthForWall(wall), normalizeColumnExtraThickness(value, label));
    }

    updateColumnToolThickness(value) {
        const thickness = normalizeColumnExtraThickness(value, "column tool thickness");
        this.columnTool.thickness = thickness;
        this.inputs.columnThickness = thickness;
        this.saveColumnToolSettingsToBrowser();
        this.emitChange();
    }

    updateColumnToolSideCount(value) {
        const sideCount = normalizeColumnSideCount(value, "column tool side count");
        this.columnTool.sideCount = sideCount;
        this.inputs.columnSideCount = sideCount;
        this.saveColumnToolSettingsToBrowser();
        this.emitChange();
    }

    updateColumnToolWidth(value) {
        const width = normalizeColumnWidth(value, "column tool width");
        this.columnTool.width = width;
        this.inputs.columnWidth = width;
        this.saveColumnToolSettingsToBrowser();
        this.emitChange();
    }

    updateColumnToolHeight(value) {
        const raw = String(value ?? "").trim();
        if (raw === "") {
            this.columnTool.height = null;
            this.columnTool.heightMode = "wall";
            this.inputs.columnHeight = null;
            this.saveColumnToolSettingsToBrowser();
            this.emitChange();
            return;
        }
        const height = normalizeColumnHeight(raw, "column tool height");
        this.columnTool.height = height;
        this.columnTool.heightMode = "fixed";
        this.inputs.columnHeight = height;
        this.saveColumnToolSettingsToBrowser();
        this.emitChange();
    }

    updateColumnToolTexture(texture) {
        if (typeof texture !== "string" || texture.length === 0) {
            throw new Error("column tool texture path must be a non-empty string");
        }
        this.columnTool.texture = texture;
        this.inputs.columnTexture = texture;
        this.paintTextures.walls = texture;
        this.saveColumnToolSettingsToBrowser();
        this.emitChange();
    }

    updateColumnToolSnapPointsPerSection(value) {
        const snapPointsPerSection = normalizeWallSnapPointsPerSection(value, "column snap points per section");
        this.columnTool.snapPointsPerSection = snapPointsPerSection;
        this.inputs.columnSnapPointsPerSection = snapPointsPerSection;
        this.saveColumnToolSettingsToBrowser();
        this.emitChange();
    }

    columnToolSettingsSnapshot() {
        return {
            thickness: this.columnTool.thickness,
            width: this.columnTool.width,
            height: this.columnTool.heightMode === "fixed" ? this.columnTool.height : null,
            heightMode: this.columnTool.heightMode === "fixed" ? "fixed" : "wall",
            sideCount: this.columnTool.sideCount,
            texture: this.columnTool.texture,
            snapPointsPerSection: this.columnTool.snapPointsPerSection
        };
    }

    saveColumnToolSettingsToBrowser() {
        const storage = browserLocalStorage();
        if (!storage) return false;
        storage.setItem(COLUMN_TOOL_STORAGE_KEY, JSON.stringify(this.columnToolSettingsSnapshot()));
        return true;
    }

    loadColumnToolSettingsFromBrowser() {
        const storage = browserLocalStorage();
        if (!storage) return false;
        const stored = storage.getItem(COLUMN_TOOL_STORAGE_KEY);
        if (!stored) return false;
        const payload = JSON.parse(stored);
        if (!payload || typeof payload !== "object") {
            throw new Error("stored column tool settings must be an object");
        }
        const thickness = normalizeColumnExtraThickness(payload.thickness ?? DEFAULT_COLUMN_EXTRA_THICKNESS, "stored column depth");
        const width = normalizeColumnWidth(payload.width ?? DEFAULT_COLUMN_WIDTH, "stored column width");
        const sideCount = normalizeColumnSideCount(payload.sideCount ?? 4, "stored column side count");
        const texture = String(payload.texture || DEFAULTS.wallTexture);
        if (!texture) throw new Error("stored column tool settings require a texture path");
        const snapPointsPerSection = payload.snapPointsPerSection === undefined
            ? 1
            : normalizeWallSnapPointsPerSection(payload.snapPointsPerSection, "stored column snap points per section");
        const heightMode = String(payload.heightMode || "").trim().toLowerCase() === "fixed" ? "fixed" : "wall";
        const height = heightMode === "fixed" ? normalizeColumnHeight(payload.height, "stored column height") : null;
        this.columnTool = {
            thickness,
            width,
            height,
            heightMode,
            sideCount,
            texture,
            snapPointsPerSection
        };
        this.inputs.columnThickness = thickness;
        this.inputs.columnWidth = width;
        this.inputs.columnHeight = heightMode === "fixed" ? height : null;
        this.inputs.columnSideCount = sideCount;
        this.inputs.columnTexture = texture;
        this.inputs.columnSnapPointsPerSection = snapPointsPerSection;
        if (this.tool === "column") this.paintTextures.walls = texture;
        this.emitChange();
        return true;
    }

    copyColumnToTool(column) {
        if (!column) return false;
        const actualThickness = Number.isFinite(Number(column.depth)) && Number(column.depth) > 0
            ? Number(column.depth)
            : Number(column.size) * 2;
        if (!Number.isFinite(actualThickness) || actualThickness <= 0) {
            throw new Error(`cannot copy invalid column thickness from column ${column.id}`);
        }
        this.columnTool.thickness = normalizeColumnExtraThickness(actualThickness, "copied column depth");
        this.columnTool.width = normalizeColumnWidth(column.width ?? Number(column.size) * 2, "copied column width");
        if (String(column.heightMode || (column.wallId !== null && column.wallId !== undefined ? "wall" : "fixed")).trim().toLowerCase() === "wall") {
            this.columnTool.height = null;
            this.columnTool.heightMode = "wall";
        } else {
            this.columnTool.height = normalizeColumnHeight(column.height, "copied column height");
            this.columnTool.heightMode = "fixed";
        }
        this.columnTool.sideCount = normalizeColumnSideCount(column.sideCount, "copied column side count");
        const texturePath = column.texturePath || DEFAULTS.wallTexture;
        if (typeof texturePath !== "string" || texturePath.length === 0) {
            throw new Error(`cannot copy invalid column texture from column ${column.id}`);
        }
        this.columnTool.texture = texturePath;
        this.inputs.columnThickness = this.columnTool.thickness;
        this.inputs.columnWidth = this.columnTool.width;
        this.inputs.columnHeight = this.columnTool.heightMode === "fixed" ? this.columnTool.height : null;
        this.inputs.columnSideCount = this.columnTool.sideCount;
        this.inputs.columnTexture = this.columnTool.texture;
        this.inputs.columnSnapPointsPerSection = this.columnTool.snapPointsPerSection;
        this.paintTextures.walls = this.columnTool.texture;
        this.saveColumnToolSettingsToBrowser();
        return true;
    }

    setColumnToolActive() {
        const selectedColumn = this.selectedColumn();
        if (selectedColumn) this.copyColumnToTool(selectedColumn);
        this.tool = "column";
        this.draft = null;
        if (!selectedColumn && this.selection && this.selection.kind === "stair") this.clearSelectionForTool();
        this.saveColumnToolSettingsToBrowser();
        this.emitChange();
    }

    updateSelectedColumnThickness(value) {
        if (this.tool === "column") {
            this.updateColumnToolThickness(value);
            return;
        }
        const columns = this.selectedColumns();
        if (!columns.length) throw new Error("cannot update column thickness without a selected column");
        const requestedDepth = normalizeColumnExtraThickness(value, "column depth");
        columns.forEach((col) => {
            col.depth = Math.max(this.minimumColumnDepth(col), requestedDepth);
        });
        this.inputs.columnThickness = columns.length === 1 ? columns[0].depth : requestedDepth;
        this.emitChange();
    }

    updateSelectedColumnWidth(value) {
        if (this.tool === "column") {
            this.updateColumnToolWidth(value);
            return;
        }
        const columns = this.selectedColumns();
        if (!columns.length) throw new Error("cannot update column width without a selected column");
        const width = normalizeColumnWidth(value, "column width");
        columns.forEach((col) => {
            col.width = width;
            col.size = width * 0.5;
        });
        this.inputs.columnWidth = width;
        this.emitChange();
    }

    updateSelectedColumnHeight(value) {
        if (this.tool === "column") {
            this.updateColumnToolHeight(value);
            return;
        }
        const columns = this.selectedColumns();
        if (!columns.length) throw new Error("cannot update column height without a selected column");
        const raw = String(value ?? "").trim();
        if (raw === "") {
            columns.forEach((col) => {
                if (col.wallId === undefined || col.wallId === null || col.wallId === "") {
                    throw new Error(`column ${col.id} cannot peg height without a host wall`);
                }
                col.heightMode = "wall";
            });
            this.inputs.columnHeight = null;
            this.emitChange();
            return;
        }
        const height = normalizeColumnHeight(raw, "column height");
        columns.forEach((col) => {
            col.height = height;
            col.heightMode = "fixed";
        });
        this.inputs.columnHeight = height;
        this.emitChange();
    }

    updateSelectedColumnSideCount(value) {
        if (this.tool === "column") {
            this.updateColumnToolSideCount(value);
            return;
        }
        const columns = this.selectedColumns();
        if (!columns.length) throw new Error("cannot update column side count without a selected column");
        const sideCount = normalizeColumnSideCount(value, "column side count");
        columns.forEach((col) => {
            col.sideCount = sideCount;
        });
        this.inputs.columnSideCount = sideCount;
        this.emitChange();
    }

    updateSelectedColumnTexture(texture) {
        if (this.tool === "column") {
            this.updateColumnToolTexture(texture);
            return;
        }
        const columns = this.selectedColumns();
        if (!columns.length) throw new Error("cannot update column texture without a selected column");
        if (typeof texture !== "string" || texture.length === 0) {
            throw new Error("column texture path must be a non-empty string");
        }
        columns.forEach((col) => {
            col.texturePath = texture;
        });
        this.inputs.columnTexture = texture;
        this.paintTextures.walls = texture;
        this.emitChange();
    }

    rotateSelectedColumns(deltaRadians) {
        const delta = Number(deltaRadians);
        if (!Number.isFinite(delta)) {
            throw new Error("column rotation delta must be finite");
        }
        const columns = this.selectedColumns();
        if (!columns.length) return false;
        columns.forEach((col) => {
            col.rotation = (Number.isFinite(Number(col.rotation)) ? Number(col.rotation) : 0) + delta;
        });
        this.emitChange();
        return true;
    }

    addColumnToFloor(floorId, columnOptions = {}) {
        const floor = findFloor(this.building, floorId);
        if (!floor) throw new Error(`cannot add column to missing floor: ${floorId}`);
        const preserveView = columnOptions.preserveView === true;
        const hostWall = columnOptions.wallId !== undefined && columnOptions.wallId !== null && columnOptions.wallId !== ""
            ? findWall(this.building, columnOptions.wallId)
            : null;
        const requestedDepth = columnOptions.depth ?? columnOptions.thickness ?? (
            columnOptions.size !== undefined ? Number(columnOptions.size) * 2 : DEFAULT_COLUMN_EXTRA_THICKNESS
        );
        const resolvedOptions = {
            ...columnOptions,
            depth: this.clampColumnDepthForWall(
                requestedDepth,
                hostWall,
                "column depth"
            )
        };
        const col = createColumn({
            floorId: getFloorId(floor),
            floorDefaultWallHeight: floor.defaultWallHeight,
            bottomZ: getFloorElevation(floor),
            ...resolvedOptions
        });
        if (!Array.isArray(floor.columns)) floor.columns = [];
        floor.columns.push(col);
        this.selection = createSelection("column", { floorId: getFloorId(floor), columnId: col.id });
        if (!preserveView) {
            this.selectedFloorIds = new Set([getFloorId(floor)]);
            this.layerSelectionMode = "floor";
        }
        this.emitChange();
        return col;
    }

    deleteSelectedColumn() {
        const columnIds = this.selectedColumnIds();
        if (!columnIds.length) return false;
        const selectedIds = new Set(columnIds.map((id) => String(id)));
        const entries = columnIds.map((columnId) => this._findColumnEntryById(columnId)).filter(Boolean);
        if (!entries.length) return false;
        const floors = new Set(entries.map((entry) => entry.floor));
        floors.forEach((floor) => {
            floor.columns = getFloorColumns(floor).filter((c) => !selectedIds.has(String(c.id)));
        });
        getBuildingFloors(this.building).forEach((floor) => getFloorBeams(floor).forEach((beam) => {
            if (beam.startAttachment && beam.startAttachment.kind === "column" &&
                selectedIds.has(String(beam.startAttachment.hostId))) {
                const pts = this.beamWorldPoints(beam);
                beam.startAttachment = pts
                    ? { kind: "free", x: pts.start.x, y: pts.start.y }
                    : { kind: "free", x: 0, y: 0 };
            }
            if (beam.endAttachment && beam.endAttachment.kind === "column" &&
                selectedIds.has(String(beam.endAttachment.hostId))) {
                const pts = this.beamWorldPoints(beam);
                beam.endAttachment = pts
                    ? { kind: "free", x: pts.end.x, y: pts.end.y }
                    : { kind: "free", x: 0, y: 0 };
            }
        }));
        const firstFloor = entries[0].floor;
        this.selection = createSelection("floor", { floorId: getFloorId(firstFloor) });
        this.emitChange();
        return true;
    }

    moveSelectedColumn(worldPoint, threshold, options = {}) {
        const col = this.selectedColumn();
        if (!col) return false;
        const floor = findFloor(this.building, col.floorId);
        if (!floor) return false;
        const snapOptions = options.snapPointsPerSection === undefined
            ? { ...options, snapPointsPerSection: this.columnTool.snapPointsPerSection }
            : options;
        const snap = this.resolveColumnSnap(worldPoint, threshold, col.floorId, snapOptions);
        const pt = snap || worldPoint;
        col.position = { x: Number(pt.x), y: Number(pt.y) };
        col.wallId = snap && snap.wall ? snap.wall.id : null;
        if (col.wallId !== null) {
            col.depth = this.clampColumnDepthForWall(col.depth, snap.wall, "column depth");
            col.rotation = this.columnRotationForWall(snap.wall);
            if (!col.heightMode) col.heightMode = "wall";
        } else if (String(col.heightMode || "").trim().toLowerCase() === "wall") {
            col.heightMode = "fixed";
        }
        if (!snap?.wall && snap && snap.snapKind === "floorVertex" && snap.vertexId) {
            col.rotation = this.columnRotationForFloorVertex(floor, snap.vertexId);
        }
        this.emitChange();
        return true;
    }

    serialize() {
        return serializeBuilding(this.building);
    }

    import(rawJson) {
        const nextBuilding = normalizeImportedBuilding(rawJson);
        const errors = validateBuilding(nextBuilding);
        if (errors.length) {
            throw new Error(`cannot load invalid building: ${errors[0]}`);
        }
        this.building = nextBuilding;
        const firstFloor = getBuildingFloors(this.building)[0] || null;
        this.selectedFloorIds = new Set(getBuildingFloors(this.building).map((floor) => getFloorId(floor)));
        this.layerSelectionMode = "all";
        this.selection = createSelection("building");
        this.syncInputsFromFloor(firstFloor);
        this.draft = null;
        this.updateCameraRotationCenter();
        this.emitChange();
    }

    repairFloorRings(building, options = {}) {
        let repairedRingCount = 0;
        let rebuiltPerimeterFloorCount = 0;
        const forceRebuildPerimeters = options.forceRebuildPerimeters === true;
        const repairedOuterFloorIds = new Set();
        getBuildingFloors(building).forEach((floor) => {
            const floorId = getFloorId(floor);
            const outerError = simplePolygonRingError(floor.outerPolygon, `floor ${floorId} outerPolygon`);
            if (outerError) {
                floor.outerPolygon = repairSimplePolygonRing(floor.outerPolygon, `floor ${floorId} outerPolygon`);
                repairedRingCount += 1;
                repairedOuterFloorIds.add(floorId);
            }
            if (Array.isArray(floor.holes)) {
                floor.holes = floor.holes.map((ring, holeIndex) => {
                    const holeError = simplePolygonRingError(ring, `floor ${floorId} hole ${holeIndex}`);
                    if (!holeError) return ring;
                    repairedRingCount += 1;
                    return repairSimplePolygonRing(ring, `floor ${floorId} hole ${holeIndex}`);
                });
            }
            if (forceRebuildPerimeters || repairedOuterFloorIds.has(floorId)) {
                createPerimeterWallsForFloor(building, floor);
                rebuiltPerimeterFloorCount += 1;
            } else {
                refreshWallSectionEndpoints(building, floor);
            }
        });
        this.repairMountedObjectWallReferences(building);
        return { repairedRingCount, rebuiltPerimeterFloorCount };
    }

    repairMountedObjectWallReferences(building) {
        const wallById = new Set(getBuildingWalls(building).map((wall) => String(wall.id)));
        getBuildingMountedObjects(building).forEach((object) => {
            if (object.mountKind === "gable") return;
            const currentWallId = object.wallId ?? object.mountedWallSectionUnitId;
            if (wallById.has(String(currentWallId))) return;
            const floorId = String(object.floorId || "");
            const objectPoint = { x: Number(object.x), y: Number(object.y) };
            if (!floorId || !Number.isFinite(objectPoint.x) || !Number.isFinite(objectPoint.y)) {
                throw new Error(`cannot repair mounted object ${object.id}: missing wall ${currentWallId}`);
            }
            let best = null;
            getBuildingWalls(building)
                .filter((wall) => String(wall.fragmentId || wall.floorId) === floorId)
                .forEach((wall) => {
                    const points = wallPoints(building, wall);
                    if (points.length !== 2) return;
                    const d = distanceToSegment(objectPoint, points[0], points[1]);
                    if (!best || d < best.distance) best = { wall, distance: d };
                });
            if (!best) {
                throw new Error(`cannot repair mounted object ${object.id}: no replacement wall on floor ${floorId}`);
            }
            object.wallId = best.wall.id;
            object.mountedSectionId = best.wall.id;
            object.mountedWallLineGroupId = best.wall.id;
            object.mountedWallSectionUnitId = best.wall.id;
            object.floorId = best.wall.fragmentId || best.wall.floorId;
        });
    }

    repairBrowserSave(options = {}) {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) {
            throw new Error("no browser-saved building was found");
        }
        const building = normalizeImportedBuilding(stored);
        const initialErrors = validateBuilding(building);
        const forceRebuildPerimeters = options.force === true || options.forceRebuildPerimeters === true;
        if (initialErrors.length === 0 && !forceRebuildPerimeters) {
            this.import(stored);
            return { repairedRingCount: 0, rebuiltPerimeterFloorCount: 0, backupKey: null };
        }
        const { repairedRingCount, rebuiltPerimeterFloorCount } = this.repairFloorRings(building, { forceRebuildPerimeters });
        const errors = validateBuilding(building);
        if (errors.length) {
            throw new Error(`browser save repair failed: ${errors[0]}`);
        }
        const shouldBackup = options.backup !== false;
        const backupKey = shouldBackup ? `${CORRUPT_SAVE_BACKUP_KEY_PREFIX}-${new Date().toISOString()}` : null;
        if (backupKey) localStorage.setItem(backupKey, stored);
        const repaired = serializeBuilding(building);
        localStorage.setItem(STORAGE_KEY, repaired);
        this.import(repaired);
        return { repairedRingCount, rebuiltPerimeterFloorCount, backupKey };
    }

    saveToBrowser() {
        this.assertValidForSave();
        localStorage.setItem(STORAGE_KEY, this.serialize());
    }

    assertValidForSave() {
        const errors = validateBuilding(this.building);
        if (errors.length) {
            throw new Error(`cannot save invalid building: ${errors[0]}`);
        }
    }

    hasBrowserSave() {
        return localStorage.getItem(STORAGE_KEY) !== null;
    }

    loadFromBrowser() {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) {
            throw new Error("no browser-saved building was found");
        }
        this.import(stored);
    }

    reset(options = {}) {
        const createStarterFloor = options.createStarterFloor !== false;
        this.building = createEmptyBuilding();
        this.tool = "select";
        this.selectedFloorIds = new Set();
        this.layerSelectionMode = "floor";
        this.selection = createSelection("building");
        this.draft = null;
        this.floorVertexDrag = null;
        this.hoverWorldPoint = null;
        this.renderError = "";
        this.snapDirection = false;
        this.camera.rotation = 0;
        this.camera.pitch = Math.PI / 4;
        if (createStarterFloor) this.createStarterFloor();
        this.centerCameraOnSelectedFloor();
        this.emitChange();
    }

    centerCameraOnSelectedFloor() {
        const floor = this.selectedFloor();
        if (!floor || !Array.isArray(floor.outerPolygon) || floor.outerPolygon.length < 3) {
            this.camera.x = 0;
            this.camera.y = 0;
            this.camera.z = 0;
            this.camera.rotation = 0;
            this.camera.pitch = Math.PI / 4;
            this.camera.rotationCenter = { x: 0, y: 0 };
            this.emitChange();
            return;
        }
        const center = polygonCentroid(floor.outerPolygon);
        const floorElevation = getFloorElevation(floor);
        const cameraZ = Number.isFinite(Number(this.camera.z)) ? Number(this.camera.z) : 0;
        this.camera.x = center.x;
        this.camera.y = center.y - (floorElevation - cameraZ);
        this.updateCameraRotationCenter();
        this.emitChange();
    }

    centerCameraOnBuilding() {
        const floors = getBuildingFloors(this.building);
        if (!floors.length) {
            this.camera.x = 0;
            this.camera.y = 0;
            this.camera.z = 0;
            this.camera.rotationCenter = { x: 0, y: 0 };
            this.emitChange();
            return;
        }
        const center = this.buildingCenter();
        const zBounds = floors.reduce((bounds, floor) => {
            const bottom = getFloorElevation(floor);
            const height = Number(floor && floor.floorHeight);
            const top = bottom + (Number.isFinite(height) && height > 0 ? height : 0);
            return {
                min: Math.min(bounds.min, bottom),
                max: Math.max(bounds.max, top)
            };
        }, { min: Infinity, max: -Infinity });
        const cameraZ = Number.isFinite(Number(this.camera.z)) ? Number(this.camera.z) : 0;
        const centerZ = Number.isFinite(zBounds.min) && Number.isFinite(zBounds.max)
            ? (zBounds.min + zBounds.max) * 0.5
            : cameraZ;
        this.camera.x = center.x;
        this.camera.y = center.y - (centerZ - cameraZ);
        this.updateCameraRotationCenter();
        this.emitChange();
    }
}
