"use strict";

importScripts("/wizard-of-flatland/wallGeometry.js?v=wizard-of-flatland-1");

const WALL_STRIDE = 8;
const HEX_GRID_COL_STEP = 0.866;
const HEX_GRID_WIDTH = 1 / HEX_GRID_COL_STEP;
const HEX_GRID_HEIGHT = 1;
const PATH_NODE_LAYER_PADDING = 4;
const PATH_NODE_WALL_THICKNESS = 0.1;
const PATH_NODE_WALL_FACE_EXTEND = 0.501;
const MAZE_CHUNK_MIN_SIZE = 28;
const MAZE_CHUNK_MAX_SIZE = 72;
const MAZE_ROOM_EDGE_INSET_TILES = 2;
const MAZE_HALLWAY_GAP_WIDTH = 3.4;
const MAZE_OUTSIDE_DOOR_MIN_WIDTH = 1;
const MAZE_OUTSIDE_DOOR_MAX_WIDTH = 3;
const MAZE_SECTION_DIRECTIONS = [
    { q: 1, r: 0 },
    { q: 0, r: 1 },
    { q: -1, r: 1 },
    { q: -1, r: 0 },
    { q: 0, r: -1 },
    { q: 1, r: -1 }
];

self.postMessage({ type: "ready" });

self.addEventListener("message", (event) => {
    const message = event && event.data ? event.data : null;
    if (!message || message.type !== "build_maze_sections") return;
    try {
        const result = buildMazeSections(message);
        self.postMessage(result, [
            result.generatedWalls.buffer,
            result.allWalls.buffer,
            result.nodeLayer.nodes.buffer,
            result.nodeLayer.blockedEdges.buffer
        ]);
    } catch (error) {
        self.postMessage({
            type: "error",
            requestId: message.requestId,
            signature: message.signature,
            message: error && error.message ? error.message : String(error)
        });
    }
});

function buildMazeSections(message) {
    const options = normalizeMazeOptions(message.options);
    const keys = normalizeSectionKeys(message.keys);
    const generatedWallBuilder = createWallBufferBuilder();
    for (const key of keys) {
        const coord = parseMazeSectionKey(key);
        appendMazeSectionWalls(generatedWallBuilder, coord.q, coord.r, options);
    }
    const generatedWalls = finishWallBuffer(generatedWallBuilder);
    const manualWalls = normalizeWalls(message.manualWalls || [], "manual walls");
    const allWalls = concatWallBuffers(generatedWalls, manualWalls);
    const bounds = normalizeBounds(message.bounds);
    const targetRadius = finiteNumber(message.targetRadius, "targetRadius");
    const nodeLayer = buildPathfindingNodeLayer(allWalls, bounds, targetRadius);
    return {
        type: "maze_sections_result",
        requestId: message.requestId,
        signature: String(message.signature || ""),
        generatedWalls,
        allWalls,
        nodeLayer
    };
}

function normalizeMazeOptions(raw) {
    const options = raw && typeof raw === "object" ? raw : null;
    if (!options) throw new Error("Wizard of Flatland maze worker requires options");
    return {
        seed: String(options.seed || "hex-maze-1"),
        chunkSize: Math.max(MAZE_CHUNK_MIN_SIZE, Math.min(MAZE_CHUNK_MAX_SIZE, Math.round(finiteNumber(options.chunkSize, "chunkSize")))),
        roomScale: Math.max(0, Math.min(1, finiteNumber(options.roomScale, "roomScale"))),
        twistiness: Math.max(0, Math.min(1, finiteNumber(options.twistiness, "twistiness")))
    };
}

function normalizeSectionKeys(keys) {
    if (!Array.isArray(keys)) throw new Error("Wizard of Flatland maze worker requires section keys");
    return keys.map((key) => {
        const coord = parseMazeSectionKey(key);
        return mazeSectionKey(coord.q, coord.r);
    }).sort();
}

function normalizeBounds(bounds) {
    if (!bounds || typeof bounds !== "object") throw new Error("Wizard of Flatland maze worker requires path bounds");
    return {
        minX: finiteNumber(bounds.minX, "bounds.minX"),
        minY: finiteNumber(bounds.minY, "bounds.minY"),
        maxX: finiteNumber(bounds.maxX, "bounds.maxX"),
        maxY: finiteNumber(bounds.maxY, "bounds.maxY")
    };
}

