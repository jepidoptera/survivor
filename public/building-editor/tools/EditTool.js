import { getFloorId } from "../BuildingModel.js";
import { findRingVertexAtPoint } from "../BuildingPolygonEditing.js";

export class EditTool {
    constructor(state) {
        this.state = state;
        this.dragging = false;
    }

    pointerDown(worldPoint, threshold, options = {}) {
        const floor = this.state.selectedFloor();
        if (!floor) return;

        if (this.state.editorMode === "walls") {
            const endpointHit = this.state.pickWallEndpoint(worldPoint, threshold);
            if (endpointHit) {
                this.state.selectWallEndpoint(endpointHit.wall.id, endpointHit.endpointKey);
                this.dragging = { kind: "wallEndpoint", threshold };
                return;
            }
            const wallHit = this.state.pick(worldPoint, threshold);
            if (wallHit && wallHit.type === "wall") {
                this.state.selectWall(wallHit.wall.id);
            }
            this.dragging = false;
            return;
        }

        if (options.shiftKey) {
            if (this.state.insertFloorVertexOnEdge(worldPoint, threshold)) {
                this.state.beginFloorVertexDrag();
                this.dragging = { kind: "floorVertex" };
            }
            return;
        }

        const hit = findRingVertexAtPoint(floor, worldPoint, threshold);
        if (!hit) {
            this.state.clearVertexSelection();
            this.state.endFloorVertexDrag();
            this.dragging = false;
            return;
        }

        this.state.selectFloorVertex(getFloorId(floor), hit.ringKind, hit.holeIndex, hit.vertexIndex);
        this.state.beginFloorVertexDrag();
        this.dragging = { kind: "floorVertex" };
    }

    pointerMove(worldPoint) {
        if (!this.dragging) return;
        if (this.dragging.kind === "wallEndpoint") {
            this.state.moveSelectedWallEndpoint(worldPoint, this.dragging.threshold);
            return;
        }
        this.state.moveSelectedFloorVertex(worldPoint);
    }

    pointerUp() {
        if (this.dragging && this.dragging.kind === "floorVertex") {
            this.state.endFloorVertexDrag();
        }
        this.dragging = false;
    }
}
