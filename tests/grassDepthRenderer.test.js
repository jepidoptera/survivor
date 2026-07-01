const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const shaderPath = path.join(ROOT, "public/assets/javascript/rendering/grassDepth/GrassDepthShaders.js");
const rendererPath = path.join(ROOT, "public/assets/javascript/rendering/grassDepth/GrassDepthRenderer.js");
const seedPath = path.join(ROOT, "public/assets/javascript/rendering/grassDepth/grass-seed.svg");

function loadGrassDepthContext() {
    const context = {
        console: {
            log() {},
            info() {}
        }
    };
    context.globalThis = context;
    context.window = context;
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(shaderPath, "utf8"), context, { filename: "GrassDepthShaders.js" });
    vm.runInContext(fs.readFileSync(rendererPath, "utf8"), context, { filename: "GrassDepthRenderer.js" });
    return context;
}

test("grass depth module installs shader and console toggle", () => {
    const context = loadGrassDepthContext();
    assert.equal(context.renderingGrassDepthEnabled, true);
    assert.equal(typeof context.grassDepth, "function");
    assert.equal(context.RenderingGrassDepth.isEnabled(), true);
    assert.equal(context.grassDepth(), false);
    assert.equal(context.grassDepth(false), false);
    assert.equal(context.RenderingGrassDepth.isEnabled(), false);
    assert.equal(context.grassDepth(true), true);
    assert.equal(context.RenderingGrassDepth.isEnabled(), true);
});

