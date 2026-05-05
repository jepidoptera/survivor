const test = require("node:test");
const assert = require("node:assert/strict");

const GLOBAL_KEYS = [
    "Spell",
    "PlaceObject",
    "PlacedObject",
    "SpellSystem",
    "Roof",
    "wizard",
    "message",
    "document",
    "Scripting",
    "viewport",
    "viewscale",
    "xyratio",
    "mousePos",
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

    delete require.cache[require.resolve("../public/assets/javascript/spells/PlaceObject.js")];
    require("../public/assets/javascript/spells/PlaceObject.js");

    const spell = new globalThis.PlaceObject(0, 0);
    spell.cast(1, 2);

    assert.equal(map.objects.length, 1);
    assert.equal(globalThis.roofs.length, 1);
    assert.equal(prototypeObjectState.captureScanNeeded, true);
    assert.equal(prototypeObjectState.dirtyRuntimeObjects.has(globalThis.roofs[0]), true);
    assert.equal(globalThis.roofs[0]._prototypeDirty, true);
});

test("placing furniture uses the wizard's current layer", () => {
    class Spell {
        constructor(x, y) {
            this.x = x;
            this.y = y;
            this.visible = true;
        }

        detachPixiSprite() {}
    }

    const placed = [];
    class PlacedObject {
        constructor(location, map, options) {
            this.x = location.x;
            this.y = location.y;
            this.map = map;
            this.options = options;
            this.type = "placedObject";
            placed.push(this);
        }
    }

    globalThis.Spell = Spell;
    globalThis.PlacedObject = PlacedObject;
    globalThis.SpellSystem = {
        getPlaceObjectPlacementCandidate() {
            return null;
        }
    };
    globalThis.document = {
        createElement() {
            return {};
        }
    };
    globalThis.message = () => {};
    globalThis.Scripting = null;

    const map = {
        wrapWorldX(value) {
            return value;
        },
        wrapWorldY(value) {
            return value;
        },
        worldToNode() {
            return { xindex: 0, yindex: 0 };
        },
        objects: []
    };

    globalThis.wizard = {
        map,
        currentLayer: 2,
        currentLayerBaseZ: 6,
        editorPlacementActive: true,
        selectedPlaceableCategory: "furniture",
        selectedPlaceableTexturePath: "/assets/images/furniture/redrug.png",
        selectedPlaceableScale: 1,
        selectedPlaceableScaleMin: 0.2,
        selectedPlaceableScaleMax: 5,
        selectedPlaceableRotation: 0,
        selectedPlaceableRotationAxis: "ground",
        selectedPlaceableAnchorX: 0.5,
        selectedPlaceableAnchorY: 0.5,
        selectedPlaceableRenderOffset: 0
    };

    delete require.cache[require.resolve("../public/assets/javascript/spells/PlaceObject.js")];
    require("../public/assets/javascript/spells/PlaceObject.js");

    const spell = new globalThis.PlaceObject(0, 0);
    spell.cast(4, 5);

    assert.equal(placed.length, 1);
    assert.equal(placed[0].options.traversalLayer, 2);
    assert.equal(placed[0].options.level, 2);
    assert.equal(placed[0].traversalLayer, 2);
    assert.equal(placed[0].level, 2);
    assert.equal(placed[0]._renderTraversalLayer, 2);
    assert.equal(placed[0]._renderLayerBaseZ, 6);
});

test("placing furniture projects screen clicks onto the wizard's current level", () => {
    class Spell {
        constructor(x, y) {
            this.x = x;
            this.y = y;
            this.visible = true;
        }

        detachPixiSprite() {}
    }

    const placed = [];
    class PlacedObject {
        constructor(location, map, options) {
            this.x = location.x;
            this.y = location.y;
            this.map = map;
            this.options = options;
            placed.push(this);
        }
    }

    globalThis.Spell = Spell;
    globalThis.PlacedObject = PlacedObject;
    globalThis.SpellSystem = null;
    globalThis.document = {
        createElement() {
            return {};
        }
    };
    globalThis.message = () => {};
    globalThis.Scripting = null;
    globalThis.viewport = { x: 10, y: 20, z: 0 };
    globalThis.viewscale = 10;
    globalThis.xyratio = 0.5;
    globalThis.mousePos = { screenX: 30, screenY: 40 };

    const map = {
        wrapWorldX(value) {
            return value;
        },
        wrapWorldY(value) {
            return value;
        },
        shortestDeltaX(_from, to) {
            return to;
        },
        shortestDeltaY(_from, to) {
            return to;
        },
        worldToNode() {
            return { xindex: 0, yindex: 0 };
        },
        objects: []
    };

    globalThis.wizard = {
        x: 0,
        y: 0,
        map,
        currentLayer: 2,
        currentLayerBaseZ: 6,
        selectedPlaceableCategory: "furniture",
        selectedPlaceableTexturePath: "/assets/images/furniture/redrug.png",
        selectedPlaceableScale: 1,
        selectedPlaceableScaleMin: 0.2,
        selectedPlaceableScaleMax: 5,
        selectedPlaceableRotation: 0,
        selectedPlaceableRotationAxis: "ground",
        selectedPlaceableAnchorX: 0.5,
        selectedPlaceableAnchorY: 0.5,
        selectedPlaceableRenderOffset: 0
    };

    delete require.cache[require.resolve("../public/assets/javascript/spells/PlaceObject.js")];
    require("../public/assets/javascript/spells/PlaceObject.js");

    const spell = new globalThis.PlaceObject(0, 0);
    spell.cast(999, 999, { screenX: 30, screenY: 40 });

    assert.equal(placed.length, 1);
    assert.equal(placed[0].x, 13);
    assert.equal(placed[0].y, 34);
    assert.equal(placed[0].options.traversalLayer, 2);
});
