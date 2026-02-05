class Hitbox {
    constructor(type) {
        this.type = type;
    }

    containsPoint(x, y) {
        throw new Error('Hitbox.containsPoint() must be implemented by subclasses');
    }

    getBounds() {
        throw new Error('Hitbox.getBounds() must be implemented by subclasses');
    }
}

function getClosestPointOnSegment(px, py, ax, ay, bx, by) {
    // Vector AB
    const abx = bx - ax;
    const aby = by - ay;
    
    // Vector AP
    const apx = px - ax;
    const apy = py - ay;
    
    // Project AP onto AB (dot product) to find position "t"
    // t = 0 means we are at A, t = 1 means we are at B
    const lenSq = (abx * abx) + (aby * aby);
    const t = (apx * abx + apy * aby) / lenSq;
    
    // Clamp t to the segment [0, 1]
    const clampedT = Math.max(0, Math.min(1, t));
    
    // Return the closest point
    return {
        x: ax + clampedT * abx,
        y: ay + clampedT * aby
    };
}

function checkCircleVsPolygon(circle, polygon) {
    let closestX = 0;
    let closestY = 0;
    let minDistSq = Infinity;
    const polygonPoints = polygon.points;

    // Loop through every edge of the polygon
    for (let i = 0; i < polygonPoints.length; i++) {
        // Get the current vertex (A) and the next vertex (B)
        // The modulo (%) ensures the last point connects back to the first
        const a = polygonPoints[i];
        const b = polygonPoints[(i + 1) % polygonPoints.length];

        const point = getClosestPointOnSegment(circle.x, circle.y, a.x, a.y, b.x, b.y);

        // Check distance to this point
        const dx = circle.x - point.x;
        const dy = circle.y - point.y;
        const distSq = (dx * dx) + (dy * dy);

        // Keep the absolute closest point found so far
        if (distSq < minDistSq) {
            minDistSq = distSq;
            closestX = point.x;
            closestY = point.y;
        }
    }

    // Now we have the closest point on the ENTIRE perimeter.
    // Check if we are colliding.
    if (minDistSq < circle.radius * circle.radius) {
        // Calculate the push vector
        const dist = Math.sqrt(minDistSq);
        
        // Prevent divide by zero if circle center is exactly on the edge
        if (dist === 0) return { pushX: 0, pushY: 0 }; 

        const overlap = circle.radius - dist;
        
        // Normalize vector (Center - Closest)
        const nx = (circle.x - closestX) / dist;
        const ny = (circle.y - closestY) / dist;

        return {
            pushX: nx * overlap,
            pushY: ny * overlap
        };
    }

    return null; // No collision
}

function checkCircleVsCircle(circleA, circleB) {
    const dx = circleB.x - circleA.x;
    const dy = circleB.y - circleA.y;
    const radiiSum = circleA.radius + circleB.radius;
    const distSq = dx * dx + dy * dy;
    if (distSq < radiiSum * radiiSum) {
        const dist = Math.sqrt(distSq);
        const overlap = radiiSum - dist;

        // Prevent divide by zero if centers are exactly the same
        if (dist === 0) return { pushX: 0, pushY: 0 };

        // Normalize vector (A -> B)
        const nx = dx / dist;
        const ny = dy / dist;

        return {
            pushX: nx * overlap,
            pushY: ny * overlap
        };
    }
    return null;
}


class CircleHitbox extends Hitbox {
    constructor(x, y, radius) {
        super('circle');
        this.x = x;
        this.y = y;
        this.radius = radius;
    }

    containsPoint(x, y) {
        const dx = x - this.x;
        const dy = y - this.y;
        return (dx * dx + dy * dy) <= (this.radius * this.radius);
    }

    getBounds() {
        return {
            x: this.x - this.radius,
            y: this.y - this.radius,
            width: this.radius * 2,
            height: this.radius * 2
        };
    }

    intersects(otherHitbox) {
        if (otherHitbox.type === 'polygon') {
            return checkCircleVsPolygon(this, otherHitbox);
        }
        if (otherHitbox.type === 'circle') {
            const dx = otherHitbox.x - this.x;
            const dy = otherHitbox.y - this.y;
            const radiiSum = this.radius + otherHitbox.radius;
            const distSq = dx * dx + dy * dy;
            if (distSq < radiiSum * radiiSum) {
                const dist = Math.sqrt(distSq);
                const overlap = radiiSum - dist;

                // Prevent divide by zero if centers are exactly the same
                if (dist === 0) return { pushX: 0, pushY: 0 };

                // Normalize vector (Other - This)
                const nx = dx / dist;
                const ny = dy / dist;

                return {
                    pushX: nx * overlap,
                    pushY: ny * overlap
                };
            }
        }
        return null;
    }
}

class PolygonHitbox extends Hitbox {
    constructor(points) {
        super('polygon');
        this.points = Array.isArray(points) ? points : [];
    }

    containsPoint(x, y) {
        // Ray casting algorithm
        let inside = false;
        const pts = this.points;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
            const xi = pts[i].x;
            const yi = pts[i].y;
            const xj = pts[j].x;
            const yj = pts[j].y;

            const intersect = ((yi > y) !== (yj > y)) &&
                (x < (xj - xi) * (y - yi) / (yj - yi + 0.0000001) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    }

    getBounds() {
        if (!this.points.length) {
            return {x: 0, y: 0, width: 0, height: 0};
        }

        let minX = this.points[0].x;
        let minY = this.points[0].y;
        let maxX = this.points[0].x;
        let maxY = this.points[0].y;

        for (let i = 1; i < this.points.length; i++) {
            const p = this.points[i];
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.x > maxX) maxX = p.x;
            if (p.y > maxY) maxY = p.y;
        }

        return {
            x: minX,
            y: minY,
            width: maxX - minX,
            height: maxY - minY
        };
    }

    intersects(otherHitbox) {
        if (otherHitbox.type === 'circle') {
            return checkCircleVsPolygon(otherHitbox, this);
        }
        // Polygon-vs-polygon collision detection can be added here
        return null;
    }
}

window.Hitbox = Hitbox;
window.CircleHitbox = CircleHitbox;
window.PolygonHitbox = PolygonHitbox;
window.checkCircleVsPolygon = checkCircleVsPolygon;
window.checkCircleVsCircle = checkCircleVsCircle;
