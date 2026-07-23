"use strict";

importScripts("/wizard-of-flatland/wallGeometry.js?v=wizard-of-flatland-1");

const WALL_STRIDE = 8;
const WALL_LABEL_ROOM_BOUNDARY = 10;
const WALL_LABEL_ROOM_HALL_GAP = 11;
const WALL_LABEL_ROOM_OUTSIDE_DOOR_GAP = 12;
const WALL_LABEL_ROOM_POCKET_OVERRIDE = 13;
const WALL_LABEL_ROOM_POCKET_OVERRIDE_HALL_GAP = 14;
const WALL_LABEL_ROOM_POCKET_CONNECTOR = 15;
const WALL_LABEL_SQUARE_SIDE_PARALLEL = 20;
const WALL_LABEL_SQUARE_SIDE_PERPENDICULAR = 21;
const WALL_LABEL_SQUARE_SIDE_PERPENDICULAR_FULL = 22;
const WALL_LABEL_HALLWAY_SIDE_HALF = 30;
const WALL_LABEL_HALLWAY_SIDE_FULL = 31;
const HEX_GRID_COL_STEP = 0.866;
const HEX_GRID_WIDTH = 1 / HEX_GRID_COL_STEP;
const HEX_GRID_HEIGHT = 1;
const PATH_NODE_LAYER_PADDING = 4;
const WALL_WORLD_THICKNESS = 0.3;
const WALL_WORLD_HALF_THICKNESS = WALL_WORLD_THICKNESS * 0.5;
const PATH_NODE_WALL_THICKNESS = WALL_WORLD_THICKNESS;
const PATH_NODE_WALL_FACE_EXTEND = 0.501;
const PATH_SNAPSHOT_NODE_STRIDE = 8;
const PATH_SNAPSHOT_EDGE_STRIDE = 4;
const PATH_NODE_X = 0;
const PATH_NODE_Y = 1;
const PATH_NODE_BLOCKED = 2;
const PATH_NODE_CLEARANCE = 3;
const PATH_NODE_XINDEX = 4;
const PATH_NODE_YINDEX = 5;
const PATH_NODE_HAS_UNBLOCKED_NEIGHBOR = 6;
const PATH_EDGE_FROM = 0;
const PATH_EDGE_TO = 1;
const MAZE_CHUNK_MIN_SIZE = 28;
const MAZE_CHUNK_MAX_SIZE = 72;
const MAZE_ROOM_EDGE_INSET_TILES = 2;
const MAZE_DOOR_WIDTH = 3;
const MAZE_FULL_WALL_HALLWAY_CHANCE = 1 / 2;
const MAZE_OUTSIDE_DOOR_WIDE_WIDTH = 5;
const MAZE_OUTSIDE_DOOR_WIDE_CHANCE = 1 / 3;
const MAZE_OUTSIDE_DOOR_FULL_WALL_CHANCE = 1 / 3;
const MAZE_SQUARE_ROOM_SIDE_CHANCE = 1 / 10;
const MAZE_SQUARE_ROOM_OPPOSITE_SIDE_CHANCE = 2 / 3;
const MAZE_SQUARE_ROOM_SIDE_OFFSET = 4;
const MAZE_SQUARE_ROOM_SIDE_GAP_WIDTH = 4;
const MAZE_SQUARE_ROOM_WALL_END_SHORTEN = 2;
const MAZE_SQUARE_ROOM_HALLWAY_SNAP_DISTANCE = 3;
const MAZE_SQUARE_ROOM_POCKET_INCORPORATE_CHANCE = 0.4;
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
            result.nodeLayer.snapshotNodes.buffer,
            result.nodeLayer.edges.buffer,
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

function appendSegmentWall(walls, ax, ay, bx, by, labelCode, sideCode = -1) {
    if (!isUsableWallSegment(ax, ay, bx, by)) return false;
    validateWallLabelCode(labelCode, sideCode);
    ensureWallBufferCapacity(walls, walls.length + WALL_STRIDE);
    walls.buffer[walls.length] = ax;
    walls.buffer[walls.length + 1] = ay;
    walls.buffer[walls.length + 2] = bx;
    walls.buffer[walls.length + 3] = by;
    walls.buffer[walls.length + 4] = labelCode;
    walls.buffer[walls.length + 5] = sideCode;
    walls.buffer[walls.length + 6] = 0;
    walls.buffer[walls.length + 7] = 0;
    walls.length += WALL_STRIDE;
    return true;
}

function validateWallLabelCode(labelCode, sideCode) {
    if (!Number.isInteger(labelCode) || labelCode <= 0) {
        throw new Error("Wizard of Flatland maze wall segment requires a label code");
    }
    if (!Number.isInteger(sideCode)) {
        throw new Error("Wizard of Flatland maze wall segment requires a side code");
    }
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
    const room = buildMazeRoom(q, r, options);
    const startLength = walls.length;
    const outgoingSides = getMazeSectionOutgoingSides(q, r, options);
    const incomingSides = getMazeSectionIncomingSides(q, r, options);
    const hallConnections = getMazeSectionHallConnections(q, r, outgoingSides, incomingSides, options);
    const outsideDoor = getMazeSectionOutsideDoor(q, r, options, new Set(hallConnections.keys()));
    const incomingSquarePocketMutations = getMazeSectionIncomingSquarePocketMutations(room, options);

    appendMazeRoomWalls(walls, room, hallConnections, outsideDoor, incomingSquarePocketMutations);
    appendMazeSquareSideWalls(walls, room, hallConnections, options);
    for (const [side, connection] of hallConnections.entries()) {
        if (!connection) throw new Error(`Wizard of Flatland maze hallway ${key}:${side} is missing connection data`);
        if (isMazeHallwaySuppressedByIncomingSquarePocket(room, side, options)) continue;
        const squarePocketHallway = getMazeSquarePocketHallwayTarget(room, side, options);
        if (squarePocketHallway) {
            appendMazeHalfHallwayToSquarePocket(walls, room, side, connection, squarePocketHallway.pocket, options);
            continue;
        }
        appendMazeHalfHallwayToNeighbor(walls, room, side, connection, options);
    }
    validateMazeSectionNativeWalls(walls, startLength, room);
}

function buildMazeRoom(q, r, options) {
    const center = mazeSectionCenter(q, r, options);
    const sectionRadius = getMazeSectionRadius(options);
    const roomRadius = Math.max(5, sectionRadius - MAZE_ROOM_EDGE_INSET_TILES / Math.cos(Math.PI / 6));
    const hexRoomCorners = getHexCornersWorld(center.x, center.y, roomRadius);
    const squareSideCorners = getMazeSectionSquareSideCorners(q, r, options);
    return {
        q,
        r,
        key: mazeSectionKey(q, r),
        center,
        radius: roomRadius,
        sectionRadius,
        sectionCorners: getHexCornersWorld(center.x, center.y, sectionRadius),
        squareSideCorners,
        corners: getSquaredMazeRoomCorners(hexRoomCorners, squareSideCorners)
    };
}

function validateMazeSectionNativeWalls(walls, startLength, room) {
    if (!room || !Array.isArray(room.sectionCorners)) {
        throw new Error("Wizard of Flatland maze native wall validation requires section corners");
    }
    for (let i = startLength; i < walls.length; i += WALL_STRIDE) {
        const a = { x: walls.buffer[i], y: walls.buffer[i + 1] };
        const b = { x: walls.buffer[i + 2], y: walls.buffer[i + 3] };
        if (pointInOrOnMazeSectionPolygon(a, room.sectionCorners) && pointInOrOnMazeSectionPolygon(b, room.sectionCorners)) continue;
        throw new Error(
            `Wizard of Flatland maze wall ${i / WALL_STRIDE} for section ${room.key} extends outside its native section: `
                + `label=${walls.buffer[i + 4]} side=${walls.buffer[i + 5]} `
                + `(${a.x.toFixed(3)},${a.y.toFixed(3)}) -> (${b.x.toFixed(3)},${b.y.toFixed(3)})`
        );
    }
}

function pointInOrOnMazeSectionPolygon(point, polygon) {
    return pointInMazeSectionPolygon(point, polygon) || pointMazeSectionPolygonEdgeDistance(point, polygon) <= 0.001;
}

function pointInMazeSectionPolygon(point, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[i];
        const b = polygon[j];
        if (((a.y > point.y) !== (b.y > point.y))
            && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) {
            inside = !inside;
        }
    }
    return inside;
}

function pointMazeSectionPolygonEdgeDistance(point, polygon) {
    let best = Infinity;
    for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i];
        const b = polygon[(i + 1) % polygon.length];
        best = Math.min(best, pointSegmentDistance(point.x, point.y, a.x, a.y, b.x, b.y));
    }
    return best;
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

function getMazeSectionSquareSideCorners(q, r, options) {
    const selected = [];
    const selectedSet = new Set();
    const random = seededRandom(hashString(`${options.seed}|square-room-sides|${q},${r}`));
    const startSide = Math.floor(random() * 6);
    for (let step = 0; step < 6; step++) {
        const cornerIndex = (startSide + step) % 6;
        if (selectedSet.has(cornerIndex)) continue;
        if (random() >= MAZE_SQUARE_ROOM_SIDE_CHANCE) continue;
        addMazeSquareSideCorner(selected, selectedSet, cornerIndex);
        const oppositeCornerIndex = (cornerIndex + 3) % 6;
        if (random() < MAZE_SQUARE_ROOM_OPPOSITE_SIDE_CHANCE) {
            addMazeSquareSideCorner(selected, selectedSet, oppositeCornerIndex);
        }
        break;
    }
    return selected;
}

function addMazeSquareSideCorner(selected, selectedSet, cornerIndex) {
    if (selectedSet.has(cornerIndex)) return;
    selectedSet.add(cornerIndex);
    selected.push(cornerIndex);
}

function getSquaredMazeRoomCorners(corners, squareSideCorners) {
    const out = corners.map((corner) => ({ x: corner.x, y: corner.y }));
    for (const cornerIndex of squareSideCorners) {
        // A squared room vertex is projected onto the line between its two
        // neighboring room vertices. That middle point becomes the passthrough
        // vertex on the squared side.
        out[cornerIndex] = projectPointToLine(
            corners[cornerIndex],
            corners[(cornerIndex + 5) % 6],
            corners[(cornerIndex + 1) % 6]
        );
    }
    return out;
}

function projectPointToLine(point, lineA, lineB) {
    const t = pointProjectionParameter(point.x, point.y, lineA.x, lineA.y, lineB.x, lineB.y);
    if (!Number.isFinite(t)) throw new Error("Wizard of Flatland maze square side projection failed");
    return pointOnHexSide(lineA, lineB, t);
}

function shouldMazeSquarePocketIncorporate(q, r, cornerIndex, pocketSide, options) {
    const chance = getMazeSquarePocketIncorporateChance(options);
    const random = seededRandom(hashString(`${options.seed}|square-pocket-incorporate|${q},${r}|${cornerIndex}|${pocketSide}`));
    return random() < chance;
}

function getMazeSquarePocketIncorporateChance(options) {
    const configured = Number(options.squarePocketIncorporateChance);
    if (Number.isFinite(configured)) return Math.max(0, Math.min(1, configured));
    return MAZE_SQUARE_ROOM_POCKET_INCORPORATE_CHANCE;
}

function getMazeSectionIncomingSquarePocketMutations(room, options) {
    const mutations = [];
    for (let side = 0; side < 6; side++) {
        const mutation = getMazeSectionIncomingSquarePocketMutation(room, side, options);
        if (!mutation) continue;
        mutations.push(mutation);
    }
    return clearCrossingMazeSquarePocketAdjacentConnectorBridges(mutations);
}

