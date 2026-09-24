import { polygonArea, simplePolygonRingError } from "./BuildingGeometry.js";
import {
    findFloor,
    findWall,
    getBuildingMountedObjects,
    getBuildingFloors,
    getBuildingWalls,
    getFloorBeams,
    getFloorColumns,
    getFloorElevation,
    getFloorId,
    getFloorRoofs,
    getFloorStairs,
    getRoofContactPolygon,
    getRoofDomeLevels,
    getRoofGables,
    getRoofPeakPoint,
    getRoofShedDirection,
    resolveEndpoint,
    wallPoints
} from "./BuildingModel.js";

function pointIsFinite(point) {
    return Number.isFinite(Number(point && point.x)) && Number.isFinite(Number(point && point.y));
}

function point3dIsFinite(point) {
    return pointIsFinite(point) && Number.isFinite(Number(point && point.z));
}

function ringCumulativeLengths(ring) {
    const lengths = [0];
    let total = 0;
    for (let index = 0; index < ring.length; index++) {
        const current = ring[index];
        const next = ring[(index + 1) % ring.length];
        total += Math.hypot(Number(next.x) - Number(current.x), Number(next.y) - Number(current.y));
        lengths.push(total);
    }
    return lengths;
}

function gableEndpointScalar(ring, cumulative, endpoint) {
    const edgeIndex = Math.floor(Number(endpoint && endpoint.edgeIndex));
    if (!Number.isInteger(edgeIndex) || edgeIndex < 0 || edgeIndex >= ring.length) return NaN;
    const t = Number(endpoint && endpoint.t);
    if (!Number.isFinite(t) || t < 0 || t > 1) return NaN;
    return cumulative[edgeIndex] + (cumulative[edgeIndex + 1] - cumulative[edgeIndex]) * t;
}

