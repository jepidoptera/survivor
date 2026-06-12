import "../assets/javascript/shared/FloorPolygonEditingCore.js";
import { simplePolygonRingError } from "./BuildingGeometry.js";

const core = globalThis.FloorPolygonEditingCore;
if (!core) {
    throw new Error("building editor could not load FloorPolygonEditingCore");
}

let vertexCounter = 1;

function nextVertexId(prefix = "vertex", usedIds = new Set()) {
    let id = `${prefix}-${vertexCounter++}`;
    while (usedIds.has(id)) {
        id = `${prefix}-${vertexCounter++}`;
    }
    usedIds.add(id);
    return id;
}

function clonePointWithId(point, prefix = "vertex", usedIds = null) {
    const existingId = typeof point.id === "string" && point.id.length > 0 ? point.id : "";
    if (existingId && usedIds && usedIds.has(existingId)) {
        throw new Error(`duplicate floor polygon vertex id: ${existingId}`);
    }
    const id = existingId || nextVertexId(prefix, usedIds || new Set());
    if (usedIds) usedIds.add(id);
    return { id, x: Number(point.x), y: Number(point.y) };
}

function sameXY(a, b) {
    return Math.abs(Number(a && a.x) - Number(b && b.x)) <= 0.000001 &&
        Math.abs(Number(a && a.y) - Number(b && b.y)) <= 0.000001;
}

function reusableFloorVertices(floor) {
    const vertices = [];
    (Array.isArray(floor && floor.outerPolygon) ? floor.outerPolygon : []).forEach((point) => {
        if (point && typeof point.id === "string" && point.id.length > 0) {
            vertices.push(point);
        }
    });
    (Array.isArray(floor && floor.holes) ? floor.holes : []).forEach((ring) => {
        (Array.isArray(ring) ? ring : []).forEach((point) => {
            if (point && typeof point.id === "string" && point.id.length > 0) {
                vertices.push(point);
            }
        });
    });
    return vertices;
}

function cloneResultPointWithPreservedId(point, prefix, reusableVertices, usedIds) {
    const reusable = reusableVertices.find((candidate) => !usedIds.has(candidate.id) && sameXY(candidate, point));
    if (reusable) {
        return clonePointWithId({ ...point, id: reusable.id }, prefix, usedIds);
    }
    return clonePointWithId(point, prefix, usedIds);
}

function cloneRingWithIds(points, prefix = "vertex") {
    const usedIds = new Set();
    return core.normalizeRing(points).map((point, index) => clonePointWithId(points[index] || point, prefix, usedIds));
}

export function applyFloorPolygonEdit(floor, editPoints, operation) {
    if (!floor) throw new Error("cannot edit missing floor polygon");
    const result = core.applyEditToPolygon(floor.outerPolygon, floor.holes || [], editPoints, operation);
    const reusableVertices = reusableFloorVertices(floor);
    const usedIds = new Set();
    return {
        footprint: result.outer.map((point) => cloneResultPointWithPreservedId(point, "vertex", reusableVertices, usedIds)),
        holes: result.holes.map((ring) => ring.map((point) => cloneResultPointWithPreservedId(point, "hole-vertex", reusableVertices, usedIds)))
    };
}

export function getFloorRing(floor, ringKind = "outer", holeIndex = -1) {
    if (!floor) return null;
    if (ringKind === "outer") return Array.isArray(floor.outerPolygon) ? floor.outerPolygon : null;
    if (ringKind === "hole") {
        const holes = Array.isArray(floor.holes) ? floor.holes : [];
        const index = Math.floor(Number(holeIndex));
        return index >= 0 && index < holes.length ? holes[index] : null;
    }
    return null;
}

