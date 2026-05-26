export class PolygonEditTool {
    constructor(state, operation) {
        this.state = state;
        this.operation = operation;
    }

    pointerDown(worldPoint, threshold = 0, options = {}) {
        const point = this.state.preparePoint(worldPoint);
        if (
            this.state.draft &&
            this.state.draft.kind === "polygonEdit" &&
            this.state.draft.operation === this.operation &&
            this.state.draft.points.length >= 3 &&
            (options.doubleClick || distance(point, this.state.draft.points[0]) <= threshold)
        ) {
            this.finish();
            return;
        }
        if (
            !this.state.draft ||
            this.state.draft.kind !== "polygonEdit" ||
            this.state.draft.operation !== this.operation
        ) {
            this.state.draft = { kind: "polygonEdit", operation: this.operation, points: [] };
        }
        this.state.draft.points.push(point);
        this.state.emitChange();
    }

    finish() {
        if (
            !this.state.draft ||
            this.state.draft.kind !== "polygonEdit" ||
            this.state.draft.operation !== this.operation
        ) {
            return;
        }
        if (this.state.draft.points.length < 3) {
            throw new Error("a polygon edit requires at least three points");
        }
        this.state.applyPolygonDraftToSelectedFloor(this.state.draft.points, this.operation);
        this.state.draft = null;
        this.state.emitChange();
    }

    cancel() {
        this.state.draft = null;
        this.state.emitChange();
    }
}

function distance(a, b) {
    return Math.hypot(Number(a.x) - Number(b.x), Number(a.y) - Number(b.y));
}
