const test = require("node:test");
const assert = require("node:assert/strict");

async function loadModel() {
    return import("../public/building-editor/BuildingModel.js");
}

async function loadState() {
    return import("../public/building-editor/BuildingEditorState.js");
}

async function loadRenderer() {
    return import("../public/building-editor/BuildingRenderer.js");
}

async function loadSelectTool() {
    return import("../public/building-editor/tools/SelectTool.js");
}

async function loadWallTool() {
    return import("../public/building-editor/tools/WallTool.js");
}

async function loadColumnTool() {
    return import("../public/building-editor/tools/ColumnTool.js");
}

function loadWallSectionUnit() {
    require("../public/assets/javascript/gameobjects/wallSectionUnit.js");
    return globalThis.WallSectionUnit;
}

function loadColumnUnit() {
    require("../public/assets/javascript/gameobjects/columnUnit.js");
    return globalThis.ColumnUnit;
}

async function loadPolygonEditTool() {
    return import("../public/building-editor/tools/PolygonEditTool.js");
}

function installLocalStorageMock() {
    const previous = globalThis.localStorage;
    const storage = new Map();
    globalThis.localStorage = {
        getItem(key) {
            return storage.has(String(key)) ? storage.get(String(key)) : null;
        },
        setItem(key, value) {
            storage.set(String(key), String(value));
        },
        removeItem(key) {
            storage.delete(String(key));
        }
    };
    return () => {
        if (previous === undefined) {
            delete globalThis.localStorage;
        } else {
            globalThis.localStorage = previous;
        }
    };
}

async function createTestBuilding() {
    const model = await loadModel();
    const building = model.createEmptyBuilding();
    const floor = model.createFloor({
        footprint: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 }
        ]
    });
    building.floorFragments.push(floor);
    model.createPerimeterWallsForFloor(building, floor);
    return { model, building, floor };
}

function triangulationXyArea(triangulation) {
    let area = 0;
    for (let index = 0; index < triangulation.indices.length; index += 3) {
        const a = triangulation.points[triangulation.indices[index]];
        const b = triangulation.points[triangulation.indices[index + 1]];
        const c = triangulation.points[triangulation.indices[index + 2]];
        area += Math.abs(
            (Number(b.x) - Number(a.x)) * (Number(c.y) - Number(a.y)) -
            (Number(c.x) - Number(a.x)) * (Number(b.y) - Number(a.y))
        ) * 0.5;
    }
    return area;
}

function ringXyArea(ring) {
    let area = 0;
    for (let index = 0; index < ring.length; index++) {
        const current = ring[index];
        const next = ring[(index + 1) % ring.length];
        area += Number(current.x) * Number(next.y) - Number(next.x) * Number(current.y);
    }
    return Math.abs(area) * 0.5;
}

function triangulatedZAt(triangulation, point, epsilon = 0.000001) {
    for (let index = 0; index < triangulation.indices.length; index += 3) {
        const a = triangulation.points[triangulation.indices[index]];
        const b = triangulation.points[triangulation.indices[index + 1]];
        const c = triangulation.points[triangulation.indices[index + 2]];
        const ax = Number(a.x);
        const ay = Number(a.y);
        const bx = Number(b.x);
        const by = Number(b.y);
        const cx = Number(c.x);
        const cy = Number(c.y);
        const px = Number(point.x);
        const py = Number(point.y);
        const denominator = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
        if (Math.abs(denominator) <= epsilon) continue;
        const wa = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / denominator;
        const wb = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / denominator;
        const wc = 1 - wa - wb;
        if (wa < -epsilon || wb < -epsilon || wc < -epsilon || wa > 1 + epsilon || wb > 1 + epsilon || wc > 1 + epsilon) {
            continue;
        }
        return Number(a.z) * wa + Number(b.z) * wb + Number(c.z) * wc;
    }
    throw new Error(`triangulation does not contain point ${Number(point.x)},${Number(point.y)}`);
}

function assertPointSetsAlmostEqual(actual, expected, epsilon = 0.000001) {
    assert.equal(actual.length, expected.length);
    const unmatched = actual.map((point) => ({ x: Number(point.x), y: Number(point.y) }));
    expected.forEach((expectedPoint) => {
        const index = unmatched.findIndex((point) => (
            Math.abs(point.x - Number(expectedPoint.x)) <= epsilon &&
            Math.abs(point.y - Number(expectedPoint.y)) <= epsilon
        ));
        assert.notEqual(index, -1, `missing point ${Number(expectedPoint.x)},${Number(expectedPoint.y)}`);
        unmatched.splice(index, 1);
    });
}

test("splitting a perimeter wall preserves untouched wall ids and remounts objects onto the split side", async () => {
    const { model, building, floor } = await createTestBuilding();
    const walls = model.getBuildingWalls(building);
    const originalIds = walls.map((wall) => wall.id);
    const splitWall = walls[0];
    building.mountedWallObjects.push(model.createWallMountedObject({
        floorId: floor.fragmentId,
        wallId: splitWall.id,
        category: "windows",
        texturePath: "/assets/images/windows/window.png",
        wallT: 0.75,
        width: 1,
        height: 1,
        zOffset: 1
    }));

    const start = floor.outerPolygon[0];
    const end = floor.outerPolygon[1];
    const inserted = { id: "split-vertex", x: 5, y: 0 };
    floor.outerPolygon.splice(1, 0, inserted);

    model.splitPerimeterWallAtVertex(building, floor, start, inserted, end);

    assert.equal(model.getBuildingWalls(building).length, 5);
    const remainingOriginalIds = model.getBuildingWalls(building)
        .filter((wall) => originalIds.includes(wall.id) && wall.id !== splitWall.id)
        .map((wall) => wall.id);
    assert.deepEqual(remainingOriginalIds, originalIds.slice(1));
    assert.equal(model.getBuildingMountedObjects(building)[0].wallId, splitWall.id);
    assert.equal(model.getBuildingMountedObjects(building)[0].wallT, 0.5);
});

test("merging perimeter walls remounts both sides onto the survivor wall", async () => {
    const { model, building, floor } = await createTestBuilding();
    const firstWall = model.getBuildingWalls(building)[0];
    const start = floor.outerPolygon[0];
    const end = floor.outerPolygon[1];
    const inserted = { id: "merge-vertex", x: 5, y: 0 };
    floor.outerPolygon.splice(1, 0, inserted);
    model.splitPerimeterWallAtVertex(building, floor, start, inserted, end);

    const secondWall = model.getBuildingWalls(building)
        .find((wall) => wall.attachment && wall.attachment.startVertexId === inserted.id && wall.attachment.endVertexId === end.id);
    assert.ok(secondWall);
    building.mountedWallObjects.push(model.createWallMountedObject({
        floorId: floor.fragmentId,
        wallId: firstWall.id,
        category: "windows",
        texturePath: "/assets/images/windows/window.png",
        wallT: 0.5,
        width: 1,
        height: 1,
        zOffset: 1
    }));
    building.mountedWallObjects.push(model.createWallMountedObject({
        floorId: floor.fragmentId,
        wallId: secondWall.id,
        category: "doors",
        texturePath: "/assets/images/doors/tree door.png",
        wallT: 0.5,
        width: 1,
        height: 2,
        zOffset: 0
    }));

    const previous = floor.outerPolygon[0];
    const deleted = floor.outerPolygon[1];
    const next = floor.outerPolygon[2];
    floor.outerPolygon.splice(1, 1);

    model.mergePerimeterWallsAcrossDeletedVertex(building, floor, previous, deleted, next);

    assert.equal(model.getBuildingWalls(building).length, 4);
    for (const object of model.getBuildingMountedObjects(building)) {
        assert.ok(model.getBuildingWalls(building).some((wall) => wall.id === object.wallId));
        assert.equal(object.wallId, firstWall.id);
    }
});

test("additive floor polygon edits do not reconfigure existing walls", async () => {
    const { BuildingEditorState } = await loadState();
    const { validateBuilding } = await import("../public/building-editor/BuildingValidation.js");
    const model = await loadModel();
    const state = new BuildingEditorState();
    const floor = state.selectedFloor();
    const originalWallIds = model.getBuildingWalls(state.building).map((wall) => wall.id);
    const originalWallCount = model.getBuildingWalls(state.building).length;
    const originalVertices = floor.outerPolygon.map((point) => ({ ...point }));
    const originalMaxX = Math.max(...floor.outerPolygon.map((point) => Number(point.x)));

    state.applyPolygonDraftToSelectedFloor([
        { x: originalMaxX, y: -1.5 },
        { x: originalMaxX + 2, y: -1.5 },
        { x: originalMaxX + 2, y: 1.5 },
        { x: originalMaxX, y: 1.5 }
    ], "add");

    assert.ok(Math.max(...floor.outerPolygon.map((point) => Number(point.x))) > originalMaxX);
    assert.equal(model.getBuildingWalls(state.building).length, originalWallCount);
    assert.deepEqual(model.getBuildingWalls(state.building).map((wall) => wall.id), originalWallIds);
    originalVertices.forEach((original) => {
        const unchanged = floor.outerPolygon.find((point) =>
            Math.abs(Number(point.x) - Number(original.x)) <= 0.000001 &&
            Math.abs(Number(point.y) - Number(original.y)) <= 0.000001
        );
        if (unchanged) assert.equal(unchanged.id, original.id);
    });
    assert.deepEqual(validateBuilding(state.building), []);
    let pointEndpointCount = 0;
    model.getBuildingWalls(state.building).forEach((wall) => {
        assert.equal(model.wallPoints(state.building, wall).length, 2);
        if (wall.role === "perimeter") {
            const attachment = wall.attachment;
            assert.equal(attachment && attachment.kind, "fragmentEdge");
            const startIndex = floor.outerPolygon.findIndex((point) => point.id === attachment.startVertexId);
            const endIndex = floor.outerPolygon.findIndex((point) => point.id === attachment.endVertexId);
            assert.equal((startIndex + 1) % floor.outerPolygon.length, endIndex);
        }
        ["startPoint", "endPoint"].forEach((endpointKey) => {
            const endpoint = wall[endpointKey];
            if (endpoint.kind === "vertex") {
                const vertex = floor.outerPolygon.find((point) => point.id === endpoint.vertexId);
                assert.ok(vertex);
                assert.equal(Number.isFinite(Number(endpoint.x)), true);
                assert.equal(Number.isFinite(Number(endpoint.y)), true);
            } else {
                pointEndpointCount += 1;
                assert.equal(endpoint.kind, "point");
                assert.equal(Number.isFinite(Number(endpoint.x)), true);
                assert.equal(Number.isFinite(Number(endpoint.y)), true);
            }
        });
    });
    assert.ok(pointEndpointCount > 0);
});

test("floor polygon tool snaps to existing floor vertices before grid points", async () => {
    const { BuildingEditorState } = await loadState();
    const state = new BuildingEditorState();
    const floor = state.selectedFloor();
    const vertex = floor.outerPolygon[0];
    state.setTool("polygon");

    const prepared = state.preparePoint({
        x: Number(vertex.x) + 0.12,
        y: Number(vertex.y) - 0.08
    });

    assert.equal(prepared.x, Number(vertex.x));
    assert.equal(prepared.y, Number(vertex.y));
});

test("snap to grid defaults off and persists to localStorage", async () => {
    const restoreStorage = installLocalStorageMock();
    try {
        const { BuildingEditorState } = await loadState();
        const first = new BuildingEditorState();
        assert.equal(first.snapToGrid, false);
        assert.equal(globalThis.localStorage.getItem("survivor-building-editor-settings"), null);

        first.setSnapToGrid(true);
        assert.deepEqual(JSON.parse(globalThis.localStorage.getItem("survivor-building-editor-settings")), {
            snapToGrid: true
        });

        const second = new BuildingEditorState();
        assert.equal(second.snapToGrid, true);

        second.setSnapToGrid(false);
        const third = new BuildingEditorState();
        assert.equal(third.snapToGrid, false);
        assert.deepEqual(JSON.parse(globalThis.localStorage.getItem("survivor-building-editor-settings")), {
            snapToGrid: false
        });
    } finally {
        restoreStorage();
    }
});

test("column snap points per section persist in browser column settings", async () => {
    const { BuildingEditorState } = await loadState();
    const restoreStorage = installLocalStorageMock();
    try {
        const first = new BuildingEditorState();
        first.updateColumnToolSnapPointsPerSection(4);

        const stored = JSON.parse(globalThis.localStorage.getItem("survivor-building-editor-column-tool"));
        assert.equal(stored.snapPointsPerSection, 4);

        const second = new BuildingEditorState();
        assert.equal(second.loadColumnToolSettingsFromBrowser(), true);
        assert.equal(second.columnTool.snapPointsPerSection, 4);
        assert.equal(second.inputs.columnSnapPointsPerSection, 4);
    } finally {
        restoreStorage();
    }
});

test("door and window snap points per section persist by mounted object category", async () => {
    const { BuildingEditorState } = await loadState();
    const restoreStorage = installLocalStorageMock();
    try {
        const first = new BuildingEditorState();
        first.updateMountedObjectSnapPointsPerSection(3);
        first.setMountedObjectToolCategory("windows");
        first.updateMountedObjectSnapPointsPerSection(5);

        const stored = JSON.parse(globalThis.localStorage.getItem("survivor-building-editor-mounted-object-tools"));
        assert.equal(stored.settings.doors.snapPointsPerSection, 3);
        assert.equal(stored.settings.windows.snapPointsPerSection, 5);

        const second = new BuildingEditorState();
        assert.equal(second.loadMountedObjectToolSettingsFromBrowser(), true);
        assert.equal(second.mountedObjectSnapPointsPerSection("doors"), 3);
        assert.equal(second.mountedObjectSnapPointsPerSection("windows"), 5);
    } finally {
        restoreStorage();
    }
});

test("floor layers can be renamed and reordered", async () => {
    const { BuildingEditorState } = await loadState();
    const model = await loadModel();
    const state = new BuildingEditorState();
    const firstFloor = state.selectedFloor();
    const secondFloor = model.duplicateFloor(state.building, model.getFloorId(firstFloor), 3);
    const firstId = model.getFloorId(firstFloor);
    const secondId = model.getFloorId(secondFloor);

    state.renameFloor(firstId, "Kitchen");
    assert.equal(firstFloor.name, "Kitchen");

    state.moveFloorInLayerPanel(secondId, firstId, "before");
    assert.deepEqual(
        model.getBuildingFloors(state.building).map((floor) => model.getFloorId(floor)).slice(0, 2),
        [secondId, firstId]
    );
    assert.equal(model.getFloorElevation(secondFloor), 0);
    assert.equal(model.getFloorElevation(firstFloor), Number(secondFloor.floorHeight));
});

test("duplicated floor roof overhang does not bake source roof footprint into the new roof contact polygon", async () => {
    const { BuildingEditorState } = await loadState();
    const { BuildingRenderer } = await loadRenderer();
    const model = await loadModel();
    const state = new BuildingEditorState();
    const sourceFloor = state.selectedFloor();
    sourceFloor.roof.overhang = 2;
    sourceFloor.roof.peakHeight = 0;
    sourceFloor.roof.contactPolygon = model.offsetRing(sourceFloor.outerPolygon, 1);

    const duplicatedFloor = model.duplicateFloor(state.building, model.getFloorId(sourceFloor), 3);
    duplicatedFloor.roof.overhang = 0;
    duplicatedFloor.roof.peakHeight = 0;

    const roofRing = model.getRoofContactPolygon(duplicatedFloor);
    assert.deepEqual(
        roofRing.map((point) => ({ x: Number(point.x), y: Number(point.y) })),
        duplicatedFloor.outerPolygon.map((point) => ({ x: Number(point.x), y: Number(point.y) }))
    );

    const renderer = Object.create(BuildingRenderer.prototype);
    renderer.worldToScreen = (point) => ({ x: Number(point.x), y: Number(point.y) });
    const ring = renderer.roofScreenGeometry(duplicatedFloor, "duplicated roof")[0][0];
    const bounds = ring.reduce((box, point) => ({
        minX: Math.min(box.minX, Number(point[0])),
        maxX: Math.max(box.maxX, Number(point[0])),
        minY: Math.min(box.minY, Number(point[1])),
        maxY: Math.max(box.maxY, Number(point[1]))
    }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });

    assert.deepEqual(bounds, { minX: -2.598, maxX: 2.598, minY: -1.5, maxY: 1.5 });
});

test("layer panel highlight follows the selected object's owning floor", async () => {
    const { BuildingEditorState } = await loadState();
    const model = await loadModel();
    const state = new BuildingEditorState();
    const firstFloor = state.selectedFloor();
    const secondFloor = model.duplicateFloor(state.building, model.getFloorId(firstFloor), 3);
    const firstWall = model.getBuildingWalls(state.building).find((wall) => (wall.fragmentId || wall.floorId) === model.getFloorId(firstFloor));
    const secondWall = model.getBuildingWalls(state.building).find((wall) => (wall.fragmentId || wall.floorId) === model.getFloorId(secondFloor));
    const mounted = model.createWallMountedObject({
        floorId: model.getFloorId(secondFloor),
        wallId: secondWall.id,
        category: "windows",
        texturePath: "/assets/images/windows/window.png",
        wallT: 0.5,
        width: 1,
        height: 1,
        zOffset: 1
    });
    state.building.mountedWallObjects.push(mounted);

    state.selectBuilding();
    state.selectWall(firstWall.id, { preserveView: true });
    assert.equal(state.allFloorsSelected(), true);
    assert.equal(state.isLayerFloorHighlighted(model.getFloorId(firstFloor)), true);
    assert.equal(state.isLayerFloorHighlighted(model.getFloorId(secondFloor)), false);

    state.selectMountedObject(mounted.id, { preserveView: true });
    assert.equal(state.isLayerFloorHighlighted(model.getFloorId(firstFloor)), false);
    assert.equal(state.isLayerFloorHighlighted(model.getFloorId(secondFloor)), true);
});

test("deleting a multi-wall selection removes every selected wall", async () => {
    const { BuildingEditorState } = await loadState();
    const model = await loadModel();
    const state = new BuildingEditorState();
    const floor = state.selectedFloor();
    const walls = model.getBuildingWalls(state.building)
        .filter((wall) => (wall.fragmentId || wall.floorId) === model.getFloorId(floor))
        .slice(0, 2);
    state.building.mountedWallObjects.push(model.createWallMountedObject({
        floorId: model.getFloorId(floor),
        wallId: walls[1].id,
        category: "windows",
        texturePath: "/assets/images/windows/window.png",
        wallT: 0.5,
        width: 1,
        height: 1,
        zOffset: 1
    }));
    state.selectWalls(walls.map((wall) => wall.id));

    assert.equal(state.deleteSelectedWall(), true);

    const remainingWallIds = new Set(model.getBuildingWalls(state.building).map((wall) => String(wall.id)));
    assert.equal(remainingWallIds.has(String(walls[0].id)), false);
    assert.equal(remainingWallIds.has(String(walls[1].id)), false);
    assert.equal(model.getBuildingMountedObjects(state.building).length, 0);
    assert.equal(state.selection.kind, "floor");
    assert.equal(state.selection.floorId, model.getFloorId(floor));
});

test("deleting a multi-mounted-object selection removes every selected object", async () => {
    const { BuildingEditorState } = await loadState();
    const model = await loadModel();
    const state = new BuildingEditorState();
    const floor = state.selectedFloor();
    const wall = model.getBuildingWalls(state.building)[0];
    const objects = [0.25, 0.75].map((wallT) => model.createWallMountedObject({
        floorId: model.getFloorId(floor),
        wallId: wall.id,
        category: "windows",
        texturePath: "/assets/images/windows/window.png",
        wallT,
        width: 1,
        height: 1,
        zOffset: 1
    }));
    state.building.mountedWallObjects.push(...objects);
    state.selectMountedObjects(objects.map((object) => object.id));

    assert.equal(state.deleteSelectedMountedObject(), true);
    assert.equal(model.getBuildingMountedObjects(state.building).length, 0);
    assert.equal(state.selection.kind, "wall");
    assert.equal(state.selection.wallId, wall.id);
});

test("wall thickness tool setting is applied to new and selected walls", async () => {
    const restoreLocalStorage = installLocalStorageMock();
    try {
        const { BuildingEditorState } = await loadState();
        const state = new BuildingEditorState();
        state.setTool("wall");
        state.updateSelectedWallThickness(0.375);

        const wall = state.addWallBetweenEndpoints(
            { kind: "point", x: -1, y: 0 },
            { kind: "point", x: 1, y: 0 }
        );

        assert.equal(wall.thickness, 0.375);
        state.setTool("select");
        state.updateSelectedWallThickness(0.5);
        assert.equal(wall.thickness, 0.5);
    } finally {
        restoreLocalStorage();
    }
});

test("perimeter walls use wall-thickness inset vertex endpoints", async () => {
    const { model, building, floor } = await createTestBuilding();
    const wall = model.getBuildingWalls(building)[0];
    assert.equal(wall.thickness, 0.25);
    assert.equal(wall.startPoint.kind, "vertex");
    assert.equal(wall.startPoint.inset, true);
    assert.equal(wall.endPoint.kind, "vertex");
    assert.equal(wall.endPoint.inset, true);

    let points = model.wallPoints(building, wall);
    assert.equal(points[0].y, 0.125);
    assert.equal(points[1].y, 0.125);

    wall.thickness = 0.5;
    model.refreshWallSectionEndpoints(building, floor);
    points = model.wallPoints(building, wall);
    assert.equal(points[0].y, 0.25);
    assert.equal(points[1].y, 0.25);
});

test("wall endpoint snapping can choose raw or thickness-inset floor vertices", async () => {
    const { BuildingEditorState } = await loadState();
    const state = new BuildingEditorState();
    state.snapToGrid = false;
    const floor = state.selectedFloor();
    const vertex = floor.outerPolygon[0];
    const rawSnap = state.snapWallEndpoint({ x: Number(vertex.x), y: Number(vertex.y) }, 0.05);

    assert.equal(rawSnap.kind, "vertex");
    assert.equal(rawSnap.point.x, Number(vertex.x));
    assert.equal(rawSnap.point.y, Number(vertex.y));

    const model = await loadModel();
    const inset = model.floorVertexWallInsetPoint(floor, "outer", -1, vertex.id, 0.25);
    const insetSnap = state.snapWallEndpoint(inset, 0.05);

    assert.equal(insetSnap.kind, "vertex");
    assert.equal(insetSnap.endpoint.inset, true);
    assert.equal(insetSnap.point.x, inset.x);
    assert.equal(insetSnap.point.y, inset.y);
});

test("wall endpoint snapping uses weighted distance between snap target types", async () => {
    const { BuildingEditorState } = await loadState();
    const state = new BuildingEditorState();
    state.snapToGrid = false;
    const floor = state.selectedFloor();
    const vertex = floor.outerPolygon[0];
    const vx = Number(vertex.x);
    const vy = Number(vertex.y);
    const wall = state.addWallBetweenEndpoints(
        { kind: "point", x: vx + 0.1, y: vy + 0.15 },
        { kind: "point", x: vx + 1, y: vy + 1 },
        { select: false }
    );
    const point = { x: vx + 0.15, y: vy + 0.2 };

    let snap = state.snapWallEndpoint(point, 1);
    assert.equal(snap.kind, "vertex");
    assert.equal(snap.endpoint.inset, true);

    wall.startPoint.x = vx + 0.13;
    wall.startPoint.y = vy + 0.18;
    snap = state.snapWallEndpoint(point, 1);
    assert.equal(snap.kind, "wallEndpoint");
});

test("detached perimeter endpoint snaps to adjacent vertex endpoint instead of coincident edge", async () => {
    const { BuildingEditorState } = await loadState();
    const model = await loadModel();
    const state = new BuildingEditorState();
    state.snapToGrid = false;
    const wall = model.getBuildingWalls(state.building)[0];
    const target = model.wallPoints(state.building, wall)[0];

    const snap = state.snapWallEndpoint(target, 1, {
        ignoreWallId: wall.id,
        ignoreVertexEndpoint: JSON.parse(JSON.stringify(wall.startPoint)),
        wallThickness: wall.thickness,
        boundaryPointEdgeSnap: true
    });

    assert.equal(snap.kind, "wallEndpoint");
    assert.equal(snap.endpoint.kind, "vertex");
    assert.equal(snap.endpoint.inset, true);
    assert.equal(snap.endpoint.vertexId, wall.startPoint.vertexId);
});

test("wall endpoint floor-edge snap uses inset line when opposite endpoint is inset", async () => {
    const { BuildingEditorState } = await loadState();
    const model = await loadModel();
    const state = new BuildingEditorState();
    state.snapToGrid = false;
    const floor = state.selectedFloor();
    const wall = model.getBuildingWalls(state.building)[0];
    const startVertex = floor.outerPolygon.find((vertex) => vertex.id === wall.startPoint.vertexId);
    const endVertex = floor.outerPolygon.find((vertex) => vertex.id === wall.endPoint.vertexId);
    const rawMidpoint = {
        x: (Number(startVertex.x) + Number(endVertex.x)) * 0.5,
        y: (Number(startVertex.y) + Number(endVertex.y)) * 0.5
    };
    const insetStart = model.floorVertexWallInsetPoint(floor, "outer", -1, startVertex.id, wall.thickness);
    const insetEnd = model.floorVertexWallInsetPoint(floor, "outer", -1, endVertex.id, wall.thickness);
    const insetMidpoint = {
        x: (Number(insetStart.x) + Number(insetEnd.x)) * 0.5,
        y: (Number(insetStart.y) + Number(insetEnd.y)) * 0.5
    };

    const snap = state.snapWallEndpoint(rawMidpoint, 0.5, {
        directionOrigin: insetStart,
        directionOriginEndpoint: JSON.parse(JSON.stringify(wall.startPoint)),
        wallThickness: wall.thickness,
        boundaryPointEdgeSnap: true
    });

    assert.equal(snap.kind, "edge");
    assert.equal(snap.endpoint.kind, "edge");
    assert.ok(Math.abs(Number(snap.point.x) - insetMidpoint.x) < 0.000001);
    assert.ok(Math.abs(Number(snap.point.y) - insetMidpoint.y) < 0.000001);
    assert.notEqual(snap.point.y, rawMidpoint.y);
});

test("vertex-attached wall endpoint can move to a partial point on the same floor edge", async () => {
    const { BuildingEditorState } = await loadState();
    const model = await loadModel();
    const state = new BuildingEditorState();
    state.snapToGrid = false;
    const floor = state.selectedFloor();
    const wall = model.getBuildingWalls(state.building)[0];
    state.selectWall(wall.id);
    state.updateSelectedWallVertexInset(false);
    const startVertex = floor.outerPolygon.find((vertex) => vertex.id === wall.startPoint.vertexId);
    const endVertex = floor.outerPolygon.find((vertex) => vertex.id === wall.endPoint.vertexId);
    const target = {
        x: Number(startVertex.x) + (Number(endVertex.x) - Number(startVertex.x)) * 0.35,
        y: Number(startVertex.y) + (Number(endVertex.y) - Number(startVertex.y)) * 0.35
    };

    state.selectWallEndpoint(wall.id, "startPoint");
    state.moveSelectedWallEndpoint(target, 1, { detachVertexEndpoint: true });

    assert.equal(wall.startPoint.kind, "edge");
    assert.equal(wall.startPoint.boundaryPoint, true);
    assert.equal(wall.attachment, null);
    assert.ok(Math.abs(Number(wall.startPoint.x) - target.x) < 0.000001);
    assert.ok(Math.abs(Number(wall.startPoint.y) - target.y) < 0.000001);
    assert.notEqual(wall.startPoint.vertexId, startVertex.id);
});

