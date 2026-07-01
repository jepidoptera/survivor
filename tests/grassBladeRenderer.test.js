const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const shaderPath = path.join(ROOT, "public/assets/javascript/rendering/grassBlades/GrassBladeShaders.js");
const rendererPath = path.join(ROOT, "public/assets/javascript/rendering/grassBlades/GrassBladeRenderer.js");

function loadGrassBladeContext() {
    const context = {
        console: {
            log() {},
            info() {}
        }
    };
    context.globalThis = context;
    context.window = context;
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(shaderPath, "utf8"), context, { filename: "GrassBladeShaders.js" });
    vm.runInContext(fs.readFileSync(rendererPath, "utf8"), context, { filename: "GrassBladeRenderer.js" });
    return context;
}

test("grass blade module installs shader and console toggles", () => {
    const context = loadGrassBladeContext();
    assert.equal(context.renderingGrassBladesEnabled, true);
    assert.equal(context.renderingGrassDepthEnabled, true);
    assert.equal(typeof context.grassBlades, "function");
    assert.equal(context.grassDepth, context.grassBlades);
    assert.equal(context.RenderingGrassBlades.isEnabled(), true);
    assert.equal(context.grassBlades(), false);
    assert.equal(context.RenderingGrassBlades.isEnabled(), false);
    assert.equal(context.grassDepth(true), true);
    assert.equal(context.RenderingGrassBlades.isEnabled(), true);
});

test("grass blade shader masks and shades whole blades by base position", () => {
    const source = fs.readFileSync(shaderPath, "utf8");
    assert.match(source, /in vec2 aBaseWorld;/);
    assert.match(source, /in vec2 aBladeVertex;/);
    assert.match(source, /in vec4 aBladeMeta;/);
    assert.match(source, /in vec2 aSwayMeta;/);
    assert.match(source, /in float aColorShift;/);
    assert.match(source, /vBaseWorld = aBaseWorld;/);
    assert.match(source, /vBaseScreen = baseScreen;/);
    assert.match(source, /vColorShift = clamp\(aColorShift,\s*-0\.2,\s*0\.2\);/);
    assert.match(source, /uniform float uTimeSeconds;/);
    assert.match(source, /uniform float uSwayRadians;/);
    assert.match(source, /float staticTiltRadians = clamp\(aBladeMeta\.w,\s*-0\.2,\s*0\.2\);/);
    assert.match(source, /float swayRadians = sin\(uTimeSeconds \* max\(0\.01,\s*aSwayMeta\.y\) \+ aSwayMeta\.x\) \* uSwayRadians;/);
    assert.match(source, /float tiltRadians = clamp\(staticTiltRadians \+ swayRadians,\s*-0\.35,\s*0\.35\);/);
    assert.match(source, /float tiltOffsetPx = tan\(tiltRadians\) \* bladeHeightPx \* t;/);
    assert.match(source, /float bladeHalfWidthPx = halfWidthPx \* widthScale;/);
    assert.match(source, /aBladeVertex\.x \* bladeHalfWidthPx \+ tiltOffsetPx/);
    assert.match(source, /vec2 maskUv = vBaseScreen \/ screenSize;/);
    assert.match(source, /texture\(uRootMask,\s*maskUv\)\.r/);
    assert.match(source, /gl_FragDepth = depthForBaseWorld\(vBaseWorld\);/);
    assert.match(source, /grassShadowShade\(vBaseWorld\)/);
    assert.match(source, /uniform vec4 uTintLow;/);
    assert.match(source, /float colorT = clamp\(\(vColorShift \+ 0\.2\) \/ 0\.4,\s*0\.0,\s*1\.0\);/);
    assert.match(source, /vec3 variedTint = mix\(uTintLow\.rgb,\s*uTint\.rgb,\s*colorT\);/);
    assert.match(source, /return length\(local\) <= 1\.0 \? clamp\(uWizardShadowOpacity,\s*0\.0,\s*1\.0\) : 0\.0;/);
});

