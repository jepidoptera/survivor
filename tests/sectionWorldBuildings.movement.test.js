const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const buildings = require("../public/assets/javascript/prototypes/sectionWorldBuildings.js");

class TestPolygonHitbox {
    constructor(points) {
        this.type = "polygon";
        this.points = points;
    }
}

function createNode(xindex, yindex) {
    return {
        xindex,
        yindex,
        x: xindex * 0.866,
        y: yindex + (xindex % 2 === 0 ? 0.5 : 0),
        objects: []
    };
}

function createPrototypeNodeMap(width = 12, height = 12) {
    const allNodesByCoordKey = new Map();
    for (let x = -2; x < width; x++) {
        for (let y = -2; y < height; y++) {
            allNodesByCoordKey.set(`${x},${y}`, createNode(x, y));
        }
    }
    return {
        _prototypeSectionState: { allNodesByCoordKey },
        markBuildingRenderCacheDirty() {}
    };
}

function createPlacement(id = "building:test-house") {
    return {
        schema: "survivor-building-placement-v1",
        id,
        buildingSaveName: "test house",
        transform: { x: 0, y: 0, rotation: 0 },
        footprintPolygons: [[
            { x: 0, y: 0 },
            { x: 3, y: 0 },
            { x: 3, y: 3 },
            { x: 0, y: 3 }
        ]],
        movementBlockerPolygons: [[
            { x: 0, y: 0 },
            { x: 0.5, y: 0 },
            { x: 0.5, y: 3 },
            { x: 0, y: 3 }
        ]]
    };
}

function createBuildingSaveWithDoorAndColumn() {
    return {
        schema: "survivor-building-v1",
        floorFragments: [{
            fragmentId: "floor-0",
            level: 0,
            outerPolygon: [
                { x: 0, y: 0 },
                { x: 4, y: 0 },
                { x: 4, y: 4 },
                { x: 0, y: 4 }
            ],
            columns: [{
                id: 1,
                position: { x: 3, y: 3 },
                sideCount: 4,
                width: 0.5,
                depth: 0.5,
                rotation: 0,
                traversalLayer: 0
            }]
        }],
        wallSections: [{
            id: 7,
            floorId: "floor-0",
            fragmentId: "floor-0",
            startPoint: { x: 0, y: 0 },
            endPoint: { x: 0, y: 4 },
            thickness: 0.4,
            traversalLayer: 0
        }],
        mountedWallObjects: [{
            id: 3,
            category: "doors",
            wallId: 7,
            wallT: 0.5,
            width: 1.5,
            isPassable: true
        }]
    };
}

function pointInPolygon(point, polygon) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const a = polygon[i];
        const b = polygon[j];
        const intersects = ((a.y > point.y) !== (b.y > point.y)) &&
            point.x < (b.x - a.x) * (point.y - a.y) / ((b.y - a.y) || 1e-12) + a.x;
        if (intersects) inside = !inside;
    }
    return inside;
}

function collectBuildingBlockers(map) {
    const blockers = new Set();
    for (const node of map._prototypeSectionState.allNodesByCoordKey.values()) {
        for (const obj of node.objects) {
            if (obj && obj._prototypeBuildingMovementBlocker === true) {
                blockers.add(obj);
            }
        }
    }
    return Array.from(blockers);
}

test("building placements block walls and columns, not the whole base floor", () => {
    const previousPolygonHitbox = globalThis.PolygonHitbox;
    globalThis.PolygonHitbox = TestPolygonHitbox;
    try {
        const map = createPrototypeNodeMap();
        buildings.installSectionWorldBuildingApis(map);
        const buildingData = createBuildingSaveWithDoorAndColumn();
        const placement = map.addPrototypeBuildingPlacement({
            id: "building:test-house",
            buildingSaveName: "test house",
            transform: { x: 0, y: 0, rotation: 0 }
        }, { buildingData });

        assert.equal(placement.footprintPolygons.length, 1);
        assert.equal(placement.movementBlockerPolygons.length, 3);

        const blockers = collectBuildingBlockers(map);
        assert.equal(blockers.length, 3);
        blockers.forEach((blocker) => {
            assert.equal(blocker.type, "prototypeBuildingMovementBlocker");
            assert.equal(blocker.buildingPlacementId, "building:test-house");
            assert.equal(blocker.isPassable, false);
            assert.equal(blocker.blocksTile, false);
            assert.ok(blocker.groundPlaneHitbox instanceof TestPolygonHitbox);
            assert.ok(blocker._prototypeBuildingMovementNodes.length > 0);
        });
        const blockerPolygons = blockers.map((blocker) => blocker.groundPlaneHitbox.points);
        assert.equal(blockerPolygons.some((polygon) => pointInPolygon({ x: 0, y: 0.5 }, polygon)), true);
        assert.equal(blockerPolygons.some((polygon) => pointInPolygon({ x: 3, y: 3 }, polygon)), true);
        assert.equal(blockerPolygons.some((polygon) => pointInPolygon({ x: 0, y: 2 }, polygon)), false);
        assert.equal(blockerPolygons.some((polygon) => pointInPolygon({ x: 2, y: 2 }, polygon)), false);
        assert.equal(map._prototypeBuildingState.movementBlockersDirty, false);
    } finally {
        if (previousPolygonHitbox === undefined) {
            delete globalThis.PolygonHitbox;
        } else {
            globalThis.PolygonHitbox = previousPolygonHitbox;
        }
    }
});