test("selected vertex wall endpoints can be inset or protruded", async () => {
    const { BuildingEditorState } = await loadState();
    const model = await loadModel();
    const state = new BuildingEditorState();
    const wall = model.getBuildingWalls(state.building)[0];
    const floor = state.selectedFloor();
    state.selectWall(wall.id);

    assert.equal(state.selectedWallsCanToggleVertexInset(), true);
    state.updateSelectedWallVertexInset(false);
    assert.equal(wall.startPoint.kind, "vertex");
    assert.equal(wall.startPoint.inset, false);
    let points = model.wallPoints(state.building, wall);
    assert.equal(points[0].x, Number(floor.outerPolygon[0].x));
    assert.equal(points[0].y, Number(floor.outerPolygon[0].y));

    state.updateSelectedWallVertexInset(true);
    assert.equal(wall.startPoint.kind, "vertex");
    assert.equal(wall.startPoint.inset, true);
    points = model.wallPoints(state.building, wall);
    assert.notEqual(points[0].x, Number(floor.outerPolygon[0].x));
    assert.notEqual(points[0].y, Number(floor.outerPolygon[0].y));
});

test("protruded perimeter vertex endpoints survive save and load normalization", async () => {
    const { BuildingEditorState } = await loadState();
    const model = await loadModel();
    const state = new BuildingEditorState();
    const wall = model.getBuildingWalls(state.building)[0];
    const floor = state.selectedFloor();
    state.selectWall(wall.id);

    state.updateSelectedWallVertexInset(false);
    const saved = state.serialize();
    const loaded = model.normalizeImportedBuilding(saved);
    const loadedWall = model.getBuildingWalls(loaded).find((candidate) => Number(candidate.id) === Number(wall.id));

    assert.equal(loadedWall.startPoint.kind, "vertex");
    assert.equal(loadedWall.startPoint.inset, false);
    assert.equal(loadedWall.endPoint.inset, false);
    const points = model.wallPoints(loaded, loadedWall);
    assert.equal(points[0].x, Number(floor.outerPolygon[0].x));
    assert.equal(points[0].y, Number(floor.outerPolygon[0].y));
});

test("snap direction constrains wall drags to twelve canonical directions", async () => {
    const restoreLocalStorage = installLocalStorageMock();
    try {
        const { BuildingEditorState } = await loadState();
        const { WallTool } = await loadWallTool();
        const state = new BuildingEditorState();
        state.snapToGrid = false;
        state.snapDirection = true;
        state.setTool("wall");
        const tool = new WallTool(state);

        tool.pointerDown({ x: 0, y: 0 }, 0);
        tool.pointerUp({ x: 1, y: 0.6 }, 0);

        const model = await loadModel();
        const wall = model.getBuildingWalls(state.building).at(-1);
        const points = model.wallPoints(state.building, wall);
        const dx = points[1].x - points[0].x;
        const dy = points[1].y - points[0].y;
        assert.ok(Math.abs(dy / dx - Math.tan(Math.PI / 6)) < 0.000001);
    } finally {
        restoreLocalStorage();
    }
});

test("snap direction constrains floor polygon draft edges to twelve canonical directions", async () => {
    const { BuildingEditorState } = await loadState();
    const { PolygonEditTool } = await loadPolygonEditTool();
    const state = new BuildingEditorState();
    state.snapToGrid = false;
    state.snapDirection = true;
    state.setTool("polygon");
    const tool = new PolygonEditTool(state, "add");

    tool.pointerDown({ x: 0, y: 0 }, 0);
    tool.pointerDown({ x: 1, y: 0.6 }, 0);

    const points = state.draft.points;
    const dx = points[1].x - points[0].x;
    const dy = points[1].y - points[0].y;
    assert.ok(Math.abs(dy / dx - Math.tan(Math.PI / 6)) < 0.000001);
});

test("building editor migrates legacy floor roof fields into roof-owned data", async () => {
    const model = await loadModel();
    const building = model.normalizeImportedBuilding({
        schema: "survivor-building-v1",
        id: "building-legacy",
        defaults: {},
        floorFragments: [{
            fragmentId: "floor-legacy",
            surfaceId: "floor-legacy",
            nodeBaseZ: 0,
            outerPolygon: [
                { id: "a", x: 0, y: 0 },
                { id: "b", x: 4, y: 0 },
                { id: "c", x: 4, y: 3 },
                { id: "d", x: 0, y: 3 }
            ],
            holes: [],
            floorTexturePath: "/assets/images/flooring/woodfloor.png",
            roofTexturePath: "/assets/images/roofs/thatch.png",
            roofOverhang: 0.4,
            roofPeakHeight: 2,
            floorHeight: 3,
            defaultWallHeight: 3,
            defaultWallTexturePath: "/assets/images/walls/woodwall.png"
        }],
        wallSections: [],
        mountedWallObjects: []
    });
    const floor = model.findFloor(building, "floor-legacy");
    const roof = model.getFloorRoof(floor);

    assert.equal(roof.texturePath, "/assets/images/roofs/thatch.png");
    assert.equal(roof.overhang, 0.4);
    assert.equal(roof.peakHeight, 2);
    assert.deepEqual(roof.gables, []);
    assert.equal(Object.hasOwn(floor, "roofTexturePath"), false);
    assert.equal(Object.hasOwn(floor, "roofOverhang"), false);
    assert.equal(Object.hasOwn(floor, "roofPeakHeight"), false);
});

test("roof gables are roof-owned and reject coincident endpoints", async () => {
    const model = await loadModel();
    const roof = model.createRoof({
        floorId: "floor-1",
        peakHeight: 2,
        gables: [{ faceIndex: 1, startT: 0.2, endT: 0.8, height: 1.5 }]
    });

    assert.equal(roof.gables.length, 1);
    assert.equal(roof.gables[0].type, "gable");
    assert.deepEqual(roof.gables[0].start, { edgeIndex: 1, t: 0.2 });
    assert.deepEqual(roof.gables[0].end, { edgeIndex: 1, t: 0.8 });
    assert.equal(roof.gables[0].wallTexturePath, "/assets/images/walls/woodwall.png");
    assert.equal(roof.gables[0].roofReturn, true);
    assert.equal(model.normalizeRoofGable({ faceIndex: 0, startT: 0, endT: 1, height: 1, roofReturn: false }).roofReturn, false);
    assert.throws(() => model.normalizeRoofGable({ faceIndex: 0, startT: 0.5, endT: 0.5, height: 1 }), /endpoints must not coincide/);
});

test("building editor rejects overlapping gables on the same roof face", async () => {
    const { BuildingEditorState } = await loadState();
    const state = new BuildingEditorState();
    const floor = state.selectedFloor();

    state.updateSelectedRoofPeakHeight(2);
    const first = state.addGableToRoof(floor.fragmentId, 0, { startT: 0, endT: 0.5 });

    assert.deepEqual(first.start, { edgeIndex: 0, t: 0 });
    assert.deepEqual(first.end, { edgeIndex: 0, t: 0.5 });
    assert.throws(
        () => state.addGableToRoof(floor.fragmentId, 0, { startT: 0.25, endT: 0.75 }),
        /overlaps gable/
    );
    assert.equal(floor.roof.gables.length, 1);
});

test("painting a gable changes only its wall texture", async () => {
    const { BuildingEditorState } = await loadState();
    const state = new BuildingEditorState();
    const floor = state.selectedFloor();

    state.updateSelectedRoofPeakHeight(2);
    state.updateSelectedRoofTexture("/assets/images/roofs/thatch.png");
    const gable = state.addGableToRoof(floor.fragmentId, 0);
    state.paintGable(floor, gable.id, "/assets/images/walls/stonewall.png");

    assert.equal(floor.roof.texturePath, "/assets/images/roofs/thatch.png");
    assert.equal(gable.wallTexturePath, "/assets/images/walls/stonewall.png");
});

test("selected roofs can be deleted and remain absent after import", async () => {
    const { BuildingEditorState } = await loadState();
    const { validateBuilding } = await import("../public/building-editor/BuildingValidation.js");
    const model = await loadModel();
    const state = new BuildingEditorState();
    const floor = state.selectedFloor();
    const floorId = floor.fragmentId;

    state.selectRoof(floorId);
    assert.equal(state.deleteSelectedRoof(), true);

    assert.equal(floor.roof, null);
    assert.equal(state.selection.kind, "floor");
    assert.deepEqual(validateBuilding(state.building), []);
    assert.throws(() => state.selectRoof(floorId), /missing roof/);

    const imported = model.normalizeImportedBuilding(state.serialize());
    assert.equal(model.findFloor(imported, floorId).roof, null);
    assert.deepEqual(validateBuilding(imported), []);
});

test("selected floors can create a roof with the current roof settings", async () => {
    const { BuildingEditorState } = await loadState();
    const { validateBuilding } = await import("../public/building-editor/BuildingValidation.js");
    const state = new BuildingEditorState();
    const floor = state.selectedFloor();

    state.selectRoof(floor.fragmentId);
    state.deleteSelectedRoof();
    state.setPaintTexture("roofs", "/assets/images/roofs/thatch.png");
    state.updateRoofToolMode("dome");
    state.updateRoofToolOverhang(0.5);
    state.updateRoofToolPeakHeight(2.25);
    state.updateRoofToolDomeLevels(4);

    const roof = state.createRoofForSelectedFloor();

    assert.equal(floor.roof, roof);
    assert.equal(state.selection.kind, "roof");
    assert.equal(roof.texturePath, "/assets/images/roofs/thatch.png");
    assert.equal(roof.mode, "dome");
    assert.equal(roof.overhang, 0.5);
    assert.equal(roof.peakHeight, 2.25);
    assert.equal(roof.domeLevels, 4);
    assert.deepEqual(validateBuilding(state.building), []);
});

test("selecting a roof keeps the active editor tool unchanged", async () => {
    const { BuildingEditorState } = await loadState();
    const state = new BuildingEditorState();
    const floor = state.selectedFloor();

    state.setTool("select");
    state.selectRoof(floor.fragmentId);

    assert.equal(state.selection.kind, "roof");
    assert.equal(state.tool, "select");
});

test("roof creation command selects an existing roof instead of replacing it", async () => {
    const { BuildingEditorState } = await loadState();
    const state = new BuildingEditorState();
    const floor = state.selectedFloor();
    const originalRoof = floor.roof;

    state.inputs.roofPeakHeight = 5;
    state.createRoofForSelectedFloor();

    assert.equal(floor.roof, originalRoof);
    assert.notEqual(floor.roof.peakHeight, 5);
    assert.equal(state.selection.kind, "roof");
});

test("imported same-floor roofs get unique ids for picker colors and mesh keys", async () => {
    const model = await loadModel();
    const { validateBuilding } = await import("../public/building-editor/BuildingValidation.js");
    const building = model.createEmptyBuilding();
    const floor = model.createFloor({
        footprint: [
            { x: 0, y: 0 },
            { x: 4, y: 0 },
            { x: 4, y: 4 },
            { x: 0, y: 4 }
        ],
        createPerimeterWalls: false
    });
    building.floorFragments.push(floor);
    const extraRoof = model.createRoof({
        floorId: floor.fragmentId,
        contactPolygon: [
            { x: 1, y: 1 },
            { x: 3, y: 1 },
            { x: 2, y: 3 }
        ]
    });
    floor.roof.id = "roof-1";
    extraRoof.id = "roof-1";
    floor.roofs = [extraRoof];

    const imported = model.normalizeImportedBuilding(model.serializeBuilding(building));
    const importedFloor = model.findFloor(imported, floor.fragmentId);
    const roofIds = model.getFloorRoofs(importedFloor).map((roof) => roof.id);

    assert.equal(roofIds.length, 2);
    assert.equal(new Set(roofIds).size, roofIds.length);
    assert.equal(roofIds[0], "roof-1");
    assert.notEqual(roofIds[1], "roof-1");
    assert.deepEqual(validateBuilding(imported), []);
});

test("roof placement from a hovered wall uses same-height wall endpoints", async () => {
    const { BuildingEditorState } = await loadState();
    const model = await loadModel();
    const { validateBuilding } = await import("../public/building-editor/BuildingValidation.js");
    const state = new BuildingEditorState();
    const floor = state.selectedFloor();
    const floorId = model.getFloorId(floor);
    const walls = model.getBuildingWalls(state.building)
        .filter((wall) => String(wall.fragmentId || wall.floorId) === floorId);

    state.selectRoof(floorId);
    state.deleteSelectedRoof();
    const roof = state.createRoofFromSupportHit({ type: "wall", floor, wall: walls[0] });

    assert.equal(floor.roof, roof);
    assert.equal(state.selection.kind, "roof");
    assert.equal(roof.elevationOffset, 0);
    const expected = [];
    const seen = new Set();
    walls.flatMap((wall) => model.wallPoints(state.building, wall)).forEach((point) => {
        const key = `${Number(point.x).toFixed(6)},${Number(point.y).toFixed(6)}`;
        if (seen.has(key)) return;
        seen.add(key);
        expected.push(point);
    });
    assertPointSetsAlmostEqual(
        model.getRoofContactPolygon(floor),
        expected
    );
    assert.deepEqual(validateBuilding(state.building), []);
});

test("roof placement from hovered columns uses column centers at that height", async () => {
    const { BuildingEditorState } = await loadState();
    const model = await loadModel();
    const { validateBuilding } = await import("../public/building-editor/BuildingValidation.js");
    const state = new BuildingEditorState();
    const floor = state.selectedFloor();
    const floorId = model.getFloorId(floor);

    state.selectRoof(floorId);
    state.deleteSelectedRoof();
    const columnOptions = {
        width: 1,
        depth: 1,
        height: 5,
        heightMode: "fixed"
    };
    const columns = [
        state.addColumnToFloor(floorId, { ...columnOptions, position: { x: 0, y: 0 } }),
        state.addColumnToFloor(floorId, { ...columnOptions, position: { x: 2, y: 0 } }),
        state.addColumnToFloor(floorId, { ...columnOptions, position: { x: 1, y: 1.5 } })
    ];
    const [column] = columns;
    const roof = state.createRoofFromSupportHit({ type: "column", floor, column });

    assert.equal(roof.elevationOffset, 2);
    assertPointSetsAlmostEqual(
        model.getRoofContactPolygon(floor),
        columns.map((entry) => ({ x: entry.position.x, y: entry.position.y }))
    );
    const columnVertexKeys = new Set(model.columnVertices(column).map((point) => `${point.x.toFixed(6)},${point.y.toFixed(6)}`));
    assert.equal(
        model.getRoofContactPolygon(floor).some((point) => columnVertexKeys.has(`${point.x.toFixed(6)},${point.y.toFixed(6)}`)),
        false
    );
    assert.deepEqual(validateBuilding(state.building), []);
});

test("column-supported shed roofs anchor the contact edge before overhang", async () => {
    const previousEarcut = globalThis.earcut;
    try {
        globalThis.earcut = require("earcut").default;
        const { BuildingEditorState } = await loadState();
        const { BuildingRenderer } = await loadRenderer();
        const model = await loadModel();
        const state = new BuildingEditorState();
        const floor = state.selectedFloor();
        const floorId = model.getFloorId(floor);
        state.selectRoof(floorId);
        state.deleteSelectedRoof();
        const columnOptions = {
            width: 0.5,
            depth: 0.5,
            height: 5,
            heightMode: "fixed"
        };
        const columns = [
            state.addColumnToFloor(floorId, { ...columnOptions, position: { x: 0, y: 0 } }),
            state.addColumnToFloor(floorId, { ...columnOptions, position: { x: 2, y: 0 } }),
            state.addColumnToFloor(floorId, { ...columnOptions, position: { x: 2, y: 2 } }),
            state.addColumnToFloor(floorId, { ...columnOptions, position: { x: 0, y: 2 } })
        ];
        const roof = state.createRoofFromSupportHit({ type: "column", floor, column: columns[0] });
        roof.mode = "shed";
        roof.overhang = 1;
        roof.peakHeight = 2;
        roof.shedDirection = { x: 1, y: 0 };
        const roofView = { ...floor, roof };
        const renderer = Object.create(BuildingRenderer.prototype);
        const triangulation = renderer.triangulateRoof(roofView);
        const baseZ = state.roofSupportColumnElevation(columns[0]) + 0.03;
        const contactRing = model.getRoofContactPolygon(roof);
        const lowProjection = Math.min(...contactRing.map((point) => Number(point.x)));
        const lowContactPoints = contactRing.filter((point) => Math.abs(Number(point.x) - lowProjection) < 0.000001);

        assert.equal(lowContactPoints.length, 2);
        lowContactPoints.forEach((point) => {
            assert.ok(Math.abs(triangulatedZAt(triangulation, point) - baseZ) < 0.000001);
            assert.ok(Math.abs(state.roofShedTopZAt(roofView, point) - (baseZ - 0.001)) < 0.000001);
        });
    } finally {
        if (typeof previousEarcut === "undefined") {
            delete globalThis.earcut;
        } else {
            globalThis.earcut = previousEarcut;
        }
    }
});

test("gabled roofs anchor both contact sides before overhang and peak at center ridge", async () => {
    const previousEarcut = globalThis.earcut;
    try {
        globalThis.earcut = require("earcut").default;
        const { BuildingEditorState } = await loadState();
        const { BuildingRenderer } = await loadRenderer();
        const model = await loadModel();
        const state = new BuildingEditorState();
        const floor = state.selectedFloor();
        const floorId = model.getFloorId(floor);
        state.selectRoof(floorId);
        state.deleteSelectedRoof();
        const columnOptions = {
            width: 0.5,
            depth: 0.5,
            height: 5,
            heightMode: "fixed"
        };
        const columns = [
            state.addColumnToFloor(floorId, { ...columnOptions, position: { x: 0, y: 0 } }),
            state.addColumnToFloor(floorId, { ...columnOptions, position: { x: 2, y: 0 } }),
            state.addColumnToFloor(floorId, { ...columnOptions, position: { x: 2, y: 2 } }),
            state.addColumnToFloor(floorId, { ...columnOptions, position: { x: 0, y: 2 } })
        ];
        const roof = state.createRoofFromSupportHit({ type: "column", floor, column: columns[0] });
        roof.mode = "gabled";
        roof.overhang = 1;
        roof.peakHeight = 2;
        roof.shedDirection = { x: 1, y: 0 };
        const roofView = { ...floor, roof };
        const renderer = Object.create(BuildingRenderer.prototype);
        const triangulation = renderer.triangulateRoof(roofView);
        const baseZ = state.roofSupportColumnElevation(columns[0]) + 0.03;

        [{ x: 0, y: 0 }, { x: 0, y: 2 }, { x: 2, y: 0 }, { x: 2, y: 2 }].forEach((point) => {
            assert.ok(Math.abs(triangulatedZAt(triangulation, point) - baseZ) < 0.000001);
        });
        [{ x: 1, y: 0 }, { x: 1, y: 2 }].forEach((point) => {
            assert.ok(Math.abs(triangulatedZAt(triangulation, point) - (baseZ + 2)) < 0.000001);
        });
        assert.ok(Math.abs(triangulatedZAt(triangulation, { x: -1, y: 0 }) - (baseZ - 2)) < 0.000001);
        assert.ok(Math.abs(triangulatedZAt(triangulation, { x: 3, y: 0 }) - (baseZ - 2)) < 0.000001);
    } finally {
        if (typeof previousEarcut === "undefined") {
            delete globalThis.earcut;
        } else {
            globalThis.earcut = previousEarcut;
        }
    }
});

test("roof placement can add an independent porch roof on the same floor", async () => {
    const { BuildingEditorState } = await loadState();
    const model = await loadModel();
    const { validateBuilding } = await import("../public/building-editor/BuildingValidation.js");
    const state = new BuildingEditorState();
    const floor = state.selectedFloor();
    const floorId = model.getFloorId(floor);
    const mainRoof = floor.roof;
    const floorWalls = model.getBuildingWalls(state.building)
        .filter((wall) => String(wall.fragmentId || wall.floorId) === floorId);
    const originalWallHeights = new Map(floorWalls.map((wall) => [String(wall.id), Number(wall.height)]));

    const columnOptions = {
        width: 1,
        depth: 1,
        height: 5,
        heightMode: "fixed"
    };
    const columns = [
        state.addColumnToFloor(floorId, { ...columnOptions, position: { x: -1, y: -1 } }),
        state.addColumnToFloor(floorId, { ...columnOptions, position: { x: 1, y: -1 } }),
        state.addColumnToFloor(floorId, { ...columnOptions, position: { x: 1, y: 1 } }),
        state.addColumnToFloor(floorId, { ...columnOptions, position: { x: -1, y: 1 } })
    ];
    const [column] = columns;
    const porchRoof = state.createRoofFromSupportHit({ type: "column", floor, column });

    assert.equal(floor.roof, mainRoof);
    assert.notEqual(porchRoof, mainRoof);
    assert.equal(floor.roofs.length, 1);
    assert.equal(floor.roofs[0], porchRoof);
    assert.equal(state.selection.kind, "roof");
    assert.equal(state.selection.roofId, porchRoof.id);

    state.updateSelectedRoofMode("shed");
    assert.equal(mainRoof.mode, "peak");
    assert.equal(porchRoof.mode, "shed");
    floorWalls.forEach((wall) => {
        assert.equal(wall.topProfile, null);
        assert.equal(wall.height, originalWallHeights.get(String(wall.id)));
    });
    state.paintRoof(floor, "/assets/images/roofs/porch-test.png", { roofId: porchRoof.id });
    assert.notEqual(mainRoof.texturePath, porchRoof.texturePath);
    assert.equal(porchRoof.texturePath, "/assets/images/roofs/porch-test.png");
    assertPointSetsAlmostEqual(
        model.getRoofContactPolygon(porchRoof),
        columns.map((entry) => ({ x: entry.position.x, y: entry.position.y }))
    );
    assert.deepEqual(validateBuilding(state.building), []);

    const imported = model.normalizeImportedBuilding(state.serialize());
    const importedFloor = model.findFloor(imported, floorId);
    assert.equal(model.getFloorRoof(importedFloor).mode, "peak");
    assert.equal(model.getFloorRoofs(importedFloor).length, 2);
    assert.equal(model.getFloorRoofs(importedFloor)[1].mode, "shed");
});

test("selected roofs carry draggable elevation offsets", async () => {
    const { BuildingEditorState } = await loadState();
    const { validateBuilding } = await import("../public/building-editor/BuildingValidation.js");
    const state = new BuildingEditorState();
    const firstFloor = state.selectedFloor();
    const firstFloorId = firstFloor.fragmentId;
    const secondFloor = state.duplicateSelectedFloor();
    const secondFloorId = secondFloor.fragmentId;

    state.selectRoofs([firstFloorId, secondFloorId]);
    state.moveSelectedRoofsVerticalDelta([
        { floorId: firstFloorId, elevationOffset: firstFloor.roof.elevationOffset },
        { floorId: secondFloorId, elevationOffset: secondFloor.roof.elevationOffset }
    ], 1.25);

    assert.equal(state.selection.kind, "roof");
    assert.deepEqual(state.selectedRoofFloorIds(), [firstFloorId, secondFloorId]);
    assert.equal(firstFloor.roof.elevationOffset, 1.25);
    assert.equal(secondFloor.roof.elevationOffset, 1.25);
    assert.deepEqual(validateBuilding(state.building), []);

    state.moveSelectedRoofsVerticalDelta([
        { floorId: firstFloorId, elevationOffset: firstFloor.roof.elevationOffset },
        { floorId: secondFloorId, elevationOffset: secondFloor.roof.elevationOffset }
    ], -1.2, { snapDistance: 0.1 });
    assert.equal(firstFloor.roof.elevationOffset, 0);
    assert.equal(secondFloor.roof.elevationOffset, 0);
});

test("roof elevation offset survives import", async () => {
    const { BuildingEditorState } = await loadState();
    const model = await loadModel();
    const state = new BuildingEditorState();
    const floor = state.selectedFloor();
    floor.roof.elevationOffset = -0.75;

    const imported = model.normalizeImportedBuilding(state.serialize());
    assert.equal(model.findFloor(imported, floor.fragmentId).roof.elevationOffset, -0.75);
});

test("roof vertices snap to rendered peak roof edges and follow vertical roof moves", async () => {
    const { BuildingEditorState } = await loadState();
    const model = await loadModel();
    const { validateBuilding } = await import("../public/building-editor/BuildingValidation.js");
    const state = new BuildingEditorState();
    state.snapToGrid = false;
    const floor = state.selectedFloor();
    const floorId = model.getFloorId(floor);
    const mainRoof = model.getFloorRoof(floor);
    mainRoof.peakHeight = 4;
    mainRoof.overhang = 0;
    mainRoof.peakPoint = { x: 0, y: 0 };
    const targetRoof = model.createRoof({
        floorId,
        mode: "peak",
        peakHeight: 0,
        elevationOffset: 1,
        contactPolygon: [
            { x: -2.05, y: -1.2 },
            { x: -0.8, y: -1.3 },
            { x: -1.8, y: -0.2 }
        ]
    });
    floor.roofs = [targetRoof];

    const attachment = {
        type: "renderedRoofEdge",
        floorId,
        roofId: mainRoof.id,
        edgeKind: "peakEave",
        edgeIndex: 0
    };
    const initialEdgePoint = state.resolveRoofEdgeAttachmentPoint(floor, targetRoof, attachment);
    state.selectRoofVertex(floorId, 0, { roofId: targetRoof.id });
    assert.equal(state.moveSelectedRoofVertex({ x: initialEdgePoint.x + 0.02, y: initialEdgePoint.y - 0.01 }), true);

    assert.ok(Math.abs(targetRoof.contactPolygon[0].x - initialEdgePoint.x) < 0.000001);
    assert.ok(Math.abs(targetRoof.contactPolygon[0].y - initialEdgePoint.y) < 0.000001);
    assert.deepEqual(targetRoof.contactPolygon[0].roofEdgeAttachment, attachment);

    state.moveSelectedRoofsVerticalDelta([
        { floorId, roofId: targetRoof.id, elevationOffset: targetRoof.elevationOffset }
    ], 1);

    const movedEdgePoint = state.resolveRoofEdgeAttachmentPoint(floor, targetRoof, attachment);
    assert.equal(targetRoof.elevationOffset, 2);
    assert.ok(Math.abs(targetRoof.contactPolygon[0].x - movedEdgePoint.x) < 0.000001);
    assert.ok(Math.abs(targetRoof.contactPolygon[0].y - movedEdgePoint.y) < 0.000001);
    assert.notEqual(targetRoof.contactPolygon[0].x, initialEdgePoint.x);
    assert.notEqual(targetRoof.contactPolygon[0].y, initialEdgePoint.y);
    assert.deepEqual(validateBuilding(state.building), []);

    const imported = model.normalizeImportedBuilding(state.serialize());
    const importedFloor = model.findFloor(imported, floorId);
    const importedTargetRoof = model.getFloorRoofs(importedFloor).find((roof) => roof.id === targetRoof.id);
    assert.deepEqual(importedTargetRoof.contactPolygon[0].roofEdgeAttachment, attachment);
});