function getMazeSectionIncomingSquarePocketMutation(room, side, options) {
    const dir = MAZE_SECTION_DIRECTIONS[side];
    if (!dir) throw new Error("Wizard of Flatland maze square pocket incoming side is invalid");
    const neighborRoom = buildMazeRoom(room.q + dir.q, room.r + dir.r, options);
    const neighborSide = (side + 3) % 6;
    const candidateCorners = [neighborSide, (neighborSide + 1) % 6];
    for (const cornerIndex of candidateCorners) {
        if (!neighborRoom.squareSideCorners.includes(cornerIndex)) continue;
        const pocketSides = getMazeSquarePocketSides(cornerIndex);
        if (!pocketSides.includes(neighborSide)) continue;
        if (!canMazeSquarePocketConnectToSide(room, side)) continue;
        const mutation = getMazeSquarePocketIncorporationMutation(neighborRoom, cornerIndex, neighborSide, room, side, options);
        if (mutation) return withMazeSquarePocketAdjacentConnectorConnection(room, mutation, options);
    }
    return null;
}

function getMazeSquarePocketIncorporationMutation(sourceRoom, cornerIndex, pocketSide, targetRoom, targetSide, options) {
    if (!canMazeSquarePocketConnectToSide(targetRoom, targetSide)) return null;
    if (!shouldMazeSquarePocketIncorporate(sourceRoom.q, sourceRoom.r, cornerIndex, pocketSide, options)) return null;
    const pocket = getMazeSquarePocketGeometry(sourceRoom, cornerIndex, pocketSide);
    return buildMazeSquarePocketMutation(targetRoom, targetSide, pocket);
}

function isMazeSquarePocketIncorporatedByNeighbor(room, cornerIndex, pocketSide, options) {
    if (!shouldMazeSquarePocketIncorporate(room.q, room.r, cornerIndex, pocketSide, options)) return false;
    const dir = MAZE_SECTION_DIRECTIONS[pocketSide];
    if (!dir) throw new Error("Wizard of Flatland maze square pocket incorporation side is invalid");
    const neighborRoom = buildMazeRoom(room.q + dir.q, room.r + dir.r, options);
    const neighborSide = (pocketSide + 3) % 6;
    if (!canMazeSquarePocketConnectToSide(neighborRoom, neighborSide)) return false;
    const pocket = getMazeSquarePocketGeometry(room, cornerIndex, pocketSide);
    return !!buildMazeSquarePocketMutation(neighborRoom, neighborSide, pocket);
}

function isMazeHallwaySuppressedByIncomingSquarePocket(room, side, options) {
    return !!getMazeSectionIncomingSquarePocketMutation(room, side, options);
}

function getMazeSquarePocketHallwayTarget(room, side, options) {
    for (const cornerIndex of room.squareSideCorners) {
        const pocketSides = getMazeSquarePocketSides(cornerIndex);
        if (!pocketSides.includes(side)) continue;
        if (!isMazeSquarePocketIncorporatedByNeighbor(room, cornerIndex, side, options)) continue;
        return {
            cornerIndex,
            pocket: getMazeSquarePocketGeometry(room, cornerIndex, side)
        };
    }
    return null;
}

function getMazeSquarePocketSides(cornerIndex) {
    return [(cornerIndex + 5) % 6, cornerIndex];
}

function canMazeSquarePocketConnectToSide(room, side) {
    if (!room || !Array.isArray(room.squareSideCorners)) {
        throw new Error("Wizard of Flatland maze square pocket side check requires room square-side data");
    }
    if (!Number.isInteger(side)) {
        throw new Error("Wizard of Flatland maze square pocket side check requires an integer side");
    }
    return !isMazeRoomSideSquaredOff(room, side);
}

function isMazeRoomSideSquaredOff(room, side) {
    if (!room || !Array.isArray(room.squareSideCorners)) {
        throw new Error("Wizard of Flatland maze squared-off side check requires room square-side data");
    }
    if (!Number.isInteger(side)) {
        throw new Error("Wizard of Flatland maze squared-off side check requires an integer side");
    }
    const normalizedSide = ((side % 6) + 6) % 6;
    return room.squareSideCorners.includes(normalizedSide)
        || room.squareSideCorners.includes((normalizedSide + 1) % 6);
}

function getMazeSquarePocketGeometry(room, cornerIndex, pocketSide) {
    const originalCorner = getHexCornersWorld(room.center.x, room.center.y, room.radius)[cornerIndex];
    const squaredCorner = room.corners[cornerIndex];
    const sideStart = room.corners[(cornerIndex + 5) % 6];
    const sideEnd = room.corners[(cornerIndex + 1) % 6];
    const sideVector = normalizeVector(sideEnd.x - sideStart.x, sideEnd.y - sideStart.y, "Wizard of Flatland maze square pocket requires a valid side vector");
    const outward = normalizeVector(originalCorner.x - squaredCorner.x, originalCorner.y - squaredCorner.y, "Wizard of Flatland maze square pocket requires an outward direction");
    const wallCenter = {
        x: squaredCorner.x + outward.x * MAZE_SQUARE_ROOM_SIDE_OFFSET,
        y: squaredCorner.y + outward.y * MAZE_SQUARE_ROOM_SIDE_OFFSET
    };
    const endpointSign = pocketSide === (cornerIndex + 5) % 6 ? -1 : 1;
    const cornerWalls = [
        getMazeSquarePocketCornerWall(room, wallCenter, sideVector, outward, -1),
        getMazeSquarePocketCornerWall(room, wallCenter, sideVector, outward, 1)
    ];
    const selectedCornerWall = endpointSign < 0 ? cornerWalls[0] : cornerWalls[1];
    // Each corner pocket has two endpoints on the generated back-wall line:
    // the selected side end and the opposite forward end. The side end is the
    // start of the pocket front wall.
    return {
        sourceRoomKey: room.key,
        cornerIndex,
        pocketSide,
        sideVector,
        outward,
        wallCenter,
        gapEndpoint: selectedCornerWall.gapEndpoint,
        boundaryEnd: selectedCornerWall.boundaryEnd,
        cornerWalls
    };
}

function getMazeSquarePocketCornerWall(room, wallCenter, sideVector, outward, endpointSign) {
    // This is one possible corner-pocket front wall: side/forward end ->
    // section boundary.
    const gapEndpoint = pointOnLine(wallCenter, sideVector, endpointSign * MAZE_SQUARE_ROOM_SIDE_GAP_WIDTH * 0.5);
    const boundary = intersectRayWithPolygon(gapEndpoint, outward, room.sectionCorners, "Wizard of Flatland maze square pocket corner wall");
    return {
        endpointSign,
        gapEndpoint,
        boundaryEnd: boundary.end
    };
}

function buildMazeSquarePocketMutation(room, side, pocket) {
    const previousSide = (side + 5) % 6;
    const nextSide = (side + 1) % 6;
    const previous = {
        side: previousSide,
        far: room.corners[previousSide],
        shared: room.corners[side]
    };
    const next = {
        side: nextSide,
        far: room.corners[(nextSide + 1) % 6],
        shared: room.corners[(side + 1) % 6]
    };
    const candidates = [
        getMazeSquarePocketMutationWallCandidate(previous, next, pocket),
        getMazeSquarePocketMutationWallCandidate(next, previous, pocket)
    ].filter((candidate) => candidate.trimHit);
    if (candidates.length === 0) {
        throw new Error(`Wizard of Flatland maze square pocket ${pocket.sourceRoomKey}:${pocket.pocketSide} cannot trim either neighbor wall`);
    }
    candidates.sort((a, b) => a.extendColinear - b.extendColinear);
    const { extend, trim, trimHit, extendHit } = candidates[0];
    const boundaryEnds = getMazeSquarePocketMutationBoundaryEnds(extend, pocket);
    // The trim point is the incorporated corner pocket's inside corner. The
    // connector endpoint lies on the pocket front wall; when possible it is the
    // theoretical crossing with the neighbor room side being extended.
    const connectorBoundaryEnd = extendHit ? extendHit.point : boundaryEnds.connectorBoundaryEnd;
    if (!connectorBoundaryEnd) {
        throw new Error(`Wizard of Flatland maze square pocket ${pocket.sourceRoomKey}:${pocket.pocketSide} cannot find a connector endpoint`);
    }
    const extendConnection = getMazeSquarePocketExtendFrontWallConnection(extend.far, connectorBoundaryEnd, pocket);
    const trimConnection = getMazeSquarePocketTrimFrontWallConnection(trim.far, trimHit.point, pocket);
    const connectorConnection = getMazeSquarePocketConnectorFrontWallConnection(trimHit.point, connectorBoundaryEnd, pocket, room.sectionCorners);
    return {
        side,
        suppressSide: side,
        extendSide: extend.side,
        trimSide: trim.side,
        extendFrom: extend.far,
        trimFrom: trim.far,
        trimPoint: trimHit.point,
        boundaryEnd: boundaryEnds.extendBoundaryEnd,
        extendBoundaryEnd: boundaryEnds.extendBoundaryEnd,
        extendStopPoint: extendConnection ? extendConnection.stopPoint : null,
        extendConnectorBoundaryEnd: extendConnection ? extendConnection.boundaryEnd : null,
        trimStopPoint: trimConnection ? trimConnection.stopPoint : null,
        trimConnectorBoundaryEnd: trimConnection ? trimConnection.boundaryEnd : null,
        connectorStopPoint: connectorConnection ? connectorConnection.stopPoint : null,
        connectorBridgeBoundaryEnd: connectorConnection ? connectorConnection.boundaryEnd : null,
        connectorStopT: connectorConnection ? connectorConnection.t : null,
        connectorBoundaryEnd
    };
}

function getMazeSquarePocketMutationWallCandidate(extend, trim, pocket) {
    const trimHit = intersectLineWithSegment(pocket.wallCenter, pocket.sideVector, trim.far, trim.shared)
        || intersectLineWithInfiniteLine(pocket.wallCenter, pocket.sideVector, trim.far, trim.shared);
    const extendHit = intersectLineWithSegment(pocket.wallCenter, pocket.sideVector, extend.far, extend.shared)
        || intersectLineWithInfiniteLine(pocket.wallCenter, pocket.sideVector, extend.far, extend.shared);
    return {
        extend,
        trim,
        trimHit,
        extendHit,
        extendColinear: getMazeSquarePocketWallColinearity(extend, pocket.outward)
    };
}

function getMazeSquarePocketMutationBoundaryEnds(extendWall, pocket) {
    if (!Array.isArray(pocket.cornerWalls) || pocket.cornerWalls.length !== 2) {
        return {
            extendBoundaryEnd: pocket.boundaryEnd,
            extendCornerWall: null,
            connectorCornerWall: null,
            connectorBoundaryEnd: pocket.boundaryEnd
        };
    }
    const firstDistance = lineDistanceToPoint(extendWall.far, extendWall.shared, pocket.cornerWalls[0].gapEndpoint);
    const secondDistance = lineDistanceToPoint(extendWall.far, extendWall.shared, pocket.cornerWalls[1].gapEndpoint);
    const extendCornerWall = firstDistance <= secondDistance ? pocket.cornerWalls[0] : pocket.cornerWalls[1];
    const connectorCornerWall = firstDistance <= secondDistance ? pocket.cornerWalls[1] : pocket.cornerWalls[0];
    return {
        extendBoundaryEnd: extendCornerWall.boundaryEnd,
        extendCornerWall,
        connectorCornerWall,
        connectorBoundaryEnd: connectorCornerWall.boundaryEnd
    };
}

