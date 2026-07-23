const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function loadMazeWorkerExports() {
    const workerPath = path.join(__dirname, "../public/wizard-of-flatland/mazeSectionWorker.js");
    const source = fs.readFileSync(workerPath, "utf8");
    const context = {
        Float32Array,
        Int32Array,
        Map,
        Math,
        Number,
        Set,
        String,
        importScripts() {},
        self: {
            WallGeometry: {
                connectionCrossesWallFaces() {
                    return false;
                }
            },
            postMessage() {},
            addEventListener() {}
        }
    };
    vm.createContext(context);
    vm.runInContext(`${source}
        self.__mazeWorkerTestExports = {
            MAZE_SQUARE_ROOM_SIDE_CHANCE,
            MAZE_SQUARE_ROOM_OPPOSITE_SIDE_CHANCE,
            MAZE_SQUARE_ROOM_SIDE_OFFSET,
            MAZE_SQUARE_ROOM_SIDE_GAP_WIDTH,
            MAZE_SQUARE_ROOM_WALL_END_SHORTEN,
            MAZE_SQUARE_ROOM_HALLWAY_SNAP_DISTANCE,
            MAZE_SQUARE_ROOM_POCKET_INCORPORATE_CHANCE,
            MAZE_FULL_WALL_HALLWAY_CHANCE,
            MAZE_OUTSIDE_DOOR_WIDE_WIDTH,
            MAZE_OUTSIDE_DOOR_WIDE_CHANCE,
            MAZE_OUTSIDE_DOOR_FULL_WALL_CHANCE,
            WALL_WORLD_THICKNESS,
            WALL_WORLD_HALF_THICKNESS,
            WALL_LABEL_ROOM_POCKET_OVERRIDE,
            WALL_LABEL_ROOM_POCKET_OVERRIDE_HALL_GAP,
            WALL_LABEL_ROOM_POCKET_CONNECTOR,
            WALL_LABEL_SQUARE_SIDE_PARALLEL,
            WALL_LABEL_SQUARE_SIDE_PERPENDICULAR_FULL,
            WALL_LABEL_HALLWAY_SIDE_HALF,
            WALL_LABEL_HALLWAY_SIDE_FULL,
            getMazeSquarePocketIncorporateChance,
            MAZE_DOOR_WIDTH,
            getMazeOutsideDoorOpening,
            buildMazeRoom,
            buildMazeSquarePocketMutation,
            getMazeSquarePocketExtendedWallEnd,
            getMazeSquarePocketTrimmedWallEnd,
            buildMazeSquarePocketWallPlan,
            createWallBufferBuilder,
            finishWallBuffer,
            getHexCornersWorld,
            getMazeSharedHallConnection,
            canMazeSharedHallwayUseFullWall,
            getMazeSectionOutsideDoor,
            getMazeSectionSquareSideCorners,
            getSquaredMazeRoomCorners,
            appendMazeSectionWalls,
            appendMazeRoomWalls,
            appendMazeSquareSideWalls,
            appendMazeHalfHallwayToNeighbor,
            appendMazeHalfHallwayToSquarePocket,
            getMazeSquarePocketGeometry,
            getMazeSquarePocketIncorporationMutation,
            getMazeSectionIncomingSquarePocketMutations,
            getMazeSquarePocketHallwayTarget,
            getMazeSquarePocketWallColinearity,
            canMazeSquarePocketConnectToSide,
            isMazeRoomSideSquaredOff,
            getMazeHalfHallwayBoundarySegments,
            getMazeSquarePocketOrthogonalHallwaySpan,
            getMazeThreeHallwayJunctionWallOmissions,
            areMazeHallwayAdjoiningSidesDefaultHex,
            appendHalfHallwaySideWallWithJunctionOmission,
            getMazeHallwayWallCornerPocketClipPoint,
            isMazeRoomSideDefaultHex,
            isMazeSquarePocketIncorporatedByNeighbor,
            isMazeHallwaySuppressedByIncomingSquarePocket,
            shouldMazeSquarePocketIncorporate,
            getMazeHallwayCorridorLineInterval,
            trimLineIntervalsAtHallway,
            subtractLineInterval,
            getWallGapEndpointsForConnection,
            normalizeVector,
            pointOnLine,
            intersectLineWithSegment,
            intersectLineWithPolygonSpan,
            intersectRayWithPolygon,
            isPathfindingNodeTerrainPassable,
            pointProjectionParameter
        };
    `, context);
    return context.self.__mazeWorkerTestExports;
}

function wallSegments(buffer) {
    const segments = [];
    for (let i = 0; i < buffer.length; i += 8) {
        segments.push({
            ax: buffer[i],
            ay: buffer[i + 1],
            bx: buffer[i + 2],
            by: buffer[i + 3],
            labelCode: buffer[i + 4],
            sideCode: buffer[i + 5]
        });
    }
    return segments;
}

function segmentLength(segment) {
    return Math.hypot(segment.bx - segment.ax, segment.by - segment.ay);
}

function pointSegmentDistance(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq)) : 0;
    const closestX = ax + dx * t;
    const closestY = ay + dy * t;
    return Math.hypot(px - closestX, py - closestY);
}

function pointPolygonEdgeDistance(point, polygon) {
    let best = Infinity;
    for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i];
        const b = polygon[(i + 1) % polygon.length];
        best = Math.min(best, pointSegmentDistance(point.x, point.y, a.x, a.y, b.x, b.y));
    }
    return best;
}

