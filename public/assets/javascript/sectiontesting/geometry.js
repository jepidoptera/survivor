export const HEX_DIRECTIONS = [
    { q: 1, r: 0 },
    { q: 1, r: -1 },
    { q: 0, r: -1 },
    { q: -1, r: 0 },
    { q: -1, r: 1 },
    { q: 0, r: 1 }
];

export const MOVE_KEYS = {
    w: 2,
    e: 1,
    d: 0,
    s: 5,
    a: 4,
    q: 3
};

export const GAME_ADJACENT_DIRECTIONS = [1, 3, 5, 7, 9, 11];

export const GAME_BLOCKER_PAIRS = [
    [11, 1],
    null,
    [1, 3],
    null,
    [3, 5],
    null,
    [5, 7],
    null,
    [7, 9],
    null,
    [9, 11],
    null
];

export const GAME_DIRECTION_COSTS = [
    Math.sqrt(3),
    1,
    Math.sqrt(3),
    1,
    Math.sqrt(3),
    1,
    Math.sqrt(3),
    1,
    Math.sqrt(3),
    1,
    Math.sqrt(3),
    1
];

const GAME_NEIGHBOR_OFFSETS_EVEN_Q = [
    { x: -2, y: 0 },
    { x: -1, y: 0 },
    { x: -1, y: -1 },
    { x: 0, y: -1 },
    { x: 1, y: -1 },
    { x: 1, y: 0 },
    { x: 2, y: 0 },
    { x: 1, y: 1 },
    { x: 1, y: 2 },
    { x: 0, y: 1 },
    { x: -1, y: 2 },
    { x: -1, y: 1 }
];

const GAME_NEIGHBOR_OFFSETS_ODD_Q = [
    { x: -2, y: 0 },
    { x: -1, y: -1 },
    { x: -1, y: -2 },
    { x: 0, y: -1 },
    { x: 1, y: -2 },
    { x: 1, y: -1 },
    { x: 2, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
    { x: -1, y: 1 },
    { x: -1, y: 0 }
];

export function makeAxialKey(q, r) {
    return `${q},${r}`;
}

export function parseAxialKey(key) {
    const [q, r] = String(key).split(",").map(Number);
    return { q, r };
}

export function addAxial(a, b) {
    return { q: a.q + b.q, r: a.r + b.r };
}

export function scaleAxial(a, scalar) {
    return { q: a.q * scalar, r: a.r * scalar };
}

export function neighborAxial(a, directionIndex) {
    const direction = HEX_DIRECTIONS[normalizeDirection(directionIndex)];
    return addAxial(a, direction);
}

export function axialDistance(a, b) {
    const dq = a.q - b.q;
    const dr = a.r - b.r;
    const ds = (-a.q - a.r) - (-b.q - b.r);
    return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(ds));
}

export function normalizeDirection(directionIndex) {
    return ((Math.round(Number(directionIndex)) % 6) + 6) % 6;
}

export function isWithinSectionRadius(q, r, radius) {
    const s = -q - r;
    const limit = Math.max(0, Math.floor(Number(radius)) - 1);
    return Math.max(Math.abs(q), Math.abs(r), Math.abs(s)) <= limit;
}

export function getSectionLocalCells(radius) {
    const limit = Math.max(0, Math.floor(Number(radius)) - 1);
    const cells = [];
    for (let q = -limit; q <= limit; q++) {
        for (let r = -limit; r <= limit; r++) {
            if (!isWithinSectionRadius(q, r, radius)) continue;
            cells.push({ q, r, key: makeAxialKey(q, r) });
        }
    }
    return cells;
}

export function getSectionStride(radius) {
    return Math.max(1, Math.floor(Number(radius)) * 2 - 1);
}

export function getSectionBasisVectors(radius) {
    const sectionRadius = Math.max(1, Math.floor(Number(radius)) || 1);
    return {
        qAxis: {
            q: getSectionStride(sectionRadius),
            r: -(sectionRadius - 1)
        },
        rAxis: {
            q: sectionRadius - 1,
            r: sectionRadius
        }
    };
}

export function getGlobalCenterForSection(sectionCoord, radius) {
    const basis = getSectionBasisVectors(radius);
    const q = Number(sectionCoord && sectionCoord.q) || 0;
    const r = Number(sectionCoord && sectionCoord.r) || 0;
    return {
        q: basis.qAxis.q * q + basis.rAxis.q * r,
        r: basis.qAxis.r * q + basis.rAxis.r * r
    };
}

