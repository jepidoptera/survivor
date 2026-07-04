(function attachGrassBladeRenderer(global) {
    const DEPTH_NEAR_METRIC = -128;
    const DEPTH_FAR_METRIC = 256;
    const ROOT_MASK_CLEAR_COLOR = 0x000000;
    const ROOT_MASK_FILL_COLOR = 0xffffff;
    const ROOT_MASK_ERASE_COLOR = 0x000000;
    const ROOT_MASK_FILL_ALPHA = 1;
    const ROOT_MASK_THRESHOLD = 0.35;
    const GRASS_TERRAIN_TYPE = "grass";
    const CHUNK_SIZE_WORLD = 8;
    const CHUNK_BUILD_BUDGET_PER_FRAME = 3;
    const MAX_CACHED_CHUNKS = 128;
    const BLADE_DENSITY_PER_WORLD = 144;
    const BLADE_HEIGHT_WORLD = 0.252;
    const BLADE_BASE_HALF_WIDTH_WORLD = 0.018;
    const BLADE_SWAY_RADIANS = 5 * Math.PI / 180;
    const BLADE_SWAY_MIN_SPEED = 1.1;
    const BLADE_SWAY_MAX_SPEED = 1.9;
    const PRIMARY_LAYER_SIZE = 1;
    const LARGE_LAYER_SIZE = 1.37;
    const GRASS_BLADE_LAYER_CONFIGS = [
        { name: "primary", size: PRIMARY_LAYER_SIZE, densityScale: 1, salt: 11 },
        { name: "large", size: LARGE_LAYER_SIZE, densityScale: 1 / (LARGE_LAYER_SIZE * LARGE_LAYER_SIZE), salt: 29 }
    ];
    const DEFAULT_LOS_NEAR_REVEAL_RADIUS = 1.0;
    const DEFAULT_LOS_SHADOW_FACTOR = 0.275;
    const DEFAULT_WIZARD_SHADOW_FACTOR = 0.275;
    const WIZARD_SHADOW_CENTER_Y_OFFSET = 0.18;
    const WIZARD_SHADOW_RADIUS = 0.22;

    function isWebgl2Renderer(renderer) {
        const gl = renderer && renderer.gl ? renderer.gl : null;
        if (!gl) return false;
        if (typeof WebGL2RenderingContext !== "undefined" && gl instanceof WebGL2RenderingContext) return true;
        return typeof gl.texImage3D === "function" && typeof gl.drawBuffers === "function";
    }

    function finiteNumber(value, fallback = 0) {
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
    }

    function signatureNumber(value) {
        const n = Number(value);
        if (!Number.isFinite(n)) return "NaN";
        return n.toFixed(4);
    }

    function normalizePointList(points) {
        if (!Array.isArray(points)) return [];
        const out = [];
        for (let i = 0; i < points.length; i++) {
            const point = points[i];
            const x = Number(point && point.x);
            const y = Number(point && point.y);
            if (Number.isFinite(x) && Number.isFinite(y)) out.push({ x, y });
        }
        return out;
    }

    function getScreenSize(rendererAdapter, ctx) {
        if (rendererAdapter && typeof rendererAdapter.getRendererScreenSize === "function") {
            return rendererAdapter.getRendererScreenSize(ctx);
        }
        const appRef = (ctx && ctx.app) || global.app || null;
        const screen = appRef && appRef.screen ? appRef.screen : null;
        return {
            width: Math.max(1, Math.round(Number(screen && screen.width) || 1)),
            height: Math.max(1, Math.round(Number(screen && screen.height) || 1))
        };
    }

    function configurePixelTextureSampling(texture) {
        const base = texture && texture.baseTexture ? texture.baseTexture : null;
        if (!base) return false;
        if (typeof PIXI !== "undefined" && PIXI.SCALE_MODES) base.scaleMode = PIXI.SCALE_MODES.NEAREST;
        if (typeof PIXI !== "undefined" && PIXI.MIPMAP_MODES) {
            base.mipmap = PIXI.MIPMAP_MODES.OFF;
        } else if (Object.prototype.hasOwnProperty.call(base, "mipmap")) {
            base.mipmap = false;
        }
        return true;
    }

    function hashUnit(a, b, c, d) {
        let x = (Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 2246822519) ^ Math.imul(d | 0, 3266489917)) >>> 0;
        x = Math.imul(x ^ (x >>> 15), 2246822519) >>> 0;
        x = Math.imul(x ^ (x >>> 13), 3266489917) >>> 0;
        return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
    }

    function currentTimeSeconds() {
        if (typeof performance !== "undefined" && performance && typeof performance.now === "function") {
            return performance.now() * 0.001;
        }
        return Date.now() * 0.001;
    }

    function isEnabled() {
        return global.renderingGrassBladesEnabled === true;
    }

    function setEnabled(enabled) {
        global.renderingGrassBladesEnabled = !!enabled;
        global.renderingGrassDepthEnabled = global.renderingGrassBladesEnabled;
        return global.renderingGrassBladesEnabled;
    }

    function installConsoleCommand() {
        const command = function grassBlades(enabled) {
            const next = arguments.length === 0 ? !isEnabled() : !!enabled;
            setEnabled(next);
            console.log(`grass blades ${next ? "enabled" : "disabled"}`);
            return next;
        };
        command._renderingGrassBladesCommand = true;
        global.grassBlades = command;
        global.grassDepth = command;
    }

    class GrassBladeRenderer {
        constructor() {
            this.container = null;
            this.state = null;
            this.rootMaskTexture = null;
            this.rootMaskGraphics = null;
            this.rootMaskSizeKey = "";
            this.rootMaskSignature = "";
            this.chunks = new Map();
            this.losDepthCanvas = null;
            this.losDepthContext = null;
            this.losDepthImageData = null;
            this.losDepthTexture = null;
            this.losDepthBins = 0;
            this.frameId = 0;
        }

        ensurePixiAvailable() {
            if (typeof PIXI === "undefined") throw new Error("grass blade rendering requires PIXI");
            if (!PIXI.Geometry || !PIXI.Mesh || !PIXI.Shader || !PIXI.RenderTexture || !PIXI.Graphics) {
                throw new Error("grass blade rendering requires PIXI Geometry, Mesh, Shader, RenderTexture, and Graphics");
            }
        }

        ensureContainer(rendererAdapter) {
            const parent = rendererAdapter && rendererAdapter.layers && rendererAdapter.layers.depthObjects
                ? rendererAdapter.layers.depthObjects
                : null;
            if (!parent) throw new Error("grass blade rendering requires the depthObjects render layer");
            if (!this.container) {
                this.container = new PIXI.Container();
                this.container.name = "renderingGrassBladeEffect";
                this.container.interactiveChildren = false;
            }
            if (this.container.parent !== parent) parent.addChild(this.container);
            return this.container;
        }

        ensureState() {
            if (this.state) return this.state;
            if (!PIXI.State) throw new Error("grass blade rendering requires PIXI.State");
            const state = new PIXI.State();
            state.depthTest = true;
            state.depthMask = true;
            state.blend = true;
            state.culling = false;
            this.state = state;
            return state;
        }

        ensureRootMaskTexture(width, height) {
            const sizeKey = `${width}x${height}`;
            if (this.rootMaskTexture && this.rootMaskSizeKey === sizeKey) return this.rootMaskTexture;
            if (this.rootMaskTexture && typeof this.rootMaskTexture.destroy === "function") this.rootMaskTexture.destroy(true);
            this.rootMaskTexture = PIXI.RenderTexture.create({ width, height, resolution: 1 });
            this.rootMaskSizeKey = sizeKey;
            this.rootMaskSignature = "";
            return this.rootMaskTexture;
        }

        ensureRootMaskGraphics() {
            if (this.rootMaskGraphics) return this.rootMaskGraphics;
            this.rootMaskGraphics = new PIXI.Graphics();
            this.rootMaskGraphics.name = "grassBladeRootMaskGraphics";
            this.rootMaskGraphics.interactive = false;
            return this.rootMaskGraphics;
        }

        isBaseGrassVisualEntry(entry) {
            if (!entry || entry.isHoleOverlay === true) return false;
            if (entry.isTerrainPolygon === true) return false;
            if (entry.terrainType) return false;
            if (Number.isFinite(entry.level) && Math.round(Number(entry.level)) !== 0) return false;
            const texturePath = typeof entry.texturePath === "string" ? entry.texturePath : "";
            if (/\/assets\/images\/terrain\/materials\/grass\.png(?:$|[?#])/i.test(texturePath)) return true;
            return /:level0-material$/.test(String(entry.key || ""));
        }

        collectGrassMaskEntries(entries) {
            if (!Array.isArray(entries)) return [];
            const out = [];
            for (let i = 0; i < entries.length; i++) {
                const entry = entries[i];
                if (!entry) continue;
                const addRoots = entry.isTerrainPolygon === true
                    ? entry.terrainType === GRASS_TERRAIN_TYPE
                    : this.isBaseGrassVisualEntry(entry);
                const removeRoots = entry.isTerrainPolygon === true && entry.terrainType !== GRASS_TERRAIN_TYPE;
                if (!addRoots && !removeRoots) continue;
                const outer = normalizePointList(entry.outer);
                if (outer.length < 3) continue;
                if (Number.isFinite(entry.alpha) && Number(entry.alpha) <= 0) continue;
                out.push({
                    source: entry,
                    mode: addRoots ? "add" : "remove",
                    outer,
                    holes: Array.isArray(entry.holes)
                        ? entry.holes.map(normalizePointList).filter((hole) => hole.length >= 3)
                        : [],
                    baseZ: Number.isFinite(entry.baseZ) ? Number(entry.baseZ) : 0
                });
            }
            return out;
        }

        roadPathOutlinePoints(roadPath) {
            const geometry = roadPath && roadPath.generatedGeometry ? roadPath.generatedGeometry : null;
            const outline = geometry && Array.isArray(geometry.outline)
                ? geometry.outline
                : (Array.isArray(roadPath && roadPath.outlinePolygon) ? roadPath.outlinePolygon : []);
            return normalizePointList(outline);
        }

        roadPathBaseZ(roadPath, rendererAdapter) {
            if (rendererAdapter && typeof rendererAdapter.getLayerBaseZForNode === "function") {
                const node = roadPath && typeof roadPath.getNode === "function"
                    ? roadPath.getNode()
                    : (roadPath && roadPath.node ? roadPath.node : roadPath);
                return finiteNumber(rendererAdapter.getLayerBaseZForNode(node), 0);
            }
            if (Number.isFinite(roadPath && roadPath.baseZ)) return Number(roadPath.baseZ);
            return 0;
        }

        collectRoadPathMaskEntries(rendererAdapter, ctx) {
            const out = [];
            const addRoadPath = (roadPath) => {
                if (!roadPath || roadPath.gone || roadPath.type !== "roadPath") return;
                const outer = this.roadPathOutlinePoints(roadPath);
                if (outer.length < 3) return;
                if (Number.isFinite(roadPath.alpha) && Number(roadPath.alpha) <= 0) return;
                out.push({
                    source: roadPath,
                    mode: "remove",
                    outer,
                    holes: [],
                    baseZ: this.roadPathBaseZ(roadPath, rendererAdapter)
                });
            };
            if (rendererAdapter && typeof rendererAdapter.collectRoadPathRenderObjects === "function") {
                const bakedKeys = rendererAdapter && typeof rendererAdapter.getBakedLevel0SectionKeys === "function"
                    ? rendererAdapter.getBakedLevel0SectionKeys(ctx)
                    : null;
                const roadPathObjects = rendererAdapter.collectRoadPathRenderObjects(ctx, bakedKeys);
                const sets = [
                    roadPathObjects && roadPathObjects.visibleRoadPathObjects,
                    roadPathObjects && roadPathObjects.bakedRoadPathObjects
                ];
                for (let s = 0; s < sets.length; s++) {
                    const set = sets[s];
                    if (!set || typeof set.forEach !== "function") continue;
                    set.forEach(addRoadPath);
                }
            }
            return out;
        }

        resolveBaseZ(maskEntries, rendererAdapter) {
            if (!maskEntries.length) {
                return rendererAdapter && typeof rendererAdapter.getLayerBaseZForLevel === "function"
                    ? rendererAdapter.getLayerBaseZForLevel(0)
                    : 0;
            }
            const baseZ = maskEntries[0].baseZ;
            for (let i = 1; i < maskEntries.length; i++) {
                if (Math.abs(maskEntries[i].baseZ - baseZ) > 0.000001) {
                    throw new Error("grass blade rendering currently requires all grass roots in a pass to share one baseZ");
                }
            }
            return baseZ;
        }

        drawScreenRing(graphics, rendererAdapter, ring, baseZ) {
            const camera = rendererAdapter && rendererAdapter.camera ? rendererAdapter.camera : null;
            if (!camera || typeof camera.worldToScreen !== "function") {
                throw new Error("grass blade root mask requires RenderingCamera.worldToScreen");
            }
            const flat = [];
            for (let i = 0; i < ring.length; i++) {
                const pt = ring[i];
                const screen = camera.worldToScreen(pt.x, pt.y, baseZ);
                if (!screen || !Number.isFinite(screen.x) || !Number.isFinite(screen.y)) {
                    throw new Error("grass blade root mask received a non-finite projected polygon point");
                }
                flat.push(screen.x, screen.y);
            }
            graphics.drawPolygon(flat);
        }

        rootMaskEntrySignature(entry) {
            if (!entry) return "";
            const parts = [
                entry.mode === "remove" ? "remove" : "add",
                signatureNumber(entry.baseZ),
                Array.isArray(entry.outer)
                    ? entry.outer.map(point => `${signatureNumber(point.x)},${signatureNumber(point.y)}`).join(";")
                    : ""
            ];
            const holes = Array.isArray(entry.holes) ? entry.holes : [];
            if (holes.length > 0) {
                parts.push(holes.map(hole => (
                    Array.isArray(hole)
                        ? hole.map(point => `${signatureNumber(point.x)},${signatureNumber(point.y)}`).join(";")
                        : ""
                )).join("/"));
            }
            return parts.join("|");
        }

        buildRootMaskSignature(rendererAdapter, maskEntries, width, height, baseZ) {
            const camera = rendererAdapter && rendererAdapter.camera ? rendererAdapter.camera : null;
            if (!camera) throw new Error("grass blade root mask signature requires a rendering camera");
            return [
                `${Math.max(1, Math.round(width))}x${Math.max(1, Math.round(height))}`,
                signatureNumber(camera.x),
                signatureNumber(camera.y),
                signatureNumber(camera.z),
                signatureNumber(camera.viewscale),
                signatureNumber(camera.xyratio),
                signatureNumber(baseZ),
                maskEntries.map(entry => this.rootMaskEntrySignature(entry)).join("~")
            ].join("::");
        }

        updateRootMask(rendererAdapter, ctx, maskEntries, width, height, baseZ) {
            const appRef = (ctx && ctx.app) || global.app || null;
            const renderer = appRef && appRef.renderer ? appRef.renderer : null;
            if (!renderer || typeof renderer.render !== "function") throw new Error("grass blade root mask requires an app renderer");
            const texture = this.ensureRootMaskTexture(width, height);
            const signature = this.buildRootMaskSignature(rendererAdapter, maskEntries, width, height, baseZ);
            if (this.rootMaskSignature === signature) return { texture, rebuilt: false, maskMs: 0 };
            const perfNow = (typeof performance !== "undefined" && performance && typeof performance.now === "function")
                ? performance.now.bind(performance)
                : null;
            const startMs = perfNow ? perfNow() : 0;
            const graphics = this.ensureRootMaskGraphics();
            graphics.clear();
            graphics.beginFill(ROOT_MASK_CLEAR_COLOR, 0);
            graphics.drawRect(0, 0, width, height);
            graphics.endFill();
            const canDrawHoles = typeof graphics.beginHole === "function" && typeof graphics.endHole === "function";
            const drawEntries = (mode, color) => {
                graphics.beginFill(color, ROOT_MASK_FILL_ALPHA);
                for (let i = 0; i < maskEntries.length; i++) {
                    const entry = maskEntries[i];
                    if (!entry || entry.mode !== mode) continue;
                    this.drawScreenRing(graphics, rendererAdapter, entry.outer, baseZ);
                    if (entry.holes.length > 0) {
                        if (!canDrawHoles) throw new Error("grass blade root mask requires PIXI.Graphics beginHole/endHole for holed grass polygons");
                        for (let h = 0; h < entry.holes.length; h++) {
                            graphics.beginHole();
                            this.drawScreenRing(graphics, rendererAdapter, entry.holes[h], baseZ);
                            graphics.endHole();
                        }
                    }
                }
                graphics.endFill();
            };
            drawEntries("add", ROOT_MASK_FILL_COLOR);
            drawEntries("remove", ROOT_MASK_ERASE_COLOR);
            renderer.render(graphics, texture, true);
            this.rootMaskSignature = signature;
            return { texture, rebuilt: true, maskMs: perfNow ? (perfNow() - startMs) : 0 };
        }

        hasAdditiveRoots(maskEntries) {
            for (let i = 0; i < maskEntries.length; i++) {
                if (maskEntries[i] && maskEntries[i].mode === "add") return true;
            }
            return false;
        }

        createChunkUniforms(rootMask, width, height, baseZ) {
            return {
                uRootMask: rootMask || PIXI.Texture.WHITE,
                uLosDepthTexture: PIXI.Texture.WHITE,
                uScreenSize: new Float32Array([width, height]),
                uCameraWorld: new Float32Array([0, 0]),
                uCameraZ: 0,
                uBaseZ: baseZ,
                uDepthBias: 0.006,
                uViewScale: 1,
                uXyRatio: 1,
                uBladeHeightWorld: BLADE_HEIGHT_WORLD,
                uBladeBaseHalfWidthWorld: BLADE_BASE_HALF_WIDTH_WORLD,
                uTimeSeconds: 0,
                uSwayRadians: BLADE_SWAY_RADIANS,
                uDepthRange: new Float32Array([
                    DEPTH_FAR_METRIC,
                    1 / Math.max(1e-6, DEPTH_FAR_METRIC - DEPTH_NEAR_METRIC)
                ]),
                uTint: new Float32Array([0.6667, 0.6667, 0.1333, 1]),
                uTintLow: new Float32Array([0, 0.4, 0, 1]),
                uRootMaskThreshold: ROOT_MASK_THRESHOLD,
                uAlphaCutoff: 0.02,
                uMapSize: new Float32Array([0, 0]),
                uWrapEnabled: new Float32Array([0, 0]),
                uLosShadowEnabled: 0,
                uLosWizardWorld: new Float32Array([0, 0]),
                uLosDepthBins: 0,
                uLosMinAngle: -Math.PI,
                uLosFarDistance: 1,
                uLosHasForwardFov: 0,
                uLosFacingAngle: 0,
                uLosHalfFovRad: Math.PI,
                uLosNearRevealRadius: DEFAULT_LOS_NEAR_REVEAL_RADIUS,
                uLosShadowOpacity: 0,
                uLosShadowFactor: DEFAULT_LOS_SHADOW_FACTOR,
                uWizardShadowEnabled: 0,
                uWizardShadowWorld: new Float32Array([0, 0]),
                uWizardShadowRadius: new Float32Array([WIZARD_SHADOW_RADIUS, WIZARD_SHADOW_RADIUS]),
                uWizardShadowOpacity: 0,
                uWizardShadowFactor: DEFAULT_WIZARD_SHADOW_FACTOR
            };
        }

        bladesForLayer(layerConfig) {
            const count = CHUNK_SIZE_WORLD * CHUNK_SIZE_WORLD * BLADE_DENSITY_PER_WORLD * layerConfig.densityScale;
            return Math.max(1, Math.round(count));
        }

        buildChunkMesh(cx, cy, renderer, rootMask, width, height, baseZ) {
            const shaders = global.RenderingGrassBladeShaders;
            if (!shaders || !shaders.vertexWebgl2 || !shaders.fragmentWebgl2) {
                throw new Error("grass blade rendering requires RenderingGrassBladeShaders");
            }
            if (!isWebgl2Renderer(renderer)) throw new Error("grass blade rendering requires WebGL2 for gl_FragDepth");
            let bladeCount = 0;
            for (let l = 0; l < GRASS_BLADE_LAYER_CONFIGS.length; l++) bladeCount += this.bladesForLayer(GRASS_BLADE_LAYER_CONFIGS[l]);
            const vertexCount = bladeCount * 4;
            if (vertexCount > 65535) throw new Error(`grass blade chunk has ${vertexCount} vertices, which exceeds Uint16 index capacity`);
            const indexCount = bladeCount * 6;
            const baseWorld = new Float32Array(vertexCount * 2);
            const bladeVertex = new Float32Array(vertexCount * 2);
            const bladeMeta = new Float32Array(vertexCount * 4);
            const swayMeta = new Float32Array(vertexCount * 2);
            const colorShift = new Float32Array(vertexCount);
            const indices = new Uint16Array(indexCount);
            let v = 0;
            let ii = 0;
            for (let l = 0; l < GRASS_BLADE_LAYER_CONFIGS.length; l++) {
                const layer = GRASS_BLADE_LAYER_CONFIGS[l];
                const count = this.bladesForLayer(layer);
                for (let i = 0; i < count; i++) {
                    const rx = hashUnit(cx, cy, i, layer.salt);
                    const ry = hashUnit(cx, cy, i, layer.salt + 1);
                    const rh = hashUnit(cx, cy, i, layer.salt + 2);
                    const rw = hashUnit(cx, cy, i, layer.salt + 3);
                    const ra = hashUnit(cx, cy, i, layer.salt + 4);
                    const rt = hashUnit(cx, cy, i, layer.salt + 5);
                    const rc = hashUnit(cx, cy, i, layer.salt + 6);
                    const rp = hashUnit(cx, cy, i, layer.salt + 7);
                    const rs = hashUnit(cx, cy, i, layer.salt + 8);
                    const x = (cx * CHUNK_SIZE_WORLD) + rx * CHUNK_SIZE_WORLD;
                    const y = (cy * CHUNK_SIZE_WORLD) + ry * CHUNK_SIZE_WORLD;
                    const heightScale = (0.55 + rh * 0.8) * layer.size;
                    const widthScale = 0.65 + rw * 0.7;
                    const alpha = 0.78 + ra * 0.2;
                    const tiltRadians = ((rt * 10) - 5) * (Math.PI / 180);
                    const swayPhase = rp * Math.PI * 2;
                    const swaySpeed = BLADE_SWAY_MIN_SPEED + rs * (BLADE_SWAY_MAX_SPEED - BLADE_SWAY_MIN_SPEED);
                    const firstVertex = v;
                    const verts = [-1, 0, 1, 0, -1, 1, 1, 1];
                    for (let k = 0; k < 4; k++) {
                        const bi = v * 2;
                        const mi = v * 4;
                        baseWorld[bi] = x;
                        baseWorld[bi + 1] = y;
                        bladeVertex[bi] = verts[k * 2];
                        bladeVertex[bi + 1] = verts[k * 2 + 1];
                        bladeMeta[mi] = heightScale;
                        bladeMeta[mi + 1] = widthScale;
                        bladeMeta[mi + 2] = alpha;
                        bladeMeta[mi + 3] = tiltRadians;
                        swayMeta[bi] = swayPhase;
                        swayMeta[bi + 1] = swaySpeed;
                        colorShift[v] = (rc * 0.4) - 0.2;
                        v += 1;
                    }
                    indices[ii] = firstVertex;
                    indices[ii + 1] = firstVertex + 1;
                    indices[ii + 2] = firstVertex + 2;
                    indices[ii + 3] = firstVertex + 1;
                    indices[ii + 4] = firstVertex + 3;
                    indices[ii + 5] = firstVertex + 2;
                    ii += 6;
                }
            }
            const geometry = new PIXI.Geometry()
                .addAttribute("aBaseWorld", baseWorld, 2)
                .addAttribute("aBladeVertex", bladeVertex, 2)
                .addAttribute("aBladeMeta", bladeMeta, 4)
                .addAttribute("aSwayMeta", swayMeta, 2)
                .addAttribute("aColorShift", colorShift, 1)
                .addIndex(indices);
            const shader = PIXI.Shader.from(shaders.vertexWebgl2, shaders.fragmentWebgl2, this.createChunkUniforms(rootMask, width, height, baseZ));
            const mesh = new PIXI.Mesh(geometry, shader, this.ensureState(), PIXI.DRAW_MODES.TRIANGLES);
            mesh.name = `grassBladeChunk:${cx},${cy}`;
            mesh.interactive = false;
            mesh.visible = false;
            return { cx, cy, mesh, bladeCount, lastSeenFrame: this.frameId };
        }

        visibleChunkKeys(camera, width, height) {
            const viewScale = Math.max(0.0001, finiteNumber(camera && camera.viewscale, 1));
            const xyRatio = Math.max(0.0001, finiteNumber(camera && camera.xyratio, 1));
            const left = finiteNumber(camera && camera.x, 0) - CHUNK_SIZE_WORLD;
            const top = finiteNumber(camera && camera.y, 0) - CHUNK_SIZE_WORLD;
            const right = finiteNumber(camera && camera.x, 0) + (width / viewScale) + CHUNK_SIZE_WORLD;
            const bottom = finiteNumber(camera && camera.y, 0) + (height / (viewScale * xyRatio)) + CHUNK_SIZE_WORLD;
            const minCx = Math.floor(left / CHUNK_SIZE_WORLD);
            const maxCx = Math.floor(right / CHUNK_SIZE_WORLD);
            const minCy = Math.floor(top / CHUNK_SIZE_WORLD);
            const maxCy = Math.floor(bottom / CHUNK_SIZE_WORLD);
            const keys = [];
            for (let cy = minCy; cy <= maxCy; cy++) {
                for (let cx = minCx; cx <= maxCx; cx++) keys.push({ key: `${cx},${cy}`, cx, cy });
            }
            return keys;
        }

        hide() {
            this.chunks.forEach((chunk) => {
                if (chunk && chunk.mesh) chunk.mesh.visible = false;
            });
            if (this.container) this.container.visible = false;
        }

        destroyChunk(key) {
            const chunk = this.chunks.get(key);
            if (!chunk) return;
            const mesh = chunk.mesh;
            if (mesh && mesh.parent) mesh.parent.removeChild(mesh);
            if (mesh && typeof mesh.destroy === "function") mesh.destroy({ children: false, texture: false, baseTexture: false });
            this.chunks.delete(key);
        }

        pruneChunks(visibleKeySet) {
            if (this.chunks.size <= MAX_CACHED_CHUNKS) return;
            const entries = Array.from(this.chunks.entries()).sort((a, b) => a[1].lastSeenFrame - b[1].lastSeenFrame);
            for (let i = 0; i < entries.length && this.chunks.size > MAX_CACHED_CHUNKS; i++) {
                if (visibleKeySet && visibleKeySet.has(entries[i][0])) continue;
                this.destroyChunk(entries[i][0]);
            }
        }

        createTinyCanvas(width, height, label) {
            if (typeof document !== "undefined" && document && typeof document.createElement === "function") {
                const canvas = document.createElement("canvas");
                canvas.width = width;
                canvas.height = height;
                return canvas;
            }
            if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
            throw new Error(`grass blade ${label} texture requires Canvas or OffscreenCanvas`);
        }

        ensureLosDepthTexture(bins) {
            const nextBins = Math.max(3, Math.floor(Number(bins) || 0));
            if (this.losDepthTexture && this.losDepthBins === nextBins) return this.losDepthTexture;
            if (this.losDepthTexture && typeof this.losDepthTexture.destroy === "function") this.losDepthTexture.destroy(true);
            this.losDepthCanvas = this.createTinyCanvas(nextBins, 1, "LOS depth");
            this.losDepthContext = this.losDepthCanvas.getContext("2d");
            if (!this.losDepthContext || typeof this.losDepthContext.createImageData !== "function") {
                throw new Error("grass blade LOS shadow texture requires a 2D canvas context");
            }
            this.losDepthImageData = this.losDepthContext.createImageData(nextBins, 1);
            this.losDepthTexture = PIXI.Texture.from(this.losDepthCanvas);
            configurePixelTextureSampling(this.losDepthTexture);
            this.losDepthBins = nextBins;
            return this.losDepthTexture;
        }

        updateLosDepthTexture(depth, bins, farDistance) {
            const texture = this.ensureLosDepthTexture(bins);
            const data = this.losDepthImageData && this.losDepthImageData.data ? this.losDepthImageData.data : null;
            if (!data) throw new Error("grass blade LOS shadow texture is missing image data");
            const maxDistance = Math.max(0.0001, finiteNumber(farDistance, 1));
            for (let i = 0; i < this.losDepthBins; i++) {
                const rawDepth = Number(depth && depth[i]);
                const normalized = Number.isFinite(rawDepth) ? Math.max(0, Math.min(1, rawDepth / maxDistance)) : 1;
                const packed = Math.round(normalized * 65535);
                const offset = i * 4;
                data[offset] = (packed >> 8) & 0xff;
                data[offset + 1] = packed & 0xff;
                data[offset + 2] = 0;
                data[offset + 3] = 255;
            }
            this.losDepthContext.putImageData(this.losDepthImageData, 0, 0);
            const base = texture && texture.baseTexture ? texture.baseTexture : null;
            if (base && typeof base.update === "function") base.update();
            else if (texture && typeof texture.update === "function") texture.update();
            else throw new Error("grass blade LOS shadow texture cannot be updated");
            return texture;
        }

        resolveWizard(ctx) {
            return (ctx && ctx.wizard) || global.wizard || null;
        }

        resolveWizardRenderPosition(ctx, wizard) {
            if (!wizard) return null;
            const alpha = Number.isFinite(ctx && ctx.renderAlpha) ? Math.max(0, Math.min(1, Number(ctx.renderAlpha))) : 1;
            if (typeof wizard.getInterpolatedPosition === "function") {
                const pos = wizard.getInterpolatedPosition(alpha);
                if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) return pos;
            }
            return { x: finiteNumber(wizard.x, 0), y: finiteNumber(wizard.y, 0), z: finiteNumber(wizard.z, 0) };
        }

        resolveMapForShadow(rendererAdapter, ctx, wizard) {
            return (ctx && ctx.map) ||
                (wizard && wizard.map) ||
                (rendererAdapter && rendererAdapter.camera && rendererAdapter.camera.map) ||
                global.map ||
                null;
        }

        mapWrapState(mapRef) {
            const worldWidth = mapRef && Number.isFinite(mapRef.worldWidth) ? Number(mapRef.worldWidth) : 0;
            const worldHeight = mapRef && Number.isFinite(mapRef.worldHeight) ? Number(mapRef.worldHeight) : 0;
            return {
                mapSize: [worldWidth > 0 ? worldWidth : 0, worldHeight > 0 ? worldHeight : 0],
                wrapEnabled: [
                    mapRef && mapRef.wrapX === true && worldWidth > 0 ? 1 : 0,
                    mapRef && mapRef.wrapY === true && worldHeight > 0 ? 1 : 0
                ]
            };
        }

        prepareShadowState(rendererAdapter, ctx) {
            const wizard = this.resolveWizard(ctx);
            const mapRef = this.resolveMapForShadow(rendererAdapter, ctx, wizard);
            const wrap = this.mapWrapState(mapRef);
            const state = rendererAdapter && rendererAdapter.currentLosState ? rendererAdapter.currentLosState : null;
            const shadowEnabled = rendererAdapter && typeof rendererAdapter.getLosVisualSetting === "function"
                ? !!rendererAdapter.getLosVisualSetting("shadowEnabled", true)
                : true;
            const omnivisionActive = rendererAdapter && typeof rendererAdapter.isOmnivisionActive === "function"
                ? !!rendererAdapter.isOmnivisionActive(wizard)
                : false;
            const mazeMode = rendererAdapter && typeof rendererAdapter.isLosMazeModeEnabled === "function" &&
                rendererAdapter.isLosMazeModeEnabled() && !omnivisionActive;
            const rawOpacity = rendererAdapter && typeof rendererAdapter.getLosVisualSetting === "function"
                ? Number(rendererAdapter.getLosVisualSetting("shadowOpacity", 0.4))
                : 0.4;
            const shadowOpacity = mazeMode ? 1 : (Number.isFinite(rawOpacity) ? Math.max(0, Math.min(1, rawOpacity)) : 0.4);
            const bins = Math.floor(Number(state && state.bins) || 0);
            const depth = state && state.depth ? state.depth : null;
            const viewportRef = (ctx && ctx.viewport) || null;
            const viewportW = viewportRef && Number.isFinite(viewportRef.width) ? Number(viewportRef.width) : 24;
            const viewportH = viewportRef && Number.isFinite(viewportRef.height) ? Number(viewportRef.height) : 24;
            const farDist = Math.max(1, Math.max(viewportW, viewportH) * 1.5);
            const losEnabled = !(omnivisionActive || !shadowEnabled || shadowOpacity <= 0 || !wizard || !depth || bins < 3 || depth.length !== bins);
            const renderPos = this.resolveWizardRenderPosition(ctx, wizard);
            const inWater = wizard && wizard.currentWaterSurface && wizard.currentWaterSurface.inWater === true;
            const gone = wizard && (wizard.gone === true || wizard.dead === true);
            const wizardShadowEnabled = !!(wizard && renderPos && !gone && !inWater);
            const invisibilityActive = rendererAdapter && typeof rendererAdapter.isInvisibilityActive === "function"
                ? !!rendererAdapter.isInvisibilityActive(wizard)
                : false;
            return {
                mapSize: wrap.mapSize,
                wrapEnabled: wrap.wrapEnabled,
                losEnabled: losEnabled ? 1 : 0,
                losDepthTexture: losEnabled ? this.updateLosDepthTexture(depth, bins, farDist) : PIXI.Texture.WHITE,
                losWizardWorld: [finiteNumber(wizard && wizard.x, 0), finiteNumber(wizard && wizard.y, 0)],
                losDepthBins: losEnabled ? bins : 0,
                losMinAngle: Number.isFinite(state && state.minAngle) ? Number(state.minAngle) : -Math.PI,
                losFarDistance: farDist,
                losHasForwardFov: state && state.hasForwardFov ? 1 : 0,
                losFacingAngle: Number.isFinite(state && state.facingAngle) ? Number(state.facingAngle) : 0,
                losHalfFovRad: Number.isFinite(state && state.halfFovRad) ? Number(state.halfFovRad) : Math.PI,
                losNearRevealRadius: rendererAdapter && typeof rendererAdapter.getLosNearRevealRadius === "function"
                    ? Math.max(0, finiteNumber(rendererAdapter.getLosNearRevealRadius(), DEFAULT_LOS_NEAR_REVEAL_RADIUS))
                    : DEFAULT_LOS_NEAR_REVEAL_RADIUS,
                losShadowOpacity: losEnabled ? shadowOpacity : 0,
                wizardShadowEnabled: wizardShadowEnabled ? 1 : 0,
                wizardShadowWorld: [
                    finiteNumber(renderPos && renderPos.x, 0),
                    finiteNumber(renderPos && renderPos.y, 0) + WIZARD_SHADOW_CENTER_Y_OFFSET
                ],
                wizardShadowOpacity: wizardShadowEnabled ? (invisibilityActive ? 0.25 : 1) : 0
            };
        }

        applyFrameUniforms(uniforms, rootMask, width, height, baseZ, camera, shadowState) {
            uniforms.uRootMask = rootMask;
            uniforms.uScreenSize[0] = width;
            uniforms.uScreenSize[1] = height;
            uniforms.uCameraWorld[0] = finiteNumber(camera && camera.x, 0);
            uniforms.uCameraWorld[1] = finiteNumber(camera && camera.y, 0);
            uniforms.uCameraZ = finiteNumber(camera && camera.z, 0);
            uniforms.uBaseZ = finiteNumber(baseZ, 0);
            uniforms.uDepthBias = 0.006;
            uniforms.uViewScale = Math.max(0.0001, finiteNumber(camera && camera.viewscale, 1));
            uniforms.uXyRatio = Math.max(0.0001, finiteNumber(camera && camera.xyratio, 1));
            uniforms.uBladeHeightWorld = BLADE_HEIGHT_WORLD;
            uniforms.uBladeBaseHalfWidthWorld = BLADE_BASE_HALF_WIDTH_WORLD;
            uniforms.uTimeSeconds = currentTimeSeconds();
            uniforms.uSwayRadians = BLADE_SWAY_RADIANS;
            uniforms.uDepthRange[0] = DEPTH_FAR_METRIC;
            uniforms.uDepthRange[1] = 1 / Math.max(1e-6, DEPTH_FAR_METRIC - DEPTH_NEAR_METRIC);
            uniforms.uMapSize[0] = shadowState.mapSize[0];
            uniforms.uMapSize[1] = shadowState.mapSize[1];
            uniforms.uWrapEnabled[0] = shadowState.wrapEnabled[0];
            uniforms.uWrapEnabled[1] = shadowState.wrapEnabled[1];
            uniforms.uLosDepthTexture = shadowState.losDepthTexture;
            uniforms.uLosShadowEnabled = shadowState.losEnabled;
            uniforms.uLosWizardWorld[0] = shadowState.losWizardWorld[0];
            uniforms.uLosWizardWorld[1] = shadowState.losWizardWorld[1];
            uniforms.uLosDepthBins = shadowState.losDepthBins;
            uniforms.uLosMinAngle = shadowState.losMinAngle;
            uniforms.uLosFarDistance = shadowState.losFarDistance;
            uniforms.uLosHasForwardFov = shadowState.losHasForwardFov;
            uniforms.uLosFacingAngle = shadowState.losFacingAngle;
            uniforms.uLosHalfFovRad = shadowState.losHalfFovRad;
            uniforms.uLosNearRevealRadius = shadowState.losNearRevealRadius;
            uniforms.uLosShadowOpacity = shadowState.losShadowOpacity;
            uniforms.uLosShadowFactor = DEFAULT_LOS_SHADOW_FACTOR;
            uniforms.uWizardShadowEnabled = shadowState.wizardShadowEnabled;
            uniforms.uWizardShadowWorld[0] = shadowState.wizardShadowWorld[0];
            uniforms.uWizardShadowWorld[1] = shadowState.wizardShadowWorld[1];
            uniforms.uWizardShadowRadius[0] = WIZARD_SHADOW_RADIUS;
            uniforms.uWizardShadowRadius[1] = WIZARD_SHADOW_RADIUS;
            uniforms.uWizardShadowOpacity = shadowState.wizardShadowOpacity;
            uniforms.uWizardShadowFactor = DEFAULT_WIZARD_SHADOW_FACTOR;
        }

        render(rendererAdapter, ctx, entries) {
            if (!isEnabled()) {
                this.hide();
                return { rendered: 0, enabled: false };
            }
            this.ensurePixiAvailable();
            const appRef = (ctx && ctx.app) || global.app || null;
            const renderer = appRef && appRef.renderer ? appRef.renderer : null;
            if (!renderer) throw new Error("grass blade rendering requires an app renderer");
            const maskEntries = this.collectGrassMaskEntries(entries);
            if (maskEntries.length === 0 || !this.hasAdditiveRoots(maskEntries)) {
                this.hide();
                return { rendered: 0, enabled: true };
            }
            const size = getScreenSize(rendererAdapter, ctx);
            const width = Math.max(1, Math.round(size.width));
            const height = Math.max(1, Math.round(size.height));
            const baseZ = this.resolveBaseZ(maskEntries, rendererAdapter);
            const roadPathMaskEntries = this.collectRoadPathMaskEntries(rendererAdapter, ctx)
                .filter((entry) => entry && Math.abs(finiteNumber(entry.baseZ, 0) - baseZ) <= 0.000001);
            for (let i = 0; i < roadPathMaskEntries.length; i++) maskEntries.push(roadPathMaskEntries[i]);
            const rootMaskResult = this.updateRootMask(rendererAdapter, ctx, maskEntries, width, height, baseZ);
            const rootMask = rootMaskResult && rootMaskResult.texture ? rootMaskResult.texture : null;
            if (!rootMask) throw new Error("grass blade root mask update did not return a texture");
            const container = this.ensureContainer(rendererAdapter);
            container.visible = true;
            const camera = rendererAdapter && rendererAdapter.camera ? rendererAdapter.camera : {};
            const visible = this.visibleChunkKeys(camera, width, height);
            const visibleKeySet = new Set(visible.map(item => item.key));
            this.chunks.forEach((chunk, key) => {
                if (chunk && chunk.mesh) chunk.mesh.visible = false;
                if (visibleKeySet.has(key)) chunk.lastSeenFrame = this.frameId;
            });
            let built = 0;
            for (let i = 0; i < visible.length && built < CHUNK_BUILD_BUDGET_PER_FRAME; i++) {
                const item = visible[i];
                if (this.chunks.has(item.key)) continue;
                const chunk = this.buildChunkMesh(item.cx, item.cy, renderer, rootMask, width, height, baseZ);
                this.chunks.set(item.key, chunk);
                built += 1;
            }
            const shadowState = this.prepareShadowState(rendererAdapter, ctx);
            let visibleChunks = 0;
            let visibleBlades = 0;
            this.chunks.forEach((chunk, key) => {
                if (!visibleKeySet.has(key) || !chunk || !chunk.mesh) return;
                if (chunk.mesh.parent !== container) container.addChild(chunk.mesh);
                const uniforms = chunk.mesh.shader && chunk.mesh.shader.uniforms ? chunk.mesh.shader.uniforms : null;
                if (!uniforms) throw new Error("grass blade chunk mesh is missing shader uniforms");
                this.applyFrameUniforms(uniforms, rootMask, width, height, baseZ, camera, shadowState);
                chunk.mesh.visible = true;
                chunk.lastSeenFrame = this.frameId;
                visibleChunks += 1;
                visibleBlades += chunk.bladeCount || 0;
            });
            this.pruneChunks(visibleKeySet);
            this.frameId += 1;
            return {
                rendered: visibleChunks > 0 ? 1 : 0,
                enabled: true,
                roots: maskEntries.filter(entry => entry && entry.mode === "add").length,
                layers: GRASS_BLADE_LAYER_CONFIGS.length,
                chunks: visibleChunks,
                chunksBuilt: built,
                chunksPending: Math.max(0, visible.length - visibleChunks),
                blades: visibleBlades,
                maskRebuilt: rootMaskResult.rebuilt === true ? 1 : 0,
                maskMs: Number.isFinite(rootMaskResult.maskMs) ? Number(rootMaskResult.maskMs) : 0,
                losShadow: shadowState.losEnabled,
                wizardShadow: shadowState.wizardShadowEnabled
            };
        }
    }

    if (typeof global.renderingGrassBladesEnabled !== "boolean") {
        global.renderingGrassBladesEnabled = true;
    }
    global.renderingGrassDepthEnabled = global.renderingGrassBladesEnabled;
    installConsoleCommand();

    global.RenderingGrassBlades = {
        Renderer: GrassBladeRenderer,
        isEnabled,
        setEnabled,
        installConsoleCommand,
        isWebgl2Renderer
    };
})(typeof globalThis !== "undefined" ? globalThis : window);
