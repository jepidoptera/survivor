const test = require("node:test");
const assert = require("node:assert/strict");

globalThis.window = globalThis;
require("../public/assets/javascript/gameobjects/hitbox.js");

function installTreeGrowHarness(nodeObjects = []) {
    const previous = {
        Spell: globalThis.Spell,
        document: globalThis.document,
        PIXI: globalThis.PIXI,
        Tree: globalThis.Tree,
        wizard: globalThis.wizard,
        message: globalThis.message,
        SpellSystem: globalThis.SpellSystem,
        keysPressed: globalThis.keysPressed
    };
    const messages = [];
    const createdTrees = [];
    const node = {
        x: 10,
        y: 20,
        xindex: 1,
        yindex: 2,
        objects: nodeObjects,
        neighbors: []
    };
    const map = {
        worldToNode() {
            return node;
        },
        getNodesInIndexWindow() {
            return [node];
        },
        scenery: {
            tree: {
                textures: [{ id: "tree0" }]
            }
        }
    };

    globalThis.Spell = class {
        constructor() {
            this.visible = true;
        }
        detachPixiSprite() {}
    };
    globalThis.document = {
        createElement() {
            return { src: "" };
        }
    };
    globalThis.PIXI = {
        Texture: {
            from(path) {
                return { path };
            }
        }
    };
    globalThis.Tree = class {
        constructor(location, textures, treeMap) {
            this.x = location.x;
            this.y = location.y;
            this.textures = textures;
            this.map = treeMap;
            this.pixiSprite = { texture: null };
            createdTrees.push(this);
        }
        applySize(size) {
            this.size = size;
        }
        setTreeTextureIndex(index) {
            this.textureIndex = index;
        }
    };
    globalThis.wizard = {
        map,
        treeGrowPlacementSize: 4,
        selectedTreeTextureVariant: 0
    };
    globalThis.message = (text) => {
        messages.push(text);
    };
    globalThis.SpellSystem = {
        resolveTreePlacementSize() {
            return 4;
        },
        clearTreePlacementPreviewVariant() {},
        clearTreePlacementPreviewSize() {}
    };
    globalThis.keysPressed = {};

    delete require.cache[require.resolve("../public/assets/javascript/spells/TreeGrow.js")];
    require("../public/assets/javascript/spells/TreeGrow.js");

    return {
        TreeGrow: globalThis.TreeGrow,
        messages,
        createdTrees,
        restore() {
            for (const [key, value] of Object.entries(previous)) {
                if (value === undefined) {
                    delete globalThis[key];
                } else {
                    globalThis[key] = value;
                }
            }
        }
    };
}

test("tree placement ignores passable node occupants", () => {
    const harness = installTreeGrowHarness([{
        type: "buildingExteriorProxy",
        blocksTile: false,
        isPassable: true,
        groundPlaneHitbox: new CircleHitbox(10, 20, 50)
    }]);
    try {
        const spell = new harness.TreeGrow();
        spell.cast(10, 20);

        assert.equal(harness.createdTrees.length, 1);
        assert.equal(harness.messages.length, 0);
    } finally {
        harness.restore();
    }
});

test("tree placement allows non-overlapping blocking hitboxes in the same node", () => {
    const harness = installTreeGrowHarness([{
        type: "wallSection",
        isPassable: false,
        blocksTile: false,
        groundPlaneHitbox: new PolygonHitbox([
            { x: 12, y: 22 },
            { x: 13, y: 22 },
            { x: 13, y: 23 },
            { x: 12, y: 23 }
        ])
    }]);
    try {
        const spell = new harness.TreeGrow();
        spell.cast(10, 20);

        assert.equal(harness.createdTrees.length, 1);
        assert.equal(harness.messages.length, 0);
    } finally {
        harness.restore();
    }
});

test("tree placement rejects actual blocking hitbox overlap", () => {
    const harness = installTreeGrowHarness([{
        type: "wallSection",
        isPassable: false,
        blocksTile: false,
        groundPlaneHitbox: new PolygonHitbox([
            { x: 9.75, y: 19.75 },
            { x: 10.25, y: 19.75 },
            { x: 10.25, y: 20.25 },
            { x: 9.75, y: 20.25 }
        ])
    }]);
    try {
        const spell = new harness.TreeGrow();
        spell.cast(10, 20);

        assert.equal(harness.createdTrees.length, 0);
        assert.deepEqual(harness.messages, ["Something is already growing there!"]);
    } finally {
        harness.restore();
    }
});