function getMazeSquarePocketExtendFrontWallConnection(extendFrom, extendToward, pocket) {
    if (!Array.isArray(pocket.cornerWalls) || pocket.cornerWalls.length !== 2) return null;
    const direction = normalizeVector(
        extendToward.x - extendFrom.x,
        extendToward.y - extendFrom.y,
        "Wizard of Flatland maze square pocket extend connector requires an extend direction"
    );
    const connections = [];
    for (const frontWall of pocket.cornerWalls) {
        const hit = intersectLineWithInfiniteLine(extendFrom, direction, frontWall.gapEndpoint, frontWall.boundaryEnd);
        if (!hit) continue;
        const extendT = pointProjectionParameter(hit.point.x, hit.point.y, extendFrom.x, extendFrom.y, extendToward.x, extendToward.y);
        if (extendT <= 0.001 || extendT >= 0.999) continue;
        const frontWallT = pointProjectionParameter(
            hit.point.x,
            hit.point.y,
            frontWall.gapEndpoint.x,
            frontWall.gapEndpoint.y,
            frontWall.boundaryEnd.x,
            frontWall.boundaryEnd.y
        );
        if (frontWallT < 0.999) continue;
        connections.push({
            t: extendT,
            stopPoint: hit.point,
            boundaryEnd: frontWall.boundaryEnd
        });
    }
    if (connections.length === 0) return null;
    connections.sort((a, b) => a.t - b.t);
    return connections[0];
}

function getMazeSquarePocketTrimFrontWallConnection(trimFrom, trimToward, pocket) {
    if (!Array.isArray(pocket.cornerWalls) || pocket.cornerWalls.length !== 2) return null;
    const direction = normalizeVector(
        trimToward.x - trimFrom.x,
        trimToward.y - trimFrom.y,
        "Wizard of Flatland maze square pocket trim connector requires a trim direction"
    );
    const connections = [];
    for (const frontWall of pocket.cornerWalls) {
        const hit = intersectLineWithInfiniteLine(trimFrom, direction, frontWall.gapEndpoint, frontWall.boundaryEnd);
        if (!hit) continue;
        const trimT = pointProjectionParameter(hit.point.x, hit.point.y, trimFrom.x, trimFrom.y, trimToward.x, trimToward.y);
        if (trimT <= 0.001 || trimT >= 0.999) continue;
        const frontWallT = pointProjectionParameter(
            hit.point.x,
            hit.point.y,
            frontWall.gapEndpoint.x,
            frontWall.gapEndpoint.y,
            frontWall.boundaryEnd.x,
            frontWall.boundaryEnd.y
        );
        if (frontWallT < 0.999) continue;
        connections.push({
            t: trimT,
            stopPoint: hit.point,
            boundaryEnd: frontWall.boundaryEnd
        });
    }
    if (connections.length === 0) return null;
    connections.sort((a, b) => a.t - b.t);
    return connections[0];
}

function withMazeSquarePocketAdjacentConnectorConnection(room, mutation, options) {
    if (!mutation || !mutation.trimPoint || !mutation.connectorBoundaryEnd) {
        throw new Error("Wizard of Flatland maze square pocket adjacent connector requires a mutation");
    }
    const adjacentConnection = getMazeSquarePocketConnectorFrontWallConnectionForWalls(
        mutation.trimPoint,
        mutation.connectorBoundaryEnd,
        getMazeSectionAdjacentIncorporatedFrontWalls(room, options),
        room.sectionCorners
    );
    if (!adjacentConnection) return mutation;
    if (mutation.connectorStopPoint && mutation.connectorStopT <= adjacentConnection.t + 0.000001) return mutation;
    return {
        ...mutation,
        connectorStopPoint: adjacentConnection.stopPoint,
        connectorBridgeBoundaryEnd: adjacentConnection.boundaryEnd,
        connectorStopT: adjacentConnection.t
    };
}

function clearCrossingMazeSquarePocketAdjacentConnectorBridges(mutations) {
    const crossingMutations = new Set();
    for (let i = 0; i < mutations.length; i++) {
        const a = mutations[i];
        if (!hasMazeSquarePocketAdjacentConnectorBridge(a)) continue;
        for (let j = i + 1; j < mutations.length; j++) {
            const b = mutations[j];
            if (!hasMazeSquarePocketAdjacentConnectorBridge(b)) continue;
            if (!doMazeSquarePocketAdjacentConnectorBridgesCross(a, b)) continue;
            crossingMutations.add(a);
            crossingMutations.add(b);
        }
    }
    if (crossingMutations.size === 0) return mutations;
    return mutations.map((mutation) => (
        crossingMutations.has(mutation)
            ? {
                ...mutation,
                connectorStopPoint: null,
                connectorBridgeBoundaryEnd: null,
                connectorStopT: null
            }
            : mutation
    ));
}

function hasMazeSquarePocketAdjacentConnectorBridge(mutation) {
    return !!(
        mutation &&
        mutation.connectorStopPoint &&
        mutation.connectorBridgeBoundaryEnd &&
        Number.isFinite(mutation.connectorStopT)
    );
}

function doMazeSquarePocketAdjacentConnectorBridgesCross(a, b) {
    return doSegmentsCrossAwayFromEndpoints(
        a.connectorStopPoint,
        a.connectorBridgeBoundaryEnd,
        b.connectorStopPoint,
        b.connectorBridgeBoundaryEnd
    );
}

function doSegmentsCrossAwayFromEndpoints(firstA, firstB, secondA, secondB) {
    const firstDirection = normalizeVector(
        firstB.x - firstA.x,
        firstB.y - firstA.y,
        "Wizard of Flatland maze segment crossing check requires a valid first segment"
    );
    const secondLength = Math.hypot(secondB.x - secondA.x, secondB.y - secondA.y);
    if (!(secondLength > 0.000001)) {
        throw new Error("Wizard of Flatland maze segment crossing check requires a valid second segment");
    }
    const hit = intersectLineWithSegment(firstA, firstDirection, secondA, secondB);
    if (!hit) return false;
    const firstLength = Math.hypot(firstB.x - firstA.x, firstB.y - firstA.y);
    if (hit.lineT <= 0.001 || hit.lineT >= firstLength - 0.001) return false;
    const secondT = pointProjectionParameter(hit.point.x, hit.point.y, secondA.x, secondA.y, secondB.x, secondB.y);
    return secondT > 0.001 && secondT < 0.999;
}

function getMazeSectionAdjacentIncorporatedFrontWalls(room, options) {
    const frontWalls = [];
    for (let side = 0; side < 6; side++) {
        const dir = MAZE_SECTION_DIRECTIONS[side];
        if (!dir) throw new Error("Wizard of Flatland maze adjacent front wall side is invalid");
        const neighborRoom = buildMazeRoom(room.q + dir.q, room.r + dir.r, options);
        for (const cornerIndex of neighborRoom.squareSideCorners) {
            const pocketSides = getMazeSquarePocketSides(cornerIndex);
            for (const pocketSide of pocketSides) {
                if (!isMazeSquarePocketIncorporatedByNeighbor(neighborRoom, cornerIndex, pocketSide, options)) continue;
                const pocket = getMazeSquarePocketGeometry(neighborRoom, cornerIndex, pocketSide);
                if (!pointInOrOnMazeSectionPolygon(pocket.boundaryEnd, room.sectionCorners)) continue;
                frontWalls.push({
                    gapEndpoint: pocket.gapEndpoint,
                    boundaryEnd: pocket.boundaryEnd
                });
            }
        }
    }
    return frontWalls;
}

function getMazeSquarePocketConnectorFrontWallConnection(connectorFrom, connectorToward, pocket, sectionCorners) {
    if (!Array.isArray(pocket.cornerWalls) || pocket.cornerWalls.length !== 2) return null;
    return getMazeSquarePocketConnectorFrontWallConnectionForWalls(connectorFrom, connectorToward, pocket.cornerWalls, sectionCorners);
}

function getMazeSquarePocketConnectorFrontWallConnectionForWalls(connectorFrom, connectorToward, frontWalls, sectionCorners) {
    if (!Array.isArray(frontWalls) || frontWalls.length === 0) return null;
    if (!Array.isArray(sectionCorners) || sectionCorners.length < 3) {
        throw new Error("Wizard of Flatland maze square pocket connector crossing requires section corners");
    }
    const direction = normalizeVector(
        connectorToward.x - connectorFrom.x,
        connectorToward.y - connectorFrom.y,
        "Wizard of Flatland maze square pocket connector requires a direction"
    );
    const connections = [];
    for (const frontWall of frontWalls) {
        const hit = intersectLineWithInfiniteLine(connectorFrom, direction, frontWall.gapEndpoint, frontWall.boundaryEnd);
        if (!hit) continue;
        const connectorT = pointProjectionParameter(
            hit.point.x,
            hit.point.y,
            connectorFrom.x,
            connectorFrom.y,
            connectorToward.x,
            connectorToward.y
        );
        if (connectorT <= 0.001 || connectorT >= 0.999) continue;
        const frontWallT = pointProjectionParameter(
            hit.point.x,
            hit.point.y,
            frontWall.gapEndpoint.x,
            frontWall.gapEndpoint.y,
            frontWall.boundaryEnd.x,
            frontWall.boundaryEnd.y
        );
        if (frontWallT <= 1.001) continue;
        if (!pointInOrOnMazeSectionPolygon(hit.point, sectionCorners)) continue;
        if (!pointInOrOnMazeSectionPolygon(frontWall.boundaryEnd, sectionCorners)) {
            throw new Error("Wizard of Flatland maze square pocket connector bridge endpoint is outside its native section");
        }
        if (Math.hypot(frontWall.boundaryEnd.x - hit.point.x, frontWall.boundaryEnd.y - hit.point.y) <= 0.001) continue;
        connections.push({
            t: connectorT,
            stopPoint: hit.point,
            boundaryEnd: frontWall.boundaryEnd
        });
    }
    if (connections.length === 0) return null;
    connections.sort((a, b) => a.t - b.t);
    return connections[0];
}

function lineDistanceToPoint(lineA, lineB, point) {
    const dx = lineB.x - lineA.x;
    const dy = lineB.y - lineA.y;
    const length = Math.hypot(dx, dy);
    if (!(length > 0.000001)) throw new Error("Wizard of Flatland maze line distance requires separated endpoints");
    return Math.abs(cross2d(point.x - lineA.x, point.y - lineA.y, dx / length, dy / length));
}

function getMazeSquarePocketWallColinearity(wall, direction) {
    return Math.abs(cross2d(
        wall.shared.x - wall.far.x,
        wall.shared.y - wall.far.y,
        direction.x,
        direction.y
    ));
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
    const fullWall = open
        && canMazeSharedHallwayUseFullWall(q, r, side, options)
        && seededRandom(hashString(`${options.seed}|hall-full-wall|${ordered}`))() < MAZE_FULL_WALL_HALLWAY_CHANCE;
    if (requireOpen && !open) throw new Error(`Wizard of Flatland maze hallway edge ${ordered} is not open`);
    return {
        side,
        edgeKey: ordered,
        open,
        t: thisKey < neighborKey ? edgeT : 1 - edgeT,
        width: MAZE_DOOR_WIDTH,
        fullWall
    };
}

