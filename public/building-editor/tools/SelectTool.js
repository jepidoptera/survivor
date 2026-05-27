import { getBuildingMountedObjects, getFloorElevation, getFloorId } from "../BuildingModel.js";
import { ringsForFloor } from "../BuildingPolygonEditing.js";
import { mountedObjectPlacementAt } from "./MountedObjectTool.js";

function closestScreenSegmentPoint(point, a, b) {
    const dx = Number(b.x) - Number(a.x);
    const dy = Number(b.y) - Number(a.y);
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared <= 0.000001) return null;
    const t = Math.max(0, Math.min(1, ((Number(point.x) - Number(a.x)) * dx + (Number(point.y) - Number(a.y)) * dy) / lengthSquared));
    const x = Number(a.x) + dx * t;
    const y = Number(a.y) + dy * t;
    return { x, y, t, distance: Math.hypot(Number(point.x) - x, Number(point.y) - y) };
}

export class SelectTool {
    constructor(state) {
        this.state = state;
        this.drag = null;
    }

    pointerDown(worldPoint, threshold, options = {}) {
        const preserveView = this.state.renderStyle() === "exterior";
        const screenHit = options.renderer &&
            options.screenPoint &&
            typeof options.renderer.pickAtScreen === "function"
            ? options.renderer.pickAtScreen(options.screenPoint)
            : null;
        if (options.controlKey && this.state.selectedMountedObjectIds().length > 0) {
            if (screenHit && screenHit.type === "mountedObject") {
                this.state.removeMountedObjectFromSelection(screenHit.object.id, { preserveView });
            }
            this.drag = null;
            return;
        }
        if (options.shiftKey && this.state.selectedMountedObjectIds().length > 0) {
            if (screenHit && screenHit.type === "mountedObject") {
                this.state.addMountedObjectToSelection(screenHit.object.id, { preserveView });
            }
            this.drag = null;
            return;
        }
        if (options.controlKey && this.state.selectedWallIds().length > 0) {
            const fallbackWallHit = !screenHit || screenHit.type !== "wall"
                ? this.state.pickWallAt(worldPoint, threshold)
                : null;
            const wallHit = screenHit && screenHit.type === "wall"
                ? screenHit
                : (fallbackWallHit ? { type: "wall", ...fallbackWallHit } : null);
            if (wallHit) {
                this.state.removeWallFromSelection(wallHit.wall.id, { preserveView });
            }
            this.drag = null;
            return;
        }
        if (options.shiftKey && this.state.selectedWallIds().length > 0) {
            const fallbackWallHit = !screenHit || screenHit.type !== "wall"
                ? this.state.pickWallAt(worldPoint, threshold)
                : null;
            const wallHit = screenHit && screenHit.type === "wall"
                ? screenHit
                : (fallbackWallHit ? { type: "wall", ...fallbackWallHit } : null);
            if (wallHit) {
                this.state.addWallToSelection(wallHit.wall.id, { preserveView });
            }
            this.drag = null;
            return;
        }
        if (options.shiftKey && this.insertFloorVertexOnScreenEdge(options)) {
            this.drag = { type: "selectedFloorVertex" };
            return;
        }
        if (options.shiftKey && this.state.insertFloorVertexOnEdge(worldPoint, threshold)) {
            this.drag = { type: "selectedFloorVertex" };
            return;
        }
        if (options.shiftKey && this.state.selection && this.state.selection.kind === "floorVertex") {
            if (this.state.insertFloorVertexNearSelected(worldPoint)) {
                this.drag = { type: "selectedFloorVertex" };
                return;
            }
        }
        const endpointHit = this.state.pickWallEndpoint(worldPoint, threshold);
        if (endpointHit) {
            const endpoint = endpointHit.wall[endpointHit.endpointKey];
            this.state.selectWallEndpoint(endpointHit.wall.id, endpointHit.endpointKey);
            this.drag = {
                type: "wallEndpoint",
                threshold,
                detachVertexEndpoint: endpoint && endpoint.kind === "vertex"
            };
            return;
        }
        const vertexHit = this.state.pickSelectedFloorVertex(worldPoint, threshold);
        if (vertexHit) {
            this.selectFloorVertexHit(vertexHit, { preserveView });
            return;
        }
        const hit = screenHit || this.state.pick(worldPoint, threshold);
        if (!hit) {
            this.state.selectBuilding();
            this.drag = null;
            return;
        }
        if (hit.type === "floorVertex") {
            this.selectFloorVertexHit(hit, { preserveView });
            return;
        }
        if (hit.type === "wall") {
            this.state.selectWall(hit.wall.id, { preserveView });
            this.drag = null;
            return;
        }
        if (hit.type === "mountedObject") {
            this.state.selectMountedObject(hit.object.id, { preserveView });
            this.drag = {
                type: "mountedObjectPending",
                objectId: hit.object.id,
                original: this.cloneMountedObject(hit.object),
                originalIndex: this.mountedObjectIndex(hit.object.id),
                startScreen: options.screenPoint ? { x: Number(options.screenPoint.x), y: Number(options.screenPoint.y) } : null,
                asset: this.assetFromMountedObject(hit.object),
                preserveView
            };
            return;
        }
        if (hit.type === "roof") {
            this.state.selectRoof(getFloorId(hit.floor), { preserveView });
            this.drag = null;
            return;
        }
        if (hit.type === "floor") {
            this.state.selectFloor(getFloorId(hit.floor), { preserveView });
            this.drag = null;
        }
    }

