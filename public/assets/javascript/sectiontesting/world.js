import {
    HEX_DIRECTIONS,
    GAME_BLOCKER_PAIRS,
    GAME_DIRECTION_COSTS,
    addAxial,
    axialDistance,
    axialToEvenQOffset,
    coordFromSectionId,
    getGameNeighborOffsets,
    getBoundaryDirections,
    getEdgeCells,
    getGlobalCenterForSection,
    getSectionLocalCells,
    hashString,
    isBoundaryCell,
    localToGlobal,
    makeAxialKey,
    makeOffsetKey,
    neighborAxial,
    normalizeDirection,
    offsetToWorld,
    sectionIdFromCoord,
    seededRandom
} from "./geometry.js";

export class SectionAsset {
    constructor(sectionCoord, radius, options = {}) {
        this.sectionCoord = { q: Number(sectionCoord.q) || 0, r: Number(sectionCoord.r) || 0 };
        this.id = options.id || sectionIdFromCoord(this.sectionCoord);
        this.radius = Math.max(1, Math.floor(Number(radius)) || 1);
        this.neighbors = Array.isArray(options.neighbors)
            ? options.neighbors.slice(0, 6)
            : buildNeighborIds(this.sectionCoord);
        this.blockedLocalKeys = new Set(options.blockedLocalKeys || []);
        this.edgeCellsByDirection = new Map();
        this.sectionColor = options.sectionColor || buildSectionColor(this.id);
    }

    getEdgeCells(directionIndex) {
        const normalizedDirection = normalizeDirection(directionIndex);
        if (!this.edgeCellsByDirection.has(normalizedDirection)) {
            this.edgeCellsByDirection.set(normalizedDirection, getEdgeCells(this.radius, normalizedDirection));
        }
        return this.edgeCellsByDirection.get(normalizedDirection);
    }

    isBlockedLocal(localKey) {
        return this.blockedLocalKeys.has(localKey);
    }
}

export class WorldGraph {
    constructor(radius, options = {}) {
        this.radius = Math.max(1, Math.floor(Number(radius)) || 1);
        this.seedSalt = String(options.seedSalt || "default");
        this.assetsById = new Map();
        this.wallsById = new Map();
        this.nextWallId = 1;
    }

    setRadius(radius, options = {}) {
        this.radius = Math.max(1, Math.floor(Number(radius)) || 1);
        if (options.seedSalt !== undefined) {
            this.seedSalt = String(options.seedSalt || "default");
        }
        this.assetsById.clear();
    }

    getSectionAsset(sectionId) {
        const normalizedId = String(sectionId);
        if (!this.assetsById.has(normalizedId)) {
            const sectionCoord = coordFromSectionId(normalizedId);
            this.assetsById.set(normalizedId, createProceduralSectionAsset(sectionCoord, this.radius, this.seedSalt));
        }
        return this.assetsById.get(normalizedId);
    }

    addWall(startCell, endCell, options = {}) {
        if (!startCell || !endCell) return null;
        if (startCell.globalKey === endCell.globalKey) return null;

        const wall = {
            id: Number.isInteger(options.id) ? Number(options.id) : this.nextWallId++,
            startGlobalCoord: {
                q: startCell.globalCoord.q,
                r: startCell.globalCoord.r
            },
            endGlobalCoord: {
                q: endCell.globalCoord.q,
                r: endCell.globalCoord.r
            },
            startWorld: {
                x: Number(startCell.worldPosition.x) || 0,
                y: Number(startCell.worldPosition.y) || 0
            },
            endWorld: {
                x: Number(endCell.worldPosition.x) || 0,
                y: Number(endCell.worldPosition.y) || 0
            },
            thickness: Number.isFinite(options.thickness)
                ? Math.max(0.02, Number(options.thickness))
                : 0.1
        };
        this.wallsById.set(wall.id, wall);
        return wall;
    }

    clearWalls() {
        this.wallsById.clear();
    }

    getWalls() {
        return Array.from(this.wallsById.values());
    }
}

export class SectionInstance {
    constructor(asset) {
        this.asset = asset;
        this.id = asset.id;
        this.radius = asset.radius;
        this.sectionCoord = asset.sectionCoord;
        this.globalCenter = getGlobalCenterForSection(this.sectionCoord, this.radius);
        this.cellsByLocalKey = new Map();
        this.cellsByGlobalKey = new Map();
        this.cellsByOffsetKey = new Map();
        this.buildCells();
    }