test("roofs save editable contact vertices separately from derived overhang", async () => {
    const { BuildingEditorState } = await loadState();
    const model = await loadModel();
    const { validateBuilding } = await import("../public/building-editor/BuildingValidation.js");
    const state = new BuildingEditorState();
    state.snapToGrid = false;
    const floor = state.selectedFloor();
    const roof = floor.roof;

    assert.deepEqual(
        model.getRoofContactPolygon(floor).map((point) => ({ x: point.x, y: point.y })),
        floor.outerPolygon.map((point) => ({ x: point.x, y: point.y }))
    );

    state.selectRoofVertex(floor.fragmentId, 0);
    state.moveSelectedRoofVertex({ x: -0.75, y: -0.25 });

    assert.equal(roof.contactPolygon[0].x, -0.75);
    assert.equal(roof.contactPolygon[0].y, -0.25);
    assert.notEqual(floor.outerPolygon[0].x, roof.contactPolygon[0].x);
    assert.deepEqual(validateBuilding(state.building), []);
});

test("roof selection outline follows editable contact polygon instead of overhang", async () => {
    const { floor } = await createTestBuilding();
    const { BuildingRenderer } = await loadRenderer();
    floor.roof.overhang = 1;
    floor.roof.peakHeight = 2;
    const renderer = Object.create(BuildingRenderer.prototype);
    renderer.worldToScreen = (point) => ({ x: Number(point.x), y: Number(point.y) });

    const selectionRing = renderer.roofContactScreenGeometry(floor, "test selection")[0][0];
    const renderRing = renderer.roofScreenGeometry(floor, "test render")[0][0];
    const bounds = (ring) => ring.reduce((box, point) => ({
        minX: Math.min(box.minX, Number(point[0])),
        maxX: Math.max(box.maxX, Number(point[0])),
        minY: Math.min(box.minY, Number(point[1])),
        maxY: Math.max(box.maxY, Number(point[1]))
    }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });

    assert.deepEqual(bounds(selectionRing), { minX: 0, maxX: 10, minY: 0, maxY: 10 });
    assert.ok(bounds(renderRing).minX < 0);
    assert.ok(bounds(renderRing).maxX > 10);
    assert.ok(bounds(renderRing).minY < 0);
    assert.ok(bounds(renderRing).maxY > 10);
});

test("selected roof outline draws contact polygon instead of overhang", async () => {
    const { BuildingEditorState } = await loadState();
    const { BuildingRenderer } = await loadRenderer();
    const state = new BuildingEditorState();
    const floor = state.selectedFloor();
    floor.roof.overhang = 1;
    floor.roof.peakHeight = 2;
    state.selectRoof(floor.fragmentId);
    const renderer = Object.create(BuildingRenderer.prototype);
    renderer.state = state;
    renderer.selectionOutlineLayer = { clear() {} };
    renderer.worldToScreen = (point) => ({ x: Number(point.x), y: Number(point.y) });
    const outlines = [];
    renderer.drawClipGeometryOutline = (_gfx, geometry, label) => outlines.push({ geometry, label });

    renderer.drawSelectionOutline();

    assert.equal(outlines.length, 1);
    assert.equal(outlines[0].label, `roof ${floor.fragmentId} selection outline`);
    const ring = outlines[0].geometry[0][0];
    const xs = ring.map((point) => Number(point[0]));
    const ys = ring.map((point) => Number(point[1]));
    assert.equal(Math.min(...xs), -2.598);
    assert.equal(Math.max(...xs), 2.598);
    assert.equal(Math.min(...ys), -1.5);
    assert.equal(Math.max(...ys), 1.5);
});

test("selected roof vertex keeps the roof outline visible", async () => {
    const { BuildingEditorState } = await loadState();
    const { BuildingRenderer } = await loadRenderer();
    const state = new BuildingEditorState();
    const floor = state.selectedFloor();
    floor.roof.overhang = 1;
    state.selectRoofVertex(floor.fragmentId, 0);
    const renderer = Object.create(BuildingRenderer.prototype);
    renderer.state = state;
    renderer.selectionOutlineLayer = { clear() {} };
    renderer.worldToScreen = (point) => ({ x: Number(point.x), y: Number(point.y) });
    const outlines = [];
    renderer.drawClipGeometryOutline = (_gfx, geometry, label) => outlines.push({ geometry, label });

    renderer.drawSelectionOutline();

    assert.equal(outlines.length, 1);
    assert.equal(outlines[0].label, `roof ${floor.fragmentId} selection outline`);
    const ring = outlines[0].geometry[0][0];
    const xs = ring.map((point) => Number(point[0]));
    const ys = ring.map((point) => Number(point[1]));
    assert.equal(Math.min(...xs), -2.598);
    assert.equal(Math.max(...xs), 2.598);
    assert.equal(Math.min(...ys), -1.5);
    assert.equal(Math.max(...ys), 1.5);
});

test("roof vertex snapping uses one mitered perimeter corner per inset wall corner", async () => {
    const { BuildingEditorState } = await loadState();
    const state = new BuildingEditorState();
    const floor = state.selectedFloor();

    const candidates = state.roofVertexSnapCandidates(floor);
    const perimeterCorners = candidates.filter((candidate) => candidate.kind === "perimeterWallOuterCorner");
    const lowerVertices = candidates.filter((candidate) => candidate.kind === "lowerFloorVertex");

    assert.equal(perimeterCorners.length, floor.outerPolygon.length);
    assert.equal(lowerVertices.length, 0);
    assertPointSetsAlmostEqual(perimeterCorners.map((candidate) => candidate.point), floor.outerPolygon);
});

test("roof vertex snapping uses protruded perimeter wall miters instead of floor corners", async () => {
    const { BuildingEditorState } = await loadState();
    const model = await loadModel();
    const state = new BuildingEditorState();
    const floor = state.selectedFloor();
    const walls = model.getBuildingWalls(state.building)
        .filter((wall) => String(wall.fragmentId || wall.floorId) === model.getFloorId(floor));

    state.selectWalls(walls.map((wall) => wall.id));
    state.updateSelectedWallVertexInset(false);

    const candidates = state.roofVertexSnapCandidates(floor);
    const perimeterCorners = candidates.filter((candidate) => candidate.kind === "perimeterWallOuterCorner");
    const lowerVertices = candidates.filter((candidate) => candidate.kind === "lowerFloorVertex");
    const expected = model.offsetRing(floor.outerPolygon, Number(walls[0].thickness) * 0.5);

    assert.equal(perimeterCorners.length, floor.outerPolygon.length);
    assert.equal(lowerVertices.length, 0);
    assertPointSetsAlmostEqual(perimeterCorners.map((candidate) => candidate.point), expected);
});

test("walls save resolved footprint and top geometry for render-time mesh building", async () => {
    const { BuildingEditorState } = await loadState();
    const model = await loadModel();
    const { validateBuilding } = await import("../public/building-editor/BuildingValidation.js");
    const state = new BuildingEditorState();
    const floor = state.selectedFloor();
    const floorId = model.getFloorId(floor);
    const walls = model.getBuildingWalls(state.building)
        .filter((wall) => String(wall.fragmentId || wall.floorId) === floorId);

    state.selectWalls(walls.map((wall) => wall.id));
    state.updateSelectedWallVertexInset(false);

    const saved = JSON.parse(state.serialize());
    const savedWalls = model.getBuildingWalls(saved)
        .filter((wall) => String(wall.fragmentId || wall.floorId) === floorId);
    assert.equal(savedWalls.length, walls.length);
    savedWalls.forEach((wall) => {
        assert.equal(wall.resolvedGeometry.version, 1);
        ["aLeft", "aRight", "bLeft", "bRight"].forEach((key) => {
            assert.equal(Number.isFinite(Number(wall.resolvedGeometry.profile[key].x)), true);
            assert.equal(Number.isFinite(Number(wall.resolvedGeometry.profile[key].y)), true);
        });
        assert.ok(wall.resolvedGeometry.topStations.length >= 2);
        wall.resolvedGeometry.topStations.forEach((station) => {
            assert.equal(Number.isFinite(Number(station.left.z)), true);
            assert.equal(Number.isFinite(Number(station.right.z)), true);
        });
    });
    assert.deepEqual(validateBuilding(saved), []);

    const expectedOuterCorners = model.offsetRing(floor.outerPolygon, Number(walls[0].thickness) * 0.5);
    const savedProfileCorners = savedWalls.flatMap((wall) => {
        const profile = wall.resolvedGeometry.profile;
        return [profile.aLeft, profile.aRight, profile.bLeft, profile.bRight];
    });
    expectedOuterCorners.forEach((expected) => {
        assert.ok(savedProfileCorners.some((point) => (
            Math.abs(Number(point.x) - Number(expected.x)) < 0.000001 &&
            Math.abs(Number(point.y) - Number(expected.y)) < 0.000001
        )), `missing saved resolved corner ${expected.x},${expected.y}`);
    });

    const imported = model.normalizeImportedBuilding(state.serialize());
    assert.deepEqual(validateBuilding(imported), []);
});

test("renderer wall units rebuild from saved mitered geometry on creation", async () => {
    loadWallSectionUnit();
    const { BuildingEditorState } = await loadState();
    const { BuildingRenderer } = await loadRenderer();
    const model = await loadModel();
    const state = new BuildingEditorState();
    const floor = state.selectedFloor();
    const floorId = model.getFloorId(floor);
    const walls = model.getBuildingWalls(state.building)
        .filter((wall) => String(wall.fragmentId || wall.floorId) === floorId);

    state.selectWalls(walls.map((wall) => wall.id));
    state.updateSelectedWallVertexInset(false);

    const renderer = Object.create(BuildingRenderer.prototype);
    renderer.state = state;
    renderer.wallUnitById = new Map();

    const wall = walls[0];
    const entry = renderer.ensureWallUnit(wall, floor);
    const vertices = entry.unit.mesh3d.vertices;
    const profile = model.getWallResolvedGeometry(wall).profile;
    const meshPoints = [];
    for (let index = 0; index < vertices.length; index += 3) {
        meshPoints.push({ x: Number(vertices[index]), y: Number(vertices[index + 1]) });
    }
    [profile.aLeft, profile.aRight, profile.bLeft, profile.bRight].forEach((expected) => {
        assert.ok(meshPoints.some((point) => (
            Math.abs(point.x - Number(expected.x)) < 0.000001 &&
            Math.abs(point.y - Number(expected.y)) < 0.000001
        )), `renderer mesh is missing resolved miter corner ${expected.x},${expected.y}`);
    });
});

test("peak roofs store a draggable peak point with center snapping", async () => {
    const { BuildingEditorState } = await loadState();
    const model = await loadModel();
    const { validateBuilding } = await import("../public/building-editor/BuildingValidation.js");
    const state = new BuildingEditorState();
    state.snapToGrid = false;
    const floor = state.selectedFloor();
    const center = model.defaultRoofPeakPointForFloor(floor);

    assert.equal(floor.roof.mode, "peak");
    assert.deepEqual(model.getRoofPeakPoint(floor), center);

    state.selectRoofPeak(floor.fragmentId);
    state.moveSelectedRoofPeak({ x: center.x + 0.1, y: center.y - 0.1 });
    assert.deepEqual(floor.roof.peakPoint, center);

    state.moveSelectedRoofPeak({ x: center.x + 1, y: center.y + 0.5, z: 99 });
    assert.equal(floor.roof.peakPoint.x, center.x + 1);
    assert.equal(floor.roof.peakPoint.y, center.y + 0.5);
    assert.equal(Object.hasOwn(floor.roof.peakPoint, "z"), false);
    assert.deepEqual(validateBuilding(state.building), []);

    const imported = model.normalizeImportedBuilding(state.serialize());
    assert.deepEqual(model.getRoofPeakPoint(model.findFloor(imported, floor.fragmentId)), floor.roof.peakPoint);
});

test("inserting a roof contact vertex splits the roof edge and remaps gables", async () => {
    const { BuildingEditorState } = await loadState();
    const state = new BuildingEditorState();
    const floor = state.selectedFloor();

    state.updateSelectedRoofPeakHeight(2);
    state.addGableToRoof(floor.fragmentId, 0, {
        start: { edgeIndex: 0, t: 0.25 },
        end: { edgeIndex: 0, t: 0.75 }
    });

    assert.equal(state.insertRoofVertexOnKnownEdge(floor.fragmentId, 0, { x: 0, y: 0 }, 0.5), true);
    const gable = floor.roof.gables[0];
    assert.equal(floor.roof.contactPolygon.length, 5);
    assert.equal(state.selection.kind, "roofVertex");
    assert.equal(state.selection.vertexIndex, 1);
    assert.equal(gable.start.edgeIndex, 0);
    assert.equal(gable.start.t, 0.5);
    assert.equal(gable.end.edgeIndex, 1);
    assert.equal(gable.end.t, 0.5);
});

test("editing a secondary roof vertex preserves the selected roof id", async () => {
    const { BuildingEditorState } = await loadState();
    const model = await loadModel();
    const state = new BuildingEditorState();
    const floor = state.selectedFloor();
    const primaryVertexCount = model.getRoofContactPolygon(floor.roof).length;
    const secondaryRoof = model.createRoof({
        floorId: floor.fragmentId,
        contactPolygon: [
            { x: -1, y: -1 },
            { x: 1, y: -1 },
            { x: 0, y: 1 }
        ]
    });
    floor.roofs = [secondaryRoof];

    assert.equal(state.insertRoofVertexOnKnownEdge(floor.fragmentId, 0, { x: 0, y: -1 }, 0.5, { roofId: secondaryRoof.id }), true);

    assert.equal(state.selection.kind, "roofVertex");
    assert.equal(state.selection.roofId, secondaryRoof.id);
    assert.equal(model.getRoofContactPolygon(secondaryRoof).length, 4);
    assert.equal(model.getRoofContactPolygon(floor.roof).length, primaryVertexCount);

    assert.equal(state.deleteSelectedRoofVertex(), true);
    assert.equal(state.selection.kind, "roofVertex");
    assert.equal(state.selection.roofId, secondaryRoof.id);
    assert.equal(model.getRoofContactPolygon(secondaryRoof).length, 3);
    assert.equal(model.getRoofContactPolygon(floor.roof).length, primaryVertexCount);
});

test("shed roofs raise vertices along direction without moving roof polygon xy", async () => {
    const previousEarcut = globalThis.earcut;
    try {
        globalThis.earcut = require("earcut").default;
        const { floor } = await createTestBuilding();
        const { BuildingRenderer } = await loadRenderer();
        floor.roof.mode = "shed";
        floor.roof.overhang = 0;
        floor.roof.peakHeight = 2;
        floor.roof.shedDirection = { x: 1, y: 0 };
        const renderer = Object.create(BuildingRenderer.prototype);
        const triangulation = renderer.triangulateRoof(floor);
        const rimZ = Number(floor.floorHeight) + 0.03;
        const low = triangulation.points.filter((point) => Math.abs(Number(point.x)) < 0.000001);
        const high = triangulation.points.filter((point) => Math.abs(Number(point.x) - 10) < 0.000001);

        assert.ok(low.length > 0);
        assert.ok(high.length > 0);
        low.forEach((point) => assert.ok(Math.abs(Number(point.z) - rimZ) < 0.000001));
        high.forEach((point) => assert.ok(Math.abs(Number(point.z) - (rimZ + 2)) < 0.000001));
        assert.deepEqual(
            new Set(triangulation.points.map((point) => `${Number(point.x)},${Number(point.y)}`)),
            new Set(floor.roof.contactPolygon.map((point) => `${Number(point.x)},${Number(point.y)}`))
        );
    } finally {
        if (typeof previousEarcut === "undefined") {
            delete globalThis.earcut;
        } else {
            globalThis.earcut = previousEarcut;
        }
    }
});

test("shed roof texture top is oriented toward the high side", async () => {
    const previousEarcut = globalThis.earcut;
    try {
        globalThis.earcut = require("earcut").default;
        const { floor } = await createTestBuilding();
        const { BuildingRenderer } = await loadRenderer();
        floor.roof.mode = "shed";
        floor.roof.overhang = 0;
        floor.roof.peakHeight = 2;
        floor.roof.shedDirection = { x: 0, y: 1 };
        const renderer = Object.create(BuildingRenderer.prototype);
        const triangulation = renderer.triangulateRoof(floor);
        const low = triangulation.points.filter((point) => Math.abs(Number(point.y)) < 0.000001);
        const high = triangulation.points.filter((point) => Math.abs(Number(point.y) - 10) < 0.000001);

        assert.ok(low.length > 0);
        assert.ok(high.length > 0);
        high.forEach((point) => {
            assert.ok(Math.abs(Number(point.v)) < 0.000001);
        });
        low.forEach((point) => {
            assert.ok(Number(point.v) > 0);
        });

        const leftHigh = high.find((point) => Math.abs(Number(point.x)) < 0.000001);
        const rightHigh = high.find((point) => Math.abs(Number(point.x) - 10) < 0.000001);
        assert.ok(leftHigh);
        assert.ok(rightHigh);
        assert.ok(Math.abs(Number(rightHigh.u) - Number(leftHigh.u)) > 0.000001);
    } finally {
        if (typeof previousEarcut === "undefined") {
            delete globalThis.earcut;
        } else {
            globalThis.earcut = previousEarcut;
        }
    }
});

test("roof UVs use repeatsPerMapUnitX and repeatsPerMapUnitY from the texture manifest", async () => {
    const previousEarcut = globalThis.earcut;
    try {
        globalThis.earcut = require("earcut").default;
        const { floor } = await createTestBuilding();
        const { BuildingRenderer } = await loadRenderer();
        floor.roof.mode = "shed";
        floor.roof.overhang = 0;
        floor.roof.peakHeight = 0;
        floor.roof.texturePath = "/assets/images/roofs/test-repeat.png";
        floor.roof.shedDirection = { x: 0, y: 1 };
        const renderer = Object.create(BuildingRenderer.prototype);
        renderer.roofTextureConfigCache = {
            byPath: new Map([[
                "/assets/images/roofs/test-repeat.png",
                {
                    texturePath: "/assets/images/roofs/test-repeat.png",
                    repeatsPerMapUnitX: 0.01,
                    repeatsPerMapUnitY: 0.01
                }
            ]]),
            byFile: new Map(),
            defaultRepeatX: 0.5,
            defaultRepeatY: 0.5
        };
        renderer.roofTextureConfigError = "";
        const triangulation = renderer.triangulateRoof(floor);
        const low = triangulation.points.filter((point) => Math.abs(Number(point.y)) < 0.000001);
        const high = triangulation.points.filter((point) => Math.abs(Number(point.y) - 10) < 0.000001);
        const leftHigh = high.find((point) => Math.abs(Number(point.x)) < 0.000001);
        const rightHigh = high.find((point) => Math.abs(Number(point.x) - 10) < 0.000001);

        assert.ok(low.length > 0);
        assert.ok(high.length > 0);
        assert.ok(leftHigh);
        assert.ok(rightHigh);
        assert.ok(Math.abs(Math.abs(Number(rightHigh.u) - Number(leftHigh.u)) - 0.1) < 0.000001);
        low.forEach((point) => {
            assert.ok(Math.abs(Number(point.v) - 0.1) < 0.000001);
        });
        high.forEach((point) => {
            assert.ok(Math.abs(Number(point.v)) < 0.000001);
        });
    } finally {
        if (typeof previousEarcut === "undefined") {
            delete globalThis.earcut;
        } else {
            globalThis.earcut = previousEarcut;
        }
    }
});

test("dome roofs build equidistant z levels on a hemispherical curve", async () => {
    const previousEarcut = globalThis.earcut;
    try {
        globalThis.earcut = require("earcut").default;
        const { floor } = await createTestBuilding();
        const { BuildingRenderer } = await loadRenderer();
        floor.roof.mode = "dome";
        floor.roof.overhang = 0;
        floor.roof.peakHeight = 4;
        floor.roof.domeLevels = 4;
        const renderer = Object.create(BuildingRenderer.prototype);
        const triangulation = renderer.triangulateRoof(floor);
        const baseZ = Number(floor.floorHeight) + 0.03;
        const uniqueZ = [...new Set(triangulation.points.map((point) => Number(point.z).toFixed(6)))].map(Number).sort((a, b) => a - b);

        assert.deepEqual(uniqueZ, [baseZ, baseZ + 1, baseZ + 2, baseZ + 3, baseZ + 4].map((value) => Number(value.toFixed(6))));

        const middleLevel = triangulation.points.filter((point) => Math.abs(Number(point.z) - (baseZ + 2)) < 0.000001);
        const middleScale = Math.sqrt(1 - 0.5 * 0.5);
        const minX = Math.min(...middleLevel.map((point) => Number(point.x)));
        const maxX = Math.max(...middleLevel.map((point) => Number(point.x)));
        assert.ok(Math.abs(minX - (5 - 5 * middleScale)) < 0.000001);
        assert.ok(Math.abs(maxX - (5 + 5 * middleScale)) < 0.000001);

        const apex = triangulation.points.filter((point) => Math.abs(Number(point.z) - (baseZ + 4)) < 0.000001);
        assert.ok(apex.length > 0);
        apex.forEach((point) => {
            assert.ok(Math.abs(Number(point.x) - 5) < 0.000001);
            assert.ok(Math.abs(Number(point.y) - 5) < 0.000001);
        });
    } finally {
        if (typeof previousEarcut === "undefined") {
            delete globalThis.earcut;
        } else {
            globalThis.earcut = previousEarcut;
        }
    }
});

test("dome roof facets use planar UVs oriented toward the top", async () => {
    const { floor } = await createTestBuilding();
    const { BuildingRenderer } = await loadRenderer();
    floor.roof.mode = "dome";
    floor.roof.overhang = 0;
    floor.roof.peakHeight = 4;
    floor.roof.domeLevels = 4;
    floor.roof.texturePath = "/assets/images/roofs/dome-repeat-test.png";
    const renderer = Object.create(BuildingRenderer.prototype);
    renderer.roofTextureConfigCache = {
        byPath: new Map([[
            "/assets/images/roofs/dome-repeat-test.png",
            {
                texturePath: "/assets/images/roofs/dome-repeat-test.png",
                repeatsPerMapUnitX: 0.01,
                repeatsPerMapUnitY: 0.01
            }
        ]]),
        byFile: new Map(),
        defaultRepeatX: 0.5,
        defaultRepeatY: 0.5
    };
    renderer.roofTextureConfigError = "";

    const triangulation = renderer.triangulateRoof(floor);
    let checkedSlopedFacet = false;
    for (let index = 0; index < triangulation.points.length; index += 3) {
        const triangle = triangulation.points.slice(index, index + 3);
        const zValues = triangle.map((point) => Number(point.z));
        const minZ = Math.min(...zValues);
        const maxZ = Math.max(...zValues);
        if (maxZ - minZ <= 0.000001) continue;
        const vValues = triangle.map((point) => Number(point.v));
        const uValues = triangle.map((point) => Number(point.u));

        triangle.forEach((point) => {
            assert.ok(Number.isFinite(Number(point.u)));
            assert.ok(Number.isFinite(Number(point.v)));
        });
        triangle
            .filter((point) => Math.abs(Number(point.z) - maxZ) <= 0.000001)
            .forEach((point) => assert.ok(Math.abs(Number(point.v)) < 0.000001));
        triangle
            .filter((point) => Math.abs(Number(point.z) - maxZ) > 0.000001)
            .forEach((point) => assert.ok(Number(point.v) > 0));
        assert.ok(Math.max(...uValues) - Math.min(...uValues) > 0);
        assert.ok(Math.max(...vValues) - Math.min(...vValues) >= (maxZ - minZ) * 0.01 - 0.000001);
        assert.ok(Math.max(...vValues) - Math.min(...vValues) < 0.1);
        checkedSlopedFacet = true;
    }
    assert.equal(checkedSlopedFacet, true);
});

test("building editor camera pitch preserves default projection and round-trips screen points", async () => {
    const { BuildingRenderer } = await loadRenderer();
    const renderer = Object.create(BuildingRenderer.prototype);
    renderer.app = { screen: { width: 100, height: 100 } };
    renderer.state = {
        camera: {
            x: 1,
            y: 1,
            z: 0,
            zoom: 10,
            rotation: 0,
            pitch: BuildingRenderer.DEFAULT_CAMERA_PITCH,
            rotationCenter: { x: 0, y: 0 }
        },
        buildingCenter() {
            return { x: 0, y: 0 };
        }
    };

    const point = { x: 3, y: 4 };
    const defaultScreen = renderer.worldToScreen(point, 2);
    assert.ok(Math.abs(defaultScreen.x - 70) < 0.000001);
    assert.ok(Math.abs(defaultScreen.y - 56.6) < 0.000001);
    const defaultRoundTrip = renderer.screenToWorld(defaultScreen, 2);
    assert.ok(Math.abs(defaultRoundTrip.x - point.x) < 0.000001);
    assert.ok(Math.abs(defaultRoundTrip.y - point.y) < 0.000001);

    renderer.state.camera.pitch = Math.PI / 6;
    const pitchedScreen = renderer.worldToScreen(point, 2);
    assert.notEqual(Number(pitchedScreen.y).toFixed(6), Number(defaultScreen.y).toFixed(6));
    const roundTrip = renderer.screenToWorld(pitchedScreen, 2);
    assert.ok(Math.abs(roundTrip.x - point.x) < 0.000001);
    assert.ok(Math.abs(roundTrip.y - point.y) < 0.000001);
});

test("building camera can recenter on the whole building bounds", async () => {
    const { BuildingEditorState } = await loadState();
    const model = await loadModel();
    const state = new BuildingEditorState();
    const firstFloor = state.selectedFloor();
    model.duplicateFloor(state.building, model.getFloorId(firstFloor), 3);
    state.camera.x = 50;
    state.camera.y = -20;
    state.camera.z = 0;
    state.camera.rotation = 0.7;
    state.camera.pitch = Math.PI / 5;

    state.centerCameraOnBuilding();

    assert.equal(state.camera.x, 0);
    assert.equal(state.camera.y, -3);
    assert.deepEqual(state.camera.rotationCenter, state.buildingCenter());
});

