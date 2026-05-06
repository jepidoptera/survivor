const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
    loadSectionWorldSlot,
    resolveSectionWorldDirForSlot,
    saveSectionWorldSlot
} = require("../server.js");

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
