const test = require("node:test");
const assert = require("node:assert/strict");

async function loadRenderer() {
    return import("../public/building-editor/BuildingRenderer.js");
}

test("building cutaway stair lighting ramps over the same steps as the upper-floor opening", async () => {
    const previousEarcut = globalThis.earcut;
    try {
        globalThis.earcut = require("earcut").default;
        const { BuildingRenderer } = await loadRenderer();
        const renderer = Object.create(BuildingRenderer.prototype);
        renderer.activePlaneZ = () => 0;
        const stair = {
            id: "cutaway-relief-stair",
            bottomZ: 0,
            height: 30,
            direction: "up",
            stepCount: 60,
            riserDepth: 0.5,
            treads: [
                { left: { x: 0, y: 0 }, right: { x: 2, y: 0 } },
                { left: { x: 0, y: 12 }, right: { x: 2, y: 12 } }
            ]
        };

        const triangulation = renderer.triangulateStairSteps(stair, {
            surfaceLightFactor: 0.62
        });
        const relief = triangulation.cutoutReliefLightFactors;
        const reliefIndexes = Array.from(relief.keys());
        const factors = Array.from(relief.values()).map((value) => Number(value.toFixed(6)));
        const cutoutSteps = renderer.stairStepPolygons(stair)
            .filter((step) => Number(step.z) >= 28 - 0.000001 && Number(step.z) <= 30 + 0.000001)
            .map((step) => step.globalStepIndex);

        assert.deepEqual(reliefIndexes, cutoutSteps);
        assert.deepEqual(reliefIndexes, [57, 58, 59, 60]);
        assert.deepEqual(factors, [0.64375, 0.715, 0.83375, 1]);
        assert.equal(factors[factors.length - 1], 1);
        assert.equal(
            triangulation.tread.points.some((point) => Number(point.surfaceLightFactor) === 1),
            true
        );
        assert.equal(
            triangulation.tread.points.some((point) => Number(point.surfaceLightFactor) === 0.62),
            true
        );
    } finally {
        if (typeof previousEarcut === "undefined") {
            delete globalThis.earcut;
        } else {
            globalThis.earcut = previousEarcut;
        }
    }
});

test("building stair riser continues one step above the final tread", async () => {
    const previousEarcut = globalThis.earcut;
    try {
        globalThis.earcut = require("earcut").default;
        const { BuildingRenderer } = await loadRenderer();
        const renderer = Object.create(BuildingRenderer.prototype);
        renderer.activePlaneZ = () => 0;
        const stair = {
            id: "final-riser-stair",
            bottomZ: 0,
            height: 3,
            direction: "up",
            stepCount: 2,
            riserDepth: 0.5,
            treads: [
                { left: { x: 0, y: 0 }, right: { x: 1, y: 0 } },
                { left: { x: 0, y: 2 }, right: { x: 1, y: 2 } }
            ]
        };

        const triangulation = renderer.triangulateStairSteps(stair);
        const treadMaxZ = Math.max(...triangulation.tread.points.map((point) => Number(point.z)));
        const riserMaxZ = Math.max(...triangulation.riser.points.map((point) => Number(point.z)));
        const treadMaxY = Math.max(...triangulation.tread.points.map((point) => Number(point.y)));
        const riserMaxY = Math.max(...triangulation.riser.points.map((point) => Number(point.y)));

        assert.equal(treadMaxZ, 2);
        assert.equal(riserMaxZ, 2.999);
        assert.equal(treadMaxY, 2);
        assert.equal(riserMaxY, 3);
        assert.equal(
            triangulation.tread.points.some((point) => Number(point.y) > 2 + 0.000001),
            false
        );
        assert.equal(
            triangulation.riser.points.some((point) => Math.abs(Number(point.z) - 2.999) <= 0.000001),
            true
        );
    } finally {
        if (typeof previousEarcut === "undefined") {
            delete globalThis.earcut;
        } else {
            globalThis.earcut = previousEarcut;
        }
    }
});

