import { getFloorId } from "../BuildingModel.js";

export class SelectTool {
    constructor(state) {
        this.state = state;
        this.drag = null;
    }

    pointerDown(worldPoint, threshold, options = {}) {
        if (options.shiftKey && this.state.selection && this.state.selection.ringKind) {
            if (this.state.insertFloorVertexNearSelected(worldPoint)) {
                this.drag = { type: "selectedFloorVertex" };
                return;
            }
        }
        if (options.shiftKey && this.state.insertFloorVertexOnEdge(worldPoint, threshold)) {
            this.drag = { type: "selectedFloorVertex" };
            return;
        }
        const hit = this.state.pick(worldPoint, threshold);
        if (!hit) {
            this.drag = null;
            return;
        }
        if (hit.type === "floorVertex") {
            const floorId = getFloorId(hit.floor);
            this.state.selectFloorVertex(
                floorId,
                hit.ringKind || "outer",
                Number.isFinite(hit.holeIndex) ? hit.holeIndex : -1,
                Number.isFinite(hit.vertexIndex) ? hit.vertexIndex : hit.index
            );
            this.drag = {
                type: "floorVertex",
                floorId,
                ringKind: hit.ringKind || "outer",
                holeIndex: Number.isFinite(hit.holeIndex) ? hit.holeIndex : -1,
                vertexIndex: Number.isFinite(hit.vertexIndex) ? hit.vertexIndex : hit.index
            };
            return;
        }
        if (hit.type === "wall") {
            this.state.selectWall(hit.wall.id);
            this.drag = null;
            return;
        }
        if (hit.type === "floor") {
            this.state.selectFloor(getFloorId(hit.floor));
            this.drag = null;
        }
    }

    pointerMove(worldPoint) {
        if (!this.drag) return;
        if (this.drag.type === "floorVertex" || this.drag.type === "selectedFloorVertex") {
            this.state.moveSelectedFloorVertex(worldPoint);
        }
    }

    pointerUp() {
        this.drag = null;
    }
}
