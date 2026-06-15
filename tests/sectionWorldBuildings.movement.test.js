const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const buildings = require("../public/assets/javascript/prototypes/sectionWorldBuildings.js");
require("../public/assets/javascript/shared/StairTraversal.js");

class TestPolygonHitbox {
    constructor(points) {
        this.type = "polygon";
        this.points = points;
    }
    getBounds() {
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const point of this.points) {
            minX = Math.min(minX, Number(point.x));
            minY = Math.min(minY, Number(point.y));
            maxX = Math.max(maxX, Number(point.x));
            maxY = Math.max(maxY, Number(point.y));
        }
        return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
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

function createPrototypeNodeMap(width = 12, height = 12, options = {}) {
    const materializeFloorNodes = options.materializeFloorNodes !== false;
    const allNodesByCoordKey = new Map();
    for (let x = -2; x < width; x++) {
        for (let y = -2; y < height; y++) {
            allNodesByCoordKey.set(`${x},${y}`, createNode(x, y));
        }
    }
    const floorNodeLayerIndex = new Map();
    const floorNodesById = new Map();
    const getFloorLayerNodeKey = (x, y, traversalLayer = 0) => (
        `${Number(x)},${Number(y)},${Number.isFinite(traversalLayer) ? Number(traversalLayer) : 0}`
    );
    return {
        floorsById: new Map(),
        floorFragmentsBySurfaceId: new Map(),
        floorFragmentsBySectionKey: new Map(),
        floorNodeLayerIndex,
        floorNodesById,
        stairsById: new Map(),
        _prototypeSectionState: { allNodesByCoordKey },
        markBuildingRenderCacheDirty() {},
        getFloorLayerNodeKey,
        getFloorNodeAtLayer(x, y, layer = 0) {
            const nodes = floorNodeLayerIndex.get(getFloorLayerNodeKey(x, y, layer)) || [];
            return nodes[0] || null;
        },
        registerFloorFragment(fragment) {
            const normalized = {
                ...fragment,
                fragmentId: fragment.fragmentId,
                surfaceId: fragment.surfaceId || fragment.fragmentId,
                ownerSectionKey: fragment.ownerSectionKey || "",
                level: Number.isFinite(fragment.level) ? Math.round(Number(fragment.level)) : 0,
                nodeBaseZ: Number.isFinite(fragment.nodeBaseZ) ? Number(fragment.nodeBaseZ) : 0
            };
            this.floorsById.set(normalized.fragmentId, normalized);
            if (!this.floorFragmentsBySurfaceId.has(normalized.surfaceId)) {
                this.floorFragmentsBySurfaceId.set(normalized.surfaceId, new Set());
            }
            this.floorFragmentsBySurfaceId.get(normalized.surfaceId).add(normalized.fragmentId);
            if (normalized.ownerSectionKey) {
                if (!this.floorFragmentsBySectionKey.has(normalized.ownerSectionKey)) {
                    this.floorFragmentsBySectionKey.set(normalized.ownerSectionKey, new Set());
                }
                this.floorFragmentsBySectionKey.get(normalized.ownerSectionKey).add(normalized.fragmentId);
            }
            if (materializeFloorNodes && normalized.level !== 0) {
                const floorNodes = [];
                for (const baseNode of allNodesByCoordKey.values()) {
                    const floorNode = {
                        xindex: baseNode.xindex,
                        yindex: baseNode.yindex,
                        x: baseNode.x,
                        y: baseNode.y,
                        objects: [],
                        traversalLayer: normalized.level,
                        level: normalized.level,
                        baseZ: normalized.nodeBaseZ,
                        surfaceId: normalized.surfaceId,
                        fragmentId: normalized.fragmentId,
                        ownerSectionKey: normalized.ownerSectionKey || "",
                        sourceNode: baseNode
                    };
                    floorNodes.push(floorNode);
                    const key = getFloorLayerNodeKey(floorNode.xindex, floorNode.yindex, normalized.level);
                    if (!floorNodeLayerIndex.has(key)) floorNodeLayerIndex.set(key, []);
                    floorNodeLayerIndex.get(key).push(floorNode);
                }
                floorNodesById.set(normalized.fragmentId, floorNodes);
            }
            return normalized;
        },
        unregisterFloorFragments(fragmentIds) {
            let removed = 0;
            for (const fragmentId of fragmentIds) {
                const fragment = this.floorsById.get(fragmentId);
                if (!fragment) continue;
                this.floorsById.delete(fragmentId);
                removed += 1;
            }
            return removed;
        },
        registerStairRuntimeRecord(stair) {
            this.stairsById.set(stair.id, { ...stair, stairKind: "treadPath" });
            return this.stairsById.get(stair.id);
        }
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

function createBuildingSaveWithTreadPathStair() {
    const square = [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
        { x: 0, y: 4 }
    ];
    return {
        schema: "survivor-building-v1",
        floorFragments: [
            {
                fragmentId: "floor-0",
                level: 0,
                nodeBaseZ: 0,
                outerPolygon: square,
                stairs: [{
                    type: "stairs",
                    id: 12,
                    floorId: "floor-0",
                    startPoint: { x: 1, y: 1 },
                    endPoint: { x: 2, y: 1 },
                    bottomZ: 0,
                    height: 3,
                    direction: "up",
                    width: 1,
                    stepCount: 6,
                    riserDepth: 0.5,
                    treads: [
                        { left: { x: 1, y: 0.5 }, right: { x: 1, y: 1.5 } },
                        { left: { x: 2, y: 0.5 }, right: { x: 2, y: 1.5 } }
                    ]
                }]
            },
            {
                fragmentId: "floor-1",
                level: 1,
                nodeBaseZ: 3,
                outerPolygon: square,
                stairs: []
            }
        ],
        wallSections: [],
        mountedWallObjects: []
    };
}

function createBuildingSaveWithImplicitTreadPathStairOpening() {
    const building = createBuildingSaveWithTreadPathStair();
    building.floorFragments[0].stairs[0].stepCount = 2;
    return building;
}

function createBuildingSaveWithTreadPathStairHole() {
    const building = createBuildingSaveWithTreadPathStair();
    building.floorFragments[0].stairs[0].stepCount = 2;
    building.floorFragments[1].holes = [[
        { x: 1, y: 0.5 },
        { x: 2, y: 0.5 },
        { x: 2, y: 1.5 },
        { x: 1, y: 1.5 }
    ]];
    return building;
}

function createBuildingSaveWithUpperFloorBlockers() {
    const square = [
        { x: 0, y: 0 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
        { x: 0, y: 4 }
    ];
    return {
        schema: "survivor-building-v1",
        floorFragments: [
            {
                fragmentId: "floor-0",
                level: 0,
                nodeBaseZ: 0,
                outerPolygon: square,
                columns: []
            },
            {
                fragmentId: "floor-1",
                level: 1,
                nodeBaseZ: 3,
                outerPolygon: square,
                columns: [{
                    id: "upper-column",
                    position: { x: 3, y: 3 },
                    sideCount: 4,
                    width: 0.5,
                    depth: 0.5,
                    rotation: 0
                }]
            }
        ],
        wallSections: [
            {
                id: "lower-wall",
                floorId: "floor-0",
                fragmentId: "floor-0",
                startPoint: { x: 0, y: 0 },
                endPoint: { x: 0, y: 4 },
                thickness: 0.4
            },
            {
                id: "upper-wall",
                floorId: "floor-1",
                fragmentId: "floor-1",
                startPoint: { x: 4, y: 0 },
                endPoint: { x: 4, y: 4 },
                thickness: 0.4
            }
        ],
        mountedWallObjects: []
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

function createSectionAsset(key, sectionPolygon) {
    const parts = String(key).split(",");
    return {
        id: `section-${key}`,
        key,
        coord: { q: Number(parts[0]) || 0, r: Number(parts[1]) || 0 },
        centerAxial: { q: 0, r: 0 },
        centerOffset: { x: 0, y: 0 },
        neighborKeys: [],
        tileCoordKeys: [],
        sectionPolygon,
        buildingRefs: []
    };
}

function installSectionAssets(map, assets) {
    map._prototypeSectionState = {
        ...(map._prototypeSectionState || {}),
        orderedSectionAssets: assets,
        sectionAssetsByKey: new Map(assets.map((asset) => [asset.key, asset]))
    };
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
    if (map.floorNodesById instanceof Map) {
        for (const nodes of map.floorNodesById.values()) {
            for (const node of nodes) {
                for (const obj of node.objects || []) {
                    if (obj && obj._prototypeBuildingMovementBlocker === true) {
                        blockers.add(obj);
                    }
                }
            }
        }
    }
    return Array.from(blockers);
}

test("building placements write lightweight refs into every touched section", () => {
    const map = {};
    const sectionA = createSectionAsset("0,0", [
        { x: -1, y: -1 },
        { x: 6, y: -1 },
        { x: 6, y: 6 },
        { x: -1, y: 6 }
    ]);
    const sectionB = createSectionAsset("1,0", [
        { x: 19, y: -1 },
        { x: 26, y: -1 },
        { x: 26, y: 6 },
        { x: 19, y: 6 }
    ]);
    installSectionAssets(map, [sectionA, sectionB]);
    buildings.installSectionWorldBuildingApis(map);

    const placement = map.addPrototypeBuildingPlacement({
        id: "building:section-ref-house",
        buildingSaveName: "test house",
        transform: { x: 0, y: 0, rotation: 0 }
    }, { buildingData: createBuildingSaveWithDoorAndColumn() });

    assert.deepEqual(placement.overlappedSectionKeys, ["0,0"]);
    assert.deepEqual(sectionA.buildingRefs, [
        { id: "building:section-ref-house", shell: true }
    ]);
    assert.deepEqual(sectionB.buildingRefs, []);

    map.updatePrototypeBuildingPlacementTransform("building:section-ref-house", {
        x: 20,
        y: 0,
        rotation: 0
    });

    assert.deepEqual(sectionA.buildingRefs, []);
    assert.deepEqual(sectionB.buildingRefs, [
        { id: "building:section-ref-house", shell: true }
    ]);
});

test("building placement creates an owned instance save unit", () => {
    const map = {};
    const sectionA = createSectionAsset("0,0", [
        { x: -1, y: -1 },
        { x: 6, y: -1 },
        { x: 6, y: 6 },
        { x: -1, y: 6 }
    ]);
    installSectionAssets(map, [sectionA]);
    buildings.installSectionWorldBuildingApis(map);

    const buildingData = createBuildingSaveWithDoorAndColumn();
    const placement = map.addPrototypeBuildingPlacement({
        id: "building:owned-house",
        buildingSaveName: "test house",
        transform: { x: 0, y: 0, rotation: 0 }
    }, { buildingData });

    buildingData.floorFragments[0].outerPolygon[0].x = 999;
    const instances = map.exportPrototypeBuildingInstances();
    assert.equal(instances.length, 1);
    assert.equal(instances[0].schema, "survivor-building-v1");
    assert.equal(instances[0].id, "building:owned-house");
    assert.equal(instances[0].sourceBuildingSaveName, "test house");
    assert.deepEqual(instances[0].transform, placement.transform);
    assert.deepEqual(instances[0].touchedSectionKeys, ["0,0"]);
    assert.notEqual(instances[0].floorFragments[0].outerPolygon[0].x, 999);
    assert.deepEqual(map.getPrototypeDirtyWorldUnits(), {
        sections: ["0,0"],
        buildings: ["building:owned-house"]
    });
});

test("active section building ensure loads only referenced placements", async () => {
    const map = {};
    const sectionA = createSectionAsset("0,0", []);
    const sectionB = createSectionAsset("1,0", []);
    installSectionAssets(map, [sectionA, sectionB]);
    buildings.installSectionWorldBuildingApis(map);
    map.initializePrototypeBuildingState([
        {
            ...createPlacement("building:active-house"),
            buildingSaveName: "active house",
            overlappedSectionKeys: ["0,0"]
        },
        {
            ...createPlacement("building:inactive-house"),
            buildingSaveName: "inactive house",
            overlappedSectionKeys: ["1,0"]
        }
    ]);
    const loaded = [];
    map.loadPrototypeBuildingEditorSaveData = async (saveName) => {
        loaded.push(saveName);
        const data = createBuildingSaveWithDoorAndColumn();
        map._prototypeBuildingState.buildingDataBySaveName.set(saveName, data);
        return data;
    };

    map.setPrototypeBuildingDesiredPlacementIds(new Set(["building:active-house"]));
    await map.ensurePrototypeBuildingPlacementsForSectionKeys(new Set(["0,0"]));

    assert.deepEqual(loaded, ["active house"]);
    assert.equal(map._prototypeBuildingState.loadedBuildingsById.has("building:active-house"), true);
    assert.equal(map._prototypeBuildingState.loadedBuildingsById.has("building:inactive-house"), false);
    assert.equal(map.getPrototypeBuildingCutawayBuildings().length, 1);
});

test("active section shell loading follows section refs and migrates old placements", async () => {
    const map = {};
    const sectionA = createSectionAsset("0,0", []);
    const sectionB = createSectionAsset("1,0", []);
    installSectionAssets(map, [sectionA, sectionB]);
    buildings.installSectionWorldBuildingApis(map);
    map.initializePrototypeBuildingState([
        {
            ...createPlacement("building:ref-house"),
            buildingSaveName: "ref house",
            overlappedSectionKeys: ["1,0"],
            loadState: "unloaded"
        }
    ]);
    sectionA.buildingRefs = [{ id: "building:ref-house", shell: true }];
    sectionB.buildingRefs = [];

    const loaded = [];
    map.loadPrototypeBuildingEditorSaveData = async (saveName) => {
        loaded.push(saveName);
        return createBuildingSaveWithDoorAndColumn();
    };

    await map.ensurePrototypeBuildingShellsForSectionKeys(new Set(["0,0"]));

    const placement = map.getPrototypeBuildingPlacements()[0];
    const instances = map.exportPrototypeBuildingInstances();
    assert.deepEqual(loaded, ["ref house"]);
    assert.equal(placement.loadState, "shell");
    assert.equal(instances.length, 1);
    assert.equal(instances[0].schema, "survivor-building-v1");
    assert.equal(instances[0].id, "building:ref-house");
    assert.equal(instances[0].loadState, "shell");
    assert.equal(map._prototypeBuildingState.loadedBuildingsById.has("building:ref-house"), true);
});

test("interior promotion survives later shell loads", async () => {
    const map = {};
    const sectionA = createSectionAsset("0,0", []);
    installSectionAssets(map, [sectionA]);
    buildings.installSectionWorldBuildingApis(map);
    const placement = map.addPrototypeBuildingPlacement({
        id: "building:interior-house",
        buildingSaveName: "interior house",
        transform: { x: 0, y: 0, rotation: 0 }
    }, { buildingData: createBuildingSaveWithDoorAndColumn() });

    await map.promotePrototypeBuildingInterior("building:interior-house");
    await map.ensurePrototypeBuildingShellsForSectionKeys(new Set(["0,0"]));

    const instances = map.exportPrototypeBuildingInstances();
    assert.equal(placement.loadState, "interior");
    assert.equal(instances[0].loadState, "interior");
});

test("wizard building support switches world scope and suspends outdoor bubble shifting", async () => {
    const previousWizard = globalThis.wizard;
    try {
        const map = createPrototypeNodeMap();
        buildings.installSectionWorldBuildingApis(map);
        const wizard = { type: "wizard" };
        globalThis.wizard = wizard;
        map.addPrototypeBuildingPlacement({
            id: "building:scope-house",
            buildingSaveName: "scope house",
            transform: { x: 0, y: 0, rotation: 0 }
        }, { buildingData: createBuildingSaveWithTreadPathStair() });

        const buildingSupport = {
            type: "floor",
            layer: 0,
            baseZ: 0,
            fragmentId: "building:scope-house:floor:floor-0",
            surfaceId: "building:scope-house:surface:floor-0",
            ownerType: "building",
            ownerId: "building:scope-house",
            sectionKey: "building:scope-house"
        };
        const buildingScope = map.updatePrototypeWorldScopeForMovementSupport(wizard, buildingSupport);
        await Promise.resolve();

        assert.deepEqual(buildingScope, { type: "building", id: "building:scope-house" });
        assert.deepEqual(map.getPrototypeWorldScope(), { type: "building", id: "building:scope-house" });
        assert.equal(map.getPrototypeBuildingPlacements()[0].loadState, "interior");
        assert.equal(map.isPrototypeOutdoorBubbleSuspendedForActor(wizard), true);
        assert.equal(map.isPrototypeOutdoorBubbleSuspendedForActor(wizard, { force: true }), false);

        const sectionSupport = {
            type: "floor",
            layer: 0,
            baseZ: 0,
            fragmentId: "section:0,0:ground",
            surfaceId: "section:0,0:ground",
            ownerType: "section",
            ownerId: "0,0",
            sectionKey: "0,0"
        };
        const sectionScope = map.updatePrototypeWorldScopeForMovementSupport(wizard, sectionSupport);

        assert.deepEqual(sectionScope, { type: "sectionWorld" });
        assert.deepEqual(map.getPrototypeWorldScope(), { type: "sectionWorld" });
        assert.equal(map.isPrototypeOutdoorBubbleSuspendedForActor(wizard), false);
    } finally {
        if (previousWizard === undefined) {
            delete globalThis.wizard;
        } else {
            globalThis.wizard = previousWizard;
        }
    }
});

test("repeated building support updates do not re-promote an already active interior", async () => {
    const previousWizard = globalThis.wizard;
    try {
        const map = createPrototypeNodeMap();
        buildings.installSectionWorldBuildingApis(map);
        const wizard = { type: "wizard" };
        globalThis.wizard = wizard;
        map.addPrototypeBuildingPlacement({
            id: "building:scope-house",
            buildingSaveName: "scope house",
            transform: { x: 0, y: 0, rotation: 0 }
        }, { buildingData: createBuildingSaveWithTreadPathStair() });

        const originalRegisterFloorFragment = map.registerFloorFragment.bind(map);
        let floorRegistrations = 0;
        map.registerFloorFragment = function registerFloorFragmentWithCount(fragment) {
            floorRegistrations += 1;
            return originalRegisterFloorFragment(fragment);
        };

        const buildingSupport = {
            type: "floor",
            layer: 0,
            baseZ: 0,
            fragmentId: "building:scope-house:floor:floor-0",
            surfaceId: "building:scope-house:surface:floor-0",
            ownerType: "building",
            ownerId: "building:scope-house",
            sectionKey: "building:scope-house"
        };

        map.updatePrototypeWorldScopeForMovementSupport(wizard, buildingSupport);
        await Promise.resolve();
        await Promise.resolve();

        assert.equal(map.getPrototypeBuildingPlacements()[0].loadState, "interior");
        assert.ok(floorRegistrations > 0);
        const registrationsAfterPromotion = floorRegistrations;

        map.updatePrototypeWorldScopeForMovementSupport(wizard, buildingSupport);
        map.updatePrototypeWorldScopeForMovementSupport(wizard, buildingSupport);
        await Promise.resolve();
        await Promise.resolve();

        assert.equal(floorRegistrations, registrationsAfterPromotion);
    } finally {
        if (previousWizard === undefined) {
            delete globalThis.wizard;
        } else {
            globalThis.wizard = previousWizard;
        }
    }
});

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

test("moving a building placement rebuilds footprints and movement blockers", () => {
    const previousPolygonHitbox = globalThis.PolygonHitbox;
    globalThis.PolygonHitbox = TestPolygonHitbox;
    try {
        const map = createPrototypeNodeMap();
        let dirtyCount = 0;
        map.markBuildingRenderCacheDirty = () => {
            dirtyCount += 1;
        };
        buildings.installSectionWorldBuildingApis(map);
        const buildingData = createBuildingSaveWithDoorAndColumn();
        map.addPrototypeBuildingPlacement({
            id: "building:test-house",
            buildingSaveName: "test house",
            transform: { x: 0, y: 0, rotation: 0 }
        }, { buildingData });

        const previousBlockers = collectBuildingBlockers(map);
        assert.equal(previousBlockers.length, 3);
        map._prototypeBuildingState.exteriorBitmapsById.set("building:test-house", {
            texture: { destroy() {} },
            depthMetricTexture: { destroy() {} }
        });

        const moved = map.updatePrototypeBuildingPlacementTransform("building:test-house", {
            x: 5,
            y: 5,
            rotation: 0
        });

        assert.equal(moved.transform.x, 5);
        assert.equal(moved.transform.y, 5);
        assert.equal(moved.footprintPolygons[0][0].x, 5);
        assert.equal(moved.footprintPolygons[0][0].y, 5);
        assert.equal(map._prototypeBuildingState.exteriorBitmapsById.has("building:test-house"), false);
        assert.equal(dirtyCount >= 2, true);

        const nextBlockers = collectBuildingBlockers(map);
        assert.equal(nextBlockers.length, 3);
        const blockerPolygons = nextBlockers.map((blocker) => blocker.groundPlaneHitbox.points);
        assert.equal(blockerPolygons.some((polygon) => pointInPolygon({ x: 5, y: 5.5 }, polygon)), true);
        assert.equal(blockerPolygons.some((polygon) => pointInPolygon({ x: 0, y: 0.5 }, polygon)), false);
    } finally {
        if (previousPolygonHitbox === undefined) {
            delete globalThis.PolygonHitbox;
        } else {
            globalThis.PolygonHitbox = previousPolygonHitbox;
        }
    }
});

test("building placement movement blockers preserve upper-floor layers", () => {
    const previousPolygonHitbox = globalThis.PolygonHitbox;
    globalThis.PolygonHitbox = TestPolygonHitbox;
    try {
        const map = createPrototypeNodeMap();
        buildings.installSectionWorldBuildingApis(map);
        const buildingData = createBuildingSaveWithUpperFloorBlockers();
        const placement = map.addPrototypeBuildingPlacement({
            id: "building:upper-blocker-house",
            buildingSaveName: "upper blocker house",
            transform: { x: 0, y: 0, rotation: 0 }
        }, { buildingData });

        assert.equal(placement.movementBlockerPolygons.length, 3);
        const layers = placement.movementBlockerPolygons.map((entry) => entry.traversalLayer).sort();
        assert.deepEqual(layers, [0, 1, 1]);
        const upperEntries = placement.movementBlockerPolygons.filter((entry) => entry.traversalLayer === 1);
        assert.equal(upperEntries.length, 2);
        upperEntries.forEach((entry) => {
            assert.equal(entry.bottomZ, 3);
            assert.equal(entry.height, 3);
        });

        const blockers = collectBuildingBlockers(map);
        assert.equal(blockers.length, 3);
        const upperBlockers = blockers.filter((blocker) => blocker.traversalLayer === 1);
        assert.equal(upperBlockers.length, 2);
        upperBlockers.forEach((blocker) => {
            assert.equal(blocker.level, 1);
            assert.equal(blocker.bottomZ, 3);
            assert.equal(blocker.height, 3);
            assert.ok(blocker._prototypeBuildingMovementNodes.length > 0);
            blocker._prototypeBuildingMovementNodes.forEach((node) => {
                assert.equal(node.traversalLayer, 1);
                assert.equal(node.objects.includes(blocker), true);
            });
        });
    } finally {
        if (previousPolygonHitbox === undefined) {
            delete globalThis.PolygonHitbox;
        } else {
            globalThis.PolygonHitbox = previousPolygonHitbox;
        }
    }
});

test("building movement blockers recompute stale saved geometry when building data is available", () => {
    const previousPolygonHitbox = globalThis.PolygonHitbox;
    globalThis.PolygonHitbox = TestPolygonHitbox;
    try {
        const map = createPrototypeNodeMap();
        buildings.installSectionWorldBuildingApis(map);
        map.initializePrototypeBuildingState([{
            ...createPlacement("building:stale-blocker-house"),
            buildingSaveName: "upper blocker house"
        }]);
        const placement = map.getPrototypeBuildingPlacements()[0];
        assert.equal(placement.movementBlockerGeometryVersion, "");
        assert.equal(placement.movementBlockerPolygons.length, 1);

        map._prototypeBuildingState.buildingDataBySaveName.set(
            "upper blocker house",
            createBuildingSaveWithUpperFloorBlockers()
        );
        map.syncPrototypeBuildingGeometryRuntime();
        buildings.markPrototypeBuildingMovementBlockersDirty(map);
        map.syncPrototypeBuildingMovementBlockers();

        assert.equal(placement.movementBlockerPolygons.length, 3);
        const layers = placement.movementBlockerPolygons.map((entry) => entry.traversalLayer).sort();
        assert.deepEqual(layers, [0, 1, 1]);
        const upperEntries = placement.movementBlockerPolygons.filter((entry) => entry.traversalLayer === 1);
        assert.equal(upperEntries.every((entry) => entry.bottomZ === 3 && entry.height === 3), true);
        assert.ok(placement.movementBlockerGeometryVersion);
        const blockers = collectBuildingBlockers(map);
        const upperBlockers = blockers.filter((blocker) => blocker.traversalLayer === 1);
        assert.equal(upperBlockers.length, 2);
        assert.equal(upperBlockers.every((blocker) => blocker.bottomZ === 3 && blocker.height === 3), true);
    } finally {
        if (previousPolygonHitbox === undefined) {
            delete globalThis.PolygonHitbox;
        } else {
            globalThis.PolygonHitbox = previousPolygonHitbox;
        }
    }
});

test("building movement blockers can be collected directly when upper floor nodes are absent", () => {
    const previousPolygonHitbox = globalThis.PolygonHitbox;
    globalThis.PolygonHitbox = TestPolygonHitbox;
    try {
        const map = createPrototypeNodeMap(12, 12, { materializeFloorNodes: false });
        buildings.installSectionWorldBuildingApis(map);
        const buildingData = createBuildingSaveWithUpperFloorBlockers();
        map.addPrototypeBuildingPlacement({
            id: "building:direct-upper-blocker-house",
            buildingSaveName: "upper blocker house",
            transform: { x: 0, y: 0, rotation: 0 }
        }, { buildingData });

        const nodeAttachedBlockers = collectBuildingBlockers(map);
        assert.equal(nodeAttachedBlockers.filter((blocker) => blocker.traversalLayer === 1).length, 0);

        const directUpperBlockers = map.collectPrototypeBuildingMovementBlockersInBounds({
            minX: 0,
            minY: 0,
            maxX: 4,
            maxY: 4
        }, 1);
        assert.equal(directUpperBlockers.length, 2);
        directUpperBlockers.forEach((blocker) => {
            assert.equal(blocker.traversalLayer, 1);
            assert.equal(blocker.bottomZ, 3);
            assert.equal(blocker.height, 3);
            assert.equal(blocker._prototypeBuildingMovementBlocker, true);
        });
    } finally {
        if (previousPolygonHitbox === undefined) {
            delete globalThis.PolygonHitbox;
        } else {
            globalThis.PolygonHitbox = previousPolygonHitbox;
        }
    }
});

test("building placements register imported floor polygons and tread-path stairs for wizard geometry", () => {
    const previousPolygonHitbox = globalThis.PolygonHitbox;
    globalThis.PolygonHitbox = TestPolygonHitbox;
    try {
        const map = createPrototypeNodeMap();
        buildings.installSectionWorldBuildingApis(map);
        map.addPrototypeBuildingPlacement({
            id: "building:stair-house",
            buildingSaveName: "stair house",
            transform: { x: 10, y: 20, rotation: 0 }
        }, { buildingData: createBuildingSaveWithTreadPathStair() });

        assert.equal(map.floorsById.has("building:stair-house:floor:floor-0"), true);
        assert.equal(map.floorsById.has("building:stair-house:floor:floor-1"), true);
        assert.equal(map.floorsById.get("building:stair-house:floor:floor-0").renderedByBuildingCutaway, true);
        assert.equal(map.floorsById.get("building:stair-house:floor:floor-1").renderedByBuildingCutaway, true);
        assert.equal(map.stairsById.size, 1);
        const stair = map.stairsById.get("building:stair-house:stair:floor-0:12");
        assert.ok(stair);
        assert.equal(stair.stairKind, "treadPath");
        assert.equal(stair.lowerFragmentId, "building:stair-house:floor:floor-0");
        assert.equal(stair.higherFragmentId, "building:stair-house:floor:floor-1");
        assert.deepEqual(stair.lowerPoint, { x: 11, y: 21 });
        assert.deepEqual(stair.higherPoint, { x: 12, y: 21 });
        assert.equal(stair.treads[0].left.x, 11);
        assert.equal(stair.treads[0].left.y, 20.5);
        assert.equal(stair.riserDepth, 0.5);
        assert.equal(stair.renderedByBuildingCutaway, true);
        const cutawayBuildings = map.getPrototypeBuildingCutawayBuildings();
        assert.equal(cutawayBuildings.length, 1);
        const stairEntry = cutawayBuildings[0].staticObjects.find((entry) => entry && entry.item && entry.item.type === "treadPathStair");
        assert.ok(stairEntry);
        assert.equal(stairEntry.item.stair.stairKind, "treadPath");
        assert.deepEqual(stairEntry.item.stair.lowerPoint, stair.lowerPoint);
        assert.deepEqual(stairEntry.item.stair.higherPoint, stair.higherPoint);
        assert.equal(stairEntry.item.stair.stepCount, stair.stepCount);
    } finally {
        if (previousPolygonHitbox === undefined) {
            delete globalThis.PolygonHitbox;
        } else {
            globalThis.PolygonHitbox = previousPolygonHitbox;
        }
    }
});

test("building stair openings are not baked into generic movement blockers", () => {
    const previousPolygonHitbox = globalThis.PolygonHitbox;
    globalThis.PolygonHitbox = TestPolygonHitbox;
    try {
        const map = createPrototypeNodeMap();
        buildings.installSectionWorldBuildingApis(map);
        const placement = map.addPrototypeBuildingPlacement({
            id: "building:stair-hole-house",
            buildingSaveName: "stair hole house",
            transform: { x: 0, y: 0, rotation: 0 }
        }, { buildingData: createBuildingSaveWithImplicitTreadPathStairOpening() });

        assert.equal(placement.movementBlockerPolygons.length, 0);

        const blockers = collectBuildingBlockers(map);
        assert.equal(blockers.length, 0);

        const stair = map.stairsById.get("building:stair-hole-house:stair:floor-0:12");
        assert.ok(stair);
        assert.deepEqual(stair.higherPoint, { x: 2, y: 1 });
    } finally {
        if (previousPolygonHitbox === undefined) {
            delete globalThis.PolygonHitbox;
        } else {
            globalThis.PolygonHitbox = previousPolygonHitbox;
        }
    }
});

test("building stair saved floor holes are not baked into generic movement blockers", () => {
    const previousPolygonHitbox = globalThis.PolygonHitbox;
    globalThis.PolygonHitbox = TestPolygonHitbox;
    try {
        const map = createPrototypeNodeMap();
        buildings.installSectionWorldBuildingApis(map);
        const placement = map.addPrototypeBuildingPlacement({
            id: "building:stair-saved-hole-house",
            buildingSaveName: "stair saved hole house",
            transform: { x: 0, y: 0, rotation: 0 }
        }, { buildingData: createBuildingSaveWithTreadPathStairHole() });

        assert.equal(placement.movementBlockerPolygons.length, 0);
        const blockers = collectBuildingBlockers(map);
        assert.equal(blockers.length, 0);
        assert.ok(map.stairsById.get("building:stair-saved-hole-house:stair:floor-0:12"));
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
        map.markPrototypeBuildingMovementBlockersDirty();
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

test("clean building movement blocker sync is a cheap no-op unless forced", () => {
    const previousPolygonHitbox = globalThis.PolygonHitbox;
    globalThis.PolygonHitbox = TestPolygonHitbox;
    try {
        const map = createPrototypeNodeMap(4, 4);
        buildings.installSectionWorldBuildingApis(map);
        map.initializePrototypeBuildingState([createPlacement("building:clean-sync-house")]);
        const originalBlocker = collectBuildingBlockers(map)[0];
        const originalNode = originalBlocker._prototypeBuildingMovementNodes[0];
        assert.ok(originalNode.objects.includes(originalBlocker));

        originalNode.objects = originalNode.objects.filter((obj) => obj !== originalBlocker);
        assert.equal(map.syncPrototypeBuildingMovementBlockers(), 0);
        assert.equal(originalNode.objects.includes(originalBlocker), false);

        assert.ok(map.syncPrototypeBuildingMovementBlockers({ forceValidate: true }) > 0);
        const replacementBlocker = collectBuildingBlockers(map)[0];
        assert.notEqual(replacementBlocker, originalBlocker);
        assert.equal(originalNode.objects.includes(replacementBlocker), true);
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

test("removing a building placement deletes objects attached to its runtime floor fragments", () => {
    const previousPolygonHitbox = globalThis.PolygonHitbox;
    globalThis.PolygonHitbox = TestPolygonHitbox;
    try {
        const map = createPrototypeNodeMap();
        buildings.installSectionWorldBuildingApis(map);
        map.initializePrototypeBuildingState([createPlacement("building:remove-object-house")]);
        map._prototypeBuildingState.runtimeFloorFragmentIdsByPlacementId.set("building:remove-object-house", [
            "building:remove-object-house:floor:upper"
        ]);
        let unregisterCall = null;
        map.unregisterFloorFragments = (fragmentIds, options = {}) => {
            unregisterCall = { fragmentIds, options };
            return fragmentIds.length;
        };

        assert.equal(map.removePrototypeBuildingPlacement("building:remove-object-house"), true);
        assert.deepEqual(unregisterCall.fragmentIds, ["building:remove-object-house:floor:upper"]);
        assert.equal(unregisterCall.options.removeAttachedObjects, true);
    } finally {
        if (previousPolygonHitbox === undefined) {
            delete globalThis.PolygonHitbox;
        } else {
            globalThis.PolygonHitbox = previousPolygonHitbox;
        }
    }
});

test("deleted floor fragments prune attached object records before runtime unregister", () => {
    const mapSource = fs.readFileSync(
        path.join(__dirname, "../public/assets/javascript/Map.js"),
        "utf8"
    );
    const floorEditSource = fs.readFileSync(
        path.join(__dirname, "../public/assets/javascript/spells/FloorFragmentEdit.js"),
        "utf8"
    );

    assert.match(mapSource, /removeObjectsForDeletedFloorFragments\(fragmentIds\)/);
    assert.match(mapSource, /record\?\.fragmentId[\s\S]*ids\.has\(fragmentId\)/);
    assert.match(mapSource, /asset\.objects = nextRecords;/);
    assert.match(mapSource, /options && options\.removeAttachedObjects === true[\s\S]*removeObjectsForDeletedFloorFragments\(ids\)/);
    assert.match(floorEditSource, /unregisterFloorFragments\(removedFragmentIds, \{ removeAttachedObjects: true \}\)/);
});

test("movement node-window queries sync dirty building blockers before collision collection", () => {
    const source = fs.readFileSync(
        path.join(__dirname, "../public/assets/javascript/prototypes/sectionWorldApiInstallers.js"),
        "utf8"
    );
    assert.match(source, /getNodesInIndexWindow[\s\S]*syncPrototypeBuildingMovementBlockers/);
});

test("prototype building wall render layer uses runtime traversal layer before physical bottomZ", () => {
    const source = fs.readFileSync(
        path.join(__dirname, "../public/assets/javascript/rendering/Rendering.js"),
        "utf8"
    );
    assert.match(
        source,
        /item\.type === "wallSection" && item\._prototypeBuildingPlacementId && Number\.isFinite\(item\.traversalLayer\)[\s\S]*return this\.getLayerIndexFromValue\(item\.traversalLayer, fallback\);[\s\S]*item\.type === "wallSection" && Number\.isFinite\(item\.bottomZ\)/
    );
});

test("placed building runtime layers use floor order instead of nodeBaseZ divided by three", () => {
    const previousPolygonHitbox = globalThis.PolygonHitbox;
    globalThis.PolygonHitbox = TestPolygonHitbox;
    try {
        const map = createPrototypeNodeMap(4, 4, { materializeFloorNodes: false });
        buildings.installSectionWorldBuildingApis(map);
        const placement = createPlacement("building:tower");
        map.initializePrototypeBuildingState([placement]);
        map._prototypeBuildingState.buildingDataBySaveName.set(placement.buildingSaveName, {
            schema: "survivor-building-v1",
            floorFragments: [
                {
                    fragmentId: "ground",
                    surfaceId: "ground",
                    level: 0,
                    nodeBaseZ: 0,
                    floorHeight: 30,
                    outerPolygon: [
                        { x: 0, y: 0 },
                        { x: 4, y: 0 },
                        { x: 4, y: 4 },
                        { x: 0, y: 4 }
                    ],
                    holes: []
                },
                {
                    fragmentId: "tower-top",
                    surfaceId: "tower-top",
                    level: 10,
                    nodeBaseZ: 30,
                    floorHeight: 4,
                    outerPolygon: [
                        { x: 0, y: 0 },
                        { x: 4, y: 0 },
                        { x: 4, y: 4 },
                        { x: 0, y: 4 }
                    ],
                    holes: []
                }
            ],
            wallSections: [],
            mountedWallObjects: []
        });

        const stats = map.syncPrototypeBuildingGeometryRuntime();
        const top = map.floorsById.get("building:tower:floor:tower-top");

        assert.equal(stats.floors, 2);
        assert.ok(top);
        assert.equal(top.level, 1);
        assert.equal(top.nodeBaseZ, 30);
    } finally {
        if (previousPolygonHitbox === undefined) {
            delete globalThis.PolygonHitbox;
        } else {
            globalThis.PolygonHitbox = previousPolygonHitbox;
        }
    }
});

test("placed building stair landing resolves unique floor at target z without endpoint containment", () => {
    const previousPolygonHitbox = globalThis.PolygonHitbox;
    globalThis.PolygonHitbox = TestPolygonHitbox;
    try {
        const map = createPrototypeNodeMap(4, 4, { materializeFloorNodes: false });
        buildings.installSectionWorldBuildingApis(map);
        const placement = createPlacement("building:tower");
        map.initializePrototypeBuildingState([placement]);
        map._prototypeBuildingState.buildingDataBySaveName.set(placement.buildingSaveName, {
            schema: "survivor-building-v1",
            floorFragments: [
                {
                    fragmentId: "ground",
                    surfaceId: "ground",
                    level: 0,
                    nodeBaseZ: 0,
                    outerPolygon: [
                        { x: 0, y: 0 },
                        { x: 4, y: 0 },
                        { x: 4, y: 4 },
                        { x: 0, y: 4 }
                    ],
                    holes: [],
                    stairs: [{
                        id: 1,
                        stairKind: "treadPath",
                        bottomZ: 0,
                        height: 30,
                        direction: "up",
                        startPoint: { x: 1, y: 1 },
                        endPoint: { x: 10, y: 10 },
                        treads: [
                            {
                                left: { x: 0.5, y: 1 },
                                right: { x: 1.5, y: 1 },
                                center: { x: 1, y: 1 }
                            },
                            {
                                left: { x: 9.5, y: 10 },
                                right: { x: 10.5, y: 10 },
                                center: { x: 10, y: 10 }
                            }
                        ]
                    }]
                },
                {
                    fragmentId: "tower-top",
                    surfaceId: "tower-top",
                    level: 10,
                    nodeBaseZ: 30,
                    nodeBaseZOffset: 0,
                    outerPolygon: [
                        { x: 0, y: 0 },
                        { x: 4, y: 0 },
                        { x: 4, y: 4 },
                        { x: 0, y: 4 }
                    ],
                    holes: []
                }
            ],
            wallSections: [{
                id: 1,
                floorId: "tower-top",
                fragmentId: "tower-top",
                startPoint: { x: 0, y: 0 },
                endPoint: { x: 4, y: 0 },
                height: 4,
                thickness: 0.25,
                bottomZ: 30,
                traversalLayer: 10
            }],
            mountedWallObjects: []
        });

        const stats = map.syncPrototypeBuildingGeometryRuntime();
        const stair = map.stairsById.get("building:tower:stair:ground:1");
        const blockers = buildings.computeBuildingPlacementMovementBlockerPolygons(
            map._prototypeBuildingState.buildingDataBySaveName.get(placement.buildingSaveName),
            placement
        );
        const cutaway = buildings.createPrototypeBuildingCutawayRecord(
            map._prototypeBuildingState.buildingDataBySaveName.get(placement.buildingSaveName),
            placement
        );
        const wallItem = cutaway.staticObjects.find((entry) => entry && entry.item && entry.item.type === "wallSection");

        assert.equal(stats.stairs, 1);
        assert.ok(stair);
        assert.equal(stair.higherFragmentId, "building:tower:floor:tower-top");
        assert.equal(stair.higherZ, 30);
        assert.equal(map.floorsById.get("building:tower:floor:tower-top").nodeBaseZ, 30);
        assert.equal(map.floorsById.get("building:tower:floor:tower-top").nodeBaseZOffset, 27);
        assert.equal(blockers[0].traversalLayer, 1);
        assert.equal(blockers[0].bottomZ, 30);
        assert.ok(wallItem);
        assert.equal(wallItem.item.traversalLayer, 1);
        assert.equal(wallItem.level, 1);
        assert.equal(wallItem.item.bottomZ, 30);
        assert.equal(cutaway.maxLevel, 1);
        assert.equal(cutaway.maxTopZ, 34);
    } finally {
        if (previousPolygonHitbox === undefined) {
            delete globalThis.PolygonHitbox;
        } else {
            globalThis.PolygonHitbox = previousPolygonHitbox;
        }
    }
});
