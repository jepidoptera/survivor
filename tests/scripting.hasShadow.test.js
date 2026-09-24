const assert = require("node:assert/strict");
const path = require("node:path");
const { afterEach, test } = require("node:test");

const SCRIPTING_PATH = path.join(__dirname, "../public/assets/javascript/spells/scripting.js");
const STATIC_OBJECTS_PATH = path.join(__dirname, "../public/assets/javascript/gameobjects/staticObjects.js");

function loadScripting() {
    delete require.cache[require.resolve(SCRIPTING_PATH)];
    delete global.Scripting;
    require(SCRIPTING_PATH);
    return global.Scripting;
}

afterEach(() => {
    delete require.cache[require.resolve(SCRIPTING_PATH)];
    delete require.cache[require.resolve(STATIC_OBJECTS_PATH)];
    delete global.Scripting;
    delete global.Rendering;
    delete global.ensureLosShadowHitboxForObject;
    delete global.presentGameFrame;
    delete global.StaticObject;
    delete global.PIXI;
    delete global.objectLayer;
    delete global.CircleHitbox;
});

test("this.hasShadow controls the target LOS shadow flag", () => {
    const scripting = loadScripting();
    const target = { type: "tree", hasShadow: true, castsLosShadows: true };

    const errors = scripting.validateScript("this.hasShadow=false");
    const run = scripting.runScript("this.hasShadow=false", { target });

    assert.deepEqual(errors, []);
    assert.equal(run.changed, true);
    assert.equal(target.hasShadow, false);
    assert.equal(target.castsLosShadows, false);
});

test("this.hasShadow=true creates LOS shadow geometry for hitbox-less targets", () => {
    const scripting = loadScripting();
    const target = {
        type: "flower",
        hasShadow: false,
        castsLosShadows: false,
        shadowBox: null,
        touchBox: { type: "circle", x: 3, y: 4, radius: 0.5 }
    };
    let helperTarget = null;
    let invalidated = false;
    let presented = false;
    global.ensureLosShadowHitboxForObject = obj => {
        helperTarget = obj;
        obj.shadowBox = { type: "circle", x: 3, y: 4, radius: 0.5 };
        return true;
    };
    global.Rendering = {
        invalidateLosState() {
            invalidated = true;
            return true;
        }
    };
    global.presentGameFrame = () => {
        presented = true;
    };

    const run = scripting.runScript("this.hasShadow=true", { target });

    assert.equal(run.changed, true);
    assert.equal(target.hasShadow, true);
    assert.equal(target.castsLosShadows, true);
    assert.equal(helperTarget, target);
    assert.deepEqual(target.shadowBox, { type: "circle", x: 3, y: 4, radius: 0.5 });
    assert.equal(invalidated, true);
    assert.equal(presented, true);
});

test("scripted objects persist hasShadow=true in save data", () => {
    global.PIXI = {
        Texture: { WHITE: { id: "white" } },
        Sprite: class {
            constructor(texture) {
                this.texture = texture;
                this.anchor = { set() {} };
            }
        }
    };
    global.objectLayer = { addChild() {} };
    global.CircleHitbox = class {
        constructor(x, y, radius) {
            this.type = "circle";
            this.x = x;
            this.y = y;
            this.radius = radius;
        }
    };

    require(STATIC_OBJECTS_PATH);
    const obj = new global.StaticObject("flower", { x: 1, y: 2 }, 1, 1, [], {
        worldToNode() {
            return null;
        }
    });
    obj.script = { playerTouches: "this.hasShadow=true" };
    obj.hasShadow = true;

    const saved = obj.saveJson();

    assert.equal(saved.hasShadow, true);
    assert.equal(saved.castsLosShadows, true);
});