test("camera rotation center prefers selected object then selected floor then average floor centers", async () => {
    const { BuildingEditorState } = await loadState();
    const model = await loadModel();
    const state = new BuildingEditorState();
    const firstFloor = state.selectedFloor();
    const secondFloor = model.createFloor({
        elevation: 3,
        footprint: [
            { x: 20, y: 10 },
            { x: 24, y: 10 },
            { x: 24, y: 14 },
            { x: 20, y: 14 }
        ],
        createPerimeterWalls: false
    });
    model.addFloor(state.building, secondFloor);
    const column = state.addColumnToFloor(firstFloor.fragmentId, { position: { x: 1.25, y: -0.5 } });

    state.selectColumn(firstFloor.fragmentId, column.id);
    assert.deepEqual(state.updateCameraRotationCenter(), { x: 1.25, y: -0.5 });

    state.selectLevel(secondFloor.fragmentId);
    assert.deepEqual(state.updateCameraRotationCenter(), { x: 22, y: 12 });

    state.selectBuilding();
    assert.deepEqual(state.updateCameraRotationCenter(), { x: 11, y: 6 });
});

test("shed roof direction handle updates a normalized roof direction", async () => {
    const { BuildingEditorState } = await loadState();
    const state = new BuildingEditorState();
    const floor = state.selectedFloor();
    state.updateSelectedRoofMode("shed");
    const center = state.roofShedBaseCenter(floor);

    state.selectRoofShedDirection(floor.fragmentId);
    assert.equal(state.moveSelectedRoofShedDirection({ x: center.x, y: center.y + 3 }), true);

    assert.equal(floor.roof.mode, "shed");
    assert.ok(Math.abs(floor.roof.shedDirection.x) < 0.000001);
    assert.ok(Math.abs(floor.roof.shedDirection.y - 1) < 0.000001);
});

test("shed roof direction snaps to perpendicular base-polygon edge hits", async () => {
    const { BuildingEditorState } = await loadState();
    const state = new BuildingEditorState();
    const floor = state.selectedFloor();
    state.updateSelectedRoofMode("shed");
    state.selectRoofShedDirection(floor.fragmentId);
    const candidates = state.roofShedDirectionSnapCandidates(floor);
    const rightEdgeSnap = candidates.find((candidate) => candidate.edgeIndex === 1);

    assert.ok(rightEdgeSnap);
    assert.ok(Math.abs(rightEdgeSnap.direction.x - 1) < 0.000001);
    assert.ok(Math.abs(rightEdgeSnap.direction.y) < 0.000001);

    const center = state.roofShedBaseCenter(floor);
    state.moveSelectedRoofShedDirection({
        x: center.x + 1.2,
        y: center.y + 0.1
    });

    assert.ok(Math.abs(floor.roof.shedDirection.x - 1) < 0.000001);
    assert.ok(Math.abs(floor.roof.shedDirection.y) < 0.000001);
});

test("shed roofs write real wall top profiles to the roof plane", async () => {
    const { BuildingEditorState } = await loadState();
    const model = await loadModel();
    const state = new BuildingEditorState();
    const floor = state.selectedFloor();
    const wall = model.getBuildingWalls(state.building)[0];
    const originalHeight = Number(wall.height);

    state.updateSelectedRoofMode("shed");
    state.updateSelectedRoofPeakHeight(4);
    const center = state.roofShedBaseCenter(floor);
    state.selectRoofShedDirection(floor.fragmentId);
    assert.equal(state.moveSelectedRoofShedDirection({ x: center.x + 3, y: center.y }), true);

    const profile = wall.topProfile;
    assert.equal(profile.kind, "stations");
    assert.equal(profile.generatedBy.type, "roof");
    assert.equal(profile.generatedBy.mode, "shed");
    assert.equal(profile.generatedBy.plane.kind, "shedPlane");
    assert.equal(profile.generatedBy.originalHeight, originalHeight);
    assert.equal(profile.stations.length, 2);

    const wallPoints = model.wallPoints(state.building, wall);
    const [a, b] = wallPoints;
    const dx = Number(b.x) - Number(a.x);
    const dy = Number(b.y) - Number(a.y);
    const length = Math.hypot(dx, dy);
    const nx = -dy / length;
    const ny = dx / length;
    const half = Number(wall.thickness) * 0.5;
    const corners = [
        { x: Number(a.x) + nx * half, y: Number(a.y) + ny * half },
        { x: Number(b.x) + nx * half, y: Number(b.y) + ny * half },
        { x: Number(b.x) - nx * half, y: Number(b.y) - ny * half },
        { x: Number(a.x) - nx * half, y: Number(a.y) - ny * half }
    ];
    const bottomZ = model.getFloorElevation(floor);
    const range = state.roofShedProjectionRange(floor);
    const expected = corners.map((point) => state.roofShedTopZAt(floor, point, range) - bottomZ);

    assert.ok(Math.abs(profile.stations[0].leftHeight - expected[0]) < 0.000001);
    assert.ok(Math.abs(profile.stations[1].leftHeight - expected[1]) < 0.000001);
    assert.ok(Math.abs(profile.stations[1].rightHeight - expected[2]) < 0.000001);
    assert.ok(Math.abs(profile.stations[0].rightHeight - expected[3]) < 0.000001);
    assert.ok(profile.stations[1].leftHeight > profile.stations[0].leftHeight + 3);
    assert.equal(wall.height, Math.max(...expected));

    state.updateSelectedRoofMode("dome");
    assert.equal(wall.topProfile, null);
    assert.equal(wall.height, originalHeight);
});

test("gabled roofs write wall top profiles with base height on both slope sides", async () => {
    const { BuildingEditorState } = await loadState();
    const model = await loadModel();
    const { validateBuilding } = await import("../public/building-editor/BuildingValidation.js");
    const state = new BuildingEditorState();
    const floor = state.selectedFloor();
    const floorId = model.getFloorId(floor);
    const contactRing = model.getRoofContactPolygon(floor);
    const minX = Math.min(...contactRing.map((point) => Number(point.x)));
    const maxX = Math.max(...contactRing.map((point) => Number(point.x)));
    const center = state.roofShedBaseCenter(floor);
    const interiorWall = state.addWallBetweenEndpoints(
        { kind: "point", x: minX, y: center.y },
        { kind: "point", x: maxX, y: center.y },
        { select: false }
    );
    const crossingWall = state.addWallBetweenEndpoints(
        { kind: "point", x: minX - 0.75, y: center.y + 0.25 },
        { kind: "point", x: maxX + 0.75, y: center.y + 0.25 },
        { select: false }
    );

    state.updateSelectedRoofMode("gabled");
    state.updateSelectedRoofPeakHeight(4);
    state.selectRoofShedDirection(floor.fragmentId);
    assert.equal(state.moveSelectedRoofShedDirection({ x: center.x + 3, y: center.y }), true);

    assert.equal(floor.roof.mode, "gabled");
    assert.deepEqual(validateBuilding(state.building), []);
    const bottomZ = model.getFloorElevation(floor);
    const baseHeight = state.roofShedTopZAt(floor, { x: minX, y: center.y }) - bottomZ;
    const oppositeBaseHeight = state.roofShedTopZAt(floor, { x: maxX, y: center.y }) - bottomZ;
    const ridgeHeight = state.roofShedTopZAt(floor, center) - bottomZ;

    assert.ok(Math.abs(baseHeight - oppositeBaseHeight) < 0.000001);
    model.getBuildingWalls(state.building)
        .filter((wall) => String(wall.fragmentId || wall.floorId) === floorId)
        .forEach((wall) => {
            assert.equal(wall.topProfile.generatedBy.mode, "gabled");
            assert.equal(wall.topProfile.generatedBy.plane.mode, "gabled");
            const points = model.wallPoints(state.building, wall);
            const wallXs = points.map((point) => Number(point.x));
            const onSlopeSide = wallXs.every((x) => Math.abs(x - minX) < 0.000001) ||
                wallXs.every((x) => Math.abs(x - maxX) < 0.000001);
            if (!onSlopeSide) return;
            wall.topProfile.stations.forEach((station) => {
                assert.ok(Math.abs(station.leftHeight - baseHeight) < 0.000001);
                assert.ok(Math.abs(station.rightHeight - baseHeight) < 0.000001);
            });
        });

    assert.equal(interiorWall.topProfile.generatedBy.mode, "gabled");
    assert.equal(interiorWall.topProfile.stations.length, 3);
    assert.equal(interiorWall.topProfile.stations[1].t, 0.5);
    assert.ok(Math.abs(interiorWall.topProfile.stations[0].leftHeight - baseHeight) < 0.000001);
    assert.ok(Math.abs(interiorWall.topProfile.stations[0].rightHeight - baseHeight) < 0.000001);
    assert.ok(Math.abs(interiorWall.topProfile.stations[1].leftHeight - ridgeHeight) < 0.000001);
    assert.ok(Math.abs(interiorWall.topProfile.stations[1].rightHeight - ridgeHeight) < 0.000001);
    assert.ok(Math.abs(interiorWall.topProfile.stations[2].leftHeight - oppositeBaseHeight) < 0.000001);
    assert.ok(Math.abs(interiorWall.topProfile.stations[2].rightHeight - oppositeBaseHeight) < 0.000001);
    assert.equal(crossingWall.topProfile.generatedBy.mode, "gabled");
    assert.equal(crossingWall.topProfile.generatedBy.plane.mode, "gabled");
    assert.equal(crossingWall.topProfile.stations.length, 3);
    assert.equal(crossingWall.topProfile.stations[1].t, 0.5);
});

test("shed roof generated wall profiles evaluate at mitered wall top corners", async () => {
    const WallSectionUnit = loadWallSectionUnit();
    const { BuildingEditorState } = await loadState();
    const { BuildingRenderer } = await loadRenderer();
    const model = await loadModel();
    const state = new BuildingEditorState();
    const floor = state.selectedFloor();

    state.updateSelectedRoofMode("shed");
    state.updateSelectedRoofPeakHeight(4);
    const center = state.roofShedBaseCenter(floor);
    state.selectRoofShedDirection(floor.fragmentId);
    assert.equal(state.moveSelectedRoofShedDirection({ x: center.x + 3, y: center.y }), true);

    const renderer = Object.create(BuildingRenderer.prototype);
    renderer.state = state;
    const floorId = model.getFloorId(floor);
    const bottomZ = model.getFloorElevation(floor);
    const entries = model.getBuildingWalls(state.building)
        .filter((wall) => String(wall.fragmentId || wall.floorId) === floorId)
        .map((wall) => {
            const points = model.wallPoints(state.building, wall);
            const unit = new WallSectionUnit(
                { ...points[0], _splitVertex: true },
                { ...points[1], _splitVertex: true },
                {
                    id: wall.id,
                    height: Number(wall.height),
                    thickness: Number(wall.thickness),
                    bottomZ,
                    topProfile: wall.topProfile,
                    deferSetup: true,
                    suppressAutoScriptingName: true
                }
            );
            return { wall, floor, entry: { unit } };
        });

    entries.forEach(({ wall, entry }) => {
        renderer.applyResolvedGeometryToWallUnit(entry.unit, wall);
        entry.unit.rebuildMesh3d();
    });
    const range = state.roofShedProjectionRange(floor);
    let checkedTopVertices = 0;
    entries.forEach(({ entry }) => {
        const mesh = entry.unit.mesh3d;
        assert.equal(mesh.kind, "wallSectionProfiledPrism");
        for (let triangle = 0; triangle < mesh.indices.length / 3; triangle++) {
            if (mesh.faceKinds[triangle] !== "top") continue;
            for (let corner = 0; corner < 3; corner++) {
                const vertex = Number(mesh.indices[triangle * 3 + corner]) * 3;
                const point = {
                    x: Number(mesh.vertices[vertex]),
                    y: Number(mesh.vertices[vertex + 1])
                };
                const z = Number(mesh.vertices[vertex + 2]);
                assert.ok(Math.abs(z - state.roofShedTopZAt(floor, point, range)) < 0.000001);
                checkedTopVertices++;
            }
        }
    });
    assert.ok(checkedTopVertices > 0);
});

test("gabled roof generated wall profiles evaluate every mitered top vertex on the roof plane", async () => {
    const WallSectionUnit = loadWallSectionUnit();
    const { BuildingEditorState } = await loadState();
    const { BuildingRenderer } = await loadRenderer();
    const model = await loadModel();
    const state = new BuildingEditorState();
    const floor = state.selectedFloor();

    state.updateSelectedRoofMode("gabled");
    state.updateSelectedRoofPeakHeight(4);
    const center = state.roofShedBaseCenter(floor);
    state.selectRoofShedDirection(floor.fragmentId);
    assert.equal(state.moveSelectedRoofShedDirection({ x: center.x + 3, y: center.y + 1 }), true);

    const renderer = Object.create(BuildingRenderer.prototype);
    renderer.state = state;
    const floorId = model.getFloorId(floor);
    const bottomZ = model.getFloorElevation(floor);
    const range = state.roofShedProjectionRange(floor);
    const entries = model.getBuildingWalls(state.building)
        .filter((wall) => String(wall.fragmentId || wall.floorId) === floorId)
        .map((wall) => {
            const points = model.wallPoints(state.building, wall);
            const unit = new WallSectionUnit(
                { ...points[0], _splitVertex: true },
                { ...points[1], _splitVertex: true },
                {
                    id: wall.id,
                    height: Number(wall.height),
                    thickness: Number(wall.thickness),
                    bottomZ,
                    topProfile: wall.topProfile,
                    deferSetup: true,
                    suppressAutoScriptingName: true
                }
            );
            return { wall, entry: { unit } };
        });

    let expectedMiterRidgeStations = 0;
    entries.forEach(({ wall }) => {
        const plane = wall.topProfile.generatedBy.plane;
        const ridgeProjection = (Number(plane.minProjection) + Number(plane.maxProjection)) * 0.5;
        const stationTs = wall.topProfile.stations.map((station) => Number(station.t));
        const profile = model.getWallResolvedGeometry(wall).profile;
        [
            [profile.aLeft, profile.bLeft],
            [profile.aRight, profile.bRight]
        ].forEach(([start, end]) => {
            const startProjection = Number(start.x) * Number(plane.direction.x) + Number(start.y) * Number(plane.direction.y);
            const endProjection = Number(end.x) * Number(plane.direction.x) + Number(end.y) * Number(plane.direction.y);
            const denominator = endProjection - startProjection;
            if (Math.abs(denominator) <= 0.000001) return;
            const t = (ridgeProjection - startProjection) / denominator;
            if (t <= 0.000001 || t >= 0.999999) return;
            expectedMiterRidgeStations++;
            assert.ok(stationTs.some((stationT) => Math.abs(stationT - t) < 0.000001));
        });
    });
    assert.ok(expectedMiterRidgeStations > 0);

    entries.forEach(({ wall, entry }) => {
        renderer.applyResolvedGeometryToWallUnit(entry.unit, wall);
        entry.unit.rebuildMesh3d();
    });
    let checkedTopVertices = 0;
    entries.forEach(({ entry }) => {
        const mesh = entry.unit.mesh3d;
        assert.equal(mesh.kind, "wallSectionProfiledPrism");
        for (let triangle = 0; triangle < mesh.indices.length / 3; triangle++) {
            if (mesh.faceKinds[triangle] !== "top") continue;
            for (let corner = 0; corner < 3; corner++) {
                const vertex = Number(mesh.indices[triangle * 3 + corner]) * 3;
                const point = {
                    x: Number(mesh.vertices[vertex]),
                    y: Number(mesh.vertices[vertex + 1])
                };
                const z = Number(mesh.vertices[vertex + 2]);
                assert.ok(Math.abs(z - state.roofShedTopZAt(floor, point, range)) < 0.000001);
                checkedTopVertices++;
            }
        }
    });
    assert.ok(checkedTopVertices > 0);
});

test("profiled wall units render sloped tops and collapse to the top cap", async () => {
    const WallSectionUnit = loadWallSectionUnit();
    const unit = new WallSectionUnit(
        { x: 0, y: 0, _splitVertex: true },
        { x: 10, y: 0, _splitVertex: true },
        {
            height: 4,
            thickness: 1,
            bottomZ: 0,
            topProfile: {
                kind: "stations",
                stations: [
                    { t: 0, leftHeight: 1, rightHeight: 0.8 },
                    { t: 1, leftHeight: 4, rightHeight: 3.8 }
                ]
            },
            deferSetup: true,
            suppressAutoScriptingName: true
        }
    );

    const mesh = unit.rebuildMesh3d();
    assert.equal(mesh.kind, "wallSectionProfiledPrism");
    assert.ok(mesh.faceKinds.includes("top"));
    const zValues = [];
    for (let index = 2; index < mesh.vertices.length; index += 3) {
        zValues.push(Number(mesh.vertices[index]));
    }
    assert.equal(Math.min(...zValues), 0);
    assert.equal(Math.max(...zValues), 4);
    assert.ok(zValues.includes(0.8));

    const full = unit._buildDepthGeometry({});
    const collapsed = unit._buildDepthGeometry({ bottomFaceOnly: true });
    assert.ok(collapsed.positions.length < full.positions.length);
    assert.equal(collapsed.indices.length, 6);
    for (let index = 2; index < collapsed.positions.length; index += 3) {
        assert.ok(Math.abs(Number(collapsed.positions[index]) - 0.025) < 0.000001);
    }
});

test("non-shed wall rendering hides cached shed-clipped wall meshes", async () => {
    const { BuildingRenderer } = await loadRenderer();
    const renderer = Object.create(BuildingRenderer.prototype);
    const mesh = { visible: true };
    renderer.clippedWallMeshById = new Map([["12", { mesh }]]);

    renderer.hideShedClippedWallMesh({ id: 12 });

    assert.equal(mesh.visible, false);
});

test("deleting a roof contact vertex deletes dependent gables", async () => {
    const { BuildingEditorState } = await loadState();
    const state = new BuildingEditorState();
    const floor = state.selectedFloor();

    state.updateSelectedRoofPeakHeight(2);
    const gable = state.addGableToRoof(floor.fragmentId, 0, { startT: 0, endT: 0.5 });
    assert.equal(floor.roof.gables.length, 1);

    state.selectRoofVertex(floor.fragmentId, 0);
    assert.equal(state.deleteSelectedRoofVertex(), true);

    assert.ok(gable);
    assert.equal(floor.roof.gables.length, 0);
    assert.equal(floor.roof.contactPolygon.length, 3);
});

test("deleting a roof contact vertex below three vertices deletes the roof", async () => {
    const { BuildingEditorState } = await loadState();
    const state = new BuildingEditorState();
    const floor = state.selectedFloor();

    floor.roof.contactPolygon = floor.roof.contactPolygon.slice(0, 3);
    state.selectRoofVertex(floor.fragmentId, 1);
    assert.equal(state.deleteSelectedRoofVertex(), true);

    assert.equal(floor.roof, null);
    assert.equal(state.selection.kind, "floor");
});

test("deleting a roof removes gable-mounted windows on that roof", async () => {
    const { BuildingEditorState } = await loadState();
    const model = await loadModel();
    const state = new BuildingEditorState();
    const floor = state.selectedFloor();
    state.updateSelectedRoofPeakHeight(2);
    const gable = state.addGableToRoof(floor.fragmentId, 0);
    state.building.mountedWallObjects.push(model.createGableMountedObject({
        floorId: floor.fragmentId,
        gableId: gable.id,
        gableSegmentIndex: 0,
        category: "windows",
        texturePath: "/assets/images/windows/window.png",
        wallT: 0.5,
        width: 1,
        height: 0.5,
        zOffset: 3.5
    }));

    state.selectRoof(floor.fragmentId);
    state.deleteSelectedRoof();

    assert.equal(floor.roof, null);
    assert.equal(model.getBuildingMountedObjects(state.building).length, 0);
});

test("gable wall UVs use wall texture repeats and perimeter-continuous wrapping", async () => {
    const previousWallSectionUnit = globalThis.WallSectionUnit;
    try {
        const { model, building, floor } = await createTestBuilding();
        const { BuildingRenderer } = await loadRenderer();
        const wallTexturePath = "/assets/images/walls/custom-gable.png";
        const gable = model.normalizeRoofGable({
            start: { edgeIndex: 0, t: 0.2 },
            end: { edgeIndex: 0, t: 0.8 },
            height: 2,
            wallTexturePath
        });
        floor.floorHeight = 3;
        floor.roof.peakHeight = 4;
        floor.roof.gables = [gable];
        model.getBuildingWalls(building)[0].texturePhaseA = 0.25;

        globalThis.WallSectionUnit = {
            _getWallTextureRepeatConfig(texturePath) {
                assert.equal(texturePath, wallTexturePath);
                return { repeatsPerMapUnitX: 0.2, repeatsPerMapUnitY: 0.5 };
            }
        };

        const renderer = Object.create(BuildingRenderer.prototype);
        renderer.state = { building };
        const triangulation = renderer.triangulateGableWall(floor, gable);
        const [start, midpointBottom, midpointTop, secondMidpointBottom, end, secondMidpointTop] = triangulation.points;

        assert.equal(start.u, 0.65);
        assert.equal(midpointBottom.u, 1.25);
        assert.equal(midpointTop.u, 1.25);
        assert.equal(end.u, 1.85);
        assert.equal(start.v, -1.515);
        assert.equal(midpointBottom.v, -1.515);
        assert.ok(Math.abs(midpointTop.v + 2.515) < 1e-9);
        assert.equal(secondMidpointBottom.x, midpointTop.x);
        assert.equal(secondMidpointTop.y, secondMidpointBottom.y);
    } finally {
        if (typeof previousWallSectionUnit === "undefined") {
            delete globalThis.WallSectionUnit;
        } else {
            globalThis.WallSectionUnit = previousWallSectionUnit;
        }
    }
});

test("gable walls split into sections across floor outline corners", async () => {
    const previousWallSectionUnit = globalThis.WallSectionUnit;
    try {
        const { model, building, floor } = await createTestBuilding();
        const { BuildingRenderer } = await loadRenderer();
        const wallTexturePath = "/assets/images/walls/custom-gable.png";
        const gable = model.normalizeRoofGable({
            start: { edgeIndex: 0, t: 0.5 },
            end: { edgeIndex: 1, t: 0.5 },
            height: 2,
            wallTexturePath
        });
        floor.floorHeight = 3;
        floor.roof.peakHeight = 4;
        floor.roof.gables = [gable];
        const walls = model.getBuildingWalls(building);
        walls[0].texturePhaseA = 0.25;
        walls[1].texturePhaseA = 0.5;

        globalThis.WallSectionUnit = {
            _getWallTextureRepeatConfig(texturePath) {
                assert.equal(texturePath, wallTexturePath);
                return { repeatsPerMapUnitX: 0.2, repeatsPerMapUnitY: 0.5 };
            }
        };

        const renderer = Object.create(BuildingRenderer.prototype);
        renderer.state = { building };
        const triangulation = renderer.triangulateGableWall(floor, gable);

        assert.equal(triangulation.indices.length, 6);
        assert.equal(triangulation.points.length, 6);
        assert.equal(triangulation.points[0].u, 1.25);
        assert.equal(triangulation.points[1].u, 2.25);
        assert.equal(triangulation.points[3].u, 2.5);
        assert.equal(triangulation.points[4].u, 3.5);
    } finally {
        if (typeof previousWallSectionUnit === "undefined") {
            delete globalThis.WallSectionUnit;
        } else {
            globalThis.WallSectionUnit = previousWallSectionUnit;
        }
    }
});

test("gable endpoint drags snap to roof outline vertices", async () => {
    const { model, building, floor } = await createTestBuilding();
    const { BuildingRenderer } = await loadRenderer();
    const gable = model.normalizeRoofGable({
        start: { edgeIndex: 0, t: 0.2 },
        end: { edgeIndex: 0, t: 0.8 },
        height: 2
    });
    floor.floorHeight = 3;
    floor.roof.peakHeight = 4;
    floor.roof.gables = [gable];

    const renderer = Object.create(BuildingRenderer.prototype);
    renderer.app = { screen: { width: 1000, height: 1000 } };
    renderer.state = {
        building,
        camera: { x: 0, y: 0, z: 0, zoom: 20, rotation: 0 }
    };
    const vertexScreen = renderer.worldToScreen(floor.outerPolygon[1], 3.03);
    const snapped = renderer.gableEdgeTAtScreen(floor, gable, {
        x: vertexScreen.x + 4,
        y: vertexScreen.y - 3
    }, 12);
    const unsnapped = renderer.gableEdgeTAtScreen(floor, gable, {
        x: vertexScreen.x - 40,
        y: vertexScreen.y
    }, 12);

    assert.deepEqual(snapped, { edgeIndex: 1, t: 0 });
    assert.equal(unsnapped.edgeIndex, 0);
    assert.ok(unsnapped.t > 0.7 && unsnapped.t < 1);
});

test("selected gable height updates clamp to roof peak height", async () => {
    const { BuildingEditorState } = await loadState();
    const state = new BuildingEditorState();
    const floor = state.selectedFloor();

    state.updateSelectedRoofPeakHeight(2);
    const gable = state.addGableToRoof(floor.fragmentId, 0);
    state.updateSelectedGableHeight(5);

    assert.equal(gable.height, 2);

    state.updateSelectedGableHeight(1.25);
    assert.equal(gable.height, 1.25);
    assert.equal(gable.roofReturn, true);
    state.updateSelectedGableRoofReturn(false);
    assert.equal(gable.roofReturn, false);
});

test("unchecked gable roof return clips only the main roof overhang under the gable eave", async () => {
    const previousClipper = globalThis.polygonClipping;
    const previousEarcut = globalThis.earcut;
    try {
        globalThis.polygonClipping = require("polygon-clipping");
        globalThis.earcut = require("earcut").default;
        const { model, floor } = await createTestBuilding();
        const { BuildingRenderer } = await loadRenderer();
        floor.floorHeight = 3;
        floor.roof.overhang = 1;
        floor.roof.peakHeight = 4;
        floor.roof.gables = [model.normalizeRoofGable({
            start: { edgeIndex: 0, t: 0.2 },
            end: { edgeIndex: 0, t: 0.8 },
            height: 2,
            roofReturn: true
        })];
        const renderer = Object.create(BuildingRenderer.prototype);
        const returnArea = triangulationXyArea(renderer.triangulateRoof(floor));
        floor.roof.gables = [model.normalizeRoofGable({
            start: { edgeIndex: 0, t: 0.2 },
            end: { edgeIndex: 0, t: 0.8 },
            height: 2,
            roofReturn: false
        })];
        const noReturnArea = triangulationXyArea(renderer.triangulateRoof(floor));
        const clippedArea = returnArea - noReturnArea;

        assert.ok(clippedArea > 3.8 && clippedArea < 4.0, `expected only the sloped radial overhang strip to be clipped, got ${clippedArea}`);
    } finally {
        if (typeof previousClipper === "undefined") {
            delete globalThis.polygonClipping;
        } else {
            globalThis.polygonClipping = previousClipper;
        }
        if (typeof previousEarcut === "undefined") {
            delete globalThis.earcut;
        } else {
            globalThis.earcut = previousEarcut;
        }
    }
});