    buildCells() {
        const localCells = getSectionLocalCells(this.radius);
        for (let i = 0; i < localCells.length; i++) {
            const localCell = localCells[i];
            const globalCoord = localToGlobal(this.sectionCoord, localCell, this.radius);
            const globalKey = makeAxialKey(globalCoord.q, globalCoord.r);
            const offsetCoord = axialToEvenQOffset(globalCoord);
            const offsetKey = makeOffsetKey(offsetCoord.x, offsetCoord.y);
            const cell = {
                sectionId: this.id,
                sectionCoord: this.sectionCoord,
                localCoord: { q: localCell.q, r: localCell.r },
                localKey: localCell.key,
                globalCoord,
                globalKey,
                offsetCoord,
                offsetKey,
                worldPosition: offsetToWorld(offsetCoord),
                blocked: this.asset.isBlockedLocal(localCell.key),
                isBoundary: isBoundaryCell(localCell, this.radius),
                boundaryDirections: getBoundaryDirections(localCell, this.radius)
            };
            this.cellsByLocalKey.set(cell.localKey, cell);
            this.cellsByGlobalKey.set(cell.globalKey, cell);
            this.cellsByOffsetKey.set(cell.offsetKey, cell);
        }
    }
}

export class CompositeMap {
    constructor(worldGraph, centerSectionId) {
        this.worldGraph = worldGraph;
        this.radius = worldGraph.radius;
        this.centerSectionId = centerSectionId;
        this.instancesById = new Map();
        this.globalCells = new Map();
        this.offsetCells = new Map();
        this.overlapWarnings = [];
        this.blockedDirectionsByCellKey = new Map();
        this.blockedLinks = [];
        this.loadBubble(centerSectionId);
    }

    loadBubble(centerSectionId) {
        this.centerSectionId = String(centerSectionId);
        this.radius = this.worldGraph.radius;
        this.instancesById.clear();
        this.globalCells.clear();
        this.offsetCells.clear();
        this.overlapWarnings.length = 0;
        this.blockedDirectionsByCellKey.clear();
        this.blockedLinks.length = 0;

        const centerAsset = this.worldGraph.getSectionAsset(this.centerSectionId);
        const sectionIds = [centerAsset.id, ...centerAsset.neighbors.filter(Boolean)];
        for (let i = 0; i < sectionIds.length; i++) {
            const asset = this.worldGraph.getSectionAsset(sectionIds[i]);
            const instance = new SectionInstance(asset);
            this.instancesById.set(asset.id, instance);
            for (const cell of instance.cellsByGlobalKey.values()) {
                if (this.globalCells.has(cell.globalKey)) {
                    this.overlapWarnings.push(cell.globalKey);
                    continue;
                }
                this.globalCells.set(cell.globalKey, cell);
                this.offsetCells.set(cell.offsetKey, cell);
            }
        }

        this.applyWallDirectionalBlocking();
    }

    forceRebuild() {
        this.loadBubble(this.centerSectionId);
    }

    getCenterInstance() {
        return this.instancesById.get(this.centerSectionId) || null;
    }

    getLoadedSectionIds() {
        return Array.from(this.instancesById.keys());
    }

    getCellByGlobalKey(globalKey) {
        return this.globalCells.get(globalKey) || null;
    }

    getCellAt(q, r) {
        return this.getCellByGlobalKey(makeAxialKey(q, r));
    }

    getCellByOffset(x, y) {
        return this.offsetCells.get(makeOffsetKey(x, y)) || null;
    }

    getNeighbors(cell, options = null) {
        if (!cell) return [];
        const opts = (options && typeof options === "object") ? options : {};
        const neighbors = [];
        const offsets = getGameNeighborOffsets(cell.offsetCoord.x);
        for (let directionIndex = 0; directionIndex < offsets.length; directionIndex++) {
            const offset = offsets[directionIndex];
            const nextCell = this.getCellByOffset(cell.offsetCoord.x + offset.x, cell.offsetCoord.y + offset.y);
            if (!nextCell) continue;
            if (opts.allowBlocked !== true && !this.canTraverse(cell, directionIndex)) continue;
            neighbors.push({
                directionIndex,
                cell: nextCell,
                crossesSection: nextCell.sectionId !== cell.sectionId
            });
        }
        return neighbors;
    }

