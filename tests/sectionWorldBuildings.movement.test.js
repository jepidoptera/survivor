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
        traversalLayer: 0,
        level: 0,
        neighbors: [],
        neighborOffsets: [],
        blockedNeighbors: new Map(),
        objects: []
    };
}

function createPrototypeNodeMap(width = 12, height = 12, options = {}) {
    const materializeFloorNodes = options.materializeFloorNodes !== false;
    const baseOffsets = [
        { x: 1, y: 0 },
        { x: -1, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: -1 }
    ];
    const allNodesByCoordKey = new Map();
    for (let x = -2; x < width; x++) {
        for (let y = -2; y < height; y++) {
            allNodesByCoordKey.set(`${x},${y}`, createNode(x, y));
        }
    }
    for (const node of allNodesByCoordKey.values()) {
        node.neighborOffsets = baseOffsets.slice();
        node.neighbors = baseOffsets.map((offset) => allNodesByCoordKey.get(`${node.xindex + offset.x},${node.yindex + offset.y}`) || null);
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

function installBuildingFloorMaterializationTestApis(map) {
    const offsets = [
        { x: 1, y: 0 },
        { x: -1, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: -1 }
    ];
    map.floorNodeIndex = new Map();
    map.getFloorNodeKey = (nodeOrX, y = null, surfaceId = "", fragmentId = "") => {
        if (nodeOrX && typeof nodeOrX === "object") {
            return `${Number(nodeOrX.xindex)},${Number(nodeOrX.yindex)},${nodeOrX.surfaceId || ""},${nodeOrX.fragmentId || ""}`;
        }
        return `${Number(nodeOrX)},${Number(y)},${surfaceId || ""},${fragmentId || ""}`;
    };
    map.isPointSupportedByFloorFragment = (fragment, x, y) => {
        const poly = Array.isArray(fragment && fragment.outerPolygon) ? fragment.outerPolygon : [];
        if (poly.length < 3) return false;
        let inside = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const xi = Number(poly[i].x);
            const yi = Number(poly[i].y);
            const xj = Number(poly[j].x);
            const yj = Number(poly[j].y);
            const intersects = ((yi > y) !== (yj > y)) &&
                (x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-9) + xi);
            if (intersects) inside = !inside;
        }
        return inside;
    };
    map.registerFloorNode = function registerFloorNode(node, fragment) {
        node.surfaceId = fragment.surfaceId;
        node.fragmentId = fragment.fragmentId;
        node.ownerSectionKey = fragment.ownerSectionKey || "";
        node.id = this.getFloorNodeKey(node);
        if (!this.floorNodesById.has(fragment.fragmentId)) this.floorNodesById.set(fragment.fragmentId, []);
        this.floorNodesById.get(fragment.fragmentId).push(node);
        this.floorNodeIndex.set(node.id, node);
        const layerKey = this.getFloorLayerNodeKey(node.xindex, node.yindex, node.traversalLayer);
        if (!this.floorNodeLayerIndex.has(layerKey)) this.floorNodeLayerIndex.set(layerKey, []);
        this.floorNodeLayerIndex.get(layerKey).push(node);
        return node;
    };
    map._connectFloorNodesIncremental = function connectFloorNodesIncremental(nodes) {
        for (const node of nodes) {
            for (let i = 0; i < node.neighborOffsets.length; i++) {
                const offset = node.neighborOffsets[i];
                const key = this.getFloorNodeKey(
                    node.xindex + offset.x,
                    node.yindex + offset.y,
                    node.surfaceId,
                    node.fragmentId
                );
                node.neighbors[i] = this.floorNodeIndex.get(key) || null;
            }
        }
    };
    map.unregisterFloorFragments = function unregisterFloorFragments(fragmentIds) {
        for (const fragmentId of fragmentIds) {
            const nodes = this.floorNodesById.get(fragmentId) || [];
            for (const node of nodes) {
                this.floorNodeIndex.delete(node.id);
                const layerKey = this.getFloorLayerNodeKey(node.xindex, node.yindex, node.traversalLayer);
                const layerNodes = this.floorNodeLayerIndex.get(layerKey) || [];
                const index = layerNodes.indexOf(node);
                if (index >= 0) layerNodes.splice(index, 1);
            }
            this.floorNodesById.delete(fragmentId);
            this.floorsById.delete(fragmentId);
        }
        return fragmentIds.length;
    };
    map.worldToNode = function worldToNode(x, y) {
        let best = null;
        let bestDist = Infinity;
        for (const node of this._prototypeSectionState.allNodesByCoordKey.values()) {
            const dx = Number(node.x) - Number(x);
            const dy = Number(node.y) - Number(y);
            const dist = dx * dx + dy * dy;
            if (dist < bestDist) {
                best = node;
                bestDist = dist;
            }
        }
        if (best) return best;
        const xi = Math.round(Number(x) / 0.866);
        const yi = Math.round(Number(y) - (xi % 2 === 0 ? 0.5 : 0));
        return {
            xindex: xi,
            yindex: yi,
            x: xi * 0.866,
            y: yi + (xi % 2 === 0 ? 0.5 : 0),
            neighborOffsets: offsets.slice(),
            objects: []
        };
    };
    map.getFloorNodeAtLayer = function getFloorNodeAtLayer(x, y, layer, options = {}) {
        const key = this.getFloorNodeKey(x, y, options.surfaceId || "", options.fragmentId || "");
        return this.floorNodeIndex.get(key) || null;
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
            nodeBaseZ: 0,
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

function collectBuildingEdgeBlockerLinks(map) {
    const links = [];
    for (const node of map._prototypeSectionState.allNodesByCoordKey.values()) {
        if (!(node.blockedNeighbors instanceof Map)) continue;
        for (const [direction, blockers] of node.blockedNeighbors.entries()) {
            if (!(blockers instanceof Set)) continue;
            for (const blocker of blockers) {
                if (blocker && blocker._prototypeBuildingMovementEdgeBlocker === true) {
                    links.push({ node, direction, blocker });
                }
            }
        }
    }
    return links;
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

test("building interior bitmap object exclusions are floor scoped and retain stale cached bakes", () => {
    let dirtyCount = 0;
    const map = {
        markBuildingRenderCacheDirty() {
            dirtyCount += 1;
        }
    };
    buildings.installSectionWorldBuildingApis(map);
    map.initializePrototypeBuildingState([createPlacement("building:bake-house")]);

    const state = map._prototypeBuildingState;
    let destroyedTextures = 0;
    const cachedEntry = {
        status: "ready",
        texture: { destroy() { destroyedTextures += 1; } },
        depthMetricTexture: { destroy() { destroyedTextures += 1; } }
    };
    state.interiorBitmapsByKey.set("building:bake-house|floor-1", cachedEntry);

    const object = {
        _prototypeOwnerType: "building",
        _prototypeOwnerId: "building:bake-house",
        _prototypeRecordId: 101,
        fragmentId: "building:bake-house:floor:floor-1",
        surfaceId: "building:bake-house:surface:floor-1"
    };

    const removed = map.removePrototypeBuildingObjectFromInteriorBitmap(object);
    assert.deepEqual(removed, {
        placementId: "building:bake-house",
        floorId: "floor-1",
        recordId: 101,
        changed: true
    });
    assert.equal(object._prototypeInteriorBitmapExcluded, true);
    assert.deepEqual(object._prototypeInteriorBitmapExclusion, {
        placementId: "building:bake-house",
        floorId: "floor-1",
        recordId: 101
    });
    assert.equal(destroyedTextures, 0);
    assert.equal(dirtyCount, 0);
    assert.equal(state.interiorBitmapsByKey.get("building:bake-house|floor-1"), cachedEntry);
    assert.equal(cachedEntry.stale, true);
    assert.equal(cachedEntry.staleReason, "object-bake-membership");
    assert.equal(state.interiorBitmapObjectExclusionsByKey.get("building:bake-house|floor-1").has(101), true);

    const repeated = map.removePrototypeBuildingObjectFromInteriorBitmap(object);
    assert.equal(repeated.changed, false);
    assert.equal(dirtyCount, 0);

    const restored = map.restorePrototypeBuildingObjectToInteriorBitmap(object);
    assert.deepEqual(restored, {
        placementId: "building:bake-house",
        floorId: "floor-1",
        recordId: 101,
        changed: true
    });
    assert.equal(object._prototypeInteriorBitmapExcluded, false);
    assert.equal(object._prototypeInteriorBitmapExclusion, null);
    assert.equal(destroyedTextures, 0);
    assert.equal(dirtyCount, 0);
    assert.equal(state.interiorBitmapsByKey.get("building:bake-house|floor-1"), cachedEntry);
    assert.equal(cachedEntry.stale, true);
    assert.equal(state.interiorBitmapObjectExclusionsByKey.has("building:bake-house|floor-1"), false);

    const surfaceOnlyObject = {
        _prototypeOwnerType: "building",
        _prototypeOwnerId: "building:bake-house",
        _prototypeRecordId: 102,
        surfaceId: "building:bake-house:surface:floor-2"
    };
    const surfaceOnlyRemoved = map.removePrototypeBuildingObjectFromInteriorBitmap(surfaceOnlyObject);
    assert.equal(surfaceOnlyRemoved.floorId, "floor-2");
    assert.equal(state.interiorBitmapObjectExclusionsByKey.get("building:bake-house|floor-2").has(102), true);
});

test("building interior bitmap invalidation is floor scoped and blocks obsolete loading commits", () => {
    let dirtyCount = 0;
    const map = {
        markBuildingRenderCacheDirty() {
            dirtyCount += 1;
        }
    };
    buildings.installSectionWorldBuildingApis(map);
    map.initializePrototypeBuildingState([createPlacement("building:bake-house")]);
    const state = map._prototypeBuildingState;
    const readyEntry = {
        status: "ready",
        texture: { destroy() {} }
    };
    const loadingEntry = {
        status: "loading",
        settingsSignature: "old"
    };
    const stalePromise = Promise.resolve();
    state.interiorBitmapsByKey.set("building:bake-house|floor-1", readyEntry);
    state.interiorBitmapsByKey.set("building:bake-house|floor-2", loadingEntry);
    state.pendingInteriorBitmapLoadsByKey.set("building:bake-house|floor-2", {
        settingsSignature: "old",
        promise: stalePromise
    });

    const readyInvalidated = map.invalidatePrototypeBuildingInteriorBitmap({
        placementId: "building:bake-house",
        floorId: "floor-1"
    });
    const loadingInvalidated = map.invalidatePrototypeBuildingInteriorBitmap({
        _prototypeOwnerType: "building",
        _prototypeOwnerId: "building:bake-house",
        _floorMembership: {
            ownerType: "building",
            ownerId: "building:bake-house",
            floorId: "floor-2",
            level: 1
        }
    });

    assert.deepEqual(readyInvalidated, {
        placementId: "building:bake-house",
        floorId: "floor-1",
        changed: true
    });
    assert.deepEqual(loadingInvalidated, {
        placementId: "building:bake-house",
        floorId: "floor-2",
        changed: true
    });
    assert.equal(readyEntry.stale, true);
    assert.equal(loadingEntry.stale, true);
    assert.equal(state.pendingInteriorBitmapLoadsByKey.has("building:bake-house|floor-2"), false);
    assert.equal(dirtyCount, 0);
});

test("building interior bitmap object exclusions require building ownership and floor identity", () => {
    const map = {};
    buildings.installSectionWorldBuildingApis(map);

    assert.throws(
        () => map.removePrototypeBuildingObjectFromInteriorBitmap({
            _prototypeOwnerType: "section",
            _prototypeOwnerId: "section:0,0",
            _prototypeRecordId: 5,
            fragmentId: "section:0,0:floor:floor-1"
        }),
        /not owned by a building/
    );

    assert.throws(
        () => map.removePrototypeBuildingObjectFromInteriorBitmap({
            _prototypeOwnerType: "building",
            _prototypeOwnerId: "building:bake-house",
            _prototypeRecordId: 5
        }),
        /requires a floor id/
    );

    assert.throws(
        () => map.removePrototypeBuildingObjectFromInteriorBitmap({
            _prototypeOwnerType: "building",
            _prototypeOwnerId: "building:bake-house",
            fragmentId: "building:bake-house:floor:floor-1"
        }),
        /requires an object record id/
    );
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

test("loaded wizard inside a building cannot walk through ground-floor walls when outdoor selection misses that building", () => {
    const previousPolygonHitbox = globalThis.PolygonHitbox;
    const previousWizard = globalThis.wizard;
    globalThis.PolygonHitbox = TestPolygonHitbox;
    try {
        const map = createPrototypeNodeMap();
        buildings.installSectionWorldBuildingApis(map);
        const wizard = { type: "wizard" };
        globalThis.wizard = wizard;
        map.addPrototypeBuildingPlacement({
            id: "building:loaded-inside-house",
            buildingSaveName: "loaded inside house",
            transform: { x: 0, y: 0, rotation: 0 }
        }, { buildingData: createBuildingSaveWithDoorAndColumn() });

        const loadedInsideSupport = {
            type: "floor",
            layer: 0,
            baseZ: 0,
            fragmentId: "building:loaded-inside-house:floor:floor-0",
            surfaceId: "building:loaded-inside-house:surface:floor-0",
            ownerType: "building",
            ownerId: "building:loaded-inside-house",
            sectionKey: "building:loaded-inside-house"
        };
        map.updatePrototypeWorldScopeForMovementSupport(wizard, loadedInsideSupport, { promoteInterior: false });

        map.setPrototypeBuildingDesiredPlacementIds(new Set());

        const blockers = map.collectPrototypeBuildingMovementBlockersInBounds({
            minX: -0.5,
            minY: -0.5,
            maxX: 0.75,
            maxY: 4.5
        }, 0);
        const canWalkThroughWall = blockers.length === 0;

        assert.equal(canWalkThroughWall, false, "loaded-inside ground-floor wall blockers should still be active");
    } finally {
        if (previousPolygonHitbox === undefined) {
            delete globalThis.PolygonHitbox;
        } else {
            globalThis.PolygonHitbox = previousPolygonHitbox;
        }
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
        const edgeLinks = collectBuildingEdgeBlockerLinks(map);
        assert.equal(edgeLinks.length > 0, true, "story-0 building walls should block neighboring base-node crossings");
        assert.equal(edgeLinks.every((link) => link.blocker.buildingPlacementId === "building:test-house"), true);
        assert.equal(placement.movementBlockedEdges.length > 0, true);
        assert.equal(placement.movementBlockedEdges.every((edge) => edge.traversalLayer === 0), true);
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

test("building geometry sync materializes upper-floor nodes and rehomes stale floor objects", () => {
    const previousPolygonHitbox = globalThis.PolygonHitbox;
    globalThis.PolygonHitbox = TestPolygonHitbox;
    try {
        const map = createPrototypeNodeMap(6, 6, { materializeFloorNodes: false });
        installBuildingFloorMaterializationTestApis(map);
        buildings.installSectionWorldBuildingApis(map);
        const placement = {
            ...createPlacement("building:node-house"),
            transform: { x: -130, y: 200, rotation: 0 },
            touchedSectionKeys: ["far-section"]
        };
        map.initializePrototypeBuildingState([placement]);
        map._prototypeBuildingState.buildingDataBySaveName.set(
            placement.buildingSaveName,
            createBuildingSaveWithUpperFloorBlockers()
        );

        const fragmentId = "building:node-house:floor:floor-1";
        const surfaceId = "building:node-house:surface:floor-1";
        const staleNode = {
            xindex: 5,
            yindex: 2,
            x: -125.67,
            y: 202,
            traversalLayer: 1,
            level: 1,
            surfaceId,
            fragmentId,
            id: `5,2,${surfaceId},${fragmentId}`,
            objects: [],
            removeObject(obj) {
                const index = this.objects.indexOf(obj);
                if (index >= 0) this.objects.splice(index, 1);
            }
        };
        const object = {
            type: "furniture",
            scriptingName: "upper-chair",
            x: -126.1,
            y: 202.4,
            groundRadius: 0.7,
            traversalLayer: 1,
            level: 1,
            fragmentId,
            surfaceId,
            _floorMembership: {
                ownerType: "building",
                ownerId: "building:node-house",
                floorId: "floor-1",
                level: 1
            },
            _indexedNodes: [staleNode],
            node: staleNode,
            setIndexedNodes(nodes, primaryNode) {
                for (const previous of this._indexedNodes) {
                    if (previous && typeof previous.removeObject === "function") previous.removeObject(this);
                }
                this._indexedNodes = nodes;
                this.node = primaryNode;
                for (const next of nodes) {
                    if (next && typeof next.addObject === "function") next.addObject(this);
                }
            },
            refreshIndexedNodesFromHitbox(options = {}) {
                const baseNode = map.worldToNode(this.x, this.y);
                const floorNode = map.getFloorNodeAtLayer(baseNode.xindex, baseNode.yindex, options.traversalLayer, {
                    fragmentId: this.fragmentId,
                    surfaceId: this.surfaceId
                });
                const indexedNode = floorNode || options.fallbackNode || null;
                this.setIndexedNodes(indexedNode ? [indexedNode] : [], indexedNode);
            }
        };
        staleNode.objects.push(object);
        map.floorNodesById.set(fragmentId, [staleNode]);
        map.floorNodeIndex.set(staleNode.id, staleNode);
        map._prototypeObjectState = {
            activeRuntimeObjectsByRecordId: new Map([[10, object]])
        };
        map._prototypeBuildingState.runtimeFloorFragmentIdsByPlacementId.set("building:node-house", [fragmentId]);

        const stats = map.syncPrototypeBuildingGeometryRuntime();
        const canonicalNode = object.node;

        assert.ok(stats.floorNodes > 1);
        assert.equal(stats.floorObjectsRehomed, 1);
        assert.ok(canonicalNode);
        assert.equal(canonicalNode.fragmentId, fragmentId);
        assert.equal(map.floorNodeIndex.get(canonicalNode.id), canonicalNode);
        assert.equal(canonicalNode.objects.includes(object), true);
        assert.equal(staleNode.objects.includes(object), false);
        assert.equal(canonicalNode.neighbors.some(Boolean), true);
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
