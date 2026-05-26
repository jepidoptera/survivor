import { flattenPolygon, polygonCentroid } from "./BuildingGeometry.js";
import { validateBuilding } from "./BuildingValidation.js";
import { ADJACENT_DIRECTIONS, hexCorners, immediateNeighborOffset, offsetToWorld, visibleHexRange } from "./BuildingHexGrid.js";
import { ringsForFloor } from "./BuildingPolygonEditing.js";
import { findFloor, getBuildingFloors, getBuildingWalls, getFloorElevation, getFloorId, wallCenterlinePoints, wallPoints } from "./BuildingModel.js";

const GAME_XY_RATIO = 0.66;
const FLOOR_TEXTURE_REPEAT = 0.1;
const ROOF_TEXTURE_REPEAT = 0.5;
const ROOF_RENDER_Z_LIFT = 0.03;
const FLOOR_DEPTH_NEAR_METRIC = -128;
const FLOOR_DEPTH_FAR_METRIC = 256;
const FLOOR_DEPTH_BIAS = 0.015;
const GEOMETRY_EPSILON = 0.000001;
const COLLAPSED_WALL_INTERSECTION_AREA_EPSILON = 0.25;
const COLLAPSED_WALL_FOOTPRINT_SUBTRACTION_SCALE = 1.01;
const DEFAULT_WALL_TEXTURE_REPEAT = 0.1;

const FLOOR_DEPTH_VS = `
precision highp float;
attribute vec3 aWorldPosition;
attribute vec2 aUvs;
uniform vec2 uScreenSize;
uniform vec2 uCameraWorld;
uniform float uCameraZ;
uniform float uViewScale;
uniform float uXyRatio;
uniform vec2 uDepthRange;
uniform float uDepthBias;
uniform float uCameraRotation;
uniform vec2 uCameraRotationCenter;
varying vec2 vUvs;
void main(void) {
    float cosR = cos(uCameraRotation);
    float sinR = sin(uCameraRotation);
    vec2 rel = aWorldPosition.xy - uCameraRotationCenter;
    vec2 rotatedWorld = vec2(
        rel.x * cosR - rel.y * sinR,
        rel.x * sinR + rel.y * cosR
    ) + uCameraRotationCenter;
    float camDx = rotatedWorld.x - uCameraWorld.x;
    float camDy = rotatedWorld.y - uCameraWorld.y;
    float camDz = aWorldPosition.z - uCameraZ;
    float sx = max(1.0, uScreenSize.x);
    float sy = max(1.0, uScreenSize.y);
    float screenX = camDx * uViewScale;
    float screenY = (camDy - camDz) * uViewScale * uXyRatio;
    float depthMetric = camDy + camDz + uDepthBias;
    float farMetric = uDepthRange.x;
    float invSpan = max(1e-6, uDepthRange.y);
    float nd = clamp((farMetric - depthMetric) * invSpan, 0.0, 1.0);
    vec2 clip = vec2(
        (screenX / sx) * 2.0 - 1.0,
        1.0 - (screenY / sy) * 2.0
    );
    gl_Position = vec4(clip, nd * 2.0 - 1.0, 1.0);
    vUvs = aUvs;
}
`;

const FLOOR_DEPTH_FS = `
precision highp float;
varying vec2 vUvs;
uniform sampler2D uSampler;
uniform vec4 uTint;
uniform float uAlphaCutoff;
void main(void) {
    vec4 outColor = texture2D(uSampler, fract(vUvs)) * uTint;
    if (outColor.a < uAlphaCutoff) discard;
    gl_FragColor = outColor;
}
`;

function normalizeTexturePath(path, fallback) {
    return (typeof path === "string" && path.length > 0) ? path : fallback;
}

function ringPointsForTriangulation(ring) {
    return (Array.isArray(ring) ? ring : [])
        .filter((point) => Number.isFinite(Number(point && point.x)) && Number.isFinite(Number(point && point.y)))
        .map((point) => ({ x: Number(point.x), y: Number(point.y) }));
}

function triangulateSurface(outerRing, holeRings = []) {
    const outer = ringPointsForTriangulation(outerRing);
    if (outer.length < 3) return null;
    const holes = (Array.isArray(holeRings) ? holeRings : [])
        .map((ring) => ringPointsForTriangulation(ring))
        .filter((ring) => ring.length >= 3);
    const points = [];
    const flat = [];
    const holeIndices = [];
    const pushRing = (ring) => {
        ring.forEach((point) => {
            points.push(point);
            flat.push(point.x, point.y);
        });
    };
    pushRing(outer);
    holes.forEach((ring) => {
        holeIndices.push(points.length);
        pushRing(ring);
    });
    const earcutFn = (PIXI.utils && typeof PIXI.utils.earcut === "function")
        ? PIXI.utils.earcut
        : (typeof globalThis.earcut === "function" ? globalThis.earcut : null);
    if (!earcutFn) throw new Error("textured floor rendering requires earcut");
    const indices = earcutFn(flat, holeIndices, 2);
    if (!indices || indices.length < 3) return null;
    return { points, indices: new Uint16Array(indices) };
}

function triangulateFloor(floor) {
    return triangulateSurface(floor && floor.outerPolygon, floor && floor.holes);
}

function floorMeshSignature(floor) {
    return surfaceMeshSignature(floor, floor.floorTexturePath, getFloorElevation(floor));
}

function floorTopElevation(floor) {
    const baseZ = getFloorElevation(floor);
    const height = Number(floor && floor.floorHeight);
    if (!Number.isFinite(height) || height <= 0) {
        throw new Error(`cannot render roof for ${getFloorId(floor)} without a positive floor height`);
    }
    return baseZ + height;
}

function roofRenderElevation(floor) {
    return floorTopElevation(floor) + ROOF_RENDER_Z_LIFT;
}

function roofMeshSignature(floor) {
    return surfaceMeshSignature(floor, floor.roofTexturePath, roofRenderElevation(floor));
}

function surfaceMeshSignature(floor, texturePath, z) {
    return surfaceMeshSignatureFromRings(getFloorId(floor), floor.outerPolygon || [], Array.isArray(floor.holes) ? floor.holes : [], texturePath, z);
}

function surfaceMeshSignatureFromRings(surfaceId, outerRing, holeRings, texturePath, z) {
    const rings = [outerRing || [], ...(Array.isArray(holeRings) ? holeRings : [])];
    return [
        surfaceId,
        Number(z).toFixed(4),
        normalizeTexturePath(texturePath, ""),
        ...rings.map((ring) => ring.map((point) => `${Number(point.x).toFixed(4)},${Number(point.y).toFixed(4)}`).join("|"))
    ].join(";");
}

function wallRenderSignature(building, wall, floor) {
    const renderPoints = wallCenterlinePoints(building, wall, floor);
    return [
        wall.id,
        getFloorId(floor),
        getFloorElevation(floor),
        Number(wall.height).toFixed(4),
        Number(wall.thickness).toFixed(4),
        normalizeTexturePath(wall.wallTexturePath, ""),
        renderPoints.map((point) => `${Number(point.x).toFixed(4)},${Number(point.y).toFixed(4)}`).join("|")
    ].join(";");
}

function wallTextureRepeatConfig(texturePath) {
    const WallSectionUnit = globalThis.WallSectionUnit;
    if (!WallSectionUnit || typeof WallSectionUnit._getWallTextureRepeatConfig !== "function") {
        throw new Error("continuous exterior wall texture tiling requires WallSectionUnit texture repeat config");
    }
    return WallSectionUnit._getWallTextureRepeatConfig(texturePath);
}

