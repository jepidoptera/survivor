import { getFloorId } from "../BuildingModel.js";

export class GableTool {
    constructor(state) {
        this.state = state;
    }

    pointerDown(worldPoint, threshold, options = {}) {
        const renderer = options.renderer;
        const screenPoint = options.screenPoint;
        if (!renderer || !screenPoint || typeof renderer.pickRoofFaceAtScreen !== "function") {
            throw new Error("gable placement requires roof face picking");
        }
        const faceHit = renderer.pickRoofFaceAtScreen(screenPoint);
        if (!faceHit || !faceHit.floor) {
            throw new Error("click a roof face to place a gable");
        }
        const gable = this.state.addGableToRoof(getFloorId(faceHit.floor), faceHit.faceIndex, {
            roofId: faceHit.roof && faceHit.roof.id,
            preserveView: this.state.renderStyle() === "exterior"
        });
        this.state.selectGable(getFloorId(faceHit.floor), gable.id, {
            roofId: faceHit.roof && faceHit.roof.id,
            preserveView: this.state.renderStyle() === "exterior"
        });
    }

    pointerMove() {}

    pointerUp() {}
}
