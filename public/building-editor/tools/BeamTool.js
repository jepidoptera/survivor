import { getFloorId, getFloorElevation } from "../BuildingModel.js";

export class BeamTool {
    constructor(state) {
        this.state = state;
        this.drag = null;
    }

    pointerDown(worldPoint, threshold, options = {}) {
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
        if (!targetHit || !targetHit.floor) return;
        const floorId = getFloorId(targetHit.floor);
        const floor = targetHit.floor;
        const snap = this.state.snapBeamEndpoint(worldPoint, threshold, floorId);
        const startPt = snap || { x: worldPoint.x, y: worldPoint.y, snapKind: "free" };
        const defaultZ = getFloorElevation(floor) + (floor.defaultWallHeight || 3);
        this.drag = {
            threshold,
            floorId,
            floor,
            startSnap: startPt,
            currentSnap: startPt,
            bottomZ: defaultZ
        };
        this.state.draft = {
            kind: "beam",
            floorId,
            start: startPt,
            end: startPt,
            bottomZ: defaultZ
        };
        this.state.emitChange();
    }

    pointerMove(worldPoint, threshold, options = {}) {
        if (!this.drag) return;
        const snap = typeof this.state.resolveBeamEndpointSnap === "function"
            ? this.state.resolveBeamEndpointSnap(worldPoint, threshold, this.drag.floorId, options)
            : this.state.snapBeamEndpoint(worldPoint, threshold, this.drag.floorId);
        const endPt = snap || { x: worldPoint.x, y: worldPoint.y, snapKind: "free" };
        this.drag.currentSnap = endPt;
        this.state.draft = {
            kind: "beam",
            floorId: this.drag.floorId,
            start: this.drag.startSnap,
            end: endPt,
            bottomZ: this.drag.bottomZ
        };
        this.state.emitChange();
    }

    pointerUp(worldPoint, threshold, options = {}) {
        if (!this.drag) return;
        const snap = worldPoint
            ? (typeof this.state.resolveBeamEndpointSnap === "function"
                ? this.state.resolveBeamEndpointSnap(worldPoint, threshold, this.drag.floorId, options)
                : this.state.snapBeamEndpoint(worldPoint, threshold, this.drag.floorId))
            : this.drag.currentSnap;
        const endPt = snap || { x: worldPoint.x, y: worldPoint.y, snapKind: "free" };
        const startPt = this.drag.startSnap;
        const floorId = this.drag.floorId;
        const bottomZ = this.drag.bottomZ;
        this.drag = null;
        this.state.draft = null;
        const dx = endPt.x - startPt.x;
        const dy = endPt.y - startPt.y;
        if (Math.hypot(dx, dy) < 0.05) {
            this.state.emitChange();
            return;
        }
        const startAttachment = this._snapToAttachment(startPt);
        const endAttachment = this._snapToAttachment(endPt);
        this.state.addBeamToFloor(floorId, { startAttachment, endAttachment, bottomZ });
        this.state.emitChange();
    }

    _snapToAttachment(snap) {
        if (!snap) return { kind: "free", x: 0, y: 0 };
        if (snap.snapKind === "columnTop") return { kind: "column", hostId: snap.hostId };
        if (snap.snapKind === "wallEndpoint" || snap.snapKind === "wallCenterline") {
            return { kind: "wall", hostId: snap.hostId, t: Number(snap.t) || 0 };
        }
        return { kind: "free", x: Number(snap.x), y: Number(snap.y) };
    }

    cancel() {
        this.drag = null;
        this.state.draft = null;
        this.state.emitChange();
    }
}
