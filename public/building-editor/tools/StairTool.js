import { distanceToSegment } from "../BuildingGeometry.js";
import { findFloor, getFloorElevation, getFloorId, wallPoints } from "../BuildingModel.js";

const LADDER_DEPTH = 1 / 6;
const ROTATION_STEP = Math.PI / 36;
const GEOMETRY_EPSILON = 0.000001;
const FINAL_POINT_HIT_PIXELS = 10;
const FINAL_POINT_DRAG_PIXELS = 3;
const SNAPPED_TREAD_ANGLE_STEP = Math.PI / 12;
const RIGHT_ANGLE_SNAP_THRESHOLD = Math.PI / 24;
const ARC_DELTA_SNAP_THRESHOLD = Math.PI / 24;
const ARC_DELTA_SNAP_GEOMETRY_EPSILON = 0.00001;

function finitePoint(point) {
    return !!point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y));
}

function closestPointOnSegment(point, a, b) {
    const dx = Number(b.x) - Number(a.x);
    const dy = Number(b.y) - Number(a.y);
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared <= GEOMETRY_EPSILON) return { x: Number(a.x), y: Number(a.y), t: 0 };
    const t = Math.max(0, Math.min(1, ((Number(point.x) - Number(a.x)) * dx + (Number(point.y) - Number(a.y)) * dy) / lengthSquared));
    return {
        x: Number(a.x) + dx * t,
        y: Number(a.y) + dy * t,
        t
    };
}

function normalizeVector(x, y, label) {
    const length = Math.hypot(Number(x), Number(y));
    if (!Number.isFinite(length) || length <= GEOMETRY_EPSILON) {
        throw new Error(`${label} requires a non-zero vector`);
    }
    return { x: Number(x) / length, y: Number(y) / length };
}

function treadFromCenter(center, angle, width) {
    const half = Number(width) * 0.5;
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    return {
        left: { x: Number(center.x) - ux * half, y: Number(center.y) - uy * half },
        right: { x: Number(center.x) + ux * half, y: Number(center.y) + uy * half },
        center: { x: Number(center.x), y: Number(center.y) },
        angle
    };
}

function treadFromEndpoint(anchor, endpointKey, angle, width) {
    const resolvedAngle = Number(angle);
    const ux = Math.cos(resolvedAngle);
    const uy = Math.sin(resolvedAngle);
    const length = Number(width);
    if (endpointKey === "left") {
        return {
            left: { x: Number(anchor.x), y: Number(anchor.y) },
            right: { x: Number(anchor.x) + ux * length, y: Number(anchor.y) + uy * length },
            center: { x: Number(anchor.x) + ux * length * 0.5, y: Number(anchor.y) + uy * length * 0.5 },
            angle: resolvedAngle
        };
    }
    return {
        left: { x: Number(anchor.x) - ux * length, y: Number(anchor.y) - uy * length },
        right: { x: Number(anchor.x), y: Number(anchor.y) },
        center: { x: Number(anchor.x) - ux * length * 0.5, y: Number(anchor.y) - uy * length * 0.5 },
        angle: resolvedAngle
    };
}

function treadAngle(tread) {
    return Math.atan2(Number(tread.right.y) - Number(tread.left.y), Number(tread.right.x) - Number(tread.left.x));
}

function snapAngle(angle, step = SNAPPED_TREAD_ANGLE_STEP) {
    return Math.round(Number(angle) / step) * step;
}

function angleDistance(a, b) {
    let delta = Number(a) - Number(b);
    while (delta <= -Math.PI) delta += Math.PI * 2;
    while (delta > Math.PI) delta -= Math.PI * 2;
    return Math.abs(delta);
}

function normalizeRadians(angle) {
    let out = Number(angle) % (Math.PI * 2);
    if (out <= -Math.PI) out += Math.PI * 2;
    if (out > Math.PI) out -= Math.PI * 2;
    return out;
}

function shortestAngleDelta(from, to) {
    return normalizeRadians(Number(to) - Number(from));
}

function unwrapDeltaNear(delta, referenceDelta) {
    let unwrapped = Number(delta);
    const reference = Number(referenceDelta);
    if (!Number.isFinite(unwrapped)) throw new Error("stair arc delta must be finite");
    if (!Number.isFinite(reference)) return unwrapped;
    while (unwrapped - reference > Math.PI) unwrapped -= Math.PI * 2;
    while (unwrapped - reference <= -Math.PI) unwrapped += Math.PI * 2;
    return unwrapped;
}

function snappedArcDelta(delta) {
    const resolved = Number(delta);
    if (!Number.isFinite(resolved)) throw new Error("stair arc delta must be finite");
    const target = Math.round(resolved / Math.PI) * Math.PI;
    if (Math.abs(target) < Math.PI - GEOMETRY_EPSILON) return null;
    return Math.abs(resolved - target) <= ARC_DELTA_SNAP_THRESHOLD ? target : null;
}

