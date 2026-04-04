const test = require("node:test");
const assert = require("node:assert/strict");

const GLOBAL_KEYS = [
    "Spell",
    "PlaceObject",
    "Roof",
    "wizard",
    "message",
    "document",
    "Scripting",
    "roofs",
    "roof"
];

const savedGlobals = new Map();
for (const key of GLOBAL_KEYS) {
    savedGlobals.set(key, globalThis[key]);
}

function restoreGlobals() {
    for (const [key, value] of savedGlobals.entries()) {
        if (typeof value === "undefined") {
            delete globalThis[key];
        } else {
            globalThis[key] = value;
        }
    }
}

test.afterEach(() => {
    restoreGlobals();
});

test("placing a prototype roof marks it dirty for prototype object capture", () => {
    class Spell {
        constructor(x, y) {
            this.x = x;
            this.y = y;
            this.visible = true;
        }

        detachPixiSprite() {}
    }

    class Roof {
        constructor(x, y, z) {
            this.x = x;
            this.y = y;
            this.z = z;
            this.type = "roof";
        }

        static getPlacementCandidate() {
            return { wallSections: [{}, {}, {}] };
        }

        static applyWallLoopCandidateToRoof(targetRoof) {
            targetRoof.x = 12;
            targetRoof.y = 34;
            targetRoof.placed = true;
            return true;
        }
    }

    globalThis.Spell = Spell;
    globalThis.Roof = Roof;
    globalThis.document = {
        createElement() {
            return {};
        }
    };
    globalThis.message = () => {};
    globalThis.Scripting = null;
    globalThis.roofs = [];
    globalThis.roof = null;

    const prototypeObjectState = {
        captureScanNeeded: false,
        dirtyRuntimeObjects: new Set()
    };
    const map = {
        objects: [],
        _prototypeObjectState: prototypeObjectState,
        wrapWorldX(value) {
            return value;
        },
        wrapWorldY(value) {
            return value;
        }
    };

    globalThis.wizard = {
        map,
        selectedPlaceableCategory: "roof",
        selectedPlaceableTexturePath: "/assets/images/roofs/slate.png",
        selectedRoofOverhang: 0.25,
        selectedRoofPeakHeight: 2,
        selectedRoofTextureRepeat: 0.125
    };

    require("../public/assets/javascript/spells/PlaceObject.js");

    const spell = new globalThis.PlaceObject(0, 0);
    spell.cast(1, 2);

    assert.equal(map.objects.length, 1);
    assert.equal(globalThis.roofs.length, 1);
    assert.equal(prototypeObjectState.captureScanNeeded, true);
    assert.equal(prototypeObjectState.dirtyRuntimeObjects.has(globalThis.roofs[0]), true);
    assert.equal(globalThis.roofs[0]._prototypeDirty, true);
});
