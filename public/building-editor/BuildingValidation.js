import { polygonArea } from "./BuildingGeometry.js";
import {
    findFloor,
    getBuildingFloors,
    getBuildingWalls,
    getFloorElevation,
    getFloorId,
    resolveEndpoint,
    wallPoints
} from "./BuildingModel.js";

function pointIsFinite(point) {
    return Number.isFinite(Number(point && point.x)) && Number.isFinite(Number(point && point.y));
}

function validateRing(errors, floorId, ring, label) {
    if (!Array.isArray(ring) || ring.length < 3) {
        errors.push(`floor ${floorId} ${label} requires at least three vertices`);
        return;
    }
    const area = polygonArea(ring);
    if (Math.abs(area) < 0.000001) {
        errors.push(`floor ${floorId} ${label} has zero area`);
    }
    const vertexIds = new Set();
    ring.forEach((point, pointIndex) => {
        if (!point.id) errors.push(`floor ${floorId} ${label} vertex ${pointIndex} is missing id`);
        if (point.id && vertexIds.has(point.id)) errors.push(`floor ${floorId} ${label} duplicate vertex id: ${point.id}`);
        if (point.id) vertexIds.add(point.id);
        if (!pointIsFinite(point)) {
            errors.push(`floor ${floorId} ${label} vertex ${pointIndex} must have finite x/y`);
        }
    });
}

function endpointLabel(wall, key) {
    return `wall ${wall.id || "(missing id)"} ${key}`;
}

function validateEndpoint(errors, building, wall, key) {
    const endpoint = wall[key];
    if (!endpoint || typeof endpoint !== "object") {
        errors.push(`${endpointLabel(wall, key)} is missing`);
        return;
    }
    if (!endpoint.kind) {
        errors.push(`${endpointLabel(wall, key)} is missing kind`);
    }
    if (endpoint.kind === "vertex") {
        if (!endpoint.fragmentId) errors.push(`${endpointLabel(wall, key)} vertex endpoint is missing fragmentId`);
        if (!endpoint.vertexId) errors.push(`${endpointLabel(wall, key)} vertex endpoint is missing vertexId`);
        if (!resolveEndpoint(building, endpoint)) {
            errors.push(`${endpointLabel(wall, key)} references missing floor vertex`);
        }
    } else if (endpoint.kind === "edge") {
        if (!pointIsFinite(endpoint)) {
            errors.push(`${endpointLabel(wall, key)} edge endpoint must have current finite x/y`);
        }
        if (!wall.attachment || wall.attachment.kind !== "lineBoundaryClip") {
            errors.push(`${endpointLabel(wall, key)} edge endpoint requires lineBoundaryClip attachment`);
        } else {
            if (!pointIsFinite(wall.attachment.linePoint)) {
                errors.push(`${endpointLabel(wall, key)} lineBoundaryClip attachment requires finite linePoint`);
            }
            const vector = wall.attachment.lineVector;
            if (!Number.isFinite(Number(vector && vector.x)) || !Number.isFinite(Number(vector && vector.y)) || Math.hypot(Number(vector.x), Number(vector.y)) < 0.000001) {
                errors.push(`${endpointLabel(wall, key)} lineBoundaryClip attachment requires non-zero lineVector`);
            }
        }
    } else if (endpoint.kind !== "point") {
        errors.push(`${endpointLabel(wall, key)} has unknown kind: ${endpoint.kind}`);
    }
    if (!pointIsFinite(resolveEndpoint(building, endpoint) || endpoint)) {
        errors.push(`${endpointLabel(wall, key)} must resolve to finite x/y`);
    }
}

export function validateBuilding(building) {
    const errors = [];
    if (!building || typeof building !== "object") {
        return ["building model is missing"];
    }
    if (building.schema !== "survivor-building-v1") {
        errors.push("building schema must be survivor-building-v1");
    }
    if (!Array.isArray(building.floorFragments)) {
        errors.push("building floorFragments must be an array");
        return errors;
    }
    if (!Array.isArray(building.wallSections)) {
        errors.push("building wallSections must be an array");
        return errors;
    }

    const floorIds = new Set();
    getBuildingFloors(building).forEach((floor, floorIndex) => {
        const floorId = getFloorId(floor);
        if (!floorId) errors.push(`floor fragment ${floorIndex} is missing fragmentId`);
        if (floorIds.has(floorId)) errors.push(`duplicate floor fragment id: ${floorId}`);
        floorIds.add(floorId);
        if (!Number.isFinite(getFloorElevation(floor))) {
            errors.push(`floor ${floorId} nodeBaseZ must be a finite number`);
        }
        if (!Number.isFinite(Number(floor.floorHeight)) || Number(floor.floorHeight) <= 0) {
            errors.push(`floor ${floorId} floorHeight must be a positive number`);
        }
        validateRing(errors, floorId, floor.outerPolygon, "outerPolygon");
        const holes = Array.isArray(floor.holes) ? floor.holes : [];
        holes.forEach((ring, holeIndex) => validateRing(errors, floorId, ring, `hole ${holeIndex}`));
    });

    const wallIds = new Set();
    getBuildingWalls(building).forEach((wall) => {
        if (wall.type !== "wallSection") errors.push(`wall ${wall.id || "(missing id)"} type must be wallSection`);
        if (wall.id === undefined || wall.id === null || wall.id === "") errors.push("wall section is missing id");
        if (wallIds.has(String(wall.id))) errors.push(`duplicate wall section id: ${wall.id}`);
        wallIds.add(String(wall.id));
        const floor = findFloor(building, wall.fragmentId || wall.floorId);
        if (!floor) {
            errors.push(`wall ${wall.id || "(missing id)"} references missing floor fragment: ${wall.fragmentId || wall.floorId || "(missing)"}`);
        }
        validateEndpoint(errors, building, wall, "startPoint");
        validateEndpoint(errors, building, wall, "endPoint");
        const points = wallPoints(building, wall);
        if (points.length !== 2) {
            errors.push(`wall ${wall.id || "(missing id)"} must resolve to two points`);
        } else if (Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y) < 0.000001) {
            errors.push(`wall ${wall.id || "(missing id)"} endpoints must not be coincident`);
        }
        if (!Number.isFinite(Number(wall.height)) || Number(wall.height) <= 0) {
            errors.push(`wall ${wall.id || "(missing id)"} height must be a positive number`);
        }
        if (!Number.isFinite(Number(wall.thickness)) || Number(wall.thickness) <= 0) {
            errors.push(`wall ${wall.id || "(missing id)"} thickness must be a positive number`);
        }
        if (!Number.isFinite(Number(wall.bottomZ))) {
            errors.push(`wall ${wall.id || "(missing id)"} bottomZ must be finite`);
        }
    });
    return errors;
}
