const test = require("node:test");
const assert = require("node:assert/strict");

const SCRIPTING_MODULE_PATH = require.resolve("../public/assets/javascript/spells/scripting.js");

const GLOBAL_KEYS = [
    "Scripting",
    "gameObject",
    "gameObjectState",
    "namedGameObjects"
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

function loadScripting() {
    delete require.cache[SCRIPTING_MODULE_PATH];
    require(SCRIPTING_MODULE_PATH);
    return globalThis.Scripting;
}

function createRectHitbox(left, top, right, bottom) {
    return {
        containsPoint(x, y) {
            return x >= left && x <= right && y >= top && y <= bottom;
        },
        intersects(probe) {
            if (!probe || probe.type !== "circle") return false;
            const nearestX = Math.max(left, Math.min(right, Number(probe.x) || 0));
            const nearestY = Math.max(top, Math.min(bottom, Number(probe.y) || 0));
            const dx = (Number(probe.x) || 0) - nearestX;
            const dy = (Number(probe.y) || 0) - nearestY;
            const radius = Math.max(0, Number(probe.radius) || 0);
            return (dx * dx) + (dy * dy) <= radius * radius;
        }
    };
}

test.afterEach(() => {
    delete require.cache[SCRIPTING_MODULE_PATH];
    restoreGlobals();
});

test("object playerTouches fires for non-door scripted objects", () => {
    const scripting = loadScripting();
    const events = [];
    scripting.on("script:playerTouches", (payload) => {
        events.push(payload);
    });

    const statue = {
        type: "placedObject",
        category: "furniture",
        x: 0,
        y: 0,
        gone: false,
        script: {
            playerTouches: "healPlayer(1)"
        }
    };
    const hitbox = createRectHitbox(-1, -1, 1, 1);
    statue.groundPlaneHitbox = hitbox;

    const wizard = {
        x: 0,
        y: 0,
        map: null,
        _scriptTouchedObjectsById: new Map()
    };

    scripting.processObjectTouchEvents(
        wizard,
        [{ obj: statue, hitbox }],
        0
    );

    assert.equal(events.length, 1);
    assert.equal(events[0].target, statue);
    assert.equal(events[0].eventName, "playerTouches");
});

test("door exit still fires after the door drops out of the nearby query", () => {
    const scripting = loadScripting();
    const events = [];
    scripting.on("door:playerExits", (payload) => {
        events.push(payload);
    });

    const door = {
        type: "placedObject",
        category: "doors",
        x: 0,
        y: 0,
        placementRotation: 0,
        map: null,
        gone: false,
        vanishing: false,
        playerEnters: "",
        playerExits: "",
        _learnedEnterSign: -1
    };
    const hitbox = createRectHitbox(-4, -1, 4, 1);
    door.groundPlaneHitbox = hitbox;

    const wizard = {
        map: null,
        _doorTraversalStateById: new Map()
    };

    scripting.processDoorTraversalEvents(
        wizard,
        3,
        -2,
        3,
        0,
        [{ obj: door, hitbox }],
        0
    );

    scripting.processDoorTraversalEvents(
        wizard,
        3,
        0,
        3,
        2,
        [],
        0
    );

    assert.equal(events.length, 1);
    assert.equal(events[0].eventName, "playerExits");
    assert.equal(events[0].door, door);
    assert.equal(wizard._doorTraversalStateById.get(door._doorRuntimeId).inside, false);
});