export function localToGlobal(sectionCoord, localCoord, radius) {
    const center = getGlobalCenterForSection(sectionCoord, radius);
    return {
        q: center.q + localCoord.q,
        r: center.r + localCoord.r
    };
}

export function isBoundaryCell(localCoord, radius) {
    for (let directionIndex = 0; directionIndex < HEX_DIRECTIONS.length; directionIndex++) {
        const next = neighborAxial(localCoord, directionIndex);
        if (!isWithinSectionRadius(next.q, next.r, radius)) return true;
    }
    return false;
}

export function getBoundaryDirections(localCoord, radius) {
    const directions = [];
    for (let directionIndex = 0; directionIndex < HEX_DIRECTIONS.length; directionIndex++) {
        const next = neighborAxial(localCoord, directionIndex);
        if (!isWithinSectionRadius(next.q, next.r, radius)) {
            directions.push(directionIndex);
        }
    }
    return directions;
}

export function getEdgeCells(radius, directionIndex) {
    const normalizedDirection = normalizeDirection(directionIndex);
    const cells = getSectionLocalCells(radius).filter((cell) => {
        const next = neighborAxial(cell, normalizedDirection);
        return !isWithinSectionRadius(next.q, next.r, radius);
    });
    return cells.sort((a, b) => getEdgeSortValue(a, normalizedDirection) - getEdgeSortValue(b, normalizedDirection));
}

function getEdgeSortValue(cell, directionIndex) {
    switch (normalizeDirection(directionIndex)) {
        case 0:
        case 3:
            return cell.r * 1000 + cell.q;
        case 1:
        case 4:
            return cell.q * 1000 + cell.r;
        case 2:
        case 5:
        default:
            return (-cell.q - cell.r) * 1000 + cell.q;
    }
}

export function axialToPixel(coord, size) {
    const q = Number(coord && coord.q) || 0;
    const r = Number(coord && coord.r) || 0;
    return {
        x: size * Math.sqrt(3) * (q + r / 2),
        y: size * 1.5 * r
    };
}

export function pixelToAxial(x, y, size) {
    const q = ((Math.sqrt(3) / 3) * x - (1 / 3) * y) / size;
    const r = ((2 / 3) * y) / size;
    return axialRound({ q, r });
}

export function axialRound(frac) {
    let q = Math.round(frac.q);
    let r = Math.round(frac.r);
    let s = Math.round(-frac.q - frac.r);

    const qDiff = Math.abs(q - frac.q);
    const rDiff = Math.abs(r - frac.r);
    const sDiff = Math.abs(s + frac.q + frac.r);

    if (qDiff > rDiff && qDiff > sDiff) {
        q = -r - s;
    } else if (rDiff > sDiff) {
        r = -q - s;
    } else {
        s = -q - r;
    }

    return { q, r, s };
}

export function sectionIdFromCoord(sectionCoord) {
    return `section:${sectionCoord.q},${sectionCoord.r}`;
}

export function makeOffsetKey(x, y) {
    return `${x},${y}`;
}

export function axialToEvenQOffset(coord) {
    const q = Number(coord && coord.q) || 0;
    const r = Number(coord && coord.r) || 0;
    return {
        x: q,
        y: r + ((q + (q & 1)) / 2)
    };
}

export function evenQOffsetToAxial(offsetCoord) {
    const x = Number(offsetCoord && offsetCoord.x) || 0;
    const y = Number(offsetCoord && offsetCoord.y) || 0;
    return {
        q: x,
        r: y - ((x + (x & 1)) / 2)
    };
}

export function offsetToWorld(offsetCoord) {
    const x = Number(offsetCoord && offsetCoord.x) || 0;
    const y = Number(offsetCoord && offsetCoord.y) || 0;
    return {
        x: x * 0.866,
        y: y + (x % 2 === 0 ? 0.5 : 0)
    };
}

export function getGameNeighborOffsets(columnX) {
    return (Number(columnX) % 2 === 0)
        ? GAME_NEIGHBOR_OFFSETS_EVEN_Q
        : GAME_NEIGHBOR_OFFSETS_ODD_Q;
}

export function coordFromSectionId(sectionId) {
    const raw = String(sectionId || "").replace(/^section:/, "");
    return parseAxialKey(raw);
}

export function seededRandom(seed) {
    let state = seed >>> 0;
    return function nextRandom() {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 4294967296;
    };
}

export function hashString(value) {
    const text = String(value || "");
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}
