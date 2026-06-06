import { columnVertices } from "./BuildingModel.js";

const PLAYTEST_STAIR_OPENING_BLOCKER_HEIGHT = 2;
const PLAYTEST_BLOCKER_AREA_EPSILON = 0.000001;

function blockerPolygonArea(polygon) {
    let area = 0;
    for (let index = 0; index < polygon.length; index++) {
        const current = polygon[index];
        const next = polygon[(index + 1) % polygon.length];
        area += Number(current.x) * Number(next.y) - Number(next.x) * Number(current.y);
    }
    return area * 0.5;
}

function assertPlaytestBlockerPolygon(polygon, label) {
    if (!Array.isArray(polygon) || polygon.length < 3) {
        throw new Error(`${label} must be a polygon with at least three points`);
    }
    polygon.forEach((point, index) => {
        if (!point || !Number.isFinite(Number(point.x)) || !Number.isFinite(Number(point.y))) {
            throw new Error(`${label} point ${index} must be finite`);
        }
    });
    if (!(Math.abs(blockerPolygonArea(polygon)) > PLAYTEST_BLOCKER_AREA_EPSILON)) {
        throw new Error(`${label} must have positive area`);
    }
}

export function buildPlaytestStairFloorBlockers({
    traversal,
    runtimeStair,
    height,
    stairId,
    upperOpeningPolygons
}) {
    const resolvedStairId = String(stairId || (runtimeStair && runtimeStair.id) || "");
    if (!resolvedStairId) throw new Error("playtest stair blocker build requires a stair id");
    if (!traversal || typeof traversal.pathPolygonForUpDownRange !== "function") {
        throw new Error(`playtest stair ${resolvedStairId} blocker build requires tread path geometry`);
    }
    if (!runtimeStair || !runtimeStair.traversalFrame) {
        throw new Error(`playtest stair ${resolvedStairId} blocker build requires a traversal frame`);
    }
    const lowerFloorId = String(runtimeStair.lowerFloorId || "");
    const higherFloorId = String(runtimeStair.higherFloorId || "");
    if (!lowerFloorId || !higherFloorId) {
        throw new Error(`playtest stair ${resolvedStairId} blocker build requires connected floor ids`);
    }
    const riseHeight = Number(height);
    if (!Number.isFinite(riseHeight) || riseHeight <= 0) {
        throw new Error(`playtest stair ${resolvedStairId} blocker build requires a positive height`);
    }

    const lowerBlockerUpDown = Math.min(1, PLAYTEST_STAIR_OPENING_BLOCKER_HEIGHT / riseHeight);
    const lowerBlockerPolygon = traversal.pathPolygonForUpDownRange(runtimeStair.traversalFrame, 0, lowerBlockerUpDown);
    assertPlaytestBlockerPolygon(lowerBlockerPolygon, `playtest stair ${resolvedStairId} lower movement blocker`);

    if (!Array.isArray(upperOpeningPolygons) || upperOpeningPolygons.length === 0) {
        throw new Error(`playtest stair ${resolvedStairId} upper movement blocker requires generated opening polygons`);
    }

    const blockers = [{
        floorId: lowerFloorId,
        stairId: resolvedStairId,
        endpoint: "lower",
        polygon: lowerBlockerPolygon
    }];

    upperOpeningPolygons.forEach((polygon, index) => {
        assertPlaytestBlockerPolygon(polygon, `playtest stair ${resolvedStairId} upper movement blocker ${index}`);
        blockers.push({
            floorId: higherFloorId,
            stairId: resolvedStairId,
            endpoint: "higher",
            polygon
        });
    });

    return blockers;
}

export function playtestColumnBlockingSegmentsForFloor(columns, floorId) {
    const resolvedFloorId = String(floorId || "");
    if (!resolvedFloorId) throw new Error("playtest column blocking segments require a floor id");
    if (!Array.isArray(columns)) throw new Error("playtest column blocking segments require a column list");
    const segments = [];
    columns.forEach((column) => {
        if (String(column && column.floorId) !== resolvedFloorId) return;
        const label = `playtest column ${column && column.id !== undefined ? column.id : "(unknown)"} footprint`;
        const polygon = columnVertices(column);
        assertPlaytestBlockerPolygon(polygon, label);
        for (let index = 0; index < polygon.length; index++) {
            segments.push({
                kind: "column",
                column,
                points: [polygon[index], polygon[(index + 1) % polygon.length]]
            });
        }
    });
    return segments;
}