test("grass blade renderer generates deterministic chunk meshes instead of a full-screen scan", () => {
    const source = fs.readFileSync(rendererPath, "utf8");
    assert.match(source, /CHUNK_SIZE_WORLD = 8/);
    assert.match(source, /CHUNK_BUILD_BUDGET_PER_FRAME = 3/);
    assert.match(source, /BLADE_DENSITY_PER_WORLD = 144/);
    assert.match(source, /BLADE_HEIGHT_WORLD = 0\.252/);
    assert.match(source, /BLADE_SWAY_RADIANS = 5 \* Math\.PI \/ 180/);
    assert.match(source, /BLADE_SWAY_MIN_SPEED = 1\.1/);
    assert.match(source, /BLADE_SWAY_MAX_SPEED = 1\.9/);
    assert.match(source, /LARGE_LAYER_SIZE = 1\.37/);
    assert.match(source, /uTimeSeconds: 0/);
    assert.match(source, /uSwayRadians: BLADE_SWAY_RADIANS/);
    assert.match(source, /uTint:\s*new Float32Array\(\[0\.6667,\s*0\.6667,\s*0\.1333,\s*1\]\)/);
    assert.match(source, /uTintLow:\s*new Float32Array\(\[0,\s*0\.4,\s*0,\s*1\]\)/);
    assert.match(source, /densityScale: 1 \/ \(LARGE_LAYER_SIZE \* LARGE_LAYER_SIZE\)/);
    assert.match(source, /buildChunkMesh\(cx,\s*cy,\s*renderer,\s*rootMask,\s*width,\s*height,\s*baseZ\)/);
    assert.match(source, /const vertexCount = bladeCount \* 4;/);
    assert.match(source, /if \(vertexCount > 65535\) throw new Error\(`grass blade chunk has \$\{vertexCount\} vertices, which exceeds Uint16 index capacity`\);/);
    assert.match(source, /const indexCount = bladeCount \* 6;/);
    assert.match(source, /const indices = new Uint16Array\(indexCount\);/);
    assert.doesNotMatch(source, /new Uint32Array\(vertexCount\)/);
    assert.match(source, /const heightScale = \(0\.55 \+ rh \* 0\.8\) \* layer\.size;/);
    assert.match(source, /const widthScale = 0\.65 \+ rw \* 0\.7;/);
    assert.match(source, /const tiltRadians = \(\(rt \* 10\) - 5\) \* \(Math\.PI \/ 180\);/);
    assert.match(source, /const swayPhase = rp \* Math\.PI \* 2;/);
    assert.match(source, /const swaySpeed = BLADE_SWAY_MIN_SPEED \+ rs \* \(BLADE_SWAY_MAX_SPEED - BLADE_SWAY_MIN_SPEED\);/);
    assert.match(source, /const verts = \[-1,\s*0,\s*1,\s*0,\s*-1,\s*1,\s*1,\s*1\];/);
    assert.match(source, /for \(let k = 0; k < 4; k\+\+\)/);
    assert.match(source, /bladeMeta\[mi \+ 3\] = tiltRadians;/);
    assert.match(source, /swayMeta\[bi\] = swayPhase;/);
    assert.match(source, /swayMeta\[bi \+ 1\] = swaySpeed;/);
    assert.match(source, /indices\[ii \+ 5\] = firstVertex \+ 2;/);
    assert.match(source, /const colorShift = new Float32Array\(vertexCount\);/);
    assert.match(source, /colorShift\[v\] = \(rc \* 0\.4\) - 0\.2;/);
    assert.match(source, /\.addAttribute\("aBaseWorld",\s*baseWorld,\s*2\)/);
    assert.match(source, /\.addAttribute\("aBladeVertex",\s*bladeVertex,\s*2\)/);
    assert.match(source, /\.addAttribute\("aBladeMeta",\s*bladeMeta,\s*4\)/);
    assert.match(source, /\.addAttribute\("aSwayMeta",\s*swayMeta,\s*2\)/);
    assert.match(source, /\.addAttribute\("aColorShift",\s*colorShift,\s*1\)/);
    assert.match(source, /uniforms\.uTimeSeconds = currentTimeSeconds\(\);/);
    assert.doesNotMatch(source, /uSeedTexture/);
    assert.doesNotMatch(source, /aScreenPosition/);
});

test("grass blade renderer still subtracts road path outline polygons from grass roots", () => {
    const context = loadGrassBladeContext();
    const renderer = new context.RenderingGrassBlades.Renderer();
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

test("game views load grass blade module before main renderer", () => {
    for (const view of ["views/hunt.ejs", "views/sectionworld.ejs"]) {
        const source = fs.readFileSync(path.join(ROOT, view), "utf8");
        const shaderIndex = source.indexOf("rendering/grassBlades/GrassBladeShaders.js");
        const rendererIndex = source.indexOf("rendering/grassBlades/GrassBladeRenderer.js");
        const mainIndex = source.indexOf("rendering/Rendering.js");
        assert.ok(shaderIndex >= 0, `${view} should load GrassBladeShaders.js`);
        assert.ok(rendererIndex > shaderIndex, `${view} should load GrassBladeRenderer.js after shaders`);
        assert.ok(mainIndex > rendererIndex, `${view} should load Rendering.js after grass blade module`);
    }
});
