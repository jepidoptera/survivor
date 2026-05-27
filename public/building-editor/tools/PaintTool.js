export class PaintTool {
    constructor(state) {
        this.state = state;
    }

    pointerDown(worldPoint, threshold, options = {}) {
        const screenHit = options.renderer &&
            options.screenPoint &&
            typeof options.renderer.pickAtScreen === "function"
            ? options.renderer.pickAtScreen(options.screenPoint)
            : null;
        const hit = screenHit || this.state.pick(worldPoint, threshold);
        if (!hit) return;
        if (hit.type === "wall") {
            const texture = this.state.paintTextureForMode("walls");
            if (!texture) throw new Error("choose a wall texture before painting");
            this.state.paintWall(hit.wall.id, texture);
            return;
        }
        if (hit.type === "floor") {
            const texture = this.state.paintTextureForMode("floor");
            if (!texture) throw new Error("choose a floor texture before painting");
            this.state.paintFloor(hit.floor, texture);
            return;
        }
        if (hit.type === "roof") {
            const texture = this.state.paintTextureForMode("roofs");
            if (!texture) throw new Error("choose a roof texture before painting");
            this.state.paintRoof(hit.floor, texture);
        }
    }

    pointerMove() {}

    pointerUp() {}
}
