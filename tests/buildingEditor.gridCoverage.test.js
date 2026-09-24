const test = require("node:test");
const assert = require("node:assert/strict");

async function loadRenderer() {
    return import("../public/building-editor/BuildingRenderer.js");
}

class FakeContainer {
    constructor() {
        this.children = [];
        this.visible = true;
    }

    addChild(child) {
        const existingIndex = this.children.indexOf(child);
        if (existingIndex >= 0) this.children.splice(existingIndex, 1);
        this.children.push(child);
        child.parent = this;
        return child;
    }

    removeChildren() {
        const removed = this.children.slice();
        this.children = [];
        removed.forEach((child) => {
            if (child) child.parent = null;
        });
        return removed;
    }
}

class FakeGraphics {
    constructor() {
        this.visible = true;
        this.polygons = [];
    }

    clear() {
        this.polygons = [];
    }

    lineStyle() {}

    drawPolygon(points) {
        this.polygons.push(points);
    }

    beginFill() {}

    endFill() {}

    moveTo() {}

    lineTo() {}

    closePath() {}
}

test("building editor grid draws steep pitch viewports across graphics chunks", async () => {
    const previousPixi = globalThis.PIXI;
    const previousScenePicker = globalThis.RenderingScenePicker;
    globalThis.PIXI = {
        Container: FakeContainer,
        Graphics: FakeGraphics
    };
    globalThis.RenderingScenePicker = class FakeRenderingScenePicker {
        buildPickPass() {
            this.pickRenderTexture = {};
        }
    };
    try {
        const { BuildingRenderer } = await loadRenderer();
        const app = {
            screen: { width: 2048, height: 1346 },
            stage: new FakeContainer(),
            render() {}
        };
        const state = {
            tool: "select",
            showSnapAnchors: false,
            camera: {
                x: 0,
                y: 0,
                z: 0,
                zoom: 72,
                rotation: 0.6,
                pitch: Math.PI * 5 / 12,
                rotationCenter: { x: 0, y: 0 }
            },
            building: { floorFragments: [], wallSections: [] },
            buildingCenter() {
                return { x: 0, y: 0 };
            },
            selectedFloor() {
                return null;
            },
            renderStyle() {
                return "exterior";
            },
            setRenderError() {}
        };

        const renderer = new BuildingRenderer(app, state);
        renderer.drawGrid();

        const visibleChunks = renderer.gridHexLayers.filter((layer) => layer.visible);
        assert.ok(visibleChunks.length > 1, "steep pitch grid should be split into multiple graphics chunks");
        assert.ok(visibleChunks.every((layer) => layer.polygons.length <= 600));
        assert.ok(visibleChunks.reduce((sum, layer) => sum + layer.polygons.length, 0) > 600);
        await Promise.resolve();
    } finally {
        if (previousPixi === undefined) {
            delete globalThis.PIXI;
        } else {
            globalThis.PIXI = previousPixi;
        }
        if (previousScenePicker === undefined) {
            delete globalThis.RenderingScenePicker;
        } else {
            globalThis.RenderingScenePicker = previousScenePicker;
        }
    }
});
