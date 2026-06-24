const test = require("node:test");
const assert = require("node:assert/strict");

const FloorSupport = require("../public/assets/javascript/shared/FloorSupport.js");

test("FloorSupport resolves section and building owners from fragments and support", () => {
    const buildingFragment = {
        fragmentId: "building:placed-3:floor:top",
        surfaceId: "building:placed-3:surface:top",
        ownerType: "building",
        ownerId: "building:placed-3",
        ownerSectionKey: "building:placed-3",
        renderedByBuildingCutaway: true,
        level: 3,
        nodeBaseZ: 9
    };
    const sectionFragment = {
        fragmentId: "section:0,0:basement",
        surfaceId: "section:0,0:basement",
        ownerType: "section",
        ownerId: "0,0",
        ownerSectionKey: "0,0",
        level: -1,
        nodeBaseZ: -3
    };
    const map = {
        floorsById: new Map([
            [buildingFragment.fragmentId, buildingFragment],
            [sectionFragment.fragmentId, sectionFragment]
        ])
    };

    assert.deepEqual(FloorSupport.getFragmentOwner(buildingFragment), { type: "building", id: "building:placed-3" });
    assert.deepEqual(FloorSupport.getFragmentOwner(sectionFragment), { type: "section", id: "0,0" });
    assert.equal(FloorSupport.isPrototypeBuildingPlacementFloorFragment(buildingFragment), true);
    assert.equal(FloorSupport.isPrototypeBuildingPlacementFloorFragment(sectionFragment), false);

    const support = FloorSupport.createFloorSupport({
        fragment: buildingFragment,
        node: { id: "node-a" }
    });
    assert.equal(support.layer, 3);
    assert.equal(support.baseZ, 9);
    assert.equal(support.ownerType, "building");
    assert.equal(support.ownerId, "building:placed-3");
    assert.deepEqual(support.floorMembership, {
        ownerType: "building",
        ownerId: "building:placed-3",
        floorId: "top",
        level: 3
    });
    assert.deepEqual(FloorSupport.getEntityFloorMembership({
        _prototypeOwnerType: "building",
        _prototypeOwnerId: "building:placed-3",
        fragmentId: "building:placed-3:floor:top",
        surfaceId: "building:placed-3:surface:top",
        traversalLayer: 3
    }), {
        ownerType: "building",
        ownerId: "building:placed-3",
        floorId: "top",
        level: 3
    });
    assert.deepEqual(FloorSupport.getSupportOwner({ fragmentId: sectionFragment.fragmentId }, map), { type: "section", id: "0,0" });
});

test("FloorSupport resolves entity owner with section fallback", () => {
    const entity = {
        x: 3,
        y: 4,
        currentMovementSupport: {
            type: "ground",
            sectionKey: ""
        }
    };

    const owner = FloorSupport.getEntityOwner(entity, {
        sectionKeyResolver(runtimeObj) {
            assert.equal(runtimeObj, entity);
            return "2,-1";
        }
    });

    assert.deepEqual(owner, { type: "section", id: "2,-1" });
    assert.equal(FloorSupport.ownerSignature(owner), "section:2,-1");
});
