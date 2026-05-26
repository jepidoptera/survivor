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
