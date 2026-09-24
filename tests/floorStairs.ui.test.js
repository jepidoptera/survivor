"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const FloorStairs = require("../public/assets/javascript/spells/editor/FloorStairs.js");

test("FloorStairs buildFootprint creates a rectangular stair footprint", () => {
    const footprint = FloorStairs.buildFootprint(
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        2,
        { shortestDeltaX: (fromX, toX) => toX - fromX, shortestDeltaY: (fromY, toY) => toY - fromY }
    );

    assert.ok(footprint);
    assert.equal(footprint.length, 4);
    assert.deepEqual(footprint.points, [
        { x: 0, y: 1 },
        { x: 4, y: 1 },
        { x: 4, y: -1 },
        { x: 0, y: -1 }
    ]);
});

test("FloorStairs beginPlacement uses injected camera context", () => {
    const fragment = {
        fragmentId: "floor_custom_z",
        level: 1,
        nodeBaseZ: 7,
        outerPolygon: [
            { x: 11, y: 24 },
            { x: 13, y: 24 },
            { x: 13, y: 26 },
            { x: 11, y: 26 }
        ],
        holes: []
    };
    const wizard = {
        currentSpell: "floorstair",
        selectedFloorEditLevel: 1,
        map: {
            floorsById: new Map([[fragment.fragmentId, fragment]])
        }
    };

    const began = FloorStairs.beginPlacement(wizard, 4, 3, {
        viewport: { x: 10, y: 20, z: 5 },
        viewscale: 2,
        xyratio: 0.5
    });

    assert.equal(began, true);
    assert.ok(wizard._floorStairPlacementDraft);
    assert.equal(wizard._floorStairPlacementDraft.startBaseZ, 7);
    assert.deepEqual(wizard._floorStairPlacementDraft.startPoint, { x: 12, y: 25 });
});

test("FloorStairs floor geometry writes preserve explicit fragment baseZ", () => {
    const asset = {
        key: "0,0",
        sectionPolygon: [
            { x: -5, y: -5 },
            { x: 5, y: -5 },
            { x: 5, y: 5 },
            { x: -5, y: 5 }
        ],
        tileCoordKeys: ["0,0"],
        floors: [{
            fragmentId: "upper_custom",
            surfaceId: "upper_custom_surface",
            ownerSectionKey: "0,0",
            level: 2,
            nodeBaseZ: 8,
            nodeBaseZOffset: 2,
            texturePath: "/assets/images/flooring/woodfloor.png",
            outerPolygon: [
                { x: -2, y: -2 },
                { x: 2, y: -2 },
                { x: 2, y: 2 },
                { x: -2, y: 2 }
            ],
            holes: [],
            tileCoordKeys: ["0,0"]
        }]
    };

    const geometry = FloorStairs._test.geometryFromPoints([
        { x: -1, y: -1 },
        { x: 1, y: -1 },
        { x: 1, y: 1 },
        { x: -1, y: 1 }
    ]);

    FloorStairs._test.setAssetAreaGeometry(asset, 2, geometry, null, asset.floors[0]);

    const rewritten = asset.floors.find(floor => floor && floor.level === 2);
    assert.ok(rewritten);
    assert.equal(rewritten.nodeBaseZ, 8);
    assert.equal(rewritten.nodeBaseZOffset, 2);
    assert.equal(rewritten.texturePath, "/assets/images/flooring/woodfloor.png");
});