function canMazeSharedHallwayUseFullWall(q, r, side, options) {
    const dir = MAZE_SECTION_DIRECTIONS[side];
    if (!dir) throw new Error("Wizard of Flatland maze full-wall hallway side is invalid");
    const room = buildMazeRoom(q, r, options);
    const neighborRoom = buildMazeRoom(q + dir.q, r + dir.r, options);
    return areMazeHallwayAdjoiningSidesDefaultHex(room, side, neighborRoom, (side + 3) % 6, options);
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

function getMazeOutsideDoorOpening(seedKey) {
    const roll = seededRandom(hashString(seedKey))();
    if (roll < MAZE_OUTSIDE_DOOR_FULL_WALL_CHANCE) {
        return {
            width: MAZE_DOOR_WIDTH,
            fullWall: true
        };
    }
    if (roll < MAZE_OUTSIDE_DOOR_FULL_WALL_CHANCE + MAZE_OUTSIDE_DOOR_WIDE_CHANCE) {
        return {
            width: MAZE_OUTSIDE_DOOR_WIDE_WIDTH,
            fullWall: false
        };
    }
    return {
        width: MAZE_DOOR_WIDTH,
        fullWall: false
    };
}

function getMazeSectionOutsideDoor(q, r, options, hallSides) {
    const random = seededRandom(hashString(`${options.seed}|outside-door|${q},${r}`));
    const sideOptions = [0, 1, 2, 3, 4, 5]
        .filter((side) => !hallSides.has(side) && canMazeSectionOwnOutsideDoorSide(q, r, side));
    if (sideOptions.length === 0) return null;
    const side = sideOptions[Math.floor(random() * sideOptions.length)];
    const opening = getMazeOutsideDoorOpening(`${options.seed}|outside-door-opening|${q},${r}`);
    return {
        side,
        t: 0.24 + random() * 0.52,
        width: opening.width,
        fullWall: opening.fullWall
    };
}

function canMazeSectionOwnOutsideDoorSide(q, r, side) {
    const dir = MAZE_SECTION_DIRECTIONS[side];
    if (!dir) throw new Error("Wizard of Flatland maze outside door side is invalid");
    return mazeSectionKey(q, r) < mazeSectionKey(q + dir.q, r + dir.r);
}

function appendMazeRoomWalls(walls, room, hallConnections, outsideDoor, incomingSquarePocketMutations = []) {
    const squarePocketWallPlan = buildMazeSquarePocketWallPlan(incomingSquarePocketMutations, room.sectionCorners);
    for (let side = 0; side < 6; side++) {
        if (squarePocketWallPlan.suppressedSides.has(side)) continue;
        const override = squarePocketWallPlan.sideOverrides.get(side);
        if (override) {
            const overrides = Array.isArray(override) ? override : [override];
            for (const overrideSegment of overrides) {
                appendMazeRoomOverrideWall(walls, room, side, overrideSegment, hallConnections.get(side));
            }
            continue;
        }
        const a = room.corners[side];
        const b = room.corners[(side + 1) % 6];
        const connection = hallConnections.get(side);
        if (connection) {
            appendWallWithGap(walls, a, b, connection.t, connection.width, WALL_LABEL_ROOM_HALL_GAP, side, connection.fullWall);
            continue;
        }
        if (outsideDoor && outsideDoor.side === side) {
            appendWallWithGap(walls, a, b, outsideDoor.t, outsideDoor.width, WALL_LABEL_ROOM_OUTSIDE_DOOR_GAP, side, outsideDoor.fullWall);
            continue;
        }
        appendSegmentWall(walls, a.x, a.y, b.x, b.y, WALL_LABEL_ROOM_BOUNDARY, side);
    }
    for (const extra of squarePocketWallPlan.extraWalls) {
        appendSegmentWall(
            walls,
            extra.a.x,
            extra.a.y,
            extra.b.x,
            extra.b.y,
            extra.labelCode || WALL_LABEL_ROOM_POCKET_CONNECTOR,
            Number.isInteger(extra.sideCode) ? extra.sideCode : -1
        );
    }
}

function appendMazeRoomOverrideWall(walls, room, side, override, connection) {
    if (!connection) {
        appendSegmentWall(walls, override.a.x, override.a.y, override.b.x, override.b.y, WALL_LABEL_ROOM_POCKET_OVERRIDE, side);
        return;
    }
    const originalA = room.corners[side];
    const originalB = room.corners[(side + 1) % 6];
    if (connection.fullWall) {
        appendMazeRoomOverrideWallOutsideFullHallway(walls, originalA, originalB, override, side);
        return;
    }
    const gapCenter = pointOnHexSide(originalA, originalB, connection.t);
    const overrideT = pointProjectionParameter(gapCenter.x, gapCenter.y, override.a.x, override.a.y, override.b.x, override.b.y);
    const projectedGapCenter = pointOnHexSide(override.a, override.b, Math.max(0, Math.min(1, overrideT)));
    const distanceToOverride = Math.hypot(projectedGapCenter.x - gapCenter.x, projectedGapCenter.y - gapCenter.y);
    if (overrideT <= 0 || overrideT >= 1 || distanceToOverride > 0.001) {
        appendSegmentWall(walls, override.a.x, override.a.y, override.b.x, override.b.y, WALL_LABEL_ROOM_POCKET_OVERRIDE, side);
        return;
    }
    appendWallWithGap(walls, override.a, override.b, overrideT, connection.width, WALL_LABEL_ROOM_POCKET_OVERRIDE_HALL_GAP, side, connection.fullWall);
}

function appendMazeRoomOverrideWallOutsideFullHallway(walls, originalA, originalB, override, side) {
    const dx = override.b.x - override.a.x;
    const dy = override.b.y - override.a.y;
    const length = Math.hypot(dx, dy);
    if (!(length > 0.001)) {
        throw new Error("Wizard of Flatland maze full-wall pocket override requires separated endpoints");
    }
    const direction = { x: dx / length, y: dy / length };
    const originalADistance = Math.abs(cross2d(originalA.x - override.a.x, originalA.y - override.a.y, direction.x, direction.y));
    const originalBDistance = Math.abs(cross2d(originalB.x - override.a.x, originalB.y - override.a.y, direction.x, direction.y));
    if (originalADistance > 0.001 || originalBDistance > 0.001) {
        appendSegmentWall(walls, override.a.x, override.a.y, override.b.x, override.b.y, WALL_LABEL_ROOM_POCKET_OVERRIDE, side);
        return;
    }
    const coveredA = pointProjectionParameter(
        originalA.x,
        originalA.y,
        override.a.x,
        override.a.y,
        override.b.x,
        override.b.y
    );
    const coveredB = pointProjectionParameter(
        originalB.x,
        originalB.y,
        override.a.x,
        override.a.y,
        override.b.x,
        override.b.y
    );
    const coveredStart = Math.max(0, Math.min(1, Math.min(coveredA, coveredB)));
    const coveredEnd = Math.max(0, Math.min(1, Math.max(coveredA, coveredB)));
    appendMazeRoomOverrideWallInterval(walls, override, side, 0, coveredStart);
    appendMazeRoomOverrideWallInterval(walls, override, side, coveredEnd, 1);
}

function appendMazeRoomOverrideWallInterval(walls, override, side, startT, endT) {
    if (!(endT > startT + 0.001)) return;
    const a = pointOnHexSide(override.a, override.b, startT);
    const b = pointOnHexSide(override.a, override.b, endT);
    appendSegmentWall(walls, a.x, a.y, b.x, b.y, WALL_LABEL_ROOM_POCKET_OVERRIDE, side);
}

function buildMazeSquarePocketWallPlan(mutations, sectionCorners = null) {
    const suppressedSides = new Set();
    const sideOverrides = new Map();
    const extraWalls = [];
    const overrideCandidatesBySide = new Map();
    const connectorWallsByMutation = new Map();
    const connectorBlockers = [];
    for (const mutation of mutations) {
        suppressedSides.add(mutation.suppressSide);
    }
    for (const mutation of mutations) {
        if (!suppressedSides.has(mutation.extendSide)) {
            addMazeSquarePocketSideOverrideCandidate(overrideCandidatesBySide, {
                mutation,
                side: mutation.extendSide,
                a: mutation.extendFrom,
                b: getMazeSquarePocketExtendedWallEnd(mutation, sectionCorners)
            });
        }
        if (!suppressedSides.has(mutation.trimSide)) {
            addMazeSquarePocketSideOverrideCandidate(overrideCandidatesBySide, {
                mutation,
                side: mutation.trimSide,
                a: mutation.trimFrom,
                b: getMazeSquarePocketTrimmedWallEnd(mutation, sectionCorners)
            });
        }
        const connectorWall = getMazeSquarePocketConnectorWallSegment(mutation, sectionCorners);
        connectorWallsByMutation.set(mutation, connectorWall);
        connectorBlockers.push({
            mutation,
            a: connectorWall.a,
            b: connectorWall.b
        });
    }
    for (const candidates of overrideCandidatesBySide.values()) {
        for (const candidate of getMazeSquarePocketSideOverrideSegments(candidates, connectorBlockers)) {
            addMazeSquarePocketSideOverride(sideOverrides, candidate);
        }
    }
    for (const mutation of mutations) {
        const extendConnectorWall = getMazeSquarePocketExtendConnectorWallSegment(mutation, sectionCorners);
        if (extendConnectorWall) extraWalls.push(extendConnectorWall);
        const trimConnectorWall = getMazeSquarePocketTrimConnectorWallSegment(mutation, sectionCorners);
        if (trimConnectorWall) extraWalls.push(trimConnectorWall);
        // Add the front wall segment from the inside corner toward the pocket.
        extraWalls.push(connectorWallsByMutation.get(mutation));
        const connectorBridgeWall = getMazeSquarePocketConnectorBridgeWallSegment(mutation, sectionCorners);
        if (connectorBridgeWall) extraWalls.push(connectorBridgeWall);
    }
    return {
        suppressedSides,
        sideOverrides,
        extraWalls
    };
}

function addMazeSquarePocketSideOverrideCandidate(candidatesBySide, candidate) {
    const existing = candidatesBySide.get(candidate.side);
    if (existing) {
        existing.push(candidate);
        return;
    }
    candidatesBySide.set(candidate.side, [candidate]);
}

function getMazeSquarePocketSideOverrideSegments(candidates, connectorBlockers) {
    if (candidates.length === 1) {
        return [getMazeSquarePocketSideOverrideStoppedAtConnectorWalls(candidates[0], connectorBlockers)];
    }
    const combined = getMazeSquarePocketOverlappingSideOverrideSegment(candidates);
    if (combined) return [combined];
    return candidates.map((candidate) => getMazeSquarePocketSideOverrideStoppedAtConnectorWalls(candidate, connectorBlockers));
}

function getMazeSquarePocketOverlappingSideOverrideSegment(candidates) {
    const first = candidates[0];
    const dx = first.b.x - first.a.x;
    const dy = first.b.y - first.a.y;
    const length = Math.hypot(dx, dy);
    if (!(length > 0.001)) {
        throw new Error("Wizard of Flatland maze square pocket side overlap requires separated endpoints");
    }
    const direction = { x: dx / length, y: dy / length };
    let start = -Infinity;
    let end = Infinity;
    for (const candidate of candidates) {
        const lineDistanceA = Math.abs(cross2d(candidate.a.x - first.a.x, candidate.a.y - first.a.y, direction.x, direction.y));
        const lineDistanceB = Math.abs(cross2d(candidate.b.x - first.a.x, candidate.b.y - first.a.y, direction.x, direction.y));
        if (lineDistanceA > 0.001 || lineDistanceB > 0.001) {
            throw new Error("Wizard of Flatland maze square pocket side overlap requires colinear overrides");
        }
        const candidateStart = pointProjectionParameter(
            candidate.a.x,
            candidate.a.y,
            first.a.x,
            first.a.y,
            first.a.x + direction.x,
            first.a.y + direction.y
        );
        const candidateEnd = pointProjectionParameter(
            candidate.b.x,
            candidate.b.y,
            first.a.x,
            first.a.y,
            first.a.x + direction.x,
            first.a.y + direction.y
        );
        start = Math.max(start, Math.min(candidateStart, candidateEnd));
        end = Math.min(end, Math.max(candidateStart, candidateEnd));
    }
    if (!(end > start + 0.001)) return null;
    return {
        side: first.side,
        a: pointOnLine(first.a, direction, start),
        b: pointOnLine(first.a, direction, end)
    };
}

function getMazeSquarePocketSideOverrideStoppedAtConnectorWalls(candidate, connectorBlockers) {
    const dx = candidate.b.x - candidate.a.x;
    const dy = candidate.b.y - candidate.a.y;
    const length = Math.hypot(dx, dy);
    if (!(length > 0.001)) {
        throw new Error("Wizard of Flatland maze square pocket side override requires separated endpoints");
    }
    const direction = { x: dx / length, y: dy / length };
    let best = null;
    for (const blocker of connectorBlockers) {
        if (blocker.mutation === candidate.mutation) continue;
        const hit = intersectLineWithSegment(candidate.a, direction, blocker.a, blocker.b);
        if (!hit || hit.lineT <= 0.001 || hit.lineT >= length - 0.001) continue;
        if (!best || hit.lineT < best.lineT) best = hit;
    }
    if (!best) return candidate;
    return {
        ...candidate,
        b: best.point
    };
}

function addMazeSquarePocketSideOverride(sideOverrides, candidate) {
    if (Math.hypot(candidate.b.x - candidate.a.x, candidate.b.y - candidate.a.y) <= 0.001) return;
    const segment = {
        a: candidate.a,
        b: candidate.b
    };
    const existing = sideOverrides.get(candidate.side);
    if (!existing) {
        sideOverrides.set(candidate.side, segment);
        return;
    }
    const existingSegments = Array.isArray(existing) ? existing : [existing];
    for (const existingSegment of existingSegments) {
        const sameDirection = Math.hypot(existingSegment.a.x - segment.a.x, existingSegment.a.y - segment.a.y) < 0.0001
            && Math.hypot(existingSegment.b.x - segment.b.x, existingSegment.b.y - segment.b.y) < 0.0001;
        const oppositeDirection = Math.hypot(existingSegment.a.x - segment.b.x, existingSegment.a.y - segment.b.y) < 0.0001
            && Math.hypot(existingSegment.b.x - segment.a.x, existingSegment.b.y - segment.a.y) < 0.0001;
        if (sameDirection || oppositeDirection) return;
    }
    if (Array.isArray(existing)) {
        existing.push(segment);
        return;
    }
    sideOverrides.set(candidate.side, [existing, segment]);
}

function getMazeSquarePocketExtendedWallEnd(mutation, sectionCorners = null) {
    if (!mutation || !mutation.extendFrom || !mutation.connectorBoundaryEnd) {
        throw new Error("Wizard of Flatland maze square pocket extended wall requires endpoints");
    }
    const end = mutation.extendStopPoint || mutation.connectorBoundaryEnd;
    if (!sectionCorners) return end;
    return shortenSegmentEndToPolygon(
        mutation.extendFrom,
        end,
        sectionCorners,
        "Wizard of Flatland maze square pocket extended wall"
    );
}

function getMazeSquarePocketTrimmedWallEnd(mutation, sectionCorners = null) {
    if (!mutation || !mutation.trimFrom || !mutation.trimPoint) {
        throw new Error("Wizard of Flatland maze square pocket trimmed wall requires endpoints");
    }
    const end = mutation.trimStopPoint || mutation.trimPoint;
    if (!sectionCorners) return end;
    return shortenSegmentEndToPolygon(
        mutation.trimFrom,
        end,
        sectionCorners,
        "Wizard of Flatland maze square pocket trimmed wall"
    );
}

function getMazeSquarePocketConnectorWallSegment(mutation, sectionCorners) {
    if (!mutation || !mutation.trimPoint || !mutation.connectorBoundaryEnd) {
        throw new Error("Wizard of Flatland maze square pocket connector wall requires endpoints");
    }
    const start = mutation.connectorStopPoint || mutation.trimPoint;
    if (!sectionCorners) {
        return {
            a: start,
            b: mutation.connectorBoundaryEnd
        };
    }
    return clipSegmentToPolygon(
        start,
        mutation.connectorBoundaryEnd,
        sectionCorners,
        "Wizard of Flatland maze square pocket connector wall"
    );
}

function getMazeSquarePocketConnectorBridgeWallSegment(mutation, sectionCorners) {
    if (!mutation || !mutation.connectorStopPoint || !mutation.connectorBridgeBoundaryEnd) return null;
    if (Math.hypot(
        mutation.connectorBridgeBoundaryEnd.x - mutation.connectorStopPoint.x,
        mutation.connectorBridgeBoundaryEnd.y - mutation.connectorStopPoint.y
    ) <= 0.001) return null;
    const wall = !sectionCorners
        ? {
            a: mutation.connectorStopPoint,
            b: mutation.connectorBridgeBoundaryEnd
        }
        : clipSegmentToPolygon(
            mutation.connectorStopPoint,
            mutation.connectorBridgeBoundaryEnd,
            sectionCorners,
            "Wizard of Flatland maze square pocket connector bridge wall"
        );
    return {
        ...wall,
        labelCode: WALL_LABEL_SQUARE_SIDE_PERPENDICULAR_FULL
    };
}

function getMazeSquarePocketExtendConnectorWallSegment(mutation, sectionCorners) {
    if (!mutation || !mutation.extendStopPoint || !mutation.extendConnectorBoundaryEnd) return null;
    if (Math.hypot(
        mutation.extendConnectorBoundaryEnd.x - mutation.extendStopPoint.x,
        mutation.extendConnectorBoundaryEnd.y - mutation.extendStopPoint.y
    ) <= 0.001) return null;
    if (!sectionCorners) {
        return {
            a: mutation.extendStopPoint,
            b: mutation.extendConnectorBoundaryEnd
        };
    }
    return clipSegmentToPolygon(
        mutation.extendStopPoint,
        mutation.extendConnectorBoundaryEnd,
        sectionCorners,
        "Wizard of Flatland maze square pocket extend connector wall"
    );
}

function getMazeSquarePocketTrimConnectorWallSegment(mutation, sectionCorners) {
    if (!mutation || !mutation.trimStopPoint || !mutation.trimConnectorBoundaryEnd) return null;
    if (Math.hypot(
        mutation.trimConnectorBoundaryEnd.x - mutation.trimStopPoint.x,
        mutation.trimConnectorBoundaryEnd.y - mutation.trimStopPoint.y
    ) <= 0.001) return null;
    if (!sectionCorners) {
        return {
            a: mutation.trimStopPoint,
            b: mutation.trimConnectorBoundaryEnd
        };
    }
    return clipSegmentToPolygon(
        mutation.trimStopPoint,
        mutation.trimConnectorBoundaryEnd,
        sectionCorners,
        "Wizard of Flatland maze square pocket trim connector wall"
    );
}

function shortenSegmentEndToPolygon(start, end, polygon, label) {
    if (!pointInOrOnMazeSectionPolygon(start, polygon)) {
        throw new Error(`${label} starts outside its native section`);
    }
    if (pointInOrOnMazeSectionPolygon(end, polygon)) return end;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (!(length > 0.000001)) throw new Error(`${label} requires separated endpoints`);
    const direction = { x: dx / length, y: dy / length };
    let best = null;
    for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i];
        const b = polygon[(i + 1) % polygon.length];
        const hit = intersectLineWithSegment(start, direction, a, b);
        if (!hit || hit.lineT < -0.001 || hit.lineT > length + 0.001) continue;
        if (!best || hit.lineT < best.lineT) best = hit;
    }
    if (!best) throw new Error(`${label} cannot be shortened to the native section boundary`);
    const shortenedLength = Math.hypot(best.point.x - start.x, best.point.y - start.y);
    if (shortenedLength > length + 0.000001) {
        throw new Error(`${label} shortening made the wall longer`);
    }
    const directionCross = Math.abs(cross2d(
        dx / length,
        dy / length,
        (best.point.x - start.x) / Math.max(shortenedLength, 0.000001),
        (best.point.y - start.y) / Math.max(shortenedLength, 0.000001)
    ));
    if (directionCross > 0.000001) {
        throw new Error(`${label} shortening changed direction`);
    }
    return best.point;
}

