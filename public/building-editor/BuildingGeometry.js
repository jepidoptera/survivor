import { findFloor, getBuildingWalls, wallPoints } from "./BuildingModel.js";

export function polygonArea(points) {
    let area = 0;
    for (let index = 0; index < points.length; index++) {
        const current = points[index];
        const next = points[(index + 1) % points.length];
        area += current.x * next.y - next.x * current.y;
    }
    return area / 2;
}

const GEOMETRY_EPSILON = 0.000001;

function signedTriangleArea(a, b, c) {
    return (Number(b.x) - Number(a.x)) * (Number(c.y) - Number(a.y)) -
        (Number(b.y) - Number(a.y)) * (Number(c.x) - Number(a.x));
}

function pointsAlmostEqual(a, b, epsilon = GEOMETRY_EPSILON) {
    return Math.hypot(Number(a.x) - Number(b.x), Number(a.y) - Number(b.y)) <= epsilon;
}

function pointOnSegment(point, a, b, epsilon = GEOMETRY_EPSILON) {
    if (Math.abs(signedTriangleArea(a, b, point)) > epsilon) return false;
    return Number(point.x) >= Math.min(Number(a.x), Number(b.x)) - epsilon &&
        Number(point.x) <= Math.max(Number(a.x), Number(b.x)) + epsilon &&
        Number(point.y) >= Math.min(Number(a.y), Number(b.y)) - epsilon &&
        Number(point.y) <= Math.max(Number(a.y), Number(b.y)) + epsilon;
}

function segmentsIntersect(a, b, c, d, epsilon = GEOMETRY_EPSILON) {
    const abC = signedTriangleArea(a, b, c);
    const abD = signedTriangleArea(a, b, d);
    const cdA = signedTriangleArea(c, d, a);
    const cdB = signedTriangleArea(c, d, b);
    if (
        ((abC > epsilon && abD < -epsilon) || (abC < -epsilon && abD > epsilon)) &&
        ((cdA > epsilon && cdB < -epsilon) || (cdA < -epsilon && cdB > epsilon))
    ) {
        return true;
    }
    return pointOnSegment(c, a, b, epsilon) ||
        pointOnSegment(d, a, b, epsilon) ||
        pointOnSegment(a, c, d, epsilon) ||
        pointOnSegment(b, c, d, epsilon);
}

function firstRingIntersection(points) {
    for (let firstIndex = 0; firstIndex < points.length; firstIndex++) {
        const firstNext = (firstIndex + 1) % points.length;
        for (let secondIndex = firstIndex + 1; secondIndex < points.length; secondIndex++) {
            const secondNext = (secondIndex + 1) % points.length;
            if (
                firstIndex === secondIndex ||
                firstNext === secondIndex ||
                secondNext === firstIndex
            ) {
                continue;
            }
            if (segmentsIntersect(points[firstIndex], points[firstNext], points[secondIndex], points[secondNext])) {
                return { firstIndex, firstNext, secondIndex, secondNext };
            }
        }
    }
    return null;
}

function ringComplexity(points) {
    if (!Array.isArray(points) || points.length < 3) return 1000000;
    let score = Math.abs(polygonArea(points)) < GEOMETRY_EPSILON ? 100 : 0;
    for (let index = 0; index < points.length; index++) {
        const point = points[index];
        const next = points[(index + 1) % points.length];
        if (!Number.isFinite(Number(point && point.x)) || !Number.isFinite(Number(point && point.y))) score += 100000;
        if (pointsAlmostEqual(point, next)) score += 10;
    }
    for (let firstIndex = 0; firstIndex < points.length; firstIndex++) {
        const firstNext = (firstIndex + 1) % points.length;
        for (let secondIndex = firstIndex + 1; secondIndex < points.length; secondIndex++) {
            const secondNext = (secondIndex + 1) % points.length;
            if (
                firstIndex === secondIndex ||
                firstNext === secondIndex ||
                secondNext === firstIndex
            ) {
                continue;
            }
            if (segmentsIntersect(points[firstIndex], points[firstNext], points[secondIndex], points[secondNext])) score += 1;
        }
    }
    return score;
}

export function simplePolygonRingError(points, label = "polygon ring") {
    if (!Array.isArray(points) || points.length < 3) {
        return `${label} requires at least three vertices`;
    }
    for (let index = 0; index < points.length; index++) {
        const point = points[index];
        if (!Number.isFinite(Number(point && point.x)) || !Number.isFinite(Number(point && point.y))) {
            return `${label} vertex ${index} must have finite x/y`;
        }
        const next = points[(index + 1) % points.length];
        if (pointsAlmostEqual(point, next)) {
            return `${label} edge ${index} has coincident endpoints`;
        }
    }
    if (Math.abs(polygonArea(points)) < GEOMETRY_EPSILON) {
        return `${label} has zero area`;
    }
    const intersection = firstRingIntersection(points);
    if (intersection) return `${label} edge ${intersection.firstIndex} intersects edge ${intersection.secondIndex}`;
    return "";
}