function normalizeWalls(walls, label) {
    if (!(walls instanceof Float32Array)) throw new Error(`Wizard of Flatland maze worker ${label} must be a wall buffer`);
    if (walls.length % WALL_STRIDE !== 0) throw new Error(`Wizard of Flatland maze worker ${label} has an invalid wall stride`);
    for (let i = 0; i < walls.length; i += WALL_STRIDE) {
        validateWallSegment(walls[i], walls[i + 1], walls[i + 2], walls[i + 3]);
    }
    return walls.slice();
}

function finiteNumber(value, label) {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error(`${label} must be finite`);
    return number;
}

function hashString(value) {
    const text = String(value || "");
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

function seededRandom(seed) {
    let stateValue = seed >>> 0;
    return function nextRandom() {
        stateValue = (Math.imul(stateValue, 1664525) + 1013904223) >>> 0;
        return stateValue / 4294967296;
    };
}

function appendSegmentWall(walls, ax, ay, bx, by) {
    if (!isUsableWallSegment(ax, ay, bx, by)) return false;
    ensureWallBufferCapacity(walls, walls.length + WALL_STRIDE);
    walls.buffer[walls.length] = ax;
    walls.buffer[walls.length + 1] = ay;
    walls.buffer[walls.length + 2] = bx;
    walls.buffer[walls.length + 3] = by;
    walls.buffer[walls.length + 4] = 0;
    walls.buffer[walls.length + 5] = 0;
    walls.buffer[walls.length + 6] = 0;
    walls.buffer[walls.length + 7] = 0;
    walls.length += WALL_STRIDE;
    return true;
}

function createWallBufferBuilder() {
    return {
        buffer: new Float32Array(WALL_STRIDE * 64),
        length: 0
    };
}

function ensureWallBufferCapacity(walls, requiredLength) {
    if (walls.buffer.length >= requiredLength) return;
    let nextLength = walls.buffer.length;
    while (nextLength < requiredLength) nextLength *= 2;
    const next = new Float32Array(nextLength);
    next.set(walls.buffer.subarray(0, walls.length));
    walls.buffer = next;
}

function finishWallBuffer(walls) {
    return walls.buffer.slice(0, walls.length);
}

function concatWallBuffers(left, right) {
    const out = new Float32Array(left.length + right.length);
    out.set(left);
    out.set(right, left.length);
    return out;
}

function validateWallSegment(ax, ay, bx, by) {
    if (!Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(bx) || !Number.isFinite(by)) {
        throw new Error("Wizard of Flatland maze worker wall segment requires finite coordinates");
    }
    if (!isUsableWallSegment(ax, ay, bx, by)) {
        throw new Error("Wizard of Flatland maze worker wall segment requires separated endpoints");
    }
}

function isUsableWallSegment(ax, ay, bx, by) {
    return Math.hypot(bx - ax, by - ay) > 0.001;
}

function getMazeSectionRadius(options) {
    return Math.max(8, Number(options.chunkSize) * 0.5);
}

function mazeSectionKey(q, r) {
    return `${q},${r}`;
}

function parseMazeSectionKey(key) {
    const parts = String(key).split(",");
    const q = Number(parts[0]);
    const r = Number(parts[1]);
    if (!Number.isFinite(q) || !Number.isFinite(r)) throw new Error(`Wizard of Flatland maze section key is invalid: ${key}`);
    return { q, r };
}

function mazeSectionCenter(q, r, options) {
    const radius = getMazeSectionRadius(options);
    return {
        x: Math.sqrt(3) * radius * (q + r * 0.5),
        y: 1.5 * radius * r
    };
}

function appendMazeSectionWalls(walls, q, r, options) {
    const key = mazeSectionKey(q, r);
    const center = mazeSectionCenter(q, r, options);
    const sectionRadius = getMazeSectionRadius(options);
    const roomRadius = Math.max(5, sectionRadius - MAZE_ROOM_EDGE_INSET_TILES / Math.cos(Math.PI / 6));
    const room = {
        q,
        r,
        key,
        center,
        radius: roomRadius,
        corners: getHexCornersWorld(center.x, center.y, roomRadius)
    };
    const outgoingSides = getMazeSectionOutgoingSides(q, r, options);
    const incomingSides = getMazeSectionIncomingSides(q, r, options);
    const hallConnections = getMazeSectionHallConnections(q, r, outgoingSides, incomingSides, options);
    const outsideDoor = getMazeSectionOutsideDoor(q, r, options, new Set(hallConnections.keys()));

    appendMazeRoomWalls(walls, room, hallConnections, outsideDoor);
    for (const [side, connection] of hallConnections.entries()) {
        if (!connection) throw new Error(`Wizard of Flatland maze hallway ${key}:${side} is missing connection data`);
        appendMazeHalfHallwayToNeighbor(walls, room, side, connection, options);
    }
}

function getHexCornersWorld(cx, cy, radius) {
    const corners = [];
    for (let i = 0; i < 6; i++) {
        const angle = (-30 + i * 60) * Math.PI / 180;
        corners.push({
            x: cx + Math.cos(angle) * radius,
            y: cy + Math.sin(angle) * radius
        });
    }
    return corners;
}

function getMazeSectionOutgoingSides(q, r, options) {
    const sides = [];
    for (let side = 0; side < 6; side++) {
        if (isMazeSharedHallOpen(q, r, side, options)) sides.push(side);
    }
    return sides;
}

function getMazeSectionIncomingSides(q, r, options) {
    return [];
}

function getMazeSectionHallConnections(q, r, outgoingSides, incomingSides, options) {
    const connections = new Map();
    for (const side of outgoingSides) connections.set(side, getMazeSharedHallConnection(q, r, side, options, true));
    for (const side of incomingSides) connections.set(side, getMazeSharedHallConnection(q, r, side, options, true));
    return connections;
}

function getMazeSharedHallConnection(q, r, side, options, requireOpen = false) {
    const dir = MAZE_SECTION_DIRECTIONS[side];
    if (!dir) throw new Error("Wizard of Flatland maze hallway side is invalid");
    const neighborQ = q + dir.q;
    const neighborR = r + dir.r;
    const thisKey = mazeSectionKey(q, r);
    const neighborKey = mazeSectionKey(neighborQ, neighborR);
    const ordered = thisKey < neighborKey ? `${thisKey}|${neighborKey}` : `${neighborKey}|${thisKey}`;
    const random = seededRandom(hashString(`${options.seed}|hall-edge|${ordered}`));
    const edgeT = 0.28 + random() * 0.44;
    const open = isMazeSharedHallOpen(q, r, side, options);
    if (requireOpen && !open) throw new Error(`Wizard of Flatland maze hallway edge ${ordered} is not open`);
    return {
        side,
        edgeKey: ordered,
        open,
        t: thisKey < neighborKey ? edgeT : 1 - edgeT,
        width: MAZE_HALLWAY_GAP_WIDTH
    };
}

function isMazeSharedHallOpen(q, r, side, options) {
    const dir = MAZE_SECTION_DIRECTIONS[side];
    if (!dir) throw new Error("Wizard of Flatland maze hallway side is invalid");
    const thisKey = mazeSectionKey(q, r);
    const neighborKey = mazeSectionKey(q + dir.q, r + dir.r);
    const ordered = thisKey < neighborKey ? `${thisKey}|${neighborKey}` : `${neighborKey}|${thisKey}`;
    const random = seededRandom(hashString(`${options.seed}|hall-open|${ordered}`));
    return random() < 1 / 3;
}

function getMazeSectionOutsideDoor(q, r, options, hallSides) {
    const random = seededRandom(hashString(`${options.seed}|outside-door|${q},${r}`));
    const sideOptions = [0, 1, 2, 3, 4, 5]
        .filter((side) => !hallSides.has(side) && canMazeSectionOwnOutsideDoorSide(q, r, side));
    if (sideOptions.length === 0) return null;
    const side = sideOptions[Math.floor(random() * sideOptions.length)];
    return {
        side,
        t: 0.24 + random() * 0.52,
        width: MAZE_OUTSIDE_DOOR_MIN_WIDTH + random() * (MAZE_OUTSIDE_DOOR_MAX_WIDTH - MAZE_OUTSIDE_DOOR_MIN_WIDTH)
    };
}

function canMazeSectionOwnOutsideDoorSide(q, r, side) {
    const dir = MAZE_SECTION_DIRECTIONS[side];
    if (!dir) throw new Error("Wizard of Flatland maze outside door side is invalid");
    return mazeSectionKey(q, r) < mazeSectionKey(q + dir.q, r + dir.r);
}

function appendMazeRoomWalls(walls, room, hallConnections, outsideDoor) {
    for (let side = 0; side < 6; side++) {
        const a = room.corners[side];
        const b = room.corners[(side + 1) % 6];
        const connection = hallConnections.get(side);
        if (connection) {
            appendWallWithGap(walls, a, b, connection.t, connection.width);
            continue;
        }
        if (outsideDoor && outsideDoor.side === side) {
            appendWallWithGap(walls, a, b, outsideDoor.t, outsideDoor.width);
            appendOutsideDoorPosts(walls, a, b, outsideDoor.t, outsideDoor.width, side);
            continue;
        }
        appendSegmentWall(walls, a.x, a.y, b.x, b.y);
    }
}

function appendWallWithGap(walls, a, b, gapT, gapWidth) {
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (!(length > gapWidth + 0.5)) return;
    const halfT = Math.max(0.02, gapWidth / length * 0.5);
    const leftT = Math.max(0, gapT - halfT);
    const rightT = Math.min(1, gapT + halfT);
    if (leftT > 0.04) appendSegmentWall(walls, a.x, a.y, a.x + (b.x - a.x) * leftT, a.y + (b.y - a.y) * leftT);
    if (rightT < 0.96) appendSegmentWall(walls, a.x + (b.x - a.x) * rightT, a.y + (b.y - a.y) * rightT, b.x, b.y);
}

function appendOutsideDoorPosts(walls, a, b, gapT, gapWidth, side) {
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (!(length > gapWidth + 0.5)) return;
    const halfT = Math.max(0.02, gapWidth / length * 0.5);
    const leftT = Math.max(0, gapT - halfT);
    const rightT = Math.min(1, gapT + halfT);
    const normal = mazeSectionSideNormal(side);
    const postLength = (0.7 + gapWidth * 0.65) / 3;
    const halfPostLength = postLength * 0.5;
    const left = { x: a.x + (b.x - a.x) * leftT, y: a.y + (b.y - a.y) * leftT };
    const right = { x: a.x + (b.x - a.x) * rightT, y: a.y + (b.y - a.y) * rightT };
    appendSegmentWall(walls, left.x - normal.x * halfPostLength, left.y - normal.y * halfPostLength, left.x + normal.x * halfPostLength, left.y + normal.y * halfPostLength);
    appendSegmentWall(walls, right.x - normal.x * halfPostLength, right.y - normal.y * halfPostLength, right.x + normal.x * halfPostLength, right.y + normal.y * halfPostLength);
}

function appendMazeHalfHallwayToNeighbor(walls, room, side, connection, options) {
    const dir = MAZE_SECTION_DIRECTIONS[side];
    const neighborCenter = mazeSectionCenter(room.q + dir.q, room.r + dir.r, options);
    const dx = neighborCenter.x - room.center.x;
    const dy = neighborCenter.y - room.center.y;
    const length = Math.hypot(dx, dy);
    if (!(length > 0.001)) throw new Error("Wizard of Flatland maze hallway requires separated section centers");
    const neighborRoomRadius = Math.max(5, getMazeSectionRadius(options) - MAZE_ROOM_EDGE_INSET_TILES / Math.cos(Math.PI / 6));
    const startGap = getWallGapEndpoints(room.corners[side], room.corners[(side + 1) % 6], connection.t, connection.width);
    const neighborSide = (side + 3) % 6;
    const neighborCorners = getHexCornersWorld(neighborCenter.x, neighborCenter.y, neighborRoomRadius);
    const neighborConnection = getMazeSharedHallConnection(room.q + dir.q, room.r + dir.r, neighborSide, options, true);
    if (neighborConnection.edgeKey !== connection.edgeKey || Math.abs(neighborConnection.width - connection.width) > 0.000001) {
        throw new Error("Wizard of Flatland maze reciprocal hallway connection mismatch");
    }
    const neighborGap = getWallGapEndpoints(neighborCorners[neighborSide], neighborCorners[(neighborSide + 1) % 6], neighborConnection.t, neighborConnection.width);
    appendHalfHallwaySideWall(walls, startGap.left, neighborGap.right);
    appendHalfHallwaySideWall(walls, startGap.right, neighborGap.left);
}

function appendHalfHallwaySideWall(walls, start, end) {
    const middle = { x: (start.x + end.x) * 0.5, y: (start.y + end.y) * 0.5 };
    if (Math.hypot(middle.x - start.x, middle.y - start.y) <= 0.5) return;
    appendSegmentWall(walls, start.x, start.y, middle.x, middle.y);
}

function getWallGapEndpoints(a, b, gapT, gapWidth) {
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (!(length > gapWidth + 0.5)) throw new Error("Wizard of Flatland maze hallway gap requires a wall segment longer than the gap");
    const halfT = Math.max(0.02, gapWidth / length * 0.5);
    return {
        left: pointOnHexSide(a, b, Math.max(0, gapT - halfT)),
        right: pointOnHexSide(a, b, Math.min(1, gapT + halfT))
    };
}

function pointOnHexSide(a, b, t) {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function mazeSectionSideNormal(side) {
    const angle = side * Math.PI / 3;
    return { x: Math.cos(angle), y: Math.sin(angle) };
}

function buildPathfindingNodeLayer(walls, bounds, targetRadius) {
    const wallGeometry = getWallGeometryApi();
    const colStart = Math.floor(bounds.minX / HEX_GRID_COL_STEP) - PATH_NODE_LAYER_PADDING;
    const colEnd = Math.ceil(bounds.maxX / HEX_GRID_COL_STEP) + PATH_NODE_LAYER_PADDING;
    const rowStart = Math.floor(bounds.minY) - PATH_NODE_LAYER_PADDING;
    const rowEnd = Math.ceil(bounds.maxY) + PATH_NODE_LAYER_PADDING;
    const nodes = [];
    const nodeByKey = new Map();

    for (let col = colStart; col <= colEnd; col++) {
        for (let row = rowStart; row <= rowEnd; row++) {
            const node = createPathfindingNode(col, row, nodes.length);
            nodes.push(node);
            nodeByKey.set(node.key, node);
        }
    }

    for (const node of nodes) {
        const offsets = getPathfindingNeighborOffsets(node.xindex);
        for (let dir = 0; dir < 12; dir++) {
            const offset = offsets[dir];
            node.neighbors[dir] = nodeByKey.get(pathfindingNodeKey(node.xindex + offset.x, node.yindex + offset.y)) || null;
        }
    }

    const blockedEdges = [];
    const blockedKeys = new Set();
    for (let w = 0; w < walls.length; w += WALL_STRIDE) {
        const ax = walls[w];
        const ay = walls[w + 1];
        const bx = walls[w + 2];
        const by = walls[w + 3];
        const wallMinX = Math.min(ax, bx) - HEX_GRID_WIDTH;
        const wallMaxX = Math.max(ax, bx) + HEX_GRID_WIDTH;
        const wallMinY = Math.min(ay, by) - HEX_GRID_HEIGHT;
        const wallMaxY = Math.max(ay, by) + HEX_GRID_HEIGHT;
        for (const node of nodes) {
            if (node.x < wallMinX || node.x > wallMaxX || node.y < wallMinY || node.y > wallMaxY) continue;
            for (let dir = 0; dir < 12; dir++) {
                const neighbor = node.neighbors[dir];
                if (!neighbor) continue;
                const edgeKey = pathfindingEdgeKey(node, neighbor);
                if (blockedKeys.has(edgeKey)) continue;
                if (!wallGeometry.connectionCrossesWallFaces(
                    node,
                    neighbor,
                    { x: ax, y: ay },
                    { x: bx, y: by },
                    { thickness: PATH_NODE_WALL_THICKNESS, extend: PATH_NODE_WALL_FACE_EXTEND }
                )) {
                    continue;
                }
                blockedKeys.add(edgeKey);
                node.blockedNeighbors.add(dir);
                const reverseDir = neighbor.neighbors.indexOf(node);
                if (reverseDir >= 0) neighbor.blockedNeighbors.add(reverseDir);
                blockedEdges.push(node.index, neighbor.index, w / WALL_STRIDE);
            }
        }
    }

    const packedNodes = new Float32Array(nodes.length * 4);
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        node.blocked = !isPathfindingNodeTerrainPassable(node, walls, targetRadius);
        const base = i * 4;
        packedNodes[base] = node.xindex;
        packedNodes[base + 1] = node.yindex;
        packedNodes[base + 2] = node.blocked ? 1 : 0;
        packedNodes[base + 3] = 0;
    }

    return {
        pathCenterX: (bounds.minX + bounds.maxX) * 0.5,
        pathCenterY: (bounds.minY + bounds.maxY) * 0.5,
        nodes: packedNodes,
        blockedEdges: new Int32Array(blockedEdges)
    };
}

function getWallGeometryApi() {
    const api = self.WallGeometry;
    if (!api || typeof api.connectionCrossesWallFaces !== "function") {
        throw new Error("Wizard of Flatland maze worker requires WallGeometry.connectionCrossesWallFaces");
    }
    return api;
}

function createPathfindingNode(xindex, yindex, index) {
    return {
        x: xindex * HEX_GRID_COL_STEP,
        y: yindex + (isEvenGridColumn(xindex) ? 0.5 : 0),
        xindex,
        yindex,
        index,
        key: pathfindingNodeKey(xindex, yindex),
        neighbors: new Array(12).fill(null),
        blockedNeighbors: new Set()
    };
}

function getPathfindingNeighborOffsets(xindex) {
    if (isEvenGridColumn(xindex)) {
        return [
            { x: -2, y: 0 }, { x: -1, y: 0 }, { x: -1, y: -1 }, { x: 0, y: -1 },
            { x: 1, y: -1 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 },
            { x: 1, y: 2 }, { x: 0, y: 1 }, { x: -1, y: 2 }, { x: -1, y: 1 }
        ];
    }
    return [
        { x: -2, y: 0 }, { x: -1, y: -1 }, { x: -1, y: -2 }, { x: 0, y: -1 },
        { x: 1, y: -2 }, { x: 1, y: -1 }, { x: 2, y: 0 }, { x: 1, y: 0 },
        { x: 1, y: 1 }, { x: 0, y: 1 }, { x: -1, y: 1 }, { x: -1, y: 0 }
    ];
}

function isEvenGridColumn(col) {
    return Math.abs(col % 2) === 0;
}

function pathfindingNodeKey(xindex, yindex) {
    return `${xindex},${yindex}`;
}

function pathfindingEdgeKey(a, b) {
    return a.key <= b.key ? `${a.key}|${b.key}` : `${b.key}|${a.key}`;
}

function isPathfindingNodeTerrainPassable(node, walls, targetRadius) {
    if (!node || !Number.isFinite(node.x) || !Number.isFinite(node.y)) {
        throw new Error("Wizard of Flatland maze worker passability requires a finite node");
    }
    for (let i = 0; i < walls.length; i += WALL_STRIDE) {
        const distance = pointSegmentDistance(node.x, node.y, walls[i], walls[i + 1], walls[i + 2], walls[i + 3]);
        if (distance < targetRadius) return false;
    }
    return true;
}

function pointSegmentDistance(px, py, ax, ay, bx, by) {
    const t = Math.max(0, Math.min(1, pointProjectionParameter(px, py, ax, ay, bx, by)));
    const closestX = ax + (bx - ax) * t;
    const closestY = ay + (by - ay) * t;
    return Math.hypot(px - closestX, py - closestY);
}

function pointProjectionParameter(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    if (lenSq <= 0.000001) return 0;
    return ((px - ax) * dx + (py - ay) * dy) / lenSq;
}
