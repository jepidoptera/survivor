const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
    app,
    defaultJsonBodyLimit,
    loadSectionWorldSlot,
    resolveSectionWorldDirForSlot,
    saveSectionWorldSlot,
    sectionWorldJsonBodyLimit
} = require("../server.js");

function parseMegabyteLimit(limit) {
    const match = /^(\d+)mb$/i.exec(String(limit || "").trim());
    return match ? Number(match[1]) : NaN;
}

test("sectionworld API preserves top-level trigger definitions after a save/load round trip", async () => {
    const slot = `test_triggers_${process.pid}_${Date.now()}`;
    const slotDir = resolveSectionWorldDirForSlot(slot);
    fs.rmSync(slotDir, { recursive: true, force: true });

    try {
        const triggerRecord = {
            id: 41,
            type: "triggerArea",
            x: 0,
            y: 0,
            points: [
                { x: -1, y: -1 },
                { x: 1, y: -1 },
                { x: 1, y: 1 },
                { x: -1, y: 1 }
            ],
            coverageSectionKeys: ["0,0"],
            script: { playerEnters: "mazeMode=true;" }
        };
        const payload = {
            manifest: {
                activeCenterKey: "0,0"
            },
            triggers: [triggerRecord],
            sections: [
                {
                    id: "section-0,0",
                    key: "0,0",
                    coord: { q: 0, r: 0 },
                    centerAxial: { q: 0, r: 0 },
                    centerOffset: { x: 0, y: 0 },
                    neighborKeys: [],
                    tileCoordKeys: ["0,0"],
                    groundTextureId: 0,
                    groundTiles: { "0,0": 0 },
                    walls: [],
                    objects: [],
                    animals: [],
                    powerups: []
                }
            ]
        };

        const saveResult = saveSectionWorldSlot(slot, payload);
        assert.equal(saveResult.status, 200);
        assert.equal(saveResult.body.ok, true);

        const loadResult = loadSectionWorldSlot(slot);
        assert.equal(loadResult.status, 200);

        assert.equal(loadResult.body.ok, true);
        assert.deepEqual(loadResult.body.triggers, [triggerRecord]);
        assert.deepEqual(loadResult.body.sections[0].objects, []);
        assert.ok(fs.existsSync(path.join(slotDir, "triggers.json")));
    } finally {
        fs.rmSync(slotDir, { recursive: true, force: true });
    }
});

test("sectionworld API preserves copied building instances as per-building files", async () => {
    const slot = `test_buildings_${process.pid}_${Date.now()}`;
    const slotDir = resolveSectionWorldDirForSlot(slot);
    fs.rmSync(slotDir, { recursive: true, force: true });

    try {
        const buildingRecord = {
            schema: "survivor-building-v1",
            id: "building:test-house",
            sourceBuildingSaveName: "the house",
            buildingSaveName: "the house",
            floorFragments: [],
            wallSections: [],
            mountedWallObjects: [],
            transform: { x: 12, y: 34, rotation: 0.25 },
            footprintPolygons: [[
                { x: 10, y: 30 },
                { x: 14, y: 30 },
                { x: 14, y: 36 },
                { x: 10, y: 36 }
            ]],
            overlappedSectionKeys: ["0,0"],
            touchedSectionKeys: ["0,0"],
            objects: [
                {
                    id: 42,
                    type: "placedObject",
                    category: "furniture",
                    texturePath: "/assets/images/furniture/chair.png",
                    x: 12.5,
                    y: 34.5
                }
            ],
            animals: [],
            triggers: [],
            loadState: "interior"
        };
        const payload = {
            manifest: {
                activeCenterKey: "0,0"
            },
            buildings: [buildingRecord],
            sections: [
                {
                    id: "section-0,0",
                    key: "0,0",
                    coord: { q: 0, r: 0 },
                    centerAxial: { q: 0, r: 0 },
                    centerOffset: { x: 0, y: 0 },
                    neighborKeys: [],
                    tileCoordKeys: ["0,0"],
                    groundTextureId: 0,
                    groundTiles: { "0,0": 0 },
                    walls: [],
                    objects: [],
                    animals: [],
                    powerups: [],
                    buildingRefs: [
                        { id: "building:test-house", buildingSaveName: "the house" }
                    ]
                }
            ]
        };

        const saveResult = saveSectionWorldSlot(slot, payload);
        assert.equal(saveResult.status, 200);
        assert.equal(saveResult.body.ok, true);

        const loadResult = loadSectionWorldSlot(slot);
        assert.equal(loadResult.status, 200);
        assert.equal(loadResult.body.ok, true);
        assert.deepEqual(loadResult.body.buildings, [buildingRecord]);
        assert.deepEqual(loadResult.body.sections[0].buildingRefs, [
            { id: "building:test-house", buildingSaveName: "the house" }
        ]);
        assert.deepEqual(loadResult.body.sections[0].objects, []);
        assert.equal(fs.existsSync(path.join(slotDir, "buildings.json")), false);
        assert.ok(fs.existsSync(path.join(slotDir, "buildings", "index.json")));
        assert.ok(fs.existsSync(path.join(slotDir, "buildings", `${encodeURIComponent("building:test-house")}.json`)));

        const savedBuilding = JSON.parse(fs.readFileSync(
            path.join(slotDir, "buildings", `${encodeURIComponent("building:test-house")}.json`),
            "utf8"
        ));
        assert.deepEqual(savedBuilding, buildingRecord);
    } finally {
        fs.rmSync(slotDir, { recursive: true, force: true });
    }
});