function pointInPolygon(point, polygon) {
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

function pointInOrOnPolygon(point, polygon, edgeTolerance = 0.001) {
    return pointInPolygon(point, polygon) || pointPolygonEdgeDistance(point, polygon) <= edgeTolerance;
}

function lineDistanceToPoint(lineA, lineB, point) {
    const dx = lineB.x - lineA.x;
    const dy = lineB.y - lineA.y;
    const length = Math.hypot(dx, dy);
    return Math.abs((point.x - lineA.x) * (dy / length) - (point.y - lineA.y) * (dx / length));
}

function segmentsCrossAwayFromEndpoints(first, second) {
    const rx = first.bx - first.ax;
    const ry = first.by - first.ay;
    const sx = second.bx - second.ax;
    const sy = second.by - second.ay;
    const denominator = rx * sy - ry * sx;
    if (Math.abs(denominator) <= 0.000001) return false;
    const qpx = second.ax - first.ax;
    const qpy = second.ay - first.ay;
    const firstT = (qpx * sy - qpy * sx) / denominator;
    const secondT = (qpx * ry - qpy * rx) / denominator;
    return firstT > 0.001 && firstT < 0.999 && secondT > 0.001 && secondT < 0.999;
}

test("Wizard of Flatland generated walls stay inside their native map section", () => {
    const api = loadMazeWorkerExports();
    const options = {
        seed: "hex-maze-1",
        chunkSize: 44,
        roomScale: 0.56,
        twistiness: 0.62
    };

    for (let q = -20; q <= 20; q++) {
        for (let r = -20; r <= 20; r++) {
            const room = api.buildMazeRoom(q, r, options);
            const walls = api.createWallBufferBuilder();
            api.appendMazeSectionWalls(walls, q, r, options);
            const segments = wallSegments(api.finishWallBuffer(walls));
            for (let index = 0; index < segments.length; index++) {
                const segment = segments[index];
                const a = { x: segment.ax, y: segment.ay };
                const b = { x: segment.bx, y: segment.by };
                assert.ok(
                    pointInOrOnPolygon(a, room.sectionCorners) && pointInOrOnPolygon(b, room.sectionCorners),
                    `wall ${index} for section ${q},${r} extends outside its native section: `
                        + `label=${segment.labelCode} side=${segment.sideCode} `
                        + `(${a.x.toFixed(3)},${a.y.toFixed(3)}) -> (${b.x.toFixed(3)},${b.y.toFixed(3)})`
                );
            }
        }
    }
});

test("Wizard of Flatland pocket wall shortening keeps the original direction", () => {
    const api = loadMazeWorkerExports();
    const options = {
        seed: "hex-maze-1",
        chunkSize: 44,
        roomScale: 0.56,
        twistiness: 0.62
    };
    const room = api.buildMazeRoom(-20, -17, options);
    const mutation = api.getMazeSectionIncomingSquarePocketMutations(room, options)
        .find((candidate) => candidate.extendSide === 2);
    assert.ok(mutation, "test fixture should find the escaping side-2 pocket mutation");

    const shortened = api.getMazeSquarePocketExtendedWallEnd(mutation, room.sectionCorners);
    const fullDx = mutation.connectorBoundaryEnd.x - mutation.extendFrom.x;
    const fullDy = mutation.connectorBoundaryEnd.y - mutation.extendFrom.y;
    const shortDx = shortened.x - mutation.extendFrom.x;
    const shortDy = shortened.y - mutation.extendFrom.y;
    const fullLength = Math.hypot(fullDx, fullDy);
    const shortLength = Math.hypot(shortDx, shortDy);
    const directionCross = Math.abs((fullDx / fullLength) * (shortDy / shortLength) - (fullDy / fullLength) * (shortDx / shortLength));

    assert.ok(shortLength < fullLength, "pocket wall fix should shorten the extended wall");
    assert.ok(directionCross < 0.000001, "pocket wall fix should not rotate the extended wall");
    assert.ok(pointInOrOnPolygon(shortened, room.sectionCorners), "shortened endpoint should stay in the native section");
});

test("Wizard of Flatland maze square side selection uses requested side odds", () => {
    const api = loadMazeWorkerExports();

    assert.equal(api.MAZE_DOOR_WIDTH, 3);
    assert.equal(api.MAZE_OUTSIDE_DOOR_WIDE_WIDTH, 5);
    assert.equal(api.MAZE_OUTSIDE_DOOR_WIDE_CHANCE, 1 / 3);
    assert.equal(api.MAZE_OUTSIDE_DOOR_FULL_WALL_CHANCE, 1 / 3);
    assert.equal(api.MAZE_SQUARE_ROOM_SIDE_CHANCE, 1 / 10);
    assert.equal(api.MAZE_SQUARE_ROOM_OPPOSITE_SIDE_CHANCE, 2 / 3);
    assert.equal(api.MAZE_SQUARE_ROOM_POCKET_INCORPORATE_CHANCE, 0.4);

    const selected = api.getMazeSectionSquareSideCorners(0, 0, {
        seed: "square-side-opposite-example",
        chunkSize: 44,
        roomScale: 0.56,
        twistiness: 0.62
    });
    for (const cornerIndex of selected) {
        assert.ok(Number.isInteger(cornerIndex));
        assert.ok(cornerIndex >= 0 && cornerIndex < 6);
    }
});

test("Wizard of Flatland path nodes reserve the rendered wall thickness", () => {
    const api = loadMazeWorkerExports();
    const targetRadius = 0.42;
    const walls = new Float32Array([0, 0, 10, 0, 0, 0, 0, 0]);
    const justInsideVisualWall = {
        x: 5,
        y: targetRadius + api.WALL_WORLD_HALF_THICKNESS - 0.001
    };
    const justOutsideVisualWall = {
        x: 5,
        y: targetRadius + api.WALL_WORLD_HALF_THICKNESS + 0.001
    };

    assert.equal(api.WALL_WORLD_THICKNESS, 0.3);
    assert.equal(api.isPathfindingNodeTerrainPassable(justInsideVisualWall, walls, targetRadius), false);
    assert.equal(api.isPathfindingNodeTerrainPassable(justOutsideVisualWall, walls, targetRadius), true);
});

test("Wizard of Flatland room doors are 3 meters wide without perpendicular posts", () => {
    const api = loadMazeWorkerExports();
    const options = {
        seed: "outside-fixture-1",
        chunkSize: 44,
        roomScale: 0.56,
        twistiness: 0.62
    };
    const hallConnection = api.getMazeSharedHallConnection(0, 0, 0, options, false);
    assert.equal(hallConnection.width, 3);

    const outsideDoor = api.getMazeSectionOutsideDoor(0, 0, options, new Set());
    assert.ok(outsideDoor, "test fixture should have an outside door side");
    assert.equal(outsideDoor.width, 3);
    assert.equal(outsideDoor.fullWall, false);

    const room = api.buildMazeRoom(0, 0, options);
    const walls = api.createWallBufferBuilder();
    api.appendMazeRoomWalls(walls, room, new Map(), outsideDoor);
    const segments = wallSegments(api.finishWallBuffer(walls));
    const doorSide = outsideDoor.side;
    const a = room.corners[doorSide];
    const b = room.corners[(doorSide + 1) % 6];
    const sideVector = api.normalizeVector(b.x - a.x, b.y - a.y, "test door side vector");
    const sideSegments = segments.filter((segment) => {
        const dx = segment.bx - segment.ax;
        const dy = segment.by - segment.ay;
        const length = Math.hypot(dx, dy);
        if (!(length > 0.001)) return false;
        return Math.abs(dx / length - sideVector.x) < 0.00001 && Math.abs(dy / length - sideVector.y) < 0.00001
            && pointSegmentDistance(segment.ax, segment.ay, a.x, a.y, b.x, b.y) < 0.00001
            && pointSegmentDistance(segment.bx, segment.by, a.x, a.y, b.x, b.y) < 0.00001;
    });
    const postLikeSegments = segments.filter((segment) => {
        const dx = segment.bx - segment.ax;
        const dy = segment.by - segment.ay;
        const length = Math.hypot(dx, dy);
        if (!(length > 0.001)) return false;
        const perpendicular = Math.abs(dx / length * sideVector.x + dy / length * sideVector.y) < 0.00001;
        return perpendicular
            && pointSegmentDistance(segment.ax, segment.ay, a.x, a.y, b.x, b.y) < 2
            && pointSegmentDistance(segment.bx, segment.by, a.x, a.y, b.x, b.y) < 2;
    });

    assert.equal(sideSegments.length, 2);
    assert.equal(postLikeSegments.length, 0);
    const gap = Math.hypot(sideSegments[1].ax - sideSegments[0].bx, sideSegments[1].ay - sideSegments[0].by);
    assert.ok(Math.abs(gap - 3) < 0.00001);
});

test("Wizard of Flatland outside doors use normal, wide, and full-wall variants", () => {
    const api = loadMazeWorkerExports();
    const normalOpening = api.getMazeOutsideDoorOpening("outside-fixture-1|outside-door-opening|0,0");
    const wideOpening = api.getMazeOutsideDoorOpening("outside-fixture-2|outside-door-opening|0,0");
    const fullWallOpening = api.getMazeOutsideDoorOpening("outside-fixture-0|outside-door-opening|0,0");

    assert.equal(normalOpening.width, 3);
    assert.equal(normalOpening.fullWall, false);
    assert.equal(wideOpening.width, 5);
    assert.equal(wideOpening.fullWall, false);
    assert.equal(fullWallOpening.width, 3);
    assert.equal(fullWallOpening.fullWall, true);

    const fullWallDoor = api.getMazeSectionOutsideDoor(0, 0, {
        seed: "outside-fixture-0",
        chunkSize: 44,
        roomScale: 0.56,
        twistiness: 0.62
    }, new Set());
    const room = api.buildMazeRoom(0, 0, {
        seed: "outside-fixture-0",
        chunkSize: 44,
        roomScale: 0.56,
        twistiness: 0.62
    });
    const walls = api.createWallBufferBuilder();
    api.appendMazeRoomWalls(walls, room, new Map(), fullWallDoor);
    const segments = wallSegments(api.finishWallBuffer(walls));

    assert.equal(fullWallDoor.fullWall, true);
    assert.equal(segments.some((segment) => segment.labelCode === 12 && segment.sideCode === fullWallDoor.side), false);
});

test("Wizard of Flatland hallways can open across the full wall", () => {
    const api = loadMazeWorkerExports();
    const options = {
        seed: "hex-maze-1",
        chunkSize: 44,
        roomScale: 0.56,
        twistiness: 0.62
    };
    const room = api.buildMazeRoom(-40, -34, options);
    const side = 5;
    const connection = api.getMazeSharedHallConnection(-40, -34, side, options, true);
    const gap = api.getWallGapEndpointsForConnection(room.corners[side], room.corners[(side + 1) % 6], connection);

    assert.equal(api.MAZE_FULL_WALL_HALLWAY_CHANCE, 1 / 2);
    assert.equal(api.canMazeSharedHallwayUseFullWall(-40, -34, side, options), true);
    assert.equal(connection.fullWall, true);
    assert.equal(connection.width, 3);
    assert.ok(Math.hypot(gap.left.x - room.corners[side].x, gap.left.y - room.corners[side].y) < 0.00001);
    assert.ok(Math.hypot(gap.right.x - room.corners[(side + 1) % 6].x, gap.right.y - room.corners[(side + 1) % 6].y) < 0.00001);

    const walls = api.createWallBufferBuilder();
    api.appendMazeRoomWalls(walls, room, new Map([[side, connection]]), null);
    const segments = wallSegments(api.finishWallBuffer(walls));
    assert.equal(segments.some((segment) => segment.labelCode === 11 && segment.sideCode === side), false);

    assert.equal(api.canMazeSharedHallwayUseFullWall(-20, -20, 2, options), false);
    assert.equal(api.getMazeSharedHallConnection(-20, -20, 2, options, true).fullWall, false);
});

test("Wizard of Flatland eligible full-wall hallways occur roughly half of the time", () => {
    const api = loadMazeWorkerExports();
    const options = {
        seed: "full-wall-hallway-rate",
        chunkSize: 44,
        roomScale: 0.56,
        twistiness: 0.62
    };
    let open = 0;
    let eligible = 0;
    let fullWall = 0;
    for (let q = -30; q <= 30; q++) {
        for (let r = -30; r <= 30; r++) {
            for (let side = 0; side < 6; side++) {
                const connection = api.getMazeSharedHallConnection(q, r, side, options, false);
                assert.equal(connection.width, 3);
                if (!connection.open) continue;
                open += 1;
                if (!api.canMazeSharedHallwayUseFullWall(q, r, side, options)) {
                    assert.equal(connection.fullWall, false);
                    continue;
                }
                eligible += 1;
                if (connection.fullWall) fullWall += 1;
            }
        }
    }
    const rate = fullWall / eligible;

    assert.ok(open > 1000, "test fixture should sample enough open hallways");
    assert.ok(eligible > 500, "test fixture should sample enough eligible open hallways");
    assert.ok(rate > 0.47 && rate < 0.53, `expected roughly 50%, got ${rate}`);
});

test("Wizard of Flatland outside doors never use hallway sides", () => {
    const api = loadMazeWorkerExports();
    const seeds = [
        "hex-maze-1",
        "door-hall-overlap-a",
        "door-hall-overlap-b",
        "door-hall-overlap-c"
    ];

    for (const seed of seeds) {
        const options = {
            seed,
            chunkSize: 44,
            roomScale: 0.56,
            twistiness: 0.62
        };
        for (let q = -20; q <= 20; q++) {
            for (let r = -20; r <= 20; r++) {
                const hallSides = new Set();
                for (let side = 0; side < 6; side++) {
                    const connection = api.getMazeSharedHallConnection(q, r, side, options, false);
                    if (connection.open) hallSides.add(side);
                }
                const outsideDoor = api.getMazeSectionOutsideDoor(q, r, options, hallSides);
                if (!outsideDoor) continue;

                assert.equal(
                    hallSides.has(outsideDoor.side),
                    false,
                    `outside door overlaps hallway side ${outsideDoor.side} for ${q},${r} seed=${seed}`
                );
            }
        }
    }
});

test("Wizard of Flatland opens one wall at three-hallway junctions", () => {
    const api = loadMazeWorkerExports();
    const options = {
        seed: "hex-maze-1",
        chunkSize: 44,
        roomScale: 0.56,
        twistiness: 0.62
    };
    const room = api.buildMazeRoom(-30, -25, options);
    const side = 2;

    assert.equal(api.getMazeSharedHallConnection(-30, -25, 2, options, false).open, true);
    assert.equal(api.getMazeSharedHallConnection(-30, -25, 3, options, false).open, true);
    assert.equal(api.getMazeSharedHallConnection(-31, -24, 4, options, false).open, true);
    const omissions = api.getMazeThreeHallwayJunctionWallOmissions(room, side, options);
    assert.equal(omissions.left, false);
    assert.equal(omissions.right, true);

    const walls = api.createWallBufferBuilder();
    api.appendMazeHalfHallwayToNeighbor(
        walls,
        room,
        side,
        api.getMazeSharedHallConnection(-30, -25, side, options, true),
        options
    );
    const segments = wallSegments(api.finishWallBuffer(walls));

    assert.equal(segments.length, 1);
    assert.equal(segments[0].labelCode, api.WALL_LABEL_HALLWAY_SIDE_HALF);

    const neighborRoom = api.buildMazeRoom(-31, -24, options);
    const neighborSide = 5;
    const neighborOmissions = api.getMazeThreeHallwayJunctionWallOmissions(neighborRoom, neighborSide, options);
    assert.equal(neighborOmissions.left, true);
    assert.equal(neighborOmissions.right, false);

    const neighborWalls = api.createWallBufferBuilder();
    api.appendMazeHalfHallwayToNeighbor(
        neighborWalls,
        neighborRoom,
        neighborSide,
        api.getMazeSharedHallConnection(-31, -24, neighborSide, options, true),
        options
    );
    const neighborSegments = wallSegments(api.finishWallBuffer(neighborWalls));

    assert.equal(neighborSegments.length, 1);
    assert.equal(neighborSegments[0].labelCode, api.WALL_LABEL_HALLWAY_SIDE_HALF);
});

test("Wizard of Flatland opens one wall at four-section hallway loops", () => {
    const api = loadMazeWorkerExports();
    const options = {
        seed: "four-loop-0",
        chunkSize: 44,
        roomScale: 0.56,
        twistiness: 0.62,
        squarePocketIncorporateChance: 1
    };
    const room = api.buildMazeRoom(-2, -1, options);
    const side = 5;

    assert.equal(api.getMazeSharedHallConnection(-2, -1, 5, options, false).open, true);
    assert.equal(api.getMazeSharedHallConnection(-2, -1, 0, options, false).open, true);
    assert.equal(api.getMazeSharedHallConnection(-1, -2, 0, options, false).open, true);
    assert.equal(api.getMazeSharedHallConnection(-1, -1, 5, options, false).open, true);
    assert.equal(api.getMazeSharedHallConnection(-1, -2, 1, options, false).open, false);
    const omissions = api.getMazeThreeHallwayJunctionWallOmissions(room, side, options);
    assert.equal(omissions.left, false);
    assert.equal(omissions.right, true);

    const walls = api.createWallBufferBuilder();
    api.appendMazeHalfHallwayToNeighbor(
        walls,
        room,
        side,
        api.getMazeSharedHallConnection(-2, -1, side, options, true),
        options
    );
    const segments = wallSegments(api.finishWallBuffer(walls));

    assert.equal(segments.length, 1);
    assert.equal(segments[0].labelCode, api.WALL_LABEL_HALLWAY_SIDE_HALF);
});

test("Wizard of Flatland three-hallway omission clips against corner pocket back walls", () => {
    const api = loadMazeWorkerExports();
    const options = {
        seed: "hex-maze-1",
        chunkSize: 44,
        roomScale: 0.56,
        twistiness: 0.62
    };
    const room = api.buildMazeRoom(-78, 78, options);
    const side = 1;
    const connection = api.getMazeSharedHallConnection(-78, 78, side, options, true);

    assert.equal(room.squareSideCorners.join(","), "2,5");
    assert.equal(connection.fullWall, false);
    assert.equal(api.getMazeThreeHallwayJunctionWallOmissions(room, side, options).right, true);

    const walls = api.createWallBufferBuilder();
    api.appendMazeHalfHallwayToNeighbor(walls, room, side, connection, options);
    const segments = wallSegments(api.finishWallBuffer(walls));
    const pocketWalls = api.createWallBufferBuilder();
    api.appendMazeSquareSideWalls(pocketWalls, room, new Map(), options);
    const backWallSegments = wallSegments(api.finishWallBuffer(pocketWalls))
        .filter((segment) => segment.labelCode === api.WALL_LABEL_SQUARE_SIDE_PARALLEL && segment.sideCode === (side + 1) % 6);
    const omittedSideSegment = segments.find((segment) => (
        segment.labelCode === api.WALL_LABEL_HALLWAY_SIDE_HALF &&
            backWallSegments.some((backWall) => (
                pointSegmentDistance(segment.bx, segment.by, backWall.ax, backWall.ay, backWall.bx, backWall.by) < 0.00001
            ))
    ));

    assert.equal(segments.length, 2);
    assert.ok(omittedSideSegment, "partially omitted wall should keep the inner segment");
});

test("Wizard of Flatland square pocket incorporation is configurable and defaults to forty percent", () => {
    const api = loadMazeWorkerExports();
    assert.equal(api.getMazeSquarePocketIncorporateChance({}), 0.4);
    assert.equal(api.getMazeSquarePocketIncorporateChance({ squarePocketIncorporateChance: 0.4 }), 0.4);
    assert.equal(api.getMazeSquarePocketIncorporateChance({ squarePocketIncorporateChance: -1 }), 0);
    assert.equal(api.getMazeSquarePocketIncorporateChance({ squarePocketIncorporateChance: 2 }), 1);

    let incorporated = 0;
    const total = 2000;
    for (let i = 0; i < total; i++) {
        if (api.shouldMazeSquarePocketIncorporate(i, -i, 0, 0, {
            seed: "square-pocket-rate",
            chunkSize: 44,
            roomScale: 0.56,
            twistiness: 0.62
        })) {
            incorporated += 1;
        }
    }
    const rate = incorporated / total;
    assert.ok(rate > 0.35 && rate < 0.45, `expected roughly 40%, got ${rate}`);
});

test("Wizard of Flatland maze squares at most one corner pair per room", () => {
    const api = loadMazeWorkerExports();
    const options = {
        seed: "square-side-selection-shape",
        chunkSize: 44,
        roomScale: 0.56,
        twistiness: 0.62
    };

    for (let q = -40; q <= 40; q++) {
        for (let r = -40; r <= 40; r++) {
            const selected = api.getMazeSectionSquareSideCorners(q, r, options);
            assert.ok(selected.length <= 2, `too many squared corners for ${q},${r}: ${selected}`);
            if (selected.length === 2) {
                assert.equal((selected[0] + 3) % 6, selected[1], `squared corners must be opposite for ${q},${r}: ${selected}`);
            }
        }
    }
});

test("Wizard of Flatland square room side projects a vertex onto its neighbor line", () => {
    const api = loadMazeWorkerExports();
    const corners = api.getHexCornersWorld(0, 0, 20);
    const squared = api.getSquaredMazeRoomCorners(corners, [0]);
    const moved = squared[0];
    const previous = corners[5];
    const next = corners[1];
    const t = api.pointProjectionParameter(moved.x, moved.y, previous.x, previous.y, next.x, next.y);

    assert.ok(t > 0 && t < 1);
    assert.ok(Math.hypot(moved.x - corners[0].x, moved.y - corners[0].y) > 1);
    assert.ok(Math.abs(moved.x - (previous.x + (next.x - previous.x) * t)) < 0.000001);
    assert.ok(Math.abs(moved.y - (previous.y + (next.y - previous.y) * t)) < 0.000001);
});

test("Wizard of Flatland deletes unused corner pockets", () => {
    const api = loadMazeWorkerExports();
    const center = { x: 0, y: 0 };
    const hexRoomCorners = api.getHexCornersWorld(center.x, center.y, 20);
    const room = {
        center,
        radius: 20,
        squareSideCorners: [0],
        sectionCorners: api.getHexCornersWorld(center.x, center.y, 22),
        corners: api.getSquaredMazeRoomCorners(hexRoomCorners, [0])
    };
    const walls = api.createWallBufferBuilder();

    api.appendMazeSquareSideWalls(walls, room, new Map(), {
        seed: "square-wall-geometry",
        chunkSize: 44,
        roomScale: 0.56,
        twistiness: 0.62,
        squarePocketIncorporateChance: 0
    });
    const segments = wallSegments(api.finishWallBuffer(walls));

    assert.equal(segments.length, 0);
});

test("Wizard of Flatland corner pocket back wall stops at hallway corridor when not incorporated", () => {
    const api = loadMazeWorkerExports();
    const options = {
        seed: "square-side-hallway-cut-3",
        chunkSize: 44,
        roomScale: 0.56,
        twistiness: 0.62,
        squarePocketIncorporateChance: 0
    };
    const center = { x: 0, y: 0 };
    const hexRoomCorners = api.getHexCornersWorld(center.x, center.y, 20);
    const room = {
        q: 0,
        r: 0,
        key: "0,0",
        center,
        radius: 20,
        squareSideCorners: [0],
        sectionCorners: api.getHexCornersWorld(center.x, center.y, 22),
        corners: api.getSquaredMazeRoomCorners(hexRoomCorners, [0])
    };
    let connection = null;
    for (let i = 0; i < 100 && !connection; i++) {
        const candidateOptions = { ...options, seed: `square-side-hallway-cut-${i}` };
        const candidate = api.getMazeSharedHallConnection(0, 0, 0, candidateOptions, false);
        if (candidate.open && !candidate.fullWall) {
            connection = candidate;
            options.seed = candidateOptions.seed;
        }
    }
    assert.ok(connection, "test fixture should find an open side-0 hallway");

    const walls = api.createWallBufferBuilder();
    api.appendMazeSquareSideWalls(walls, room, new Map([[0, connection]]), options);
    const segments = wallSegments(api.finishWallBuffer(walls));

    const squaredCorner = room.corners[0];
    const originalCorner = hexRoomCorners[0];
    const sideVector = api.normalizeVector(room.corners[1].x - room.corners[5].x, room.corners[1].y - room.corners[5].y, "test side vector");
    const outward = api.normalizeVector(originalCorner.x - squaredCorner.x, originalCorner.y - squaredCorner.y, "test outward");
    const wallCenter = {
        x: squaredCorner.x + outward.x * api.MAZE_SQUARE_ROOM_SIDE_OFFSET,
        y: squaredCorner.y + outward.y * api.MAZE_SQUARE_ROOM_SIDE_OFFSET
    };
    const hallwayInterval = api.getMazeHallwayCorridorLineInterval(room, 0, connection, wallCenter, sideVector, options);
    const parallelSegments = segments.filter((segment) => {
        const dx = segment.bx - segment.ax;
        const dy = segment.by - segment.ay;
        const length = Math.hypot(dx, dy);
        return Math.abs(dx / length - sideVector.x) < 0.00001 && Math.abs(dy / length - sideVector.y) < 0.00001;
    });

    assert.ok(parallelSegments.length >= 1);
    let foundCenterToHallwaySegment = false;
    for (const segment of parallelSegments) {
        const start = api.pointProjectionParameter(segment.ax, segment.ay, wallCenter.x, wallCenter.y, wallCenter.x + sideVector.x, wallCenter.y + sideVector.y);
        const end = api.pointProjectionParameter(segment.bx, segment.by, wallCenter.x, wallCenter.y, wallCenter.x + sideVector.x, wallCenter.y + sideVector.y);
        assert.ok(end <= hallwayInterval.start + 0.00001 || start >= hallwayInterval.end - 0.00001);
        assert.ok(start < hallwayInterval.end - 0.00001, "square side wall should not continue beyond the far hallway edge");
        if (start >= api.MAZE_SQUARE_ROOM_SIDE_GAP_WIDTH * 0.5 - 0.00001 && Math.abs(end - hallwayInterval.start) < 0.00001) {
            foundCenterToHallwaySegment = true;
        }
    }
    assert.equal(foundCenterToHallwaySegment, true);
});

test("Wizard of Flatland corner pocket back walls snap to nearby hallway edges", () => {
    const api = loadMazeWorkerExports();
    const hallwayInterval = { start: 9, end: 12 };

    assert.equal(api.MAZE_SQUARE_ROOM_HALLWAY_SNAP_DISTANCE, 3);

    const negativeSide = api.trimLineIntervalsAtHallway([{ start: 0, end: 7 }], hallwayInterval, false);
    assert.equal(negativeSide.length, 1);
    assert.equal(negativeSide[0].start, 0);
    assert.equal(negativeSide[0].end, 9);

    const positiveSide = api.trimLineIntervalsAtHallway([{ start: 14, end: 20 }], hallwayInterval, true);
    assert.equal(positiveSide.length, 1);
    assert.equal(positiveSide[0].start, 12);
    assert.equal(positiveSide[0].end, 20);

    const farNegativeSide = api.trimLineIntervalsAtHallway([{ start: 0, end: 5.9 }], hallwayInterval, false);
    assert.equal(farNegativeSide.length, 1);
    assert.equal(farNegativeSide[0].end, 5.9);

    const incorporatedCut = api.subtractLineInterval([
        { start: 0, end: 7 },
        { start: 14, end: 20 }
    ], hallwayInterval.start, hallwayInterval.end);
    assert.equal(incorporatedCut.length, 2);
    assert.equal(incorporatedCut[0].end, 9);
    assert.equal(incorporatedCut[1].start, 12);
});

test("Wizard of Flatland incorporated corner pocket back wall gaps and resumes at hallway", () => {
    const api = loadMazeWorkerExports();
    const options = {
        seed: "square-pocket-back-wall-hallway-fixture-3",
        chunkSize: 44,
        roomScale: 0.56,
        twistiness: 0.62,
        squarePocketIncorporateChance: 1
    };
    const room = api.buildMazeRoom(0, 0, options);
    const cornerIndex = 3;
    const side = 3;
    const connection = api.getMazeSharedHallConnection(0, 0, side, options, true);

    assert.equal(room.squareSideCorners.join(","), "0,3");
    assert.equal(api.isMazeSquarePocketIncorporatedByNeighbor(room, cornerIndex, side, options), true);

    const walls = api.createWallBufferBuilder();
    api.appendMazeSquareSideWalls(walls, room, new Map([[side, connection]]), options);
    const segments = wallSegments(api.finishWallBuffer(walls));
    const originalCorner = api.getHexCornersWorld(room.center.x, room.center.y, room.radius)[cornerIndex];
    const squaredCorner = room.corners[cornerIndex];
    const sideVector = api.normalizeVector(
        room.corners[(cornerIndex + 1) % 6].x - room.corners[(cornerIndex + 5) % 6].x,
        room.corners[(cornerIndex + 1) % 6].y - room.corners[(cornerIndex + 5) % 6].y,
        "test side vector"
    );
    const outward = api.normalizeVector(originalCorner.x - squaredCorner.x, originalCorner.y - squaredCorner.y, "test outward");
    const wallCenter = {
        x: squaredCorner.x + outward.x * api.MAZE_SQUARE_ROOM_SIDE_OFFSET,
        y: squaredCorner.y + outward.y * api.MAZE_SQUARE_ROOM_SIDE_OFFSET
    };
    const hallwayInterval = api.getMazeHallwayCorridorLineInterval(room, side, connection, wallCenter, sideVector, options);
    const start = Math.min(hallwayInterval.start, hallwayInterval.end);
    const end = Math.max(hallwayInterval.start, hallwayInterval.end);
    const keepTowardPositive = side === (cornerIndex + 5) % 6;
    const backWallSegments = segments.filter((segment) => (
        segment.labelCode === api.WALL_LABEL_SQUARE_SIDE_PARALLEL && segment.sideCode === cornerIndex
    ));
    let hasNearSideSegment = false;
    let hasFarSideSegment = false;
    for (const segment of backWallSegments) {
        const segmentStart = api.pointProjectionParameter(segment.ax, segment.ay, wallCenter.x, wallCenter.y, wallCenter.x + sideVector.x, wallCenter.y + sideVector.y);
        const segmentEnd = api.pointProjectionParameter(segment.bx, segment.by, wallCenter.x, wallCenter.y, wallCenter.x + sideVector.x, wallCenter.y + sideVector.y);
        const min = Math.min(segmentStart, segmentEnd);
        const max = Math.max(segmentStart, segmentEnd);
        assert.ok(max <= start + 0.00001 || min >= end - 0.00001, "back wall should leave the hallway opening clear");
        if (keepTowardPositive) {
            if (max <= start + 0.00001) hasNearSideSegment = true;
            if (min >= end - 0.00001) hasFarSideSegment = true;
        } else {
            if (min >= end - 0.00001) hasNearSideSegment = true;
            if (max <= start + 0.00001) hasFarSideSegment = true;
        }
    }

    assert.equal(hasNearSideSegment, true);
    assert.equal(hasFarSideSegment, true);
});

test("Wizard of Flatland incorporated corner pocket back wall reaches boundary after hallway", () => {
    const api = loadMazeWorkerExports();
    const options = {
        seed: "hex-maze-1",
        chunkSize: 44,
        roomScale: 0.56,
        twistiness: 0.62
    };
    const room = api.buildMazeRoom(-30, -27, options);
    const cornerIndex = 2;
    const side = 2;
    const connection = api.getMazeSharedHallConnection(-30, -27, side, options, true);

    assert.equal(room.squareSideCorners.join(","), "5,2");
    assert.equal(api.isMazeSquarePocketIncorporatedByNeighbor(room, cornerIndex, side, options), true);

    const walls = api.createWallBufferBuilder();
    api.appendMazeSquareSideWalls(walls, room, new Map([[side, connection]]), options);
    const segments = wallSegments(api.finishWallBuffer(walls));
    const originalCorner = api.getHexCornersWorld(room.center.x, room.center.y, room.radius)[cornerIndex];
    const squaredCorner = room.corners[cornerIndex];
    const sideVector = api.normalizeVector(
        room.corners[(cornerIndex + 1) % 6].x - room.corners[(cornerIndex + 5) % 6].x,
        room.corners[(cornerIndex + 1) % 6].y - room.corners[(cornerIndex + 5) % 6].y,
        "test side vector"
    );
    const outward = api.normalizeVector(originalCorner.x - squaredCorner.x, originalCorner.y - squaredCorner.y, "test outward");
    const wallCenter = {
        x: squaredCorner.x + outward.x * api.MAZE_SQUARE_ROOM_SIDE_OFFSET,
        y: squaredCorner.y + outward.y * api.MAZE_SQUARE_ROOM_SIDE_OFFSET
    };
    const hallwayInterval = api.getMazeHallwayCorridorLineInterval(room, side, connection, wallCenter, sideVector, options);
    const hallwayEnd = Math.max(hallwayInterval.start, hallwayInterval.end);
    const farSegment = segments.find((segment) => {
        if (segment.labelCode !== api.WALL_LABEL_SQUARE_SIDE_PARALLEL || segment.sideCode !== cornerIndex) return false;
        const start = api.pointProjectionParameter(segment.ax, segment.ay, wallCenter.x, wallCenter.y, wallCenter.x + sideVector.x, wallCenter.y + sideVector.y);
        const end = api.pointProjectionParameter(segment.bx, segment.by, wallCenter.x, wallCenter.y, wallCenter.x + sideVector.x, wallCenter.y + sideVector.y);
        return Math.min(start, end) >= hallwayEnd - 0.00001;
    });

    assert.ok(farSegment, "incorporated back wall should resume on the far side of the hallway");
    assert.ok(
        pointPolygonEdgeDistance({ x: farSegment.bx, y: farSegment.by }, room.sectionCorners) < 0.00001,
        "resumed incorporated back wall should reach the section boundary"
    );
});

test("Wizard of Flatland reshaped squared side stops at front wall crossing and adds bridge", () => {
    const api = loadMazeWorkerExports();
    const options = {
        seed: "hex-maze-1",
        chunkSize: 44,
        roomScale: 0.56,
        twistiness: 0.62
    };
    const sourceRoom = api.buildMazeRoom(-17, 10, options);
    const cornerIndex = 0;
    const pocketSide = 0;
    const targetRoom = api.buildMazeRoom(-16, 10, options);
    const targetSide = 3;
    const pocket = api.getMazeSquarePocketGeometry(sourceRoom, cornerIndex, pocketSide);
    const mutation = api.getMazeSquarePocketIncorporationMutation(sourceRoom, cornerIndex, pocketSide, targetRoom, targetSide, options);

    assert.ok(mutation.extendStopPoint, "test fixture should find a front-wall crossing before the section boundary");
    const wallPlan = api.buildMazeSquarePocketWallPlan([mutation], targetRoom.sectionCorners);
    const reshapedSide = wallPlan.sideOverrides.get(mutation.extendSide);
    assert.ok(reshapedSide, "incorporated corner pocket should reshape the adjacent squared side");
    assert.ok(Math.hypot(
        reshapedSide.b.x - mutation.extendStopPoint.x,
        reshapedSide.b.y - mutation.extendStopPoint.y
    ) < 0.00001);

    const oldBoundaryEnd = api.getMazeSquarePocketExtendedWallEnd({
        ...mutation,
        extendStopPoint: null
    }, targetRoom.sectionCorners);
    const shortenedLength = Math.hypot(reshapedSide.b.x - mutation.extendFrom.x, reshapedSide.b.y - mutation.extendFrom.y);
    const oldLength = Math.hypot(oldBoundaryEnd.x - mutation.extendFrom.x, oldBoundaryEnd.y - mutation.extendFrom.y);
    assert.ok(shortenedLength < oldLength - 0.00001, "reshaped squared side should stop before the section boundary");

    const bridge = wallPlan.extraWalls.find((wall) => (
        Math.hypot(wall.a.x - mutation.extendStopPoint.x, wall.a.y - mutation.extendStopPoint.y) < 0.00001
            && Math.hypot(wall.b.x - mutation.extendConnectorBoundaryEnd.x, wall.b.y - mutation.extendConnectorBoundaryEnd.y) < 0.00001
    ));
    assert.ok(bridge, "front-wall bridge should connect the shortened squared side to the section boundary");
    const bridgeIsOnFrontWall = pocket.cornerWalls.some((frontWall) => (
        lineDistanceToPoint(frontWall.gapEndpoint, frontWall.boundaryEnd, { x: bridge.a.x, y: bridge.a.y }) < 0.00001
            && lineDistanceToPoint(frontWall.gapEndpoint, frontWall.boundaryEnd, { x: bridge.b.x, y: bridge.b.y }) < 0.00001
    ));
    assert.equal(bridgeIsOnFrontWall, true);
});

test("Wizard of Flatland corner-pocket extended sides count as default hex sides", () => {
    const api = loadMazeWorkerExports();
    const options = {
        seed: "hex-maze-1",
        chunkSize: 44,
        roomScale: 0.56,
        twistiness: 0.62
    };
    const targetRoom = api.buildMazeRoom(-30, -28, options);
    const mutation = api.getMazeSectionIncomingSquarePocketMutations(targetRoom, options)
        .find((candidate) => candidate.extendSide === 0);

    assert.ok(mutation, "test fixture should create a corner-pocket extension on a non-squared side");
    assert.equal(targetRoom.squareSideCorners.length, 0);
    assert.equal(api.isMazeRoomSideDefaultHex(targetRoom, mutation.extendSide, options), true);
    assert.equal(api.isMazeRoomSideDefaultHex(targetRoom, mutation.trimSide, options), false);
});

test("Wizard of Flatland reshaped trim side stops at front wall crossing and adds bridge", () => {
    const api = loadMazeWorkerExports();
    const options = {
        seed: "hex-maze-1",
        chunkSize: 44,
        roomScale: 0.56,
        twistiness: 0.62
    };
    const sourceRoom = api.buildMazeRoom(-4, 1, options);
    const targetRoom = api.buildMazeRoom(-3, 0, options);
    const pocket = api.getMazeSquarePocketGeometry(sourceRoom, 0, 5);
    const mutation = api.getMazeSquarePocketIncorporationMutation(sourceRoom, 0, 5, targetRoom, 2, options);

    assert.ok(mutation.trimStopPoint, "test fixture should find a trim-side front-wall crossing before the section boundary");
    const wallPlan = api.buildMazeSquarePocketWallPlan([mutation], targetRoom.sectionCorners);
    const reshapedSide = wallPlan.sideOverrides.get(mutation.trimSide);
    assert.ok(reshapedSide, "incorporated corner pocket should reshape the trim side");
    assert.ok(Math.hypot(
        reshapedSide.b.x - mutation.trimStopPoint.x,
        reshapedSide.b.y - mutation.trimStopPoint.y
    ) < 0.00001);

    const oldBoundaryEnd = api.getMazeSquarePocketTrimmedWallEnd({
        ...mutation,
        trimStopPoint: null
    }, targetRoom.sectionCorners);
    const shortenedLength = Math.hypot(reshapedSide.b.x - mutation.trimFrom.x, reshapedSide.b.y - mutation.trimFrom.y);
    const oldLength = Math.hypot(oldBoundaryEnd.x - mutation.trimFrom.x, oldBoundaryEnd.y - mutation.trimFrom.y);
    assert.ok(shortenedLength < oldLength - 0.00001, "reshaped trim side should stop before the section boundary");

    const bridge = wallPlan.extraWalls.find((wall) => (
        Math.hypot(wall.a.x - mutation.trimStopPoint.x, wall.a.y - mutation.trimStopPoint.y) < 0.00001
            && Math.hypot(wall.b.x - mutation.trimConnectorBoundaryEnd.x, wall.b.y - mutation.trimConnectorBoundaryEnd.y) < 0.00001
    ));
    assert.ok(bridge, "front-wall bridge should connect the shortened trim side to the section boundary");
    const bridgeIsOnFrontWall = pocket.cornerWalls.some((frontWall) => (
        lineDistanceToPoint(frontWall.gapEndpoint, frontWall.boundaryEnd, { x: bridge.a.x, y: bridge.a.y }) < 0.00001
            && lineDistanceToPoint(frontWall.gapEndpoint, frontWall.boundaryEnd, { x: bridge.b.x, y: bridge.b.y }) < 0.00001
    ));
    assert.equal(bridgeIsOnFrontWall, true);
});

test("Wizard of Flatland neighbor-incorporated connector stops at section-boundary front wall crossing", () => {
    const api = loadMazeWorkerExports();
    const options = {
        seed: "hex-maze-1",
        chunkSize: 44,
        roomScale: 0.56,
        twistiness: 0.62
    };
    const targetRoom = api.buildMazeRoom(-1, 0, options);
    const mutation = api.getMazeSectionIncomingSquarePocketMutations(targetRoom, options)
        .find((candidate) => candidate.side === 1);

    assert.ok(mutation, "test fixture should find the visible connector mutation");
    assert.ok(mutation.connectorStopPoint, "connector should stop at the front-wall crossing");
    assert.ok(mutation.connectorBridgeBoundaryEnd, "connector should add a bridge back to the section-boundary front wall");

    const wallPlan = api.buildMazeSquarePocketWallPlan([mutation], targetRoom.sectionCorners);
    const connector = wallPlan.extraWalls.find((wall) => (
        Math.hypot(wall.a.x - mutation.connectorStopPoint.x, wall.a.y - mutation.connectorStopPoint.y) < 0.00001
            && pointPolygonEdgeDistance(wall.b, targetRoom.sectionCorners) < 0.00001
            && pointSegmentDistance(mutation.trimPoint.x, mutation.trimPoint.y, wall.a.x, wall.a.y, wall.b.x, wall.b.y) > 0.1
    ));
    const bridge = wallPlan.extraWalls.find((wall) => (
        wall.labelCode === api.WALL_LABEL_SQUARE_SIDE_PERPENDICULAR_FULL
            && Math.hypot(wall.a.x - mutation.connectorStopPoint.x, wall.a.y - mutation.connectorStopPoint.y) < 0.00001
            && Math.hypot(wall.b.x - mutation.connectorBridgeBoundaryEnd.x, wall.b.y - mutation.connectorBridgeBoundaryEnd.y) < 0.00001
    ));

    assert.ok(connector, "neighbor-incorporated connector should keep the far side and end at the crossing");
    assert.ok(bridge, "front-wall bridge should be emitted from the crossing to the section boundary");
    assert.ok(
        pointPolygonEdgeDistance(bridge.b, targetRoom.sectionCorners) < 0.00001,
        "front-wall bridge should terminate on the native section boundary"
    );
    assert.ok(
        lineDistanceToPoint(bridge.a, bridge.b, { x: -19.052558883257653, y: 8.690598923241495 }) < 0.00001,
        "front-wall bridge should be colinear with the existing section-boundary front wall"
    );

    const walls = api.createWallBufferBuilder();
    api.appendMazeSectionWalls(walls, -1, 0, options);
    const segments = wallSegments(api.finishWallBuffer(walls));
    const emittedConnector = segments.find((segment) => (
        segment.labelCode === api.WALL_LABEL_ROOM_POCKET_CONNECTOR
            && pointSegmentDistance(
                mutation.connectorStopPoint.x,
                mutation.connectorStopPoint.y,
                segment.ax,
                segment.ay,
                segment.bx,
                segment.by
            ) < 0.00001
            && pointSegmentDistance(
                mutation.trimPoint.x,
                mutation.trimPoint.y,
                segment.ax,
                segment.ay,
                segment.bx,
                segment.by
            ) > 0.1
            && pointPolygonEdgeDistance({ x: segment.bx, y: segment.by }, targetRoom.sectionCorners) < 0.00001
    ));
    const emittedBridge = segments.find((segment) => (
        segment.labelCode === api.WALL_LABEL_SQUARE_SIDE_PERPENDICULAR_FULL
            && pointSegmentDistance(
                mutation.connectorStopPoint.x,
                mutation.connectorStopPoint.y,
                segment.ax,
                segment.ay,
                segment.bx,
                segment.by
            ) < 0.00001
            && pointSegmentDistance(
                mutation.connectorBridgeBoundaryEnd.x,
                mutation.connectorBridgeBoundaryEnd.y,
                segment.ax,
                segment.ay,
                segment.bx,
                segment.by
            ) < 0.00001
    ));

    assert.ok(emittedConnector, "final wall buffer should include the shortened neighbor-incorporated connector");
    assert.ok(emittedBridge, "final wall buffer should include the section-boundary front-wall bridge");
});

test("Wizard of Flatland mirrored adjacent pocket front-wall bridges do not cross", () => {
    const api = loadMazeWorkerExports();
    const options = {
        seed: "hex-maze-1",
        chunkSize: 44,
        roomScale: 0.56,
        twistiness: 0.62
    };
    const room = api.buildMazeRoom(-2, -17, options);
    const mutations = api.getMazeSectionIncomingSquarePocketMutations(room, options)
        .filter((mutation) => mutation.side === 1 || mutation.side === 2);

    assert.equal(mutations.length, 2, "test fixture should include the mirrored incoming pockets");
    for (const mutation of mutations) {
        assert.equal(mutation.connectorStopPoint, null, "mirrored bridge should not steal the opposite front-wall endpoint");
        assert.equal(mutation.connectorBridgeBoundaryEnd, null, "mirrored bridge should not emit a crossing section-boundary wall");
    }

    const walls = api.createWallBufferBuilder();
    api.appendMazeSectionWalls(walls, -2, -17, options);
    const segments = wallSegments(api.finishWallBuffer(walls));
    const bridgeSegments = segments.filter((segment) => (
        segment.labelCode === api.WALL_LABEL_SQUARE_SIDE_PERPENDICULAR_FULL
    ));
    for (let i = 0; i < bridgeSegments.length; i++) {
        for (let j = i + 1; j < bridgeSegments.length; j++) {
            assert.equal(
                segmentsCrossAwayFromEndpoints(bridgeSegments[i], bridgeSegments[j]),
                false,
                "section-boundary front-wall bridges should not cross each other"
            );
        }
    }
});

test("Wizard of Flatland overlapping pocket reshapes stop at each other's front walls", () => {
    const api = loadMazeWorkerExports();
    const options = {
        seed: "hex-maze-1",
        chunkSize: 44,
        roomScale: 0.56,
        twistiness: 0.62
    };
    const room = api.buildMazeRoom(1, -4, options);
    const mutations = api.getMazeSectionIncomingSquarePocketMutations(room, options)
        .filter((mutation) => mutation.trimSide === 1);
    const firstPocket = mutations.find((mutation) => mutation.side === 0);
    const secondPocket = mutations.find((mutation) => mutation.side === 2);

    assert.ok(firstPocket, "test fixture should include the side-0 pocket");
    assert.ok(secondPocket, "test fixture should include the side-2 pocket");

    const walls = api.createWallBufferBuilder();
    api.appendMazeSectionWalls(walls, 1, -4, options);
    const segments = wallSegments(api.finishWallBuffer(walls));
    const sideSegments = segments.filter((segment) => (
        segment.labelCode === api.WALL_LABEL_ROOM_POCKET_OVERRIDE && segment.sideCode === 1
    ));

    assert.equal(sideSegments.length, 1);
    assert.ok(pointSegmentDistance(firstPocket.trimPoint.x, firstPocket.trimPoint.y, sideSegments[0].ax, sideSegments[0].ay, sideSegments[0].bx, sideSegments[0].by) < 0.00001);
    assert.ok(pointSegmentDistance(secondPocket.trimPoint.x, secondPocket.trimPoint.y, sideSegments[0].ax, sideSegments[0].ay, sideSegments[0].bx, sideSegments[0].by) < 0.00001);
    assert.equal(
        sideSegments.some((segment) => (
            pointSegmentDistance(room.corners[1].x, room.corners[1].y, segment.ax, segment.ay, segment.bx, segment.by) < 0.00001
                || pointSegmentDistance(room.corners[2].x, room.corners[2].y, segment.ax, segment.ay, segment.bx, segment.by) < 0.00001
        )),
        false,
        "side 1 should not leave endpoint nubs outside the incorporated pocket fronts"
    );
});

test("Wizard of Flatland overlapping pocket reshapes connect to hallway gaps", () => {
    const api = loadMazeWorkerExports();
    const options = {
        seed: "hex-maze-1",
        chunkSize: 44,
        roomScale: 0.56,
        twistiness: 0.62
    };
    const room = api.buildMazeRoom(4, -2, options);
    const mutations = api.getMazeSectionIncomingSquarePocketMutations(room, options)
        .filter((mutation) => mutation.trimSide === 1);
    const firstPocket = mutations.find((mutation) => mutation.side === 0);
    const secondPocket = mutations.find((mutation) => mutation.side === 2);
    const connection = api.getMazeSharedHallConnection(4, -2, 1, options, true);
    const gap = getWallGapEndpointsForTest(api, room.corners[1], room.corners[2], connection.t, connection.width);

    assert.ok(firstPocket, "test fixture should include the side-0 pocket");
    assert.ok(secondPocket, "test fixture should include the side-2 pocket");

    const walls = api.createWallBufferBuilder();
    api.appendMazeSectionWalls(walls, 4, -2, options);
    const segments = wallSegments(api.finishWallBuffer(walls));
    const sideSegments = segments.filter((segment) => (
        segment.labelCode === api.WALL_LABEL_ROOM_POCKET_OVERRIDE_HALL_GAP && segment.sideCode === 1
    ));
    const hallwaySegments = segments.filter((segment) => segment.labelCode === api.WALL_LABEL_HALLWAY_SIDE_HALF);

    assert.equal(sideSegments.length, 2);
    assert.ok(
        sideSegments.some((segment) => (
            pointSegmentDistance(firstPocket.trimPoint.x, firstPocket.trimPoint.y, segment.ax, segment.ay, segment.bx, segment.by) < 0.00001
                && pointSegmentDistance(gap.left.x, gap.left.y, segment.ax, segment.ay, segment.bx, segment.by) < 0.00001
        )),
        "side 1 should run from the side-0 pocket front wall to the hallway gap"
    );
    assert.ok(
        sideSegments.some((segment) => (
            pointSegmentDistance(secondPocket.trimPoint.x, secondPocket.trimPoint.y, segment.ax, segment.ay, segment.bx, segment.by) < 0.00001
                && pointSegmentDistance(gap.right.x, gap.right.y, segment.ax, segment.ay, segment.bx, segment.by) < 0.00001
        )),
        "side 1 should run from the side-2 pocket front wall to the hallway gap"
    );
    assert.ok(
        hallwaySegments.some((segment) => pointSegmentDistance(gap.left.x, gap.left.y, segment.ax, segment.ay, segment.bx, segment.by) < 0.00001),
        "left hallway side should share the side-1 gap endpoint"
    );
    assert.ok(
        hallwaySegments.some((segment) => pointSegmentDistance(gap.right.x, gap.right.y, segment.ax, segment.ay, segment.bx, segment.by) < 0.00001),
        "right hallway side should share the side-1 gap endpoint"
    );
});

test("Wizard of Flatland pocket override closes extra wall beyond full hallway opening", () => {
    const api = loadMazeWorkerExports();
    const options = {
        seed: "hex-maze-1",
        chunkSize: 44,
        roomScale: 0.56,
        twistiness: 0.62
    };
    const room = api.buildMazeRoom(4, -2, options);
    const mutation = api.getMazeSectionIncomingSquarePocketMutations(room, options)
        .find((candidate) => candidate.side === 2 && candidate.extendSide === 3);
    const connection = api.getMazeSharedHallConnection(4, -2, 3, options, true);

    assert.ok(mutation, "test fixture should include the full-hallway pocket extension");
    assert.equal(connection.fullWall, true);

    const walls = api.createWallBufferBuilder();
    api.appendMazeSectionWalls(walls, 4, -2, options);
    const segments = wallSegments(api.finishWallBuffer(walls));
    const closingWall = segments.find((segment) => (
        segment.labelCode === api.WALL_LABEL_ROOM_POCKET_OVERRIDE && segment.sideCode === 3
            && pointSegmentDistance(room.corners[3].x, room.corners[3].y, segment.ax, segment.ay, segment.bx, segment.by) < 0.00001
            && pointSegmentDistance(mutation.extendBoundaryEnd.x, mutation.extendBoundaryEnd.y, segment.ax, segment.ay, segment.bx, segment.by) < 0.00001
    ));

    assert.ok(closingWall, "pocket extension should close the gap outside the full-wall hallway opening");
    assert.equal(
        segments.some((segment) => (
            segment.labelCode === api.WALL_LABEL_ROOM_POCKET_OVERRIDE && segment.sideCode === 3
                && pointSegmentDistance(room.corners[3].x, room.corners[3].y, segment.ax, segment.ay, segment.bx, segment.by) < 0.00001
                && pointSegmentDistance(room.corners[4].x, room.corners[4].y, segment.ax, segment.ay, segment.bx, segment.by) < 0.00001
        )),
        false,
        "full-wall hallway should not get its original room boundary restored"
    );
    assert.ok(
        segments.some((segment) => (
            segment.labelCode === api.WALL_LABEL_HALLWAY_SIDE_HALF
                && pointSegmentDistance(room.corners[3].x, room.corners[3].y, segment.ax, segment.ay, segment.bx, segment.by) < 0.00001
        )),
        "full-wall hallway side should meet the extra pocket wall"
    );
});

test("Wizard of Flatland corner pockets connect only to unsquared neighbor walls", () => {
    const api = loadMazeWorkerExports();
    let options = null;
    let sourceRoom = null;
    let cornerIndex = null;
    let pocketSide = null;
    let targetRoom = null;
    let targetSide = null;
    for (let i = 0; i < 5000 && !options; i++) {
        const candidateOptions = {
            seed: `square-pocket-unsquared-target-fixture-${i}`,
            chunkSize: 44,
            roomScale: 0.56,
            twistiness: 0.62,
            squarePocketIncorporateChance: 1
        };
        const candidateRoom = api.buildMazeRoom(0, 0, candidateOptions);
        for (const candidateCorner of candidateRoom.squareSideCorners) {
            for (const candidatePocketSide of [(candidateCorner + 5) % 6, candidateCorner]) {
                if (!api.isMazeSquarePocketIncorporatedByNeighbor(candidateRoom, candidateCorner, candidatePocketSide, candidateOptions)) continue;
                const dir = [
                    { q: 1, r: 0 },
                    { q: 0, r: 1 },
                    { q: -1, r: 1 },
                    { q: -1, r: 0 },
                    { q: 0, r: -1 },
                    { q: 1, r: -1 }
                ][candidatePocketSide];
                options = candidateOptions;
                sourceRoom = candidateRoom;
                cornerIndex = candidateCorner;
                pocketSide = candidatePocketSide;
                targetRoom = api.buildMazeRoom(dir.q, dir.r, candidateOptions);
                targetSide = (candidatePocketSide + 3) % 6;
                break;
            }
            if (options) break;
        }
    }
    assert.ok(options, "test fixture should find a pocket that can connect to an unsquared neighbor wall");
    assert.equal(api.canMazeSquarePocketConnectToSide(targetRoom, targetSide), true);

    const walls = api.createWallBufferBuilder();
    api.appendMazeSquareSideWalls(walls, sourceRoom, new Map(), options);
    const segments = wallSegments(api.finishWallBuffer(walls));
    const hexRoomCorners = api.getHexCornersWorld(sourceRoom.center.x, sourceRoom.center.y, sourceRoom.radius);
    const originalCorner = hexRoomCorners[cornerIndex];
    const squaredCorner = sourceRoom.corners[cornerIndex];
    const sideVector = api.normalizeVector(
        sourceRoom.corners[(cornerIndex + 1) % 6].x - sourceRoom.corners[(cornerIndex + 5) % 6].x,
        sourceRoom.corners[(cornerIndex + 1) % 6].y - sourceRoom.corners[(cornerIndex + 5) % 6].y,
        "test side vector"
    );
    const outward = api.normalizeVector(originalCorner.x - squaredCorner.x, originalCorner.y - squaredCorner.y, "test outward");
    const wallCenter = {
        x: squaredCorner.x + outward.x * api.MAZE_SQUARE_ROOM_SIDE_OFFSET,
        y: squaredCorner.y + outward.y * api.MAZE_SQUARE_ROOM_SIDE_OFFSET
    };
    const gapEndpoints = [
        api.pointOnLine(wallCenter, sideVector, -api.MAZE_SQUARE_ROOM_SIDE_GAP_WIDTH * 0.5),
        api.pointOnLine(wallCenter, sideVector, api.MAZE_SQUARE_ROOM_SIDE_GAP_WIDTH * 0.5)
    ];
    const perpendicularSegments = gapEndpoints.map((gapEndpoint) => segments.find((segment) => (
        pointSegmentDistance(gapEndpoint.x, gapEndpoint.y, segment.ax, segment.ay, segment.bx, segment.by) < 0.00001
            && Math.abs(((segment.bx - segment.ax) * outward.y) - ((segment.by - segment.ay) * outward.x)) < 0.00001
    )));

    const incorporatedIndex = pocketSide === (cornerIndex + 5) % 6 ? 0 : 1;
    assert.equal(perpendicularSegments[1 - incorporatedIndex], undefined);
    assert.ok(perpendicularSegments[incorporatedIndex]);
    const fullLengths = gapEndpoints.map((gapEndpoint) => {
        const hit = api.intersectRayWithPolygon(gapEndpoint, outward, sourceRoom.sectionCorners, "test full corner wall");
        return Math.hypot(hit.end.x - gapEndpoint.x, hit.end.y - gapEndpoint.y);
    });
    assert.ok(Math.abs(segmentLength(perpendicularSegments[incorporatedIndex]) - fullLengths[incorporatedIndex]) < 0.00001);

    const pocket = api.getMazeSquarePocketGeometry(sourceRoom, cornerIndex, pocketSide);
    const blockedTargetHexCorners = api.getHexCornersWorld(targetRoom.center.x, targetRoom.center.y, targetRoom.radius);
    const blockedTargetSquareCorners = [targetSide];
    const blockedTargetRoom = {
        ...targetRoom,
        squareSideCorners: blockedTargetSquareCorners,
        corners: api.getSquaredMazeRoomCorners(blockedTargetHexCorners, blockedTargetSquareCorners)
    };
    assert.equal(api.isMazeRoomSideSquaredOff(blockedTargetRoom, targetSide), true);
    assert.equal(api.canMazeSquarePocketConnectToSide(blockedTargetRoom, targetSide), false);
    assert.equal(api.buildMazeSquarePocketMutation(blockedTargetRoom, targetSide, pocket) !== null, true);
    assert.equal(api.isMazeSquarePocketIncorporatedByNeighbor(sourceRoom, cornerIndex, pocketSide, {
        ...options,
        seed: options.seed
    }), true);
    assert.equal(api.getMazeSquarePocketIncorporationMutation(sourceRoom, cornerIndex, pocketSide, blockedTargetRoom, targetSide, options), null);
});

test("Wizard of Flatland pocket-shortened walls preserve hallway openings", () => {
    const api = loadMazeWorkerExports();
    const room = api.buildMazeRoom(0, 0, {
        seed: "pocket-shortened-hallway",
        chunkSize: 44,
        roomScale: 0.56,
        twistiness: 0.62
    });
    const side = 0;
    const a = room.corners[side];
    const b = room.corners[(side + 1) % 6];
    const trimPoint = {
        x: a.x + (b.x - a.x) * 0.8,
        y: a.y + (b.y - a.y) * 0.8
    };
    const walls = api.createWallBufferBuilder();

    api.appendMazeRoomWalls(
        walls,
        room,
        new Map([[side, { t: 0.5, width: 2 }]]),
        null,
        [{
            suppressSide: 3,
            extendSide: 4,
            trimSide: side,
            extendFrom: room.corners[4],
            trimFrom: a,
            trimPoint,
            boundaryEnd: { x: room.corners[4].x + 1, y: room.corners[4].y + 1 },
            extendBoundaryEnd: { x: room.corners[4].x + 1, y: room.corners[4].y + 1 },
            connectorBoundaryEnd: { x: room.corners[4].x + 1, y: room.corners[4].y + 1 }
        }]
    );

    const sideVector = api.normalizeVector(b.x - a.x, b.y - a.y, "test side vector");
    const sideSegments = wallSegments(api.finishWallBuffer(walls)).filter((segment) => {
        const dx = segment.bx - segment.ax;
        const dy = segment.by - segment.ay;
        const length = Math.hypot(dx, dy);
        if (!(length > 0.001)) return false;
        return Math.abs(dx / length - sideVector.x) < 0.00001 && Math.abs(dy / length - sideVector.y) < 0.00001
            && pointSegmentDistance(segment.ax, segment.ay, a.x, a.y, trimPoint.x, trimPoint.y) < 0.00001
            && pointSegmentDistance(segment.bx, segment.by, a.x, a.y, trimPoint.x, trimPoint.y) < 0.00001;
    });

    assert.equal(sideSegments.length, 2);
    const gap = Math.hypot(sideSegments[1].ax - sideSegments[0].bx, sideSegments[1].ay - sideSegments[0].by);
    assert.ok(Math.abs(gap - 2) < 0.00001);
});

test("Wizard of Flatland hallway connects to incorporated square pocket instead of reciprocal room hallway", () => {
    const api = loadMazeWorkerExports();
    let options = null;
    let room = null;
    let side = null;
    let connection = null;
    let pocket = null;
    for (let i = 0; i < 5000 && !options; i++) {
        const candidateOptions = {
            seed: `square-pocket-hallway-fixture-${i}`,
            chunkSize: 44,
            roomScale: 0.56,
            twistiness: 0.62,
            squarePocketIncorporateChance: 1
        };
        const candidateRoom = api.buildMazeRoom(0, 0, candidateOptions);
        for (const cornerIndex of candidateRoom.squareSideCorners) {
            for (const candidateSide of [(cornerIndex + 5) % 6, cornerIndex]) {
                const candidateConnection = api.getMazeSharedHallConnection(0, 0, candidateSide, candidateOptions, false);
                if (!candidateConnection.open) continue;
                if (candidateConnection.fullWall) continue;
                const target = api.getMazeSquarePocketHallwayTarget(candidateRoom, candidateSide, candidateOptions);
                if (!target) continue;
                options = candidateOptions;
                room = candidateRoom;
                side = candidateSide;
                connection = api.getMazeSharedHallConnection(0, 0, candidateSide, candidateOptions, true);
                pocket = target.pocket;
                break;
            }
            if (options) break;
        }
    }
    assert.ok(options, "test fixture should find an open hallway on an incorporated square pocket side");

    const dir = [
        { q: 1, r: 0 },
        { q: 0, r: 1 },
        { q: -1, r: 1 },
        { q: -1, r: 0 },
        { q: 0, r: -1 },
        { q: 1, r: -1 }
    ][side];
    const neighborRoom = api.buildMazeRoom(dir.q, dir.r, options);
    const neighborSide = (side + 3) % 6;
    assert.equal(api.canMazeSquarePocketConnectToSide(neighborRoom, neighborSide), true);
    assert.equal(api.isMazeHallwaySuppressedByIncomingSquarePocket(neighborRoom, neighborSide, options), true);

    const walls = api.createWallBufferBuilder();
    api.appendMazeHalfHallwayToSquarePocket(walls, room, side, connection, pocket);
    const segments = wallSegments(api.finishWallBuffer(walls));
    assert.equal(segments.length, 2);

    const startGap = getWallGapEndpointsForTest(api, room.corners[side], room.corners[(side + 1) % 6], connection.t, connection.width);
    const span = api.getMazeSquarePocketOrthogonalHallwaySpan(room, side, connection, pocket);
    const squaredWallDirection = api.normalizeVector(
        room.corners[(side + 1) % 6].x - room.corners[side].x,
        room.corners[(side + 1) % 6].y - room.corners[side].y,
        "test squared wall direction"
    );
    assert.ok(pointSegmentDistance(startGap.left.x, startGap.left.y, segments[0].ax, segments[0].ay, segments[0].bx, segments[0].by) < 0.00001);
    assert.ok(pointSegmentDistance(span.leftPoint.x, span.leftPoint.y, segments[0].ax, segments[0].ay, segments[0].bx, segments[0].by) < 0.00001);
    assert.ok(pointSegmentDistance(startGap.right.x, startGap.right.y, segments[1].ax, segments[1].ay, segments[1].bx, segments[1].by) < 0.00001);
    assert.ok(pointSegmentDistance(span.rightPoint.x, span.rightPoint.y, segments[1].ax, segments[1].ay, segments[1].bx, segments[1].by) < 0.00001);
    for (const segment of segments) {
        const dx = segment.bx - segment.ax;
        const dy = segment.by - segment.ay;
        const length = Math.hypot(dx, dy);
        assert.ok(length > 0.001);
        assert.ok(
            Math.abs(dx / length * squaredWallDirection.x + dy / length * squaredWallDirection.y) < 0.00001,
            "hallway should meet the squared wall at a right angle"
        );
        assert.ok(
            Math.abs(dx / length * pocket.sideVector.x + dy / length * pocket.sideVector.y) < 0.00001,
            "hallway should meet the pocket back wall at a right angle"
        );
    }
});

test("Wizard of Flatland square-pocket hallways honor three-hallway junction openings", () => {
    const api = loadMazeWorkerExports();
    const options = {
        seed: "tri-pocket-5",
        chunkSize: 44,
        roomScale: 0.56,
        twistiness: 0.62,
        squarePocketIncorporateChance: 1
    };
    const room = api.buildMazeRoom(2, 0, options);
    const side = 5;
    const connection = api.getMazeSharedHallConnection(2, 0, side, options, true);
    const target = api.getMazeSquarePocketHallwayTarget(room, side, options);
    const omissions = api.getMazeThreeHallwayJunctionWallOmissions(room, side, options);

    assert.ok(target, "test fixture should route the hallway into an incorporated square pocket");
    assert.equal(omissions.left, false);
    assert.equal(omissions.right, true);

    const walls = api.createWallBufferBuilder();
    api.appendMazeHalfHallwayToSquarePocket(walls, room, side, connection, target.pocket, options);
    const segments = wallSegments(api.finishWallBuffer(walls));

    assert.equal(segments.length, 1);
    assert.equal(segments[0].labelCode, api.WALL_LABEL_HALLWAY_SIDE_FULL);
    const span = api.getMazeSquarePocketOrthogonalHallwaySpan(room, side, connection, target.pocket);
    assert.ok(
        pointSegmentDistance(span.startGap.left.x, span.startGap.left.y, segments[0].ax, segments[0].ay, segments[0].bx, segments[0].by) < 0.00001,
        "left hallway side should remain anchored at the room opening"
    );
    assert.ok(
        pointSegmentDistance(span.startGap.right.x, span.startGap.right.y, segments[0].ax, segments[0].ay, segments[0].bx, segments[0].by) > 0.5,
        "right hallway side should be omitted at the three-hallway junction"
    );
});

test("Wizard of Flatland square-pocket hallways honor four-section loop openings", () => {
    const api = loadMazeWorkerExports();
    const options = {
        seed: "four-loop-2",
        chunkSize: 44,
        roomScale: 0.56,
        twistiness: 0.62,
        squarePocketIncorporateChance: 1
    };
    const room = api.buildMazeRoom(1, -3, options);
    const side = 0;
    const connection = api.getMazeSharedHallConnection(1, -3, side, options, true);
    const target = api.getMazeSquarePocketHallwayTarget(room, side, options);
    const omissions = api.getMazeThreeHallwayJunctionWallOmissions(room, side, options);

    assert.equal(api.getMazeSharedHallConnection(1, -3, 0, options, false).open, true);
    assert.equal(api.getMazeSharedHallConnection(1, -3, 1, options, false).open, true);
    assert.equal(api.getMazeSharedHallConnection(2, -3, 1, options, false).open, true);
    assert.equal(api.getMazeSharedHallConnection(1, -2, 0, options, false).open, true);
    assert.equal(api.getMazeSharedHallConnection(2, -3, 2, options, false).open, false);
    assert.ok(target, "test fixture should route the four-section loop hallway into an incorporated square pocket");
    assert.equal(omissions.left, false);
    assert.equal(omissions.right, true);

    const walls = api.createWallBufferBuilder();
    api.appendMazeHalfHallwayToSquarePocket(walls, room, side, connection, target.pocket, options);
    const segments = wallSegments(api.finishWallBuffer(walls));

    assert.equal(segments.length, 1);
    assert.equal(segments[0].labelCode, api.WALL_LABEL_HALLWAY_SIDE_FULL);
    const span = api.getMazeSquarePocketOrthogonalHallwaySpan(room, side, connection, target.pocket);
    assert.ok(
        pointSegmentDistance(span.startGap.left.x, span.startGap.left.y, segments[0].ax, segments[0].ay, segments[0].bx, segments[0].by) < 0.00001,
        "left square-pocket hallway side should remain anchored at the room opening"
    );
    assert.ok(
        pointSegmentDistance(span.startGap.right.x, span.startGap.right.y, segments[0].ax, segments[0].ay, segments[0].bx, segments[0].by) > 0.5,
        "right square-pocket hallway side should be omitted at the four-section loop"
    );
});

function getWallGapEndpointsForTest(api, a, b, gapT, gapWidth) {
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    const halfT = Math.max(0.02, gapWidth / length * 0.5);
    return {
        left: {
            x: a.x + (b.x - a.x) * Math.max(0, gapT - halfT),
            y: a.y + (b.y - a.y) * Math.max(0, gapT - halfT)
        },
        right: {
            x: a.x + (b.x - a.x) * Math.min(1, gapT + halfT),
            y: a.y + (b.y - a.y) * Math.min(1, gapT + halfT)
        }
    };
}