test("windows can mount to gable wall segments without wall ids", async () => {
    const { model, building, floor } = await createTestBuilding();
    const { validateBuilding } = await import("../public/building-editor/BuildingValidation.js");
    const { BuildingRenderer } = await loadRenderer();
    floor.floorHeight = 3;
    floor.roof.peakHeight = 4;
    const gable = model.normalizeRoofGable({
        start: { edgeIndex: 0, t: 0.2 },
        end: { edgeIndex: 0, t: 0.8 },
        height: 2
    });
    floor.roof.gables = [gable];
    const window = model.createGableMountedObject({
        floorId: floor.fragmentId,
        gableId: gable.id,
        gableSegmentIndex: 0,
        category: "windows",
        texturePath: "/assets/images/windows/window.png",
        wallT: 0.5,
        width: 1,
        height: 0.5,
        zOffset: 3.5
    });
    building.mountedWallObjects.push(window);

    assert.equal(window.wallId, null);
    assert.deepEqual(validateBuilding(building), []);

    const renderer = Object.create(BuildingRenderer.prototype);
    renderer.state = {
        building,
        isFloorSelected(floorId) {
            return String(floorId) === String(floor.fragmentId);
        }
    };
    const placement = renderer.mountedObjectPlacement(window);
    assert.equal(placement.mountKind, "gable");
    assert.equal(placement.gable.id, gable.id);
    assert.equal(placement.gableSegmentIndex, 0);
    assert.equal(placement.points.length, 2);
    assert.ok(placement.wallHeight > 0);

    renderer.app = { screen: { width: 1000, height: 1000 } };
    renderer.state.camera = { x: 0, y: 0, z: 0, zoom: 30, rotation: 0 };
    const candidate = renderer.resolveGableMountedPlacementCandidate(floor, gable, {
        category: "windows",
        width: 0.5,
        height: 0.5,
        anchorY: 0.5
    }, renderer.worldToScreen({ x: 3.5, y: 0 }, 3.8));
    assert.ok(candidate);
    assert.equal(candidate.mountKind, "gable");
    assert.equal(candidate.valid, true);
});

test("gable window placement snaps to the merged gable span center", async () => {
    const { model, building, floor } = await createTestBuilding();
    const { BuildingRenderer } = await loadRenderer();
    floor.floorHeight = 3;
    floor.roof.peakHeight = 4;
    const gable = model.normalizeRoofGable({
        start: { edgeIndex: 0, t: 0.2 },
        end: { edgeIndex: 0, t: 0.8 },
        height: 2
    });
    floor.roof.gables = [gable];

    const renderer = Object.create(BuildingRenderer.prototype);
    renderer.app = { screen: { width: 1000, height: 1000 } };
    renderer.state = {
        building,
        camera: { x: 0, y: 0, z: 0, zoom: 30, rotation: 0 },
        isFloorSelected() {
            return true;
        }
    };
    const placement = renderer.resolveGableMountedPlacementCandidate(floor, gable, {
        category: "windows",
        width: 0.5,
        height: 0.5,
        anchorY: 0.5
    }, renderer.worldToScreen({ x: 5.1, y: 0 }, 4));

    assert.ok(placement);
    assert.equal(placement.centerSnapActive, true);
    assert.ok(Math.abs(placement.wallCenter.x - 5) < 0.000001);
    assert.ok(Math.abs(placement.resizeWallT - 0.5) < 0.000001);
});

test("gable window horizontal resize uses the merged straight span across the ridge split", async () => {
    const { model, building, floor } = await createTestBuilding();
    const { BuildingRenderer } = await loadRenderer();
    const { SelectTool } = await loadSelectTool();
    floor.floorHeight = 3;
    floor.roof.peakHeight = 4;
    const gable = model.normalizeRoofGable({
        start: { edgeIndex: 0, t: 0.2 },
        end: { edgeIndex: 0, t: 0.8 },
        height: 2
    });
    floor.roof.gables = [gable];
    const window = model.createGableMountedObject({
        floorId: floor.fragmentId,
        gableId: gable.id,
        gableSegmentIndex: 0,
        category: "windows",
        texturePath: "/assets/images/windows/window.png",
        wallT: 1,
        width: 0.5,
        height: 0.5,
        zOffset: 3.7
    });
    building.mountedWallObjects.push(window);

    const renderer = Object.create(BuildingRenderer.prototype);
    renderer.state = {
        building,
        isFloorSelected() {
            return true;
        }
    };
    const tool = Object.create(SelectTool.prototype);
    const bounds = tool.mountedObjectResizeBounds(window, renderer);

    assert.ok(bounds.maxWidth > 5.9);
});

test("createBeam produces a valid beam record with defaults", async () => {
    const model = await loadModel();
    const { building, floor } = await createTestBuilding();
    const beam = model.createBeam({
        floorId: floor.fragmentId,
        startAttachment: { kind: "free", x: 1, y: 1 },
        endAttachment: { kind: "free", x: 5, y: 1 }
    });
    assert.equal(beam.type, "beam");
    assert.ok(Number.isInteger(beam.id));
    assert.equal(beam.floorId, floor.fragmentId);
    assert.equal(beam.thickness, 0.001);
    assert.equal(beam.height, 0.2);
    assert.equal(beam.startOverhang, 0);
    assert.equal(beam.endOverhang, 0);
    assert.equal(beam.startAttachment.kind, "free");
    assert.equal(beam.endAttachment.kind, "free");
    assert.throws(() => model.createBeam({ floorId: floor.fragmentId, thickness: 0.0009 }),
        /thickness must be at least/);
    assert.throws(() => model.createBeam({ floorId: floor.fragmentId, height: -1 }),
        /height must be a positive/);
    void (building);
});

test("createColumn produces a valid column record with defaults", async () => {
    const model = await loadModel();
    const { floor } = await createTestBuilding();
    const col = model.createColumn({
        floorId: floor.fragmentId,
        position: { x: 3, y: 3 },
        floorDefaultWallHeight: 3
    });
    assert.equal(col.type, "column");
    assert.ok(Number.isInteger(col.id));
    assert.equal(col.floorId, floor.fragmentId);
    assert.equal(col.sideCount, 4);
    assert.equal(col.size, 0.125);
    assert.equal(col.width, 0.25);
    assert.equal(col.depth, 0.25);
    assert.equal(col.height, 3);
    assert.equal(col.heightMode, "fixed");
    assert.throws(() => model.createColumn({ floorId: floor.fragmentId, position: { x: 0, y: 0 }, sideCount: 2 }),
        /sideCount must be between/);
    assert.throws(() => model.createColumn({ floorId: floor.fragmentId, position: { x: 0, y: 0 }, sideCount: 13 }),
        /sideCount must be between/);
    assert.throws(() => model.createColumn({ floorId: floor.fragmentId, position: { x: 0, y: 0 }, size: -1 }),
        /width.*must be a positive/);
});

test("column tool defaults to host wall height and one millimeter extra thickness", async () => {
    const { BuildingEditorState } = await loadState();
    const { ColumnTool } = await loadColumnTool();
    const { model, building, floor } = await createTestBuilding();
    const wall = model.getBuildingWalls(building)[0];
    wall.height = 4.25;
    wall.thickness = 0.375;
    const pts = model.wallPoints(building, wall);
    const point = {
        x: (pts[0].x + pts[1].x) * 0.5,
        y: (pts[0].y + pts[1].y) * 0.5
    };
    const state = new BuildingEditorState();
    state.building = building;
    state.selectFloor(floor.fragmentId);
    const tool = new ColumnTool(state);

    tool.pointerDown(point, 0.5, {
        screenPoint: { x: 10, y: 10 },
        renderer: {
            pickAtScreen() {
                return { type: "wall", wall, floor };
            }
        }
    });

    const [column] = model.getFloorColumns(floor);
    assert.ok(column, "column was placed");
    assert.equal(column.height, 4.25);
    assert.equal(column.heightMode, "wall");
    assert.equal(column.sideCount, 4);
    assert.ok(Math.abs(column.depth - 0.376) < 0.0000001);
    assert.equal(column.width, 0.25);
    assert.equal(column.wallId, wall.id);
});

test("wall-hosted columns follow wall height and generated roof profiles", async () => {
    const { BuildingEditorState } = await loadState();
    const model = await loadModel();
    const state = new BuildingEditorState();
    const floor = state.selectedFloor();
    const floorId = model.getFloorId(floor);
    const wall = model.getBuildingWalls(state.building)[0];
    const pts = model.wallPoints(state.building, wall);
    const column = state.addColumnToFloor(floorId, {
        wallId: wall.id,
        position: {
            x: (Number(pts[0].x) + Number(pts[1].x)) * 0.5,
            y: (Number(pts[0].y) + Number(pts[1].y)) * 0.5
        },
        height: 1,
        bottomZ: model.getFloorElevation(floor)
    });

    assert.equal(column.height, wall.height);

    state.selectWall(wall.id);
    state.updateSelectedWallHeight(4.5);
    assert.equal(column.height, 4.5);

    state.selectFloor(floorId);
    state.updateSelectedRoofMode("shed");
    state.updateSelectedRoofPeakHeight(4);
    const center = state.roofShedBaseCenter(floor);
    state.selectRoofShedDirection(floorId);
    assert.equal(state.moveSelectedRoofShedDirection({ x: center.x + 3, y: center.y }), true);
    const shedHeight = column.height;
    assert.notEqual(shedHeight, 4.5);

    state.updateSelectedRoofPeakHeight(1);
    assert.notEqual(column.height, shedHeight);

    state.updateSelectedRoofMode("dome");
    assert.equal(column.height, 4.5);
});

test("column height can be fixed and reset to wall-pegged", async () => {
    const { BuildingEditorState } = await loadState();
    const model = await loadModel();
    const state = new BuildingEditorState();
    const floor = state.selectedFloor();
    const floorId = model.getFloorId(floor);
    const wall = model.getBuildingWalls(state.building)[0];
    const pts = model.wallPoints(state.building, wall);
    const column = state.addColumnToFloor(floorId, {
        wallId: wall.id,
        position: {
            x: (Number(pts[0].x) + Number(pts[1].x)) * 0.5,
            y: (Number(pts[0].y) + Number(pts[1].y)) * 0.5
        },
        bottomZ: model.getFloorElevation(floor)
    });

    assert.equal(column.heightMode, "wall");
    assert.equal(column.height, wall.height);

    state.selectColumn(floorId, column.id);
    state.updateSelectedColumnHeight("2.25");
    assert.equal(column.heightMode, "fixed");
    assert.equal(column.height, 2.25);

    state.selectWall(wall.id);
    state.updateSelectedWallHeight(4.75);
    assert.equal(column.height, 2.25);

    state.selectColumn(floorId, column.id);
    state.updateSelectedColumnHeight("");
    assert.equal(column.heightMode, "wall");
    assert.equal(column.height, 4.75);
});

test("column tool depth is actual depth and clamps to host wall minimum", async () => {
    const { BuildingEditorState } = await loadState();
    const { ColumnTool } = await loadColumnTool();
    const { model, building, floor } = await createTestBuilding();
    const wall = model.getBuildingWalls(building)[0];
    wall.thickness = 0.25;
    const pts = model.wallPoints(building, wall);
    const point = {
        x: (pts[0].x + pts[1].x) * 0.5,
        y: (pts[0].y + pts[1].y) * 0.5
    };
    const state = new BuildingEditorState();
    state.building = building;
    state.selectFloor(floor.fragmentId);
    state.updateColumnToolThickness(0.5);
    state.updateColumnToolWidth(0.4);

    new ColumnTool(state).pointerDown(point, 0.5, {
        screenPoint: { x: 10, y: 10 },
        renderer: {
            pickAtScreen() {
                return { type: "wall", wall, floor };
            }
        }
    });

    const [column] = model.getFloorColumns(floor);
    assert.equal(column.depth, 0.5);
    assert.equal(column.width, 0.4);
    assert.equal(column.wallId, wall.id);

    state.deleteSelectedColumn();
    state.updateColumnToolThickness(0.1);
    new ColumnTool(state).pointerDown(point, 0.5, {
        screenPoint: { x: 10, y: 10 },
        renderer: {
            pickAtScreen() {
                return { type: "wall", wall, floor };
            }
        }
    });

    const [clamped] = model.getFloorColumns(floor);
    assert.ok(Math.abs(clamped.depth - 0.251) < 0.000001);
});

test("column tool preserves exterior view when placing on an exterior wall", async () => {
    const { BuildingEditorState } = await loadState();
    const { ColumnTool } = await loadColumnTool();
    const { model, building, floor } = await createTestBuilding();
    const wall = model.getBuildingWalls(building)[0];
    const pts = model.wallPoints(building, wall);
    const point = {
        x: (pts[0].x + pts[1].x) * 0.5,
        y: (pts[0].y + pts[1].y) * 0.5
    };
    const state = new BuildingEditorState();
    state.building = building;
    state.selectBuilding();
    assert.equal(state.renderStyle(), "exterior");

    new ColumnTool(state).pointerDown(point, 0.5, {
        screenPoint: { x: 10, y: 10 },
        renderer: {
            pickAtScreen() {
                return { type: "wall", wall, floor };
            }
        }
    });

    assert.equal(state.renderStyle(), "exterior");
    assert.equal(state.selectedColumn().wallId, wall.id);
});

