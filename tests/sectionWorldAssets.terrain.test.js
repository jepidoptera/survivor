const test = require("node:test");
const assert = require("node:assert/strict");

const {
    createSectionWorldAssetHelpers
} = require("../public/assets/javascript/prototypes/sectionWorldAssets.js");

function createAssetHelpers() {
    return createSectionWorldAssetHelpers({
        hashCoordinatePair(a, b, salt = 0) {
            return Math.abs(((Math.floor(a) * 73856093) ^ (Math.floor(b) * 19349663) ^ salt)) >>> 0;
        },
        hashToUnitFloat(value) {
            return (Math.abs(Number(value)) % 1000) / 1000;
        },
        offsetToWorld(offset) {
            const x = Number(offset && offset.x) || 0;
            const y = Number(offset && offset.y) || 0;
            return {
                x: x * 0.866,
                y: y + (x % 2 === 0 ? 0.5 : 0)
            };
        }
    });
}

test("section asset load drops terrain polygons with no matching saved terrain tile", () => {
    const helpers = createAssetHelpers();
    const asset = {
        key: "0,0",
        tileCoordKeys: [],
        terrainPolygons: [],
        floors: [],
        walls: [],
        blockedEdges: [],
        clearanceByTile: {},
        objects: [],
        animals: [],
        powerups: [],
        buildingRefs: []
    };
    const map = {
        getGroundTerrainDef(textureId) {
            return Number(textureId) === 53 ? { name: "water" } : { name: "grass" };
        },
        getGroundTerrainIdCount() {
            return 54;
        }
    };
    const keptPolygon = {
        type: "water",
        points: [
            { x: -1, y: 0 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
            { x: -1, y: 1 }
        ]
    };
    const stalePolygon = {
        type: "water",
        points: [
            { x: 10, y: 10 },
            { x: 11, y: 10 },
            { x: 11, y: 11 },
            { x: 10, y: 11 }
        ]
    };

    helpers.applyRawPrototypeSectionAssetToStateAsset(asset, {
        key: "0,0",
        id: "0,0",
        coord: { q: 0, r: 0 },
        centerAxial: { q: 0, r: 0 },
        centerOffset: { x: 0, y: 0 },
        neighborKeys: [],
        tileCoordKeys: ["0,0"],
        groundTiles: { "0,0": 53 },
        terrainPolygons: [keptPolygon, stalePolygon],
        floors: [],
        floorHoles: [],
        floorVoids: [],
        walls: [],
        blockedEdges: [],
        clearanceByTile: {},
        objects: [],
        animals: [],
        powerups: [],
        buildingRefs: []
    }, map, null);

    assert.deepEqual(asset.terrainPolygons, [keptPolygon]);
});
