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
                assert.ok(Math.abs(Number(endpoint.x) - Number(vertex.x)) <= 0.000001);
                assert.ok(Math.abs(Number(endpoint.y) - Number(vertex.y)) <= 0.000001);
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

        assert.ok(clippedArea > 6.5 && clippedArea < 6.7, `expected only the mitered overhang strip to be clipped, got ${clippedArea}`);
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