test("column tool defaults screen-picked wall placement to the section center snap", async () => {
    const { BuildingEditorState } = await loadState();
    const { ColumnTool } = await loadColumnTool();
    const { model, building, floor } = await createTestBuilding();
    const wall = model.getBuildingWalls(building)[0];
    const state = new BuildingEditorState();
    state.building = building;
    state.selectFloor(floor.fragmentId);
    const tool = new ColumnTool(state);

    tool.pointerMove({ x: 5, y: 4 }, 0.001, {
        screenPoint: { x: 10, y: 10 },
        renderer: {
            pickAtScreen() {
                return { type: "wall", wall, floor };
            }
        }
    });

    assert.equal(state.draft.kind, "column");
    const pts = model.wallPoints(building, wall);
    const a = pts[0], b = pts[1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = 0.5;
    assert.ok(Math.abs(state.draft.position.x - (a.x + dx * t)) < 0.000001);
    assert.ok(Math.abs(state.draft.position.y - (a.y + dy * t)) < 0.000001);
    assert.equal(state.draft.wallId, wall.id);
});

test("column tool uses multiple snap points per wall section", async () => {
    const { BuildingEditorState } = await loadState();
    const { ColumnTool } = await loadColumnTool();
    const { model, building, floor } = await createTestBuilding();
    const wall = model.getBuildingWalls(building)[0];
    const state = new BuildingEditorState();
    state.building = building;
    state.selectFloor(floor.fragmentId);
    state.updateColumnToolSnapPointsPerSection(4);

    new ColumnTool(state).pointerMove({ x: 8, y: 4 }, 0.001, {
        screenPoint: { x: 10, y: 10 },
        renderer: {
            pickAtScreen() {
                return { type: "wall", wall, floor };
            }
        }
    });

    assert.equal(state.draft.kind, "column");
    const pts = model.wallPoints(building, wall);
    const a = pts[0], b = pts[1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = 0.875;
    assert.ok(Math.abs(state.draft.position.x - (a.x + dx * t)) < 0.000001);
    assert.ok(Math.abs(state.draft.position.y - (a.y + dy * t)) < 0.000001);
    assert.equal(state.draft.wallId, wall.id);
});

test("column tool prefers screen-picked wall endpoints over wall centerline projection", async () => {
    const { BuildingEditorState } = await loadState();
    const { ColumnTool } = await loadColumnTool();
    const { model, building, floor } = await createTestBuilding();
    const wall = model.getBuildingWalls(building)[0];
    const pts = model.wallPoints(building, wall);
    const endpoint = pts[0];
    const nearEndpoint = { x: endpoint.x + 0.05, y: endpoint.y + 0.05 };
    const state = new BuildingEditorState();
    state.building = building;
    state.selectFloor(floor.fragmentId);

    new ColumnTool(state).pointerMove(nearEndpoint, 0.5, {
        screenPoint: { x: 10, y: 10 },
        renderer: {
            pickAtScreen() {
                return { type: "wall", wall, floor };
            }
        }
    });

    assert.equal(state.draft.kind, "column");
    assert.ok(Math.abs(state.draft.position.x - endpoint.x) < 0.000001);
    assert.ok(Math.abs(state.draft.position.y - endpoint.y) < 0.000001);
    assert.equal(state.draft.wallId, wall.id);
});

test("wall-attached columns use the shed roof plane for clipped top heights", async () => {
    const { BuildingEditorState } = await loadState();
    const { BuildingRenderer } = await loadRenderer();
    const model = await loadModel();
    const state = new BuildingEditorState();
    const floor = state.selectedFloor();
    const wall = model.getBuildingWalls(state.building)[0];

    state.updateSelectedRoofMode("shed");
    state.updateSelectedRoofPeakHeight(4);
    const center = state.roofShedBaseCenter(floor);
    state.selectRoofShedDirection(floor.fragmentId);
    assert.equal(state.moveSelectedRoofShedDirection({ x: center.x + 3, y: center.y }), true);

    const column = state.addColumnToFloor(floor.fragmentId, {
        wallId: wall.id,
        position: { x: 0, y: -1.5 },
        size: 0.125,
        height: 4,
        bottomZ: model.getFloorElevation(floor)
    });
    const renderer = Object.create(BuildingRenderer.prototype);
    renderer.state = state;
    const topHeights = renderer.columnTopHeightsForRender(column, floor);
    const verts = model.columnVertices(column);
    const expected = verts.map((point) => state.roofShedTopZAt(floor, point) - model.getFloorElevation(floor));

    assert.deepEqual(column.topHeights, expected);
    assert.equal(topHeights.length, verts.length);
    assert.ok(topHeights.some((value, index) => Math.abs(value - topHeights[(index + 1) % topHeights.length]) > 0.000001));
    topHeights.forEach((value, index) => {
        assert.ok(Math.abs(value - expected[index]) < 0.000001);
    });
});

test("repositioned columns without wall attachment still clip to shed roof plane", async () => {
    const { BuildingEditorState } = await loadState();
    const { BuildingRenderer } = await loadRenderer();
    const model = await loadModel();
    const state = new BuildingEditorState();
    const floor = state.selectedFloor();
    const wall = model.getBuildingWalls(state.building)[0];

    state.updateSelectedRoofMode("shed");
    state.updateSelectedRoofPeakHeight(4);
    const center = state.roofShedBaseCenter(floor);
    state.selectRoofShedDirection(floor.fragmentId);
    assert.equal(state.moveSelectedRoofShedDirection({ x: center.x + 3, y: center.y }), true);

    const column = state.addColumnToFloor(floor.fragmentId, {
        wallId: wall.id,
        position: { x: 0, y: -1.5 },
        size: 0.125,
        height: 4,
        bottomZ: model.getFloorElevation(floor)
    });
    state.selectColumn(floor.fragmentId, column.id);
    assert.equal(state.moveSelectedColumn({ x: 0.4, y: 0 }, 0.001, {
        screenPoint: { x: 10, y: 10 },
        renderer: {
            pickAtScreen() {
                return { type: "floor", floor };
            }
        }
    }), true);
    assert.equal(column.wallId, null);

    const renderer = Object.create(BuildingRenderer.prototype);
    renderer.state = state;
    const topHeights = renderer.columnTopHeightsForRender(column, floor);
    const verts = model.columnVertices(column);
    const expected = verts.map((point) => state.roofShedTopZAt(floor, point) - model.getFloorElevation(floor));

    assert.deepEqual(column.topHeights, expected);
    assert.equal(topHeights.length, verts.length);
    assert.ok(topHeights.some((value, index) => Math.abs(value - topHeights[(index + 1) % topHeights.length]) > 0.000001));
    topHeights.forEach((value, index) => {
        assert.ok(Math.abs(value - expected[index]) < 0.000001);
    });
    const imported = model.normalizeImportedBuilding(state.serialize());
    const importedColumn = model.getFloorColumns(model.findFloor(imported, floor.fragmentId))[0];
    assert.deepEqual(importedColumn.topHeights, expected);
});

test("freestanding columns under gabled roofs save sloped top geometry", async () => {
    const { BuildingEditorState } = await loadState();
    const { BuildingRenderer } = await loadRenderer();
    const model = await loadModel();
    const { validateBuilding } = await import("../public/building-editor/BuildingValidation.js");
    const state = new BuildingEditorState();
    const floor = state.selectedFloor();

    state.updateSelectedRoofMode("gabled");
    state.updateSelectedRoofPeakHeight(4);
    const center = state.roofShedBaseCenter(floor);
    state.selectRoofShedDirection(floor.fragmentId);
    assert.equal(state.moveSelectedRoofShedDirection({ x: center.x + 3, y: center.y }), true);

    const column = state.addColumnToFloor(floor.fragmentId, {
        position: { x: 0.4, y: 0 },
        size: 0.125,
        height: 4,
        bottomZ: model.getFloorElevation(floor)
    });
    const verts = model.columnVertices(column);
    const expected = verts.map((point) => state.roofShedTopZAt(floor, point) - model.getFloorElevation(floor));

    assert.deepEqual(validateBuilding(state.building), []);
    assert.deepEqual(column.topHeights, expected);
    assert.ok(column.topHeights.some((value, index) => Math.abs(value - column.topHeights[(index + 1) % column.topHeights.length]) > 0.000001));

    const renderer = Object.create(BuildingRenderer.prototype);
    renderer.state = state;
    assert.deepEqual(renderer.columnTopHeightsForRender(column, floor), expected);

    const imported = model.normalizeImportedBuilding(state.serialize());
    const importedColumn = model.getFloorColumns(model.findFloor(imported, floor.fragmentId))[0];
    assert.deepEqual(importedColumn.topHeights, expected);
});

test("columns can be multi-selected, bulk edited, and bulk deleted", async () => {
    const { BuildingEditorState } = await loadState();
    const state = new BuildingEditorState();
    const floor = state.selectedFloor();
    const first = state.addColumnToFloor(floor.fragmentId, { position: { x: 1, y: 1 } });
    const second = state.addColumnToFloor(floor.fragmentId, { position: { x: 2, y: 2 } });
    const third = state.addColumnToFloor(floor.fragmentId, { position: { x: 3, y: 3 } });

    state.selectColumn(floor.fragmentId, first.id);
    state.addColumnToSelection(second.id);

    assert.deepEqual(state.selectedColumnIds().map(Number), [first.id, second.id]);
    assert.equal(state.isColumnSelected(first.id), true);
    assert.equal(state.isColumnSelected(second.id), true);
    assert.equal(state.isColumnSelected(third.id), false);

    state.updateSelectedColumnSideCount(6);
    state.updateSelectedColumnThickness(0.5);
    assert.equal(first.sideCount, 6);
    assert.equal(second.sideCount, 6);
    assert.equal(third.sideCount, 4);
    assert.equal(first.depth, 0.5);
    assert.equal(second.depth, 0.5);
    state.updateSelectedColumnWidth(0.4);
    assert.equal(first.width, 0.4);
    assert.equal(second.width, 0.4);
    assert.equal(first.size, 0.2);
    assert.equal(second.size, 0.2);

    state.removeColumnFromSelection(first.id);
    assert.deepEqual(state.selectedColumnIds().map(Number), [second.id]);
    state.addColumnsToSelection([first.id, third.id]);
    assert.deepEqual(state.selectedColumnIds().map(Number), [second.id, first.id, third.id]);

    assert.equal(state.deleteSelectedColumn(), true);
    assert.equal(state.findColumnInFloor(floor.fragmentId, first.id), null);
    assert.equal(state.findColumnInFloor(floor.fragmentId, second.id), null);
    assert.equal(state.findColumnInFloor(floor.fragmentId, third.id), null);
});

test("selected columns rotate by arrow-key deltas", async () => {
    const { BuildingEditorState } = await loadState();
    const state = new BuildingEditorState();
    const floor = state.selectedFloor();
    const first = state.addColumnToFloor(floor.fragmentId, { position: { x: 1, y: 1 }, rotation: 0 });
    const second = state.addColumnToFloor(floor.fragmentId, { position: { x: 2, y: 2 }, rotation: Math.PI / 4 });
    const third = state.addColumnToFloor(floor.fragmentId, { position: { x: 3, y: 3 }, rotation: 0 });
    const step = 15 * Math.PI / 180;
    const fineStep = 3.75 * Math.PI / 180;

    state.selectColumns([first.id, second.id]);
    assert.equal(state.rotateSelectedColumns(step), true);
    assert.ok(Math.abs(first.rotation - step) < 0.000001);
    assert.ok(Math.abs(second.rotation - (Math.PI / 4 + step)) < 0.000001);
    assert.equal(third.rotation, 0);

    assert.equal(state.rotateSelectedColumns(-step), true);
    assert.ok(Math.abs(first.rotation) < 0.000001);
    assert.ok(Math.abs(second.rotation - Math.PI / 4) < 0.000001);
    assert.equal(third.rotation, 0);

    assert.equal(state.rotateSelectedColumns(fineStep), true);
    assert.ok(Math.abs(first.rotation - fineStep) < 0.000001);
    assert.ok(Math.abs(second.rotation - (Math.PI / 4 + fineStep)) < 0.000001);
    assert.equal(third.rotation, 0);
});

test("activating the column tool copies settings from the selected hosted column", async () => {
    const { BuildingEditorState } = await loadState();
    const model = await loadModel();
    const { building, floor } = await createTestBuilding();
    const wall = model.getBuildingWalls(building)[0];
    wall.thickness = 0.375;
    const state = new BuildingEditorState();
    state.building = building;
    state.selectFloor(floor.fragmentId);
    const column = state.addColumnToFloor(floor.fragmentId, {
        wallId: wall.id,
        position: { x: 1, y: 1 },
        width: 0.4,
        depth: 0.5,
        sideCount: 6,
        texturePath: "/assets/images/walls/stone.png"
    });
    state.selectColumn(floor.fragmentId, column.id);

    state.setTool("column");

    assert.equal(state.tool, "column");
    assert.ok(Math.abs(state.columnTool.thickness - 0.5) < 0.000001);
    assert.equal(state.columnTool.width, 0.4);
    assert.equal(state.columnTool.sideCount, 6);
    assert.equal(state.columnTool.texture, "/assets/images/walls/stone.png");
    assert.deepEqual(state.selectedColumnIds().map(Number), [column.id]);
});

test("activating the column tool copies freestanding column settings relative to default wall thickness", async () => {
    const { BuildingEditorState } = await loadState();
    const state = new BuildingEditorState();
    const floor = state.selectedFloor();
    const column = state.addColumnToFloor(floor.fragmentId, {
        wallId: null,
        position: { x: 1, y: 1 },
        width: 0.55,
        depth: 0.6,
        sideCount: 5,
        texturePath: "/assets/images/walls/plaster.png"
    });
    state.selectColumn(floor.fragmentId, column.id);

    state.setTool("column");

    assert.ok(Math.abs(state.columnTool.thickness - 0.6) < 0.000001);
    assert.equal(state.columnTool.width, 0.55);
    assert.equal(state.columnTool.sideCount, 5);
    assert.equal(state.columnTool.texture, "/assets/images/walls/plaster.png");
});

test("renderer draws selection outlines for every selected column", async () => {
    const { BuildingEditorState } = await loadState();
    const { BuildingRenderer } = await loadRenderer();
    const state = new BuildingEditorState();
    const floor = state.selectedFloor();
    const first = state.addColumnToFloor(floor.fragmentId, { position: { x: 1, y: 1 } });
    const second = state.addColumnToFloor(floor.fragmentId, { position: { x: 2, y: 2 } });
    state.selectColumns([first.id, second.id]);
    const outlineLabels = [];
    const renderer = Object.create(BuildingRenderer.prototype);
    renderer.state = state;
    renderer.selectionOutlineLayer = { clear() {} };
    renderer.columnScreenOutlineRings = (column) => [{ columnId: column.id }];
    renderer.drawClipGeometryOutline = (_gfx, _rings, label) => outlineLabels.push(label);

    renderer.drawSelectionOutline();

    assert.deepEqual(outlineLabels, [
        `column ${first.id} selection outline`,
        `column ${second.id} selection outline`
    ]);
});

test("select tool shift-adds and control-removes columns", async () => {
    const { BuildingEditorState } = await loadState();
    const { SelectTool } = await loadSelectTool();
    const state = new BuildingEditorState();
    const floor = state.selectedFloor();
    const first = state.addColumnToFloor(floor.fragmentId, { position: { x: 1, y: 1 } });
    const second = state.addColumnToFloor(floor.fragmentId, { position: { x: 2, y: 2 } });
    const selectTool = new SelectTool(state);
    const screenPoint = { x: 10, y: 10 };

    state.selectColumn(floor.fragmentId, first.id);
    selectTool.pointerDown({ x: 2, y: 2 }, 0.5, {
        shiftKey: true,
        screenPoint,
        renderer: {
            pickAtScreen() {
                return { type: "column", column: second, floor };
            }
        }
    });
    assert.deepEqual(state.selectedColumnIds().map(Number), [first.id, second.id]);

    selectTool.pointerDown({ x: 1, y: 1 }, 0.5, {
        controlKey: true,
        screenPoint,
        renderer: {
            pickAtScreen() {
                return { type: "column", column: first, floor };
            }
        }
    });
    assert.deepEqual(state.selectedColumnIds().map(Number), [second.id]);
});

test("select tool background click clears selection but keeps interior until double click", async () => {
    const { BuildingEditorState } = await loadState();
    const { SelectTool } = await loadSelectTool();
    const state = new BuildingEditorState();
    const floor = state.selectedFloor();
    const column = state.addColumnToFloor(floor.fragmentId, { position: { x: 1, y: 1 } });
    const selectTool = new SelectTool(state);
    const renderer = {
        pickAtScreen() {
            return null;
        }
    };

    state.selectColumn(floor.fragmentId, column.id);
    assert.equal(state.renderStyle(), "interior");

    selectTool.pointerDown({ x: 50, y: 50 }, 0.5, {
        screenPoint: { x: 50, y: 50 },
        renderer,
        doubleClick: false,
        timeStamp: 100
    });

    assert.equal(state.renderStyle(), "interior");
    assert.equal(state.selection.kind, "level");
    assert.equal(state.selection.floorId, floor.fragmentId);
    assert.deepEqual(state.selectedColumnIds(), []);

    selectTool.pointerDown({ x: 50, y: 50 }, 0.5, {
        screenPoint: { x: 50, y: 50 },
        renderer,
        doubleClick: false,
        timeStamp: 220
    });

    assert.equal(state.renderStyle(), "exterior");
    assert.equal(state.selection.kind, "building");
});

test("select tool click-selecting a column does not move it off its wall", async () => {
    const { BuildingEditorState } = await loadState();
    const { SelectTool } = await loadSelectTool();
    const model = await loadModel();
    const { building, floor } = await createTestBuilding();
    const wall = model.getBuildingWalls(building)[0];
    const originalPosition = { x: 1, y: 1 };
    const state = new BuildingEditorState();
    state.building = building;
    state.selectFloor(floor.fragmentId);
    const column = state.addColumnToFloor(floor.fragmentId, {
        position: originalPosition,
        wallId: wall.id
    });
    const selectTool = new SelectTool(state);
    let pickMode = "column";
    const renderer = {
        pickAtScreen() {
            if (pickMode === "column") return { type: "column", column, floor };
            return { type: "floor", floor };
        }
    };

    selectTool.pointerDown(originalPosition, 0.5, {
        screenPoint: { x: 10, y: 10 },
        renderer
    });
    pickMode = "floor";
    selectTool.pointerMove({ x: originalPosition.x + 0.2, y: originalPosition.y + 0.2 }, 0.5, {
        screenPoint: { x: 11, y: 11 },
        renderer
    });
    selectTool.pointerUp({ x: originalPosition.x + 0.2, y: originalPosition.y + 0.2 }, 0.5, {
        screenPoint: { x: 11, y: 11 },
        renderer
    });

    assert.deepEqual(column.position, originalPosition);
    assert.equal(column.wallId, wall.id);
    assert.deepEqual(state.selectedColumnIds().map(Number), [column.id]);
});

test("select tool moves selected columns onto screen-picked wall snap points regardless snap threshold", async () => {
    const { BuildingEditorState } = await loadState();
    const { SelectTool } = await loadSelectTool();
    const model = await loadModel();
    const { building, floor } = await createTestBuilding();
    const wall = model.getBuildingWalls(building)[0];
    const state = new BuildingEditorState();
    state.building = building;
    state.selectFloor(floor.fragmentId);
    const column = state.addColumnToFloor(floor.fragmentId, {
        position: { x: 1, y: 1 },
        wallId: null
    });
    const selectTool = new SelectTool(state);
    const screenPoint = { x: 10, y: 10 };
    let pickMode = "column";
    const renderer = {
        pickAtScreen(_screenPoint, pickOptions = {}) {
            if (pickMode === "column") return { type: "column", column, floor };
            assert.equal(pickOptions.includeMountedObjects, false);
            assert.equal(pickOptions.includeColumns, false);
            assert.equal(pickOptions.includeBeams, false);
            return { type: "wall", wall, floor };
        }
    };

    selectTool.pointerDown({ x: 1, y: 1 }, 0.001, { screenPoint, renderer });
    pickMode = "wall";
    selectTool.pointerMove({ x: 5, y: 4 }, 0.001, { screenPoint: { x: 16, y: 10 }, renderer });

    const pts = model.wallPoints(building, wall);
    const a = pts[0], b = pts[1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = 0.5;
    assert.ok(Math.abs(column.position.x - (a.x + dx * t)) < 0.000001);
    assert.ok(Math.abs(column.position.y - (a.y + dy * t)) < 0.000001);
    assert.equal(column.wallId, wall.id);
});

test("selected column wall drags snap from screen-space wall position instead of floor world point", async () => {
    const { BuildingEditorState } = await loadState();
    const { SelectTool } = await loadSelectTool();
    const model = await loadModel();
    const { building, floor } = await createTestBuilding();
    const wall = model.getBuildingWalls(building)[0];
    const pts = model.wallPoints(building, wall);
    const targetT = 0.2;
    const expectedT = 0.125;
    const targetPoint = {
        x: pts[0].x + (pts[1].x - pts[0].x) * targetT,
        y: pts[0].y + (pts[1].y - pts[0].y) * targetT
    };
    const state = new BuildingEditorState();
    state.building = building;
    state.selectFloor(floor.fragmentId);
    state.updateColumnToolSnapPointsPerSection(4);
    const column = state.addColumnToFloor(floor.fragmentId, {
        position: { x: 1, y: 1 },
        wallId: null
    });
    const selectTool = new SelectTool(state);
    const startScreenPoint = { x: 10, y: 10 };
    let pickMode = "column";
    const renderer = {
        worldToScreen(point, z = 0) {
            return { x: Number(point.x) * 100, y: Number(point.y) * 100 - Number(z) * 10 };
        },
        pickAtScreen(_screenPoint, pickOptions = {}) {
            if (pickMode === "column") return { type: "column", column, floor };
            assert.equal(pickOptions.includeColumns, false);
            assert.equal(pickOptions.includeBeams, false);
            return { type: "wall", wall, floor };
        }
    };

    selectTool.pointerDown({ x: 1, y: 1 }, 0.001, { screenPoint: startScreenPoint, renderer });
    pickMode = "wall";
    selectTool.pointerMove({ x: pts[1].x, y: pts[1].y + 100 }, 0.001, {
        screenPoint: { x: renderer.worldToScreen(targetPoint, 0).x, y: startScreenPoint.y + 10 },
        renderer
    });

    assert.ok(Math.abs(column.position.x - (pts[0].x + (pts[1].x - pts[0].x) * expectedT)) < 0.000001);
    assert.ok(Math.abs(column.position.y - (pts[0].y + (pts[1].y - pts[0].y) * expectedT)) < 0.000001);
    assert.equal(column.wallId, wall.id);
});

test("select tool moves selected columns to screen-picked wall endpoints first", async () => {
    const { BuildingEditorState } = await loadState();
    const { SelectTool } = await loadSelectTool();
    const model = await loadModel();
    const { building, floor } = await createTestBuilding();
    const wall = model.getBuildingWalls(building)[0];
    const endpoint = model.wallPoints(building, wall)[0];
    const state = new BuildingEditorState();
    state.building = building;
    state.selectFloor(floor.fragmentId);
    const column = state.addColumnToFloor(floor.fragmentId, {
        position: { x: 1, y: 1 },
        wallId: null
    });
    const selectTool = new SelectTool(state);
    const screenPoint = { x: 10, y: 10 };
    let pickMode = "column";
    const renderer = {
        pickAtScreen() {
            if (pickMode === "column") return { type: "column", column, floor };
            return { type: "wall", wall, floor };
        }
    };

    selectTool.pointerDown({ x: 1, y: 1 }, 0.5, { screenPoint, renderer });
    pickMode = "wall";
    selectTool.pointerMove({ x: endpoint.x + 0.05, y: endpoint.y + 0.05 }, 0.5, { screenPoint: { x: 16, y: 10 }, renderer });

    assert.ok(Math.abs(column.position.x - endpoint.x) < 0.000001);
    assert.ok(Math.abs(column.position.y - endpoint.y) < 0.000001);
    assert.equal(column.wallId, wall.id);
});

test("columnVertices returns correct polygon for a square column", async () => {
    const model = await loadModel();
    const col = model.createColumn({
        floorId: "test",
        position: { x: 0, y: 0 },
        sideCount: 4,
        width: 1,
        depth: 1,
        rotation: 0,
        height: 3
    });
    const verts = model.columnVertices(col);
    assert.equal(verts.length, 4);
    verts.forEach((v) => {
        const r = Math.hypot(v.x, v.y);
        assert.ok(Math.abs(r - 0.5 / Math.cos(Math.PI / 4)) < 0.000001, `circumradius mismatch: ${r}`);
    });
    let minFaceToCenter = Infinity;
    for (let i = 0; i < 4; i++) {
        const a = verts[i], b = verts[(i + 1) % 4];
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        minFaceToCenter = Math.min(minFaceToCenter, Math.hypot(mx, my));
    }
    assert.ok(Math.abs(minFaceToCenter - 0.5) < 0.000001, `apothem should equal half width, got ${minFaceToCenter}`);
});

test("column depth UVs use wall texture repeat config", async () => {
    const WallSectionUnit = loadWallSectionUnit();
    const ColumnUnit = loadColumnUnit();
    WallSectionUnit._wallTextureConfigCache = WallSectionUnit._buildWallTextureConfigMaps({
        items: [{
            texturePath: "/assets/images/walls/custom-column-test.png",
            repeatsPerMapUnitX: 0.25,
            repeatsPerMapUnitY: 0.5
        }]
    });

    const column = new ColumnUnit({
        x: 0,
        y: 0,
        sideCount: 4,
        size: 1,
        height: 3,
        bottomZ: 0,
        texturePath: "/assets/images/walls/custom-column-test.png",
        deferSetup: true
    });
    column.rebuildMesh3d();
    const geometry = column._buildDepthGeometry();
    const uValues = [];
    const vValues = [];
    for (let index = 0; index < geometry.uvs.length; index += 2) {
        uValues.push(Number(geometry.uvs[index]));
        vValues.push(Number(geometry.uvs[index + 1]));
    }

    assert.ok(Math.abs(Math.max(...uValues) - 1.5) < 0.000001);
    assert.ok(Math.abs(Math.max(...vValues) - 1.5) < 0.000001);
});

test("validateBuilding reports beam and column errors", async () => {
    const model = await loadModel();
    const { model: _m, building, floor } = await createTestBuilding();
    const { validateBuilding } = await import("../public/building-editor/BuildingValidation.js");
    floor.beams.push({ type: "beam", id: 999, floorId: floor.fragmentId, thickness: 0.0001, height: 0.2, bottomZ: 0, startAttachment: { kind: "free" }, endAttachment: { kind: "free" } });
    let errors = validateBuilding(building);
    assert.ok(errors.some((e) => /thickness must be at least/.test(e)), "should report bad thickness");
    floor.beams.length = 0;
    floor.columns.push({ type: "column", id: 998, floorId: floor.fragmentId, position: { x: 0, y: 0 }, sideCount: 2, size: 0.1, height: 3, bottomZ: 0, rotation: 0 });
    errors = validateBuilding(building);
    assert.ok(errors.some((e) => /sideCount must be an integer between 3 and 12/.test(e)), "should report bad sideCount");
    void _m;
});

test("beam round-trips through normalizeImportedBuilding", async () => {
    const model = await loadModel();
    const { building, floor } = await createTestBuilding();
    const beam = model.createBeam({ floorId: floor.fragmentId, startAttachment: { kind: "free", x: 1, y: 1 }, endAttachment: { kind: "column", hostId: 7 }, bottomZ: 1.5, thickness: 0.1, height: 0.3 });
    floor.beams.push(beam);
    const json = model.serializeBuilding(building);
    const restored = model.normalizeImportedBuilding(json);
    const restoredFloor = model.getBuildingFloors(restored)[0];
    const restoredBeam = model.getFloorBeams(restoredFloor)[0];
    assert.equal(restoredBeam.type, "beam");
    assert.equal(restoredBeam.id, beam.id);
    assert.equal(restoredBeam.bottomZ, 1.5);
    assert.equal(restoredBeam.thickness, 0.1);
    assert.equal(restoredBeam.height, 0.3);
    assert.equal(restoredBeam.endAttachment.kind, "column");
    assert.equal(restoredBeam.endAttachment.hostId, 7);
});

test("createStraightStair produces a valid footprint and rejects invalid settings", async () => {
    const model = await loadModel();
    const floor = model.createFloor({
        footprint: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }]
    });
    const stair = model.createStraightStair({
        floorId: floor.fragmentId,
        startPoint: { x: 1, y: 1 },
        endPoint: { x: 3, y: 1 },
        width: 1,
        direction: "down",
        texturePath: "/assets/images/flooring/woodfloor.png",
        treadTexturePath: "/assets/images/flooring/cobblestones.png",
        riserTexturePath: "/assets/images/flooring/dirt.jpg",
        bottomZ: 3,
        height: 3,
        riserDepth: 2
    });

    assert.equal(stair.type, "stairs");
    assert.equal(stair.stairKind, "straight");
    assert.equal(stair.direction, "down");
    assert.equal(stair.width, 1);
    assert.equal(stair.texturePath, "/assets/images/flooring/cobblestones.png");
    assert.equal(stair.treadTexturePath, "/assets/images/flooring/cobblestones.png");
    assert.equal(stair.riserTexturePath, "/assets/images/flooring/dirt.jpg");
    assert.equal(stair.riserDepth, 2);
    assert.equal(stair.footprint.length, 4);
    assert.deepEqual(stair.footprint.map((point) => Number(point.y.toFixed(3))), [1.5, 1.5, 0.5, 0.5]);
    assert.throws(() => model.createStraightStair({
        floorId: floor.fragmentId,
        startPoint: { x: 0, y: 0 },
        endPoint: { x: 0, y: 0 }
    }), /must not coincide/);
    assert.throws(() => model.createStraightStair({
        floorId: floor.fragmentId,
        startPoint: { x: 0, y: 0 },
        endPoint: { x: 1, y: 0 },
        direction: "sideways"
    }), /up or down/);
    assert.throws(() => model.createStraightStair({
        floorId: floor.fragmentId,
        startPoint: { x: 0, y: 0 },
        endPoint: { x: 1, y: 0 },
        height: 3,
        riserDepth: 4
    }), /riser depth/);
});

test("stair records round-trip through normalizeImportedBuilding", async () => {
    const model = await loadModel();
    const building = model.createEmptyBuilding();
    const floor = model.createFloor({
        footprint: [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }, { x: 0, y: 5 }]
    });
    model.addFloor(building, floor);
    const stair = model.createStraightStair({
        floorId: floor.fragmentId,
        startPoint: { x: 1, y: 1 },
        endPoint: { x: 4, y: 1 },
        width: 1.4,
        direction: "up",
        treadTexturePath: "/assets/images/flooring/cobblestones.png",
        riserTexturePath: "/assets/images/flooring/dirt.jpg",
        bottomZ: 0,
        height: 3,
        stepCount: 9,
        riserDepth: 1.75
    });
    floor.stairs.push(stair);

    const restored = model.normalizeImportedBuilding(model.serializeBuilding(building));
    const restoredFloor = model.getBuildingFloors(restored)[0];
    const restoredStair = model.getFloorStairs(restoredFloor)[0];

    assert.equal(restoredStair.id, stair.id);
    assert.equal(restoredStair.floorId, floor.fragmentId);
    assert.equal(restoredStair.width, 1.4);
    assert.equal(restoredStair.direction, "up");
    assert.equal(restoredStair.stepCount, 9);
    assert.equal(restoredStair.riserDepth, 1.75);
    assert.equal(restoredStair.treadTexturePath, "/assets/images/flooring/cobblestones.png");
    assert.equal(restoredStair.riserTexturePath, "/assets/images/flooring/dirt.jpg");
    assert.equal(restoredStair.treads.length, 2);
    assert.equal(restoredStair.footprint.length, 4);
});

test("stair tool settings are applied to new stairs", async () => {
    const { BuildingEditorState } = await loadState();
    const model = await loadModel();
    const state = new BuildingEditorState();
    const floor = state.selectedFloor();
    const lowerFloor = model.createFloor({
        elevation: -3,
        footprint: [{ x: -2, y: -2 }, { x: 2, y: -2 }, { x: 2, y: 2 }, { x: -2, y: 2 }]
    });
    model.addFloor(state.building, lowerFloor);

    state.setTool("stair");
    state.updateStairToolWidth(1.6);
    state.updateStairToolDirection("down");
    state.updateStairToolTreadTexture("/assets/images/flooring/cobblestones.png");
    state.updateStairToolRiserTexture("/assets/images/flooring/dirt.jpg");
    state.updateStairToolRiserDepth(1.25);
    const stair = state.addStairToFloor(floor.fragmentId, {
        startPoint: { x: -1, y: 0 },
        endPoint: { x: 1, y: 0 }
    });

    assert.equal(stair.width, 1.6);
    assert.equal(stair.direction, "down");
    assert.equal(stair.texturePath, "/assets/images/flooring/cobblestones.png");
    assert.equal(stair.treadTexturePath, "/assets/images/flooring/cobblestones.png");
    assert.equal(stair.riserTexturePath, "/assets/images/flooring/dirt.jpg");
    assert.equal(stair.stepCount, 15);
    assert.equal(stair.riserDepth, 1.25);
    assert.equal(stair.height, 3);
    assert.equal(stair.floorId, model.getFloorId(lowerFloor));
    assert.equal(model.getFloorStairs(floor).length, 0);
    assert.equal(model.getFloorStairs(lowerFloor).length, 1);
    assert.equal(state.tool, "stair");
});

test("stair tool explicit step count overrides the floor-height default", async () => {
    const { BuildingEditorState } = await loadState();
    const model = await loadModel();
    const state = new BuildingEditorState();
    const floor = state.selectedFloor();
    const upperFloor = model.createFloor({
        elevation: 4,
        footprint: [{ x: -2, y: -2 }, { x: 2, y: -2 }, { x: 2, y: 2 }, { x: -2, y: 2 }]
    });
    model.addFloor(state.building, upperFloor);

    assert.equal(state.defaultStairStepCountForFloor(floor, "up"), 20);
    state.updateStairToolStepCount(7);
    const stair = state.addStairToFloor(floor.fragmentId, {
        startPoint: { x: -1, y: 0 },
        endPoint: { x: 1, y: 0 }
    });

    assert.equal(stair.stepCount, 7);
    assert.equal(stair.height, 4);
});

test("stair tool selects the only viable floor direction automatically", async () => {
    const { BuildingEditorState } = await loadState();
    const model = await loadModel();
    const state = new BuildingEditorState();
    const groundFloor = state.selectedFloor();
    const lowerFloor = model.createFloor({
        elevation: -3,
        footprint: [{ x: -2, y: -2 }, { x: 2, y: -2 }, { x: 2, y: 2 }, { x: -2, y: 2 }]
    });
    model.addFloor(state.building, lowerFloor);

    state.setTool("stair");

    assert.deepEqual(state.stairDirectionAvailability(groundFloor), { up: false, down: true });
    assert.equal(state.stairTool.direction, "down");
    assert.equal(state.inputs.stairDirection, "down");

    state.selectFloor(model.getFloorId(lowerFloor));

    assert.deepEqual(state.stairDirectionAvailability(lowerFloor), { up: true, down: false });
    assert.equal(state.stairTool.direction, "up");
    assert.equal(state.inputs.stairDirection, "up");
});

test("stairs can be selected and deleted", async () => {
    const { BuildingEditorState } = await loadState();
    const model = await loadModel();
    const state = new BuildingEditorState();
    const floor = state.selectedFloor();
    const upperFloor = model.createFloor({
        elevation: 3,
        footprint: [{ x: -2, y: -2 }, { x: 2, y: -2 }, { x: 2, y: 2 }, { x: -2, y: 2 }]
    });
    model.addFloor(state.building, upperFloor);
    const stair = state.addStairToFloor(floor.fragmentId, {
        startPoint: { x: -1, y: 0 },
        endPoint: { x: 1, y: 0 }
    });

    state.selectStair(model.getFloorId(floor), stair.id);

    assert.equal(state.selection.kind, "stair");
    assert.equal(state.selectedStairIds()[0], stair.id);
    assert.equal(state.selectedStairs()[0], stair);
    assert.equal(state.deleteSelectedStair(), true);
    assert.equal(model.getFloorStairs(floor).length, 0);
    assert.equal(state.selection.kind, "floor");
});

test("selecting another editor object clears stair selection", async () => {
    const { BuildingEditorState } = await loadState();
    const model = await loadModel();
    const state = new BuildingEditorState();
    const floor = state.selectedFloor();
    const wall = model.getBuildingWalls(state.building)[0];
    const upperFloor = model.createFloor({
        elevation: 3,
        footprint: [{ x: -2, y: -2 }, { x: 2, y: -2 }, { x: 2, y: 2 }, { x: -2, y: 2 }]
    });
    model.addFloor(state.building, upperFloor);
    const stair = state.addStairToFloor(floor.fragmentId, {
        startPoint: { x: -1, y: 0 },
        endPoint: { x: 1, y: 0 }
    });

    state.selectStair(model.getFloorId(floor), stair.id);
    state.selectWall(wall.id);

    assert.equal(state.selection.kind, "wall");
    assert.deepEqual(state.selectedStairIds(), []);
});

test("activating a tool clears stair selection", async () => {
    const { BuildingEditorState } = await loadState();
    const model = await loadModel();
    const state = new BuildingEditorState();
    const floor = state.selectedFloor();
    const upperFloor = model.createFloor({
        elevation: 3,
        footprint: [{ x: -2, y: -2 }, { x: 2, y: -2 }, { x: 2, y: 2 }, { x: -2, y: 2 }]
    });
    model.addFloor(state.building, upperFloor);
    const stair = state.addStairToFloor(floor.fragmentId, {
        startPoint: { x: -1, y: 0 },
        endPoint: { x: 1, y: 0 }
    });

    state.selectStair(model.getFloorId(floor), stair.id);
    state.setTool("stair");

    assert.equal(state.tool, "stair");
    assert.equal(state.selection.kind, "level");
    assert.deepEqual(state.selectedStairIds(), []);
});

test("selected stairs can be retextured with floor textures", async () => {
    const { BuildingEditorState } = await loadState();
    const model = await loadModel();
    const state = new BuildingEditorState();
    const floor = state.selectedFloor();
    const upperFloor = model.createFloor({
        elevation: 3,
        footprint: [{ x: -2, y: -2 }, { x: 2, y: -2 }, { x: 2, y: 2 }, { x: -2, y: 2 }]
    });
    model.addFloor(state.building, upperFloor);
    const stair = state.addStairToFloor(floor.fragmentId, {
        startPoint: { x: -1, y: 0 },
        endPoint: { x: 1, y: 0 },
        texturePath: "/assets/images/flooring/woodfloor.png"
    });

    state.selectStair(model.getFloorId(floor), stair.id);
    state.updateSelectedStairTreadTexture("/assets/images/flooring/cobblestones.png");
    state.updateSelectedStairRiserTexture("/assets/images/flooring/dirt.jpg");

    assert.equal(stair.texturePath, "/assets/images/flooring/cobblestones.png");
    assert.equal(stair.treadTexturePath, "/assets/images/flooring/cobblestones.png");
    assert.equal(stair.riserTexturePath, "/assets/images/flooring/dirt.jpg");
    assert.equal(state.paintTextureForMode("floor"), "/assets/images/flooring/cobblestones.png");
    assert.equal(state.selection.kind, "stair");
    assert.deepEqual(state.selectedStairIds(), [stair.id]);
});

test("selected stairs can edit width and step count after placement", async () => {
    const previousClipper = globalThis.polygonClipping;
    try {
        globalThis.polygonClipping = require("polygon-clipping");
        const { BuildingEditorState } = await loadState();
        const model = await loadModel();
        const state = new BuildingEditorState();
        const floor = state.selectedFloor();
        const upperFloor = model.createFloor({
            elevation: 3,
            footprint: floor.outerPolygon
        });
        model.addFloor(state.building, upperFloor);
        state.updateStairToolWidth(0.5);
        const stair = state.addStairToFloor(floor.fragmentId, {
            treads: [
                { left: { x: -0.5, y: -0.25 }, right: { x: -0.5, y: 0.25 } },
                { left: { x: 0.5, y: -0.25 }, right: { x: 0.5, y: 0.25 } }
            ]
        });

        state.selectStair(model.getFloorId(floor), stair.id);
        assert.equal(state.updateSelectedStairWidth(0.8), true);
        state.updateSelectedStairStepCount(8);
        assert.equal(state.updateSelectedStairRiserDepth(1.2), true);

        assert.equal(stair.width, 0.8);
        assert.equal(stair.stepCount, 8);
        assert.equal(stair.riserDepth, 1.2);
        assert.equal(Math.hypot(stair.treads[0].right.x - stair.treads[0].left.x, stair.treads[0].right.y - stair.treads[0].left.y).toFixed(6), "0.800000");
        assert.equal(state.selection.kind, "stair");
    } finally {
        if (typeof previousClipper === "undefined") {
            delete globalThis.polygonClipping;
        } else {
            globalThis.polygonClipping = previousClipper;
        }
    }
});

