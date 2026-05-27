import { flattenPolygon, polygonCentroid } from "./BuildingGeometry.js";
import { validateBuilding } from "./BuildingValidation.js";
import { ADJACENT_DIRECTIONS, hexCorners, immediateNeighborOffset, offsetToWorld, visibleHexRange } from "./BuildingHexGrid.js";
import { ringsForFloor } from "./BuildingPolygonEditing.js";
import { findFloor, findWall, getBuildingMountedObjects, getBuildingFloors, getBuildingWalls, getFloorElevation, getFloorId, offsetRing, wallCenterlinePoints, wallPoints } from "./BuildingModel.js";

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
const COLLAPSED_WALL_FRONT_DEPTH_EPSILON = 0.05;
const SCENE_LIGHT_TILT_RADIANS = 20 * Math.PI / 180;
const SCENE_LIGHT_DIFFUSE = 0.95;
const SCENE_LIGHT_MIN = 0.58;
const SCENE_LIGHT_MAX = 1.36;
const DEFAULT_WALL_TEXTURE_REPEAT = 0.1;
const PICKER_DEBUG_DEPTH_BIAS = 0.05;
const SELECTION_OUTLINE_COLOR = 0x42a5ff;
const SELECTION_OUTLINE_SHADOW_COLOR = 0x07131f;

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
uniform vec2 uDepthRange;
uniform float uDepthBias;
uniform float uCameraRotation;
uniform vec2 uCameraRotationCenter;
uniform vec3 uLightVector;
uniform float uLightDiffuse;
uniform vec2 uLightClamp;
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
    vec3 normal = normalize(vec3(
        aWorldNormal.x * cosR - aWorldNormal.y * sinR,
        aWorldNormal.x * sinR + aWorldNormal.y * cosR,
        aWorldNormal.z
    ));
    vec3 light = normalize(uLightVector);
    float lightDot = dot(normal, light);
    float upwardWeight = smoothstep(0.25, 0.75, abs(normal.z));
    float overheadBaseline = light.z * upwardWeight;
    vLightFactor = clamp(1.0 + (lightDot - overheadBaseline) * uLightDiffuse, uLightClamp.x, uLightClamp.y);
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
}
`;

const SOLID_DEPTH_FS = `
precision highp float;
uniform vec4 uColor;
void main(void) {
    gl_FragColor = uColor;
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

function roofOverhang(floor) {
    const value = Number(floor && floor.roofOverhang);
    if (!Number.isFinite(value)) throw new Error(`roof ${getFloorId(floor)} overhang must be finite`);
    return value;
}

function roofPeakHeight(floor) {
    const value = Number(floor && floor.roofPeakHeight);
    if (!Number.isFinite(value) || value < 0) {
        throw new Error(`roof ${getFloorId(floor)} peak height must be zero or greater`);
    }
    return value;
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

function triangulatePitchedRoof(floor) {
    const floorId = getFloorId(floor);
    const holes = Array.isArray(floor && floor.holes) ? floor.holes.filter((ring) => Array.isArray(ring) && ring.length >= 3) : [];
    if (holes.length > 0) {
        throw new Error(`roof ${floorId} with overhang or peak height cannot render floor holes yet`);
    }
    const contactRing = ringPointsForTriangulation(floor && floor.outerPolygon);
    if (contactRing.length < 3) return null;
    const overhang = roofOverhang(floor);
    const peakHeight = roofPeakHeight(floor);
    const rimZ = roofRenderElevation(floor);
    const center = polygonCentroid(contactRing);
    if (!Number.isFinite(Number(center && center.x)) || !Number.isFinite(Number(center && center.y))) {
        throw new Error(`roof ${floorId} requires a finite center point`);
    }
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
    const addTexturedFan = (ring) => {
        const cumulative = ringCumulativeLengths(ring);
        const ringLength = ring.length;
        for (let index = 0; index < ringLength; index++) {
            const next = (index + 1) % ringLength;
            const a = ring[index];
            const b = ring[next];
            const uA = cumulative[index] * ROOF_TEXTURE_REPEAT;
            const uB = cumulative[index + 1] * ROOF_TEXTURE_REPEAT;
            const uCenter = (uA + uB) * 0.5;
            const slopeDistance = Math.hypot(distancePointToLineSegment(center, a, b), peakHeight);
            const vCenter = Math.max(1, slopeDistance * ROOF_TEXTURE_REPEAT);
            addTriangle(
                { x: Number(a.x), y: Number(a.y), z: rimZ, u: uA, v: 0 },
                { x: Number(b.x), y: Number(b.y), z: rimZ, u: uB, v: 0 },
                { x: Number(center.x), y: Number(center.y), z: rimZ + peakHeight, u: uCenter, v: vCenter }
            );
        }
    };

    if (overhang < -GEOMETRY_EPSILON) {
        const innerRing = offsetRing(contactRing, overhang);
        if (!Array.isArray(innerRing) || innerRing.length !== contactRing.length) {
            throw new Error(`roof ${floorId} negative overhang requires a valid inset ring`);
        }
        const ringLength = contactRing.length;
        const cumulative = ringCumulativeLengths(contactRing);
        for (let index = 0; index < ringLength; index++) {
            const next = (index + 1) % ringLength;
            const outerA = contactRing[index];
            const outerB = contactRing[next];
            const innerA = innerRing[index];
            const innerB = innerRing[next];
            const uA = cumulative[index] * ROOF_TEXTURE_REPEAT;
            const uB = cumulative[index + 1] * ROOF_TEXTURE_REPEAT;
            const vInnerA = Math.hypot(Number(innerA.x) - Number(outerA.x), Number(innerA.y) - Number(outerA.y)) * ROOF_TEXTURE_REPEAT;
            const vInnerB = Math.hypot(Number(innerB.x) - Number(outerB.x), Number(innerB.y) - Number(outerB.y)) * ROOF_TEXTURE_REPEAT;
            addTriangle(
                { x: Number(outerA.x), y: Number(outerA.y), z: rimZ, u: uA, v: 0 },
                { x: Number(outerB.x), y: Number(outerB.y), z: rimZ, u: uB, v: 0 },
                { x: Number(innerB.x), y: Number(innerB.y), z: rimZ, u: uB, v: vInnerB }
            );
            addTriangle(
                { x: Number(outerA.x), y: Number(outerA.y), z: rimZ, u: uA, v: 0 },
                { x: Number(innerB.x), y: Number(innerB.y), z: rimZ, u: uB, v: vInnerB },
                { x: Number(innerA.x), y: Number(innerA.y), z: rimZ, u: uA, v: vInnerA }
            );
        }
        addTexturedFan(innerRing);
        return { points, indices: new Uint16Array(indices) };
    }

    const outerRing = overhang > GEOMETRY_EPSILON ? offsetRing(contactRing, overhang) : contactRing;
    if (!Array.isArray(outerRing) || outerRing.length < 3) {
        throw new Error(`roof ${floorId} overhang requires a valid outer ring`);
    }
    addTexturedFan(outerRing);
    return { points, indices: new Uint16Array(indices) };
}

function triangulateRoof(floor) {
    const hasOverhang = Math.abs(roofOverhang(floor)) > GEOMETRY_EPSILON;
    const hasPeak = roofPeakHeight(floor) > GEOMETRY_EPSILON;
    return hasOverhang || hasPeak ? triangulatePitchedRoof(floor) : triangulateFloor(floor);
}

function roofMeshSignature(floor) {
    return [
        surfaceMeshSignature(floor, floor.roofTexturePath, roofRenderElevation(floor)),
        Number(roofOverhang(floor)).toFixed(4),
        Number(roofPeakHeight(floor)).toFixed(4)
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

function debugSurfaceColor(type, floorId) {
    const offset = type === "roof" ? 113 : 29;
    const seed = String(floorId || "")
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
        this.mountedObjectLayer = new PIXI.Container();
        this.selectionOutlineLayer = new PIXI.Graphics();
        this.handleLayer = new PIXI.Graphics();
        this.draftLayer = new PIXI.Graphics();
        this.pickerDepthDebugLayer = new PIXI.Container();
        this.pickerDebugLayer = new PIXI.Graphics();
        this.pickerDebugLabels = new PIXI.Container();
        this.floorMeshById = new Map();
        this.roofMeshById = new Map();
        this.wallUnitById = new Map();
        this.mountedObjectMeshById = new Map();
        this.mountedObjectPreviewMesh = null;
        this.floorTextureByPath = new Map();
        this.floorDepthState = null;
        this.collapsedWallGeometryByFloorId = new Map();
        this.lastWallPickEntries = [];
        this.lastSurfacePickEntries = [];
        this.lastMountedObjectPickEntries = [];
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
            this.pickerDepthDebugLayer,
            this.pickerDebugLayer,
            this.pickerDebugLabels
        );
        this.app.stage.addChild(this.root);
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
        this.drawGameStyleBuilding();
        this.drawFloorUnderlay(this.floorLayer);
        this.drawMountedObjects();
        this.drawScreenPickerDebug(this.lastWallPickEntries);
        this.drawSelectionOutline();
        this.drawHandles();
        this.drawDraft();
        this.drawMountedObjectPreview();
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
        u.uDepthRange[0] = FLOOR_DEPTH_FAR_METRIC;
        u.uDepthRange[1] = 1 / Math.max(1e-6, FLOOR_DEPTH_FAR_METRIC - FLOOR_DEPTH_NEAR_METRIC);
        u.uDepthBias = Number(depthBias);
        u.uCameraRotation = Number(this.state.camera.rotation) || 0;
        const rotationCenter = this.state.camera.rotationCenter || this.state.buildingCenter();
        u.uCameraRotationCenter[0] = Number(rotationCenter.x) || 0;
        u.uCameraRotationCenter[1] = Number(rotationCenter.y) || 0;
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
            uvs[index * 2] = hasCustomUv ? Number(point.u) : Number(point.x) * textureRepeat;
            uvs[index * 2 + 1] = hasCustomUv ? Number(point.v) : Number(point.y) * textureRepeat;
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
        u.uTint[0] = lightFactor;
        u.uTint[1] = lightFactor;
        u.uTint[2] = lightFactor;
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
            const triangulation = triangulateRoof(floor);
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
                {
                    endpointKey: "startPoint",
                    sharedEnd: "start",
                    point: authoredPoints[0],
                    farPoint: authoredPoints[1],
                    runtimePoint: unit.startPoint,
                    runtimeFarPoint: unit.endPoint
                },
                {
                    endpointKey: "endPoint",
                    sharedEnd: "end",
                    point: authoredPoints[1],
                    farPoint: authoredPoints[0],
                    runtimePoint: unit.endPoint,
                    runtimeFarPoint: unit.startPoint
                }
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
                    profileSharedPoint: endpoint.runtimePoint,
                    profileFarPoint: endpoint.runtimeFarPoint,
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
            const sharedPoint = finite2dPoint(item.profileSharedPoint) ? item.profileSharedPoint : item.sharedPoint;
            const farPoint = finite2dPoint(item.profileFarPoint) ? item.profileFarPoint : item.farPoint;
            const dx = Number(farPoint.x) - Number(sharedPoint.x);
            const dy = Number(farPoint.y) - Number(sharedPoint.y);
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
                    x: Number(sharedPoint.x) + leftN.x * halfT,
                    y: Number(sharedPoint.y) + leftN.y * halfT
                },
                rightFace: {
                    x: Number(sharedPoint.x) - leftN.x * halfT,
                    y: Number(sharedPoint.y) - leftN.y * halfT
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
        let openArea = [floorPolygon];
        if (wallFootprints.length > 0) {
            try {
                openArea = clipper.difference(floorPolygon, ...wallFootprints.map((entry) => entry.footprint));
            } catch (error) {
                for (let index = 0; index < wallFootprints.length; index++) {
                    const entry = wallFootprints[index];
                    try {
                        clipper.difference(floorPolygon, ...wallFootprints.slice(0, index + 1).map((item) => item.footprint));
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

    wallRenderProfilePoints(wall, floor, wallEntries = null, label = "wall render profile") {
        const renderProfile = this.wallProfileForRender(wall, wallEntries);
        return renderProfile
            ? wallProfilePolygonFromProfile(renderProfile, label)
            : wallProfilePoints(this.state.building, wall, floor);
    }

    wallScreenImagePolygon(wall, floor, wallEntries = null) {
        const baseZ = getFloorElevation(floor);
        const height = Number(wall && wall.height);
        if (!Number.isFinite(height) || height <= 0) {
            throw new Error(`wall ${wall && wall.id} screen image requires a positive height`);
        }
        const profile = this.wallRenderProfilePoints(wall, floor, wallEntries, `wall ${wall && wall.id} mitered screen image`);
        const projected = [];
        profile.forEach((point) => {
            projected.push(this.worldToScreen(point, baseZ));
            projected.push(this.worldToScreen(point, baseZ + height));
        });
        return [closedClipRing(convexHull(projected, `wall ${wall && wall.id} screen image`), `wall ${wall && wall.id} screen image`)];
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
        const rings = [];
        if (overhang > GEOMETRY_EPSILON) {
            rings.push(closedClipRing(offsetRing(floor && floor.outerPolygon, overhang), `${label} overhang outer polygon`));
        } else {
            rings.push(closedClipRing(floor && floor.outerPolygon, `${label} contact outer polygon`));
            if (Math.abs(overhang) <= GEOMETRY_EPSILON && roofPeakHeight(floor) <= GEOMETRY_EPSILON) {
                (Array.isArray(floor && floor.holes) ? floor.holes : []).forEach((ring, index) => {
                    rings.push(closedClipRing(ring, `${label} hole ${index}`));
                });
            }
        }
        return this.projectClipGeometryToScreen([rings], roofRenderElevation(floor))
            .map((polygon, polygonIndex) => polygon.map((ring, ringIndex) => {
                if (!looksLikeClipRing(ring)) {
                    throw new Error(`${label} projected malformed roof ring ${polygonIndex}:${ringIndex}`);
                }
                return ring;
            }));
    }

    surfaceEntryScreenGeometry(entry, label) {
        if (!entry || !entry.floor) throw new Error(`${label} requires a surface entry with a floor`);
        return entry.type === "roof"
            ? this.roofScreenGeometry(entry.floor, label)
            : this.surfaceScreenGeometry(entry.floor, entry.z, label);
    }

    worldDepthMetric(point, z) {
        const camera = this.state.camera;
        const cameraZ = Number.isFinite(Number(camera.z)) ? Number(camera.z) : 0;
        const rotated = this.rotatePointForCamera(point);
        return (Number(rotated.y) - Number(camera.y)) + (Number(z) - cameraZ);
    }

    surfaceDepthMetricAtScreen(screenPoint, z) {
        const point = screenPointToClipPoint(screenPoint, "surface screen pick");
        const camera = this.state.camera;
        const cameraZ = Number.isFinite(Number(camera.z)) ? Number(camera.z) : 0;
        const zoom = Number(camera.zoom);
        if (!Number.isFinite(zoom) || zoom <= 0) {
            throw new Error("surface screen picking requires a positive camera zoom");
        }
        const camDy = (point[1] - this.app.screen.height / 2) / (zoom * GAME_XY_RATIO) + (Number(z) - cameraZ);
        return camDy + (Number(z) - cameraZ);
    }

    wallScreenPickDepthMetric(wall, floor, wallEntries = null) {
        const baseZ = getFloorElevation(floor);
        const height = Number(wall && wall.height);
        if (!Number.isFinite(height) || height <= 0) {
            throw new Error(`wall ${wall && wall.id} screen picking requires a positive height`);
        }
        const profile = this.wallRenderProfilePoints(wall, floor, wallEntries, `wall ${wall && wall.id} screen pick profile`);
        if (this.shouldDrawWallCollapsed(wall, floor, wallEntries)) {
            return profile.reduce((best, point) => Math.max(best, this.worldDepthMetric(point, baseZ)), -Infinity);
        }
        return profile.reduce((best, point) => Math.max(
            best,
            this.worldDepthMetric(point, baseZ),
            this.worldDepthMetric(point, baseZ + height)
        ), -Infinity);
    }

    pickWallAtScreen(screenPoint) {
        const hit = this.pickAtScreen(screenPoint, { includeSurfaces: false });
        return hit && hit.type === "wall" ? hit : null;
    }

    pickSurfaceAtScreen(screenPoint) {
        const hit = this.pickAtScreen(screenPoint, { includeWalls: false });
        return hit && (hit.type === "floor" || hit.type === "roof") ? hit : null;
    }

    pickAtScreen(screenPoint, options = {}) {
        const point = screenPointToClipPoint(screenPoint, "wall screen pick");
        let best = null;
        let bestMountedObject = null;
        const includeWalls = options.includeWalls !== false;
        const includeSurfaces = options.includeSurfaces !== false;
        const includeMountedObjects = options.includeMountedObjects !== false;
        const considerHit = (hit) => {
            if (!hit) return;
            if (!best ||
                hit.depthMetric > best.depthMetric + GEOMETRY_EPSILON ||
                (Math.abs(hit.depthMetric - best.depthMetric) <= GEOMETRY_EPSILON && hit.priority > best.priority)) {
                best = hit;
            }
        };
        if (includeSurfaces) {
            for (const candidate of this.lastSurfacePickEntries) {
                if (!candidate || !candidate.floor || (candidate.type !== "floor" && candidate.type !== "roof")) {
                    throw new Error("screen surface picking encountered an invalid render entry");
                }
                const projection = this.surfaceEntryScreenGeometry(
                    candidate,
                    `${candidate.type} ${getFloorId(candidate.floor)} screen pick`
                );
                if (!pointInClipGeometry(point, projection)) continue;
                considerHit({
                    type: candidate.type,
                    floor: candidate.floor,
                    depthMetric: this.surfaceDepthMetricAtScreen(screenPoint, candidate.z),
                    priority: candidate.type === "roof" ? 20 : 10
                });
            }
        }
        if (includeWalls) {
            for (const candidate of this.lastWallPickEntries) {
                if (!candidate || !candidate.wall || !candidate.floor) {
                    throw new Error("wall screen picking encountered an invalid render entry");
                }
                const projection = this.wallScreenPickGeometry(candidate.wall, candidate.floor, this.lastWallPickEntries);
                if (!pointInClipGeometry(point, projection)) continue;
                considerHit({
                    type: "wall",
                    wall: candidate.wall,
                    floor: candidate.floor,
                    depthMetric: this.wallScreenPickDepthMetric(candidate.wall, candidate.floor, this.lastWallPickEntries),
                    priority: 30
                });
            }
        }
        if (includeMountedObjects) {
            for (const candidate of this.lastMountedObjectPickEntries) {
                if (!candidate || !candidate.object || !candidate.wall || !candidate.floor) {
                    throw new Error("mounted object screen picking encountered an invalid render entry");
                }
                const projection = this.mountedObjectScreenGeometry(candidate);
                if (!pointInClipGeometry(point, projection)) continue;
                const hit = {
                    ...candidate,
                    type: "mountedObject",
                    depthMetric: this.mountedObjectPickDepthMetric(candidate),
                    priority: 40
                };
                if (!bestMountedObject ||
                    hit.depthMetric > bestMountedObject.depthMetric + GEOMETRY_EPSILON ||
                    (Math.abs(hit.depthMetric - bestMountedObject.depthMetric) <= GEOMETRY_EPSILON && hit.priority > bestMountedObject.priority)) {
                    bestMountedObject = hit;
                }
            }
        }
        if (bestMountedObject) return { ...bestMountedObject, type: "mountedObject" };
        if (!best) return null;
        if (best.type === "wall") return { type: "wall", wall: best.wall, floor: best.floor };
        return { type: best.type, floor: best.floor };
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
        const floor = entry.floor;
        const triangulation = entry.type === "roof" ? triangulateRoof(floor) : triangulateFloor(floor);
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
        return this.createSolidDepthMesh(
            `buildingEditorPickerDebug:${entry.type}:${getFloorId(floor)}`,
            positions,
            triangulation.indices,
            debugSurfaceColor(entry.type, getFloorId(floor))
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
        } else if (hit.type === "floor" || hit.type === "roof") {
            const floorId = getFloorId(hit.floor);
            labelText = `${hit.type} ${floorId}`;
            const z = hit.type === "roof" ? roofRenderElevation(hit.floor) : getFloorElevation(hit.floor);
            rings = hit.type === "roof"
                ? this.roofScreenGeometry(hit.floor, `${hit.type} ${floorId} hover`)
                : this.surfaceScreenGeometry(hit.floor, z, `${hit.type} ${floorId} hover`);
            // Flatten one polygon level below.
            rings = rings.flat();
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

    drawWallProjectionOutlines(floorIds, wallEntries = null) {
        if (this.state.renderStyle() !== "interior") return;
        const wallDebug = this.wallLayer;
        wallDebug.lineStyle(2, 0xffffff, 0.95);
        getBuildingWalls(this.state.building).forEach((wall) => {
            const floor = findFloor(this.state.building, wall.fragmentId || wall.floorId);
            if (!floor || !floorIds.has(getFloorId(floor))) return;
            const projection = clipGeometryRings(this.wallScreenPickGeometry(wall, floor, wallEntries), `wall ${wall.id} projection`);
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
        const selected = this.state.isWallSelected(wall);
        const bottomFaceOnly = this.shouldDrawWallCollapsed(wall, floor, wallEntries);
        const localTextureU = this.shouldUseExteriorPerimeterTextureU(wall);
        const sceneBrightness = this.wallSceneBrightnessPercent(wall, floor);
        const mesh = entry.unit.getDepthMeshDisplayObject({
            camera: this.gameCamera(),
            app: this.app,
            viewscale: Number(this.state.camera.zoom),
            xyratio: GAME_XY_RATIO,
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
        this.clearScreenPickerDebug();
        this.collapsedWallGeometryByFloorId.clear();
        this.lastWallPickEntries = [];
        this.lastSurfacePickEntries = [];
        this.lastMountedObjectPickEntries = [];
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
            if (mesh) {
                liveFloorMeshIds.add(getFloorId(floor));
                this.lastSurfacePickEntries.push({
                    type: "floor",
                    floor,
                    z: getFloorElevation(floor)
                });
            }
            const selection = this.state.selection || {};
            const selectedRoofVisible = selection.kind === "roof" && selection.floorId === getFloorId(floor);
            if (exterior || selectedRoofVisible) {
                const roofMesh = this.syncRoofMesh(floor, 1);
                if (roofMesh) {
                    liveRoofMeshIds.add(getFloorId(floor));
                    this.lastSurfacePickEntries.push({
                        type: "roof",
                        floor,
                        z: roofRenderElevation(floor)
                    });
                }
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
        this.lastWallPickEntries = wallEntries;
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

    drawFloorUnderlay(gfx) {
        const floor = typeof this.state.floorUnderlay === "function" ? this.state.floorUnderlay() : null;
        if (!floor) return;
        const elevation = getFloorElevation(floor);
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

    mountedObjectPlacement(object) {
        if (!object) return null;
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
            liveIds.add(id);
            let mesh = this.mountedObjectMeshById.get(id);
            if (!mesh) {
                mesh = this.createMountedObjectMesh(PIXI.Texture.EMPTY);
                this.mountedObjectMeshById.set(id, mesh);
                this.buildingUnit.addChild(mesh);
            } else if (mesh.parent !== this.buildingUnit) {
                this.buildingUnit.addChild(mesh);
            }
            this.updateMountedObjectMesh(mesh, object, placement, {
                alphaMultiplier: this.shouldDrawWallCollapsed(placement.wall, placement.floor, this.lastWallPickEntries) ? 0.5 : 1
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
        this.drawClipGeometryOutline(gfx, this.roofScreenGeometry(floor, label), label);
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
        const floor = this.state.selectedFloor();
        if (!floor) {
            throw new Error(`${selection.kind} selection outline is missing a selected floor`);
        }
        const floorId = getFloorId(floor);
        if (selection.kind === "roof") {
            this.drawRoofSelectionOutline(gfx, floor, `roof ${floorId} selection outline`);
            return;
        }
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
        if (!floor) return;
        const elevation = getFloorElevation(floor);
        if (selectionKind === "wall" || selectionKind === "wallEndpoint") {
            this.drawSelectedWallEndpointHandles(gfx, elevation);
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