function clipSegmentToPolygon(start, end, polygon, label) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.hypot(dx, dy);
    if (!(length > 0.000001)) throw new Error(`${label} requires separated endpoints`);
    const direction = { x: dx / length, y: dy / length };
    const hits = [];
    if (pointInOrOnMazeSectionPolygon(start, polygon)) addSegmentClipHit(hits, 0, start);
    if (pointInOrOnMazeSectionPolygon(end, polygon)) addSegmentClipHit(hits, length, end);
    for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i];
        const b = polygon[(i + 1) % polygon.length];
        const hit = intersectLineWithSegment(start, direction, a, b);
        if (!hit || hit.lineT < -0.001 || hit.lineT > length + 0.001) continue;
        addSegmentClipHit(hits, Math.max(0, Math.min(length, hit.lineT)), hit.point);
    }
    hits.sort((a, b) => a.t - b.t);
    for (let i = 0; i < hits.length - 1; i++) {
        const a = hits[i];
        const b = hits[i + 1];
        if (!(b.t > a.t + 0.001)) continue;
        const mid = pointOnLine(start, direction, (a.t + b.t) * 0.5);
        if (!pointInOrOnMazeSectionPolygon(mid, polygon)) continue;
        return {
            a: pointOnLine(start, direction, a.t),
            b: pointOnLine(start, direction, b.t)
        };
    }
    throw new Error(`${label} has no segment inside its native section`);
}

function addSegmentClipHit(hits, t, point) {
    for (const hit of hits) {
        if (Math.abs(hit.t - t) < 0.0001 || Math.hypot(hit.point.x - point.x, hit.point.y - point.y) < 0.0001) return;
    }
    hits.push({ t, point });
}

function appendMazeSquareSideWalls(walls, room, hallConnections, options) {
    for (const cornerIndex of room.squareSideCorners) {
        const pocketSides = getMazeSquarePocketSides(cornerIndex);
        const leftPocketIncorporated = isMazeSquarePocketIncorporatedByNeighbor(room, cornerIndex, pocketSides[0], options);
        const rightPocketIncorporated = isMazeSquarePocketIncorporatedByNeighbor(room, cornerIndex, pocketSides[1], options);
        const leftPocketIntersectsHallway = doesMazeSquarePocketIntersectHallway(pocketSides[0], hallConnections);
        const rightPocketIntersectsHallway = doesMazeSquarePocketIntersectHallway(pocketSides[1], hallConnections);
        const keepLeftPocket = leftPocketIncorporated || leftPocketIntersectsHallway;
        const keepRightPocket = rightPocketIncorporated || rightPocketIntersectsHallway;
        if (!keepLeftPocket && !keepRightPocket) continue;
        const originalCorner = getHexCornersWorld(room.center.x, room.center.y, room.radius)[cornerIndex];
        const squaredCorner = room.corners[cornerIndex];
        const sideStart = room.corners[(cornerIndex + 5) % 6];
        const sideEnd = room.corners[(cornerIndex + 1) % 6];
        const sideVector = normalizeVector(sideEnd.x - sideStart.x, sideEnd.y - sideStart.y, "Wizard of Flatland maze square side requires a valid side vector");
        const outward = normalizeVector(originalCorner.x - squaredCorner.x, originalCorner.y - squaredCorner.y, "Wizard of Flatland maze square side requires an outward direction");
        const wallCenter = {
            x: squaredCorner.x + outward.x * MAZE_SQUARE_ROOM_SIDE_OFFSET,
            y: squaredCorner.y + outward.y * MAZE_SQUARE_ROOM_SIDE_OFFSET
        };
        const span = intersectLineWithPolygonSpan(wallCenter, sideVector, room.sectionCorners, "Wizard of Flatland maze square side wall");
        // This generated wall is the corner-pocket back wall running parallel
        // to the squared side, with a centered opening between pocket vertices.
        let intervals = [];
        if (keepLeftPocket) {
            intervals.push({
                start: leftPocketIncorporated ? span.start : span.start + span.startEdgeDistanceScale * MAZE_SQUARE_ROOM_WALL_END_SHORTEN,
                end: -MAZE_SQUARE_ROOM_SIDE_GAP_WIDTH * 0.5
            });
        }
        if (keepRightPocket) {
            intervals.push({
                start: MAZE_SQUARE_ROOM_SIDE_GAP_WIDTH * 0.5,
                end: rightPocketIncorporated ? span.end : span.end - span.endEdgeDistanceScale * MAZE_SQUARE_ROOM_WALL_END_SHORTEN
            });
        }
        intervals = subtractMazeSquareSideHallwayIntervals(intervals, room, cornerIndex, wallCenter, sideVector, hallConnections, options);
        appendLineIntervalsAsWalls(walls, wallCenter, sideVector, intervals, WALL_LABEL_SQUARE_SIDE_PARALLEL, cornerIndex);
        const gap = getCenteredLineGapEndpoints(wallCenter, sideVector, MAZE_SQUARE_ROOM_SIDE_GAP_WIDTH);
        // Each back-wall endpoint grows outward as a corner-pocket front wall.
        if (keepLeftPocket) appendPerpendicularSquareSideWall(walls, gap.left, outward, room.sectionCorners, leftPocketIncorporated);
        if (keepRightPocket) appendPerpendicularSquareSideWall(walls, gap.right, outward, room.sectionCorners, rightPocketIncorporated);
    }
}

