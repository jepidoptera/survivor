export class PolygonEditTool {
    constructor(state, operation) {
        this.state = state;
        this.operation = operation;
        this.drag = null;
    }

    pointerDown(worldPoint, threshold = 0, options = {}) {
        const preparedPoint = this.state.preparePoint(worldPoint, { preferFloorVertices: true });
        const existingDraft = this.state.draft &&
            this.state.draft.kind === "polygonEdit" &&
            this.state.draft.operation === this.operation
            ? this.state.draft
            : null;
        if (existingDraft && existingDraft.completed === true) {
            if (options.shiftKey && this.state.insertPolygonDraftVertexOnEdge(worldPoint, threshold)) {
                this.drag = { type: "draftVertex" };
                return;
            }
            const hit = this.state.pickPolygonDraftVertex(worldPoint, threshold);
            if (hit) {
                this.state.selectPolygonDraftVertex(hit.vertexIndex);
                this.drag = { type: "draftVertex" };
                return;
            }
            this.state.clearPolygonDraftVertexSelection();
            return;
        }
        if (
            existingDraft &&
            existingDraft.points.length >= 3 &&
            (options.doubleClick || distance(preparedPoint, existingDraft.points[0]) <= threshold)
        ) {
            existingDraft.completed = true;
            this.state.emitChange();
            return;
        }
        if (
            !this.state.draft ||
            this.state.draft.kind !== "polygonEdit" ||
            this.state.draft.operation !== this.operation
        ) {
            this.state.draft = {
                kind: "polygonEdit",
                operation: this.operation,
                elevation: this.state.polygonToolElevation,
                completed: false,
                points: []
            };
        }
        const origin = this.state.draft.points.length > 0
            ? this.state.draft.points[this.state.draft.points.length - 1]
            : null;
        const point = origin
            ? this.state.prepareLinePoint(worldPoint, origin, { preferFloorVertices: true })
            : preparedPoint;
        this.state.draft.points.push(point);
        this.state.draft.selectedVertexIndex = this.state.draft.points.length - 1;
        this.state.emitChange();
    }

    pointerMove(worldPoint) {
        if (!this.drag || this.drag.type !== "draftVertex") return;
        this.state.moveSelectedPolygonDraftVertex(worldPoint);
    }

    pointerUp() {
        this.drag = null;
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
        if (this.state.draft.completed !== true) {
            throw new Error("complete the polygon before finalizing it");
        }
        this.state.applyPolygonDraftAtElevation(this.state.draft.points, this.operation, this.state.draft.elevation);
        this.state.draft = null;
        this.state.emitChange();
    }

    cancel() {
        this.state.draft = null;
        this.drag = null;
        this.state.emitChange();
    }
}

function distance(a, b) {
    return Math.hypot(Number(a.x) - Number(b.x), Number(a.y) - Number(b.y));
}