    canTraverse(cell, directionIndex) {
        if (!cell) return false;
        const offsets = getGameNeighborOffsets(cell.offsetCoord.x);
        const offset = offsets[directionIndex];
        if (!offset) return false;
        if (this.isDirectionBlocked(cell, directionIndex)) return false;
        const nextCell = this.getCellByOffset(cell.offsetCoord.x + offset.x, cell.offsetCoord.y + offset.y);
        if (!nextCell || nextCell.blocked) return false;

        const blockerPair = GAME_BLOCKER_PAIRS[directionIndex];
        if (!blockerPair) return true;

        for (let i = 0; i < blockerPair.length; i++) {
            const flankDirection = blockerPair[i];
            const flankOffset = offsets[flankDirection];
            if (!flankOffset) continue;
            const flankCell = this.getCellByOffset(cell.offsetCoord.x + flankOffset.x, cell.offsetCoord.y + flankOffset.y);
            if (flankCell && flankCell.blocked) return false;
        }

        return true;
    }

    isDirectionBlocked(cell, directionIndex) {
        if (!cell) return false;
        const blockedDirections = this.blockedDirectionsByCellKey.get(cell.globalKey);
        return !!(blockedDirections && blockedDirections.has(directionIndex));
    }

    applyWallDirectionalBlocking() {
        this.blockedDirectionsByCellKey.clear();
        this.blockedLinks.length = 0;

        const walls = this.worldGraph.getWalls();
        if (walls.length === 0) return;

        for (const cell of this.globalCells.values()) {
            const offsets = getGameNeighborOffsets(cell.offsetCoord.x);
            for (let directionIndex = 0; directionIndex < offsets.length; directionIndex++) {
                const offset = offsets[directionIndex];
                const neighbor = this.getCellByOffset(cell.offsetCoord.x + offset.x, cell.offsetCoord.y + offset.y);
                if (!neighbor) continue;
                if (cell.globalKey >= neighbor.globalKey) continue;

                for (let wallIndex = 0; wallIndex < walls.length; wallIndex++) {
                    const wall = walls[wallIndex];
                    if (!connectionCrossesWallFaces(cell.worldPosition, neighbor.worldPosition, wall)) continue;
                    this.blockConnection(cell, neighbor, directionIndex, wall);
                    break;
                }
            }
        }
    }

    blockConnection(cellA, cellB, directionFromA, wall) {
        const directionFromB = findDirectionIndexBetween(cellB, cellA);
        if (!Number.isInteger(directionFromA) || !Number.isInteger(directionFromB)) return;

        addBlockedDirection(this.blockedDirectionsByCellKey, cellA.globalKey, directionFromA);
        addBlockedDirection(this.blockedDirectionsByCellKey, cellB.globalKey, directionFromB);
        this.blockedLinks.push({
            wallId: wall && wall.id,
            fromCell: cellA,
            toCell: cellB,
            fromDirection: directionFromA,
            toDirection: directionFromB
        });
    }

    findPath(startCell, goalCell) {
        if (!startCell || !goalCell) return null;
        if (startCell.globalKey === goalCell.globalKey) return [startCell];
        if (goalCell.blocked) return null;

        const openSet = new MinPriorityQueue();
        const cameFrom = new Map();
        const gScore = new Map();

        gScore.set(startCell.globalKey, 0);
        openSet.push(startCell, worldDistance(startCell, goalCell));

        while (!openSet.isEmpty()) {
            const current = openSet.pop();
            if (!current) break;
            if (current.globalKey === goalCell.globalKey) {
                return reconstructPath(cameFrom, current, this.globalCells);
            }

            const neighbors = this.getNeighbors(current);
            for (let i = 0; i < neighbors.length; i++) {
                const entry = neighbors[i];
                const neighbor = entry.cell;
                if (!neighbor || neighbor.blocked) continue;
                const currentG = gScore.has(current.globalKey) ? gScore.get(current.globalKey) : Infinity;
                const neighborG = gScore.has(neighbor.globalKey) ? gScore.get(neighbor.globalKey) : Infinity;
                const tentativeG = currentG + GAME_DIRECTION_COSTS[entry.directionIndex];
                if (tentativeG >= neighborG) continue;
                cameFrom.set(neighbor.globalKey, current.globalKey);
                gScore.set(neighbor.globalKey, tentativeG);
                const nextF = tentativeG + worldDistance(neighbor, goalCell);
                openSet.push(neighbor, nextF);
            }
        }

        return null;
    }

