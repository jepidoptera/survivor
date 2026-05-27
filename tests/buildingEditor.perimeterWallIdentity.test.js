const test = require("node:test");
const assert = require("node:assert/strict");

async function loadModel() {
    return import("../public/building-editor/BuildingModel.js");
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