function pointFromPolar(center, radius, angle) {
    return {
        x: Number(center.x) + Math.cos(angle) * Number(radius),
        y: Number(center.y) + Math.sin(angle) * Number(radius)
    };
}

function snapTreadAngleToRightAngle(directionAngle, angle) {
    const candidates = [Number(directionAngle) + Math.PI * 0.5, Number(directionAngle) - Math.PI * 0.5];
    const nearest = candidates.reduce((best, candidate) => {
        const distance = angleDistance(angle, candidate);
        return !best || distance < best.distance ? { angle: candidate, distance } : best;
    }, null);
    return nearest && nearest.distance <= RIGHT_ANGLE_SNAP_THRESHOLD ? nearest.angle : angle;
}

function reflectAngleAcrossDirection(treadAngleValue, directionAngle) {
    return 2 * directionAngle - treadAngleValue;
}

function signedArea(a, b, c) {
    return (Number(b.x) - Number(a.x)) * (Number(c.y) - Number(a.y)) -
        (Number(b.y) - Number(a.y)) * (Number(c.x) - Number(a.x));
}

function pointsAlmostEqual(a, b) {
    return Math.hypot(Number(a.x) - Number(b.x), Number(a.y) - Number(b.y)) <= 0.000001;
}

function pointOnSegment(point, a, b) {
    return Math.abs(signedArea(a, b, point)) <= 0.000001 &&
        Number(point.x) >= Math.min(Number(a.x), Number(b.x)) - 0.000001 &&
        Number(point.x) <= Math.max(Number(a.x), Number(b.x)) + 0.000001 &&
        Number(point.y) >= Math.min(Number(a.y), Number(b.y)) - 0.000001 &&
        Number(point.y) <= Math.max(Number(a.y), Number(b.y)) + 0.000001;
}

function pointStrictlyOnSegment(point, a, b) {
    return pointOnSegment(point, a, b) && !pointsAlmostEqual(point, a) && !pointsAlmostEqual(point, b);
}

function properSegmentsCross(a, b, c, d) {
    const abC = signedArea(a, b, c);
    const abD = signedArea(a, b, d);
    const cdA = signedArea(c, d, a);
    const cdB = signedArea(c, d, b);
    return (
        ((abC > 0.000001 && abD < -0.000001) || (abC < -0.000001 && abD > 0.000001)) &&
        ((cdA > 0.000001 && cdB < -0.000001) || (cdA < -0.000001 && cdB > 0.000001))
    );
}

function segmentsIntersect(a, b, c, d) {
    if (properSegmentsCross(a, b, c, d)) return true;
    return pointOnSegment(c, a, b) ||
        pointOnSegment(d, a, b) ||
        pointOnSegment(a, c, d) ||
        pointOnSegment(b, c, d);
}

function lineIntersectionPoint(a, b, c, d) {
    const ax = Number(a.x);
    const ay = Number(a.y);
    const bx = Number(b.x);
    const by = Number(b.y);
    const cx = Number(c.x);
    const cy = Number(c.y);
    const dx = Number(d.x);
    const dy = Number(d.y);
    const abx = bx - ax;
    const aby = by - ay;
    const cdx = dx - cx;
    const cdy = dy - cy;
    const denominator = abx * cdy - aby * cdx;
    if (Math.abs(denominator) <= GEOMETRY_EPSILON) return null;
    const acx = cx - ax;
    const acy = cy - ay;
    const t = (acx * cdy - acy * cdx) / denominator;
    return { x: ax + abx * t, y: ay + aby * t };
}

function segmentIntersectionIsOnlySharedEndpoint(a, b, c, d) {
    const sharedEndpointPairs = [
        [a, c],
        [a, d],
        [b, c],
        [b, d]
    ].filter(([p, q]) => pointsAlmostEqual(p, q));
    if (sharedEndpointPairs.length !== 1) return false;
    return !pointStrictlyOnSegment(c, a, b) &&
        !pointStrictlyOnSegment(d, a, b) &&
        !pointStrictlyOnSegment(a, c, d) &&
        !pointStrictlyOnSegment(b, c, d);
}

function treadLinesCross(a, b) {
    return properSegmentsCross(a.left, a.right, b.left, b.right);
}

function treadLinesConflict(a, b) {
    if (!segmentsIntersect(a.left, a.right, b.left, b.right)) return false;
    return !segmentIntersectionIsOnlySharedEndpoint(a.left, a.right, b.left, b.right);
}

