const test = require("node:test");
const assert = require("node:assert/strict");

function installPixiMock() {
    const previousPixi = globalThis.PIXI;
    class DisplayNode {
        constructor() {
            this.children = [];
            this.parent = null;
            this.visible = true;
        }

        addChild(...children) {
            children.forEach((child) => {
                if (child) {
                    child.parent = this;
                    this.children.push(child);
                }
            });
            return children[children.length - 1] || null;
        }

        removeChild(child) {
            const index = this.children.indexOf(child);
            if (index >= 0) this.children.splice(index, 1);
            if (child) child.parent = null;
            return child;
        }

        destroy() {}
    }
    class Graphics extends DisplayNode {
        clear() {}
    }
    globalThis.PIXI = { Container: DisplayNode, Graphics };
    return () => {
        if (previousPixi === undefined) {
            delete globalThis.PIXI;
        } else {
            globalThis.PIXI = previousPixi;
        }
    };
}

test("collapsed wall open area handles perimeter-only triangular floors after vertex deletion", async () => {
    const restorePixi = installPixiMock();
    const previousClipper = globalThis.polygonClipping;
    globalThis.polygonClipping = require("polygon-clipping");
    try {
        const model = await import("../public/building-editor/BuildingModel.js");
        const { BuildingRenderer } = await import("../public/building-editor/BuildingRenderer.js");
        const building = model.createEmptyBuilding();
        const floor = model.createFloor({
            footprint: [
                { x: 5.761093709431589, y: 0 },
                { x: -4.218169328942895, y: 5.165767566951455e-16 },
                { x: -4.881645460147412, y: -6.400017818933569 }
            ]
        });
        model.addFloor(building, floor);

        const renderer = new BuildingRenderer({
            screen: { width: 800, height: 600 },
            stage: { addChild() {} }
        }, {
            building,
            camera: { x: 0, y: 0, z: 0, zoom: 1, rotation: 0 },
            selectedFloor: () => floor,
            buildingCenter: () => ({ x: 0, y: 0 })
        });

        const geometry = renderer.floorOpenAreaScreenGeometry(floor);

        assert.equal(geometry.length, 1);
        assert.equal(geometry[0].length, 1);
        assert.equal(geometry[0][0].length, 4);
    } finally {
        if (previousClipper === undefined) {
            delete globalThis.polygonClipping;
        } else {
            globalThis.polygonClipping = previousClipper;
        }
        restorePixi();
    }
});
