import { distance } from "../BuildingGeometry.js";

export class WallTool {
    constructor(state) {
        this.state = state;
        this.drag = null;
    }

    pointerDown(worldPoint, threshold) {
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
        this.state.addWallBetweenEndpoints(start.endpoint, current.endpoint);
        this.state.emitChange();
    }

    cancel() {
        this.drag = null;
        this.state.draft = null;
        this.state.emitChange();
    }
}
