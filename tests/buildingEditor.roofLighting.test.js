const test = require("node:test");
const assert = require("node:assert/strict");

async function loadRenderer() {
    return import("../public/building-editor/BuildingRenderer.js");
}

function createSurfaceUniformMesh() {
    return {
        visible: false,
        shader: {
            uniforms: {
                uScreenSize: new Float32Array([0, 0]),
                uCameraWorld: new Float32Array([0, 0]),
                uCameraZ: 0,
                uViewScale: 0,
                uXyRatio: 0,
                uCameraPitch: 0,
                uCameraRotation: 0,
                uCameraRotationCenter: new Float32Array([0, 0]),
                uLightVector: new Float32Array([0, 0, 0]),
                uLightDiffuse: 0,
                uLightClamp: new Float32Array([0, 0]),
                uOverheadSlopeLighting: 0,
                uSampler: null,
                uTint: new Float32Array([0, 0, 0, 0])
            }
        }
    };
}

function createRenderer(BuildingRenderer) {
    const renderer = Object.create(BuildingRenderer.prototype);
    renderer.app = { screen: { width: 320, height: 200 } };
    renderer.state = {
        camera: {
            x: 0,
            y: 0,
            z: 0,
            zoom: 10,
            rotation: 0,
            pitch: BuildingRenderer.DEFAULT_CAMERA_PITCH,
            rotationCenter: { x: 0, y: 0 }
        },
        buildingCenter() {
            return { x: 0, y: 0 };
        }
    };
    renderer.getSurfaceTexture = (texturePath) => ({ texturePath });
    return renderer;
}

test("roof surface meshes opt into overhead slope lighting", async () => {
    const { BuildingRenderer } = await loadRenderer();
    const renderer = createRenderer(BuildingRenderer);
    const floor = {
        fragmentId: "floor-1",
        floorTexturePath: "/assets/images/flooring/woodfloor.png",
        roof: {
            mode: "dome",
            texturePath: "/assets/images/roofs/slate.png"
        }
    };

    const roofMesh = createSurfaceUniformMesh();
    renderer.updateRoofMeshUniforms(roofMesh, floor, 1);
    assert.equal(roofMesh.shader.uniforms.uOverheadSlopeLighting, 1);

    const floorMesh = createSurfaceUniformMesh();
    renderer.updateFloorMeshUniforms(floorMesh, floor, 1);
    assert.equal(floorMesh.shader.uniforms.uOverheadSlopeLighting, 0);
});