test("newly finished stair is selected and deactivates the stair tool", async () => {
    const previousClipper = globalThis.polygonClipping;
    try {
        globalThis.polygonClipping = require("polygon-clipping");
        const { BuildingEditorState } = await loadState();
        const { StairTool } = await import("../public/building-editor/tools/StairTool.js");
        const model = await loadModel();
        const state = new BuildingEditorState();
        const floor = state.selectedFloor();
        const upperFloor = model.createFloor({
            elevation: 3,
            footprint: floor.outerPolygon
        });
        model.addFloor(state.building, upperFloor);
        state.setTool("stair");
        state.draft = {
            kind: "stair",
            started: true,
            completed: true,
            ladder: false,
            floorId: model.getFloorId(floor),
            bottomZ: 0,
            height: 3,
            direction: "up",
            width: 1,
            stepCount: 6,
            riserDepth: 0.5,
            texturePath: "/assets/images/flooring/woodfloor.png",
            treadTexturePath: "/assets/images/flooring/woodfloor.png",
            riserTexturePath: "/assets/images/flooring/woodfloor.png",
            treads: [
                { left: { x: -0.5, y: -0.5 }, right: { x: -0.5, y: 0.5 } },
                { left: { x: 0.5, y: -0.5 }, right: { x: 0.5, y: 0.5 } }
            ]
        };

        new StairTool(state).finish();
        const stair = state.selectedStairs()[0];

        assert.equal(state.tool, "select");
        assert.equal(state.selection.kind, "stair");
        assert.equal(stair.riserDepth, 0.5);
        state.stairMoveIsLegal = () => {
            throw new Error("riser depth edit should not run stair move validation");
        };
        assert.equal(state.updateSelectedStairRiserDepth(1.2), true);
        assert.equal(stair.riserDepth, 1.2);
        assert.equal(state.stairTool.riserDepth, null);
    } finally {
        if (typeof previousClipper === "undefined") {
            delete globalThis.polygonClipping;
        } else {
            globalThis.polygonClipping = previousClipper;
        }
    }
});

test("stair openings cut the floor above using steps within two map units", async () => {
    const previousClipper = globalThis.polygonClipping;
    try {
        globalThis.polygonClipping = require("polygon-clipping");
        const { BuildingEditorState } = await loadState();
        const { BuildingRenderer } = await loadRenderer();
        const model = await loadModel();
        const state = new BuildingEditorState();
        const lowerFloor = state.selectedFloor();
        const upperFloor = model.createFloor({
            elevation: 4,
            footprint: [{ x: -1, y: -1 }, { x: 2, y: -1 }, { x: 2, y: 5 }, { x: -1, y: 5 }]
        });
        model.addFloor(state.building, upperFloor);
        state.updateStairToolWidth(1);
        state.updateStairToolStepCount(4);
        const stair = state.addStairToFloor(lowerFloor.fragmentId, {
            treads: [
                { left: { x: 0, y: 0 }, right: { x: 1, y: 0 } },
                { left: { x: 0, y: 4 }, right: { x: 1, y: 4 } }
            ]
        });
        const renderer = Object.create(BuildingRenderer.prototype);
        renderer.state = state;
        renderer.activePlaneZ = () => 0;

        const holes = renderer.stairOpeningHolesForFloor(upperFloor);

        assert.equal(stair.floorId, model.getFloorId(lowerFloor));
        assert.equal(holes.length, 1);
        assert.ok(Math.abs(ringXyArea(holes[0]) - 2) <= 0.000001, `expected a 2 m^2 stair opening, got ${ringXyArea(holes[0])}`);
    } finally {
        if (typeof previousClipper === "undefined") {
            delete globalThis.polygonClipping;
        } else {
            globalThis.polygonClipping = previousClipper;
        }
    }
});

test("renderer draws lower-owned stairs through the rendered upper floor opening", async () => {
    const previousClipper = globalThis.polygonClipping;
    try {
        globalThis.polygonClipping = require("polygon-clipping");
        const { BuildingEditorState } = await loadState();
        const { BuildingRenderer } = await loadRenderer();
        const model = await loadModel();
        const state = new BuildingEditorState();
        const lowerFloor = state.selectedFloor();
        const upperFloor = model.createFloor({
            elevation: 4,
            footprint: [{ x: -1, y: -1 }, { x: 2, y: -1 }, { x: 2, y: 5 }, { x: -1, y: 5 }]
        });
        const unrelatedUpperFloor = model.createFloor({
            elevation: 4,
            footprint: [{ x: 10, y: 10 }, { x: 12, y: 10 }, { x: 12, y: 12 }, { x: 10, y: 12 }]
        });
        model.addFloor(state.building, upperFloor);
        model.addFloor(state.building, unrelatedUpperFloor);
        state.updateStairToolWidth(1);
        state.updateStairToolStepCount(4);
        const stair = state.addStairToFloor(lowerFloor.fragmentId, {
            treads: [
                { left: { x: 0, y: 0 }, right: { x: 1, y: 0 } },
                { left: { x: 0, y: 4 }, right: { x: 1, y: 4 } }
            ]
        });
        const renderer = Object.create(BuildingRenderer.prototype);
        renderer.state = state;
        renderer.stairMeshById = new Map();
        renderer.syncStairMesh = (floor, renderedStair) => ({ floor, renderedStair });
        renderer.renderedFloors = () => [upperFloor];
        renderer.lastStairPickEntries = [];

        renderer.drawStairs();

        assert.equal(stair.floorId, model.getFloorId(lowerFloor));
        assert.equal(renderer.lastStairPickEntries.length, 1);
        assert.equal(renderer.lastStairPickEntries[0].floor, lowerFloor);
        assert.equal(renderer.lastStairPickEntries[0].stair, stair);

        renderer.lastStairPickEntries = [];
        renderer.renderedFloors = () => [unrelatedUpperFloor];
        renderer.drawStairs();

        assert.equal(renderer.lastStairPickEntries.length, 0);
    } finally {
        if (typeof previousClipper === "undefined") {
            delete globalThis.polygonClipping;
        } else {
            globalThis.polygonClipping = previousClipper;
        }
    }
});

test("selected stairs can be dragged and carry their upper-floor opening with them", async () => {
    const previousClipper = globalThis.polygonClipping;
    try {
        globalThis.polygonClipping = require("polygon-clipping");
        const { BuildingEditorState } = await loadState();
        const model = await loadModel();
        const state = new BuildingEditorState();
        const lowerFloor = state.selectedFloor();
        const upperFloor = model.createFloor({
            elevation: 4,
            footprint: [{ x: -2, y: -2 }, { x: 4, y: -2 }, { x: 4, y: 6 }, { x: -2, y: 6 }]
        });
        model.addFloor(state.building, upperFloor);
        state.updateStairToolWidth(1);
        state.updateStairToolStepCount(4);
        const stair = state.addStairToFloor(lowerFloor.fragmentId, {
            treads: [
                { left: { x: 0, y: 0 }, right: { x: 1, y: 0 } },
                { left: { x: 0, y: 4 }, right: { x: 1, y: 4 } }
            ]
        });
        state.selectStair(model.getFloorId(lowerFloor), stair.id);
        const beforeOpening = state.stairOpeningPolygonsForValidation(stair, upperFloor)[0];
        const snapshot = state.beginSelectedStairMove({ x: 0, y: 0 });

        const moved = state.moveSelectedStair(snapshot, { x: 1, y: 0.5 });
        const afterOpening = state.stairOpeningPolygonsForValidation(stair, upperFloor)[0];

        assert.equal(moved, true);
        assert.equal(stair.treads[0].left.x, 1);
        assert.equal(stair.treads[0].left.y, 0.5);
        assert.deepEqual(afterOpening.map((point, index) => ({
            x: Number((point.x - beforeOpening[index].x).toFixed(6)),
            y: Number((point.y - beforeOpening[index].y).toFixed(6))
        })), beforeOpening.map(() => ({ x: 1, y: 0.5 })));
    } finally {
        if (typeof previousClipper === "undefined") {
            delete globalThis.polygonClipping;
        } else {
            globalThis.polygonClipping = previousClipper;
        }
    }
});

test("select tool drags selected stairs after the pointer moves", async () => {
    const previousClipper = globalThis.polygonClipping;
    try {
        globalThis.polygonClipping = require("polygon-clipping");
        const { BuildingEditorState } = await loadState();
        const { SelectTool } = await loadSelectTool();
        const model = await loadModel();
        const state = new BuildingEditorState();
        const lowerFloor = state.selectedFloor();
        const upperFloor = model.createFloor({
            elevation: 4,
            footprint: [{ x: -2, y: -2 }, { x: 4, y: -2 }, { x: 4, y: 6 }, { x: -2, y: 6 }]
        });
        model.addFloor(state.building, upperFloor);
        state.updateStairToolWidth(1);
        state.updateStairToolStepCount(4);
        const stair = state.addStairToFloor(lowerFloor.fragmentId, {
            treads: [
                { left: { x: 0, y: 0 }, right: { x: 1, y: 0 } },
                { left: { x: 0, y: 4 }, right: { x: 1, y: 4 } }
            ]
        });
        const tool = new SelectTool(state);
        const renderer = {
            pickAtScreen() {
                return { type: "stair", stair, floor: lowerFloor };
            }
        };

        tool.pointerDown({ x: 0, y: 0 }, 0.5, { screenPoint: { x: 0, y: 0 }, renderer });
        tool.pointerMove({ x: 1, y: 0.5 }, 0.5, { screenPoint: { x: 10, y: 0 }, renderer });

        assert.equal(stair.treads[0].left.x, 1);
        assert.equal(stair.treads[0].left.y, 0.5);
    } finally {
        if (typeof previousClipper === "undefined") {
            delete globalThis.polygonClipping;
        } else {
            globalThis.polygonClipping = previousClipper;
        }
    }
});

test("selected stair drag is rejected when the upper-floor opening leaves its floor", async () => {
    const previousClipper = globalThis.polygonClipping;
    try {
        globalThis.polygonClipping = require("polygon-clipping");
        const { BuildingEditorState } = await loadState();
        const model = await loadModel();
        const state = new BuildingEditorState();
        const lowerFloor = state.selectedFloor();
        const upperFloor = model.createFloor({
            elevation: 4,
            footprint: [{ x: -1, y: -1 }, { x: 2, y: -1 }, { x: 2, y: 5 }, { x: -1, y: 5 }]
        });
        model.addFloor(state.building, upperFloor);
        state.updateStairToolWidth(1);
        state.updateStairToolStepCount(4);
        const stair = state.addStairToFloor(lowerFloor.fragmentId, {
            treads: [
                { left: { x: 0, y: 0 }, right: { x: 1, y: 0 } },
                { left: { x: 0, y: 4 }, right: { x: 1, y: 4 } }
            ]
        });
        state.selectStair(model.getFloorId(lowerFloor), stair.id);
        const snapshot = state.beginSelectedStairMove({ x: 0, y: 0 });

        const moved = state.moveSelectedStair(snapshot, { x: 4, y: 0 });

        assert.equal(moved, false);
        assert.equal(stair.treads[0].left.x, 0);
        assert.equal(stair.treads[0].left.y, 0);
    } finally {
        if (typeof previousClipper === "undefined") {
            delete globalThis.polygonClipping;
        } else {
            globalThis.polygonClipping = previousClipper;
        }
    }
});

test("selected stair drag is rejected when a landing rectangle intersects a wall", async () => {
    const previousClipper = globalThis.polygonClipping;
    try {
        globalThis.polygonClipping = require("polygon-clipping");
        const { BuildingEditorState } = await loadState();
        const model = await loadModel();
        const state = new BuildingEditorState();
        const lowerFloor = state.selectedFloor();
        const upperFloor = model.createFloor({
            elevation: 4,
            footprint: [{ x: -2, y: -2 }, { x: 5, y: -2 }, { x: 5, y: 6 }, { x: -2, y: 6 }]
        });
        model.addFloor(state.building, upperFloor);
        const wall = model.createWall({
            floorId: upperFloor.fragmentId,
            startPoint: { kind: "point", x: 1.25, y: 4.5 },
            endPoint: { kind: "point", x: 1.75, y: 4.5 },
            thickness: 0.25
        });
        state.building.wallSections.push(wall);
        model.refreshWallResolvedGeometry(state.building, upperFloor);
        state.updateStairToolWidth(1);
        state.updateStairToolStepCount(4);
        const stair = state.addStairToFloor(lowerFloor.fragmentId, {
            treads: [
                { left: { x: 0, y: 0 }, right: { x: 1, y: 0 } },
                { left: { x: 0, y: 4 }, right: { x: 1, y: 4 } }
            ]
        });
        state.selectStair(model.getFloorId(lowerFloor), stair.id);
        const snapshot = state.beginSelectedStairMove({ x: 0, y: 0 });

        const moved = state.moveSelectedStair(snapshot, { x: 1, y: 0 });

        assert.equal(moved, false);
        assert.equal(stair.treads[0].left.x, 0);
        assert.equal(stair.treads[0].left.y, 0);
    } finally {
        if (typeof previousClipper === "undefined") {
            delete globalThis.polygonClipping;
        } else {
            globalThis.polygonClipping = previousClipper;
        }
    }
});

test("renderer draws stair drafts stored as treads", async () => {
    const { BuildingRenderer } = await loadRenderer();
    const renderer = Object.create(BuildingRenderer.prototype);
    let cleared = false;
    let rendered = null;
    renderer.draftLayer = {
        clear() {
            cleared = true;
        }
    };
    renderer.state = {
        draft: {
            kind: "stair",
            treads: [{
                left: { x: 0, y: 0 },
                right: { x: 1, y: 0 },
                center: { x: 0.5, y: 0 },
                angle: 0
            }],
            width: 1,
            bottomZ: 0,
            height: 0,
            direction: "up"
        }
    };
    renderer.drawStairRecord = (gfx, draft, preview) => {
        rendered = { gfx, draft, preview };
    };

    renderer.drawDraft();

    assert.equal(cleared, true);
    assert.equal(rendered.gfx, renderer.draftLayer);
    assert.equal(rendered.draft, renderer.state.draft);
    assert.equal(rendered.preview, true);
});

test("renderer stair preview draws only tread lines and direction lines", async () => {
    const { BuildingRenderer } = await loadRenderer();
    const renderer = Object.create(BuildingRenderer.prototype);
    renderer.worldToScreen = (point) => ({ x: Number(point.x), y: Number(point.y) });
    renderer.activePlaneZ = () => 0;
    const calls = [];
    const gfx = {
        lineStyle(...args) { calls.push(["lineStyle", ...args]); },
        moveTo(...args) { calls.push(["moveTo", ...args]); },
        lineTo(...args) { calls.push(["lineTo", ...args]); },
        beginFill(...args) { calls.push(["beginFill", ...args]); },
        closePath(...args) { calls.push(["closePath", ...args]); },
        endFill(...args) { calls.push(["endFill", ...args]); }
    };

    renderer.drawStairPreviewRecord(gfx, {
        bottomZ: 0,
        treads: [{
            left: { x: -1, y: 0 },
            right: { x: 1, y: 0 },
            center: { x: 0, y: 0 }
        }],
        pendingTread: {
            left: { x: -1, y: 2 },
            right: { x: 1, y: 2 },
            center: { x: 0, y: 2 }
        }
    });

    assert.equal(calls.some((call) => call[0] === "beginFill" || call[0] === "closePath" || call[0] === "endFill"), false);
    assert.equal(calls.filter((call) => call[0] === "lineTo").length, 3);
});

test("renderer screen picker registers stairs with a stair hit payload", async () => {
    const { BuildingRenderer } = await loadRenderer();
    const model = await loadModel();
    const renderer = Object.create(BuildingRenderer.prototype);
    renderer.editorPickItemByKey = new Map();
    renderer.lastSurfacePickEntries = [];
    renderer.lastWallPickEntries = [];
    renderer.lastGablePickEntries = [];
    renderer.lastMountedObjectPickEntries = [];
    renderer.lastBeamPickEntries = [];
    renderer.lastColumnPickEntries = [];
    const floor = model.createFloor({
        footprint: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }]
    });
    const stair = model.createStraightStair({
        floorId: floor.fragmentId,
        startPoint: { x: 1, y: 1 },
        endPoint: { x: 3, y: 1 },
        width: 1,
        bottomZ: 0,
        height: 3,
        stepCount: 5
    });
    const mesh = { name: "stair-pick-mesh" };
    renderer.lastStairPickEntries = [{ stair, floor, mesh }];

    const items = renderer.editorPickRenderItems();
    const stairItem = items.find((entry) => entry.item.editorPickType === "stair");
    const hit = renderer.hitFromEditorPickItem(stairItem.item);

    assert.ok(stairItem);
    assert.equal(stairItem.item.editorPickKey, `stair:${model.getFloorId(floor)}:${stair.id}`);
    assert.equal(stairItem.displayObj, mesh);
    assert.equal(hit.type, "stair");
    assert.equal(hit.stair, stair);
    assert.equal(hit.floor, floor);
});

test("renderer screen picker registers split stair tread and riser meshes", async () => {
    const { BuildingRenderer } = await loadRenderer();
    const model = await loadModel();
    const renderer = Object.create(BuildingRenderer.prototype);
    renderer.editorPickItemByKey = new Map();
    renderer.lastSurfacePickEntries = [];
    renderer.lastWallPickEntries = [];
    renderer.lastGablePickEntries = [];
    renderer.lastMountedObjectPickEntries = [];
    renderer.lastBeamPickEntries = [];
    renderer.lastColumnPickEntries = [];
    const floor = model.createFloor({
        footprint: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }]
    });
    const stair = model.createStraightStair({
        floorId: floor.fragmentId,
        startPoint: { x: 1, y: 1 },
        endPoint: { x: 3, y: 1 },
        width: 1,
        bottomZ: 0,
        height: 3,
        stepCount: 5
    });
    const treadMesh = { name: "stair-tread-pick-mesh" };
    const riserMesh = { name: "stair-riser-pick-mesh" };
    const container = {
        name: "stair-pick-container",
        _stairTreadMesh: treadMesh,
        _stairRiserMesh: riserMesh
    };
    renderer.lastStairPickEntries = [{ stair, floor, mesh: container }];

    const items = renderer.editorPickRenderItems();
    const stairItems = items.filter((entry) => entry.item.editorPickType === "stair");

    assert.equal(stairItems.length, 2);
    assert.deepEqual(stairItems.map((entry) => entry.displayObj), [treadMesh, riserMesh]);
    stairItems.forEach((entry) => {
        const hit = renderer.hitFromEditorPickItem(entry.item);
        assert.equal(entry.item.editorPickKey, `stair:${model.getFloorId(floor)}:${stair.id}`);
        assert.equal(hit.type, "stair");
        assert.equal(hit.stair, stair);
        assert.equal(hit.floor, floor);
    });
});

test("renderer screen picker debug draws stairs as a solid depth mesh", async () => {
    const { BuildingRenderer } = await loadRenderer();
    const model = await loadModel();
    const renderer = Object.create(BuildingRenderer.prototype);
    const floor = model.createFloor({
        footprint: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }]
    });
    const stair = model.createStraightStair({
        floorId: floor.fragmentId,
        startPoint: { x: 1, y: 1 },
        endPoint: { x: 3, y: 1 },
        width: 1,
        bottomZ: 0,
        height: 3,
        stepCount: 5
    });
    const indices = new Uint16Array([0, 1, 2]);
    renderer.triangulateStairSteps = () => ({
        points: [
            { x: 1, y: 1, z: 0.5 },
            { x: 2, y: 1, z: 0.5 },
            { x: 1, y: 2, z: 0.5 }
        ],
        indices
    });
    let created = null;
    renderer.createSolidDepthMesh = (name, positions, meshIndices, color) => {
        created = { name, positions, meshIndices, color };
        return { name };
    };

    const mesh = renderer.createStairPickerDebugMesh({ stair, floor });

    assert.equal(mesh.name, `buildingEditorPickerDebug:stair:${model.getFloorId(floor)}:${stair.id}`);
    assert.equal(created.name, mesh.name);
    assert.deepEqual(Array.from(created.positions), [1, 1, 0.5, 2, 1, 0.5, 1, 2, 0.5]);
    assert.equal(created.meshIndices, indices);
    assert.equal(Number.isInteger(created.color), true);
});

