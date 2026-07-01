(function attachGrassDepthRenderer(global) {
    const DEFAULT_SEED_TEXTURE_PATH = "/assets/javascript/rendering/grassDepth/grass-seed.svg";
    const DEPTH_NEAR_METRIC = -128;
    const DEPTH_FAR_METRIC = 256;
    const ROOT_MASK_CLEAR_COLOR = 0x000000;
    const ROOT_MASK_FILL_COLOR = 0xffffff;
    const ROOT_MASK_ERASE_COLOR = 0x000000;
    const ROOT_MASK_FILL_ALPHA = 1;
    const ROOT_MASK_THRESHOLD = 0.35;
    const GRASS_TERRAIN_TYPE = "grass";
    const BLADE_HEIGHT_WORLD = 0.252;
    const BLADE_BASE_HALF_WIDTH_WORLD = 0.018;
    const MIN_BLADE_HEIGHT_PX = 12;
    const MAX_BLADE_HEIGHT_PX = 72;
    const MIN_BLADE_BASE_HALF_WIDTH_PX = 1;
    const MAX_BLADE_BASE_HALF_WIDTH_PX = 6;
    const PRIMARY_SEED_WORLD_SCALE = 0.0875;
    const SECONDARY_SEED_SIZE_FACTOR = 1.37;
    const SECONDARY_SEED_WORLD_SCALE = PRIMARY_SEED_WORLD_SCALE / SECONDARY_SEED_SIZE_FACTOR;
    const GRASS_DEPTH_LAYER_CONFIGS = [
        { name: "primary", seedWorldScale: PRIMARY_SEED_WORLD_SCALE },
        { name: "large", seedWorldScale: SECONDARY_SEED_WORLD_SCALE }
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

    function getScreenSize(rendererAdapter, ctx) {
        if (
            rendererAdapter &&
            typeof rendererAdapter.getRendererScreenSize === "function"
        ) {
            return rendererAdapter.getRendererScreenSize(ctx);
        }
        const appRef = (ctx && ctx.app) || global.app || null;
        const screen = appRef && appRef.screen ? appRef.screen : null;
        const width = Math.max(1, Math.round(Number(screen && screen.width) || 1));
        const height = Math.max(1, Math.round(Number(screen && screen.height) || 1));
        return { width, height };
    }

    function configureSeedTextureSampling(texture) {
        const base = texture && texture.baseTexture ? texture.baseTexture : null;
        if (!base) return false;
        if (typeof PIXI !== "undefined" && PIXI.SCALE_MODES) {
            base.scaleMode = PIXI.SCALE_MODES.LINEAR;
        }
        if (typeof PIXI !== "undefined" && PIXI.MIPMAP_MODES) {
            base.mipmap = PIXI.MIPMAP_MODES.OFF;
        } else if (Object.prototype.hasOwnProperty.call(base, "mipmap")) {
            base.mipmap = false;
        }
        return true;
    }

    function configurePixelTextureSampling(texture) {
        const base = texture && texture.baseTexture ? texture.baseTexture : null;
        if (!base) return false;
        if (typeof PIXI !== "undefined" && PIXI.SCALE_MODES) {
            base.scaleMode = PIXI.SCALE_MODES.NEAREST;
        }
        if (typeof PIXI !== "undefined" && PIXI.MIPMAP_MODES) {
            base.mipmap = PIXI.MIPMAP_MODES.OFF;
        } else if (Object.prototype.hasOwnProperty.call(base, "mipmap")) {
            base.mipmap = false;
        }
        if (typeof PIXI !== "undefined" && PIXI.WRAP_MODES && Object.prototype.hasOwnProperty.call(PIXI.WRAP_MODES, "CLAMP")) {
            base.wrapMode = PIXI.WRAP_MODES.CLAMP;
        }
        return true;
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

    function isEnabled() {
        return global.renderingGrassDepthEnabled === true;
    }

    function setEnabled(enabled) {
        global.renderingGrassDepthEnabled = !!enabled;
        return global.renderingGrassDepthEnabled;
    }

    function installConsoleCommand() {
        if (typeof global.grassDepth === "function" && global.grassDepth._renderingGrassDepthCommand === true) {
            return;
        }
        const command = function grassDepth(enabled) {
            const next = arguments.length === 0 ? !isEnabled() : !!enabled;
            setEnabled(next);
            console.log(`grass depth ${next ? "enabled" : "disabled"}`);
            return next;
        };
        command._renderingGrassDepthCommand = true;
        global.grassDepth = command;
    }

    class GrassDepthRenderer {
        constructor() {
            this.container = null;
            this.mesh = null;
            this.meshes = [];
            this.geometry = null;
            this.rootMaskTexture = null;
            this.rootMaskSizeKey = "";
            this.rootMaskSignature = "";
            this.rootMaskGraphics = null;
            this.seedTexture = null;
            this.seedTextureFailed = false;
            this.seedTextureFailureMessage = "";
            this.losDepthCanvas = null;
            this.losDepthContext = null;
            this.losDepthImageData = null;
            this.losDepthTexture = null;
            this.losDepthBins = 0;
            this.state = null;
            this.lastScreenGeometryKey = "";
            this.loggedSeedPending = false;
        }

        ensurePixiAvailable() {
            if (typeof PIXI === "undefined") {
                throw new Error("grass depth rendering requires PIXI");
            }
            if (!PIXI.Geometry || !PIXI.Mesh || !PIXI.Shader || !PIXI.RenderTexture || !PIXI.Graphics) {
                throw new Error("grass depth rendering requires PIXI Geometry, Mesh, Shader, RenderTexture, and Graphics");
            }
        }

        ensureContainer(rendererAdapter) {
            const parent = rendererAdapter && rendererAdapter.layers && rendererAdapter.layers.depthObjects
                ? rendererAdapter.layers.depthObjects
                : null;
            if (!parent) {
                throw new Error("grass depth rendering requires the depthObjects render layer");
            }
            if (!this.container) {
                this.container = new PIXI.Container();
                this.container.name = "renderingGrassDepthEffect";
                this.container.interactiveChildren = false;
            }
            if (this.container.parent !== parent) {
                parent.addChild(this.container);
            }
            return this.container;
        }

        ensureState() {
            if (this.state) return this.state;
            if (!PIXI.State) {
                throw new Error("grass depth rendering requires PIXI.State");
            }
            const state = new PIXI.State();
            state.depthTest = true;
            state.depthMask = true;
            state.blend = true;
            state.culling = false;
            this.state = state;
            return state;
        }

        ensureSeedTexture() {
            if (this.seedTextureFailed) {
                throw new Error(this.seedTextureFailureMessage || "grass depth seed texture failed to load");
            }
            if (this.seedTexture) return this.seedTexture;
            if (!PIXI.Texture || typeof PIXI.Texture.from !== "function") {
                throw new Error("grass depth rendering requires PIXI.Texture.from");
            }
            const texture = PIXI.Texture.from(DEFAULT_SEED_TEXTURE_PATH);
            configureSeedTextureSampling(texture);
            this.seedTexture = texture;
            const base = texture && texture.baseTexture ? texture.baseTexture : null;
            if (base && typeof base.once === "function") {
                base.once("error", (err) => {
                    this.seedTextureFailed = true;
                    this.seedTextureFailureMessage = `grass depth seed texture failed to load: ${err && err.message ? err.message : DEFAULT_SEED_TEXTURE_PATH}`;
                });
                base.once("loaded", () => {
                    configureSeedTextureSampling(texture);
                });
            }
            return texture;
        }

        seedTextureReady(texture) {
            const base = texture && texture.baseTexture ? texture.baseTexture : null;
            return !!(base && base.valid);
        }

        ensureRootMaskTexture(width, height) {
            const sizeKey = `${width}x${height}`;
            if (this.rootMaskTexture && this.rootMaskSizeKey === sizeKey) return this.rootMaskTexture;
            if (this.rootMaskTexture && typeof this.rootMaskTexture.destroy === "function") {
                this.rootMaskTexture.destroy(true);
            }
            this.rootMaskTexture = PIXI.RenderTexture.create({
                width,
                height,
                resolution: 1
            });
            this.rootMaskSizeKey = sizeKey;
            this.rootMaskSignature = "";
            return this.rootMaskTexture;
        }

        ensureRootMaskGraphics() {
            if (this.rootMaskGraphics) return this.rootMaskGraphics;
            this.rootMaskGraphics = new PIXI.Graphics();
            this.rootMaskGraphics.name = "grassDepthRootMaskGraphics";
            this.rootMaskGraphics.interactive = false;
            return this.rootMaskGraphics;
        }

        createMeshUniforms(width, height) {
            return {
                uRootMask: PIXI.Texture.WHITE,
                uSeedTexture: PIXI.Texture.WHITE,
                uScreenSize: new Float32Array([width, height]),
                uCameraWorld: new Float32Array([0, 0]),
                uSeedCameraWorld: new Float32Array([0, 0]),
                uCameraZ: 0,
                uBaseZ: 0,
                uDepthBias: 0.006,
                uViewScale: 1,
                uXyRatio: 1,
                uDepthRange: new Float32Array([
                    DEPTH_FAR_METRIC,
                    1 / Math.max(1e-6, DEPTH_FAR_METRIC - DEPTH_NEAR_METRIC)
                ]),
                uSeedWorldScale: new Float32Array([PRIMARY_SEED_WORLD_SCALE, PRIMARY_SEED_WORLD_SCALE]),
                uMaxBladeHeightPx: 22,
                uStepPx: 1,
                uTimeSeconds: 0,
                uSwayPx: 0,
                uBladeBaseHalfWidthPx: 1.25,
                uRootMaskThreshold: ROOT_MASK_THRESHOLD,
                uAlphaCutoff: 0.02,
                uTint: new Float32Array([0.2667, 0.4667, 0.1333, 1]),
                uLosDepthTexture: PIXI.Texture.WHITE,
                uLosShadowEnabled: 0,
                uLosWizardWorld: new Float32Array([0, 0]),
                uLosMapSize: new Float32Array([0, 0]),
                uLosWrapEnabled: new Float32Array([0, 0]),
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

        createScreenMesh(width, height, renderer, layerConfig, layerIndex) {
            const shaders = global.RenderingGrassDepthShaders;
            if (!shaders || !shaders.vertexWebgl2 || !shaders.fragmentWebgl2) {
                throw new Error("grass depth rendering requires RenderingGrassDepthShaders");
            }
            if (!isWebgl2Renderer(renderer)) {
                throw new Error("grass depth rendering requires WebGL2 for gl_FragDepth");
            }
            const positions = new Float32Array([
                0, 0,
                width, 0,
                width, height,
                0, height
            ]);
            const geometry = new PIXI.Geometry()
                .addAttribute("aScreenPosition", positions, 2)
                .addIndex(new Uint16Array([0, 1, 2, 0, 2, 3]));
            const shader = PIXI.Shader.from(shaders.vertexWebgl2, shaders.fragmentWebgl2, this.createMeshUniforms(width, height));
            const mesh = new PIXI.Mesh(geometry, shader, this.ensureState(), PIXI.DRAW_MODES.TRIANGLES);
            const layerName = layerConfig && layerConfig.name ? layerConfig.name : String(layerIndex);
            mesh.name = `grassDepthScreenMesh:${layerName}`;
            mesh.interactive = false;
            mesh.visible = false;
            return mesh;
        }

        destroyMeshes() {
            if (!Array.isArray(this.meshes)) this.meshes = [];
            for (let i = 0; i < this.meshes.length; i++) {
                const mesh = this.meshes[i];
                if (!mesh || typeof mesh.destroy !== "function") continue;
                if (mesh.parent) mesh.parent.removeChild(mesh);
                mesh.destroy({ children: false, texture: false, baseTexture: false });
            }
            this.meshes = [];
            this.mesh = null;
            this.geometry = null;
        }

        ensureMeshes(width, height, renderer) {
            const geometryKey = `${width}x${height}x${GRASS_DEPTH_LAYER_CONFIGS.length}`;
            if (
                Array.isArray(this.meshes) &&
                this.meshes.length === GRASS_DEPTH_LAYER_CONFIGS.length &&
                this.lastScreenGeometryKey === geometryKey
            ) {
                return this.meshes;
            }
            this.destroyMeshes();
            this.meshes = GRASS_DEPTH_LAYER_CONFIGS.map((layerConfig, layerIndex) => (
                this.createScreenMesh(width, height, renderer, layerConfig, layerIndex)
            ));
            this.mesh = this.meshes[0] || null;
            this.geometry = this.mesh && this.mesh.geometry ? this.mesh.geometry : null;
            this.lastScreenGeometryKey = geometryKey;
            return this.meshes;
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
                return out;
            }
            const map = ctx && ctx.map ? ctx.map : null;
            const seen = new Set();
            const visit = (roadPath) => {
                if (!roadPath || seen.has(roadPath)) return;
                seen.add(roadPath);
                addRoadPath(roadPath);
            };
            const objectState = map && map._prototypeObjectState ? map._prototypeObjectState : null;
            if (objectState && objectState.activeRuntimeObjectsByRecordId instanceof Map) {
                objectState.activeRuntimeObjectsByRecordId.forEach(visit);
            }
            if (map && Array.isArray(map.objects)) {
                for (let i = 0; i < map.objects.length; i++) visit(map.objects[i]);
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
                    throw new Error("grass depth rendering currently requires all grass roots in a pass to share one baseZ");
                }
            }
            return baseZ;
        }

        drawScreenRing(graphics, rendererAdapter, ring, baseZ) {
            const camera = rendererAdapter && rendererAdapter.camera ? rendererAdapter.camera : null;
            if (!camera || typeof camera.worldToScreen !== "function") {
                throw new Error("grass depth root mask requires RenderingCamera.worldToScreen");
            }
            const flat = [];
            for (let i = 0; i < ring.length; i++) {
                const pt = ring[i];
                const screen = camera.worldToScreen(pt.x, pt.y, baseZ);
                if (
                    !screen ||
                    !Number.isFinite(screen.x) ||
                    !Number.isFinite(screen.y)
                ) {
                    throw new Error("grass depth root mask received a non-finite projected polygon point");
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
            if (!camera) {
                throw new Error("grass depth root mask signature requires a rendering camera");
            }
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
            if (!renderer || typeof renderer.render !== "function") {
                throw new Error("grass depth root mask requires an app renderer");
            }
            const texture = this.ensureRootMaskTexture(width, height);
            const signature = this.buildRootMaskSignature(rendererAdapter, maskEntries, width, height, baseZ);
            if (this.rootMaskSignature === signature) {
                return { texture, rebuilt: false, maskMs: 0 };
            }
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
                        if (!canDrawHoles) {
                            throw new Error("grass depth root mask requires PIXI.Graphics beginHole/endHole for holed grass polygons");
                        }
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
            return {
                texture,
                rebuilt: true,
                maskMs: perfNow ? (perfNow() - startMs) : 0
            };
        }

        hasAdditiveRoots(maskEntries) {
            for (let i = 0; i < maskEntries.length; i++) {
                if (maskEntries[i] && maskEntries[i].mode === "add") return true;
            }
            return false;
        }

        hide() {
            if (this.mesh) this.mesh.visible = false;
            if (Array.isArray(this.meshes)) {
                for (let i = 0; i < this.meshes.length; i++) {
                    if (this.meshes[i]) this.meshes[i].visible = false;
                }
            }
            if (this.container) this.container.visible = false;
        }

        createTinyCanvas(width, height, label) {
            if (typeof document !== "undefined" && document && typeof document.createElement === "function") {
                const canvas = document.createElement("canvas");
                canvas.width = width;
                canvas.height = height;
                return canvas;
            }
            if (typeof OffscreenCanvas !== "undefined") {
                return new OffscreenCanvas(width, height);
            }
            throw new Error(`grass depth ${label} texture requires Canvas or OffscreenCanvas`);
        }

        ensureLosDepthTexture(bins) {
            const nextBins = Math.max(3, Math.floor(Number(bins) || 0));
            if (this.losDepthTexture && this.losDepthBins === nextBins) return this.losDepthTexture;
            if (this.losDepthTexture && typeof this.losDepthTexture.destroy === "function") {
                this.losDepthTexture.destroy(true);
            }
            this.losDepthCanvas = this.createTinyCanvas(nextBins, 1, "LOS depth");
            this.losDepthContext = this.losDepthCanvas.getContext("2d");
            if (!this.losDepthContext || typeof this.losDepthContext.createImageData !== "function") {
                throw new Error("grass depth LOS shadow texture requires a 2D canvas context");
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
            if (!data) {
                throw new Error("grass depth LOS shadow texture is missing image data");
            }
            const maxDistance = Math.max(0.0001, finiteNumber(farDistance, 1));
            for (let i = 0; i < this.losDepthBins; i++) {
                const rawDepth = Number(depth && depth[i]);
                const normalized = Number.isFinite(rawDepth)
                    ? Math.max(0, Math.min(1, rawDepth / maxDistance))
                    : 1;
                const packed = Math.round(normalized * 65535);
                const offset = i * 4;
                data[offset] = (packed >> 8) & 0xff;
                data[offset + 1] = packed & 0xff;
                data[offset + 2] = 0;
                data[offset + 3] = 255;
            }
            this.losDepthContext.putImageData(this.losDepthImageData, 0, 0);
            const base = texture && texture.baseTexture ? texture.baseTexture : null;
            if (base && typeof base.update === "function") {
                base.update();
            } else if (texture && typeof texture.update === "function") {
                texture.update();
            } else {
                throw new Error("grass depth LOS shadow texture cannot be updated");
            }
            return texture;
        }

        resolveWizard(ctx) {
            return (ctx && ctx.wizard) || global.wizard || null;
        }

        resolveWizardRenderPosition(ctx, wizard) {
            if (!wizard) return null;
            const alpha = Number.isFinite(ctx && ctx.renderAlpha)
                ? Math.max(0, Math.min(1, Number(ctx.renderAlpha)))
                : 1;
            if (typeof wizard.getInterpolatedPosition === "function") {
                const pos = wizard.getInterpolatedPosition(alpha);
                if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) return pos;
            }
            return {
                x: finiteNumber(wizard.x, 0),
                y: finiteNumber(wizard.y, 0),
                z: finiteNumber(wizard.z, 0)
            };
        }

        resolveMapForShadow(rendererAdapter, ctx, wizard) {
            return (ctx && ctx.map) ||
                (wizard && wizard.map) ||
                (rendererAdapter && rendererAdapter.camera && rendererAdapter.camera.map) ||
                global.map ||
                null;
        }

        applyMapWrapUniforms(uniforms, mapRef) {
            const worldWidth = mapRef && Number.isFinite(mapRef.worldWidth) ? Number(mapRef.worldWidth) : 0;
            const worldHeight = mapRef && Number.isFinite(mapRef.worldHeight) ? Number(mapRef.worldHeight) : 0;
            uniforms.uLosMapSize[0] = worldWidth > 0 ? worldWidth : 0;
            uniforms.uLosMapSize[1] = worldHeight > 0 ? worldHeight : 0;
            uniforms.uLosWrapEnabled[0] = mapRef && mapRef.wrapX === true && worldWidth > 0 ? 1 : 0;
            uniforms.uLosWrapEnabled[1] = mapRef && mapRef.wrapY === true && worldHeight > 0 ? 1 : 0;
        }

        applyLosShadowUniforms(rendererAdapter, ctx, uniforms) {
            const wizard = this.resolveWizard(ctx);
            const state = rendererAdapter && rendererAdapter.currentLosState ? rendererAdapter.currentLosState : null;
            const shadowEnabled = rendererAdapter && typeof rendererAdapter.getLosVisualSetting === "function"
                ? !!rendererAdapter.getLosVisualSetting("shadowEnabled", true)
                : true;
            const omnivisionActive = rendererAdapter && typeof rendererAdapter.isOmnivisionActive === "function"
                ? !!rendererAdapter.isOmnivisionActive(wizard)
                : false;
            const mazeMode = rendererAdapter &&
                typeof rendererAdapter.isLosMazeModeEnabled === "function" &&
                rendererAdapter.isLosMazeModeEnabled() &&
                !omnivisionActive;
            const rawOpacity = rendererAdapter && typeof rendererAdapter.getLosVisualSetting === "function"
                ? Number(rendererAdapter.getLosVisualSetting("shadowOpacity", 0.4))
                : 0.4;
            const shadowOpacity = mazeMode
                ? 1
                : (Number.isFinite(rawOpacity) ? Math.max(0, Math.min(1, rawOpacity)) : 0.4);
            const bins = Math.floor(Number(state && state.bins) || 0);
            const depth = state && state.depth ? state.depth : null;
            if (omnivisionActive || !shadowEnabled || shadowOpacity <= 0 || !wizard || !depth || bins < 3 || depth.length !== bins) {
                uniforms.uLosShadowEnabled = 0;
                uniforms.uLosShadowOpacity = 0;
                return 0;
            }

            const viewportRef = (ctx && ctx.viewport) || null;
            const viewportW = viewportRef && Number.isFinite(viewportRef.width) ? Number(viewportRef.width) : 24;
            const viewportH = viewportRef && Number.isFinite(viewportRef.height) ? Number(viewportRef.height) : 24;
            const farDist = Math.max(1, Math.max(viewportW, viewportH) * 1.5);
            const texture = this.updateLosDepthTexture(depth, bins, farDist);
            const mapRef = this.resolveMapForShadow(rendererAdapter, ctx, wizard);
            this.applyMapWrapUniforms(uniforms, mapRef);
            uniforms.uLosDepthTexture = texture;
            uniforms.uLosShadowEnabled = 1;
            uniforms.uLosWizardWorld[0] = finiteNumber(wizard.x, 0);
            uniforms.uLosWizardWorld[1] = finiteNumber(wizard.y, 0);
            uniforms.uLosDepthBins = bins;
            uniforms.uLosMinAngle = Number.isFinite(state.minAngle) ? Number(state.minAngle) : -Math.PI;
            uniforms.uLosFarDistance = farDist;
            uniforms.uLosHasForwardFov = state.hasForwardFov ? 1 : 0;
            uniforms.uLosFacingAngle = Number.isFinite(state.facingAngle) ? Number(state.facingAngle) : 0;
            uniforms.uLosHalfFovRad = Number.isFinite(state.halfFovRad) ? Number(state.halfFovRad) : Math.PI;
            uniforms.uLosNearRevealRadius = rendererAdapter && typeof rendererAdapter.getLosNearRevealRadius === "function"
                ? Math.max(0, finiteNumber(rendererAdapter.getLosNearRevealRadius(), DEFAULT_LOS_NEAR_REVEAL_RADIUS))
                : DEFAULT_LOS_NEAR_REVEAL_RADIUS;
            uniforms.uLosShadowOpacity = shadowOpacity;
            uniforms.uLosShadowFactor = DEFAULT_LOS_SHADOW_FACTOR;
            return 1;
        }

        applyWizardShadowUniforms(rendererAdapter, ctx, uniforms) {
            const wizard = this.resolveWizard(ctx);
            const renderPos = this.resolveWizardRenderPosition(ctx, wizard);
            if (!wizard || !renderPos) {
                uniforms.uWizardShadowEnabled = 0;
                uniforms.uWizardShadowOpacity = 0;
                return 0;
            }
            const inWater = wizard && wizard.currentWaterSurface && wizard.currentWaterSurface.inWater === true;
            const gone = wizard.gone === true || wizard.dead === true;
            if (gone || inWater) {
                uniforms.uWizardShadowEnabled = 0;
                uniforms.uWizardShadowOpacity = 0;
                return 0;
            }
            const invisibilityActive = rendererAdapter && typeof rendererAdapter.isInvisibilityActive === "function"
                ? !!rendererAdapter.isInvisibilityActive(wizard)
                : false;
            uniforms.uWizardShadowEnabled = 1;
            uniforms.uWizardShadowWorld[0] = finiteNumber(renderPos.x, 0);
            uniforms.uWizardShadowWorld[1] = finiteNumber(renderPos.y, 0) + WIZARD_SHADOW_CENTER_Y_OFFSET;
            uniforms.uWizardShadowRadius[0] = WIZARD_SHADOW_RADIUS;
            uniforms.uWizardShadowRadius[1] = WIZARD_SHADOW_RADIUS;
            uniforms.uWizardShadowOpacity = invisibilityActive ? 0.25 : 1;
            uniforms.uWizardShadowFactor = DEFAULT_WIZARD_SHADOW_FACTOR;
            return 1;
        }

        applyShadowUniforms(rendererAdapter, ctx, uniforms) {
            const wizard = this.resolveWizard(ctx);
            const mapRef = this.resolveMapForShadow(rendererAdapter, ctx, wizard);
            this.applyMapWrapUniforms(uniforms, mapRef);
            const losEnabled = this.applyLosShadowUniforms(rendererAdapter, ctx, uniforms);
            const wizardEnabled = this.applyWizardShadowUniforms(rendererAdapter, ctx, uniforms);
            return { losEnabled, wizardEnabled };
        }

        render(rendererAdapter, ctx, entries) {
            if (!isEnabled()) {
                this.hide();
                return { rendered: 0, enabled: false };
            }
            this.ensurePixiAvailable();
            const appRef = (ctx && ctx.app) || global.app || null;
            const renderer = appRef && appRef.renderer ? appRef.renderer : null;
            if (!renderer) {
                throw new Error("grass depth rendering requires an app renderer");
            }
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
            for (let i = 0; i < roadPathMaskEntries.length; i++) {
                maskEntries.push(roadPathMaskEntries[i]);
            }
            const seedTexture = this.ensureSeedTexture();
            if (!this.seedTextureReady(seedTexture)) {
                if (!this.loggedSeedPending) {
                    console.info("grass depth seed texture is loading", DEFAULT_SEED_TEXTURE_PATH);
                    this.loggedSeedPending = true;
                }
                this.hide();
                return { rendered: 0, enabled: true, loading: true };
            }

            const rootMaskResult = this.updateRootMask(rendererAdapter, ctx, maskEntries, width, height, baseZ);
            const rootMask = rootMaskResult && rootMaskResult.texture ? rootMaskResult.texture : null;
            if (!rootMask) {
                throw new Error("grass depth root mask update did not return a texture");
            }
            const container = this.ensureContainer(rendererAdapter);
            const meshes = this.ensureMeshes(width, height, renderer);
            if (!Array.isArray(meshes) || meshes.length !== GRASS_DEPTH_LAYER_CONFIGS.length) {
                throw new Error("grass depth renderer failed to create all grass texture layers");
            }
            for (let i = 0; i < meshes.length; i++) {
                const mesh = meshes[i];
                if (mesh && mesh.parent !== container) container.addChild(mesh);
            }
            container.visible = true;

            const cam = rendererAdapter && rendererAdapter.camera ? rendererAdapter.camera : {};
            const cameraX = finiteNumber(cam.x, 0);
            const cameraY = finiteNumber(cam.y, 0);
            const viewScale = Math.max(0.0001, finiteNumber(cam.viewscale, 1));
            const xyRatio = Math.max(0.0001, finiteNumber(cam.xyratio, 1));
            const snappedSeedCameraX = Math.round(cameraX * viewScale) / viewScale;
            const snappedSeedCameraY = Math.round(cameraY * viewScale * xyRatio) / (viewScale * xyRatio);
            const bladeHeightPx = Math.min(
                MAX_BLADE_HEIGHT_PX,
                Math.max(MIN_BLADE_HEIGHT_PX, BLADE_HEIGHT_WORLD * viewScale)
            );
            const bladeBaseHalfWidthPx = Math.min(
                MAX_BLADE_BASE_HALF_WIDTH_PX,
                Math.max(MIN_BLADE_BASE_HALF_WIDTH_PX, BLADE_BASE_HALF_WIDTH_WORLD * viewScale)
            );
            const timeSeconds = ((ctx && Number.isFinite(ctx.renderNowMs)) ? Number(ctx.renderNowMs) : Date.now()) * 0.001;
            let losShadow = 0;
            let wizardShadow = 0;
            for (let i = 0; i < meshes.length; i++) {
                const mesh = meshes[i];
                if (!mesh) continue;
                mesh.visible = true;
                const shader = mesh.shader || null;
                const uniforms = shader && shader.uniforms ? shader.uniforms : null;
                if (!uniforms) {
                    throw new Error("grass depth rendering mesh is missing shader uniforms");
                }
                const layerConfig = GRASS_DEPTH_LAYER_CONFIGS[i] || GRASS_DEPTH_LAYER_CONFIGS[0];
                const seedWorldScale = finiteNumber(layerConfig && layerConfig.seedWorldScale, PRIMARY_SEED_WORLD_SCALE);
                uniforms.uRootMask = rootMask;
                uniforms.uSeedTexture = seedTexture;
                uniforms.uScreenSize[0] = width;
                uniforms.uScreenSize[1] = height;
                uniforms.uCameraWorld[0] = cameraX;
                uniforms.uCameraWorld[1] = cameraY;
                uniforms.uSeedCameraWorld[0] = snappedSeedCameraX;
                uniforms.uSeedCameraWorld[1] = snappedSeedCameraY;
                uniforms.uCameraZ = finiteNumber(cam.z, 0);
                uniforms.uBaseZ = finiteNumber(baseZ, 0);
                uniforms.uDepthBias = 0.006;
                uniforms.uViewScale = viewScale;
                uniforms.uXyRatio = xyRatio;
                uniforms.uDepthRange[0] = DEPTH_FAR_METRIC;
                uniforms.uDepthRange[1] = 1 / Math.max(1e-6, DEPTH_FAR_METRIC - DEPTH_NEAR_METRIC);
                uniforms.uSeedWorldScale[0] = seedWorldScale;
                uniforms.uSeedWorldScale[1] = seedWorldScale;
                uniforms.uMaxBladeHeightPx = bladeHeightPx;
                uniforms.uBladeBaseHalfWidthPx = bladeBaseHalfWidthPx;
                uniforms.uTimeSeconds = timeSeconds;
                const shadowState = this.applyShadowUniforms(rendererAdapter, ctx, uniforms);
                losShadow = Math.max(losShadow, Number(shadowState && shadowState.losEnabled) || 0);
                wizardShadow = Math.max(wizardShadow, Number(shadowState && shadowState.wizardEnabled) || 0);
            }
            return {
                rendered: meshes.length,
                enabled: true,
                roots: maskEntries.filter(entry => entry && entry.mode === "add").length,
                layers: meshes.length,
                maskRebuilt: rootMaskResult.rebuilt === true ? 1 : 0,
                maskMs: Number.isFinite(rootMaskResult.maskMs) ? Number(rootMaskResult.maskMs) : 0,
                losShadow,
                wizardShadow
            };
        }
    }

    if (typeof global.renderingGrassDepthEnabled !== "boolean") {
        global.renderingGrassDepthEnabled = true;
    }
    installConsoleCommand();

    global.RenderingGrassDepth = {
        Renderer: GrassDepthRenderer,
        isEnabled,
        setEnabled,
        installConsoleCommand,
        isWebgl2Renderer
    };
})(typeof globalThis !== "undefined" ? globalThis : window);