    getRandomOpenCell(preferredSectionId = null) {
        const cells = [];
        for (const cell of this.globalCells.values()) {
            if (cell.blocked) continue;
            if (preferredSectionId && cell.sectionId !== preferredSectionId) continue;
            cells.push(cell);
        }
        if (cells.length === 0) return null;
        return cells[Math.floor(Math.random() * cells.length)] || null;
    }
}

function reconstructPath(cameFrom, current, cellsByKey) {
    const path = [current];
    let walkKey = current.globalKey;
    while (cameFrom.has(walkKey)) {
        walkKey = cameFrom.get(walkKey);
        const previous = cellsByKey.get(walkKey);
        if (!previous) break;
        path.unshift(previous);
    }
    return path;
}

function worldDistance(a, b) {
    const ax = a && a.worldPosition ? Number(a.worldPosition.x) : 0;
    const ay = a && a.worldPosition ? Number(a.worldPosition.y) : 0;
    const bx = b && b.worldPosition ? Number(b.worldPosition.x) : 0;
    const by = b && b.worldPosition ? Number(b.worldPosition.y) : 0;
    return Math.hypot(bx - ax, by - ay);
}

function createProceduralSectionAsset(sectionCoord, radius, seedSalt = "default") {
    const id = sectionIdFromCoord(sectionCoord);
    const random = seededRandom(hashString(`${id}|${radius}|${seedSalt}`));
    const blockedLocalKeys = new Set();
    const localCells = getSectionLocalCells(radius);
    const safeRadius = Math.max(1, radius - 1);

    for (let i = 0; i < localCells.length; i++) {
        const localCell = localCells[i];
        const distanceFromCenter = axialDistance({ q: 0, r: 0 }, localCell);
        const boundary = isBoundaryCell(localCell, radius);
        const chance = boundary ? 0.08 : 0.18;
        if (distanceFromCenter <= 1) continue;
        if (random() < chance) {
            blockedLocalKeys.add(localCell.key);
        }
    }

    carveGuaranteedOpenPaths(blockedLocalKeys, radius, safeRadius);

    return new SectionAsset(sectionCoord, radius, {
        id,
        neighbors: buildNeighborIds(sectionCoord),
        blockedLocalKeys,
        sectionColor: buildSectionColor(id)
    });
}

function carveGuaranteedOpenPaths(blockedLocalKeys, radius, safeRadius) {
    const axisLines = [
        (step) => ({ q: step, r: 0 }),
        (step) => ({ q: step, r: -step }),
        (step) => ({ q: 0, r: step })
    ];

    for (let i = 0; i < axisLines.length; i++) {
        const makeCell = axisLines[i];
        for (let step = -(safeRadius - 1); step <= (safeRadius - 1); step++) {
            const localCoord = makeCell(step);
            blockedLocalKeys.delete(makeAxialKey(localCoord.q, localCoord.r));
        }
    }

    for (let directionIndex = 0; directionIndex < HEX_DIRECTIONS.length; directionIndex++) {
        const edgeCells = getEdgeCells(radius, directionIndex);
        const middle = edgeCells[Math.floor(edgeCells.length / 2)] || null;
        if (middle) blockedLocalKeys.delete(middle.key);
        const left = edgeCells[Math.max(0, Math.floor(edgeCells.length / 2) - 1)] || null;
        if (left) blockedLocalKeys.delete(left.key);
        const right = edgeCells[Math.min(edgeCells.length - 1, Math.floor(edgeCells.length / 2) + 1)] || null;
        if (right) blockedLocalKeys.delete(right.key);
    }
}

function buildNeighborIds(sectionCoord) {
    const ids = [];
    for (let directionIndex = 0; directionIndex < HEX_DIRECTIONS.length; directionIndex++) {
        const neighborCoord = addAxial(sectionCoord, HEX_DIRECTIONS[directionIndex]);
        ids.push(sectionIdFromCoord(neighborCoord));
    }
    return ids;
}

function buildSectionColor(sectionId) {
    const seed = hashString(sectionId);
    const hue = seed % 360;
    return {
        fill: `hsla(${hue}, 45%, 32%, 0.55)`,
        stroke: `hsla(${hue}, 62%, 74%, 0.82)`,
        banner: `hsla(${hue}, 72%, 68%, 0.9)`
    };
}