function doesMazeSquarePocketIntersectHallway(pocketSide, hallConnections) {
    return !!hallConnections && hallConnections.has(pocketSide);
}

function subtractMazeSquareSideHallwayIntervals(intervals, room, cornerIndex, wallCenter, sideVector, hallConnections, options) {
    if (!hallConnections) return intervals;
    const sideA = (cornerIndex + 5) % 6;
    const sideB = cornerIndex;
    let out = intervals;
    const sideCuts = [
        { side: sideA, keepTowardPositive: true },
        { side: sideB, keepTowardPositive: false }
    ];
    for (const sideCut of sideCuts) {
        const connection = hallConnections.get(sideCut.side);
        if (!connection) continue;
        const hallwayInterval = getMazeHallwayCorridorLineInterval(room, sideCut.side, connection, wallCenter, sideVector, options);
        // A hallway normally cuts a corner pocket back wall so it does not
        // continue on the other side. If the adjoining room has incorporated
        // this pocket, leave the resumed far-side wall in place, but still cut
        // the hallway opening itself.
        if (isMazeSquarePocketIncorporatedByNeighbor(room, cornerIndex, sideCut.side, options)) {
            out = subtractLineInterval(out, hallwayInterval.start, hallwayInterval.end);
            continue;
        }
        out = trimLineIntervalsAtHallway(out, hallwayInterval, sideCut.keepTowardPositive);
    }
    return out;
}

function trimLineIntervalsAtHallway(intervals, hallwayInterval, keepTowardPositive) {
    const start = Math.min(hallwayInterval.start, hallwayInterval.end);
    const end = Math.max(hallwayInterval.start, hallwayInterval.end);
    if (!(end > start)) throw new Error("Wizard of Flatland maze square side hallway trim requires separated endpoints");
    const out = [];
    for (const interval of intervals) {
        if (!(interval.end > interval.start)) continue;
        if (keepTowardPositive) {
            const trimmedStart = getMazeLineIntervalStartSnappedToHallway(interval.start, end);
            if (interval.end > trimmedStart) out.push({ start: trimmedStart, end: interval.end });
            continue;
        }
        const trimmedEnd = getMazeLineIntervalEndSnappedToHallway(interval.end, start);
        if (trimmedEnd > interval.start) out.push({ start: interval.start, end: trimmedEnd });
    }
    return out;
}

function getMazeLineIntervalStartSnappedToHallway(intervalStart, hallwayEnd) {
    if (intervalStart >= hallwayEnd && intervalStart - hallwayEnd <= MAZE_SQUARE_ROOM_HALLWAY_SNAP_DISTANCE) {
        return hallwayEnd;
    }
    return Math.max(intervalStart, hallwayEnd);
}

function getMazeLineIntervalEndSnappedToHallway(intervalEnd, hallwayStart) {
    if (intervalEnd <= hallwayStart && hallwayStart - intervalEnd <= MAZE_SQUARE_ROOM_HALLWAY_SNAP_DISTANCE) {
        return hallwayStart;
    }
    return Math.min(intervalEnd, hallwayStart);
}

function getMazeHallwayCorridorLineInterval(room, side, connection, linePoint, lineDirection, options) {
    const span = getMazeHallwayCorridorLineSpan(room, side, connection, linePoint, lineDirection, options);
    return {
        start: span.start,
        end: span.end
    };
}

function getMazeHallwayCorridorLineSpan(room, side, connection, linePoint, lineDirection, options) {
    const squarePocketHallway = getMazeSquarePocketHallwayTarget(room, side, options);
    if (
        squarePocketHallway &&
        isMazeLineEquivalentToSquarePocketBackWall(linePoint, lineDirection, squarePocketHallway.pocket)
    ) {
        return getMazeSquarePocketOrthogonalHallwaySpan(room, side, connection, squarePocketHallway.pocket, linePoint, lineDirection);
    }
    const polygon = getMazeHalfHallwayCorridorPolygon(room, side, connection, options);
    const hits = [];
    for (let i = 0; i < polygon.length; i++) {
        const hit = intersectLineWithSegment(linePoint, lineDirection, polygon[i], polygon[(i + 1) % polygon.length]);
        if (!hit) continue;
        addUniqueLineHit(hits, hit);
    }
    if (hits.length < 2) {
        throw new Error(`Wizard of Flatland maze square side hallway cut ${room.key}:${side} requires two corridor intersections`);
    }
    hits.sort((a, b) => a.lineT - b.lineT);
    for (let i = 0; i < hits.length - 1; i++) {
        const a = hits[i];
        const b = hits[i + 1];
        if (!(b.lineT > a.lineT + 0.001)) continue;
        const mid = pointOnLine(linePoint, lineDirection, (a.lineT + b.lineT) * 0.5);
        if (!pointInOrOnMazeSectionPolygon(mid, polygon)) continue;
        return {
            start: a.lineT,
            end: b.lineT,
            startPoint: a.point,
            endPoint: b.point
        };
    }
    throw new Error(`Wizard of Flatland maze square side hallway cut ${room.key}:${side} has no corridor span`);
}

function isMazeLineEquivalentToSquarePocketBackWall(linePoint, lineDirection, pocket) {
    if (!pocket || !pocket.wallCenter || !pocket.sideVector) {
        throw new Error("Wizard of Flatland maze square pocket hallway line check requires pocket geometry");
    }
    const direction = normalizeVector(
        lineDirection.x,
        lineDirection.y,
        "Wizard of Flatland maze square pocket hallway line check requires a valid direction"
    );
    const directionCross = Math.abs(cross2d(direction.x, direction.y, pocket.sideVector.x, pocket.sideVector.y));
    if (directionCross > 0.000001) return false;
    return Math.abs(cross2d(
        linePoint.x - pocket.wallCenter.x,
        linePoint.y - pocket.wallCenter.y,
        pocket.sideVector.x,
        pocket.sideVector.y
    )) <= 0.001;
}

function getMazeSquarePocketOrthogonalHallwaySpan(room, side, connection, pocket, linePoint = pocket.wallCenter, lineDirection = pocket.sideVector) {
    if (!room || !Array.isArray(room.corners)) {
        throw new Error("Wizard of Flatland maze square pocket hallway requires room corners");
    }
    if (!pocket || !pocket.wallCenter || !pocket.sideVector) {
        throw new Error("Wizard of Flatland maze square pocket hallway requires pocket geometry");
    }
    const roomWallDirection = normalizeVector(
        room.corners[(side + 1) % 6].x - room.corners[side].x,
        room.corners[(side + 1) % 6].y - room.corners[side].y,
        "Wizard of Flatland maze square pocket hallway requires a squared wall direction"
    );
    const parallelCross = Math.abs(cross2d(roomWallDirection.x, roomWallDirection.y, pocket.sideVector.x, pocket.sideVector.y));
    if (parallelCross > 0.000001) {
        throw new Error("Wizard of Flatland maze square pocket hallway requires a squared wall parallel to the pocket back wall");
    }
    const startGap = getWallGapEndpointsForConnection(room.corners[side], room.corners[(side + 1) % 6], connection);
    let normal = { x: -roomWallDirection.y, y: roomWallDirection.x };
    const gapCenter = {
        x: (startGap.left.x + startGap.right.x) * 0.5,
        y: (startGap.left.y + startGap.right.y) * 0.5
    };
    const towardPocket = {
        x: pocket.wallCenter.x - gapCenter.x,
        y: pocket.wallCenter.y - gapCenter.y
    };
    if (normal.x * towardPocket.x + normal.y * towardPocket.y < 0) {
        normal = { x: -normal.x, y: -normal.y };
    }
    const pocketLineEnd = pointOnLine(pocket.wallCenter, pocket.sideVector, 1);
    const leftHit = intersectLineWithInfiniteLine(startGap.left, normal, pocket.wallCenter, pocketLineEnd);
    const rightHit = intersectLineWithInfiniteLine(startGap.right, normal, pocket.wallCenter, pocketLineEnd);
    if (!leftHit || !rightHit) {
        throw new Error("Wizard of Flatland maze square pocket hallway cannot intersect the pocket back wall");
    }
    if (leftHit.lineT <= 0.001 || rightHit.lineT <= 0.001) {
        throw new Error("Wizard of Flatland maze square pocket hallway must point from the squared wall toward the pocket");
    }
    const leftProjection = pointProjectionParameter(
        leftHit.point.x,
        leftHit.point.y,
        linePoint.x,
        linePoint.y,
        linePoint.x + lineDirection.x,
        linePoint.y + lineDirection.y
    );
    const rightProjection = pointProjectionParameter(
        rightHit.point.x,
        rightHit.point.y,
        linePoint.x,
        linePoint.y,
        linePoint.x + lineDirection.x,
        linePoint.y + lineDirection.y
    );
    return {
        start: Math.min(leftProjection, rightProjection),
        end: Math.max(leftProjection, rightProjection),
        startPoint: leftProjection <= rightProjection ? leftHit.point : rightHit.point,
        endPoint: leftProjection <= rightProjection ? rightHit.point : leftHit.point,
        startGap,
        leftPoint: leftHit.point,
        rightPoint: rightHit.point,
        normal
    };
}

function getMazeHalfHallwayBoundarySegments(room, side, connection, options) {
    const polygon = getMazeHalfHallwayCorridorPolygon(room, side, connection, options);
    return [
        { a: polygon[0], b: polygon[1] },
        { a: polygon[3], b: polygon[2] }
    ];
}

function getMazeHalfHallwayCorridorPolygon(room, side, connection, options) {
    const dir = MAZE_SECTION_DIRECTIONS[side];
    if (!dir) throw new Error("Wizard of Flatland maze square side hallway cut side is invalid");
    const neighborQ = room.q + dir.q;
    const neighborR = room.r + dir.r;
    const neighborCenter = mazeSectionCenter(neighborQ, neighborR, options);
    const neighborRoomRadius = Math.max(5, getMazeSectionRadius(options) - MAZE_ROOM_EDGE_INSET_TILES / Math.cos(Math.PI / 6));
    const startGap = getWallGapEndpointsForConnection(room.corners[side], room.corners[(side + 1) % 6], connection);
    const neighborSide = (side + 3) % 6;
    const neighborHexCorners = getHexCornersWorld(neighborCenter.x, neighborCenter.y, neighborRoomRadius);
    const neighborSquareSideCorners = getMazeSectionSquareSideCorners(neighborQ, neighborR, options);
    const neighborCorners = getSquaredMazeRoomCorners(neighborHexCorners, neighborSquareSideCorners);
    const neighborConnection = getMazeSharedHallConnection(neighborQ, neighborR, neighborSide, options, true);
    if (
        neighborConnection.edgeKey !== connection.edgeKey ||
        Math.abs(neighborConnection.width - connection.width) > 0.000001 ||
        neighborConnection.fullWall !== connection.fullWall
    ) {
        throw new Error("Wizard of Flatland maze square side hallway cut reciprocal connection mismatch");
    }
    const neighborGap = getWallGapEndpointsForConnection(neighborCorners[neighborSide], neighborCorners[(neighborSide + 1) % 6], neighborConnection);
    return [
        startGap.left,
        neighborGap.right,
        neighborGap.left,
        startGap.right
    ];
}

