export class PaintTool {
    constructor(state) {
        this.state = state;
    }

    pointerDown(worldPoint, threshold) {
        const mode = this.state.editorMode === "walls" ? "walls" : "floor";
        const texture = this.state.paintTextureForMode(mode);
        if (!texture) {
            throw new Error(`choose a ${mode === "walls" ? "wall" : "floor"} texture before painting`);
        }
        if (mode === "walls") {
            const hit = this.state.pickWallAt(worldPoint, threshold);
            if (!hit || !hit.wall) return;
            this.state.paintWall(hit.wall.id, texture);
            return;
        }
        const hit = this.state.pickFloorAt(worldPoint);
        if (!hit || !hit.floor) return;
        this.state.paintFloor(hit.floor, texture);
    }

    pointerMove() {}

    pointerUp() {}
}