test("building movement blockers lazy-sync after prototype nodes are materialized", () => {
    const previousPolygonHitbox = globalThis.PolygonHitbox;
    globalThis.PolygonHitbox = TestPolygonHitbox;
    try {
        const map = {};
        buildings.installSectionWorldBuildingApis(map);
        map.initializePrototypeBuildingState([createPlacement("building:lazy-house")]);
        assert.equal(map._prototypeBuildingState.movementBlockersDirty, true);

        map._prototypeSectionState = createPrototypeNodeMap()._prototypeSectionState;
        assert.ok(map.syncPrototypeBuildingMovementBlockers() > 0);

        const blockers = collectBuildingBlockers(map);
        assert.equal(blockers.length, 1);
        assert.equal(blockers[0].buildingPlacementId, "building:lazy-house");
        assert.equal(map._prototypeBuildingState.movementBlockersDirty, false);
    } finally {
        if (previousPolygonHitbox === undefined) {
            delete globalThis.PolygonHitbox;
        } else {
            globalThis.PolygonHitbox = previousPolygonHitbox;
        }
    }
});

test("building movement blockers resync when the prototype node registry changes", () => {
    const previousPolygonHitbox = globalThis.PolygonHitbox;
    globalThis.PolygonHitbox = TestPolygonHitbox;
    try {
        const map = createPrototypeNodeMap(4, 4);
        buildings.installSectionWorldBuildingApis(map);
        map.initializePrototypeBuildingState([createPlacement("building:growing-node-house")]);
        const initialAttachmentCount = collectBuildingBlockers(map)[0]._prototypeBuildingMovementNodes.length;

        const addedNode = createNode(4, 1);
        map._prototypeSectionState.allNodesByCoordKey.set("4,1", addedNode);
        map.syncPrototypeBuildingMovementBlockers();

        const blocker = collectBuildingBlockers(map)[0];
        assert.ok(blocker._prototypeBuildingMovementNodes.length > initialAttachmentCount);
        assert.equal(addedNode.objects.includes(blocker), true);
    } finally {
        if (previousPolygonHitbox === undefined) {
            delete globalThis.PolygonHitbox;
        } else {
            globalThis.PolygonHitbox = previousPolygonHitbox;
        }
    }
});

test("building movement blockers resync when prototype nodes are replaced at the same registry size", () => {
    const previousPolygonHitbox = globalThis.PolygonHitbox;
    globalThis.PolygonHitbox = TestPolygonHitbox;
    try {
        const map = createPrototypeNodeMap(4, 4);
        buildings.installSectionWorldBuildingApis(map);
        map.initializePrototypeBuildingState([createPlacement("building:replacement-node-house")]);
        const originalBlocker = collectBuildingBlockers(map)[0];
        const replacementNode = createNode(1, 1);
        const oldNode = map._prototypeSectionState.allNodesByCoordKey.get("1,1");
        assert.ok(oldNode.objects.includes(originalBlocker));

        map._prototypeSectionState.allNodesByCoordKey.set("1,1", replacementNode);
        map.syncPrototypeBuildingMovementBlockers();

        const replacementBlocker = collectBuildingBlockers(map)[0];
        assert.notEqual(replacementBlocker, originalBlocker);
        assert.equal(oldNode.objects.includes(originalBlocker), false);
        assert.equal(replacementNode.objects.includes(replacementBlocker), true);
    } finally {
        if (previousPolygonHitbox === undefined) {
            delete globalThis.PolygonHitbox;
        } else {
            globalThis.PolygonHitbox = previousPolygonHitbox;
        }
    }
});

test("removing a building placement removes its movement blockers from nodes", () => {
    const previousPolygonHitbox = globalThis.PolygonHitbox;
    globalThis.PolygonHitbox = TestPolygonHitbox;
    try {
        const map = createPrototypeNodeMap();
        buildings.installSectionWorldBuildingApis(map);
        map.initializePrototypeBuildingState([createPlacement("building:remove-house")]);
        assert.equal(collectBuildingBlockers(map).length, 1);

        assert.equal(map.removePrototypeBuildingPlacement("building:remove-house"), true);
        assert.equal(collectBuildingBlockers(map).length, 0);
        assert.equal(map._prototypeBuildingState.movementBlockersByPlacementId.size, 0);
    } finally {
        if (previousPolygonHitbox === undefined) {
            delete globalThis.PolygonHitbox;
        } else {
            globalThis.PolygonHitbox = previousPolygonHitbox;
        }
    }
});

test("movement node-window queries sync dirty building blockers before collision collection", () => {
    const source = fs.readFileSync(
        path.join(__dirname, "../public/assets/javascript/prototypes/sectionWorldApiInstallers.js"),
        "utf8"
    );
    assert.match(source, /getNodesInIndexWindow[\s\S]*syncPrototypeBuildingMovementBlockers/);
});
