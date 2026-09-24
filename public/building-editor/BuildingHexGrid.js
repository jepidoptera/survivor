export const GAME_HEX_X_STEP = 0.866;
export const GAME_HEX_RADIUS = 1 / Math.sqrt(3);
export const ADJACENT_DIRECTIONS = [1, 3, 5, 7, 9, 11];

export function offsetToWorld(offsetCoord) {
    const x = Number(offsetCoord && offsetCoord.x) || 0;
    const y = Number(offsetCoord && offsetCoord.y) || 0;
    return {
        x: x * GAME_HEX_X_STEP,
        y: y + (x % 2 === 0 ? 0.5 : 0)
    };
}

export function worldToNearestHex(worldPoint) {
    if (!Number.isFinite(worldPoint && worldPoint.x) || !Number.isFinite(worldPoint && worldPoint.y)) {
        throw new Error("cannot resolve hex for non-finite world point");
    }
    const approxX = Math.round(worldPoint.x / GAME_HEX_X_STEP);
    const approxY = Math.round(worldPoint.y - (approxX % 2 === 0 ? 0.5 : 0));
    let best = null;
    let bestDist = Infinity;
    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            const xindex = approxX + dx;
            const yindex = approxY + dy;
            const center = offsetToWorld({ x: xindex, y: yindex });
            const dist = Math.hypot(center.x - worldPoint.x, center.y - worldPoint.y);
            if (dist < bestDist) {
                bestDist = dist;
                best = { xindex, yindex, center, distance: dist };
            }
        }
    }
    return best;
}

export function immediateNeighborOffset(xindex, direction) {
    const even = xindex % 2 === 0;
    const evenOffsets = {
        1: { x: -1, y: 0 },
        3: { x: 0, y: -1 },
        5: { x: 1, y: 0 },
        7: { x: 1, y: 1 },
        9: { x: 0, y: 1 },
        11: { x: -1, y: 1 }
    };
    const oddOffsets = {
        1: { x: -1, y: -1 },
        3: { x: 0, y: -1 },
        5: { x: 1, y: -1 },
        7: { x: 1, y: 0 },
        9: { x: 0, y: 1 },
        11: { x: -1, y: 0 }
    };
    const offset = (even ? evenOffsets : oddOffsets)[direction];
    if (!offset) {
        throw new Error(`unsupported adjacent hex direction: ${direction}`);
    }
    return offset;
}

export function hexAnchorCandidatesNear(worldPoint) {
    const nearest = worldToNearestHex(worldPoint);
    const candidatesByKey = new Map();
    const addCenter = (xindex, yindex) => {
        const center = offsetToWorld({ x: xindex, y: yindex });
        candidatesByKey.set(`node:${xindex},${yindex}`, {
            kind: "node",
            xindex,
            yindex,
            point: center
        });
    };
    const addMidpoint = (aX, aY, bX, bY, direction) => {
        const a = offsetToWorld({ x: aX, y: aY });
        const b = offsetToWorld({ x: bX, y: bY });
        const left = `${aX},${aY}`;
        const right = `${bX},${bY}`;
        const key = left < right ? `midpoint:${left}|${right}` : `midpoint:${right}|${left}`;
        candidatesByKey.set(key, {
            kind: "midpoint",
            a: { xindex: aX, yindex: aY },
            b: { xindex: bX, yindex: bY },
            direction,
            point: {
                x: (a.x + b.x) * 0.5,
                y: (a.y + b.y) * 0.5
            }
        });
    };

    for (let dx = -2; dx <= 2; dx++) {
        for (let dy = -2; dy <= 2; dy++) {
            const xindex = nearest.xindex + dx;
            const yindex = nearest.yindex + dy;
            addCenter(xindex, yindex);
            ADJACENT_DIRECTIONS.forEach((direction) => {
                const offset = immediateNeighborOffset(xindex, direction);
                addMidpoint(xindex, yindex, xindex + offset.x, yindex + offset.y, direction);
            });
        }
    }
    return Array.from(candidatesByKey.values());
}

export function nearestHexAnchor(worldPoint) {
    const candidates = hexAnchorCandidatesNear(worldPoint);
    let best = null;
    let bestDist = Infinity;
    candidates.forEach((candidate) => {
        const dist = Math.hypot(candidate.point.x - worldPoint.x, candidate.point.y - worldPoint.y);
        if (dist < bestDist) {
            bestDist = dist;
            best = { ...candidate, distance: dist };
        }
    });
    if (!best) {
        throw new Error("could not resolve nearest hex anchor");
    }
    return best;
}

export function snapToHexAnchor(worldPoint) {
    return nearestHexAnchor(worldPoint).point;
}

export function hexCorners(center) {
    const r = GAME_HEX_RADIUS;
    return [
        { x: center.x + r, y: center.y },
        { x: center.x + r / 2, y: center.y + 0.5 },
        { x: center.x - r / 2, y: center.y + 0.5 },
        { x: center.x - r, y: center.y },
        { x: center.x - r / 2, y: center.y - 0.5 },
        { x: center.x + r / 2, y: center.y - 0.5 }
    ];
}

export function visibleHexRange(topLeft, bottomRight, padding = 2) {
    const minX = Math.floor(topLeft.x / GAME_HEX_X_STEP) - padding;
    const maxX = Math.ceil(bottomRight.x / GAME_HEX_X_STEP) + padding;
    const minY = Math.floor(Math.min(topLeft.y, bottomRight.y)) - padding;
    const maxY = Math.ceil(Math.max(topLeft.y, bottomRight.y)) + padding;
    return { minX, maxX, minY, maxY };
}
