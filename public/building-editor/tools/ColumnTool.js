import { DEFAULTS, getFloorId, getFloorElevation } from "../BuildingModel.js";
import { wallPlacementPointAtScreen } from "../WallScreenPlacement.js";

export class ColumnTool {
    constructor(state) {
        this.state = state;
    }

    _snapForTarget(worldPoint, threshold, target, options = {}) {
        if (!target.wall) return this.state.snapColumnPosition(worldPoint, threshold, getFloorId(target.floor));
        const screenSnap = wallPlacementPointAtScreen(this.state, target.wall, target.floor, options.screenPoint, options.renderer, {
            worldX: Number(worldPoint.x),
            worldY: Number(worldPoint.y)
        });
        return screenSnap || this.state.snapColumnToWall(worldPoint, target.wall, threshold);
    }

    _resolveTarget(worldPoint, options = {}) {
        const screenHit = options.renderer &&
            options.screenPoint &&
            typeof options.renderer.pickAtScreen === "function"
            ? options.renderer.pickAtScreen(options.screenPoint, {
                includeMountedObjects: false,
                includeColumns: false,
                includeBeams: false
            })
            : null;
        const targetHit = screenHit && screenHit.floor
            ? screenHit
            : this.state.pickFloorAt(worldPoint);
        return {
            floor: (targetHit && targetHit.floor) ? targetHit.floor : null,
            wall: (targetHit && targetHit.type === "wall" && targetHit.wall) ? targetHit.wall : null
        };
    }

    _columnOptionsForTarget(floor, snap, screenWall = null) {
        const hostWall = (snap && snap.wall) || screenWall || null;
        const settings = this.state.columnCreationSettings(hostWall);
        return {
            wallId: hostWall ? hostWall.id : null,
            height: settings.height,
            heightMode: settings.heightMode,
            sideCount: settings.sideCount,
            width: settings.width,
            depth: hostWall && typeof this.state.clampColumnDepthForWall === "function"
                ? this.state.clampColumnDepthForWall(settings.thickness, hostWall, "column depth")
                : settings.thickness,
            texturePath: settings.texture,
            bottomZ: getFloorElevation(floor),
            traversalLayer: floor && Number.isFinite(Number(floor.level)) ? Number(floor.level) : 0
        };
    }

    pointerDown(worldPoint, threshold, options = {}) {
        const target = this._resolveTarget(worldPoint, options);
        const floor = target.floor;
        if (!floor) return;
        const floorId = getFloorId(floor);
        const snap = this._snapForTarget(worldPoint, threshold, target, options);
        const position = snap
            ? { x: snap.x, y: snap.y }
            : { x: worldPoint.x, y: worldPoint.y };
        const rotation = (snap && snap.snapKind === "floorVertex" && snap.vertexId)
            ? this.state.columnRotationForFloorVertex(floor, snap.vertexId)
            : (snap && snap.wall && typeof this.state.columnRotationForWall === "function")
                ? this.state.columnRotationForWall(snap.wall)
            : 0;
        this.state.draft = null;
        this.state.addColumnToFloor(floorId, {
            ...this._columnOptionsForTarget(floor, snap, target.wall),
            position,
            rotation,
            preserveView: target.wall && this.state.isExteriorWall(target.wall) && this.state.renderStyle() === "exterior"
        });
        this.state.emitChange();
    }

    pointerMove(worldPoint, threshold, options = {}) {
        const target = this._resolveTarget(worldPoint, options);
        const floor = target.floor;
        if (!floor) {
            if (this.state.draft) {
                this.state.draft = null;
                this.state.emitChange();
            }
            return;
        }
        const floorId = getFloorId(floor);
        const snap = this._snapForTarget(worldPoint, threshold, target, options);
        const pos = snap ? { x: snap.x, y: snap.y } : { x: worldPoint.x, y: worldPoint.y };
        const rotation = (snap && snap.snapKind === "floorVertex" && snap.vertexId)
            ? this.state.columnRotationForFloorVertex(floor, snap.vertexId)
            : (snap && snap.wall && typeof this.state.columnRotationForWall === "function")
                ? this.state.columnRotationForWall(snap.wall)
            : 0;
        const columnOptions = this._columnOptionsForTarget(floor, snap, target.wall);
        this.state.draft = {
            kind: "column",
            floorId,
            position: pos,
            sideCount: columnOptions.sideCount,
            size: columnOptions.size,
            width: columnOptions.width,
            depth: columnOptions.depth,
            rotation,
            bottomZ: columnOptions.bottomZ,
            height: columnOptions.height,
            heightMode: columnOptions.heightMode,
            texturePath: columnOptions.texturePath,
            wallId: columnOptions.wallId
        };
        this.state.emitChange();
    }

    pointerUp() {}

    cancel() {
        if (this.state.draft) {
            this.state.draft = null;
            this.state.emitChange();
        }
    }
}