export function repairSimplePolygonRing(points, label = "polygon ring") {
    let ring = (Array.isArray(points) ? points : [])
        .filter((point) => Number.isFinite(Number(point && point.x)) && Number.isFinite(Number(point && point.y)))
        .map((point) => ({ ...point, x: Number(point.x), y: Number(point.y) }));
    const maxIterations = Math.max(1, ring.length * ring.length);
    for (let iteration = 0; iteration < maxIterations; iteration++) {
        const error = simplePolygonRingError(ring, label);
        if (!error) return ring;
        if (ring.length <= 3) {
            throw new Error(`cannot repair ${label}: ${error}`);
        }
        let candidateIndexes = [];
        for (let index = 0; index < ring.length; index++) {
            if (pointsAlmostEqual(ring[index], ring[(index + 1) % ring.length])) {
                candidateIndexes = [(index + 1) % ring.length];
                break;
            }
        }
        if (candidateIndexes.length === 0) {
            const intersection = firstRingIntersection(ring);
            if (intersection) {
                candidateIndexes = [
                    intersection.firstIndex,
                    intersection.firstNext,
                    intersection.secondIndex,
                    intersection.secondNext
                ];
            }
        }
        if (candidateIndexes.length === 0) {
            throw new Error(`cannot repair ${label}: ${error}`);
        }
        const currentComplexity = ringComplexity(ring);
        const currentArea = Math.abs(polygonArea(ring));
        let best = null;
        [...new Set(candidateIndexes)].forEach((candidateIndex) => {
            const candidate = ring.filter((_point, index) => index !== candidateIndex);
            if (candidate.length < 3) return;
            const complexity = ringComplexity(candidate);
            const areaDelta = Math.abs(Math.abs(polygonArea(candidate)) - currentArea);
            if (
                !best ||
                complexity < best.complexity ||
                (complexity === best.complexity && areaDelta < best.areaDelta)
            ) {
                best = { ring: candidate, complexity, areaDelta };
            }
        });
        if (!best || best.complexity > currentComplexity) {
            throw new Error(`cannot repair ${label}: ${error}`);
        }
        ring = best.ring;
    }
    throw new Error(`cannot repair ${label}: exceeded repair iteration limit`);
}

export function polygonCentroid(points) {
    const area = polygonArea(points);
    if (Math.abs(area) < 0.000001) {
        const sum = points.reduce((acc, point) => ({
            x: acc.x + point.x,
            y: acc.y + point.y
        }), { x: 0, y: 0 });
        return { x: sum.x / points.length, y: sum.y / points.length };
    }
    let cx = 0;
    let cy = 0;
    for (let index = 0; index < points.length; index++) {
        const current = points[index];
        const next = points[(index + 1) % points.length];
        const cross = current.x * next.y - next.x * current.y;
        cx += (current.x + next.x) * cross;
        cy += (current.y + next.y) * cross;
    }
    return { x: cx / (6 * area), y: cy / (6 * area) };
}

export function pointInPolygon(point, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const pi = polygon[i];
        const pj = polygon[j];
        const intersects = ((pi.y > point.y) !== (pj.y > point.y)) &&
            (point.x < (pj.x - pi.x) * (point.y - pi.y) / (pj.y - pi.y) + pi.x);
        if (intersects) inside = !inside;
    }
    return inside;
}

export function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

export function distanceToSegment(point, a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) return distance(point, a);
    let t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared;
    t = Math.max(0, Math.min(1, t));
    const projection = { x: a.x + t * dx, y: a.y + t * dy };
    return distance(point, projection);
}

export function nearestFloorVertex(floor, point, threshold) {
    let best = null;
    const vertices = Array.isArray(floor && floor.outerPolygon) ? floor.outerPolygon : [];
    vertices.forEach((vertex, index) => {
        const d = distance(vertex, point);
        if (d <= threshold && (!best || d < best.distance)) {
            best = { floor, vertex, index, distance: d };
        }
    });
    return best;
}

export function nearestWall(building, point, threshold, includeWall = null) {
    let best = null;
    getBuildingWalls(building).forEach((wall) => {
        const points = wallPoints(building, wall);
        const floor = findFloor(building, wall.fragmentId || wall.floorId);
        if (!floor || points.length < 2) return;
        if (includeWall && !includeWall(wall, floor)) return;
        for (let index = 0; index < points.length - 1; index++) {
            const d = distanceToSegment(point, points[index], points[index + 1]);
            if (d <= threshold && (!best || d < best.distance)) {
                best = { floor, wall, segmentIndex: index, distance: d };
            }
        }
    });
    return best;
}

export function flattenPolygon(points) {
    return points.flatMap((point) => [point.x, point.y]);
}