    selectFloorVertexHit(hit, options = {}) {
        const floorId = getFloorId(hit.floor);
        const ringKind = hit.ringKind || "outer";
        const holeIndex = Number.isFinite(hit.holeIndex) ? hit.holeIndex : -1;
        const vertexIndex = Number.isFinite(hit.vertexIndex) ? hit.vertexIndex : hit.index;
        this.state.selectFloorVertex(floorId, ringKind, holeIndex, vertexIndex, options);
        this.drag = { type: "floorVertex", floorId, ringKind, holeIndex, vertexIndex };
    }

    insertFloorVertexOnScreenEdge(options) {
        const renderer = options.renderer;
        const screenPoint = options.screenPoint;
        const thresholdPixels = Number(options.thresholdPixels);
        const floor = this.state.selectedFloor();
        if (!floor || !renderer || !screenPoint || !Number.isFinite(thresholdPixels)) return false;
        let best = null;
        const elevation = getFloorElevation(floor);
        ringsForFloor(floor).forEach((ring) => {
            for (let index = 0; index < ring.points.length; index++) {
                const a = renderer.worldToScreen(ring.points[index], elevation);
                const b = renderer.worldToScreen(ring.points[(index + 1) % ring.points.length], elevation);
                const hit = closestScreenSegmentPoint(screenPoint, a, b);
                if (!hit || hit.distance > thresholdPixels) continue;
                if (!best || hit.distance < best.distance) {
                    best = { ...ring, insertAfterIndex: index, screenPoint: { x: hit.x, y: hit.y }, distance: hit.distance };
                }
            }
        });
        if (!best) return false;
        const point = renderer.screenToWorld(best.screenPoint, elevation);
        return this.state.insertFloorVertexOnKnownEdge(
            getFloorId(floor),
            best.ringKind,
            best.holeIndex,
            best.insertAfterIndex,
            point
        );
    }

    cloneMountedObject(object) {
        return JSON.parse(JSON.stringify(object));
    }

