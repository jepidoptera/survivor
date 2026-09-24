export class RoofTool {
    constructor(state) {
        this.state = state;
    }

    _supportHit(options = {}) {
        if (!options.renderer || !options.screenPoint || typeof options.renderer.pickAtScreen !== "function") return null;
        const hit = options.renderer.pickAtScreen(options.screenPoint, {
            includeSurfaces: false,
            includeMountedObjects: false,
            includeBeams: false
        });
        return hit && (hit.type === "wall" || hit.type === "column") ? hit : null;
    }

    pointerDown(worldPoint, threshold, options = {}) {
        const hit = this._supportHit(options);
        if (!hit) throw new Error("click the top of a wall or column to place a roof");
        this.state.createRoofFromSupportHit(hit, {
            screenPoint: options.screenPoint,
            renderer: options.renderer,
            preserveView: this.state.renderStyle() === "exterior"
        });
        this.state.draft = null;
        this.state.setTool("select");
    }

    pointerMove(worldPoint, threshold, options = {}) {
        const hit = this._supportHit(options);
        if (!hit) {
            if (this.state.draft) {
                this.state.draft = null;
                this.state.emitChange();
            }
            return;
        }
        const placement = this.state.roofPlacementFromSupportHit(hit, {
            screenPoint: options.screenPoint,
            renderer: options.renderer
        });
        this.state.draft = {
            kind: "roofPlacement",
            floorId: placement.floorId,
            elevation: placement.elevation,
            points: placement.contactPolygon
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