function snapNearestTreadEndpoints(previous, pending) {
    const pairs = [
        { previous: previous.left, pending: pending.left, pendingKey: "left" },
        { previous: previous.left, pending: pending.right, pendingKey: "right" },
        { previous: previous.right, pending: pending.left, pendingKey: "left" },
        { previous: previous.right, pending: pending.right, pendingKey: "right" }
    ];
    const nearest = pairs.reduce((best, pair) => {
        const distance = Math.hypot(Number(pair.previous.x) - Number(pair.pending.x), Number(pair.previous.y) - Number(pair.pending.y));
        return !best || distance < best.distance ? { ...pair, distance } : best;
    }, null);
    if (!nearest) return pending;
    return treadFromEndpoint(nearest.previous, nearest.pendingKey, snapAngle(treadAngle(pending)), Math.hypot(
        Number(pending.right.x) - Number(pending.left.x),
        Number(pending.right.y) - Number(pending.left.y)
    ));
}

function cloneTread(tread) {
    const cloned = {
        left: { x: Number(tread.left.x), y: Number(tread.left.y) },
        right: { x: Number(tread.right.x), y: Number(tread.right.y) },
        center: { x: Number(tread.center.x), y: Number(tread.center.y) },
        angle: Number.isFinite(Number(tread.angle)) ? Number(tread.angle) : treadAngle(tread)
    };
    if (Object.prototype.hasOwnProperty.call(tread, "arcDeltaAngle")) {
        const value = Number(tread.arcDeltaAngle);
        if (!Number.isFinite(value)) throw new Error("stair tread arcDeltaAngle must be finite");
        cloned.arcDeltaAngle = value;
    }
    if (Object.prototype.hasOwnProperty.call(tread, "arcNearDeltaAngle")) {
        const value = Number(tread.arcNearDeltaAngle);
        if (!Number.isFinite(value)) throw new Error("stair tread arcNearDeltaAngle must be finite");
        cloned.arcNearDeltaAngle = value;
    }
    return cloned;
}

function connectedTreadEndpoint(a, b) {
    const endpoints = [
        { aName: "left", bName: "left", aPoint: a.left, bPoint: b.left, aOther: a.right, bOther: b.right },
        { aName: "left", bName: "right", aPoint: a.left, bPoint: b.right, aOther: a.right, bOther: b.left },
        { aName: "right", bName: "left", aPoint: a.right, bPoint: b.left, aOther: a.left, bOther: b.right },
        { aName: "right", bName: "right", aPoint: a.right, bPoint: b.right, aOther: a.left, bOther: b.left }
    ];
    return endpoints.find((entry) => pointsAlmostEqual(entry.aPoint, entry.bPoint)) || null;
}

function treadArcDeltas(previous, next) {
    const directionCross = Math.sin(treadAngle(next) - treadAngle(previous));
    if (Math.abs(directionCross) <= GEOMETRY_EPSILON) return null;
    const connected = connectedTreadEndpoint(previous, next);
    if (connected) {
        const center = connected.aPoint;
        const startAngle = Math.atan2(Number(connected.aOther.y) - Number(center.y), Number(connected.aOther.x) - Number(center.x));
        const endAngle = Math.atan2(Number(connected.bOther.y) - Number(center.y), Number(connected.bOther.x) - Number(center.x));
        return {
            kind: "wedge",
            center,
            radius: Math.hypot(Number(connected.aOther.x) - Number(center.x), Number(connected.aOther.y) - Number(center.y)),
            startAngle,
            deltaAngle: shortestAngleDelta(startAngle, endAngle),
            sharedKey: connected.bName,
            outerKey: connected.bName === "left" ? "right" : "left"
        };
    }
    const crossing = lineIntersectionPoint(previous.left, previous.right, next.left, next.right);
    if (!crossing) return null;
    const sortedPrevious = [previous.left, previous.right]
        .map((point, index) => ({ key: index === 0 ? "left" : "right", point, distance: Math.hypot(Number(point.x) - crossing.x, Number(point.y) - crossing.y) }))
        .sort((a, b) => a.distance - b.distance);
    const sortedNext = [next.left, next.right]
        .map((point, index) => ({ key: index === 0 ? "left" : "right", point, distance: Math.hypot(Number(point.x) - crossing.x, Number(point.y) - crossing.y) }))
        .sort((a, b) => a.distance - b.distance);
    const farStartAngle = Math.atan2(sortedPrevious[1].point.y - crossing.y, sortedPrevious[1].point.x - crossing.x);
    const farEndAngle = Math.atan2(sortedNext[1].point.y - crossing.y, sortedNext[1].point.x - crossing.x);
    const nearStartAngle = Math.atan2(sortedPrevious[0].point.y - crossing.y, sortedPrevious[0].point.x - crossing.x);
    const nearEndAngle = Math.atan2(sortedNext[0].point.y - crossing.y, sortedNext[0].point.x - crossing.x);
    return {
        kind: "annular",
        center: crossing,
        farRadius: (sortedPrevious[1].distance + sortedNext[1].distance) * 0.5,
        nearRadius: (sortedPrevious[0].distance + sortedNext[0].distance) * 0.5,
        farStartAngle,
        nearStartAngle,
        farKey: sortedNext[1].key,
        nearKey: sortedNext[0].key,
        deltaAngle: shortestAngleDelta(farStartAngle, farEndAngle),
        nearDeltaAngle: shortestAngleDelta(nearStartAngle, nearEndAngle)
    };
}

