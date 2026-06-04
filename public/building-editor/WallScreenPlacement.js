import { getFloorElevation, wallCenterlinePoints } from "./BuildingModel.js";

function wallProfileFromCenterline(points, thickness) {
    const geometry = globalThis.WallGeometry;
    if (!geometry || typeof geometry.baseProfileFromEndpoints !== "function") {
        throw new Error("missing shared wall geometry profile helper");
    }
    return geometry.baseProfileFromEndpoints(points[0], points[1], thickness);
}

export function editorWallPlacementAdapter(wall, floor, points, renderer) {
    const bottomZ = getFloorElevation(floor);
    return {
        id: wall.id,
        type: "wallSection",
        startPoint: points[0],
        endPoint: points[1],
        height: Number(wall.height),
        thickness: Number(wall.thickness),
        bottomZ,
        getWallProfile() {
            return wallProfileFromCenterline(points, wall.thickness);
        },
        getWallPositionAtScreenPoint(screenX, screenY, options = {}) {
            const geometry = globalThis.WallGeometry;
            if (!geometry || typeof geometry.wallPositionAtScreenPoint !== "function") {
                throw new Error("missing shared wall geometry screen-position helper");
            }
            return geometry.wallPositionAtScreenPoint(this, screenX, screenY, {
                ...options,
                direction: Number.isFinite(Number(wall.direction)) ? Number(wall.direction) : 0,
                getWallProfile: () => this.getWallProfile(),
                toScreenPoint: (point, z) => renderer.worldToScreen(point, z)
            });
        }
    };
}

export function normalizeWallSnapPointsPerSection(value, label = "snap points per section") {
    const count = Math.round(Number(value));
    if (!Number.isInteger(count) || count < 1 || count > 64) {
        throw new Error(`${label} must be an integer between 1 and 64`);
    }
    return count;
}

export function wallSectionSnapTValues(snapPointsPerSection = 1) {
    const count = normalizeWallSnapPointsPerSection(snapPointsPerSection);
    return Array.from({ length: count }, (_value, index) => (index + 0.5) / count);
}

export function nearestWallSectionSnapT(t, snapPointsPerSection = 1) {
    const count = normalizeWallSnapPointsPerSection(snapPointsPerSection);
    const clampedT = Math.max(0, Math.min(1, Number(t)));
    const index = Math.max(0, Math.min(count - 1, Math.floor(clampedT * count)));
    return (index + 0.5) / count;
}

export function wallPointAtT(points, t) {
    if (!Array.isArray(points) || points.length !== 2) {
        throw new Error("wall snap point requires a two-point wall centerline");
    }
    const clampedT = Math.max(0, Math.min(1, Number(t)));
    return {
        x: Number(points[0].x) + (Number(points[1].x) - Number(points[0].x)) * clampedT,
        y: Number(points[0].y) + (Number(points[1].y) - Number(points[0].y)) * clampedT
    };
}

export function quantizeWallPlacementSnap(snap, snapPointsPerSection = 1) {
    if (!snap || !snap.wall || !Array.isArray(snap.points) || snap.points.length !== 2) return snap;
    const t = nearestWallSectionSnapT(snap.t ?? 0.5, snapPointsPerSection);
    const point = wallPointAtT(snap.points, t);
    return {
        ...snap,
        ...point,
        t,
        wallT: t,
        snapKind: snap.snapKind || "wallCenterline",
        wallSectionSnapPoint: true,
        snapPointsPerSection: normalizeWallSnapPointsPerSection(snapPointsPerSection)
    };
}

export function wallPlacementPointAtScreen(state, wall, floor, screenPoint, renderer, options = {}) {
    if (!state || !wall || !floor || !screenPoint || !renderer) return null;
    if (typeof renderer.worldToScreen !== "function") return null;
    const points = wallCenterlinePoints(state.building, wall, floor);
    if (!points || points.length !== 2) return null;
    const section = editorWallPlacementAdapter(wall, floor, points, renderer);
    const t = section.getWallPositionAtScreenPoint(Number(screenPoint.x), Number(screenPoint.y), options);
    if (!Number.isFinite(Number(t))) return null;
    const clampedT = Math.max(0, Math.min(1, Number(t)));
    const snap = {
        x: Number(points[0].x) + (Number(points[1].x) - Number(points[0].x)) * clampedT,
        y: Number(points[0].y) + (Number(points[1].y) - Number(points[0].y)) * clampedT,
        t: clampedT,
        wall,
        floor,
        points,
        snapKind: "wallCenterline"
    };
    return options.snapPointsPerSection === undefined
        ? snap
        : quantizeWallPlacementSnap(snap, options.snapPointsPerSection);
}