function wallTextureRepeatX(texturePath) {
    const config = wallTextureRepeatConfig(texturePath);
    const repeatX = Number(config && config.repeatsPerMapUnitX);
    return Number.isFinite(repeatX) && repeatX > 0 ? repeatX : DEFAULT_WALL_TEXTURE_REPEAT;
}

function wallTextureRepeatY(texturePath) {
    const config = wallTextureRepeatConfig(texturePath);
    const repeatY = Number(config && config.repeatsPerMapUnitY);
    return Number.isFinite(repeatY) && repeatY > 0 ? repeatY : DEFAULT_WALL_TEXTURE_REPEAT;
}

function polygonClipper() {
    const clipper = globalThis.polygonClipping;
    if (!clipper || typeof clipper.difference !== "function" || typeof clipper.intersection !== "function") {
        throw new Error("collapsed wall rendering requires polygon-clipping");
    }
    return clipper;
}

function finite2dPoint(point) {
    return Number.isFinite(Number(point && point.x)) && Number.isFinite(Number(point && point.y));
}

function closedClipRing(points, label) {
    if (!Array.isArray(points)) {
        throw new Error(`${label} requires a point array`);
    }
    const ring = points.map((point, index) => {
        if (!finite2dPoint(point)) {
            throw new Error(`${label} contains a non-finite point at index ${index}`);
        }
        return [Number(point.x), Number(point.y)];
    });
    if (ring.length < 3) {
        throw new Error(`${label} requires at least three finite points`);
    }
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (Math.hypot(first[0] - last[0], first[1] - last[1]) > GEOMETRY_EPSILON) {
        ring.push([first[0], first[1]]);
    }
    return ring;
}

function floorClipPolygon(floor) {
    return [
        closedClipRing(floor && floor.outerPolygon, `floor ${getFloorId(floor)} outer polygon`),
        ...(Array.isArray(floor && floor.holes) ? floor.holes : [])
            .map((ring, index) => closedClipRing(ring, `floor ${getFloorId(floor)} hole ${index}`))
    ];
}

function wallProfilePoints(building, wall, floor, options = {}) {
    if (options.profile) {
        const points = wallProfilePolygonFromProfile(options.profile, `wall ${wall && wall.id} mitered footprint`);
        const scale = Number.isFinite(Number(options.footprintScale)) ? Number(options.footprintScale) : 1;
        return scale === 1 ? points : scalePolygonAboutCentroid(points, scale, `wall ${wall && wall.id} mitered footprint`);
    }
    const points = wallCenterlinePoints(building, wall, floor);
    if (points.length !== 2) {
        throw new Error(`wall ${wall && wall.id} footprint requires exactly two centerline points`);
    }
    const [a, b] = points;
    const thickness = Number(wall && wall.thickness);
    if (!Number.isFinite(thickness) || thickness <= 0) {
        throw new Error(`wall ${wall && wall.id} footprint requires a positive thickness`);
    }
    const dx = Number(b.x) - Number(a.x);
    const dy = Number(b.y) - Number(a.y);
    const length = Math.hypot(dx, dy);
    if (length <= GEOMETRY_EPSILON) {
        throw new Error(`wall ${wall && wall.id} footprint endpoints must not be coincident`);
    }
    const nx = -dy / length;
    const ny = dx / length;
    const scale = Number.isFinite(Number(options.thicknessScale)) ? Number(options.thicknessScale) : 1;
    if (scale <= 0) {
        throw new Error(`wall ${wall && wall.id} footprint requires a positive thickness scale`);
    }
    const halfThickness = thickness * scale * 0.5;
    return [
        { x: Number(a.x) + nx * halfThickness, y: Number(a.y) + ny * halfThickness },
        { x: Number(b.x) + nx * halfThickness, y: Number(b.y) + ny * halfThickness },
        { x: Number(b.x) - nx * halfThickness, y: Number(b.y) - ny * halfThickness },
        { x: Number(a.x) - nx * halfThickness, y: Number(a.y) - ny * halfThickness }
    ];
}

function wallFootprintPolygon(building, wall, floor, options = {}) {
    return [closedClipRing(wallProfilePoints(building, wall, floor, options), `wall ${wall && wall.id} footprint`)];
}

function wallProfilePolygonFromProfile(profile, label) {
    const keys = ["aLeft", "bLeft", "bRight", "aRight"];
    return keys.map((key) => {
        const point = profile && profile[key];
        if (!finite2dPoint(point)) {
            throw new Error(`${label} missing finite ${key}`);
        }
        return { x: Number(point.x), y: Number(point.y) };
    });
}

function scalePolygonAboutCentroid(points, scale, label) {
    const amount = Number(scale);
    if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error(`${label} requires a positive scale`);
    }
    const center = points.reduce((acc, point) => ({
        x: acc.x + Number(point.x),
        y: acc.y + Number(point.y)
    }), { x: 0, y: 0 });
    center.x /= points.length;
    center.y /= points.length;
    return points.map((point) => ({
        x: center.x + (Number(point.x) - center.x) * amount,
        y: center.y + (Number(point.y) - center.y) * amount
    }));
}

function polygonSignedArea(points) {
    let area = 0;
    for (let index = 0; index < points.length; index++) {
        const current = points[index];
        const next = points[(index + 1) % points.length];
        area += current.x * next.y - next.x * current.y;
    }
    return area * 0.5;
}

function convexHull(points, label = "convex hull") {
    const unique = [];
    points.forEach((point, index) => {
        if (!finite2dPoint(point)) {
            throw new Error(`${label} contains a non-finite projected point at index ${index}`);
        }
        const normalized = { x: Number(point.x), y: Number(point.y) };
        if (!unique.some((candidate) => Math.hypot(candidate.x - normalized.x, candidate.y - normalized.y) <= GEOMETRY_EPSILON)) {
            unique.push(normalized);
        }
    });
    if (unique.length < 3) {
        throw new Error(`${label} requires at least three projected points`);
    }
    unique.sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
    const cross = (origin, a, b) => (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
    const lower = [];
    unique.forEach((point) => {
        while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], point) <= GEOMETRY_EPSILON) {
            lower.pop();
        }
        lower.push(point);
    });
    const upper = [];
    for (let index = unique.length - 1; index >= 0; index--) {
        const point = unique[index];
        while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], point) <= GEOMETRY_EPSILON) {
            upper.pop();
        }
        upper.push(point);
    }
    const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
    if (hull.length < 3 || Math.abs(polygonSignedArea(hull)) <= GEOMETRY_EPSILON) {
        throw new Error(`${label} projected to a degenerate polygon`);
    }
    return hull;
}