function pendingTreadForArcDelta(pending, arc, deltaAngle, nearDeltaAngle = deltaAngle) {
    const next = {
        ...pending,
        left: { x: Number(pending.left.x), y: Number(pending.left.y) },
        right: { x: Number(pending.right.x), y: Number(pending.right.y) },
        center: { x: Number(pending.center.x), y: Number(pending.center.y) }
    };
    if (arc.kind === "wedge") {
        next[arc.sharedKey] = { x: Number(arc.center.x), y: Number(arc.center.y) };
        next[arc.outerKey] = pointFromPolar(arc.center, arc.radius, arc.startAngle + deltaAngle);
    } else if (arc.kind === "annular") {
        next[arc.farKey] = pointFromPolar(arc.center, arc.farRadius, arc.farStartAngle + deltaAngle);
        next[arc.nearKey] = pointFromPolar(arc.center, arc.nearRadius, arc.nearStartAngle + nearDeltaAngle);
    } else {
        throw new Error(`unsupported stair arc kind: ${arc.kind}`);
    }
    next.center = {
        x: (next.left.x + next.right.x) * 0.5,
        y: (next.left.y + next.right.y) * 0.5
    };
    next.angle = treadAngle(next);
    return next;
}

function ladderFootprintFromWall(projection, wallUnit, normal, width) {
    const half = Number(width) * 0.5;
    const left = {
        x: Number(projection.x) - wallUnit.x * half,
        y: Number(projection.y) - wallUnit.y * half
    };
    const right = {
        x: Number(projection.x) + wallUnit.x * half,
        y: Number(projection.y) + wallUnit.y * half
    };
    return [
        left,
        right,
        { x: right.x + normal.x * LADDER_DEPTH, y: right.y + normal.y * LADDER_DEPTH },
        { x: left.x + normal.x * LADDER_DEPTH, y: left.y + normal.y * LADDER_DEPTH }
    ];
}

export class StairTool {
    constructor(state) {
        this.state = state;
        this.previewRotation = 0;
        this.lastWorldPoint = null;
        this.drag = null;
    }

    _floorForPoint(worldPoint, options = {}) {
        const screenHit = options.renderer &&
            options.screenPoint &&
            typeof options.renderer.pickAtScreen === "function"
            ? options.renderer.pickAtScreen(options.screenPoint, {
                includeMountedObjects: false,
                includeColumns: false,
                includeBeams: false
            })
            : null;
        const target = screenHit && screenHit.floor ? screenHit : this.state.pickFloorAt(worldPoint);
        return target && target.floor ? target.floor : null;
    }

    _wallSnap(worldPoint, floor, options = {}) {
        const width = Number(this.state.stairTool.width);
        const tenPixels = options.renderer && typeof options.renderer.screenPixelsToWorldDistance === "function"
            ? options.renderer.screenPixelsToWorldDistance(10)
            : 0.1;
        const threshold = width * 0.5 + tenPixels;
        const wallHit = this.state.pickWallAt(worldPoint, threshold);
        if (!wallHit || !wallHit.wall || getFloorId(wallHit.floor) !== getFloorId(floor)) return null;
        const points = wallPoints(this.state.building, wallHit.wall);
        if (!Array.isArray(points) || points.length !== 2) return null;
        const projection = closestPointOnSegment(worldPoint, points[0], points[1]);
        const wallUnit = normalizeVector(points[1].x - points[0].x, points[1].y - points[0].y, "stair wall snap");
        const normalA = { x: -wallUnit.y, y: wallUnit.x };
        const dx = Number(worldPoint.x) - projection.x;
        const dy = Number(worldPoint.y) - projection.y;
        const normalSign = dx * normalA.x + dy * normalA.y >= 0 ? 1 : -1;
        const normal = { x: normalA.x * normalSign, y: normalA.y * normalSign };
        const distance = distanceToSegment(worldPoint, points[0], points[1]);
        const onWall = distance <= tenPixels;
        return { wall: wallHit.wall, points, projection, wallUnit, normal, onWall };
    }