export function setFloorRing(floor, ringKind, holeIndex, points) {
    const ring = cloneRingWithIds(points, ringKind === "hole" ? "hole-vertex" : "vertex");
    const error = simplePolygonRingError(ring, "floor polygon ring");
    if (error) throw new Error(error);
    if (ringKind === "outer") {
        floor.outerPolygon = ring;
        return;
    }
    if (ringKind === "hole") {
        if (!Array.isArray(floor.holes)) floor.holes = [];
        const index = Math.floor(Number(holeIndex));
        if (index < 0 || index >= floor.holes.length) {
            throw new Error(`cannot update missing floor hole ring: ${holeIndex}`);
        }
        floor.holes[index] = ring;
        return;
    }
    throw new Error(`unknown floor ring kind: ${ringKind}`);
}

export function findRingVertexAtPoint(floor, point, threshold) {
    let best = null;
    ringsForFloor(floor).forEach((ring) => {
        ring.points.forEach((vertex, vertexIndex) => {
            const dist = Math.hypot(vertex.x - point.x, vertex.y - point.y);
            if (dist <= threshold && (!best || dist < best.distance)) {
                best = { ...ring, vertexIndex, vertex, distance: dist };
            }
        });
    });
    return best;
}

export function findRingEdgeAtPoint(floor, point, threshold) {
    let best = null;
    ringsForFloor(floor).forEach((ring) => {
        for (let index = 0; index < ring.points.length; index++) {
            const hit = core.closestSegmentInfo(point, ring.points[index], ring.points[(index + 1) % ring.points.length]);
            if (!hit) continue;
            const distance = Math.sqrt(hit.distanceSq);
            if (distance <= threshold && (!best || distance < best.distance)) {
                best = { ...ring, insertAfterIndex: index, t: hit.t, point: { x: hit.x, y: hit.y }, distance };
            }
        }
    });
    return best;
}

export function insertVertexOnRingEdge(ring, insertAfterIndex, point) {
    const usedIds = new Set();
    const next = ring.map((vertex) => clonePointWithId(vertex, "vertex", usedIds));
    if (next.length < 3) throw new Error("cannot insert vertex into invalid ring");
    const index = Math.max(0, Math.min(next.length, Math.floor(Number(insertAfterIndex)) + 1));
    next.splice(index, 0, clonePointWithId(point, "vertex", usedIds));
    return { ring: next, vertexIndex: index };
}

export function insertVertexNearSelectedNeighbor(ring, selectedIndex, point) {
    const usedIds = new Set();
    const next = ring.map((vertex) => clonePointWithId(vertex, "vertex", usedIds));
    if (next.length < 3) throw new Error("cannot insert vertex into invalid ring");
    const index = Math.floor(Number(selectedIndex));
    if (!Number.isInteger(index) || index < 0 || index >= next.length) {
        throw new Error("cannot insert vertex without a valid selected vertex");
    }
    const prevIndex = (index - 1 + next.length) % next.length;
    const nextIndex = (index + 1) % next.length;
    const prevDx = Number(point.x) - Number(next[prevIndex].x);
    const prevDy = Number(point.y) - Number(next[prevIndex].y);
    const nextDx = Number(point.x) - Number(next[nextIndex].x);
    const nextDy = Number(point.y) - Number(next[nextIndex].y);
    const insertIndex = (prevDx * prevDx + prevDy * prevDy) <= (nextDx * nextDx + nextDy * nextDy)
        ? index
        : index + 1;
    next.splice(insertIndex, 0, clonePointWithId(point, "vertex", usedIds));
    return { ring: next, vertexIndex: insertIndex };
}

export function ringsForFloor(floor) {
    const rings = [];
    if (floor && Array.isArray(floor.outerPolygon) && floor.outerPolygon.length >= 3) {
        rings.push({ ringKind: "outer", holeIndex: -1, points: floor.outerPolygon });
    }
    const holes = Array.isArray(floor && floor.holes) ? floor.holes : [];
    holes.forEach((points, holeIndex) => {
        if (Array.isArray(points) && points.length >= 3) {
            rings.push({ ringKind: "hole", holeIndex, points });
        }
    });
    return rings;
}
