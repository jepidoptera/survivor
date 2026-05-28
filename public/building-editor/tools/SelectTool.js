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

function screenVector(a, b) {
    return { x: Number(b.x) - Number(a.x), y: Number(b.y) - Number(a.y) };
}

function normalizeScreenVector(vector, label) {
    const length = Math.hypot(Number(vector.x), Number(vector.y));
    if (!Number.isFinite(length) || length <= 0.000001) {
        throw new Error(`${label} requires a non-zero screen vector`);
    }
    return { x: Number(vector.x) / length, y: Number(vector.y) / length };
}

function dotScreenVector(a, b) {
    return Number(a.x) * Number(b.x) + Number(a.y) * Number(b.y);
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
        const resizeHandle = this.pickMountedObjectResizeHandle(options);
        if (resizeHandle) {
            this.beginMountedObjectResize(resizeHandle, options);
            return;
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
            const floorId = getFloorId(hit.floor);
            if (
                this.state.selection &&
                this.state.selection.kind === "floor" &&
                this.state.selection.floorId === floorId
            ) {
                const drag = this.state.beginFloorFragmentDrag(worldPoint);
                if (drag) {
                    this.drag = { type: "floorFragment", snapshot: drag };
                    return;
                }
            }
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

    pickMountedObjectResizeHandle(options = {}) {
        const renderer = options.renderer;
        if (!renderer || !options.screenPoint || typeof renderer.pickMountedObjectResizeHandle !== "function") return null;
        if (this.state.tool === "mountObject" || this.state.selectedMountedObjectIds().length === 0) return null;
        return renderer.pickMountedObjectResizeHandle(options.screenPoint, Math.max(10, Number(options.thresholdPixels) || 10));
    }

    mountedObjectResizeBounds(object, renderer) {
        const placement = renderer.mountedObjectPlacement(object);
        if (!placement) {
            throw new Error(`selected door/window ${object && object.id} resize requires placement geometry`);
        }
        const points = placement.points;
        if (!Array.isArray(points) || points.length !== 2) {
            throw new Error(`selected door/window ${object && object.id} resize requires two wall points`);
        }
        const wallLength = Math.hypot(
            Number(points[1].x) - Number(points[0].x),
            Number(points[1].y) - Number(points[0].y)
        );
        if (!Number.isFinite(wallLength) || wallLength <= 0.000001) {
            throw new Error(`selected door/window ${object && object.id} resize requires a positive wall length`);
        }
        const wallT = Number(object.wallT);
        if (!Number.isFinite(wallT)) {
            throw new Error(`selected door/window ${object && object.id} resize requires finite wallT`);
        }
        const wallHeight = Number(placement.wallHeight);
        const zOffset = Number(object.zOffset);
        if (!Number.isFinite(wallHeight) || wallHeight <= 0 || !Number.isFinite(zOffset)) {
            throw new Error(`selected door/window ${object && object.id} resize requires finite wall height and z offset`);
        }
        const category = String(object.category || "").trim().toLowerCase();
        const anchorY = Number.isFinite(Number(object.placeableAnchorY ?? object.anchorY))
            ? Number(object.placeableAnchorY ?? object.anchorY)
            : (category === "windows" ? 0.5 : 1);
        let maxHeight = Infinity;
        if (1 - anchorY > 0.000001) {
            maxHeight = Math.min(maxHeight, zOffset / (1 - anchorY));
        }
        if (anchorY > 0.000001) {
            maxHeight = Math.min(maxHeight, (wallHeight - zOffset) / anchorY);
        }
        return {
            maxWidth: Math.max(0.05, 2 * Math.min(Math.max(0, wallT), Math.max(0, 1 - wallT)) * wallLength),
            maxHeight: Math.max(0.05, maxHeight),
            anchorY
        };
    }

    mountedObjectResizeSnapshot(object, renderer) {
        const width = Number(object.width);
        const height = Number(object.height);
        if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
            throw new Error(`selected door/window ${object && object.id} resize requires positive width and height`);
        }
        const bounds = this.mountedObjectResizeBounds(object, renderer);
        return {
            id: object.id,
            width,
            height,
            maxWidth: bounds.maxWidth,
            maxHeight: bounds.maxHeight,
            anchorY: bounds.anchorY
        };
    }

    beginMountedObjectResize(handle, options = {}) {
        const renderer = options.renderer;
        if (!renderer || !options.screenPoint) {
            throw new Error("door/window resize requires renderer and screen point");
        }
        const selectedObjects = this.state.selectedMountedObjects();
        if (!selectedObjects.length) {
            throw new Error("door/window resize requires selected objects");
        }
        const leadObject = selectedObjects.find((object) => String(object.id) === String(handle.objectId));
        if (!leadObject) {
            throw new Error(`door/window resize handle references unselected object ${handle.objectId}`);
        }
        const screen = handle.screen;
        const topCenter = screen.topCenterScreen;
        const bottomCenter = screen.bottomCenterScreen;
        const [topLeft, topRight] = screen.quadPoints;
        const leadAnchorY = Number.isFinite(Number(leadObject.placeableAnchorY ?? leadObject.anchorY))
            ? Number(leadObject.placeableAnchorY ?? leadObject.anchorY)
            : (String(leadObject.category || "").trim().toLowerCase() === "windows" ? 0.5 : 1);
        const vertical = screenVector(bottomCenter, topCenter);
        const anchorScreen = {
            x: Number(bottomCenter.x) + vertical.x * (1 - leadAnchorY),
            y: Number(bottomCenter.y) + vertical.y * (1 - leadAnchorY)
        };
        const horizontalUnit = normalizeScreenVector(screenVector(topLeft, topRight), "door/window resize horizontal axis");
        const verticalUnit = normalizeScreenVector(vertical, "door/window resize vertical axis");
        const handleVector = screenVector(anchorScreen, handle.point);
        const originalHorizontalDistancePx = Math.abs(dotScreenVector(handleVector, horizontalUnit));
        const originalVerticalDistancePx = Math.abs(dotScreenVector(handleVector, verticalUnit));
        if (handle.resizeX === true && originalHorizontalDistancePx <= 0.000001) {
            throw new Error("door/window horizontal resize requires a non-zero original screen width");
        }
        if (handle.resizeY === true && originalVerticalDistancePx <= 0.000001) {
            throw new Error("door/window vertical resize requires a non-zero original screen height");
        }
        this.drag = {
            type: "mountedObjectResize",
            leadObjectId: leadObject.id,
            resizeX: handle.resizeX === true,
            resizeY: handle.resizeY === true,
            verticalSide: handle.verticalSide || "top",
            anchorY: leadAnchorY,
            anchorScreen,
            horizontalUnit,
            verticalUnit,
            originalHorizontalDistancePx,
            originalVerticalDistancePx,
            originals: selectedObjects.map((object) => this.mountedObjectResizeSnapshot(object, renderer)),
            preserveView: this.state.renderStyle() === "exterior"
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

    requestedMountedObjectResizeScale(screenPoint) {
        if (!screenPoint) throw new Error("door/window resize requires a screen point");
        const delta = {
            x: Number(screenPoint.x) - Number(this.drag.anchorScreen.x),
            y: Number(screenPoint.y) - Number(this.drag.anchorScreen.y)
        };
        let scaleX = 1;
        let scaleY = 1;
        if (this.drag.resizeX) {
            const horizontalDistance = Math.abs(dotScreenVector(delta, this.drag.horizontalUnit));
            scaleX = Math.max(0.0001, horizontalDistance) / this.drag.originalHorizontalDistancePx;
        }
        if (this.drag.resizeY) {
            const verticalDistance = dotScreenVector(delta, this.drag.verticalUnit);
            const distance = this.drag.verticalSide === "bottom" ? -verticalDistance : verticalDistance;
            scaleY = Math.max(0.0001, distance) / this.drag.originalVerticalDistancePx;
        }
        return { scaleX, scaleY };
    }

    clampMountedObjectResizeScale(scale) {
        let scaleX = Number(scale.scaleX);
        let scaleY = Number(scale.scaleY);
        if (!Number.isFinite(scaleX) || scaleX <= 0 || !Number.isFinite(scaleY) || scaleY <= 0) {
            throw new Error("door/window resize produced a non-positive scale");
        }
        const minSize = 0.05;
        this.drag.originals.forEach((entry) => {
            if (this.drag.resizeX) {
                scaleX = Math.max(scaleX, minSize / entry.width);
                scaleX = Math.min(scaleX, entry.maxWidth / entry.width);
            }
            if (this.drag.resizeY) {
                scaleY = Math.max(scaleY, minSize / entry.height);
                scaleY = Math.min(scaleY, entry.maxHeight / entry.height);
            }
        });
        return { scaleX, scaleY };
    }

    refreshMountedObjectGroundHitbox(object, renderer) {
        const placement = renderer.mountedObjectPlacement(object);
        if (!placement) {
            throw new Error(`resized door/window ${object && object.id} requires placement geometry for hitbox update`);
        }
        const width = Number(object.width);
        if (!Number.isFinite(width) || width <= 0) {
            throw new Error(`resized door/window ${object && object.id} requires a positive width for hitbox update`);
        }
        const ux = Number(placement.sectionDirX);
        const uy = Number(placement.sectionDirY);
        const nx = Number(placement.sectionNormalX);
        const ny = Number(placement.sectionNormalY);
        const center = placement.wallCenter;
        const wallThickness = Number(placement.wallThickness);
        if (![ux, uy, nx, ny, wallThickness, Number(center && center.x), Number(center && center.y)].every(Number.isFinite)) {
            throw new Error(`resized door/window ${object && object.id} hitbox update requires finite wall geometry`);
        }
        const category = String(object.category || "").trim().toLowerCase();
        const halfWidth = width * 0.5;
        const hitboxHalfThickness = Math.max(0.001, wallThickness * 0.5) * (category === "doors" ? 1.1 : 1);
        object.groundPlaneHitboxOverridePoints = [
            { x: Number(center.x) - ux * halfWidth + nx * hitboxHalfThickness, y: Number(center.y) - uy * halfWidth + ny * hitboxHalfThickness },
            { x: Number(center.x) + ux * halfWidth + nx * hitboxHalfThickness, y: Number(center.y) + uy * halfWidth + ny * hitboxHalfThickness },
            { x: Number(center.x) + ux * halfWidth - nx * hitboxHalfThickness, y: Number(center.y) + uy * halfWidth - ny * hitboxHalfThickness },
            { x: Number(center.x) - ux * halfWidth - nx * hitboxHalfThickness, y: Number(center.y) - uy * halfWidth - ny * hitboxHalfThickness }
        ];
    }

    updateMountedObjectResize(options = {}) {
        const renderer = options.renderer;
        if (!renderer) throw new Error("door/window resize requires renderer geometry");
        const requested = this.requestedMountedObjectResizeScale(options.screenPoint);
        const { scaleX, scaleY } = this.clampMountedObjectResizeScale(requested);
        const originalsById = new Map(this.drag.originals.map((entry) => [String(entry.id), entry]));
        getBuildingMountedObjects(this.state.building).forEach((object) => {
            const original = originalsById.get(String(object.id));
            if (!original) return;
            if (this.drag.resizeX) object.width = original.width * scaleX;
            if (this.drag.resizeY) object.height = original.height * scaleY;
            this.refreshMountedObjectGroundHitbox(object, renderer);
        });
        this.state.draft = null;
        this.state.emitChange();
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
        if (this.drag.type === "mountedObjectResize") {
            this.updateMountedObjectResize(options);
            return;
        }
        if (this.drag.type === "floorVertex" || this.drag.type === "selectedFloorVertex") {
            this.state.moveSelectedFloorVertex(worldPoint);
            return;
        }
        if (this.drag.type === "floorFragment") {
            this.state.moveFloorFragmentDrag(this.drag.snapshot, worldPoint, { snapDistance: threshold });
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
        if (this.drag && this.drag.type === "mountedObjectResize") {
            this.drag = null;
            this.state.emitChange();
            return;
        }
        this.drag = null;
    }
}