    _previewForPoint(worldPoint, options = {}) {
        const floor = this._floorForPoint(worldPoint, options);
        if (!floor) return null;
        const width = Number(this.state.stairTool.width);
        const snap = this._wallSnap(worldPoint, floor, options);
        const settings = this._settingsForFloor(floor, { quiet: true });
        if (snap && snap.onWall) {
            const footprint = ladderFootprintFromWall(snap.projection, snap.wallUnit, snap.normal, width);
            return {
                floor,
                floorId: getFloorId(floor),
                ladder: true,
                snapped: true,
                snapKind: "ladder",
                treads: [{
                    left: footprint[0],
                    right: footprint[1],
                    center: snap.projection,
                    angle: Math.atan2(snap.wallUnit.y, snap.wallUnit.x)
                }],
                footprint,
                ...settings
            };
        }
        if (snap) {
            const end = {
                x: snap.projection.x + snap.normal.x * width,
                y: snap.projection.y + snap.normal.y * width
            };
            const tread = {
                left: { x: snap.projection.x, y: snap.projection.y },
                right: end,
                center: {
                    x: (snap.projection.x + end.x) * 0.5,
                    y: (snap.projection.y + end.y) * 0.5
                },
                angle: Math.atan2(snap.normal.y, snap.normal.x)
            };
            return {
                floor,
                floorId: getFloorId(floor),
                ladder: false,
                snapped: true,
                snapKind: "wallEnd",
                treads: [tread],
                ...settings
            };
        }
        return {
            floor,
            floorId: getFloorId(floor),
            ladder: false,
            snapped: false,
            snapKind: "",
            treads: [treadFromCenter(worldPoint, this.previewRotation, width)],
            ...settings
        };
    }

    _settingsForFloor(floor, options = {}) {
        try {
            const settings = this.state.stairCreationSettingsForFloor(floor);
            return {
                direction: settings.direction,
                width: settings.width,
                texturePath: settings.texturePath,
                treadTexturePath: settings.treadTexturePath,
                riserTexturePath: settings.riserTexturePath,
                bottomZ: getFloorElevation(floor),
                height: settings.height,
                stepCount: settings.stepCount,
                riserDepth: settings.riserDepth
            };
        } catch (error) {
            if (options.quiet) {
                return {
                    direction: this.state.stairTool.direction,
                    width: this.state.stairTool.width,
                    texturePath: this.state.stairTool.treadTexture || this.state.stairTool.texture,
                    treadTexturePath: this.state.stairTool.treadTexture || this.state.stairTool.texture,
                    riserTexturePath: this.state.stairTool.riserTexture || this.state.stairTool.treadTexture || this.state.stairTool.texture,
                    bottomZ: getFloorElevation(floor),
                    height: 0,
                    stepCount: this.state.stairTool.stepCount || null,
                    riserDepth: this.state.stairTool.riserDepth,
                    placementError: error.message
                };
            }
            throw error;
        }
    }

    pointerMove(worldPoint, threshold, options = {}) {
        this.lastWorldPoint = { x: Number(worldPoint.x), y: Number(worldPoint.y) };
        if (this.drag && this.drag.type === "treadPoint") {
            this._moveDraftTreadPoint(this.lastWorldPoint);
            return;
        }
        if (this.drag && this.drag.type === "finalPoint") {
            const dragDistance = Math.hypot(
                this.lastWorldPoint.x - this.drag.startPoint.x,
                this.lastWorldPoint.y - this.drag.startPoint.y
            );
            if (!this.drag.moved && dragDistance <= this.drag.dragThreshold) return;
            this.drag.moved = true;
            this._moveDraftFinalPoint(this.lastWorldPoint, options);
            return;
        }
        const draft = this._activeDraft();
        if (draft && draft.started && draft.completed !== true && draft.ladder !== true) {
            this._updatePendingTread(this.lastWorldPoint, options);
            return;
        }
        if (draft && draft.completed === true) return;
        const preview = this._previewForPoint(this.lastWorldPoint, options);
        if (!preview) {
            if (this.state.draft && this.state.draft.kind === "stair" && !this.state.draft.started) {
                this.state.draft = null;
                this.state.emitChange();
            }
            return;
        }
        this.state.draft = {
            kind: "stair",
            started: false,
            completed: false,
            selectedTreadIndex: -1,
            selectedTreadPoint: "",
            ...preview
        };
        this.state.emitChange();
    }