test("renderer draws stair selection outlines as valid clip geometry", async () => {
    const { BuildingRenderer } = await loadRenderer();
    const renderer = Object.create(BuildingRenderer.prototype);
    const stair = { id: "1" };
    const drawn = [];
    renderer.state = {
        tool: "select",
        selection: { kind: "stair" },
        selectedStairs: () => [stair]
    };
    renderer.selectionOutlineLayer = {
        clear() {},
        lineStyle(...args) { drawn.push(["lineStyle", ...args]); },
        drawPolygon(points) { drawn.push(["drawPolygon", points]); }
    };
    renderer.worldToScreen = (point) => ({ x: Number(point.x), y: Number(point.y) });
    renderer.stairStepPolygons = () => [{
        z: 0,
        polygon: [
            { x: 0, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
            { x: 0, y: 1 }
        ]
    }];

    renderer.drawSelectionOutline();

    assert.equal(drawn.filter((call) => call[0] === "drawPolygon").length, 2);
});

test("renderer outlines the upper-floor hole when a stair is selected", async () => {
    const previousClipper = globalThis.polygonClipping;
    try {
        globalThis.polygonClipping = require("polygon-clipping");
        const { BuildingEditorState } = await loadState();
        const { BuildingRenderer } = await loadRenderer();
        const model = await loadModel();
        const state = new BuildingEditorState();
        const lowerFloor = state.selectedFloor();
        const upperFloor = model.createFloor({
            elevation: 4,
            footprint: [{ x: -1, y: -1 }, { x: 2, y: -1 }, { x: 2, y: 5 }, { x: -1, y: 5 }]
        });
        model.addFloor(state.building, upperFloor);
        state.updateStairToolWidth(1);
        state.updateStairToolStepCount(4);
        const stair = state.addStairToFloor(lowerFloor.fragmentId, {
            treads: [
                { left: { x: 0, y: 0 }, right: { x: 1, y: 0 } },
                { left: { x: 0, y: 4 }, right: { x: 1, y: 4 } }
            ]
        });
        state.selectStair(model.getFloorId(lowerFloor), stair.id);
        const renderer = Object.create(BuildingRenderer.prototype);
        const labels = [];
        const realDrawClipGeometryOutline = BuildingRenderer.prototype.drawClipGeometryOutline;
        renderer.state = state;
        renderer.selectionOutlineLayer = {
            clear() {},
            lineStyle() {},
            drawPolygon() {}
        };
        renderer.worldToScreen = (point, z = 0) => ({ x: Number(point.x), y: Number(point.y) - Number(z) });
        renderer.drawClipGeometryOutline = function drawClipGeometryOutline(gfx, geometry, label) {
            labels.push(label);
            return realDrawClipGeometryOutline.call(this, gfx, geometry, label);
        };

        renderer.drawSelectionOutline();

        assert.equal(labels.includes(`stair ${stair.id} selection outline`), true);
        assert.equal(labels.includes(`stair ${stair.id} upper floor opening outline`), true);
    } finally {
        if (typeof previousClipper === "undefined") {
            delete globalThis.polygonClipping;
        } else {
            globalThis.polygonClipping = previousClipper;
        }
    }
});

test("renderer stair preview outlines generated steps in blue before finalize", async () => {
    const { BuildingRenderer } = await loadRenderer();
    const renderer = Object.create(BuildingRenderer.prototype);
    const projectedZ = [];
    renderer.worldToScreen = (point, z = 0) => {
        projectedZ.push(Number(z));
        return { x: Number(point.x), y: Number(point.y) };
    };
    renderer.activePlaneZ = () => 0;
    const calls = [];
    const gfx = {
        lineStyle(...args) { calls.push(["lineStyle", ...args]); },
        moveTo(...args) { calls.push(["moveTo", ...args]); },
        lineTo(...args) { calls.push(["lineTo", ...args]); },
        beginFill(...args) { calls.push(["beginFill", ...args]); },
        closePath(...args) { calls.push(["closePath", ...args]); },
        endFill(...args) { calls.push(["endFill", ...args]); }
    };

    renderer.drawStairPreviewRecord(gfx, {
        bottomZ: 0,
        height: 3,
        direction: "up",
        stepCount: 3,
        treads: [{
            left: { x: 0, y: 0 },
            right: { x: 1, y: 0 },
            center: { x: 0.5, y: 0 }
        }],
        pendingTread: {
            left: { x: 0, y: 3 },
            right: { x: 1, y: 3 },
            center: { x: 0.5, y: 3 }
        }
    });

    const blueStepOutlines = calls.filter((call) => call[0] === "lineStyle" && call[2] === 0x42a5ff);
    assert.equal(blueStepOutlines.length, 3);
    assert.equal(calls.some((call) => call[0] === "beginFill" || call[0] === "closePath" || call[0] === "endFill"), false);
    assert.equal(projectedZ.some((z) => z > 0), true);
});

test("renderer stair steps divide straight sections and rise between floors", async () => {
    const { BuildingRenderer } = await loadRenderer();
    const renderer = Object.create(BuildingRenderer.prototype);
    renderer.activePlaneZ = () => 0;

    const steps = renderer.stairStepPolygons({
        id: "straight",
        bottomZ: 0,
        height: 4,
        direction: "up",
        stepCount: 4,
        treads: [
            { left: { x: 0, y: 0 }, right: { x: 1, y: 0 } },
            { left: { x: 0, y: 2 }, right: { x: 1, y: 2 } }
        ]
    });

    assert.equal(steps.length, 4);
    assert.deepEqual(steps.map((step) => step.polygon.length), [4, 4, 4, 4]);
    assert.deepEqual(steps.map((step) => Number(step.z.toFixed(6))), [0.8, 1.6, 2.4, 3.2]);
    assertPointSetsAlmostEqual(steps[0].polygon, [
        { x: 0, y: 0 },
        { x: 0, y: 0.5 },
        { x: 1, y: 0.5 },
        { x: 1, y: 0 }
    ]);
});

test("renderer stair steps are allocated proportionally by section area", async () => {
    const { BuildingRenderer } = await loadRenderer();
    const renderer = Object.create(BuildingRenderer.prototype);
    renderer.activePlaneZ = () => 0;

    const steps = renderer.stairStepPolygons({
        id: "proportional",
        bottomZ: 0,
        height: 2,
        direction: "up",
        stepCount: 10,
        treads: [
            { left: { x: 0, y: 0 }, right: { x: 1, y: 0 } },
            { left: { x: 0, y: 2 }, right: { x: 1, y: 2 } },
            { left: { x: 0, y: 5 }, right: { x: 1, y: 5 } }
        ]
    });

    assert.equal(steps.length, 10);
    assert.equal(steps.filter((step) => step.sectionIndex === 0).length, 4);
    assert.equal(steps.filter((step) => step.sectionIndex === 1).length, 6);
});

test("renderer stair steps form triangles for connected-end wedge sections", async () => {
    const { BuildingRenderer } = await loadRenderer();
    const renderer = Object.create(BuildingRenderer.prototype);
    renderer.activePlaneZ = () => 0;

    const steps = renderer.stairStepPolygons({
        id: "wedge",
        bottomZ: 2,
        height: 3,
        direction: "down",
        stepCount: 3,
        treads: [
            { left: { x: 0, y: 0 }, right: { x: 1, y: 0 } },
            { left: { x: 0, y: 0 }, right: { x: 0, y: 1 } }
        ]
    });

    assert.equal(steps.length, 3);
    assert.deepEqual(steps.map((step) => step.polygon.length), [3, 3, 3]);
    assert.deepEqual(steps.map((step) => Number(step.z.toFixed(6))), [1.25, 0.5, -0.25]);
    steps.forEach((step) => {
        assert.equal(step.polygon.some((point) => Math.hypot(point.x, point.y) <= 0.000001), true);
    });
});

test("renderer stair steps form annular quadrilaterals for crossing tread sections", async () => {
    const { BuildingRenderer } = await loadRenderer();
    const renderer = Object.create(BuildingRenderer.prototype);
    renderer.activePlaneZ = () => 0;

    const steps = renderer.stairStepPolygons({
        id: "annular",
        bottomZ: 0,
        height: 1,
        direction: "up",
        stepCount: 2,
        treads: [
            { left: { x: -1, y: 0 }, right: { x: 3, y: 0 } },
            { left: { x: 0, y: -1 }, right: { x: 0, y: 3 } }
        ]
    });

    assert.equal(steps.length, 2);
    assert.deepEqual(steps.map((step) => step.polygon.length), [4, 4]);
    assert.equal(steps.every((step) => step.polygon.every((point) => {
        const radius = Math.hypot(point.x, point.y);
        return radius >= 1 - 0.000001 && radius <= 3 + 0.000001;
    })), true);
});

test("renderer triangulates stair riser depth from tread-only to floor-clipped solid", async () => {
    const previousEarcut = globalThis.earcut;
    try {
        globalThis.earcut = require("earcut").default;
        const { BuildingRenderer } = await loadRenderer();
        const renderer = Object.create(BuildingRenderer.prototype);
        renderer.activePlaneZ = () => 0;

        const up = renderer.triangulateStairSteps({
            id: "solid-up",
            bottomZ: 0,
            height: 3,
            direction: "up",
            stepCount: 2,
            treads: [
                { left: { x: 0, y: 0 }, right: { x: 1, y: 0 } },
                { left: { x: 0, y: 2 }, right: { x: 1, y: 2 } }
            ]
        });
        const down = renderer.triangulateStairSteps({
            id: "solid-down",
            bottomZ: 3,
            height: 3,
            direction: "down",
            stepCount: 2,
            treads: [
                { left: { x: 0, y: 0 }, right: { x: 1, y: 0 } },
                { left: { x: 0, y: 2 }, right: { x: 1, y: 2 } }
            ]
        });
        const treadOnly = renderer.triangulateStairSteps({
            id: "tread-only",
            bottomZ: 0,
            height: 3,
            direction: "up",
            stepCount: 2,
            riserDepth: 0,
            treads: [
                { left: { x: 0, y: 0 }, right: { x: 1, y: 0 } },
                { left: { x: 0, y: 2 }, right: { x: 1, y: 2 } }
            ]
        });
        const floorDepth = renderer.triangulateStairSteps({
            id: "floor-depth",
            bottomZ: 0,
            height: 3,
            direction: "up",
            stepCount: 2,
            riserDepth: 3,
            treads: [
                { left: { x: 0, y: 0 }, right: { x: 1, y: 0 } },
                { left: { x: 0, y: 2 }, right: { x: 1, y: 2 } }
            ]
        });

        assert.equal(up.riser.points.some((point) => Math.abs(point.z) <= 0.000001), true);
        assert.equal(up.riser.points.every((point) => point.z >= -0.000001), true);
        assert.equal(up.points.some((point) => Math.abs(point.z - 1) <= 0.000001 && Math.abs(point.normal.z) <= 0.000001), true);
        assert.equal(down.points.every((point) => point.z >= -0.000001), true);
        assert.equal(up.tread.points.every((point) => point.normal.z === 1), true);
        assert.equal(up.riser.points.every((point) => point.normal.z < 1), true);
        assert.equal(up.indices.length > 12, true);
        assert.equal(treadOnly.riser.points.length, 0);
        assert.equal(treadOnly.riser.indices.length, 0);
        assert.equal(treadOnly.points.every((point) => point.normal.z === 1), true);
        assert.equal(floorDepth.riser.points.some((point) => Math.abs(point.z) <= 0.000001), true);
        assert.equal(floorDepth.riser.points.every((point) => point.z >= -0.000001), true);
    } finally {
        if (typeof previousEarcut === "undefined") {
            delete globalThis.earcut;
        } else {
            globalThis.earcut = previousEarcut;
        }
    }
});

test("stair tool starts a draft before target floor height is available", async () => {
    const { BuildingEditorState } = await loadState();
    const { StairTool } = await import("../public/building-editor/tools/StairTool.js");
    const model = await loadModel();
    const state = new BuildingEditorState();
    state.setTool("stair");
    const tool = new StairTool(state);
    const floor = state.selectedFloor();
    const floorId = model.getFloorId(floor);

    tool.pointerMove({ x: 0, y: 0 }, 0.1);
    assert.equal(state.draft.kind, "stair");
    assert.equal(state.draft.started, false);

    tool.pointerDown({ x: 0, y: 0 }, 0.1);

    assert.equal(state.draft.kind, "stair");
    assert.equal(state.draft.started, true);
    assert.equal(state.draft.floorId, floorId);
    assert.match(state.draft.placementError, /requires another floor above/);
    assert.throws(() => tool.finish(), /requires another floor above/);
});

test("stair tool rotates a wall-snapped first tread preview", async () => {
    const { StairTool } = await import("../public/building-editor/tools/StairTool.js");
    const state = {
        stairTool: {
            width: 2,
            direction: "up",
            texture: "/assets/images/flooring/woodfloor.png",
            treadTexture: "/assets/images/flooring/woodfloor.png",
            riserTexture: "/assets/images/flooring/woodfloor.png",
            stepCount: 4,
            riserDepth: 0.5
        },
        draft: null,
        stairCreationSettingsForFloor() {
            return {
                direction: "up",
                width: 2,
                texturePath: "/assets/images/flooring/woodfloor.png",
                treadTexturePath: "/assets/images/flooring/woodfloor.png",
                riserTexturePath: "/assets/images/flooring/woodfloor.png",
                height: 3,
                stepCount: 4,
                riserDepth: 0.5
            };
        },
        emitChange() {}
    };
    const tool = new StairTool(state);
    tool._floorForPoint = () => ({ fragmentId: "floor", elevation: 0 });
    tool._wallSnap = () => ({
        projection: { x: 1, y: 1 },
        normal: { x: 0, y: 1 },
        onWall: false
    });

    tool.pointerMove({ x: 1, y: 1.6 }, 0.1);
    const before = state.draft.treads[0];
    tool.rotatePreview(Math.PI / 2);
    const after = state.draft.treads[0];

    assert.deepEqual(
        {
            x: Number(after.center.x.toFixed(6)),
            y: Number(after.center.y.toFixed(6))
        },
        {
            x: Number(before.center.x.toFixed(6)),
            y: Number(before.center.y.toFixed(6))
        }
    );
    assert.equal(Number(after.angle.toFixed(6)), Number((Math.PI / 2).toFixed(6)));
});

test("stair tool cancel deselects the tool", async () => {
    const { BuildingEditorState } = await loadState();
    const { StairTool } = await import("../public/building-editor/tools/StairTool.js");
    const state = new BuildingEditorState();
    state.setTool("stair");
    state.draft = {
        kind: "stair",
        started: false,
        completed: false,
        treads: [{
            left: { x: 0, y: 0 },
            right: { x: 1, y: 0 },
            center: { x: 0.5, y: 0 },
            angle: 0
        }]
    };
    const tool = new StairTool(state);

    tool.cancel();

    assert.equal(state.tool, "select");
    assert.equal(state.draft, null);
});

test("stair tool completes an active draft when clicking the final point", async () => {
    const { StairTool } = await import("../public/building-editor/tools/StairTool.js");
    const renderer = {
        screenPixelsToWorldDistance(pixels) {
            return Number(pixels) * 0.01;
        }
    };
    const state = {
        stairTool: { width: 2 },
        draft: {
            kind: "stair",
            started: true,
            completed: false,
            ladder: false,
            width: 2,
            treads: [{
                left: { x: -1, y: 0 },
                right: { x: 1, y: 0 },
                center: { x: 0, y: 0 },
                angle: 0
            }, {
                left: { x: -1, y: 2 },
                right: { x: 1, y: 2 },
                center: { x: 0, y: 2 },
                angle: 0
            }],
            pendingTread: {
                left: { x: -1, y: 2 },
                right: { x: 1, y: 2 },
                center: { x: 0, y: 2 },
                angle: 0
            }
        },
        emitChange() {}
    };
    const tool = new StairTool(state);

    tool.pointerDown({ x: 0.05, y: 2.03 }, 0.14, { thresholdPixels: 14, renderer });
    assert.equal(state.draft.completed, true);
    assert.equal(state.draft.pendingTread, null);
    assert.equal(state.draft.treads.length, 2);
});

test("stair tool reopens a completed draft when clicking the final point again", async () => {
    const { StairTool } = await import("../public/building-editor/tools/StairTool.js");
    const renderer = {
        screenPixelsToWorldDistance(pixels) {
            return Number(pixels) * 0.01;
        }
    };
    const state = {
        stairTool: { width: 2 },
        draft: {
            kind: "stair",
            started: true,
            completed: true,
            ladder: false,
            width: 2,
            treads: [{
                left: { x: -1, y: 0 },
                right: { x: 1, y: 0 },
                center: { x: 0, y: 0 },
                angle: 0
            }, {
                left: { x: -1, y: 2 },
                right: { x: 1, y: 2 },
                center: { x: 0, y: 2 },
                angle: 0
            }],
            pendingTread: null,
            pendingArcState: null,
            selectedTreadIndex: -1,
            selectedTreadPoint: ""
        },
        emitChange() {}
    };
    const tool = new StairTool(state);

    tool.pointerDown({ x: 0, y: 2 }, 0.14, { thresholdPixels: 14, renderer });
    tool.pointerUp({ x: 0, y: 2 }, 0.14, { thresholdPixels: 14, renderer });

    assert.equal(state.draft.completed, false);
    tool.pointerMove({ x: 0, y: 3 }, 0.14, { thresholdPixels: 14, renderer });
    assert.equal(state.draft.pendingTread.center.y, 3);
});

test("stair tool drags the completed draft final point", async () => {
    const { StairTool } = await import("../public/building-editor/tools/StairTool.js");
    const renderer = {
        screenPixelsToWorldDistance(pixels) {
            return Number(pixels) * 0.01;
        }
    };
    const state = {
        stairTool: { width: 2 },
        draft: {
            kind: "stair",
            started: true,
            completed: true,
            ladder: false,
            width: 2,
            treads: [{
                left: { x: -1, y: 0 },
                right: { x: 1, y: 0 },
                center: { x: 0, y: 0 },
                angle: 0
            }, {
                left: { x: -1, y: 2 },
                right: { x: 1, y: 2 },
                center: { x: 0, y: 2 },
                angle: 0
            }],
            pendingTread: null,
            pendingArcState: null,
            selectedTreadIndex: -1,
            selectedTreadPoint: ""
        },
        emitChange() {}
    };
    const tool = new StairTool(state);

    tool.pointerDown({ x: 0, y: 2 }, 0.14, { thresholdPixels: 14, renderer });
    tool.pointerMove({ x: 0, y: 3 }, 0.14, { thresholdPixels: 14, renderer });
    tool.pointerUp({ x: 0, y: 3 }, 0.14, { thresholdPixels: 14, renderer });

    assert.equal(state.draft.completed, true);
    assert.equal(state.draft.treads.length, 2);
    assert.deepEqual(
        {
            x: Number(state.draft.treads[1].center.x.toFixed(6)),
            y: Number(state.draft.treads[1].center.y.toFixed(6))
        },
        { x: 0, y: 3 }
    );
});

test("stair pending tread centers at the mouse and mirrors across the direction line", async () => {
    const { StairTool } = await import("../public/building-editor/tools/StairTool.js");
    const state = {
        draft: {
            kind: "stair",
            started: true,
            completed: false,
            ladder: false,
            width: 2,
            treads: [{
                left: { x: -1, y: 0 },
                right: { x: 1, y: 0 },
                center: { x: 0, y: 0 },
                angle: 0
            }]
        },
        emitChange() {}
    };
    const tool = new StairTool(state);

    tool.pointerMove({ x: 0, y: 2 }, 0.1);

    assert.deepEqual(
        {
            x: Number(state.draft.pendingTread.center.x.toFixed(6)),
            y: Number(state.draft.pendingTread.center.y.toFixed(6))
        },
        { x: 0, y: 2 }
    );
    assert.equal(Math.abs(Number(state.draft.pendingTread.angle.toFixed(6))), Number(Math.PI.toFixed(6)));
});

test("stair pending tread does not force straight from a small angle alone", async () => {
    const { StairTool } = await import("../public/building-editor/tools/StairTool.js");
    const previousAngle = Math.PI / 36;
    const previous = {
        left: { x: -Math.cos(previousAngle), y: -Math.sin(previousAngle) },
        right: { x: Math.cos(previousAngle), y: Math.sin(previousAngle) },
        center: { x: 0, y: 0 },
        angle: previousAngle
    };
    const state = {
        draft: {
            kind: "stair",
            started: true,
            completed: false,
            ladder: false,
            width: 2,
            treads: [previous]
        },
        emitChange() {}
    };
    const tool = new StairTool(state);

    tool.pointerMove({ x: 0, y: 3 }, 0.1);

    assert.deepEqual(
        {
            x: Number(state.draft.pendingTread.center.x.toFixed(6)),
            y: Number(state.draft.pendingTread.center.y.toFixed(6))
        },
        { x: 0, y: 3 }
    );
    assert.equal(Number(state.draft.pendingTread.angle.toFixed(6)), Number((Math.PI - previousAngle).toFixed(6)));
});

test("stair pending tread snaps straight within ten screen pixels of the guide line", async () => {
    const { StairTool } = await import("../public/building-editor/tools/StairTool.js");
    const renderer = {
        screenPixelsToWorldDistance(pixels) {
            return Number(pixels) * 0.01;
        }
    };
    const state = {
        draft: {
            kind: "stair",
            started: true,
            completed: false,
            ladder: false,
            width: 2,
            treads: [{
                left: { x: -1, y: 0 },
                right: { x: 1, y: 0 },
                center: { x: 0, y: 0 },
                angle: 0
            }]
        },
        emitChange() {}
    };
    const tool = new StairTool(state);
    const pointer = { x: 0.08, y: 3 };

    tool.pointerMove(pointer, 0.14, { thresholdPixels: 14, renderer });

    assert.deepEqual(
        {
            x: Number(state.draft.pendingTread.center.x.toFixed(6)),
            y: Number(state.draft.pendingTread.center.y.toFixed(6))
        },
        { x: 0, y: 3 }
    );
    assert.equal(Math.abs(Number(state.draft.pendingTread.angle.toFixed(6))), Number(Math.PI.toFixed(6)));
});

test("stair pending tread bends normally outside ten screen pixels of the straight guide line", async () => {
    const { StairTool } = await import("../public/building-editor/tools/StairTool.js");
    const renderer = {
        screenPixelsToWorldDistance(pixels) {
            return Number(pixels) * 0.01;
        }
    };
    const state = {
        draft: {
            kind: "stair",
            started: true,
            completed: false,
            ladder: false,
            width: 2,
            treads: [{
                left: { x: -1, y: 0 },
                right: { x: 1, y: 0 },
                center: { x: 0, y: 0 },
                angle: 0
            }]
        },
        emitChange() {}
    };
    const tool = new StairTool(state);
    const pointer = { x: 0.11, y: 3 };

    tool.pointerMove(pointer, 0.14, { thresholdPixels: 14, renderer });

    assert.deepEqual(
        {
            x: Number(state.draft.pendingTread.center.x.toFixed(6)),
            y: Number(state.draft.pendingTread.center.y.toFixed(6))
        },
        { x: 0.11, y: 3 }
    );
    assert.notEqual(Math.abs(Number(state.draft.pendingTread.angle.toFixed(6))), Number(Math.PI.toFixed(6)));
});

test("stair pending tread snaps nearest endpoints together when mirrored treads cross", async () => {
    const { StairTool } = await import("../public/building-editor/tools/StairTool.js");
    const state = {
        draft: {
            kind: "stair",
            started: true,
            completed: false,
            ladder: false,
            width: 2,
            treads: [{
                left: { x: -1, y: 0 },
                right: { x: 1, y: 0 },
                center: { x: 0, y: 0 },
                angle: 0
            }]
        },
        emitChange() {}
    };
    const tool = new StairTool(state);

    tool.pointerMove({ x: 0.2, y: 0.1 }, 0.1);

    const previous = state.draft.treads[0];
    const pending = state.draft.pendingTread;
    const endpointPairs = [
        [previous.left, pending.left],
        [previous.left, pending.right],
        [previous.right, pending.left],
        [previous.right, pending.right]
    ];
    assert.equal(endpointPairs.some(([a, b]) => Math.hypot(a.x - b.x, a.y - b.y) < 0.000001), true);
    assert.notDeepEqual(
        {
            x: Number(pending.center.x.toFixed(6)),
            y: Number(pending.center.y.toFixed(6))
        },
        { x: 0.2, y: 0.1 }
    );
    const fifteenDegrees = Math.PI / 12;
    const snappedStep = pending.angle / fifteenDegrees;
    assert.equal(Math.abs(snappedStep - Math.round(snappedStep)) < 0.000001, true);
    assert.equal(tool._commitPendingTread(), true);
    assert.equal(state.draft.treads.length, 2);
});

test("stair active path treads snap to walls without becoming ladders", async () => {
    const { BuildingEditorState } = await loadState();
    const { StairTool } = await import("../public/building-editor/tools/StairTool.js");
    const model = await loadModel();
    const state = new BuildingEditorState();
    state.setTool("stair");
    state.updateStairToolWidth(1);
    const floor = state.selectedFloor();
    const wall = model.getBuildingWalls(state.building).find((candidate) => String(candidate.floorId || candidate.fragmentId) === model.getFloorId(floor));
    const [a, b] = model.wallPoints(state.building, wall);
    const midpoint = { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
    state.draft = {
        kind: "stair",
        started: true,
        completed: false,
        ladder: false,
        floorId: model.getFloorId(floor),
        width: 1,
        treads: [{
            left: { x: midpoint.x - 0.5, y: midpoint.y + 2 },
            right: { x: midpoint.x + 0.5, y: midpoint.y + 2 },
            center: { x: midpoint.x, y: midpoint.y + 2 },
            angle: 0
        }]
    };
    const tool = new StairTool(state);

    tool.pointerMove(midpoint, 0.1, {
        renderer: {
            screenPixelsToWorldDistance() {
                return 0.1;
            }
        }
    });

    const pending = state.draft.pendingTread;
    const treadDx = pending.right.x - pending.left.x;
    const treadDy = pending.right.y - pending.left.y;
    const wallDx = b.x - a.x;
    const wallDy = b.y - a.y;
    assert.equal(Math.hypot(treadDx, treadDy).toFixed(6), "1.000000");
    assert.equal(Math.abs(treadDx * wallDx + treadDy * wallDy) < 0.000001, false);
    assert.equal(Math.hypot(pending.center.x - midpoint.x, pending.center.y - midpoint.y).toFixed(6), "0.500000");
    assert.equal(Math.hypot(pending.left.x - midpoint.x, pending.left.y - midpoint.y) < 0.000001, false);
    assert.equal(state.draft.ladder, false);
});

test("beams can be multi-selected, moved vertically, and bulk deleted", async () => {
    const { BuildingEditorState } = await loadState();
    const state = new BuildingEditorState();
    const floor = state.selectedFloor();
    const first = state.addBeamToFloor(floor.fragmentId, {
        startAttachment: { kind: "free", x: 1, y: 1 },
        endAttachment: { kind: "free", x: 3, y: 1 },
        bottomZ: 1
    });
    const second = state.addBeamToFloor(floor.fragmentId, {
        startAttachment: { kind: "free", x: 1, y: 2 },
        endAttachment: { kind: "free", x: 3, y: 2 },
        bottomZ: 2
    });
    const third = state.addBeamToFloor(floor.fragmentId, {
        startAttachment: { kind: "free", x: 1, y: 3 },
        endAttachment: { kind: "free", x: 3, y: 3 },
        bottomZ: 3
    });

    state.selectBeam(floor.fragmentId, first.id);
    state.addBeamToSelection(second.id);

    assert.deepEqual(state.selectedBeamIds().map(Number), [first.id, second.id]);
    assert.equal(state.isBeamSelected(first.id), true);
    assert.equal(state.isBeamSelected(second.id), true);
    assert.equal(state.isBeamSelected(third.id), false);

    state.moveSelectedBeamVertical([
        { beamId: first.id, bottomZ: first.bottomZ },
        { beamId: second.id, bottomZ: second.bottomZ }
    ], 0.5);
    assert.equal(first.bottomZ, 1.5);
    assert.equal(second.bottomZ, 2.5);
    assert.equal(third.bottomZ, 3);

    state.deleteSelectedBeam();
    assert.deepEqual(state.selectedBeamIds(), []);
    assert.deepEqual(floor.beams.map((beam) => beam.id), [third.id]);
});

test("renderer draws selection outlines for every selected beam", async () => {
    const { BuildingEditorState } = await loadState();
    const { BuildingRenderer } = await loadRenderer();
    const state = new BuildingEditorState();
    const floor = state.selectedFloor();
    const first = state.addBeamToFloor(floor.fragmentId, {
        startAttachment: { kind: "free", x: 1, y: 1 },
        endAttachment: { kind: "free", x: 3, y: 1 }
    });
    const second = state.addBeamToFloor(floor.fragmentId, {
        startAttachment: { kind: "free", x: 1, y: 2 },
        endAttachment: { kind: "free", x: 3, y: 2 }
    });
    state.selectBeams([first.id, second.id]);
    const outlineLabels = [];
    const renderer = Object.create(BuildingRenderer.prototype);
    renderer.state = state;
    renderer.selectionOutlineLayer = { clear() {} };
    renderer.beamScreenOutlineRings = (beam) => [{ beamId: beam.id }];
    renderer.drawClipGeometryOutline = (_gfx, _rings, label) => outlineLabels.push(label);

    renderer.drawSelectionOutline();

    assert.deepEqual(outlineLabels, [
        `beam ${first.id} selection outline`,
        `beam ${second.id} selection outline`
    ]);
});

test("selected beam endpoint drags use screen-picked walls instead of the beam itself", async () => {
    const { BuildingEditorState } = await loadState();
    const model = await loadModel();
    const { building, floor } = await createTestBuilding();
    const wall = model.getBuildingWalls(building)[0];
    const state = new BuildingEditorState();
    state.building = building;
    state.selectFloor(floor.fragmentId);
    const beam = state.addBeamToFloor(floor.fragmentId, {
        startAttachment: { kind: "free", x: 1, y: 1 },
        endAttachment: { kind: "free", x: 8, y: 8 }
    });
    state.selectBeamEndpoint(floor.fragmentId, beam.id, "startAttachment");
    const renderer = {
        pickAtScreen(_screenPoint, pickOptions = {}) {
            if (pickOptions.includeBeams !== false) return { type: "beam", beam, floor };
            assert.equal(pickOptions.includeMountedObjects, false);
            assert.equal(pickOptions.includeColumns, false);
            assert.equal(pickOptions.includeBeams, false);
            return { type: "wall", wall, floor };
        }
    };

    assert.equal(state.moveSelectedBeamEndpoint({ x: 5, y: 4 }, 0.001, {
        screenPoint: { x: 10, y: 10 },
        renderer
    }), true);

    assert.equal(beam.startAttachment.kind, "wall");
    assert.equal(beam.startAttachment.hostId, wall.id);
    assert.ok(Number.isFinite(Number(beam.startAttachment.t)));
});

test("deleting a wall with only one beam endpoint orphans the beam but does not delete it", async () => {
    const { BuildingEditorState } = await loadState();
    const state = new BuildingEditorState();
    await new Promise((resolve) => {
        const orig = state.emitChange.bind(state);
        state.emitChange = () => { orig(); resolve(); };
        state.emitChange();
    });
    const { createFloor: cf, createPerimeterWallsForFloor: cpw, getBuildingWalls: gbw, getFloorBeams } = await loadModel();
    const floor = cf({ footprint: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] });
    state.building.floorFragments.push(floor);
    cpw(state.building, floor);
    const wall = gbw(state.building)[0];
    const beam = state.addBeamToFloor(floor.fragmentId, {
        startAttachment: { kind: "wall", hostId: wall.id, t: 0.5 },
        endAttachment: { kind: "free", x: 5, y: 5 }
    });
    state.selectWall(wall.id);
    state.deleteSelectedWall();
    const remaining = getFloorBeams(floor);
    assert.equal(remaining.length, 1, "beam should survive when only one end is on deleted wall");
    assert.equal(remaining[0].id, beam.id);
    assert.equal(remaining[0].startAttachment.kind, "free", "orphaned end should become free");
    assert.equal(remaining[0].endAttachment.kind, "free", "other end unchanged");
});

test("deleting a wall that hosts both beam endpoints deletes the beam", async () => {
    const { BuildingEditorState } = await loadState();
    const state = new BuildingEditorState();
    const { createFloor: cf, createPerimeterWallsForFloor: cpw, getBuildingWalls: gbw, getFloorBeams } = await loadModel();
    const floor = cf({ footprint: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] });
    state.building.floorFragments.push(floor);
    cpw(state.building, floor);
    const wall = gbw(state.building)[0];
    state.addBeamToFloor(floor.fragmentId, {
        startAttachment: { kind: "wall", hostId: wall.id, t: 0.3 },
        endAttachment: { kind: "wall", hostId: wall.id, t: 0.7 }
    });
    state.selectWall(wall.id);
    state.deleteSelectedWall();
    const remaining = getFloorBeams(floor);
    assert.equal(remaining.length, 0, "beam should be deleted when both ends are on deleted wall");
});

test("deleting a column orphans beam attachments pointing to it", async () => {
    const { BuildingEditorState } = await loadState();
    const state = new BuildingEditorState();
    const { createFloor: cf, getFloorBeams } = await loadModel();
    const floor = cf({ footprint: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }] });
    state.building.floorFragments.push(floor);
    const col = state.addColumnToFloor(floor.fragmentId, { position: { x: 2, y: 2 }, height: 3 });
    const beam = state.addBeamToFloor(floor.fragmentId, {
        startAttachment: { kind: "column", hostId: col.id },
        endAttachment: { kind: "free", x: 8, y: 2 }
    });
    state.selectColumn(floor.fragmentId, col.id);
    state.deleteSelectedColumn();
    const remaining = getFloorBeams(floor);
    assert.equal(remaining.length, 1, "beam survives column deletion");
    assert.equal(remaining[0].id, beam.id);
    assert.equal(remaining[0].startAttachment.kind, "free", "column-attached end becomes free");
});