test("grass depth shader samples root mask and writes seed depth per fragment", () => {
    const source = fs.readFileSync(shaderPath, "utf8");
    assert.match(source, /texture\(uRootMask,\s*maskUv\)\.r/);
    assert.match(source, /uniform vec2 uSeedCameraWorld;/);
    assert.match(source, /const int MAX_GRASS_DEPTH_STEPS = 80;/);
    assert.match(source, /const int MAX_GRASS_HALF_WIDTH_STEPS = 6;/);
    assert.doesNotMatch(source, /BLADE_TOP_DEPTH_BIAS/);
    assert.match(source, /uniform float uBladeBaseHalfWidthPx;/);
    assert.match(source, /vec2 maskUv = seedScreen \/ screenSize;/);
    assert.match(source, /seedScreenToSnappedWorld\(seedScreen\)/);
    assert.match(source, /bestSeedScreen = seedScreen;/);
    assert.match(source, /uniform vec4 uTint;/);
    assert.match(source, /seedCoverageFromSample/);
    assert.doesNotMatch(source, /sampleSeedCoverageAt/);
    assert.doesNotMatch(source, /float sampleSeedCoverage\(/);
    assert.match(source, /sampleNearestSeedCoverage\(seedUv\)/);
    assert.match(source, /float seedCoverage = sampleNearestSeedCoverage\(seedUv\);/);
    assert.match(source, /seedScreenToWorld\(bestSeedScreen\)/);
    assert.doesNotMatch(source, /if \(bestAlong >= 0\.0\) break;/);
    assert.match(source, /gl_FragDepth\s*=\s*depthForSeedWorld\(seedWorld\)/);
    assert.match(source, /if \(bestAlong <= 0\.5\) discard;/);
    assert.match(source, /float allowedHalfWidth = baseHalfWidth \* \(1\.0 - normalizedAlong\);/);
    assert.match(source, /abs\(side\) > allowedHalfWidth \+ 0\.5/);
    assert.match(source, /float alpha = bestSeedCoverage \* uTint\.a;/);
    assert.doesNotMatch(source, /BLADE_FULL_BRIGHTNESS_FRACTION/);
    assert.doesNotMatch(source, /smoothstep\(BLADE_FULL_BRIGHTNESS_FRACTION/);
    assert.match(source, /float shade = grassShadowShade\(seedWorld\);/);
    assert.match(source, /fragColor\s*=\s*vec4\(uTint\.rgb \* shade \* alpha,\s*alpha\)/);
});

test("grass depth shader shades whole blades from seed shadow state", () => {
    const source = fs.readFileSync(shaderPath, "utf8");
    assert.match(source, /uniform sampler2D uLosDepthTexture;/);
    assert.match(source, /uniform float uLosShadowEnabled;/);
    assert.match(source, /uniform vec2 uLosMapSize;/);
    assert.match(source, /uniform vec2 uLosWrapEnabled;/);
    assert.match(source, /float losShadowCoverageForSeed\(vec2 seedWorld\)/);
    assert.match(source, /wrappedDelta\(uLosWizardWorld\.x,\s*seedWorld\.x,\s*uLosWrapEnabled\.x,\s*uLosMapSize\.x\)/);
    assert.match(source, /unpackLosDepth\(texture\(uLosDepthTexture,\s*depthUv\)\)/);
    assert.match(source, /uniform float uWizardShadowEnabled;/);
    assert.match(source, /float wizardShadowCoverageForSeed\(vec2 seedWorld\)/);
    assert.match(source, /wrappedDelta\(uWizardShadowWorld\.x,\s*seedWorld\.x,\s*uLosWrapEnabled\.x,\s*uLosMapSize\.x\)/);
    assert.match(source, /return dist <= 1\.0 \? clamp\(uWizardShadowOpacity,\s*0\.0,\s*1\.0\) : 0\.0;/);
    assert.match(source, /grassShadowShade\(seedWorld\)/);
});

test("grass depth seed texture is a larger low-repeat one-pixel seed tile", () => {
    const seed = fs.readFileSync(seedPath, "utf8");
    const renderer = fs.readFileSync(rendererPath, "utf8");
    assert.match(seed, /width="640" height="640"/);
    assert.match(seed, /viewBox="0 0 640 640"/);
    assert.match(seed, /fill="#000"/);
    assert.match(seed, /fill="#fff"/);
    assert.match(seed, /width="1" height="1"/);
    assert.doesNotMatch(seed, /width="2" height="2"/);
    const cellMatch = seed.match(/<g id="grass-seed-cell"[\s\S]*?<\/g>/);
    assert.ok(cellMatch, "seed texture should define a reusable seed cell");
    assert.equal((cellMatch[0].match(/<rect /g) || []).length, 64);
    assert.match(renderer, /PRIMARY_SEED_WORLD_SCALE = 0\.0875/);
    assert.match(renderer, /SECONDARY_SEED_SIZE_FACTOR = 1\.37/);
    assert.match(renderer, /SECONDARY_SEED_WORLD_SCALE = PRIMARY_SEED_WORLD_SCALE \/ SECONDARY_SEED_SIZE_FACTOR/);
    assert.match(renderer, /GRASS_DEPTH_LAYER_CONFIGS = \[/);
    assert.match(renderer, /seedWorldScale:\s*PRIMARY_SEED_WORLD_SCALE/);
    assert.match(renderer, /seedWorldScale:\s*SECONDARY_SEED_WORLD_SCALE/);
    assert.match(renderer, /uSeedWorldScale:\s*new Float32Array\(\[PRIMARY_SEED_WORLD_SCALE,\s*PRIMARY_SEED_WORLD_SCALE\]\)/);
    assert.match(renderer, /uMaxBladeHeightPx:\s*22/);
    assert.match(renderer, /uBladeBaseHalfWidthPx:\s*1\.25/);
    assert.match(renderer, /uTint:\s*new Float32Array\(\[0\.2667,\s*0\.4667,\s*0\.1333,\s*1\]\)/);
    assert.match(renderer, /BLADE_HEIGHT_WORLD = 0\.252/);
    assert.match(renderer, /BLADE_BASE_HALF_WIDTH_WORLD = 0\.018/);
    assert.match(renderer, /MAX_BLADE_HEIGHT_PX,\s*Math\.max\(MIN_BLADE_HEIGHT_PX,\s*BLADE_HEIGHT_WORLD \* viewScale\)/);
    assert.match(renderer, /MAX_BLADE_BASE_HALF_WIDTH_PX,\s*Math\.max\(MIN_BLADE_BASE_HALF_WIDTH_PX,\s*BLADE_BASE_HALF_WIDTH_WORLD \* viewScale\)/);
    assert.match(renderer, /uSwayPx:\s*0/);
    assert.match(renderer, /base\.scaleMode = PIXI\.SCALE_MODES\.LINEAR;/);
    assert.match(renderer, /base\.mipmap = PIXI\.MIPMAP_MODES\.OFF;/);
});

test("grass depth renderer creates two texture layers that share mask and depth behavior", () => {
    const renderer = fs.readFileSync(rendererPath, "utf8");
    assert.match(renderer, /this\.meshes = \[\]/);
    assert.match(renderer, /ensureMeshes\(width,\s*height,\s*renderer\)/);
    assert.match(renderer, /GRASS_DEPTH_LAYER_CONFIGS\.map/);
    assert.match(renderer, /mesh\.name = `grassDepthScreenMesh:\$\{layerName\}`;/);
    assert.match(renderer, /uniforms\.uRootMask = rootMask;/);
    assert.match(renderer, /uniforms\.uDepthRange\[0\] = DEPTH_FAR_METRIC;/);
    assert.match(renderer, /uniforms\.uSeedWorldScale\[0\] = seedWorldScale;/);
    assert.match(renderer, /uniforms\.uSeedWorldScale\[1\] = seedWorldScale;/);
    assert.match(renderer, /rendered: meshes\.length/);
    assert.match(renderer, /layers: meshes\.length/);
});

test("grass depth renderer prepares LOS and wizard shadow uniforms", () => {
    const renderer = fs.readFileSync(rendererPath, "utf8");
    assert.match(renderer, /DEFAULT_LOS_SHADOW_FACTOR = 0\.275/);
    assert.match(renderer, /DEFAULT_WIZARD_SHADOW_FACTOR = 0\.275/);
    assert.match(renderer, /WIZARD_SHADOW_CENTER_Y_OFFSET = 0\.18/);
    assert.match(renderer, /WIZARD_SHADOW_RADIUS = 0\.22/);
    assert.match(renderer, /uLosDepthTexture:\s*PIXI\.Texture\.WHITE/);
    assert.match(renderer, /uLosMapSize:\s*new Float32Array\(\[0,\s*0\]\)/);
    assert.match(renderer, /uLosWrapEnabled:\s*new Float32Array\(\[0,\s*0\]\)/);
    assert.match(renderer, /ensureLosDepthTexture\(bins\)/);
    assert.match(renderer, /Math\.round\(normalized \* 65535\)/);
    assert.match(renderer, /base\.update\(\)/);
    assert.match(renderer, /getLosNearRevealRadius/);
    assert.match(renderer, /this\.applyMapWrapUniforms\(uniforms,\s*mapRef\);/);
    assert.match(renderer, /applyShadowUniforms\(rendererAdapter,\s*ctx,\s*uniforms\)/);
});

test("grass depth snaps seed lookup camera to screen pixels", () => {
    const renderer = fs.readFileSync(rendererPath, "utf8");
    assert.match(renderer, /uSeedCameraWorld:\s*new Float32Array\(\[0,\s*0\]\)/);
    assert.match(renderer, /Math\.round\(cameraX \* viewScale\) \/ viewScale/);
    assert.match(renderer, /Math\.round\(cameraY \* viewScale \* xyRatio\) \/ \(viewScale \* xyRatio\)/);
    assert.match(renderer, /uniforms\.uSeedCameraWorld\[0\]\s*=\s*snappedSeedCameraX/);
    assert.match(renderer, /uniforms\.uSeedCameraWorld\[1\]\s*=\s*snappedSeedCameraY/);
});

test("grass depth roots include base grass material and subtract non-grass terrain overlays", () => {
    const context = loadGrassDepthContext();
    const renderer = new context.RenderingGrassDepth.Renderer();
    const entries = renderer.collectGrassMaskEntries([
        {
            key: "fragment:section:0,0:floor:level0-material",
            level: 0,
            texturePath: "/assets/images/terrain/materials/grass.png",
            outer: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }],
            holes: [],
            alpha: 1
        },
        {
            key: "fragment:section:0,0:terrain:water:0",
            level: 0,
            isTerrainPolygon: true,
            terrainType: "water",
            outer: [{ x: 1, y: 1 }, { x: 3, y: 1 }, { x: 3, y: 3 }, { x: 1, y: 3 }],
            holes: [],
            alpha: 1
        }
    ]);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].mode, "add");
    assert.equal(entries[1].mode, "remove");
    assert.equal(renderer.hasAdditiveRoots(entries), true);
});