    pointerDown(worldPoint, threshold, options = {}) {
        this.lastWorldPoint = { x: Number(worldPoint.x), y: Number(worldPoint.y) };
        const draft = this._activeDraft();
        if (draft && draft.completed === true) {
            if (draft.ladder !== true && this._pointHitsFinalPoint(this.lastWorldPoint, threshold, options)) {
                draft.selectedTreadIndex = draft.treads.length - 1;
                draft.selectedTreadPoint = "center";
                this.drag = {
                    type: "finalPoint",
                    startPoint: { ...this.lastWorldPoint },
                    dragThreshold: this._screenPixelsToWorldDistance(FINAL_POINT_DRAG_PIXELS, threshold, options),
                    moved: false
                };
                this.state.emitChange();
                return;
            }
            const hit = this._pickDraftTreadPoint(worldPoint, threshold);
            if (hit) {
                draft.selectedTreadIndex = hit.treadIndex;
                draft.selectedTreadPoint = hit.pointKey;
                this.drag = { type: "treadPoint" };
                this.state.emitChange();
                return;
            }
            draft.selectedTreadIndex = -1;
            draft.selectedTreadPoint = "";
            this.state.emitChange();
            return;
        }
        if (draft && draft.started) {
            if (draft.ladder !== true && this._pointHitsFinalPoint(this.lastWorldPoint, threshold, options)) {
                if (!Array.isArray(draft.treads) || draft.treads.length < 2) return;
                draft.completed = true;
                draft.pendingTread = null;
                draft.pendingArcState = null;
                this.state.emitChange();
                return;
            }
            this._commitPendingTread();
            return;
        }
        const preview = this._previewForPoint(this.lastWorldPoint, options);
        if (!preview) return;
        const startedDraft = {
            kind: "stair",
            started: true,
            completed: preview.ladder === true,
            ladder: preview.ladder === true,
            floorId: preview.floorId,
            bottomZ: preview.bottomZ,
            height: preview.height,
            direction: preview.direction,
            width: preview.width,
            stepCount: preview.stepCount,
            texturePath: preview.texturePath,
            treadTexturePath: preview.treadTexturePath,
            riserTexturePath: preview.riserTexturePath,
            placementError: preview.placementError || "",
            treads: preview.treads.map(cloneTread),
            footprint: preview.footprint || null,
            pendingTread: null,
            pendingArcState: null,
            selectedTreadIndex: -1,
            selectedTreadPoint: ""
        };
        this.state.selectedFloorIds = new Set([preview.floorId]);
        this.state.layerSelectionMode = "floor";
        this.state.draft = startedDraft;
        this.state.emitChange();
    }

    _screenPixelsToWorldDistance(pixels, threshold, options = {}) {
        if (options.renderer && typeof options.renderer.screenPixelsToWorldDistance === "function") {
            return options.renderer.screenPixelsToWorldDistance(pixels);
        }
        const scaledThreshold = Number(threshold);
        if (Number.isFinite(scaledThreshold) && scaledThreshold > 0) {
            const thresholdPixels = Number(options.thresholdPixels);
            if (Number.isFinite(thresholdPixels) && thresholdPixels > 0) {
                return scaledThreshold * Number(pixels) / thresholdPixels;
            }
            return scaledThreshold;
        }
        return Number(pixels) * 0.01;
    }

    _finalPoint(draft = this._activeDraft()) {
        if (!draft || !Array.isArray(draft.treads) || !draft.treads.length) return null;
        const tread = draft.treads[draft.treads.length - 1];
        return tread && tread.center ? tread.center : null;
    }

    _pointHitsFinalPoint(worldPoint, threshold, options = {}) {
        const finalPoint = this._finalPoint();
        if (!finalPoint) return false;
        const hitDistance = this._screenPixelsToWorldDistance(FINAL_POINT_HIT_PIXELS, threshold, options);
        return Math.hypot(Number(worldPoint.x) - Number(finalPoint.x), Number(worldPoint.y) - Number(finalPoint.y)) <= hitDistance;
    }

    pointerUp(worldPoint, threshold, options = {}) {
        if (this.drag && this.drag.type === "finalPoint") {
            if (!this.drag.moved) {
                const draft = this._activeDraft();
                if (draft && draft.completed === true) {
                    draft.completed = false;
                    draft.pendingTread = null;
                    draft.pendingArcState = null;
                    draft.selectedTreadIndex = -1;
                    draft.selectedTreadPoint = "";
                    this.state.emitChange();
                }
            }
            this.drag = null;
            return;
        }
        this.drag = null;
    }

    rotatePreview(delta = ROTATION_STEP) {
        const draft = this._activeDraft();
        if (draft && draft.started) return false;
        this.previewRotation += Number(delta);
        if (this.lastWorldPoint) this.pointerMove(this.lastWorldPoint, 0, {});
        return true;
    }

    _activeDraft() {
        return this.state.draft && this.state.draft.kind === "stair" ? this.state.draft : null;
    }

    _updatePendingTread(worldPoint, options = {}) {
        const draft = this._activeDraft();
        if (!draft || !draft.started || !Array.isArray(draft.treads) || !draft.treads.length) return;
        const previous = draft.treads[draft.treads.length - 1];
        const pending = this._pendingTreadForPoint(draft, previous, worldPoint, options);
        if (!pending) return;
        draft.pendingTread = this._pendingTreadWithArcMetadata(draft, previous, pending);
        this.state.emitChange();
    }