test("building stair fake top face uses the upper floor texture", async () => {
    const previousPixi = globalThis.PIXI;
    try {
        globalThis.PIXI = {
            Container: class {
                constructor() {
                    this.children = [];
                }
                addChild(child) {
                    this.children.push(child);
                    child.parent = this;
                    return child;
                }
            }
        };
        const { BuildingRenderer } = await loadRenderer();
        const renderer = Object.create(BuildingRenderer.prototype);
        const lowerFloor = {
            fragmentId: "lower",
            floorTexturePath: "/assets/images/flooring/lower.png",
            elevation: 0
        };
        const upperFloor = {
            fragmentId: "upper",
            floorTexturePath: "/assets/images/flooring/upper.png",
            elevation: 3
        };
        const stair = {
            id: "platform-cap-texture-stair",
            bottomZ: 0,
            height: 3,
            direction: "up"
        };
        const triangulation = {
            tread: {
                points: [{ x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 1 }, { x: 0, y: 1, z: 1 }],
                indices: new Uint16Array([0, 1, 2])
            },
            riser: {
                points: [{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }],
                indices: new Uint16Array([0, 1, 2])
            },
            platformCap: {
                points: [{ x: 0, y: 1, z: 2.999 }, { x: 1, y: 1, z: 2.999 }, { x: 0, y: 2, z: 2.999 }],
                indices: new Uint16Array([0, 1, 2])
            }
        };
        const created = [];
        renderer.createStairMeshPart = (floor, passedStair, part, texturePath, namePrefix) => {
            created.push({ floor, passedStair, part, texturePath, namePrefix });
            return { namePrefix };
        };

        const mesh = renderer.createStairMesh(lowerFloor, stair, triangulation, null, null, upperFloor, null);
        const cap = created.find((entry) => entry.namePrefix === "buildingEditorStairPlatformCapMesh");

        assert.equal(mesh._stairPlatformCapMesh.namePrefix, "buildingEditorStairPlatformCapMesh");
        assert.equal(cap.texturePath, "/assets/images/flooring/upper.png");
        assert.equal(cap.floor, upperFloor);
        assert.equal(
            created.find((entry) => entry.namePrefix === "buildingEditorStairRiserMesh").texturePath,
            "/assets/images/flooring/woodfloor.png"
        );
    } finally {
        if (typeof previousPixi === "undefined") {
            delete globalThis.PIXI;
        } else {
            globalThis.PIXI = previousPixi;
        }
    }
});

test("building stair fake top face continues wedge angle edge to edge", async () => {
    const previousEarcut = globalThis.earcut;
    try {
        globalThis.earcut = require("earcut").default;
        const { BuildingRenderer } = await loadRenderer();
        const renderer = Object.create(BuildingRenderer.prototype);
        renderer.activePlaneZ = () => 0;
        const stair = {
            id: "wedge-platform-cap-stair",
            bottomZ: 0,
            height: 3,
            direction: "up",
            stepCount: 2,
            riserDepth: 0.5,
            treads: [
                { left: { x: 0, y: 0 }, right: { x: -2, y: 0 } },
                { left: { x: 2, y: 0 }, right: { x: 0, y: 0 }, arcDeltaAngle: Math.PI }
            ]
        };

        const triangulation = renderer.triangulateStairSteps(stair);
        const capPoints = triangulation.platformCap.points.map((point) => ({
            x: Number(point.x.toFixed(6)),
            y: Number(point.y.toFixed(6))
        }));
        const hasPoint = (x, y) => capPoints.some((point) => (
            Math.abs(point.x - x) <= 0.000001 &&
            Math.abs(point.y - y) <= 0.000001
        ));

        assert.equal(hasPoint(2, 0), true);
        assert.equal(hasPoint(0, 0), true);
        assert.equal(hasPoint(0, 2), true);
        assert.equal(hasPoint(0, -2), false);
    } finally {
        if (typeof previousEarcut === "undefined") {
            delete globalThis.earcut;
        } else {
            globalThis.earcut = previousEarcut;
        }
    }
});