function subtractLineInterval(intervals, cutStart, cutEnd) {
    const start = Math.min(cutStart, cutEnd);
    const end = Math.max(cutStart, cutEnd);
    if (!(end > start)) throw new Error("Wizard of Flatland maze square side interval cut requires separated endpoints");
    const out = [];
    for (const interval of intervals) {
        if (!(interval.end > interval.start)) continue;
        if (interval.end <= start && start - interval.end <= MAZE_SQUARE_ROOM_HALLWAY_SNAP_DISTANCE) {
            out.push({ start: interval.start, end: start });
            continue;
        }
        if (interval.start >= end && interval.start - end <= MAZE_SQUARE_ROOM_HALLWAY_SNAP_DISTANCE) {
            out.push({ start: end, end: interval.end });
            continue;
        }
        if (end <= interval.start || start >= interval.end) {
            out.push(interval);
            continue;
        }
        if (start > interval.start) out.push({ start: interval.start, end: Math.min(start, interval.end) });
        if (end < interval.end) out.push({ start: Math.max(end, interval.start), end: interval.end });
    }
    return out;
}

function appendLineIntervalsAsWalls(walls, linePoint, lineDirection, intervals, labelCode, sideCode = -1) {
    for (const interval of intervals) {
        if (!(interval.end > interval.start + 0.001)) continue;
        const a = pointOnLine(linePoint, lineDirection, interval.start);
        const b = pointOnLine(linePoint, lineDirection, interval.end);
        appendSegmentWall(walls, a.x, a.y, b.x, b.y, labelCode, sideCode);
    }
}

function getCenteredLineGapEndpoints(center, direction, gapWidth) {
    const half = gapWidth * 0.5;
    return {
        left: { x: center.x - direction.x * half, y: center.y - direction.y * half },
        right: { x: center.x + direction.x * half, y: center.y + direction.y * half }
    };
}

function appendPerpendicularSquareSideWall(walls, start, outward, sectionCorners, fullLength = false) {
    const span = intersectRayWithPolygon(start, outward, sectionCorners, "Wizard of Flatland maze square side perpendicular wall");
    if (fullLength) {
        appendSegmentWall(walls, start.x, start.y, span.end.x, span.end.y, WALL_LABEL_SQUARE_SIDE_PERPENDICULAR_FULL);
        return;
    }
    const length = Math.hypot(span.end.x - start.x, span.end.y - start.y);
    if (!(length > MAZE_SQUARE_ROOM_WALL_END_SHORTEN + 0.001)) {
        throw new Error("Wizard of Flatland maze square side perpendicular wall requires enough length to shorten");
    }
    appendSegmentWall(
        walls,
        start.x,
        start.y,
        span.end.x - outward.x * MAZE_SQUARE_ROOM_WALL_END_SHORTEN,
        span.end.y - outward.y * MAZE_SQUARE_ROOM_WALL_END_SHORTEN,
        WALL_LABEL_SQUARE_SIDE_PERPENDICULAR
    );
}

function appendWallWithGap(walls, a, b, gapT, gapWidth, labelCode, sideCode = -1, fullWall = false) {
    if (fullWall) return;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (!(length > gapWidth + 0.5)) return;
    const halfT = Math.max(0.02, gapWidth / length * 0.5);
    const leftT = Math.max(0, gapT - halfT);
    const rightT = Math.min(1, gapT + halfT);
    if (leftT > 0.04) appendSegmentWall(walls, a.x, a.y, a.x + (b.x - a.x) * leftT, a.y + (b.y - a.y) * leftT, labelCode, sideCode);
    if (rightT < 0.96) appendSegmentWall(walls, a.x + (b.x - a.x) * rightT, a.y + (b.y - a.y) * rightT, b.x, b.y, labelCode, sideCode);
}

function appendMazeHalfHallwayToNeighbor(walls, room, side, connection, options) {
    const dir = MAZE_SECTION_DIRECTIONS[side];
    const neighborCenter = mazeSectionCenter(room.q + dir.q, room.r + dir.r, options);
    const dx = neighborCenter.x - room.center.x;
    const dy = neighborCenter.y - room.center.y;
    const length = Math.hypot(dx, dy);
    if (!(length > 0.001)) throw new Error("Wizard of Flatland maze hallway requires separated section centers");
    const neighborRoomRadius = Math.max(5, getMazeSectionRadius(options) - MAZE_ROOM_EDGE_INSET_TILES / Math.cos(Math.PI / 6));
    const startGap = getWallGapEndpointsForConnection(room.corners[side], room.corners[(side + 1) % 6], connection);
    const neighborSide = (side + 3) % 6;
    const neighborHexCorners = getHexCornersWorld(neighborCenter.x, neighborCenter.y, neighborRoomRadius);
    const neighborSquareSideCorners = getMazeSectionSquareSideCorners(room.q + dir.q, room.r + dir.r, options);
    const neighborCorners = getSquaredMazeRoomCorners(neighborHexCorners, neighborSquareSideCorners);
    const neighborConnection = getMazeSharedHallConnection(room.q + dir.q, room.r + dir.r, neighborSide, options, true);
    if (
        neighborConnection.edgeKey !== connection.edgeKey ||
        Math.abs(neighborConnection.width - connection.width) > 0.000001 ||
        neighborConnection.fullWall !== connection.fullWall
    ) {
        throw new Error("Wizard of Flatland maze reciprocal hallway connection mismatch");
    }
    const neighborGap = getWallGapEndpointsForConnection(neighborCorners[neighborSide], neighborCorners[(neighborSide + 1) % 6], neighborConnection);
    const omissions = getMazeThreeHallwayJunctionWallOmissions(room, side, options);
    if (!omissions.left) appendHalfHallwaySideWall(walls, startGap.left, neighborGap.right, room.sectionCorners);
    appendHalfHallwaySideWallWithJunctionOmission(
        walls,
        startGap.right,
        neighborGap.left,
        room,
        side,
        omissions.right
    );
}

function appendHalfHallwaySideWallWithJunctionOmission(walls, start, end, room, side, omitForJunction) {
    if (!omitForJunction) {
        appendHalfHallwaySideWall(walls, start, end, room.sectionCorners);
        return;
    }
    const clippedEnd = shortenSegmentEndToPolygon(
        start,
        end,
        room.sectionCorners,
        "Wizard of Flatland maze omitted junction hallway wall"
    );
    const cornerIndex = (side + 1) % 6;
    const clipPoint = getMazeHallwayWallCornerPocketClipPoint(room, cornerIndex, side, start, clippedEnd);
    if (!clipPoint) return;
    if (Math.hypot(clipPoint.x - start.x, clipPoint.y - start.y) <= 0.5) return;
    appendSegmentWall(walls, start.x, start.y, clipPoint.x, clipPoint.y, WALL_LABEL_HALLWAY_SIDE_HALF);
}

function getMazeThreeHallwayJunctionWallOmissions(room, side, options) {
    return {
        left: shouldMirrorMazeThreeHallwayJunctionOmission(room, side, options),
        right: shouldOpenMazeThreeHallwayJunctionAtCorner(room, (side + 1) % 6, side, options)
    };
}

function shouldMirrorMazeThreeHallwayJunctionOmission(room, side, options) {
    const dir = MAZE_SECTION_DIRECTIONS[side];
    if (!dir) throw new Error("Wizard of Flatland maze mirrored three-hallway junction side is invalid");
    const neighborRoom = buildMazeRoom(room.q + dir.q, room.r + dir.r, options);
    const neighborSide = (side + 3) % 6;
    if (!areMazeHallwayAdjoiningSidesDefaultHex(room, side, neighborRoom, neighborSide, options)) return false;
    return shouldOpenMazeThreeHallwayJunctionAtCorner(neighborRoom, (neighborSide + 1) % 6, neighborSide, options);
}

function areMazeHallwayAdjoiningSidesDefaultHex(room, side, neighborRoom, neighborSide, options) {
    return isMazeRoomSideDefaultHex(room, side, options)
        && isMazeRoomSideDefaultHex(neighborRoom, neighborSide, options);
}

function isMazeRoomSideDefaultHex(room, side, options) {
    if (isMazeRoomSideSquaredOff(room, side)) return false;
    const incomingMutations = getMazeSectionIncomingSquarePocketMutations(room, options);
    for (const mutation of incomingMutations) {
        if (
            mutation.suppressSide === side ||
            mutation.trimSide === side
        ) {
            return false;
        }
    }
    return true;
}

function shouldOpenMazeThreeHallwayJunctionAtCorner(room, cornerIndex, omittedSide, options) {
    return shouldOpenMazeThreeSectionHallwayLoopAtCorner(room, cornerIndex, omittedSide, options)
        || shouldOpenMazeFourSectionHallwayLoopAtCorner(room, cornerIndex, omittedSide, options);
}

function shouldOpenMazeThreeSectionHallwayLoopAtCorner(room, cornerIndex, omittedSide, options) {
    const sideBefore = (cornerIndex + 5) % 6;
    const sideAfter = cornerIndex;
    if (omittedSide !== sideBefore) return false;
    if (!isMazeSharedHallOpen(room.q, room.r, sideBefore, options)) return false;
    if (!isMazeSharedHallOpen(room.q, room.r, sideAfter, options)) return false;
    const beforeDir = MAZE_SECTION_DIRECTIONS[sideBefore];
    const afterDir = MAZE_SECTION_DIRECTIONS[sideAfter];
    if (!beforeDir || !afterDir) throw new Error("Wizard of Flatland maze three-hallway junction requires valid adjacent sides");
    const neighborSide = getMazeDirectionSide(afterDir.q - beforeDir.q, afterDir.r - beforeDir.r);
    if (!isMazeSharedHallOpen(room.q + beforeDir.q, room.r + beforeDir.r, neighborSide, options)) return false;

    const keys = [
        room.key,
        mazeSectionKey(room.q + beforeDir.q, room.r + beforeDir.r),
        mazeSectionKey(room.q + afterDir.q, room.r + afterDir.r)
    ].sort();
    return room.key === keys[0];
}

function shouldOpenMazeFourSectionHallwayLoopAtCorner(room, cornerIndex, omittedSide, options) {
    const sideBefore = (cornerIndex + 5) % 6;
    const sideAfter = cornerIndex;
    if (omittedSide !== sideBefore) return false;
    if (!isMazeSharedHallOpen(room.q, room.r, sideBefore, options)) return false;
    if (!isMazeSharedHallOpen(room.q, room.r, sideAfter, options)) return false;
    const beforeDir = MAZE_SECTION_DIRECTIONS[sideBefore];
    const afterDir = MAZE_SECTION_DIRECTIONS[sideAfter];
    if (!beforeDir || !afterDir) throw new Error("Wizard of Flatland maze four-section hallway loop requires valid adjacent sides");
    if (!isMazeSharedHallOpen(room.q + beforeDir.q, room.r + beforeDir.r, sideAfter, options)) return false;
    if (!isMazeSharedHallOpen(room.q + afterDir.q, room.r + afterDir.r, sideBefore, options)) return false;

    const diagonalKey = mazeSectionKey(room.q + beforeDir.q + afterDir.q, room.r + beforeDir.r + afterDir.r);
    return room.key === [room.key, diagonalKey].sort()[0];
}

