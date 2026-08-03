const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

test("Wizard of Flatland validates generated zone-boundary wall labels", () => {
    const source = fs.readFileSync(
        path.join(__dirname, "../public/wizard-of-flatland/wallLabels.js"),
        "utf8"
    );
    const context = { window: {} };
    vm.createContext(context);
    vm.runInContext(source, context, { filename: "wallLabels.js" });

    const system = context.window.WizardFlatlandWallLabels.createWallLabelSystem({
        validateWallBuffer(walls) {
            assert.ok(walls instanceof Float32Array);
            assert.equal(walls.length % 8, 0);
        },
        constants: {
            WALL_STRIDE: 8,
            WALL_LABEL_CODE: 4,
            WALL_LABEL_SIDE: 5,
            WALL_LABEL_MANUAL_TOOL: 1,
            WALL_LABEL_ARENA_BOUNDARY: 2,
            WALL_LABEL_ROOM_BOUNDARY: 10,
            WALL_LABEL_ROOM_HALL_GAP: 11,
            WALL_LABEL_ROOM_OUTSIDE_DOOR_GAP: 12,
            WALL_LABEL_ROOM_POCKET_OVERRIDE: 13,
            WALL_LABEL_ROOM_POCKET_OVERRIDE_HALL_GAP: 14,
            WALL_LABEL_ROOM_POCKET_CONNECTOR: 15,
            WALL_LABEL_SQUARE_SIDE_PARALLEL: 20,
            WALL_LABEL_SQUARE_SIDE_PERPENDICULAR: 21,
            WALL_LABEL_SQUARE_SIDE_PERPENDICULAR_FULL: 22,
            WALL_LABEL_HALLWAY_SIDE_HALF: 30,
            WALL_LABEL_HALLWAY_SIDE_FULL: 31,
            WALL_LABEL_ZONE_BOUNDARY: 32,
            WALL_LABEL_TREE: 40
        }
    });
    const walls = new Float32Array([0, 0, 1, 1, 32, 2, 0, 0]);

    assert.doesNotThrow(() => system.validateWallLabelBuffer(walls, "zone boundary fixture"));
    assert.equal(system.getWallDebugLabel(32, 2), "zone boundary s2 | outward corridor closed");

    const mainSource = fs.readFileSync(
        path.join(__dirname, "../public/wizard-of-flatland/main.js"),
        "utf8"
    );
    assert.match(mainSource, /const WALL_LABEL_ZONE_BOUNDARY = 32;/);
    assert.match(mainSource, /WALL_LABEL_HALLWAY_SIDE_FULL,[\s\S]*WALL_LABEL_ZONE_BOUNDARY,[\s\S]*WALL_LABEL_TREE/);
});