function gableIntervalParts(totalLength, startScalar, endScalar) {
    if (!Number.isFinite(totalLength) || totalLength <= 0) return [];
    if (endScalar >= startScalar) return [{ start: startScalar, end: endScalar }];
    return [
        { start: startScalar, end: totalLength },
        { start: 0, end: endScalar }
    ];
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
    const ringError = simplePolygonRingError(ring, `floor ${floorId} ${label}`);
    if (ringError) errors.push(ringError);
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

function validateRoofRecord(errors, floor, roof, roofIndex = 0) {
    const floorId = getFloorId(floor);
    const roofLabel = roofIndex === 0 ? `floor ${floorId} roof` : `floor ${floorId} roof ${roof.id || roofIndex}`;
    if (roof.type !== "roof") errors.push(`${roofLabel} type must be roof`);
    const mode = String(roof.mode || "peak").trim().toLowerCase();
    if (mode !== "peak" && mode !== "shed" && mode !== "gabled" && mode !== "dome") {
        errors.push(`${roofLabel} mode must be peak, shed, gabled, or dome`);
    }
    if (mode !== "peak" && getRoofGables(roof).length > 0) {
        errors.push(`${roofLabel} gables require peak mode`);
    }
    if (typeof roof.texturePath !== "string" || roof.texturePath.length === 0) {
        errors.push(`${roofLabel} texturePath must be a non-empty string`);
    }
    if (!Number.isFinite(Number(roof.overhang))) {
        errors.push(`${roofLabel} overhang must be a finite number`);
    }
    if (Number(roof.overhang) < 0 && getRoofGables(roof).length > 0) {
        errors.push(`${roofLabel} gables cannot be used with negative overhang yet`);
    }
    if (!Number.isFinite(Number(roof.peakHeight)) || Number(roof.peakHeight) < 0) {
        errors.push(`${roofLabel} peakHeight must be zero or greater`);
    }
    try {
        getRoofDomeLevels(roof);
    } catch (error) {
        errors.push(`${roofLabel} ${error.message}`);
    }
    if (!Number.isFinite(Number(roof.elevationOffset))) {
        errors.push(`${roofLabel} elevationOffset must be a finite number`);
    }
    const peakPoint = getRoofPeakPoint(roof);
    if (!pointIsFinite(peakPoint)) {
        errors.push(`${roofLabel} peakPoint must be finite`);
    }
    const shedDirection = getRoofShedDirection(roof);
    if (!pointIsFinite(shedDirection) || Math.hypot(Number(shedDirection && shedDirection.x), Number(shedDirection && shedDirection.y)) <= 0.000001) {
        errors.push(`${roofLabel} shedDirection must be finite`);
    }
    if (Number(roof.peakHeight) <= 0 && getRoofGables(roof).length > 0) {
        errors.push(`${roofLabel} gables require positive peakHeight`);
    }
    const perimeter = getRoofContactPolygon(roof);
    validateRing(errors, floorId, perimeter, "roof contactPolygon");
    perimeter.forEach((vertex, vertexIndex) => {
        const attachment = vertex && vertex.roofEdgeAttachment;
        if (attachment === undefined || attachment === null) return;
        const label = `${roofLabel} contact vertex ${vertexIndex} roofEdgeAttachment`;
        if (!attachment || typeof attachment !== "object") {
            errors.push(`${label} must be an object`);
            return;
        }
        if (attachment.type !== "renderedRoofEdge") errors.push(`${label} type must be renderedRoofEdge`);
        if (typeof attachment.floorId !== "string" || attachment.floorId.length === 0) errors.push(`${label} floorId must be a non-empty string`);
        if (typeof attachment.roofId !== "string" || attachment.roofId.length === 0) errors.push(`${label} roofId must be a non-empty string`);
        if (attachment.edgeKind !== "peakEave") errors.push(`${label} edgeKind must be peakEave`);
        const edgeIndex = Math.floor(Number(attachment.edgeIndex));
        if (!Number.isInteger(edgeIndex) || edgeIndex < 0) errors.push(`${label} edgeIndex must be zero or greater`);
    });
    const faceCount = perimeter.length;
    const cumulative = faceCount >= 3 ? ringCumulativeLengths(perimeter) : [];
    const totalLength = cumulative.length ? cumulative[cumulative.length - 1] : 0;
    const intervals = [];
    getRoofGables(roof).forEach((gable, index) => {
        const label = `${roofLabel} gable ${gable && gable.id !== undefined ? gable.id : index}`;
        if (!gable || typeof gable !== "object") {
            errors.push(`${label} must be an object`);
            return;
        }
        if (gable.type !== "gable") errors.push(`${label} type must be gable`);
        if (!Number.isInteger(Number(gable.id))) errors.push(`${label} id must be an integer`);
        const startEdgeIndex = Math.floor(Number(gable.start && gable.start.edgeIndex));
        const endEdgeIndex = Math.floor(Number(gable.end && gable.end.edgeIndex));
        const startT = Number(gable.start && gable.start.t);
        const endT = Number(gable.end && gable.end.t);
        if (!Number.isInteger(startEdgeIndex) || startEdgeIndex < 0 || startEdgeIndex >= faceCount) {
            errors.push(`${label} start edgeIndex must reference a roof outline edge`);
        }
        if (!Number.isInteger(endEdgeIndex) || endEdgeIndex < 0 || endEdgeIndex >= faceCount) {
            errors.push(`${label} end edgeIndex must reference a roof outline edge`);
        }
        if (!Number.isFinite(startT) || startT < 0 || startT > 1 || !Number.isFinite(endT) || endT < 0 || endT > 1) {
            errors.push(`${label} endpoint t values must be between zero and one`);
        }
        const startScalar = gableEndpointScalar(perimeter, cumulative, gable.start);
        const endScalar = gableEndpointScalar(perimeter, cumulative, gable.end);
        const intervalLength = endScalar >= startScalar ? endScalar - startScalar : totalLength - startScalar + endScalar;
        if (!Number.isFinite(intervalLength) || intervalLength <= 0.000001) {
            errors.push(`${label} endpoints must not coincide`);
        }
        const height = Number(gable.height);
        if (!Number.isFinite(height) || height < 0 || height > Number(roof.peakHeight) + 0.000001) {
            errors.push(`${label} height must be between zero and roof peakHeight`);
        }
        if (typeof gable.wallTexturePath !== "string" || gable.wallTexturePath.length === 0) {
            errors.push(`${label} wallTexturePath must be a non-empty string`);
        }
        if (gable.roofReturn !== true && gable.roofReturn !== false) {
            errors.push(`${label} roofReturn must be a boolean`);
        }
        const parts = gableIntervalParts(totalLength, startScalar, endScalar);
        intervals.forEach((interval) => {
            const overlaps = interval.parts.some((a) => parts.some((b) => Math.max(a.start, b.start) < Math.min(a.end, b.end) - 0.000001));
            if (overlaps) errors.push(`${label} overlaps roof gable ${interval.id}`);
        });
        intervals.push({ id: gable.id, parts });
    });
}

function validateRoof(errors, floor) {
    let roofs = [];
    try {
        roofs = getFloorRoofs(floor);
    } catch (error) {
        errors.push(error.message);
        return;
    }
    roofs.forEach((roof, index) => validateRoofRecord(errors, floor, roof, index));
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
    if (endpoint.kind === "vertex" || endpoint.kind === "insetVertex") {
        if (!endpoint.fragmentId) errors.push(`${endpointLabel(wall, key)} vertex endpoint is missing fragmentId`);
        if (!endpoint.vertexId) errors.push(`${endpointLabel(wall, key)} vertex endpoint is missing vertexId`);
        if (!resolveEndpoint(building, endpoint, wall)) {
            errors.push(`${endpointLabel(wall, key)} references missing floor vertex`);
        }
    } else if (endpoint.kind === "edge") {
        if (!pointIsFinite(endpoint)) {
            errors.push(`${endpointLabel(wall, key)} edge endpoint must have current finite x/y`);
        }
        if (endpoint.boundaryPoint === true) {
            return;
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
    if (!pointIsFinite(resolveEndpoint(building, endpoint, wall) || endpoint)) {
        errors.push(`${endpointLabel(wall, key)} must resolve to finite x/y`);
    }
}

function validateResolvedWallGeometry(errors, wall) {
    const label = `wall ${wall.id || "(missing id)"} resolvedGeometry`;
    const geometry = wall.resolvedGeometry;
    if (!geometry || typeof geometry !== "object") {
        errors.push(`${label} is missing`);
        return;
    }
    if (geometry.version !== 1) errors.push(`${label} version must be 1`);
    const profile = geometry.profile;
    if (!profile || typeof profile !== "object") {
        errors.push(`${label} profile is missing`);
    } else {
        ["aLeft", "aRight", "bLeft", "bRight"].forEach((key) => {
            if (!pointIsFinite(profile[key])) errors.push(`${label} profile ${key} must have finite x/y`);
        });
    }
    if (!Number.isFinite(Number(geometry.bottomZ))) {
        errors.push(`${label} bottomZ must be finite`);
    }
    const topStations = Array.isArray(geometry.topStations) ? geometry.topStations : [];
    if (topStations.length < 2) {
        errors.push(`${label} requires at least two top stations`);
    }
    topStations.forEach((station, stationIndex) => {
        if (!Number.isFinite(Number(station && station.t)) || Number(station.t) < 0 || Number(station.t) > 1) {
            errors.push(`${label} top station ${stationIndex} t must be between zero and one`);
        }
        if (!point3dIsFinite(station && station.left)) {
            errors.push(`${label} top station ${stationIndex} left must have finite x/y/z`);
        }
        if (!point3dIsFinite(station && station.right)) {
            errors.push(`${label} top station ${stationIndex} right must have finite x/y/z`);
        }
    });
    if (typeof geometry.signature !== "string" || geometry.signature.length === 0) {
        errors.push(`${label} signature must be a non-empty string`);
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
    if (!Array.isArray(building.mountedWallObjects)) {
        errors.push("building mountedWallObjects must be an array");
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
        validateRoof(errors, floor);
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
        validateResolvedWallGeometry(errors, wall);
        if (wall.topProfile !== null && wall.topProfile !== undefined) {
            if (!wall.topProfile || typeof wall.topProfile !== "object") {
                errors.push(`wall ${wall.id || "(missing id)"} topProfile must be an object`);
            } else {
                const stations = Array.isArray(wall.topProfile.stations) ? wall.topProfile.stations : [];
                if (String(wall.topProfile.kind || "") !== "stations") {
                    errors.push(`wall ${wall.id || "(missing id)"} topProfile kind must be stations`);
                }
                if (stations.length < 2) {
                    errors.push(`wall ${wall.id || "(missing id)"} topProfile must have at least two stations`);
                }
                stations.forEach((station, stationIndex) => {
                    const t = Number(station && station.t);
                    const leftHeight = Number(station && station.leftHeight);
                    const rightHeight = Number(station && station.rightHeight);
                    if (!Number.isFinite(t) || t < 0 || t > 1) {
                        errors.push(`wall ${wall.id || "(missing id)"} topProfile station ${stationIndex} t must be between zero and one`);
                    }
                    if (!Number.isFinite(leftHeight) || leftHeight < 0 || !Number.isFinite(rightHeight) || rightHeight < 0) {
                        errors.push(`wall ${wall.id || "(missing id)"} topProfile station ${stationIndex} heights must be zero or greater`);
                    }
                    if (stationIndex > 0 && Number(stations[stationIndex - 1].t) >= t) {
                        errors.push(`wall ${wall.id || "(missing id)"} topProfile station ${stationIndex} t must be greater than the previous station`);
                    }
                });
            }
        }
    });
    const mountedObjectIds = new Set();
    getBuildingMountedObjects(building).forEach((object) => {
        if (object.id === undefined || object.id === null || object.id === "") {
            errors.push("mounted wall object is missing id");
        }
        if (mountedObjectIds.has(String(object.id))) errors.push(`duplicate mounted wall object id: ${object.id}`);
        mountedObjectIds.add(String(object.id));
        if (object.category !== "doors" && object.category !== "windows") {
            errors.push(`mounted wall object ${object.id || "(missing id)"} category must be doors or windows`);
        }
        if (typeof object.texturePath !== "string" || object.texturePath.length === 0) {
            errors.push(`mounted wall object ${object.id || "(missing id)"} texturePath must be a non-empty string`);
        }
        if (object.mountKind === "gable") {
            const floor = findFloor(building, object.floorId);
            if (!floor) {
                errors.push(`mounted wall object ${object.id || "(missing id)"} references missing gable floor: ${object.floorId || "(missing)"}`);
            } else {
                const gable = getRoofGables(floor).find((candidate) => String(candidate.id) === String(object.gableId));
                if (!gable) {
                    errors.push(`mounted wall object ${object.id || "(missing id)"} references missing gable: ${object.gableId ?? "(missing)"}`);
                }
            }
            if (object.category !== "windows") {
                errors.push(`mounted wall object ${object.id || "(missing id)"} gable mount must be a window`);
            }
            if (!Number.isInteger(Number(object.gableSegmentIndex)) || Number(object.gableSegmentIndex) < 0) {
                errors.push(`mounted wall object ${object.id || "(missing id)"} gableSegmentIndex must be a zero or greater integer`);
            }
        } else {
            const wall = findWall(building, object.wallId ?? object.mountedWallSectionUnitId);
            if (!wall) {
                errors.push(`mounted wall object ${object.id || "(missing id)"} references missing wall: ${object.wallId ?? object.mountedWallSectionUnitId ?? "(missing)"}`);
            } else if (object.floorId && String(object.floorId) !== String(wall.fragmentId || wall.floorId)) {
                errors.push(`mounted wall object ${object.id || "(missing id)"} floorId does not match mounted wall`);
            }
        }
        if (!Number.isFinite(Number(object.wallT)) || Number(object.wallT) < 0 || Number(object.wallT) > 1) {
            errors.push(`mounted wall object ${object.id || "(missing id)"} wallT must be between 0 and 1`);
        }
        if (!Number.isFinite(Number(object.width)) || Number(object.width) <= 0) {
            errors.push(`mounted wall object ${object.id || "(missing id)"} width must be a positive number`);
        }
        if (!Number.isFinite(Number(object.height)) || Number(object.height) <= 0) {
            errors.push(`mounted wall object ${object.id || "(missing id)"} height must be a positive number`);
        }
        if (!Number.isFinite(Number(object.zOffset))) {
            errors.push(`mounted wall object ${object.id || "(missing id)"} zOffset must be finite`);
        }
    });

    const beamIds = new Set();
    getBuildingFloors(building).forEach((floor) => {
        const floorId = getFloorId(floor);
        getFloorBeams(floor).forEach((beam) => {
            const label = `beam ${beam.id ?? "(missing id)"} on floor ${floorId}`;
            if (beam.id === undefined || beam.id === null || beam.id === "") errors.push(`${label} is missing id`);
            if (beamIds.has(String(beam.id))) errors.push(`duplicate beam id: ${beam.id}`);
            beamIds.add(String(beam.id));
            if (beam.type !== "beam") errors.push(`${label} type must be beam`);
            if (Number(beam.thickness) < 0.001) errors.push(`${label} thickness must be at least 0.001`);
            if (!Number.isFinite(Number(beam.height)) || Number(beam.height) <= 0) {
                errors.push(`${label} height must be a positive number`);
            }
            if (!Number.isFinite(Number(beam.bottomZ))) errors.push(`${label} bottomZ must be finite`);
            ["startAttachment", "endAttachment"].forEach((key) => {
                const att = beam[key];
                if (!att || typeof att !== "object") {
                    errors.push(`${label} ${key} must be an object`);
                } else if (!["wall", "column", "free"].includes(att.kind)) {
                    errors.push(`${label} ${key} kind must be wall, column, or free`);
                }
            });
        });
    });

    const columnIds = new Set();
    getBuildingFloors(building).forEach((floor) => {
        const floorId = getFloorId(floor);
        getFloorColumns(floor).forEach((column) => {
            const label = `column ${column.id ?? "(missing id)"} on floor ${floorId}`;
            if (column.id === undefined || column.id === null || column.id === "") errors.push(`${label} is missing id`);
            if (columnIds.has(String(column.id))) errors.push(`duplicate column id: ${column.id}`);
            columnIds.add(String(column.id));
            if (column.type !== "column") errors.push(`${label} type must be column`);
            if (!Number.isInteger(Number(column.sideCount)) || Number(column.sideCount) < 3 || Number(column.sideCount) > 12) {
                errors.push(`${label} sideCount must be an integer between 3 and 12`);
            }
            if (!Number.isFinite(Number(column.size)) || Number(column.size) <= 0) {
                errors.push(`${label} size (apothem) must be a positive number`);
            }
            if (!Number.isFinite(Number(column.width)) || Number(column.width) <= 0 || Number(column.width) > 2) {
                errors.push(`${label} width must be a positive number no greater than 2`);
            }
            if (!Number.isFinite(Number(column.depth)) || Number(column.depth) <= 0 || Number(column.depth) > 2) {
                errors.push(`${label} depth must be a positive number no greater than 2`);
            }
            if (!Number.isFinite(Number(column.height)) || Number(column.height) <= 0) {
                errors.push(`${label} height must be a positive number`);
            }
            if (column.topHeights !== undefined && column.topHeights !== null) {
                if (!Array.isArray(column.topHeights)) {
                    errors.push(`${label} topHeights must be an array`);
                } else if (column.topHeights.length !== Math.round(Number(column.sideCount))) {
                    errors.push(`${label} topHeights length must match sideCount`);
                } else {
                    column.topHeights.forEach((height, index) => {
                        if (!Number.isFinite(Number(height)) || Number(height) <= 0) {
                            errors.push(`${label} topHeights[${index}] must be a positive number`);
                        }
                    });
                }
            }
            if (!Number.isFinite(Number(column.bottomZ))) errors.push(`${label} bottomZ must be finite`);
            if (!pointIsFinite(column.position)) errors.push(`${label} position must have finite x and y`);
            if (column.wallId !== undefined && column.wallId !== null && column.wallId !== "") {
                const wall = getBuildingWalls(building).find((candidate) => String(candidate.id) === String(column.wallId));
                if (!wall) {
                    errors.push(`${label} references missing wall ${column.wallId}`);
                } else if (String(wall.fragmentId || wall.floorId) !== String(floorId)) {
                    errors.push(`${label} wallId must reference a wall on the same floor`);
                }
            }
        });
    });

    const stairIds = new Set();
    getBuildingFloors(building).forEach((floor) => {
        const floorId = getFloorId(floor);
        getFloorStairs(floor).forEach((stair) => {
            const label = `stair ${stair.id ?? "(missing id)"} on floor ${floorId}`;
            if (stair.id === undefined || stair.id === null || stair.id === "") errors.push(`${label} is missing id`);
            if (stairIds.has(String(stair.id))) errors.push(`duplicate stair id: ${stair.id}`);
            stairIds.add(String(stair.id));
            if (stair.type !== "stairs") errors.push(`${label} type must be stairs`);
            if (String(stair.floorId || "") !== String(floorId)) {
                errors.push(`${label} floorId must match containing floor`);
            }
            if (!Number.isFinite(Number(stair.width)) || Number(stair.width) <= 0) {
                errors.push(`${label} width must be a positive number`);
            }
            if (!Number.isFinite(Number(stair.height)) || Number(stair.height) <= 0) {
                errors.push(`${label} height must be a positive number`);
            }
            if (!Number.isFinite(Number(stair.bottomZ))) errors.push(`${label} bottomZ must be finite`);
            if (!Number.isInteger(Number(stair.stepCount)) || Number(stair.stepCount) < 1) {
                errors.push(`${label} stepCount must be a positive integer`);
            }
        });
    });

    return errors;
}