    _pendingTreadForPoint(draft, previous, worldPoint, options = {}) {
        const rawDistance = Math.hypot(Number(worldPoint.x) - Number(previous.center.x), Number(worldPoint.y) - Number(previous.center.y));
        if (!Number.isFinite(rawDistance) || rawDistance <= GEOMETRY_EPSILON) return null;
        const floor = this.state.building && draft.floorId ? findFloor(this.state.building, draft.floorId) : null;
        const wallSnap = floor ? this._wallSnap(worldPoint, floor, options) : null;
        const targetPoint = wallSnap
            ? {
                x: Number(wallSnap.projection.x) + Number(wallSnap.normal.x) * Number(draft.width) * 0.5,
                y: Number(wallSnap.projection.y) + Number(wallSnap.normal.y) * Number(draft.width) * 0.5
            }
            : { x: Number(worldPoint.x), y: Number(worldPoint.y) };
        const direction = normalizeVector(
            targetPoint.x - Number(previous.center.x),
            targetPoint.y - Number(previous.center.y),
            "stair path segment"
        );
        const directionAngle = Math.atan2(direction.y, direction.x);
        const pendingAngle = snapTreadAngleToRightAngle(
            directionAngle,
            reflectAngleAcrossDirection(treadAngle(previous), directionAngle)
        );
        let pending = treadFromCenter(targetPoint, pendingAngle, draft.width);
        if (treadLinesCross(previous, pending)) pending = snapNearestTreadEndpoints(previous, pending);
        return pending;
    }

    _pendingTreadWithArcMetadata(draft, previous, pending, options = {}) {
        const deltas = treadArcDeltas(previous, pending);
        if (!deltas) {
            draft.pendingArcState = null;
            return pending;
        }
        const previousState = draft.pendingArcState &&
            draft.pendingArcState.treadIndex === draft.treads.length - 1 &&
            draft.pendingArcState.kind === deltas.kind
            ? draft.pendingArcState
            : null;
        const referenceDelta = previousState && previousState.deltaAngle !== null && previousState.deltaAngle !== undefined
            ? previousState.deltaAngle
            : options.referenceDeltaAngle;
        let deltaAngle = unwrapDeltaNear(deltas.deltaAngle, referenceDelta);
        let nearDeltaAngle = Number.isFinite(Number(deltas.nearDeltaAngle))
            ? unwrapDeltaNear(deltas.nearDeltaAngle, deltaAngle)
            : null;
        const snappedDelta = snappedArcDelta(deltaAngle);
        if (snappedDelta !== null) {
            const geometryDelta = snappedDelta - Math.sign(snappedDelta) * ARC_DELTA_SNAP_GEOMETRY_EPSILON;
            const geometryNearDelta = nearDeltaAngle === null
                ? geometryDelta
                : snappedDelta - Math.sign(snappedDelta) * ARC_DELTA_SNAP_GEOMETRY_EPSILON;
            pending = pendingTreadForArcDelta(pending, deltas, geometryDelta, geometryNearDelta);
            deltaAngle = snappedDelta;
            if (nearDeltaAngle !== null) nearDeltaAngle = snappedDelta;
        }
        const next = { ...pending, arcDeltaAngle: deltaAngle };
        if (nearDeltaAngle !== null) {
            next.arcNearDeltaAngle = nearDeltaAngle;
        }
        draft.pendingArcState = {
            treadIndex: draft.treads.length - 1,
            kind: deltas.kind,
            deltaAngle
        };
        return next;
    }

    _commitPendingTread() {
        const draft = this._activeDraft();
        if (!draft || !draft.started || draft.completed === true) return false;
        if (!draft.pendingTread) {
            if (this.lastWorldPoint) this._updatePendingTread(this.lastWorldPoint);
        }
        if (!draft.pendingTread) return false;
        const candidate = cloneTread(draft.pendingTread);
        if (draft.treads.some((tread) => treadLinesConflict(tread, candidate))) return false;
        draft.treads.push(candidate);
        draft.pendingTread = null;
        draft.pendingArcState = null;
        this.state.emitChange();
        return true;
    }

    _pickDraftTreadPoint(worldPoint, threshold) {
        const draft = this._activeDraft();
        if (!draft || !Array.isArray(draft.treads)) return null;
        let best = null;
        draft.treads.forEach((tread, treadIndex) => {
            ["left", "right"].forEach((pointKey) => {
                const point = tread[pointKey];
                const d = Math.hypot(Number(worldPoint.x) - Number(point.x), Number(worldPoint.y) - Number(point.y));
                if (d <= threshold && (!best || d < best.distance)) {
                    best = { treadIndex, pointKey, distance: d };
                }
            });
        });
        return best;
    }

