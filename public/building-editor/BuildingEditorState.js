import {
    addFloor,
    createEmptyBuilding,
    createFloor,
    createRoof,
    createGableMountedObject,
    createPerimeterWallsForFloor,
    createWall,
    createWallMountedObject,
    DEFAULTS,
    duplicateFloor,
    fallbackDeletedVertexEndpointsToPoint,
    findFloor,
    findMountedObject,
    findWall,
    floorVertexWallInsetPoint,
    getBuildingMountedObjects,
    getBuildingFloors,
    getBuildingWalls,
    getFloorRoof,
    getRoofContactPolygon,
    getRoofDomeLevels,
    getRoofPeakPoint,
    getRoofShedDirection,
    defaultRoofPeakPointForFloor,
    getFloorElevation,
    getFloorId,
    getRoofGables,
    normalizeRoofGable,
    mergePerimeterWallsAcrossDeletedVertex,
    normalizeImportedBuilding,
    offsetRing,
    replaceFloorShape,
    refreshWallSectionEndpoints,
    serializeBuilding,
    splitPerimeterWallAtVertex,
    setFloorElevation,
    wallPoints
} from "./BuildingModel.js";
import { distance, distanceToSegment, nearestFloorVertex, nearestWall, pointInPolygon, repairSimplePolygonRing, simplePolygonRingError } from "./BuildingGeometry.js";
import { polygonCentroid } from "./BuildingGeometry.js";
import { validateBuilding } from "./BuildingValidation.js";
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
const MOUNTED_OBJECT_TOOL_STORAGE_KEY = "survivor-building-editor-mounted-object-tools";
const WALL_TOOL_STORAGE_KEY = "survivor-building-editor-wall-tool";
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
const SHED_WALL_ROOF_GAP = 0.002;
const ROOF_SNAP_IMPORTANCE = Object.freeze({
    perimeterWallOuterCorner: 4,
    lowerFloorVertex: 3,
    columnCorner: 2,
    interiorWallCorner: 1
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
    const hasEdgeEndpoint = (wall.startPoint && wall.startPoint.kind === "edge") || (wall.endPoint && wall.endPoint.kind === "edge");
    if (!hasEdgeEndpoint) {
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
        wallId,
        wallIds,
        mountedObjectId,
        mountedObjectIds,
        gableId: fields.gableId !== undefined && fields.gableId !== null ? Number(fields.gableId) : null,
        gableHandle: fields.gableHandle || null,
        wallEndpointKey: fields.wallEndpointKey || null,
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
        this.snapToGrid = true;
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
                doors: { size: 1, aspectRatio: 0.75 },
                windows: { size: 1, aspectRatio: 1 }
            }
        };
        this.wallTool = {
            height: DEFAULTS.wallHeight,
            texture: DEFAULTS.wallTexture,
            thickness: DEFAULTS.wallThickness
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
            wallThickness: DEFAULTS.wallThickness
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
        this.dispatchEvent(new CustomEvent("change"));
    }

    setTool(tool) {
        if (tool === "wall") {
            this.setWallToolActive();
            return;
        }
        if (tool === "polygon" || tool === "scissors") {
            const selectedFloor = this.selectedFloor();
            if (selectedFloor) this.polygonToolElevation = getFloorElevation(selectedFloor);
        }
        this.tool = tool;
        this.draft = null;
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
            aspectRatio: width / height
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
            aspectRatio: width / height
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
                this.mountedObjectTool.settings[category] = { size, aspectRatio };
            }
        });
        const category = String(payload.category || "").trim().toLowerCase();
        if (category === "doors" || category === "windows") {
            this.mountedObjectTool.category = category;
        }
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
                aspectRatio: width / height
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
            aspectRatio
        };
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
        return this.selectedRoofFloorIds().map((floorId) => {
            const floor = findFloor(this.building, floorId);
            if (!floor) throw new Error(`selected roof is missing its floor: ${floorId}`);
            const roof = getFloorRoof(floor);
            if (!roof) throw new Error(`selected roof is missing from floor: ${floorId}`);
            return { floor, roof };
        });
    }

    editableRoofEntries(label = "selected roof") {
        if (this.selection && this.selection.kind === "roof") {
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
        const roof = getFloorRoof(floor);
        if (!roof) throw new Error(`selected roof vertex is missing its roof: ${selection.floorId}`);
        const ring = getRoofContactPolygon(roof);
        const vertexIndex = Math.floor(Number(selection.vertexIndex));
        if (!Number.isInteger(vertexIndex) || vertexIndex < 0 || vertexIndex >= ring.length) {
            throw new Error(`selected roof vertex index is invalid: ${selection.vertexIndex}`);
        }
        return { floor, roof, ring, vertexIndex, point: ring[vertexIndex] };
    }

    isRoofSelected(floorId) {
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
        if (!options.preserveView) {
            this.selectedFloorIds = new Set(resolved.floorIds);
            this.layerSelectionMode = "floor";
        }
        this.selection = createSelection("roof", { floorId: resolved.floorIds[0], roofFloorIds: resolved.floorIds });
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
        const roof = getFloorRoof(floor);
        if (!roof) throw new Error(`cannot select roof peak without a roof: ${floorId}`);
        getRoofPeakPoint(floor);
        const selectedFloorId = getFloorId(floor);
        if (!options.preserveView) {
            this.selectedFloorIds = new Set([selectedFloorId]);
            this.layerSelectionMode = "floor";
        }
        this.selection = createSelection("roofPeak", { floorId: selectedFloorId });
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
        const overhang = Number(roof.overhang);
        if (!Number.isFinite(overhang)) throw new Error("shed roof overhang must be finite");
        if (Math.abs(overhang) <= 0.000001) {
            return ring.map((point) => ({ x: Number(point.x), y: Number(point.y) }));
        }
        const expanded = offsetRing(ring, overhang);
        if (!Array.isArray(expanded) || expanded.length !== ring.length) {
            throw new Error(`shed roof ${getFloorId(floor)} overhang requires a valid base polygon`);
        }
        return expanded.map((point) => ({ x: Number(point.x), y: Number(point.y) }));
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
        if (!roof) throw new Error("shed roof wall clipping requires a roof");
        const resolvedRange = range || this.roofShedProjectionRange(floor);
        return {
            kind: "shedPlane",
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
        const t = Math.max(0, Math.min(1, (projection - plane.minProjection) / (plane.maxProjection - plane.minProjection)));
        return plane.baseZ + Number(plane.peakHeight) * t;
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
        return {
            kind: "stations",
            generatedBy: {
                type: "roof",
                mode: "shed",
                roofId: String(getFloorRoof(floor).id || ""),
                floorId: getFloorId(floor),
                plane,
                originalHeight: Number.isFinite(priorGeneratedHeight)
                    ? priorGeneratedHeight
                    : Number(wall.height)
            },
            stations: [
                {
                    t: 0,
                    leftHeight: zAt(profile[0]),
                    rightHeight: zAt(profile[3])
                },
                {
                    t: 1,
                    leftHeight: zAt(profile[1]),
                    rightHeight: zAt(profile[2])
                }
            ]
        };
    }

    syncGeneratedWallTopProfiles() {
        getBuildingFloors(this.building).forEach((floor) => {
            const roof = getFloorRoof(floor);
            const isShed = !!roof && String(roof.mode || "peak").trim().toLowerCase() === "shed";
            const floorId = getFloorId(floor);
            const range = isShed ? this.roofShedProjectionRange(floor) : null;
            getBuildingWalls(this.building).forEach((wall) => {
                if (String(wall.fragmentId || wall.floorId) !== floorId) return;
                if (isShed) {
                    wall.topProfile = this.shedWallTopProfileForWall(floor, wall, range);
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
        const roof = getFloorRoof(floor);
        if (!roof) throw new Error(`cannot select shed roof direction without a roof: ${floorId}`);
        if (String(roof.mode || "peak") !== "shed") throw new Error("cannot select shed direction on a non-shed roof");
        getRoofShedDirection(roof);
        const selectedFloorId = getFloorId(floor);
        if (!options.preserveView) {
            this.selectedFloorIds = new Set([selectedFloorId]);
            this.layerSelectionMode = "floor";
        }
        this.selection = createSelection("roofShedDirection", { floorId: selectedFloorId });
        this.syncInputsFromFloor(floor);
        this.emitChange();
    }

    selectRoofVertex(floorId, vertexIndex, options = {}) {
        const floor = findFloor(this.building, floorId);
        if (!floor) throw new Error(`cannot select roof vertex for missing level: ${floorId}`);
        const roof = getFloorRoof(floor);
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
        this.selection = createSelection("roofVertex", { floorId: selectedFloorId, vertexIndex: index });
        this.syncInputsFromFloor(floor);
        this.emitChange();
    }

    selectedRoofPeak() {
        const selection = this.selection || {};
        if (selection.kind !== "roofPeak") return null;
        const floor = findFloor(this.building, selection.floorId);
        if (!floor) throw new Error(`selected roof peak is missing its floor: ${selection.floorId}`);
        const roof = getFloorRoof(floor);
        if (!roof) throw new Error(`selected roof peak is missing its roof: ${selection.floorId}`);
        return { floor, roof, point: getRoofPeakPoint(floor) };
    }

    selectedRoofShedDirection() {
        const selection = this.selection || {};
        if (selection.kind !== "roofShedDirection") return null;
        const floor = findFloor(this.building, selection.floorId);
        if (!floor) throw new Error(`selected shed roof direction is missing its floor: ${selection.floorId}`);
        const roof = getFloorRoof(floor);
        if (!roof) throw new Error(`selected shed roof direction is missing its roof: ${selection.floorId}`);
        if (String(roof.mode || "peak") !== "shed") throw new Error("selected shed roof direction requires a shed roof");
        return { floor, roof, direction: getRoofShedDirection(roof) };
    }

    findGable(floorOrId, gableId) {
        const floor = typeof floorOrId === "string" ? findFloor(this.building, floorOrId) : floorOrId;
        if (!floor) return null;
        const id = Number(gableId);
        return getRoofGables(floor).find((gable) => Number(gable.id) === id) || null;
    }

    selectedGable() {
        const selection = this.selection || {};
        if (selection.kind !== "gable" && selection.kind !== "gableHandle") return null;
        return this.findGable(selection.floorId, selection.gableId);
    }

    selectGable(floorId, gableId, options = {}) {
        const floor = findFloor(this.building, floorId);
        if (!floor) throw new Error(`cannot select gable for missing level: ${floorId}`);
        const gable = this.findGable(floor, gableId);
        if (!gable) throw new Error(`cannot select missing roof gable: ${gableId}`);
        const selectedFloorId = getFloorId(floor);
        if (!options.preserveView) {
            this.selectedFloorIds = new Set([selectedFloorId]);
            this.layerSelectionMode = "floor";
        }
        this.selection = createSelection("gable", { floorId: selectedFloorId, gableId: gable.id });
        this.syncInputsFromFloor(floor);
        this.emitChange();
    }

    selectGableHandle(floorId, gableId, handle, options = {}) {
        if (handle !== "start" && handle !== "end" && handle !== "height") {
            throw new Error(`unknown gable handle: ${handle}`);
        }
        const floor = findFloor(this.building, floorId);
        if (!floor) throw new Error(`cannot select gable handle for missing level: ${floorId}`);
        const gable = this.findGable(floor, gableId);
        if (!gable) throw new Error(`cannot select handle for missing roof gable: ${gableId}`);
        const selectedFloorId = getFloorId(floor);
        if (!options.preserveView) {
            this.selectedFloorIds = new Set([selectedFloorId]);
            this.layerSelectionMode = "floor";
        }
        this.selection = createSelection("gableHandle", { floorId: selectedFloorId, gableId: gable.id, gableHandle: handle });
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
        const roof = getFloorRoof(floor);
        if (!roof) throw new Error(`cannot add gable to missing roof on level: ${floorId}`);
        if (String(roof.mode || "peak") !== "peak") throw new Error("gables can only be added to peak roofs");
        if (Number(roof.overhang) < 0) {
            throw new Error("cannot add gable to a roof with negative overhang yet");
        }
        const resolvedFaceIndex = Math.floor(Number(faceIndex));
        const faceCount = getRoofContactPolygon(roof).length;
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
        this.assertGableDoesNotOverlap(floor, gable);
        roof.gables.push(gable);
        this.selectGable(getFloorId(floor), gable.id, options);
        return gable;
    }

    moveSelectedGableHandle(value, options = {}) {
        const selection = this.selection || {};
        if (selection.kind !== "gableHandle") return false;
        const floor = findFloor(this.building, selection.floorId);
        if (!floor) throw new Error(`cannot move gable handle for missing level: ${selection.floorId}`);
        const roof = getFloorRoof(floor);
        if (!roof) throw new Error(`cannot move gable handle without a roof on level: ${selection.floorId}`);
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
            this.assertGableDoesNotOverlap(floor, gable, gable.id);
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
        const roof = getFloorRoof(floor);
        if (!roof) throw new Error(`cannot delete gable without a roof on level: ${selection.floorId}`);
        const before = roof.gables.length;
        roof.gables = roof.gables.filter((gable) => String(gable.id) !== String(selection.gableId));
        if (roof.gables.length === before) throw new Error(`cannot delete missing roof gable: ${selection.gableId}`);
        this.building.mountedWallObjects = getBuildingMountedObjects(this.building)
            .filter((object) => object.mountKind !== "gable" || String(object.floorId) !== String(selection.floorId) || String(object.gableId) !== String(selection.gableId));
        this.selectRoof(getFloorId(floor), { preserveView: true });
        return true;
    }

    deleteSelectedRoof() {
        const selection = this.selection || {};
        if (selection.kind !== "roof") return false;
        const entries = this.selectedRoofEntries();
        if (!entries.length) return false;
        const floorIds = new Set(entries.map((entry) => getFloorId(entry.floor)));
        entries.forEach((entry) => {
            entry.floor.roof = null;
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

    createRoofForSelectedFloor(options = {}) {
        const floor = this.selectedFloor();
        if (!floor) throw new Error("cannot create roof without a selected floor");
        const floorId = getFloorId(floor);
        const existingRoof = getFloorRoof(floor);
        if (existingRoof) {
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
        floor.roof = createRoof({
            floorId,
            mode: options.mode || DEFAULTS.roofMode,
            texture,
            overhang,
            peakHeight,
            domeLevels: options.domeLevels ?? this.inputs.roofDomeLevels,
            peakPoint: options.peakPoint || this.defaultRoofPeakPoint(floor),
            elevationOffset,
            contactPolygon: Array.isArray(options.contactPolygon) ? options.contactPolygon : this.defaultRoofContactPolygon(floor)
        });
        this.inputs.roofTexture = texture;
        this.inputs.roofOverhang = overhang;
        this.inputs.roofPeakHeight = peakHeight;
        this.inputs.roofDomeLevels = getRoofDomeLevels(floor.roof);
        this.paintTextures.roofs = texture;
        this.selectRoof(floorId, { preserveView: options.preserveView === true });
        return floor.roof;
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
        const roof = getFloorRoof(floor);
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

    paintGable(floorOrId, gableId, texture) {
        const floor = typeof floorOrId === "string" ? findFloor(this.building, floorOrId) : floorOrId;
        if (!floor) throw new Error("cannot paint gable on a missing roof");
        if (!getFloorRoof(floor)) throw new Error("cannot paint gable on a missing roof");
        const gable = this.findGable(floor, gableId);
        if (!gable) throw new Error(`cannot paint missing roof gable: ${gableId}`);
        gable.wallTexturePath = texture;
        this.inputs.wallTexture = texture;
        this.paintTextures.walls = texture;
        this.selectGable(getFloorId(floor), gable.id);
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
                this.selectRoof(selection.floorId, { preserveView });
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
                this.selectGable(selection.floorId, selection.gableId, { preserveView });
                return true;
            case "gable":
                this.selectRoof(selection.floorId, { preserveView });
                return true;
            case "wall":
            case "floor":
            case "roof":
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
                if (matchesIgnoredVertex(entry.endpoint)) return;
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
            for (let index = 0; index < ring.points.length; index++) {
                const a = ring.points[index];
                const b = ring.points[(index + 1) % ring.points.length];
                const candidatePoint = closestPointOnSegment(point, a, b);
                if (pointIsNearSegmentEndpoint(candidatePoint, a, b, threshold)) continue;
                consider({
                    importance: WALL_SNAP_IMPORTANCE.floorEdge,
                    distance: distanceToSegment(point, a, b),
                    point: candidatePoint,
                    endpoint: {
                        kind: "edge",
                        fragmentId: floorId,
                        ring: ring.ringKind,
                        holeIndex: ring.holeIndex,
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
        const nextEndpoint = this.snapWallEndpoint(point, threshold, {
            ignoreWallId: wall.id,
            ignoreVertexEndpoint: detachVertexEndpoint ? previousEndpoint : null,
            directionOrigin,
            wallThickness: wall.thickness
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
                    delete endpoint.inset;
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

    updateSelectedRoofMode(value) {
        const entries = this.editableRoofEntries("cannot update roof mode");
        const mode = String(value || "").trim().toLowerCase();
        if (mode !== "peak" && mode !== "shed" && mode !== "dome") {
            throw new Error(`unknown roof mode: ${value}`);
        }
        const changedFloorIds = new Set();
        entries.forEach(({ floor, roof }) => {
            roof.mode = mode;
            if (mode !== "peak") {
                roof.gables = [];
                changedFloorIds.add(getFloorId(floor));
            }
            if (mode === "shed") {
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
        const originalsByFloorId = new Map((Array.isArray(originalOffsets) ? originalOffsets : [])
            .map((entry) => [String(entry.floorId), normalizeRoofElevationOffset(entry.elevationOffset, "roof drag starting elevation offset")]));
        if (!originalsByFloorId.size) throw new Error("roof drag requires starting offsets");
        const snapDistance = Number.isFinite(Number(options.snapDistance)) ? Math.max(0, Number(options.snapDistance)) : 0;
        this.selectedRoofEntries().forEach(({ floor, roof }) => {
            const floorId = getFloorId(floor);
            if (!originalsByFloorId.has(floorId)) throw new Error(`roof drag is missing starting offset for ${floorId}`);
            let nextOffset = originalsByFloorId.get(floorId) + Number(deltaZ);
            if (!Number.isFinite(nextOffset)) throw new Error("roof drag produced a non-finite elevation offset");
            if (snapDistance > 0 && Math.abs(nextOffset) <= snapDistance) nextOffset = 0;
            roof.elevationOffset = nextOffset;
        });
        this.emitChange();
    }

    paintRoof(floorOrId, texture) {
        const floor = typeof floorOrId === "string" ? findFloor(this.building, floorOrId) : floorOrId;
        if (!floor) throw new Error("cannot paint missing roof");
        const roof = getFloorRoof(floor);
        if (!roof) throw new Error("cannot paint missing roof");
        roof.texturePath = texture;
        this.inputs.roofTexture = texture;
        this.paintTextures.roofs = texture;
        this.selection = createSelection("roof", { floorId: getFloorId(floor) });
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

    roofVertexSnapCandidates(floor) {
        if (!floor) throw new Error("roof vertex snapping requires a floor");
        const floorId = getFloorId(floor);
        const floorCenter = polygonCentroid(floor.outerPolygon || []);
        const candidates = [];
        const addCandidate = (point, kind, importance) => {
            if (!Number.isFinite(Number(point && point.x)) || !Number.isFinite(Number(point && point.y))) return;
            candidates.push({
                point: { x: Number(point.x), y: Number(point.y) },
                kind,
                importance
            });
        };
        getBuildingWalls(this.building).forEach((wall) => {
            const wallFloorId = wall.fragmentId || wall.floorId;
            if (wallFloorId !== floorId) return;
            const points = wallPoints(this.building, wall);
            if (points.length !== 2) return;
            const corners = wallFootprintCornersFromCenterline(points, wall.thickness, `wall ${wall.id} roof snap corners`);
            if (wall.role === "perimeter") {
                const firstSide = [corners[0], corners[1]];
                const secondSide = [corners[2], corners[3]];
                const sideDistance = (side) => {
                    const midpoint = {
                        x: (Number(side[0].x) + Number(side[1].x)) * 0.5,
                        y: (Number(side[0].y) + Number(side[1].y)) * 0.5
                    };
                    return Math.hypot(midpoint.x - Number(floorCenter.x), midpoint.y - Number(floorCenter.y));
                };
                const outerSide = sideDistance(firstSide) >= sideDistance(secondSide) ? firstSide : secondSide;
                outerSide.forEach((corner) => addCandidate(corner, "perimeterWallOuterCorner", ROOF_SNAP_IMPORTANCE.perimeterWallOuterCorner));
                return;
            }
            corners.forEach((corner) => addCandidate(corner, "interiorWallCorner", ROOF_SNAP_IMPORTANCE.interiorWallCorner));
        });
        (Array.isArray(floor.outerPolygon) ? floor.outerPolygon : []).forEach((point) => {
            addCandidate(point, "lowerFloorVertex", ROOF_SNAP_IMPORTANCE.lowerFloorVertex);
        });
        return candidates;
    }

    roofVertexSnapPoint(floor, point, threshold = ROOF_SNAP_DISTANCE) {
        let best = null;
        this.roofVertexSnapCandidates(floor).forEach((candidate) => {
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
        return best ? best.point : null;
    }

    prepareRoofVertexPoint(floor, point) {
        const snapped = this.roofVertexSnapPoint(floor, point);
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

    moveSelectedRoofVertex(point) {
        const selected = this.selectedRoofVertex();
        const nextPoint = this.prepareRoofVertexPoint(selected.floor, point);
        const nextRing = selected.ring.map((vertex, index) => (
            index === selected.vertexIndex ? { ...vertex, x: Number(nextPoint.x), y: Number(nextPoint.y) } : { ...vertex }
        ));
        const error = simplePolygonRingError(nextRing, `roof ${getFloorId(selected.floor)} contact polygon`);
        if (error) throw new Error(`cannot move roof vertex: ${error}`);
        selected.roof.contactPolygon = nextRing;
        this.emitChange();
        return true;
    }

    moveSelectedRoofPeak(point) {
        const selected = this.selectedRoofPeak();
        if (!selected) return false;
        const nextPoint = this.prepareRoofPeakPoint(selected.floor, point);
        selected.roof.peakPoint = { x: Number(nextPoint.x), y: Number(nextPoint.y) };
        this.emitChange();
        return true;
    }

    moveSelectedRoofShedDirection(point) {
        const selected = this.selectedRoofShedDirection();
        if (!selected) return false;
        const center = this.roofShedBaseCenter(selected.floor);
        const dx = Number(point.x) - Number(center.x);
        const dy = Number(point.y) - Number(center.y);
        const length = Math.hypot(dx, dy);
        if (!Number.isFinite(length) || length <= 0.000001) return false;
        const rawDirection = { x: dx / length, y: dy / length };
        const rawHandlePoint = {
            x: Number(center.x) + rawDirection.x * ROOF_SHED_DIRECTION_HANDLE_LENGTH,
            y: Number(center.y) + rawDirection.y * ROOF_SHED_DIRECTION_HANDLE_LENGTH
        };
        const snap = this.roofShedDirectionSnapCandidates(selected.floor)
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

    insertRoofVertexOnKnownEdge(floorId, insertAfterIndex, point, edgeT = null) {
        const floor = findFloor(this.building, floorId);
        if (!floor) throw new Error(`cannot insert roof vertex on missing floor: ${floorId}`);
        const roof = getFloorRoof(floor);
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
            vertexIndex: result.vertexIndex
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
        this.selection = createSelection("roofVertex", { floorId, vertexIndex: nextIndex });
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
        return !!(draft && draft.completed === true && Array.isArray(draft.points) && draft.points.length >= 3);
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
}