function clipGeometryArea(geometry) {
    return (Array.isArray(geometry) ? geometry : []).reduce((total, polygon) => {
        if (!Array.isArray(polygon) || polygon.length === 0) return total;
        const outerArea = Math.abs(clipRingSignedArea(polygon[0]));
        const holeArea = polygon.slice(1).reduce((sum, ring) => sum + Math.abs(clipRingSignedArea(ring)), 0);
        return total + Math.max(0, outerArea - holeArea);
    }, 0);
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

function lineIntersection2d(pointA, directionA, pointB, directionB) {
    const denominator = Number(directionA.x) * Number(directionB.y) - Number(directionA.y) * Number(directionB.x);
    if (Math.abs(denominator) <= GEOMETRY_EPSILON) return null;
    const dx = Number(pointB.x) - Number(pointA.x);
    const dy = Number(pointB.y) - Number(pointA.y);
    const t = (dx * Number(directionB.y) - dy * Number(directionB.x)) / denominator;
    return {
        x: Number(pointA.x) + Number(directionA.x) * t,
        y: Number(pointA.y) + Number(directionA.y) * t
    };
}

function sideLinePerpendicularCenterHit(point, direction, center) {
    const perpendicular = { x: -Number(direction.y), y: Number(direction.x) };
    return lineIntersection2d(point, direction, center, perpendicular);
}

function flattenClipRing(ring, label) {
    if (!Array.isArray(ring) || ring.length < 4) {
        throw new Error(`${label} requires a closed polygon-clipping ring`);
    }
    return ring.flatMap((point, index) => {
        if (!Array.isArray(point) || point.length < 2) {
            throw new Error(`${label} contains a malformed point at index ${index}`);
        }
        const x = Number(point[0]);
        const y = Number(point[1]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            throw new Error(`${label} contains a non-finite point at index ${index}`);
        }
        return [x, y];
    });
}

export class BuildingRenderer {
    constructor(app, state) {
        if (!globalThis.PIXI) {
            throw new Error("BuildingRenderer requires PIXI to be loaded");
        }
        this.app = app;
        this.state = state;
        this.root = new PIXI.Container();
        this.gridLayer = new PIXI.Graphics();
        this.gridAnchorLayer = new PIXI.Graphics();
        this.buildingUnit = new PIXI.Container();
        this.buildingUnit.name = "buildingEditorGameStyleBuildingUnit";
        this.floorLayer = new PIXI.Graphics();
        this.wallLayer = new PIXI.Graphics();
        this.handleLayer = new PIXI.Graphics();
        this.draftLayer = new PIXI.Graphics();
        this.floorMeshById = new Map();
        this.roofMeshById = new Map();
        this.wallUnitById = new Map();
        this.floorTextureByPath = new Map();
        this.floorDepthState = null;
        this.collapsedWallGeometryByFloorId = new Map();
        this.root.addChild(
            this.gridLayer,
            this.gridAnchorLayer,
            this.buildingUnit,
            this.floorLayer,
            this.wallLayer,
            this.handleLayer,
            this.draftLayer
        );
        this.app.stage.addChild(this.root);
    }

    render() {
        const errors = validateBuilding(this.state.building);
        if (errors.length) {
            this.state.setRenderError(errors[0]);
        } else {
            this.state.setRenderError("");
        }
        this.drawGrid();
        this.drawGameStyleBuilding();
        this.drawHandles();
        this.drawDraft();
        if (typeof this.app.render === "function") {
            this.app.render();
        }
    }

    activePlaneZ() {
        const floor = this.state.selectedFloor();
        return floor ? getFloorElevation(floor) : 0;
    }

    rotatePointForCamera(point) {
        const angle = Number(this.state.camera.rotation) || 0;
        if (Math.abs(angle) < 0.000001) return { x: Number(point.x), y: Number(point.y) };
        const center = this.state.camera.rotationCenter || this.state.buildingCenter();
        const dx = Number(point.x) - center.x;
        const dy = Number(point.y) - center.y;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        return {
            x: center.x + dx * cos - dy * sin,
            y: center.y + dx * sin + dy * cos
        };
    }

    unrotatePointForCamera(point) {
        const angle = -(Number(this.state.camera.rotation) || 0);
        if (Math.abs(angle) < 0.000001) return { x: Number(point.x), y: Number(point.y) };
        const center = this.state.camera.rotationCenter || this.state.buildingCenter();
        const dx = Number(point.x) - center.x;
        const dy = Number(point.y) - center.y;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        return {
            x: center.x + dx * cos - dy * sin,
            y: center.y + dx * sin + dy * cos
        };
    }

    worldToScreen(point, worldZ = 0) {
        const { camera } = this.state;
        const cameraZ = Number.isFinite(Number(camera.z)) ? Number(camera.z) : 0;
        const rotated = this.rotatePointForCamera(point);
        return {
            x: (rotated.x - camera.x) * camera.zoom + this.app.screen.width / 2,
            y: (rotated.y - camera.y - (Number(worldZ) - cameraZ)) * camera.zoom * GAME_XY_RATIO + this.app.screen.height / 2
        };
    }

    screenToWorld(point, worldZ = this.activePlaneZ()) {
        const { camera } = this.state;
        const cameraZ = Number.isFinite(Number(camera.z)) ? Number(camera.z) : 0;
        return this.unrotatePointForCamera({
            x: (point.x - this.app.screen.width / 2) / camera.zoom + camera.x,
            y: (point.y - this.app.screen.height / 2) / (camera.zoom * GAME_XY_RATIO) + camera.y + (Number(worldZ) - cameraZ)
        });
    }

    screenDeltaToWorldDelta(delta) {
        const zoom = Number(this.state.camera.zoom);
        if (!Number.isFinite(zoom) || zoom <= 0) {
            throw new Error("cannot convert screen delta without a positive camera zoom");
        }
        return {
            x: Number(delta.x) / zoom,
            y: Number(delta.y) / (zoom * GAME_XY_RATIO)
        };
    }

    screenPixelsToWorldDistance(pixels) {
        const zoom = Number(this.state.camera.zoom);
        if (!Number.isFinite(zoom) || zoom <= 0) {
            throw new Error("cannot convert screen threshold without a positive camera zoom");
        }
        return Number(pixels) / (zoom * GAME_XY_RATIO);
    }

    visibleWorldBounds(worldZ = 0) {
        const width = this.app.screen.width;
        const height = this.app.screen.height;
        const corners = [
            this.screenToWorld({ x: 0, y: 0 }, worldZ),
            this.screenToWorld({ x: width, y: 0 }, worldZ),
            this.screenToWorld({ x: width, y: height }, worldZ),
            this.screenToWorld({ x: 0, y: height }, worldZ)
        ];
        return corners.reduce((acc, point) => ({
            minX: Math.min(acc.minX, point.x),
            maxX: Math.max(acc.maxX, point.x),
            minY: Math.min(acc.minY, point.y),
            maxY: Math.max(acc.maxY, point.y)
        }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
    }

    drawGrid() {
        const gfx = this.gridLayer;
        const anchors = this.gridAnchorLayer;
        gfx.clear();
        anchors.clear();
        const bounds = this.visibleWorldBounds(0);
        const topLeft = { x: bounds.minX, y: bounds.minY };
        const bottomRight = { x: bounds.maxX, y: bounds.maxY };
        const range = visibleHexRange(topLeft, bottomRight);

        gfx.lineStyle(1, 0x263640, 0.58);
        for (let x = range.minX; x <= range.maxX; x++) {
            for (let y = range.minY; y <= range.maxY; y++) {
                const center = offsetToWorld({ x, y });
                const corners = hexCorners(center).map((point) => this.worldToScreen(point, 0));
                gfx.drawPolygon(flattenPolygon(corners));
            }
        }

        if (!this.state.showSnapAnchors) {
            this.drawAxes(gfx, topLeft, bottomRight);
            return;
        }

        anchors.beginFill(0x607782, 0.5);
        for (let x = range.minX; x <= range.maxX; x++) {
            for (let y = range.minY; y <= range.maxY; y++) {
                const center = this.worldToScreen(offsetToWorld({ x, y }), 0);
                anchors.drawCircle(center.x, center.y, 1.35);
            }
        }
        anchors.endFill();

        anchors.beginFill(0x6f8992, 0.36);
        const midpointKeys = new Set();
        for (let x = range.minX; x <= range.maxX; x++) {
            for (let y = range.minY; y <= range.maxY; y++) {
                ADJACENT_DIRECTIONS.forEach((direction) => {
                    const offset = immediateNeighborOffset(x, direction);
                    const bx = x + offset.x;
                    const by = y + offset.y;
                    const aKey = `${x},${y}`;
                    const bKey = `${bx},${by}`;
                    const key = aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
                    if (midpointKeys.has(key)) return;
                    midpointKeys.add(key);
                    const a = offsetToWorld({ x, y });
                    const b = offsetToWorld({ x: bx, y: by });
                    const screen = this.worldToScreen({ x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 }, 0);
                    anchors.drawCircle(screen.x, screen.y, 0.95);
                });
            }
        }
        anchors.endFill();

        this.drawAxes(gfx, topLeft, bottomRight);
    }

    drawAxes(gfx, topLeft, bottomRight) {
        gfx.lineStyle(1, 0x52616b, 0.36);
        const xAxisA = this.worldToScreen({ x: topLeft.x, y: 0 }, 0);
        const xAxisB = this.worldToScreen({ x: bottomRight.x, y: 0 }, 0);
        const yAxisA = this.worldToScreen({ x: 0, y: topLeft.y }, 0);
        const yAxisB = this.worldToScreen({ x: 0, y: bottomRight.y }, 0);
        gfx.moveTo(xAxisA.x, xAxisA.y);
        gfx.lineTo(xAxisB.x, xAxisB.y);
        gfx.moveTo(yAxisA.x, yAxisA.y);
        gfx.lineTo(yAxisB.x, yAxisB.y);
    }

    gameCamera() {
        const camera = this.state.camera;
        const zoom = Number(camera.zoom);
        if (!Number.isFinite(zoom) || zoom <= 0) {
            throw new Error("game-style building rendering requires a positive camera zoom");
        }
        return {
            x: Number(camera.x) - this.app.screen.width / (2 * zoom),
            y: Number(camera.y) - this.app.screen.height / (2 * zoom * GAME_XY_RATIO),
            z: Number.isFinite(Number(camera.z)) ? Number(camera.z) : 0,
            viewscale: zoom,
            xyratio: GAME_XY_RATIO,
            rotation: Number(camera.rotation) || 0,
            rotationCenter: camera.rotationCenter || this.state.buildingCenter(),
            worldToScreen: (x, y, z = 0) => this.worldToScreen({ x: Number(x), y: Number(y) }, z)
        };
    }

    getFloorDepthState() {
        if (this.floorDepthState) return this.floorDepthState;
        if (!PIXI.State) return null;
        const state = new PIXI.State();
        state.depthTest = true;
        state.depthMask = true;
        state.blend = true;
        state.culling = false;
        this.floorDepthState = state;
        return state;
    }

    getFloorTexture(texturePath) {
        return this.getSurfaceTexture(texturePath, "/assets/images/flooring/woodfloor.png");
    }

    getRoofTexture(texturePath) {
        return this.getSurfaceTexture(texturePath, "/assets/images/roofs/slate.png");
    }

    getSurfaceTexture(texturePath, fallback) {
        const path = normalizeTexturePath(texturePath, fallback);
        let texture = this.floorTextureByPath.get(path);
        if (!texture) {
            texture = PIXI.Texture.from(path);
            if (texture && texture.baseTexture) {
                texture.baseTexture.wrapMode = PIXI.WRAP_MODES.REPEAT;
                texture.baseTexture.scaleMode = PIXI.SCALE_MODES.LINEAR;
            }
            this.floorTextureByPath.set(path, texture);
        }
        return texture;
    }

    createSurfaceMesh(floor, triangulation, options = {}) {
        if (!triangulation || !triangulation.points || triangulation.points.length < 3) return null;
        const z = Number(options.z);
        if (!Number.isFinite(z)) throw new Error(`cannot create surface mesh for ${getFloorId(floor)} without finite z`);
        const texturePath = normalizeTexturePath(options.texturePath, options.textureFallback);
        const textureRepeat = Number.isFinite(Number(options.textureRepeat)) ? Number(options.textureRepeat) : FLOOR_TEXTURE_REPEAT;
        const positions = new Float32Array(triangulation.points.length * 3);
        const uvs = new Float32Array(triangulation.points.length * 2);
        triangulation.points.forEach((point, index) => {
            positions[index * 3] = Number(point.x);
            positions[index * 3 + 1] = Number(point.y);
            positions[index * 3 + 2] = z;
            uvs[index * 2] = Number(point.x) * textureRepeat;
            uvs[index * 2 + 1] = Number(point.y) * textureRepeat;
        });
        const geometry = new PIXI.Geometry()
            .addAttribute("aWorldPosition", positions, 3)
            .addAttribute("aUvs", uvs, 2)
            .addIndex(triangulation.indices);
        const shader = PIXI.Shader.from(FLOOR_DEPTH_VS, FLOOR_DEPTH_FS, {
            uScreenSize: new Float32Array([1, 1]),
            uCameraWorld: new Float32Array([0, 0]),
            uCameraZ: 0,
            uViewScale: 1,
            uXyRatio: GAME_XY_RATIO,
            uDepthRange: new Float32Array([
                FLOOR_DEPTH_FAR_METRIC,
                1 / Math.max(1e-6, FLOOR_DEPTH_FAR_METRIC - FLOOR_DEPTH_NEAR_METRIC)
            ]),
            uDepthBias: FLOOR_DEPTH_BIAS,
            uCameraRotation: 0,
            uCameraRotationCenter: new Float32Array([0, 0]),
            uTint: new Float32Array([1, 1, 1, 1]),
            uAlphaCutoff: 0.001,
            uSampler: this.getSurfaceTexture(texturePath, options.textureFallback)
        });
        const mesh = new PIXI.Mesh(geometry, shader, this.getFloorDepthState() || undefined, PIXI.DRAW_MODES.TRIANGLES);
        mesh.name = `${options.namePrefix || "buildingEditorSurfaceMesh"}:${getFloorId(floor)}`;
        mesh.interactive = false;
        mesh.visible = false;
        return mesh;
    }

    createFloorMesh(floor, triangulation) {
        return this.createSurfaceMesh(floor, triangulation, {
            z: getFloorElevation(floor),
            texturePath: floor.floorTexturePath,
            textureFallback: "/assets/images/flooring/woodfloor.png",
            textureRepeat: FLOOR_TEXTURE_REPEAT,
            namePrefix: "buildingEditorFloorMesh"
        });
    }

    createRoofMesh(floor, triangulation) {
        return this.createSurfaceMesh(floor, triangulation, {
            z: roofRenderElevation(floor),
            texturePath: floor.roofTexturePath,
            textureFallback: "/assets/images/roofs/slate.png",
            textureRepeat: ROOF_TEXTURE_REPEAT,
            namePrefix: "buildingEditorRoofMesh"
        });
    }

    updateSurfaceMeshUniforms(mesh, floor, alpha, options = {}) {
        if (!mesh || !mesh.shader || !mesh.shader.uniforms) {
            throw new Error(`missing textured surface mesh uniforms for ${getFloorId(floor)}`);
        }
        const camera = this.gameCamera();
        const u = mesh.shader.uniforms;
        u.uScreenSize[0] = Math.max(1, this.app.screen.width);
        u.uScreenSize[1] = Math.max(1, this.app.screen.height);
        u.uCameraWorld[0] = Number(camera.x);
        u.uCameraWorld[1] = Number(camera.y);
        u.uCameraZ = Number(camera.z);
        u.uViewScale = Number(camera.viewscale);
        u.uXyRatio = Number(camera.xyratio);
        u.uCameraRotation = Number(this.state.camera.rotation) || 0;
        const rotationCenter = this.state.camera.rotationCenter || this.state.buildingCenter();
        u.uCameraRotationCenter[0] = Number(rotationCenter.x) || 0;
        u.uCameraRotationCenter[1] = Number(rotationCenter.y) || 0;
        u.uSampler = this.getSurfaceTexture(options.texturePath, options.textureFallback);
        u.uTint[0] = 1;
        u.uTint[1] = 1;
        u.uTint[2] = 1;
        u.uTint[3] = Math.max(0, Math.min(1, Number(alpha)));
        mesh.visible = true;
    }

    updateFloorMeshUniforms(mesh, floor, alpha) {
        this.updateSurfaceMeshUniforms(mesh, floor, alpha, {
            texturePath: floor.floorTexturePath,
            textureFallback: "/assets/images/flooring/woodfloor.png"
        });
    }

    updateRoofMeshUniforms(mesh, floor, alpha) {
        this.updateSurfaceMeshUniforms(mesh, floor, alpha, {
            texturePath: floor.roofTexturePath,
            textureFallback: "/assets/images/roofs/slate.png"
        });
    }

    syncFloorMesh(floor, alpha) {
        const floorId = getFloorId(floor);
        const signature = floorMeshSignature(floor);
        let entry = this.floorMeshById.get(floorId);
        if (!entry || entry.signature !== signature) {
            if (entry && entry.mesh) {
                if (entry.mesh.parent) entry.mesh.parent.removeChild(entry.mesh);
                entry.mesh.destroy({ children: false, texture: false, baseTexture: false });
            }
            const triangulation = triangulateFloor(floor);
            if (!triangulation) return null;
            const mesh = this.createFloorMesh(floor, triangulation);
            if (!mesh) return null;
            this.buildingUnit.addChild(mesh);
            entry = { signature, mesh };
            this.floorMeshById.set(floorId, entry);
        } else if (entry.mesh.parent !== this.buildingUnit) {
            this.buildingUnit.addChild(entry.mesh);
        }
        this.updateFloorMeshUniforms(entry.mesh, floor, alpha);
        return entry.mesh;
    }

    syncRoofMesh(floor, alpha) {
        const floorId = getFloorId(floor);
        const signature = roofMeshSignature(floor);
        let entry = this.roofMeshById.get(floorId);
        if (!entry || entry.signature !== signature) {
            if (entry && entry.mesh) {
                if (entry.mesh.parent) entry.mesh.parent.removeChild(entry.mesh);
                entry.mesh.destroy({ children: false, texture: false, baseTexture: false });
            }
            const triangulation = triangulateFloor(floor);
            if (!triangulation) return null;
            const mesh = this.createRoofMesh(floor, triangulation);
            if (!mesh) return null;
            this.buildingUnit.addChild(mesh);
            entry = { signature, mesh };
            this.roofMeshById.set(floorId, entry);
        } else if (entry.mesh.parent !== this.buildingUnit) {
            this.buildingUnit.addChild(entry.mesh);
        }
        this.updateRoofMeshUniforms(entry.mesh, floor, alpha);
        return entry.mesh;
    }

    makeWallRuntimeEndpoint(point) {
        return {
            x: Number(point.x),
            y: Number(point.y),
            _splitVertex: true
        };
    }

    projectClipGeometryToScreen(geometry, worldZ) {
        return (Array.isArray(geometry) ? geometry : []).map((polygon) => {
            if (!Array.isArray(polygon)) return [];
            return polygon.map((ring) => {
                const projected = (Array.isArray(ring) ? ring : []).map((point) => {
                    if (!Array.isArray(point) || point.length < 2) {
                        throw new Error("cannot project malformed polygon-clipping point");
                    }
                    return this.worldToScreen({ x: Number(point[0]), y: Number(point[1]) }, worldZ);
                });
                return closedClipRing(projected, "projected floor open area");
            });
        }).filter((polygon) => polygon.length > 0);
    }

    wallEntryForWall(wall, wallEntries) {
        if (!Array.isArray(wallEntries)) return null;
        return wallEntries.find((entry) => entry && entry.wall === wall) || null;
    }

    wallProfileForRender(wall, wallEntries) {
        const entry = this.wallEntryForWall(wall, wallEntries);
        const unit = entry && entry.entry && entry.entry.unit;
        if (!unit || typeof unit.getWallProfile !== "function") return null;
        return unit.getWallProfile();
    }

    wallMiterEndpointKey(wall, endpointKey, point, floor) {
        const endpoint = wall && wall[endpointKey];
        const floorId = getFloorId(floor);
        if (endpoint && endpoint.kind === "vertex") {
            if (!endpoint.vertexId || !endpoint.fragmentId || !endpoint.ring) {
                throw new Error(`wall ${wall && wall.id} ${endpointKey} vertex endpoint is missing miter metadata`);
            }
            return [
                "vertex",
                endpoint.fragmentId,
                endpoint.ring,
                Number.isFinite(Number(endpoint.holeIndex)) ? Number(endpoint.holeIndex) : -1,
                endpoint.vertexId
            ].join(":");
        }
        if (!finite2dPoint(point)) {
            throw new Error(`wall ${wall && wall.id} ${endpointKey} cannot be mitered without a finite endpoint`);
        }
        return `point:${floorId}:${Number(point.x).toFixed(6)},${Number(point.y).toFixed(6)}`;
    }

    miterWallEntriesForFloor(wallEntries) {
        if (!Array.isArray(wallEntries) || wallEntries.length === 0) return;
        const WallSectionUnit = globalThis.WallSectionUnit;
        if (!WallSectionUnit || typeof WallSectionUnit.endpointKey !== "function") {
            throw new Error("building editor mitered wall rendering requires WallSectionUnit.endpointKey");
        }
        const groups = new Map();
        wallEntries.forEach((entry) => {
            const unit = entry && entry.entry && entry.entry.unit;
            const wall = entry && entry.wall;
            const floor = entry && entry.floor;
            if (!unit || !wall || !floor) return;
            unit._joineryCorners = {};
            unit._visibleNeighborMiterProfileCache = null;
            const authoredPoints = wallPoints(this.state.building, wall);
            if (authoredPoints.length !== 2) return;
            [
                { endpointKey: "startPoint", sharedEnd: "start", point: authoredPoints[0], farPoint: authoredPoints[1], runtimePoint: unit.startPoint },
                { endpointKey: "endPoint", sharedEnd: "end", point: authoredPoints[1], farPoint: authoredPoints[0], runtimePoint: unit.endPoint }
            ].forEach((endpoint) => {
                const groupKey = this.wallMiterEndpointKey(wall, endpoint.endpointKey, endpoint.point, floor);
                const layer = Number.isFinite(Number(wall.traversalLayer))
                    ? Math.round(Number(wall.traversalLayer))
                    : Math.round(getFloorElevation(floor) / 3);
                const indexKey = `${groupKey}|layer:${layer}`;
                if (!groups.has(indexKey)) groups.set(indexKey, []);
                groups.get(indexKey).push({
                    wall,
                    unit,
                    sharedEnd: endpoint.sharedEnd,
                    sharedPoint: endpoint.point,
                    farPoint: endpoint.farPoint,
                    runtimeEndpointKey: WallSectionUnit.endpointKey(endpoint.runtimePoint)
                });
            });
        });

        for (const group of groups.values()) {
            this.applyMiterGroup(group);
        }

        wallEntries.forEach((entry) => {
            const unit = entry && entry.entry && entry.entry.unit;
            if (unit && typeof unit.rebuildMesh3d === "function") unit.rebuildMesh3d();
        });
    }

    applyMiterGroup(group) {
        if (!Array.isArray(group) || group.length < 2) return;
        const entries = group.map((item) => {
            const dx = Number(item.farPoint.x) - Number(item.sharedPoint.x);
            const dy = Number(item.farPoint.y) - Number(item.sharedPoint.y);
            const length = Math.hypot(dx, dy);
            if (length <= GEOMETRY_EPSILON) return null;
            const ux = dx / length;
            const uy = dy / length;
            const leftN = { x: -uy, y: ux };
            const halfT = Math.max(0.001, Number(item.wall.thickness) || 0.001) * 0.5;
            return {
                ...item,
                awayDir: { x: ux, y: uy },
                angle: Math.atan2(uy, ux),
                leftFace: {
                    x: Number(item.sharedPoint.x) + leftN.x * halfT,
                    y: Number(item.sharedPoint.y) + leftN.y * halfT
                },
                rightFace: {
                    x: Number(item.sharedPoint.x) - leftN.x * halfT,
                    y: Number(item.sharedPoint.y) - leftN.y * halfT
                },
                leftLabel: item.sharedEnd === "start" ? "posN" : "negN",
                rightLabel: item.sharedEnd === "start" ? "negN" : "posN"
            };
        }).filter(Boolean);
        if (entries.length < 2) return;
        const center = {
            x: Number(entries[0].sharedPoint.x),
            y: Number(entries[0].sharedPoint.y)
        };
        if (!Number.isFinite(center.x) || !Number.isFinite(center.y)) {
            throw new Error("wall miter group requires a finite center");
        }
        entries.sort((a, b) => {
            const angleDelta = b.angle - a.angle;
            if (Math.abs(angleDelta) > GEOMETRY_EPSILON) return angleDelta;
            return (Number(a.wall.id) || 0) - (Number(b.wall.id) || 0);
        });

        const ringCorners = new Array(entries.length).fill(null);
        for (let index = 0; index < entries.length; index++) {
            const current = entries[index];
            const next = entries[(index + 1) % entries.length];
            let hit = lineIntersection2d(current.rightFace, current.awayDir, next.leftFace, next.awayDir);
            if (!hit) {
                const currentHit = sideLinePerpendicularCenterHit(current.rightFace, current.awayDir, center);
                const nextHit = sideLinePerpendicularCenterHit(next.leftFace, next.awayDir, center);
                if (currentHit && nextHit) {
                    const separation = Math.hypot(currentHit.x - nextHit.x, currentHit.y - nextHit.y);
                    if (separation <= 0.0001) {
                        hit = {
                            x: (currentHit.x + nextHit.x) * 0.5,
                            y: (currentHit.y + nextHit.y) * 0.5
                        };
                    }
                }
            }
            if (hit) ringCorners[index] = hit;
        }

        entries.forEach((entry, index) => {
            if (!entry.runtimeEndpointKey) {
                throw new Error(`wall ${entry.wall && entry.wall.id} miter endpoint is missing a runtime key`);
            }
            entry.unit._joineryCorners = entry.unit._joineryCorners || {};
            const store = {
                sharedEnd: entry.sharedEnd,
                center: { x: center.x, y: center.y }
            };
            const rightCorner = ringCorners[index];
            const leftCorner = ringCorners[(index - 1 + entries.length) % entries.length];
            if (rightCorner) store[entry.rightLabel] = rightCorner;
            if (leftCorner) store[entry.leftLabel] = leftCorner;
            entry.unit._joineryCorners[entry.runtimeEndpointKey] = store;
            entry.unit._visibleNeighborMiterProfileCache = null;
        });
    }

    floorOpenAreaScreenGeometry(floor, wallEntries = null) {
        const floorId = getFloorId(floor);
        if (this.collapsedWallGeometryByFloorId.has(floorId)) {
            return this.collapsedWallGeometryByFloorId.get(floorId);
        }
        const clipper = polygonClipper();
        const floorPolygon = floorClipPolygon(floor);
        const wallsForFloor = Array.isArray(wallEntries)
            ? wallEntries.filter((entry) => entry && getFloorId(entry.floor) === floorId).map((entry) => entry.wall)
            : getBuildingWalls(this.state.building).filter((wall) => String(wall.fragmentId || wall.floorId) === floorId);
        const wallFootprints = wallsForFloor.map((wall) => {
            const profile = this.wallProfileForRender(wall, wallEntries);
            return wallFootprintPolygon(this.state.building, wall, floor, profile
                ? {
                    profile,
                    footprintScale: COLLAPSED_WALL_FOOTPRINT_SUBTRACTION_SCALE
                }
                : {
                    thicknessScale: COLLAPSED_WALL_FOOTPRINT_SUBTRACTION_SCALE
                });
        });
        const openArea = wallFootprints.length > 0
            ? clipper.difference(floorPolygon, ...wallFootprints)
            : [floorPolygon];
        const screenOpenArea = this.projectClipGeometryToScreen(openArea, getFloorElevation(floor));
        this.collapsedWallGeometryByFloorId.set(floorId, screenOpenArea);
        return screenOpenArea;
    }

    wallScreenImagePolygon(wall, floor, wallEntries = null) {
        const baseZ = getFloorElevation(floor);
        const height = Number(wall && wall.height);
        if (!Number.isFinite(height) || height <= 0) {
            throw new Error(`wall ${wall && wall.id} screen image requires a positive height`);
        }
        const renderProfile = this.wallProfileForRender(wall, wallEntries);
        const profile = renderProfile
            ? wallProfilePolygonFromProfile(renderProfile, `wall ${wall && wall.id} mitered screen image`)
            : wallProfilePoints(this.state.building, wall, floor);
        const projected = [];
        profile.forEach((point) => {
            projected.push(this.worldToScreen(point, baseZ));
            projected.push(this.worldToScreen(point, baseZ + height));
        });
        return [closedClipRing(convexHull(projected, `wall ${wall && wall.id} screen image`), `wall ${wall && wall.id} screen image`)];
    }

    shouldDrawWallCollapsed(wall, floor, wallEntries = null) {
        if (this.state.renderStyle() !== "interior") return false;
        const openArea = this.floorOpenAreaScreenGeometry(floor, wallEntries);
        if (clipGeometryArea(openArea) <= GEOMETRY_EPSILON) return false;
        const wallImage = this.wallScreenImagePolygon(wall, floor, wallEntries);
        const intersection = polygonClipper().intersection(openArea, wallImage);
        return clipGeometryArea(intersection) > COLLAPSED_WALL_INTERSECTION_AREA_EPSILON;
    }

    drawWallProjectionOutlines(floorIds, wallEntries = null) {
        if (this.state.renderStyle() !== "interior") return;
        const wallDebug = this.wallLayer;
        wallDebug.lineStyle(2, 0xffffff, 0.95);
        getBuildingWalls(this.state.building).forEach((wall) => {
            const floor = findFloor(this.state.building, wall.fragmentId || wall.floorId);
            if (!floor || !floorIds.has(getFloorId(floor))) return;
            const projection = this.wallScreenImagePolygon(wall, floor, wallEntries);
            projection.forEach((ring, index) => {
                wallDebug.drawPolygon(flattenClipRing(ring, `wall ${wall.id} projection outline ${index}`));
            });
        });
    }

    ensureWallUnit(wall, floor) {
        const WallSectionUnit = globalThis.WallSectionUnit;
        if (typeof WallSectionUnit !== "function") {
            throw new Error("building editor game-style walls require WallSectionUnit");
        }
        const renderPoints = wallCenterlinePoints(this.state.building, wall, floor);
        if (renderPoints.length !== 2) return null;
        const signature = wallRenderSignature(this.state.building, wall, floor);
        const wallId = String(wall.id);
        let entry = this.wallUnitById.get(wallId);
        if (!entry || entry.signature !== signature) {
            if (entry && entry.unit && typeof entry.unit.destroy === "function") {
                entry.unit.destroy();
            }
            const baseZ = getFloorElevation(floor);
            const unit = new WallSectionUnit(
                this.makeWallRuntimeEndpoint(renderPoints[0]),
                this.makeWallRuntimeEndpoint(renderPoints[1]),
                {
                    id: Number.isInteger(Number(wall.id)) ? Number(wall.id) : undefined,
                    height: Number(wall.height),
                    thickness: Number(wall.thickness),
                    bottomZ: baseZ,
                    traversalLayer: Number.isFinite(Number(wall.traversalLayer))
                        ? Math.round(Number(wall.traversalLayer))
                        : Math.round(baseZ / 3),
                    level: Number.isFinite(Number(wall.level)) ? Math.round(Number(wall.level)) : Math.round(baseZ / 3),
                    wallTexturePath: normalizeTexturePath(wall.wallTexturePath, "/assets/images/walls/stonewall.png"),
                    deferSetup: true,
                    suppressAutoScriptingName: true
                }
            );
            entry = { signature, unit, mesh: null };
            this.wallUnitById.set(wallId, entry);
        }
        return entry;
    }

    renderWallUnit(wall, floor, alpha, wallEntries = null) {
        const entry = this.ensureWallUnit(wall, floor);
        if (!entry) return null;
        this.updateWallTexturePhase(entry.unit, wall, floor);
        const selected = Number(this.state.selection.wallId) === Number(wall.id);
        const bottomFaceOnly = this.shouldDrawWallCollapsed(wall, floor, wallEntries);
        const localTextureU = this.shouldUseExteriorPerimeterTextureU(wall);
        const mesh = entry.unit.getDepthMeshDisplayObject({
            camera: this.gameCamera(),
            app: this.app,
            viewscale: Number(this.state.camera.zoom),
            xyratio: GAME_XY_RATIO,
            cameraRotation: Number(this.state.camera.rotation) || 0,
            cameraRotationCenter: this.state.camera.rotationCenter || this.state.buildingCenter(),
            tint: selected ? 0xffd27a : 0xffffff,
            alpha,
            brightness: selected ? 12 : 0,
            bottomFaceOnly,
            localTextureU
        });
        if (!mesh) {
            throw new Error(`WallSectionUnit failed to create depth mesh for wall ${wall.id}`);
        }
        if (mesh.parent !== this.buildingUnit) this.buildingUnit.addChild(mesh);
        mesh.visible = true;
        entry.mesh = mesh;
        return mesh;
    }

    shouldUseExteriorPerimeterTextureU(wall) {
        return this.state.renderStyle() === "exterior" &&
            wall &&
            wall.role === "perimeter" &&
            wall.attachment &&
            wall.attachment.kind === "fragmentEdge" &&
            wall.attachment.ring === "outer";
    }

    perimeterDistanceByVertexId(floor) {
        const ring = Array.isArray(floor && floor.outerPolygon) ? floor.outerPolygon : [];
        if (ring.length < 3) {
            throw new Error(`cannot compute perimeter texture coordinates for ${getFloorId(floor)} without an outer polygon`);
        }
        const distances = new Map();
        let distance = 0;
        ring.forEach((vertex, index) => {
            if (!vertex || !vertex.id) {
                throw new Error(`cannot compute perimeter texture coordinates for ${getFloorId(floor)}: vertex ${index} is missing an id`);
            }
            distances.set(vertex.id, distance);
            const next = ring[(index + 1) % ring.length];
            distance += Math.hypot(Number(next.x) - Number(vertex.x), Number(next.y) - Number(vertex.y));
        });
        return distances;
    }

    exteriorPerimeterTexturePhaseU(wall, floor, texturePath) {
        const attachment = wall && wall.attachment;
        if (!attachment || attachment.kind !== "fragmentEdge" || attachment.ring !== "outer") {
            throw new Error(`wall ${wall && wall.id} cannot use perimeter texture continuity without an outer fragmentEdge attachment`);
        }
        const startVertexId = attachment.startVertexId;
        if (!startVertexId) {
            throw new Error(`wall ${wall && wall.id} perimeter texture continuity requires a start vertex id`);
        }
        const distance = this.perimeterDistanceByVertexId(floor).get(startVertexId);
        if (!Number.isFinite(distance)) {
            throw new Error(`wall ${wall && wall.id} perimeter texture continuity references missing vertex ${startVertexId}`);
        }
        const modelPhaseA = Number(wall && wall.texturePhaseA);
        const offset = Number.isFinite(modelPhaseA) ? modelPhaseA : 0;
        return distance * wallTextureRepeatX(texturePath) + offset;
    }

    updateWallTexturePhase(unit, wall, floor) {
        if (!unit) return;
        const modelPhaseA = Number(wall && wall.texturePhaseA);
        const texturePath = normalizeTexturePath(wall && wall.wallTexturePath, "/assets/images/walls/stonewall.png");
        unit.texturePhaseA = this.shouldUseExteriorPerimeterTextureU(wall)
            ? this.exteriorPerimeterTexturePhaseU(wall, floor, texturePath)
            : (Number.isFinite(modelPhaseA) ? modelPhaseA : NaN);
        if (this.state.renderStyle() !== "exterior") {
            const modelPhaseB = Number(wall && wall.texturePhaseB);
            unit.texturePhaseB = Number.isFinite(modelPhaseB) ? modelPhaseB : NaN;
            return;
        }
        const repeatY = wallTextureRepeatY(texturePath);
        const topZ = getFloorElevation(floor) + Number(wall && wall.height);
        if (!Number.isFinite(topZ)) {
            throw new Error(`cannot compute exterior wall texture phase for wall ${wall && wall.id} without finite top z`);
        }
        unit.texturePhaseB = -topZ * repeatY;
    }

    syncWallUnit(wall, floor, alpha) {
        const entry = this.ensureWallUnit(wall, floor);
        if (!entry) return null;
        const wallEntries = [{ wall, floor, entry }];
        this.miterWallEntriesForFloor(wallEntries);
        return this.renderWallUnit(wall, floor, alpha, wallEntries);
    }

    renderedFloors() {
        if (this.state.renderStyle() === "exterior") {
            return [...getBuildingFloors(this.state.building)]
                .sort((a, b) => getFloorElevation(a) - getFloorElevation(b));
        }
        const floor = this.state.selectedFloor();
        return floor ? [floor] : [];
    }

    drawGameStyleBuilding() {
        this.floorLayer.clear();
        this.wallLayer.clear();
        this.collapsedWallGeometryByFloorId.clear();
        const floors = this.renderedFloors();
        const floorIds = new Set(floors.map((floor) => getFloorId(floor)));
        const liveFloorMeshIds = new Set();
        const liveRoofMeshIds = new Set();
        const liveWallIds = new Set();
        const wallEntries = [];
        const wallEntriesByFloorId = new Map();
        const exterior = this.state.renderStyle() === "exterior";
        this.buildingUnit.alpha = exterior ? 0.92 : 1;
        floors.forEach((floor) => {
            const floorAlpha = exterior ? 0.92 : 1;
            const mesh = this.syncFloorMesh(floor, floorAlpha);
            if (mesh) liveFloorMeshIds.add(getFloorId(floor));
            if (exterior) {
                const roofMesh = this.syncRoofMesh(floor, 1);
                if (roofMesh) liveRoofMeshIds.add(getFloorId(floor));
            }
        });
        getBuildingWalls(this.state.building).forEach((wall) => {
            const floor = findFloor(this.state.building, wall.fragmentId || wall.floorId);
            if (!floor || !floorIds.has(getFloorId(floor))) return;
            const entry = this.ensureWallUnit(wall, floor);
            if (!entry) return;
            const wallEntry = { wall, floor, entry };
            wallEntries.push(wallEntry);
            const floorId = getFloorId(floor);
            if (!wallEntriesByFloorId.has(floorId)) wallEntriesByFloorId.set(floorId, []);
            wallEntriesByFloorId.get(floorId).push(wallEntry);
            liveWallIds.add(String(wall.id));
        });
        for (const entries of wallEntriesByFloorId.values()) {
            this.miterWallEntriesForFloor(entries);
        }
        wallEntries.forEach((entry) => {
            this.renderWallUnit(entry.wall, entry.floor, 1, wallEntries);
        });
        this.drawWallProjectionOutlines(floorIds, wallEntries);
        for (const [floorId, entry] of this.floorMeshById.entries()) {
            if (!liveFloorMeshIds.has(floorId) && entry && entry.mesh) entry.mesh.visible = false;
        }
        for (const [floorId, entry] of this.roofMeshById.entries()) {
            if (!liveRoofMeshIds.has(floorId) && entry && entry.mesh) entry.mesh.visible = false;
        }
        for (const [wallId, entry] of this.wallUnitById.entries()) {
            if (!liveWallIds.has(wallId) && entry && entry.mesh) entry.mesh.visible = false;
        }
    }

    drawFloors() {
        const gfx = this.floorLayer;
        gfx.clear();
        const floors = [...getBuildingFloors(this.state.building)].sort((a, b) => getFloorElevation(a) - getFloorElevation(b));
        floors.forEach((floor) => {
            if (!this.state.isFloorSelected(getFloorId(floor))) return;
            const selected = this.state.selection.floorId === getFloorId(floor) && !this.state.selection.wallId;
            const elevation = getFloorElevation(floor);
            const points = floor.outerPolygon.map((point) => this.worldToScreen(point, elevation));
            if (points.length < 3) return;
            gfx.beginFill(selected ? 0x4d8b8f : 0x415c54, selected ? 0.52 : 0.36);
            gfx.lineStyle(selected ? 3 : 2, selected ? 0x9fe4d5 : 0x6c9280, selected ? 1 : 0.85);
            gfx.drawPolygon(flattenPolygon(points));
            const holes = Array.isArray(floor.holes) ? floor.holes : [];
            if (holes.length > 0) {
                if (typeof gfx.beginHole !== "function" || typeof gfx.endHole !== "function") {
                    throw new Error("floor hole rendering requires PIXI Graphics.beginHole/endHole");
                }
                gfx.beginHole();
                holes.forEach((ring) => {
                    const holePoints = ring.map((point) => this.worldToScreen(point, elevation));
                    if (holePoints.length >= 3) gfx.drawPolygon(flattenPolygon(holePoints));
                });
                gfx.endHole();
            }
            gfx.endFill();
        });
    }

    drawWalls() {
        const gfx = this.wallLayer;
        gfx.clear();
        getBuildingWalls(this.state.building).forEach((wall) => {
            const floor = findFloor(this.state.building, wall.fragmentId || wall.floorId);
            const points = floor ? wallCenterlinePoints(this.state.building, wall, floor) : [];
            if (!floor || points.length < 2) return;
            if (!this.state.isFloorSelected(getFloorId(floor))) return;
            const baseZ = getFloorElevation(floor);
            const selected = this.state.selection.wallId === wall.id;
            const color = selected ? 0xffd27a : (wall.role === "perimeter" ? 0xe8e0cd : 0x78b7ff);
            const wallTopZ = baseZ + Math.max(0, Number(wall.height) || 0);
            for (let index = 1; index < points.length; index++) {
                const a = points[index - 1];
                const b = points[index];
                const baseA = this.worldToScreen(a, baseZ);
                const baseB = this.worldToScreen(b, baseZ);
                const topB = this.worldToScreen(b, wallTopZ);
                const topA = this.worldToScreen(a, wallTopZ);
                gfx.lineStyle(selected ? 2 : 1, selected ? 0xfff0b8 : 0x111820, selected ? 0.95 : 0.45);
                gfx.beginFill(color, selected ? 0.62 : 0.42);
                gfx.moveTo(baseA.x, baseA.y);
                gfx.lineTo(baseB.x, baseB.y);
                gfx.lineTo(topB.x, topB.y);
                gfx.lineTo(topA.x, topA.y);
                gfx.closePath();
                gfx.endFill();
                gfx.lineStyle(selected ? 4 : 2, color, selected ? 1 : 0.88);
                gfx.moveTo(topA.x, topA.y);
                gfx.lineTo(topB.x, topB.y);
            }
        });
    }

    drawHandles() {
        const gfx = this.handleLayer;
        gfx.clear();
        const floor = this.state.selectedFloor();
        if (!floor) return;
        const elevation = getFloorElevation(floor);
        if (this.state.editorMode === "walls") {
            this.drawWallEndpointHandles(gfx, floor, elevation);
            return;
        }
        const baseColor = this.state.tool === "select" ? 0xf4f2e8 : 0xa7b0b8;
        ringsForFloor(floor).forEach((ring) => {
            ring.points.forEach((point, vertexIndex) => {
                const selected = (
                    this.state.selection.floorId === getFloorId(floor) &&
                    this.state.selection.ringKind === ring.ringKind &&
                    Number(this.state.selection.holeIndex) === Number(ring.holeIndex) &&
                    Number(this.state.selection.vertexIndex) === vertexIndex
                );
                const screen = this.worldToScreen(point, elevation);
                gfx.beginFill(selected ? 0xffffff : baseColor, 1);
                gfx.lineStyle(selected ? 3 : 2, selected ? 0xffd27a : 0x111820, 1);
                gfx.drawCircle(screen.x, screen.y, selected ? 7 : 5);
                gfx.endFill();
            });
        });
        const center = polygonCentroid(floor.outerPolygon);
        const centerScreen = this.worldToScreen(center, elevation);
        gfx.beginFill(0x111820, 0.8);
        gfx.lineStyle(2, 0xf4f2e8, 0.85);
        gfx.drawCircle(centerScreen.x, centerScreen.y, 4);
        gfx.endFill();
    }

    drawWallEndpointHandles(gfx, floor, elevation) {
        const floorId = getFloorId(floor);
        getBuildingWalls(this.state.building).forEach((wall) => {
            if ((wall.fragmentId || wall.floorId) !== floorId) return;
            const points = wallPoints(this.state.building, wall);
            if (points.length !== 2) return;
            [
                { key: "startPoint", point: points[0] },
                { key: "endPoint", point: points[1] }
            ].forEach((entry) => {
                const selected = (
                    Number(this.state.selection.wallId) === Number(wall.id) &&
                    this.state.selection.wallEndpointKey === entry.key
                );
                const screen = this.worldToScreen(entry.point, elevation);
                gfx.beginFill(selected ? 0xffffff : 0xc9d1d8, 1);
                gfx.lineStyle(selected ? 3 : 2, selected ? 0xffd27a : 0x111820, 1);
                gfx.drawCircle(screen.x, screen.y, selected ? 7 : 5);
                gfx.endFill();
            });
        });
    }

    drawDraft() {
        const gfx = this.draftLayer;
        gfx.clear();
        const draft = this.state.draft;
        if (!draft || !Array.isArray(draft.points) || !draft.points.length) return;
        const z = this.activePlaneZ();
        const color = draft.kind === "wall"
            ? 0x78b7ff
            : (draft.operation === "subtract" ? 0xff8a8a : 0x80e0bd);
        gfx.lineStyle(2, color, 1);
        const first = this.worldToScreen(draft.points[0], z);
        gfx.moveTo(first.x, first.y);
        for (let index = 1; index < draft.points.length; index++) {
            const point = this.worldToScreen(draft.points[index], z);
            gfx.lineTo(point.x, point.y);
        }
        if (draft.kind === "polygonEdit" && draft.points.length > 0 && this.state.hoverWorldPoint) {
            const hover = this.worldToScreen(this.state.hoverWorldPoint, z);
            gfx.lineTo(hover.x, hover.y);
        }
        draft.points.forEach((point) => {
            const screen = this.worldToScreen(point, z);
            gfx.beginFill(0x111820, 1);
            gfx.lineStyle(2, color, 1);
            gfx.drawCircle(screen.x, screen.y, 5);
            gfx.endFill();
        });
    }
}
