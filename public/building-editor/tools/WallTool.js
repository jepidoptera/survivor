import { distance } from "../BuildingGeometry.js";
import { getFloorId } from "../BuildingModel.js";

export class WallTool {
    constructor(state) {
        this.state = state;
        this.drag = null;
    }

    pointerDown(worldPoint, threshold, options = {}) {
        const screenHit = options.renderer &&
            options.screenPoint &&
            typeof options.renderer.pickAtScreen === "function"
            ? options.renderer.pickAtScreen(options.screenPoint, { includeMountedObjects: false })
            : null;
        const targetHit = screenHit && screenHit.floor
            ? screenHit
            : this.state.pickFloorAt(worldPoint);
        if (targetHit && targetHit.floor) {
            const floorId = getFloorId(targetHit.floor);
            if (!this.state.isWallToolFocusedOnFloor(floorId)) {
                this.drag = null;
                this.state.draft = null;
                this.state.focusWallToolFloor(floorId);
                return;
            }
        }
        const start = this.state.snapWallEndpoint(worldPoint, threshold);
        this.drag = { threshold, start, current: start };
        this.state.draft = {
            kind: "wall",
            points: [start.point, start.point],
            endpointKinds: [start.kind, start.kind]
        };
        this.state.emitChange();
    }

    pointerMove(worldPoint) {
        if (!this.drag) return;
        const current = this.state.snapWallEndpoint(worldPoint, this.drag.threshold);
        this.drag.current = current;
        this.state.draft = {
            kind: "wall",
            points: [this.drag.start.point, current.point],
            endpointKinds: [this.drag.start.kind, current.kind]
        };
        this.state.emitChange();
    }

    pointerUp(worldPoint) {
        if (!this.drag) return;
        const current = worldPoint ? this.state.snapWallEndpoint(worldPoint, this.drag.threshold) : this.drag.current;
        const start = this.drag.start;
        this.drag = null;
        this.state.draft = null;
        if (distance(start.point, current.point) < 0.05) {
            this.state.emitChange();
            return;
        }
        this.state.addWallBetweenEndpoints(start.endpoint, current.endpoint, { select: false });
        this.state.emitChange();
    }

    cancel() {
        this.drag = null;
        this.state.draft = null;
        this.state.emitChange();
    }
}
