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
        if (this.state.polygonToolRegularPolygon === true) {
            this.pointerDownRegularPolygon(worldPoint, preparedPoint);
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

    pointerDownRegularPolygon(worldPoint, preparedPoint) {
        let draft = this.state.draft &&
            this.state.draft.kind === "polygonEdit" &&
            this.state.draft.operation === this.operation &&
            this.state.draft.regularPolygon
            ? this.state.draft
            : null;
        const sides = regularPolygonSides(this.state.polygonToolSides);
        if (!draft || draft.completed === true) {
            draft = {
                kind: "polygonEdit",
                operation: this.operation,
                elevation: this.state.polygonToolElevation,
                completed: false,
                points: [],
                previewPoints: null,
                regularPolygon: {
                    sides,
                    phase: "side"
                }
            };
            this.state.draft = draft;
        }
        draft.regularPolygon.sides = sides;
        if (draft.regularPolygon.phase === "sideChoice") {
            const preview = regularPolygonPreviewFromDraft(draft, worldPoint, sides);
            if (!preview) {
                throw new Error("regular polygon side selection requires a point off the first side");
            }
            draft.points = preview;
            draft.previewPoints = null;
            draft.completed = true;
            draft.selectedVertexIndex = -1;
            draft.regularPolygon.phase = "completed";
            this.state.emitChange();
            return;
        }
        if (draft.points.length === 0) {
            draft.points.push(preparedPoint);
            draft.selectedVertexIndex = 0;
            this.state.emitChange();
            return;
        }
        if (draft.points.length === 1) {
            const sideEnd = this.state.prepareLinePoint(worldPoint, draft.points[0], { preferFloorVertices: true });
            if (distance(draft.points[0], sideEnd) <= 0.000001) {
                throw new Error("regular polygon side requires two distinct points");
            }
            draft.points.push(sideEnd);
            draft.selectedVertexIndex = 1;
            draft.regularPolygon = {
                sides,
                phase: "sideChoice",
                baseStart: { ...draft.points[0] },
                baseEnd: { ...sideEnd }
            };
            draft.previewPoints = regularPolygonPreviewFromDraft(draft, worldPoint, sides);
            this.state.emitChange();
            return;
        }
        throw new Error("regular polygon draft is in an invalid click state");
    }

    pointerMove(worldPoint) {
        const draft = this.state.draft &&
            this.state.draft.kind === "polygonEdit" &&
            this.state.draft.operation === this.operation &&
            this.state.draft.regularPolygon &&
            this.state.draft.regularPolygon.phase === "sideChoice"
            ? this.state.draft
            : null;
        if (draft) {
            const sides = regularPolygonSides(this.state.polygonToolSides);
            draft.regularPolygon.sides = sides;
            draft.previewPoints = regularPolygonPreviewFromDraft(draft, worldPoint, sides);
            this.state.emitChange();
            return;
        }
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

function regularPolygonSides(value) {
    const sides = Math.round(Number(value));
    if (!Number.isInteger(sides) || sides < 3 || sides > 24) {
        throw new Error("regular polygon sides must be an integer between 3 and 24");
    }
    return sides;
}

function regularPolygonPreviewFromDraft(draft, sidePoint, sides) {
    const regular = draft && draft.regularPolygon;
    const start = regular && regular.baseStart;
    const end = regular && regular.baseEnd;
    if (!start || !end) return null;
    return buildRegularPolygonFromSide(start, end, sides, sidePoint);
}

export function buildRegularPolygonFromSide(start, end, sidesValue, sidePoint) {
    const sides = regularPolygonSides(sidesValue);
    const ax = Number(start && start.x);
    const ay = Number(start && start.y);
    const bx = Number(end && end.x);
    const by = Number(end && end.y);
    const px = Number(sidePoint && sidePoint.x);
    const py = Number(sidePoint && sidePoint.y);
    if (![ax, ay, bx, by, px, py].every(Number.isFinite)) {
        throw new Error("regular polygon construction requires finite points");
    }
    const dx = bx - ax;
    const dy = by - ay;
    const sideLength = Math.hypot(dx, dy);
    if (sideLength <= 0.000001) {
        throw new Error("regular polygon side requires two distinct points");
    }
    const cross = dx * (py - ay) - dy * (px - ax);
    if (Math.abs(cross) <= 0.000001) return null;
    const sideSign = cross > 0 ? 1 : -1;
    const ux = dx / sideLength;
    const uy = dy / sideLength;
    const leftNormalX = -uy;
    const leftNormalY = ux;
    const midpointX = (ax + bx) * 0.5;
    const midpointY = (ay + by) * 0.5;
    const apothem = sideLength / (2 * Math.tan(Math.PI / sides));
    const centerX = midpointX + leftNormalX * apothem * sideSign;
    const centerY = midpointY + leftNormalY * apothem * sideSign;
    const angleStep = sideSign * (Math.PI * 2 / sides);
    const radiusX = ax - centerX;
    const radiusY = ay - centerY;
    const points = [];
    for (let index = 0; index < sides; index++) {
        const angle = angleStep * index;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        points.push({
            x: centerX + radiusX * cos - radiusY * sin,
            y: centerY + radiusX * sin + radiusY * cos
        });
    }
    points[0] = { x: ax, y: ay };
    points[1] = { x: bx, y: by };
    return points;
}