    assetFromMountedObject(object) {
        const category = String(object && object.category || "").trim().toLowerCase();
        if (category !== "doors" && category !== "windows") {
            throw new Error(`cannot drag unknown mounted object category: ${category || "missing"}`);
        }
        const width = Number(object.width);
        const height = Number(object.height);
        if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
            throw new Error(`mounted object ${object.id || "(missing id)"} requires positive width and height`);
        }
        return {
            ...object,
            category,
            texturePath: object.texturePath,
            width,
            height,
            anchorX: Number.isFinite(Number(object.placeableAnchorX ?? object.anchorX))
                ? Number(object.placeableAnchorX ?? object.anchorX)
                : 0.5,
            anchorY: Number.isFinite(Number(object.placeableAnchorY ?? object.anchorY))
                ? Number(object.placeableAnchorY ?? object.anchorY)
                : (category === "windows" ? 0.5 : 1)
        };
    }

    mountedObjectIndex(objectId) {
        return getBuildingMountedObjects(this.state.building)
            .findIndex((object) => String(object.id) === String(objectId));
    }

    removeMountedObject(objectId) {
        this.state.building.mountedWallObjects = getBuildingMountedObjects(this.state.building)
            .filter((object) => String(object.id) !== String(objectId));
    }

    insertMountedObject(object, index) {
        if (!Array.isArray(this.state.building.mountedWallObjects)) this.state.building.mountedWallObjects = [];
        this.removeMountedObject(object.id);
        const list = this.state.building.mountedWallObjects;
        const insertIndex = Number.isInteger(index)
            ? Math.max(0, Math.min(list.length, index))
            : list.length;
        list.splice(insertIndex, 0, object);
    }

    replaceMountedObject(object) {
        if (!object || object.id == null) {
            throw new Error("cannot update dragged door/window without an object id");
        }
        const list = getBuildingMountedObjects(this.state.building);
        const index = list.findIndex((candidate) => String(candidate.id) === String(object.id));
        if (index < 0) {
            throw new Error(`dragged door/window ${object.id} disappeared before placement finished`);
        }
        list[index] = object;
    }

    placedMountedObject(original, placement, asset) {
        if (!placement || !placement.wall || !placement.floor) {
            throw new Error("cannot place dragged door/window without a wall placement");
        }
        if (!placement.valid) {
            throw new Error(placement.reason || "dragged door/window does not fit on this wall");
        }
        const floorElevation = getFloorElevation(placement.floor);
        const object = {
            ...this.cloneMountedObject(original),
            category: asset.category,
            texturePath: asset.texturePath,
            floorId: getFloorId(placement.floor),
            wallId: placement.wall.id,
            mountedSectionId: placement.wall.id,
            mountedWallLineGroupId: placement.wall.id,
            mountedWallSectionUnitId: placement.wall.id,
            mountedWallFacingSign: placement.mountedWallFacingSign,
            wallT: placement.wallT,
            width: asset.width,
            height: asset.height,
            zOffset: placement.zOffset,
            placementRotation: placement.placementRotation,
            placeableAnchorX: asset.anchorX,
            placeableAnchorY: asset.anchorY,
            renderDepthOffset: asset.renderDepthOffset,
            compositeLayers: Array.isArray(asset.compositeLayers) ? this.cloneMountedObject(asset.compositeLayers) : asset.compositeLayers
        };
        object.x = Number(placement.faceCenter.x);
        object.y = Number(placement.faceCenter.y);
        object.z = floorElevation + Number(placement.zOffset);
        object.groundPlaneHitboxOverridePoints = Array.isArray(placement.groundPlaneHitboxOverridePoints)
            ? placement.groundPlaneHitboxOverridePoints.map((point) => ({ x: Number(point.x), y: Number(point.y) }))
            : undefined;
        return object;
    }

    beginMountedObjectDrag(worldPoint, threshold, options = {}) {
        const pending = this.drag;
        const index = pending.originalIndex >= 0 ? pending.originalIndex : this.mountedObjectIndex(pending.objectId);
        this.drag = {
            type: "mountedObject",
            original: pending.original,
            originalIndex: index,
            asset: pending.asset,
            placement: null,
            preserveView: pending.preserveView
        };
        this.updateMountedObjectDrag(worldPoint, threshold, options);
    }

    updateMountedObjectDrag(worldPoint, threshold, options = {}) {
        const placement = mountedObjectPlacementAt(this.state, this.drag.asset, worldPoint, threshold, {
            ...options,
            ignoredObjectId: this.drag.original.id
        });
        this.drag.placement = placement;
        this.state.draft = {
            kind: "mountedObject",
            asset: this.drag.asset,
            placement,
            replacingMountedObjectId: this.drag.original.id
        };
        this.state.emitChange();
    }

    shouldStartMountedObjectDrag(options = {}) {
        if (!this.drag || this.drag.type !== "mountedObjectPending") return false;
        if (!this.drag.startScreen || !options.screenPoint) return true;
        const dx = Number(options.screenPoint.x) - Number(this.drag.startScreen.x);
        const dy = Number(options.screenPoint.y) - Number(this.drag.startScreen.y);
        return Math.hypot(dx, dy) >= 3;
    }

    finishMountedObjectDrag(worldPoint, threshold, options = {}) {
        if (this.drag.type === "mountedObjectPending") {
            this.drag = null;
            return;
        }
        const originalId = this.drag.original.id;
        const placement = mountedObjectPlacementAt(this.state, this.drag.asset, worldPoint, threshold, {
            ...options,
            ignoredObjectId: this.drag.original.id
        });
        if (placement && placement.valid) {
            const object = this.placedMountedObject(this.drag.original, placement, this.drag.asset);
            this.replaceMountedObject(object);
        }
        const preserveView = this.drag.preserveView;
        this.state.draft = null;
        this.drag = null;
        this.state.selectMountedObject(originalId, { preserveView });
    }

    pointerMove(worldPoint, threshold, options = {}) {
        if (!this.drag) return;
        if (this.drag.type === "mountedObjectPending") {
            if (this.shouldStartMountedObjectDrag(options)) {
                this.beginMountedObjectDrag(worldPoint, threshold, options);
            }
            return;
        }
        if (this.drag.type === "mountedObject") {
            this.updateMountedObjectDrag(worldPoint, threshold, options);
            return;
        }
        if (this.drag.type === "floorVertex" || this.drag.type === "selectedFloorVertex") {
            this.state.moveSelectedFloorVertex(worldPoint);
            return;
        }
        if (this.drag.type === "wallEndpoint") {
            this.state.moveSelectedWallEndpoint(worldPoint, this.drag.threshold, {
                detachVertexEndpoint: this.drag.detachVertexEndpoint === true
            });
        }
    }

    pointerUp(worldPoint, threshold, options = {}) {
        if (this.drag && (this.drag.type === "mountedObject" || this.drag.type === "mountedObjectPending")) {
            this.finishMountedObjectDrag(worldPoint, threshold, options);
            return;
        }
        this.drag = null;
    }
}
