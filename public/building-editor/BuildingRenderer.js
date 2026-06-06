import "../assets/javascript/wallGeometry.js";
import { flattenPolygon, polygonCentroid, simplePolygonRingError } from "./BuildingGeometry.js";
import { validateBuilding } from "./BuildingValidation.js";
import { ADJACENT_DIRECTIONS, GAME_HEX_RADIUS, GAME_HEX_X_STEP, hexCorners, immediateNeighborOffset, offsetToWorld, visibleHexRange } from "./BuildingHexGrid.js";
import { ringsForFloor } from "./BuildingPolygonEditing.js";
import { columnVertices, DEFAULTS, findFloor, findFloorRoof, findWall, getBuildingMountedObjects, getBuildingFloors, getBuildingWalls, getFloorBeams, getFloorColumns, getFloorElevation, getFloorId, getFloorRoof, getFloorRoofs, getFloorStairs, getRoofContactPolygon, getRoofDomeLevels, getRoofGables, getRoofPeakPoint, getRoofShedDirection, getWallResolvedGeometry, offsetRing, stairFootprintPoints, wallCenterlinePoints, wallPoints } from "./BuildingModel.js";

const GAME_XY_RATIO = 0.66;
const CAMERA_DEFAULT_PITCH = Math.PI / 4;
const CAMERA_MIN_PITCH = 0;
const CAMERA_MAX_PITCH = Math.PI / 2 - 0.001;
const CAMERA_PITCH_BASE = Math.SQRT1_2;
const FLOOR_TEXTURE_REPEAT = 0.1;
const DEFAULT_ROOF_TEXTURE_REPEAT = 0.5;
const FLOOR_TEXTURE_CONFIG_URL = "/assets/images/flooring/items.json";
const ROOF_TEXTURE_CONFIG_URL = "/assets/images/roofs/items.json";
const ROOF_RENDER_Z_LIFT = 0.03;
const FLOOR_DEPTH_NEAR_METRIC = -128;
const FLOOR_DEPTH_FAR_METRIC = 256;
const FLOOR_DEPTH_BIAS = 0.015;
const GEOMETRY_EPSILON = 0.000001;
const COLLAPSED_WALL_INTERSECTION_AREA_EPSILON = 0.25;
const COLLAPSED_WALL_FOOTPRINT_SUBTRACTION_SCALE = 1.01;
const COLLAPSED_WALL_FRONT_DEPTH_EPSILON = 0.05;
const SCENE_LIGHT_TILT_RADIANS = 20 * Math.PI / 180;
const SCENE_LIGHT_DIFFUSE = 0.95;
const SCENE_LIGHT_MIN = 0.58;
const SCENE_LIGHT_MAX = 1.36;
const ROOF_OVERHEAD_SLOPE_LIGHTING = 0.55;
const DEFAULT_WALL_TEXTURE_REPEAT = 0.1;
const GABLE_MOUNT_WALL_THICKNESS = 0.08;
const GABLE_ENDPOINT_VERTEX_SNAP_PIXELS = 12;
const ROOF_SHED_DIRECTION_HANDLE_LENGTH = 1.25;
const GRID_SCREEN_OVERSCAN_PIXELS = 96;
const GRID_HEX_TILE_COLS = 10;      // must be even for hex column parity
const GRID_HEX_TILE_ROWS_MAX = 400;
const GRID_HEX_TILE_SPRITES = 12;   // max sprite instances per axis (12×12 pool)
const GRID_HEX_VY_MIN = 1.5;        // hide grid when hex row screen height < this px
const PICKER_DEBUG_DEPTH_BIAS = 0.05;
const SELECTION_OUTLINE_COLOR = 0x42a5ff;
const SELECTION_OUTLINE_SHADOW_COLOR = 0x07131f;
const PLAYTEST_WIZARD_SHEET_PATH = "/assets/images/runningman.png";
const PLAYTEST_WIZARD_SHEET_ROWS = 12;
const PLAYTEST_WIZARD_SHEET_COLS = 9;
const PLAYTEST_WIZARD_HAT_RESOLUTION = 128;
const PLAYTEST_WIZARD_HAT_RENDER_SCALE = 0.9;
const PLAYTEST_WIZARD_HAT_RENDER_Y_OFFSET_UNITS = 0.14;
const PLAYTEST_WIZARD_HAT_COLOR = 0x000099;
const PLAYTEST_WIZARD_HAT_BAND_COLOR = 0xffd700;
const PLAYTEST_WIZARD_SHADOW_RENDER_Z_OFFSET_UNITS = 0.1;

function roofMeshKey(floor, roof = null) {
    const floorId = getFloorId(floor);
    const roofId = roof && roof.id ? String(roof.id) : "primary";
    return `${floorId}:${roofId}`;
}

function floorRoofView(floor, roof = null) {
    if (!roof || getFloorRoof(floor) === roof) return floor;
    return { ...floor, roof };
}

const FLOOR_DEPTH_VS = `
precision highp float;
attribute vec3 aWorldPosition;
attribute vec3 aWorldNormal;
attribute vec2 aUvs;
uniform vec2 uScreenSize;
uniform vec2 uCameraWorld;
uniform float uCameraZ;
uniform float uViewScale;
uniform float uXyRatio;
uniform float uCameraPitch;
uniform vec2 uDepthRange;
uniform float uDepthBias;
uniform float uCameraRotation;
uniform vec2 uCameraRotationCenter;
uniform vec3 uLightVector;
uniform float uLightDiffuse;
uniform vec2 uLightClamp;
uniform float uOverheadSlopeLighting;
varying vec2 vUvs;
varying float vLightFactor;
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
    float pitchFloor = cos(uCameraPitch) / ${CAMERA_PITCH_BASE.toFixed(16)};
    float pitchHeight = sin(uCameraPitch) / ${CAMERA_PITCH_BASE.toFixed(16)};
    float sx = max(1.0, uScreenSize.x);
    float sy = max(1.0, uScreenSize.y);
    float screenX = camDx * uViewScale;
    float screenY = (camDy * pitchFloor - camDz * pitchHeight) * uViewScale * uXyRatio;
    float depthMetric = camDy * pitchHeight + camDz * pitchFloor + uDepthBias;
    float farMetric = uDepthRange.x;
    float invSpan = max(1e-6, uDepthRange.y);
    float nd = clamp((farMetric - depthMetric) * invSpan, 0.0, 1.0);
    vec2 clip = vec2(
        (screenX / sx) * 2.0 - 1.0,
        1.0 - (screenY / sy) * 2.0
    );
    gl_Position = vec4(clip, nd * 2.0 - 1.0, 1.0);
    vec3 normal = normalize(vec3(
        aWorldNormal.x * cosR - aWorldNormal.y * sinR,
        aWorldNormal.x * sinR + aWorldNormal.y * cosR,
        aWorldNormal.z
    ));
    vec3 light = normalize(uLightVector);
    float lightDot = dot(normal, light);
    float upwardWeight = smoothstep(0.25, 0.75, abs(normal.z));
    float overheadBaseline = light.z * upwardWeight;
    float directionalLightFactor = clamp(1.0 + (lightDot - overheadBaseline) * uLightDiffuse, uLightClamp.x, uLightClamp.y);
    float slopeLightFactor = mix(uLightClamp.x, 1.0, smoothstep(0.0, 1.0, clamp(normal.z, 0.0, 1.0)));
    vLightFactor = mix(directionalLightFactor, slopeLightFactor, clamp(uOverheadSlopeLighting, 0.0, 1.0));
    vUvs = aUvs;
}
`;

const FLOOR_DEPTH_FS = `
precision highp float;
varying vec2 vUvs;
varying float vLightFactor;
uniform sampler2D uSampler;
uniform vec4 uTint;
uniform float uAlphaCutoff;
void main(void) {
    vec4 outColor = texture2D(uSampler, fract(vUvs)) * uTint;
    outColor.rgb *= vLightFactor;
    if (outColor.a < uAlphaCutoff) discard;
    gl_FragColor = outColor;
}
`;

const SOLID_DEPTH_VS = `
precision highp float;
attribute vec3 aWorldPosition;
uniform vec2 uScreenSize;
uniform vec2 uCameraWorld;
uniform float uCameraZ;
uniform float uViewScale;
uniform float uXyRatio;
uniform float uCameraPitch;
uniform vec2 uDepthRange;
uniform float uDepthBias;
uniform float uCameraRotation;
uniform vec2 uCameraRotationCenter;
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
    float pitchFloor = cos(uCameraPitch) / ${CAMERA_PITCH_BASE.toFixed(16)};
    float pitchHeight = sin(uCameraPitch) / ${CAMERA_PITCH_BASE.toFixed(16)};
    float sx = max(1.0, uScreenSize.x);
    float sy = max(1.0, uScreenSize.y);
    float screenX = camDx * uViewScale;
    float screenY = (camDy * pitchFloor - camDz * pitchHeight) * uViewScale * uXyRatio;
    float depthMetric = camDy * pitchHeight + camDz * pitchFloor + uDepthBias;
    float farMetric = uDepthRange.x;
    float invSpan = max(1e-6, uDepthRange.y);
    float nd = clamp((farMetric - depthMetric) * invSpan, 0.0, 1.0);
    vec2 clip = vec2(
        (screenX / sx) * 2.0 - 1.0,
        1.0 - (screenY / sy) * 2.0
    );
    gl_Position = vec4(clip, nd * 2.0 - 1.0, 1.0);
}
`;

const SOLID_DEPTH_FS = `
precision highp float;
uniform vec4 uColor;
void main(void) {
    gl_FragColor = uColor;
}
`;

const PLAYTEST_WIZARD_DEPTH_VS = `
precision highp float;
attribute vec3 aWorldPosition;
attribute vec2 aUvs;
uniform vec2 uScreenSize;
uniform vec2 uCameraWorld;
uniform float uCameraZ;
uniform float uViewScale;
uniform float uXyRatio;
uniform float uCameraPitch;
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
    float pitchFloor = cos(uCameraPitch) / ${CAMERA_PITCH_BASE.toFixed(16)};
    float pitchHeight = sin(uCameraPitch) / ${CAMERA_PITCH_BASE.toFixed(16)};
    float sx = max(1.0, uScreenSize.x);
    float sy = max(1.0, uScreenSize.y);
    float screenX = camDx * uViewScale;
    float screenY = (camDy * pitchFloor - camDz * pitchHeight) * uViewScale * uXyRatio;
    float depthMetric = camDy * pitchHeight + camDz * pitchFloor + uDepthBias;
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

const PLAYTEST_WIZARD_DEPTH_FS = `
precision highp float;
varying vec2 vUvs;
uniform sampler2D uSampler;
uniform vec4 uTint;
uniform float uAlphaCutoff;
void main(void) {
    vec4 outColor = texture2D(uSampler, vUvs) * uTint;
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
    const pixiUtils = globalThis.PIXI && globalThis.PIXI.utils;
    const earcutFn = (pixiUtils && typeof pixiUtils.earcut === "function")
        ? pixiUtils.earcut
        : (typeof globalThis.earcut === "function" ? globalThis.earcut : null);
    if (!earcutFn) throw new Error("textured floor rendering requires earcut");
    const indices = earcutFn(flat, holeIndices, 2);
    if (!indices || indices.length < 3) return null;
    return { points, indices: new Uint16Array(indices) };
}

function triangulateFloor(floor) {
    return triangulateSurface(floor && floor.outerPolygon, floor && floor.holes);
}

function roofOverhang(floor) {
    const roof = getFloorRoof(floor);
    if (!roof) throw new Error(`floor ${getFloorId(floor)} has no roof`);
    const value = Number(roof.overhang);
    if (!Number.isFinite(value)) throw new Error(`roof ${getFloorId(floor)} overhang must be finite`);
    return value;
}

function roofPeakHeight(floor) {
    const roof = getFloorRoof(floor);
    if (!roof) throw new Error(`floor ${getFloorId(floor)} has no roof`);
    const value = Number(roof.peakHeight);
    if (!Number.isFinite(value) || value < 0) {
        throw new Error(`roof ${getFloorId(floor)} peak height must be zero or greater`);
    }
    return value;
}

function roofMode(floor) {
    const roof = getFloorRoof(floor);
    if (!roof) throw new Error(`floor ${getFloorId(floor)} has no roof`);
    const mode = String(roof.mode || "peak").trim().toLowerCase();
    if (mode === "peak" || mode === "shed" || mode === "gabled" || mode === "dome") return mode;
    throw new Error(`roof ${getFloorId(floor)} has unknown mode: ${roof.mode}`);
}

function clampCameraPitch(value) {
    const pitch = Number(value);
    if (!Number.isFinite(pitch)) return CAMERA_DEFAULT_PITCH;
    return Math.max(CAMERA_MIN_PITCH, Math.min(CAMERA_MAX_PITCH, pitch));
}

function cameraPitch(camera) {
    return clampCameraPitch(camera && camera.pitch !== undefined ? camera.pitch : CAMERA_DEFAULT_PITCH);
}

function cameraPitchProjectionFactors(camera) {
    const pitch = cameraPitch(camera);
    return {
        pitch,
        floor: Math.cos(pitch) / CAMERA_PITCH_BASE,
        height: Math.sin(pitch) / CAMERA_PITCH_BASE
    };
}

function floorMeshSignature(floor, textureRepeatConfig = null) {
    return `${surfaceMeshSignature(floor, floor.floorTexturePath, getFloorElevation(floor))};${textureRepeatSignature(textureRepeatConfig, FLOOR_TEXTURE_REPEAT)}`;
}

function floorTopElevation(floor) {
    const baseZ = getFloorElevation(floor);
    const height = Number(floor && floor.floorHeight);
    if (!Number.isFinite(height) || height <= 0) {
        throw new Error(`cannot render roof for ${getFloorId(floor)} without a positive floor height`);
    }
    return baseZ + height;
}

function roofElevationOffset(floor) {
    const roof = getFloorRoof(floor);
    if (!roof) throw new Error(`floor ${getFloorId(floor)} has no roof elevation`);
    const offset = Number(roof.elevationOffset);
    if (!Number.isFinite(offset)) throw new Error(`roof ${getFloorId(floor)} elevation offset must be finite`);
    return offset;
}

function roofBaseElevation(floor) {
    return floorTopElevation(floor) + roofElevationOffset(floor);
}

function roofRenderElevation(floor) {
    return roofBaseElevation(floor) + ROOF_RENDER_Z_LIFT;
}

function roofTexturePath(floor) {
    const roof = getFloorRoof(floor);
    if (!roof) throw new Error(`floor ${getFloorId(floor)} has no roof texture`);
    return roof.texturePath;
}

function normalizeTextureConfigPath(texturePath) {
    if (typeof texturePath !== "string" || texturePath.length === 0) return "";
    const raw = texturePath.split("?")[0].split("#")[0];
    if (raw.startsWith("/")) return raw;
    try {
        if (typeof window !== "undefined" && window.location && window.location.origin) {
            return new URL(raw, window.location.origin).pathname || raw;
        }
    } catch (_) {}
    return raw;
}

function normalizeTextureRepeatConfig(config = {}, fallbackRepeat = FLOOR_TEXTURE_REPEAT) {
    const fallback = Number.isFinite(Number(config.repeatsPerMapUnit))
        ? Math.max(0.0001, Number(config.repeatsPerMapUnit))
        : fallbackRepeat;
    const x = Number.isFinite(Number(config.repeatsPerMapUnitX))
        ? Math.max(0.0001, Number(config.repeatsPerMapUnitX))
        : fallback;
    const y = Number.isFinite(Number(config.repeatsPerMapUnitY))
        ? Math.max(0.0001, Number(config.repeatsPerMapUnitY))
        : fallback;
    return { repeatsPerMapUnitX: x, repeatsPerMapUnitY: y };
}

function normalizeRoofTextureRepeatConfig(config = {}) {
    return normalizeTextureRepeatConfig(config, DEFAULT_ROOF_TEXTURE_REPEAT);
}

function textureRepeatSignature(config, fallbackRepeat = FLOOR_TEXTURE_REPEAT) {
    const repeat = normalizeTextureRepeatConfig(config, fallbackRepeat);
    return `${repeat.repeatsPerMapUnitX.toFixed(6)}:${repeat.repeatsPerMapUnitY.toFixed(6)}`;
}

function roofTextureRepeatSignature(config) {
    return textureRepeatSignature(config, DEFAULT_ROOF_TEXTURE_REPEAT);
}

function gableWallTexturePath(floor, gable) {
    return normalizeTexturePath(gable && gable.wallTexturePath, floor && floor.defaultWallTexturePath || "/assets/images/walls/woodwall.png");
}

function roofPerimeterRing(floor) {
    if (roofMode(floor) === "shed") return shedRoofPerimeterRing(floor);
    if (roofMode(floor) === "gabled") return gabledRoofPerimeterRing(floor);
    if (roofMode(floor) === "dome") return domeRoofBaseRing(floor).map((point) => ({ ...point, z: roofRenderElevation(floor) }));
    if (roofMode(floor) !== "peak") throw new Error(`roof ${getFloorId(floor)} mode ${roofMode(floor)} is not renderable yet`);
    const contactRing = ringPointsForTriangulation(getRoofContactPolygon(floor));
    if (contactRing.length < 3) return contactRing;
    const overhang = roofOverhang(floor);
    if (Math.abs(overhang) <= GEOMETRY_EPSILON) return contactRing;
    return peakRoofEaveRing(floor, contactRing);
}

function shedRoofDirection(floor) {
    const direction = getRoofShedDirection(floor);
    const length = Math.hypot(Number(direction && direction.x), Number(direction && direction.y));
    if (!Number.isFinite(length) || length <= GEOMETRY_EPSILON) {
        throw new Error(`roof ${getFloorId(floor)} shed direction must be finite`);
    }
    return { x: Number(direction.x) / length, y: Number(direction.y) / length };
}

function shedRoofBaseRing(floor) {
    const contactRing = ringPointsForTriangulation(getRoofContactPolygon(floor));
    if (contactRing.length < 3) return contactRing;
    const overhang = roofOverhang(floor);
    if (Math.abs(overhang) <= GEOMETRY_EPSILON) return contactRing.map((point) => ({ ...point }));
    const ring = offsetRing(contactRing, overhang);
    if (!Array.isArray(ring) || ring.length !== contactRing.length) {
        throw new Error(`roof ${getFloorId(floor)} shed overhang requires a valid perimeter ring`);
    }
    return ring.map((point) => ({ x: Number(point.x), y: Number(point.y) }));
}

function domeRoofBaseRing(floor) {
    const contactRing = ringPointsForTriangulation(getRoofContactPolygon(floor));
    if (contactRing.length < 3) return contactRing;
    const overhang = roofOverhang(floor);
    if (Math.abs(overhang) <= GEOMETRY_EPSILON) return contactRing.map((point) => ({ ...point }));
    const ring = offsetRing(contactRing, overhang);
    if (!Array.isArray(ring) || ring.length !== contactRing.length) {
        throw new Error(`roof ${getFloorId(floor)} dome overhang requires a valid base ring`);
    }
    return ring.map((point) => ({ x: Number(point.x), y: Number(point.y) }));
}

function domeRoofLevelCount(floor) {
    const levels = getRoofDomeLevels(floor);
    if (!Number.isInteger(Number(levels)) || Number(levels) < 1) {
        throw new Error(`roof ${getFloorId(floor)} dome levels must be a positive integer`);
    }
    return Number(levels);
}

function shedRoofProjectionRange(floor) {
    const points = ringPointsForTriangulation(getRoofContactPolygon(floor));
    const direction = shedRoofDirection(floor);
    let min = Infinity;
    let max = -Infinity;
    points.forEach((point) => {
        const value = Number(point.x) * direction.x + Number(point.y) * direction.y;
        min = Math.min(min, value);
        max = Math.max(max, value);
    });
    if (!Number.isFinite(min) || !Number.isFinite(max) || max - min <= GEOMETRY_EPSILON) {
        throw new Error(`roof ${getFloorId(floor)} shed direction has no run across the roof polygon`);
    }
    return { min, max, direction };
}

function shedRoofZAt(floor, point, range = null) {
    const resolvedRange = range || shedRoofProjectionRange(floor);
    const projection = Number(point.x) * resolvedRange.direction.x + Number(point.y) * resolvedRange.direction.y;
    const t = (projection - resolvedRange.min) / (resolvedRange.max - resolvedRange.min);
    return roofRenderElevation(floor) + t * roofPeakHeight(floor);
}

function gabledRoofZAt(floor, point, range = null) {
    const resolvedRange = range || shedRoofProjectionRange(floor);
    const projection = Number(point.x) * resolvedRange.direction.x + Number(point.y) * resolvedRange.direction.y;
    const t = (projection - resolvedRange.min) / (resolvedRange.max - resolvedRange.min);
    return roofRenderElevation(floor) + (1 - Math.abs(2 * t - 1)) * roofPeakHeight(floor);
}

function shedRoofPerimeterRing(floor) {
    const ring = shedRoofBaseRing(floor);
    if (ring.length < 3) return ring;
    const range = shedRoofProjectionRange(floor);
    return ring.map((point) => ({ ...point, z: shedRoofZAt(floor, point, range) }));
}

function gabledRoofPerimeterRing(floor) {
    const ring = shedRoofBaseRing(floor);
    if (ring.length < 3) return ring;
    const range = shedRoofProjectionRange(floor);
    return ring.map((point) => ({ ...point, z: gabledRoofZAt(floor, point, range) }));
}

function projectionAlong(point, direction) {
    return Number(point.x) * Number(direction.x) + Number(point.y) * Number(direction.y);
}

function dedupeClipPoints(points) {
    const deduped = [];
    (Array.isArray(points) ? points : []).forEach((point) => {
        const previous = deduped[deduped.length - 1];
        if (previous && Math.hypot(Number(previous.x) - Number(point.x), Number(previous.y) - Number(point.y)) <= GEOMETRY_EPSILON) return;
        deduped.push(point);
    });
    if (deduped.length > 1) {
        const first = deduped[0];
        const last = deduped[deduped.length - 1];
        if (Math.hypot(Number(first.x) - Number(last.x), Number(first.y) - Number(last.y)) <= GEOMETRY_EPSILON) {
            deduped.pop();
        }
    }
    return deduped;
}

function clipRingToRidgeSide(ring, range, side) {
    const mid = (Number(range.min) + Number(range.max)) * 0.5;
    const direction = range.direction;
    const inside = (point) => {
        const signed = projectionAlong(point, direction) - mid;
        return side === "low" ? signed <= GEOMETRY_EPSILON : signed >= -GEOMETRY_EPSILON;
    };
    const intersection = (a, b) => {
        const aProjection = projectionAlong(a, direction);
        const bProjection = projectionAlong(b, direction);
        const denominator = bProjection - aProjection;
        if (Math.abs(denominator) <= GEOMETRY_EPSILON) return null;
        const t = (mid - aProjection) / denominator;
        if (t < -GEOMETRY_EPSILON || t > 1 + GEOMETRY_EPSILON) return null;
        return interpolatePoint(a, b, Math.max(0, Math.min(1, t)));
    };
    const result = [];
    for (let index = 0; index < ring.length; index++) {
        const current = ring[index];
        const next = ring[(index + 1) % ring.length];
        const currentInside = inside(current);
        const nextInside = inside(next);
        if (currentInside) result.push({ x: Number(current.x), y: Number(current.y) });
        if (currentInside !== nextInside) {
            const crossing = intersection(current, next);
            if (crossing) result.push(crossing);
        }
    }
    return dedupeClipPoints(result);
}

function peakRoofPoint(floor) {
    if (roofMode(floor) !== "peak") {
        throw new Error(`roof ${getFloorId(floor)} mode ${roofMode(floor)} has no peak point geometry yet`);
    }
    const peakPoint = getRoofPeakPoint(floor);
    if (!Number.isFinite(Number(peakPoint && peakPoint.x)) || !Number.isFinite(Number(peakPoint && peakPoint.y))) {
        throw new Error(`roof ${getFloorId(floor)} requires a finite peak point`);
    }
    return { x: Number(peakPoint.x), y: Number(peakPoint.y) };
}

function peakRoofEaveRing(floor, contactRing = null) {
    const ring = contactRing || ringPointsForTriangulation(getRoofContactPolygon(floor));
    if (ring.length < 3) return ring;
    const peak = peakRoofPoint(floor);
    const overhang = roofOverhang(floor);
    const rimZ = roofRenderElevation(floor);
    const peakHeight = roofPeakHeight(floor);
    return ring.map((point, index) => {
        const dx = Number(point.x) - peak.x;
        const dy = Number(point.y) - peak.y;
        const run = Math.hypot(dx, dy);
        if (run <= GEOMETRY_EPSILON) {
            throw new Error(`roof ${getFloorId(floor)} contact vertex ${index} coincides with the peak point`);
        }
        const slopeLength = Math.hypot(run, peakHeight);
        if (slopeLength <= GEOMETRY_EPSILON) {
            throw new Error(`roof ${getFloorId(floor)} contact vertex ${index} has no peak-to-contact run`);
        }
        const horizontalExtension = overhang * run / slopeLength;
        const scale = (run + horizontalExtension) / run;
        return {
            x: peak.x + dx * scale,
            y: peak.y + dy * scale,
            z: rimZ - peakHeight * (overhang / slopeLength)
        };
    });
}

function interpolatePoint(a, b, t) {
    const clamped = Math.max(0, Math.min(1, Number(t)));
    return {
        x: Number(a.x) + (Number(b.x) - Number(a.x)) * clamped,
        y: Number(a.y) + (Number(b.y) - Number(a.y)) * clamped
    };
}

function interpolatePoint3d(a, b, t) {
    const point = interpolatePoint(a, b, t);
    return {
        ...point,
        z: Number(a.z) + (Number(b.z) - Number(a.z)) * Math.max(0, Math.min(1, Number(t)))
    };
}

function distance3d(a, b) {
    return Math.hypot(
        Number(b.x) - Number(a.x),
        Number(b.y) - Number(a.y),
        Number(b.z) - Number(a.z)
    );
}

function triangleArea3d(a, b, c) {
    const abx = Number(b.x) - Number(a.x);
    const aby = Number(b.y) - Number(a.y);
    const abz = Number(b.z) - Number(a.z);
    const acx = Number(c.x) - Number(a.x);
    const acy = Number(c.y) - Number(a.y);
    const acz = Number(c.z) - Number(a.z);
    const nx = aby * acz - abz * acy;
    const ny = abz * acx - abx * acz;
    const nz = abx * acy - aby * acx;
    return Math.hypot(nx, ny, nz) * 0.5;
}

function roofFaceWorldGeometry(floor, faceIndex) {
    const ring = roofPerimeterRing(floor);
    const index = Math.floor(Number(faceIndex));
    if (!Number.isInteger(index) || index < 0 || index >= ring.length) {
        throw new Error(`roof ${getFloorId(floor)} face index out of range: ${faceIndex}`);
    }
    const rimZ = roofRenderElevation(floor);
    const peakHeight = roofPeakHeight(floor);
    const peakPoint = peakRoofPoint(floor);
    return {
        faceIndex: index,
        edgeA: { ...ring[index], z: Number.isFinite(Number(ring[index].z)) ? Number(ring[index].z) : rimZ },
        edgeB: { ...ring[(index + 1) % ring.length], z: Number.isFinite(Number(ring[(index + 1) % ring.length].z)) ? Number(ring[(index + 1) % ring.length].z) : rimZ },
        peak: { x: peakPoint.x, y: peakPoint.y, z: rimZ + peakHeight },
        rimZ,
        peakHeight
    };
}

function roofPeakWorldGeometry(floor) {
    const rimZ = roofRenderElevation(floor);
    const peakHeight = roofPeakHeight(floor);
    const peakPoint = peakRoofPoint(floor);
    return {
        peak: { x: peakPoint.x, y: peakPoint.y, z: rimZ + peakHeight },
        rimZ,
        peakHeight
    };
}

function gableEndpointPosition(gable, key, ringLength) {
    const endpoint = gable && gable[key];
    const edgeIndex = Math.floor(Number(endpoint && endpoint.edgeIndex));
    const t = Number(endpoint && endpoint.t);
    if (!Number.isInteger(edgeIndex) || edgeIndex < 0 || edgeIndex >= ringLength || !Number.isFinite(t)) {
        throw new Error(`roof gable ${gable && gable.id} ${key} endpoint must reference the roof outline`);
    }
    return { edgeIndex, t: Math.max(0, Math.min(1, t)) };
}

function perimeterPointAtPosition(ring, position, label) {
    const index = Math.floor(Number(position && position.edgeIndex));
    if (!Array.isArray(ring) || index < 0 || index >= ring.length) {
        throw new Error(`${label} references missing perimeter edge`);
    }
    return interpolatePoint(ring[index], ring[(index + 1) % ring.length], Number(position.t));
}

function perimeterPathSegments(ring, start, end, label) {
    if (!Array.isArray(ring) || ring.length < 3) {
        throw new Error(`${label} requires a valid perimeter ring`);
    }
    const segments = [];
    let current = { ...start };
    let guard = 0;
    while (true) {
        const reachesEndOnCurrentEdge = current.edgeIndex === end.edgeIndex && (guard > 0 || end.t >= current.t);
        const segmentEnd = reachesEndOnCurrentEdge
            ? { ...end }
            : { edgeIndex: current.edgeIndex, t: 1 };
        const startPoint = perimeterPointAtPosition(ring, current, `${label} segment ${segments.length} start`);
        const endPoint = perimeterPointAtPosition(ring, segmentEnd, `${label} segment ${segments.length} end`);
        if (Math.hypot(Number(endPoint.x) - Number(startPoint.x), Number(endPoint.y) - Number(startPoint.y)) > GEOMETRY_EPSILON) {
            segments.push({
                start: { ...startPoint, position: { ...current } },
                end: { ...endPoint, position: { ...segmentEnd } }
            });
        }
        if (reachesEndOnCurrentEdge) break;
        current = { edgeIndex: (current.edgeIndex + 1) % ring.length, t: 0 };
        guard++;
        if (guard > ring.length) throw new Error(`${label} could not walk perimeter interval`);
    }
    return segments;
}

function segmentTForLineIntersection(a, b, linePoint, lineDirection) {
    const sx = Number(b.x) - Number(a.x);
    const sy = Number(b.y) - Number(a.y);
    const lx = Number(lineDirection.x);
    const ly = Number(lineDirection.y);
    const denominator = sx * ly - sy * lx;
    if (Math.abs(denominator) <= GEOMETRY_EPSILON) return null;
    const dx = Number(linePoint.x) - Number(a.x);
    const dy = Number(linePoint.y) - Number(a.y);
    const t = (dx * ly - dy * lx) / denominator;
    return Number.isFinite(t) ? t : null;
}

function interpolateGableSegmentPosition(a, b, t) {
    if (!a || !b || a.edgeIndex !== b.edgeIndex) {
        throw new Error("gable wall segment split requires endpoints on the same outline edge");
    }
    return {
        edgeIndex: a.edgeIndex,
        t: Number(a.t) + (Number(b.t) - Number(a.t)) * Math.max(0, Math.min(1, Number(t)))
    };
}

function pointWithPositionAtSegmentT(a, b, t) {
    const clamped = Math.max(0, Math.min(1, Number(t)));
    return {
        x: Number(a.x) + (Number(b.x) - Number(a.x)) * clamped,
        y: Number(a.y) + (Number(b.y) - Number(a.y)) * clamped,
        z: Number(a.z) + (Number(b.z) - Number(a.z)) * clamped,
        position: interpolateGableSegmentPosition(a.position, b.position, clamped)
    };
}

function roofPlaneFromPoints(a, b, c, label) {
    const normal = triangleSurfaceNormal(a, b, c, label);
    if (Math.abs(normal.z) <= GEOMETRY_EPSILON) {
        throw new Error(`${label} cannot clip vertical walls with a vertical roof plane`);
    }
    return { point: a, normal };
}

function roofPlaneZAt(plane, point, label) {
    const z = Number(plane.point.z) -
        (Number(plane.normal.x) * (Number(point.x) - Number(plane.point.x)) +
            Number(plane.normal.y) * (Number(point.y) - Number(plane.point.y))) / Number(plane.normal.z);
    if (!Number.isFinite(z)) throw new Error(`${label} produced a non-finite roof clip height`);
    return z;
}

function gableWallTopZ(geometry, point, label) {
    const leftZ = roofPlaneZAt(geometry.leftRoofPlane, point, `${label} left plane`);
    const rightZ = roofPlaneZAt(geometry.rightRoofPlane, point, `${label} right plane`);
    return Math.max(geometry.rimZ, Math.min(geometry.rimZ + geometry.height, Math.min(leftZ, rightZ)));
}

function splitGableWallBaseSegmentAtRidge(segment, geometry) {
    const t = segmentTForLineIntersection(segment.start, segment.end, geometry.roofApex, geometry.ridgeDirection);
    if (t === null || t <= GEOMETRY_EPSILON || t >= 1 - GEOMETRY_EPSILON) return [segment];
    const middle = pointWithPositionAtSegmentT(segment.start, segment.end, t);
    return [
        { start: segment.start, end: middle },
        { start: middle, end: segment.end }
    ];
}

function gableRidgeWallCrossing(wallSegments, ridgePoint, ridgeDirection, label) {
    let best = null;
    wallSegments.forEach((segment) => {
        const t = segmentTForLineIntersection(segment.start, segment.end, ridgePoint, ridgeDirection);
        if (t === null || t < -GEOMETRY_EPSILON || t > 1 + GEOMETRY_EPSILON) return;
        const point = pointWithPositionAtSegmentT(segment.start, segment.end, Math.max(0, Math.min(1, t)));
        const distance = Math.hypot(Number(point.x) - Number(ridgePoint.x), Number(point.y) - Number(ridgePoint.y));
        if (!best || distance < best.distance) best = { point, distance };
    });
    if (!best) {
        throw new Error(`${label} ridge line does not cross the gable wall contour`);
    }
    return best.point;
}

function gableWorldGeometry(floor, gable) {
    const roofRing = roofPerimeterRing(floor);
    const floorRing = ringPointsForTriangulation(getRoofContactPolygon(floor));
    const start = gableEndpointPosition(gable, "start", roofRing.length);
    const end = gableEndpointPosition(gable, "end", roofRing.length);
    const roofBase = roofPeakWorldGeometry(floor);
    const height = Math.max(0, Math.min(roofBase.peakHeight, Number(gable.height)));
    const roofStartPoint = perimeterPointAtPosition(roofRing, start, `roof ${getFloorId(floor)} gable ${gable && gable.id} start`);
    const roofEndPoint = perimeterPointAtPosition(roofRing, end, `roof ${getFloorId(floor)} gable ${gable && gable.id} end`);
    const wallStartPoint = perimeterPointAtPosition(floorRing, start, `roof ${getFloorId(floor)} gable ${gable && gable.id} wall start`);
    const wallEndPoint = perimeterPointAtPosition(floorRing, end, `roof ${getFloorId(floor)} gable ${gable && gable.id} wall end`);
    const preliminaryRoofMid = {
        x: (Number(roofStartPoint.x) + Number(roofEndPoint.x)) * 0.5,
        y: (Number(roofStartPoint.y) + Number(roofEndPoint.y)) * 0.5
    };
    const edgeDx = Number(roofEndPoint.x) - Number(roofStartPoint.x);
    const edgeDy = Number(roofEndPoint.y) - Number(roofStartPoint.y);
    const edgeLength = Math.hypot(edgeDx, edgeDy);
    if (edgeLength <= GEOMETRY_EPSILON) {
        throw new Error(`roof ${getFloorId(floor)} gable ${gable && gable.id} requires non-coincident outline endpoints`);
    }
    const edgeUx = edgeDx / edgeLength;
    const edgeUy = edgeDy / edgeLength;
    const peakDx = Number(roofBase.peak.x) - Number(preliminaryRoofMid.x);
    const peakDy = Number(roofBase.peak.y) - Number(preliminaryRoofMid.y);
    const peakAlongEdge = peakDx * edgeUx + peakDy * edgeUy;
    const inwardX = peakDx - edgeUx * peakAlongEdge;
    const inwardY = peakDy - edgeUy * peakAlongEdge;
    const inwardLength = Math.hypot(inwardX, inwardY);
    if (inwardLength <= GEOMETRY_EPSILON) {
        throw new Error(`roof ${getFloorId(floor)} gable ${gable && gable.id} requires an outline span with inward roof depth`);
    }
    const wallBaseSegments = perimeterPathSegments(floorRing, start, end, `roof ${getFloorId(floor)} gable ${gable && gable.id} wall path`)
        .map((segment) => ({
            start: { ...segment.start, z: roofBase.rimZ },
            end: { ...segment.end, z: roofBase.rimZ }
        }));
    const ridgeDirection = { x: inwardX / inwardLength, y: inwardY / inwardLength };
    const wallCrossing = gableRidgeWallCrossing(
        wallBaseSegments,
        preliminaryRoofMid,
        ridgeDirection,
        `roof ${getFloorId(floor)} gable ${gable && gable.id}`
    );
    const overhang = roofOverhang(floor);
    const roofApex = {
        x: Number(wallCrossing.x) - ridgeDirection.x * overhang,
        y: Number(wallCrossing.y) - ridgeDirection.y * overhang,
        z: roofBase.rimZ + height
    };
    const heightT = roofBase.peakHeight > GEOMETRY_EPSILON ? height / roofBase.peakHeight : 0;
    const roofStart = { ...roofStartPoint, z: roofBase.rimZ };
    const roofEnd = { ...roofEndPoint, z: roofBase.rimZ };
    const backApexOnMainRoof = interpolatePoint3d({ x: roofApex.x, y: roofApex.y, z: roofBase.rimZ }, roofBase.peak, heightT);
    const runLength = Math.hypot(
        Number(backApexOnMainRoof.x) - Number(roofApex.x),
        Number(backApexOnMainRoof.y) - Number(roofApex.y)
    );
    const runVector = {
        x: inwardX / inwardLength * runLength,
        y: inwardY / inwardLength * runLength
    };
    const translateRun = (point) => ({
        x: Number(point.x) + runVector.x,
        y: Number(point.y) + runVector.y,
        z: Number(point.z)
    });
    const roofBackStart = translateRun(roofStart);
    const roofBackEnd = translateRun(roofEnd);
    const roofBackApex = translateRun(roofApex);
    const baseGeometry = {
        rimZ: roofBase.rimZ,
        height,
        roofApex,
        ridgeDirection,
        leftRoofPlane: roofPlaneFromPoints(roofStart, roofApex, roofBackApex, `roof ${getFloorId(floor)} gable ${gable && gable.id} left side`),
        rightRoofPlane: roofPlaneFromPoints(roofApex, roofEnd, roofBackEnd, `roof ${getFloorId(floor)} gable ${gable && gable.id} right side`)
    };
    const wallSegments = wallBaseSegments
        .flatMap((segment) => splitGableWallBaseSegmentAtRidge(segment, baseGeometry))
        .map((segment, index) => {
            const topStartZ = gableWallTopZ(baseGeometry, segment.start, `roof ${getFloorId(floor)} gable ${gable && gable.id} wall segment ${index} start`);
            const topEndZ = gableWallTopZ(baseGeometry, segment.end, `roof ${getFloorId(floor)} gable ${gable && gable.id} wall segment ${index} end`);
            return {
                bottomStart: { ...segment.start, z: roofBase.rimZ },
                bottomEnd: { ...segment.end, z: roofBase.rimZ },
                topStart: { ...segment.start, z: topStartZ },
                topEnd: { ...segment.end, z: topEndZ }
            };
        });
    return {
        start,
        end,
        rimZ: roofBase.rimZ,
        peakHeight: roofBase.peakHeight,
        height,
        ridgeDirection,
        wallCrossing,
        leftRoofPlane: baseGeometry.leftRoofPlane,
        rightRoofPlane: baseGeometry.rightRoofPlane,
        roofStart,
        roofEnd,
        roofApex,
        roofBackStart,
        roofBackEnd,
        roofBackApex,
        roofPeak: roofBase.peak,
        wallStart: { ...wallStartPoint, z: roofBase.rimZ },
        wallEnd: { ...wallEndPoint, z: roofBase.rimZ },
        wallSegments
    };
}

function pointsCoincident(a, b) {
    return Math.hypot(Number(a.x) - Number(b.x), Number(a.y) - Number(b.y)) <= GEOMETRY_EPSILON;
}

function gableWallSegmentLength(segment, label) {
    const length = Math.hypot(
        Number(segment.bottomEnd.x) - Number(segment.bottomStart.x),
        Number(segment.bottomEnd.y) - Number(segment.bottomStart.y)
    );
    if (!Number.isFinite(length) || length <= GEOMETRY_EPSILON) {
        throw new Error(`${label} requires a positive wall segment length`);
    }
    return length;
}

function gableWallSegmentsCollinear(a, b) {
    if (!pointsCoincident(a.bottomEnd, b.bottomStart)) return false;
    const ax = Number(a.bottomEnd.x) - Number(a.bottomStart.x);
    const ay = Number(a.bottomEnd.y) - Number(a.bottomStart.y);
    const bx = Number(b.bottomEnd.x) - Number(b.bottomStart.x);
    const by = Number(b.bottomEnd.y) - Number(b.bottomStart.y);
    const cross = ax * by - ay * bx;
    const dot = ax * bx + ay * by;
    return Math.abs(cross) <= GEOMETRY_EPSILON && dot > 0;
}

function gableMountSections(geometry, label) {
    if (!geometry || !Array.isArray(geometry.wallSegments)) {
        throw new Error(`${label} requires gable wall segments`);
    }
    const sections = [];
    geometry.wallSegments.forEach((segment, segmentIndex) => {
        const length = gableWallSegmentLength(segment, `${label} wall segment ${segmentIndex}`);
        const last = sections[sections.length - 1] || null;
        if (last && gableWallSegmentsCollinear(last.lastSegment, segment)) {
            last.pieces.push({
                segment,
                segmentIndex,
                startAlong: last.length,
                endAlong: last.length + length
            });
            last.length += length;
            last.bottomEnd = segment.bottomEnd;
            last.topEnd = segment.topEnd;
            last.lastSegment = segment;
            return;
        }
        sections.push({
            sectionIndex: sections.length,
            bottomStart: segment.bottomStart,
            bottomEnd: segment.bottomEnd,
            topStart: segment.topStart,
            topEnd: segment.topEnd,
            length,
            lastSegment: segment,
            pieces: [{
                segment,
                segmentIndex,
                startAlong: 0,
                endAlong: length
            }]
        });
    });
    return sections;
}

function gableMountPieceForSegment(section, segmentIndex, label) {
    const piece = section && section.pieces && section.pieces.find((candidate) => candidate.segmentIndex === segmentIndex);
    if (!piece) throw new Error(`${label} references a segment outside its mount section`);
    return piece;
}

function gableMountSectionForSegment(sections, segmentIndex, label) {
    const section = sections.find((candidate) => candidate.pieces.some((piece) => piece.segmentIndex === segmentIndex));
    if (!section) throw new Error(`${label} references missing gable wall segment ${segmentIndex}`);
    return section;
}

function gableMountPieceAtAlong(section, along, label) {
    const clamped = Math.max(0, Math.min(Number(section.length), Number(along)));
    const piece = section.pieces.find((candidate) => (
        clamped >= candidate.startAlong - GEOMETRY_EPSILON &&
        clamped <= candidate.endAlong + GEOMETRY_EPSILON
    )) || section.pieces[section.pieces.length - 1];
    if (!piece) throw new Error(`${label} cannot resolve mount section position`);
    return { piece, along: clamped };
}

function gableMountPointAtAlong(section, along, label) {
    const resolved = gableMountPieceAtAlong(section, along, label);
    const pieceLength = resolved.piece.endAlong - resolved.piece.startAlong;
    const localT = pieceLength > GEOMETRY_EPSILON
        ? (resolved.along - resolved.piece.startAlong) / pieceLength
        : 0;
    return {
        segmentIndex: resolved.piece.segmentIndex,
        wallT: Math.max(0, Math.min(1, localT)),
        point: interpolatePoint(resolved.piece.segment.bottomStart, resolved.piece.segment.bottomEnd, localT),
        topZ: Number(resolved.piece.segment.topStart.z) + (Number(resolved.piece.segment.topEnd.z) - Number(resolved.piece.segment.topStart.z)) * Math.max(0, Math.min(1, localT))
    };
}

function ringCumulativeLengths(ring) {
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

function distancePointToLineSegment(point, a, b) {
    const dx = Number(b.x) - Number(a.x);
    const dy = Number(b.y) - Number(a.y);
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared <= GEOMETRY_EPSILON) {
        return Math.hypot(Number(point.x) - Number(a.x), Number(point.y) - Number(a.y));
    }
    const t = Math.max(0, Math.min(1, ((Number(point.x) - Number(a.x)) * dx + (Number(point.y) - Number(a.y)) * dy) / lengthSquared));
    return Math.hypot(
        Number(point.x) - (Number(a.x) + dx * t),
        Number(point.y) - (Number(a.y) + dy * t)
    );
}

function distancePointToScreenSegment(point, a, b) {
    const dx = Number(b.x) - Number(a.x);
    const dy = Number(b.y) - Number(a.y);
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared <= GEOMETRY_EPSILON) {
        return Math.hypot(Number(point.x) - Number(a.x), Number(point.y) - Number(a.y));
    }
    const t = Math.max(0, Math.min(1, ((Number(point.x) - Number(a.x)) * dx + (Number(point.y) - Number(a.y)) * dy) / lengthSquared));
    return Math.hypot(
        Number(point.x) - (Number(a.x) + dx * t),
        Number(point.y) - (Number(a.y) + dy * t)
    );
}

function triangleSurfaceNormal(a, b, c, label) {
    const abx = Number(b.x) - Number(a.x);
    const aby = Number(b.y) - Number(a.y);
    const abz = Number(b.z) - Number(a.z);
    const acx = Number(c.x) - Number(a.x);
    const acy = Number(c.y) - Number(a.y);
    const acz = Number(c.z) - Number(a.z);
    let nx = aby * acz - abz * acy;
    let ny = abz * acx - abx * acz;
    let nz = abx * acy - aby * acx;
    const length = Math.hypot(nx, ny, nz);
    if (!Number.isFinite(length) || length <= GEOMETRY_EPSILON) {
        throw new Error(`${label} requires a non-degenerate triangle normal`);
    }
    if (nz < 0) {
        nx = -nx;
        ny = -ny;
        nz = -nz;
    }
    return { x: nx / length, y: ny / length, z: nz / length };
}

function vector3Between(a, b) {
    return {
        x: Number(b.x) - Number(a.x),
        y: Number(b.y) - Number(a.y),
        z: Number(b.z) - Number(a.z)
    };
}

function dot3(a, b) {
    return Number(a.x) * Number(b.x) + Number(a.y) * Number(b.y) + Number(a.z) * Number(b.z);
}

function cross3(a, b) {
    return {
        x: Number(a.y) * Number(b.z) - Number(a.z) * Number(b.y),
        y: Number(a.z) * Number(b.x) - Number(a.x) * Number(b.z),
        z: Number(a.x) * Number(b.y) - Number(a.y) * Number(b.x)
    };
}

function normalizeVector3(vector, label) {
    const length = Math.hypot(Number(vector.x), Number(vector.y), Number(vector.z));
    if (!Number.isFinite(length) || length <= GEOMETRY_EPSILON) {
        throw new Error(`${label} requires a non-zero vector`);
    }
    return {
        x: Number(vector.x) / length,
        y: Number(vector.y) / length,
        z: Number(vector.z) / length
    };
}

function midpoint3(points, label) {
    if (!Array.isArray(points) || points.length === 0) {
        throw new Error(`${label} requires at least one point`);
    }
    const sum = points.reduce((acc, point) => ({
        x: acc.x + Number(point.x),
        y: acc.y + Number(point.y),
        z: acc.z + Number(point.z)
    }), { x: 0, y: 0, z: 0 });
    const count = points.length;
    return { x: sum.x / count, y: sum.y / count, z: sum.z / count };
}

function domeFacetUvPoints(a, b, c, normal, label, repeatX, repeatY) {
    const vertices = [a, b, c].map((point, index) => {
        const x = Number(point.x);
        const y = Number(point.y);
        const z = Number(point.z);
        if (![x, y, z].every(Number.isFinite)) {
            throw new Error(`${label} vertex ${index} requires finite xyz for texture coordinates`);
        }
        return { ...point, x, y, z };
    });
    const minZ = Math.min(...vertices.map((point) => point.z));
    const maxZ = Math.max(...vertices.map((point) => point.z));
    let origin = vertices[0];
    let vAxis = null;
    let uCandidate = null;
    if (maxZ - minZ > GEOMETRY_EPSILON) {
        const top = vertices.filter((point) => Math.abs(point.z - maxZ) <= GEOMETRY_EPSILON);
        const lower = vertices.filter((point) => Math.abs(point.z - maxZ) > GEOMETRY_EPSILON);
        origin = midpoint3(top, `${label} top edge`);
        const lowerMid = midpoint3(lower, `${label} lower edge`);
        if (top.length >= 2) {
            uCandidate = vector3Between(top[0], top[1]);
            const topAxis = normalizeVector3(uCandidate, `${label} top texture axis`);
            vAxis = normalizeVector3(cross3(topAxis, normal), `${label} downslope texture axis`);
            if (dot3(vAxis, vector3Between(origin, lowerMid)) < 0) {
                vAxis = { x: -vAxis.x, y: -vAxis.y, z: -vAxis.z };
            }
        } else {
            uCandidate = vector3Between(lower[0], lower[lower.length - 1]);
            const lowerAxis = normalizeVector3(uCandidate, `${label} lower texture axis`);
            vAxis = normalizeVector3(cross3(lowerAxis, normal), `${label} downslope texture axis`);
            if (dot3(vAxis, vector3Between(origin, lowerMid)) < 0) {
                vAxis = { x: -vAxis.x, y: -vAxis.y, z: -vAxis.z };
            }
        }
    } else {
        uCandidate = vector3Between(vertices[0], vertices[1]);
        if (Math.hypot(uCandidate.x, uCandidate.y, uCandidate.z) <= GEOMETRY_EPSILON) {
            uCandidate = vector3Between(vertices[0], vertices[2]);
        }
        const uAxisFlat = normalizeVector3(uCandidate, `${label} flat texture u axis`);
        vAxis = normalizeVector3(cross3(uAxisFlat, normal), `${label} flat texture v axis`);
    }
    let uAxis = normalizeVector3(cross3(normal, vAxis), `${label} texture u axis`);
    if (uCandidate && dot3(uAxis, uCandidate) < 0) {
        uAxis = { x: -uAxis.x, y: -uAxis.y, z: -uAxis.z };
    }
    const coords = vertices.map((point) => ({
        point,
        rawU: dot3(vector3Between(origin, point), uAxis),
        rawV: dot3(vector3Between(origin, point), vAxis)
    }));
    const minU = Math.min(...coords.map((coord) => coord.rawU));
    const flatFacet = maxZ - minZ <= GEOMETRY_EPSILON;
    const minV = flatFacet ? Math.min(...coords.map((coord) => coord.rawV)) : 0;
    return coords.map((coord) => ({
        ...coord.point,
        u: (coord.rawU - minU) * repeatX,
        v: Math.max(0, coord.rawV - minV) * repeatY
    }));
}

function averageSurfaceNormals(a, b, label) {
    const nx = Number(a && a.x) + Number(b && b.x);
    const ny = Number(a && a.y) + Number(b && b.y);
    const nz = Number(a && a.z) + Number(b && b.z);
    const length = Math.hypot(nx, ny, nz);
    if (!Number.isFinite(length) || length <= GEOMETRY_EPSILON) {
        throw new Error(`${label} requires compatible gable side normals`);
    }
    return { x: nx / length, y: ny / length, z: nz / length };
}

function clipRingToPoints(ring, label) {
    if (!Array.isArray(ring) || ring.length < 4) {
        throw new Error(`${label} requires a closed polygon ring`);
    }
    const points = ring.map((point, index) => {
        const x = Number(Array.isArray(point) ? point[0] : point && point.x);
        const y = Number(Array.isArray(point) ? point[1] : point && point.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            throw new Error(`${label} contains a non-finite point at index ${index}`);
        }
        return { x, y };
    });
    const first = points[0];
    const last = points[points.length - 1];
    if (Math.hypot(Number(first.x) - Number(last.x), Number(first.y) - Number(last.y)) <= GEOMETRY_EPSILON) {
        points.pop();
    }
    if (points.length < 3) throw new Error(`${label} requires at least three unique points`);
    return points;
}

function roofTriangleBarycentric(point, a, b, c, label) {
    const px = Number(point.x);
    const py = Number(point.y);
    const ax = Number(a.x);
    const ay = Number(a.y);
    const bx = Number(b.x);
    const by = Number(b.y);
    const cx = Number(c.x);
    const cy = Number(c.y);
    const denominator = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
    if (Math.abs(denominator) <= GEOMETRY_EPSILON) {
        throw new Error(`${label} requires a non-degenerate source triangle`);
    }
    const wa = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / denominator;
    const wb = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / denominator;
    return { a: wa, b: wb, c: 1 - wa - wb };
}

function interpolateRoofTrianglePoint(point, a, b, c, label) {
    const weights = roofTriangleBarycentric(point, a, b, c, label);
    const blend = (key) => Number(a[key]) * weights.a + Number(b[key]) * weights.b + Number(c[key]) * weights.c;
    return {
        x: Number(point.x),
        y: Number(point.y),
        z: blend("z"),
        u: blend("u"),
        v: blend("v")
    };
}

function perimeterPathPoints(segments, label) {
    if (!Array.isArray(segments) || segments.length < 1) {
        throw new Error(`${label} requires at least one perimeter segment`);
    }
    return [
        segments[0].start,
        ...segments.map((segment) => segment.end)
    ];
}

function gableRoofClipPolygon(floor, geometry, label) {
    if (roofOverhang(floor) <= GEOMETRY_EPSILON) return null;
    const roofRing = roofPerimeterRing(floor);
    const floorRing = ringPointsForTriangulation(getRoofContactPolygon(floor));
    if (roofRing.length !== floorRing.length) {
        throw new Error(`${label} roof return clip requires matching floor and roof perimeter rings`);
    }
    const roofPath = perimeterPathPoints(
        perimeterPathSegments(roofRing, geometry.start, geometry.end, `${label} roof return outer path`),
        `${label} roof return outer path`
    );
    const floorPath = perimeterPathPoints(
        perimeterPathSegments(floorRing, geometry.start, geometry.end, `${label} roof return inner path`),
        `${label} roof return inner path`
    );
    const ring = closedClipRing([
        ...roofPath,
        ...floorPath.reverse()
    ], `${label} roof return clip footprint`);
    if (Math.abs(clipRingSignedArea(ring)) <= GEOMETRY_EPSILON) {
        throw new Error(`${label} roof clip footprint has zero area`);
    }
    return [ring];
}

function triangulatePitchedRoof(floor, textureRepeatConfig = null) {
    const floorId = getFloorId(floor);
    if (roofMode(floor) !== "peak") {
        throw new Error(`roof ${floorId} mode ${roofMode(floor)} cannot use peak triangulation`);
    }
    const repeatConfig = normalizeRoofTextureRepeatConfig(textureRepeatConfig);
    const repeatX = repeatConfig.repeatsPerMapUnitX;
    const repeatY = repeatConfig.repeatsPerMapUnitY;
    const holes = Array.isArray(floor && floor.holes) ? floor.holes.filter((ring) => Array.isArray(ring) && ring.length >= 3) : [];
    if (holes.length > 0) {
        throw new Error(`roof ${floorId} with overhang or peak height cannot render floor holes yet`);
    }
    const contactRing = ringPointsForTriangulation(getRoofContactPolygon(floor));
    if (contactRing.length < 3) return null;
    const overhang = roofOverhang(floor);
    const peakHeight = roofPeakHeight(floor);
    const rimZ = roofRenderElevation(floor);
    const peakPoint = peakRoofPoint(floor);
    const points = [];
    const indices = [];
    const addTriangle = (a, b, c) => {
        const normal = triangleSurfaceNormal(a, b, c, `roof ${floorId}`);
        const start = points.length;
        points.push(
            { ...a, normal },
            { ...b, normal },
            { ...c, normal }
        );
        indices.push(start, start + 1, start + 2);
    };
    const addGableRoofPatch = (geometry, label) => {
        if (
            triangleArea3d(geometry.roofStart, geometry.roofApex, geometry.roofBackApex) <= GEOMETRY_EPSILON ||
            triangleArea3d(geometry.roofApex, geometry.roofEnd, geometry.roofBackEnd) <= GEOMETRY_EPSILON
        ) {
            return;
        }
        const runRepeat = distance3d(geometry.roofApex, geometry.roofBackApex) * repeatX;
        const leftSlopeRepeat = distance3d(geometry.roofStart, geometry.roofApex) * repeatY;
        const rightSlopeRepeat = distance3d(geometry.roofEnd, geometry.roofApex) * repeatY;
        const leftNormal = triangleSurfaceNormal(geometry.roofStart, geometry.roofApex, geometry.roofBackApex, `${label} left side`);
        const rightNormal = triangleSurfaceNormal(geometry.roofApex, geometry.roofEnd, geometry.roofBackEnd, `${label} right side`);
        const ridgeNormal = averageSurfaceNormals(leftNormal, rightNormal, `${label} ridge`);
        const start = points.length;
        points.push(
            { ...geometry.roofStart, u: 0, v: leftSlopeRepeat, normal: leftNormal },
            { ...geometry.roofApex, u: 0, v: 0, normal: ridgeNormal },
            { ...geometry.roofBackApex, u: runRepeat, v: 0, normal: ridgeNormal },
            { ...geometry.roofBackStart, u: runRepeat, v: leftSlopeRepeat, normal: leftNormal },
            { ...geometry.roofEnd, u: 0, v: rightSlopeRepeat, normal: rightNormal },
            { ...geometry.roofBackEnd, u: runRepeat, v: rightSlopeRepeat, normal: rightNormal }
        );
        indices.push(
            start, start + 1, start + 2,
            start, start + 2, start + 3,
            start + 1, start + 4, start + 5,
            start + 1, start + 5, start + 2
        );
    };
    const addClippedRoofTriangle = (a, b, c, clipPolygons, label) => {
        const source = [[closedClipRing([a, b, c], `${label} source`)]];
        let clipped = null;
        try {
            clipped = polygonClipper(`roof ${floorId} gable clipping`).difference(source, ...clipPolygons);
        } catch (error) {
            throw new Error(`${label} roof clipping failed: ${error.message}`);
        }
        if (!Array.isArray(clipped)) {
            throw new Error(`${label} roof clipping returned malformed geometry`);
        }
        clipped.forEach((polygon, polygonIndex) => {
            if (!Array.isArray(polygon) || polygon.length < 1) {
                throw new Error(`${label} roof clipping returned malformed polygon ${polygonIndex}`);
            }
            const outer = clipRingToPoints(polygon[0], `${label} clipped polygon ${polygonIndex}`);
            const holes = polygon.slice(1).map((ring, holeIndex) => clipRingToPoints(ring, `${label} clipped polygon ${polygonIndex} hole ${holeIndex}`));
            const triangulation = triangulateSurface(outer, holes);
            if (!triangulation) return;
            for (let index = 0; index < triangulation.indices.length; index += 3) {
                const roofA = interpolateRoofTrianglePoint(triangulation.points[triangulation.indices[index]], a, b, c, label);
                const roofB = interpolateRoofTrianglePoint(triangulation.points[triangulation.indices[index + 1]], a, b, c, label);
                const roofC = interpolateRoofTrianglePoint(triangulation.points[triangulation.indices[index + 2]], a, b, c, label);
                if (triangleArea3d(roofA, roofB, roofC) <= GEOMETRY_EPSILON) continue;
                addTriangle(roofA, roofB, roofC);
            }
        });
    };
    const addTexturedFan = (ring, clipPolygons = []) => {
        const cumulative = ringCumulativeLengths(ring);
        const ringLength = ring.length;
        for (let index = 0; index < ringLength; index++) {
            const next = (index + 1) % ringLength;
            const a = ring[index];
            const b = ring[next];
            const zA = Number.isFinite(Number(a.z)) ? Number(a.z) : rimZ;
            const zB = Number.isFinite(Number(b.z)) ? Number(b.z) : rimZ;
            const uA = cumulative[index] * repeatX;
            const uB = cumulative[index + 1] * repeatX;
            const uCenter = (uA + uB) * 0.5;
            const slopeDistance = Math.hypot(distancePointToLineSegment(peakPoint, a, b), peakHeight);
            const vCenter = Math.max(1, slopeDistance * repeatY);
            const roofA = { x: Number(a.x), y: Number(a.y), z: zA, u: uA, v: 0 };
            const roofB = { x: Number(b.x), y: Number(b.y), z: zB, u: uB, v: 0 };
            const roofPeak = { x: peakPoint.x, y: peakPoint.y, z: rimZ + peakHeight, u: uCenter, v: vCenter };
            if (clipPolygons.length > 0) {
                addClippedRoofTriangle(roofA, roofB, roofPeak, clipPolygons, `roof ${floorId} face ${index}`);
            } else {
                addTriangle(roofA, roofB, roofPeak);
            }
        }
    };

    const outerRing = Math.abs(overhang) > GEOMETRY_EPSILON ? peakRoofEaveRing(floor, contactRing) : contactRing.map((point) => ({ ...point, z: rimZ }));
    if (!Array.isArray(outerRing) || outerRing.length < 3) {
        throw new Error(`roof ${floorId} overhang requires a valid outer ring`);
    }
    const gableGeometries = getRoofGables(floor).map((gable) => ({
        gable,
        geometry: gableWorldGeometry(floor, gable)
    }));
    const roofClipPolygons = gableGeometries
        .filter((entry) => entry.gable.roofReturn === false)
        .map((entry) => gableRoofClipPolygon(floor, entry.geometry, `roof ${floorId} gable ${entry.gable.id}`))
        .filter(Boolean);
    addTexturedFan(outerRing, roofClipPolygons);
    gableGeometries.forEach(({ gable, geometry }) => {
        addGableRoofPatch(geometry, `roof ${floorId} gable ${gable.id}`);
    });
    return { points, indices: new Uint16Array(indices) };
}

function triangulateShedRoof(floor, textureRepeatConfig = null) {
    const floorId = getFloorId(floor);
    const repeatConfig = normalizeRoofTextureRepeatConfig(textureRepeatConfig);
    const repeatX = repeatConfig.repeatsPerMapUnitX;
    const repeatY = repeatConfig.repeatsPerMapUnitY;
    const ring = shedRoofPerimeterRing(floor);
    if (ring.length < 3) return null;
    const triangulation = triangulateSurface(ring, []);
    if (!triangulation) return null;
    const range = shedRoofProjectionRange(floor);
    const slope = roofPeakHeight(floor) / (range.max - range.min);
    const normalLength = Math.hypot(slope * range.direction.x, slope * range.direction.y, 1);
    const normal = {
        x: -slope * range.direction.x / normalLength,
        y: -slope * range.direction.y / normalLength,
        z: 1 / normalLength
    };
    const slopeRunScale = Math.hypot(1, slope);
    const uAxis = {
        x: -range.direction.y,
        y: range.direction.x
    };
    let minU = Infinity;
    triangulation.points.forEach((point) => {
        const uProjection = Number(point.x) * uAxis.x + Number(point.y) * uAxis.y;
        minU = Math.min(minU, uProjection);
    });
    if (!Number.isFinite(minU)) {
        throw new Error(`roof ${floorId} shed texture orientation requires finite roof points`);
    }
    const points = triangulation.points.map((point) => ({
        x: Number(point.x),
        y: Number(point.y),
        z: shedRoofZAt(floor, point, range),
        u: ((Number(point.x) * uAxis.x + Number(point.y) * uAxis.y) - minU) * repeatX,
        v: (range.max - (Number(point.x) * range.direction.x + Number(point.y) * range.direction.y)) * slopeRunScale * repeatY,
        normal
    }));
    return { points, indices: triangulation.indices };
}

function triangulateGabledRoof(floor, textureRepeatConfig = null) {
    const floorId = getFloorId(floor);
    const repeatConfig = normalizeRoofTextureRepeatConfig(textureRepeatConfig);
    const repeatX = repeatConfig.repeatsPerMapUnitX;
    const repeatY = repeatConfig.repeatsPerMapUnitY;
    const ring = shedRoofBaseRing(floor);
    if (ring.length < 3) return null;
    const range = shedRoofProjectionRange(floor);
    const halfRun = (range.max - range.min) * 0.5;
    if (halfRun <= GEOMETRY_EPSILON) {
        throw new Error(`roof ${floorId} gabled direction has no run across the roof polygon`);
    }
    const slope = roofPeakHeight(floor) / halfRun;
    const slopeRunScale = Math.hypot(1, slope);
    const uAxis = {
        x: -range.direction.y,
        y: range.direction.x
    };
    let minU = Infinity;
    ring.forEach((point) => {
        const uProjection = Number(point.x) * uAxis.x + Number(point.y) * uAxis.y;
        minU = Math.min(minU, uProjection);
    });
    if (!Number.isFinite(minU)) {
        throw new Error(`roof ${floorId} gabled texture orientation requires finite roof points`);
    }
    const points = [];
    const indices = [];
    const addSide = (side) => {
        const sideRing = clipRingToRidgeSide(ring, range, side);
        if (sideRing.length < 3) return;
        const triangulation = triangulateSurface(sideRing, []);
        if (!triangulation) return;
        const normalSign = side === "low" ? -1 : 1;
        const normalLength = Math.hypot(slope * range.direction.x, slope * range.direction.y, 1);
        const normal = {
            x: normalSign * slope * range.direction.x / normalLength,
            y: normalSign * slope * range.direction.y / normalLength,
            z: 1 / normalLength
        };
        const start = points.length;
        triangulation.points.forEach((point) => {
            const projection = projectionAlong(point, range.direction);
            points.push({
                x: Number(point.x),
                y: Number(point.y),
                z: gabledRoofZAt(floor, point, range),
                u: ((Number(point.x) * uAxis.x + Number(point.y) * uAxis.y) - minU) * repeatX,
                v: Math.abs(((range.min + range.max) * 0.5) - projection) * slopeRunScale * repeatY,
                normal
            });
        });
        triangulation.indices.forEach((index) => indices.push(start + index));
    };
    addSide("low");
    addSide("high");
    return indices.length >= 3 ? { points, indices: new Uint16Array(indices) } : null;
}

function triangulateDomeRoof(floor, textureRepeatConfig = null) {
    const floorId = getFloorId(floor);
    const repeatConfig = normalizeRoofTextureRepeatConfig(textureRepeatConfig);
    const repeatX = repeatConfig.repeatsPerMapUnitX;
    const repeatY = repeatConfig.repeatsPerMapUnitY;
    const baseRing = domeRoofBaseRing(floor);
    if (baseRing.length < 3) return null;
    const peakHeight = roofPeakHeight(floor);
    if (peakHeight <= GEOMETRY_EPSILON) {
        const triangulation = triangulateSurface(baseRing, []);
        if (!triangulation) return null;
        return {
            points: triangulation.points.map((point) => ({
                x: Number(point.x),
                y: Number(point.y),
                z: roofRenderElevation(floor),
                normal: { x: 0, y: 0, z: 1 }
            })),
            indices: triangulation.indices
        };
    }
    const levels = domeRoofLevelCount(floor);
    const center = polygonCentroid(baseRing);
    const baseZ = roofRenderElevation(floor);
    const points = [];
    const indices = [];
    const ringLength = baseRing.length;
    const rings = [];
    for (let level = 0; level <= levels; level++) {
        const t = level / levels;
        const scale = Math.sqrt(Math.max(0, 1 - t * t));
        const z = baseZ + peakHeight * t;
        rings.push(baseRing.map((point) => ({
            x: Number(center.x) + (Number(point.x) - Number(center.x)) * scale,
            y: Number(center.y) + (Number(point.y) - Number(center.y)) * scale,
            z
        })));
    }
    const pushTriangle = (a, b, c, label) => {
        if (triangleArea3d(a, b, c) <= GEOMETRY_EPSILON) return;
        const normal = triangleSurfaceNormal(a, b, c, label);
        const uvPoints = domeFacetUvPoints(a, b, c, normal, label, repeatX, repeatY);
        const start = points.length;
        points.push(
            { ...uvPoints[0], normal },
            { ...uvPoints[1], normal },
            { ...uvPoints[2], normal }
        );
        indices.push(start, start + 1, start + 2);
    };
    for (let level = 0; level < levels; level++) {
        const lower = rings[level];
        const upper = rings[level + 1];
        const upperCollapsed = level + 1 === levels;
        for (let index = 0; index < ringLength; index++) {
            const next = (index + 1) % ringLength;
            const a = lower[index];
            const b = lower[next];
            const c = upper[next];
            const d = upper[index];
            if (upperCollapsed) {
                const apex = {
                    x: Number(center.x),
                    y: Number(center.y),
                    z: baseZ + peakHeight
                };
                pushTriangle(a, b, apex, `roof ${floorId} dome level ${level} cap ${index}`);
            } else {
                pushTriangle(a, b, c, `roof ${floorId} dome level ${level} face ${index} lower`);
                pushTriangle(a, c, d, `roof ${floorId} dome level ${level} face ${index} upper`);
            }
        }
    }
    return indices.length >= 3 ? { points, indices: new Uint16Array(indices) } : null;
}

function triangulateRoof(floor, textureRepeatConfig = null) {
    if (roofMode(floor) === "shed") return triangulateShedRoof(floor, textureRepeatConfig);
    if (roofMode(floor) === "gabled") return triangulateGabledRoof(floor, textureRepeatConfig);
    if (roofMode(floor) === "dome") return triangulateDomeRoof(floor, textureRepeatConfig);
    if (roofMode(floor) !== "peak") throw new Error(`roof ${getFloorId(floor)} mode ${roofMode(floor)} is not renderable yet`);
    const hasOverhang = Math.abs(roofOverhang(floor)) > GEOMETRY_EPSILON;
    const hasPeak = roofPeakHeight(floor) > GEOMETRY_EPSILON;
    return hasOverhang || hasPeak ? triangulatePitchedRoof(floor, textureRepeatConfig) : triangulateSurface(getRoofContactPolygon(floor), []);
}

function roofMeshSignature(floor, textureRepeatConfig = null) {
    const roof = getFloorRoof(floor);
    if (!roof) return `${getFloorId(floor)};no-roof`;
    return [
        surfaceMeshSignatureFromRings(getFloorId(floor), getRoofContactPolygon(floor), [], roof.texturePath, roofRenderElevation(floor)),
        roofTextureRepeatSignature(textureRepeatConfig),
        String(roof.mode || "peak"),
        `${Number(getRoofPeakPoint(floor).x).toFixed(4)},${Number(getRoofPeakPoint(floor).y).toFixed(4)}`,
        `${Number(getRoofShedDirection(floor).x).toFixed(4)},${Number(getRoofShedDirection(floor).y).toFixed(4)}`,
        Number(roofOverhang(floor)).toFixed(4),
        Number(roofPeakHeight(floor)).toFixed(4),
        Number(getRoofDomeLevels(floor)).toFixed(0),
        getRoofGables(floor).map((gable) => [
            gable.id,
            gable.start && gable.start.edgeIndex,
            Number(gable.start && gable.start.t).toFixed(4),
            gable.end && gable.end.edgeIndex,
            Number(gable.end && gable.end.t).toFixed(4),
            Number(gable.height).toFixed(4),
            gable.roofReturn === false ? "no-return" : "return"
        ].join(",")).join("|")
    ].join(";");
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
    const resolvedGeometry = getWallResolvedGeometry(wall);
    return [
        wall.id,
        getFloorId(floor),
        resolvedGeometry.signature,
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

function polygonClipper(label = "polygon clipping") {
    const clipper = globalThis.polygonClipping;
    if (!clipper || typeof clipper.difference !== "function" || typeof clipper.intersection !== "function") {
        throw new Error(`${label} requires polygon-clipping`);
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
    const points = wallProfilePolygonFromProfile(getWallResolvedGeometry(wall).profile, `wall ${wall && wall.id} resolved footprint`);
    const scale = Number.isFinite(Number(options.thicknessScale)) ? Number(options.thicknessScale) : 1;
    if (scale <= 0) {
        throw new Error(`wall ${wall && wall.id} footprint requires a positive thickness scale`);
    }
    return scale === 1 ? points : scalePolygonAboutCentroid(points, scale, `wall ${wall && wall.id} resolved footprint`);
}

function wallFootprintPolygon(building, wall, floor, options = {}) {
    return [closedClipRing(wallProfilePoints(building, wall, floor, options), `wall ${wall && wall.id} footprint`)];
}

function wallIsOuterPerimeterForFloor(wall, floorId) {
    const attachment = wall && wall.attachment;
    return wall && wall.role === "perimeter" &&
        String(wall.fragmentId || wall.floorId) === floorId &&
        attachment &&
        attachment.kind === "fragmentEdge" &&
        attachment.ring === "outer" &&
        attachment.fragmentId === floorId;
}

function completeUniformPerimeterInsetDistance(floor, wallsForFloor) {
    const floorId = getFloorId(floor);
    const outer = Array.isArray(floor && floor.outerPolygon) ? floor.outerPolygon : [];
    if (outer.length < 3) return null;
    const perimeterWalls = (Array.isArray(wallsForFloor) ? wallsForFloor : [])
        .filter((wall) => wallIsOuterPerimeterForFloor(wall, floorId));
    if (perimeterWalls.length !== outer.length) return null;
    const wallsByEdge = new Map();
    perimeterWalls.forEach((wall) => {
        const attachment = wall.attachment;
        const edgeKey = `${attachment.startVertexId}->${attachment.endVertexId}`;
        if (wallsByEdge.has(edgeKey)) {
            throw new Error(`floor ${floorId} has duplicate perimeter walls for edge ${edgeKey}`);
        }
        wallsByEdge.set(edgeKey, wall);
    });
    let thickness = null;
    for (let index = 0; index < outer.length; index++) {
        const start = outer[index];
        const end = outer[(index + 1) % outer.length];
        if (!start || !start.id || !end || !end.id) {
            throw new Error(`floor ${floorId} perimeter open area requires stable vertex ids`);
        }
        const wall = wallsByEdge.get(`${start.id}->${end.id}`);
        if (!wall) return null;
        const wallThickness = Number(wall.thickness);
        if (!Number.isFinite(wallThickness) || wallThickness <= 0) {
            throw new Error(`floor ${floorId} perimeter wall ${wall.id} requires a positive thickness`);
        }
        if (thickness === null) {
            thickness = wallThickness;
        } else if (Math.abs(thickness - wallThickness) > GEOMETRY_EPSILON) {
            return null;
        }
    }
    return -thickness * (1 + COLLAPSED_WALL_FOOTPRINT_SUBTRACTION_SCALE) * 0.5;
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

function wallTopStations(wall) {
    const profile = wall && wall.topProfile;
    if (profile !== null && profile !== undefined) {
        const stations = Array.isArray(profile.stations) ? profile.stations : null;
        if (!stations || stations.length < 2) {
            throw new Error(`wall ${wall && wall.id} topProfile requires at least two stations`);
        }
        const normalized = stations.map((station, index) => {
            const t = Number(station && station.t);
            const leftHeight = Number(station && station.leftHeight);
            const rightHeight = Number(station && station.rightHeight);
            if (!Number.isFinite(t) || t < 0 || t > 1) {
                throw new Error(`wall ${wall && wall.id} topProfile station ${index} has invalid t`);
            }
            if (!Number.isFinite(leftHeight) || leftHeight < 0 || !Number.isFinite(rightHeight) || rightHeight < 0) {
                throw new Error(`wall ${wall && wall.id} topProfile station ${index} has invalid heights`);
            }
            return { t, leftHeight, rightHeight };
        }).sort((a, b) => a.t - b.t);
        for (let index = 1; index < normalized.length; index++) {
            if (normalized[index].t <= normalized[index - 1].t) {
                throw new Error(`wall ${wall && wall.id} topProfile station t values must be strictly increasing`);
            }
        }
        return normalized;
    }
    const height = Number(wall && wall.height);
    if (!Number.isFinite(height) || height <= 0) {
        throw new Error(`wall ${wall && wall.id} top profile requires a positive height`);
    }
    return [
        { t: 0, leftHeight: height, rightHeight: height },
        { t: 1, leftHeight: height, rightHeight: height }
    ];
}

function wallProfilePointAt(profile, side, t) {
    const clamped = Math.max(0, Math.min(1, Number(t)));
    const start = side === "left" ? profile.aLeft : profile.aRight;
    const end = side === "left" ? profile.bLeft : profile.bRight;
    return {
        x: Number(start.x) + (Number(end.x) - Number(start.x)) * clamped,
        y: Number(start.y) + (Number(end.y) - Number(start.y)) * clamped
    };
}

function wallTopProfilePlane(wall) {
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
        normalized.maxProjection - normalized.minProjection <= GEOMETRY_EPSILON
    ) {
        throw new Error(`wall ${wall && wall.id} generated roof topProfile has an invalid plane`);
    }
    return normalized;
}

function wallTopHeightAt(wall, point, fallbackHeight, bottomZ) {
    const plane = wallTopProfilePlane(wall);
    if (!plane) return fallbackHeight;
    const projection = Number(point.x) * plane.direction.x + Number(point.y) * plane.direction.y;
    const t = (projection - plane.minProjection) / (plane.maxProjection - plane.minProjection);
    const heightZ = plane.mode === "gabled"
        ? plane.baseZ + plane.peakHeight * (1 - Math.abs(2 * t - 1))
        : plane.baseZ + plane.peakHeight * t;
    return Math.max(0, heightZ - bottomZ);
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

function positiveAreaRing(points) {
    const ring = (Array.isArray(points) ? points : [])
        .filter((point) => finite2dPoint(point))
        .map((point) => ({ x: Number(point.x), y: Number(point.y), z: point.z }));
    return polygonSignedArea(ring) < 0 ? ring.reverse() : ring;
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

function stableHashString(value) {
    const text = String(value);
    let hash = 2166136261;
    for (let index = 0; index < text.length; index++) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    hash += hash << 13;
    hash ^= hash >>> 7;
    hash += hash << 3;
    hash ^= hash >>> 17;
    hash += hash << 5;
    return hash >>> 0;
}

function stableUnitRandom(seed) {
    return stableHashString(seed) / 4294967296;
}

function pointSeed(point) {
    return `${Number(point && point.x).toFixed(4)},${Number(point && point.y).toFixed(4)}`;
}

function samePoint(a, b, epsilon = GEOMETRY_EPSILON) {
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
    if (Math.abs(denominator) <= GEOMETRY_EPSILON) return null;
    const acx = cx - ax;
    const acy = cy - ay;
    const t = (acx * cdy - acy * cdx) / denominator;
    return { x: ax + abx * t, y: ay + aby * t };
}

function normalizedTread(tread, label = "stair tread") {
    if (!tread || !finite2dPoint(tread.left) || !finite2dPoint(tread.right)) {
        throw new Error(`${label} requires finite left and right endpoints`);
    }
    const left = { x: Number(tread.left.x), y: Number(tread.left.y) };
    const right = { x: Number(tread.right.x), y: Number(tread.right.y) };
    const length = pointDistance(left, right);
    if (!Number.isFinite(length) || length <= GEOMETRY_EPSILON) {
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

function connectedTreadEndpoint(a, b) {
    const endpoints = [
        { aName: "left", bName: "left", aPoint: a.left, bPoint: b.left, aOther: a.right, bOther: b.right },
        { aName: "left", bName: "right", aPoint: a.left, bPoint: b.right, aOther: a.right, bOther: b.left },
        { aName: "right", bName: "left", aPoint: a.right, bPoint: b.left, aOther: a.left, bOther: b.right },
        { aName: "right", bName: "right", aPoint: a.right, bPoint: b.right, aOther: a.left, bOther: b.left }
    ];
    return endpoints.find((entry) => samePoint(entry.aPoint, entry.bPoint)) || null;
}

function chooseParallelTreadPairing(a, b) {
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
        .filter((entry) => entry.area > GEOMETRY_EPSILON);
    const counts = new Array(sections.length).fill(0);
    if (!active.length) {
        counts[0] = count;
        return counts;
    }
    const totalArea = active.reduce((sum, entry) => sum + entry.area, 0);
    if (count >= active.length) {
        active.forEach((entry) => {
            counts[entry.index] = 1;
        });
        const remaining = count - active.length;
        const extras = active.map((entry) => {
            const exact = remaining * entry.area / totalArea;
            return { ...entry, exact, floor: Math.floor(exact), remainder: exact - Math.floor(exact) };
        });
        let assigned = 0;
        extras.forEach((entry) => {
            counts[entry.index] += entry.floor;
            assigned += entry.floor;
        });
        extras
            .sort((a, b) => b.remainder - a.remainder || b.area - a.area || a.index - b.index)
            .slice(0, remaining - assigned)
            .forEach((entry) => {
                counts[entry.index] += 1;
            });
        return counts;
    }
    const shares = active.map((entry) => {
        const exact = count * entry.area / totalArea;
        return { ...entry, exact, floor: Math.floor(exact), remainder: exact - Math.floor(exact) };
    });
    let assigned = 0;
    shares.forEach((entry) => {
        counts[entry.index] = entry.floor;
        assigned += entry.floor;
    });
    shares
        .sort((a, b) => b.remainder - a.remainder || b.area - a.area || a.index - b.index)
        .slice(0, count - assigned)
        .forEach((entry) => {
            counts[entry.index] += 1;
        });
    return counts;
}

function stairMeshKey(floor, stair) {
    const floorId = getFloorId(floor);
    const stairId = stair && stair.id !== undefined ? String(stair.id) : "new";
    return `${floorId}:${stairId}`;
}

function stairTreadTexturePath(stair) {
    return normalizeTexturePath(stair && (stair.treadTexturePath || stair.texturePath), DEFAULTS.floorTexture);
}

function stairRiserTexturePath(stair) {
    return normalizeTexturePath(stair && (stair.riserTexturePath || stair.texturePath || stair.treadTexturePath), DEFAULTS.floorTexture);
}

function defaultStairRiserDepth(height, stepCount) {
    const resolvedHeight = Number(height);
    const resolvedStepCount = Math.max(1, Math.round(Number(stepCount) || 1));
    if (!Number.isFinite(resolvedHeight) || resolvedHeight <= 0) return 0;
    return Math.min(resolvedHeight, resolvedHeight / (resolvedStepCount + 1) + 0.25);
}

function stairRiserDepth(stair, height, stepCount) {
    if (stair && stair.riserDepth !== null && stair.riserDepth !== undefined && stair.riserDepth !== "") {
        const depth = Number(stair.riserDepth);
        if (!Number.isFinite(depth) || depth < 0) {
            throw new Error(`stair ${stair.id || "(new)"} riser depth must be zero or greater`);
        }
        return Math.min(Number(height), depth);
    }
    return defaultStairRiserDepth(height, stepCount);
}

function stairMeshSignature(floor, stair, treadTextureRepeatConfig = null, riserTextureRepeatConfig = null) {
    const treads = Array.isArray(stair && stair.treads) ? stair.treads : [];
    const treadSignature = treads.map((tread) => [
        Number(tread && tread.left && tread.left.x).toFixed(4),
        Number(tread && tread.left && tread.left.y).toFixed(4),
        Number(tread && tread.right && tread.right.x).toFixed(4),
        Number(tread && tread.right && tread.right.y).toFixed(4)
    ].join(",")).join("|");
    const footprintSignature = Array.isArray(stair && stair.footprint)
        ? stair.footprint.map((point) => `${Number(point.x).toFixed(4)},${Number(point.y).toFixed(4)}`).join("|")
        : "";
    return [
        getFloorId(floor),
        stair && stair.id,
        stair && stair.ladder === true ? "ladder" : "stairs",
        Number(stair && stair.width).toFixed(4),
        Number(stair && stair.stepCount).toFixed(0),
        Number(stair && stair.height).toFixed(4),
        Number(stairRiserDepth(stair, Number(stair && stair.height), Number(stair && stair.stepCount))).toFixed(4),
        Number(stair && stair.bottomZ).toFixed(4),
        stair && stair.direction,
        stairTreadTexturePath(stair),
        stairRiserTexturePath(stair),
        textureRepeatSignature(treadTextureRepeatConfig, FLOOR_TEXTURE_REPEAT),
        textureRepeatSignature(riserTextureRepeatConfig, FLOOR_TEXTURE_REPEAT),
        treadSignature,
        footprintSignature
    ].join(";");
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

function screenPointToClipPoint(point, label = "screen pick point") {
    const x = Number(point && point.x);
    const y = Number(point && point.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new Error(`${label} requires finite screen coordinates`);
    }
    return [x, y];
}

function distanceToClipSegment(point, a, b) {
    const ax = Number(a[0]);
    const ay = Number(a[1]);
    const bx = Number(b[0]);
    const by = Number(b[1]);
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared <= GEOMETRY_EPSILON) return Math.hypot(point[0] - ax, point[1] - ay);
    const t = Math.max(0, Math.min(1, ((point[0] - ax) * dx + (point[1] - ay) * dy) / lengthSquared));
    return Math.hypot(point[0] - (ax + dx * t), point[1] - (ay + dy * t));
}

function pointInClipRing(point, ring, boundaryPixels = 0.75) {
    if (!Array.isArray(ring) || ring.length < 4) {
        throw new Error("screen wall picking requires closed projection rings");
    }
    let inside = false;
    for (let index = 0, previousIndex = ring.length - 1; index < ring.length; previousIndex = index++) {
        const current = ring[index];
        const previous = ring[previousIndex];
        if (!Array.isArray(current) || !Array.isArray(previous)) {
            throw new Error("screen wall picking found a malformed projection ring");
        }
        if (distanceToClipSegment(point, previous, current) <= boundaryPixels) return true;
        const xi = Number(current[0]);
        const yi = Number(current[1]);
        const xj = Number(previous[0]);
        const yj = Number(previous[1]);
        if (![xi, yi, xj, yj].every(Number.isFinite)) {
            throw new Error("screen wall picking found a non-finite projection point");
        }
        const intersects = ((yi > point[1]) !== (yj > point[1])) &&
            (point[0] < ((xj - xi) * (point[1] - yi)) / ((yj - yi) || GEOMETRY_EPSILON) + xi);
        if (intersects) inside = !inside;
    }
    return inside;
}

function pointInClipPolygon(point, polygon) {
    if (!Array.isArray(polygon) || polygon.length === 0) return false;
    if (!pointInClipRing(point, polygon[0])) return false;
    return !polygon.slice(1).some((hole) => pointInClipRing(point, hole, 0));
}

function looksLikeClipRing(value) {
    return Array.isArray(value) &&
        value.length >= 4 &&
        Array.isArray(value[0]) &&
        value[0].length >= 2 &&
        Number.isFinite(Number(value[0][0])) &&
        Number.isFinite(Number(value[0][1]));
}

function looksLikeClipPolygon(value) {
    return Array.isArray(value) && value.length > 0 && looksLikeClipRing(value[0]);
}

function pointInClipGeometry(point, geometry) {
    if (looksLikeClipRing(geometry)) return pointInClipRing(point, geometry);
    if (looksLikeClipPolygon(geometry)) return pointInClipPolygon(point, geometry);
    return (Array.isArray(geometry) ? geometry : []).some((polygon) => {
        if (!looksLikeClipPolygon(polygon)) {
            throw new Error("screen wall picking requires polygon or multipolygon projection geometry");
        }
        return pointInClipPolygon(point, polygon);
    });
}

function clipGeometryRings(geometry, label) {
    if (looksLikeClipRing(geometry)) return [geometry];
    if (looksLikeClipPolygon(geometry)) return geometry;
    return (Array.isArray(geometry) ? geometry : []).flatMap((polygon, polygonIndex) => {
        if (!looksLikeClipPolygon(polygon)) {
            throw new Error(`${label} contains malformed polygon ${polygonIndex}`);
        }
        return polygon;
    });
}

function clipRingCentroid(ring, label) {
    if (!looksLikeClipRing(ring)) {
        throw new Error(`${label} requires a closed screen ring`);
    }
    const points = ring.slice(0, -1);
    const total = points.reduce((acc, point, index) => {
        const x = Number(point[0]);
        const y = Number(point[1]);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            throw new Error(`${label} contains a non-finite point at index ${index}`);
        }
        return { x: acc.x + x, y: acc.y + y };
    }, { x: 0, y: 0 });
    return {
        x: total.x / points.length,
        y: total.y / points.length
    };
}

function debugWallColor(wallId) {
    const numeric = Number(wallId);
    const seed = Number.isFinite(numeric)
        ? numeric
        : String(wallId || "").split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const hue = ((seed * 47) % 360 + 360) % 360;
    const chroma = 0.58;
    const lightness = 0.58;
    const a = chroma * Math.min(lightness, 1 - lightness);
    const f = (n) => {
        const k = (n + hue / 30) % 12;
        return lightness - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    };
    const r = Math.round(f(0) * 255);
    const g = Math.round(f(8) * 255);
    const b = Math.round(f(4) * 255);
    return (r << 16) | (g << 8) | b;
}

function debugSurfaceColor(type, surfaceId) {
    const offset = type === "roof" ? 113 : 29;
    const seed = String(surfaceId || "")
        .split("")
        .reduce((acc, char) => acc + char.charCodeAt(0), offset);
    return debugWallColor(seed);
}

function colorToVec4(color, alpha = 1) {
    const value = Number(color) >>> 0;
    return new Float32Array([
        ((value >> 16) & 255) / 255,
        ((value >> 8) & 255) / 255,
        (value & 255) / 255,
        Math.max(0, Math.min(1, Number(alpha)))
    ]);
}

export class BuildingRenderer {
    static get DEFAULT_CAMERA_PITCH() {
        return CAMERA_DEFAULT_PITCH;
    }

    static clampCameraPitch(value) {
        return clampCameraPitch(value);
    }

    constructor(app, state) {
        if (!globalThis.PIXI) {
            throw new Error("BuildingRenderer requires PIXI to be loaded");
        }
        this.app = app;
        this.state = state;
        this.root = new PIXI.Container();
        this.gridLayer = new PIXI.Container();
        this.gridLayer.name = "buildingEditorGridLayer";
        this.hexGridSpriteLayer = new PIXI.Container();
        this.hexGridSpriteLayer.name = "buildingEditorHexGridSpriteLayer";
        this.hexGridTexture = null;
        this.hexGridSprites = [];
        this.hexGridTextureKey = null;
        this.gridAxisLayer = new PIXI.Graphics();
        this.gridAxisLayer.name = "buildingEditorGridAxisLayer";
        // sprite layer first so axis layer renders on top
        this.gridLayer.addChild(this.hexGridSpriteLayer);
        this.gridLayer.addChild(this.gridAxisLayer);
        this.gridAnchorLayer = new PIXI.Graphics();
        this.buildingUnit = new PIXI.Container();
        this.buildingUnit.name = "buildingEditorGameStyleBuildingUnit";
        this.floorLayer = new PIXI.Graphics();
        this.wallLayer = new PIXI.Graphics();
        this.mountedObjectLayer = new PIXI.Container();
        this.selectionOutlineLayer = new PIXI.Graphics();
        this.handleLayer = new PIXI.Graphics();
        this.draftLayer = new PIXI.Graphics();
        this.playtestLayer = new PIXI.Container();
        this.playtestLayer.name = "buildingEditorPlaytestLayer";
        this.playtestShadowGraphics = new PIXI.Graphics();
        this.playtestShadowGraphics.name = "buildingEditorPlaytestWizardShadow";
        this.playtestHatGraphics = new PIXI.Graphics();
        this.playtestHatGraphics.name = "buildingEditorPlaytestWizardHat";
        this.playtestWizardSprite = null;
        this.playtestWizardDepthMesh = null;
        this.playtestWizardDepthWorldPositions = null;
        this.playtestWizardDepthUvSignature = "";
        this.playtestWizardDepthPositionSignature = "";
        this.playtestWizardSheetTexture = null;
        this.playtestWizardFrames = null;
        this.playtestWizardSheetLoadAttached = false;
        this.playtestFloorSnapshotRenderTexture = null;
        this.playtestFloorSnapshotSprite = null;
        this.playtestFloorSnapshotSize = null;
        this.playtestFloorSnapshot = null;
        this.playtestFloorRenderOverride = null;
        this.playtestLayer.addChild(this.playtestShadowGraphics);
        this.playtestLayer.addChild(this.playtestHatGraphics);
        this.pickerDepthDebugLayer = new PIXI.Container();
        this.pickerDebugLayer = new PIXI.Graphics();
        this.pickerDebugLabels = new PIXI.Container();
        this.floorMeshById = new Map();
        this.roofMeshById = new Map();
        this.stairMeshById = new Map();
        this.gableWallMeshById = new Map();
        this.wallUnitById = new Map();
        this.columnUnitById = new Map();
        this.clippedWallMeshById = new Map();
        this.mountedObjectMeshById = new Map();
        this.mountedObjectPreviewMesh = null;
        const ScenePickerCtor = globalThis.RenderingScenePicker;
        this.scenePicker = (typeof ScenePickerCtor === "function") ? new ScenePickerCtor() : null;
        this.editorPickItemByKey = new Map();
        this.lastGablePickEntries = [];
        this.floorTextureByPath = new Map();
        this.floorDepthState = null;
        this.collapsedWallGeometryByFloorId = new Map();
        this.lastWallPickEntries = [];
        this.lastSurfacePickEntries = [];
        this.lastMountedObjectPickEntries = [];
        this.lastStairPickEntries = [];
        this.floorTextureConfigCache = null;
        this.floorTextureConfigPromise = null;
        this.floorTextureConfigError = "";
        this.roofTextureConfigCache = null;
        this.roofTextureConfigPromise = null;
        this.roofTextureConfigError = "";
        this.screenPickerDebug = false;
        this.screenPickerDebugPoint = null;
        this.root.addChild(
            this.gridLayer,
            this.gridAnchorLayer,
            this.buildingUnit,
            this.floorLayer,
            this.wallLayer,
            this.mountedObjectLayer,
            this.selectionOutlineLayer,
            this.handleLayer,
            this.draftLayer,
            this.playtestLayer,
            this.pickerDepthDebugLayer,
            this.pickerDebugLayer,
            this.pickerDebugLabels
        );
        this.app.stage.addChild(this.root);
        void Promise.all([
            this.ensureFloorTextureConfigLoaded(),
            this.ensureRoofTextureConfigLoaded()
        ]).then(() => {
            if (this.state && typeof this.state.setRenderError === "function") {
                this.render();
            }
        }).catch((error) => {
            console.error(error);
            this.floorTextureConfigError = this.floorTextureConfigError || error.message;
            this.roofTextureConfigError = this.roofTextureConfigError || error.message;
            if (this.state && typeof this.state.setRenderError === "function") {
                this.state.setRenderError(error.message);
            }
        });
    }

    defaultCameraPitch() {
        return CAMERA_DEFAULT_PITCH;
    }

    clampCameraPitch(value) {
        return clampCameraPitch(value);
    }

    editorPickItem(key, type, payload = {}) {
        if (!key) throw new Error("building editor screen picker item requires a key");
        let item = this.editorPickItemByKey.get(key);
        if (!item) {
            item = {
                type: "buildingEditorPickTarget",
                editorPickKey: key,
                editorPickType: type,
                gone: false,
                vanishing: false
            };
            this.editorPickItemByKey.set(key, item);
        }
        item.editorPickType = type;
        item.gone = false;
        item.vanishing = false;
        item.editorPickPayload = payload;
        const floor = payload.floor || null;
        if (floor) {
            const points = Array.isArray(floor.outerPolygon) ? floor.outerPolygon : [];
            const center = points.length > 0
                ? points.reduce((acc, point) => ({
                    x: acc.x + Number(point.x),
                    y: acc.y + Number(point.y)
                }), { x: 0, y: 0 })
                : null;
            if (center) {
                item.x = center.x / points.length;
                item.y = center.y / points.length;
            }
            item.z = getFloorElevation(floor);
        }
        if (payload.object) {
            item.x = Number(payload.object.x) || item.x || 0;
            item.y = Number(payload.object.y) || item.y || 0;
            item.z = Number(payload.object.z) || item.z || 0;
        }
        if (payload.wall) {
            const points = wallPoints(this.state.building, payload.wall);
            if (points.length === 2) {
                item.startPoint = points[0];
                item.endPoint = points[1];
                item.x = (Number(points[0].x) + Number(points[1].x)) * 0.5;
                item.y = (Number(points[0].y) + Number(points[1].y)) * 0.5;
            }
        }
        return item;
    }

    setScreenPickerDebug(enabled) {
        this.screenPickerDebug = !!enabled;
    }

    toggleScreenPickerDebug() {
        this.screenPickerDebug = !this.screenPickerDebug;
        return this.screenPickerDebug;
    }

    setScreenPickerDebugPoint(point) {
        if (!point) {
            this.screenPickerDebugPoint = null;
            return;
        }
        this.screenPickerDebugPoint = {
            x: Number(point.x),
            y: Number(point.y)
        };
        if (!Number.isFinite(this.screenPickerDebugPoint.x) || !Number.isFinite(this.screenPickerDebugPoint.y)) {
            throw new Error("screen picker debug point requires finite screen coordinates");
        }
    }

    render() {
        const errors = validateBuilding(this.state.building);
        if (errors.length) {
            this.state.setRenderError(errors[0]);
        } else {
            this.state.setRenderError("");
        }
        this.drawGrid();
        this.ensurePlaytestFloorSnapshotForCurrentFade();
        this.drawGameStyleBuilding();
        this.drawFloorUnderlay(this.floorLayer);
        this.drawMountedObjects();
        this.renderPlaytestFloorSnapshot();
        this.renderEditorPickPass();
        this.drawScreenPickerDebug(this.lastWallPickEntries);
        this.drawSelectionOutline();
        this.drawHandles();
        this.drawDraft();
        this.drawPlaytestWizard();
        this.drawMountedObjectPreview();
        if (typeof this.app.render === "function") {
            const gl = this.app.renderer && this.app.renderer.gl;
            if (gl) {
                gl.clearDepth(1);
                gl.clear(gl.DEPTH_BUFFER_BIT);
            }
            this.app.render();
        }
    }

    activePlaneZ() {
        if (this.state.tool === "polygon" || this.state.tool === "scissors") {
            return Number(this.state.polygonToolElevation) || 0;
        }
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

    rotateVectorForCamera(vector) {
        const angle = Number(this.state.camera.rotation) || 0;
        const x = Number(vector && vector.x);
        const y = Number(vector && vector.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            throw new Error("camera vector rotation requires finite x/y");
        }
        if (Math.abs(angle) < 0.000001) return { x, y };
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        return {
            x: x * cos - y * sin,
            y: x * sin + y * cos
        };
    }

    sceneLightVectorCamera() {
        return {
            x: -Math.sin(SCENE_LIGHT_TILT_RADIANS),
            y: 0,
            z: Math.cos(SCENE_LIGHT_TILT_RADIANS)
        };
    }

    sceneLightFactorForCameraNormal(normal) {
        const nx = Number(normal && normal.x);
        const ny = Number(normal && normal.y);
        const nz = Number(normal && normal.z);
        const length = Math.hypot(nx, ny, nz);
        if (!Number.isFinite(length) || length <= GEOMETRY_EPSILON) {
            throw new Error("scene lighting requires a non-zero surface normal");
        }
        const light = this.sceneLightVectorCamera();
        const dot = (nx / length) * light.x + (ny / length) * light.y + (nz / length) * light.z;
        const upwardWeight = Math.max(0, Math.min(1, (Math.abs(nz / length) - 0.25) / 0.5));
        const smoothedUpwardWeight = upwardWeight * upwardWeight * (3 - 2 * upwardWeight);
        const overheadBaseline = light.z * smoothedUpwardWeight;
        const factor = 1 + SCENE_LIGHT_DIFFUSE * (dot - overheadBaseline);
        return Math.max(SCENE_LIGHT_MIN, Math.min(SCENE_LIGHT_MAX, factor));
    }

    wallVisibleNormalCamera(wall, floor) {
        const points = wallCenterlinePoints(this.state.building, wall, floor);
        if (points.length !== 2) {
            throw new Error(`wall ${wall && wall.id} lighting requires two centerline points`);
        }
        const dx = Number(points[1].x) - Number(points[0].x);
        const dy = Number(points[1].y) - Number(points[0].y);
        const length = Math.hypot(dx, dy);
        if (!Number.isFinite(length) || length <= GEOMETRY_EPSILON) {
            throw new Error(`wall ${wall && wall.id} lighting requires non-coincident endpoints`);
        }
        let normal = this.rotateVectorForCamera({ x: -dy / length, y: dx / length });
        if (normal.y < 0) normal = { x: -normal.x, y: -normal.y };
        return { x: normal.x, y: normal.y, z: 0 };
    }

    wallSceneBrightnessPercent(wall, floor) {
        const factor = this.sceneLightFactorForCameraNormal(this.wallVisibleNormalCamera(wall, floor));
        return (factor - 1) * 100;
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
        const pitch = cameraPitchProjectionFactors(camera);
        const projectedY = (rotated.y - camera.y) * pitch.floor - (Number(worldZ) - cameraZ) * pitch.height;
        return {
            x: (rotated.x - camera.x) * camera.zoom + this.app.screen.width / 2,
            y: projectedY * camera.zoom * GAME_XY_RATIO + this.app.screen.height / 2
        };
    }

    centerCameraOnWorldPoint(point, worldZ = 0) {
        if (!point || !this.state || !this.state.camera) {
            throw new Error("building editor camera centering requires a point and camera");
        }
        const x = Number(point.x);
        const y = Number(point.y);
        const z = Number(worldZ);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
            throw new Error("building editor camera centering requires finite x/y/z");
        }
        const camera = this.state.camera;
        const cameraZ = Number.isFinite(Number(camera.z)) ? Number(camera.z) : 0;
        const rotated = this.rotatePointForCamera({ x, y });
        const pitch = cameraPitchProjectionFactors(camera);
        if (!(pitch.floor > 0)) {
            throw new Error("building editor camera centering requires a positive floor projection");
        }
        camera.x = rotated.x;
        camera.y = rotated.y - ((z - cameraZ) * pitch.height / pitch.floor);
    }

    screenToWorld(point, worldZ = this.activePlaneZ()) {
        const { camera } = this.state;
        const cameraZ = Number.isFinite(Number(camera.z)) ? Number(camera.z) : 0;
        const pitch = cameraPitchProjectionFactors(camera);
        const projectedY = (point.y - this.app.screen.height / 2) / (camera.zoom * GAME_XY_RATIO);
        const camDz = Number(worldZ) - cameraZ;
        return this.unrotatePointForCamera({
            x: (point.x - this.app.screen.width / 2) / camera.zoom + camera.x,
            y: (projectedY + camDz * pitch.height) / pitch.floor + camera.y
        });
    }

    screenDeltaToWorldDelta(delta) {
        const zoom = Number(this.state.camera.zoom);
        if (!Number.isFinite(zoom) || zoom <= 0) {
            throw new Error("cannot convert screen delta without a positive camera zoom");
        }
        const pitch = cameraPitchProjectionFactors(this.state.camera);
        return {
            x: Number(delta.x) / zoom,
            y: Number(delta.y) / (zoom * GAME_XY_RATIO * pitch.floor)
        };
    }

    screenPixelsToWorldDistance(pixels) {
        const zoom = Number(this.state.camera.zoom);
        if (!Number.isFinite(zoom) || zoom <= 0) {
            throw new Error("cannot convert screen threshold without a positive camera zoom");
        }
        return Number(pixels) / (zoom * GAME_XY_RATIO * cameraPitchProjectionFactors(this.state.camera).floor);
    }

    visibleWorldBounds(worldZ = 0, screenMarginPixels = 0) {
        const width = this.app.screen.width;
        const height = this.app.screen.height;
        const margin = Number.isFinite(Number(screenMarginPixels)) ? Math.max(0, Number(screenMarginPixels)) : 0;
        const corners = [
            this.screenToWorld({ x: -margin, y: -margin }, worldZ),
            this.screenToWorld({ x: width + margin, y: -margin }, worldZ),
            this.screenToWorld({ x: width + margin, y: height + margin }, worldZ),
            this.screenToWorld({ x: -margin, y: height + margin }, worldZ)
        ];
        return corners.reduce((acc, point) => ({
            minX: Math.min(acc.minX, point.x),
            maxX: Math.max(acc.maxX, point.x),
            minY: Math.min(acc.minY, point.y),
            maxY: Math.max(acc.maxY, point.y)
        }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
    }

    drawGrid() {
        const gridZ = this.activePlaneZ();
        const camera = this.state.camera;
        const zoom = Number(camera.zoom);
        if (!Number.isFinite(zoom) || zoom <= 0) return;
        const pitch = cameraPitchProjectionFactors(camera);
        const vy = zoom * GAME_XY_RATIO * pitch.floor;

        if (this.gridAxisLayer && typeof this.gridAxisLayer.clear === "function") {
            this.gridAxisLayer.clear();
            this.gridAxisLayer.visible = true;
        }
        this.gridAnchorLayer.clear();

        if (vy < GRID_HEX_VY_MIN) {
            this._hideHexGridSprites();
            return;
        }

        const bounds = this.visibleWorldBounds(gridZ, GRID_SCREEN_OVERSCAN_PIXELS);
        const topLeft = { x: bounds.minX, y: bounds.minY };
        const bottomRight = { x: bounds.maxX, y: bounds.maxY };


        this._drawHexGridTexture(gridZ, zoom, pitch.floor, Number(camera.rotation) || 0);

        if (!this.state.showSnapAnchors) return;

        const range = visibleHexRange(topLeft, bottomRight);
        const hexCount = (range.maxX - range.minX + 1) * (range.maxY - range.minY + 1);
        if (hexCount > 4000) return;

        const anchors = this.gridAnchorLayer;
        anchors.beginFill(0x607782, 0.5);
        for (let x = range.minX; x <= range.maxX; x++) {
            for (let y = range.minY; y <= range.maxY; y++) {
                const center = this.worldToScreen(offsetToWorld({ x, y }), gridZ);
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
                    const screen = this.worldToScreen({ x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 }, gridZ);
                    anchors.drawCircle(screen.x, screen.y, 0.95);
                });
            }
        }
        anchors.endFill();
    }

    _hideHexGridSprites() {
        for (const spr of this.hexGridSprites) {
            if (spr) spr.visible = false;
        }
    }

    _drawHexGridTexture(gridZ, zoom, pf, rotation) {
        const cosA = Math.cos(rotation);
        const sinA = Math.sin(rotation);
        const vy = zoom * GAME_XY_RATIO * pf;
        const screenH = this.app.screen.height;
        const screenW = this.app.screen.width;

        const TILE_COLS = GRID_HEX_TILE_COLS;
        const TILE_ROWS = Math.max(10, Math.min(GRID_HEX_TILE_ROWS_MAX,
            Math.ceil(screenH / (GRID_HEX_TILE_SPRITES * vy))));

        // Screen-space period vectors for the hex tile
        // v1 = screen delta for one tile-width in world X (TILE_COLS * 0.866)
        const v1x = TILE_COLS * GAME_HEX_X_STEP * cosA * zoom;
        const v1y = TILE_COLS * GAME_HEX_X_STEP * sinA * vy;
        // v2 = screen delta for one tile-height in world Y (TILE_ROWS)
        const v2x = -TILE_ROWS * sinA * zoom;
        const v2y = TILE_ROWS * cosA * vy;

        // Bounding box of the parallelogram — guarantees rectangular sprites tile
        // without visible gaps when placed at parallelogram lattice positions
        const xMin = Math.min(0, v1x, v2x, v1x + v2x);
        const xMax = Math.max(0, v1x, v2x, v1x + v2x);
        const yMin = Math.min(0, v1y, v2y, v1y + v2y);
        const yMax = Math.max(0, v1y, v2y, v1y + v2y);
        const texW = Math.ceil(xMax - xMin) + 1;
        const texH = Math.ceil(yMax - yMin) + 1;

        // Extremely flat pitch + rotation produces enormous bounding-box textures; skip rather than OOM
        if (texW > 2048 || texH > 2048) { this._hideHexGridSprites(); return; }

        const key = `${zoom.toFixed(2)},${pf.toFixed(5)},${rotation.toFixed(5)},${TILE_ROWS}`;
        if (key !== this.hexGridTextureKey || !this.hexGridTexture) {
            this._buildHexGridTexture(TILE_COLS, TILE_ROWS, zoom, pf, cosA, sinA, xMin, yMin, texW, texH);
            this.hexGridTextureKey = key;
        }

        // Anchor: align to the tile containing the screen center, then iterate
        // symmetrically so that camera rotation never leaves part of the screen uncovered.
        const centerWorld = this.screenToWorld({ x: screenW / 2, y: screenH / 2 }, gridZ);
        const tileColIdx = Math.floor(centerWorld.x / (TILE_COLS * GAME_HEX_X_STEP));
        const tileRowIdx = Math.floor(centerWorld.y / TILE_ROWS);
        const refWorldX = tileColIdx * TILE_COLS * GAME_HEX_X_STEP;
        const refWorldY = tileRowIdx * TILE_ROWS;
        const refScreen = this.worldToScreen({ x: refWorldX, y: refWorldY }, gridZ);
        // refScreen is the screen position of the tile's reference world point.
        // In the texture, that point sits at pixel (-xMin, -yMin), so the
        // sprite's top-left is refScreen offset by (xMin, yMin).
        const startX = refScreen.x + xMin;
        const startY = refScreen.y + yMin;

        let idx = 0;
        const half = Math.floor(GRID_HEX_TILE_SPRITES / 2);
        for (let j = -half; j <= half; j++) {
            for (let i = -half; i <= half; i++) {
                const sx = startX + i * v1x + j * v2x;
                const sy = startY + i * v1y + j * v2y;
                if (sx + texW < 0 || sx > screenW || sy + texH < 0 || sy > screenH) continue;
                let spr = this.hexGridSprites[idx];
                if (!spr) {
                    spr = new PIXI.Sprite(this.hexGridTexture);
                    spr.name = "buildingEditorHexGridTile";
                    spr.anchor.set(0, 0);
                    spr.interactive = false;
                    this.hexGridSpriteLayer.addChild(spr);
                    this.hexGridSprites[idx] = spr;
                }
                if (spr.texture !== this.hexGridTexture) spr.texture = this.hexGridTexture;
                spr.x = sx;
                spr.y = sy;
                spr.visible = true;
                idx++;
            }
        }
        for (; idx < this.hexGridSprites.length; idx++) {
            if (this.hexGridSprites[idx]) this.hexGridSprites[idx].visible = false;
        }
    }

    _buildHexGridTexture(TILE_COLS, TILE_ROWS, zoom, pf, cosA, sinA, xMin, yMin, texW, texH) {
        const scaleX = zoom;
        const scaleY = zoom * GAME_XY_RATIO * pf;
        // Extra hex columns/rows to fill parallelogram corners; capped so iteration stays O(TILE_COLS²)
        const extraCols = Math.min(TILE_COLS, Math.ceil(Math.abs(TILE_ROWS * sinA / GAME_HEX_X_STEP))) + 2;
        const extraRows = Math.min(TILE_ROWS, Math.ceil(Math.abs(TILE_COLS * GAME_HEX_X_STEP * sinA))) + 2;
        const hexBound = Math.max(scaleX * GAME_HEX_RADIUS, scaleY * 0.5) + 2;

        const gfx = new PIXI.Graphics();
        gfx.lineStyle(1, 0x263640, 0.58);

        for (let col = -extraCols; col < TILE_COLS + extraCols; col++) {
            const worldX = col * GAME_HEX_X_STEP;
            for (let row = -extraRows; row < TILE_ROWS + extraRows; row++) {
                const worldY = row + (col % 2 === 0 ? 0.5 : 0);
                const cx = (worldX * cosA - worldY * sinA) * scaleX - xMin;
                const cy = (worldX * sinA + worldY * cosA) * scaleY - yMin;
                if (cx + hexBound < 0 || cx - hexBound > texW || cy + hexBound < 0 || cy - hexBound > texH) continue;
                const corners = hexCorners({ x: worldX, y: worldY });
                gfx.moveTo(
                    (corners[0].x * cosA - corners[0].y * sinA) * scaleX - xMin,
                    (corners[0].x * sinA + corners[0].y * cosA) * scaleY - yMin
                );
                for (let k = 1; k < corners.length; k++) {
                    gfx.lineTo(
                        (corners[k].x * cosA - corners[k].y * sinA) * scaleX - xMin,
                        (corners[k].x * sinA + corners[k].y * cosA) * scaleY - yMin
                    );
                }
                gfx.closePath();
            }
        }

        const tex = this.app.renderer.generateTexture(gfx, {
            region: new PIXI.Rectangle(0, 0, texW, texH),
            resolution: 1,
        });
        gfx.destroy(true);
        if (this.hexGridTexture) this.hexGridTexture.destroy(true);
        this.hexGridTexture = tex;
    }

    drawAxes(gfx, topLeft, bottomRight, worldZ = 0) {
        gfx.lineStyle(1, 0x52616b, 0.36);
        const xAxisA = this.worldToScreen({ x: topLeft.x, y: 0 }, worldZ);
        const xAxisB = this.worldToScreen({ x: bottomRight.x, y: 0 }, worldZ);
        const yAxisA = this.worldToScreen({ x: 0, y: topLeft.y }, worldZ);
        const yAxisB = this.worldToScreen({ x: 0, y: bottomRight.y }, worldZ);
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
        const pitch = cameraPitchProjectionFactors(camera);
        return {
            x: Number(camera.x) - this.app.screen.width / (2 * zoom),
            y: Number(camera.y) - this.app.screen.height / (2 * zoom * GAME_XY_RATIO * pitch.floor),
            z: Number.isFinite(Number(camera.z)) ? Number(camera.z) : 0,
            viewscale: zoom,
            xyratio: GAME_XY_RATIO,
            pitch: pitch.pitch,
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

    createSolidDepthMesh(name, positions, indices, color, depthBias = PICKER_DEBUG_DEPTH_BIAS) {
        if (!PIXI.Geometry || !PIXI.Shader || !PIXI.Mesh) {
            throw new Error("screen picker depth debug requires PIXI Geometry, Shader, and Mesh");
        }
        if (!(positions instanceof Float32Array) || positions.length < 9 || positions.length % 3 !== 0) {
            throw new Error(`screen picker depth debug mesh ${name} requires finite 3D positions`);
        }
        if (!(indices instanceof Uint16Array) && !(indices instanceof Uint32Array)) {
            throw new Error(`screen picker depth debug mesh ${name} requires typed triangle indices`);
        }
        const shader = PIXI.Shader.from(SOLID_DEPTH_VS, SOLID_DEPTH_FS, {
            uScreenSize: new Float32Array([1, 1]),
            uCameraWorld: new Float32Array([0, 0]),
            uCameraZ: 0,
            uViewScale: 1,
            uXyRatio: GAME_XY_RATIO,
            uCameraPitch: CAMERA_DEFAULT_PITCH,
            uDepthRange: new Float32Array([
                FLOOR_DEPTH_FAR_METRIC,
                1 / Math.max(1e-6, FLOOR_DEPTH_FAR_METRIC - FLOOR_DEPTH_NEAR_METRIC)
            ]),
            uDepthBias: Number(depthBias),
            uCameraRotation: 0,
            uCameraRotationCenter: new Float32Array([0, 0]),
            uColor: colorToVec4(color, 1)
        });
        const geometry = new PIXI.Geometry()
            .addAttribute("aWorldPosition", positions, 3)
            .addAttribute("aUvs", new Float32Array((positions.length / 3) * 2), 2)
            .addIndex(indices);
        const mesh = new PIXI.Mesh(geometry, shader, this.getFloorDepthState() || undefined, PIXI.DRAW_MODES.TRIANGLES);
        mesh.name = name;
        mesh.interactive = false;
        mesh.visible = true;
        this.updateSolidDepthMeshUniforms(mesh, depthBias);
        return mesh;
    }

    updateSolidDepthMeshUniforms(mesh, depthBias = PICKER_DEBUG_DEPTH_BIAS) {
        if (!mesh || !mesh.shader || !mesh.shader.uniforms) {
            throw new Error("missing screen picker depth debug mesh uniforms");
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
        u.uCameraPitch = cameraPitch(this.state.camera);
        u.uDepthRange[0] = FLOOR_DEPTH_FAR_METRIC;
        u.uDepthRange[1] = 1 / Math.max(1e-6, FLOOR_DEPTH_FAR_METRIC - FLOOR_DEPTH_NEAR_METRIC);
        u.uDepthBias = Number(depthBias);
        u.uCameraRotation = Number(this.state.camera.rotation) || 0;
        const rotationCenter = this.state.camera.rotationCenter || this.state.buildingCenter();
        u.uCameraRotationCenter[0] = Number(rotationCenter.x) || 0;
        u.uCameraRotationCenter[1] = Number(rotationCenter.y) || 0;
    }

    getFloorTexture(texturePath) {
        return this.getSurfaceTexture(texturePath, DEFAULTS.floorTexture);
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

    buildTextureConfigMaps(doc, label, fallbackRepeat) {
        if (!doc || typeof doc !== "object") {
            throw new Error(`${label} texture manifest must be an object`);
        }
        const defaults = doc.defaults && typeof doc.defaults === "object" ? doc.defaults : {};
        const defaultRepeat = normalizeTextureRepeatConfig(defaults, fallbackRepeat);
        const cfg = {
            byPath: new Map(),
            byFile: new Map(),
            defaultRepeatX: defaultRepeat.repeatsPerMapUnitX,
            defaultRepeatY: defaultRepeat.repeatsPerMapUnitY
        };
        const items = Array.isArray(doc.items) ? doc.items : [];
        if (!items.length) throw new Error(`${label} texture manifest is empty`);
        items.forEach((item, index) => {
            if (!item || typeof item !== "object") {
                throw new Error(`${label} texture manifest item ${index} must be an object`);
            }
            const texturePath = normalizeTextureConfigPath(item.texturePath);
            if (!texturePath) throw new Error(`${label} texture manifest item ${index} is missing texturePath`);
            const fallbackRepeat = Number.isFinite(Number(item.repeatsPerMapUnit))
                ? Math.max(0.0001, Number(item.repeatsPerMapUnit))
                : null;
            const repeatsPerMapUnitX = Number.isFinite(Number(item.repeatsPerMapUnitX))
                ? Math.max(0.0001, Number(item.repeatsPerMapUnitX))
                : (fallbackRepeat || cfg.defaultRepeatX);
            const repeatsPerMapUnitY = Number.isFinite(Number(item.repeatsPerMapUnitY))
                ? Math.max(0.0001, Number(item.repeatsPerMapUnitY))
                : (fallbackRepeat || cfg.defaultRepeatY);
            const entry = { texturePath, repeatsPerMapUnitX, repeatsPerMapUnitY };
            cfg.byPath.set(texturePath, entry);
            const file = typeof item.file === "string" && item.file.length > 0
                ? item.file.toLowerCase()
                : "";
            if (file) cfg.byFile.set(file, entry);
            const textureFile = (texturePath.split("/").pop() || "").toLowerCase();
            if (textureFile) cfg.byFile.set(textureFile, entry);
        });
        return cfg;
    }

    buildRoofTextureConfigMaps(doc) {
        return this.buildTextureConfigMaps(doc, "roof", DEFAULT_ROOF_TEXTURE_REPEAT);
    }

    buildFloorTextureConfigMaps(doc) {
        return this.buildTextureConfigMaps(doc, "floor", FLOOR_TEXTURE_REPEAT);
    }

    ensureFloorTextureConfigLoaded() {
        if (this.floorTextureConfigCache) return Promise.resolve(this.floorTextureConfigCache);
        if (this.floorTextureConfigPromise) return this.floorTextureConfigPromise;
        if (typeof fetch !== "function" || typeof window === "undefined" || !window.location) {
            this.floorTextureConfigCache = {
                byPath: new Map(),
                byFile: new Map(),
                defaultRepeatX: FLOOR_TEXTURE_REPEAT,
                defaultRepeatY: FLOOR_TEXTURE_REPEAT
            };
            return Promise.resolve(this.floorTextureConfigCache);
        }
        this.floorTextureConfigError = "";
        this.floorTextureConfigPromise = fetch(FLOOR_TEXTURE_CONFIG_URL, { cache: "no-cache" })
            .then((response) => {
                if (!response || !response.ok) {
                    throw new Error("could not load floor texture manifest");
                }
                return response.json();
            })
            .then((doc) => {
                this.floorTextureConfigCache = this.buildFloorTextureConfigMaps(doc);
                this.floorTextureConfigError = "";
                return this.floorTextureConfigCache;
            })
            .catch((error) => {
                this.floorTextureConfigError = error.message;
                throw error;
            })
            .finally(() => {
                this.floorTextureConfigPromise = null;
            });
        return this.floorTextureConfigPromise;
    }

    ensureRoofTextureConfigLoaded() {
        if (this.roofTextureConfigCache) return Promise.resolve(this.roofTextureConfigCache);
        if (this.roofTextureConfigPromise) return this.roofTextureConfigPromise;
        if (typeof fetch !== "function" || typeof window === "undefined" || !window.location) {
            this.roofTextureConfigCache = {
                byPath: new Map(),
                byFile: new Map(),
                defaultRepeatX: DEFAULT_ROOF_TEXTURE_REPEAT,
                defaultRepeatY: DEFAULT_ROOF_TEXTURE_REPEAT
            };
            return Promise.resolve(this.roofTextureConfigCache);
        }
        this.roofTextureConfigError = "";
        this.roofTextureConfigPromise = fetch(ROOF_TEXTURE_CONFIG_URL, { cache: "no-cache" })
            .then((response) => {
                if (!response || !response.ok) {
                    throw new Error("could not load roof texture manifest");
                }
                return response.json();
            })
            .then((doc) => {
                this.roofTextureConfigCache = this.buildRoofTextureConfigMaps(doc);
                this.roofTextureConfigError = "";
                return this.roofTextureConfigCache;
            })
            .catch((error) => {
                this.roofTextureConfigError = error.message;
                throw error;
            })
            .finally(() => {
                this.roofTextureConfigPromise = null;
            });
        return this.roofTextureConfigPromise;
    }

    textureRepeatConfigFromCache(texturePath, fallbackTexturePath, cache, fallbackRepeat) {
        const normalized = normalizeTextureConfigPath(normalizeTexturePath(texturePath, fallbackTexturePath));
        const file = (normalized.split("/").pop() || "").toLowerCase();
        const entry = (cache && cache.byPath && cache.byPath.get(normalized)) ||
            (cache && cache.byFile && cache.byFile.get(file)) ||
            null;
        return {
            texturePath: entry && entry.texturePath ? entry.texturePath : normalized,
            repeatsPerMapUnitX: entry && Number.isFinite(Number(entry.repeatsPerMapUnitX))
                ? Math.max(0.0001, Number(entry.repeatsPerMapUnitX))
                : (cache && Number.isFinite(Number(cache.defaultRepeatX)) ? Number(cache.defaultRepeatX) : fallbackRepeat),
            repeatsPerMapUnitY: entry && Number.isFinite(Number(entry.repeatsPerMapUnitY))
                ? Math.max(0.0001, Number(entry.repeatsPerMapUnitY))
                : (cache && Number.isFinite(Number(cache.defaultRepeatY)) ? Number(cache.defaultRepeatY) : fallbackRepeat)
        };
    }

    floorTextureRepeatConfig(texturePath) {
        if (this.floorTextureConfigError) {
            throw new Error(this.floorTextureConfigError);
        }
        if (!this.floorTextureConfigCache) {
            void this.ensureFloorTextureConfigLoaded();
        }
        return this.textureRepeatConfigFromCache(
            texturePath,
            DEFAULTS.floorTexture,
            this.floorTextureConfigCache || null,
            FLOOR_TEXTURE_REPEAT
        );
    }

    roofTextureRepeatConfig(texturePath) {
        if (this.roofTextureConfigError) {
            throw new Error(this.roofTextureConfigError);
        }
        if (!this.roofTextureConfigCache) {
            void this.ensureRoofTextureConfigLoaded();
        }
        return this.textureRepeatConfigFromCache(
            texturePath,
            "/assets/images/roofs/slate.png",
            this.roofTextureConfigCache || null,
            DEFAULT_ROOF_TEXTURE_REPEAT
        );
    }

    createSurfaceMesh(floor, triangulation, options = {}) {
        if (!triangulation || !triangulation.points || triangulation.points.length < 3) return null;
        const z = Number(options.z);
        if (!Number.isFinite(z)) throw new Error(`cannot create surface mesh for ${getFloorId(floor)} without finite z`);
        const texturePath = normalizeTexturePath(options.texturePath, options.textureFallback);
        const textureRepeat = Number.isFinite(Number(options.textureRepeat)) ? Number(options.textureRepeat) : FLOOR_TEXTURE_REPEAT;
        const textureRepeatX = Number.isFinite(Number(options.textureRepeatX))
            ? Math.max(0.0001, Number(options.textureRepeatX))
            : textureRepeat;
        const textureRepeatY = Number.isFinite(Number(options.textureRepeatY))
            ? Math.max(0.0001, Number(options.textureRepeatY))
            : textureRepeat;
        const positions = new Float32Array(triangulation.points.length * 3);
        const normals = new Float32Array(triangulation.points.length * 3);
        const uvs = new Float32Array(triangulation.points.length * 2);
        triangulation.points.forEach((point, index) => {
            const pointZ = Number.isFinite(Number(point.z)) ? Number(point.z) : z;
            positions[index * 3] = Number(point.x);
            positions[index * 3 + 1] = Number(point.y);
            positions[index * 3 + 2] = pointZ;
            const normal = point.normal || { x: 0, y: 0, z: 1 };
            normals[index * 3] = Number.isFinite(Number(normal.x)) ? Number(normal.x) : 0;
            normals[index * 3 + 1] = Number.isFinite(Number(normal.y)) ? Number(normal.y) : 0;
            normals[index * 3 + 2] = Number.isFinite(Number(normal.z)) ? Number(normal.z) : 1;
            const hasCustomUv = Number.isFinite(Number(point.u)) && Number.isFinite(Number(point.v));
            uvs[index * 2] = hasCustomUv ? Number(point.u) : Number(point.x) * textureRepeatX;
            uvs[index * 2 + 1] = hasCustomUv ? Number(point.v) : Number(point.y) * textureRepeatY;
        });
        const geometry = new PIXI.Geometry()
            .addAttribute("aWorldPosition", positions, 3)
            .addAttribute("aWorldNormal", normals, 3)
            .addAttribute("aUvs", uvs, 2)
            .addIndex(triangulation.indices);
        const shader = PIXI.Shader.from(FLOOR_DEPTH_VS, FLOOR_DEPTH_FS, {
            uScreenSize: new Float32Array([1, 1]),
            uCameraWorld: new Float32Array([0, 0]),
            uCameraZ: 0,
            uViewScale: 1,
            uXyRatio: GAME_XY_RATIO,
            uCameraPitch: CAMERA_DEFAULT_PITCH,
            uDepthRange: new Float32Array([
                FLOOR_DEPTH_FAR_METRIC,
                1 / Math.max(1e-6, FLOOR_DEPTH_FAR_METRIC - FLOOR_DEPTH_NEAR_METRIC)
            ]),
            uDepthBias: FLOOR_DEPTH_BIAS,
            uCameraRotation: 0,
            uCameraRotationCenter: new Float32Array([0, 0]),
            uLightVector: new Float32Array([0, 0, 1]),
            uLightDiffuse: SCENE_LIGHT_DIFFUSE,
            uLightClamp: new Float32Array([SCENE_LIGHT_MIN, SCENE_LIGHT_MAX]),
            uOverheadSlopeLighting: 0,
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

    createFloorMesh(floor, triangulation, textureRepeatConfig = null) {
        const repeatConfig = normalizeTextureRepeatConfig(textureRepeatConfig, FLOOR_TEXTURE_REPEAT);
        return this.createSurfaceMesh(floor, triangulation, {
            z: getFloorElevation(floor),
            texturePath: floor.floorTexturePath,
            textureFallback: DEFAULTS.floorTexture,
            textureRepeatX: repeatConfig.repeatsPerMapUnitX,
            textureRepeatY: repeatConfig.repeatsPerMapUnitY,
            namePrefix: "buildingEditorFloorMesh"
        });
    }

    createRoofMesh(floor, triangulation, textureRepeatConfig = null) {
        const repeatConfig = normalizeRoofTextureRepeatConfig(textureRepeatConfig);
        return this.createSurfaceMesh(floor, triangulation, {
            z: roofRenderElevation(floor),
            texturePath: roofTexturePath(floor),
            textureFallback: "/assets/images/roofs/slate.png",
            textureRepeatX: repeatConfig.repeatsPerMapUnitX,
            textureRepeatY: repeatConfig.repeatsPerMapUnitY,
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
        u.uCameraPitch = cameraPitch(this.state.camera);
        u.uCameraRotation = Number(this.state.camera.rotation) || 0;
        const rotationCenter = this.state.camera.rotationCenter || this.state.buildingCenter();
        u.uCameraRotationCenter[0] = Number(rotationCenter.x) || 0;
        u.uCameraRotationCenter[1] = Number(rotationCenter.y) || 0;
        const light = this.sceneLightVectorCamera();
        u.uLightVector[0] = light.x;
        u.uLightVector[1] = light.y;
        u.uLightVector[2] = light.z;
        u.uLightDiffuse = SCENE_LIGHT_DIFFUSE;
        u.uLightClamp[0] = SCENE_LIGHT_MIN;
        u.uLightClamp[1] = SCENE_LIGHT_MAX;
        u.uSampler = this.getSurfaceTexture(options.texturePath, options.textureFallback);
        const lightFactor = Number.isFinite(Number(options.lightFactor))
            ? Math.max(SCENE_LIGHT_MIN, Math.min(SCENE_LIGHT_MAX, Number(options.lightFactor)))
            : 1;
        const overheadSlopeLighting = Number.isFinite(Number(options.overheadSlopeLighting))
            ? Number(options.overheadSlopeLighting)
            : (options.overheadSlopeLighting === true ? 1 : 0);
        u.uOverheadSlopeLighting = Math.max(0, Math.min(1, overheadSlopeLighting));
        u.uTint[0] = lightFactor;
        u.uTint[1] = lightFactor;
        u.uTint[2] = lightFactor;
        u.uTint[3] = Math.max(0, Math.min(1, Number(alpha)));
        mesh.visible = true;
    }

    updateFloorMeshUniforms(mesh, floor, alpha) {
        this.updateSurfaceMeshUniforms(mesh, floor, alpha, {
            texturePath: floor.floorTexturePath,
            textureFallback: DEFAULTS.floorTexture
        });
    }

    updateRoofMeshUniforms(mesh, floor, alpha) {
        this.updateSurfaceMeshUniforms(mesh, floor, alpha, {
            texturePath: roofTexturePath(floor),
            textureFallback: "/assets/images/roofs/slate.png",
            overheadSlopeLighting: ROOF_OVERHEAD_SLOPE_LIGHTING
        });
    }

    stairOpeningStepPolygonsForFloor(stair, floor) {
        const floorZ = getFloorElevation(floor);
        const bottomZ = Number(stair && stair.bottomZ);
        const height = Number(stair && stair.height);
        if (!Number.isFinite(bottomZ) || !Number.isFinite(height) || height <= 0) {
            throw new Error(`stair ${stair && stair.id ? stair.id : "(new)"} needs finite elevation data for floor opening`);
        }
        const topZ = String(stair.direction || "up") === "down" ? bottomZ : bottomZ + height;
        if (Math.abs(topZ - floorZ) > GEOMETRY_EPSILON) return [];
        const thresholdZ = floorZ - 2;
        return this.stairStepPolygons(stair)
            .filter((step) => Number(step.z) >= thresholdZ - GEOMETRY_EPSILON && Number(step.z) <= floorZ + GEOMETRY_EPSILON)
            .map((step) => positiveAreaRing(step.polygon));
    }

    stairOpeningClipGeometryForFloor(stair, floor, label = "stair floor opening") {
        const openingPolygons = this.stairOpeningStepPolygonsForFloor(stair, floor)
            .map((polygon, index) => [closedClipRing(polygon, `${label} step ${index}`)]);
        if (!openingPolygons.length) return [];
        const clipper = polygonClipper(label);
        const union = clipper.union(...openingPolygons);
        if (!Array.isArray(union) || union.length === 0) return [];
        const floorPolygon = this.floorClipPolygon(floor, `${label} floor ${getFloorId(floor)}`);
        const clipped = clipper.intersection(union, [floorPolygon]);
        return Array.isArray(clipped) ? clipped : [];
    }

    floorClipPolygon(floor, label = `floor ${getFloorId(floor)} polygon`) {
        return [
            closedClipRing(floor.outerPolygon, `${label} outer`),
            ...(Array.isArray(floor.holes) ? floor.holes : [])
                .map((ring, index) => closedClipRing(ring, `${label} hole ${index}`))
        ];
    }

    stairOpeningIntersectsFloor(stair, floor) {
        return clipGeometryArea(this.stairOpeningClipGeometryForFloor(
            stair,
            floor,
            `stair ${stair && stair.id ? stair.id : "(new)"} render visibility`
        )) > GEOMETRY_EPSILON;
    }

    stairOpeningHolesForFloor(floor) {
        const openingPolygons = [];
        getBuildingFloors(this.state.building).forEach((sourceFloor) => {
            getFloorStairs(sourceFloor).forEach((stair) => {
                this.stairOpeningStepPolygonsForFloor(stair, floor).forEach((polygon, index) => {
                    openingPolygons.push([closedClipRing(polygon, `stair ${stair.id} opening step ${index}`)]);
                });
            });
        });
        if (!openingPolygons.length) return [];
        const clipper = polygonClipper("stair floor openings");
        const union = clipper.union(...openingPolygons);
        if (!Array.isArray(union) || union.length === 0) return [];
        const floorPolygon = this.floorClipPolygon(floor, `floor ${getFloorId(floor)} stair opening clip`);
        const clipped = clipper.intersection(union, [floorPolygon]);
        return (Array.isArray(clipped) ? clipped : [])
            .map((polygon, index) => {
                if (!Array.isArray(polygon) || !Array.isArray(polygon[0])) {
                    throw new Error(`stair floor opening union produced malformed polygon ${index}`);
                }
                return clipRingToPoints(polygon[0], `stair floor opening ${getFloorId(floor)} polygon ${index}`);
            })
            .filter((ring) => ring.length >= 3 && Math.abs(polygonSignedArea(ring)) > GEOMETRY_EPSILON);
    }

    floorSurfaceHoles(floor) {
        const staticHoles = (Array.isArray(floor && floor.holes) ? floor.holes : [])
            .filter((ring) => Array.isArray(ring) && ring.length >= 3);
        return [...staticHoles, ...this.stairOpeningHolesForFloor(floor)];
    }

    syncFloorMesh(floor, alpha) {
        const floorId = getFloorId(floor);
        const holeRings = this.floorSurfaceHoles(floor);
        const textureRepeatConfig = this.floorTextureRepeatConfig(floor.floorTexturePath);
        const signature = `${surfaceMeshSignatureFromRings(floorId, floor.outerPolygon || [], holeRings, floor.floorTexturePath, getFloorElevation(floor))};${textureRepeatSignature(textureRepeatConfig, FLOOR_TEXTURE_REPEAT)}`;
        let entry = this.floorMeshById.get(floorId);
        if (!entry || entry.signature !== signature) {
            if (entry && entry.mesh) {
                if (entry.mesh.parent) entry.mesh.parent.removeChild(entry.mesh);
                entry.mesh.destroy({ children: false, texture: false, baseTexture: false });
            }
            const triangulation = triangulateSurface(floor && floor.outerPolygon, holeRings);
            if (!triangulation) return null;
            const mesh = this.createFloorMesh(floor, triangulation, textureRepeatConfig);
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

    syncRoofMesh(floor, alpha, roof = null) {
        const roofView = floorRoofView(floor, roof);
        const key = roofMeshKey(floor, roof || getFloorRoof(roofView));
        if (!getFloorRoof(roofView)) {
            const entry = this.roofMeshById.get(key);
            if (entry && entry.mesh) entry.mesh.visible = false;
            return null;
        }
        const textureRepeatConfig = this.roofTextureRepeatConfig(roofTexturePath(roofView));
        const signature = roofMeshSignature(roofView, textureRepeatConfig);
        let entry = this.roofMeshById.get(key);
        if (!entry || entry.signature !== signature) {
            if (entry && entry.mesh) {
                if (entry.mesh.parent) entry.mesh.parent.removeChild(entry.mesh);
                entry.mesh.destroy({ children: false, texture: false, baseTexture: false });
            }
            const triangulation = triangulateRoof(roofView, textureRepeatConfig);
            if (!triangulation) return null;
            const mesh = this.createRoofMesh(roofView, triangulation, textureRepeatConfig);
            if (!mesh) return null;
            this.buildingUnit.addChild(mesh);
            entry = { signature, mesh };
            this.roofMeshById.set(key, entry);
        } else if (entry.mesh.parent !== this.buildingUnit) {
            this.buildingUnit.addChild(entry.mesh);
        }
        this.updateRoofMeshUniforms(entry.mesh, roofView, alpha);
        return entry.mesh;
    }

    stairSectionBetweenTreads(previousTread, nextTread, label = "stair section") {
        const previous = normalizedTread(previousTread, `${label} previous tread`);
        const next = normalizedTread(nextTread, `${label} next tread`);
        const directionCross = Math.sin(next.angle - previous.angle);
        if (Math.abs(directionCross) <= GEOMETRY_EPSILON) {
            const paired = chooseParallelTreadPairing(previous, next);
            const ring = positiveAreaRing([
                paired.side0Start,
                paired.side0End,
                paired.side1End,
                paired.side1Start
            ]);
            const area = Math.abs(polygonSignedArea(ring));
            return {
                kind: "rectangle",
                area,
                pointOuter: (t) => interpolatePoint(paired.side0Start, paired.side0End, t),
                pointInner: (t) => interpolatePoint(paired.side1Start, paired.side1End, t),
                ring
            };
        }

        const connected = connectedTreadEndpoint(previous, next);
        if (connected) {
            const center = { x: Number(connected.aPoint.x), y: Number(connected.aPoint.y) };
            const outer0 = connected.aOther;
            const outer1 = connected.bOther;
            const radius = pointDistance(center, outer0);
            if (Math.abs(radius - pointDistance(center, outer1)) > Math.max(0.001, radius * 0.01)) {
                throw new Error(`${label} connected tread endpoints do not share a consistent stair width`);
            }
            const startAngle = Math.atan2(outer0.y - center.y, outer0.x - center.x);
            const endAngle = Math.atan2(outer1.y - center.y, outer1.x - center.x);
            const deltaAngle = stairArcDelta(startAngle, endAngle, next, "arcDeltaAngle", `${label} next tread`);
            const area = Math.abs(0.5 * radius * radius * deltaAngle);
            return {
                kind: "wedge",
                area,
                pointOuter: (t) => arcPoint(center, radius, startAngle, deltaAngle, t),
                pointInner: () => ({ ...center }),
                ring: positiveAreaRing([outer0, outer1, center])
            };
        }

        const crossing = lineIntersectionPoint(previous.left, previous.right, next.left, next.right);
        if (!crossing) {
            throw new Error(`${label} treads are neither parallel, connected, nor intersecting`);
        }
        const sortedPrevious = [previous.left, previous.right]
            .map((point) => ({ point, distance: pointDistance(crossing, point) }))
            .sort((a, b) => a.distance - b.distance);
        const sortedNext = [next.left, next.right]
            .map((point) => ({ point, distance: pointDistance(crossing, point) }))
            .sort((a, b) => a.distance - b.distance);
        const near0 = sortedPrevious[0];
        const far0 = sortedPrevious[1];
        const near1 = sortedNext[0];
        const far1 = sortedNext[1];
        const nearRadius = (near0.distance + near1.distance) * 0.5;
        const farRadius = (far0.distance + far1.distance) * 0.5;
        if (farRadius - nearRadius <= GEOMETRY_EPSILON) {
            throw new Error(`${label} intersecting treads produce a degenerate annular section`);
        }
        const farStartAngle = Math.atan2(far0.point.y - crossing.y, far0.point.x - crossing.x);
        const farEndAngle = Math.atan2(far1.point.y - crossing.y, far1.point.x - crossing.x);
        const farDeltaAngle = stairArcDelta(farStartAngle, farEndAngle, next, "arcDeltaAngle", `${label} next tread`);
        const nearStartAngle = Math.atan2(near0.point.y - crossing.y, near0.point.x - crossing.x);
        const nearEndAngle = Math.atan2(near1.point.y - crossing.y, near1.point.x - crossing.x);
        const nearDeltaAngle = stairArcDelta(nearStartAngle, nearEndAngle, next, "arcNearDeltaAngle", `${label} next tread`, farDeltaAngle);
        const sectionAngle = Math.abs(farDeltaAngle);
        const area = Math.abs(0.5 * sectionAngle * (farRadius * farRadius - nearRadius * nearRadius));
        return {
            kind: "annular",
            area,
            pointOuter: (t) => arcPoint(crossing, farRadius, farStartAngle, farDeltaAngle, t),
            pointInner: (t) => arcPoint(crossing, nearRadius, nearStartAngle, nearDeltaAngle, t),
            ring: positiveAreaRing([
                far0.point,
                far1.point,
                near1.point,
                near0.point
            ])
        };
    }

    stairSections(stair) {
        if (!stair || stair.ladder === true) return [];
        const treads = Array.isArray(stair.treads) ? stair.treads : [];
        if (treads.length < 2) {
            throw new Error(`stair ${stair && stair.id ? stair.id : "(new)"} requires at least two treads`);
        }
        const sections = [];
        for (let index = 1; index < treads.length; index++) {
            sections.push(this.stairSectionBetweenTreads(
                treads[index - 1],
                treads[index],
                `stair ${stair.id || "(new)"} section ${index - 1}`
            ));
        }
        return sections;
    }

    stairStepPolygons(stair) {
        if (!stair || typeof stair !== "object") throw new Error("stair step polygons require a stair record");
        const totalSteps = Math.max(1, Math.round(Number(stair.stepCount) || 1));
        const baseZ = Number.isFinite(Number(stair.bottomZ)) ? Number(stair.bottomZ) : this.activePlaneZ();
        const height = Number(stair.height);
        if (!Number.isFinite(height) || height <= 0) {
            throw new Error(`stair ${stair.id || "(new)"} requires a positive height for step rendering`);
        }
        const rise = String(stair.direction || "up") === "down" ? -height : height;
        if (stair.ladder === true) {
            const footprint = stairFootprintPoints(stair);
            if (!Array.isArray(footprint) || footprint.length < 3) {
                throw new Error(`ladder stair ${stair.id || "(new)"} requires a valid footprint`);
            }
            const ring = positiveAreaRing(footprint);
            return Array.from({ length: totalSteps }, (_, index) => ({
                sectionIndex: 0,
                localStepIndex: index,
                globalStepIndex: index + 1,
                z: baseZ + rise * ((index + 1) / (totalSteps + 1)),
                polygon: ring.map((point) => ({ ...point }))
            }));
        }
        const sections = this.stairSections(stair);
        const sectionCounts = allocateCountsByArea(sections, totalSteps);
        const steps = [];
        let globalStepIndex = 0;
        sections.forEach((section, sectionIndex) => {
            const count = sectionCounts[sectionIndex];
            for (let step = 0; step < count; step++) {
                const t0 = step / count;
                const t1 = (step + 1) / count;
                const outer0 = section.pointOuter(t0);
                const outer1 = section.pointOuter(t1);
                const inner1 = section.pointInner(t1);
                const inner0 = section.pointInner(t0);
                const polygon = section.kind === "wedge"
                    ? positiveAreaRing([outer0, outer1, inner0])
                    : positiveAreaRing([outer0, outer1, inner1, inner0]);
                if (polygon.length < 3 || Math.abs(polygonSignedArea(polygon)) <= GEOMETRY_EPSILON) {
                    throw new Error(`stair ${stair.id || "(new)"} section ${sectionIndex} step ${step} is degenerate`);
                }
                globalStepIndex++;
                const isDownStair = String(stair.direction || "up") === "down";
                steps.push({
                    sectionIndex,
                    localStepIndex: step,
                    globalStepIndex,
                    z: baseZ + rise * (globalStepIndex / (totalSteps + 1)),
                    polygon,
                    lowerEdge: isDownStair
                        ? [{ ...outer1 }, { ...inner1 }]
                        : [{ ...outer0 }, { ...inner0 }]
                });
            }
        });
        if (steps.length !== totalSteps) {
            throw new Error(`stair ${stair.id || "(new)"} generated ${steps.length} rendered steps instead of ${totalSteps}`);
        }
        return steps;
    }

    triangulateStairSteps(stair, options = {}) {
        const steps = this.stairStepPolygons(stair);
        const totalSteps = Math.max(1, Math.round(Number(stair && stair.stepCount) || 1));
        const height = Number(stair && stair.height);
        if (!Number.isFinite(height) || height <= 0) {
            throw new Error(`stair ${stair && stair.id ? stair.id : "(new)"} requires a positive height for solid step triangulation`);
        }
        const stepDrop = height / (totalSteps + 1);
        const resolvedRiserDepth = stairRiserDepth(stair, height, totalSteps);
        const baseZ = Number.isFinite(Number(stair && stair.bottomZ)) ? Number(stair.bottomZ) : this.activePlaneZ();
        const floorZ = String(stair && stair.direction || "up") === "down"
            ? baseZ - height
            : baseZ;
        const treadTextureRepeat = normalizeTextureRepeatConfig({
            repeatsPerMapUnit: options.treadTextureRepeat,
            repeatsPerMapUnitX: options.treadTextureRepeatX,
            repeatsPerMapUnitY: options.treadTextureRepeatY
        }, FLOOR_TEXTURE_REPEAT);
        const riserTextureRepeat = normalizeTextureRepeatConfig({
            repeatsPerMapUnit: options.riserTextureRepeat,
            repeatsPerMapUnitX: options.riserTextureRepeatX,
            repeatsPerMapUnitY: options.riserTextureRepeatY
        }, FLOOR_TEXTURE_REPEAT);
        const treadPoints = [];
        const treadIndices = [];
        const riserPoints = [];
        const riserIndices = [];
        const pushRiserPoint = (point) => {
            riserPoints.push(point);
            return riserPoints.length - 1;
        };
        const same2d = (a, b) => Math.hypot(Number(a.x) - Number(b.x), Number(a.y) - Number(b.y)) <= GEOMETRY_EPSILON;
        const normalForFace = (p0, p1, p2) => {
            const ux = p1.x - p0.x;
            const uy = p1.y - p0.y;
            const uz = p1.z - p0.z;
            const vx = p2.x - p0.x;
            const vy = p2.y - p0.y;
            const vz = p2.z - p0.z;
            const nx = uy * vz - uz * vy;
            const ny = uz * vx - ux * vz;
            const nz = ux * vy - uy * vx;
            const length = Math.hypot(nx, ny, nz);
            if (length <= GEOMETRY_EPSILON) return { x: 0, y: 0, z: 1 };
            return { x: nx / length, y: ny / length, z: nz / length };
        };
        const addVerticalFace = (a, b, topZ, bottomZA, bottomZB) => {
            const ax = Number(a.x);
            const ay = Number(a.y);
            const bx = Number(b.x);
            const by = Number(b.y);
            if (![ax, ay, bx, by, topZ, bottomZA, bottomZB].every(Number.isFinite)) {
                throw new Error(`stair ${stair.id || "(new)"} solid face contains non-finite coordinates`);
            }
            if (Math.max(Math.abs(topZ - bottomZA), Math.abs(topZ - bottomZB)) <= GEOMETRY_EPSILON || Math.hypot(bx - ax, by - ay) <= GEOMETRY_EPSILON) return;
            const edgeLength = Math.hypot(bx - ax, by - ay);
            const u0 = 0;
            const u1 = edgeLength * riserTextureRepeat.repeatsPerMapUnitX;
            const vTop = -topZ * riserTextureRepeat.repeatsPerMapUnitY;
            const p0 = { x: ax, y: ay, z: topZ };
            const p1 = { x: bx, y: by, z: topZ };
            const p2 = { x: bx, y: by, z: bottomZB };
            const normal = normalForFace(p0, p1, p2);
            const aTop = pushRiserPoint({ ...p0, u: u0, v: vTop, normal });
            const bTop = pushRiserPoint({ ...p1, u: u1, v: vTop, normal });
            const bBottom = pushRiserPoint({ ...p2, u: u1, v: -bottomZB * riserTextureRepeat.repeatsPerMapUnitY, normal });
            const aBottom = pushRiserPoint({ x: ax, y: ay, z: bottomZA, u: u0, v: -bottomZA * riserTextureRepeat.repeatsPerMapUnitY, normal });
            riserIndices.push(aTop, bBottom, bTop, aTop, aBottom, bBottom);
        };
        const addBottomFace = (ring, bottomZFor) => {
            const bottomRing = positiveAreaRing(ring).map((point) => ({
                x: Number(point.x),
                y: Number(point.y),
                z: bottomZFor(point)
            }));
            const triangulation = triangulateSurface(bottomRing, []);
            if (!triangulation) {
                throw new Error(`stair ${stair.id || "(new)"} bottom face could not be triangulated`);
            }
            for (let index = 0; index < triangulation.indices.length; index += 3) {
                const a = triangulation.points[Number(triangulation.indices[index])];
                const b = triangulation.points[Number(triangulation.indices[index + 1])];
                const c = triangulation.points[Number(triangulation.indices[index + 2])];
                if (!a || !b || !c) throw new Error(`stair ${stair.id || "(new)"} bottom face contains a missing triangle point`);
                const p0 = { x: Number(a.x), y: Number(a.y), z: bottomZFor(a) };
                const p1 = { x: Number(c.x), y: Number(c.y), z: bottomZFor(c) };
                const p2 = { x: Number(b.x), y: Number(b.y), z: bottomZFor(b) };
                const normal = normalForFace(p0, p1, p2);
                const offset = riserPoints.length;
                [p0, p1, p2].forEach((point) => {
                    riserPoints.push({
                        ...point,
                        u: point.x * riserTextureRepeat.repeatsPerMapUnitX,
                        v: point.y * riserTextureRepeat.repeatsPerMapUnitY,
                        normal
                    });
                });
                riserIndices.push(offset, offset + 1, offset + 2);
            }
        };
        const stepBottomZFor = (step, point) => {
            const topZ = Number(step.z);
            if (resolvedRiserDepth <= GEOMETRY_EPSILON) return topZ;
            const lowerEdge = Array.isArray(step.lowerEdge) ? step.lowerEdge : [];
            const onLowerEdge = lowerEdge.some((edgePoint) => same2d(point, edgePoint));
            let bottomZ;
            if (resolvedRiserDepth <= stepDrop + GEOMETRY_EPSILON) {
                bottomZ = topZ - resolvedRiserDepth;
            } else if (resolvedRiserDepth <= stepDrop * 2 + GEOMETRY_EPSILON) {
                bottomZ = onLowerEdge
                    ? topZ - resolvedRiserDepth
                    : topZ - stepDrop;
            } else {
                bottomZ = onLowerEdge
                    ? topZ - resolvedRiserDepth
                    : topZ - (resolvedRiserDepth - stepDrop);
            }
            return Math.max(floorZ, bottomZ);
        };
        const treadUvFrame = (step, ring) => {
            const lowerEdge = Array.isArray(step.lowerEdge) ? step.lowerEdge : [];
            const a = lowerEdge[0];
            const b = lowerEdge[1];
            if (!finite2dPoint(a) || !finite2dPoint(b)) {
                throw new Error(`stair ${stair.id || "(new)"} step ${step.globalStepIndex} requires a finite lower edge for tread texture mapping`);
            }
            const edgeLength = pointDistance(a, b);
            if (!Number.isFinite(edgeLength) || edgeLength <= GEOMETRY_EPSILON) {
                throw new Error(`stair ${stair.id || "(new)"} step ${step.globalStepIndex} lower edge is degenerate`);
            }
            const ux = (Number(b.x) - Number(a.x)) / edgeLength;
            const uy = (Number(b.y) - Number(a.y)) / edgeLength;
            const midpoint = {
                x: (Number(a.x) + Number(b.x)) * 0.5,
                y: (Number(a.y) + Number(b.y)) * 0.5
            };
            const center = ring.reduce((acc, point) => ({
                x: acc.x + Number(point.x),
                y: acc.y + Number(point.y)
            }), { x: 0, y: 0 });
            center.x /= ring.length;
            center.y /= ring.length;
            let vx = -uy;
            let vy = ux;
            if ((center.x - midpoint.x) * vx + (center.y - midpoint.y) * vy < 0) {
                vx = -vx;
                vy = -vy;
            }
            let maxT = 0;
            const local = ring.map((point) => {
                const dx = Number(point.x) - Number(a.x);
                const dy = Number(point.y) - Number(a.y);
                const s = dx * ux + dy * uy;
                const t = Math.max(0, dx * vx + dy * vy);
                maxT = Math.max(maxT, t);
                return { point, s, t };
            });
            if (maxT <= GEOMETRY_EPSILON) {
                throw new Error(`stair ${stair.id || "(new)"} step ${step.globalStepIndex} has no measurable tread texture height`);
            }
            const seed = [
                "stair-tread-uv",
                stair && stair.id !== undefined ? String(stair.id) : "new",
                stair && stair.floorId !== undefined ? String(stair.floorId) : "",
                step.sectionIndex,
                step.localStepIndex,
                step.globalStepIndex,
                pointSeed(a),
                pointSeed(b),
                ring.map(pointSeed).join(";")
            ].join("|");
            const uOffset = stableUnitRandom(`${seed}|u`);
            const vOffset = stableUnitRandom(`${seed}|v`);
            return {
                uvFor(point) {
                    const match = local.find((entry) => same2d(entry.point, point));
                    if (match) {
                        return {
                            u: uOffset + match.s * treadTextureRepeat.repeatsPerMapUnitX,
                            v: vOffset + match.t * treadTextureRepeat.repeatsPerMapUnitY
                        };
                    }
                    const dx = Number(point.x) - Number(a.x);
                    const dy = Number(point.y) - Number(a.y);
                    return {
                        u: uOffset + (dx * ux + dy * uy) * treadTextureRepeat.repeatsPerMapUnitX,
                        v: vOffset + Math.max(0, dx * vx + dy * vy) * treadTextureRepeat.repeatsPerMapUnitY
                    };
                }
            };
        };
        steps.forEach((step) => {
            const ring = positiveAreaRing(step.polygon).map((point) => ({ ...point, z: step.z }));
            const uvFrame = treadUvFrame(step, ring);
            const triangulation = triangulateSurface(ring, []);
            if (!triangulation) {
                throw new Error(`stair ${stair.id || "(new)"} step ${step.globalStepIndex} could not be triangulated`);
            }
            const offset = treadPoints.length;
            triangulation.points.forEach((point) => {
                const uv = uvFrame.uvFor(point);
                treadPoints.push({ ...point, z: step.z, u: uv.u, v: uv.v, normal: { x: 0, y: 0, z: 1 } });
            });
            triangulation.indices.forEach((index) => {
                treadIndices.push(offset + Number(index));
            });
            if (resolvedRiserDepth <= GEOMETRY_EPSILON) return;
            const bottomZFor = (point) => stepBottomZFor(step, point);
            for (let index = 0; index < ring.length; index++) {
                const a = ring[index];
                const b = ring[(index + 1) % ring.length];
                addVerticalFace(a, b, Number(step.z), bottomZFor(a), bottomZFor(b));
            }
            addBottomFace(ring, bottomZFor);
        });
        if (!treadPoints.length || treadIndices.length < 3) {
            throw new Error(`stair ${stair.id || "(new)"} did not produce renderable step geometry`);
        }
        const combinedPoints = [
            ...treadPoints,
            ...riserPoints
        ];
        const combinedIndices = [
            ...treadIndices,
            ...riserIndices.map((index) => Number(index) + treadPoints.length)
        ];
        const treadIndexArray = treadPoints.length > 65535 ? Uint32Array : Uint16Array;
        const riserIndexArray = riserPoints.length > 65535 ? Uint32Array : Uint16Array;
        const combinedIndexArray = combinedPoints.length > 65535 ? Uint32Array : Uint16Array;
        return {
            points: combinedPoints,
            indices: new combinedIndexArray(combinedIndices),
            tread: {
                points: treadPoints,
                indices: new treadIndexArray(treadIndices)
            },
            riser: {
                points: riserPoints,
                indices: new riserIndexArray(riserIndices)
            }
        };
    }

    createStairMeshPart(floor, stair, triangulation, texturePath, namePrefix, textureRepeatConfig = null) {
        const repeatConfig = normalizeTextureRepeatConfig(textureRepeatConfig, FLOOR_TEXTURE_REPEAT);
        return this.createSurfaceMesh(floor, triangulation, {
            z: Number.isFinite(Number(stair.bottomZ)) ? Number(stair.bottomZ) : getFloorElevation(floor),
            texturePath,
            textureFallback: DEFAULTS.floorTexture,
            textureRepeatX: repeatConfig.repeatsPerMapUnitX,
            textureRepeatY: repeatConfig.repeatsPerMapUnitY,
            namePrefix
        });
    }

    createStairMesh(floor, stair, triangulation, treadTextureRepeatConfig = null, riserTextureRepeatConfig = null) {
        if (!triangulation || !triangulation.tread) {
            throw new Error(`stair ${stair && stair.id ? stair.id : "(new)"} triangulation is missing tread geometry`);
        }
        const container = new PIXI.Container();
        container.name = `buildingEditorStairMesh:${getFloorId(floor)}:${stair && stair.id !== undefined ? stair.id : "new"}`;
        const treadMesh = this.createStairMeshPart(floor, stair, triangulation.tread, stairTreadTexturePath(stair), "buildingEditorStairTreadMesh", treadTextureRepeatConfig);
        const hasRiser = !!(triangulation.riser && triangulation.riser.points && triangulation.riser.points.length && triangulation.riser.indices && triangulation.riser.indices.length >= 3);
        const riserMesh = hasRiser
            ? this.createStairMeshPart(floor, stair, triangulation.riser, stairRiserTexturePath(stair), "buildingEditorStairRiserMesh", riserTextureRepeatConfig)
            : null;
        if (!treadMesh || (hasRiser && !riserMesh)) throw new Error(`stair ${stair && stair.id ? stair.id : "(new)"} split mesh could not be created`);
        if (riserMesh) container.addChild(riserMesh);
        container.addChild(treadMesh);
        container.visible = false;
        container.interactive = false;
        container._stairTreadMesh = treadMesh;
        container._stairRiserMesh = riserMesh;
        return container;
    }

    syncStairMesh(floor, stair, alpha) {
        const key = stairMeshKey(floor, stair);
        const treadTextureRepeatConfig = this.floorTextureRepeatConfig(stairTreadTexturePath(stair));
        const riserTextureRepeatConfig = this.floorTextureRepeatConfig(stairRiserTexturePath(stair));
        const signature = stairMeshSignature(floor, stair, treadTextureRepeatConfig, riserTextureRepeatConfig);
        let entry = this.stairMeshById.get(key);
        if (!entry || entry.signature !== signature) {
            if (entry && entry.mesh) {
                if (entry.mesh.parent) entry.mesh.parent.removeChild(entry.mesh);
                entry.mesh.destroy({ children: true, texture: false, baseTexture: false });
            }
            const triangulation = this.triangulateStairSteps(stair, {
                treadTextureRepeatX: treadTextureRepeatConfig.repeatsPerMapUnitX,
                treadTextureRepeatY: treadTextureRepeatConfig.repeatsPerMapUnitY,
                riserTextureRepeatX: riserTextureRepeatConfig.repeatsPerMapUnitX,
                riserTextureRepeatY: riserTextureRepeatConfig.repeatsPerMapUnitY
            });
            const mesh = this.createStairMesh(floor, stair, triangulation, treadTextureRepeatConfig, riserTextureRepeatConfig);
            if (!mesh) throw new Error(`stair ${stair && stair.id ? stair.id : "(new)"} mesh could not be created`);
            this.buildingUnit.addChild(mesh);
            entry = { signature, mesh };
            this.stairMeshById.set(key, entry);
        } else if (entry.mesh.parent !== this.buildingUnit) {
            this.buildingUnit.addChild(entry.mesh);
        }
        entry.mesh.visible = true;
        this.updateSurfaceMeshUniforms(entry.mesh._stairTreadMesh, floor, alpha, {
            texturePath: stairTreadTexturePath(stair),
            textureFallback: DEFAULTS.floorTexture
        });
        if (entry.mesh._stairRiserMesh) {
            this.updateSurfaceMeshUniforms(entry.mesh._stairRiserMesh, floor, alpha, {
                texturePath: stairRiserTexturePath(stair),
                textureFallback: DEFAULTS.floorTexture
            });
        }
        return entry.mesh;
    }

    gableWallSignature(floor, gable) {
        const roof = getFloorRoof(floor);
        const texturePath = gableWallTexturePath(floor, gable);
        return [
            getFloorId(floor),
            gable.id,
            gable.start && gable.start.edgeIndex,
            Number(gable.start && gable.start.t).toFixed(4),
            gable.end && gable.end.edgeIndex,
            Number(gable.end && gable.end.t).toFixed(4),
            Number(gable.height).toFixed(4),
            Number(roofElevationOffset(floor)).toFixed(4),
            Number(roof.overhang).toFixed(4),
            Number(roof.peakHeight).toFixed(4),
            texturePath,
            Number(wallTextureRepeatX(texturePath)).toFixed(4),
            Number(wallTextureRepeatY(texturePath)).toFixed(4)
        ].join(";");
    }

    gableWallPerimeterDistanceAt(floor, position) {
        const ring = getRoofContactPolygon(floor);
        const index = Math.floor(Number(position && position.edgeIndex));
        if (!Number.isInteger(index) || index < 0 || index >= ring.length) {
            throw new Error(`roof ${getFloorId(floor)} gable wall texture coordinates require a valid outline edge`);
        }
        const start = ring[index];
        const end = ring[(index + 1) % ring.length];
        const cumulative = ringCumulativeLengths(ring);
        const baseDistance = cumulative[index];
        const edgeLength = Math.hypot(Number(end.x) - Number(start.x), Number(end.y) - Number(start.y));
        if (!Number.isFinite(edgeLength) || edgeLength <= GEOMETRY_EPSILON) {
            throw new Error(`roof ${getFloorId(floor)} gable wall texture coordinates require a non-zero perimeter edge`);
        }
        return baseDistance + edgeLength * Math.max(0, Math.min(1, Number(position && position.t)));
    }

    gableWallTexturePhaseOffset(floor, position) {
        const ring = getRoofContactPolygon(floor);
        const index = Math.floor(Number(position && position.edgeIndex));
        if (!Number.isInteger(index) || index < 0 || index >= ring.length) {
            throw new Error(`roof ${getFloorId(floor)} gable wall texture phase requires a valid outline edge`);
        }
        const start = ring[index];
        const end = ring[(index + 1) % ring.length];
        if (!start || !start.id || !end || !end.id) {
            return 0;
        }
        const floorId = getFloorId(floor);
        const matchingWall = getBuildingWalls(this.state.building).find((wall) => {
            const attachment = wall && wall.attachment;
            return wallIsOuterPerimeterForFloor(wall, floorId) &&
                attachment.startVertexId === start.id &&
                attachment.endVertexId === end.id;
        });
        const offset = Number(matchingWall && matchingWall.texturePhaseA);
        return Number.isFinite(offset) ? offset : 0;
    }

    triangulateRoof(floor) {
        return triangulateRoof(floor, this.roofTextureRepeatConfig(roofTexturePath(floor)));
    }

    triangulateGableWall(floor, gable) {
        const geometry = gableWorldGeometry(floor, gable);
        const texturePath = gableWallTexturePath(floor, gable);
        const repeatX = wallTextureRepeatX(texturePath);
        const repeatY = wallTextureRepeatY(texturePath);
        const points = [];
        const indices = [];
        const wallUv = (point, position) => ({
            u: this.gableWallPerimeterDistanceAt(floor, position) * repeatX + this.gableWallTexturePhaseOffset(floor, position),
            v: -Number(point.z) * repeatY
        });
        const addWallTriangle = (a, b, c, label) => {
            if (triangleArea3d(a, b, c) <= GEOMETRY_EPSILON) return;
            const normal = triangleSurfaceNormal(a, b, c, label);
            const offset = points.length;
            points.push(
                { ...a, normal, ...wallUv(a, a.position) },
                { ...b, normal, ...wallUv(b, b.position) },
                { ...c, normal, ...wallUv(c, c.position) }
            );
            indices.push(offset, offset + 1, offset + 2);
        };
        geometry.wallSegments.forEach((segment, index) => {
            addWallTriangle(
                segment.bottomStart,
                segment.bottomEnd,
                segment.topEnd,
                `roof ${getFloorId(floor)} gable ${gable.id} wall segment ${index} lower`
            );
            addWallTriangle(
                segment.bottomStart,
                segment.topEnd,
                segment.topStart,
                `roof ${getFloorId(floor)} gable ${gable.id} wall segment ${index} upper`
            );
        });
        return { points, indices: new Uint16Array(indices) };
    }

    syncGableWallMesh(floor, gable, alpha) {
        const id = `${roofMeshKey(floor, getFloorRoof(floor))}:${gable.id}`;
        const signature = this.gableWallSignature(floor, gable);
        let entry = this.gableWallMeshById.get(id);
        if (!entry || entry.signature !== signature) {
            if (entry && entry.mesh) {
                if (entry.mesh.parent) entry.mesh.parent.removeChild(entry.mesh);
                entry.mesh.destroy({ children: false, texture: false, baseTexture: false });
            }
            const triangulation = this.triangulateGableWall(floor, gable);
            const texturePath = gableWallTexturePath(floor, gable);
            const mesh = this.createSurfaceMesh(floor, triangulation, {
                z: roofRenderElevation(floor),
                texturePath,
                textureFallback: "/assets/images/walls/woodwall.png",
                textureRepeat: wallTextureRepeatX(texturePath),
                namePrefix: "buildingEditorGableWallMesh"
            });
            if (!mesh) throw new Error(`roof ${getFloorId(floor)} gable ${gable.id} wall mesh could not be created`);
            this.buildingUnit.addChild(mesh);
            entry = { signature, mesh };
            this.gableWallMeshById.set(id, entry);
        } else if (entry.mesh.parent !== this.buildingUnit) {
            this.buildingUnit.addChild(entry.mesh);
        }
        const texturePath = gableWallTexturePath(floor, gable);
        this.updateSurfaceMeshUniforms(entry.mesh, floor, alpha, {
            texturePath,
            textureFallback: "/assets/images/walls/woodwall.png"
        });
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
        if (!unit || typeof unit.getWallProfile !== "function") return getWallResolvedGeometry(wall).profile;
        return unit.getWallProfile();
    }

    applyResolvedGeometryToWallUnit(unit, wall) {
        const WallSectionUnit = globalThis.WallSectionUnit;
        if (!WallSectionUnit || typeof WallSectionUnit.endpointKey !== "function") {
            throw new Error("building editor resolved wall rendering requires WallSectionUnit.endpointKey");
        }
        if (!unit) throw new Error(`wall ${wall && wall.id} cannot apply resolved geometry without a WallSectionUnit`);
        const profile = getWallResolvedGeometry(wall).profile;
        const startKey = WallSectionUnit.endpointKey(unit.startPoint);
        const endKey = WallSectionUnit.endpointKey(unit.endPoint);
        unit._joineryCorners = {};
        unit._joineryCorners[startKey] = {
            sharedEnd: "start",
            center: { x: Number(unit.startPoint.x), y: Number(unit.startPoint.y) },
            posN: { ...profile.aLeft },
            negN: { ...profile.aRight }
        };
        unit._joineryCorners[endKey] = {
            sharedEnd: "end",
            center: { x: Number(unit.endPoint.x), y: Number(unit.endPoint.y) },
            posN: { ...profile.bLeft },
            negN: { ...profile.bRight }
        };
        unit._visibleNeighborMiterProfileCache = null;
        if (typeof unit.rebuildMesh3d === "function") unit.rebuildMesh3d();
    }

    completePerimeterOpenAreaPolygon(floor, wallsForFloor) {
        const floorId = getFloorId(floor);
        const insetDistance = completeUniformPerimeterInsetDistance(floor, wallsForFloor);
        if (insetDistance === null) return null;
        const outer = Array.isArray(floor && floor.outerPolygon) ? floor.outerPolygon : [];
        const innerRing = offsetRing(outer, insetDistance);
        if (!Array.isArray(innerRing) || innerRing.length !== outer.length) {
            throw new Error(`floor ${floorId} perimeter open area could not resolve an inset ring`);
        }
        const ringError = simplePolygonRingError(innerRing, `floor ${floorId} perimeter open-area ring`);
        if (ringError) {
            throw new Error(`floor ${floorId} perimeter open area is invalid: ${ringError}`);
        }
        return [
            closedClipRing(innerRing, `floor ${floorId} perimeter open area`),
            ...(Array.isArray(floor && floor.holes) ? floor.holes : [])
                .map((ring, index) => closedClipRing(ring, `floor ${floorId} hole ${index}`))
        ];
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
        const perimeterOpenAreaPolygon = this.completePerimeterOpenAreaPolygon(floor, wallsForFloor);
        const wallsToSubtract = perimeterOpenAreaPolygon
            ? wallsForFloor.filter((wall) => !wallIsOuterPerimeterForFloor(wall, floorId))
            : wallsForFloor;
        const wallFootprints = wallsToSubtract.map((wall) => {
            try {
                const profile = this.wallProfileForRender(wall, wallEntries);
                return {
                    wall,
                    footprint: wallFootprintPolygon(this.state.building, wall, floor, profile
                        ? {
                            profile,
                            footprintScale: COLLAPSED_WALL_FOOTPRINT_SUBTRACTION_SCALE
                        }
                        : {
                            thicknessScale: COLLAPSED_WALL_FOOTPRINT_SUBTRACTION_SCALE
                        })
                };
            } catch (error) {
                throw new Error(`collapsed wall open-area footprint failed for floor ${floorId}, wall ${wall && wall.id}: ${error.message}`);
            }
        });
        let openArea = perimeterOpenAreaPolygon ? [perimeterOpenAreaPolygon] : [floorPolygon];
        if (wallFootprints.length > 0) {
            try {
                openArea = clipper.difference(openArea, ...wallFootprints.map((entry) => entry.footprint));
            } catch (error) {
                for (let index = 0; index < wallFootprints.length; index++) {
                    const entry = wallFootprints[index];
                    try {
                        clipper.difference(openArea, ...wallFootprints.slice(0, index + 1).map((item) => item.footprint));
                    } catch (innerError) {
                        throw new Error(`collapsed wall open-area clipping failed for floor ${floorId} after adding wall ${entry.wall && entry.wall.id}: ${innerError.message}`);
                    }
                }
                throw new Error(`collapsed wall open-area clipping failed for floor ${floorId}: ${error.message}`);
            }
        }
        const screenOpenArea = this.projectClipGeometryToScreen(openArea, getFloorElevation(floor));
        this.collapsedWallGeometryByFloorId.set(floorId, screenOpenArea);
        return screenOpenArea;
    }

    wallRenderProfile(wall, floor, wallEntries = null, label = "wall render profile") {
        const renderProfile = this.wallProfileForRender(wall, wallEntries);
        if (renderProfile) return renderProfile;
        const points = wallProfilePoints(this.state.building, wall, floor);
        if (!Array.isArray(points) || points.length < 4) {
            throw new Error(`${label} requires a four-corner wall profile`);
        }
        return {
            aLeft: points[0],
            bLeft: points[1],
            bRight: points[2],
            aRight: points[3]
        };
    }

    wallRenderProfilePoints(wall, floor, wallEntries = null, label = "wall render profile") {
        return wallProfilePolygonFromProfile(this.wallRenderProfile(wall, floor, wallEntries, label), label);
    }

    wallScreenImagePolygon(wall, floor, wallEntries = null) {
        const baseZ = getFloorElevation(floor);
        const profile = this.wallRenderProfile(wall, floor, wallEntries, `wall ${wall && wall.id} mitered screen image`);
        const stations = wallTopStations(wall);
        const rings = [];
        const toScreenRing = (points, label) => [[closedClipRing(points.map((point) => this.worldToScreen(point, point.z)), label)]];
        const stationPoint = (station) => {
            const left = wallProfilePointAt(profile, "left", station.t);
            const right = wallProfilePointAt(profile, "right", station.t);
            const leftHeight = wallTopHeightAt(wall, left, station.leftHeight, baseZ);
            const rightHeight = wallTopHeightAt(wall, right, station.rightHeight, baseZ);
            return {
                leftBottom: { ...left, z: baseZ },
                rightBottom: { ...right, z: baseZ },
                leftTop: { ...left, z: baseZ + leftHeight },
                rightTop: { ...right, z: baseZ + rightHeight }
            };
        };
        const resolved = stations.map(stationPoint);
        for (let index = 0; index < resolved.length - 1; index++) {
            const a = resolved[index];
            const b = resolved[index + 1];
            rings.push(...toScreenRing([a.leftBottom, b.leftBottom, b.leftTop, a.leftTop], `wall ${wall && wall.id} screen left ${index}`));
            rings.push(...toScreenRing([b.rightBottom, a.rightBottom, a.rightTop, b.rightTop], `wall ${wall && wall.id} screen right ${index}`));
            rings.push(...toScreenRing([a.leftTop, b.leftTop, b.rightTop, a.rightTop], `wall ${wall && wall.id} screen top ${index}`));
        }
        const first = resolved[0];
        const last = resolved[resolved.length - 1];
        rings.push(...toScreenRing([first.rightBottom, first.leftBottom, first.leftTop, first.rightTop], `wall ${wall && wall.id} screen start cap`));
        rings.push(...toScreenRing([last.leftBottom, last.rightBottom, last.rightTop, last.leftTop], `wall ${wall && wall.id} screen end cap`));
        return rings;
    }

    wallScreenTopProfilePoints(wall, floor, wallEntries = null) {
        const baseZ = getFloorElevation(floor);
        const profile = this.wallRenderProfile(wall, floor, wallEntries, `wall ${wall && wall.id} top profile`);
        return wallTopStations(wall).flatMap((station) => {
            const left = wallProfilePointAt(profile, "left", station.t);
            const right = wallProfilePointAt(profile, "right", station.t);
            const leftHeight = wallTopHeightAt(wall, left, station.leftHeight, baseZ);
            const rightHeight = wallTopHeightAt(wall, right, station.rightHeight, baseZ);
            return [
                { ...left, z: baseZ + leftHeight },
                { ...right, z: baseZ + rightHeight }
            ];
        });
    }

    wallScreenCollapsedGeometry(wall, floor, wallEntries = null) {
        const profile = this.wallProfileForRender(wall, wallEntries);
        const footprint = wallFootprintPolygon(this.state.building, wall, floor, profile ? { profile } : {});
        return this.projectClipGeometryToScreen([footprint], getFloorElevation(floor));
    }

    wallScreenPickGeometry(wall, floor, wallEntries = null) {
        return this.shouldDrawWallCollapsed(wall, floor, wallEntries)
            ? this.wallScreenCollapsedGeometry(wall, floor, wallEntries)
            : this.wallScreenImagePolygon(wall, floor, wallEntries);
    }

    surfaceScreenGeometry(floor, z, label) {
        return this.projectClipGeometryToScreen([floorClipPolygon(floor)], z)
            .map((polygon, polygonIndex) => polygon.map((ring, ringIndex) => {
                if (!looksLikeClipRing(ring)) {
                    throw new Error(`${label} projected malformed ring ${polygonIndex}:${ringIndex}`);
                }
                return ring;
            }));
    }

    roofScreenGeometry(floor, label) {
        const overhang = roofOverhang(floor);
        const contactPolygon = getRoofContactPolygon(floor);
        const perimeter = Math.abs(overhang) > GEOMETRY_EPSILON || roofPeakHeight(floor) > GEOMETRY_EPSILON
            ? roofPerimeterRing(floor)
            : contactPolygon.map((point) => ({ ...point, z: roofRenderElevation(floor) }));
        const ring = closedClipRing(perimeter.map((point) => this.worldToScreen(point, Number.isFinite(Number(point.z)) ? Number(point.z) : roofRenderElevation(floor))), `${label} roof projected outline`);
        if (!looksLikeClipRing(ring)) {
            throw new Error(`${label} projected malformed roof outline`);
        }
        return [[ring]];
    }

    roofContactScreenGeometry(floor, label) {
        const contactPolygon = getRoofContactPolygon(floor)
            .map((point) => ({ ...point, z: roofRenderElevation(floor) }));
        const ring = closedClipRing(contactPolygon.map((point) => this.worldToScreen(point, point.z)), `${label} roof contact outline`);
        if (!looksLikeClipRing(ring)) {
            throw new Error(`${label} projected malformed roof contact outline`);
        }
        return [[ring]];
    }

    gableScreenGeometry(floor, gable, label) {
        const geometry = gableWorldGeometry(floor, gable);
        const rings = [
            [geometry.roofStart, geometry.roofApex, geometry.roofBackApex, geometry.roofBackStart],
            [geometry.roofApex, geometry.roofEnd, geometry.roofBackEnd, geometry.roofBackApex],
            ...geometry.wallSegments
                .filter((segment) => Math.max(
                    Number(segment.topStart.z) - Number(segment.bottomStart.z),
                    Number(segment.topEnd.z) - Number(segment.bottomEnd.z)
                ) > GEOMETRY_EPSILON)
                .map((segment) => [segment.bottomStart, segment.bottomEnd, segment.topEnd, segment.topStart])
        ].map((points, index) => closedClipRing(
            points.map((point) => this.worldToScreen(point, point.z)),
            `${label} part ${index}`
        ));
        return rings.map((ring, index) => {
            if (!looksLikeClipRing(ring)) {
                throw new Error(`${label} projected malformed gable ring ${index}`);
            }
            return [ring];
        });
    }

    gableHandles(floor, gable) {
        const geometry = gableWorldGeometry(floor, gable);
        return [
            { key: "start", point: geometry.roofStart, screen: this.worldToScreen(geometry.roofStart, geometry.roofStart.z), gable, floor },
            { key: "end", point: geometry.roofEnd, screen: this.worldToScreen(geometry.roofEnd, geometry.roofEnd.z), gable, floor },
            { key: "height", point: geometry.roofApex, screen: this.worldToScreen(geometry.roofApex, geometry.roofApex.z), gable, floor }
        ];
    }

    pickGableHandleAtScreen(screenPoint, thresholdPixels = 10) {
        const point = screenPointToClipPoint(screenPoint, "gable handle pick");
        const selection = this.state.selection || {};
        const selectedGableId = selection.gableId !== null && selection.gableId !== undefined ? String(selection.gableId) : "";
        let best = null;
        this.state.selectedRoofEntries().forEach(({ floor, roof }) => {
            const roofView = floorRoofView(floor, roof);
            getRoofGables(roofView).forEach((gable) => {
                if (selectedGableId && String(gable.id) !== selectedGableId) return;
                this.gableHandles(roofView, gable).forEach((handle) => {
                    const distance = Math.hypot(point[0] - Number(handle.screen.x), point[1] - Number(handle.screen.y));
                    if (distance > thresholdPixels) return;
                    if (!best || distance < best.distance) best = { ...handle, floor, roof, distance };
                });
            });
        });
        return best;
    }

    gableEdgeTAtScreen(floor, gable, screenPoint, snapPixels = GABLE_ENDPOINT_VERTEX_SNAP_PIXELS) {
        const roofView = this.selectedRoofViewForFloor(floor);
        const ring = roofPerimeterRing(roofView);
        const geometry = gableWorldGeometry(roofView, gable);
        const snapThreshold = Number.isFinite(Number(snapPixels)) && Number(snapPixels) >= 0
            ? Number(snapPixels)
            : GABLE_ENDPOINT_VERTEX_SNAP_PIXELS;
        let snappedVertex = null;
        ring.forEach((vertex, index) => {
            const screen = this.worldToScreen(vertex, geometry.rimZ);
            const distance = Math.hypot(Number(screenPoint.x) - Number(screen.x), Number(screenPoint.y) - Number(screen.y));
            if (distance > snapThreshold) return;
            if (!snappedVertex || distance < snappedVertex.distance) {
                snappedVertex = { edgeIndex: index, t: 0, distance };
            }
        });
        if (snappedVertex) {
            return { edgeIndex: snappedVertex.edgeIndex, t: snappedVertex.t };
        }
        let best = null;
        for (let index = 0; index < ring.length; index++) {
            const a = this.worldToScreen(ring[index], geometry.rimZ);
            const b = this.worldToScreen(ring[(index + 1) % ring.length], geometry.rimZ);
            const dx = Number(b.x) - Number(a.x);
            const dy = Number(b.y) - Number(a.y);
            const lengthSquared = dx * dx + dy * dy;
            if (lengthSquared <= GEOMETRY_EPSILON) continue;
            const t = Math.max(0, Math.min(1, ((Number(screenPoint.x) - Number(a.x)) * dx + (Number(screenPoint.y) - Number(a.y)) * dy) / lengthSquared));
            const x = Number(a.x) + dx * t;
            const y = Number(a.y) + dy * t;
            const distance = Math.hypot(Number(screenPoint.x) - x, Number(screenPoint.y) - y);
            if (!best || distance < best.distance) best = { edgeIndex: index, t, distance };
        }
        if (!best) throw new Error(`roof ${getFloorId(floor)} gable ${gable.id} endpoint drag requires a valid roof outline`);
        return { edgeIndex: best.edgeIndex, t: best.t };
    }

    gableHeightAtScreen(floor, gable, screenPoint) {
        const geometry = gableWorldGeometry(this.selectedRoofViewForFloor(floor), gable);
        const baseScreen = this.worldToScreen({
            x: geometry.roofApex.x,
            y: geometry.roofApex.y
        }, geometry.rimZ);
        const pixelsPerZ = Number(this.state.camera.zoom) * GAME_XY_RATIO * cameraPitchProjectionFactors(this.state.camera).height;
        if (!Number.isFinite(pixelsPerZ) || pixelsPerZ <= 0) {
            throw new Error("gable height drag requires a positive camera zoom");
        }
        return Math.max(0, Math.min(geometry.peakHeight, (Number(baseScreen.y) - Number(screenPoint.y)) / pixelsPerZ));
    }

    selectedRoofViewForFloor(floor) {
        const selection = this.state.selection || {};
        const roof = selection && selection.roofId && String(selection.floorId) === String(getFloorId(floor))
            ? findFloorRoof(floor, selection.roofId)
            : getFloorRoof(floor);
        return floorRoofView(floor, roof);
    }

    roofContactWorldPointAtScreen(floor, screenPoint) {
        if (!floor || !screenPoint) throw new Error("roof vertex drag requires a floor and screen point");
        return this.screenToWorld(screenPoint, roofRenderElevation(this.selectedRoofViewForFloor(floor)));
    }

    roofPeakWorldPointAtScreen(floor, screenPoint, options = {}) {
        if (!floor || !screenPoint) throw new Error("roof peak drag requires a floor and screen point");
        const roofView = this.selectedRoofViewForFloor(floor);
        const peakPlaneZ = roofRenderElevation(roofView) + roofPeakHeight(roofView);
        if (options.startScreen && options.originalPoint) {
            const start = this.screenToWorld(options.startScreen, peakPlaneZ);
            const next = this.screenToWorld(screenPoint, peakPlaneZ);
            return {
                x: Number(options.originalPoint.x) + Number(next.x) - Number(start.x),
                y: Number(options.originalPoint.y) + Number(next.y) - Number(start.y)
            };
        }
        return this.screenToWorld(screenPoint, peakPlaneZ);
    }

    pickRoofPeakAtScreen(screenPoint, thresholdPixels = 10) {
        const selection = this.state.selection || {};
        if (selection.kind !== "roof" && selection.kind !== "roofVertex" && selection.kind !== "roofPeak") return null;
        const threshold = Number.isFinite(Number(thresholdPixels)) ? Number(thresholdPixels) : 10;
        let best = null;
        this.state.selectedRoofEntries().forEach(({ floor, roof }) => {
            const roofView = floorRoofView(floor, roof);
            if (String(roof.mode || "peak") !== "peak") return;
            const peak = roofPeakWorldGeometry(roofView).peak;
            const screen = this.worldToScreen(peak, peak.z);
            const distance = Math.hypot(Number(screenPoint.x) - Number(screen.x), Number(screenPoint.y) - Number(screen.y));
            if (distance > threshold) return;
            if (!best || distance < best.distance) best = { type: "roofPeak", floor, roof, point: peak, distance };
        });
        return best;
    }

    roofShedDirectionWorldPointAtScreen(floor, screenPoint) {
        if (!floor || !screenPoint) throw new Error("shed roof direction drag requires a floor and screen point");
        return this.screenToWorld(screenPoint, roofRenderElevation(this.selectedRoofViewForFloor(floor)));
    }

    pickRoofShedDirectionAtScreen(screenPoint, thresholdPixels = 10) {
        const selection = this.state.selection || {};
        if (selection.kind !== "roof" && selection.kind !== "roofShedDirection") return null;
        const threshold = Number.isFinite(Number(thresholdPixels)) ? Number(thresholdPixels) : 10;
        let best = null;
        this.state.selectedRoofEntries().forEach(({ floor, roof }) => {
            const roofView = floorRoofView(floor, roof);
            const mode = String(roof.mode || "peak");
            if (mode !== "shed" && mode !== "gabled") return;
            const center = polygonCentroid(getRoofContactPolygon(roofView));
            const direction = getRoofShedDirection(roofView);
            const point = {
                x: Number(center.x) + Number(direction.x) * ROOF_SHED_DIRECTION_HANDLE_LENGTH,
                y: Number(center.y) + Number(direction.y) * ROOF_SHED_DIRECTION_HANDLE_LENGTH
            };
            const screen = this.worldToScreen(point, roofRenderElevation(roofView));
            const distance = Math.hypot(Number(screenPoint.x) - Number(screen.x), Number(screenPoint.y) - Number(screen.y));
            if (distance > threshold) return;
            if (!best || distance < best.distance) best = { type: "roofShedDirection", floor, roof, point, distance };
        });
        return best;
    }

    pickRoofContactVertexAtScreen(screenPoint, thresholdPixels = 10) {
        const selection = this.state.selection || {};
        if (selection.kind !== "roof" && selection.kind !== "roofVertex" && selection.kind !== "roofPeak" && selection.kind !== "roofShedDirection") return null;
        const threshold = Number.isFinite(Number(thresholdPixels)) ? Number(thresholdPixels) : 10;
        let best = null;
        this.state.selectedRoofEntries().forEach(({ floor, roof }) => {
            const roofView = floorRoofView(floor, roof);
            getRoofContactPolygon(roofView).forEach((point, vertexIndex) => {
                const screen = this.worldToScreen(point, roofRenderElevation(roofView));
                const distance = Math.hypot(Number(screenPoint.x) - Number(screen.x), Number(screenPoint.y) - Number(screen.y));
                if (distance > threshold) return;
                if (!best || distance < best.distance) best = { type: "roofVertex", floor, roof, vertexIndex, point, distance };
            });
        });
        return best;
    }

    pickRoofContactEdgeAtScreen(screenPoint, thresholdPixels = 10) {
        const selection = this.state.selection || {};
        if (selection.kind !== "roof" && selection.kind !== "roofVertex" && selection.kind !== "roofPeak" && selection.kind !== "roofShedDirection") return null;
        const threshold = Number.isFinite(Number(thresholdPixels)) ? Number(thresholdPixels) : 10;
        let best = null;
        this.state.selectedRoofEntries().forEach(({ floor, roof }) => {
            const roofView = floorRoofView(floor, roof);
            const ring = getRoofContactPolygon(roofView);
            for (let index = 0; index < ring.length; index++) {
                const a = this.worldToScreen(ring[index], roofRenderElevation(roofView));
                const b = this.worldToScreen(ring[(index + 1) % ring.length], roofRenderElevation(roofView));
                const dx = Number(b.x) - Number(a.x);
                const dy = Number(b.y) - Number(a.y);
                const lengthSquared = dx * dx + dy * dy;
                if (lengthSquared <= GEOMETRY_EPSILON) continue;
                const t = Math.max(0, Math.min(1, ((Number(screenPoint.x) - Number(a.x)) * dx + (Number(screenPoint.y) - Number(a.y)) * dy) / lengthSquared));
                if (t <= 0.02 || t >= 0.98) continue;
                const x = Number(a.x) + dx * t;
                const y = Number(a.y) + dy * t;
                const distance = Math.hypot(Number(screenPoint.x) - x, Number(screenPoint.y) - y);
                if (distance > threshold) continue;
                if (!best || distance < best.distance) {
                    best = {
                        type: "roofEdge",
                        floor,
                        roof,
                        insertAfterIndex: index,
                        t,
                        point: this.screenToWorld({ x, y }, roofRenderElevation(roofView)),
                        distance
                    };
                }
            }
        });
        return best;
    }

    pickRoofFaceAtScreen(screenPoint) {
        const point = screenPointToClipPoint(screenPoint, "roof face screen pick");
        let best = null;
        this.renderedFloors().forEach((floor) => {
            getFloorRoofs(floor).forEach((roof) => {
                const roofView = floorRoofView(floor, roof);
                const ring = roofPerimeterRing(roofView);
                if (ring.length < 3) return;
                const z = roofRenderElevation(roofView);
                for (let index = 0; index < ring.length; index++) {
                    const face = roofFaceWorldGeometry(roofView, index);
                    const ringScreen = closedClipRing([
                        this.worldToScreen(face.edgeA, face.edgeA.z),
                        this.worldToScreen(face.edgeB, face.edgeB.z),
                        this.worldToScreen(face.peak, face.peak.z)
                    ], `roof ${getFloorId(floor)} face ${index} pick`);
                    if (!pointInClipRing(point, ringScreen)) continue;
                    const depthMetric = this.surfaceDepthMetricAtScreen(screenPoint, z);
                    if (!best || depthMetric > best.depthMetric) {
                        best = { type: "roofFace", floor, roof, faceIndex: index, depthMetric };
                    }
                }
            });
        });
        return best;
    }

    surfaceEntryScreenGeometry(entry, label) {
        if (!entry || !entry.floor) throw new Error(`${label} requires a surface entry with a floor`);
        return entry.type === "roof"
            ? this.roofScreenGeometry(floorRoofView(entry.floor, entry.roof), label)
            : this.surfaceScreenGeometry(entry.floor, entry.z, label);
    }

    worldDepthMetric(point, z) {
        const camera = this.state.camera;
        const cameraZ = Number.isFinite(Number(camera.z)) ? Number(camera.z) : 0;
        const rotated = this.rotatePointForCamera(point);
        const pitch = cameraPitchProjectionFactors(camera);
        const camDy = Number(rotated.y) - Number(camera.y);
        const camDz = Number(z) - cameraZ;
        return camDy * pitch.height + camDz * pitch.floor;
    }

    surfaceDepthMetricAtScreen(screenPoint, z) {
        const point = screenPointToClipPoint(screenPoint, "surface screen pick");
        const camera = this.state.camera;
        const cameraZ = Number.isFinite(Number(camera.z)) ? Number(camera.z) : 0;
        const zoom = Number(camera.zoom);
        if (!Number.isFinite(zoom) || zoom <= 0) {
            throw new Error("surface screen picking requires a positive camera zoom");
        }
        const pitch = cameraPitchProjectionFactors(camera);
        const camDz = Number(z) - cameraZ;
        const projectedY = (point[1] - this.app.screen.height / 2) / (zoom * GAME_XY_RATIO);
        const camDy = (projectedY + camDz * pitch.height) / pitch.floor;
        return camDy * pitch.height + camDz * pitch.floor;
    }

    wallScreenPickDepthMetric(wall, floor, wallEntries = null) {
        const baseZ = getFloorElevation(floor);
        const profile = this.wallRenderProfilePoints(wall, floor, wallEntries, `wall ${wall && wall.id} screen pick profile`);
        if (this.shouldDrawWallCollapsed(wall, floor, wallEntries)) {
            return profile.reduce((best, point) => Math.max(best, this.worldDepthMetric(point, baseZ)), -Infinity);
        }
        const topPoints = this.wallScreenTopProfilePoints(wall, floor, wallEntries);
        return [
            ...profile.map((point) => ({ ...point, z: baseZ })),
            ...topPoints
        ].reduce((best, point) => Math.max(best, this.worldDepthMetric(point, point.z)), -Infinity);
    }

    pickWallAtScreen(screenPoint) {
        const hit = this.pickAtScreen(screenPoint, { includeSurfaces: false, includeColumns: false, includeStairs: false });
        return hit && hit.type === "wall" ? hit : null;
    }

    pickSurfaceAtScreen(screenPoint) {
        const hit = this.pickAtScreen(screenPoint, { includeWalls: false, includeColumns: false, includeStairs: false });
        return hit && (hit.type === "floor" || hit.type === "roof") ? hit : null;
    }

    editorPickRenderItems(options = {}) {
        const includeWalls = options.includeWalls !== false;
        const includeSurfaces = options.includeSurfaces !== false;
        const includeMountedObjects = options.includeMountedObjects !== false;
        const includeGables = options.includeGables !== false;
        const includeColumns = options.includeColumns !== false;
        const includeBeams = options.includeBeams !== false;
        const includeStairs = options.includeStairs !== false;
        const items = [];
        const push = (key, type, payload, displayObj, forceInclude = false) => {
            if (!displayObj) return;
            items.push({
                item: this.editorPickItem(key, type, payload),
                displayObj,
                forceInclude: !!forceInclude
            });
        };
        if (includeSurfaces) {
            for (const candidate of this.lastSurfacePickEntries) {
                if (!candidate || !candidate.floor || (candidate.type !== "floor" && candidate.type !== "roof")) {
                    throw new Error("building editor surface screen picker encountered an invalid render entry");
                }
                push(
                    candidate.type === "roof"
                        ? `${candidate.type}:${roofMeshKey(candidate.floor, candidate.roof)}`
                        : `${candidate.type}:${getFloorId(candidate.floor)}`,
                    candidate.type,
                    { type: candidate.type, floor: candidate.floor, roof: candidate.roof || null, entry: candidate },
                    candidate.mesh
                );
            }
        }
        if (includeWalls) {
            for (const candidate of this.lastWallPickEntries) {
                if (!candidate || !candidate.wall || !candidate.floor) {
                    throw new Error("building editor wall screen picker encountered an invalid render entry");
                }
                push(
                    `wall:${candidate.wall.id}`,
                    "wall",
                    { type: "wall", wall: candidate.wall, floor: candidate.floor, entry: candidate },
                    candidate.mesh || (candidate.entry && candidate.entry.mesh)
                );
            }
        }
        if (includeGables) {
            for (const candidate of this.lastGablePickEntries) {
                if (!candidate || !candidate.floor || !candidate.gable) {
                    throw new Error("building editor gable screen picker encountered an invalid render entry");
                }
                push(
                    `gable:${roofMeshKey(candidate.floor, candidate.roof)}:${candidate.gable.id}`,
                    "gable",
                    { type: "gable", floor: candidate.floor, roof: candidate.roof || null, gable: candidate.gable, entry: candidate },
                    candidate.mesh
                );
            }
        }
        if (includeMountedObjects) {
            for (const candidate of this.lastMountedObjectPickEntries) {
                if (!candidate || !candidate.object || !candidate.floor || (!candidate.wall && candidate.mountKind !== "gable")) {
                    throw new Error("building editor mounted object screen picker encountered an invalid render entry");
                }
                push(
                    `mountedObject:${candidate.object.id}`,
                    "mountedObject",
                    { ...candidate, type: "mountedObject" },
                    candidate.mesh
                );
            }
        }
        if (includeBeams) {
            for (const candidate of (this.lastBeamPickEntries || [])) {
                if (candidate && candidate.beam && candidate.floor && candidate.mesh) {
                    push(`beam:${candidate.beam.id}`, "beam",
                        { type: "beam", beam: candidate.beam, floor: candidate.floor },
                        candidate.mesh);
                }
            }
        }
        if (includeStairs) {
            for (const candidate of (this.lastStairPickEntries || [])) {
                if (candidate && candidate.stair && candidate.floor && candidate.mesh) {
                    const pickMeshes = [];
                    if (candidate.mesh._stairTreadMesh || candidate.mesh._stairRiserMesh) {
                        if (candidate.mesh._stairTreadMesh) pickMeshes.push(candidate.mesh._stairTreadMesh);
                        if (candidate.mesh._stairRiserMesh && candidate.mesh._stairRiserMesh !== candidate.mesh._stairTreadMesh) {
                            pickMeshes.push(candidate.mesh._stairRiserMesh);
                        }
                    } else {
                        pickMeshes.push(candidate.mesh);
                    }
                    if (!pickMeshes.length) {
                        throw new Error(`building editor stair ${candidate.stair.id} screen picker has no renderable mesh parts`);
                    }
                    pickMeshes.forEach((mesh) => {
                        push(`stair:${getFloorId(candidate.floor)}:${candidate.stair.id}`, "stair",
                            { type: "stair", stair: candidate.stair, floor: candidate.floor, entry: candidate },
                            mesh);
                    });
                }
            }
        }
        if (includeColumns) {
            for (const candidate of (this.lastColumnPickEntries || [])) {
                if (candidate && candidate.column && candidate.floor && candidate.mesh) {
                    push(`column:${candidate.column.id}`, "column",
                        { type: "column", column: candidate.column, floor: candidate.floor },
                        candidate.mesh,
                        true);
                }
            }
        }
        return items;
    }

    renderEditorPickPass(options = {}) {
        if (!this.scenePicker || typeof this.scenePicker.buildPickPass !== "function") {
            throw new Error("building editor screen picking requires the regular RenderingScenePicker build pass");
        }
        const camera = this.gameCamera();
        const zoom = Number(this.state.camera.zoom);
        const pitch = cameraPitchProjectionFactors(this.state.camera);
        const viewport = {
            width: Number.isFinite(zoom) && zoom > 0 ? this.app.screen.width / zoom : 1,
            height: Number.isFinite(zoom) && zoom > 0 ? this.app.screen.height / (zoom * GAME_XY_RATIO * pitch.floor) : 1
        };
        const pickRenderItems = this.editorPickRenderItems(options);
        this.scenePicker.buildPickPass({
            app: this.app,
            camera,
            viewport,
            pickRenderItems,
            uiLayer: this.pickerDebugLayer
        }, pickRenderItems.map((entry) => entry.item));
        if (!this.scenePicker.pickRenderTexture) {
            throw new Error("building editor screen picker did not produce a pick render texture");
        }
    }

    hitFromEditorPickItem(item) {
        if (!item || item.type !== "buildingEditorPickTarget") return null;
        const payload = item.editorPickPayload || {};
        if (item.editorPickType === "wall") {
            if (!payload.wall || !payload.floor) throw new Error("building editor wall pick item is missing its payload");
            return { type: "wall", wall: payload.wall, floor: payload.floor };
        }
        if (item.editorPickType === "gable") {
            if (!payload.gable || !payload.floor) throw new Error("building editor gable pick item is missing its payload");
            return { type: "gable", gable: payload.gable, floor: payload.floor, roof: payload.roof || null };
        }
        if (item.editorPickType === "mountedObject") {
            if (!payload.object || !payload.floor) throw new Error("building editor mounted-object pick item is missing its payload");
            return { ...payload, type: "mountedObject" };
        }
        if (item.editorPickType === "floor" || item.editorPickType === "roof") {
            if (!payload.floor) throw new Error(`building editor ${item.editorPickType} pick item is missing its floor`);
            return { type: item.editorPickType, floor: payload.floor, roof: payload.roof || null };
        }
        if (item.editorPickType === "beam") {
            if (!payload.beam || !payload.floor) throw new Error("building editor beam pick item is missing its payload");
            return { type: "beam", beam: payload.beam, floor: payload.floor };
        }
        if (item.editorPickType === "stair") {
            if (!payload.stair || !payload.floor) throw new Error("building editor stair pick item is missing its payload");
            return { type: "stair", stair: payload.stair, floor: payload.floor };
        }
        if (item.editorPickType === "column") {
            if (!payload.column || !payload.floor) throw new Error("building editor column pick item is missing its payload");
            return { type: "column", column: payload.column, floor: payload.floor };
        }
        throw new Error(`unknown building editor screen pick item type: ${item.editorPickType}`);
    }

    pickAtScreen(screenPoint, options = {}) {
        if (!screenPoint || !Number.isFinite(Number(screenPoint.x)) || !Number.isFinite(Number(screenPoint.y))) {
            throw new Error("building editor screen picking requires finite screen coordinates");
        }
        this.renderEditorPickPass(options);
        const renderScale = Number.isFinite(Number(this.scenePicker.pickRenderScale)) && Number(this.scenePicker.pickRenderScale) > 0
            ? Number(this.scenePicker.pickRenderScale)
            : 1;
        const sampled = this.scenePicker.getObjectAtPickPixel(
            Number(screenPoint.x) * renderScale,
            Number(screenPoint.y) * renderScale
        );
        return this.hitFromEditorPickItem(sampled && sampled.object);
    }

    clearScreenPickerDebug() {
        this.pickerDebugLayer.clear();
        this.pickerDepthDebugLayer.removeChildren().forEach((child) => {
            if (child && typeof child.destroy === "function") {
                child.destroy({ children: false, texture: false, baseTexture: false });
            }
        });
        this.pickerDebugLabels.removeChildren().forEach((child) => {
            if (child && typeof child.destroy === "function") child.destroy();
        });
    }

    createSurfacePickerDebugMesh(entry) {
        if (!entry || !entry.floor || (entry.type !== "floor" && entry.type !== "roof")) {
            throw new Error("cannot create picker debug surface mesh without a valid surface entry");
        }
        const floor = entry.type === "roof" ? floorRoofView(entry.floor, entry.roof) : entry.floor;
        const triangulation = entry.type === "roof"
            ? triangulateRoof(floor, this.roofTextureRepeatConfig(roofTexturePath(floor)))
            : triangulateSurface(floor && floor.outerPolygon, Array.isArray(entry.holes) ? entry.holes : floor && floor.holes);
        if (!triangulation) {
            throw new Error(`screen picker debug surface ${entry.type} ${getFloorId(floor)} requires triangulatable geometry`);
        }
        const z = Number(entry.z);
        if (!Number.isFinite(z)) {
            throw new Error(`screen picker debug surface ${entry.type} ${getFloorId(floor)} requires finite z`);
        }
        const positions = new Float32Array(triangulation.points.length * 3);
        triangulation.points.forEach((point, index) => {
            const pointZ = Number.isFinite(Number(point.z)) ? Number(point.z) : z;
            positions[index * 3] = Number(point.x);
            positions[index * 3 + 1] = Number(point.y);
            positions[index * 3 + 2] = pointZ;
        });
        const debugSurfaceId = entry.type === "roof" ? roofMeshKey(entry.floor, entry.roof) : getFloorId(floor);
        return this.createSolidDepthMesh(
            `buildingEditorPickerDebug:${entry.type}:${entry.type === "roof" ? roofMeshKey(entry.floor, entry.roof) : getFloorId(floor)}`,
            positions,
            triangulation.indices,
            debugSurfaceColor(entry.type, debugSurfaceId)
        );
    }

    createWallPickerDebugMesh(entry, wallEntries) {
        const unit = entry && entry.entry && entry.entry.unit;
        if (!entry || !entry.wall || !entry.floor || !unit) {
            throw new Error("cannot create picker debug wall mesh without a valid wall entry");
        }
        if (typeof unit._buildDepthGeometry !== "function") {
            throw new Error(`screen picker debug wall ${entry.wall.id} requires WallSectionUnit depth geometry`);
        }
        this.updateWallTexturePhase(unit, entry.wall, entry.floor);
        const geometry = unit._buildDepthGeometry({
            bottomFaceOnly: this.shouldDrawWallCollapsed(entry.wall, entry.floor, wallEntries),
            localTextureU: this.shouldUseExteriorPerimeterTextureU(entry.wall)
        });
        if (!geometry || !(geometry.positions instanceof Float32Array) || geometry.positions.length < 9) {
            throw new Error(`missing screen picker wall depth geometry for wall ${entry.wall.id}`);
        }
        return this.createSolidDepthMesh(
            `buildingEditorPickerDebug:wall:${entry.wall.id}`,
            geometry.positions,
            geometry.indices,
            debugWallColor(entry.wall.id)
        );
    }

    createStairPickerDebugMesh(entry) {
        if (!entry || !entry.stair || !entry.floor) {
            throw new Error("cannot create picker debug stair mesh without a valid stair entry");
        }
        const triangulation = this.triangulateStairSteps(entry.stair);
        if (!triangulation || !Array.isArray(triangulation.points) || triangulation.points.length < 3) {
            throw new Error(`screen picker debug stair ${entry.stair.id} requires triangulatable geometry`);
        }
        const positions = new Float32Array(triangulation.points.length * 3);
        triangulation.points.forEach((point, index) => {
            if (
                !Number.isFinite(Number(point && point.x)) ||
                !Number.isFinite(Number(point && point.y)) ||
                !Number.isFinite(Number(point && point.z))
            ) {
                throw new Error(`screen picker debug stair ${entry.stair.id} has a non-finite vertex`);
            }
            positions[index * 3] = Number(point.x);
            positions[index * 3 + 1] = Number(point.y);
            positions[index * 3 + 2] = Number(point.z);
        });
        return this.createSolidDepthMesh(
            `buildingEditorPickerDebug:stair:${getFloorId(entry.floor)}:${entry.stair.id}`,
            positions,
            triangulation.indices,
            debugSurfaceColor("stair", `${getFloorId(entry.floor)}:${entry.stair.id}`)
        );
    }

    drawScreenPickerHoverOutline(hit, wallEntries) {
        if (!hit) return;
        const gfx = this.pickerDebugLayer;
        let labelText = "";
        let rings = [];
        if (hit.type === "wall") {
            labelText = `wall ${hit.wall.id}`;
            rings = clipGeometryRings(this.wallScreenPickGeometry(hit.wall, hit.floor, wallEntries), `wall ${hit.wall.id} hover`);
        } else if (hit.type === "mountedObject") {
            labelText = `${hit.object.category === "windows" ? "window" : "door"} ${hit.object.id}`;
            rings = clipGeometryRings(this.mountedObjectScreenGeometry(hit), `${labelText} hover`);
        } else if (hit.type === "gable") {
            labelText = `gable ${hit.gable.id}`;
            rings = this.gableScreenGeometry(floorRoofView(hit.floor, hit.roof), hit.gable, `${labelText} hover`).flat();
        } else if (hit.type === "floor" || hit.type === "roof") {
            const floorId = getFloorId(hit.floor);
            labelText = `${hit.type} ${floorId}`;
            const roofView = hit.type === "roof" ? floorRoofView(hit.floor, hit.roof) : hit.floor;
            const z = hit.type === "roof" ? roofRenderElevation(roofView) : getFloorElevation(hit.floor);
            rings = hit.type === "roof"
                ? this.roofContactScreenGeometry(roofView, `${hit.type} ${floorId} hover`)
                : this.surfaceScreenGeometry(hit.floor, z, `${hit.type} ${floorId} hover`);
            // Flatten one polygon level below.
            rings = rings.flat();
        } else if (hit.type === "beam") {
            labelText = `beam ${hit.beam.id}`;
            rings = this.beamScreenOutlineRings(hit.beam, hit.floor);
        } else if (hit.type === "column") {
            labelText = `column ${hit.column.id}`;
            rings = this.columnScreenOutlineRings(hit.column);
        } else if (hit.type === "stair") {
            labelText = `stair ${hit.stair.id}`;
            rings = clipGeometryRings(this.stairScreenOutlineRings(hit.stair, `${labelText} hover`), `${labelText} hover`);
        } else {
            throw new Error(`cannot draw hover outline for unknown pick hit type: ${hit.type}`);
        }
        if (!rings.length) return;
        let labelPoint = null;
        rings.forEach((ring, index) => {
            const flatRing = flattenClipRing(ring, `${labelText} hover outline ${index}`);
            gfx.lineStyle(3, 0xffffff, 1);
            gfx.drawPolygon(flatRing);
            if (index === 0) labelPoint = clipRingCentroid(ring, `${labelText} hover label`);
        });
        if (!labelPoint) return;
        const label = new PIXI.Text(labelText, {
            fontFamily: "monospace",
            fontSize: 12,
            fill: 0xffffff,
            stroke: 0x000000,
            strokeThickness: 4
        });
        label.anchor.set(0.5);
        label.position.set(labelPoint.x, labelPoint.y);
        this.pickerDebugLabels.addChild(label);
    }

    drawScreenPickerDebug(wallEntries) {
        this.clearScreenPickerDebug();
        if (!this.screenPickerDebug) return;
        const gfx = this.pickerDebugLayer;
        const wallPickEntries = Array.isArray(wallEntries) ? wallEntries : [];
        const surfacePickEntries = Array.isArray(this.lastSurfacePickEntries) ? this.lastSurfacePickEntries : [];
        const mountedObjectPickEntries = Array.isArray(this.lastMountedObjectPickEntries) ? this.lastMountedObjectPickEntries : [];
        const stairPickEntries = Array.isArray(this.lastStairPickEntries) ? this.lastStairPickEntries : [];
        const pointerHit = this.screenPickerDebugPoint ? this.pickAtScreen(this.screenPickerDebugPoint) : null;
        surfacePickEntries.forEach((entry) => {
            this.pickerDepthDebugLayer.addChild(this.createSurfacePickerDebugMesh(entry));
        });
        wallPickEntries.forEach((entry) => {
            this.pickerDepthDebugLayer.addChild(this.createWallPickerDebugMesh(entry, wallEntries));
        });
        mountedObjectPickEntries.forEach((entry) => {
            const worldQuad = this.mountedObjectWorldQuad(entry.object, entry);
            if (!worldQuad) throw new Error(`screen picker debug mounted object ${entry.object.id} is missing quad geometry`);
            this.pickerDepthDebugLayer.addChild(this.createSolidDepthMesh(
                `buildingEditorPickerDebug:mountedObject:${entry.object.id}`,
                new Float32Array(worldQuad.quads.flat().flatMap((point) => [point.x, point.y, point.z])),
                new Uint16Array([0, 1, 2, 0, 2, 3]),
                debugWallColor(entry.object.id)
            ));
        });
        // Picker debug has two parts: register the object in editorPickRenderItems(),
        // and draw a solid debug mesh here. New depth-rendered object types need both.
        stairPickEntries.forEach((entry) => {
            this.pickerDepthDebugLayer.addChild(this.createStairPickerDebugMesh(entry));
        });
        this.drawScreenPickerHoverOutline(pointerHit, wallEntries);
        if (this.screenPickerDebugPoint) {
            const point = screenPointToClipPoint(this.screenPickerDebugPoint, "screen picker debug cursor");
            gfx.lineStyle(2, 0x000000, 1);
            gfx.moveTo(point[0] - 7, point[1]);
            gfx.lineTo(point[0] + 7, point[1]);
            gfx.moveTo(point[0], point[1] - 7);
            gfx.lineTo(point[0], point[1] + 7);
            gfx.drawCircle(point[0], point[1], 4);
        }
    }

    shouldDrawWallCollapsed(wall, floor, wallEntries = null) {
        if (this.state.renderStyle() !== "interior") return false;
        if (this.state.selectedWallIds().length > 0) return false;
        if (!this.wallIsInFrontOfFloor(wall, floor, wallEntries)) return false;
        const openArea = this.floorOpenAreaScreenGeometry(floor, wallEntries);
        if (clipGeometryArea(openArea) <= GEOMETRY_EPSILON) return false;
        const wallImage = this.wallScreenImagePolygon(wall, floor, wallEntries);
        const intersection = polygonClipper().intersection(openArea, wallImage);
        return clipGeometryArea(intersection) > COLLAPSED_WALL_INTERSECTION_AREA_EPSILON;
    }

    wallIsInFrontOfFloor(wall, floor, wallEntries = null) {
        const baseZ = getFloorElevation(floor);
        const floorCenter = polygonCentroid(floor.outerPolygon || []);
        if (!finite2dPoint(floorCenter)) {
            throw new Error(`collapsed wall visibility requires floor ${getFloorId(floor)} to have a finite centroid`);
        }
        const floorDepth = this.worldDepthMetric(floorCenter, baseZ);
        const profile = this.wallRenderProfilePoints(wall, floor, wallEntries, `wall ${wall && wall.id} front/back visibility profile`);
        const wallDepth = profile.reduce((total, point) => total + this.worldDepthMetric(point, baseZ), 0) / profile.length;
        return wallDepth > floorDepth + COLLAPSED_WALL_FRONT_DEPTH_EPSILON;
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
                    topProfile: wall.topProfile || null,
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
            this.applyResolvedGeometryToWallUnit(unit, wall);
            entry = { signature, unit, mesh: null };
            this.wallUnitById.set(wallId, entry);
        }
        return entry;
    }

    renderWallUnit(wall, floor, alpha, wallEntries = null) {
        const entry = this.ensureWallUnit(wall, floor);
        if (!entry) return null;
        this.hideShedClippedWallMesh(wall);
        this.updateWallTexturePhase(entry.unit, wall, floor);
        const selected = this.state.isWallSelected(wall);
        const bottomFaceOnly = this.shouldDrawWallCollapsed(wall, floor, wallEntries);
        const localTextureU = this.shouldUseExteriorPerimeterTextureU(wall);
        const sceneBrightness = this.wallSceneBrightnessPercent(wall, floor);
        const mesh = entry.unit.getDepthMeshDisplayObject({
            camera: this.gameCamera(),
            app: this.app,
            viewscale: Number(this.state.camera.zoom),
            xyratio: GAME_XY_RATIO,
            cameraPitch: cameraPitch(this.state.camera),
            cameraRotation: Number(this.state.camera.rotation) || 0,
            cameraRotationCenter: this.state.camera.rotationCenter || this.state.buildingCenter(),
            tint: selected ? 0xffd27a : 0xffffff,
            alpha,
            brightness: sceneBrightness + (selected ? 12 : 0),
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

    columnTopHeightsForRender(column, floor) {
        const verts = columnVertices(column);
        if (!verts || verts.length < 3) {
            throw new Error(`column ${column.id} roof clipping requires at least three vertices`);
        }
        if (column.topHeights === undefined || column.topHeights === null) return null;
        if (!Array.isArray(column.topHeights) || column.topHeights.length !== verts.length) {
            throw new Error(`column ${column.id} topHeights must match its footprint vertex count`);
        }
        return column.topHeights.map((value, index) => {
            const height = Number(value);
            if (!Number.isFinite(height) || height <= 0) {
                throw new Error(`column ${column.id} topHeights[${index}] must be a positive finite number`);
            }
            return height;
        });
    }

    ensureColumnUnit(column, floor) {
        const ColumnUnit = globalThis.ColumnUnit;
        if (typeof ColumnUnit !== "function") return null;
        const pos = column.position || {};
        const topHeights = this.columnTopHeightsForRender(column, floor);
        const topHeightSig = Array.isArray(topHeights) ? topHeights.map((value) => Number(value).toFixed(6)).join(",") : "";
        const sig = `${pos.x},${pos.y}|${column.sideCount}|${column.width ?? ""}|${column.depth ?? ""}|${column.size}|${column.rotation}|${column.height}|${column.bottomZ}|${column.texturePath}|${column.wallId ?? ""}|${topHeightSig}`;
        const colId = String(column.id);
        let entry = this.columnUnitById.get(colId);
        if (!entry || entry.signature !== sig) {
            if (entry && entry.unit && typeof entry.unit.remove === "function") entry.unit.remove();
            const unit = new ColumnUnit({
                id: Number.isInteger(Number(column.id)) ? Number(column.id) : undefined,
                x: Number(pos.x),
                y: Number(pos.y),
                sideCount: column.sideCount,
                size: column.size,
                width: column.width,
                depth: column.depth,
                rotation: column.rotation,
                height: column.height,
                topHeights,
                bottomZ: column.bottomZ,
                texturePath: column.texturePath,
                deferSetup: true
            });
            unit.rebuildMesh3d();
            entry = { signature: sig, unit, mesh: null };
            this.columnUnitById.set(colId, entry);
        }
        return entry;
    }

    renderColumnUnit(column, floor, alpha) {
        const entry = this.ensureColumnUnit(column, floor);
        if (!entry) return null;
        const selected = this.state.isColumnSelected(column.id);
        const mesh = entry.unit.getDepthMeshDisplayObject({
            camera: this.gameCamera(),
            app: this.app,
            viewscale: Number(this.state.camera.zoom),
            xyratio: GAME_XY_RATIO,
            cameraPitch: cameraPitch(this.state.camera),
            cameraRotation: Number(this.state.camera.rotation) || 0,
            cameraRotationCenter: this.state.camera.rotationCenter || this.state.buildingCenter(),
            tint: selected ? 0xffd27a : 0xffffff,
            alpha,
            brightness: selected ? 12 : 0
        });
        if (!mesh) return null;
        if (mesh.parent !== this.buildingUnit) this.buildingUnit.addChild(mesh);
        mesh.visible = true;
        entry.mesh = mesh;
        return mesh;
    }

    hideShedClippedWallMesh(wall) {
        const wallId = String(wall && wall.id);
        const entry = this.clippedWallMeshById && this.clippedWallMeshById.get(wallId);
        if (entry && entry.mesh) entry.mesh.visible = false;
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
        return this.renderWallUnit(wall, floor, alpha, wallEntries);
    }

    rendererScreenSize() {
        const width = Math.max(1, Math.round(Number(this.app && this.app.screen && this.app.screen.width) || 0));
        const height = Math.max(1, Math.round(Number(this.app && this.app.screen && this.app.screen.height) || 0));
        if (!(width > 0) || !(height > 0)) {
            throw new Error("playtest floor snapshot requires a valid renderer screen size");
        }
        return { width, height };
    }

    ensureRenderTextureDepthAttachment(renderTexture, label = "render texture") {
        const framebuffer = renderTexture && renderTexture.baseTexture && renderTexture.baseTexture.framebuffer
            ? renderTexture.baseTexture.framebuffer
            : (renderTexture && renderTexture.framebuffer ? renderTexture.framebuffer : null);
        if (!framebuffer) {
            throw new Error(`${label} is missing a framebuffer; depth-tested rendering cannot be used.`);
        }
        if (typeof framebuffer.enableDepth === "function") {
            framebuffer.enableDepth();
        } else if (Object.prototype.hasOwnProperty.call(framebuffer, "depth")) {
            framebuffer.depth = true;
        } else {
            throw new Error(`${label} framebuffer does not support a depth attachment.`);
        }
        return framebuffer;
    }

    clearDepthTestedRenderTarget(resources, label = "render target") {
        const renderer = resources && resources.renderer;
        const texture = resources && resources.texture;
        const gl = renderer && renderer.gl;
        const framebuffer = texture && texture.baseTexture && texture.baseTexture.framebuffer
            ? texture.baseTexture.framebuffer
            : (texture && texture.framebuffer ? texture.framebuffer : null);
        if (!gl || !framebuffer || !renderer.framebuffer || typeof renderer.framebuffer.bind !== "function") {
            throw new Error(`${label} cannot be cleared with a depth buffer`);
        }
        renderer.framebuffer.bind(framebuffer);
        gl.clearColor(0, 0, 0, 0);
        gl.clearDepth(1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        return true;
    }

    ensurePlaytestFloorSnapshotResources() {
        if (!PIXI.RenderTexture || !PIXI.Sprite) {
            throw new Error("playtest floor snapshot requires Pixi render texture support");
        }
        const renderer = this.app && this.app.renderer;
        if (!renderer) throw new Error("playtest floor snapshot requires an app renderer");
        const { width, height } = this.rendererScreenSize();
        const sizeKey = `${width}x${height}`;
        if (
            !this.playtestFloorSnapshotRenderTexture ||
            !this.playtestFloorSnapshotSize ||
            this.playtestFloorSnapshotSize.key !== sizeKey
        ) {
            if (
                this.playtestFloorSnapshotRenderTexture &&
                typeof this.playtestFloorSnapshotRenderTexture.destroy === "function"
            ) {
                this.playtestFloorSnapshotRenderTexture.destroy(true);
            }
            this.playtestFloorSnapshotRenderTexture = PIXI.RenderTexture.create({ width, height });
            this.playtestFloorSnapshotSize = { key: sizeKey, width, height };
        }
        this.ensureRenderTextureDepthAttachment(
            this.playtestFloorSnapshotRenderTexture,
            "playtest floor snapshot texture"
        );
        if (!this.playtestFloorSnapshotSprite) {
            this.playtestFloorSnapshotSprite = new PIXI.Sprite(this.playtestFloorSnapshotRenderTexture);
            this.playtestFloorSnapshotSprite.name = "buildingEditorPlaytestFloorSnapshot";
            this.playtestFloorSnapshotSprite.interactive = false;
            this.playtestFloorSnapshotSprite.visible = false;
            if (Object.prototype.hasOwnProperty.call(this.playtestFloorSnapshotSprite, "renderable")) {
                this.playtestFloorSnapshotSprite.renderable = false;
            }
        } else if (this.playtestFloorSnapshotSprite.texture !== this.playtestFloorSnapshotRenderTexture) {
            this.playtestFloorSnapshotSprite.texture = this.playtestFloorSnapshotRenderTexture;
        }
        this.applyPlaytestFloorSnapshotSpriteTransform(this.playtestFloorSnapshotSprite, width, height);
        if (PIXI.BLEND_MODES) {
            this.playtestFloorSnapshotSprite.blendMode = PIXI.BLEND_MODES.NORMAL;
        }
        return {
            renderer,
            texture: this.playtestFloorSnapshotRenderTexture,
            sprite: this.playtestFloorSnapshotSprite,
            width,
            height
        };
    }

    playtestFloorSnapshotCameraState() {
        const camera = this.state && this.state.camera;
        if (!camera) throw new Error("playtest floor snapshot requires a camera");
        const pitch = cameraPitchProjectionFactors(camera);
        const state = {
            x: Number(camera.x),
            y: Number(camera.y),
            z: Number.isFinite(Number(camera.z)) ? Number(camera.z) : 0,
            zoom: Number(camera.zoom),
            rotation: Number(camera.rotation) || 0,
            pitch: pitch.pitch,
            pitchFloor: pitch.floor,
            pitchHeight: pitch.height,
            xyratio: GAME_XY_RATIO
        };
        if (
            !Number.isFinite(state.x) ||
            !Number.isFinite(state.y) ||
            !Number.isFinite(state.z) ||
            !(state.zoom > 0) ||
            !Number.isFinite(state.rotation) ||
            !Number.isFinite(state.pitch)
        ) {
            throw new Error("playtest floor snapshot has invalid camera state");
        }
        return state;
    }

    playtestFloorSnapshotScreenOffset(snapshot) {
        if (!snapshot || !snapshot.camera) {
            throw new Error("playtest floor snapshot is missing camera state");
        }
        const captured = snapshot.camera;
        const current = this.playtestFloorSnapshotCameraState();
        if (Math.abs(current.rotation - captured.rotation) > 0.000001) {
            throw new Error("playtest floor snapshot cannot track camera rotation changes during a fade");
        }
        if (Math.abs(current.pitch - captured.pitch) > 0.000001) {
            throw new Error("playtest floor snapshot cannot track camera pitch changes during a fade");
        }
        if (Math.abs(current.zoom - captured.zoom) > 0.000001) {
            throw new Error("playtest floor snapshot cannot track camera zoom changes during a fade");
        }
        return {
            x: (captured.x - current.x) * current.zoom,
            y: (
                (captured.y - current.y) * current.pitchFloor +
                (current.z - captured.z) * current.pitchHeight
            ) * current.zoom * current.xyratio
        };
    }

    applyPlaytestFloorSnapshotSpriteTransform(sprite, width, height, offsetX = 0, offsetY = 0) {
        if (!sprite) throw new Error("missing playtest floor snapshot sprite");
        const textureRef = sprite.texture || this.playtestFloorSnapshotRenderTexture || null;
        const textureWidth = Number(textureRef && textureRef.width) || Number(width);
        const textureHeight = Number(textureRef && textureRef.height) || Number(height);
        if (!(textureWidth > 0) || !(textureHeight > 0)) {
            throw new Error("playtest floor snapshot has invalid texture size");
        }
        if (sprite.anchor && typeof sprite.anchor.set === "function") sprite.anchor.set(0, 0);
        sprite.position.set(Number(offsetX) || 0, Number(height) + (Number(offsetY) || 0));
        sprite.scale.set(Number(width) / textureWidth, -(Number(height) / textureHeight));
    }

    playtestFloorSnapshotSignature(fade) {
        const { width, height } = this.rendererScreenSize();
        return [
            String(fade && fade.fromFloorId || ""),
            String(fade && fade.toFloorId || ""),
            `${width}x${height}`
        ].join("|");
    }

    playtestFloorSnapshotAlpha(fade = this.playtestFloorFadeDescriptor()) {
        if (!fade) return 0;
        return Math.max(0, Math.min(1, 1 - Number(fade.progress)));
    }

    withDisplayObjectsHidden(displayObjects, callback) {
        const hidden = [];
        const seen = new Set();
        const hide = (displayObj) => {
            if (!displayObj || seen.has(displayObj)) return;
            seen.add(displayObj);
            hidden.push({
                displayObj,
                visible: displayObj.visible,
                renderable: displayObj.renderable
            });
            displayObj.visible = false;
            if (Object.prototype.hasOwnProperty.call(displayObj, "renderable")) displayObj.renderable = false;
        };
        displayObjects.forEach(hide);
        try {
            return callback();
        } finally {
            for (let i = hidden.length - 1; i >= 0; i--) {
                const entry = hidden[i];
                entry.displayObj.visible = entry.visible;
                if (Object.prototype.hasOwnProperty.call(entry.displayObj, "renderable")) {
                    entry.displayObj.renderable = entry.renderable;
                }
            }
        }
    }

    capturePlaytestFloorSnapshot(fade) {
        if (!fade) return false;
        const fromFloor = findFloor(this.state.building, fade.fromFloorId);
        const toFloor = findFloor(this.state.building, fade.toFloorId);
        if (!fromFloor) throw new Error(`playtest floor snapshot references missing source level ${fade.fromFloorId}`);
        if (!toFloor) throw new Error(`playtest floor snapshot references missing target level ${fade.toFloorId}`);
        const resources = this.ensurePlaytestFloorSnapshotResources();
        const previousOverride = this.playtestFloorRenderOverride;
        const previousSnapshot = this.playtestFloorSnapshot;
        this.playtestFloorRenderOverride = {
            floorIds: new Set([String(fade.fromFloorId)]),
            suppressFade: true
        };
        try {
            this.drawGameStyleBuilding();
            this.drawMountedObjects();
            const hidden = [
                resources.sprite,
                this.gridLayer,
                this.gridAnchorLayer,
                this.floorLayer,
                this.selectionOutlineLayer,
                this.handleLayer,
                this.draftLayer,
                this.playtestLayer,
                this.playtestWizardSprite,
                this.playtestWizardDepthMesh,
                this.playtestShadowGraphics,
                this.playtestHatGraphics,
                this.pickerDepthDebugLayer,
                this.pickerDebugLayer,
                this.pickerDebugLabels
            ];
            this.withDisplayObjectsHidden(hidden, () => {
                this.clearDepthTestedRenderTarget(resources, "playtest floor snapshot target");
                resources.renderer.render(this.root, resources.texture, false);
            });
        } catch (error) {
            throw new Error(`playtest floor snapshot capture failed: ${error && error.message ? error.message : error}`);
        } finally {
            this.playtestFloorRenderOverride = previousOverride;
            this.playtestFloorSnapshot = previousSnapshot;
        }
        this.playtestFloorSnapshot = {
            active: true,
            fromFloorId: String(fade.fromFloorId),
            toFloorId: String(fade.toFloorId),
            signature: this.playtestFloorSnapshotSignature(fade),
            width: resources.width,
            height: resources.height,
            camera: this.playtestFloorSnapshotCameraState()
        };
        resources.sprite.alpha = this.playtestFloorSnapshotAlpha(fade);
        resources.sprite.visible = true;
        if (Object.prototype.hasOwnProperty.call(resources.sprite, "renderable")) resources.sprite.renderable = true;
        return true;
    }

    ensurePlaytestFloorSnapshotForCurrentFade() {
        const fade = this.playtestFloorFadeDescriptor();
        if (!fade) {
            this.hidePlaytestFloorSnapshot();
            return false;
        }
        const signature = this.playtestFloorSnapshotSignature(fade);
        const snapshot = this.playtestFloorSnapshot;
        if (
            snapshot &&
            snapshot.active === true &&
            snapshot.signature === signature &&
            String(snapshot.fromFloorId || "") === String(fade.fromFloorId) &&
            String(snapshot.toFloorId || "") === String(fade.toFloorId)
        ) {
            return false;
        }
        return this.capturePlaytestFloorSnapshot(fade);
    }

    hidePlaytestFloorSnapshot() {
        const sprite = this.playtestFloorSnapshotSprite;
        if (sprite) {
            sprite.visible = false;
            if (Object.prototype.hasOwnProperty.call(sprite, "renderable")) sprite.renderable = false;
            if (sprite.parent) sprite.parent.removeChild(sprite);
        }
        this.playtestFloorSnapshot = null;
    }

    setPlaytestFloorSnapshotDisplayIndex() {
        const sprite = this.playtestFloorSnapshotSprite;
        if (!sprite || !this.root || sprite.parent !== this.root || typeof this.root.setChildIndex !== "function") return;
        const before = this.selectionOutlineLayer;
        let targetIndex = this.root.children.length - 1;
        if (before && before.parent === this.root && typeof this.root.getChildIndex === "function") {
            targetIndex = Math.max(0, this.root.getChildIndex(before));
        }
        if (this.root.getChildIndex(sprite) !== targetIndex) {
            this.root.setChildIndex(sprite, targetIndex);
        }
    }

    renderPlaytestFloorSnapshot() {
        const fade = this.playtestFloorFadeDescriptor();
        if (!fade || !(this.playtestFloorSnapshot && this.playtestFloorSnapshot.active === true)) {
            this.hidePlaytestFloorSnapshot();
            return null;
        }
        const resources = this.ensurePlaytestFloorSnapshotResources();
        const alpha = this.playtestFloorSnapshotAlpha(fade);
        if (!(alpha > 0.001)) {
            this.hidePlaytestFloorSnapshot();
            return null;
        }
        const sprite = resources.sprite;
        if (sprite.parent !== this.root) this.root.addChild(sprite);
        this.setPlaytestFloorSnapshotDisplayIndex();
        const offset = this.playtestFloorSnapshotScreenOffset(this.playtestFloorSnapshot);
        this.applyPlaytestFloorSnapshotSpriteTransform(
            sprite,
            this.playtestFloorSnapshot.width || resources.width,
            this.playtestFloorSnapshot.height || resources.height,
            offset.x,
            offset.y
        );
        sprite.alpha = alpha;
        sprite.visible = true;
        if (Object.prototype.hasOwnProperty.call(sprite, "renderable")) sprite.renderable = true;
        if (PIXI.BLEND_MODES) sprite.blendMode = PIXI.BLEND_MODES.NORMAL;
        return sprite;
    }

    renderedFloors() {
        const override = this.playtestFloorRenderOverride;
        if (override && override.floorIds instanceof Set) {
            return [...getBuildingFloors(this.state.building)]
                .filter((floor) => override.floorIds.has(getFloorId(floor)))
                .sort((a, b) => getFloorElevation(a) - getFloorElevation(b));
        }
        if (this.state.renderStyle() === "exterior") {
            return [...getBuildingFloors(this.state.building)]
                .sort((a, b) => getFloorElevation(a) - getFloorElevation(b));
        }
        const fade = this.playtestFloorFadeDescriptor();
        if (fade) {
            const fromFloor = findFloor(this.state.building, fade.fromFloorId);
            const toFloor = findFloor(this.state.building, fade.toFloorId);
            if (!fromFloor) throw new Error(`playtest floor fade references missing source level ${fade.fromFloorId}`);
            if (!toFloor) throw new Error(`playtest floor fade references missing target level ${fade.toFloorId}`);
            return [toFloor];
        }
        const floor = this.state.selectedFloor();
        return floor ? [floor] : [];
    }

    playtestFloorFadeDescriptor() {
        const fade = this.state && this.state.playtestFloorFade ? this.state.playtestFloorFade : null;
        if (!fade) return null;
        const fromFloorId = String(fade.fromFloorId || "");
        const toFloorId = String(fade.toFloorId || "");
        const progress = Number(fade.progress);
        if (!fromFloorId || !toFloorId) throw new Error("playtest floor fade requires level ids");
        if (!Number.isFinite(progress)) throw new Error("playtest floor fade requires finite progress");
        return {
            fromFloorId,
            toFloorId,
            progress: Math.max(0, Math.min(1, progress))
        };
    }

    renderedFloorAlphaMap(floors, exterior) {
        const alphaById = new Map();
        floors.forEach((floor) => {
            const floorId = getFloorId(floor);
            const alpha = exterior ? 0.92 : 1;
            alphaById.set(floorId, Math.max(0, Math.min(1, alpha)));
        });
        return alphaById;
    }

    drawGameStyleBuilding() {
        this.floorLayer.clear();
        this.wallLayer.clear();
        this.clearScreenPickerDebug();
        this.collapsedWallGeometryByFloorId.clear();
        this.lastWallPickEntries = [];
        this.lastSurfacePickEntries = [];
        this.lastMountedObjectPickEntries = [];
        this.lastGablePickEntries = [];
        this.lastBeamPickEntries = [];
        this.lastColumnPickEntries = [];
        this.lastStairPickEntries = [];
        const floors = this.renderedFloors();
        const floorIds = new Set(floors.map((floor) => getFloorId(floor)));
        const exterior = this.state.renderStyle() === "exterior";
        const floorAlphaById = this.renderedFloorAlphaMap(floors, exterior);
        const liveFloorMeshIds = new Set();
        const liveRoofMeshIds = new Set();
        const liveGableWallIds = new Set();
        const liveWallIds = new Set();
        const wallEntries = [];
        this.buildingUnit.alpha = exterior ? 0.92 : 1;
        floors.forEach((floor) => {
            const floorAlpha = floorAlphaById.get(getFloorId(floor)) ?? (exterior ? 0.92 : 1);
            const mesh = this.syncFloorMesh(floor, floorAlpha);
            if (mesh) {
                const holes = this.floorSurfaceHoles(floor);
                liveFloorMeshIds.add(getFloorId(floor));
                this.lastSurfacePickEntries.push({
                    type: "floor",
                    floor,
                    z: getFloorElevation(floor),
                    holes,
                    mesh
                });
            }
            const selection = this.state.selection || {};
            getFloorRoofs(floor).forEach((roof) => {
                const selectedRoofVisible = selection.kind === "roof"
                    ? this.state.isRoofSelected(getFloorId(floor), roof.id)
                    : (selection.kind === "roofVertex" || selection.kind === "roofPeak" || selection.kind === "roofShedDirection" || selection.kind === "gable" || selection.kind === "gableHandle") &&
                        selection.floorId === getFloorId(floor) &&
                        (!selection.roofId || String(selection.roofId) === String(roof.id));
                if (exterior || selectedRoofVisible) {
                    const roofView = floorRoofView(floor, roof);
                    const roofMesh = this.syncRoofMesh(floor, floorAlpha, roof);
                    if (roofMesh) {
                        const key = roofMeshKey(floor, roof);
                        liveRoofMeshIds.add(key);
                        this.lastSurfacePickEntries.push({
                            type: "roof",
                            floor,
                            roof,
                            z: roofRenderElevation(roofView),
                            mesh: roofMesh
                        });
                    }
                    getRoofGables(roof).forEach((gable) => {
                        const roofView = floorRoofView(floor, roof);
                        const gableMesh = this.syncGableWallMesh(roofView, gable, floorAlpha);
                        liveGableWallIds.add(`${roofMeshKey(floor, roof)}:${gable.id}`);
                        this.lastGablePickEntries.push({
                            type: "gable",
                            floor,
                            roof,
                            gable,
                            mesh: gableMesh
                        });
                    });
                }
            });
        });
        getBuildingWalls(this.state.building).forEach((wall) => {
            const floor = findFloor(this.state.building, wall.fragmentId || wall.floorId);
            if (!floor || !floorIds.has(getFloorId(floor))) return;
            const entry = this.ensureWallUnit(wall, floor);
            if (!entry) return;
            const wallEntry = { wall, floor, entry };
            wallEntries.push(wallEntry);
            liveWallIds.add(String(wall.id));
        });
        this.lastWallPickEntries = wallEntries;
        wallEntries.forEach((entry) => {
            const alpha = floorAlphaById.get(getFloorId(entry.floor)) ?? 1;
            entry.mesh = this.renderWallUnit(entry.wall, entry.floor, alpha, wallEntries);
        });
        for (const [floorId, entry] of this.floorMeshById.entries()) {
            if (!liveFloorMeshIds.has(floorId) && entry && entry.mesh) entry.mesh.visible = false;
        }
        for (const [roofKey, entry] of this.roofMeshById.entries()) {
            if (!liveRoofMeshIds.has(roofKey) && entry && entry.mesh) entry.mesh.visible = false;
        }
        for (const [gableKey, entry] of this.gableWallMeshById.entries()) {
            if (!liveGableWallIds.has(gableKey) && entry && entry.mesh) entry.mesh.visible = false;
        }
        for (const [wallId, entry] of this.wallUnitById.entries()) {
            if (!liveWallIds.has(wallId) && entry && entry.mesh) entry.mesh.visible = false;
        }
        for (const [wallId, entry] of this.clippedWallMeshById.entries()) {
            if (!liveWallIds.has(wallId) && entry && entry.mesh) entry.mesh.visible = false;
        }
        const liveColumnIds = new Set();
        floors.forEach((floor) => {
            getFloorBeams(floor).forEach((beam) => {
                const mesh = this.createBeamPickMesh(beam, floor);
                if (mesh) this.lastBeamPickEntries.push({ beam, floor, mesh });
            });
            getFloorColumns(floor).forEach((column) => {
                const pickMesh = this.createColumnPickMesh(column, floor);
                this.lastColumnPickEntries.push({ column, floor, mesh: pickMesh });
                const alpha = floorAlphaById.get(getFloorId(floor)) ?? 1;
                this.renderColumnUnit(column, floor, alpha);
                liveColumnIds.add(String(column.id));
            });
        });
        for (const [colId, entry] of this.columnUnitById.entries()) {
            if (!liveColumnIds.has(colId) && entry && entry.mesh) entry.mesh.visible = false;
        }
        this.drawStairs();
        this.drawBeams();
    }

    drawFloorUnderlay(gfx) {
        const floor = typeof this.state.floorUnderlay === "function" ? this.state.floorUnderlay() : null;
        if (!floor) return;
        const selectedFloor = this.state.selectedFloor();
        const elevation = selectedFloor ? getFloorElevation(selectedFloor) : getFloorElevation(floor);
        const drawRing = (ring, color, alpha) => {
            if (!Array.isArray(ring) || ring.length < 3) return;
            const points = ring.map((point) => this.worldToScreen(point, elevation));
            gfx.lineStyle(2, color, alpha);
            this.drawDashedScreenLoop(gfx, points, 8, 6);
            points.forEach((point) => {
                gfx.beginFill(color, 0.42);
                gfx.lineStyle(1, 0x111820, 0.75);
                gfx.drawCircle(point.x, point.y, 3.25);
                gfx.endFill();
            });
        };
        drawRing(floor.outerPolygon, 0xb7c6d1, 0.72);
        (Array.isArray(floor.holes) ? floor.holes : []).forEach((ring) => {
            drawRing(ring, 0xff9c85, 0.5);
        });
    }

    drawDashedScreenLoop(gfx, points, dashLength = 8, gapLength = 6) {
        if (!Array.isArray(points) || points.length < 2) return;
        for (let index = 0; index < points.length; index++) {
            const a = points[index];
            const b = points[(index + 1) % points.length];
            const dx = Number(b.x) - Number(a.x);
            const dy = Number(b.y) - Number(a.y);
            const length = Math.hypot(dx, dy);
            if (!Number.isFinite(length) || length <= 0.000001) continue;
            const ux = dx / length;
            const uy = dy / length;
            let cursor = 0;
            while (cursor < length) {
                const start = cursor;
                const end = Math.min(length, cursor + dashLength);
                gfx.moveTo(Number(a.x) + ux * start, Number(a.y) + uy * start);
                gfx.lineTo(Number(a.x) + ux * end, Number(a.y) + uy * end);
                cursor += dashLength + gapLength;
            }
        }
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
            const selected = this.state.isWallSelected(wall);
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

    strokeClipRing(gfx, ring, label, width, color, alpha) {
        gfx.lineStyle(width, color, alpha);
        gfx.drawPolygon(flattenClipRing(ring, label));
    }

    drawClipGeometryOutline(gfx, geometry, label) {
        const rings = clipGeometryRings(geometry, label);
        rings.forEach((ring, index) => {
            this.strokeClipRing(gfx, ring, `${label} shadow ${index}`, 7, SELECTION_OUTLINE_SHADOW_COLOR, 0.9);
        });
        rings.forEach((ring, index) => {
            this.strokeClipRing(gfx, ring, `${label} blue ${index}`, 3, SELECTION_OUTLINE_COLOR, 1);
        });
    }

    gableMountedObjectPlacementFromSegment(object, floor, gable, segmentIndex, wallT, options = {}) {
        const geometry = gableWorldGeometry(floor, gable);
        const segment = geometry.wallSegments[segmentIndex];
        if (!segment) {
            throw new Error(`mounted wall object ${object && object.id} references missing gable wall segment ${segmentIndex}`);
        }
        const sections = gableMountSections(geometry, `roof ${getFloorId(floor)} gable ${gable && gable.id}`);
        const section = gableMountSectionForSegment(sections, segmentIndex, `mounted wall object ${object && object.id}`);
        const piece = gableMountPieceForSegment(section, segmentIndex, `mounted wall object ${object && object.id}`);
        const segmentLength = piece.endAlong - piece.startAlong;
        const sectionAlong = piece.startAlong + segmentLength * Math.max(0, Math.min(1, Number(wallT)));
        const sectionT = section.length > GEOMETRY_EPSILON ? sectionAlong / section.length : 0;
        const a = section.bottomStart;
        const b = section.bottomEnd;
        const dx = Number(b.x) - Number(a.x);
        const dy = Number(b.y) - Number(a.y);
        const length = Math.hypot(dx, dy);
        if (!(length > GEOMETRY_EPSILON)) {
            throw new Error(`mounted wall object ${object && object.id} gable segment ${segmentIndex} has zero length`);
        }
        const t = Math.max(0, Math.min(1, Number(wallT)));
        if (!Number.isFinite(t)) throw new Error(`mounted wall object ${object && object.id} wallT must be finite`);
        const ux = dx / length;
        const uy = dy / length;
        const nx = -uy;
        const ny = ux;
        const facingSign = Number(options.mountedWallFacingSign ?? (object && object.mountedWallFacingSign)) >= 0 ? 1 : -1;
        const wallCenter = {
            x: Number(a.x) + dx * sectionT,
            y: Number(a.y) + dy * sectionT
        };
        const halfThickness = GABLE_MOUNT_WALL_THICKNESS * 0.5;
        const faceCenter = {
            x: wallCenter.x + nx * halfThickness * facingSign,
            y: wallCenter.y + ny * halfThickness * facingSign
        };
        const topAtSectionAlong = (along) => gableMountPointAtAlong(section, along, `mounted wall object ${object && object.id}`).topZ;
        const width = Number(options.width ?? (object && object.width));
        const height = Number(options.height ?? (object && object.height));
        const halfWidth = Number.isFinite(width) && width > 0 ? width * 0.5 : 0;
        const availableHeight = Math.max(0, Math.min(
            topAtSectionAlong(sectionAlong - halfWidth),
            topAtSectionAlong(sectionAlong + halfWidth)
        ) - geometry.rimZ);
        return {
            object,
            mountKind: "gable",
            gable,
            gableId: gable.id,
            gableSegmentIndex: segmentIndex,
            floor,
            points: [segment.bottomStart, segment.bottomEnd],
            wallT: t,
            wallLength: length,
            resizePoints: [section.bottomStart, section.bottomEnd],
            resizeWallT: sectionT,
            resizeWallLength: section.length,
            wallCenter,
            faceCenter,
            sectionDirX: ux,
            sectionDirY: uy,
            sectionNormalX: nx,
            sectionNormalY: ny,
            mountedWallFacingSign: facingSign,
            wallThickness: GABLE_MOUNT_WALL_THICKNESS,
            wallHeight: availableHeight,
            wallBottomZ: geometry.rimZ,
            zOffset: Number(options.zOffset ?? (object && object.zOffset)) || 0,
            placementRotation: Number(options.placementRotation ?? (object && object.placementRotation)) || (Math.atan2(uy, ux) * 180 / Math.PI),
            availableHeight,
            valid: height > 0 ? availableHeight + GEOMETRY_EPSILON >= height : true
        };
    }

    resolveGableMountedPlacementCandidate(floor, gable, asset, screenPoint, options = {}) {
        if (!floor || !gable || !asset || !screenPoint) return null;
        const category = String(asset.category || "").trim().toLowerCase();
        if (category !== "windows") return null;
        const width = Number(asset.width);
        const height = Number(asset.height);
        if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
            throw new Error("selected gable window asset requires positive width and height");
        }
        const geometry = gableWorldGeometry(floor, gable);
        const sections = gableMountSections(geometry, `roof ${getFloorId(floor)} gable ${gable && gable.id}`);
        const point = screenPointToClipPoint(screenPoint, "gable-mounted window placement");
        let best = null;
        geometry.wallSegments.forEach((segment, segmentIndex) => {
            const section = gableMountSectionForSegment(sections, segmentIndex, `roof ${getFloorId(floor)} gable ${gable && gable.id}`);
            const piece = gableMountPieceForSegment(section, segmentIndex, `roof ${getFloorId(floor)} gable ${gable && gable.id}`);
            const bottomStart = this.worldToScreen(segment.bottomStart, segment.bottomStart.z);
            const bottomEnd = this.worldToScreen(segment.bottomEnd, segment.bottomEnd.z);
            const topEnd = this.worldToScreen(segment.topEnd, segment.topEnd.z);
            const topStart = this.worldToScreen(segment.topStart, segment.topStart.z);
            const polygon = closedClipRing([bottomStart, bottomEnd, topEnd, topStart], `roof ${getFloorId(floor)} gable ${gable.id} wall segment ${segmentIndex} placement`);
            const inside = pointInClipRing(point, polygon);
            const edgeDistance = Math.min(
                distancePointToScreenSegment(screenPoint, bottomStart, bottomEnd),
                distancePointToScreenSegment(screenPoint, bottomEnd, topEnd),
                distancePointToScreenSegment(screenPoint, topEnd, topStart),
                distancePointToScreenSegment(screenPoint, topStart, bottomStart)
            );
            if (!inside && edgeDistance > 12) return;
            const screenDx = Number(bottomEnd.x) - Number(bottomStart.x);
            const screenDy = Number(bottomEnd.y) - Number(bottomStart.y);
            const screenLengthSquared = screenDx * screenDx + screenDy * screenDy;
            if (screenLengthSquared <= GEOMETRY_EPSILON) return;
            let wallT = Math.max(0, Math.min(1, ((Number(screenPoint.x) - Number(bottomStart.x)) * screenDx + (Number(screenPoint.y) - Number(bottomStart.y)) * screenDy) / screenLengthSquared));
            const halfWidth = width * 0.5;
            let sectionAlong = piece.startAlong + (piece.endAlong - piece.startAlong) * wallT;
            const fitsSectionWidth = width <= section.length + GEOMETRY_EPSILON;
            sectionAlong = fitsSectionWidth
                ? Math.max(halfWidth, Math.min(section.length - halfWidth, sectionAlong))
                : Math.max(0, Math.min(section.length, sectionAlong));
            const sectionStartScreen = this.worldToScreen(section.bottomStart, section.bottomStart.z);
            const sectionEndScreen = this.worldToScreen(section.bottomEnd, section.bottomEnd.z);
            const faceMinX = Math.min(Number(sectionStartScreen.x), Number(sectionEndScreen.x));
            const faceMaxX = Math.max(Number(sectionStartScreen.x), Number(sectionEndScreen.x));
            const faceSpanX = faceMaxX - faceMinX;
            const centerSnapPx = Number.isFinite(Number(options.centerSnapPx)) ? Number(options.centerSnapPx) : 10;
            let centerDistPx = Infinity;
            if (faceSpanX > 0.0001) {
                centerDistPx = Math.abs(Number(screenPoint.x) - (faceMinX + faceMaxX) * 0.5);
            } else {
                centerDistPx = Math.abs(Number(screenPoint.y) - (Number(sectionStartScreen.y) + Number(sectionEndScreen.y)) * 0.5);
            }
            let centerSnapActive = false;
            if (Number.isFinite(centerDistPx) && centerDistPx <= centerSnapPx) {
                sectionAlong = fitsSectionWidth
                    ? Math.max(halfWidth, Math.min(section.length - halfWidth, section.length * 0.5))
                    : section.length * 0.5;
                centerSnapActive = true;
            }
            const sectionPoint = gableMountPointAtAlong(section, sectionAlong, `roof ${getFloorId(floor)} gable ${gable.id} placement`);
            segmentIndex = sectionPoint.segmentIndex;
            wallT = sectionPoint.wallT;
            const placementBase = this.gableMountedObjectPlacementFromSegment(
                { id: "preview", width, height, category, mountedWallFacingSign: 1 },
                floor,
                gable,
                segmentIndex,
                wallT,
                { width, height, placementRotation: Math.atan2(Number(segment.bottomEnd.y) - Number(segment.bottomStart.y), Number(segment.bottomEnd.x) - Number(segment.bottomStart.x)) * 180 / Math.PI }
            );
            const frontDepth = this.worldDepthMetric({
                x: placementBase.wallCenter.x + placementBase.sectionNormalX * GABLE_MOUNT_WALL_THICKNESS * 0.5,
                y: placementBase.wallCenter.y + placementBase.sectionNormalY * GABLE_MOUNT_WALL_THICKNESS * 0.5
            }, geometry.rimZ + placementBase.availableHeight * 0.5);
            const backDepth = this.worldDepthMetric({
                x: placementBase.wallCenter.x - placementBase.sectionNormalX * GABLE_MOUNT_WALL_THICKNESS * 0.5,
                y: placementBase.wallCenter.y - placementBase.sectionNormalY * GABLE_MOUNT_WALL_THICKNESS * 0.5
            }, geometry.rimZ + placementBase.availableHeight * 0.5);
            const mountedWallFacingSign = frontDepth >= backDepth ? 1 : -1;
            const pixelsPerZ = Number(this.state.camera.zoom) * GAME_XY_RATIO * cameraPitchProjectionFactors(this.state.camera).height;
            if (!Number.isFinite(pixelsPerZ) || pixelsPerZ <= 0) {
                throw new Error("gable-mounted window placement requires a positive camera zoom");
            }
            const bottomAtCenter = this.worldToScreen(placementBase.wallCenter, geometry.rimZ);
            const mouseAnchorZ = geometry.rimZ + (Number(bottomAtCenter.y) - Number(screenPoint.y)) / pixelsPerZ;
            const anchorY = Number.isFinite(Number(asset.anchorY ?? asset.placeableAnchorY))
                ? Number(asset.anchorY ?? asset.placeableAnchorY)
                : 0.5;
            const minAnchorZ = geometry.rimZ + (1 - anchorY) * height;
            const maxAnchorZ = geometry.rimZ + placementBase.availableHeight - anchorY * height;
            const fitsWidth = fitsSectionWidth;
            const fitsHeight = maxAnchorZ + GEOMETRY_EPSILON >= minAnchorZ;
            const centerAnchorZ = geometry.rimZ + placementBase.availableHeight * 0.5;
            const centerDistanceZPx = Math.abs(mouseAnchorZ - centerAnchorZ) * pixelsPerZ;
            const verticalCenterSnapActive = fitsHeight && Number.isFinite(centerDistanceZPx) && centerDistanceZPx <= centerSnapPx;
            const snappedAnchorZ = verticalCenterSnapActive
                ? Math.max(minAnchorZ, Math.min(maxAnchorZ, centerAnchorZ))
                : fitsHeight
                ? Math.max(minAnchorZ, Math.min(maxAnchorZ, mouseAnchorZ))
                : minAnchorZ;
            const placement = this.gableMountedObjectPlacementFromSegment(
                { id: "preview", width, height, category, mountedWallFacingSign },
                floor,
                gable,
                segmentIndex,
                wallT,
                {
                    width,
                    height,
                    zOffset: snappedAnchorZ - getFloorElevation(floor),
                    mountedWallFacingSign,
                    placementRotation: placementBase.placementRotation
                }
            );
            placement.valid = fitsWidth && fitsHeight;
            placement.reason = !fitsWidth
                ? "window is wider than this gable wall span"
                : (!fitsHeight ? "window is taller than this gable wall span" : "");
            placement.centerSnapActive = centerSnapActive;
            placement.verticalCenterSnapActive = verticalCenterSnapActive;
            placement.verticalSnapKind = verticalCenterSnapActive ? "wallCenter" : null;
            placement.verticalSnapZ = snappedAnchorZ;
            const hitScore = inside ? edgeDistance : edgeDistance + 100;
            if (!best || hitScore < best.hitScore) best = { ...placement, hitScore };
        });
        if (!best) return null;
        const halfWidth = width * 0.5;
        const hitboxHalfThickness = GABLE_MOUNT_WALL_THICKNESS * 0.5;
        best.groundPlaneHitboxOverridePoints = [
            { x: best.wallCenter.x - best.sectionDirX * halfWidth + best.sectionNormalX * hitboxHalfThickness, y: best.wallCenter.y - best.sectionDirY * halfWidth + best.sectionNormalY * hitboxHalfThickness },
            { x: best.wallCenter.x + best.sectionDirX * halfWidth + best.sectionNormalX * hitboxHalfThickness, y: best.wallCenter.y + best.sectionDirY * halfWidth + best.sectionNormalY * hitboxHalfThickness },
            { x: best.wallCenter.x + best.sectionDirX * halfWidth - best.sectionNormalX * hitboxHalfThickness, y: best.wallCenter.y + best.sectionDirY * halfWidth - best.sectionNormalY * hitboxHalfThickness },
            { x: best.wallCenter.x - best.sectionDirX * halfWidth - best.sectionNormalX * hitboxHalfThickness, y: best.wallCenter.y - best.sectionDirY * halfWidth - best.sectionNormalY * hitboxHalfThickness }
        ];
        return best;
    }

    mountedObjectPlacement(object) {
        if (!object) return null;
        if (object.mountKind === "gable") {
            const floor = findFloor(this.state.building, object.floorId);
            if (!floor) throw new Error(`mounted wall object ${object.id} references missing gable floor ${object.floorId}`);
            if (!this.state.isFloorSelected(getFloorId(floor))) return null;
            const gable = getRoofGables(floor).find((candidate) => String(candidate.id) === String(object.gableId));
            if (!gable) throw new Error(`mounted wall object ${object.id} references missing gable ${object.gableId}`);
            return this.gableMountedObjectPlacementFromSegment(
                object,
                floor,
                gable,
                Number(object.gableSegmentIndex),
                object.wallT,
                {
                    width: object.width,
                    height: object.height,
                    zOffset: object.zOffset,
                    mountedWallFacingSign: object.mountedWallFacingSign,
                    placementRotation: object.placementRotation
                }
            );
        }
        const wall = findWall(this.state.building, object.wallId ?? object.mountedWallSectionUnitId);
        if (!wall) throw new Error(`mounted wall object ${object.id} references missing wall ${object.wallId}`);
        const floor = findFloor(this.state.building, wall.fragmentId || wall.floorId);
        if (!floor) throw new Error(`mounted wall object ${object.id} references wall ${wall.id} with missing floor`);
        if (!this.state.isFloorSelected(getFloorId(floor))) return null;
        const points = wallCenterlinePoints(this.state.building, wall, floor);
        if (points.length !== 2) throw new Error(`mounted wall object ${object.id} wall ${wall.id} does not resolve to two points`);
        const a = points[0];
        const b = points[1];
        const dx = Number(b.x) - Number(a.x);
        const dy = Number(b.y) - Number(a.y);
        const length = Math.hypot(dx, dy);
        if (!(length > 0.000001)) throw new Error(`mounted wall object ${object.id} wall ${wall.id} has zero length`);
        const t = Math.max(0, Math.min(1, Number(object.wallT)));
        if (!Number.isFinite(t)) throw new Error(`mounted wall object ${object.id} wallT must be finite`);
        const ux = dx / length;
        const uy = dy / length;
        const nx = -uy;
        const ny = ux;
        const halfThickness = Math.max(0.001, Number(wall.thickness) || 0.001) * 0.5;
        const facingSign = Number(object.mountedWallFacingSign) >= 0 ? 1 : -1;
        const wallCenter = {
            x: Number(a.x) + dx * t,
            y: Number(a.y) + dy * t
        };
        const faceCenter = {
            x: wallCenter.x + nx * halfThickness * facingSign,
            y: wallCenter.y + ny * halfThickness * facingSign
        };
        return {
            object,
            wall,
            floor,
            points,
            wallCenter,
            faceCenter,
            sectionDirX: ux,
            sectionDirY: uy,
            sectionNormalX: nx,
            sectionNormalY: ny,
            mountedWallFacingSign: facingSign,
            wallThickness: halfThickness * 2,
            wallHeight: Number(wall.height),
            wallBottomZ: getFloorElevation(floor),
            zOffset: Number(object.zOffset) || 0,
            placementRotation: Number(object.placementRotation) || (Math.atan2(uy, ux) * 180 / Math.PI)
        };
    }

    mountedObjectWorldQuad(object, placement = null) {
        const resolved = placement || this.mountedObjectPlacement(object);
        if (!resolved) return null;
        const source = object || resolved.object || {};
        const width = Number(source.width);
        const height = Number(source.height);
        if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
            throw new Error(`mounted wall object ${source.id || "preview"} requires positive width and height`);
        }
        const baseZ = getFloorElevation(resolved.floor);
        const anchorY = Number.isFinite(Number(source.placeableAnchorY ?? source.anchorY))
            ? Number(source.placeableAnchorY ?? source.anchorY)
            : (source.category === "windows" ? 0.5 : 1);
        const anchorZ = baseZ + Number(resolved.zOffset || 0);
        const bottomZ = anchorZ - (1 - anchorY) * height;
        const topZ = bottomZ + height;
        const halfWidth = width * 0.5;
        const ux = Number(resolved.sectionDirX);
        const uy = Number(resolved.sectionDirY);
        const nx = Number(resolved.sectionNormalX);
        const ny = Number(resolved.sectionNormalY);
        const facingSign = Number(resolved.mountedWallFacingSign) >= 0 ? 1 : -1;
        const faceBias = 0.012;
        const frontCenter = {
            x: Number(resolved.faceCenter.x) + nx * facingSign * faceBias,
            y: Number(resolved.faceCenter.y) + ny * facingSign * faceBias
        };
        const halfThickness = Math.max(0, Number(resolved.wallThickness) || 0) * 0.5;
        const backCenter = {
            x: Number(resolved.wallCenter.x) - nx * halfThickness * facingSign - nx * facingSign * faceBias,
            y: Number(resolved.wallCenter.y) - ny * halfThickness * facingSign - ny * facingSign * faceBias
        };
        const quadForCenter = (center) => [
            { x: center.x - ux * halfWidth, y: center.y - uy * halfWidth, z: topZ },
            { x: center.x + ux * halfWidth, y: center.y + uy * halfWidth, z: topZ },
            { x: center.x + ux * halfWidth, y: center.y + uy * halfWidth, z: bottomZ },
            { x: center.x - ux * halfWidth, y: center.y - uy * halfWidth, z: bottomZ }
        ];
        const frontQuadPoints = quadForCenter(frontCenter);
        const backQuadPoints = quadForCenter(backCenter);
        const frontCameraY = this.rotatePointForCamera(frontCenter).y;
        const backCameraY = this.rotatePointForCamera(backCenter).y;
        if (!Number.isFinite(frontCameraY) || !Number.isFinite(backCameraY)) {
            throw new Error(`mounted wall object ${source.id || "preview"} face selection requires finite camera-space centers`);
        }
        const visibleFace = frontCameraY >= backCameraY ? "front" : "back";
        const visibleCenter = visibleFace === "front" ? frontCenter : backCenter;
        const quadPoints = visibleFace === "front" ? frontQuadPoints : backQuadPoints;
        return {
            quadPoints,
            frontQuadPoints,
            backQuadPoints,
            quads: [quadPoints],
            visibleFace,
            anchorY,
            bottomCenter: { x: visibleCenter.x, y: visibleCenter.y, z: bottomZ },
            topCenter: { x: visibleCenter.x, y: visibleCenter.y, z: topZ }
        };
    }

    mountedObjectScreenPlacement(object, placement = null) {
        const worldQuad = this.mountedObjectWorldQuad(object, placement);
        if (!worldQuad) return null;
        return {
            ...worldQuad,
            quadPoints: worldQuad.quadPoints.map((point) => this.worldToScreen(point, point.z)),
            backQuadPoints: worldQuad.backQuadPoints.map((point) => this.worldToScreen(point, point.z)),
            quads: worldQuad.quads.map((quad) => quad.map((point) => this.worldToScreen(point, point.z))),
            bottomCenterScreen: this.worldToScreen(worldQuad.bottomCenter, worldQuad.bottomCenter.z),
            topCenterScreen: this.worldToScreen(worldQuad.topCenter, worldQuad.topCenter.z)
        };
    }

    mountedObjectScreenGeometry(entry) {
        const screen = this.mountedObjectScreenPlacement(entry.object, entry);
        if (!screen || !Array.isArray(screen.quadPoints) || screen.quadPoints.length !== 4) {
            throw new Error(`mounted object ${entry && entry.object && entry.object.id} screen picking requires a quad`);
        }
        return screen.quads.map((quad, quadIndex) => [quad.map((point, index) => {
            const x = Number(point.x);
            const y = Number(point.y);
            if (!Number.isFinite(x) || !Number.isFinite(y)) {
                throw new Error(`mounted object ${entry.object.id} screen pick quad ${quadIndex} has non-finite point ${index}`);
            }
            return [x, y];
        })]);
    }

    mountedObjectResizeHandles(object) {
        const placement = this.mountedObjectPlacement(object);
        if (!placement) return [];
        const screen = this.mountedObjectScreenPlacement(object, placement);
        if (!screen || !Array.isArray(screen.quadPoints) || screen.quadPoints.length !== 4) {
            throw new Error(`mounted object ${object && object.id} resize handles require a screen quad`);
        }
        const [topLeft, topRight, bottomRight, bottomLeft] = screen.quadPoints;
        const midpoint = (a, b) => ({ x: (Number(a.x) + Number(b.x)) * 0.5, y: (Number(a.y) + Number(b.y)) * 0.5 });
        const category = String(object && object.category || "").trim().toLowerCase();
        const handles = [
            { key: "topLeft", point: topLeft, resizeX: true, resizeY: true, verticalSide: "top" },
            { key: "topRight", point: topRight, resizeX: true, resizeY: true, verticalSide: "top" },
            { key: "top", point: midpoint(topLeft, topRight), resizeX: false, resizeY: true, verticalSide: "top" },
            { key: "right", point: midpoint(topRight, bottomRight), resizeX: true, resizeY: false, verticalSide: null },
            { key: "left", point: midpoint(topLeft, bottomLeft), resizeX: true, resizeY: false, verticalSide: null }
        ];
        if (category === "windows") {
            handles.push(
                { key: "bottomRight", point: bottomRight, resizeX: true, resizeY: true, verticalSide: "bottom" },
                { key: "bottomLeft", point: bottomLeft, resizeX: true, resizeY: true, verticalSide: "bottom" },
                { key: "bottom", point: midpoint(bottomLeft, bottomRight), resizeX: false, resizeY: true, verticalSide: "bottom" }
            );
        }
        return handles.map((handle) => ({
            ...handle,
            object,
            objectId: object.id,
            placement,
            screen
        }));
    }

    pickMountedObjectResizeHandle(screenPoint, thresholdPixels = 10) {
        if (!screenPoint || this.state.tool === "mountObject") return null;
        const selectedObjects = this.state.selectedMountedObjects();
        if (!selectedObjects.length) return null;
        const threshold = Number.isFinite(Number(thresholdPixels)) ? Number(thresholdPixels) : 10;
        let best = null;
        selectedObjects.forEach((object) => {
            this.mountedObjectResizeHandles(object).forEach((handle) => {
                const distance = Math.hypot(Number(screenPoint.x) - Number(handle.point.x), Number(screenPoint.y) - Number(handle.point.y));
                if (distance > threshold) return;
                const priority = handle.resizeX && handle.resizeY ? 0 : 1;
                if (!best || distance < best.distance - 0.001 || (Math.abs(distance - best.distance) <= 0.001 && priority < best.priority)) {
                    best = { ...handle, distance, priority };
                }
            });
        });
        return best;
    }

    mountedObjectPickDepthMetric(entry) {
        const worldQuad = this.mountedObjectWorldQuad(entry.object, entry);
        if (!worldQuad) throw new Error(`mounted object ${entry && entry.object && entry.object.id} screen picking requires world quad geometry`);
        return worldQuad.quads.flat().reduce((best, point) => Math.max(best, this.worldDepthMetric(point, point.z)), -Infinity);
    }

    mountedObjectWorldNormal(placement, worldQuad) {
        const nx = Number(placement && placement.sectionNormalX);
        const ny = Number(placement && placement.sectionNormalY);
        if (!Number.isFinite(nx) || !Number.isFinite(ny)) {
            throw new Error("mounted object lighting requires a finite wall normal");
        }
        const facingSign = Number(placement.mountedWallFacingSign) >= 0 ? 1 : -1;
        const faceSign = worldQuad && worldQuad.visibleFace === "back" ? -1 : 1;
        return { x: nx * facingSign * faceSign, y: ny * facingSign * faceSign, z: 0 };
    }

    createMountedObjectMesh(texture) {
        if (!PIXI.Geometry || !PIXI.Shader || !PIXI.Mesh) {
            throw new Error("wall-mounted door/window rendering requires PIXI Geometry, Shader, and Mesh");
        }
        const positions = new Float32Array(12);
        const normals = new Float32Array(12);
        const uvs = new Float32Array([
            0, 0,
            1, 0,
            1, 1,
            0, 1
        ]);
        const geometry = new PIXI.Geometry()
            .addAttribute("aWorldPosition", positions, 3)
            .addAttribute("aWorldNormal", normals, 3)
            .addAttribute("aUvs", uvs, 2)
            .addIndex(new Uint16Array([0, 1, 2, 0, 2, 3]));
        const shader = PIXI.Shader.from(FLOOR_DEPTH_VS, FLOOR_DEPTH_FS, {
            uScreenSize: new Float32Array([1, 1]),
            uCameraWorld: new Float32Array([0, 0]),
            uCameraZ: 0,
            uViewScale: 1,
            uXyRatio: GAME_XY_RATIO,
            uCameraPitch: CAMERA_DEFAULT_PITCH,
            uDepthRange: new Float32Array([
                FLOOR_DEPTH_FAR_METRIC,
                1 / Math.max(1e-6, FLOOR_DEPTH_FAR_METRIC - FLOOR_DEPTH_NEAR_METRIC)
            ]),
            uDepthBias: FLOOR_DEPTH_BIAS,
            uCameraRotation: 0,
            uCameraRotationCenter: new Float32Array([0, 0]),
            uLightVector: new Float32Array([0, 0, 1]),
            uLightDiffuse: SCENE_LIGHT_DIFFUSE,
            uLightClamp: new Float32Array([SCENE_LIGHT_MIN, SCENE_LIGHT_MAX]),
            uOverheadSlopeLighting: 0,
            uTint: new Float32Array([1, 1, 1, 1]),
            uAlphaCutoff: 0.001,
            uSampler: texture
        });
        const mesh = new PIXI.Mesh(geometry, shader, this.getFloorDepthState() || undefined, PIXI.DRAW_MODES.TRIANGLES);
        mesh.interactive = false;
        mesh.visible = false;
        return mesh;
    }

    updateMountedObjectMesh(mesh, source, placement, options = {}) {
        const texturePath = normalizeTexturePath(source.texturePath, source.category === "windows"
            ? "/assets/images/windows/window.png"
            : "/assets/images/doors/door5.png");
        if (mesh._texturePath !== texturePath) {
            mesh.shader.uniforms.uSampler = this.getSurfaceTexture(texturePath, source.category === "windows"
                ? "/assets/images/windows/window.png"
                : "/assets/images/doors/door5.png");
            mesh._texturePath = texturePath;
        }
        const worldQuad = this.mountedObjectWorldQuad(source, placement);
        if (!worldQuad) {
            mesh.visible = false;
            return false;
        }
        const vertices = new Float32Array(worldQuad.quadPoints.flatMap((point) => [point.x, point.y, point.z]));
        if (mesh.geometry && typeof mesh.geometry.getBuffer === "function") {
            const buffer = mesh.geometry.getBuffer("aWorldPosition");
            if (!buffer || !buffer.data || typeof buffer.data.set !== "function") {
                throw new Error("wall-mounted door/window mesh is missing world-position buffer data");
            }
            if (buffer.data.length !== vertices.length) {
                throw new Error("wall-mounted door/window mesh world-position buffer has unexpected length");
            }
            buffer.data.set(vertices);
            if (typeof buffer.update === "function") buffer.update();
            const normalBuffer = mesh.geometry.getBuffer("aWorldNormal");
            if (!normalBuffer || !normalBuffer.data || typeof normalBuffer.data.set !== "function") {
                throw new Error("wall-mounted door/window mesh is missing normal buffer data");
            }
            const normal = this.mountedObjectWorldNormal(placement, worldQuad);
            const normals = new Float32Array([
                normal.x, normal.y, normal.z,
                normal.x, normal.y, normal.z,
                normal.x, normal.y, normal.z,
                normal.x, normal.y, normal.z
            ]);
            if (normalBuffer.data.length !== normals.length) {
                throw new Error("wall-mounted door/window mesh normal buffer has unexpected length");
            }
            normalBuffer.data.set(normals);
            if (typeof normalBuffer.update === "function") normalBuffer.update();
            const uvBuffer = mesh.geometry.getBuffer("aUvs");
            if (!uvBuffer || !uvBuffer.data || typeof uvBuffer.data.set !== "function") {
                throw new Error("wall-mounted door/window mesh is missing uv buffer data");
            }
            const uvs = worldQuad.visibleFace === "back"
                ? new Float32Array([1, 0, 0, 0, 0, 1, 1, 1])
                : new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
            if (uvBuffer.data.length !== uvs.length) {
                throw new Error("wall-mounted door/window mesh uv buffer has unexpected length");
            }
            uvBuffer.data.set(uvs);
            if (typeof uvBuffer.update === "function") uvBuffer.update();
        } else {
            throw new Error("wall-mounted door/window mesh does not expose editable vertices");
        }
        const alphaMultiplier = Number.isFinite(Number(options.alphaMultiplier))
            ? Number(options.alphaMultiplier)
            : 1;
        const alpha = Math.max(0, Math.min(1, Number(source.previewAlpha ?? 1) * alphaMultiplier));
        this.updateSurfaceMeshUniforms(mesh, placement.floor, alpha, {
            texturePath,
            textureFallback: source.category === "windows" ? "/assets/images/windows/window.png" : "/assets/images/doors/door5.png"
        });
        mesh.visible = true;
        return true;
    }

    drawMountedObjects() {
        const liveIds = new Set();
        const floors = this.renderedFloors();
        const floorIds = new Set(floors.map((floor) => getFloorId(floor)));
        const exterior = this.state.renderStyle() === "exterior";
        const floorAlphaById = this.renderedFloorAlphaMap(floors, exterior);
        const draft = this.state.draft;
        const replacingMountedObjectId = draft &&
            draft.kind === "mountedObject" &&
            draft.replacingMountedObjectId != null
            ? String(draft.replacingMountedObjectId)
            : null;
        this.lastMountedObjectPickEntries = [];
        getBuildingMountedObjects(this.state.building).forEach((object) => {
            const id = String(object.id);
            if (replacingMountedObjectId === id) return;
            const placement = this.mountedObjectPlacement(object);
            if (!placement) return;
            const floorId = getFloorId(placement.floor);
            if (!floorIds.has(floorId)) return;
            liveIds.add(id);
            let mesh = this.mountedObjectMeshById.get(id);
            if (!mesh) {
                mesh = this.createMountedObjectMesh(PIXI.Texture.EMPTY);
                this.mountedObjectMeshById.set(id, mesh);
                this.buildingUnit.addChild(mesh);
            } else if (mesh.parent !== this.buildingUnit) {
                this.buildingUnit.addChild(mesh);
            }
            const floorAlpha = floorAlphaById.get(floorId) ?? 1;
            const collapsedAlpha = placement.mountKind === "gable"
                ? 1
                : (this.shouldDrawWallCollapsed(placement.wall, placement.floor, this.lastWallPickEntries) ? 0.5 : 1);
            this.updateMountedObjectMesh(mesh, object, placement, {
                alphaMultiplier: floorAlpha * collapsedAlpha
            });
            this.lastMountedObjectPickEntries.push({
                ...placement,
                object,
                mesh
            });
        });
        for (const [id, mesh] of this.mountedObjectMeshById.entries()) {
            if (!liveIds.has(id)) mesh.visible = false;
        }
    }

    drawMountedObjectPreview() {
        const draft = this.state.draft;
        const preview = draft && draft.kind === "mountedObject" ? draft : null;
        if (!preview || !preview.asset || !preview.placement) {
            if (this.mountedObjectPreviewMesh) this.mountedObjectPreviewMesh.visible = false;
            return;
        }
        if (!this.mountedObjectPreviewMesh) {
            this.mountedObjectPreviewMesh = this.createMountedObjectMesh(PIXI.Texture.EMPTY);
            this.buildingUnit.addChild(this.mountedObjectPreviewMesh);
        } else if (this.mountedObjectPreviewMesh.parent !== this.buildingUnit) {
            this.buildingUnit.addChild(this.mountedObjectPreviewMesh);
        }
        this.updateMountedObjectMesh(this.mountedObjectPreviewMesh, {
            ...preview.asset,
            previewAlpha: 0.55,
            valid: preview.placement.valid
        }, preview.placement);
    }

    drawSurfaceSelectionOutline(gfx, floor, z, label) {
        this.drawClipGeometryOutline(gfx, this.surfaceScreenGeometry(floor, z, label), label);
    }

    drawRoofSelectionOutline(gfx, floor, label) {
        this.drawClipGeometryOutline(gfx, this.roofContactScreenGeometry(floor, label), label);
    }

    drawWallEntrySelectionOutline(gfx, entry, label, options = {}) {
        if (!entry || !entry.wall || !entry.floor) {
            throw new Error(`${label} requires a rendered wall entry`);
        }
        const geometry = options.fullHeight === true
            ? this.wallScreenImagePolygon(entry.wall, entry.floor, this.lastWallPickEntries)
            : this.wallScreenPickGeometry(entry.wall, entry.floor, this.lastWallPickEntries);
        this.drawClipGeometryOutline(
            gfx,
            geometry,
            label
        );
    }

    stairScreenOutlineRings(stair, label = "stair selection outline") {
        const steps = this.stairStepPolygons(stair);
        if (!steps.length) throw new Error(`${label} requires at least one rendered step`);
        return steps.map((step, index) => [closedClipRing(
            step.polygon.map((point) => this.worldToScreen(point, step.z)),
            `${label} step ${index}`
        )]);
    }

    stairOpeningScreenGeometry(stair, label = "stair opening outline") {
        const geometry = [];
        getBuildingFloors(this.state.building).forEach((floor) => {
            const floorId = getFloorId(floor);
            const clipped = this.stairOpeningClipGeometryForFloor(stair, floor, `${label} floor ${floorId}`);
            if (clipGeometryArea(clipped) <= GEOMETRY_EPSILON) return;
            const z = getFloorElevation(floor);
            clipped.forEach((polygon, polygonIndex) => {
                if (!looksLikeClipPolygon(polygon)) {
                    throw new Error(`${label} floor ${floorId} contains malformed opening polygon ${polygonIndex}`);
                }
                geometry.push(polygon.map((ring, ringIndex) => {
                    const points = clipRingToPoints(ring, `${label} floor ${floorId} polygon ${polygonIndex} ring ${ringIndex}`)
                        .map((point) => this.worldToScreen(point, z));
                    return closedClipRing(points, `${label} floor ${floorId} screen polygon ${polygonIndex} ring ${ringIndex}`);
                }));
            });
        });
        return geometry;
    }

    drawSelectionOutline() {
        const gfx = this.selectionOutlineLayer;
        gfx.clear();
        if (this.state.tool === "mountObject") return;
        const selection = this.state.selection || { kind: "building" };
        if (selection.kind === "building" || selection.kind === "level") {
            return;
        }
        if (selection.kind === "wall" || selection.kind === "wallEndpoint") {
            const selectedWallIds = new Set(this.state.selectedWallIds().map((id) => String(id)));
            if (selectedWallIds.size === 0) {
                throw new Error(`${selection.kind} selection outline is missing selected wall ids`);
            }
            const entries = this.lastWallPickEntries.filter((entry) => entry && entry.wall && selectedWallIds.has(String(entry.wall.id)));
            if (entries.length !== selectedWallIds.size) {
                throw new Error("selected wall outline is missing a rendered wall entry");
            }
            entries.forEach((entry) => {
                this.drawWallEntrySelectionOutline(gfx, entry, `wall ${entry.wall.id} selection outline`, { fullHeight: true });
            });
            return;
        }
        if (selection.kind === "mountedObject") {
            const objects = this.state.selectedMountedObjects();
            if (!objects.length) {
                throw new Error("mounted object selection outline is missing selected objects");
            }
            objects.forEach((object) => {
                const placement = this.mountedObjectPlacement(object);
                if (!placement) {
                    throw new Error(`mounted object ${object.id} selection outline is missing placement geometry`);
                }
                this.drawClipGeometryOutline(gfx, this.mountedObjectScreenGeometry({
                    ...placement,
                    object
                }), `mounted object ${object.id} selection outline`);
            });
            return;
        }
        if (selection.kind === "gable" || selection.kind === "gableHandle") {
            const floor = this.state.selectedFloor();
            const gable = this.state.selectedGable();
            if (!floor || !gable) throw new Error("gable selection outline is missing selected gable");
            const roof = findFloorRoof(floor, selection.roofId);
            this.drawClipGeometryOutline(gfx, this.gableScreenGeometry(floorRoofView(floor, roof), gable, `gable ${gable.id} selection outline`), `gable ${gable.id} selection outline`);
            return;
        }
        if (selection.kind === "roof" || selection.kind === "roofVertex" || selection.kind === "roofPeak" || selection.kind === "roofShedDirection") {
            const entries = this.state.selectedRoofEntries();
            if (!entries.length) {
                throw new Error("roof selection outline is missing selected roofs");
            }
            entries.forEach(({ floor, roof }) => {
                const floorId = getFloorId(floor);
                this.drawRoofSelectionOutline(gfx, floorRoofView(floor, roof), `roof ${floorId} selection outline`);
            });
            return;
        }
        if (selection.kind === "beam") {
            const beams = typeof this.state.selectedBeams === "function" ? this.state.selectedBeams() : [this.state.selectedBeam()].filter(Boolean);
            beams.forEach((beam) => {
                const floor = this.state.findBeamById(beam.id);
                if (floor) this.drawClipGeometryOutline(gfx, this.beamScreenOutlineRings(beam, floor.floor), `beam ${beam.id} selection outline`);
            });
            if (!beams.length) {
                throw new Error("beam selection outline is missing selected beams");
            }
            return;
        }
        if (selection.kind === "stair") {
            const stairs = this.state.selectedStairs();
            if (!stairs.length) {
                throw new Error("stair selection outline is missing selected stairs");
            }
            stairs.forEach((stair) => {
                this.drawClipGeometryOutline(gfx, this.stairScreenOutlineRings(stair, `stair ${stair.id} selection outline`), `stair ${stair.id} selection outline`);
                const openingGeometry = this.stairOpeningScreenGeometry(stair, `stair ${stair.id} upper floor opening outline`);
                if (openingGeometry.length) {
                    this.drawClipGeometryOutline(gfx, openingGeometry, `stair ${stair.id} upper floor opening outline`);
                }
            });
            return;
        }
        if (selection.kind === "column") {
            const columns = this.state.selectedColumns();
            if (!columns.length) {
                throw new Error("column selection outline is missing selected columns");
            }
            columns.forEach((col) => {
                this.drawClipGeometryOutline(gfx, this.columnScreenOutlineRings(col), `column ${col.id} selection outline`);
            });
            return;
        }
        const floor = this.state.selectedFloor();
        if (!floor) {
            throw new Error(`${selection.kind} selection outline is missing a selected floor`);
        }
        const floorId = getFloorId(floor);
        if (selection.kind === "floor" || selection.kind === "floorVertex") {
            this.drawSurfaceSelectionOutline(gfx, floor, getFloorElevation(floor), `floor ${floorId} selection outline`);
        }
    }

    drawHandles() {
        const gfx = this.handleLayer;
        gfx.clear();
        if (this.state.tool === "mountObject") return;
        const floor = this.state.selectedFloor();
        const selectionKind = this.state.selection && this.state.selection.kind;
        if (selectionKind === "mountedObject") {
            this.drawSelectedMountedObjectResizeHandles(gfx);
            return;
        }
        if (selectionKind === "roof" || selectionKind === "roofVertex" || selectionKind === "roofPeak" || selectionKind === "roofShedDirection") {
            this.drawSelectedRoofVertexHandles(gfx);
            return;
        }
        if (selectionKind === "gable" || selectionKind === "gableHandle") {
            this.drawSelectedGableHandles(gfx);
            return;
        }
        if (!floor) return;
        const elevation = getFloorElevation(floor);
        if (selectionKind === "wall" || selectionKind === "wallEndpoint") {
            this.drawSelectedWallEndpointHandles(gfx, elevation);
            return;
        }
        if (selectionKind === "beam") {
            this.drawSelectedBeamEndpointHandles(gfx);
            return;
        }
        if (selectionKind === "column") {
            const columns = this.state.selectedColumns();
            columns.forEach((col) => {
                const screen = this.worldToScreen(col.position, col.bottomZ);
                gfx.beginFill(0xffd27a, 1);
                gfx.lineStyle(2, 0x111820, 1);
                gfx.drawCircle(screen.x, screen.y, 6);
                gfx.endFill();
            });
            return;
        }
        if (selectionKind !== "floor" && selectionKind !== "floorVertex") return;
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

    drawSelectedRoofVertexHandles(gfx) {
        const selection = this.state.selection || {};
        const entries = this.state.selectedRoofEntries();
        entries.forEach(({ floor, roof }) => {
            const roofView = floorRoofView(floor, roof);
            const floorId = getFloorId(floor);
            getRoofContactPolygon(roofView).forEach((point, vertexIndex) => {
                const selected = selection.kind === "roofVertex" &&
                    selection.floorId === floorId &&
                    (!selection.roofId || String(selection.roofId) === String(roof.id)) &&
                    Number(selection.vertexIndex) === vertexIndex;
                const screen = this.worldToScreen(point, roofRenderElevation(roofView));
                gfx.beginFill(selected ? 0xffffff : 0xc9d1d8, 1);
                gfx.lineStyle(selected ? 3 : 2, selected ? 0xffd27a : 0x111820, 1);
                gfx.drawCircle(screen.x, screen.y, selected ? 7 : 5);
                gfx.endFill();
            });
            const mode = String(roof && roof.mode || "peak");
            const hasSlopeDirection = mode === "shed" || mode === "gabled";
            const center = hasSlopeDirection
                ? polygonCentroid(getRoofContactPolygon(roofView))
                : polygonCentroid(getRoofContactPolygon(roofView));
            const centerZ = hasSlopeDirection ? roofRenderElevation(roofView) : roofRenderElevation(roofView) + roofPeakHeight(roofView);
            const centerScreen = this.worldToScreen(center, centerZ);
            gfx.beginFill(0x9aa0a6, 0.95);
            gfx.lineStyle(1, 0x30343a, 0.8);
            gfx.drawCircle(centerScreen.x, centerScreen.y, hasSlopeDirection ? 4 : 3);
            gfx.endFill();
            if (hasSlopeDirection) {
                const direction = getRoofShedDirection(roofView);
                const handle = {
                    x: Number(center.x) + Number(direction.x) * ROOF_SHED_DIRECTION_HANDLE_LENGTH,
                    y: Number(center.y) + Number(direction.y) * ROOF_SHED_DIRECTION_HANDLE_LENGTH
                };
                const handleScreen = this.worldToScreen(handle, centerZ);
                const selected = selection.kind === "roofShedDirection" && selection.floorId === floorId &&
                    (!selection.roofId || String(selection.roofId) === String(roof.id));
                gfx.lineStyle(2, selected ? 0xffd27a : 0x8f98a1, 0.95);
                gfx.moveTo(centerScreen.x, centerScreen.y);
                gfx.lineTo(handleScreen.x, handleScreen.y);
                gfx.beginFill(selected ? 0xffffff : 0xd7dde3, 1);
                gfx.lineStyle(selected ? 3 : 2, selected ? 0xffd27a : 0x30343a, 1);
                gfx.drawCircle(handleScreen.x, handleScreen.y, selected ? 7 : 5);
                gfx.endFill();
                if (typeof this.state.roofShedDirectionSnapCandidates === "function") {
                    this.state.roofShedDirectionSnapCandidates(roofView).forEach((candidate) => {
                        const snapScreen = this.worldToScreen(candidate.point, centerZ);
                        gfx.beginFill(0xb5bbc2, 0.95);
                        gfx.lineStyle(1, 0x30343a, 0.7);
                        gfx.drawCircle(snapScreen.x, snapScreen.y, 3);
                        gfx.endFill();
                    });
                }
                return;
            }
            if (mode === "dome") return;
            const peak = roofPeakWorldGeometry(floor).peak;
            const peakSelected = selection.kind === "roofPeak" && selection.floorId === floorId;
            const peakScreen = this.worldToScreen(peak, peak.z);
            gfx.beginFill(peakSelected ? 0xffffff : 0x8ee6ff, 1);
            gfx.lineStyle(peakSelected ? 3 : 2, peakSelected ? 0xffd27a : 0x111820, 1);
            gfx.drawCircle(peakScreen.x, peakScreen.y, peakSelected ? 8 : 6);
            gfx.endFill();
        });
    }

    drawSelectedMountedObjectResizeHandles(gfx) {
        const objects = this.state.selectedMountedObjects();
        objects.forEach((object) => {
            this.mountedObjectResizeHandles(object).forEach((handle) => {
                const point = handle.point;
                const corner = handle.resizeX && handle.resizeY;
                gfx.beginFill(corner ? 0xffffff : 0xc9d1d8, 1);
                gfx.lineStyle(2, 0x111820, 1);
                if (corner) {
                    gfx.drawRect(Number(point.x) - 4.5, Number(point.y) - 4.5, 9, 9);
                } else {
                    gfx.drawCircle(Number(point.x), Number(point.y), 4.5);
                }
                gfx.endFill();
            });
        });
    }

    drawSelectedGableHandles(gfx) {
        const floor = this.state.selectedFloor();
        const gable = this.state.selectedGable();
        if (!floor || !gable) return;
        this.gableHandles(this.selectedRoofViewForFloor(floor), gable).forEach((handle) => {
            const selected = this.state.selection &&
                this.state.selection.kind === "gableHandle" &&
                this.state.selection.gableHandle === handle.key;
            const point = handle.screen;
            gfx.beginFill(selected ? 0xffffff : 0xc9d1d8, 1);
            gfx.lineStyle(selected ? 3 : 2, selected ? 0xffd27a : 0x111820, 1);
            if (handle.key === "height") {
                gfx.drawRect(Number(point.x) - 5, Number(point.y) - 5, 10, 10);
            } else {
                gfx.drawCircle(Number(point.x), Number(point.y), selected ? 7 : 5);
            }
            gfx.endFill();
        });
    }

    drawSelectedWallEndpointHandles(gfx, elevation) {
        const wall = this.state.selectedWall();
        if (!wall) return;
        const points = wallPoints(this.state.building, wall);
        if (points.length !== 2) return;
        [
            { key: "startPoint", point: points[0] },
            { key: "endPoint", point: points[1] }
        ].forEach((entry) => {
            const selected = this.state.selection.kind === "wallEndpoint" &&
                this.state.selection.wallEndpointKey === entry.key;
            const screen = this.worldToScreen(entry.point, elevation);
            gfx.beginFill(selected ? 0xffffff : 0xc9d1d8, 1);
            gfx.lineStyle(selected ? 3 : 2, selected ? 0xffd27a : 0x111820, 1);
            gfx.drawCircle(screen.x, screen.y, selected ? 7 : 5);
            gfx.endFill();
        });
    }

    drawFloorContourSnapGuide(gfx, floor, z) {
        const guideZ = Number(z);
        if (!Number.isFinite(guideZ)) {
            throw new Error("floor contour snap guide requires a finite z height");
        }
        ringsForFloor(floor).forEach((ring) => {
            if (!Array.isArray(ring.points) || ring.points.length < 3) {
                throw new Error("floor contour snap guide requires valid floor rings");
            }
            const first = ring.points[0];
            if (!Number.isFinite(Number(first.x)) || !Number.isFinite(Number(first.y))) {
                throw new Error("floor contour snap guide contains a non-finite vertex");
            }
            const firstScreen = this.worldToScreen(first, guideZ);
            gfx.lineStyle(2, 0xff0000, 0.72);
            gfx.moveTo(firstScreen.x, firstScreen.y);
            for (let index = 1; index < ring.points.length; index++) {
                const point = ring.points[index];
                if (!Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) {
                    throw new Error("floor contour snap guide contains a non-finite vertex");
                }
                const screen = this.worldToScreen(point, guideZ);
                gfx.lineTo(screen.x, screen.y);
            }
            gfx.lineTo(firstScreen.x, firstScreen.y);
        });
    }

    drawDraft() {
        const gfx = this.draftLayer;
        gfx.clear();
        const draft = this.state.draft;
        if (draft && draft.kind === "roofShedDirection") {
            const floor = findFloor(this.state.building, draft.floorId);
            if (!floor) throw new Error(`shed direction draft references missing floor: ${draft.floorId}`);
            const ring = typeof this.state.roofShedBasePolygon === "function"
                ? this.state.roofShedBasePolygon(floor)
                : shedRoofBaseRing(floor);
            const z = roofRenderElevation(floor);
            const screens = ring.map((point) => this.worldToScreen(point, z));
            gfx.beginFill(0x78b7ff, 0.12);
            gfx.lineStyle(3, 0x78b7ff, 0.95);
            screens.forEach((point, index) => {
                if (index === 0) gfx.moveTo(point.x, point.y);
                else gfx.lineTo(point.x, point.y);
            });
            if (screens.length > 0) gfx.lineTo(screens[0].x, screens[0].y);
            gfx.endFill();
            return;
        }
        if (draft && draft.kind === "mountedObject" && draft.placement) {
            const placement = draft.placement;
            if (placement.wall && placement.floor) {
                this.drawWallEntrySelectionOutline(gfx, {
                    wall: placement.wall,
                    floor: placement.floor
                }, `mounted object preview wall ${placement.wall.id} outline`, { fullHeight: true });
            }
            const screen = this.mountedObjectScreenPlacement(draft.asset, placement);
            if (screen) {
                gfx.lineStyle(2, placement.valid ? 0xffd27a : 0xff8a8a, 0.95);
                screen.quads.forEach((points) => {
                    gfx.moveTo(points[0].x, points[0].y);
                    for (let index = 1; index < points.length; index++) gfx.lineTo(points[index].x, points[index].y);
                    gfx.closePath();
                });
            }
            if (placement.centerSnapActive) {
                const baseZ = getFloorElevation(placement.floor);
                const topZ = baseZ + Math.max(0, Number(placement.wallHeight) || 0);
                const center = placement.faceCenter;
                const bottom = this.worldToScreen(center, baseZ);
                const top = this.worldToScreen(center, topZ);
                gfx.lineStyle(2, 0xff0000, 0.72);
                gfx.moveTo(bottom.x, bottom.y);
                gfx.lineTo(top.x, top.y);
            }
            if (placement.verticalPeerSnapActive) {
                this.drawFloorContourSnapGuide(gfx, placement.floor, placement.verticalSnapZ);
            }
            if (placement.verticalCenterSnapActive && Array.isArray(placement.points) && placement.points.length === 2) {
                const baseZ = getFloorElevation(placement.floor);
                const wallMidZ = baseZ + Math.max(0, Number(placement.wallHeight) || 0) * 0.5;
                const normalX = Number(placement.sectionNormalX);
                const normalY = Number(placement.sectionNormalY);
                const halfThickness = Math.max(0, Number(placement.wallThickness) || 0) * 0.5;
                const facingSign = Number(placement.mountedWallFacingSign) >= 0 ? 1 : -1;
                if (!Number.isFinite(normalX) || !Number.isFinite(normalY)) {
                    throw new Error("vertical window snap guide requires a finite wall normal");
                }
                const start = {
                    x: Number(placement.points[0].x) + normalX * halfThickness * facingSign,
                    y: Number(placement.points[0].y) + normalY * halfThickness * facingSign
                };
                const end = {
                    x: Number(placement.points[1].x) + normalX * halfThickness * facingSign,
                    y: Number(placement.points[1].y) + normalY * halfThickness * facingSign
                };
                const startScreen = this.worldToScreen(start, wallMidZ);
                const endScreen = this.worldToScreen(end, wallMidZ);
                gfx.lineStyle(2, 0xff0000, 0.72);
                gfx.moveTo(startScreen.x, startScreen.y);
                gfx.lineTo(endScreen.x, endScreen.y);
            }
            return;
        }
        if (draft && draft.kind === "column" && draft.position) {
            const verts = columnVertices(draft);
            if (verts && verts.length >= 3) {
                const bz = Number.isFinite(draft.bottomZ) ? draft.bottomZ : this.activePlaneZ();
                const tz = bz + (Number.isFinite(draft.height) ? draft.height : 3);
                const n = verts.length;
                const bScreen = verts.map((v) => this.worldToScreen(v, bz));
                const tScreen = verts.map((v) => this.worldToScreen(v, tz));
                gfx.lineStyle(2, 0x9fe4d5, 0.95);
                gfx.beginFill(0x9fe4d5, 0.18);
                gfx.moveTo(bScreen[0].x, bScreen[0].y);
                for (let i = 1; i < n; i++) gfx.lineTo(bScreen[i].x, bScreen[i].y);
                gfx.closePath();
                gfx.moveTo(tScreen[0].x, tScreen[0].y);
                for (let i = 1; i < n; i++) gfx.lineTo(tScreen[i].x, tScreen[i].y);
                gfx.closePath();
                for (let i = 0; i < n; i++) {
                    const b0 = bScreen[i], b1 = bScreen[(i + 1) % n];
                    const t0 = tScreen[i], t1 = tScreen[(i + 1) % n];
                    gfx.moveTo(b0.x, b0.y); gfx.lineTo(b1.x, b1.y);
                    gfx.lineTo(t1.x, t1.y); gfx.lineTo(t0.x, t0.y);
                    gfx.closePath();
                }
                gfx.endFill();
            }
            return;
        }
        if (draft && draft.kind === "stair" && Array.isArray(draft.treads) && draft.treads.length > 0) {
            this.drawStairRecord(gfx, draft, true);
            return;
        }
        if (draft && draft.kind === "roofPlacement" && Array.isArray(draft.points) && draft.points.length >= 3) {
            const z = Number.isFinite(Number(draft.elevation)) ? Number(draft.elevation) : this.activePlaneZ();
            const screens = draft.points.map((point) => this.worldToScreen(point, z));
            gfx.lineStyle(3, 0x78b7ff, 0.95);
            gfx.beginFill(0x78b7ff, 0.14);
            screens.forEach((point, index) => {
                if (index === 0) gfx.moveTo(point.x, point.y);
                else gfx.lineTo(point.x, point.y);
            });
            gfx.lineTo(screens[0].x, screens[0].y);
            gfx.endFill();
            return;
        }
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
        if (draft.kind === "polygonEdit" && draft.completed === true && draft.points.length >= 3) {
            gfx.lineTo(first.x, first.y);
        }
        if (draft.kind === "polygonEdit" && draft.completed !== true && draft.points.length > 0 && this.state.hoverWorldPoint) {
            const hover = this.worldToScreen(this.state.hoverWorldPoint, z);
            gfx.lineTo(hover.x, hover.y);
        }
        draft.points.forEach((point, index) => {
            const screen = this.worldToScreen(point, z);
            gfx.beginFill(0x111820, 1);
            const selected = draft.kind === "polygonEdit" && Number(draft.selectedVertexIndex) === index;
            gfx.lineStyle(selected ? 3 : 2, selected ? 0xffd27a : color, 1);
            gfx.drawCircle(screen.x, screen.y, selected ? 7 : 5);
            gfx.endFill();
        });
    }

    validatePlaytestWizardSheetBase(baseTexture) {
        if (!baseTexture) {
            throw new Error("building editor playtest wizard is missing runningman base texture");
        }
        if (baseTexture.valid !== true) return false;
        const width = Number(baseTexture.width);
        const height = Number(baseTexture.height);
        if (!(width > 0) || !(height > 0)) {
            throw new Error("building editor playtest wizard runningman texture has invalid dimensions");
        }
        if (width % PLAYTEST_WIZARD_SHEET_COLS !== 0 || height % PLAYTEST_WIZARD_SHEET_ROWS !== 0) {
            throw new Error(`building editor playtest wizard sprite sheet must divide into ${PLAYTEST_WIZARD_SHEET_ROWS}x${PLAYTEST_WIZARD_SHEET_COLS} frames`);
        }
        return true;
    }

    attachPlaytestWizardSheetLoadHandler(baseTexture) {
        if (this.playtestWizardSheetLoadAttached || !baseTexture || typeof baseTexture.once !== "function") return;
        this.playtestWizardSheetLoadAttached = true;
        baseTexture.once("loaded", () => {
            this.playtestWizardFrames = null;
            this.validatePlaytestWizardSheetBase(baseTexture);
            this.render();
        });
        baseTexture.once("error", () => {
            throw new Error(`building editor playtest wizard failed to load ${PLAYTEST_WIZARD_SHEET_PATH}`);
        });
    }

    ensurePlaytestWizardFrames() {
        if (Array.isArray(this.playtestWizardFrames) && this.playtestWizardFrames.length > 0) {
            return this.playtestWizardFrames;
        }
        if (!globalThis.PIXI || !PIXI.Texture || !PIXI.Rectangle) {
            throw new Error("building editor playtest wizard requires PIXI.Texture and PIXI.Rectangle");
        }
        this.playtestWizardSheetTexture = this.playtestWizardSheetTexture || PIXI.Texture.from(PLAYTEST_WIZARD_SHEET_PATH);
        const baseTexture = this.playtestWizardSheetTexture && this.playtestWizardSheetTexture.baseTexture;
        if (!this.validatePlaytestWizardSheetBase(baseTexture)) {
            if (!baseTexture || typeof baseTexture.once !== "function") {
                throw new Error("building editor playtest wizard runningman texture is not ready and cannot report load completion");
            }
            this.attachPlaytestWizardSheetLoadHandler(baseTexture);
            return null;
        }
        const frameWidth = Number(baseTexture.width) / PLAYTEST_WIZARD_SHEET_COLS;
        const frameHeight = Number(baseTexture.height) / PLAYTEST_WIZARD_SHEET_ROWS;
        const frames = [];
        for (let row = 0; row < PLAYTEST_WIZARD_SHEET_ROWS; row++) {
            for (let col = 0; col < PLAYTEST_WIZARD_SHEET_COLS; col++) {
                const frameRect = new PIXI.Rectangle(
                    col * frameWidth,
                    row * frameHeight,
                    frameWidth,
                    frameHeight
                );
                frames.push(new PIXI.Texture(baseTexture, frameRect));
            }
        }
        this.playtestWizardFrames = frames;
        return frames;
    }

    ensurePlaytestWizardSprite(texture) {
        if (!PIXI.Sprite) {
            throw new Error("building editor playtest wizard requires PIXI.Sprite");
        }
        if (!this.playtestWizardSprite) {
            this.playtestWizardSprite = new PIXI.Sprite(texture);
            this.playtestWizardSprite.name = "buildingEditorPlaytestWizard";
            if (!this.playtestWizardSprite.anchor || typeof this.playtestWizardSprite.anchor.set !== "function") {
                throw new Error("building editor playtest wizard sprite requires a Pixi anchor");
            }
            this.playtestWizardSprite.anchor.set(0.5, 0.75);
        } else {
            this.playtestWizardSprite.texture = texture;
        }
        if (this.playtestWizardSprite.parent !== this.playtestLayer) {
            this.playtestLayer.addChild(this.playtestWizardSprite);
        }
        if (this.playtestHatGraphics.parent !== this.playtestLayer) {
            this.playtestLayer.addChild(this.playtestHatGraphics);
        } else if (typeof this.playtestLayer.setChildIndex === "function" && Array.isArray(this.playtestLayer.children)) {
            this.playtestLayer.setChildIndex(this.playtestHatGraphics, this.playtestLayer.children.length - 1);
        }
        return this.playtestWizardSprite;
    }

    ensurePlaytestWizardDepthMesh() {
        if (!PIXI.Geometry || !PIXI.Shader || !PIXI.Mesh) {
            throw new Error("building editor playtest wizard depth rendering requires Pixi Geometry, Shader, and Mesh");
        }
        if (this.playtestWizardDepthMesh && this.playtestWizardDepthMesh.destroyed !== true) {
            return this.playtestWizardDepthMesh;
        }
        const uvs = new Float32Array([
            0, 1,
            1, 1,
            1, 0,
            0, 0
        ]);
        const indices = new Uint16Array([0, 1, 2, 0, 2, 3]);
        const geometry = new PIXI.Geometry()
            .addAttribute("aWorldPosition", new Float32Array(12), 3)
            .addAttribute("aUvs", uvs, 2)
            .addIndex(indices);
        const shader = PIXI.Shader.from(PLAYTEST_WIZARD_DEPTH_VS, PLAYTEST_WIZARD_DEPTH_FS, {
            uScreenSize: new Float32Array([1, 1]),
            uCameraWorld: new Float32Array([0, 0]),
            uCameraZ: 0,
            uViewScale: 1,
            uXyRatio: GAME_XY_RATIO,
            uCameraPitch: CAMERA_DEFAULT_PITCH,
            uDepthRange: new Float32Array([
                FLOOR_DEPTH_FAR_METRIC,
                1 / Math.max(1e-6, FLOOR_DEPTH_FAR_METRIC - FLOOR_DEPTH_NEAR_METRIC)
            ]),
            uDepthBias: 0,
            uCameraRotation: 0,
            uCameraRotationCenter: new Float32Array([0, 0]),
            uTint: new Float32Array([1, 1, 1, 1]),
            uAlphaCutoff: 0.08,
            uSampler: PIXI.Texture.WHITE
        });
        const mesh = new PIXI.Mesh(geometry, shader, this.getFloorDepthState() || undefined, PIXI.DRAW_MODES.TRIANGLES);
        mesh.name = "buildingEditorPlaytestWizardDepthMesh";
        mesh.interactive = false;
        mesh.visible = false;
        this.playtestWizardDepthMesh = mesh;
        this.playtestWizardDepthWorldPositions = geometry.getBuffer("aWorldPosition").data;
        this.playtestWizardDepthUvSignature = "";
        this.playtestWizardDepthPositionSignature = "";
        return mesh;
    }

    updatePlaytestWizardDepthUvs(mesh, texture) {
        if (!mesh || !mesh.geometry || !texture || !texture.baseTexture) {
            throw new Error("building editor playtest wizard depth mesh requires a framed texture");
        }
        const uvBuffer = mesh.geometry.getBuffer("aUvs");
        if (!uvBuffer) throw new Error("building editor playtest wizard depth mesh is missing UVs");
        const baseTexture = texture.baseTexture;
        const baseW = Number(baseTexture.realWidth || baseTexture.width || 0);
        const baseH = Number(baseTexture.realHeight || baseTexture.height || 0);
        if (!(baseW > 0) || !(baseH > 0)) {
            throw new Error("building editor playtest wizard texture has no finite base size");
        }
        const frame = texture.frame || new PIXI.Rectangle(0, 0, baseW, baseH);
        const u0 = Number(frame.x) / baseW;
        const v0 = Number(frame.y) / baseH;
        const u1 = (Number(frame.x) + Number(frame.width)) / baseW;
        const v1 = (Number(frame.y) + Number(frame.height)) / baseH;
        const signature = `${u0.toFixed(6)}:${v0.toFixed(6)}:${u1.toFixed(6)}:${v1.toFixed(6)}`;
        if (signature === this.playtestWizardDepthUvSignature) return;
        uvBuffer.data = new Float32Array([
            u0, v1,
            u1, v1,
            u1, v0,
            u0, v0
        ]);
        uvBuffer.update();
        this.playtestWizardDepthUvSignature = signature;
    }

    updatePlaytestWizardDepthMesh(mesh, texture, wizard, sprite) {
        if (!mesh || !mesh.shader || !mesh.shader.uniforms || !this.playtestWizardDepthWorldPositions) {
            throw new Error("building editor playtest wizard depth mesh is missing required buffers");
        }
        const x = Number(wizard.x);
        const y = Number(wizard.y);
        const z = Number(wizard.z);
        if (![x, y, z].every(Number.isFinite)) {
            throw new Error("building editor playtest wizard depth mesh requires finite x/y/z");
        }
        const viewScale = Number(this.state.camera.zoom);
        if (!(viewScale > 0)) throw new Error("building editor playtest wizard depth mesh requires positive camera zoom");
        const widthWorld = Math.max(0.01, Math.abs(Number(sprite.width) || viewScale) / viewScale);
        const heightWorldZ = Math.max(0.01, Math.abs(Number(sprite.height) || viewScale) / (viewScale * GAME_XY_RATIO));
        const rotation = Number(this.state.camera.rotation) || 0;
        const axisX = Math.cos(rotation);
        const axisY = -Math.sin(rotation);
        const halfWidth = widthWorld * 0.5;
        const bottomZ = z;
        const topZ = z + heightWorldZ;
        const leftX = x - axisX * halfWidth;
        const leftY = y - axisY * halfWidth;
        const rightX = x + axisX * halfWidth;
        const rightY = y + axisY * halfWidth;
        const signature = [
            leftX, leftY, rightX, rightY, bottomZ, topZ, widthWorld, heightWorldZ, rotation
        ].map((value) => Number(value).toFixed(4)).join("|");
        if (signature !== this.playtestWizardDepthPositionSignature) {
            const positions = this.playtestWizardDepthWorldPositions;
            positions[0] = leftX; positions[1] = leftY; positions[2] = bottomZ;
            positions[3] = rightX; positions[4] = rightY; positions[5] = bottomZ;
            positions[6] = rightX; positions[7] = rightY; positions[8] = topZ;
            positions[9] = leftX; positions[10] = leftY; positions[11] = topZ;
            mesh.geometry.getBuffer("aWorldPosition").update();
            this.playtestWizardDepthPositionSignature = signature;
        }
        this.updatePlaytestWizardDepthUvs(mesh, texture);
        const camera = this.gameCamera();
        const u = mesh.shader.uniforms;
        u.uScreenSize[0] = Math.max(1, this.app.screen.width);
        u.uScreenSize[1] = Math.max(1, this.app.screen.height);
        u.uCameraWorld[0] = Number(camera.x);
        u.uCameraWorld[1] = Number(camera.y);
        u.uCameraZ = Number(camera.z);
        u.uViewScale = Number(camera.viewscale);
        u.uXyRatio = Number(camera.xyratio);
        u.uCameraPitch = cameraPitch(this.state.camera);
        u.uCameraRotation = rotation;
        const rotationCenter = this.state.camera.rotationCenter || this.state.buildingCenter();
        u.uCameraRotationCenter[0] = Number(rotationCenter.x) || 0;
        u.uCameraRotationCenter[1] = Number(rotationCenter.y) || 0;
        u.uDepthRange[0] = FLOOR_DEPTH_FAR_METRIC;
        u.uDepthRange[1] = 1 / Math.max(1e-6, FLOOR_DEPTH_FAR_METRIC - FLOOR_DEPTH_NEAR_METRIC);
        u.uDepthBias = 0;
        u.uTint[0] = 1;
        u.uTint[1] = 1;
        u.uTint[2] = 1;
        u.uTint[3] = 1;
        u.uAlphaCutoff = 0.08;
        u.uSampler = texture;
        if (mesh.parent !== this.buildingUnit) this.buildingUnit.addChild(mesh);
        mesh.visible = true;
        if (Object.prototype.hasOwnProperty.call(mesh, "renderable")) {
            mesh.renderable = true;
        }
    }

    playtestWizardFrameIndex(wizard) {
        const visualSpeed = Math.hypot(
            Number(wizard && wizard.movementVector && wizard.movementVector.x) || 0,
            Number(wizard && wizard.movementVector && wizard.movementVector.y) || 0
        );
        const rowIndex = Number.isInteger(wizard.lastDirectionRow)
            ? ((wizard.lastDirectionRow % PLAYTEST_WIZARD_SHEET_ROWS) + PLAYTEST_WIZARD_SHEET_ROWS) % PLAYTEST_WIZARD_SHEET_ROWS
            : 0;
        let frameIndex = rowIndex * PLAYTEST_WIZARD_SHEET_COLS;
        if (wizard.isJumping) {
            frameIndex = rowIndex * PLAYTEST_WIZARD_SHEET_COLS + 2;
        } else if (wizard.moving === true || visualSpeed > 0.02) {
            const speed = Number(wizard.speed);
            const speedRatio = speed > 0 ? visualSpeed / speed : 0;
            const nowMs = (typeof performance !== "undefined" && performance && typeof performance.now === "function")
                ? performance.now()
                : Date.now();
            const animSpeed = Number.isFinite(Number(wizard.animationSpeedMultiplier))
                ? Number(wizard.animationSpeedMultiplier)
                : 1;
            const simTicks = (nowMs / 1000) * 60;
            const animFrame = Math.floor(simTicks * animSpeed * speedRatio / 2) % 8;
            const effectiveAnimFrame = wizard.isMovingBackward ? (7 - animFrame) : animFrame;
            frameIndex = rowIndex * PLAYTEST_WIZARD_SHEET_COLS + 1 + effectiveAnimFrame;
        }
        return frameIndex;
    }

    redrawPlaytestWizardHatGeometry() {
        const gfx = this.playtestHatGraphics;
        if (!gfx) throw new Error("building editor playtest wizard hat graphics are missing");
        const hatResolution = PLAYTEST_WIZARD_HAT_RESOLUTION;
        const brimX = 0 * hatResolution;
        const brimY = -0.625 * hatResolution;
        const brimWidth = 0.5 * hatResolution;
        const brimHeight = 0.25 * hatResolution;
        const pointX = 0 * hatResolution;
        const pointY = -0.65 * hatResolution;
        const pointHeight = 0.35 * hatResolution;
        const pointWidth = brimWidth * 0.6;
        const bandInnerHeight = brimHeight * 0.4;
        const bandInnerWidth = pointWidth * 0.8;
        const bandOuterWidth = pointWidth;
        const bandOuterHeight = brimHeight / brimWidth * bandOuterWidth;

        gfx.clear();
        gfx.beginFill(PLAYTEST_WIZARD_HAT_COLOR, 1);
        gfx.drawEllipse(brimX, brimY, brimWidth / 2, brimHeight / 2);
        gfx.endFill();
        gfx.beginFill(PLAYTEST_WIZARD_HAT_BAND_COLOR, 1);
        gfx.drawEllipse(brimX, brimY, bandOuterWidth / 2, bandOuterHeight / 2);
        gfx.endFill();
        gfx.beginFill(PLAYTEST_WIZARD_HAT_COLOR, 1);
        gfx.drawEllipse(brimX, brimY, bandInnerWidth / 2, bandInnerHeight / 2);
        gfx.drawRect(brimX - bandInnerWidth / 2, brimY - bandInnerHeight, bandInnerWidth, bandInnerHeight);
        gfx.endFill();
        gfx.beginFill(PLAYTEST_WIZARD_HAT_COLOR, 1);
        gfx.moveTo(pointX, pointY - pointHeight);
        gfx.lineTo(pointX - pointWidth / 2, pointY);
        gfx.lineTo(pointX + pointWidth / 2, pointY);
        gfx.closePath();
        gfx.endFill();
    }

    hidePlaytestWizardDisplay() {
        if (this.playtestShadowGraphics) {
            this.playtestShadowGraphics.clear();
            this.playtestShadowGraphics.visible = false;
        }
        if (this.playtestHatGraphics) {
            this.playtestHatGraphics.clear();
            this.playtestHatGraphics.visible = false;
        }
        if (this.playtestWizardSprite) {
            this.playtestWizardSprite.visible = false;
            if (Object.prototype.hasOwnProperty.call(this.playtestWizardSprite, "renderable")) {
                this.playtestWizardSprite.renderable = false;
            }
        }
        if (this.playtestWizardDepthMesh) {
            this.playtestWizardDepthMesh.visible = false;
            if (Object.prototype.hasOwnProperty.call(this.playtestWizardDepthMesh, "renderable")) {
                this.playtestWizardDepthMesh.renderable = false;
            }
        }
    }

    drawPlaytestWizard() {
        const wizard = this.state && this.state.playtestWizard ? this.state.playtestWizard : null;
        if (!wizard || wizard.active !== true) {
            this.hidePlaytestWizardDisplay();
            return;
        }
        const x = Number(wizard.x);
        const y = Number(wizard.y);
        const z = Number(wizard.z);
        if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
            throw new Error("building editor playtest wizard requires finite x/y/z");
        }
        const radius = Number.isFinite(Number(wizard.radius)) ? Math.max(0.05, Number(wizard.radius)) : 0.3;
        const zoom = Number(this.state.camera.zoom);
        if (!(zoom > 0)) throw new Error("building editor playtest wizard requires positive camera zoom");
        const center = this.worldToScreen({ x, y }, z);
        const shadowCenter = this.worldToScreen({ x, y }, z + PLAYTEST_WIZARD_SHADOW_RENDER_Z_OFFSET_UNITS);
        const px = Math.max(5, radius * zoom);
        const py = Math.max(3, px * 0.45);

        const shadow = this.playtestShadowGraphics;
        if (!shadow) throw new Error("building editor playtest wizard shadow graphics are missing");
        shadow.visible = true;
        shadow.clear();
        shadow.lineStyle(0, 0x000000, 0);
        shadow.beginFill(0x000000, 0.22);
        shadow.drawEllipse(shadowCenter.x, shadowCenter.y + py * 0.35, px * 0.95, py * 0.55);
        shadow.endFill();

        const frames = this.ensurePlaytestWizardFrames();
        if (!frames) {
            if (this.playtestWizardSprite) this.playtestWizardSprite.visible = false;
            if (this.playtestWizardDepthMesh) this.playtestWizardDepthMesh.visible = false;
            return;
        }
        const frameIndex = this.playtestWizardFrameIndex(wizard);
        const texture = frames[frameIndex];
        if (!texture) throw new Error(`building editor playtest wizard missing frame ${frameIndex}`);
        const sprite = this.ensurePlaytestWizardSprite(texture);
        sprite.x = center.x;
        sprite.y = center.y - zoom * 0.25;
        sprite.width = zoom;
        sprite.height = zoom;
        sprite.rotation = 0;
        sprite.alpha = 1;
        sprite.visible = false;
        if (Object.prototype.hasOwnProperty.call(sprite, "renderable")) {
            sprite.renderable = false;
        }
        const depthMesh = this.ensurePlaytestWizardDepthMesh();
        this.updatePlaytestWizardDepthMesh(depthMesh, texture, wizard, sprite);

        this.redrawPlaytestWizardHatGeometry();
        const hat = this.playtestHatGraphics;
        hat.visible = true;
        hat.x = center.x;
        hat.y = sprite.y - (PLAYTEST_WIZARD_HAT_RENDER_Y_OFFSET_UNITS * zoom * GAME_XY_RATIO);
        if (!hat.scale || typeof hat.scale.set !== "function") {
            throw new Error("building editor playtest wizard hat requires a Pixi scale");
        }
        const hatScale = (zoom / PLAYTEST_WIZARD_HAT_RESOLUTION) * PLAYTEST_WIZARD_HAT_RENDER_SCALE;
        hat.scale.set(hatScale, hatScale);
    }

    // ── Beam and Column rendering ────────────────────────────────────────────

    drawStairRecord(gfx, stair, preview = false) {
        if (preview) {
            this.drawStairPreviewRecord(gfx, stair);
            return;
        }
        const boundaryTreads = this.stairRenderTreads(stair);
        const footprintSource = stair && stair.pendingTread
            ? { ...stair, treads: [...(Array.isArray(stair.treads) ? stair.treads : []), stair.pendingTread] }
            : stair;
        const footprint = stairFootprintPoints(footprintSource);
        if (!Array.isArray(footprint) || footprint.length < 4) {
            throw new Error(`stair ${stair && stair.id ? stair.id : "(preview)"} has invalid footprint`);
        }
        const baseZ = Number.isFinite(Number(stair.bottomZ)) ? Number(stair.bottomZ) : this.activePlaneZ();
        const height = Number.isFinite(Number(stair.height)) ? Number(stair.height) : 3;
        const topZ = String(stair.direction || "up") === "down" ? baseZ - height : baseZ + height;
        const color = 0xcaa16a;
        const outline = 0x111820;
        const alpha = 0.42;
        const screens = footprint.map((point) => this.worldToScreen(point, baseZ));
        gfx.lineStyle(1, outline, 0.55);
        gfx.beginFill(color, alpha);
        gfx.moveTo(screens[0].x, screens[0].y);
        for (let i = 1; i < screens.length; i++) gfx.lineTo(screens[i].x, screens[i].y);
        gfx.closePath();
        gfx.endFill();

        if (boundaryTreads.length >= 2 && stair.ladder !== true) {
            const platformCount = Math.max(1, boundaryTreads.length - 1);
            for (let index = 0; index < platformCount; index++) {
                const z = baseZ + (topZ - baseZ) * ((index + 1) / (boundaryTreads.length + 1));
                const current = boundaryTreads[index];
                const next = boundaryTreads[index + 1];
                const face = [current.left, next.left, next.right, current.right].map((point) => this.worldToScreen(point, z));
                gfx.lineStyle(1, outline, 0.42);
                gfx.beginFill(color, 0.28);
                gfx.moveTo(face[0].x, face[0].y);
                for (let i = 1; i < face.length; i++) gfx.lineTo(face[i].x, face[i].y);
                gfx.closePath();
                gfx.endFill();
            }
        }

        boundaryTreads.forEach((tread, index) => {
            const z = baseZ + (topZ - baseZ) * ((index + 1) / (boundaryTreads.length + 1));
            const leftScreen = this.worldToScreen(tread.left, z);
            const rightScreen = this.worldToScreen(tread.right, z);
            gfx.lineStyle(index === 0 ? 2 : 1, outline, 0.5);
            gfx.moveTo(leftScreen.x, leftScreen.y);
            gfx.lineTo(rightScreen.x, rightScreen.y);
        });
    }

    drawStairPreviewRecord(gfx, stair) {
        const sourceTreadCount = Array.isArray(stair && stair.treads) ? stair.treads.length : 0;
        const finishHoverIndex = stair && stair.finishTreadHover === true && sourceTreadCount >= 2
            ? sourceTreadCount - 1
            : -1;
        const treads = Array.isArray(stair && stair.treads) ? [...stair.treads] : [];
        if (stair && stair.pendingTread) treads.push(stair.pendingTread);
        if (!treads.length) return;
        const baseZ = Number.isFinite(Number(stair.bottomZ)) ? Number(stair.bottomZ) : this.activePlaneZ();
        const height = Number(stair && stair.height);
        if (Number.isFinite(height) && height > 0 && (stair.ladder === true || treads.length >= 2)) {
            const previewStair = { ...stair, treads };
            const steps = this.stairStepPolygons(previewStair);
            steps.forEach((step) => {
                const polygon = Array.isArray(step.polygon) ? step.polygon : [];
                if (polygon.length < 3) return;
                const screens = polygon.map((point) => this.worldToScreen(point, step.z));
                gfx.lineStyle(2, 0x42a5ff, 0.95);
                gfx.moveTo(screens[0].x, screens[0].y);
                for (let index = 1; index < screens.length; index++) {
                    gfx.lineTo(screens[index].x, screens[index].y);
                }
                gfx.lineTo(screens[0].x, screens[0].y);
            });
        }
        const centerFor = (tread) => tread.center || {
            x: (Number(tread.left.x) + Number(tread.right.x)) * 0.5,
            y: (Number(tread.left.y) + Number(tread.right.y)) * 0.5
        };

        if (treads.length >= 2) {
            gfx.lineStyle(1, 0xf4f2e8, 0.72);
            for (let index = 1; index < treads.length; index++) {
                const start = this.worldToScreen(centerFor(treads[index - 1]), baseZ);
                const end = this.worldToScreen(centerFor(treads[index]), baseZ);
                gfx.moveTo(start.x, start.y);
                gfx.lineTo(end.x, end.y);
            }
        }

        treads.forEach((tread, index) => {
            const leftScreen = this.worldToScreen(tread.left, baseZ);
            const rightScreen = this.worldToScreen(tread.right, baseZ);
            const finishHover = index === finishHoverIndex;
            if (finishHover) {
                gfx.lineStyle(4, 0xff4f4f, 1);
                gfx.moveTo(leftScreen.x, leftScreen.y);
                gfx.lineTo(rightScreen.x, rightScreen.y);
                return;
            }
            const dx = Number(rightScreen.x) - Number(leftScreen.x);
            const dy = Number(rightScreen.y) - Number(leftScreen.y);
            const length = Math.hypot(dx, dy);
            const offsetX = length > GEOMETRY_EPSILON ? -dy / length : 0;
            const offsetY = length > GEOMETRY_EPSILON ? dx / length : 0;
            const alpha = index === treads.length - 1 ? 0.95 : 0.78;
            gfx.lineStyle(index === 0 ? 3 : 2, 0x05070a, alpha);
            gfx.moveTo(leftScreen.x - offsetX, leftScreen.y - offsetY);
            gfx.lineTo(rightScreen.x - offsetX, rightScreen.y - offsetY);
            gfx.lineStyle(index === 0 ? 3 : 2, 0xffffff, alpha);
            gfx.moveTo(leftScreen.x + offsetX, leftScreen.y + offsetY);
            gfx.lineTo(rightScreen.x + offsetX, rightScreen.y + offsetY);
        });
    }

    stairRenderTreads(stair) {
        const sourceTreads = Array.isArray(stair && stair.treads) ? [...stair.treads] : [];
        if (stair && stair.pendingTread) sourceTreads.push(stair.pendingTread);
        if (sourceTreads.length === 0) return [];
        if (stair.ladder === true) {
            const stepCount = Math.max(1, Math.round(Number(stair.stepCount) || sourceTreads.length || 1));
            return Array.from({ length: stepCount }, () => ({
                left: { x: Number(sourceTreads[0].left.x), y: Number(sourceTreads[0].left.y) },
                right: { x: Number(sourceTreads[0].right.x), y: Number(sourceTreads[0].right.y) }
            }));
        }
        if (sourceTreads.length < 2) {
            return sourceTreads.map((tread) => ({
                left: { x: Number(tread.left.x), y: Number(tread.left.y) },
                right: { x: Number(tread.right.x), y: Number(tread.right.y) }
            }));
        }
        const centers = sourceTreads.map((tread) => ({
            x: (Number(tread.left.x) + Number(tread.right.x)) * 0.5,
            y: (Number(tread.left.y) + Number(tread.right.y)) * 0.5
        }));
        const lengths = [0];
        for (let i = 1; i < centers.length; i++) {
            lengths[i] = lengths[i - 1] + Math.hypot(centers[i].x - centers[i - 1].x, centers[i].y - centers[i - 1].y);
        }
        const total = lengths[lengths.length - 1];
        if (!Number.isFinite(total) || total <= GEOMETRY_EPSILON) return sourceTreads;
        const stepCount = Math.max(1, Math.round(Number(stair.stepCount) || sourceTreads.length));
        const out = [];
        for (let step = 0; step < stepCount; step++) {
            const target = total * ((step + 1) / (stepCount + 1));
            let segmentIndex = 1;
            while (segmentIndex < lengths.length - 1 && lengths[segmentIndex] < target) segmentIndex++;
            const previousLength = lengths[segmentIndex - 1];
            const segmentLength = lengths[segmentIndex] - previousLength;
            const t = segmentLength <= GEOMETRY_EPSILON ? 0 : (target - previousLength) / segmentLength;
            const a = sourceTreads[segmentIndex - 1];
            const b = sourceTreads[segmentIndex];
            out.push({
                left: {
                    x: Number(a.left.x) + (Number(b.left.x) - Number(a.left.x)) * t,
                    y: Number(a.left.y) + (Number(b.left.y) - Number(a.left.y)) * t
                },
                right: {
                    x: Number(a.right.x) + (Number(b.right.x) - Number(a.right.x)) * t,
                    y: Number(a.right.y) + (Number(b.right.y) - Number(a.right.y)) * t
                }
            });
        }
        return out;
    }

    drawStairs() {
        const floors = this.renderedFloors();
        const floorIds = new Set(floors.map((f) => getFloorId(f)));
        const exterior = this.state.renderStyle() === "exterior";
        const floorAlphaById = this.renderedFloorAlphaMap(floors, exterior);
        const liveStairMeshIds = new Set();
        getBuildingFloors(this.state.building).forEach((ownerFloor) => {
            getFloorStairs(ownerFloor).forEach((stair) => {
                const ownerFloorId = getFloorId(ownerFloor);
                const visibleThroughRenderedFloor = floorIds.has(ownerFloorId) ||
                    floors.some((floor) => getFloorId(floor) !== ownerFloorId && this.stairOpeningIntersectsFloor(stair, floor));
                if (!visibleThroughRenderedFloor) return;
                const key = stairMeshKey(ownerFloor, stair);
                const stairAlphas = [];
                if (floorIds.has(ownerFloorId)) stairAlphas.push(floorAlphaById.get(ownerFloorId) ?? 1);
                floors
                    .filter((floor) => getFloorId(floor) !== ownerFloorId && this.stairOpeningIntersectsFloor(stair, floor))
                    .forEach((floor) => stairAlphas.push(floorAlphaById.get(getFloorId(floor)) ?? 1));
                if (stairAlphas.length === 0) {
                    throw new Error(`visible stair ${stair.id} has no resolved floor alpha`);
                }
                const stairAlpha = Math.max(...stairAlphas);
                const mesh = this.syncStairMesh(ownerFloor, stair, stairAlpha);
                if (mesh) this.lastStairPickEntries.push({ stair, floor: ownerFloor, mesh });
                liveStairMeshIds.add(key);
            });
        });
        for (const [key, entry] of this.stairMeshById.entries()) {
            if (!liveStairMeshIds.has(key) && entry && entry.mesh) entry.mesh.visible = false;
        }
    }

    _beamBoxVertices(beam, floor) {
        const pts = this.state.beamWorldPoints(beam);
        if (!pts) return null;
        const dx = pts.end.x - pts.start.x;
        const dy = pts.end.y - pts.start.y;
        const len = Math.hypot(dx, dy);
        if (len < GEOMETRY_EPSILON) return null;
        const px = -dy / len;
        const py = dx / len;
        const wall = beam.startAttachment && beam.startAttachment.kind === "wall"
            ? (() => { try { return this.state.building.wallSections.find((w) => Number(w.id) === Number(beam.startAttachment.hostId)); } catch (e) { return null; } })()
            : null;
        const renderedThickness = wall ? wall.thickness + 0.001 : beam.thickness;
        const hw = renderedThickness * 0.5;
        const bz = pts.start.z;
        const tz = bz + beam.height;
        return [
            { x: pts.start.x + px * hw, y: pts.start.y + py * hw, zB: bz, zT: tz },
            { x: pts.start.x - px * hw, y: pts.start.y - py * hw, zB: bz, zT: tz },
            { x: pts.end.x - px * hw, y: pts.end.y - py * hw, zB: bz, zT: tz },
            { x: pts.end.x + px * hw, y: pts.end.y + py * hw, zB: bz, zT: tz }
        ];
    }

    createBeamPickMesh(beam, floor) {
        const verts = this._beamBoxVertices(beam, floor);
        if (!verts) return null;
        const pos = new Float32Array(8 * 3);
        verts.forEach((v, i) => {
            pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.zB;
        });
        verts.forEach((v, i) => {
            pos[(i + 4) * 3] = v.x; pos[(i + 4) * 3 + 1] = v.y; pos[(i + 4) * 3 + 2] = v.zT;
        });
        const idx = new Uint16Array([
            0,1,2, 0,2,3,
            4,5,6, 4,6,7,
            0,1,5, 0,5,4,
            1,2,6, 1,6,5,
            2,3,7, 2,7,6,
            3,0,4, 3,4,7
        ]);
        try {
            return this.createSolidDepthMesh(`beam:${beam.id}`, pos, idx, debugWallColor(beam.id));
        } catch (e) {
            return null;
        }
    }

    createColumnPickMesh(column, floor) {
        const verts = columnVertices(column);
        if (!verts || verts.length < 3) {
            throw new Error(`screen picker column ${column && column.id} requires at least three vertices`);
        }
        const n = verts.length;
        const bz = Number(column.bottomZ);
        const height = Number(column.height);
        if (!Number.isFinite(bz) || !Number.isFinite(height) || height <= 0) {
            throw new Error(`screen picker column ${column && column.id} requires finite positive height and bottomZ`);
        }
        const topHeights = this.columnTopHeightsForRender(column, floor);
        const pos = new Float32Array(n * 2 * 3);
        for (let i = 0; i < n; i++) {
            if (!Number.isFinite(Number(verts[i].x)) || !Number.isFinite(Number(verts[i].y))) {
                throw new Error(`screen picker column ${column && column.id} has a non-finite vertex`);
            }
            pos[i * 3] = verts[i].x; pos[i * 3 + 1] = verts[i].y; pos[i * 3 + 2] = bz;
            pos[(i + n) * 3] = verts[i].x;
            pos[(i + n) * 3 + 1] = verts[i].y;
            pos[(i + n) * 3 + 2] = bz + (topHeights ? topHeights[i] : height);
        }
        const triCount = (n - 2) * 2 + n * 2;
        const idx = new Uint16Array(triCount * 3);
        let t = 0;
        for (let i = 1; i < n - 1; i++) { idx[t++] = 0; idx[t++] = i; idx[t++] = i + 1; }
        for (let i = 1; i < n - 1; i++) { idx[t++] = n; idx[t++] = n + i + 1; idx[t++] = n + i; }
        for (let i = 0; i < n; i++) {
            const a = i, b = (i + 1) % n;
            idx[t++] = a; idx[t++] = b; idx[t++] = n + b;
            idx[t++] = a; idx[t++] = n + b; idx[t++] = n + a;
        }
        return this.createSolidDepthMesh(`column:${column.id}`, pos, idx, debugWallColor(column.id + 10000));
    }

    drawBeams() {
        const gfx = this.wallLayer;
        const floors = this.renderedFloors();
        const floorIds = new Set(floors.map((f) => getFloorId(f)));
        const exterior = this.state.renderStyle() === "exterior";
        const floorAlphaById = this.renderedFloorAlphaMap(floors, exterior);
        getBuildingFloors(this.state.building).forEach((floor) => {
            const floorId = getFloorId(floor);
            if (!floorIds.has(floorId)) return;
            const floorAlpha = floorAlphaById.get(floorId) ?? 1;
            getFloorBeams(floor).forEach((beam) => {
                const verts = this._beamBoxVertices(beam, floor);
                if (!verts) return;
                const selected = this.state.isBeamSelected(beam.id);
                const color = selected ? 0xffd27a : 0xd4aa70;
                const outlineColor = selected ? 0xfff0b8 : 0x111820;
                const bVerts = verts.map((v) => this.worldToScreen(v, v.zB));
                const tVerts = verts.map((v) => this.worldToScreen(v, v.zT));
                gfx.lineStyle(selected ? 2 : 1, outlineColor, (selected ? 0.95 : 0.5) * floorAlpha);
                gfx.beginFill(color, (selected ? 0.72 : 0.52) * floorAlpha);
                [[bVerts[0], bVerts[1], bVerts[2], bVerts[3]],
                 [tVerts[0], tVerts[1], tVerts[2], tVerts[3]],
                 [bVerts[0], bVerts[1], tVerts[1], tVerts[0]],
                 [bVerts[1], bVerts[2], tVerts[2], tVerts[1]],
                 [bVerts[2], bVerts[3], tVerts[3], tVerts[2]],
                 [bVerts[3], bVerts[0], tVerts[0], tVerts[3]]
                ].forEach((face) => {
                    gfx.moveTo(face[0].x, face[0].y);
                    for (let i = 1; i < face.length; i++) gfx.lineTo(face[i].x, face[i].y);
                    gfx.closePath();
                });
                gfx.endFill();
            });
        });
    }

    drawColumns() {
        const gfx = this.wallLayer;
        const floors = this.renderedFloors();
        const floorIds = new Set(floors.map((f) => getFloorId(f)));
        const exterior = this.state.renderStyle() === "exterior";
        const floorAlphaById = this.renderedFloorAlphaMap(floors, exterior);
        getBuildingFloors(this.state.building).forEach((floor) => {
            const floorId = getFloorId(floor);
            if (!floorIds.has(floorId)) return;
            const floorAlpha = floorAlphaById.get(floorId) ?? 1;
            getFloorColumns(floor).forEach((column) => {
                const verts = columnVertices(column);
                if (!verts || verts.length < 3) return;
                const selected = this.state.isColumnSelected(column.id);
                const color = selected ? 0xffd27a : 0xb0a090;
                const outlineColor = selected ? 0xfff0b8 : 0x111820;
                const bz = column.bottomZ;
                const tz = bz + column.height;
                const bScreen = verts.map((v) => this.worldToScreen(v, bz));
                const tScreen = verts.map((v) => this.worldToScreen(v, tz));
                const n = verts.length;
                gfx.lineStyle(selected ? 2 : 1, outlineColor, (selected ? 0.95 : 0.5) * floorAlpha);
                gfx.beginFill(color, (selected ? 0.72 : 0.52) * floorAlpha);
                gfx.moveTo(bScreen[0].x, bScreen[0].y);
                for (let i = 1; i < n; i++) gfx.lineTo(bScreen[i].x, bScreen[i].y);
                gfx.closePath();
                gfx.moveTo(tScreen[0].x, tScreen[0].y);
                for (let i = 1; i < n; i++) gfx.lineTo(tScreen[i].x, tScreen[i].y);
                gfx.closePath();
                for (let i = 0; i < n; i++) {
                    const b0 = bScreen[i], b1 = bScreen[(i + 1) % n];
                    const t0 = tScreen[i], t1 = tScreen[(i + 1) % n];
                    gfx.moveTo(b0.x, b0.y); gfx.lineTo(b1.x, b1.y);
                    gfx.lineTo(t1.x, t1.y); gfx.lineTo(t0.x, t0.y);
                    gfx.closePath();
                }
                gfx.endFill();
            });
        });
    }

    beamScreenOutlineRings(beam, floor) {
        const verts = this._beamBoxVertices(beam, floor);
        if (!verts) return [];
        const bz = verts[0].zB, tz = verts[0].zT;
        const points = [
            ...verts.map((v) => this.worldToScreen(v, bz)),
            ...verts.slice().reverse().map((v) => this.worldToScreen(v, tz))
        ];
        const ring = points.map((s) => [s.x, s.y]);
        ring.push(ring[0]);
        return [ring];
    }

    columnScreenOutlineRings(column) {
        const verts = columnVertices(column);
        if (!verts || verts.length < 3) return [];
        const bz = column.bottomZ, tz = bz + column.height;
        const points = [
            ...verts.map((v) => this.worldToScreen(v, bz)),
            ...verts.slice().reverse().map((v) => this.worldToScreen(v, tz))
        ];
        const ring = points.map((s) => [s.x, s.y]);
        ring.push(ring[0]);
        return [ring];
    }

    drawSelectedBeamEndpointHandles(gfx) {
        const beam = this.state.selectedBeam();
        if (!beam) return;
        const pts = this.state.beamWorldPoints(beam);
        if (!pts) return;
        const sel = this.state.selection;
        [
            { point: pts.start, key: "startAttachment" },
            { point: pts.end, key: "endAttachment" }
        ].forEach(({ point, key }) => {
            const selected = sel && sel.beamEndpointKey === key;
            const screen = this.worldToScreen(point, point.z);
            gfx.beginFill(selected ? 0xffffff : 0xffd27a, 1);
            gfx.lineStyle(selected ? 3 : 2, selected ? 0xffd27a : 0x111820, 1);
            gfx.drawCircle(screen.x, screen.y, selected ? 7 : 5);
            gfx.endFill();
        });
    }
}