    _moveDraftTreadPoint(worldPoint) {
        const draft = this._activeDraft();
        if (!draft || draft.completed !== true) return false;
        const index = Math.floor(Number(draft.selectedTreadIndex));
        const key = draft.selectedTreadPoint;
        if (!Number.isInteger(index) || index < 0 || index >= draft.treads.length || (key !== "left" && key !== "right")) return false;
        const previous = cloneTread(draft.treads[index]);
        const otherKey = key === "left" ? "right" : "left";
        const other = previous[otherKey];
        const vector = normalizeVector(Number(worldPoint.x) - Number(other.x), Number(worldPoint.y) - Number(other.y), "stair tread drag");
        const next = cloneTread(previous);
        next[key] = {
            x: Number(other.x) + vector.x * Number(draft.width),
            y: Number(other.y) + vector.y * Number(draft.width)
        };
        next.center = {
            x: (next.left.x + next.right.x) * 0.5,
            y: (next.left.y + next.right.y) * 0.5
        };
        next.angle = treadAngle(next);
        delete next.arcDeltaAngle;
        delete next.arcNearDeltaAngle;
        if (!this._draftTreadMoveIsLegal(draft, index, next)) return false;
        draft.treads[index] = next;
        if (draft.treads[index + 1]) {
            delete draft.treads[index + 1].arcDeltaAngle;
            delete draft.treads[index + 1].arcNearDeltaAngle;
        }
        this.state.emitChange();
        return true;
    }

    _moveDraftFinalPoint(worldPoint, options = {}) {
        const draft = this._activeDraft();
        if (!draft || draft.completed !== true || draft.ladder === true || !Array.isArray(draft.treads) || draft.treads.length < 2) return false;
        const index = draft.treads.length - 1;
        const previous = draft.treads[index - 1];
        const current = draft.treads[index];
        const pending = this._pendingTreadForPoint(draft, previous, worldPoint, options);
        if (!pending) return false;
        const metadataDraft = {
            ...draft,
            treads: draft.treads.slice(0, index),
            pendingArcState: null
        };
        const next = this._pendingTreadWithArcMetadata(metadataDraft, previous, pending, {
            referenceDeltaAngle: current.arcDeltaAngle
        });
        if (this._draftTreadReplacementHasConflicts(draft, index, next)) return false;
        draft.treads[index] = cloneTread(next);
        draft.pendingArcState = null;
        this.state.emitChange();
        return true;
    }

    _draftTreadReplacementHasConflicts(draft, movedIndex, movedTread) {
        const treads = draft.treads.map((tread, index) => index === movedIndex ? movedTread : tread);
        for (let i = 0; i < treads.length; i++) {
            for (let j = i + 1; j < treads.length; j++) {
                if (treadLinesConflict(treads[i], treads[j])) return true;
            }
        }
        return false;
    }

    _draftTreadMoveIsLegal(draft, movedIndex, movedTread) {
        const minWallDistance = Number(draft.width) * 0.5;
        const floorId = String(draft.floorId || "");
        const wallTooClose = [movedTread.left, movedTread.right].some((point) => {
            const hit = this.state.pickWallAt(point, minWallDistance);
            return hit && getFloorId(hit.floor) === floorId;
        });
        if (wallTooClose) return false;
        const treads = draft.treads.map((tread, index) => index === movedIndex ? movedTread : tread);
        for (let i = 0; i < treads.length; i++) {
            for (let j = i + 1; j < treads.length; j++) {
                if (treadLinesConflict(treads[i], treads[j])) return false;
            }
        }
        return true;
    }

    finish() {
        const draft = this._activeDraft();
        if (!draft || draft.started !== true) return;
        if (draft.placementError) throw new Error(draft.placementError);
        if (draft.completed !== true) {
            throw new Error("complete the stair path before finalizing it");
        }
        let createdStair = null;
        if (draft.ladder === true) {
            createdStair = this.state.addStairToFloor(draft.floorId, {
                treads: [
                    draft.treads[0],
                    draft.treads[0]
                ],
                ladder: true,
                footprint: draft.footprint,
                depth: LADDER_DEPTH,
                width: draft.width,
                direction: draft.direction,
                texturePath: draft.texturePath,
                treadTexturePath: draft.treadTexturePath,
                riserTexturePath: draft.riserTexturePath,
                height: draft.height,
                stepCount: draft.stepCount,
                riserDepth: draft.riserDepth
            });
        } else {
            if (!Array.isArray(draft.treads) || draft.treads.length < 2) {
                throw new Error("stair path requires at least two treads");
            }
            createdStair = this.state.addStairToFloor(draft.floorId, {
                treads: draft.treads,
                width: draft.width,
                direction: draft.direction,
                texturePath: draft.texturePath,
                treadTexturePath: draft.treadTexturePath,
                riserTexturePath: draft.riserTexturePath,
                height: draft.height,
                stepCount: draft.stepCount,
                riserDepth: draft.riserDepth
            });
        }
        this.state.draft = null;
        if (createdStair && createdStair.id !== undefined && typeof this.state.selectStair === "function") {
            this.state.selectStair(createdStair.floorId, createdStair.id);
        }
        this.state.emitChange();
    }

    cancel() {
        this.drag = null;
        this.state.draft = null;
        if (typeof this.state.setTool === "function") {
            this.state.setTool("select");
            return;
        }
        this.state.emitChange();
    }
}
