import { findFloor, getBuildingMountedObjects, getFloorElevation, wallCenterlinePoints } from "../BuildingModel.js";

function wallProfileFromCenterline(points, thickness) {
    const geometry = globalThis.WallGeometry;
    if (!geometry || typeof geometry.baseProfileFromEndpoints !== "function") {
        throw new Error("missing shared wall geometry profile helper");
    }
    return geometry.baseProfileFromEndpoints(points[0], points[1], thickness);
}

function editorWallPlacementAdapter(wall, floor, points, renderer) {
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

function sameLevelWindowSnapTargets(building, floor, ignoredObjectId = null) {
    if (!floor) return [];
    const floorElevation = getFloorElevation(floor);
    return getBuildingMountedObjects(building)
        .filter((object) => String(object && object.category || "").trim().toLowerCase() === "windows")
        .filter((object) => ignoredObjectId === null || String(object.id) !== String(ignoredObjectId))
        .map((object) => {
            const objectFloor = findFloor(building, object.floorId);
            if (!objectFloor) {
                throw new Error(`window ${object.id || "(missing id)"} references missing floor ${object.floorId}`);
            }
            if (Math.abs(getFloorElevation(objectFloor) - floorElevation) > 0.000001) return null;
            const zOffset = Number(object.zOffset);
            if (!Number.isFinite(zOffset)) {
                throw new Error(`window ${object.id || "(missing id)"} requires a finite zOffset for vertical snapping`);
            }
            return {
                id: object.id,
                absoluteZ: getFloorElevation(objectFloor) + zOffset,
                wallAnchorZ: zOffset
            };
        })
        .filter(Boolean);
}

export function mountedObjectPlacementAt(state, asset, worldPoint, threshold, options = {}) {
    const renderer = options.renderer || null;
    const screenPoint = options.screenPoint || null;
    if (!asset) return null;
    const screenHit = renderer &&
        screenPoint &&
        typeof renderer.pickAtScreen === "function"
        ? renderer.pickAtScreen(screenPoint, { includeMountedObjects: false, includeSurfaces: false })
        : null;
    const category = String(asset.category || state.mountedObjectTool.category || "").toLowerCase();
    if (screenHit && screenHit.type === "gable") {
        if (category !== "windows") return null;
        if (!renderer || typeof renderer.resolveGableMountedPlacementCandidate !== "function") {
            throw new Error("gable-mounted window placement requires renderer gable placement geometry");
        }
        return renderer.resolveGableMountedPlacementCandidate(screenHit.floor, screenHit.gable, asset, screenPoint, {
            ignoredObjectId: options.ignoredObjectId ?? null
        });
    }
    const hit = screenHit && screenHit.type === "wall"
        ? screenHit
        : state.pickWallAt(worldPoint, threshold);
    if (!hit || !hit.wall || !hit.floor) return null;

    const points = wallCenterlinePoints(state.building, hit.wall, hit.floor);
    if (points.length !== 2) return null;
    const width = Number(asset.width);
    const height = Number(asset.height);
    if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
        throw new Error("selected door or window asset requires positive width and height");
    }
    const placementApi = globalThis.PlaceObjectPlacement;
    if (!placementApi || typeof placementApi.resolveWallMountedPlacementCandidate !== "function") {
        throw new Error("missing shared wall-mounted place object placement helper");
    }
    if (!renderer || !screenPoint) return null;
    const anchorY = Number.isFinite(Number(asset.anchorY ?? asset.placeableAnchorY))
        ? Number(asset.anchorY ?? asset.placeableAnchorY)
        : (category === "windows" ? 0.5 : 1);
    const candidate = placementApi.resolveWallMountedPlacementCandidate({
        section: editorWallPlacementAdapter(hit.wall, hit.floor, points, renderer),
        category,
        worldX: Number(worldPoint.x),
        worldY: Number(worldPoint.y),
        mouseScreen: screenPoint,
        toScreenPoint: (point, z) => renderer.worldToScreen(point, z),
        width,
        height,
        placeableScale: height,
        anchorY,
        verticalSnapTargets: category === "windows"
            ? sameLevelWindowSnapTargets(state.building, hit.floor, options.ignoredObjectId ?? null)
            : []
    });
    if (!candidate) return null;
    const wallHeight = Number(candidate.wallHeight);
    const floorBaseZ = getFloorElevation(hit.floor);
    let zOffset = Math.max(0, (1 - anchorY) * height);
    if (category === "windows") {
        zOffset = Number(candidate.snappedZ) - floorBaseZ;
        if (!Number.isFinite(zOffset)) {
            throw new Error("window wall placement requires a finite snappedZ");
        }
        if (zOffset < -0.000001) {
            throw new Error("window wall placement snapped below its floor");
        }
        zOffset = Math.max(0, zOffset);
    }
    return {
        valid: candidate.valid,
        reason: candidate.reason,
        wall: hit.wall,
        floor: hit.floor,
        points,
        wallT: candidate.wallT,
        wallLength: Math.hypot(
            Number(points[1].x) - Number(points[0].x),
            Number(points[1].y) - Number(points[0].y)
        ),
        wallCenter: { x: candidate.wallCenterX, y: candidate.wallCenterY },
        faceCenter: { x: candidate.wallFaceCenterX, y: candidate.wallFaceCenterY },
        sectionDirX: candidate.sectionDirX,
        sectionDirY: candidate.sectionDirY,
        sectionNormalX: candidate.sectionNormalX,
        sectionNormalY: candidate.sectionNormalY,
        wallThickness: candidate.wallThickness,
        wallHeight,
        mountedWallFacingSign: candidate.mountedWallFacingSign,
        placementRotation: candidate.snappedRotationDeg,
        zOffset,
        groundPlaneHitboxOverridePoints: candidate.wallGroundHitboxPoints,
        centerSnapActive: candidate.centerSnapActive,
        verticalCenterSnapActive: candidate.verticalCenterSnapActive,
        verticalPeerSnapActive: candidate.verticalPeerSnapActive,
        verticalSnapKind: candidate.verticalSnapKind,
        verticalSnapZ: candidate.snappedZ,
        verticalSnapTarget: candidate.verticalSnapTarget
    };
}

export class MountedObjectTool {
    constructor(state) {
        this.state = state;
    }

    placementAt(worldPoint, threshold, options = {}) {
        const asset = this.state.selectedMountedObjectAsset();
        return mountedObjectPlacementAt(this.state, asset, worldPoint, threshold, options);
    }

    pointerDown(worldPoint, threshold, options = {}) {
        const asset = this.state.selectedMountedObjectAsset();
        if (!asset) throw new Error("choose a door or window before placing");
        const placement = this.placementAt(worldPoint, threshold, options);
        if (!placement) return;
        this.state.addMountedWallObject(placement, asset);
    }

    pointerMove(worldPoint, threshold, options = {}) {
        const asset = this.state.selectedMountedObjectAsset();
        const placement = asset ? this.placementAt(worldPoint, threshold, options) : null;
        this.state.draft = placement ? {
            kind: "mountedObject",
            asset,
            placement
        } : null;
        this.state.emitChange();
    }

    pointerUp() {}

    cancel() {
        this.state.draft = null;
        this.state.emitChange();
    }
}