test("grass depth subtracts road path outline polygons from grass roots", () => {
    const context = loadGrassDepthContext();
    const renderer = new context.RenderingGrassDepth.Renderer();
    const roadPath = {
        type: "roadPath",
        alpha: 1,
        node: { layer: 0 },
        generatedGeometry: {
            outline: [{ x: 1, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 1 }, { x: 1, y: 1 }]
        }
    };
    const adapter = {
        getLayerBaseZForNode(node) {
            return node && node.layer === 1 ? 10 : 0;
        },
        collectRoadPathRenderObjects() {
            return {
                visibleRoadPathObjects: new Set([roadPath]),
                bakedRoadPathObjects: new Set()
            };
        }
    };
    const entries = renderer.collectRoadPathMaskEntries(adapter, {});
    assert.equal(entries.length, 1);
    assert.equal(entries[0].mode, "remove");
    assert.equal(entries[0].outer.length, 4);
    assert.equal(entries[0].baseZ, 0);
});

test("grass depth root mask signature is stable until camera or roots change", () => {
    const context = loadGrassDepthContext();
    const renderer = new context.RenderingGrassDepth.Renderer();
    const entries = renderer.collectGrassMaskEntries([
        {
            key: "fragment:section:0,0:floor:level0-material",
            level: 0,
            texturePath: "/assets/images/terrain/materials/grass.png",
            outer: [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }],
            holes: [],
            alpha: 1,
            baseZ: 0
        }
    ]);
    const adapter = {
        camera: { x: 10, y: 20, z: 0, viewscale: 16, xyratio: 0.66 }
    };
    const first = renderer.buildRootMaskSignature(adapter, entries, 800, 600, 0);
    const second = renderer.buildRootMaskSignature(adapter, entries, 800, 600, 0);
    assert.equal(first, second);
    adapter.camera.x += 1;
    const moved = renderer.buildRootMaskSignature(adapter, entries, 800, 600, 0);
    assert.notEqual(first, moved);
    entries[0].outer[0].x += 1;
    const changedRoots = renderer.buildRootMaskSignature(adapter, entries, 800, 600, 0);
    assert.notEqual(moved, changedRoots);
});

test("game views no longer load the legacy grass depth module", () => {
    for (const view of ["views/hunt.ejs", "views/sectionworld.ejs"]) {
        const source = fs.readFileSync(path.join(ROOT, view), "utf8");
        assert.equal(source.includes("rendering/grassDepth/GrassDepthShaders.js"), false);
        assert.equal(source.includes("rendering/grassDepth/GrassDepthRenderer.js"), false);
    }
});
