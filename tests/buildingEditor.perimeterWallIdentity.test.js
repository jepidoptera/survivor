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
    state.inputs.roofOverhang = 0.5;
    state.inputs.roofPeakHeight = 2.25;

    const roof = state.createRoofForSelectedFloor();

    assert.equal(floor.roof, roof);
    assert.equal(state.selection.kind, "roof");
    assert.equal(roof.texturePath, "/assets/images/roofs/thatch.png");
    assert.equal(roof.overhang, 0.5);
    assert.equal(roof.peakHeight, 2.25);
    assert.deepEqual(validateBuilding(state.building), []);
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

test("column tool snaps anywhere on an exterior wall picked by screen hit", async () => {
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
    const lenSq = dx * dx + dy * dy;
    const t = Math.max(0, Math.min(1, ((5 - a.x) * dx + (4 - a.y) * dy) / lenSq));
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

    assert.equal(topHeights.length, verts.length);
    assert.ok(topHeights.some((value, index) => Math.abs(value - topHeights[(index + 1) % topHeights.length]) > 0.000001));
    topHeights.forEach((value, index) => {
        assert.ok(Math.abs(value - expected[index]) < 0.000001);
    });
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

test("select tool moves selected columns onto screen-picked walls regardless snap threshold", async () => {
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
    const lenSq = dx * dx + dy * dy;
    const t = Math.max(0, Math.min(1, ((5 - a.x) * dx + (4 - a.y) * dy) / lenSq));
    assert.ok(Math.abs(column.position.x - (a.x + dx * t)) < 0.000001);
    assert.ok(Math.abs(column.position.y - (a.y + dy * t)) < 0.000001);
    assert.equal(column.wallId, wall.id);
});

test("selected column wall drags use screen-space wall position instead of floor world point", async () => {
    const { BuildingEditorState } = await loadState();
    const { SelectTool } = await loadSelectTool();
    const model = await loadModel();
    const { building, floor } = await createTestBuilding();
    const wall = model.getBuildingWalls(building)[0];
    const pts = model.wallPoints(building, wall);
    const targetT = 0.25;
    const targetPoint = {
        x: pts[0].x + (pts[1].x - pts[0].x) * targetT,
        y: pts[0].y + (pts[1].y - pts[0].y) * targetT
    };
    const state = new BuildingEditorState();
    state.building = building;
    state.selectFloor(floor.fragmentId);
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

    assert.ok(Math.abs(column.position.x - targetPoint.x) < 0.000001);
    assert.ok(Math.abs(column.position.y - targetPoint.y) < 0.000001);
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