class MinPriorityQueue {
    constructor() {
        this.items = [];
    }

    push(value, priority) {
        this.items.push({ value, priority });
        this.bubbleUp(this.items.length - 1);
    }

    pop() {
        if (this.items.length === 0) return null;
        const top = this.items[0];
        const last = this.items.pop();
        if (this.items.length > 0 && last) {
            this.items[0] = last;
            this.sinkDown(0);
        }
        return top.value;
    }

    isEmpty() {
        return this.items.length === 0;
    }

    bubbleUp(index) {
        let currentIndex = index;
        while (currentIndex > 0) {
            const parentIndex = Math.floor((currentIndex - 1) / 2);
            if (this.items[parentIndex].priority <= this.items[currentIndex].priority) break;
            [this.items[parentIndex], this.items[currentIndex]] = [this.items[currentIndex], this.items[parentIndex]];
            currentIndex = parentIndex;
        }
    }

    sinkDown(index) {
        let currentIndex = index;
        const length = this.items.length;
        while (true) {
            const leftIndex = currentIndex * 2 + 1;
            const rightIndex = currentIndex * 2 + 2;
            let smallest = currentIndex;

            if (leftIndex < length && this.items[leftIndex].priority < this.items[smallest].priority) {
                smallest = leftIndex;
            }
            if (rightIndex < length && this.items[rightIndex].priority < this.items[smallest].priority) {
                smallest = rightIndex;
            }
            if (smallest === currentIndex) break;
            [this.items[currentIndex], this.items[smallest]] = [this.items[smallest], this.items[currentIndex]];
            currentIndex = smallest;
        }
    }
}

function addBlockedDirection(map, cellKey, directionIndex) {
    if (!map.has(cellKey)) {
        map.set(cellKey, new Set());
    }
    map.get(cellKey).add(directionIndex);
}

function findDirectionIndexBetween(fromCell, toCell) {
    if (!fromCell || !toCell) return null;
    const deltaX = toCell.offsetCoord.x - fromCell.offsetCoord.x;
    const deltaY = toCell.offsetCoord.y - fromCell.offsetCoord.y;
    const offsets = getGameNeighborOffsets(fromCell.offsetCoord.x);
    for (let i = 0; i < offsets.length; i++) {
        const offset = offsets[i];
        if (offset.x === deltaX && offset.y === deltaY) return i;
    }
    return null;
}

function connectionCrossesWallFaces(pointA, pointB, wall) {
    if (!pointA || !pointB || !wall || !wall.startWorld || !wall.endWorld) return false;

    const wallStart = wall.startWorld;
    const wallEnd = wall.endWorld;
    const wallDx = wallEnd.x - wallStart.x;
    const wallDy = wallEnd.y - wallStart.y;
    const wallLen = Math.hypot(wallDx, wallDy);
    const segLen = Math.hypot(pointB.x - pointA.x, pointB.y - pointA.y);
    if (!(wallLen > 1e-6) || !(segLen > 1e-6)) return false;

    const ux = wallDx / wallLen;
    const uy = wallDy / wallLen;
    const px = -uy;
    const py = ux;
    const halfThickness = Math.max(1e-6, (Number(wall.thickness) || 0.1) * 0.5);
    const extend = 0.501;

    const crossesFace = (sign) => {
        const offX = px * sign * halfThickness;
        const offY = py * sign * halfThickness;
        const faceStart = {
            x: wallStart.x + offX - ux * extend,
            y: wallStart.y + offY - uy * extend
        };
        const faceEnd = {
            x: wallEnd.x + offX + ux * extend,
            y: wallEnd.y + offY + uy * extend
        };
        return segmentsIntersect2D(faceStart, faceEnd, pointA, pointB, 1e-6);
    };

    return crossesFace(1) || crossesFace(-1);
}

function segmentsIntersect2D(a, b, c, d, epsilon = 1e-6) {
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const cdx = d.x - c.x;
    const cdy = d.y - c.y;
    const acx = c.x - a.x;
    const acy = c.y - a.y;
    const denom = (abx * cdy) - (aby * cdx);

    if (Math.abs(denom) <= epsilon) {
        return false;
    }

    const t = ((acx * cdy) - (acy * cdx)) / denom;
    const u = ((acx * aby) - (acy * abx)) / denom;
    return t >= -epsilon && t <= 1 + epsilon && u >= -epsilon && u <= 1 + epsilon;
}