test("sectionworld API still loads legacy bundled buildings.json saves", async () => {
    const slot = `test_legacy_buildings_${process.pid}_${Date.now()}`;
    const slotDir = resolveSectionWorldDirForSlot(slot);
    fs.rmSync(slotDir, { recursive: true, force: true });

    try {
        const buildingRecord = {
            schema: "survivor-building-placement-v1",
            id: "building:legacy-house",
            buildingSaveName: "the house",
            transform: { x: 12, y: 34, rotation: 0.25 },
            footprintPolygons: [],
            overlappedSectionKeys: ["0,0"],
            loadState: "unloaded"
        };
        fs.mkdirSync(slotDir, { recursive: true });
        fs.writeFileSync(path.join(slotDir, "manifest.json"), JSON.stringify({ activeCenterKey: "0,0" }, null, 2), "utf8");
        fs.writeFileSync(path.join(slotDir, "buildings.json"), JSON.stringify([buildingRecord], null, 2), "utf8");
        fs.writeFileSync(path.join(slotDir, "0,0.json"), JSON.stringify({
            id: "section-0,0",
            key: "0,0",
            coord: { q: 0, r: 0 },
            centerAxial: { q: 0, r: 0 },
            centerOffset: { x: 0, y: 0 },
            neighborKeys: [],
            tileCoordKeys: ["0,0"],
            groundTextureId: 0,
            groundTiles: { "0,0": 0 },
            walls: [],
            objects: [],
            animals: [],
            powerups: [],
            buildingRefs: [{ id: "building:legacy-house", buildingSaveName: "the house" }]
        }, null, 2), "utf8");

        const loadResult = loadSectionWorldSlot(slot);
        assert.equal(loadResult.status, 200);
        assert.equal(loadResult.body.ok, true);
        assert.deepEqual(loadResult.body.buildings, [buildingRecord]);
        assert.equal(loadResult.body.sections.length, 1);
    } finally {
        fs.rmSync(slotDir, { recursive: true, force: true });
    }
});

test("sectionworld API installs its larger JSON body parser before the default parser", () => {
    assert.ok(parseMegabyteLimit(sectionWorldJsonBodyLimit) > parseMegabyteLimit(defaultJsonBodyLimit));

    const stack = app._router.stack;
    const sectionWorldParserIndex = stack.findIndex(layer => (
        layer.handle &&
        layer.handle.name === "jsonParser" &&
        String(layer.regexp).includes("\\/api\\/sectionworld")
    ));
    const defaultJsonParserIndex = stack.findIndex(layer => (
        layer.handle &&
        layer.handle.name === "jsonParser" &&
        String(layer.regexp) === "/^\\/?(?=\\/|$)/i"
    ));
    const sectionWorldPostIndex = stack.findIndex(layer => (
        layer.route &&
        layer.route.path === "/api/sectionworld" &&
        layer.route.methods &&
        layer.route.methods.post
    ));

    assert.notEqual(sectionWorldParserIndex, -1);
    assert.notEqual(defaultJsonParserIndex, -1);
    assert.notEqual(sectionWorldPostIndex, -1);
    assert.ok(sectionWorldParserIndex < defaultJsonParserIndex);
    assert.ok(sectionWorldParserIndex < sectionWorldPostIndex);
});