function getMazeDirectionSide(q, r) {
    for (let side = 0; side < MAZE_SECTION_DIRECTIONS.length; side++) {
        const dir = MAZE_SECTION_DIRECTIONS[side];
        if (dir.q === q && dir.r === r) return side;
    }
    throw new Error(`Wizard of Flatland maze direction has no side: ${q},${r}`);
}

function getMazeHallwayWallCornerPocketClipPoint(room, cornerIndex, pocketSide, start, end) {
    if (!room.squareSideCorners.includes(cornerIndex)) return null;
    const length = Math.hypot(end.x - start.x, end.y - start.y);
    if (!(length > 0.000001)) throw new Error("Wizard of Flatland maze corner-pocket hallway clip requires separated endpoints");
    const direction = { x: (end.x - start.x) / length, y: (end.y - start.y) / length };
    const pocket = getMazeSquarePocketGeometry(room, cornerIndex, pocketSide);
    const pocketBoundary = getMazeSquarePocketBoundarySegments(room, pocket);
    let best = null;
    for (const boundary of pocketBoundary) {
        const hit = intersectLineWithSegment(start, direction, boundary.a, boundary.b);
        if (!hit || hit.lineT <= 0.001 || hit.lineT >= length - 0.001) continue;
        if (!best || hit.lineT < best.lineT) best = hit;
    }
    return best ? best.point : null;
}

function getMazeSquarePocketBoundarySegments(room, pocket) {
    if (!pocket || !Array.isArray(pocket.cornerWalls) || pocket.cornerWalls.length !== 2) {
        throw new Error("Wizard of Flatland maze corner-pocket hallway clip requires pocket boundary walls");
    }
    const first = pocket.cornerWalls[0];
    const second = pocket.cornerWalls[1];
    const span = intersectLineWithPolygonSpan(
        pocket.wallCenter,
        pocket.sideVector,
        room.sectionCorners,
        "Wizard of Flatland maze corner-pocket hallway clip back wall"
    );
    return [
        { a: pointOnLine(pocket.wallCenter, pocket.sideVector, span.start), b: first.gapEndpoint },
        { a: first.gapEndpoint, b: first.boundaryEnd },
        { a: first.boundaryEnd, b: second.boundaryEnd },
        { a: second.boundaryEnd, b: second.gapEndpoint },
        { a: second.gapEndpoint, b: pointOnLine(pocket.wallCenter, pocket.sideVector, span.end) }
    ];
}

function appendHalfHallwaySideWall(walls, start, end, sectionCorners) {
    const clippedEnd = shortenSegmentEndToPolygon(
        start,
        end,
        sectionCorners,
        "Wizard of Flatland maze half hallway wall"
    );
    if (Math.hypot(clippedEnd.x - start.x, clippedEnd.y - start.y) <= 0.5) return;
    appendSegmentWall(walls, start.x, start.y, clippedEnd.x, clippedEnd.y, WALL_LABEL_HALLWAY_SIDE_HALF);
}

function appendMazeHalfHallwayToSquarePocket(walls, room, side, connection, pocket, options = null) {
    const span = getMazeSquarePocketOrthogonalHallwaySpan(room, side, connection, pocket);
    const omissions = options
        ? getMazeThreeHallwayJunctionWallOmissions(room, side, options)
        : { left: false, right: false };
    if (!omissions.left) appendFullHallwaySideWall(walls, span.startGap.left, span.leftPoint, room.sectionCorners);
    appendFullHallwaySideWallWithJunctionOmission(
        walls,
        span.startGap.right,
        span.rightPoint,
        room,
        side,
        omissions.right
    );
}

function appendFullHallwaySideWall(walls, start, end, sectionCorners) {
    const clippedEnd = shortenSegmentEndToPolygon(
        start,
        end,
        sectionCorners,
        "Wizard of Flatland maze full hallway wall"
    );
    if (Math.hypot(clippedEnd.x - start.x, clippedEnd.y - start.y) <= 0.5) return;
    appendSegmentWall(walls, start.x, start.y, clippedEnd.x, clippedEnd.y, WALL_LABEL_HALLWAY_SIDE_FULL);
}

function appendFullHallwaySideWallWithJunctionOmission(walls, start, end, room, side, omitForJunction) {
    if (!omitForJunction) {
        appendFullHallwaySideWall(walls, start, end, room.sectionCorners);
        return;
    }
    const clippedEnd = shortenSegmentEndToPolygon(
        start,
        end,
        room.sectionCorners,
        "Wizard of Flatland maze omitted square-pocket hallway wall"
    );
    const cornerIndex = (side + 1) % 6;
    const clipPoint = getMazeHallwayWallCornerPocketClipPoint(room, cornerIndex, side, start, clippedEnd);
    if (!clipPoint) return;
    if (Math.hypot(clipPoint.x - start.x, clipPoint.y - start.y) <= 0.5) return;
    appendSegmentWall(walls, start.x, start.y, clipPoint.x, clipPoint.y, WALL_LABEL_HALLWAY_SIDE_FULL);
}

function getWallGapEndpointsForConnection(a, b, connection) {
    if (!connection) throw new Error("Wizard of Flatland maze hallway gap requires connection data");
    if (connection.fullWall) {
        return {
            left: { x: a.x, y: a.y },
            right: { x: b.x, y: b.y }
        };
    }
    return getWallGapEndpoints(a, b, connection.t, connection.width);
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

function pointOnLine(point, direction, t) {
    return {
        x: point.x + direction.x * t,
        y: point.y + direction.y * t
    };
}

function normalizeVector(x, y, errorMessage) {
    const length = Math.hypot(x, y);
    if (!(length > 0.000001)) throw new Error(errorMessage);
    return { x: x / length, y: y / length };
}

function intersectLineWithPolygonSpan(point, direction, polygon, label) {
    const hits = [];
    for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i];
        const b = polygon[(i + 1) % polygon.length];
        const hit = intersectLineWithSegment(point, direction, a, b);
        if (!hit) continue;
        addUniqueLineHit(hits, hit);
    }
    if (hits.length < 2) throw new Error(`${label} requires two section intersections`);
    hits.sort((a, b) => a.lineT - b.lineT);
    return {
        start: hits[0].lineT,
        end: hits[hits.length - 1].lineT,
        startEdgeDistanceScale: hits[0].edgeDistanceScale,
        endEdgeDistanceScale: hits[hits.length - 1].edgeDistanceScale
    };
}

function intersectRayWithPolygon(point, direction, polygon, label) {
    const hits = [];
    for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i];
        const b = polygon[(i + 1) % polygon.length];
        const hit = intersectLineWithSegment(point, direction, a, b);
        if (!hit || hit.lineT <= 0.000001) continue;
        addUniqueLineHit(hits, hit);
    }
    if (hits.length < 1) throw new Error(`${label} requires a forward section intersection`);
    hits.sort((a, b) => a.lineT - b.lineT);
    return { end: hits[0].point };
}

function intersectLineWithSegment(linePoint, lineDirection, segmentA, segmentB) {
    const sx = segmentB.x - segmentA.x;
    const sy = segmentB.y - segmentA.y;
    const denom = cross2d(lineDirection.x, lineDirection.y, sx, sy);
    if (Math.abs(denom) <= 0.000001) return null;
    const segmentLength = Math.hypot(sx, sy);
    if (!(segmentLength > 0.000001)) throw new Error("Wizard of Flatland maze line intersection requires a valid segment");
    const edgeCross = Math.abs(cross2d(lineDirection.x, lineDirection.y, sx / segmentLength, sy / segmentLength));
    if (!(edgeCross > 0.000001)) throw new Error("Wizard of Flatland maze line intersection requires a non-parallel edge");
    const qpx = segmentA.x - linePoint.x;
    const qpy = segmentA.y - linePoint.y;
    const lineT = cross2d(qpx, qpy, sx, sy) / denom;
    const segmentT = cross2d(qpx, qpy, lineDirection.x, lineDirection.y) / denom;
    if (segmentT < -0.000001 || segmentT > 1.000001) return null;
    return {
        lineT,
        edgeDistanceScale: 1 / edgeCross,
        point: {
            x: linePoint.x + lineDirection.x * lineT,
            y: linePoint.y + lineDirection.y * lineT
        }
    };
}

function intersectLineWithInfiniteLine(linePoint, lineDirection, otherA, otherB) {
    const sx = otherB.x - otherA.x;
    const sy = otherB.y - otherA.y;
    const denom = cross2d(lineDirection.x, lineDirection.y, sx, sy);
    if (Math.abs(denom) <= 0.000001) return null;
    const qpx = otherA.x - linePoint.x;
    const qpy = otherA.y - linePoint.y;
    const lineT = cross2d(qpx, qpy, sx, sy) / denom;
    return {
        lineT,
        point: {
            x: linePoint.x + lineDirection.x * lineT,
            y: linePoint.y + lineDirection.y * lineT
        }
    };
}

function addUniqueLineHit(hits, hit) {
    for (const existing of hits) {
        if (Math.hypot(existing.point.x - hit.point.x, existing.point.y - hit.point.y) < 0.0001) return;
    }
    hits.push(hit);
}

function cross2d(ax, ay, bx, by) {
    return ax * by - ay * bx;
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
                blockedEdges.push(node.index, neighbor.index, w / WALL_STRIDE, 0);
            }
        }
    }

    const edgeValues = [];
    for (const node of nodes) {
        for (let dir = 0; dir < node.neighbors.length; dir++) {
            const neighbor = node.neighbors[dir];
            if (!neighbor) continue;
            if (node.blockedNeighbors.has(dir)) continue;
            edgeValues.push(node.index, neighbor.index, dir, 0);
        }
    }

    const packedNodes = new Float32Array(nodes.length * PATH_SNAPSHOT_NODE_STRIDE);
    const packedEdges = new Int32Array(edgeValues);
    for (const node of nodes) {
        node.blocked = !isPathfindingNodeTerrainPassable(node, walls, targetRadius);
    }
    for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        const base = i * PATH_SNAPSHOT_NODE_STRIDE;
        packedNodes[base + PATH_NODE_X] = node.x;
        packedNodes[base + PATH_NODE_Y] = node.y;
        packedNodes[base + PATH_NODE_BLOCKED] = node.blocked ? 1 : 0;
        packedNodes[base + PATH_NODE_CLEARANCE] = Infinity;
        packedNodes[base + PATH_NODE_XINDEX] = node.xindex;
        packedNodes[base + PATH_NODE_YINDEX] = node.yindex;
        packedNodes[base + PATH_NODE_HAS_UNBLOCKED_NEIGHBOR] = hasUnblockedPathfindingNeighbor(node) ? 1 : 0;
        packedNodes[base + 7] = 0;
    }

    return {
        pathCenterX: (bounds.minX + bounds.maxX) * 0.5,
        pathCenterY: (bounds.minY + bounds.maxY) * 0.5,
        nodes: packedNodes,
        snapshotNodes: packedNodes.slice(),
        edges: packedEdges,
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

function hasUnblockedPathfindingNeighbor(node) {
    for (let dir = 0; dir < node.neighbors.length; dir++) {
        const neighbor = node.neighbors[dir];
        if (!neighbor || neighbor.blocked === true) continue;
        if (node.blockedNeighbors.has(dir)) continue;
        return true;
    }
    return false;
}

function isPathfindingNodeTerrainPassable(node, walls, targetRadius) {
    if (!node || !Number.isFinite(node.x) || !Number.isFinite(node.y)) {
        throw new Error("Wizard of Flatland maze worker passability requires a finite node");
    }
    for (let i = 0; i < walls.length; i += WALL_STRIDE) {
        const distance = pointSegmentDistance(node.x, node.y, walls[i], walls[i + 1], walls[i + 2], walls[i + 3]);
        if (distance < targetRadius + WALL_WORLD_HALF_THICKNESS) return false;
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
