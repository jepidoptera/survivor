(function attachRendering(global) {
    const GROUND_TILE_OVERLAP_SCALE = 1.5;
    const GROUND_TILE_CACHE_LIMIT = 6000;
    const GROUND_TILE_TRIM_CHUNK_SIZE = 250;
    const GROUND_TILE_POOL_LIMIT = 1024;
    const TREE_ALPHA_CUTOFF = 0.08;
    const LOS_NEAR_REVEAL_RADIUS = 1.0;
    const LOS_THROTTLE_MS = 33;
    const LOS_BINS = 3600;
    const MAZE_MODE_ACTIVATION_SKIP_REVEAL_MS = 700;
    if (typeof global.renderingShowPickerScreen !== "boolean") {
        global.renderingShowPickerScreen = false;
    }

    function getShowPickerScreenFlag() {
        return !!global.renderingShowPickerScreen;
    }

    function setShowPickerScreenFlag(enabled) {
        const next = !!enabled;
        global.renderingShowPickerScreen = next;
        return next;
    }

    // Keep expensive renderer diagnostics available for triage, but leave them
    // off in normal gameplay. Re-enable only when chasing invalid PIXI textures
    // or ground tile lifetime bugs.
    function ensureRenderingDiagnosticsConfig() {
        const defaults = {
            textureSanitizer: false,
            pixiSpriteCrashDiagnostics: false,
            roadTextureLifecycleDiagnostics: false,
            groundTileProfiling: false,
            drawPassBreakdown: true,
            scenePickerHoverProfiling: false
        };
        if (!global.renderingDiagnostics || typeof global.renderingDiagnostics !== "object") {
            global.renderingDiagnostics = { ...defaults };
            return global.renderingDiagnostics;
        }
        const config = global.renderingDiagnostics;
        for (const key of Object.keys(defaults)) {
            if (typeof config[key] !== "boolean") {
                config[key] = defaults[key];
            }
        }
        return config;
    }

    function isTextureSanitizerEnabled() {
        return !!ensureRenderingDiagnosticsConfig().textureSanitizer;
    }

    function isPixiSpriteCrashDiagnosticsEnabled() {
        return !!ensureRenderingDiagnosticsConfig().pixiSpriteCrashDiagnostics;
    }

    function isRoadTextureLifecycleDiagnosticsEnabled() {
        return !!ensureRenderingDiagnosticsConfig().roadTextureLifecycleDiagnostics;
    }

    function isGroundTileProfilingEnabled() {
        return !!ensureRenderingDiagnosticsConfig().groundTileProfiling;
    }

    function isDrawPassBreakdownEnabled() {
        return !!ensureRenderingDiagnosticsConfig().drawPassBreakdown;
    }

    if (typeof global.RenderingDiagnostics !== "object" || !global.RenderingDiagnostics) {
        global.RenderingDiagnostics = {
            getFlags() {
                return { ...ensureRenderingDiagnosticsConfig() };
            },
            setTextureSanitizerEnabled(enabled) {
                const config = ensureRenderingDiagnosticsConfig();
                config.textureSanitizer = !!enabled;
                return config.textureSanitizer;
            },
            setPixiSpriteCrashDiagnosticsEnabled(enabled) {
                const config = ensureRenderingDiagnosticsConfig();
                config.pixiSpriteCrashDiagnostics = !!enabled;
                if (config.pixiSpriteCrashDiagnostics) {
                    installPixiSpriteRenderDiagnostics();
                }
                return config.pixiSpriteCrashDiagnostics;
            },
            setRoadTextureLifecycleDiagnosticsEnabled(enabled) {
                const config = ensureRenderingDiagnosticsConfig();
                config.roadTextureLifecycleDiagnostics = !!enabled;
                return config.roadTextureLifecycleDiagnostics;
            },
            setGroundTileProfilingEnabled(enabled) {
                const config = ensureRenderingDiagnosticsConfig();
                config.groundTileProfiling = !!enabled;
                return config.groundTileProfiling;
            },
            setDrawPassBreakdownEnabled(enabled) {
                const config = ensureRenderingDiagnosticsConfig();
                config.drawPassBreakdown = !!enabled;
                return config.drawPassBreakdown;
            },
            setScenePickerHoverProfilingEnabled(enabled) {
                const config = ensureRenderingDiagnosticsConfig();
                config.scenePickerHoverProfiling = !!enabled;
                return config.scenePickerHoverProfiling;
            }
        };
    }

    function isRenderablePixiTexture(texture) {
        if (!texture || texture === PIXI.Texture.EMPTY) return false;
        const baseTexture = texture.baseTexture || null;
        const orig = texture.orig || null;
        const hasUvs = !!(texture._uvs && texture._uvs.uvsFloat32);
        const hasOrigSize = !!(
            orig &&
            Number.isFinite(orig.width) &&
            Number.isFinite(orig.height)
        );
        return !!(baseTexture && hasUvs && hasOrigSize);
    }

    function sanitizeDisplayTreeTextures(root, options = {}) {
        if (!root) return { repaired: 0, samples: [] };
        const maxSamples = Number.isFinite(options.maxSamples) ? Math.max(1, Number(options.maxSamples)) : 8;
        const samples = [];
        let repaired = 0;
        const stack = [root];
        while (stack.length > 0) {
            const current = stack.pop();
            if (!current) continue;
            const texture = current.texture;
            if (Object.prototype.hasOwnProperty.call(current, "texture") && texture && !isRenderablePixiTexture(texture)) {
                if (samples.length < maxSamples) {
                    samples.push({
                        name: typeof current.name === "string" ? current.name : "",
                        ctor: current.constructor && current.constructor.name ? current.constructor.name : "",
                        textureValid: !!texture,
                        hasBaseTexture: !!(texture && texture.baseTexture),
                        hasUvs: !!(texture && texture._uvs && texture._uvs.uvsFloat32),
                        origWidth: texture && texture.orig ? Number(texture.orig.width) : null,
                        origHeight: texture && texture.orig ? Number(texture.orig.height) : null
                    });
                }
                current.texture = PIXI.Texture.WHITE;
                repaired += 1;
            }
            const children = Array.isArray(current.children) ? current.children : null;
            if (!children) continue;
            for (let i = children.length - 1; i >= 0; i--) {
                stack.push(children[i]);
            }
        }
        return { repaired, samples };
    }

    function summarizePixiTexture(texture) {
        if (!texture) {
            return {
                exists: false
            };
        }
        const baseTexture = texture.baseTexture || null;
        const orig = texture.orig || null;
        return {
            exists: true,
            hasBaseTexture: !!baseTexture,
            baseTextureValid: !!(baseTexture && baseTexture.valid),
            hasUvs: !!(texture._uvs && texture._uvs.uvsFloat32),
            origWidth: orig && Number.isFinite(orig.width) ? Number(orig.width) : null,
            origHeight: orig && Number.isFinite(orig.height) ? Number(orig.height) : null,
            frameWidth: texture.frame && Number.isFinite(texture.frame.width) ? Number(texture.frame.width) : null,
            frameHeight: texture.frame && Number.isFinite(texture.frame.height) ? Number(texture.frame.height) : null
        };
    }

    function summarizePixiDisplayObject(displayObj) {
        if (!displayObj) return null;
        const parent = displayObj.parent || null;
        const scale = displayObj.scale || null;
        const anchor = displayObj.anchor || null;
        return {
            ctor: displayObj.constructor && displayObj.constructor.name ? displayObj.constructor.name : "",
            name: typeof displayObj.name === "string" ? displayObj.name : "",
            destroyed: displayObj.destroyed === true,
            visible: displayObj.visible !== false,
            renderable: displayObj.renderable !== false,
            x: Number.isFinite(displayObj.x) ? Number(displayObj.x) : null,
            y: Number.isFinite(displayObj.y) ? Number(displayObj.y) : null,
            scaleX: scale && Number.isFinite(scale.x) ? Number(scale.x) : null,
            scaleY: scale && Number.isFinite(scale.y) ? Number(scale.y) : null,
            anchorX: anchor && Number.isFinite(anchor.x) ? Number(anchor.x) : null,
            anchorY: anchor && Number.isFinite(anchor.y) ? Number(anchor.y) : null,
            alpha: Number.isFinite(displayObj.alpha) ? Number(displayObj.alpha) : null,
            parentName: parent && typeof parent.name === "string" ? parent.name : "",
            roadTextureCacheKey: (typeof displayObj._roadTextureCacheKey === "string") ? displayObj._roadTextureCacheKey : "",
            texture: summarizePixiTexture(displayObj.texture)
        };
    }

    function buildPixiDisplayObjectCrashSignature(summary) {
        if (!summary) return "unknown";
        const tex = summary.texture || {};
        return [
            summary.ctor || "",
            summary.name || "",
            summary.parentName || "",
            tex.hasBaseTexture ? "bt1" : "bt0",
            tex.hasUvs ? "uv1" : "uv0",
            tex.origWidth === null ? "owx" : `ow${tex.origWidth}`,
            tex.origHeight === null ? "ohx" : `oh${tex.origHeight}`
        ].join("|");
    }

    function syncRoadRenderSpriteTextureRetention(sprite, road) {
        if (!sprite) return;
        const RoadClass = (typeof global !== "undefined" && global && global.Road) ? global.Road : null;
        const nextKey = (road && typeof road._roadTextureCacheKey === "string" && road._roadTextureCacheKey.length > 0)
            ? road._roadTextureCacheKey
            : "";
        const currentKey = (typeof sprite._roadTextureCacheKey === "string") ? sprite._roadTextureCacheKey : "";
        if (currentKey === nextKey) return;
        if (currentKey && RoadClass && typeof RoadClass._releaseTextureCacheEntry === "function") {
            RoadClass._releaseTextureCacheEntry(currentKey);
        }
        sprite._roadTextureCacheKey = "";
        if (nextKey && RoadClass && typeof RoadClass._retainTextureCacheEntry === "function") {
            RoadClass._retainTextureCacheEntry(nextKey);
            sprite._roadTextureCacheKey = nextKey;
        }
    }

    function installPixiSpriteRenderDiagnostics() {
        if (!PIXI || !PIXI.Sprite || !PIXI.Sprite.prototype) return;
        if (PIXI.Sprite.prototype._survivorTextureDiagInstalled === true) return;
        PIXI.Sprite.prototype._survivorTextureDiagInstalled = true;
        const loggedCrashSignatures = new Set();

        const originalCalculateVertices = PIXI.Sprite.prototype.calculateVertices;
        if (typeof originalCalculateVertices === "function") {
            PIXI.Sprite.prototype.calculateVertices = function survivorDiagnoseCalculateVertices(...args) {
                try {
                    return originalCalculateVertices.apply(this, args);
                } catch (err) {
                    if (!isPixiSpriteCrashDiagnosticsEnabled()) {
                        throw err;
                    }
                    const message = err && err.message ? String(err.message) : "";
                    const textureState = summarizePixiDisplayObject(this);
                    const signature = buildPixiDisplayObjectCrashSignature(textureState);
                    if (!loggedCrashSignatures.has(signature)) {
                        loggedCrashSignatures.add(signature);
                        console.error("[pixi sprite calculateVertices crash]", {
                            message,
                            signature,
                            sprite: textureState
                        });
                        try {
                            console.error("[pixi sprite calculateVertices crash json]", JSON.stringify({
                                message,
                                signature,
                                sprite: textureState
                            }));
                        } catch (_jsonErr) {
                            // ignore JSON serialization failures
                        }
                    }
                    if (!isRenderablePixiTexture(this.texture)) {
                        this.texture = PIXI.Texture.WHITE;
                        try {
                            return originalCalculateVertices.apply(this, args);
                        } catch (_retryErr) {
                            // fall through to original error
                        }
                    }
                    throw err;
                }
            };
        }
    }

    class RenderingImpl {
        constructor() {
            const CameraCtor = global.RenderingCamera;
            const LayersCtor = global.RenderingLayers;
            const MazeModeCtor = global.RenderingMazeMode;
            this.camera = new CameraCtor();
            this.layers = new LayersCtor();
            this.mazeModeRenderer = (MazeModeCtor && typeof MazeModeCtor === "function")
                ? new MazeModeCtor()
                : null;
            this.mazeModeOverlayActive = false;
            this.mazeModeJustActivatedFrame = false;
            this.mazeModeActivatedAtMs = null;
            this.lastMazeModeSettingEnabled = null;
            this.mazeModeSuppressRevealAnimation = false;
            this.initialized = false;
            this.wizardSprite = null;
            this.wizardGhostSprite = null;
            this.wizardShadowGraphics = null;
            this.wizardShadowSprite = null;
            this.wizardShadowProxy = null;
            this.placeObjectPreviewSprite = null;
            this.placeObjectPreviewTexturePath = "";
            this.placeObjectPreviewDisplayObject = null;
            this.placeObjectPreviewItem = null;
            this.placeObjectCenterSnapGuideGraphics = null;
            this.powerupPlacementPreviewSprite = null;
            this.powerupPlacementPreviewTexturePath = "";
            this.powerupPlacementPreviewDisplayObject = null;
            this.powerupPlacementPreviewItem = null;
            this.wallPlacementPreviewGraphics = null;
            this.prototypeSectionSeamGraphics = null;
            this.hexGridTexture = null;
            this.hexGridSprites = [];
            this.hexGridContainer = null;
            this.hexGridPickerBackdrop = null;
            this.groundTileContainer = null;
            this.hexGridLastViewscale = 0;
            this.hexGridLastXyratio = 0;
            this.groundSpriteByNodeKey = new Map();
            this.groundVisibleNodeKeys = new Set();
            this.groundSpritePool = [];
            this.roadSpriteByObject = new Map();
            this.lastSectionInputItems = [];
            this.activeObjectDisplayObjects = new Set();
            this.activeDepthBillboardMeshes = new Set();
            this.activeDepthBillboardItems = new Set();
            this.activeAnimalHealthBarItems = new Set();
            this.activeTreeHealthBarItems = new Set();
            this.activePowerupDisplayObjects = new Set();
            this.activeProjectileDisplayObjects = new Set();
            this.scriptMessageTextObjects = new Map();
            this.pickRenderItems = [];
            this.losShadowGraphics = null;
            this.currentLosState = null;
            this.lastLosWizardX = null;
            this.lastLosWizardY = null;
            this.lastLosFacingAngle = null;
            this.lastLosCandidateCount = -1;
            this.lastLosCandidateHash = 0;
            this.lastLosComputeAtMs = 0;
            this.nextLosObjectId = 1;
            this.drawPassProfiler = {
                startMs: null,
                deadlineMs: null,
                frameCount: 0,
                totalFrameMs: 0,
                maxFrameMs: 0,
                sections: Object.create(null),
                printed: false
            };
            this.currentFrameDrawSections = Object.create(null);
            this.groundTileProfiler = {
                startMs: null,
                deadlineMs: null,
                frameCount: 0,
                printed: false,
                totals: {
                    totalMs: 0,
                    activeKeyBuildMs: 0,
                    visibleSetMs: 0,
                    createSpriteMs: 0,
                    parentAttachMs: 0,
                    textureResolveMs: 0,
                    positionSizeMs: 0,
                    cleanupMs: 0
                },
                counts: {
                    visibleNodes: 0,
                    createdSprites: 0,
                    attachedSprites: 0,
                    cleanedSprites: 0,
                    evictedSprites: 0,
                    reusedSprites: 0
                }
            };
            this._lastTextureSanitizerLogAtMs = 0;
            const ScenePickerCtor = global.RenderingScenePicker;
            this.scenePicker = (ScenePickerCtor && typeof ScenePickerCtor === "function")
                ? new ScenePickerCtor()
                : null;
        }

        resetPickRenderItems() {
            this.pickRenderItems.length = 0;
        }

        addPickRenderItem(item, displayObj, options = null) {
            if (!item || !displayObj) return;
            if (item.gone || item.vanishing) return;
            const opts = options && typeof options === "object" ? options : {};
            const forceInclude = !!opts.forceInclude;
            if (!forceInclude && !displayObj.visible) return;
            if (!displayObj.parent && !(forceInclude && (item.type === "triggerArea" || item.isTriggerArea === true))) return;
            this.pickRenderItems.push({ item, displayObj, forceInclude });
        }

        init(ctx) {
            if (this.initialized) return;
            const parent = (ctx && ctx.gameContainer) || (ctx && ctx.app && ctx.app.stage) || null;
            if (!parent) return;
            parent.addChild(this.layers.root);
            this.layers.root.zIndex = 10000;
            this.initialized = true;
        }

        getCharacterLayer() {
            return (this.layers && (this.layers.depthObjects || this.layers.characters || this.layers.entities)) || null;
        }

        isCharacterRenderItem(item) {
            return !!(item && typeof Character !== "undefined" && item instanceof Character);
        }

        getWizardShadowTexture() {
            if (this._wizardShadowTexture) return this._wizardShadowTexture;
            const canvas = document.createElement("canvas");
            canvas.width = 128;
            canvas.height = 128;
            const ctx2d = canvas.getContext("2d");
            if (!ctx2d) return PIXI.Texture.WHITE;
            const gradient = ctx2d.createRadialGradient(64, 64, 12, 64, 64, 62);
            gradient.addColorStop(0, "rgba(0,0,0,0.34)");
            gradient.addColorStop(0.6, "rgba(0,0,0,0.18)");
            gradient.addColorStop(1, "rgba(0,0,0,0)");
            ctx2d.fillStyle = gradient;
            ctx2d.beginPath();
            ctx2d.ellipse(64, 64, 62, 62, 0, 0, Math.PI * 2);
            ctx2d.fill();
            this._wizardShadowTexture = PIXI.Texture.from(canvas);
            return this._wizardShadowTexture;
        }

        ensureWizardGhostSprite() {
            if (!this.wizardGhostSprite) {
                this.wizardGhostSprite = new PIXI.Sprite(PIXI.Texture.from("/assets/images/ghost.png"));
                this.wizardGhostSprite.name = "renderingWizardGhost";
                this.wizardGhostSprite.anchor.set(0.5, 1);
                this.wizardGhostSprite.visible = false;
                if (Object.prototype.hasOwnProperty.call(this.wizardGhostSprite, "renderable")) {
                    this.wizardGhostSprite.renderable = false;
                }
            }
            return this.wizardGhostSprite;
        }

        ensureWizardShadowProxy() {
            if (!this.wizardShadowSprite) {
                this.wizardShadowSprite = new PIXI.Sprite(this.getWizardShadowTexture());
                this.wizardShadowSprite.name = "renderingWizardShadowSprite";
                this.wizardShadowSprite.anchor.set(0.5, 0.5);
            }
            if (!this.wizardShadowProxy) {
                this.wizardShadowProxy = {
                    type: "wizardShadow",
                    category: "shadow",
                    rotationAxis: "ground",
                    placementRotation: 0,
                    forceDepthTestGround: true,
                    pixiSprite: this.wizardShadowSprite,
                    x: 0,
                    y: 0,
                    z: 0,
                    width: 0.4,
                    height: 0.4,
                    gone: false,
                    vanishing: false,
                    visible: true,
                    tint: 0xFFFFFF,
                    _depthBillboardMesh: null,
                    _depthBillboardWorldPositions: null,
                    _depthBillboardLastSignature: "",
                    _depthBillboardLastUvSignature: "",
                    _depthBillboardMeshMode: ""
                };
                const staticProto = (typeof global.StaticObject === "function" && global.StaticObject.prototype)
                    ? global.StaticObject.prototype
                    : null;
                if (staticProto) {
                    if (typeof staticProto.ensureDepthBillboardMesh === "function") {
                        this.wizardShadowProxy.ensureDepthBillboardMesh = staticProto.ensureDepthBillboardMesh;
                    }
                    if (typeof staticProto.updateDepthBillboardUvsForTexture === "function") {
                        this.wizardShadowProxy.updateDepthBillboardUvsForTexture = staticProto.updateDepthBillboardUvsForTexture;
                    }
                    if (typeof staticProto.updateDepthBillboardMesh === "function") {
                        this.wizardShadowProxy.updateDepthBillboardMesh = staticProto.updateDepthBillboardMesh;
                    }
                }
            }
            return this.wizardShadowProxy;
        }

        setLegacyLayersVisible(visible) {
            const names = [
                "landLayer",
                "roadLayer",
                "gridLayer",
                "neighborDebugLayer",
                "opaqueMeshLayer",
                "objectLayer",
                "roofLayer",
                "characterLayer",
                "projectileLayer",
                "hitboxLayer"
            ];
            for (let i = 0; i < names.length; i++) {
                const layer = global[names[i]];
                if (layer && typeof layer.visible === "boolean") layer.visible = visible;
            }
        }

        getProjectileTexture(projectile) {
            if (!projectile) return null;
            const frames = Array.isArray(projectile.explosionFrames) ? projectile.explosionFrames : null;
            if (frames && frames.length > 0) {
                const rawFrame = Number.isFinite(projectile.explosionFrame)
                    ? Math.floor(projectile.explosionFrame)
                    : 0;
                const frameIndex = ((rawFrame % frames.length) + frames.length) % frames.length;
                const frameTexture = frames[frameIndex];
                if (frameTexture) return frameTexture;
            }
            const imageSrc = (projectile.image && typeof projectile.image.src === "string" && projectile.image.src.length > 0)
                ? projectile.image.src
                : null;
            if (imageSrc) return PIXI.Texture.from(imageSrc);
            const texturePath = (typeof projectile.texturePath === "string" && projectile.texturePath.length > 0)
                ? projectile.texturePath
                : null;
            if (texturePath) return PIXI.Texture.from(texturePath);
            return null;
        }

        renderProjectileParticles(projectile, container, hiddenByMazeLos) {
            if (!projectile) return null;
            const particles = Array.isArray(projectile.snowParticles) ? projectile.snowParticles : null;
            let graphics = projectile.particleGraphics || null;

            if (!particles || particles.length === 0 || hiddenByMazeLos) {
                if (graphics) {
                    graphics.clear();
                    graphics.visible = false;
                    if (graphics.parent) {
                        graphics.parent.removeChild(graphics);
                    }
                }
                return graphics;
            }

            if (!graphics) {
                graphics = new PIXI.Graphics();
                graphics.name = "projectileParticles";
                projectile.particleGraphics = graphics;
            }
            if (graphics.parent !== container) {
                container.addChild(graphics);
            }

            graphics.clear();
            graphics.visible = true;
            graphics.zIndex = 2;

            for (let i = 0; i < particles.length; i++) {
                const particle = particles[i];
                if (!particle) continue;
                const lifeMs = Math.max(1, Number(particle.lifeMs) || 1);
                const ageMs = Math.max(0, Number(particle.ageMs) || 0);
                const lifeProgress = Math.max(0, Math.min(1, ageMs / lifeMs));
                const alpha = Math.max(0, (Number(particle.alpha) || 0) * (1 - lifeProgress));
                if (alpha <= 0.01) continue;
                const baseSize = Math.max(1, Number(particle.size) || 1);
                const shrink = Math.max(0, Math.min(1, Number(particle.shrink) || 0));
                const radiusPx = Math.max(0.7, baseSize * (1 - (lifeProgress * shrink)));
                const screenPoint = this.camera.worldToScreen(
                    Number(particle.x) || 0,
                    Number(particle.y) || 0,
                    0
                );
                const screenY = screenPoint.y - (Math.max(0, Number(particle.z) || 0) * this.camera.viewscale * this.camera.xyratio);
                graphics.beginFill(Number.isFinite(particle.color) ? Number(particle.color) : 0xeaf7ff, alpha);
                graphics.drawCircle(screenPoint.x, screenY, radiusPx);
                graphics.endFill();
            }

            return graphics;
        }

        getLosVisualSetting(key, fallback) {
            const settings = (typeof LOSVisualSettings !== "undefined")
                ? LOSVisualSettings
                : (global.LOSVisualSettings || null);
            if (!settings || typeof settings !== "object") return fallback;
            return Object.prototype.hasOwnProperty.call(settings, key) ? settings[key] : fallback;
        }

        isLosMazeModeEnabled() {
            return !!this.getLosVisualSetting("mazeMode", false);
        }

        isMazeModeOverlayEligible(ctx) {
            if (!this.mazeModeRenderer) return false;
            if (!this.isLosMazeModeEnabled()) return false;
            const wizard = (ctx && ctx.wizard) ? ctx.wizard : null;
            return !this.isOmnivisionActive(wizard);
        }

        applyMazeModeCompositor(ctx) {
            const overlayEligible = this.isMazeModeOverlayEligible(ctx);
            const wasOverlayActive = !!this.mazeModeOverlayActive;
            if (!this.mazeModeRenderer) {
                this.mazeModeOverlayActive = false;
                this.mazeModeJustActivatedFrame = false;
                return false;
            }

            this.mazeModeOverlayActive = !!this.mazeModeRenderer.apply(this, ctx, {
                enabled: overlayEligible
            });
            this.mazeModeJustActivatedFrame = !!(this.mazeModeOverlayActive && !wasOverlayActive);

            const root = this.layers && this.layers.root ? this.layers.root : null;
            if (!root) return this.mazeModeOverlayActive;
            const bringToTop = (node) => {
                if (node && node.parent === root) root.addChild(node);
            };

            if (this.mazeModeOverlayActive) {
                const maskNode = this.mazeModeRenderer.occlusionMaskGraphics || null;
                const backdropNode = this.mazeModeRenderer.blackBackdropGraphics || null;
                if (maskNode && maskNode.parent === root) root.setChildIndex(maskNode, 0);
                if (backdropNode && backdropNode.parent === root) root.setChildIndex(backdropNode, Math.min(1, root.children.length - 1));
                bringToTop(this.layers.ground);
                bringToTop(this.layers.roadsFloor);
                bringToTop(this.layers.groundObjects);
                bringToTop(this.layers.losShadow);
                bringToTop(this.layers.depthObjects);
                bringToTop(this.layers.characters);
                bringToTop(this.layers.objects3d);
                bringToTop(this.layers.entities);
                bringToTop(this.layers.ui);
                bringToTop(this.layers.scriptMessages);
            } else {
                bringToTop(this.layers.ground);
                bringToTop(this.layers.roadsFloor);
                bringToTop(this.layers.groundObjects);
                bringToTop(this.layers.losShadow);
                bringToTop(this.layers.depthObjects);
                bringToTop(this.layers.characters);
                bringToTop(this.layers.objects3d);
                bringToTop(this.layers.entities);
                bringToTop(this.layers.ui);
                bringToTop(this.layers.scriptMessages);
            }

            return this.mazeModeOverlayActive;
        }

        isOmnivisionActive(wizard) {
            if (!wizard) return false;
            const activeAuras = (Array.isArray(wizard.activeAuras))
                ? wizard.activeAuras
                : ((typeof wizard.activeAura === "string") ? [wizard.activeAura] : []);
            return activeAuras.includes("omnivision");
        }

        isInvisibilityActive(wizard) {
            if (!wizard) return false;
            const activeAuras = (Array.isArray(wizard.activeAuras))
                ? wizard.activeAuras
                : ((typeof wizard.activeAura === "string") ? [wizard.activeAura] : []);
            return activeAuras.includes("invisibility");
        }

        getWizardFacingAngleRad(wizard) {
            if (!wizard) return 0;
            if (Number.isFinite(wizard.smoothedFacingAngleDeg)) {
                return Number(wizard.smoothedFacingAngleDeg) * (Math.PI / 180);
            }
            if (Number.isInteger(wizard.lastDirectionRow)) {
                const rowAngleDegByDirectionIndex = [180, -150, -120, -90, -60, -30, 0, 30, 60, 90, 120, 150];
                const rowOffset = Number.isFinite(global.wizardDirectionRowOffset)
                    ? Number(global.wizardDirectionRowOffset)
                    : 0;
                const directionIndex = ((wizard.lastDirectionRow - rowOffset) % 12 + 12) % 12;
                const deg = rowAngleDegByDirectionIndex[directionIndex];
                if (Number.isFinite(deg)) return deg * (Math.PI / 180);
            }
            if (wizard.direction && Number.isFinite(wizard.direction.x) && Number.isFinite(wizard.direction.y)) {
                const mag = Math.hypot(wizard.direction.x, wizard.direction.y);
                if (mag > 1e-6) return Math.atan2(wizard.direction.y, wizard.direction.x);
            }
            return 0;
        }

        resolveInterpolatedItemWorldPosition(item, mapRef) {
            if (!item) return null;
            const interpolated = (typeof item.getInterpolatedPosition === "function")
                ? item.getInterpolatedPosition()
                : null;
            if (interpolated && Number.isFinite(interpolated.x) && Number.isFinite(interpolated.y)) {
                return { x: interpolated.x, y: interpolated.y };
            }
            const alpha = Number.isFinite(global.renderAlpha) ? Math.max(0, Math.min(1, global.renderAlpha)) : 1;
            const x = (Number.isFinite(item.prevX) && Number.isFinite(item.x))
                ? (
                    Number.isFinite(alpha) && mapRef && typeof mapRef.shortestDeltaX === "function"
                        ? (item.prevX + mapRef.shortestDeltaX(item.prevX, item.x) * alpha)
                        : (item.prevX + (item.x - item.prevX) * alpha)
                )
                : item.x;
            const y = (Number.isFinite(item.prevY) && Number.isFinite(item.y))
                ? (
                    Number.isFinite(alpha) && mapRef && typeof mapRef.shortestDeltaY === "function"
                        ? (item.prevY + mapRef.shortestDeltaY(item.prevY, item.y) * alpha)
                        : (item.prevY + (item.y - item.prevY) * alpha)
                )
                : item.y;
            if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
            return { x, y };
        }

        getMountedFaceCentersForItem(item) {
            if (!item) return null;
            const explicitFaceCenters = (
                item.depthBillboardFaceCenters &&
                item.depthBillboardFaceCenters.front &&
                item.depthBillboardFaceCenters.back
            ) ? item.depthBillboardFaceCenters : null;
            if (
                explicitFaceCenters &&
                Number.isFinite(explicitFaceCenters.front.x) &&
                Number.isFinite(explicitFaceCenters.front.y) &&
                Number.isFinite(explicitFaceCenters.back.x) &&
                Number.isFinite(explicitFaceCenters.back.y)
            ) {
                return {
                    front: {
                        x: Number(explicitFaceCenters.front.x),
                        y: Number(explicitFaceCenters.front.y)
                    },
                    back: {
                        x: Number(explicitFaceCenters.back.x),
                        y: Number(explicitFaceCenters.back.y)
                    }
                };
            }
            const getFaceCenters = (typeof global.getMountedWallFaceCentersForObject === "function")
                ? global.getMountedWallFaceCentersForObject
                : null;
            if (!getFaceCenters) return null;
            const resolved = getFaceCenters(item);
            if (
                !resolved ||
                !resolved.front ||
                !resolved.back ||
                !Number.isFinite(resolved.front.x) ||
                !Number.isFinite(resolved.front.y) ||
                !Number.isFinite(resolved.back.x) ||
                !Number.isFinite(resolved.back.y)
            ) {
                return null;
            }
            return {
                front: { x: Number(resolved.front.x), y: Number(resolved.front.y) },
                back: { x: Number(resolved.back.x), y: Number(resolved.back.y) }
            };
        }

        isWallMountedSpatialItem(item) {
            if (!item) return false;
            const category = (typeof item.category === "string") ? item.category.trim().toLowerCase() : "";
            const isDoorOrWindow = (
                category === "windows" ||
                category === "doors" ||
                item.type === "window" ||
                item.type === "door"
            );
            if (!isDoorOrWindow || item.rotationAxis !== "spatial") return false;
            return !!(
                Number.isInteger(item.mountedWallSectionUnitId) ||
                Number.isInteger(item.mountedWallLineGroupId) ||
                Number.isInteger(item.mountedSectionId)
            );
        }

        resolveMountedWallSectionForItem(item) {
            if (!item) return null;
            const wallCtor = global.WallSectionUnit;
            const allSections = (wallCtor && wallCtor._allSections instanceof Map)
                ? wallCtor._allSections
                : null;
            if (!allSections) return null;
            const candidateIds = [
                item.mountedWallSectionUnitId,
                item.mountedSectionId,
                item.mountedWallLineGroupId
            ];
            for (let i = 0; i < candidateIds.length; i++) {
                const id = Number(candidateIds[i]);
                if (!Number.isInteger(id)) continue;
                const section = allSections.get(id) || null;
                if (section && section.type === "wallSection") return section;
            }
            return null;
        }

        getLosVisibilitySamplePointForItem(item, mapRef, observer = null) {
            if (!item) return null;
            if (
                item.isFallenDoorEffect &&
                item._losVisibilitySamplePoint &&
                Number.isFinite(item._losVisibilitySamplePoint.x) &&
                Number.isFinite(item._losVisibilitySamplePoint.y)
            ) {
                return {
                    x: Number(item._losVisibilitySamplePoint.x),
                    y: Number(item._losVisibilitySamplePoint.y)
                };
            }
            const isWallMountedSpatial = this.isWallMountedSpatialItem(item);
            if (isWallMountedSpatial) {
                const faceCenters = this.getMountedFaceCentersForItem(item);
                if (faceCenters) {
                    const refX = (observer && Number.isFinite(observer.x))
                        ? Number(observer.x)
                        : (Number.isFinite(item.x) ? Number(item.x) : 0);
                    const refY = (observer && Number.isFinite(observer.y))
                        ? Number(observer.y)
                        : (Number.isFinite(item.y) ? Number(item.y) : 0);
                    const frontDx = (mapRef && typeof mapRef.shortestDeltaX === "function")
                        ? mapRef.shortestDeltaX(refX, faceCenters.front.x)
                        : (faceCenters.front.x - refX);
                    const frontDy = (mapRef && typeof mapRef.shortestDeltaY === "function")
                        ? mapRef.shortestDeltaY(refY, faceCenters.front.y)
                        : (faceCenters.front.y - refY);
                    const backDx = (mapRef && typeof mapRef.shortestDeltaX === "function")
                        ? mapRef.shortestDeltaX(refX, faceCenters.back.x)
                        : (faceCenters.back.x - refX);
                    const backDy = (mapRef && typeof mapRef.shortestDeltaY === "function")
                        ? mapRef.shortestDeltaY(refY, faceCenters.back.y)
                        : (faceCenters.back.y - refY);
                    const frontDist2 = frontDx * frontDx + frontDy * frontDy;
                    const backDist2 = backDx * backDx + backDy * backDy;
                    const picked = frontDist2 <= backDist2 ? faceCenters.front : faceCenters.back;
                    return { x: picked.x, y: picked.y };
                }
            }
            return this.resolveInterpolatedItemWorldPosition(item, mapRef);
        }

        isWorldPointInLosShadow(worldX, worldY, wizard, mapRef = null) {
            if (!wizard || !Number.isFinite(worldX) || !Number.isFinite(worldY)) return false;
            const state = this.currentLosState;
            if (!state || !state.depth || !Number.isFinite(state.bins) || state.bins < 3) return false;
            const bins = Math.floor(state.bins);
            const depth = state.depth;
            if (!depth || depth.length !== bins) return false;
            const effectiveMap = mapRef || (wizard && wizard.map) || (this.camera && this.camera.map) || global.map || null;
            const dx = (effectiveMap && typeof effectiveMap.shortestDeltaX === "function")
                ? effectiveMap.shortestDeltaX(wizard.x, worldX)
                : (worldX - wizard.x);
            const dy = (effectiveMap && typeof effectiveMap.shortestDeltaY === "function")
                ? effectiveMap.shortestDeltaY(wizard.y, worldY)
                : (worldY - wizard.y);
            const distance = Math.hypot(dx, dy);
            const theta = Math.atan2(dy, dx);
            const twoPi = Math.PI * 2;
            const norm = ((theta + Math.PI) % twoPi + twoPi) % twoPi;
            const binIdx = Math.max(0, Math.min(bins - 1, Math.floor((norm / twoPi) * bins)));
            const losDepth = Number.isFinite(depth[binIdx]) ? Number(depth[binIdx]) : Infinity;
            const losHasForwardFov = !!state.hasForwardFov;
            const losFacingAngle = Number.isFinite(state.facingAngle) ? state.facingAngle : 0;
            const losHalfFovRad = Number.isFinite(state.halfFovRad) ? state.halfFovRad : Math.PI;
            let insideFov = true;
            if (losHasForwardFov) {
                let delta = theta - losFacingAngle;
                while (delta <= -Math.PI) delta += twoPi;
                while (delta > Math.PI) delta -= twoPi;
                insideFov = Math.abs(delta) <= losHalfFovRad;
            }
            const nearReveal = insideFov ? 0 : LOS_NEAR_REVEAL_RADIUS;
            const litDistance = Math.max(nearReveal, losDepth);
            return distance > litDistance;
        }

        isRadialItemHiddenByLos(item, wizard, mapRef = null) {
            if (!item || !wizard) return false;
            const worldPos = this.getLosVisibilitySamplePointForItem(item, mapRef, wizard);
            if (!worldPos) return false;
            if (!this.isWorldPointInLosShadow(worldPos.x, worldPos.y, wizard, mapRef)) return false;

            const state = this.currentLosState;
            if (!state || !state.depth || !Number.isFinite(state.bins) || state.bins < 3) return true;
            const bins = Math.floor(state.bins);
            const depth = state.depth;
            if (!depth || depth.length !== bins) return true;

            const effectiveMap = mapRef || (wizard && wizard.map) || (this.camera && this.camera.map) || global.map || null;
            const dx = (effectiveMap && typeof effectiveMap.shortestDeltaX === "function")
                ? effectiveMap.shortestDeltaX(wizard.x, worldPos.x)
                : (worldPos.x - wizard.x);
            const dy = (effectiveMap && typeof effectiveMap.shortestDeltaY === "function")
                ? effectiveMap.shortestDeltaY(wizard.y, worldPos.y)
                : (worldPos.y - wizard.y);
            const dist = Math.hypot(dx, dy);
            if (dist < 0.01) return false;

            const visR = Math.max(
                Number.isFinite(item.width) ? item.width / 2 : 0,
                Number.isFinite(item.height) ? item.height / 2 : 0,
                Number.isFinite(item.radius) ? item.radius : 0,
                (item.groundPlaneHitbox && Number.isFinite(item.groundPlaneHitbox.radius))
                    ? item.groundPlaneHitbox.radius : 0,
                Number.isFinite(item.visualRadius) ? item.visualRadius : 0
            );
            if (visR <= 0) return true;

            const halfSpan = Math.asin(Math.min(1, visR / dist));
            const centerAngle = Math.atan2(dy, dx);
            const twoPi = Math.PI * 2;
            const a0 = centerAngle - halfSpan;
            const a1 = centerAngle + halfSpan;
            const norm0 = ((a0 + Math.PI) % twoPi + twoPi) % twoPi;
            const norm1 = ((a1 + Math.PI) % twoPi + twoPi) % twoPi;
            const bin0 = Math.max(0, Math.min(bins - 1, Math.floor((norm0 / twoPi) * bins)));
            const bin1 = Math.max(0, Math.min(bins - 1, Math.floor((norm1 / twoPi) * bins)));
            const spanBins = ((bin1 - bin0 + bins) % bins) || 1;

            for (let i = 0; i <= spanBins; i++) {
                const b = (bin0 + i) % bins;
                const d = Number.isFinite(depth[b]) ? depth[b] : Infinity;
                if (d >= dist) return false;
            }
            return true;
        }

        isPlacedObjectEntity(item) {
            return !!(
                item &&
                (item.isPlacedObject || item.objectType === "placedObject" || item.type === "placedObject")
            );
        }

        forEachWrappedNodeInViewport(mapRef, xPadding, yPadding, callback, cameraOverride = null) {
            if (!mapRef || typeof callback !== "function") return;
            if (typeof mapRef.getVisibleNodesInViewport === "function") {
                const nodes = mapRef.getVisibleNodesInViewport(cameraOverride || this.camera || {}, xPadding, yPadding);
                for (let i = 0; i < nodes.length; i++) {
                    if (nodes[i]) callback(nodes[i]);
                }
                return;
            }
            const camera = cameraOverride || this.camera || {};
            const viewportRef = global.viewport || null;
            const cameraWidth = Number.isFinite(camera.width)
                ? camera.width
                : (viewportRef && Number.isFinite(viewportRef.width) ? viewportRef.width : 0);
            const cameraHeight = Number.isFinite(camera.height)
                ? camera.height
                : (viewportRef && Number.isFinite(viewportRef.height) ? viewportRef.height : 0);
            const padX = Math.max(0, Number.isFinite(xPadding) ? Math.floor(xPadding) : 0);
            const padY = Math.max(0, Number.isFinite(yPadding) ? Math.floor(yPadding) : 0);
            const xScale = 0.866;
            const xStart = Math.floor(camera.x / xScale) - padX;
            const xEnd = Math.ceil((camera.x + cameraWidth) / xScale) + padX;
            const yStart = Math.floor(camera.y) - padY;
            const yEnd = Math.ceil(camera.y + cameraHeight) + padY;
            const xRanges = (typeof global.getWrappedIndexRanges === "function")
                ? global.getWrappedIndexRanges(xStart, xEnd, mapRef.width, mapRef.wrapX)
                : [];
            const yRanges = (typeof global.getWrappedIndexRanges === "function")
                ? global.getWrappedIndexRanges(yStart, yEnd, mapRef.height, mapRef.wrapY)
                : [];
            if (xRanges.length === 0 || yRanges.length === 0) return;

            yRanges.forEach(yRange => {
                for (let y = yRange.start; y <= yRange.end; y++) {
                    xRanges.forEach(xRange => {
                        for (let x = xRange.start; x <= xRange.end; x++) {
                            const node = mapRef.nodes[x] && mapRef.nodes[x][y] ? mapRef.nodes[x][y] : null;
                            if (node) callback(node);
                        }
                    });
                }
            });
        }

        resolvePlacedObjectLodTexturePath(item) {
            if (!item || !this.isPlacedObjectEntity(item)) return null;
            const basePath = (typeof item.texturePath === "string" && item.texturePath.length > 0)
                ? item.texturePath
                : null;
            const lodList = Array.isArray(item.lodTextures) ? item.lodTextures : null;
            if (!lodList || lodList.length === 0) return basePath;
            const itemWidthWorld = Math.max(0.01, Number.isFinite(item.width) ? Number(item.width) : 1);
            const itemHeightWorld = Math.max(0.01, Number.isFinite(item.height) ? Number(item.height) : 1);
            const rotationAxis = (typeof item.rotationAxis === "string") ? item.rotationAxis : "visual";
            const yIsoScale = Math.max(0.0001, Math.abs(Number.isFinite(this.camera.xyratio) ? this.camera.xyratio : 0.66));
            const screenWidthPx = itemWidthWorld * this.camera.viewscale;
            const screenHeightPx = (rotationAxis === "spatial")
                ? (itemHeightWorld * this.camera.viewscale)
                : (itemHeightWorld * this.camera.viewscale * yIsoScale);
            const sizeMetric = Math.max(screenWidthPx, screenHeightPx);

            for (let i = 0; i < lodList.length; i++) {
                const entry = lodList[i];
                if (!entry || typeof entry.texturePath !== "string" || entry.texturePath.length === 0) continue;
                const maxSize = Number.isFinite(entry.maxDistance) ? Number(entry.maxDistance) : Infinity;
                if (sizeMetric <= maxSize) return entry.texturePath;
            }
            return basePath || (lodList[lodList.length - 1] && lodList[lodList.length - 1].texturePath) || null;
        }

        resolvePowerupLodTexturePath(item) {
            if (!item) return null;
            const basePath = (typeof item.imagePath === "string" && item.imagePath.length > 0)
                ? item.imagePath
                : null;
            const lodList = Array.isArray(item.lodTextures) ? item.lodTextures : null;
            if (!lodList || lodList.length === 0) return basePath;
            const itemWidthWorld = Math.max(0.01, Number.isFinite(item.width) ? Number(item.width) : 1);
            const itemHeightWorld = Math.max(0.01, Number.isFinite(item.height) ? Number(item.height) : 1);
            const sizeMetric = Math.max(
                itemWidthWorld * this.camera.viewscale,
                itemHeightWorld * this.camera.viewscale
            );

            for (let i = 0; i < lodList.length; i++) {
                const entry = lodList[i];
                if (!entry || typeof entry.texturePath !== "string" || entry.texturePath.length === 0) continue;
                const maxSize = Number.isFinite(entry.maxDistance) ? Number(entry.maxDistance) : Infinity;
                if (sizeMetric <= maxSize) return entry.texturePath;
            }
            return basePath || (lodList[lodList.length - 1] && lodList[lodList.length - 1].texturePath) || null;
        }

        applySpriteTransform(item) {
            if (!item || !item.pixiSprite) return;
            if (item.dead && typeof item.tickDeadFire === "function") {
                item.tickDeadFire();
            }
            if (item.dead && typeof item.tickDeathAnimation === "function") {
                item.tickDeathAnimation();
            }
            if (typeof item._syncFireVisualState === "function") {
                item._syncFireVisualState();
            }
            const interpolatedWorld = (typeof item.getInterpolatedPosition === "function")
                ? item.getInterpolatedPosition()
                : null;
            const mapRef = this.camera.map || global.map || null;
            const alpha = Number.isFinite(global.renderAlpha) ? Math.max(0, Math.min(1, global.renderAlpha)) : 1;
            const fallbackWorldX = (item && Number.isFinite(item.prevX) && Number.isFinite(item.x))
                ? (
                    Number.isFinite(alpha) && mapRef && typeof mapRef.shortestDeltaX === "function"
                        ? (item.prevX + mapRef.shortestDeltaX(item.prevX, item.x) * alpha)
                        : (item.prevX + (item.x - item.prevX) * alpha)
                )
                : item.x;
            const fallbackWorldY = (item && Number.isFinite(item.prevY) && Number.isFinite(item.y))
                ? (
                    Number.isFinite(alpha) && mapRef && typeof mapRef.shortestDeltaY === "function"
                        ? (item.prevY + mapRef.shortestDeltaY(item.prevY, item.y) * alpha)
                        : (item.prevY + (item.y - item.prevY) * alpha)
                )
                : item.y;
            const drawX = (
                interpolatedWorld &&
                Number.isFinite(interpolatedWorld.x) &&
                Number.isFinite(interpolatedWorld.y)
            ) ? interpolatedWorld.x : fallbackWorldX;
            const drawY = (
                interpolatedWorld &&
                Number.isFinite(interpolatedWorld.x) &&
                Number.isFinite(interpolatedWorld.y)
            ) ? interpolatedWorld.y : fallbackWorldY;
            const drawZ = (
                interpolatedWorld &&
                Number.isFinite(interpolatedWorld.z)
            )
                ? interpolatedWorld.z
                : (Number.isFinite(item.z) ? Number(item.z) : 0);
            const coors = this.camera.worldToScreen(drawX, drawY, drawZ);
            item.pixiSprite.x = coors.x;
            item.pixiSprite.y = coors.y;

            if (typeof global.ensureSpriteFrames === "function") {
                global.ensureSpriteFrames(item);
            }
            if (item.spriteFrames && item.pixiSprite) {
                const rowIndex = typeof item.getDirectionRow === "function" ? item.getDirectionRow() : 0;
                const safeRow = Math.max(0, Math.min(rowIndex, (item.spriteRows || 1) - 1));
                const safeCol = Math.max(0, Math.min(item.spriteCol || 0, (item.spriteCols || 1) - 1));
                const rowFrames = item.spriteFrames[safeRow] || item.spriteFrames[0];
                const nextTexture = rowFrames && (rowFrames[safeCol] || rowFrames[0]);
                if (nextTexture) item.pixiSprite.texture = nextTexture;
            }

            const spriteTexture = item.pixiSprite.texture || null;
            const nativeTexW = spriteTexture && Number.isFinite(spriteTexture.width) ? Number(spriteTexture.width) : null;
            const nativeTexH = spriteTexture && Number.isFinite(spriteTexture.height) ? Number(spriteTexture.height) : null;
            const frameScale = (typeof item.getSpriteFrameScale === "function")
                ? item.getSpriteFrameScale()
                : null;
            const frameScaleWidth = Math.max(
                0.01,
                frameScale && Number.isFinite(frameScale.width) ? Number(frameScale.width) : 1
            );
            const frameScaleHeight = Math.max(
                0.01,
                frameScale && Number.isFinite(frameScale.height) ? Number(frameScale.height) : 1
            );
            const useNativeLodSize = !!(
                global.debugUseLodNativePixelSize &&
                this.isPlacedObjectEntity(item) &&
                item.rotationAxis !== "spatial" &&
                Number.isFinite(nativeTexW) &&
                Number.isFinite(nativeTexH)
            );

            if (this.isPlacedObjectEntity(item) && item.rotationAxis !== "spatial" && item.pixiSprite instanceof PIXI.Sprite) {
                const lodTexturePath = this.resolvePlacedObjectLodTexturePath(item);
                if (typeof lodTexturePath === "string" && lodTexturePath.length > 0 && lodTexturePath !== item._activeLodTexturePath) {
                    item.pixiSprite.texture = PIXI.Texture.from(lodTexturePath);
                    item._activeLodTexturePath = lodTexturePath;
                }
            }

            let targetWidth = 0;
            let targetHeight = 0;
            if (item.type === "road") {
                targetWidth = (item.width || 1) * this.camera.viewscale * 1.1547;
                targetHeight = (item.height || 1) * this.camera.viewscale * this.camera.xyratio;
            } else if (item.rotationAxis === "ground") {
                targetWidth = (item.width || 1) * this.camera.viewscale;
                targetHeight = (item.height || 1) * this.camera.viewscale;
            } else if (useNativeLodSize) {
                targetWidth = nativeTexW;
                targetHeight = nativeTexH;
            } else {
                targetWidth = (item.width || 1) * this.camera.viewscale;
                targetHeight = (item.height || 1) * this.camera.viewscale;
            }
            item.pixiSprite.width = targetWidth * frameScaleWidth;
            item.pixiSprite.height = targetHeight * frameScaleHeight;

            if (item.dead && item.pixiSprite.anchor) {
                // For items with a gradual death fall animation (e.g. Blodia), keep the
                // default foot anchor so the depth billboard bottomZ stays at ground level.
                if (!item._useGradualDeathFall) {
                    // Flip around the sprite midline (y=0.5), not the default foot anchor.
                    item.pixiSprite.anchor.set(0.5, 0.5);
                    item.pixiSprite.y = coors.y - (item.pixiSprite.height * 0.5);
                }
            }

            if (!this.shouldUseDepthBillboard(item) && item.fireSprite) {
                const shouldShowFire = !!(item.isOnFire && this.isScriptVisible(item) && !item.gone && !item.vanishing);
                if (shouldShowFire) {
                    const fireContainer = this.isCharacterRenderItem(item)
                        ? (this.getCharacterLayer() || item.pixiSprite.parent || null)
                        : (this.layers.entities || item.pixiSprite.parent || null);
                    if (fireContainer && item.fireSprite.parent !== fireContainer) {
                        fireContainer.addChild(item.fireSprite);
                    }
                    if (item.fireSprite.anchor) item.fireSprite.anchor.set(0.5, 1);
                    item.fireSprite.x = item.pixiSprite.x;
                    // For trees, flames grow as HP is lost: scale = min(maxHP / hp, 4)
                    const _fireScale = (item.type === 'tree' && item.maxHP > 0 && item.hp > 0)
                        ? Math.min(item.maxHP / item.hp, 4)
                        : 1;
                    item.fireSprite.width = item.pixiSprite.width * 1.6 * _fireScale;
                    item.fireSprite.height = item.pixiSprite.height * 1.2 * _fireScale;
                    // Place fire bottom at the top of the host sprite, compensating for its anchor
                    const _sprAnchorY = (item.pixiSprite.anchor && Number.isFinite(item.pixiSprite.anchor.y))
                        ? item.pixiSprite.anchor.y : 1;
                    item.fireSprite.y = item.pixiSprite.y - item.pixiSprite.height * _sprAnchorY;
                    item.fireSprite.visible = true;
                    if (Object.prototype.hasOwnProperty.call(item.fireSprite, "renderable")) {
                        item.fireSprite.renderable = true;
                    }
                } else {
                    item.fireSprite.visible = false;
                    if (Object.prototype.hasOwnProperty.call(item.fireSprite, "renderable")) {
                        item.fireSprite.renderable = false;
                    }
                }
            }

            const visualRotationBase = (item && item.dead)
                ? (Number.isFinite(item.rotation) ? item.rotation : 180)
                : ((item && item.rotationAxis === "none")
                    ? 0
                    : Number.isFinite(item.placementRotation)
                        ? item.placementRotation
                        : item.rotation);
            const visualRotationOffset = (item && typeof item.getAdditionalSpriteRotationDegrees === "function")
                ? Number(item.getAdditionalSpriteRotationDegrees()) || 0
                : 0;
            const visualRotation = (Number(visualRotationBase) || 0) + visualRotationOffset;
            item.pixiSprite.rotation = visualRotation ? (visualRotation * (Math.PI / 180)) : 0;
        }

        getRoofsList(ctx) {
            const fromCtx = Array.isArray(ctx && ctx.roofs) ? ctx.roofs : null;
            if (fromCtx) return fromCtx;
            if (Array.isArray(global.roofs)) return global.roofs;
            const legacy = global.roof || null;
            return legacy ? [legacy] : [];
        }

        isWorldPointUnderRoof(worldX, worldY, ctx = null) {
            if (!Number.isFinite(worldX) || !Number.isFinite(worldY)) return false;
            const roofList = this.getRoofsList(ctx);
            if (!Array.isArray(roofList) || roofList.length === 0) return false;

            for (let i = 0; i < roofList.length; i++) {
                const roofRef = roofList[i];
                if (!roofRef || roofRef.gone || !roofRef.placed) continue;
                if (!this.isScriptVisible(roofRef)) continue;
                const roofInteriorHitbox = (
                    roofRef.interiorHideHitbox &&
                    typeof roofRef.interiorHideHitbox.containsPoint === "function"
                ) ? roofRef.interiorHideHitbox : roofRef.groundPlaneHitbox;
                if (!roofInteriorHitbox || typeof roofInteriorHitbox.containsPoint !== "function") continue;
                if (roofInteriorHitbox.containsPoint(worldX, worldY)) {
                    return true;
                }
            }
            return false;
        }

        updateRoofPreview(roof, wizardRef) {
            if (!roof) return;
            if (!roof.pixiMesh) {
                roof.createPixiMesh();
                if (roof.pixiMesh && roof.pixiMesh.parent) {
                    roof.pixiMesh.parent.removeChild(roof.pixiMesh);
                }
            }

            if (!roof.pixiMesh) return;
            const roofInteriorHitbox = (
                roof.interiorHideHitbox &&
                typeof roof.interiorHideHitbox.containsPoint === "function"
            ) ? roof.interiorHideHitbox : roof.groundPlaneHitbox;
            const wizardInsideRoof = !!(
                wizardRef &&
                roof.placed &&
                roofInteriorHitbox &&
                typeof roofInteriorHitbox.containsPoint === "function" &&
                roofInteriorHitbox.containsPoint(wizardRef.x, wizardRef.y)
            );

            const targetRoofAlpha = wizardInsideRoof ? 0.0 : 1.0;
            if (!Number.isFinite(roof.currentAlpha)) {
                roof.currentAlpha = targetRoofAlpha;
            }
            const fadeSpeed = 0.15;
            roof.currentAlpha += (targetRoofAlpha - roof.currentAlpha) * fadeSpeed;
            if (Math.abs(targetRoofAlpha - roof.currentAlpha) < 0.01) {
                roof.currentAlpha = targetRoofAlpha;
            }
            roof.pixiMesh.alpha = roof.currentAlpha;
            roof.pixiMesh.visible = !!roof.placed && roof.currentAlpha > 0.01;

            // Hide walls of this roof whose player-facing and camera-facing sides differ.
            const wallCtor = global.WallSectionUnit;
            // Lazily infer section IDs for roofs built before wallLoopSectionIds was introduced.
            if (!Array.isArray(roof.wallLoopSectionIds) && roof.placed) {
                roof.wallLoopSectionIds = this._inferWallLoopSectionIds(roof, wallCtor);
            }
            if (
                wallCtor &&
                wallCtor._allSections instanceof Map &&
                Array.isArray(roof.wallLoopSectionIds) &&
                roof.wallLoopSectionIds.length > 0
            ) {
                const roofAlpha = Number.isFinite(roof.currentAlpha) ? Number(roof.currentAlpha) : 1;
                const needsFacingCheck = roofAlpha < 0.9999;
                const facingOptions = needsFacingCheck ? {
                    worldToScreenFn: (pt) => this.camera.worldToScreen(
                        Number(pt && pt.x) || 0,
                        Number(pt && pt.y) || 0,
                        0
                    ),
                    viewscale: this.camera.viewscale,
                    xyratio: this.camera.xyratio,
                    player: wizardRef
                } : null;
                for (let wi = 0; wi < roof.wallLoopSectionIds.length; wi++) {
                    const section = wallCtor._allSections.get(roof.wallLoopSectionIds[wi]);
                    if (!section || section.gone || section.vanishing || !section.pixiSprite) continue;
                    if (!needsFacingCheck) {
                        // Roof fully visible: restore wall to normal rendering.
                        section._roofForceTopFace = false;
                        continue;
                    }
                    const facesSame = typeof section.isVisibleInMazeModeFacingRule === "function"
                        ? section.isVisibleInMazeModeFacingRule(facingOptions)
                        : true;
                    // Mismatched walls: show only the top face with its texture, not the sides.
                    section._roofForceTopFace = !facesSame;
                }
            }

            if (roof.placed) {
                const baseZ = Number.isFinite(roof.z)
                    ? Number(roof.z)
                    : (Number.isFinite(roof.heightFromGround) ? Number(roof.heightFromGround) : 0);
                const usesDepthShader = !!(
                    roof.pixiMesh &&
                    roof.pixiMesh._usesRoofDepthShader &&
                    Array.isArray(roof.pixiMesh._roofDepthUniforms)
                );
                if (usesDepthShader) {
                    const uniformsList = roof.pixiMesh._roofDepthUniforms;
                    const appRef = (typeof app !== "undefined" && app) ? app : (global.app || null);
                    const screenW = (appRef && appRef.screen && Number.isFinite(appRef.screen.width))
                        ? Number(appRef.screen.width)
                        : 1;
                    const screenH = (appRef && appRef.screen && Number.isFinite(appRef.screen.height))
                        ? Number(appRef.screen.height)
                        : 1;
                    const roofCtor = (typeof Roof !== "undefined") ? Roof : null;
                    const nearMetric = Number.isFinite(roofCtor && roofCtor.DEPTH_NEAR_METRIC)
                        ? Number(roofCtor.DEPTH_NEAR_METRIC)
                        : -128;
                    const farMetric = Number.isFinite(roofCtor && roofCtor.DEPTH_FAR_METRIC)
                        ? Number(roofCtor.DEPTH_FAR_METRIC)
                        : 256;
                    const depthSpanInv = 1 / Math.max(1e-6, farMetric - nearMetric);
                    const mapRef = roof.map || this.camera.map || global.map || null;
                    const worldW = (mapRef && Number.isFinite(mapRef.worldWidth) && mapRef.worldWidth > 0)
                        ? Number(mapRef.worldWidth)
                        : 0;
                    const worldH = (mapRef && Number.isFinite(mapRef.worldHeight) && mapRef.worldHeight > 0)
                        ? Number(mapRef.worldHeight)
                        : 0;
                    const wrapX = (mapRef && mapRef.wrapX !== false) ? 1 : 0;
                    const wrapY = (mapRef && mapRef.wrapY !== false) ? 1 : 0;
                    for (let i = 0; i < uniformsList.length; i++) {
                        const u = uniformsList[i];
                        if (!u) continue;
                        u.uScreenSize[0] = Math.max(1, screenW);
                        u.uScreenSize[1] = Math.max(1, screenH);
                        u.uCameraWorld[0] = Number(this.camera.x) || 0;
                        u.uCameraWorld[1] = Number(this.camera.y) || 0;
                        u.uViewScale = Number(this.camera.viewscale) || 1;
                        u.uXyRatio = Number(this.camera.xyratio) || 1;
                        u.uDepthRange[0] = farMetric;
                        u.uDepthRange[1] = depthSpanInv;
                        u.uModelOrigin[0] = Number(roof.x) || 0;
                        u.uModelOrigin[1] = Number(roof.y) || 0;
                        u.uModelOrigin[2] = baseZ;
                        u.uWorldSize[0] = worldW;
                        u.uWorldSize[1] = worldH;
                        u.uWrapEnabled[0] = wrapX;
                        u.uWrapEnabled[1] = wrapY;
                        u.uWrapAnchorWorld[0] = Number(roof.x) || 0;
                        u.uWrapAnchorWorld[1] = Number(roof.y) || 0;
                        u.uTint[3] = Number.isFinite(roof.currentAlpha) ? Number(roof.currentAlpha) : 1;
                    }
                    roof.pixiMesh.x = 0;
                    roof.pixiMesh.y = 0;
                    roof.pixiMesh.scale.set(1, 1);
                    roof.pixiMesh.alpha = 1;
                } else {
                    const roofCoords = this.camera.worldToScreen(roof.x, roof.y, 0);
                    const baseYOffsetPx = baseZ * this.camera.viewscale * this.camera.xyratio;
                    roof.pixiMesh.x = roofCoords.x;
                    roof.pixiMesh.y = roofCoords.y - baseYOffsetPx;
                    roof.pixiMesh.scale.set(this.camera.viewscale, this.camera.viewscale);
                }
            }
        }

        _inferWallLoopSectionIds(roof, wallCtor) {
            const poly = roof.interiorHidePolygonPoints;
            if (
                !Array.isArray(poly) || poly.length < 3 ||
                !(wallCtor && wallCtor._allSections instanceof Map)
            ) {
                return [];
            }
            // Wall section endpoints lie at polygon vertices (exact grid coords).
            // Use a generous epsilon to survive save/load float rounding.
            const EPS = 0.5;
            const epsSq = EPS * EPS;
            const isAtVertex = (px, py) => {
                for (let vi = 0; vi < poly.length; vi++) {
                    const v = poly[vi];
                    const dx = px - Number(v.x);
                    const dy = py - Number(v.y);
                    if (dx * dx + dy * dy <= epsSq) return true;
                }
                return false;
            };
            const ids = [];
            wallCtor._allSections.forEach((section) => {
                if (!section || section.gone || section.vanishing) return;
                if (!section.startPoint || !section.endPoint || !Number.isInteger(section.id)) return;
                const sx = Number(section.startPoint.x);
                const sy = Number(section.startPoint.y);
                const ex = Number(section.endPoint.x);
                const ey = Number(section.endPoint.y);
                if (!Number.isFinite(sx) || !Number.isFinite(sy) ||
                    !Number.isFinite(ex) || !Number.isFinite(ey)) return;
                if (isAtVertex(sx, sy) && isAtVertex(ex, ey)) {
                    ids.push(section.id);
                }
            });
            return ids;
        }

        isLosOccluder(item) {
            if (!item || !item.groundPlaneHitbox) return false;
            if (item.type === "road" || item.type === "firewall" || item.type === "roof") return false;
            if (typeof item.castsLosShadows === "boolean" && !item.castsLosShadows) return false;
            const isAnimal = (typeof Animal !== "undefined" && item instanceof Animal);
            if (isAnimal) return false;
            return true;
        }

        getLosObjectId(item) {
            if (!item) return 0;
            if (!Number.isInteger(item._losObjectId)) {
                item._losObjectId = this.nextLosObjectId++;
            }
            return item._losObjectId;
        }

        computeLosCandidateHash(candidates) {
            let xor = 0;
            let sum = 0;
            for (let i = 0; i < candidates.length; i++) {
                const id = this.getLosObjectId(candidates[i]) >>> 0;
                xor = (xor ^ id) >>> 0;
                sum = (sum + ((id * 2654435761) >>> 0)) >>> 0;
            }
            return (xor ^ sum) >>> 0;
        }

        clearLosStateDebug() {
            this.currentLosState = null;
            this.lastLosWizardX = null;
            this.lastLosWizardY = null;
            this.lastLosFacingAngle = null;
            this.lastLosCandidateCount = -1;
            this.lastLosCandidateHash = 0;
            this.lastLosComputeAtMs = 0;
            global.losDebugVisibleObjects = [];
            global.losDebugLastMs = 0;
            global.losDebugBreakdown = {
                buildMs: 0,
                traceMs: 0,
                totalMs: 0,
                recomputed: false,
                candidates: 0
            };
        }

        updateLosState(ctx, visibleNodes, visibleObjectsOverride = null) {
            const wizard = ctx && ctx.wizard ? ctx.wizard : null;
            const losSystem = (typeof LOSSystem !== "undefined") ? LOSSystem : global.LOSSystem;
            if (!wizard || !losSystem || typeof losSystem.computeState !== "function") {
                this.clearLosStateDebug();
                return;
            }

            const omnivisionActive = this.isOmnivisionActive(wizard);
            if (omnivisionActive) {
                this.clearLosStateDebug();
                return;
            }

            const losBuildStartMs = performance.now();
            const visibleObjects = Array.isArray(visibleObjectsOverride)
                ? visibleObjectsOverride
                : this.collectVisibleObjects(visibleNodes, ctx);
            const losNowMs = (ctx && Number.isFinite(ctx.renderNowMs)) ? Number(ctx.renderNowMs) : Date.now();
            const losCandidates = [];
            for (let i = 0; i < visibleObjects.length; i++) {
                const obj = visibleObjects[i];
                if (!obj || obj === wizard || obj.gone || obj.vanishing) continue;
                this.updateSinkAnimation(obj, losNowMs);
                if (this.isLosOccluder(obj)) losCandidates.push(obj);
            }
            const losBuildMs = performance.now() - losBuildStartMs;

            const candidateCount = losCandidates.length;
            const candidateHash = this.computeLosCandidateHash(losCandidates);
            const facingAngle = this.getWizardFacingAngleRad(wizard);
            const mapRef = ctx && ctx.map ? ctx.map : (wizard.map || null);
            const movedDx = (mapRef && typeof mapRef.shortestDeltaX === "function" && Number.isFinite(this.lastLosWizardX))
                ? mapRef.shortestDeltaX(this.lastLosWizardX, wizard.x)
                : (Number.isFinite(this.lastLosWizardX) ? (wizard.x - this.lastLosWizardX) : Infinity);
            const movedDy = (mapRef && typeof mapRef.shortestDeltaY === "function" && Number.isFinite(this.lastLosWizardY))
                ? mapRef.shortestDeltaY(this.lastLosWizardY, wizard.y)
                : (Number.isFinite(this.lastLosWizardY) ? (wizard.y - this.lastLosWizardY) : Infinity);
            const movedDist = Math.hypot(movedDx, movedDy);
            const facingDelta = Number.isFinite(this.lastLosFacingAngle)
                ? Math.abs(Math.atan2(Math.sin(facingAngle - this.lastLosFacingAngle), Math.cos(facingAngle - this.lastLosFacingAngle)))
                : Infinity;
            const structuralChange = (
                !this.currentLosState ||
                candidateCount !== this.lastLosCandidateCount ||
                candidateHash !== this.lastLosCandidateHash
            );
            const nowMs = (ctx && Number.isFinite(ctx.renderNowMs)) ? Number(ctx.renderNowMs) : performance.now();
            const timeSinceLastLosMs = Number.isFinite(this.lastLosComputeAtMs) ? (nowMs - this.lastLosComputeAtMs) : Infinity;
            const shouldRecomputeLos = (
                structuralChange ||
                movedDist > 0.03 ||
                facingDelta > 0.05 ||
                timeSinceLastLosMs >= LOS_THROTTLE_MS
            );

            let losTraceMs = 0;
            if (shouldRecomputeLos) {
                const mazeMode = this.isLosMazeModeEnabled();
                const losForwardFovDegreesRaw = Number(this.getLosVisualSetting("forwardFovDegrees", 200));
                const losForwardFovDegrees = mazeMode
                    ? 360
                    : (
                        Number.isFinite(losForwardFovDegreesRaw)
                            ? Math.max(0, Math.min(360, losForwardFovDegreesRaw))
                            : 200
                    );
                this.currentLosState = losSystem.computeState(wizard, losCandidates, {
                    bins: LOS_BINS,
                    facingAngle,
                    fovDegrees: losForwardFovDegrees,
                    mazeMode
                });
                losTraceMs = Number.isFinite(this.currentLosState && this.currentLosState.elapsedMs)
                    ? Number(this.currentLosState.elapsedMs)
                    : 0;
                this.lastLosWizardX = wizard.x;
                this.lastLosWizardY = wizard.y;
                this.lastLosFacingAngle = facingAngle;
                this.lastLosCandidateCount = candidateCount;
                this.lastLosCandidateHash = candidateHash;
                this.lastLosComputeAtMs = nowMs;
            }

            global.losDebugVisibleObjects = (this.currentLosState && Array.isArray(this.currentLosState.visibleObjects))
                ? this.currentLosState.visibleObjects
                : [];
            global.losDebugLastMs = losBuildMs + losTraceMs;
            global.losDebugBreakdown = {
                buildMs: losBuildMs,
                traceMs: losTraceMs,
                totalMs: losBuildMs + losTraceMs,
                recomputed: shouldRecomputeLos,
                candidates: candidateCount
            };
            this.setFrameMetric("losCandidates", candidateCount);
            this.setFrameMetric("losBuildMs", losBuildMs);
            this.setFrameMetric("losTraceMs", losTraceMs);
            this.setFrameMetric("losTotalMs", losBuildMs + losTraceMs);
            this.setFrameMetric("losRecomputed", shouldRecomputeLos ? 1 : 0);
            this.setFrameMetric(
                "losVisibleObjects",
                (this.currentLosState && Array.isArray(this.currentLosState.visibleObjects))
                    ? this.currentLosState.visibleObjects.length
                    : 0
            );
        }

        updateWallLosIlluminationTallies(ctx) {
            const wallCtor = global.WallSectionUnit;
            const allSections = (wallCtor && wallCtor._allSections instanceof Map)
                ? wallCtor._allSections
                : null;
            if (!allSections) return;

            const diagnosticsEnabled = !!this.currentFrameMetrics;
            const functionStartMs = diagnosticsEnabled ? performance.now() : 0;
            let resetSections = 0;
            let illuminatedBins = 0;
            let rangedSections = 0;
            let endpointOwnerLookups = 0;
            let endpointOwnersResolved = 0;

            for (const section of allSections.values()) {
                if (!section || typeof section.resetLosIlluminationTally !== "function") continue;
                section.resetLosIlluminationTally();
                resetSections += 1;
            }

            const wizard = ctx && ctx.wizard ? ctx.wizard : null;
            const mazeMode = this.isLosMazeModeEnabled() && !this.isOmnivisionActive(wizard);
            if (!mazeMode) return;

            const state = this.currentLosState;
            if (!wizard || !state || !Array.isArray(state.owner) || !state.depth || !Number.isFinite(state.bins)) return;

            const bins = Math.max(1, Math.floor(state.bins));
            if (bins <= 0) return;
            const minAngle = Number.isFinite(state.minAngle) ? state.minAngle : -Math.PI;
            const twoPi = Math.PI * 2;
            const mapRef = (wizard && wizard.map) || global.map || null;

            const angleToBinIndex = theta => {
                const relative = ((theta - minAngle) % twoPi + twoPi) % twoPi;
                const rawIndex = Math.floor((relative / twoPi) * bins);
                if (rawIndex < 0) return 0;
                if (rawIndex >= bins) return bins - 1;
                return rawIndex;
            };

            const collectEndpointOwners = endpoint => {
                if (!endpoint || !Number.isFinite(endpoint.x) || !Number.isFinite(endpoint.y)) return [];
                endpointOwnerLookups += 1;
                const dx = (mapRef && typeof mapRef.shortestDeltaX === "function")
                    ? mapRef.shortestDeltaX(wizard.x, endpoint.x)
                    : (endpoint.x - wizard.x);
                const dy = (mapRef && typeof mapRef.shortestDeltaY === "function")
                    ? mapRef.shortestDeltaY(wizard.y, endpoint.y)
                    : (endpoint.y - wizard.y);
                if (!Number.isFinite(dx) || !Number.isFinite(dy)) return [];
                const endpointDistance = Math.hypot(dx, dy);
                const theta = Math.atan2(dy, dx);
                const centerBin = angleToBinIndex(theta);
                const endpointSampleRadius = 0.8;
                const angularTolerance = endpointDistance > 1e-6
                    ? Math.atan2(endpointSampleRadius, endpointDistance)
                    : Math.PI;
                const dynamicRadius = Math.ceil((angularTolerance / twoPi) * bins);
                const searchRadiusBins = Math.min(
                    Math.max(2, dynamicRadius),
                    Math.max(2, Math.min(24, Math.floor(bins / 6)))
                );
                const endpointDepthSlack = 0.35;
                const out = [];
                const seen = new Set();
                for (let offset = 0; offset <= searchRadiusBins; offset++) {
                    const candidates = offset === 0
                        ? [centerBin]
                        : [
                            (centerBin - offset + bins) % bins,
                            (centerBin + offset) % bins
                        ];
                    for (let i = 0; i < candidates.length; i++) {
                        const binIndex = candidates[i];
                        const owner = state.owner[binIndex] || null;
                        if (!owner || seen.has(owner)) continue;
                        const hitDist = Number(state.depth[binIndex]);
                        if (!Number.isFinite(hitDist) || hitDist <= 0) continue;
                        if (Number.isFinite(endpointDistance) && hitDist > (endpointDistance + endpointDepthSlack)) continue;
                        seen.add(owner);
                        out.push(owner);
                    }
                }
                endpointOwnersResolved += out.length;
                return out;
            };

            for (let i = 0; i < bins; i++) {
                const owner = state.owner[i];
                if (!owner || owner.type !== "wallSection" || typeof owner.accumulateLosIlluminationT !== "function") continue;
                const hitDist = Number(state.depth[i]);
                if (!Number.isFinite(hitDist) || hitDist <= 0) continue;
                illuminatedBins += 1;

                const theta = minAngle + ((i + 0.5) / bins) * twoPi;
                const hitX = Number(wizard.x) + Math.cos(theta) * hitDist;
                const hitY = Number(wizard.y) + Math.sin(theta) * hitDist;
                const t = (typeof owner._parameterForWorldPointOnSection === "function")
                    ? owner._parameterForWorldPointOnSection({ x: hitX, y: hitY })
                    : null;
                owner.accumulateLosIlluminationT(t);
            }

            for (const section of allSections.values()) {
                if (!section || typeof section.getLosIlluminationRangeT !== "function") continue;
                const range = section.getLosIlluminationRangeT();
                if (!range) continue;
                rangedSections += 1;

                const sectionLength = Number.isFinite(section.length) ? Math.max(0, Number(section.length)) : 0;
                const tMin = Number(range.tMin);
                const tMax = Number(range.tMax);
                const endpointSnapDistance = 1.0;
                const startDistToPlayer = (
                    section.startPoint &&
                    Number.isFinite(section.startPoint.x) &&
                    Number.isFinite(section.startPoint.y)
                )
                    ? Math.hypot(
                        (mapRef && typeof mapRef.shortestDeltaX === "function")
                            ? mapRef.shortestDeltaX(wizard.x, section.startPoint.x)
                            : (Number(section.startPoint.x) - Number(wizard.x)),
                        (mapRef && typeof mapRef.shortestDeltaY === "function")
                            ? mapRef.shortestDeltaY(wizard.y, section.startPoint.y)
                            : (Number(section.startPoint.y) - Number(wizard.y))
                    )
                    : Infinity;
                const endDistToPlayer = (
                    section.endPoint &&
                    Number.isFinite(section.endPoint.x) &&
                    Number.isFinite(section.endPoint.y)
                )
                    ? Math.hypot(
                        (mapRef && typeof mapRef.shortestDeltaX === "function")
                            ? mapRef.shortestDeltaX(wizard.x, section.endPoint.x)
                            : (Number(section.endPoint.x) - Number(wizard.x)),
                        (mapRef && typeof mapRef.shortestDeltaY === "function")
                            ? mapRef.shortestDeltaY(wizard.y, section.endPoint.y)
                            : (Number(section.endPoint.y) - Number(wizard.y))
                    )
                    : Infinity;
                const nearStartEndpointToPlayer = startDistToPlayer <= endDistToPlayer;
                const nearEndEndpointToPlayer = endDistToPlayer < startDistToPlayer;
                const nearStartByDistance = (
                    nearStartEndpointToPlayer &&
                    sectionLength > 0 &&
                    Number.isFinite(tMin) &&
                    (Math.max(0, tMin) * sectionLength) <= endpointSnapDistance
                );
                const nearEndByDistance = (
                    nearEndEndpointToPlayer &&
                    sectionLength > 0 &&
                    Number.isFinite(tMax) &&
                    (Math.max(0, 1 - tMax) * sectionLength) <= endpointSnapDistance
                );

                const ownersAtStart = collectEndpointOwners(section.startPoint);
                const ownersAtEnd = collectEndpointOwners(section.endPoint);
                const snapStartByOwner = (typeof section.isEndpointOwnedBySameWall === "function")
                    ? ownersAtStart.some(owner => section.isEndpointOwnedBySameWall("a", owner))
                    : false;
                const snapEndByOwner = (typeof section.isEndpointOwnedBySameWall === "function")
                    ? ownersAtEnd.some(owner => section.isEndpointOwnedBySameWall("b", owner))
                    : false;
                const snapStart = snapStartByOwner || nearStartByDistance;
                const snapEnd = snapEndByOwner || nearEndByDistance;

                if (typeof section.setLosEndpointSnapEligibility === "function") {
                    section.setLosEndpointSnapEligibility("a", snapStart);
                    section.setLosEndpointSnapEligibility("b", snapEnd);
                }
            }

            this.setFrameMetric("wallLosResetSections", resetSections);
            this.setFrameMetric("wallLosIlluminatedBins", illuminatedBins);
            this.setFrameMetric("wallLosRangedSections", rangedSections);
            this.setFrameMetric("wallLosEndpointLookups", endpointOwnerLookups);
            this.setFrameMetric("wallLosEndpointOwnersResolved", endpointOwnersResolved);
            this.setFrameMetric(
                "wallLosMs",
                diagnosticsEnabled ? (performance.now() - functionStartMs) : 0
            );
        }

        ensureLosShadowGraphics() {
            const layer = this.layers && this.layers.losShadow ? this.layers.losShadow : null;
            if (!layer) return null;
            if (!this.losShadowGraphics) {
                this.losShadowGraphics = new PIXI.Graphics();
                this.losShadowGraphics.name = "renderingLosShadowGraphics";
                this.losShadowGraphics.visible = false;
                this.losShadowGraphics.interactive = false;
                layer.addChild(this.losShadowGraphics);
            } else if (this.losShadowGraphics.parent !== layer) {
                layer.addChild(this.losShadowGraphics);
            }
            const shadowBlurEnabled = !!this.getLosVisualSetting("shadowBlurEnabled", true);
            const shadowBlurStrength = Number(this.getLosVisualSetting("shadowBlurStrength", 12));
            if (shadowBlurEnabled && shadowBlurStrength > 0 && typeof PIXI !== "undefined") {
                if (typeof PIXI.BlurFilter === "function") {
                    if (!this.losShadowGraphics._losBlurFilter || !(this.losShadowGraphics._losBlurFilter instanceof PIXI.BlurFilter)) {
                        this.losShadowGraphics._losBlurFilter = new PIXI.BlurFilter();
                    }
                    this.losShadowGraphics._losBlurFilter.blur = shadowBlurStrength;
                    this.losShadowGraphics.filters = [this.losShadowGraphics._losBlurFilter];
                } else if (PIXI.filters && typeof PIXI.filters.BlurFilter === "function") {
                    if (!this.losShadowGraphics._losBlurFilter || !(this.losShadowGraphics._losBlurFilter instanceof PIXI.filters.BlurFilter)) {
                        this.losShadowGraphics._losBlurFilter = new PIXI.filters.BlurFilter();
                    }
                    this.losShadowGraphics._losBlurFilter.blur = shadowBlurStrength;
                    this.losShadowGraphics.filters = [this.losShadowGraphics._losBlurFilter];
                } else {
                    this.losShadowGraphics.filters = null;
                }
            } else {
                this.losShadowGraphics.filters = null;
            }
            return this.losShadowGraphics;
        }

        renderLosShadowOverlay(ctx) {
            const graphics = this.ensureLosShadowGraphics();
            if (!graphics) return;
            graphics.clear();
            if (this.mazeModeOverlayActive) {
                graphics.visible = false;
                return;
            }

            const shadowEnabled = !!this.getLosVisualSetting("shadowEnabled", true);
            const wizard = ctx && ctx.wizard ? ctx.wizard : null;
            const omnivisionActive = this.isOmnivisionActive(wizard);
            const mazeMode = this.isLosMazeModeEnabled() && !omnivisionActive;
            const shadowOpacityRaw = Number(this.getLosVisualSetting("shadowOpacity", 0.4));
            const shadowOpacity = mazeMode
                ? 1
                : (Number.isFinite(shadowOpacityRaw) ? Math.max(0, Math.min(1, shadowOpacityRaw)) : 0.4);
            const state = this.currentLosState;
            if (omnivisionActive || !shadowEnabled || shadowOpacity <= 0 || !wizard || !state || !state.depth || !Number.isFinite(state.bins)) {
                graphics.visible = false;
                return;
            }

            const bins = Math.max(3, Math.floor(state.bins));
            const depth = state.depth;
            if (!depth || depth.length !== bins) {
                graphics.visible = false;
                return;
            }

            const minAngle = Number.isFinite(state.minAngle) ? state.minAngle : -Math.PI;
            const twoPi = Math.PI * 2;
            const viewportRef = (ctx && ctx.viewport) || null;
            const viewportW = viewportRef && Number.isFinite(viewportRef.width) ? viewportRef.width : 24;
            const viewportH = viewportRef && Number.isFinite(viewportRef.height) ? viewportRef.height : 24;
            const farDist = Math.max(viewportW, viewportH) * 1.5;
            const angleForBin = idx => minAngle + ((idx + 0.5) / bins) * twoPi;
            const losHasForwardFov = !!state.hasForwardFov;
            const losFacingAngle = Number.isFinite(state.facingAngle) ? state.facingAngle : 0;
            const losHalfFovRad = Number.isFinite(state.halfFovRad) ? state.halfFovRad : Math.PI;
            const isInsideFov = theta => {
                if (!losHasForwardFov) return true;
                let delta = theta - losFacingAngle;
                while (delta <= -Math.PI) delta += twoPi;
                while (delta > Math.PI) delta -= twoPi;
                return Math.abs(delta) <= losHalfFovRad;
            };
            const wizardScreen = this.camera.worldToScreen(wizard.x, wizard.y, 0);
            const scaleX = this.camera.viewscale;
            const scaleY = this.camera.viewscale * this.camera.xyratio;
            const wizardScreenX = wizardScreen.x;
            const wizardScreenY = wizardScreen.y;
            graphics.visible = true;
            graphics.lineStyle(0);
            const shadowColorRaw = Number(this.getLosVisualSetting("shadowColor", 0x777777));
            const shadowColor = Number.isFinite(shadowColorRaw)
                ? Math.max(0, Math.min(0xffffff, Math.floor(shadowColorRaw)))
                : 0x777777;
            graphics.beginFill(shadowColor, shadowOpacity);
            for (let i = 0; i < bins; i++) {
                const j = (i + 1) % bins;
                const t0 = angleForBin(i);
                const t1 = angleForBin(j);
                const nearReveal0 = isInsideFov(t0) ? 0 : LOS_NEAR_REVEAL_RADIUS;
                const nearReveal1 = isInsideFov(t1) ? 0 : LOS_NEAR_REVEAL_RADIUS;
                const d0 = Number.isFinite(depth[i]) ? Math.max(nearReveal0, depth[i]) : farDist;
                const d1 = Number.isFinite(depth[j]) ? Math.max(nearReveal1, depth[j]) : farDist;
                if (d0 >= farDist && d1 >= farDist) continue;

                const cos0 = Math.cos(t0);
                const sin0 = Math.sin(t0);
                const cos1 = Math.cos(t1);
                const sin1 = Math.sin(t1);
                const near0x = wizardScreenX + cos0 * d0 * scaleX;
                const near0y = wizardScreenY + sin0 * d0 * scaleY;
                const near1x = wizardScreenX + cos1 * d1 * scaleX;
                const near1y = wizardScreenY + sin1 * d1 * scaleY;
                const far1x = wizardScreenX + cos1 * farDist * scaleX;
                const far1y = wizardScreenY + sin1 * farDist * scaleY;
                const far0x = wizardScreenX + cos0 * farDist * scaleX;
                const far0y = wizardScreenY + sin0 * farDist * scaleY;
                graphics.moveTo(near0x, near0y);
                graphics.lineTo(near1x, near1y);
                graphics.lineTo(far1x, far1y);
                graphics.lineTo(far0x, far0y);
                graphics.closePath();
            }
            graphics.endFill();
        }

        collectVisibleObjects(visibleNodes, ctx) {
            const nodes = Array.isArray(visibleNodes) ? visibleNodes : [];
            const mapRef = ctx && ctx.map ? ctx.map : null;
            const seen = new Set();
            const out = [];
            let nodeObjectsRefs = 0;
            let nodeVisibilityRefs = 0;
            let duplicateRefsSkipped = 0;
            for (let n = 0; n < nodes.length; n++) {
                const node = nodes[n];
                if (!node) continue;
                const objectLists = [node.objects, node.visibilityObjects];
                for (let listIndex = 0; listIndex < objectLists.length; listIndex++) {
                    const list = objectLists[listIndex];
                    if (!Array.isArray(list)) continue;
                    if (listIndex === 0) {
                        nodeObjectsRefs += list.length;
                    } else {
                        nodeVisibilityRefs += list.length;
                    }
                    for (let i = 0; i < list.length; i++) {
                        const obj = list[i];
                        if (!obj || obj.gone || obj.vanishing) continue;
                        if (
                            mapRef &&
                            mapRef._prototypeTriggerState &&
                            (obj.type === "triggerArea" || obj.isTriggerArea === true)
                        ) {
                            continue;
                        }
                        if (seen.has(obj)) {
                            duplicateRefsSkipped += 1;
                            continue;
                        }
                        seen.add(obj);
                        out.push(obj);
                    }
                }
            }
            const animalsList = Array.isArray(ctx && ctx.animals)
                ? ctx.animals
                : (Array.isArray(global.animals) ? global.animals : []);
            const animalsPreFilteredVisible = !!(ctx && ctx.animalsPreFilteredVisible);
            let animalsConsidered = 0;
            let animalsAdded = 0;
            let animalsSkippedOffscreen = 0;
            for (let i = 0; i < animalsList.length; i++) {
                const animal = animalsList[i];
                if (!animal || animal.gone || animal.vanishing) continue;
                animalsConsidered += 1;
                if (!animalsPreFilteredVisible && !animal.onScreen) {
                    animalsSkippedOffscreen += 1;
                    continue;
                }
                if (seen.has(animal)) continue;
                seen.add(animal);
                out.push(animal);
                animalsAdded += 1;
            }
            const wizardRef = (ctx && ctx.wizard) || global.wizard || null;
            if (
                mapRef &&
                wizardRef &&
                typeof mapRef.getPrototypeActiveTriggerDisplayObjectsForActor === "function"
            ) {
                const triggerObjects = mapRef.getPrototypeActiveTriggerDisplayObjectsForActor(wizardRef);
                for (let i = 0; i < triggerObjects.length; i++) {
                    const triggerObj = triggerObjects[i];
                    if (!triggerObj || triggerObj.gone || triggerObj.vanishing) continue;
                    if (seen.has(triggerObj)) continue;
                    seen.add(triggerObj);
                    out.push(triggerObj);
                }
            }
            this.setFrameMetric("visibleObjectNodeRefs", nodeObjectsRefs);
            this.setFrameMetric("visibleObjectVisibilityRefs", nodeVisibilityRefs);
            this.setFrameMetric("visibleObjectDuplicateRefsSkipped", duplicateRefsSkipped);
            this.setFrameMetric("visibleAnimalCandidates", animalsConsidered);
            this.setFrameMetric("visibleAnimalsAdded", animalsAdded);
            this.setFrameMetric("visibleAnimalsSkippedOffscreen", animalsSkippedOffscreen);
            this.setFrameMetric("visibleObjects", out.length);
            return out;
        }

        collectVisibleNodes(ctx, xPadding = 0, yPadding = 0) {
            const map = ctx.map;
            if (!map || !Array.isArray(map.nodes)) return [];
            const nodes = [];
            const shouldRenderNode = (typeof map.shouldRenderNode === "function")
                ? map.shouldRenderNode.bind(map)
                : null;
            let skippedByRenderFilter = 0;
            let wrappedNodes = 0;
            let fallbackNodes = 0;

            this.forEachWrappedNodeInViewport(
                map,
                xPadding,
                yPadding,
                (node) => {
                    if (shouldRenderNode && !shouldRenderNode(node)) {
                        skippedByRenderFilter += 1;
                        return;
                    }
                    if (node) {
                        nodes.push(node);
                        wrappedNodes += 1;
                    }
                },
                ctx.camera
            );
            if (nodes.length > 0) {
                this.setFrameMetric("visibleNodes", nodes.length);
                this.setFrameMetric("visibleNodesWrapped", wrappedNodes);
                this.setFrameMetric("visibleNodesFallback", 0);
                this.setFrameMetric("visibleNodeFilterSkipped", skippedByRenderFilter);
                this.setFrameMetric("visibleNodeFallbackUsed", 0);
                return nodes;
            }

            const cam = this.camera;
            const padX = Math.max(0, Number.isFinite(xPadding) ? Math.floor(xPadding) : 0);
            const padY = Math.max(0, Number.isFinite(yPadding) ? Math.floor(yPadding) : 0);
            const minX = Math.max(0, Math.floor(cam.x / 0.866) - padX);
            const maxX = Math.min(map.width - 1, Math.ceil((cam.x + ctx.viewport.width) / 0.866) + padX);
            const minY = Math.max(0, Math.floor(cam.y) - padY);
            const maxY = Math.min(map.height - 1, Math.ceil(cam.y + ctx.viewport.height) + padY);
            for (let x = minX; x <= maxX; x++) {
                const col = map.nodes[x];
                if (!Array.isArray(col)) continue;
                for (let y = minY; y <= maxY; y++) {
                    const node = col[y];
                    if (shouldRenderNode && !shouldRenderNode(node)) {
                        skippedByRenderFilter += 1;
                        continue;
                    }
                    if (node) {
                        nodes.push(node);
                        fallbackNodes += 1;
                    }
                }
            }
            this.setFrameMetric("visibleNodes", nodes.length);
            this.setFrameMetric("visibleNodesWrapped", wrappedNodes);
            this.setFrameMetric("visibleNodesFallback", fallbackNodes);
            this.setFrameMetric("visibleNodeFilterSkipped", skippedByRenderFilter);
            this.setFrameMetric("visibleNodeFallbackUsed", fallbackNodes > 0 ? 1 : 0);
            return nodes;
        }

        syncOnscreenObjectsCache(ctx, visibleNodes, visibleObjectsOverride = null) {
            const cache = (typeof global.onscreenObjects !== "undefined") ? global.onscreenObjects : null;
            if (!cache || typeof cache.clear !== "function" || typeof cache.add !== "function") return;
            cache.clear();

            const visibleObjects = Array.isArray(visibleObjectsOverride)
                ? visibleObjectsOverride
                : this.collectVisibleObjects(visibleNodes, ctx);
            let cacheObjectsAdded = 0;
            for (let i = 0; i < visibleObjects.length; i++) {
                const obj = visibleObjects[i];
                if (!obj || obj.gone || obj.vanishing) continue;
                cache.add(obj);
                cacheObjectsAdded += 1;
            }

            const roofList = this.getRoofsList(ctx);
            let cacheRoofsAdded = 0;
            for (let i = 0; i < roofList.length; i++) {
                const roofRef = roofList[i];
                if (!roofRef || roofRef.gone || !roofRef.placed || !roofRef.pixiMesh || !roofRef.pixiMesh.visible) continue;
                cache.add(roofRef);
                cacheRoofsAdded += 1;
            }
            this.setFrameMetric("onscreenCacheObjects", cacheObjectsAdded);
            this.setFrameMetric("onscreenCacheRoofs", cacheRoofsAdded);
        }

        shouldUseDepthBillboard(item) {
            if (!item || item.gone || item.vanishing) return false;
            if (item.type === "road" || item.type === "roof" || item.type === "wallSection") {
                return false;
            }
            if (item.type === "triggerArea" || item.isTriggerArea === true) {
                return false;
            }
            const category = (typeof item.category === "string") ? item.category.trim().toLowerCase() : "";
            const isSpatialDoorOrWindow = !!(
                item.rotationAxis === "spatial" &&
                (category === "windows" || category === "doors" || item.type === "window" || item.type === "door")
            );
            const isWallMountedSpatial = this.isWallMountedSpatialItem(item);
            if (item.rotationAxis === "spatial" && !isSpatialDoorOrWindow) return false;
            if (typeof item.updateDepthBillboardMesh !== "function") return false;
            const sprite = item.pixiSprite;
            if (!sprite && !(typeof item.texturePath === "string" && item.texturePath.length > 0)) return false;
            return true;
        }

        applyScriptBrightness(item, displayObj = null) {
            if (!item) return;
            const scriptingApi = (typeof global.Scripting !== "undefined" && global.Scripting)
                ? global.Scripting
                : ((typeof Scripting !== "undefined" && Scripting) ? Scripting : null);
            if (!scriptingApi || typeof scriptingApi.applyTargetBrightness !== "function") return;
            scriptingApi.applyTargetBrightness(item, displayObj);
        }

        applyFrozenTint(item, displayObj = null) {
            if (!item) return;
            const nowMs = Date.now();
            const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));
            const fullyFrozenBaseTint = 0x2222ff;
            const freezeBrightnessFilterKey = "__freezeBrightnessFilter";
            const freezeTemperatureRecoverRateDegreesPerSecond = 1;
            const frozenUntilMs = Number(item._freezeTintUntilMs);
            const degreesBelowBaseline = (typeof item.getDegreesBelowBaseline === "function")
                ? Math.max(0, Number(item.getDegreesBelowBaseline()) || 0)
                : 0;
            const baselineTemperature = (typeof item.getTemperatureBaseline === "function")
                ? Number(item.getTemperatureBaseline())
                : Number(item.baselineTemperature);
            const freezeThreshold = (typeof item.getFreezeTemperatureThreshold === "function")
                ? Number(item.getFreezeTemperatureThreshold())
                : -20;
            const fullFreezeDegrees = Math.max(
                1,
                Number.isFinite(baselineTemperature) && Number.isFinite(freezeThreshold)
                    ? Math.abs(baselineTemperature - freezeThreshold)
                    : 20
            );
            const isDead = item.dead === true;
            const isTemperatureFrozen = typeof item.isTemperatureFrozen === "function" && item.isTemperatureFrozen();
            const hasFreezeFlash = Number.isFinite(frozenUntilMs) && frozenUntilMs > nowMs;
            const deadFreezeFadeCompleted = isDead && item._freezeDeathFadeCompleted === true;
            const liveTemperatureFreezeProgress = clamp01(degreesBelowBaseline / fullFreezeDegrees);
            const liveFreezeProgress = deadFreezeFadeCompleted
                ? 0
                : Math.max(liveTemperatureFreezeProgress, hasFreezeFlash ? 0.35 : 0);
            const hadFrozenVisualState = !!(
                !deadFreezeFadeCompleted && (
                    liveFreezeProgress > 1e-6 ||
                    Number.isFinite(item._freezeOriginalTint) ||
                    Number.isFinite(item._freezeDeathFadeStartedAtMs) ||
                    Number.isFinite(item._freezeDeathFadeInitialDegreesBelow)
                )
            );
            if (isDead && hadFrozenVisualState && !Number.isFinite(item._freezeDeathFadeStartedAtMs)) {
                item._freezeDeathFadeStartedAtMs = nowMs;
                item._freezeDeathFadeInitialDegreesBelow = Math.max(0, liveFreezeProgress * fullFreezeDegrees);
                item._freezeDeathFadeCompleted = false;
            } else if (!isDead && Number.isFinite(item._freezeDeathFadeStartedAtMs)) {
                item._freezeDeathFadeStartedAtMs = null;
                item._freezeDeathFadeInitialDegreesBelow = null;
                item._freezeDeathFadeCompleted = null;
            }
            const deathFadeStartMs = Number(item._freezeDeathFadeStartedAtMs);
            const deathFadeInitialDegreesBelow = Number(item._freezeDeathFadeInitialDegreesBelow);
            const corpseDegreesBelowBaseline = (isDead && Number.isFinite(deathFadeStartMs))
                ? Math.max(
                    0,
                    (Number.isFinite(deathFadeInitialDegreesBelow)
                        ? deathFadeInitialDegreesBelow
                        : (liveFreezeProgress * fullFreezeDegrees)) -
                    (((nowMs - deathFadeStartMs) / 1000) * freezeTemperatureRecoverRateDegreesPerSecond)
                )
                : null;
            const freezeProgress = isDead
                ? clamp01((Number.isFinite(corpseDegreesBelowBaseline) ? corpseDegreesBelowBaseline : 0) / fullFreezeDegrees)
                : liveFreezeProgress;
            const shouldRenderFrozen = hadFrozenVisualState && freezeProgress > 1e-6;
            const targetTint = Number.isFinite(item._freezeTintColor)
                ? Math.max(0, Math.min(0xFFFFFF, Math.floor(Number(item._freezeTintColor))))
                : 0x9fd8ff;
            const baseTint = Number.isFinite(item.tint)
                ? Math.max(0, Math.min(0xFFFFFF, Math.floor(Number(item.tint))))
                : (Number.isFinite(item._freezeOriginalTint) ? Number(item._freezeOriginalTint) : 0xFFFFFF);
            const displayObjects = new Set();
            if (displayObj && typeof displayObj === "object") displayObjects.add(displayObj);
            if (item.pixiSprite && typeof item.pixiSprite === "object") displayObjects.add(item.pixiSprite);
            if (item._renderingDepthMesh && typeof item._renderingDepthMesh === "object") displayObjects.add(item._renderingDepthMesh);
            if (item._renderingDisplayObject && typeof item._renderingDisplayObject === "object") displayObjects.add(item._renderingDisplayObject);
            if (item._compositeUnderlayMesh && typeof item._compositeUnderlayMesh === "object") displayObjects.add(item._compositeUnderlayMesh);

            if (shouldRenderFrozen) {
                if (!Number.isFinite(item._freezeOriginalTint)) {
                    const currentTint = Number.isFinite(item.tint)
                        ? Number(item.tint)
                        : (item.pixiSprite && Number.isFinite(item.pixiSprite.tint) ? Number(item.pixiSprite.tint) : 0xFFFFFF);
                    item._freezeOriginalTint = Math.max(0, Math.min(0xFFFFFF, Math.floor(currentTint)));
                }
                const blendColor = (fromColor, toColor, factor) => {
                    const t = Math.max(0, Math.min(1, Number(factor) || 0));
                    const fromR = (fromColor >> 16) & 0xFF;
                    const fromG = (fromColor >> 8) & 0xFF;
                    const fromB = fromColor & 0xFF;
                    const toR = (toColor >> 16) & 0xFF;
                    const toG = (toColor >> 8) & 0xFF;
                    const toB = toColor & 0xFF;
                    const r = Math.round(fromR + ((toR - fromR) * t));
                    const g = Math.round(fromG + ((toG - fromG) * t));
                    const b = Math.round(fromB + ((toB - fromB) * t));
                    return (r << 16) | (g << 8) | b;
                };
                const applyFreezeBrightness = (obj, brightnessPercent = null) => {
                    if (!obj || typeof obj !== "object") return;
                    if (
                        obj.shader &&
                        obj.shader.uniforms &&
                        Object.prototype.hasOwnProperty.call(obj.shader.uniforms, "uBrightness")
                    ) {
                        obj.shader.uniforms.uBrightness = Number.isFinite(brightnessPercent)
                            ? Math.max(-1, Math.min(1, Number(brightnessPercent) / 100))
                            : 0;
                        return;
                    }
                    const pixiScope = (typeof PIXI !== "undefined" && PIXI)
                        ? PIXI
                        : ((typeof globalThis !== "undefined" && globalThis.PIXI) ? globalThis.PIXI : null);
                    const ColorMatrixFilterCtor = pixiScope && pixiScope.filters && pixiScope.filters.ColorMatrixFilter;
                    const SpriteCtor = pixiScope && pixiScope.Sprite;
                    const currentFilters = Array.isArray(obj.filters) ? obj.filters.filter(Boolean) : [];
                    const existingFilter = obj[freezeBrightnessFilterKey];
                    const retainedFilters = currentFilters.filter(filter => filter !== existingFilter);
                    const isSprite = (typeof SpriteCtor === "function") && (obj instanceof SpriteCtor);
                    if (!isSprite || typeof ColorMatrixFilterCtor !== "function") {
                        obj[freezeBrightnessFilterKey] = null;
                        obj.filters = retainedFilters.length > 0 ? retainedFilters : null;
                        return;
                    }
                    if (!(Number.isFinite(brightnessPercent) && brightnessPercent > 1e-6)) {
                        obj[freezeBrightnessFilterKey] = null;
                        obj.filters = retainedFilters.length > 0 ? retainedFilters : null;
                        return;
                    }
                    const normalized = clamp01(Number(brightnessPercent) / 100);
                    const whiteMix = 0.55 * normalized;
                    const scale = 1 - whiteMix;
                    const filter = (existingFilter instanceof ColorMatrixFilterCtor)
                        ? existingFilter
                        : new ColorMatrixFilterCtor();
                    filter.matrix = [
                        scale, 0, 0, 0, whiteMix,
                        0, scale, 0, 0, whiteMix,
                        0, 0, scale, 0, whiteMix,
                        0, 0, 0, 1, 0
                    ];
                    obj[freezeBrightnessFilterKey] = filter;
                    retainedFilters.push(filter);
                    obj.filters = retainedFilters;
                };
                const freezeFadeScale = (isDead && liveFreezeProgress > 1e-6)
                    ? clamp01(freezeProgress / liveFreezeProgress)
                    : 1;
                const impactFlashBlend = (hasFreezeFlash ? 1 : 0) * freezeFadeScale;
                const coldTintBlend = Math.max(
                    (!isDead && isTemperatureFrozen ? 1 : 0),
                    clamp01(0.2 + (freezeProgress * 0.8))
                );
                const intermediateTint = blendColor(baseTint, targetTint, Math.max(impactFlashBlend, coldTintBlend));
                const appliedTint = blendColor(intermediateTint, fullyFrozenBaseTint, freezeProgress);
                const appliedBrightness = 35 * freezeProgress;
                displayObjects.forEach(obj => {
                    if (Number.isFinite(obj.tint)) obj.tint = appliedTint;
                    applyFreezeBrightness(obj, appliedBrightness);
                });
                return;
            }

            if (
                Number.isFinite(item._freezeOriginalTint) ||
                Number.isFinite(frozenUntilMs) ||
                Number.isFinite(item._freezeDeathFadeStartedAtMs) ||
                item._freezeDeathFadeCompleted === true
            ) {
                displayObjects.forEach(obj => {
                    if (Number.isFinite(obj.tint)) obj.tint = baseTint;
                    if (
                        obj &&
                        typeof obj === "object" &&
                        obj.shader &&
                        obj.shader.uniforms &&
                        Object.prototype.hasOwnProperty.call(obj.shader.uniforms, "uBrightness")
                    ) {
                        obj.shader.uniforms.uBrightness = 0;
                    }
                    if (obj && typeof obj === "object" && Object.prototype.hasOwnProperty.call(obj, freezeBrightnessFilterKey)) {
                        const currentFilters = Array.isArray(obj.filters) ? obj.filters.filter(Boolean) : [];
                        const existingFilter = obj[freezeBrightnessFilterKey];
                        const retainedFilters = currentFilters.filter(filter => filter !== existingFilter);
                        obj[freezeBrightnessFilterKey] = null;
                        obj.filters = retainedFilters.length > 0 ? retainedFilters : null;
                    }
                });
                item._freezeTintUntilMs = 0;
                item._freezeTintColor = null;
                item._freezeOriginalTint = null;
                item._freezeDeathFadeStartedAtMs = null;
                item._freezeDeathFadeInitialDegreesBelow = null;
                item._freezeDeathFadeCompleted = isDead ? true : null;
            }
        }

        isDebugModeEnabled() {
            return !!(
                (typeof debugMode !== "undefined" && debugMode) ||
                global.debugMode
            );
        }

        shouldRevealScriptHiddenInDebug(item) {
            return !!(item && item.visible === false && this.isDebugModeEnabled());
        }

        isScriptVisible(item) {
            if (!(item && item.visible === false)) return true;
            return this.shouldRevealScriptHiddenInDebug(item);
        }

        getScriptDisplayAlpha(item) {
            if (this.shouldRevealScriptHiddenInDebug(item)) {
                return 0.35;
            }
            return 1;
        }

        isForceVisible(item) {
            if (!item) return false;
            if (item.forceVisible === true || item._forceVisible === true) return true;
            if (item.forceVisible === 1 || item._forceVisible === 1) return true;
            if (typeof item.forceVisible === "string" && item.forceVisible.trim().toLowerCase() === "true") return true;
            if (typeof item._forceVisible === "string" && item._forceVisible.trim().toLowerCase() === "true") return true;
            return false;
        }

        updateSinkAnimation(item, nowMs = null) {
            if (!item || typeof item !== "object") return 0;
            const sinkState = (item._scriptSinkState && typeof item._scriptSinkState === "object")
                ? item._scriptSinkState
                : null;
            if (!sinkState) return 0;
            const baseProperty = (typeof sinkState.baseProperty === "string" && sinkState.baseProperty.length > 0)
                ? sinkState.baseProperty
                : (item.type === "wallSection" ? "bottomZ" : "z");
            const startBase = Number.isFinite(sinkState.startBase) ? Number(sinkState.startBase) : 0;
            const targetBase = Number.isFinite(sinkState.targetBase) ? Number(sinkState.targetBase) : startBase;
            const durationMs = Number.isFinite(sinkState.durationMs) ? Math.max(0, Number(sinkState.durationMs)) : 0;
            const candidateNowMs = Number.isFinite(nowMs) ? Number(nowMs) : NaN;
            const currentMs = (Number.isFinite(candidateNowMs) && candidateNowMs > 1e12)
                ? candidateNowMs
                : Date.now();
            const pausedUntilMs = Number(item._scriptPausedUntilMs);
            const frozenUntilMs = Number(item._scriptFrozenUntilMs);
            const blockedUntilMs = Math.max(
                Number.isFinite(pausedUntilMs) ? pausedUntilMs : 0,
                frozenUntilMs > 0 ? frozenUntilMs : 0
            );
            const wasBlocked = blockedUntilMs > currentMs;
            const lastUpdateMs = Number.isFinite(sinkState.lastUpdateMs) ? Number(sinkState.lastUpdateMs) : currentMs;
            if (!wasBlocked) {
                const deltaMs = Math.max(0, currentMs - lastUpdateMs);
                sinkState.elapsedMs = Math.max(0, Number(sinkState.elapsedMs) || 0) + deltaMs;
            }
            sinkState.lastUpdateMs = currentMs;
            const animationProgress = durationMs > 0
                ? Math.max(0, Math.min(1, (Number(sinkState.elapsedMs) || 0) / durationMs))
                : 1;
            const startProgress = Number.isFinite(sinkState.startProgress)
                ? Math.max(0, Math.min(1, Number(sinkState.startProgress)))
                : 0;
            const targetProgress = Number.isFinite(sinkState.targetProgress)
                ? Math.max(0, Math.min(1, Number(sinkState.targetProgress)))
                : 1;
            const progress = startProgress + ((targetProgress - startProgress) * animationProgress);
            const nextBase = startBase + (targetBase - startBase) * animationProgress;
            const prevBase = Number.isFinite(item[baseProperty]) ? Number(item[baseProperty]) : startBase;
            const heightProperty = (typeof sinkState.heightProperty === "string" && sinkState.heightProperty.length > 0)
                ? sinkState.heightProperty
                : "";
            const startHeight = Number.isFinite(sinkState.startHeight) ? Math.max(0, Number(sinkState.startHeight)) : NaN;
            const targetHeight = Number.isFinite(sinkState.targetHeight) ? Math.max(0, Number(sinkState.targetHeight)) : NaN;
            const prevHeight = (heightProperty && Number.isFinite(item[heightProperty]))
                ? Math.max(0, Number(item[heightProperty]))
                : NaN;
            item[baseProperty] = nextBase;
            if (baseProperty === "z") {
                if (Number.isFinite(item.prevZ) || Object.prototype.hasOwnProperty.call(item, "prevZ")) {
                    item.prevZ = nextBase;
                }
                if (Number.isFinite(item.heightFromGround) || item.type === "roof") {
                    item.heightFromGround = nextBase;
                }
            }
            const nextHeight = (heightProperty && Number.isFinite(startHeight) && Number.isFinite(targetHeight))
                ? Math.max(0, startHeight + ((targetHeight - startHeight) * animationProgress))
                : NaN;
            if (heightProperty && Number.isFinite(startHeight)) {
                item[heightProperty] = nextHeight;
            }
            if (
                (baseProperty === "bottomZ" && Math.abs(nextBase - prevBase) > 1e-6) ||
                (heightProperty && Number.isFinite(prevHeight) && Number.isFinite(nextHeight) && Math.abs(nextHeight - prevHeight) > 1e-6)
            ) {
                if (Object.prototype.hasOwnProperty.call(item, "mesh3d")) {
                    item.mesh3d = null;
                }
                if (Object.prototype.hasOwnProperty.call(item, "_depthGeometryCache")) {
                    item._depthGeometryCache = null;
                }
            }
            sinkState.progress = progress;
            sinkState.currentBase = nextBase;
            const prevNonBlocking = !!sinkState.nonBlocking;
            const prevLosTransparent = !!sinkState.losTransparent;
            if (typeof globalThis !== "undefined" && typeof globalThis.syncTargetSinkInteractionState === "function") {
                globalThis.syncTargetSinkInteractionState(item);
            }
            if (
                (prevNonBlocking !== !!sinkState.nonBlocking || prevLosTransparent !== !!sinkState.losTransparent) &&
                typeof globalThis !== "undefined" &&
                typeof globalThis.refreshTargetSinkBlocking === "function"
            ) {
                globalThis.refreshTargetSinkBlocking(item);
            }
            sinkState.active = animationProgress < 1;
            if (animationProgress >= 1 && sinkState.nonBlocking === false) {
                if (typeof globalThis !== "undefined" && typeof globalThis.restoreTargetSinkBlockingState === "function") {
                    globalThis.restoreTargetSinkBlockingState(item, sinkState);
                }
                item._scriptSinkState = null;
            }
            return progress;
        }

        clearSinkClip(item, displayObj = null) {
            const obj = displayObj || (item && item._renderingDisplayObject) || null;
            if (obj && obj.mask && item && item._scriptSinkMaskGraphics && obj.mask === item._scriptSinkMaskGraphics) {
                obj.mask = null;
            }
            if (item && item._scriptSinkMaskGraphics) {
                item._scriptSinkMaskGraphics.clear();
                item._scriptSinkMaskGraphics.visible = false;
                if (Object.prototype.hasOwnProperty.call(item._scriptSinkMaskGraphics, "renderable")) {
                    item._scriptSinkMaskGraphics.renderable = false;
                }
            }
        }

        applySinkClip(item, displayObj = null) {
            if (!item || !displayObj) return true;
            const sinkState = (item._scriptSinkState && typeof item._scriptSinkState === "object")
                ? item._scriptSinkState
                : null;
            const progress = sinkState && Number.isFinite(sinkState.progress)
                ? Math.max(0, Math.min(1, Number(sinkState.progress)))
                : 0;
            if (progress <= 1e-4) {
                this.clearSinkClip(item, displayObj);
                return true;
            }
            const visibleRatio = Math.max(0, 1 - progress);
            if (visibleRatio <= 1e-4) {
                this.clearSinkClip(item, displayObj);
                displayObj.visible = false;
                if (Object.prototype.hasOwnProperty.call(displayObj, "renderable")) {
                    displayObj.renderable = false;
                }
                return false;
            }
            displayObj.visible = true;
            if (Object.prototype.hasOwnProperty.call(displayObj, "renderable")) {
                displayObj.renderable = true;
            }
            if (!displayObj.parent || typeof displayObj.getBounds !== "function" || typeof PIXI === "undefined") {
                return true;
            }
            if (displayObj instanceof PIXI.Mesh) {
                this.clearSinkClip(item, displayObj);
                return true;
            }
            if (!item._scriptSinkMaskGraphics) {
                item._scriptSinkMaskGraphics = new PIXI.Graphics();
                item._scriptSinkMaskGraphics.name = "renderingSinkMask";
                item._scriptSinkMaskGraphics.interactive = false;
            }
            const maskGraphics = item._scriptSinkMaskGraphics;
            if (maskGraphics.parent !== displayObj.parent) {
                displayObj.parent.addChild(maskGraphics);
            }
            const bounds = displayObj.getBounds();
            if (!bounds || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y) ||
                !Number.isFinite(bounds.width) || !Number.isFinite(bounds.height) ||
                bounds.width <= 0 || bounds.height <= 0) {
                this.clearSinkClip(item, displayObj);
                return true;
            }
            const groundPoint = (
                this.camera &&
                Number.isFinite(item.x) &&
                Number.isFinite(item.y) &&
                typeof this.camera.worldToScreen === "function"
            )
                ? this.camera.worldToScreen(Number(item.x), Number(item.y), 0)
                : null;
            const clipBottom = (groundPoint && Number.isFinite(groundPoint.y))
                ? Math.min(bounds.y + bounds.height, Number(groundPoint.y))
                : (bounds.y + Math.max(0.5, bounds.height * visibleRatio));
            const visibleHeight = clipBottom - bounds.y;
            if (!(visibleHeight > 0.5)) {
                this.clearSinkClip(item, displayObj);
                displayObj.visible = false;
                if (Object.prototype.hasOwnProperty.call(displayObj, "renderable")) {
                    displayObj.renderable = false;
                }
                return false;
            }
            maskGraphics.clear();
            maskGraphics.beginFill(0xffffff, 1);
            maskGraphics.drawRect(bounds.x, bounds.y, bounds.width, visibleHeight);
            maskGraphics.endFill();
            maskGraphics.visible = true;
            if (Object.prototype.hasOwnProperty.call(maskGraphics, "renderable")) {
                maskGraphics.renderable = true;
            }
            displayObj.mask = maskGraphics;
            return true;
        }

        shouldShowTriggerAreaPickerPolygon() {
            const activeSpell = this.getActiveToolSpellName();
            return activeSpell === "editscript";
        }

        isWallBottomFaceOutlineDebugEnabled() {
            const wallCtor = global.WallSectionUnit || null;
            return !!(wallCtor && wallCtor._showBottomFaceOnlyDebug);
        }

        renderDoorBottomFaceDebugOutline(item, container) {
            if (!item || !item.pixiSprite || !container || typeof PIXI === "undefined") return false;
            if (!item._doorBottomFaceDebugGraphics) {
                item._doorBottomFaceDebugGraphics = new PIXI.Graphics();
                item._doorBottomFaceDebugGraphics.name = "renderingDoorBottomFaceDebugOutline";
                item._doorBottomFaceDebugGraphics.visible = false;
                item._doorBottomFaceDebugGraphics.interactive = false;
            }
            this.applySpriteTransform(item);
            const sprite = item.pixiSprite;
            const g = item._doorBottomFaceDebugGraphics;
            if (g.parent !== container) {
                container.addChild(g);
            }
            const width = Number(sprite.width) || 0;
            const height = Number(sprite.height) || 0;
            const x = Number(sprite.x);
            const y = Number(sprite.y);
            if (!(width > 0) || !(height > 0) || !Number.isFinite(x) || !Number.isFinite(y)) {
                g.visible = false;
                return false;
            }
            const anchorX = (sprite.anchor && Number.isFinite(sprite.anchor.x)) ? Number(sprite.anchor.x) : 0.5;
            const anchorY = (sprite.anchor && Number.isFinite(sprite.anchor.y)) ? Number(sprite.anchor.y) : 1;
            g.clear();
            g.position.set(x, y);
            g.rotation = Number(sprite.rotation) || 0;
            g.alpha = this.getScriptDisplayAlpha(item);
            g.lineStyle(2, 0x33cc66, 1);
            g.drawRect(-anchorX * width, -anchorY * height, width, height);
            g.visible = true;
            if (Object.prototype.hasOwnProperty.call(g, "renderable")) {
                g.renderable = true;
            }
            return true;
        }

        getActiveToolSpellName(wizardOverride = null) {
            const wizard = wizardOverride || global.wizard || null;
            if (!wizard) return "";
            if (typeof wizard.currentSpell === "string" && wizard.currentSpell.length > 0) {
                return wizard.currentSpell;
            }
            if (typeof wizard.selectedSpellName === "string" && wizard.selectedSpellName.length > 0) {
                return wizard.selectedSpellName;
            }
            return "";
        }

        shouldShowTriggerAreaToolOutlines(wizardOverride = null) {
            if (this.isDebugModeEnabled()) return true;
            const activeSpell = this.getActiveToolSpellName(wizardOverride);
            if (global.renderingShowPickerScreen) {
                return activeSpell === "editscript";
            }
            return activeSpell === "editscript" || activeSpell === "triggerarea";
        }

        shouldShowTriggerAreaVertexMarkersForTool(wizardOverride = null) {
            const activeSpell = this.getActiveToolSpellName(wizardOverride);
            return activeSpell === "triggerarea";
        }

        isTriggerAreaHighlighted(item) {
            if (!item) return false;
            const pickerApi = (typeof global.renderingScenePicker !== "undefined")
                ? global.renderingScenePicker
                : null;
            if (!pickerApi || typeof pickerApi.getHoveredObject !== "function") return false;
            try {
                return pickerApi.getHoveredObject() === item;
            } catch (_err) {
                return false;
            }
        }

        getTriggerAreaOutlineClipRect() {
            const appRef = (typeof app !== "undefined" && app)
                ? app
                : (global.app || null);
            const screenWidth = Math.max(
                1,
                Number(appRef && appRef.renderer && appRef.renderer.width) ||
                Number(appRef && appRef.screen && appRef.screen.width) ||
                Number(window && window.innerWidth) ||
                1
            );
            const screenHeight = Math.max(
                1,
                Number(appRef && appRef.renderer && appRef.renderer.height) ||
                Number(appRef && appRef.screen && appRef.screen.height) ||
                Number(window && window.innerHeight) ||
                1
            );
            const insetX = Math.max(0, (Number(this.camera && this.camera.viewscale) || 1) * 0.5);
            const insetY = Math.max(0, (Number(this.camera && this.camera.viewscale) || 1) * (Number(this.camera && this.camera.xyratio) || 1) * 0.5);
            const rect = {
                left: insetX,
                top: insetY,
                right: screenWidth - insetX,
                bottom: screenHeight - insetY
            };
            if (!(rect.right > rect.left) || !(rect.bottom > rect.top)) return null;
            return rect;
        }

        clipPolygonAgainstBoundary(points, isInside, intersect) {
            const input = Array.isArray(points) ? points : [];
            if (input.length === 0) return [];
            const output = [];
            let previous = input[input.length - 1];
            let previousInside = !!isInside(previous);
            for (let i = 0; i < input.length; i++) {
                const current = input[i];
                const currentInside = !!isInside(current);
                if (currentInside) {
                    if (!previousInside) {
                        const entry = intersect(previous, current);
                        if (entry) output.push(entry);
                    }
                    output.push(current);
                } else if (previousInside) {
                    const exit = intersect(previous, current);
                    if (exit) output.push(exit);
                }
                previous = current;
                previousInside = currentInside;
            }
            return output;
        }

        clipTriggerAreaScreenPolygon(points, rect) {
            let clipped = Array.isArray(points)
                ? points
                    .filter((pt) => pt && Number.isFinite(pt.x) && Number.isFinite(pt.y))
                    .map((pt) => ({ x: Number(pt.x), y: Number(pt.y) }))
                : [];
            if (!rect || clipped.length < 3) return clipped;
            const intersectVertical = (boundaryX) => (a, b) => {
                const dx = Number(b.x) - Number(a.x);
                if (Math.abs(dx) <= 1e-7) {
                    return { x: boundaryX, y: Number(a.y) };
                }
                const t = (boundaryX - Number(a.x)) / dx;
                return {
                    x: boundaryX,
                    y: Number(a.y) + (Number(b.y) - Number(a.y)) * t
                };
            };
            const intersectHorizontal = (boundaryY) => (a, b) => {
                const dy = Number(b.y) - Number(a.y);
                if (Math.abs(dy) <= 1e-7) {
                    return { x: Number(a.x), y: boundaryY };
                }
                const t = (boundaryY - Number(a.y)) / dy;
                return {
                    x: Number(a.x) + (Number(b.x) - Number(a.x)) * t,
                    y: boundaryY
                };
            };
            clipped = this.clipPolygonAgainstBoundary(clipped, (pt) => Number(pt.x) >= rect.left, intersectVertical(rect.left));
            clipped = this.clipPolygonAgainstBoundary(clipped, (pt) => Number(pt.x) <= rect.right, intersectVertical(rect.right));
            clipped = this.clipPolygonAgainstBoundary(clipped, (pt) => Number(pt.y) >= rect.top, intersectHorizontal(rect.top));
            clipped = this.clipPolygonAgainstBoundary(clipped, (pt) => Number(pt.y) <= rect.bottom, intersectHorizontal(rect.bottom));
            return clipped;
        }

        renderTriggerAreaOmnivisionOutline(item, container, omnivisionActive, wizardOverride = null) {
            if (!item) return;
            if (!item._triggerOutlineGraphics) {
                item._triggerOutlineGraphics = new PIXI.Graphics();
                item._triggerOutlineGraphics.name = "renderingTriggerAreaOutline";
                item._triggerOutlineGraphics.visible = false;
                item._triggerOutlineGraphics.interactive = false;
            }
            const g = item._triggerOutlineGraphics;
            if (g.parent !== container) {
                container.addChild(g);
            }
            g.clear();
            const points = (item.groundPlaneHitbox && Array.isArray(item.groundPlaneHitbox.points))
                ? item.groundPlaneHitbox.points
                : null;
            if (!this.shouldShowTriggerAreaToolOutlines(wizardOverride) || !points || points.length < 3) {
                g.visible = false;
                return;
            }
            const screenPoints = [];
            for (let i = 0; i < points.length; i++) {
                const pt = points[i];
                if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) continue;
                const sp = this.camera.worldToScreen(Number(pt.x), Number(pt.y), 0);
                if (!sp || !Number.isFinite(sp.x) || !Number.isFinite(sp.y)) continue;
                screenPoints.push(sp);
            }
            if (screenPoints.length < 3) {
                g.visible = false;
                return;
            }

            const clippedPoints = this.clipTriggerAreaScreenPolygon(
                screenPoints,
                this.getTriggerAreaOutlineClipRect()
            );
            if (!Array.isArray(clippedPoints) || clippedPoints.length < 2) {
                g.visible = false;
                return;
            }

            const dashLengthPx = 10;
            const gapLengthPx = 6;
            const outlineColor = this.isTriggerAreaHighlighted(item) ? 0x66c2ff : 0xffffff;
            g.lineStyle(3, outlineColor, 1);
            let drewAny = false;
            for (let i = 0; i < clippedPoints.length; i++) {
                const a = clippedPoints[i];
                const b = clippedPoints[(i + 1) % clippedPoints.length];
                const dx = Number(b.x) - Number(a.x);
                const dy = Number(b.y) - Number(a.y);
                const len = Math.hypot(dx, dy);
                if (!(len > 0)) continue;
                const ux = dx / len;
                const uy = dy / len;
                let dist = 0;
                while (dist < len) {
                    const dashStart = dist;
                    const dashEnd = Math.min(len, dist + dashLengthPx);
                    g.moveTo(
                        Number(a.x) + ux * dashStart,
                        Number(a.y) + uy * dashStart
                    );
                    g.lineTo(
                        Number(a.x) + ux * dashEnd,
                        Number(a.y) + uy * dashEnd
                    );
                    drewAny = true;
                    dist += dashLengthPx + gapLengthPx;
                }
            }
            g.visible = drewAny;
        }

        renderTriggerAreaVertexMarkers(item, container, wizardOverride = null) {
            if (!item) return;
            if (!item._triggerVertexGraphics) {
                item._triggerVertexGraphics = new PIXI.Graphics();
                item._triggerVertexGraphics.name = "renderingTriggerAreaVertices";
                item._triggerVertexGraphics.visible = false;
                item._triggerVertexGraphics.interactive = false;
            }
            const g = item._triggerVertexGraphics;
            if (g.parent !== container) {
                container.addChild(g);
            }
            g.clear();
            const points = (item.groundPlaneHitbox && Array.isArray(item.groundPlaneHitbox.points))
                ? item.groundPlaneHitbox.points
                : null;
            if (!this.shouldShowTriggerAreaVertexMarkersForTool(wizardOverride) || !points || points.length < 3) {
                g.visible = false;
                return;
            }

            const wizard = global.wizard || null;
            const spellSystemRef = (typeof SpellSystem !== "undefined")
                ? SpellSystem
                : (global.SpellSystem || null);
            const selection = (
                wizard &&
                spellSystemRef &&
                typeof spellSystemRef.getTriggerAreaVertexSelection === "function"
            )
                ? spellSystemRef.getTriggerAreaVertexSelection(wizard)
                : null;

            g.lineStyle(2, 0xffffff, 1);
            for (let i = 0; i < points.length; i++) {
                const pt = points[i];
                if (!pt || !Number.isFinite(pt.x) || !Number.isFinite(pt.y)) continue;
                const sp = this.camera.worldToScreen(Number(pt.x), Number(pt.y), 0);
                if (!sp || !Number.isFinite(sp.x) || !Number.isFinite(sp.y)) continue;
                const isSelected = !!(selection && selection.area === item && selection.vertexIndex === i);
                g.drawCircle(sp.x, sp.y, isSelected ? 10 : 6);
            }
            g.visible = true;
        }

        renderDepthBillboardObjects(ctx, renderItems) {
            const container = this.layers.depthObjects;
            const characterContainer = this.getCharacterLayer() || container;
            const groundContainer = this.layers.groundObjects;
            if (!container) return new Set();
            const depthRenderedItems = new Set();
            const currentMeshes = new Set();
            const currentItems = new Set();
            const wizardRef = (ctx && ctx.wizard) || global.wizard || null;
            const mazeModeForDepth = this.isLosMazeModeEnabled() && !this.isOmnivisionActive(wizardRef);
            let depthCandidates = 0;
            let depthMissingMountedSection = 0;
            let depthHiddenByScript = 0;
            let depthDoorBottomOutlineOnly = 0;

            for (let i = 0; i < renderItems.length; i++) {
                const item = renderItems[i];
                if (!this.shouldUseDepthBillboard(item)) continue;
                depthCandidates += 1;
                // Windows on top-face-only roof walls should be hidden; doors remain visible.
                if (this.isWallMountedSpatialItem(item)) {
                    const _mountedSection = this.resolveMountedWallSectionForItem(item);
                    // Section streaming can temporarily leave a mounted door/window alive
                    // while its backing wall section is unloaded. In that state, falling
                    // back to the single-plane depth billboard uses raw sprite pixel
                    // dimensions and renders at the wrong size, so keep it hidden until
                    // the mounted wall is present again.
                    if (!_mountedSection) {
                        if (item.pixiSprite) {
                            item.pixiSprite.visible = false;
                            if (Object.prototype.hasOwnProperty.call(item.pixiSprite, "renderable")) {
                                item.pixiSprite.renderable = false;
                            }
                        }
                        if (item.fireSprite) {
                            item.fireSprite.visible = false;
                            if (Object.prototype.hasOwnProperty.call(item.fireSprite, "renderable")) {
                                item.fireSprite.renderable = false;
                            }
                        }
                        if (item._renderingDepthMesh) {
                            item._renderingDepthMesh.visible = false;
                        }
                        if (item._compositeUnderlayMesh) {
                            item._compositeUnderlayMesh.visible = false;
                            if (Object.prototype.hasOwnProperty.call(item._compositeUnderlayMesh, "renderable")) {
                                item._compositeUnderlayMesh.renderable = false;
                            }
                        }
                        if (item._doorBottomFaceDebugGraphics) {
                            item._doorBottomFaceDebugGraphics.visible = false;
                            if (Object.prototype.hasOwnProperty.call(item._doorBottomFaceDebugGraphics, "renderable")) {
                                item._doorBottomFaceDebugGraphics.renderable = false;
                            }
                        }
                        depthMissingMountedSection += 1;
                        depthRenderedItems.add(item);
                        continue;
                    }
                    const _itemCat = (typeof item.category === "string") ? item.category.trim().toLowerCase() : "";
                    if (_itemCat === "windows" || item.type === "window") {
                        if (_mountedSection && _mountedSection._roofForceTopFace) {
                            if (item.pixiSprite) {
                                item.pixiSprite.visible = false;
                                if (Object.prototype.hasOwnProperty.call(item.pixiSprite, "renderable")) item.pixiSprite.renderable = false;
                            }
                            if (item.fireSprite) {
                                item.fireSprite.visible = false;
                                if (Object.prototype.hasOwnProperty.call(item.fireSprite, "renderable")) item.fireSprite.renderable = false;
                            }
                            if (item._renderingDepthMesh) {
                                item._renderingDepthMesh.visible = false;
                            }
                            if (item._compositeUnderlayMesh) {
                                item._compositeUnderlayMesh.visible = false;
                            }
                            depthRenderedItems.add(item);
                            continue;
                        }
                    }
                }
                if (!this.isScriptVisible(item)) {
                    depthHiddenByScript += 1;
                    if (item.pixiSprite) {
                        item.pixiSprite.visible = false;
                        if (Object.prototype.hasOwnProperty.call(item.pixiSprite, "renderable")) {
                            item.pixiSprite.renderable = false;
                        }
                    }
                    if (item.fireSprite) {
                        item.fireSprite.visible = false;
                        if (Object.prototype.hasOwnProperty.call(item.fireSprite, "renderable")) {
                            item.fireSprite.renderable = false;
                        }
                    }
                    if (item._compositeUnderlayMesh) {
                        item._compositeUnderlayMesh.visible = false;
                    }
                    continue;
                }
                if (typeof item.updateSpriteAnimation === "function") {
                    item.updateSpriteAnimation();
                }
                const sprite = item.pixiSprite;
                const disableMazeDepthVariant = this.isWallMountedSpatialItem(item);
                const category = (typeof item.category === "string") ? item.category.trim().toLowerCase() : "";
                const isMountedDoor = !!(
                    disableMazeDepthVariant &&
                    (category === "doors" || item.type === "door")
                );
                const showDoorBottomDebugOutline = !!(
                    isMountedDoor &&
                    this.isWallBottomFaceOutlineDebugEnabled()
                );
                let forceMountedWallSide = null;
                if (isMountedDoor) {
                    const mountedSection = this.resolveMountedWallSectionForItem(item);
                    const isBottomFaceOnly = !!(
                        (mazeModeForDepth && mountedSection && typeof mountedSection.isBottomOnlyVisibleInMazeMode === "function" &&
                            mountedSection.isBottomOnlyVisibleInMazeMode({ player: wizardRef, camera: this.camera })) ||
                        (mountedSection && mountedSection._roofForceTopFace)
                    );
                    if (isBottomFaceOnly) {
                        forceMountedWallSide = "center";
                    }
                }
                if (showDoorBottomDebugOutline) {
                    depthDoorBottomOutlineOnly += 1;
                    const itemContainer = this.isCharacterRenderItem(item) ? characterContainer : container;
                    const targetContainer = (item.rotationAxis === "ground" && groundContainer)
                        ? groundContainer
                        : itemContainer;
                    const outlineVisible = this.renderDoorBottomFaceDebugOutline(item, targetContainer);
                    if (item._renderingDepthMesh) {
                        if (item._renderingDepthMesh.parent) {
                            item._renderingDepthMesh.parent.removeChild(item._renderingDepthMesh);
                        }
                        item._renderingDepthMesh.visible = false;
                        item._renderingDepthMesh = null;
                    }
                    if (item._compositeUnderlayMesh) {
                        item._compositeUnderlayMesh.visible = false;
                        if (Object.prototype.hasOwnProperty.call(item._compositeUnderlayMesh, "renderable")) {
                            item._compositeUnderlayMesh.renderable = false;
                        }
                    }
                    if (sprite) {
                        sprite.visible = false;
                        if (Object.prototype.hasOwnProperty.call(sprite, "renderable")) {
                            sprite.renderable = false;
                        }
                    }
                    if (item.fireSprite) {
                        item.fireSprite.visible = false;
                        if (Object.prototype.hasOwnProperty.call(item.fireSprite, "renderable")) {
                            item.fireSprite.renderable = false;
                        }
                    }
                    currentItems.add(item);
                    depthRenderedItems.add(item);
                    if (outlineVisible && item._doorBottomFaceDebugGraphics) {
                        currentMeshes.add(item._doorBottomFaceDebugGraphics);
                        this.addPickRenderItem(item, item._doorBottomFaceDebugGraphics, { forceInclude: true });
                    }
                    continue;
                }
                const mesh = item.updateDepthBillboardMesh(ctx, this.camera, {
                    alphaCutoff: TREE_ALPHA_CUTOFF,
                    mazeMode: disableMazeDepthVariant ? false : mazeModeForDepth,
                    player: wizardRef,
                    forceMountedWallSide
                });
                if (!mesh) continue;
                item._renderingDepthMesh = mesh;

                const itemContainer = this.isCharacterRenderItem(item) ? characterContainer : container;

                const targetContainer = (item.rotationAxis === "ground" && groundContainer)
                    ? groundContainer
                    : itemContainer;

                // Add composite underlay mesh BEFORE the main mesh so it renders behind
                const underlayMesh = item._compositeUnderlayMesh;
                if (underlayMesh && !underlayMesh.destroyed && item._compositeUnderlayShouldRender) {
                    if (underlayMesh.parent !== targetContainer) {
                        targetContainer.addChild(underlayMesh);
                    }
                    underlayMesh.visible = true;
                    underlayMesh.alpha = this.getScriptDisplayAlpha(item);
                    if (Object.prototype.hasOwnProperty.call(underlayMesh, "renderable")) {
                        underlayMesh.renderable = true;
                    }
                    if (this.applySinkClip(item, underlayMesh)) {
                        currentMeshes.add(underlayMesh);
                    }
                } else if (underlayMesh && !underlayMesh.destroyed) {
                    underlayMesh.visible = false;
                    if (Object.prototype.hasOwnProperty.call(underlayMesh, "renderable")) {
                        underlayMesh.renderable = false;
                    }
                }

                if (mesh.parent !== targetContainer) {
                    targetContainer.addChild(mesh);
                }
                mesh.visible = true;
                mesh.alpha = this.getScriptDisplayAlpha(item);
                if (Object.prototype.hasOwnProperty.call(mesh, "renderable")) {
                    mesh.renderable = true;
                }
                this.applyScriptBrightness(item, mesh);
                this.applyFrozenTint(item, mesh);
                currentItems.add(item);
                depthRenderedItems.add(item);
                const meshVisibleAfterSinkClip = this.applySinkClip(item, mesh);
                if (meshVisibleAfterSinkClip) {
                    currentMeshes.add(mesh);
                }
                // Use the same depth billboard mesh for picker hits so picker-screen
                // occlusion matches the regular depth-rendered scene (trees included).
                if (meshVisibleAfterSinkClip) {
                    this.addPickRenderItem(item, mesh, { forceInclude: true });
                }
                if (item._doorBottomFaceDebugGraphics) {
                    item._doorBottomFaceDebugGraphics.visible = false;
                    if (Object.prototype.hasOwnProperty.call(item._doorBottomFaceDebugGraphics, "renderable")) {
                        item._doorBottomFaceDebugGraphics.renderable = false;
                    }
                }

                // Hide legacy sprite when depth mesh is active.
                sprite.visible = false;
                if (Object.prototype.hasOwnProperty.call(sprite, "renderable")) {
                    sprite.renderable = false;
                }

                // Position fire sprite overlay if present
                if (item.fireSprite) {
                    const fireSprite = item.fireSprite;
                    const fireContainer = targetContainer || itemContainer;
                    if (fireSprite.parent !== fireContainer) {
                        fireContainer.addChild(fireSprite);
                    }
                    if (fireContainer && mesh && typeof fireContainer.getChildIndex === "function" && typeof fireContainer.setChildIndex === "function") {
                        const meshIndex = fireContainer.getChildIndex(mesh);
                        const maxIndex = Math.max(0, fireContainer.children.length - 1);
                        const desiredIndex = Math.min(meshIndex + 1, maxIndex);
                        if (fireContainer.getChildIndex(fireSprite) !== desiredIndex) {
                            fireContainer.setChildIndex(fireSprite, desiredIndex);
                        }
                    }

                    let fp = null;
                    if (item.type === "tree") {
                        fireSprite.anchor.set(0.5, 1);
                        const worldPositions = item._depthBillboardWorldPositions;
                        if (worldPositions && worldPositions.length >= 12) {
                            // Use a point 1/3 down from the crown (TR/TL midpoint toward BL/BR midpoint).
                            // worldPositions layout: BL[0-2], BR[3-5], TR[6-8], TL[9-11]
                            const crownX = (worldPositions[6] + worldPositions[9]) / 2;
                            const crownY = (worldPositions[7] + worldPositions[10]) / 2;
                            const crownZ = (worldPositions[8] + worldPositions[11]) / 2;
                            const baseX = (worldPositions[0] + worldPositions[3]) / 2;
                            const baseY = (worldPositions[1] + worldPositions[4]) / 2;
                            const baseZ = (worldPositions[2] + worldPositions[5]) / 2;
                            const t = 1 / 3; // fraction down from crown
                            const tx = crownX + (baseX - crownX) * t;
                            const ty = crownY + (baseY - crownY) * t;
                            const tz = crownZ + (baseZ - crownZ) * t;
                            fp = this.camera.worldToScreen(tx, ty, tz);
                        } else {
                            const treeWidth = Number.isFinite(item.width) ? item.width : 4;
                            const treeHeight = Number.isFinite(item.height) ? item.height : 4;
                            const anchorX = (item.pixiSprite && item.pixiSprite.anchor && Number.isFinite(item.pixiSprite.anchor.x))
                                ? Number(item.pixiSprite.anchor.x)
                                : 0.5;
                            const anchorY = (item.pixiSprite && item.pixiSprite.anchor && Number.isFinite(item.pixiSprite.anchor.y))
                                ? Number(item.pixiSprite.anchor.y)
                                : 1;
                            const topWorldX = item.x + (0.5 - anchorX) * treeWidth;
                            const topWorldZ = anchorY * treeHeight * 0.75; // 25% down from top
                            fp = this.camera.worldToScreen(topWorldX, item.y, topWorldZ);
                        }
                    } else {
                        const itemHeight = Number.isFinite(item.height) ? item.height : 0;
                        const isDeadAnimal = !!(
                            item &&
                            item.dead &&
                            typeof Animal !== "undefined" &&
                            item instanceof Animal
                        );
                        if (fireSprite.anchor) {
                            fireSprite.anchor.set(0.5, isDeadAnimal ? 0.5 : 1);
                        }
                        if (item.isFallenDoorEffect && typeof item.getFallenDoorWorldPointFromLocalAnchor === "function") {
                            const anchorWorld = item.getFallenDoorWorldPointFromLocalAnchor();
                            if (anchorWorld) {
                                fp = this.camera.worldToScreen(anchorWorld.x, anchorWorld.y, anchorWorld.z);
                            }
                        }
                        if (!fp && isDeadAnimal && item._useGradualDeathFall) {
                            // Keep corpse fire centered on the billboard while it falls by
                            // rotating the upright midpoint around the corpse foot pivot.
                            const centerScreen = this.camera.worldToScreen(item.x, item.y, itemHeight * 0.5);
                            const pivotScreen = this.camera.worldToScreen(item.x, item.y, 0);
                            const rotRad = (Number.isFinite(item.rotation) ? item.rotation : 0) * (Math.PI / 180);
                            const cosR = Math.cos(rotRad);
                            const sinR = Math.sin(rotRad);
                            const dx = centerScreen.x - pivotScreen.x;
                            const dy = centerScreen.y - pivotScreen.y;
                            fp = {
                                x: pivotScreen.x + dx * cosR - dy * sinR,
                                y: pivotScreen.y + dx * sinR + dy * cosR
                            };
                        } else if (!fp && isDeadAnimal) {
                            fp = this.camera.worldToScreen(item.x, item.y, itemHeight * 0.5);
                        } else if (!fp) {
                            // Place fire base 25% down from the top of the object.
                            fp = this.camera.worldToScreen(item.x, item.y, itemHeight * 0.75);
                        }
                    }
                    fireSprite.x = fp.x;
                    fireSprite.y = fp.y;

                    // Size the fire. For trees: use _frozenFireScale (locked at death)
                    // while falling/fading so there's no sudden size jump when hp hits 0.
                    const _fireScale = (item.type === 'tree')
                        ? (Number.isFinite(item._frozenFireScale)
                            ? item._frozenFireScale
                            : (item.maxHP > 0 && item.hp > 0 ? Math.min(item.maxHP / item.hp, 4) : 1))
                        : 1;
                    const fireScale = Number.isFinite(item.fireScale) ? item.fireScale : 1;
                    const treeWidth = Number.isFinite(item.width) ? item.width : 4;
                    const treeHeight = Number.isFinite(item.height) ? item.height : 4;
                    const vs = this.camera.viewscale;
                    // Gradual death-fall fire: apply animated scale and alpha.
                    const deathFireMul = (item._useGradualDeathFall && Number.isFinite(item._deathFireScale))
                        ? Math.max(0, item._deathFireScale) : 1;
                    const deathFireAlpha = (item._useGradualDeathFall && Number.isFinite(item._deathFireAlpha))
                        ? Math.max(0, Math.min(1, item._deathFireAlpha)) : 1;
                    fireSprite.width = treeWidth * vs * fireScale * _fireScale * 0.8 * deathFireMul;
                    fireSprite.height = treeHeight * vs * fireScale * _fireScale * 0.6 * deathFireMul;
                    fireSprite.alpha = deathFireAlpha;
                    fireSprite.visible = true;
                    fireSprite.renderable = true;
                }
            }

            for (const mesh of this.activeDepthBillboardMeshes) {
                if (!currentMeshes.has(mesh) && mesh) {
                    mesh.visible = false;
                }
            }
            for (const item of this.activeDepthBillboardItems) {
                if (currentItems.has(item)) continue;
                if (item && item.pixiSprite) {
                    const category = (typeof item.category === "string") ? item.category.trim().toLowerCase() : "";
                    const isSpatialDoorOrWindow = !!(
                        item.rotationAxis === "spatial" &&
                        (category === "doors" || category === "windows" || item.type === "door" || item.type === "window")
                    );
                    const shouldShowSprite = isSpatialDoorOrWindow ? false : this.isScriptVisible(item);
                    item.pixiSprite.visible = shouldShowSprite;
                    item.pixiSprite.alpha = shouldShowSprite ? this.getScriptDisplayAlpha(item) : 1;
                    if (Object.prototype.hasOwnProperty.call(item.pixiSprite, "renderable")) {
                        item.pixiSprite.renderable = shouldShowSprite;
                    }
                }
                if (item && item._renderingDepthMesh) {
                    item._renderingDepthMesh = null;
                }
                if (item && item._compositeUnderlayMesh) {
                    item._compositeUnderlayMesh.visible = false;
                    if (Object.prototype.hasOwnProperty.call(item._compositeUnderlayMesh, "renderable")) {
                        item._compositeUnderlayMesh.renderable = false;
                    }
                }
                if (item && item._doorBottomFaceDebugGraphics) {
                    item._doorBottomFaceDebugGraphics.visible = false;
                    if (Object.prototype.hasOwnProperty.call(item._doorBottomFaceDebugGraphics, "renderable")) {
                        item._doorBottomFaceDebugGraphics.renderable = false;
                    }
                }
                // Hide fire sprite when item leaves depth billboard rendering
                if (item && item.fireSprite) {
                    item.fireSprite.visible = false;
                }
            }
            this.activeDepthBillboardMeshes = currentMeshes;
            this.activeDepthBillboardItems = currentItems;

            this.setFrameMetric("depthCandidates", depthCandidates);
            this.setFrameMetric("depthMissingMountedSection", depthMissingMountedSection);
            this.setFrameMetric("depthHiddenByScript", depthHiddenByScript);
            this.setFrameMetric("depthDoorBottomOutlineOnly", depthDoorBottomOutlineOnly);

            return depthRenderedItems;
        }

        renderGroundObjects(ctx, renderItems, alreadyRenderedItems) {
            const container = this.layers.groundObjects;
            if (!container) return new Set();
            const groundRenderedItems = new Set();
            const currentSprites = new Set();

            for (let i = 0; i < renderItems.length; i++) {
                const item = renderItems[i];
                if (!item || item.gone || item.vanishing) continue;
                if (item.rotationAxis !== "ground") continue;
                if (item.type === "triggerArea" || item.isTriggerArea === true) continue;
                if (alreadyRenderedItems && alreadyRenderedItems.has(item)) continue;
                if (!this.isScriptVisible(item)) continue;
                const sprite = item.pixiSprite;
                if (!sprite) continue;

                // Fallback sprite path for ground items not handled by depth billboard
                if (sprite.parent !== container) {
                    container.addChild(sprite);
                }
                sprite.visible = true;
                sprite.alpha = this.getScriptDisplayAlpha(item);
                if (Object.prototype.hasOwnProperty.call(sprite, "renderable")) {
                    sprite.renderable = true;
                }
                this.applyScriptBrightness(item, sprite);
                this.applyFrozenTint(item, sprite);
                groundRenderedItems.add(item);
                if (this.applySinkClip(item, sprite)) {
                    currentSprites.add(sprite);
                    this.addPickRenderItem(item, sprite);
                }
            }

            if (!this._activeGroundObjectSprites) this._activeGroundObjectSprites = new Set();
            for (const sprite of this._activeGroundObjectSprites) {
                if (!currentSprites.has(sprite) && sprite) {
                    sprite.visible = false;
                }
            }
            this._activeGroundObjectSprites = currentSprites;

            this.setFrameMetric("groundObjectSpritesRendered", currentSprites.size);

            return groundRenderedItems;
        }

        getGroundTileZIndex(node, mapRef) {
            const mapWidth = Number.isFinite(mapRef && mapRef.width) ? Math.max(1, Math.floor(mapRef.width)) : 1;
            const y = Number.isFinite(node && node.yindex) ? Math.floor(node.yindex) : 0;
            const x = Number.isFinite(node && node.xindex) ? Math.floor(node.xindex) : 0;
            return y * mapWidth + x;
        }

        ensureGroundTileContainer() {
            const layer = this.layers && this.layers.ground;
            if (!layer) return null;
            if (!this.groundTileContainer) {
                this.groundTileContainer = new PIXI.Container();
                this.groundTileContainer.name = "renderingGroundTiles";
                layer.addChild(this.groundTileContainer);
            } else if (this.groundTileContainer.parent !== layer) {
                layer.addChild(this.groundTileContainer);
            }
            return this.groundTileContainer;
        }

        beginGroundTileProfiling(nowMs) {
            const profiler = this.groundTileProfiler;
            if (!profiler || profiler.printed || !isGroundTileProfilingEnabled()) return null;
            const currentNow = Number.isFinite(nowMs) ? Number(nowMs) : performance.now();
            if (!Number.isFinite(profiler.startMs)) {
                profiler.startMs = currentNow;
                profiler.deadlineMs = currentNow + 10000;
            }
            return profiler;
        }

        maybePrintGroundTileProfile(nowMs) {
            const profiler = this.groundTileProfiler;
            if (!profiler || profiler.printed || !Number.isFinite(profiler.deadlineMs)) return;
            const currentNow = Number.isFinite(nowMs) ? Number(nowMs) : performance.now();
            if (currentNow < profiler.deadlineMs) return;
            const frameCount = Math.max(1, Number(profiler.frameCount) || 1);
            const totals = profiler.totals || {};
            const counts = profiler.counts || {};
            console.log("[ground tile profile 10s]", {
                durationMs: Number((currentNow - profiler.startMs).toFixed(2)),
                frameCount,
                avg: {
                    totalMs: Number((Number(totals.totalMs || 0) / frameCount).toFixed(3)),
                    activeKeyBuildMs: Number((Number(totals.activeKeyBuildMs || 0) / frameCount).toFixed(3)),
                    visibleSetMs: Number((Number(totals.visibleSetMs || 0) / frameCount).toFixed(3)),
                    createSpriteMs: Number((Number(totals.createSpriteMs || 0) / frameCount).toFixed(3)),
                    parentAttachMs: Number((Number(totals.parentAttachMs || 0) / frameCount).toFixed(3)),
                    textureResolveMs: Number((Number(totals.textureResolveMs || 0) / frameCount).toFixed(3)),
                    positionSizeMs: Number((Number(totals.positionSizeMs || 0) / frameCount).toFixed(3)),
                    cleanupMs: Number((Number(totals.cleanupMs || 0) / frameCount).toFixed(3))
                },
                counts: {
                    visibleNodesPerFrame: Number((Number(counts.visibleNodes || 0) / frameCount).toFixed(2)),
                    createdSpritesPerFrame: Number((Number(counts.createdSprites || 0) / frameCount).toFixed(2)),
                    attachedSpritesPerFrame: Number((Number(counts.attachedSprites || 0) / frameCount).toFixed(2)),
                    cleanedSpritesPerFrame: Number((Number(counts.cleanedSprites || 0) / frameCount).toFixed(2)),
                    evictedSpritesPerFrame: Number((Number(counts.evictedSprites || 0) / frameCount).toFixed(2)),
                    reusedSpritesPerFrame: Number((Number(counts.reusedSprites || 0) / frameCount).toFixed(2))
                }
            });
            profiler.printed = true;
        }

        acquireGroundTileSprite() {
            let sprite = Array.isArray(this.groundSpritePool) && this.groundSpritePool.length > 0
                ? this.groundSpritePool.pop()
                : null;
            if (!sprite) {
                sprite = new PIXI.Sprite(PIXI.Texture.WHITE);
                sprite.name = "renderingGroundTile";
                sprite.anchor.set(0.5, 0.5);
            }
            sprite.visible = true;
            if (Object.prototype.hasOwnProperty.call(sprite, "renderable")) {
                sprite.renderable = true;
            }
            sprite.alpha = 1;
            return sprite;
        }

        releaseGroundTileSprite(sprite) {
            if (!sprite) return false;
            if (sprite.parent) {
                sprite.parent.removeChild(sprite);
            }
            sprite.visible = false;
            if (Object.prototype.hasOwnProperty.call(sprite, "renderable")) {
                sprite.renderable = false;
            }
            sprite.alpha = 1;
            sprite.texture = PIXI.Texture.WHITE;
            if (Array.isArray(this.groundSpritePool) && this.groundSpritePool.length < GROUND_TILE_POOL_LIMIT) {
                this.groundSpritePool.push(sprite);
                return false;
            }
            if (typeof sprite.destroy === "function") {
                sprite.destroy({ children: false, texture: false, baseTexture: false });
            }
            return true;
        }

        trimGroundTileSpriteCache(maxEvictions = GROUND_TILE_TRIM_CHUNK_SIZE) {
            if (!(this.groundSpriteByNodeKey instanceof Map) || this.groundSpriteByNodeKey.size <= GROUND_TILE_CACHE_LIMIT) {
                return 0;
            }
            const visibleKeys = this.groundVisibleNodeKeys instanceof Set
                ? this.groundVisibleNodeKeys
                : new Set();
            const evictTarget = Math.max(
                0,
                Math.min(
                    Math.floor(Number(maxEvictions) || 0),
                    this.groundSpriteByNodeKey.size - GROUND_TILE_CACHE_LIMIT
                )
            );
            if (evictTarget <= 0) return 0;

            let evictedSprites = 0;
            for (const [key, sprite] of this.groundSpriteByNodeKey.entries()) {
                if (visibleKeys.has(key)) continue;
                this.groundSpriteByNodeKey.delete(key);
                this.groundVisibleNodeKeys.delete(key);
                this.releaseGroundTileSprite(sprite);
                evictedSprites += 1;
                if (evictedSprites >= evictTarget || this.groundSpriteByNodeKey.size <= GROUND_TILE_CACHE_LIMIT) {
                    break;
                }
            }
            return evictedSprites;
        }

        renderGroundTiles(ctx, visibleNodes) {
            const map = ctx.map;
            const layer = this.layers.ground;
            if (!map || !Array.isArray(map.nodes) || !layer) return;
            const frameStartMs = performance.now();
            const profiler = this.beginGroundTileProfiling(
                ctx && Number.isFinite(ctx.renderNowMs) ? Number(ctx.renderNowMs) : frameStartMs
            );

            const cam = this.camera;
            const tileWorldW = (Number.isFinite(map.hexWidth) ? map.hexWidth : (1 / 0.866))
                * GROUND_TILE_OVERLAP_SCALE;
            const tileWorldH = (Number.isFinite(map.hexHeight) ? map.hexHeight : 1)
                * GROUND_TILE_OVERLAP_SCALE;
            const nodes = Array.isArray(visibleNodes) ? visibleNodes : [];
            const visibleNodeKeys = new Set();
            const activeKeyBuildStartMs = profiler ? performance.now() : 0;
            const activePrototypeNodeKeys = (typeof map.getLoadedPrototypeNodeKeySet === "function")
                ? map.getLoadedPrototypeNodeKeySet()
                : null;
            const activeKeyBuildMs = profiler ? (performance.now() - activeKeyBuildStartMs) : 0;
            const usePrototypeContainerTransform = !!activePrototypeNodeKeys;
            const container = usePrototypeContainerTransform
                ? this.ensureGroundTileContainer()
                : layer;
            if (!container) return;

            if (usePrototypeContainerTransform) {
                container.position.set(
                    -(Number(cam.x) || 0) * (Number(cam.viewscale) || 1),
                    -(Number(cam.y) || 0) * (Number(cam.viewscale) || 1) * (Number(cam.xyratio) || 1)
                );
                container.scale.set(
                    Number(cam.viewscale) || 1,
                    (Number(cam.viewscale) || 1) * (Number(cam.xyratio) || 1)
                );
            } else if (this.groundTileContainer) {
                this.groundTileContainer.position.set(0, 0);
                this.groundTileContainer.scale.set(1, 1);
            }

            let createSpriteMs = 0;
            let parentAttachMs = 0;
            let textureResolveMs = 0;
            let positionSizeMs = 0;
            let createdSprites = 0;
            let attachedSprites = 0;
            let reusedSprites = 0;
            const visibleSetStartMs = profiler ? performance.now() : 0;
            for (let i = 0; i < nodes.length; i++) {
                const node = nodes[i];
                if (!node) continue;
                const key = `${node.xindex},${node.yindex}`;
                visibleNodeKeys.add(key);
                let sprite = this.groundSpriteByNodeKey.get(key);
                if (!sprite) {
                    const createStartMs = profiler ? performance.now() : 0;
                    sprite = this.acquireGroundTileSprite();
                    this.groundSpriteByNodeKey.set(key, sprite);
                    if (profiler) createSpriteMs += (performance.now() - createStartMs);
                    createdSprites += 1;
                } else {
                    this.groundSpriteByNodeKey.delete(key);
                    this.groundSpriteByNodeKey.set(key, sprite);
                    reusedSprites += 1;
                }
                if (sprite.parent !== container) {
                    const attachStartMs = profiler ? performance.now() : 0;
                    container.addChild(sprite);
                    if (profiler) parentAttachMs += (performance.now() - attachStartMs);
                    attachedSprites += 1;
                }

                const textureStartMs = profiler ? performance.now() : 0;
                const maxTextureIndex = Array.isArray(map.groundTextures) ? (map.groundTextures.length - 1) : 0;
                const textureIndex = Math.max(
                    0,
                    Math.min(maxTextureIndex, Number.isFinite(node.groundTextureId) ? Math.floor(node.groundTextureId) : 0)
                );
                const texture = (Array.isArray(map.groundTextures) && map.groundTextures[textureIndex])
                    ? map.groundTextures[textureIndex]
                    : PIXI.Texture.WHITE;
                if (sprite.texture !== texture) {
                    sprite.texture = texture;
                }
                if (profiler) textureResolveMs += (performance.now() - textureStartMs);

                const positionStartMs = profiler ? performance.now() : 0;
                if (usePrototypeContainerTransform) {
                    sprite.x = Number(node.x) || 0;
                    sprite.y = Number(node.y) || 0;
                    sprite.width = tileWorldW;
                    sprite.height = tileWorldH;
                } else {
                    const center = cam.worldToScreen(node.x, node.y, 0);
                    sprite.x = center.x;
                    sprite.y = center.y;
                    sprite.width = tileWorldW * cam.viewscale;
                    sprite.height = tileWorldH * cam.viewscale * cam.xyratio;
                }
                sprite.alpha = 1;
                sprite.visible = true;
                if (profiler) positionSizeMs += (performance.now() - positionStartMs);
            }
            const visibleSetMs = profiler ? (performance.now() - visibleSetStartMs) : 0;

            const cleanupStartMs = profiler ? performance.now() : 0;
            let cleanedSprites = 0;
            let evictedSprites = 0;
            const previouslyVisibleNodeKeys = this.groundVisibleNodeKeys instanceof Set
                ? this.groundVisibleNodeKeys
                : new Set();
            for (const key of previouslyVisibleNodeKeys) {
                if (visibleNodeKeys.has(key)) continue;
                const sprite = this.groundSpriteByNodeKey.get(key);
                if (sprite) {
                    sprite.visible = false;
                    cleanedSprites += 1;
                }
            }
            this.groundVisibleNodeKeys = visibleNodeKeys;
            evictedSprites = this.trimGroundTileSpriteCache(GROUND_TILE_TRIM_CHUNK_SIZE);
            cleanedSprites += evictedSprites;
            const cleanupMs = profiler ? (performance.now() - cleanupStartMs) : 0;

            if (profiler) {
                profiler.frameCount += 1;
                profiler.totals.totalMs += (performance.now() - frameStartMs);
                profiler.totals.activeKeyBuildMs += activeKeyBuildMs;
                profiler.totals.visibleSetMs += visibleSetMs;
                profiler.totals.createSpriteMs += createSpriteMs;
                profiler.totals.parentAttachMs += parentAttachMs;
                profiler.totals.textureResolveMs += textureResolveMs;
                profiler.totals.positionSizeMs += positionSizeMs;
                profiler.totals.cleanupMs += cleanupMs;
                profiler.counts.visibleNodes += nodes.length;
                profiler.counts.createdSprites += createdSprites;
                profiler.counts.attachedSprites += attachedSprites;
                profiler.counts.cleanedSprites += cleanedSprites;
                profiler.counts.evictedSprites += evictedSprites;
                profiler.counts.reusedSprites += reusedSprites;
                this.maybePrintGroundTileProfile(
                    ctx && Number.isFinite(ctx.renderNowMs) ? Number(ctx.renderNowMs) : performance.now()
                );
            }
        }

        renderRoadsAndFloors(ctx, visibleNodes) {
            const map = ctx.map;
            const cam = this.camera;
            const container = this.layers.roadsFloor;
            if (!map || !Array.isArray(map.nodes) || !container) return;
            const diagnosticsEnabled = !!this.currentFrameMetrics;
            const functionStartMs = diagnosticsEnabled ? performance.now() : 0;
            const nowMs = (ctx && Number.isFinite(ctx.renderNowMs))
                ? Number(ctx.renderNowMs)
                : ((typeof performance !== "undefined" && performance && typeof performance.now === "function")
                    ? performance.now()
                    : Date.now());
            const hiddenSpriteGraceMs = 500;
            const maxHiddenSprites = 96;
            let roadSpritesCreated = 0;
            let roadSpritesAttached = 0;
            let roadTextureRefreshes = 0;
            let roadTextureAssignments = 0;
            let roadHiddenSprites = 0;
            let roadDestroyedSprites = 0;
            let roadEvictedSprites = 0;

            const destroyRoadSprite = (road, sprite) => {
                if (isRoadTextureLifecycleDiagnosticsEnabled()) {
                    console.warn("[road render sprite destroy]", {
                        roadId: Number.isInteger(road && road._prototypeRecordId) ? Number(road._prototypeRecordId) : null,
                        roadGone: !!(road && road.gone),
                        roadTextureCacheKey: (road && typeof road._roadTextureCacheKey === "string") ? road._roadTextureCacheKey : "",
                        sprite: summarizePixiDisplayObject(sprite)
                    });
                }
                if (sprite) {
                    if (sprite.destroyed !== true) {
                        syncRoadRenderSpriteTextureRetention(sprite, null);
                    }
                    if (sprite.parent) {
                        sprite.parent.removeChild(sprite);
                    }
                    if (sprite.destroyed !== true && typeof sprite.destroy === "function") {
                        sprite.destroy({ children: false, texture: false, baseTexture: false });
                    }
                }
                this.roadSpriteByObject.delete(road);
                roadDestroyedSprites += 1;
            };

            const visibleRoadObjects = new Set();
            const nodes = Array.isArray(visibleNodes) ? visibleNodes : [];
            for (let n = 0; n < nodes.length; n++) {
                const node = nodes[n];
                if (!node || !Array.isArray(node.objects)) continue;
                for (let i = 0; i < node.objects.length; i++) {
                    const obj = node.objects[i];
                    if (!obj || obj.gone || obj.type !== "road") continue;
                    if (!this.isScriptVisible(obj)) continue;
                    visibleRoadObjects.add(obj);
                }
            }

            const roadObjects = Array.from(visibleRoadObjects);
            for (let i = 0; i < roadObjects.length; i++) {
                const road = roadObjects[i];
                let sprite = this.roadSpriteByObject.get(road);
                if (!sprite) {
                    sprite = new PIXI.Sprite(PIXI.Texture.WHITE);
                    sprite.name = "renderingRoad";
                    sprite.anchor.set(0.5, 0.5);
                    this.roadSpriteByObject.set(road, sprite);
                    roadSpritesCreated += 1;
                }
                if (sprite.parent !== container) {
                    container.addChild(sprite);
                    roadSpritesAttached += 1;
                }

                const worldX = Number.isFinite(road.x) ? road.x : (road.node && Number.isFinite(road.node.x) ? road.node.x : 0);
                const worldY = Number.isFinite(road.y) ? road.y : (road.node && Number.isFinite(road.node.y) ? road.node.y : 0);
                const roadScreenWidth = (Number(road.width) || 1) * cam.viewscale * 1.1547;
                const roadScreenHeight = (Number(road.height) || 1) * cam.viewscale * cam.xyratio;
                if (typeof global.Road !== "undefined" && typeof global.Road.resolveFillTexturePathForSize === "function") {
                    const lodMetric = typeof global.Road.getFillTextureLodMetric === "function"
                        ? global.Road.getFillTextureLodMetric(road.fillTexturePath, roadScreenWidth, roadScreenHeight)
                        : Math.max(roadScreenWidth, roadScreenHeight);
                    const resolvedFillTexturePath = global.Road.resolveFillTexturePathForSize(road.fillTexturePath, lodMetric);
                    if (resolvedFillTexturePath !== road._resolvedRenderFillTexturePath && typeof road.updateTexture === "function") {
                        road.updateTexture(null, resolvedFillTexturePath);
                    }
                }

                const sourceTexture = (
                    road &&
                    road.pixiSprite &&
                    isRenderablePixiTexture(road.pixiSprite.texture)
                ) ? road.pixiSprite.texture : null;
                if (!sourceTexture && typeof road.updateTexture === "function") {
                    road.updateTexture();
                    roadTextureRefreshes += 1;
                }
                const refreshedSourceTexture = (
                    road &&
                    road.pixiSprite &&
                    isRenderablePixiTexture(road.pixiSprite.texture)
                ) ? road.pixiSprite.texture : null;
                if (refreshedSourceTexture && refreshedSourceTexture !== sprite.texture) {
                    sprite.texture = refreshedSourceTexture;
                    syncRoadRenderSpriteTextureRetention(sprite, road);
                    roadTextureAssignments += 1;
                } else if (refreshedSourceTexture) {
                    syncRoadRenderSpriteTextureRetention(sprite, road);
                } else if (!isRenderablePixiTexture(sprite.texture)) {
                    syncRoadRenderSpriteTextureRetention(sprite, null);
                    sprite.texture = PIXI.Texture.WHITE;
                    roadTextureAssignments += 1;
                }

                const p = cam.worldToScreen(worldX, worldY, 0);
                sprite.x = p.x;
                sprite.y = p.y;
                if (!isRenderablePixiTexture(sprite.texture)) {
                    syncRoadRenderSpriteTextureRetention(sprite, null);
                    sprite.texture = PIXI.Texture.WHITE;
                }
                sprite.width = roadScreenWidth;
                sprite.height = roadScreenHeight;
                sprite.alpha = Number.isFinite(road.alpha) ? road.alpha : 1;
                sprite.visible = true;
                sprite._lastVisibleAtMs = nowMs;
                this.applyScriptBrightness(road, sprite);
                road._renderingDisplayObject = sprite;
                this.addPickRenderItem(road, sprite);
            }

            const hiddenEntries = [];
            for (const [road, sprite] of this.roadSpriteByObject.entries()) {
                if (!road || road.gone) {
                    destroyRoadSprite(road, sprite);
                    continue;
                }
                if (!visibleRoadObjects.has(road) && sprite) {
                    const lastVisibleAtMs = Number.isFinite(sprite._lastVisibleAtMs)
                        ? Number(sprite._lastVisibleAtMs)
                        : 0;
                    if (lastVisibleAtMs > 0 && (nowMs - lastVisibleAtMs) > hiddenSpriteGraceMs) {
                        destroyRoadSprite(road, sprite);
                        continue;
                    }
                    if (!isRenderablePixiTexture(sprite.texture)) {
                        syncRoadRenderSpriteTextureRetention(sprite, null);
                        sprite.texture = PIXI.Texture.WHITE;
                    }
                    sprite.visible = false;
                    roadHiddenSprites += 1;
                    hiddenEntries.push({ road, sprite, lastVisibleAtMs });
                }
            }

            if (hiddenEntries.length > maxHiddenSprites) {
                hiddenEntries.sort((a, b) => a.lastVisibleAtMs - b.lastVisibleAtMs);
                const evictCount = hiddenEntries.length - maxHiddenSprites;
                for (let i = 0; i < evictCount; i++) {
                    const entry = hiddenEntries[i];
                    destroyRoadSprite(entry.road, entry.sprite);
                    roadEvictedSprites += 1;
                }
            }

            this.setFrameMetric("roadsVisible", roadObjects.length);
            this.setFrameMetric("roadsCached", this.roadSpriteByObject instanceof Map ? this.roadSpriteByObject.size : 0);
            this.setFrameMetric("roadsCreated", roadSpritesCreated);
            this.setFrameMetric("roadsAttached", roadSpritesAttached);
            this.setFrameMetric("roadsTextureRefreshes", roadTextureRefreshes);
            this.setFrameMetric("roadsTextureAssignments", roadTextureAssignments);
            this.setFrameMetric("roadsHidden", roadHiddenSprites);
            this.setFrameMetric("roadsDestroyed", roadDestroyedSprites);
            this.setFrameMetric("roadsEvicted", roadEvictedSprites);
            this.setFrameMetric(
                "roadsMs",
                diagnosticsEnabled ? (performance.now() - functionStartMs) : 0
            );
        }

        renderHexGridOverlay(ctx) {
            const showPickerScreen = getShowPickerScreenFlag();
            const layer = showPickerScreen ? this.layers.ui : this.layers.roadsFloor;
            if (!layer) return;
            const appRef = (ctx && ctx.app) || global.app || null;
            if (!appRef || !appRef.renderer) return;
            const wallCtor = global.WallSectionUnit || null;
            const directionalBlockingDebugEnabled = !!(
                wallCtor &&
                wallCtor._showDirectionalBlockingDebug
            );

            if (showPickerScreen) {
                if (!this.hexGridPickerBackdrop) {
                    this.hexGridPickerBackdrop = new PIXI.Sprite(PIXI.Texture.WHITE);
                    this.hexGridPickerBackdrop.name = "renderingHexGridPickerBackdrop";
                    this.hexGridPickerBackdrop.interactive = false;
                    this.hexGridPickerBackdrop.tint = 0x000000;
                    this.hexGridPickerBackdrop.alpha = 1;
                }
                if (this.hexGridPickerBackdrop.parent !== layer) {
                    layer.addChild(this.hexGridPickerBackdrop);
                }
                this.hexGridPickerBackdrop.position.set(0, 0);
                this.hexGridPickerBackdrop.width = Math.max(1, Number(appRef.renderer.width) || Number(window.innerWidth) || 1);
                this.hexGridPickerBackdrop.height = Math.max(1, Number(appRef.renderer.height) || Number(window.innerHeight) || 1);
                this.hexGridPickerBackdrop.visible = true;
                if (layer.getChildIndex(this.hexGridPickerBackdrop) !== 0) {
                    layer.setChildIndex(this.hexGridPickerBackdrop, 0);
                }
            } else if (this.hexGridPickerBackdrop) {
                this.hexGridPickerBackdrop.visible = false;
            }

            const gridEnabled = !!(
                (typeof showHexGrid !== "undefined" && showHexGrid)
            );
            if (!gridEnabled && !directionalBlockingDebugEnabled) {
                if (this.hexGridContainer) this.hexGridContainer.visible = false;
                return;
            }
            const cam = this.camera;

            if (!this.hexGridContainer) {
                this.hexGridContainer = new PIXI.Container();
                this.hexGridContainer.name = "renderingHexGridContainer";
                this.hexGridContainer.interactiveChildren = false;
                this.hexGridContainer.zIndex = Number.MIN_SAFE_INTEGER;
                layer.addChild(this.hexGridContainer);
            } else if (this.hexGridContainer.parent !== layer) {
                layer.addChild(this.hexGridContainer);
            }
            this.hexGridContainer.visible = true;

            if (!this.hexGridDirectionalBlockingGraphics) {
                this.hexGridDirectionalBlockingGraphics = new PIXI.Graphics();
                this.hexGridDirectionalBlockingGraphics.name = "renderingHexGridDirectionalBlockingDebug";
                this.hexGridDirectionalBlockingGraphics.interactive = false;
                this.hexGridContainer.addChild(this.hexGridDirectionalBlockingGraphics);
            } else if (this.hexGridDirectionalBlockingGraphics.parent !== this.hexGridContainer) {
                this.hexGridContainer.addChild(this.hexGridDirectionalBlockingGraphics);
            }

            const vs = cam.viewscale;
            const vsy = cam.viewscale * cam.xyratio;
            if (vs <= 0 || vsy <= 0) return;

            // Hex geometry in screen pixels.
            // Nodes: x = xIndex*0.866, y = yIndex + (xIndex%2===0 ? 0.5 : 0)
            // Even columns are shifted DOWN by 0.5 world units.
            const colStep = 0.866 * vs;       // horizontal distance between adjacent columns
            const vy = vsy;                    // vertical distance between adjacent rows
            const hexPxW = vs / 0.866;         // full hex bounding width
            const halfW = hexPxW / 2;
            const halfH = vy / 2;
            const quarterW = hexPxW / 4;

            // In the texture, hex[col][row] center is at:
            //   tx = col*colStep + cx0
            //   ty = row*vy + cy0 - (col%2===1 ? halfH : 0)
            // cy0=vy ensures odd-col row-0 hexes don't clip above y=0.
            const cx0 = halfW;
            const cy0 = vy;

            const TILE_COLS = 16;  // must be even so parity is preserved when tiling
            const TILE_ROWS = 16;
            // Texture bounding box:
            //   width  = rightmost hex right-edge  = (TILE_COLS-1)*colStep + hexPxW
            //   height = lowest hex bottom-edge    = TILE_ROWS*vy + halfH  (even-col last row)
            const tileTexW = (TILE_COLS - 1) * colStep + hexPxW;
            const tileTexH = TILE_ROWS * vy + halfH;

            // Rebuild texture only when zoom or aspect ratio changes meaningfully.
            let rebuildTexture = !this.hexGridTexture;
            if (!rebuildTexture && Math.abs(vs - this.hexGridLastViewscale) > 1e-3) rebuildTexture = true;
            if (!rebuildTexture && Math.abs(cam.xyratio - this.hexGridLastXyratio) > 1e-3) rebuildTexture = true;

            if (rebuildTexture) {
                const gfx = new PIXI.Graphics();
                gfx.lineStyle(1, 0xffffff, 0.35);
                for (let col = 0; col < TILE_COLS; col++) {
                    const tx = col * colStep + cx0;
                    for (let row = 0; row < TILE_ROWS; row++) {
                        const ty = row * vy + cy0 - (col % 2 === 1 ? halfH : 0);
                        gfx.moveTo(tx - halfW, ty);
                        gfx.lineTo(tx - quarterW, ty - halfH);
                        gfx.lineTo(tx + quarterW, ty - halfH);
                        gfx.lineTo(tx + halfW, ty);
                        gfx.lineTo(tx + quarterW, ty + halfH);
                        gfx.lineTo(tx - quarterW, ty + halfH);
                        gfx.closePath();
                    }
                }
                const pxW = Math.ceil(tileTexW);
                const pxH = Math.ceil(tileTexH);
                const tex = appRef.renderer.generateTexture(gfx, {
                    region: new PIXI.Rectangle(0, 0, pxW, pxH),
                    resolution: 1
                });
                gfx.destroy(true);
                if (this.hexGridTexture && this.hexGridTexture !== tex) {
                    this.hexGridTexture.destroy(true);
                }
                this.hexGridTexture = tex;
                this.hexGridLastViewscale = vs;
                this.hexGridLastXyratio = cam.xyratio;
            }

            // Anchor: even column just offscreen to the top-left.
            // xIndex must be even so the texture parity (even-col first) is always correct.
            const xIndexRaw = Math.floor(cam.x / 0.866) - 1;
            const xIndex = xIndexRaw % 2 === 0 ? xIndexRaw : xIndexRaw - 1;
            const yIndex = Math.floor(cam.y) - 1;
            // Even column: world y = yIndex + 0.5
            const anchorWorldX = xIndex * 0.866;
            const anchorWorldY = yIndex + 0.5;
            const anchorScreen = cam.worldToScreen(anchorWorldX, anchorWorldY);

            // Top-left of first tile sprite in screen space
            const startScreenX = anchorScreen.x - cx0;
            const startScreenY = anchorScreen.y - cy0;

            // Step between successive tile copies (exactly 16 columns / 16 rows)
            const stepX = TILE_COLS * colStep;   // 16 * 0.866 * vs
            const stepY = TILE_ROWS * vy;         // 16 * vy

            const screenW = Math.max(1, appRef.renderer.width || window.innerWidth || 800);
            const screenH = Math.max(1, appRef.renderer.height || window.innerHeight || 600);

            const colsNeeded = Math.ceil((screenW - startScreenX) / stepX) + 1;
            const rowsNeeded = Math.ceil((screenH - startScreenY) / stepY) + 1;

            let idx = 0;
            if (gridEnabled) {
                for (let r = 0; r < rowsNeeded; r++) {
                    for (let c = 0; c < colsNeeded; c++) {
                        let spr = this.hexGridSprites[idx];
                        if (!spr) {
                            spr = new PIXI.Sprite(this.hexGridTexture);
                            spr.name = "renderingHexGridTile";
                            spr.anchor.set(0, 0);
                            spr.interactive = false;
                            this.hexGridContainer.addChild(spr);
                            this.hexGridSprites[idx] = spr;
                        }
                        if (spr.texture !== this.hexGridTexture) spr.texture = this.hexGridTexture;
                        spr.x = startScreenX + c * stepX;
                        spr.y = startScreenY + r * stepY;
                        spr.visible = true;
                        idx++;
                    }
                }
            }
            for (; idx < this.hexGridSprites.length; idx++) {
                if (this.hexGridSprites[idx]) this.hexGridSprites[idx].visible = false;
            }

            const directionalGfx = this.hexGridDirectionalBlockingGraphics;
            if (directionalGfx) {
                directionalGfx.clear();
                directionalGfx.visible = directionalBlockingDebugEnabled;
                if (directionalBlockingDebugEnabled && wallCtor && wallCtor._allSections instanceof Map) {
                    const drawnMarkers = new Map();
                    const worldMarginX = Math.max(2, (Number(ctx && ctx.viewport && ctx.viewport.width) || 20) * 0.15);
                    const worldMarginY = Math.max(2, (Number(ctx && ctx.viewport && ctx.viewport.height) || 20) * 0.15);
                    const minWorldX = Number(cam.x) - worldMarginX;
                    const maxWorldX = Number(cam.x) + Number(ctx && ctx.viewport && ctx.viewport.width || 20) + worldMarginX;
                    const minWorldY = Number(cam.y) - worldMarginY;
                    const maxWorldY = Number(cam.y) + Number(ctx && ctx.viewport && ctx.viewport.height || 20) + worldMarginY;
                    for (const section of wallCtor._allSections.values()) {
                        if (!section || section.gone) continue;
                        const sectionCenter = section.center || null;
                        if (
                            sectionCenter &&
                            Number.isFinite(sectionCenter.x) &&
                            Number.isFinite(sectionCenter.y) &&
                            (
                                Number(sectionCenter.x) < minWorldX ||
                                Number(sectionCenter.x) > maxWorldX ||
                                Number(sectionCenter.y) < minWorldY ||
                                Number(sectionCenter.y) > maxWorldY
                            )
                        ) {
                            continue;
                        }
                        const debugData = section._directionalBlockingDebug;
                        if (!debugData) continue;
                        const blockedLinks = Array.isArray(section.blockedLinks) ? section.blockedLinks : [];

                        for (let i = 0; i < blockedLinks.length; i++) {
                            const link = blockedLinks[i];
                            const sourceNode = link && link.node;
                            const dir = Number(link && link.direction);
                            if (!sourceNode || !Array.isArray(sourceNode.neighbors) || !Number.isInteger(dir)) continue;
                            const destinationNode = sourceNode.neighbors[dir];
                            if (!destinationNode) continue;
                            const incomingDir = ((dir + 6) % 12 + 12) % 12;
                            const markerKey = `${Number(destinationNode.xindex)},${Number(destinationNode.yindex)}|${incomingDir}`;
                            const color = (typeof wallCtor._getDirectionalBlockingDebugColor === "function")
                                ? wallCtor._getDirectionalBlockingDebugColor(link.blocker)
                                : 0xff0000;
                            const existingColor = drawnMarkers.get(markerKey);
                            if (existingColor === 0x3399ff || existingColor === color) continue;
                            drawnMarkers.set(markerKey, {
                                sourceNode,
                                destinationNode,
                                incomingDir,
                                color
                            });
                        }
                    }

                    for (const marker of drawnMarkers.values()) {
                        if (!marker || !marker.sourceNode || !marker.destinationNode) continue;
                        const sourceWorldX = Number(marker.sourceNode.x) || 0;
                        const sourceWorldY = Number(marker.sourceNode.y) || 0;
                        const destinationWorldX = Number(marker.destinationNode.x) || 0;
                        const destinationWorldY = Number(marker.destinationNode.y) || 0;
                        const dxWorld = sourceWorldX - destinationWorldX;
                        const dyWorld = sourceWorldY - destinationWorldY;
                        const worldLen = Math.hypot(dxWorld, dyWorld);
                        if (!(worldLen > 1e-4)) continue;

                        const ux = dxWorld / worldLen;
                        const uy = dyWorld / worldLen;
                        const px = -uy;
                        const py = ux;
                        const incomingDir = Number.isInteger(marker.incomingDir) ? marker.incomingDir : 0;
                        const halfMarkerWorldLength = (incomingDir % 2 === 1) ? 0.28 : 0.22;
                        const markerCenterWorldX = destinationWorldX + ux * worldLen * 0.56;
                        const markerCenterWorldY = destinationWorldY + uy * worldLen * 0.56;
                        const startScreen = cam.worldToScreen(
                            markerCenterWorldX - px * halfMarkerWorldLength,
                            markerCenterWorldY - py * halfMarkerWorldLength,
                            0
                        );
                        const endScreen = cam.worldToScreen(
                            markerCenterWorldX + px * halfMarkerWorldLength,
                            markerCenterWorldY + py * halfMarkerWorldLength,
                            0
                        );

                        directionalGfx.lineStyle(3, marker.color, 0.95);
                        directionalGfx.moveTo(startScreen.x, startScreen.y);
                        directionalGfx.lineTo(endScreen.x, endScreen.y);
                    }
                }
            }

            if (directionalGfx && directionalGfx.parent === this.hexGridContainer) {
                this.hexGridContainer.setChildIndex(directionalGfx, this.hexGridContainer.children.length - 1);
            }

            if (this.hexGridContainer.parent === layer) {
                    const targetIdx = showPickerScreen
                        ? ((this.hexGridPickerBackdrop && this.hexGridPickerBackdrop.parent === layer) ? 1 : 0)
                        : Math.max(0, layer.children.length - 1);
                    if (layer.getChildIndex(this.hexGridContainer) !== targetIdx) {
                        layer.setChildIndex(this.hexGridContainer, targetIdx);
                }
            }
        }

        renderObjects3D(ctx, visibleNodes, visibleObjectsOverride = null) {
            const container = this.layers.objects3d;
            if (!container) return;
            const diagnosticsEnabled = !!this.currentFrameMetrics;
            const nowIfEnabled = () => diagnosticsEnabled ? performance.now() : 0;
            const showPickerScreen = getShowPickerScreenFlag();
            const wizard = (ctx && ctx.wizard) ? ctx.wizard : null;
            const mapRef = (ctx && ctx.map) ? ctx.map : (this.camera && this.camera.map) || global.map || null;
            const omnivisionActive = this.isOmnivisionActive(wizard);
            const mazeMode = this.isLosMazeModeEnabled() && !omnivisionActive;
            const useMazeLosClipping = mazeMode;
            const buildLosSetsStartMs = nowIfEnabled();
            const losVisibleObjectSet = (
                useMazeLosClipping &&
                this.currentLosState &&
                Array.isArray(this.currentLosState.visibleObjects)
            ) ? new Set(this.currentLosState.visibleObjects) : null;
            const visibleWallIdSet = (() => {
                if (!useMazeLosClipping || !losVisibleObjectSet) return null;
                const out = new Set();
                for (const obj of losVisibleObjectSet) {
                    if (!obj || obj.type !== "wallSection" || !Number.isInteger(obj.id)) continue;
                    out.add(Number(obj.id));
                }
                return out;
            })();
            const losVisibleWalls = (() => {
                if (!losVisibleObjectSet) return [];
                const out = [];
                for (const obj of losVisibleObjectSet) {
                    if (!obj || obj.type !== "wallSection") continue;
                    out.push(obj);
                }
                return out;
            })();
            const buildLosSetsMs = diagnosticsEnabled ? (performance.now() - buildLosSetsStartMs) : 0;
            this.setFrameMetric("objects3dLosBuildMs", buildLosSetsMs);
            this.setFrameMetric("objects3dLosVisibleSetSize", losVisibleObjectSet ? losVisibleObjectSet.size : 0);
            this.setFrameMetric("objects3dLosVisibleWalls", losVisibleWalls.length);
            const sharesVisibleCollinearWallLine = (item) => {
                if (!item || !useMazeLosClipping || !losVisibleObjectSet || losVisibleWalls.length === 0) {
                    return false;
                }
                if (item.type === "wallSection") {
                    if (losVisibleObjectSet.has(item)) return true;
                    for (let i = 0; i < losVisibleWalls.length; i++) {
                        const visibleWall = losVisibleWalls[i];
                        if (!visibleWall || visibleWall === item) continue;
                        const hasMazeGuard = (
                            typeof item.canShareMazeCollinearVisibilityWith === "function" ||
                            typeof visibleWall.canShareMazeCollinearVisibilityWith === "function"
                        );
                        if (
                            typeof item.canShareMazeCollinearVisibilityWith === "function" &&
                            item.canShareMazeCollinearVisibilityWith(visibleWall, wizard)
                        ) {
                            return true;
                        }
                        if (
                            typeof visibleWall.canShareMazeCollinearVisibilityWith === "function" &&
                            visibleWall.canShareMazeCollinearVisibilityWith(item, wizard)
                        ) {
                            return true;
                        }
                        if (hasMazeGuard) continue;
                        if (
                            typeof item._isSameWallLineForVisibility === "function" &&
                            item._isSameWallLineForVisibility(visibleWall)
                        ) {
                            return true;
                        }
                        if (
                            typeof visibleWall._isSameWallLineForVisibility === "function" &&
                            visibleWall._isSameWallLineForVisibility(item)
                        ) {
                            return true;
                        }
                    }
                    return false;
                }
                if (!this.isWallMountedSpatialItem(item)) return false;
                const mountedSection = this.resolveMountedWallSectionForItem(item);
                if (!mountedSection || mountedSection.type !== "wallSection") return false;
                for (let i = 0; i < losVisibleWalls.length; i++) {
                    const visibleWall = losVisibleWalls[i];
                    if (!visibleWall || typeof visibleWall.isEndpointOwnedBySameWall !== "function") continue;
                    const hasMazeGuard = (
                        typeof mountedSection.canShareMazeCollinearVisibilityWith === "function" ||
                        typeof visibleWall.canShareMazeCollinearVisibilityWith === "function"
                    );
                    if (visibleWall === mountedSection) return true;
                    if (
                        typeof mountedSection.canShareMazeCollinearVisibilityWith === "function" &&
                        mountedSection.canShareMazeCollinearVisibilityWith(visibleWall, wizard)
                    ) {
                        return true;
                    }
                    if (
                            typeof visibleWall.canShareMazeCollinearVisibilityWith === "function" &&
                            visibleWall.canShareMazeCollinearVisibilityWith(mountedSection, wizard)
                    ) {
                        return true;
                    }
                    if (hasMazeGuard) continue;
                    if (
                        visibleWall.isEndpointOwnedBySameWall("a", item) ||
                        visibleWall.isEndpointOwnedBySameWall("b", item)
                    ) {
                        return true;
                    }
                }
                return false;
            };
            const isWallDirectlyVisibleByMazeLos = (item) => {
                if (!useMazeLosClipping || !item || item.type !== "wallSection") return false;
                return !!(
                    (losVisibleObjectSet && losVisibleObjectSet.has(item)) ||
                    sharesVisibleCollinearWallLine(item)
                );
            };
            const isWallVisibleByMazeSample = (item) => {
                if (!useMazeLosClipping || !wizard || !item || item.type !== "wallSection") return false;
                if (isWallDirectlyVisibleByMazeLos(item)) return true;
                const samplePos = this.getLosVisibilitySamplePointForItem(item, mapRef, wizard);
                if (!samplePos) return false;
                return !this.isWorldPointInLosShadow(samplePos.x, samplePos.y, wizard, mapRef);
            };
            const animalsList = Array.isArray(ctx && ctx.animals)
                ? ctx.animals
                : (Array.isArray(global.animals) ? global.animals : null);
            const animalSet = Array.isArray(animalsList) ? new Set(animalsList) : null;
            const LOS_ANIMAL_EDGE_SAMPLES = 8;
            const isAnimalHiddenByLos = (item) => {
                if (!animalSet || !animalSet.has(item)) return false;
                if (!useMazeLosClipping && this.isForceVisible(item)) return false;
                return this.isRadialItemHiddenByLos(item, wizard, mapRef);
            };
            const isItemHiddenByMazeLos = (item) => {
                if (!useMazeLosClipping || !wizard || !item) return false;
                if (item.type === "wallSection") {
                    if (item.castsLosShadows === false) return false;
                    return !isWallVisibleByMazeSample(item);
                }
                if (this.isWallMountedSpatialItem(item) && losVisibleObjectSet) {
                    const category = (typeof item.category === "string") ? item.category.trim().toLowerCase() : "";
                    const isDoor = item.type === "door" || category === "doors";
                    if (isDoor) {
                        const mountedSection = this.resolveMountedWallSectionForItem(item);
                        if (mountedSection && mountedSection.type === "wallSection" && !losVisibleObjectSet.has(mountedSection)) {
                            return true;
                        }
                    }
                }
                if (sharesVisibleCollinearWallLine(item)) return false;
                if (losVisibleObjectSet && this.isLosOccluder(item)) {
                    return !losVisibleObjectSet.has(item);
                }
                const samplePos = this.getLosVisibilitySamplePointForItem(item, mapRef, wizard);
                if (!samplePos) return false;
                return this.isWorldPointInLosShadow(samplePos.x, samplePos.y, wizard, mapRef);
            };

            const visibleObjects = Array.isArray(visibleObjectsOverride)
                ? visibleObjectsOverride
                : this.collectVisibleObjects(visibleNodes, ctx);
            let animalLosHiddenCount = 0;
            let itemMazeHiddenCount = 0;
            let wallMazeHiddenCount = 0;
            const filterStartMs = nowIfEnabled();
            const mapItems = visibleObjects.filter(item => {
                if (!item) return false;
                if (!this.isScriptVisible(item)) return false;
                if (item.type === "road" || item === wizard) return false;
                if (isAnimalHiddenByLos(item)) {
                    animalLosHiddenCount += 1;
                    return false;
                }
                if (isItemHiddenByMazeLos(item)) {
                    itemMazeHiddenCount += 1;
                    if (item.type === "wallSection") {
                        wallMazeHiddenCount += 1;
                    }
                    return false;
                }
                return true;
            });
            const filterMs = diagnosticsEnabled ? (performance.now() - filterStartMs) : 0;
            const renderNowMs = Number.isFinite(ctx && ctx.renderNowMs) ? Number(ctx.renderNowMs) : performance.now();
            const inMazeModeActivationRevealBypassWindow = !!(
                useMazeLosClipping &&
                Number.isFinite(this.mazeModeActivatedAtMs) &&
                (renderNowMs - Number(this.mazeModeActivatedAtMs)) <= MAZE_MODE_ACTIVATION_SKIP_REVEAL_MS
            );
            const skipMazeRevealAnimationForActivation = !!(
                useMazeLosClipping &&
                (
                    this.mazeModeSuppressRevealAnimation ||
                    inMazeModeActivationRevealBypassWindow
                )
            );
            const roofItems = this.getRoofsList(ctx).filter(roofRef =>
                roofRef &&
                !roofRef.gone &&
                this.isScriptVisible(roofRef) &&
                !isItemHiddenByMazeLos(roofRef)
            );
            const renderItems = mapItems.concat(roofItems);
            this.setFrameMetric("objects3dFilterMs", filterMs);
            this.setFrameMetric("objects3dAnimalLosHidden", animalLosHiddenCount);
            this.setFrameMetric("objects3dMazeHidden", itemMazeHiddenCount);
            this.setFrameMetric("objects3dMazeHiddenWalls", wallMazeHiddenCount);
            this.setFrameMetric("objects3dMapItems", mapItems.length);
            this.setFrameMetric("objects3dRoofItems", roofItems.length);
            this.setFrameMetric("objects3dRenderItems", renderItems.length);
            for (let i = 0; i < renderItems.length; i++) {
                this.updateSinkAnimation(renderItems[i], renderNowMs);
            }

            const transformStartMs = nowIfEnabled();
            for (let i = 0; i < renderItems.length; i++) {
                const item = renderItems[i];
                if (!item) continue;
                if (item.type === "roof") {
                    this.updateRoofPreview(item, ctx.wizard || global.wizard || null);
                    continue;
                }
                const isWallMountedSpatial = this.isWallMountedSpatialItem(item);
                if (!isWallMountedSpatial) {
                    if (item.skipTransform && typeof item.draw === "function") {
                        item.draw();
                    } else {
                        this.applySpriteTransform(item);
                    }
                }
            }
            const transformMs = diagnosticsEnabled ? (performance.now() - transformStartMs) : 0;
            this.setFrameMetric("objects3dTransformMs", transformMs);
            const depthStartMs = nowIfEnabled();
            const depthBillboardRenderedItems = this.renderDepthBillboardObjects(ctx, renderItems);
            const depthMs = diagnosticsEnabled ? (performance.now() - depthStartMs) : 0;
            this.setFrameMetric("objects3dDepthMs", depthMs);
            this.setFrameMetric("objects3dDepthRendered", depthBillboardRenderedItems.size);
            const groundStartMs = nowIfEnabled();
            const groundObjectsRenderedItems = this.renderGroundObjects(ctx, renderItems, depthBillboardRenderedItems);
            const groundMs = diagnosticsEnabled ? (performance.now() - groundStartMs) : 0;
            this.setFrameMetric("objects3dGroundMs", groundMs);
            this.setFrameMetric("objects3dGroundRendered", groundObjectsRenderedItems.size);
            const currentDisplayObjects = new Set();
            const displayStartMs = nowIfEnabled();

            for (let i = 0; i < renderItems.length; i++) {
                const item = renderItems[i];
                if (!item) continue;
                if (depthBillboardRenderedItems.has(item)) continue;
                if (groundObjectsRenderedItems.has(item)) continue;
                if (item.type === "triggerArea") {
                    const triggerOverlayContainer = (!showPickerScreen && this.layers && this.layers.ui)
                        ? this.layers.ui
                        : container;
                    this.renderTriggerAreaOmnivisionOutline(item, triggerOverlayContainer, omnivisionActive, wizard);
                    this.renderTriggerAreaVertexMarkers(item, triggerOverlayContainer, wizard);
                    if (item._triggerOutlineGraphics) {
                        currentDisplayObjects.add(item._triggerOutlineGraphics);
                    }
                    if (item._triggerVertexGraphics) {
                        currentDisplayObjects.add(item._triggerVertexGraphics);
                    }
                    if (item.pixiSprite) {
                        this.applySpriteTransform(item);
                        item.pixiSprite.visible = false;
                        if (Object.prototype.hasOwnProperty.call(item.pixiSprite, "renderable")) {
                            item.pixiSprite.renderable = false;
                        }
                        if (this.shouldShowTriggerAreaPickerPolygon()) {
                            this.addPickRenderItem(item, item.pixiSprite, { forceInclude: true });
                        }
                    }
                    continue;
                }
                let displayObj = (item.type === "roof")
                    ? (item.pixiMesh || null)
                    : (item.pixiSprite || null);
                const wallCtor = global.WallSectionUnit || null;
                const wallBottomOutlineOnly = !!(
                    item.type === "wallSection" &&
                    wallCtor &&
                    wallCtor._showBottomFaceOnlyDebug
                );
                if (
                    item.type === "wallSection" &&
                    typeof item.getDepthMeshDisplayObject === "function" &&
                    !wallBottomOutlineOnly
                ) {
                    const clipWallToLosVisibleSpan = !!(
                        useMazeLosClipping &&
                        isWallDirectlyVisibleByMazeLos(item)
                    );
                    const depthDisplay = item.getDepthMeshDisplayObject({
                        camera: this.camera,
                        app: ctx.app,
                        viewscale: this.camera.viewscale,
                        xyratio: this.camera.xyratio,
                        worldToScreenFn: (pt) => this.camera.worldToScreen(Number(pt && pt.x) || 0, Number(pt && pt.y) || 0, 0),
                        // Use regular wall geometry; LOS visibility still filters which walls render.
                        // _roofForceTopFace: render only the top face for back-facing roof walls.
                        mazeMode: false,
                        topFaceOnly: !!item._roofForceTopFace,
                        bottomFaceOnly: !!(item.type === "wallSection" && wallCtor && wallCtor._showBottomFaceOnlyDebug),
                        clipToLosVisibleSpan: clipWallToLosVisibleSpan,
                        skipMazeRevealAnimation: !!(
                            this.mazeModeJustActivatedFrame ||
                            skipMazeRevealAnimationForActivation
                        ),
                        visibleWallIdSet,
                        nowMs: renderNowMs,
                        player: wizard,
                        tint: item.pixiSprite && Number.isFinite(item.pixiSprite.tint)
                            ? item.pixiSprite.tint
                            : 0xFFFFFF,
                        alpha: item.pixiSprite && Number.isFinite(item.pixiSprite.alpha)
                            ? item.pixiSprite.alpha
                            : 1,
                        brightness: Number.isFinite(item.brightness)
                            ? Number(item.brightness)
                            : 0
                    });
                    if (depthDisplay) {
                        displayObj = depthDisplay;
                    } else if (useMazeLosClipping) {
                        displayObj = null;
                    }
                }
                if (wallBottomOutlineOnly && item._depthDisplayMesh) {
                    if (item._depthDisplayMesh.parent) {
                        item._depthDisplayMesh.parent.removeChild(item._depthDisplayMesh);
                    }
                    item._depthDisplayMesh.visible = false;
                }
                if (!displayObj) continue;
                const isRoofItem = item.type === "roof";
                if (isRoofItem && !displayObj.visible) {
                    if (Object.prototype.hasOwnProperty.call(displayObj, "renderable")) {
                        displayObj.renderable = false;
                    }
                    item._renderingDisplayObject = displayObj;
                    continue;
                }
                if (displayObj.parent !== container) {
                    container.addChild(displayObj);
                }
                if (!isRoofItem) {
                    displayObj.visible = true;
                }
                item._renderingDisplayObject = displayObj;
                if (Object.prototype.hasOwnProperty.call(displayObj, "renderable")) {
                    displayObj.renderable = true;
                }
                this.applyScriptBrightness(item, displayObj);
                this.applyFrozenTint(item, displayObj);
                const displayVisibleAfterSinkClip = this.applySinkClip(item, displayObj);
                if (displayVisibleAfterSinkClip) {
                    currentDisplayObjects.add(displayObj);
                }
                if (
                    item.type === "roof" &&
                    typeof PIXI !== "undefined" &&
                    displayObj instanceof PIXI.Container
                ) {
                    const roofChildren = Array.isArray(displayObj.children) ? displayObj.children : [];
                    for (let c = 0; c < roofChildren.length; c++) {
                        const child = roofChildren[c];
                        if (!child) continue;
                        if (!(child instanceof PIXI.Mesh) && !(child instanceof PIXI.Sprite)) continue;
                        if (displayVisibleAfterSinkClip) {
                            this.addPickRenderItem(item, child);
                        }
                    }
                } else if (displayVisibleAfterSinkClip) {
                    this.addPickRenderItem(item, displayObj);
                }
            }

            // Ensure wall-mounted depth billboards (windows/doors) win picker hits over wall sections.
            // Their visible pixels should be targetable even when coplanar with section meshes.
            for (let i = 0; i < renderItems.length; i++) {
                const item = renderItems[i];
                if (!item || !depthBillboardRenderedItems.has(item)) continue;
                const isWallMountedSpatial = this.isWallMountedSpatialItem(item);
                if (!isWallMountedSpatial) continue;
                const mesh = item._renderingDepthMesh;
                if (!mesh || !mesh.parent || !mesh.visible) continue;
                this.addPickRenderItem(item, mesh, { forceInclude: true });
            }

            for (const obj of this.activeObjectDisplayObjects) {
                if (!currentDisplayObjects.has(obj) && obj) {
                    obj.visible = false;
                }
            }
            this.activeObjectDisplayObjects = currentDisplayObjects;

            const visibleAnimalItems = new Set();
            for (let i = 0; i < renderItems.length; i++) {
                const item = renderItems[i];
                if (!item) continue;
                if (!(typeof Animal !== "undefined" && item instanceof Animal)) continue;
                visibleAnimalItems.add(item);
                if (typeof item.updateHealthBarOverlay === "function") {
                    item.updateHealthBarOverlay(this.camera, this.layers.entities || this.getCharacterLayer());
                }
            }
            for (const animal of this.activeAnimalHealthBarItems) {
                if (visibleAnimalItems.has(animal)) continue;
                if (animal && typeof animal.hideHealthBarOverlay === "function") {
                    animal.hideHealthBarOverlay();
                }
            }
            this.activeAnimalHealthBarItems = visibleAnimalItems;

            const visibleTreeItems = new Set();
            for (let i = 0; i < renderItems.length; i++) {
                const item = renderItems[i];
                if (!item || item.type !== "tree") continue;
                if (typeof item.updateHealthBarOverlay !== "function") continue;
                visibleTreeItems.add(item);
                item.updateHealthBarOverlay(this.camera, this.layers.entities || this.getCharacterLayer());
            }
            for (const tree of this.activeTreeHealthBarItems) {
                if (visibleTreeItems.has(tree)) continue;
                if (tree && typeof tree.hideHealthBarOverlay === "function") {
                    tree.hideHealthBarOverlay();
                }
            }
            this.activeTreeHealthBarItems = visibleTreeItems;

            const displayMs = diagnosticsEnabled ? (performance.now() - displayStartMs) : 0;
            this.setFrameMetric("objects3dDisplayMs", displayMs);
            this.setFrameMetric("objects3dDisplayObjects", currentDisplayObjects.size);
            this.setFrameMetric("objects3dVisibleAnimals", visibleAnimalItems.size);
            this.setFrameMetric("objects3dVisibleTrees", visibleTreeItems.size);
        }

        renderWizard(ctx) {
            const depthContainer = this.getCharacterLayer();
            const overlayContainer = (this.layers && (this.layers.entities || this.layers.characters || this.layers.depthObjects)) || null;
            const wizard = ctx.wizard;
            if (!wizard || !Number.isFinite(wizard.x) || !Number.isFinite(wizard.y)) return;
            if (!depthContainer || !overlayContainer) return;

            const createWizardSprite = (texture) => {
                const sprite = new PIXI.Sprite(texture || PIXI.Texture.WHITE);
                sprite.name = "renderingWizard";
                sprite.anchor.set(0.5, 0.75);
                return sprite;
            };
            const ensureWizardSprite = (forceRecreate = false) => {
                const current = this.wizardSprite;
                const transform = current && current.transform ? current.transform : null;
                const anchor = current && current._anchor ? current._anchor : null;
                const usable = !!(
                    current &&
                    current.destroyed !== true &&
                    transform &&
                    transform.scale &&
                    anchor
                );
                if (!forceRecreate && usable) {
                    return current;
                }
                if (current && current.parent) {
                    current.parent.removeChild(current);
                }
                if (current && typeof current.destroy === "function") {
                    try {
                        current.destroy({ children: false, texture: false, baseTexture: false });
                    } catch (_destroyErr) {
                        // Ignore stale Pixi teardown failures and rebuild the sprite.
                    }
                }
                const initialTexture = (Array.isArray(ctx.wizardFrames) && ctx.wizardFrames[0])
                    ? ctx.wizardFrames[0]
                    : PIXI.Texture.WHITE;
                this.wizardSprite = createWizardSprite(initialTexture);
                return this.wizardSprite;
            };

            let wizardSprite = ensureWizardSprite();
            wizard.pixiSprite = wizardSprite;
            if (wizardSprite.parent) {
                wizardSprite.parent.removeChild(wizardSprite);
            }

            const visualSpeed = Math.hypot(
                Number(wizard?.movementVector?.x) || 0,
                Number(wizard?.movementVector?.y) || 0
            );
            const isVisuallyMoving = !!wizard.moving || visualSpeed > 0.02;
            const rowIndex = Number.isInteger(wizard.lastDirectionRow)
                ? ((wizard.lastDirectionRow % 12) + 12) % 12
                : 0;

            let frameIndex = rowIndex * 9;
            if (wizard.isJumping) {
                frameIndex = rowIndex * 9 + 2;
            } else if (isVisuallyMoving) {
                const speedRatio = (wizard.speed > 0)
                    ? (visualSpeed / wizard.speed)
                    : 0;
                const nowMs = Number.isFinite(ctx.renderNowMs) ? ctx.renderNowMs : performance.now();
                const simFrameRate = Number.isFinite(ctx.frameRate) ? ctx.frameRate : 60;
                const animSpeed = Number.isFinite(wizard.animationSpeedMultiplier)
                    ? wizard.animationSpeedMultiplier
                    : 1;
                const simTicks = (nowMs / 1000) * simFrameRate;
                const animFrame = Math.floor(simTicks * animSpeed * speedRatio / 2) % 8;
                const effectiveAnimFrame = wizard.isMovingBackward ? (7 - animFrame) : animFrame;
                frameIndex = rowIndex * 9 + 1 + effectiveAnimFrame;
            }

            if (Array.isArray(ctx.wizardFrames) && ctx.wizardFrames[frameIndex]) {
                try {
                    wizardSprite.texture = ctx.wizardFrames[frameIndex];
                } catch (_textureErr) {
                    wizardSprite = ensureWizardSprite(true);
                    wizard.pixiSprite = wizardSprite;
                    try {
                        wizardSprite.texture = ctx.wizardFrames[frameIndex] || PIXI.Texture.WHITE;
                    } catch (_retryErr) {
                        wizardSprite.texture = PIXI.Texture.WHITE;
                    }
                }
            }

            const invisibilityActive = this.isInvisibilityActive(wizard);
            const wizardAlpha = invisibilityActive ? 0.45 : 1;
            wizardSprite.alpha = wizardAlpha;

            const alpha = Number.isFinite(ctx.renderAlpha)
                ? Math.max(0, Math.min(1, ctx.renderAlpha))
                : 1;
            const renderPos = (wizard && typeof wizard.getInterpolatedPosition === "function")
                ? wizard.getInterpolatedPosition(alpha)
                : {
                    x: Number.isFinite(wizard.x) ? wizard.x : 0,
                    y: Number.isFinite(wizard.y) ? wizard.y : 0,
                    z: Number.isFinite(wizard.z) ? wizard.z : 0
                };
            const pGround = this.camera.worldToScreen(renderPos.x, renderPos.y, 0);
            const interpolatedJumpHeight = Number.isFinite(renderPos.z) ? renderPos.z : 0;
            const jumpOffsetPx = interpolatedJumpHeight * this.camera.viewscale * this.camera.xyratio;
            const wizardCenterY = pGround.y - jumpOffsetPx - (this.camera.viewscale * 0.25);
            const renderNowMs = Number.isFinite(ctx.renderNowMs)
                ? Number(ctx.renderNowMs)
                : ((typeof performance !== "undefined" && performance && typeof performance.now === "function")
                    ? performance.now()
                    : Date.now());
            const deathAnimationActive = !!(
                wizard &&
                typeof wizard.isAdventureDeathAnimationActive === "function" &&
                wizard.isAdventureDeathAnimationActive(renderNowMs)
            );
            const deathAnimationProgress = deathAnimationActive && typeof wizard.getAdventureDeathAnimationProgress === "function"
                ? wizard.getAdventureDeathAnimationProgress(renderNowMs)
                : 0;
            const ghostSprite = this.ensureWizardGhostSprite();

            wizardSprite.width = this.camera.viewscale;
            wizardSprite.height = this.camera.viewscale;
            wizardSprite.visible = false;
            if (Object.prototype.hasOwnProperty.call(wizardSprite, "renderable")) {
                wizardSprite.renderable = false;
            }
            if (ghostSprite) {
                ghostSprite.visible = false;
                if (Object.prototype.hasOwnProperty.call(ghostSprite, "renderable")) {
                    ghostSprite.renderable = false;
                }
            }

            if (deathAnimationActive) {
                if (wizard._renderingDepthMesh) {
                    wizard._renderingDepthMesh.visible = false;
                    if (Object.prototype.hasOwnProperty.call(wizard._renderingDepthMesh, "renderable")) {
                        wizard._renderingDepthMesh.renderable = false;
                    }
                }
                const shadowProxy = this.ensureWizardShadowProxy();
                if (shadowProxy && shadowProxy._renderingDepthMesh) {
                    shadowProxy._renderingDepthMesh.visible = false;
                    if (Object.prototype.hasOwnProperty.call(shadowProxy._renderingDepthMesh, "renderable")) {
                        shadowProxy._renderingDepthMesh.renderable = false;
                    }
                }
                if (this.wizardShadowGraphics) {
                    this.wizardShadowGraphics.visible = false;
                    if (Object.prototype.hasOwnProperty.call(this.wizardShadowGraphics, "renderable")) {
                        this.wizardShadowGraphics.renderable = false;
                    }
                }
                if (wizardSprite.parent !== overlayContainer) {
                    overlayContainer.addChild(wizardSprite);
                }
                wizardSprite.anchor.set(0.5, 0.5);
                wizardSprite.x = pGround.x;
                wizardSprite.y = wizardCenterY;
                wizardSprite.rotation = Math.PI / 2;
                wizardSprite.alpha = wizardAlpha;
                wizardSprite.visible = true;
                if (Object.prototype.hasOwnProperty.call(wizardSprite, "renderable")) {
                    wizardSprite.renderable = true;
                }

                if (ghostSprite) {
                    if (ghostSprite.parent !== overlayContainer) {
                        overlayContainer.addChild(ghostSprite);
                    }
                    const riseDistance = this.camera.viewscale * 0.55;
                    ghostSprite.x = pGround.x;
                    ghostSprite.y = wizardCenterY - (this.camera.viewscale * 0.05) - (riseDistance * deathAnimationProgress);
                    ghostSprite.width = this.camera.viewscale * 0.8;
                    ghostSprite.height = this.camera.viewscale * 0.95;
                    ghostSprite.alpha = Math.max(0, Math.min(1, deathAnimationProgress / 0.2));
                    ghostSprite.visible = true;
                    if (Object.prototype.hasOwnProperty.call(ghostSprite, "renderable")) {
                        ghostSprite.renderable = true;
                    }
                }
            }

            const staticProto = (typeof global.StaticObject === "function" && global.StaticObject.prototype)
                ? global.StaticObject.prototype
                : null;
            let wizardDepthMesh = null;
            if (!deathAnimationActive && staticProto && typeof staticProto.updateDepthBillboardMesh === "function") {
                if (typeof staticProto.ensureDepthBillboardMesh === "function") {
                    wizard.ensureDepthBillboardMesh = staticProto.ensureDepthBillboardMesh;
                }
                if (typeof staticProto.updateDepthBillboardUvsForTexture === "function") {
                    wizard.updateDepthBillboardUvsForTexture = staticProto.updateDepthBillboardUvsForTexture;
                }
                const savedX = wizard.x;
                const savedY = wizard.y;
                const savedZ = wizard.z;
                wizard.x = renderPos.x;
                wizard.y = renderPos.y;
                wizard.z = renderPos.z;
                wizardDepthMesh = staticProto.updateDepthBillboardMesh.call(wizard, ctx, this.camera, {
                    alphaCutoff: TREE_ALPHA_CUTOFF,
                    mazeMode: false,
                    player: wizard
                });
                wizard.x = savedX;
                wizard.y = savedY;
                wizard.z = savedZ;
            }
            if (wizardDepthMesh) {
                wizard._renderingDepthMesh = wizardDepthMesh;
                if (wizardDepthMesh.parent !== depthContainer) {
                    depthContainer.addChild(wizardDepthMesh);
                }
                wizardDepthMesh.alpha = wizardAlpha;
                wizardDepthMesh.visible = true;
                if (Object.prototype.hasOwnProperty.call(wizardDepthMesh, "renderable")) {
                    wizardDepthMesh.renderable = true;
                }
                this.addPickRenderItem(wizard, wizardDepthMesh, { forceInclude: true });
            } else if (wizard._renderingDepthMesh) {
                wizard._renderingDepthMesh.visible = false;
                if (Object.prototype.hasOwnProperty.call(wizard._renderingDepthMesh, "renderable")) {
                    wizard._renderingDepthMesh.renderable = false;
                }
            }

            if (this.wizardShadowGraphics) {
                this.wizardShadowGraphics.visible = false;
                if (Object.prototype.hasOwnProperty.call(this.wizardShadowGraphics, "renderable")) {
                    this.wizardShadowGraphics.renderable = false;
                }
            }

            const shadowProxy = this.ensureWizardShadowProxy();
            if (!deathAnimationActive && shadowProxy && typeof shadowProxy.updateDepthBillboardMesh === "function") {
                shadowProxy.map = wizard.map || global.map || null;
                shadowProxy.x = renderPos.x;
                shadowProxy.y = renderPos.y + 0.23;
                shadowProxy.z = 0;
                shadowProxy.visible = true;
                shadowProxy.gone = false;
                shadowProxy.vanishing = false;
                shadowProxy.width = 0.44;
                shadowProxy.height = 0.44;
                shadowProxy.pixiSprite.width = 0.44 * this.camera.viewscale;
                shadowProxy.pixiSprite.height = 0.44 * this.camera.viewscale;
                shadowProxy.pixiSprite.alpha = invisibilityActive ? 0.25 : 1;
                shadowProxy.pixiSprite.tint = 0xFFFFFF;
                const shadowMesh = shadowProxy.updateDepthBillboardMesh(ctx, this.camera, {
                    alphaCutoff: 0.01,
                    mazeMode: false,
                    player: wizard
                });
                if (shadowMesh) {
                    shadowProxy._renderingDepthMesh = shadowMesh;
                    if (shadowMesh.parent !== depthContainer) {
                        depthContainer.addChild(shadowMesh);
                    }
                    shadowMesh.alpha = invisibilityActive ? 0.25 : 1;
                    shadowMesh.visible = true;
                    if (Object.prototype.hasOwnProperty.call(shadowMesh, "renderable")) {
                        shadowMesh.renderable = true;
                    }
                }
            } else if (shadowProxy && shadowProxy._renderingDepthMesh) {
                shadowProxy._renderingDepthMesh.visible = false;
                if (Object.prototype.hasOwnProperty.call(shadowProxy._renderingDepthMesh, "renderable")) {
                    shadowProxy._renderingDepthMesh.renderable = false;
                }
            }

            const hat = wizard.hatGraphics;
            if (wizard && typeof wizard.drawShield === "function") {
                if (deathAnimationActive) {
                    if (wizard.shieldGraphics) {
                        wizard.shieldGraphics.visible = false;
                    }
                    if (wizard.shieldWireframeMesh) {
                        wizard.shieldWireframeMesh.visible = false;
                        if (Object.prototype.hasOwnProperty.call(wizard.shieldWireframeMesh, "renderable")) {
                            wizard.shieldWireframeMesh.renderable = false;
                        }
                    }
                } else {
                    wizard.drawShield(interpolatedJumpHeight, renderPos);
                }
            }
            if (hat && typeof hat === "object") {
                if (hat.parent !== overlayContainer) {
                    overlayContainer.addChild(hat);
                }
                if (deathAnimationActive) {
                    const hatYOffset = (Number.isFinite(wizard.hatRenderYOffsetUnits) ? wizard.hatRenderYOffsetUnits : 0)
                        * this.camera.viewscale * this.camera.xyratio;
                    const bodyCenterToHatOriginY = (this.camera.viewscale * 0.25) - hatYOffset;
                    const deathRotation = Math.PI / 2;
                    const cosTheta = Math.cos(deathRotation);
                    const sinTheta = Math.sin(deathRotation);
                    const rotatedHatOffsetX = 0 * cosTheta - bodyCenterToHatOriginY * sinTheta;
                    const rotatedHatOffsetY = 0 * sinTheta + bodyCenterToHatOriginY * cosTheta;
                    hat.x = pGround.x + rotatedHatOffsetX;
                    hat.y = wizardCenterY + rotatedHatOffsetY;
                    hat.rotation = deathRotation;
                } else {
                    hat.x = pGround.x;
                    const hatYOffset = (Number.isFinite(wizard.hatRenderYOffsetUnits) ? wizard.hatRenderYOffsetUnits : 0)
                        * this.camera.viewscale * this.camera.xyratio;
                    hat.y = pGround.y - jumpOffsetPx - hatYOffset;
                    hat.rotation = 0;
                }
                if (hat.scale && typeof hat.scale.set === "function") {
                    const hatRes = Number.isFinite(wizard.hatResolution) ? Math.max(1, wizard.hatResolution) : 1;
                    const hatRenderScale = Number.isFinite(wizard.hatRenderScale) ? Math.max(0.05, wizard.hatRenderScale) : 1;
                    const s = (this.camera.viewscale / hatRes) * hatRenderScale;
                    hat.scale.set(s, s);
                }
                hat.alpha = wizardAlpha;
                hat.visible = true;
                if (hat.parent && hat.parent.children[hat.parent.children.length - 1] !== hat) {
                    hat.parent.setChildIndex(hat, hat.parent.children.length - 1);
                }
            }
        }

        renderPowerups(ctx) {
            const depthContainer = this.layers.depthObjects;
            if (!depthContainer) return;
            const maskedContainer = this.layers.groundObjects || depthContainer;
            const wizard = (ctx && ctx.wizard) ? ctx.wizard : null;
            const mapRef = (ctx && ctx.map) ? ctx.map : (this.camera && this.camera.map) || global.map || null;
            const mazeLosActive = !!(
                this.isLosMazeModeEnabled() &&
                !this.isOmnivisionActive(wizard) &&
                wizard
            );

            const list = Array.isArray(ctx && ctx.powerups)
                ? ctx.powerups
                : (Array.isArray(global.powerups) ? global.powerups : []);
            const currentDisplayObjects = new Set();
            const renderNowMs = Number.isFinite(ctx && ctx.renderNowMs) ? Number(ctx.renderNowMs) : Date.now();

            for (let i = 0; i < list.length; i++) {
                const powerup = list[i];
                if (!powerup || powerup.gone || powerup.collected) continue;
                if (!Number.isFinite(powerup.x) || !Number.isFinite(powerup.y)) continue;
                this.updateSinkAnimation(powerup, renderNowMs);
                if (typeof powerup.ensureSprite === "function") {
                    powerup.ensureSprite();
                }
                const sprite = powerup.pixiSprite;
                if (!sprite) continue;
                if (typeof powerup.updateSpriteAnimation === "function") {
                    powerup.updateSpriteAnimation();
                }

                if (
                    wizard &&
                    (mazeLosActive || !this.isForceVisible(powerup)) &&
                    this.isRadialItemHiddenByLos(powerup, wizard, mapRef)
                ) {
                    sprite.visible = false;
                    if (Object.prototype.hasOwnProperty.call(sprite, "renderable")) {
                        sprite.renderable = false;
                    }
                    if (powerup._renderingDepthMesh) {
                        powerup._renderingDepthMesh.visible = false;
                        if (Object.prototype.hasOwnProperty.call(powerup._renderingDepthMesh, "renderable")) {
                            powerup._renderingDepthMesh.renderable = false;
                        }
                    }
                    powerup._renderingDepthMesh = null;
                    powerup._renderingDisplayObject = null;
                    continue;
                }

                const point = this.camera.worldToScreen(
                    powerup.x,
                    powerup.y,
                    Number.isFinite(powerup.z) ? powerup.z : 0
                );
                const w = Number.isFinite(powerup.width) ? Math.max(0.01, Number(powerup.width)) : 0.8;
                const h = Number.isFinite(powerup.height) ? Math.max(0.01, Number(powerup.height)) : 0.8;
                const lodTexturePath = this.resolvePowerupLodTexturePath(powerup);
                if (typeof lodTexturePath === "string" && lodTexturePath.length > 0 && lodTexturePath !== powerup._activeLodTexturePath) {
                    sprite.texture = PIXI.Texture.from(lodTexturePath);
                    powerup._activeLodTexturePath = lodTexturePath;
                }
                sprite.x = point.x;
                sprite.y = point.y;
                sprite.width = w * this.camera.viewscale;
                sprite.height = h * this.camera.viewscale;

                let depthMesh = null;
                if (typeof powerup.updateDepthBillboardMesh === "function") {
                    depthMesh = powerup.updateDepthBillboardMesh(ctx, this.camera, { alphaCutoff: TREE_ALPHA_CUTOFF });
                }

                if (!depthMesh) {
                    sprite.visible = false;
                    if (Object.prototype.hasOwnProperty.call(sprite, "renderable")) {
                        sprite.renderable = false;
                    }
                    powerup._renderingDepthMesh = null;
                    powerup._renderingDisplayObject = null;
                    continue;
                }

                const targetContainer = mazeLosActive
                    ? maskedContainer
                    : depthContainer;
                if (depthMesh.parent !== targetContainer) {
                    targetContainer.addChild(depthMesh);
                }
                depthMesh.visible = true;
                if (Object.prototype.hasOwnProperty.call(depthMesh, "renderable")) {
                    depthMesh.renderable = true;
                }
                sprite.visible = false;
                if (Object.prototype.hasOwnProperty.call(sprite, "renderable")) {
                    sprite.renderable = false;
                }

                powerup._renderingDepthMesh = depthMesh;
                powerup._renderingDisplayObject = depthMesh;
                if (this.applySinkClip(powerup, depthMesh)) {
                    currentDisplayObjects.add(depthMesh);
                    this.addPickRenderItem(powerup, depthMesh, { forceInclude: true });
                }
            }

            for (const sprite of this.activePowerupDisplayObjects) {
                if (!currentDisplayObjects.has(sprite) && sprite) {
                    sprite.visible = false;
                    if (Object.prototype.hasOwnProperty.call(sprite, "renderable")) {
                        sprite.renderable = false;
                    }
                }
            }
            this.activePowerupDisplayObjects = currentDisplayObjects;
        }

        renderProjectiles(ctx) {
            const container = this.layers.entities;
            if (!container) return;
            const wizard = (ctx && ctx.wizard) ? ctx.wizard : null;
            const mapRef = (ctx && ctx.map) ? ctx.map : (this.camera && this.camera.map) || global.map || null;
            const mazeLosActive = !!(
                this.isLosMazeModeEnabled() &&
                !this.isOmnivisionActive(wizard) &&
                wizard
            );

            const list = Array.isArray(ctx && ctx.projectiles)
                ? ctx.projectiles
                : (
                    (typeof projectiles !== "undefined" && Array.isArray(projectiles))
                        ? projectiles
                        : (Array.isArray(global.projectiles) ? global.projectiles : [])
                );
            const currentDisplayObjects = new Set();

            for (let i = 0; i < list.length; i++) {
                const projectile = list[i];
                if (!projectile || projectile.gone) continue;

                const texture = this.getProjectileTexture(projectile);
                let sprite = projectile.pixiSprite || null;
                if (!sprite) {
                    sprite = new PIXI.Sprite(texture || PIXI.Texture.WHITE);
                    sprite.anchor.set(0.5, 0.5);
                    projectile.pixiSprite = sprite;
                } else if (texture && sprite.texture !== texture) {
                    sprite.texture = texture;
                }

                if (sprite.parent !== container) {
                    container.addChild(sprite);
                }

                const worldX = Number.isFinite(projectile.x) ? Number(projectile.x) : 0;
                const worldY = Number.isFinite(projectile.y) ? Number(projectile.y) : 0;
                const worldZ = Number.isFinite(projectile.z) ? Number(projectile.z) : 0;
                const hiddenByMazeLos = !!(
                    mazeLosActive &&
                    this.isWorldPointInLosShadow(worldX, worldY, wizard, mapRef)
                );
                const visible = projectile.visible !== false && !hiddenByMazeLos;
                const spriteVisible = visible && !projectile.hideProjectileSprite;
                sprite.visible = spriteVisible;
                if (Object.prototype.hasOwnProperty.call(sprite, "renderable")) {
                    sprite.renderable = spriteVisible;
                }

                if (spriteVisible) {
                    const p = this.camera.worldToScreen(worldX, worldY, 0);
                    sprite.x = p.x;
                    sprite.y = p.y - worldZ * this.camera.viewscale * this.camera.xyratio;

                    const zoomFactor = Math.max(
                        0.01,
                        Number.isFinite(global.viewportZoomFactor)
                            ? Number(global.viewportZoomFactor)
                            : 1
                    );
                    const apparentSize = Number.isFinite(projectile.apparentSize)
                        ? Number(projectile.apparentSize)
                        : NaN;
                    const fallbackSize = (
                        Number.isFinite(projectile.size)
                            ? Number(projectile.size)
                            : 0.35
                    ) * this.camera.viewscale;
                    const sizePx = Math.max(
                        1,
                        Number.isFinite(apparentSize) && apparentSize > 0
                            ? (apparentSize * zoomFactor)
                            : fallbackSize
                    );
                    sprite.width = sizePx;
                    sprite.height = sizePx;

                    if ((projectile.type === "arrow" || projectile.rotateSpriteToMovement) && projectile.movement) {
                        const moveX = Number(projectile.movement.x) || 0;
                        const moveY = Number(projectile.movement.y) || 0;
                        if (Math.hypot(moveX, moveY) > 1e-6) {
                            const rotationOffset = Number.isFinite(projectile.spriteRotationOffset)
                                ? Number(projectile.spriteRotationOffset)
                                : Math.PI * 0.5;
                            sprite.rotation = Math.atan2(moveY, moveX) + rotationOffset;
                        }
                    } else {
                        sprite.rotation = Number(projectile.spriteRotation) || 0;
                    }
                }

                currentDisplayObjects.add(sprite);
                const particleGraphics = this.renderProjectileParticles(projectile, container, hiddenByMazeLos);
                if (particleGraphics) {
                    currentDisplayObjects.add(particleGraphics);
                }
            }

            for (const sprite of this.activeProjectileDisplayObjects) {
                if (!currentDisplayObjects.has(sprite) && sprite) {
                    if (typeof sprite.clear === "function") {
                        sprite.clear();
                    }
                    sprite.visible = false;
                    if (Object.prototype.hasOwnProperty.call(sprite, "renderable")) {
                        sprite.renderable = false;
                    }
                    if (sprite.parent) {
                        sprite.parent.removeChild(sprite);
                    }
                }
            }
            this.activeProjectileDisplayObjects = currentDisplayObjects;
        }

        renderCreatureTracePaths(ctx) {
            const container = this.layers.entities;
            if (!container) return;
            const creatureList = Array.isArray(ctx && ctx.animals)
                ? ctx.animals
                : ((typeof animals !== "undefined" && Array.isArray(animals)) ? animals : (Array.isArray(global.animals) ? global.animals : []));
            const mapRef = (ctx && ctx.map) ? ctx.map : (this.camera && this.camera.map) || global.map || null;
            const renderNowMs = Number.isFinite(ctx && ctx.renderNowMs) ? Number(ctx.renderNowMs) : Date.now();
            const isGamePaused = !!((typeof paused !== "undefined" && paused) || global.paused);
            const CameraCtor = global.RenderingCamera;

            for (let i = 0; i < creatureList.length; i++) {
                const creature = creatureList[i];
                if (!creature) continue;

                const traceState = (typeof creature.updateTracePathLifetime === "function")
                    ? creature.updateTracePathLifetime(renderNowMs, isGamePaused)
                    : null;
                const traceLog = Array.isArray(creature.nodeVisitLog) ? creature.nodeVisitLog : [];
                const shouldRender = !!(
                    traceState &&
                    traceLog.length >= 2 &&
                    !creature.gone
                );

                let graphics = creature._tracePathGraphics || null;
                if (!shouldRender) {
                    if (graphics) {
                        graphics.clear();
                        graphics.visible = false;
                    }
                    continue;
                }

                if (!graphics) {
                    graphics = new PIXI.Graphics();
                    graphics.name = "creatureTracePath";
                    creature._tracePathGraphics = graphics;
                }
                if (graphics.parent !== container) {
                    container.addChild(graphics);
                }

                graphics.clear();
                graphics.visible = true;
                graphics.zIndex = -10;
                graphics.alpha = 1;
                graphics.lineStyle(Math.max(2, this.camera.viewscale * 0.16), 0xb04cff, 0.9);

                const firstEntry = traceLog[0];
                if (!firstEntry) {
                    graphics.visible = false;
                    continue;
                }

                let continuousPoint = (CameraCtor && typeof CameraCtor.alignWorldPointToReference === "function")
                    ? CameraCtor.alignWorldPointToReference(
                        mapRef,
                        Number(this.camera && this.camera.x) || 0,
                        Number(this.camera && this.camera.y) || 0,
                        Number(firstEntry.x),
                        Number(firstEntry.y)
                    )
                    : { x: Number(firstEntry.x), y: Number(firstEntry.y) };
                let screenPoint = this.camera.worldToScreen(continuousPoint.x, continuousPoint.y, 0);
                graphics.moveTo(screenPoint.x, screenPoint.y);

                for (let j = 1; j < traceLog.length; j++) {
                    const entry = traceLog[j];
                    if (!entry || !Number.isFinite(entry.x) || !Number.isFinite(entry.y)) continue;
                    continuousPoint = (CameraCtor && typeof CameraCtor.alignWorldPointToReference === "function")
                        ? CameraCtor.alignWorldPointToReference(
                            mapRef,
                            continuousPoint.x,
                            continuousPoint.y,
                            Number(entry.x),
                            Number(entry.y)
                        )
                        : { x: Number(entry.x), y: Number(entry.y) };
                    screenPoint = this.camera.worldToScreen(continuousPoint.x, continuousPoint.y, 0);
                    graphics.lineTo(screenPoint.x, screenPoint.y);
                }
            }
        }

        renderScriptMessages(ctx) {
            const container = this.layers.scriptMessages;
            if (!container) return;
            const mapRef = (ctx && ctx.map) ? ctx.map : (this.camera && this.camera.map) || global.map || null;
            const wizard = (ctx && ctx.wizard) ? ctx.wizard : null;
            const wizardUnderRoof = !!(
                wizard &&
                Number.isFinite(wizard.x) &&
                Number.isFinite(wizard.y) &&
                this.isWorldPointUnderRoof(Number(wizard.x), Number(wizard.y), ctx)
            );
            const mazeLosActive = !!(
                this.isLosMazeModeEnabled() &&
                !this.isOmnivisionActive(wizard) &&
                wizard
            );

            // Collect objects with messages from the global registry AND from game objects
            const objectsWithMessages = [];
            const seen = new Set();

            // Primary source: global registry (set by this.message handler)
            const globalTargets = (global._scriptMessageTargets instanceof Set)
                ? global._scriptMessageTargets
                : null;
            if (globalTargets) {
                for (const item of globalTargets) {
                    if (!item || item.gone) {
                        globalTargets.delete(item);
                        continue;
                    }
                    if (!Array.isArray(item._scriptMessages) || item._scriptMessages.length === 0) {
                        globalTargets.delete(item);
                        continue;
                    }
                    if (item.visible === false) continue;
                    seen.add(item);
                    objectsWithMessages.push(item);
                }
            }

            // Fallback: scan game objects (in case registry was missed)
            if (mapRef && typeof mapRef.getGameObjects === "function") {
                const allObjects = mapRef.getGameObjects({ refresh: false }) || [];
                for (let i = 0; i < allObjects.length; i++) {
                    const item = allObjects[i];
                    if (!item || item.gone || seen.has(item)) continue;
                    if (!Array.isArray(item._scriptMessages) || item._scriptMessages.length === 0) continue;
                    if (item.visible === false) continue;
                    objectsWithMessages.push(item);
                }
            }

            const activeKeys = new Set();
            const parseScriptMessageColor = (value, fallback = 0xFFFFFF) => {
                if (Number.isFinite(value)) {
                    return Math.max(0, Math.min(0xFFFFFF, Math.floor(Number(value))));
                }
                if (typeof value === "string") {
                    const text = value.trim().toLowerCase();
                    if (/^#?[0-9a-f]{6}$/.test(text)) {
                        return parseInt(text.replace(/^#/, ""), 16);
                    }
                    if (/^0x[0-9a-f]{6}$/.test(text)) {
                        return parseInt(text, 16);
                    }
                }
                return fallback;
            };
            const normalizeScriptMessageFontSize = (value, fallback = 14) => {
                const parsed = Number(value);
                if (!Number.isFinite(parsed)) return fallback;
                return Math.max(8, Math.min(96, parsed));
            };

            for (let i = 0; i < objectsWithMessages.length; i++) {
                const item = objectsWithMessages[i];
                const messages = item._scriptMessages;

                const worldPos = this.resolveInterpolatedItemWorldPosition(item, mapRef);
                if (!worldPos) continue;
                if (
                    mazeLosActive &&
                    this.isWorldPointInLosShadow(worldPos.x, worldPos.y, wizard, mapRef)
                ) {
                    continue;
                }
                if (this.isWorldPointUnderRoof(worldPos.x, worldPos.y, ctx) && !wizardUnderRoof) {
                    continue;
                }

                // Stable key per object (lazy-assigned, survives array reordering)
                if (!item._scriptMessageRenderingId) {
                    item._scriptMessageRenderingId = "msgobj:" + (this._nextScriptMessageObjId = (this._nextScriptMessageObjId || 0) + 1);
                }

                for (let m = 0; m < messages.length; m++) {
                    const msg = messages[m];
                    if (!msg || typeof msg.text !== "string" || !msg.text.length) continue;
                    const key = item._scriptMessageRenderingId + ":" + m;
                    activeKeys.add(key);
                    const fillColor = parseScriptMessageColor(msg.color, 0xFFFFFF);
                    const fontSize = normalizeScriptMessageFontSize(msg.fontsize, 14);
                    const styleSignature = `${fillColor}:${fontSize}`;

                    let entry = this.scriptMessageTextObjects.get(key);
                    if (!entry) {
                        const textObj = new PIXI.Text(msg.text, {
                            fontFamily: "Arial, Helvetica, sans-serif",
                            fontSize,
                            fontWeight: "bold",
                            fill: fillColor,
                            stroke: 0x000000,
                            strokeThickness: 3,
                            align: "center",
                            wordWrap: true,
                            wordWrapWidth: 200
                        });
                        textObj.anchor.set(0.5, 0.5);
                        textObj.name = "scriptMsg_" + key;
                        container.addChild(textObj);
                        entry = { textObj, lastText: msg.text, lastStyleSignature: styleSignature };
                        this.scriptMessageTextObjects.set(key, entry);
                    } else if (entry.lastText !== msg.text) {
                        entry.textObj.text = msg.text;
                        entry.lastText = msg.text;
                    }
                    if (entry.lastStyleSignature !== styleSignature) {
                        entry.textObj.style.fill = fillColor;
                        entry.textObj.style.fontSize = fontSize;
                        entry.lastStyleSignature = styleSignature;
                    }

                    const offsetX = Number.isFinite(msg.x) ? msg.x : 0;
                    const offsetY = Number.isFinite(msg.y) ? msg.y : 0;

                    // Compute the visual center of the object, accounting for its
                    // actual anchor, dimensions, and rotation axis so the message
                    // is centred on its appearance rather than its anchor point.
                    let visCenterX = worldPos.x;
                    let visCenterY = worldPos.y;
                    let visCenterZ = Number.isFinite(item.z) ? item.z : 0;

                    const itemW = Number.isFinite(item.width) ? item.width : 0;
                    const itemH = Number.isFinite(item.height) ? item.height : 0;
                    const rotAxis = (typeof item.rotationAxis === "string") ? item.rotationAxis : "visual";

                    if (rotAxis === "ground") {
                        // Flat on the ground — visual center is just the position, no Z offset.
                    } else if (item._depthBillboardWorldPositions && item._depthBillboardWorldPositions.length >= 12) {
                        // Use the actual billboard quad corner positions for accuracy.
                        const wp = item._depthBillboardWorldPositions;
                        const count = Math.min(wp.length / 3, rotAxis === "spatial" && wp.length >= 24 ? 8 : 4);
                        let sx = 0, sy = 0, sz = 0;
                        for (let v = 0; v < count; v++) {
                            sx += wp[v * 3];
                            sy += wp[v * 3 + 1];
                            sz += wp[v * 3 + 2];
                        }
                        visCenterX = sx / count;
                        visCenterY = sy / count;
                        visCenterZ = sz / count;
                    } else if (itemW > 0 || itemH > 0) {
                        // Fallback: derive visual center from anchor + dimensions.
                        const sprAnchor = item.pixiSprite && item.pixiSprite.anchor;
                        const ax = Number.isFinite(item.placeableAnchorX)
                            ? Number(item.placeableAnchorX)
                            : (sprAnchor && Number.isFinite(sprAnchor.x) ? Number(sprAnchor.x) : 0.5);
                        const ay = Number.isFinite(item.placeableAnchorY)
                            ? Number(item.placeableAnchorY)
                            : (sprAnchor && Number.isFinite(sprAnchor.y) ? Number(sprAnchor.y) : 1);
                        const xyR = Math.max(0.0001, this.camera.xyratio || 0.66);
                        const worldHeightZ = (rotAxis === "spatial")
                            ? (itemH / xyR)
                            : itemH;
                        visCenterX += (0.5 - ax) * itemW;
                        visCenterZ += (ay - 0.5) * worldHeightZ;
                    }

                    const screenPos = this.camera.worldToScreen(
                        visCenterX + offsetX,
                        visCenterY + offsetY,
                        visCenterZ
                    );
                    entry.textObj.x = screenPos.x;
                    entry.textObj.y = screenPos.y;
                    entry.textObj.visible = true;
                }
            }

            // Hide/remove stale text objects
            for (const [key, entry] of this.scriptMessageTextObjects.entries()) {
                if (!activeKeys.has(key)) {
                    entry.textObj.visible = false;
                    if (entry.textObj.parent) {
                        entry.textObj.parent.removeChild(entry.textObj);
                    }
                    entry.textObj.destroy();
                    this.scriptMessageTextObjects.delete(key);
                }
            }
        }

        getMousePosRef(ctx) {
            if (ctx && ctx.mousePos) return ctx.mousePos;
            if (typeof mousePos !== "undefined") return mousePos;
            return global.mousePos || null;
        }

        ensurePlaceObjectPreviewItem(mapRef = null) {
            if (!this.placeObjectPreviewItem) {
                this.placeObjectPreviewItem = {
                    type: "placedObjectPreview",
                    map: mapRef || global.map || null,
                    gone: false,
                    vanishing: false,
                    isPlacedObject: true,
                    objectType: "placedObject",
                    pixiSprite: this.placeObjectPreviewSprite
                };
            }
            const previewItem = this.placeObjectPreviewItem;
            previewItem.map = mapRef || previewItem.map || global.map || null;
            previewItem.gone = false;
            previewItem.vanishing = false;
            previewItem.isPlacedObject = true;
            previewItem.objectType = "placedObject";
            previewItem.pixiSprite = this.placeObjectPreviewSprite;

            const staticProto = global.StaticObject && global.StaticObject.prototype
                ? global.StaticObject.prototype
                : null;
            if (staticProto && typeof staticProto.ensureDepthBillboardMesh === "function" && typeof previewItem.ensureDepthBillboardMesh !== "function") {
                previewItem.ensureDepthBillboardMesh = staticProto.ensureDepthBillboardMesh;
            }
            if (staticProto && typeof staticProto.updateDepthBillboardMesh === "function" && typeof previewItem.updateDepthBillboardMesh !== "function") {
                previewItem.updateDepthBillboardMesh = staticProto.updateDepthBillboardMesh;
            }
            if (staticProto && typeof staticProto._ensureCompositeUnderlayMesh === "function" && typeof previewItem._ensureCompositeUnderlayMesh !== "function") {
                previewItem._ensureCompositeUnderlayMesh = staticProto._ensureCompositeUnderlayMesh;
            }
            if (staticProto && typeof staticProto._destroyCompositeUnderlayMesh === "function" && typeof previewItem._destroyCompositeUnderlayMesh !== "function") {
                previewItem._destroyCompositeUnderlayMesh = staticProto._destroyCompositeUnderlayMesh;
            }

            return previewItem;
        }

        clearPlaceObjectPreview() {
            if (this.placeObjectPreviewItem) {
                if (this.placeObjectPreviewItem._depthBillboardMesh) {
                    const mesh = this.placeObjectPreviewItem._depthBillboardMesh;
                    mesh.visible = false;
                    if (Object.prototype.hasOwnProperty.call(mesh, "renderable")) {
                        mesh.renderable = false;
                    }
                }
                if (this.placeObjectPreviewItem._compositeUnderlayMesh) {
                    const mesh = this.placeObjectPreviewItem._compositeUnderlayMesh;
                    mesh.visible = false;
                    if (Object.prototype.hasOwnProperty.call(mesh, "renderable")) {
                        mesh.renderable = false;
                    }
                }
            }
            if (this.placeObjectPreviewDisplayObject) {
                this.placeObjectPreviewDisplayObject.visible = false;
                if (Object.prototype.hasOwnProperty.call(this.placeObjectPreviewDisplayObject, "renderable")) {
                    this.placeObjectPreviewDisplayObject.renderable = false;
                }
                this.placeObjectPreviewDisplayObject = null;
            }
            if (this.placeObjectPreviewSprite) {
                this.placeObjectPreviewSprite.visible = false;
                if (Object.prototype.hasOwnProperty.call(this.placeObjectPreviewSprite, "renderable")) {
                    this.placeObjectPreviewSprite.renderable = false;
                }
            }
            if (this.placeObjectCenterSnapGuideGraphics) {
                this.placeObjectCenterSnapGuideGraphics.clear();
                this.placeObjectCenterSnapGuideGraphics.visible = false;
            }
        }

        clearPowerupPlacementPreview() {
            if (this.powerupPlacementPreviewItem && this.powerupPlacementPreviewItem._depthBillboardMesh) {
                const mesh = this.powerupPlacementPreviewItem._depthBillboardMesh;
                mesh.visible = false;
                if (Object.prototype.hasOwnProperty.call(mesh, "renderable")) {
                    mesh.renderable = false;
                }
            }
            if (this.powerupPlacementPreviewDisplayObject) {
                this.powerupPlacementPreviewDisplayObject.visible = false;
                if (Object.prototype.hasOwnProperty.call(this.powerupPlacementPreviewDisplayObject, "renderable")) {
                    this.powerupPlacementPreviewDisplayObject.renderable = false;
                }
                this.powerupPlacementPreviewDisplayObject = null;
            }
            if (this.powerupPlacementPreviewSprite) {
                this.powerupPlacementPreviewSprite.visible = false;
                if (Object.prototype.hasOwnProperty.call(this.powerupPlacementPreviewSprite, "renderable")) {
                    this.powerupPlacementPreviewSprite.renderable = false;
                }
            }
        }

        clearWallPlacementPreview() {
            if (!this.wallPlacementPreviewGraphics) return;
            this.wallPlacementPreviewGraphics.clear();
            this.wallPlacementPreviewGraphics.visible = false;
        }

        clearPrototypeSectionSeams() {
            if (!this.prototypeSectionSeamGraphics) return;
            this.prototypeSectionSeamGraphics.clear();
            this.prototypeSectionSeamGraphics.visible = false;
        }

        renderPrototypeSectionSeams(ctx) {
            const layer = this.layers.ui;
            if (!layer) return;
            if (!this.prototypeSectionSeamGraphics) {
                this.prototypeSectionSeamGraphics = new PIXI.Graphics();
                this.prototypeSectionSeamGraphics.name = "renderingPrototypeSectionSeams";
                this.prototypeSectionSeamGraphics.skipTransform = true;
                this.prototypeSectionSeamGraphics.interactive = false;
                this.prototypeSectionSeamGraphics.visible = false;
                layer.addChild(this.prototypeSectionSeamGraphics);
            } else if (this.prototypeSectionSeamGraphics.parent !== layer) {
                layer.addChild(this.prototypeSectionSeamGraphics);
            }

            const g = this.prototypeSectionSeamGraphics;
            g.clear();

            const showSectionWorldSeams = !!(
                global.debugViewSettings
                    ? global.debugViewSettings.showSectionWorldSeams !== false
                    : global.renderingShowSectionWorldSeams !== false
            );
            if (!showSectionWorldSeams) {
                g.visible = false;
                return;
            }

            const mapRef = (ctx && ctx.map) || global.map || null;
            const wizardRef = (ctx && ctx.wizard) || global.wizard || null;
            if (wizardRef && typeof wizardRef.isAdventureMode === "function" && wizardRef.isAdventureMode()) {
                g.visible = false;
                return;
            }
            if (!mapRef || typeof mapRef.getPrototypeSectionSeamSegments !== "function") {
                g.visible = false;
                return;
            }

            const segments = mapRef.getPrototypeSectionSeamSegments();
            if (!Array.isArray(segments) || segments.length === 0) {
                g.visible = false;
                return;
            }

            g.visible = true;
            g.lineStyle(2, 0xf4f4f4, 0.72);
            for (let i = 0; i < segments.length; i++) {
                const segment = segments[i];
                if (!segment) continue;
                const a = this.camera.worldToScreen(Number(segment.x1), Number(segment.y1), 0);
                const b = this.camera.worldToScreen(Number(segment.x2), Number(segment.y2), 0);
                g.moveTo(a.x, a.y);
                g.lineTo(b.x, b.y);
            }
        }

        clearRoadPlacementPreview() {
            if (this.roadPlacementPreviewContainer) {
                this.roadPlacementPreviewContainer.visible = false;
            }
            if (this.roadPlacementPreviewSpriteByKey && this.roadPlacementPreviewSpriteByKey.size > 0) {
                for (const sprite of this.roadPlacementPreviewSpriteByKey.values()) {
                    if (!sprite) continue;
                    syncRoadRenderSpriteTextureRetention(sprite, null);
                    sprite.visible = false;
                    if (Object.prototype.hasOwnProperty.call(sprite, "renderable")) {
                        sprite.renderable = false;
                    }
                }
            }
        }

        renderWallPlacementPreview(ctx) {
            const layer = this.layers.ui;
            if (!layer) return;
            if (!this.wallPlacementPreviewGraphics) {
                this.wallPlacementPreviewGraphics = new PIXI.Graphics();
                this.wallPlacementPreviewGraphics.name = "renderingWallPlacementPreview";
                this.wallPlacementPreviewGraphics.skipTransform = true;
                this.wallPlacementPreviewGraphics.interactive = false;
                this.wallPlacementPreviewGraphics.visible = false;
                layer.addChild(this.wallPlacementPreviewGraphics);
            } else if (this.wallPlacementPreviewGraphics.parent !== layer) {
                layer.addChild(this.wallPlacementPreviewGraphics);
            }

            const g = this.wallPlacementPreviewGraphics;
            g.clear();

            const wizard = (ctx && ctx.wizard) || global.wizard || null;
            const mapRef = (ctx && ctx.map) || (wizard && wizard.map) || global.map || null;
            const mousePosRef = this.getMousePosRef(ctx);
            if (wizard) wizard.wallPreviewPlacement = null;
            if (
                !wizard ||
                wizard.currentSpell !== "wall" ||
                !wizard.wallLayoutMode ||
                !wizard.wallStartPoint ||
                !mapRef ||
                !mousePosRef ||
                !Number.isFinite(mousePosRef.worldX) ||
                !Number.isFinite(mousePosRef.worldY)
            ) {
                g.visible = false;
                return;
            }

            const spellSystemRef = (typeof SpellSystem !== "undefined")
                ? SpellSystem
                : (global.SpellSystem || null);
            const adjustedWallDragPoint = (
                spellSystemRef &&
                typeof spellSystemRef.getAdjustedWallDragWorldPoint === "function"
            ) ? spellSystemRef.getAdjustedWallDragWorldPoint(wizard, mousePosRef.worldX, mousePosRef.worldY) : null;
            const dragWorldX = adjustedWallDragPoint && Number.isFinite(adjustedWallDragPoint.x)
                ? adjustedWallDragPoint.x
                : mousePosRef.worldX;
            const dragWorldY = adjustedWallDragPoint && Number.isFinite(adjustedWallDragPoint.y)
                ? adjustedWallDragPoint.y
                : mousePosRef.worldY;

            const startWorld = {
                x: Number(wizard.wallStartPoint.x),
                y: Number(wizard.wallStartPoint.y)
            };
            const endWorld = { x: Number(dragWorldX), y: Number(dragWorldY) };
            if (
                !Number.isFinite(startWorld.x) ||
                !Number.isFinite(startWorld.y) ||
                !Number.isFinite(endWorld.x) ||
                !Number.isFinite(endWorld.y)
            ) {
                g.visible = false;
                return;
            }

            let segments = [];
            let previewPlan = null;
            if (
                typeof global.WallSectionUnit !== "undefined" &&
                global.WallSectionUnit &&
                typeof global.WallSectionUnit.planPlacementFromWorldPoints === "function"
            ) {
                const plan = global.WallSectionUnit.planPlacementFromWorldPoints(mapRef, startWorld, endWorld, {
                    rawStartWorld: (
                        wizard.wallDragMouseStartWorld &&
                        Number.isFinite(wizard.wallDragMouseStartWorld.x) &&
                        Number.isFinite(wizard.wallDragMouseStartWorld.y)
                    ) ? {
                        x: Number(wizard.wallDragMouseStartWorld.x),
                        y: Number(wizard.wallDragMouseStartWorld.y)
                    } : { x: startWorld.x, y: startWorld.y },
                    startFromExistingWall: !!wizard.wallStartFromExistingWall,
                    startReferenceWall: wizard.wallStartReferenceWall || null
                });
                if (plan) {
                    previewPlan = plan;
                }
                if (plan && Array.isArray(plan.segments)) {
                    segments = plan.segments.slice();
                }
            }

            if (segments.length === 0) {
                g.visible = false;
                return;
            }

            const normalizedSegments = [];
            for (let i = 0; i < segments.length; i++) {
                const seg = segments[i];
                if (!seg || !seg.start || !seg.end) continue;
                const sx = Number(seg.start.x);
                const sy = Number(seg.start.y);
                const ex = Number(seg.end.x);
                const ey = Number(seg.end.y);
                if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(ex) || !Number.isFinite(ey)) continue;
                normalizedSegments.push({
                    start: { x: sx, y: sy },
                    end: { x: ex, y: ey },
                    direction: Number.isFinite(seg.direction) ? Number(seg.direction) : undefined
                });
            }
            wizard.wallPreviewPlacement = {
                startWorld: { x: startWorld.x, y: startWorld.y },
                endWorld: { x: endWorld.x, y: endWorld.y },
                rawStartWorld: (
                    wizard.wallDragMouseStartWorld &&
                    Number.isFinite(wizard.wallDragMouseStartWorld.x) &&
                    Number.isFinite(wizard.wallDragMouseStartWorld.y)
                ) ? {
                    x: Number(wizard.wallDragMouseStartWorld.x),
                    y: Number(wizard.wallDragMouseStartWorld.y)
                } : { x: startWorld.x, y: startWorld.y },
                plan: previewPlan,
                segments: normalizedSegments
            };

            g.lineStyle(2, 0xff2222, 0.95);
            const wallThickness = (wizard && Number.isFinite(wizard.selectedWallThickness))
                ? wizard.selectedWallThickness : 0.1;
            const halfT = wallThickness * 0.5;
            const bottomZ = 0;
            for (let i = 0; i < segments.length; i++) {
                const seg = segments[i];
                if (!seg || !seg.start || !seg.end) continue;
                const sx = Number(seg.start.x);
                const sy = Number(seg.start.y);
                const ex = Number(seg.end.x);
                const ey = Number(seg.end.y);
                if (!Number.isFinite(sx) || !Number.isFinite(sy) || !Number.isFinite(ex) || !Number.isFinite(ey)) continue;
                const dx = ex - sx;
                const dy = ey - sy;
                const len = Math.hypot(dx, dy);
                if (len < 1e-6) continue;
                // Perpendicular normal
                const nx = -dy / len;
                const ny = dx / len;
                // Four corners of the base rectangle
                const al = this.camera.worldToScreen(sx + nx * halfT, sy + ny * halfT, bottomZ);
                const ar = this.camera.worldToScreen(sx - nx * halfT, sy - ny * halfT, bottomZ);
                const bl = this.camera.worldToScreen(ex + nx * halfT, ey + ny * halfT, bottomZ);
                const br = this.camera.worldToScreen(ex - nx * halfT, ey - ny * halfT, bottomZ);
                // Draw closed rectangle
                g.moveTo(al.x, al.y);
                g.lineTo(bl.x, bl.y);
                g.lineTo(br.x, br.y);
                g.lineTo(ar.x, ar.y);
                g.lineTo(al.x, al.y);
            }
            g.visible = true;
        }

        renderRoadPlacementPreview(ctx) {
            const layer = this.layers.ui;
            if (!layer) return;
            if (!this.roadPlacementPreviewContainer) {
                this.roadPlacementPreviewContainer = new PIXI.Container();
                this.roadPlacementPreviewContainer.name = "renderingRoadPlacementPreview";
                this.roadPlacementPreviewContainer.skipTransform = true;
                this.roadPlacementPreviewContainer.interactive = false;
                this.roadPlacementPreviewContainer.visible = false;
                layer.addChild(this.roadPlacementPreviewContainer);
            } else if (this.roadPlacementPreviewContainer.parent !== layer) {
                layer.addChild(this.roadPlacementPreviewContainer);
            }
            if (!this.roadPlacementPreviewSpriteByKey) {
                this.roadPlacementPreviewSpriteByKey = new Map();
            }

            const previewContainer = this.roadPlacementPreviewContainer;
            const previewSpriteByKey = this.roadPlacementPreviewSpriteByKey;

            const wizard = (ctx && ctx.wizard) || global.wizard || null;
            const mapRef = (ctx && ctx.map) || (wizard && wizard.map) || global.map || null;
            const mousePosRef = this.getMousePosRef(ctx);
            const RoadClass = (typeof global.Road !== "undefined") ? global.Road : null;
            if (
                !wizard ||
                wizard.currentSpell !== "buildroad" ||
                !wizard.roadLayoutMode ||
                !wizard.roadStartPoint ||
                !mapRef ||
                typeof mapRef.getHexLine !== "function" ||
                typeof mapRef.worldToNode !== "function" ||
                !RoadClass ||
                typeof RoadClass._getTextureForMaskAndPhase !== "function" ||
                !mousePosRef ||
                !Number.isFinite(mousePosRef.worldX) ||
                !Number.isFinite(mousePosRef.worldY)
            ) {
                this.clearRoadPlacementPreview();
                return;
            }

            const startNode = wizard.roadStartPoint;
            const endNode = mapRef.worldToNode(mousePosRef.worldX, mousePosRef.worldY);
            if (!startNode || !endNode) {
                this.clearRoadPlacementPreview();
                return;
            }

            const configuredRoadWidth = Number.isFinite(wizard.selectedRoadWidth)
                ? Math.max(1, Math.min(5, Math.round(Number(wizard.selectedRoadWidth))))
                : (
                    (typeof roadWidth !== "undefined" && Number.isFinite(roadWidth))
                        ? Number(roadWidth)
                        : ((Number.isFinite(global.roadWidth) ? Number(global.roadWidth) : 3))
                );
            const width = (startNode === endNode) ? 1 : configuredRoadWidth;
            const roadNodes = mapRef.getHexLine(startNode, endNode, width);
            if (!Array.isArray(roadNodes) || roadNodes.length === 0) {
                this.clearRoadPlacementPreview();
                return;
            }

            const oddDirections = Array.isArray(RoadClass._oddDirections) && RoadClass._oddDirections.length > 0
                ? RoadClass._oddDirections.slice()
                : [1, 3, 5, 7, 9, 11];
            const fillTexturePath = (
                typeof wizard.selectedFlooringTexture === "string" &&
                wizard.selectedFlooringTexture.length > 0
            )
                ? wizard.selectedFlooringTexture
                : (
                    (typeof RoadClass._defaultFillTexturePath === "string" && RoadClass._defaultFillTexturePath.length > 0)
                        ? RoadClass._defaultFillTexturePath
                        : "/assets/images/flooring/dirt.jpg"
                );

            const previewKeys = new Set();
            const roadNodeByKey = new Map();
            for (let i = 0; i < roadNodes.length; i++) {
                const node = roadNodes[i];
                if (!node || !Number.isFinite(node.x) || !Number.isFinite(node.y)) continue;
                const key = `${node.xindex},${node.yindex}`;
                if (previewKeys.has(key)) continue;
                previewKeys.add(key);
                roadNodeByKey.set(key, node);
            }

            const hasRoadObjectAtNode = (node) => {
                if (!node || !Array.isArray(node.objects)) return false;
                if (RoadClass && typeof RoadClass.hasMatchingRoadAtNode === "function") {
                    return RoadClass.hasMatchingRoadAtNode(node, fillTexturePath);
                }
                for (let i = 0; i < node.objects.length; i++) {
                    const obj = node.objects[i];
                    if (obj && obj.type === "road" && !obj.gone && !obj.vanishing) return true;
                }
                return false;
            };

            const activeKeys = new Set();
            for (const [key, node] of roadNodeByKey.entries()) {
                const neighborDirections = [];
                for (let i = 0; i < oddDirections.length; i++) {
                    const dir = oddDirections[i];
                    const neighbor = node.neighbors && node.neighbors[dir];
                    if (!neighbor) continue;
                    const neighborKey = `${neighbor.xindex},${neighbor.yindex}`;
                    if (previewKeys.has(neighborKey) || hasRoadObjectAtNode(neighbor)) {
                        neighborDirections.push(dir);
                    }
                }
                const mask = (typeof RoadClass._getNeighborMask === "function")
                    ? RoadClass._getNeighborMask(neighborDirections)
                    : 0;
                const roadScreenWidth = this.camera.viewscale * 1.1547;
                const roadScreenHeight = this.camera.viewscale * this.camera.xyratio;
                const lodMetric = (typeof RoadClass.getFillTextureLodMetric === "function")
                    ? RoadClass.getFillTextureLodMetric(fillTexturePath, roadScreenWidth, roadScreenHeight)
                    : Math.max(roadScreenWidth, roadScreenHeight);
                const resolvedFillTexturePath = (typeof RoadClass.resolveFillTexturePathForSize === "function")
                    ? RoadClass.resolveFillTexturePathForSize(fillTexturePath, lodMetric)
                    : fillTexturePath;
                const metrics = (typeof RoadClass._getTextureTileMetrics === "function")
                    ? RoadClass._getTextureTileMetrics(resolvedFillTexturePath)
                    : { tileW: 1, tileH: 1 };
                const pixelsPerWorldUnit = Number.isFinite(RoadClass._pixelsPerWorldUnit)
                    ? Number(RoadClass._pixelsPerWorldUnit)
                    : ((128 * 2) / 1.1547);
                const phaseX = (((Number(node.x) * pixelsPerWorldUnit) % metrics.tileW) + metrics.tileW) % metrics.tileW;
                const phaseY = (((Number(node.y) * pixelsPerWorldUnit) % metrics.tileH) + metrics.tileH) % metrics.tileH;
                const textureRef = RoadClass._getTextureForMaskAndPhase(mask, phaseX, phaseY, resolvedFillTexturePath);
                const textureCacheKey = (textureRef && typeof textureRef.key === "string") ? textureRef.key : "";
                const texture = (textureRef && textureRef.entry && isRenderablePixiTexture(textureRef.entry.texture))
                    ? textureRef.entry.texture
                    : null;
                if (!texture) {
                    const existingSprite = previewSpriteByKey.get(key);
                    if (existingSprite) {
                        syncRoadRenderSpriteTextureRetention(existingSprite, null);
                        existingSprite.visible = false;
                        if (Object.prototype.hasOwnProperty.call(existingSprite, "renderable")) {
                            existingSprite.renderable = false;
                        }
                    }
                    continue;
                }

                let sprite = previewSpriteByKey.get(key);
                if (!sprite) {
                    sprite = new PIXI.Sprite(texture);
                    sprite.anchor.set(0.5, 0.5);
                    sprite.name = `renderingRoadPlacementTile:${key}`;
                    previewSpriteByKey.set(key, sprite);
                    previewContainer.addChild(sprite);
                } else if (sprite.texture !== texture) {
                    sprite.texture = texture;
                }
                syncRoadRenderSpriteTextureRetention(sprite, { _roadTextureCacheKey: textureCacheKey });
                if (sprite.parent !== previewContainer) {
                    previewContainer.addChild(sprite);
                }

                const center = this.camera.worldToScreen(Number(node.x), Number(node.y), 0);
                sprite.x = center.x;
                sprite.y = center.y;
                sprite.width = this.camera.viewscale * 1.1547;
                sprite.height = this.camera.viewscale * this.camera.xyratio;
                sprite.alpha = 0.5;
                sprite.visible = true;
                if (Object.prototype.hasOwnProperty.call(sprite, "renderable")) {
                    sprite.renderable = true;
                }
                activeKeys.add(key);
            }

            for (const [key, sprite] of previewSpriteByKey.entries()) {
                if (!sprite || activeKeys.has(key)) continue;
                syncRoadRenderSpriteTextureRetention(sprite, null);
                sprite.visible = false;
                if (Object.prototype.hasOwnProperty.call(sprite, "renderable")) {
                    sprite.renderable = false;
                }
            }

            previewContainer.visible = activeKeys.size > 0;
        }

        clearFirewallPlacementPreview() {
            if (!this.firewallPlacementPreviewGraphics) return;
            this.firewallPlacementPreviewGraphics.clear();
            this.firewallPlacementPreviewGraphics.visible = false;
        }

        renderFirewallPlacementPreview(ctx) {
            const layer = this.layers.ui;
            if (!layer) return;
            if (!this.firewallPlacementPreviewGraphics) {
                this.firewallPlacementPreviewGraphics = new PIXI.Graphics();
                this.firewallPlacementPreviewGraphics.name = "renderingFirewallPlacementPreview";
                this.firewallPlacementPreviewGraphics.skipTransform = true;
                this.firewallPlacementPreviewGraphics.interactive = false;
                this.firewallPlacementPreviewGraphics.visible = false;
                layer.addChild(this.firewallPlacementPreviewGraphics);
            } else if (this.firewallPlacementPreviewGraphics.parent !== layer) {
                layer.addChild(this.firewallPlacementPreviewGraphics);
            }

            const g = this.firewallPlacementPreviewGraphics;
            g.clear();

            const wizard = (ctx && ctx.wizard) || global.wizard || null;
            const mapRef = (ctx && ctx.map) || (wizard && wizard.map) || global.map || null;
            const mousePosRef = this.getMousePosRef(ctx);
            if (
                !wizard ||
                wizard.currentSpell !== "firewall" ||
                !wizard.firewallLayoutMode ||
                !wizard.firewallStartPoint ||
                !mapRef ||
                !mousePosRef ||
                !Number.isFinite(mousePosRef.worldX) ||
                !Number.isFinite(mousePosRef.worldY)
            ) {
                g.visible = false;
                return;
            }

            const startWorld = {
                x: Number(wizard.firewallStartPoint.x),
                y: Number(wizard.firewallStartPoint.y)
            };
            const endWorld = { x: Number(mousePosRef.worldX), y: Number(mousePosRef.worldY) };
            if (
                !Number.isFinite(startWorld.x) ||
                !Number.isFinite(startWorld.y) ||
                !Number.isFinite(endWorld.x) ||
                !Number.isFinite(endWorld.y)
            ) {
                g.visible = false;
                return;
            }

            const screenStart = this.camera.worldToScreen(startWorld.x, startWorld.y, 0);
            const screenEnd = this.camera.worldToScreen(endWorld.x, endWorld.y, 0);
            if (!screenStart || !screenEnd) {
                g.visible = false;
                return;
            }

            // Draw red preview line
            g.lineStyle(3, 0xff2222, 0.9);
            g.moveTo(screenStart.x, screenStart.y);
            g.lineTo(screenEnd.x, screenEnd.y);

            // Draw tick marks along the line at emitter spacing intervals
            const dx = endWorld.x - startWorld.x;
            const dy = endWorld.y - startWorld.y;
            const dist = Math.hypot(dx, dy);
            const spacing = 0.5;
            const steps = Math.max(1, Math.ceil(dist / spacing));
            const perpScreenX = -(screenEnd.y - screenStart.y);
            const perpScreenY = (screenEnd.x - screenStart.x);
            const perpLen = Math.hypot(perpScreenX, perpScreenY);
            const tickHalfLen = 4;
            if (perpLen > 1e-6) {
                const nx = (perpScreenX / perpLen) * tickHalfLen;
                const ny = (perpScreenY / perpLen) * tickHalfLen;
                g.lineStyle(2, 0xff4444, 0.7);
                for (let i = 0; i <= steps; i++) {
                    const t = steps === 0 ? 0 : i / steps;
                    const px = screenStart.x + (screenEnd.x - screenStart.x) * t;
                    const py = screenStart.y + (screenEnd.y - screenStart.y) * t;
                    g.moveTo(px - nx, py - ny);
                    g.lineTo(px + nx, py + ny);
                }
            }

            g.visible = true;
        }

        clearTriggerAreaPlacementPreview() {
            if (!this.triggerAreaPlacementPreviewGraphics) return;
            this.triggerAreaPlacementPreviewGraphics.clear();
            this.triggerAreaPlacementPreviewGraphics.visible = false;
        }

        renderTriggerAreaPlacementPreview(ctx) {
            const layer = this.layers.ui;
            if (!layer) return;
            if (!this.triggerAreaPlacementPreviewGraphics) {
                this.triggerAreaPlacementPreviewGraphics = new PIXI.Graphics();
                this.triggerAreaPlacementPreviewGraphics.name = "renderingTriggerAreaPlacementPreview";
                this.triggerAreaPlacementPreviewGraphics.skipTransform = true;
                this.triggerAreaPlacementPreviewGraphics.interactive = false;
                this.triggerAreaPlacementPreviewGraphics.visible = false;
                layer.addChild(this.triggerAreaPlacementPreviewGraphics);
            } else if (this.triggerAreaPlacementPreviewGraphics.parent !== layer) {
                layer.addChild(this.triggerAreaPlacementPreviewGraphics);
            }

            const g = this.triggerAreaPlacementPreviewGraphics;
            g.clear();
            const wizard = (ctx && ctx.wizard) || global.wizard || null;
            const spellSystemRef = (typeof SpellSystem !== "undefined")
                ? SpellSystem
                : (global.SpellSystem || null);
            if (
                !wizard ||
                wizard.currentSpell !== "triggerarea" ||
                !spellSystemRef ||
                typeof spellSystemRef.getTriggerAreaPlacementPreview !== "function"
            ) {
                g.visible = false;
                return;
            }

            const preview = spellSystemRef.getTriggerAreaPlacementPreview(wizard);
            if (!preview || !Array.isArray(preview.points) || preview.points.length === 0) {
                g.visible = false;
                return;
            }
            const points = preview.points;
            const first = points[0];
            const startScreen = this.camera.worldToScreen(Number(first.x), Number(first.y), 0);
            if (!startScreen || !Number.isFinite(startScreen.x) || !Number.isFinite(startScreen.y)) {
                g.visible = false;
                return;
            }

            const mousePosRef = this.getMousePosRef(ctx);
            const hasMouseWorld = !!(
                mousePosRef &&
                Number.isFinite(mousePosRef.worldX) &&
                Number.isFinite(mousePosRef.worldY)
            );
            const mouseScreen = hasMouseWorld
                ? this.camera.worldToScreen(Number(mousePosRef.worldX), Number(mousePosRef.worldY), 0)
                : null;

            g.lineStyle(2, 0xffffff, 0.95);
            g.moveTo(startScreen.x, startScreen.y);
            for (let i = 1; i < points.length; i++) {
                const pt = points[i];
                const sp = this.camera.worldToScreen(Number(pt.x), Number(pt.y), 0);
                g.lineTo(sp.x, sp.y);
            }
            if (mouseScreen && Number.isFinite(mouseScreen.x) && Number.isFinite(mouseScreen.y)) {
                g.lineTo(mouseScreen.x, mouseScreen.y);
            }

            g.lineStyle(2, 0x9ee7ff, 0.9);
            g.drawCircle(startScreen.x, startScreen.y, 5);
            g.visible = true;
        }

        buildPlaceObjectPreviewRenderItem(ctx) {
            const wizard = (ctx && ctx.wizard) || global.wizard || null;
            if (!wizard || wizard.currentSpell !== "placeobject" || wizard.editorPlacementActive !== true) {
                return null;
            }
            const mousePosRef = this.getMousePosRef(ctx);
            if (!mousePosRef || !Number.isFinite(mousePosRef.worldX) || !Number.isFinite(mousePosRef.worldY)) {
                return null;
            }

            const texturePath = (
                typeof wizard.selectedPlaceableTexturePath === "string" &&
                wizard.selectedPlaceableTexturePath.length > 0
            ) ? wizard.selectedPlaceableTexturePath : "/assets/images/doors/door5.png";
            const selectedCategory = (
                typeof wizard.selectedPlaceableCategory === "string" &&
                wizard.selectedPlaceableCategory.length > 0
            ) ? wizard.selectedPlaceableCategory : "doors";
            const rawAxis = (typeof wizard.selectedPlaceableRotationAxis === "string")
                ? wizard.selectedPlaceableRotationAxis.trim().toLowerCase()
                : "";
            const rotationAxis = (rawAxis === "spatial" || rawAxis === "visual" || rawAxis === "none" || rawAxis === "ground")
                ? rawAxis
                : ((selectedCategory === "doors" || selectedCategory === "windows") ? "spatial" : "visual");
            const placementRotation = Number.isFinite(wizard.selectedPlaceableRotation)
                ? Number(wizard.selectedPlaceableRotation)
                : 0;
            const effectivePlacementRotation = (rotationAxis === "none") ? 0 : placementRotation;

            if (!this.placeObjectPreviewSprite) {
                this.placeObjectPreviewSprite = new PIXI.Sprite(PIXI.Texture.from(texturePath));
                this.placeObjectPreviewSprite.anchor.set(0.5, 0.5);
                this.placeObjectPreviewSprite.alpha = 0.5;
                this.placeObjectPreviewSprite.interactive = false;
                this.placeObjectPreviewSprite.visible = false;
                this.placeObjectPreviewTexturePath = texturePath;
            } else if (this.placeObjectPreviewTexturePath !== texturePath) {
                this.placeObjectPreviewSprite.texture = PIXI.Texture.from(texturePath);
                this.placeObjectPreviewTexturePath = texturePath;
            }

            const mapRef = (ctx && ctx.map) || wizard.map || global.map || null;
            const worldX = (mapRef && typeof mapRef.wrapWorldX === "function")
                ? mapRef.wrapWorldX(mousePosRef.worldX)
                : mousePosRef.worldX;
            const worldY = (mapRef && typeof mapRef.wrapWorldY === "function")
                ? mapRef.wrapWorldY(mousePosRef.worldY)
                : mousePosRef.worldY;
            const supportsWallSnapPlacement = selectedCategory === "windows" || selectedCategory === "doors";
            const requiresWallSnapPlacement = selectedCategory === "windows";
            const isRoofPlacement = selectedCategory === "roof";
            const roofApi = (typeof global.Roof === "function")
                ? global.Roof
                : ((typeof Roof === "function") ? Roof : null);
            const roofDiagnostics = (
                isRoofPlacement &&
                roofApi &&
                typeof roofApi.getPlacementDiagnostics === "function"
            ) ? roofApi.getPlacementDiagnostics(wizard, worldX, worldY, { maxDepth: 12 }) : null;
            const spellSystemRef = (typeof SpellSystem !== "undefined")
                ? SpellSystem
                : (global.SpellSystem || null);
            const snapPlacement = (
                (supportsWallSnapPlacement || isRoofPlacement) &&
                spellSystemRef &&
                typeof spellSystemRef.getPlaceObjectPlacementCandidate === "function"
            ) ? spellSystemRef.getPlaceObjectPlacementCandidate(wizard, worldX, worldY) : null;
            if (isRoofPlacement) {
                if (!roofDiagnostics || !roofDiagnostics.hoveredSection) return null;
                const previewItem = this.ensurePlaceObjectPreviewItem(mapRef);
                previewItem.roofHighlightOnly = true;
                previewItem.roofLoopSections = Array.isArray(roofDiagnostics.wallSections)
                    ? roofDiagnostics.wallSections.slice()
                    : [roofDiagnostics.hoveredSection];
                previewItem.centerSnapGuide = null;
                return previewItem;
            }
            const useSnapPlacement = !!(snapPlacement && snapPlacement.targetWall);
            const useRoofPlacement = !!(
                isRoofPlacement &&
                useSnapPlacement &&
                Number.isFinite(snapPlacement.previewX) &&
                Number.isFinite(snapPlacement.previewY) &&
                Number.isFinite(snapPlacement.previewZ)
            );
            if (requiresWallSnapPlacement) {
                if (
                    !useSnapPlacement ||
                    !Number.isFinite(snapPlacement.snappedX) ||
                    !Number.isFinite(snapPlacement.snappedY) ||
                    !Number.isFinite(snapPlacement.snappedRotationDeg) ||
                    !Number.isFinite(snapPlacement.snappedZ)
                ) {
                    return null;
                }
            }
            if (isRoofPlacement && !useRoofPlacement) return null;
            const placeableScale = Number.isFinite(wizard.selectedPlaceableScale)
                ? Number(wizard.selectedPlaceableScale)
                : 1;
            const scaleMin = Number.isFinite(wizard.selectedPlaceableScaleMin) ? wizard.selectedPlaceableScaleMin : 0.2;
            const scaleMax = Number.isFinite(wizard.selectedPlaceableScaleMax) ? wizard.selectedPlaceableScaleMax : 5;
            const clampedScale = Math.max(scaleMin, Math.min(scaleMax, placeableScale));
            const selectedSizing = (
                wizard.selectedPlaceableSizingByTexture &&
                typeof wizard.selectedPlaceableSizingByTexture === "object"
            ) ? wizard.selectedPlaceableSizingByTexture[texturePath] : null;
            const scaledDimensions = (
                typeof globalThis !== "undefined" &&
                typeof globalThis.resolvePlaceableScaledDimensions === "function"
            ) ? globalThis.resolvePlaceableScaledDimensions(selectedSizing, clampedScale) : {
                width: clampedScale,
                height: clampedScale
            };
            const selectedAnchorY = Number.isFinite(wizard.selectedPlaceableAnchorY)
                ? Number(wizard.selectedPlaceableAnchorY)
                : 1;
            const effectiveAnchorY = isRoofPlacement
                ? 0.5
                : ((useSnapPlacement && selectedCategory === "windows") ? 0.5 : selectedAnchorY);
            const yScale = Math.max(0.1, Math.abs(Number.isFinite(this.camera.xyratio) ? this.camera.xyratio : 0.66));
            const placementYOffset = (rotationAxis === "spatial" || rotationAxis === "ground" || isRoofPlacement)
                ? 0
                : (((effectiveAnchorY - 0.5) * scaledDimensions.height) / yScale);
            const spatialAnchorPlacementYOffset = (
                rotationAxis === "spatial" &&
                !useSnapPlacement &&
                !useRoofPlacement &&
                (selectedCategory === "doors" || selectedCategory === "windows")
            )
                ? (((effectiveAnchorY - 0.5) * scaledDimensions.height) / yScale)
                : 0;
            const previewX = useRoofPlacement
                ? Number(snapPlacement.previewX)
                : (useSnapPlacement ? snapPlacement.snappedX : worldX);
            let placedY = useRoofPlacement
                ? Number(snapPlacement.previewY)
                : (useSnapPlacement ? snapPlacement.snappedY : (worldY + placementYOffset + spatialAnchorPlacementYOffset));
            if (mapRef && typeof mapRef.wrapWorldY === "function") {
                placedY = mapRef.wrapWorldY(placedY);
            }
            const renderDepthOffset = Number.isFinite(wizard.selectedPlaceableRenderOffset)
                ? Number(wizard.selectedPlaceableRenderOffset)
                : 0;
            this.placeObjectPreviewSprite.tint = 0xFFFFFF;
            this.placeObjectPreviewSprite.visible = true;
            if (Object.prototype.hasOwnProperty.call(this.placeObjectPreviewSprite, "renderable")) {
                this.placeObjectPreviewSprite.renderable = true;
            }
            const previewItem = this.ensurePlaceObjectPreviewItem(mapRef);
            previewItem.x = previewX;
            previewItem.y = useRoofPlacement
                ? Number(snapPlacement.previewY)
                : (useSnapPlacement ? snapPlacement.snappedY : placedY);
            previewItem.z = useRoofPlacement
                ? Number(snapPlacement.previewZ)
                : (useSnapPlacement ? Number(snapPlacement.snappedZ) : 0);
            previewItem.width = scaledDimensions.width;
            previewItem.height = scaledDimensions.height;
            previewItem.renderZ = placedY + renderDepthOffset;
            previewItem.previewAlpha = 0.5;
            previewItem.texturePath = texturePath;
            previewItem.category = selectedCategory;
            
            if (wizard.selectedPlaceableCompositeLayersByTexture && wizard.selectedPlaceableCompositeLayersByTexture[texturePath]) {
                previewItem.compositeLayers = wizard.selectedPlaceableCompositeLayersByTexture[texturePath];
            } else {
                previewItem.compositeLayers = null;
            }

            previewItem.placeableAnchorX = Number.isFinite(wizard.selectedPlaceableAnchorX)
                ? ((useSnapPlacement && !useRoofPlacement) ? 0.5 : Number(wizard.selectedPlaceableAnchorX))
                : 0.5;
            previewItem.placeableAnchorY = effectiveAnchorY;
            // Keep the preview sprite's Pixi anchor in sync with the item's
            // logical anchor so that updateDepthBillboardMesh (which reads
            // sprite.anchor for the standard billboard path) produces the
            // same quad geometry as the final placed object.
            if (this.placeObjectPreviewSprite && this.placeObjectPreviewSprite.anchor) {
                this.placeObjectPreviewSprite.anchor.set(
                    previewItem.placeableAnchorX,
                    previewItem.placeableAnchorY
                );
            }
            previewItem.rotationAxis = (useSnapPlacement && !useRoofPlacement) ? "spatial" : rotationAxis;
            previewItem.placementRotation = (useSnapPlacement && !useRoofPlacement)
                ? snapPlacement.snappedRotationDeg
                : effectivePlacementRotation;
            previewItem.mountedSectionId = (
                useSnapPlacement &&
                !useRoofPlacement &&
                Number.isInteger(snapPlacement.mountedSectionId)
            ) ? Number(snapPlacement.mountedSectionId) : null;
            previewItem.mountedWallLineGroupId = (
                useSnapPlacement &&
                !useRoofPlacement &&
                Number.isInteger(snapPlacement.mountedWallLineGroupId)
            ) ? Number(snapPlacement.mountedWallLineGroupId) : null;
            previewItem.mountedWallSectionUnitId = (
                useSnapPlacement &&
                !useRoofPlacement &&
                Number.isInteger(snapPlacement.mountedWallSectionUnitId)
            ) ? Number(snapPlacement.mountedWallSectionUnitId) : null;
            previewItem.mountedWallFacingSign = (
                useSnapPlacement &&
                !useRoofPlacement &&
                Number.isFinite(snapPlacement.mountedWallFacingSign)
            ) ? Number(snapPlacement.mountedWallFacingSign) : null;
            if (
                useSnapPlacement &&
                !useRoofPlacement &&
                Number.isFinite(snapPlacement.wallFaceCenterX) &&
                Number.isFinite(snapPlacement.wallFaceCenterY) &&
                Number.isFinite(snapPlacement.sectionNormalX) &&
                Number.isFinite(snapPlacement.sectionNormalY) &&
                Number.isFinite(snapPlacement.wallThickness) &&
                Number.isFinite(previewItem.mountedWallFacingSign)
            ) {
                const sign = Number(previewItem.mountedWallFacingSign) >= 0 ? 1 : -1;
                const thickness = Math.max(0, Number(snapPlacement.wallThickness));
                const nx = Number(snapPlacement.sectionNormalX);
                const ny = Number(snapPlacement.sectionNormalY);
                const frontX = Number(snapPlacement.wallFaceCenterX);
                const frontY = Number(snapPlacement.wallFaceCenterY);
                const faceEpsilon = 0.01;
                const dirX = nx * sign;
                const dirY = ny * sign;
                const backBaseX = frontX - dirX * thickness;
                const backBaseY = frontY - dirY * thickness;
                previewItem.depthBillboardFaceCenters = {
                    // Nudge both planes slightly away from wall faces to prevent preview z-fighting.
                    front: {
                        x: frontX + dirX * faceEpsilon,
                        y: frontY + dirY * faceEpsilon
                    },
                    back: {
                        x: backBaseX + dirX * faceEpsilon,
                        y: backBaseY + dirY * faceEpsilon
                    }
                };
            } else {
                previewItem.depthBillboardFaceCenters = null;
            }
            previewItem.centerSnapGuide = useSnapPlacement
                && !useRoofPlacement
                ? {
                    centerSnapActive: !!snapPlacement.centerSnapActive,
                    placementCenterX: Number(snapPlacement.placementCenterX),
                    placementCenterY: Number(snapPlacement.placementCenterY),
                    sectionCenterX: Number(snapPlacement.sectionCenterX),
                    sectionCenterY: Number(snapPlacement.sectionCenterY),
                    sectionFacingSign: Number(snapPlacement.sectionFacingSign),
                    sectionNormalX: Number(snapPlacement.sectionNormalX),
                    sectionNormalY: Number(snapPlacement.sectionNormalY),
                    sectionDirX: Number(snapPlacement.sectionDirX),
                    sectionDirY: Number(snapPlacement.sectionDirY),
                    wallFaceCenterX: Number(snapPlacement.wallFaceCenterX),
                    wallFaceCenterY: Number(snapPlacement.wallFaceCenterY),
                    placementHalfWidth: Number(snapPlacement.placementHalfWidth),
                    wallHeight: Number(snapPlacement.wallHeight) || 0,
                    wallThickness: Number(snapPlacement.wallThickness) || 0,
                    sectionFaceQuadScreenPoints: Array.isArray(snapPlacement.sectionFaceQuadScreenPoints)
                        ? snapPlacement.sectionFaceQuadScreenPoints
                        : null,
                    sectionVisiblePolygonsScreen: Array.isArray(snapPlacement.sectionVisiblePolygonsScreen)
                        ? snapPlacement.sectionVisiblePolygonsScreen
                        : null
                }
                : null;
            previewItem.roofHighlightOnly = false;
            previewItem.roofLoopSections = (
                useRoofPlacement &&
                Array.isArray(snapPlacement.wallSections)
            ) ? snapPlacement.wallSections.slice() : null;
            return previewItem;
        }

        renderPlaceObjectCenterSnapGuide(previewItem) {
            const layer = this.layers.ui;
            if (!layer) return;
            if (!this.placeObjectCenterSnapGuideGraphics) {
                this.placeObjectCenterSnapGuideGraphics = new PIXI.Graphics();
                this.placeObjectCenterSnapGuideGraphics.name = "renderingPlaceObjectSnapGuide";
                this.placeObjectCenterSnapGuideGraphics.skipTransform = true;
                this.placeObjectCenterSnapGuideGraphics.interactive = false;
                this.placeObjectCenterSnapGuideGraphics.visible = false;
                layer.addChild(this.placeObjectCenterSnapGuideGraphics);
            } else if (this.placeObjectCenterSnapGuideGraphics.parent !== layer) {
                layer.addChild(this.placeObjectCenterSnapGuideGraphics);
            }
            const g = this.placeObjectCenterSnapGuideGraphics;
            g.clear();
            const guide = previewItem && previewItem.centerSnapGuide ? previewItem.centerSnapGuide : null;
            const roofSections = (
                previewItem &&
                Array.isArray(previewItem.roofLoopSections)
            ) ? previewItem.roofLoopSections : null;
            let drewRoofLoop = false;
            if (Array.isArray(roofSections) && roofSections.length > 0) {
                for (let i = 0; i < roofSections.length; i++) {
                    const section = roofSections[i];
                    if (!section || typeof section.getWallProfile !== "function") continue;
                    const profile = section.getWallProfile();
                    if (!profile) continue;
                    const topZ = Math.max(0, Number(section.bottomZ) || 0) + Math.max(0, Number(section.height) || 0);
                    const topFace = [
                        this.camera.worldToScreen(Number(profile.aLeft.x), Number(profile.aLeft.y), topZ),
                        this.camera.worldToScreen(Number(profile.bLeft.x), Number(profile.bLeft.y), topZ),
                        this.camera.worldToScreen(Number(profile.bRight.x), Number(profile.bRight.y), topZ),
                        this.camera.worldToScreen(Number(profile.aRight.x), Number(profile.aRight.y), topZ)
                    ];
                    if (!topFace.every(pt => Number.isFinite(pt.x) && Number.isFinite(pt.y))) continue;
                    g.lineStyle(2, 0x66c2ff, 0.55);
                    g.beginFill(0x66c2ff, 0.12);
                    g.moveTo(topFace[0].x, topFace[0].y);
                    g.lineTo(topFace[1].x, topFace[1].y);
                    g.lineTo(topFace[2].x, topFace[2].y);
                    g.lineTo(topFace[3].x, topFace[3].y);
                    g.closePath();
                    g.endFill();
                    drewRoofLoop = true;
                }
            }
            if (
                !guide ||
                !Number.isFinite(guide.placementCenterX) ||
                !Number.isFinite(guide.placementCenterY) ||
                !Number.isFinite(guide.sectionCenterX) ||
                !Number.isFinite(guide.sectionCenterY)
            ) {
                g.visible = drewRoofLoop;
                return;
            }

            const placementCenterScreen = this.camera.worldToScreen(guide.placementCenterX, guide.placementCenterY, 0);
            const sectionCenterScreen = this.camera.worldToScreen(guide.sectionCenterX, guide.sectionCenterY, 0);
            const topCenterScreen = {
                x: sectionCenterScreen.x,
                y: sectionCenterScreen.y - (Math.max(0, Number(guide.wallHeight) || 0) * this.camera.viewscale * this.camera.xyratio)
            };
            const visiblePolygons = Array.isArray(guide.sectionVisiblePolygonsScreen)
                ? guide.sectionVisiblePolygonsScreen
                : null;
            if (Array.isArray(visiblePolygons) && visiblePolygons.length > 0) {
                for (let i = 0; i < visiblePolygons.length; i++) {
                    const poly = Array.isArray(visiblePolygons[i])
                        ? visiblePolygons[i].map(pt => ({ x: Number(pt.x), y: Number(pt.y) }))
                        : [];
                    if (poly.length < 3) continue;
                    if (!poly.every(pt => Number.isFinite(pt.x) && Number.isFinite(pt.y))) continue;
                    g.lineStyle(2, 0x4FC3FF, 0.8);
                    g.beginFill(0x4FC3FF, 0.12);
                    g.moveTo(poly[0].x, poly[0].y);
                    for (let p = 1; p < poly.length; p++) {
                        g.lineTo(poly[p].x, poly[p].y);
                    }
                    g.closePath();
                    g.endFill();
                }
            } else if (Array.isArray(guide.sectionFaceQuadScreenPoints) && guide.sectionFaceQuadScreenPoints.length >= 4) {
                const quad = guide.sectionFaceQuadScreenPoints
                    .slice(0, 4)
                    .map(pt => ({ x: Number(pt.x), y: Number(pt.y) }))
                    .filter(pt => Number.isFinite(pt.x) && Number.isFinite(pt.y));
                if (quad.length === 4) {
                    g.lineStyle(2, 0x4FC3FF, 0.8);
                    g.beginFill(0x4FC3FF, 0.12);
                    g.moveTo(quad[0].x, quad[0].y);
                    g.lineTo(quad[1].x, quad[1].y);
                    g.lineTo(quad[2].x, quad[2].y);
                    g.lineTo(quad[3].x, quad[3].y);
                    g.closePath();
                    g.endFill();
                }
            }

            const facingSign = Number.isFinite(guide.sectionFacingSign) ? Number(guide.sectionFacingSign) : 1;
            const insideWorld = {
                x: guide.sectionCenterX - (Number.isFinite(guide.sectionNormalX) ? guide.sectionNormalX : 0) * Math.max(0, Number(guide.wallThickness) || 0) * facingSign,
                y: guide.sectionCenterY - (Number.isFinite(guide.sectionNormalY) ? guide.sectionNormalY : 0) * Math.max(0, Number(guide.wallThickness) || 0) * facingSign
            };
            const insideScreen = this.camera.worldToScreen(insideWorld.x, insideWorld.y, 0);
            const topInsideScreen = {
                x: insideScreen.x,
                y: insideScreen.y - (Math.max(0, Number(guide.wallHeight) || 0) * this.camera.viewscale * this.camera.xyratio)
            };
            if (guide.centerSnapActive) {
                g.lineStyle(2, 0xFF0000, 0.5);
                g.moveTo(placementCenterScreen.x, placementCenterScreen.y);
                g.lineTo(topCenterScreen.x, topCenterScreen.y);
                g.moveTo(topCenterScreen.x, topCenterScreen.y);
                g.lineTo(topInsideScreen.x, topInsideScreen.y);
            }

            if (
                Number.isFinite(guide.wallFaceCenterX) &&
                Number.isFinite(guide.wallFaceCenterY) &&
                Number.isFinite(guide.sectionDirX) &&
                Number.isFinite(guide.sectionDirY) &&
                Number.isFinite(guide.placementHalfWidth)
            ) {
                const hx = guide.sectionDirX * guide.placementHalfWidth;
                const hy = guide.sectionDirY * guide.placementHalfWidth;
                const facingEndA = { x: guide.wallFaceCenterX - hx, y: guide.wallFaceCenterY - hy };
                const facingEndB = { x: guide.wallFaceCenterX + hx, y: guide.wallFaceCenterY + hy };
                const insideEndA = {
                    x: facingEndA.x - (Number.isFinite(guide.sectionNormalX) ? guide.sectionNormalX : 0) * Math.max(0, Number(guide.wallThickness) || 0) * facingSign,
                    y: facingEndA.y - (Number.isFinite(guide.sectionNormalY) ? guide.sectionNormalY : 0) * Math.max(0, Number(guide.wallThickness) || 0) * facingSign
                };
                const insideEndB = {
                    x: facingEndB.x - (Number.isFinite(guide.sectionNormalX) ? guide.sectionNormalX : 0) * Math.max(0, Number(guide.wallThickness) || 0) * facingSign,
                    y: facingEndB.y - (Number.isFinite(guide.sectionNormalY) ? guide.sectionNormalY : 0) * Math.max(0, Number(guide.wallThickness) || 0) * facingSign
                };
                const toTop = (pt) => {
                    const s = this.camera.worldToScreen(pt.x, pt.y, 0);
                    return {
                        x: s.x,
                        y: s.y - (Math.max(0, Number(guide.wallHeight) || 0) * this.camera.viewscale * this.camera.xyratio)
                    };
                };
                const topFacingA = toTop(facingEndA);
                const topInsideA = toTop(insideEndA);
                const topFacingB = toTop(facingEndB);
                const topInsideB = toTop(insideEndB);
                g.lineStyle(2, 0x000000, 0.6);
                g.moveTo(topFacingA.x, topFacingA.y);
                g.lineTo(topInsideA.x, topInsideA.y);
                g.moveTo(topFacingB.x, topFacingB.y);
                g.lineTo(topInsideB.x, topInsideB.y);
            }
            g.visible = true;
        }

        renderPlaceObjectPreview(ctx) {
            const previewItem = this.buildPlaceObjectPreviewRenderItem(ctx);
            if (!previewItem) {
                this.clearPlaceObjectPreview();
                return;
            }
            if (previewItem.roofHighlightOnly) {
                if (this.placeObjectPreviewItem) {
                    if (this.placeObjectPreviewItem._depthBillboardMesh) {
                        const mesh = this.placeObjectPreviewItem._depthBillboardMesh;
                        mesh.visible = false;
                        if (Object.prototype.hasOwnProperty.call(mesh, "renderable")) {
                            mesh.renderable = false;
                        }
                    }
                    if (this.placeObjectPreviewItem._compositeUnderlayMesh) {
                        const mesh = this.placeObjectPreviewItem._compositeUnderlayMesh;
                        mesh.visible = false;
                        if (Object.prototype.hasOwnProperty.call(mesh, "renderable")) {
                            mesh.renderable = false;
                        }
                    }
                }
                if (this.placeObjectPreviewDisplayObject) {
                    this.placeObjectPreviewDisplayObject.visible = false;
                    if (Object.prototype.hasOwnProperty.call(this.placeObjectPreviewDisplayObject, "renderable")) {
                        this.placeObjectPreviewDisplayObject.renderable = false;
                    }
                    this.placeObjectPreviewDisplayObject = null;
                }
                if (this.placeObjectPreviewSprite) {
                    this.placeObjectPreviewSprite.visible = false;
                    if (Object.prototype.hasOwnProperty.call(this.placeObjectPreviewSprite, "renderable")) {
                        this.placeObjectPreviewSprite.renderable = false;
                    }
                }
                this.renderPlaceObjectCenterSnapGuide(previewItem);
                return;
            }
            let displayObj = null;
            // Keep preview sprite dimensions in world scale before any depth-mesh extraction.
            this.applySpriteTransform(previewItem);
            if (
                typeof previewItem.updateDepthBillboardMesh === "function"
            ) {
                const mesh = previewItem.updateDepthBillboardMesh(
                    ctx,
                    this.camera,
                    { alphaCutoff: TREE_ALPHA_CUTOFF }
                );
                if (mesh) {
                    if (Object.prototype.hasOwnProperty.call(mesh, "renderable")) {
                        mesh.renderable = true;
                    }
                    if (Number.isFinite(previewItem.previewAlpha)) {
                        mesh.alpha = previewItem.previewAlpha;
                    }
                    displayObj = mesh;
                }
            }
            if (!displayObj) {
                displayObj = previewItem.pixiSprite || this.placeObjectPreviewSprite;
            }
            if (!displayObj) {
                this.clearPlaceObjectPreview();
                return;
            }
            const container = (displayObj instanceof PIXI.Mesh)
                ? this.layers.depthObjects
                : this.layers.objects3d;
            if (!container) {
                this.clearPlaceObjectPreview();
                return;
            }
            const depthMesh = previewItem._depthBillboardMesh;
            if (depthMesh && depthMesh !== displayObj) {
                depthMesh.visible = false;
                if (Object.prototype.hasOwnProperty.call(depthMesh, "renderable")) {
                    depthMesh.renderable = false;
                }
            }
            if (displayObj.parent !== container) {
                container.addChild(displayObj);
            }
            displayObj.visible = true;
            if (Object.prototype.hasOwnProperty.call(displayObj, "renderable")) {
                displayObj.renderable = true;
            }
            if (Number.isFinite(previewItem.previewAlpha)) {
                displayObj.alpha = previewItem.previewAlpha;
            }
            if (Number.isFinite(displayObj.tint)) {
                displayObj.tint = 0xFFFFFF;
            }

            const underlayMesh = previewItem._compositeUnderlayMesh;
            const shouldShowUnderlay = !!(
                underlayMesh &&
                !underlayMesh.destroyed &&
                previewItem._compositeUnderlayShouldRender
            );
            if (shouldShowUnderlay) {
                if (underlayMesh.parent !== container) {
                    container.addChild(underlayMesh);
                }
                underlayMesh.visible = true;
                if (Object.prototype.hasOwnProperty.call(underlayMesh, "renderable")) {
                    underlayMesh.renderable = true;
                }
                if (Number.isFinite(previewItem.previewAlpha)) {
                    underlayMesh.alpha = previewItem.previewAlpha;
                }
                if (Number.isFinite(underlayMesh.tint)) {
                    underlayMesh.tint = 0xFFFFFF;
                }
            } else if (underlayMesh && !underlayMesh.destroyed) {
                underlayMesh.visible = false;
                if (Object.prototype.hasOwnProperty.call(underlayMesh, "renderable")) {
                    underlayMesh.renderable = false;
                }
            }

            const topIndex = container.children.length - 1;
            if (topIndex >= 0) {
                const currentIndex = container.getChildIndex(displayObj);
                if (currentIndex !== topIndex) {
                    container.setChildIndex(displayObj, topIndex);
                }
                if (underlayMesh && underlayMesh.parent === container) {
                    const uIndex = container.getChildIndex(underlayMesh);
                    const newUIndex = Math.max(0, container.children.length - 2);
                    if (uIndex !== newUIndex) {
                        container.setChildIndex(underlayMesh, newUIndex);
                    }
                }
            }
            if (this.placeObjectPreviewDisplayObject && this.placeObjectPreviewDisplayObject !== displayObj) {
                this.placeObjectPreviewDisplayObject.visible = false;
                if (Object.prototype.hasOwnProperty.call(this.placeObjectPreviewDisplayObject, "renderable")) {
                    this.placeObjectPreviewDisplayObject.renderable = false;
                }
            }
            this.placeObjectPreviewDisplayObject = displayObj;
            this.renderPlaceObjectCenterSnapGuide(previewItem);
        }

        buildPowerupPlacementPreviewRenderItem(ctx) {
            const wizard = (ctx && ctx.wizard) || global.wizard || null;
            if (!wizard || wizard.currentSpell !== "blackdiamond" || wizard.editorPlacementActive !== true) {
                return null;
            }
            const mousePosRef = this.getMousePosRef(ctx);
            if (!mousePosRef || !Number.isFinite(mousePosRef.worldX) || !Number.isFinite(mousePosRef.worldY)) {
                return null;
            }

            const spellSystemRef = (typeof SpellSystem !== "undefined")
                ? SpellSystem
                : (global.SpellSystem || null);
            const previewConfig = (
                spellSystemRef &&
                typeof spellSystemRef.getPowerupPlacementPreviewConfig === "function"
            ) ? spellSystemRef.getPowerupPlacementPreviewConfig(wizard) : {
                fileName: "button.png",
                imagePath: "/assets/images/powerups/button.png",
                width: 0.8,
                height: 0.8,
                radius: 0.35,
                scale: 1
            };

            const texturePath = (previewConfig && typeof previewConfig.imagePath === "string" && previewConfig.imagePath.length > 0)
                ? previewConfig.imagePath
                : "/assets/images/powerups/button.png";
            if (!this.powerupPlacementPreviewSprite) {
                this.powerupPlacementPreviewSprite = new PIXI.Sprite(PIXI.Texture.from(texturePath));
                this.powerupPlacementPreviewSprite.anchor.set(0.5, 1);
                this.powerupPlacementPreviewSprite.alpha = 0.55;
                this.powerupPlacementPreviewSprite.interactive = false;
                this.powerupPlacementPreviewSprite.visible = false;
                this.powerupPlacementPreviewTexturePath = texturePath;
            } else if (this.powerupPlacementPreviewTexturePath !== texturePath) {
                this.powerupPlacementPreviewSprite.texture = PIXI.Texture.from(texturePath);
                this.powerupPlacementPreviewTexturePath = texturePath;
            }

            const mapRef = (ctx && ctx.map) || wizard.map || global.map || null;
            const worldX = (mapRef && typeof mapRef.wrapWorldX === "function")
                ? mapRef.wrapWorldX(mousePosRef.worldX)
                : mousePosRef.worldX;
            const worldY = (mapRef && typeof mapRef.wrapWorldY === "function")
                ? mapRef.wrapWorldY(mousePosRef.worldY)
                : mousePosRef.worldY;
            const width = Number.isFinite(previewConfig && previewConfig.width)
                ? Math.max(0.01, Number(previewConfig.width))
                : 0.8;
            const height = Number.isFinite(previewConfig && previewConfig.height)
                ? Math.max(0.01, Number(previewConfig.height))
                : 0.8;

            this.powerupPlacementPreviewSprite.tint = 0xFFFFFF;
            this.powerupPlacementPreviewSprite.visible = true;
            if (Object.prototype.hasOwnProperty.call(this.powerupPlacementPreviewSprite, "renderable")) {
                this.powerupPlacementPreviewSprite.renderable = true;
            }

            if (!this.powerupPlacementPreviewItem) {
                this.powerupPlacementPreviewItem = {
                    type: "powerupPlacementPreview",
                    map: mapRef || global.map || null,
                    gone: false,
                    vanishing: false,
                    pixiSprite: this.powerupPlacementPreviewSprite,
                    anchorX: 0.5,
                    anchorY: 1
                };
                const powerupProto = global.Powerup && global.Powerup.prototype
                    ? global.Powerup.prototype
                    : null;
                if (powerupProto && typeof powerupProto.ensureSprite === "function") {
                    this.powerupPlacementPreviewItem.ensureSprite = powerupProto.ensureSprite;
                }
                if (powerupProto && typeof powerupProto.ensureDepthBillboardMesh === "function") {
                    this.powerupPlacementPreviewItem.ensureDepthBillboardMesh = powerupProto.ensureDepthBillboardMesh;
                }
                if (powerupProto && typeof powerupProto.updateDepthBillboardMesh === "function") {
                    this.powerupPlacementPreviewItem.updateDepthBillboardMesh = powerupProto.updateDepthBillboardMesh;
                }
            }

            const previewItem = this.powerupPlacementPreviewItem;
            previewItem.map = mapRef || previewItem.map || null;
            previewItem.pixiSprite = this.powerupPlacementPreviewSprite;
            previewItem.x = worldX;
            previewItem.y = worldY;
            previewItem.z = 0;
            previewItem.width = width;
            previewItem.height = height;
            previewItem.renderZ = worldY;
            previewItem.previewAlpha = 0.55;
            previewItem.imagePath = texturePath;
            const puAnchorX = Number.isFinite(previewConfig && previewConfig.anchorX)
                ? Number(previewConfig.anchorX) : 0.5;
            const puAnchorY = Number.isFinite(previewConfig && previewConfig.anchorY)
                ? Number(previewConfig.anchorY) : 0.5;
            previewItem.anchorX = puAnchorX;
            previewItem.anchorY = puAnchorY;
            // Sync the preview sprite's Pixi anchor to match the actual
            // powerup anchor from items.json so the depth billboard quad
            // matches the final placed powerup appearance.
            if (this.powerupPlacementPreviewSprite && this.powerupPlacementPreviewSprite.anchor) {
                this.powerupPlacementPreviewSprite.anchor.set(puAnchorX, puAnchorY);
            }
            return previewItem;
        }

        renderPowerupPlacementPreview(ctx) {
            const previewItem = this.buildPowerupPlacementPreviewRenderItem(ctx);
            if (!previewItem) {
                this.clearPowerupPlacementPreview();
                return;
            }
            if (previewItem.pixiSprite) {
                const w = Number.isFinite(previewItem.width) ? Math.max(0.01, Number(previewItem.width)) : 0.8;
                const h = Number.isFinite(previewItem.height) ? Math.max(0.01, Number(previewItem.height)) : 0.8;
                const viewScale = Number.isFinite(this.camera && this.camera.viewscale)
                    ? Number(this.camera.viewscale)
                    : 1;
                // Match live powerup render sizing exactly (see renderPowerups()).
                previewItem.pixiSprite.width = w * viewScale;
                previewItem.pixiSprite.height = h * viewScale;
            }
            let displayObj = null;
            if (typeof previewItem.updateDepthBillboardMesh === "function") {
                const mesh = previewItem.updateDepthBillboardMesh(
                    ctx,
                    this.camera,
                    { alphaCutoff: TREE_ALPHA_CUTOFF }
                );
                if (mesh) {
                    const depthContainer = this.layers.depthObjects;
                    if (depthContainer && mesh.parent !== depthContainer) {
                        depthContainer.addChild(mesh);
                    }
                    mesh.visible = true;
                    if (Object.prototype.hasOwnProperty.call(mesh, "renderable")) {
                        mesh.renderable = true;
                    }
                    if (Number.isFinite(previewItem.previewAlpha)) {
                        mesh.alpha = previewItem.previewAlpha;
                    }
                    displayObj = mesh;
                }
            }
            if (!displayObj) {
                this.applySpriteTransform(previewItem);
                displayObj = previewItem.pixiSprite || this.powerupPlacementPreviewSprite;
            }
            if (!displayObj) {
                this.clearPowerupPlacementPreview();
                return;
            }

            const container = (displayObj instanceof PIXI.Mesh)
                ? this.layers.depthObjects
                : this.layers.objects3d;
            if (!container) {
                this.clearPowerupPlacementPreview();
                return;
            }
            if (displayObj.parent !== container) {
                container.addChild(displayObj);
            }
            displayObj.visible = true;
            if (Object.prototype.hasOwnProperty.call(displayObj, "renderable")) {
                displayObj.renderable = true;
            }
            if (Number.isFinite(previewItem.previewAlpha)) {
                displayObj.alpha = previewItem.previewAlpha;
            }
            if (Number.isFinite(displayObj.tint)) {
                displayObj.tint = 0xFFFFFF;
            }
            const topIndex = container.children.length - 1;
            if (topIndex >= 0) {
                const currentIndex = container.getChildIndex(displayObj);
                if (currentIndex !== topIndex) {
                    container.setChildIndex(displayObj, topIndex);
                }
            }
            if (this.powerupPlacementPreviewDisplayObject && this.powerupPlacementPreviewDisplayObject !== displayObj) {
                this.powerupPlacementPreviewDisplayObject.visible = false;
                if (Object.prototype.hasOwnProperty.call(this.powerupPlacementPreviewDisplayObject, "renderable")) {
                    this.powerupPlacementPreviewDisplayObject.renderable = false;
                }
            }
            this.powerupPlacementPreviewDisplayObject = displayObj;
        }

        beginDrawPassProfiling(ctx) {
            const profiler = this.drawPassProfiler;
            if (!profiler || profiler.printed || !isDrawPassBreakdownEnabled()) return null;
            const nowMs = (ctx && Number.isFinite(ctx.renderNowMs)) ? Number(ctx.renderNowMs) : performance.now();
            if (!Number.isFinite(profiler.startMs)) {
                profiler.startMs = nowMs;
                profiler.deadlineMs = nowMs + 60000;
            }
            return profiler;
        }

        beginFrameMetrics() {
            if (!isDrawPassBreakdownEnabled()) {
                this.currentFrameMetrics = null;
                return null;
            }
            this.currentFrameMetrics = Object.create(null);
            return this.currentFrameMetrics;
        }

        setFrameMetric(metricName, value) {
            if (!this.currentFrameMetrics || !metricName) return value;
            this.currentFrameMetrics[metricName] = value;
            return value;
        }

        incrementFrameMetric(metricName, delta = 1) {
            if (!this.currentFrameMetrics || !metricName || !Number.isFinite(delta)) return 0;
            const nextValue = Number(this.currentFrameMetrics[metricName] || 0) + Number(delta);
            this.currentFrameMetrics[metricName] = nextValue;
            return nextValue;
        }

        recordDrawPassSection(sectionName, elapsedMs) {
            const profiler = this.drawPassProfiler;
            if (!profiler || profiler.printed || !sectionName || !Number.isFinite(elapsedMs)) return;
            let section = profiler.sections[sectionName];
            if (!section) {
                section = {
                    count: 0,
                    totalMs: 0,
                    maxMs: 0
                };
                profiler.sections[sectionName] = section;
            }
            section.count += 1;
            section.totalMs += elapsedMs;
            if (elapsedMs > section.maxMs) {
                section.maxMs = elapsedMs;
            }
        }

        profileDrawPassSection(sectionName, fn) {
            if (!isDrawPassBreakdownEnabled()) {
                return fn();
            }
            const t0 = performance.now();
            const result = fn();
            const elapsedMs = performance.now() - t0;
            this.recordDrawPassSection(sectionName, elapsedMs);
            if (!this.currentFrameDrawSections) {
                this.currentFrameDrawSections = Object.create(null);
            }
            this.currentFrameDrawSections[sectionName] = elapsedMs;
            return result;
        }

        maybePrintDrawPassProfileSummary(ctx) {
            const profiler = this.drawPassProfiler;
            if (!profiler || profiler.printed || !Number.isFinite(profiler.deadlineMs)) return;
            const nowMs = (ctx && Number.isFinite(ctx.renderNowMs)) ? Number(ctx.renderNowMs) : performance.now();
            if (nowMs < profiler.deadlineMs) return;

            const sections = {};
            const sectionNames = Object.keys(profiler.sections);
            for (let i = 0; i < sectionNames.length; i++) {
                const name = sectionNames[i];
                const section = profiler.sections[name];
                if (!section) continue;
                const avgMs = section.count > 0 ? section.totalMs / section.count : 0;
                sections[name] = {
                    samples: section.count,
                    avgMs,
                    maxMs: section.maxMs,
                    totalMs: section.totalMs
                };
            }

            const summary = {
                durationMs: nowMs - profiler.startMs,
                frameCount: profiler.frameCount,
                avgFrameMs: profiler.frameCount > 0 ? profiler.totalFrameMs / profiler.frameCount : 0,
                maxFrameMs: profiler.maxFrameMs,
                sections
            };
            global.renderingDrawPassProfileSummary = summary;
            console.log("Rendering draw-pass profile (60s):", summary);
            profiler.printed = true;
        }

        renderFrame(ctx) {
            this.init(ctx);
            if (!this.initialized) return false;
            const frameStartMs = performance.now();
            this.currentFrameDrawSections = isDrawPassBreakdownEnabled() ? Object.create(null) : null;
            this.beginFrameMetrics();
            const frameNowMs = (ctx && Number.isFinite(ctx.renderNowMs)) ? Number(ctx.renderNowMs) : frameStartMs;
            const mazeModeSettingEnabled = this.isLosMazeModeEnabled();
            if (mazeModeSettingEnabled && (!this.lastMazeModeSettingEnabled || !Number.isFinite(this.mazeModeActivatedAtMs))) {
                this.mazeModeActivatedAtMs = frameNowMs;
                this.mazeModeSuppressRevealAnimation = true;
            } else if (!mazeModeSettingEnabled) {
                this.mazeModeActivatedAtMs = null;
                this.mazeModeSuppressRevealAnimation = false;
            }
            this.lastMazeModeSettingEnabled = mazeModeSettingEnabled;
            this.beginDrawPassProfiling(ctx);
            this.profileDrawPassSection("resetWallDepthGeometryBudget", () => {
                if (typeof global.resetWallDepthGeometryBudget === "function") {
                    global.resetWallDepthGeometryBudget();
                }
            });
            this.setLegacyLayersVisible(false);
            this.layers.root.visible = true;
            this.profileDrawPassSection("camera.update", () => {
                this.camera.update({
                    camera: ctx.camera,
                    wizard: ctx.wizard,
                    viewport: ctx.viewport,
                    viewscale: ctx.viewscale,
                    xyratio: ctx.xyratio,
                    map: ctx.map,
                    renderAlpha: ctx.renderAlpha
                });
            });
            this.resetPickRenderItems();
            if (this.scenePicker && this.scenePicker.publicApi) {
                global.renderingScenePicker = this.scenePicker.publicApi;
            }
            const visibleNodes = this.profileDrawPassSection("collectVisibleNodes", () =>
                this.collectVisibleNodes(ctx, 4, 4)
            );
            const visibleObjects = this.profileDrawPassSection("collectVisibleObjects", () =>
                this.collectVisibleObjects(visibleNodes, ctx)
            );
            this.profileDrawPassSection("syncOnscreenObjectsCache", () => {
                this.syncOnscreenObjectsCache(ctx, visibleNodes, visibleObjects);
            });
            this.profileDrawPassSection("updateLosState", () => {
                this.updateLosState(ctx, visibleNodes, visibleObjects);
            });
            this.profileDrawPassSection("updateWallLosIlluminationTallies", () => {
                this.updateWallLosIlluminationTallies(ctx);
            });
            this.profileDrawPassSection("renderGroundTiles", () => {
                this.renderGroundTiles(ctx, visibleNodes);
            });
            this.profileDrawPassSection("renderPrototypeSectionSeams", () => {
                this.renderPrototypeSectionSeams(ctx);
            });
            this.profileDrawPassSection("renderClearanceOverlay", () => {
                if (typeof drawAnimalClearanceOverlay === "function") {
                    drawAnimalClearanceOverlay(this.layers.ground, this.camera);
                }
            });
            this.profileDrawPassSection("renderTileClearanceNumbers", () => {
                if (typeof drawTileClearanceNumbers === "function") {
                    drawTileClearanceNumbers(this.layers.ground, this.camera);
                }
            });
            this.profileDrawPassSection("drawMapBorder", () => {
                const debugEnabled = !!(
                    (typeof debugMode !== "undefined" && debugMode) ||
                    global.debugMode
                );
                if (debugEnabled && typeof global.drawMapBorder === "function") {
                    global.drawMapBorder();
                }
            });
            this.profileDrawPassSection("renderRoadsAndFloors", () => {
                this.renderRoadsAndFloors(ctx, visibleNodes);
            });
            this.profileDrawPassSection("renderHexGridOverlay", () => {
                this.renderHexGridOverlay(ctx);
            });
            this.profileDrawPassSection("applyMazeModeCompositor", () => {
                this.applyMazeModeCompositor(ctx);
            });
            this.profileDrawPassSection("renderLosShadowOverlay", () => {
                this.renderLosShadowOverlay(ctx);
            });
            this.profileDrawPassSection("renderObjects3D", () => {
                this.renderObjects3D(ctx, visibleNodes, visibleObjects);
            });
            this.profileDrawPassSection("renderWallPlacementPreview", () => {
                this.renderWallPlacementPreview(ctx);
            });
            this.profileDrawPassSection("renderRoadPlacementPreview", () => {
                this.renderRoadPlacementPreview(ctx);
            });
            this.profileDrawPassSection("renderFirewallPlacementPreview", () => {
                this.renderFirewallPlacementPreview(ctx);
            });
            this.profileDrawPassSection("renderTriggerAreaPlacementPreview", () => {
                this.renderTriggerAreaPlacementPreview(ctx);
            });
            this.profileDrawPassSection("renderPlaceObjectPreview", () => {
                this.renderPlaceObjectPreview(ctx);
            });
            this.profileDrawPassSection("renderPowerupPlacementPreview", () => {
                this.renderPowerupPlacementPreview(ctx);
            });
            this.profileDrawPassSection("renderPowerups", () => {
                this.renderPowerups(ctx);
            });
            this.profileDrawPassSection("renderWizard", () => {
                this.renderWizard(ctx);
            });
            this.profileDrawPassSection("renderCreatureTracePaths", () => {
                this.renderCreatureTracePaths(ctx);
            });
            this.profileDrawPassSection("renderProjectiles", () => {
                this.renderProjectiles(ctx);
            });
            this.profileDrawPassSection("renderScriptMessages", () => {
                this.renderScriptMessages(ctx);
            });
            if (this.scenePicker && typeof this.scenePicker.renderHoverHighlight === "function") {
                this.profileDrawPassSection("scenePicker.renderHoverHighlight", () => {
                    const spellSystemRef = (typeof SpellSystem !== "undefined")
                        ? SpellSystem
                        : (global.SpellSystem || null);
                    const mousePosRef = (typeof mousePos !== "undefined")
                        ? mousePos
                        : (global.mousePos || null);
                    const frameCountRef = (typeof frameCount !== "undefined")
                        ? frameCount
                        : (global.frameCount || 0);
                    const spaceHeldRef = !!(
                        typeof keysPressed !== "undefined" &&
                        keysPressed &&
                        keysPressed[" "]
                    );
                    this.scenePicker.renderHoverHighlight({
                        app: ctx.app || global.app || null,
                        wizard: ctx.wizard || global.wizard || null,
                        spellSystem: spellSystemRef,
                        mousePos: mousePosRef,
                        spaceHeld: spaceHeldRef,
                        frameCount: frameCountRef,
                        viewport: ctx.viewport || null,
                        pickRenderItems: this.pickRenderItems,
                        camera: this.camera,
                        uiLayer: this.layers.ui,
                        getDisplayObjectForItem: (item) => {
                            if (!item) return null;
                            if (item._renderingDepthMesh && item._renderingDepthMesh.visible) return item._renderingDepthMesh;
                            if (item.type === "road") {
                                const roadSprite = this.roadSpriteByObject.get(item);
                                if (roadSprite && roadSprite.parent) return roadSprite;
                            }
                            if (item._renderingDisplayObject && item._renderingDisplayObject.parent) {
                                return item._renderingDisplayObject;
                            }
                            if (item.pixiSprite && item.pixiSprite.parent) return item.pixiSprite;
                            return null;
                        }
                    });
                });
            }
            if (this.hexGridContainer && this.hexGridContainer.parent === this.layers.ui) {
                const ui = this.layers.ui;
                const hasBackdrop = !!(
                    this.hexGridPickerBackdrop &&
                    this.hexGridPickerBackdrop.parent === ui
                );
                const previewSprite = (this.scenePicker && this.scenePicker.pickPreviewSprite && this.scenePicker.pickPreviewSprite.parent === ui)
                    ? this.scenePicker.pickPreviewSprite
                    : null;
                if (previewSprite) {
                    const previewTopIdx = ui.children.length - 1;
                    if (ui.getChildIndex(previewSprite) !== previewTopIdx) {
                        ui.setChildIndex(previewSprite, previewTopIdx);
                    }
                    const previewIdx = ui.getChildIndex(previewSprite);
                    const gridTargetIdx = Math.max(hasBackdrop ? 1 : 0, previewIdx - 1);
                    if (ui.getChildIndex(this.hexGridContainer) !== gridTargetIdx) {
                        ui.setChildIndex(this.hexGridContainer, gridTargetIdx);
                    }
                    if (hasBackdrop && ui.getChildIndex(this.hexGridPickerBackdrop) !== 0) {
                        ui.setChildIndex(this.hexGridPickerBackdrop, 0);
                    }
                } else {
                    const gridTargetIdx = hasBackdrop ? 1 : 0;
                    if (ui.getChildIndex(this.hexGridContainer) !== gridTargetIdx) {
                        ui.setChildIndex(this.hexGridContainer, gridTargetIdx);
                    }
                    if (hasBackdrop && ui.getChildIndex(this.hexGridPickerBackdrop) !== 0) {
                        ui.setChildIndex(this.hexGridPickerBackdrop, 0);
                    }
                }
            }
            const showPickerScreen = getShowPickerScreenFlag();
            setShowPickerScreenFlag(showPickerScreen);
            this.layers.ground.visible = !showPickerScreen;
            this.layers.roadsFloor.visible = !showPickerScreen;
            this.layers.groundObjects.visible = !showPickerScreen;
            this.layers.losShadow.visible = !showPickerScreen && !this.mazeModeOverlayActive;
            this.layers.depthObjects.visible = !showPickerScreen;
            this.layers.objects3d.visible = !showPickerScreen;
            if (this.layers.characters) {
                this.layers.characters.visible = !showPickerScreen;
            }
            this.layers.entities.visible = !showPickerScreen;
            this.layers.scriptMessages.visible = !showPickerScreen;
            this.layers.ui.visible = true;
            if (this.mazeModeRenderer && this.mazeModeRenderer.blackBackdropGraphics) {
                this.mazeModeRenderer.blackBackdropGraphics.visible = !showPickerScreen && this.mazeModeOverlayActive;
            }
            if (this.mazeModeRenderer && this.mazeModeRenderer.occlusionMaskGraphics) {
                this.mazeModeRenderer.occlusionMaskGraphics.visible = !showPickerScreen && this.mazeModeOverlayActive;
            }
            if (isTextureSanitizerEnabled()) {
                this.profileDrawPassSection("sanitizeDisplayTreeTextures", () => {
                    const sanitizeRoot = (ctx && ctx.app && ctx.app.stage) ? ctx.app.stage : this.layers.root;
                    const sanitizeResult = sanitizeDisplayTreeTextures(sanitizeRoot, { maxSamples: 6 });
                    if (sanitizeResult && sanitizeResult.repaired > 0) {
                        const nowMs = performance.now();
                        if (!Number.isFinite(this._lastTextureSanitizerLogAtMs) || (nowMs - this._lastTextureSanitizerLogAtMs) > 1000) {
                            this._lastTextureSanitizerLogAtMs = nowMs;
                            console.warn("[render texture sanitizer]", {
                                repaired: sanitizeResult.repaired,
                                samples: sanitizeResult.samples
                            });
                        }
                    }
                });
            }
            const frameElapsedMs = performance.now() - frameStartMs;
            this.recordDrawPassSection("renderFrame.total", frameElapsedMs);
            if (typeof globalThis !== "undefined") {
                globalThis.renderingLiveStats = {
                    groundCached: this.groundSpriteByNodeKey instanceof Map
                        ? this.groundSpriteByNodeKey.size
                        : 0,
                    groundVisible: this.groundVisibleNodeKeys instanceof Set
                        ? this.groundVisibleNodeKeys.size
                        : 0,
                    groundPool: Array.isArray(this.groundSpritePool)
                        ? this.groundSpritePool.length
                        : 0,
                    roadCached: this.roadSpriteByObject instanceof Map
                        ? this.roadSpriteByObject.size
                        : 0,
                    depthMeshes: this.activeDepthBillboardMeshes instanceof Set
                        ? this.activeDepthBillboardMeshes.size
                        : 0,
                    objectDisplays: this.activeObjectDisplayObjects instanceof Set
                        ? this.activeObjectDisplayObjects.size
                        : 0,
                    groundLayerChildren: this.layers && this.layers.ground && Array.isArray(this.layers.ground.children)
                        ? this.layers.ground.children.length
                        : 0,
                    roadsLayerChildren: this.layers && this.layers.roadsFloor && Array.isArray(this.layers.roadsFloor.children)
                        ? this.layers.roadsFloor.children.length
                        : 0,
                    objectsLayerChildren: this.layers && this.layers.objects3d && Array.isArray(this.layers.objects3d.children)
                        ? this.layers.objects3d.children.length
                        : 0
                };
            }
            if (typeof globalThis !== "undefined" && isDrawPassBreakdownEnabled()) {
                const sections = this.currentFrameDrawSections || Object.create(null);
                const metrics = this.currentFrameMetrics || Object.create(null);
                const getMs = (name) => Number(sections[name] || 0);
                const getMetric = (name) => Number(metrics[name] || 0);
                const visibleObjectsCount = Array.isArray(visibleObjects) ? visibleObjects.length : 0;
                let hydratedRoads = 0;
                let hydratedTrees = 0;
                for (let i = 0; i < visibleObjectsCount; i++) {
                    const item = visibleObjects[i];
                    if (!item || item.gone || item.vanishing) continue;
                    if (item.type === "road") {
                        hydratedRoads += 1;
                    } else if (item.type === "tree") {
                        hydratedTrees += 1;
                    }
                }
                globalThis.drawPerfBreakdown = {
                    lazyMs: 0,
                    prepMs: getMs("resetWallDepthGeometryBudget") + getMs("camera.update"),
                    collectMs: getMs("collectVisibleNodes") + getMs("collectVisibleObjects") + getMs("syncOnscreenObjectsCache"),
                    losMs: getMs("updateLosState") + getMs("updateWallLosIlluminationTallies"),
                    composeMs: frameElapsedMs,
                    passWorldMs:
                        getMs("renderGroundTiles") +
                        getMs("renderHexGridOverlay") +
                        getMs("renderPrototypeSectionSeams") +
                        getMs("renderClearanceOverlay") +
                        getMs("renderTileClearanceNumbers") +
                        getMs("drawMapBorder") +
                        getMs("renderRoadsAndFloors"),
                    passWorldGroundMs: getMs("renderGroundTiles"),
                    passWorldHexMs: getMs("renderHexGridOverlay"),
                    passWorldSeamsMs: getMs("renderPrototypeSectionSeams"),
                    passWorldClearanceMs: getMs("renderClearanceOverlay"),
                    passWorldTileNumbersMs: getMs("renderTileClearanceNumbers"),
                    passWorldBorderMs: getMs("drawMapBorder"),
                    passWorldRoadsMs: getMs("renderRoadsAndFloors"),
                    passLosMs:
                        getMs("applyMazeModeCompositor") +
                        getMs("renderLosShadowOverlay"),
                    passObjectsMs:
                        getMs("renderObjects3D") +
                        getMs("renderPowerups") +
                        getMs("renderWizard") +
                        getMs("renderCreatureTracePaths") +
                        getMs("renderProjectiles") +
                        getMs("renderScriptMessages"),
                    passPostMs:
                        getMs("renderWallPlacementPreview") +
                        getMs("renderRoadPlacementPreview") +
                        getMs("renderFirewallPlacementPreview") +
                        getMs("renderTriggerAreaPlacementPreview") +
                        getMs("renderPlaceObjectPreview") +
                        getMs("renderPowerupPlacementPreview") +
                        getMs("scenePicker.renderHoverHighlight") +
                        getMs("drawNodeInspectorOverlay") +
                        getMs("sanitizeDisplayTreeTextures"),
                    composeMaskMs: 0,
                    composeSortMs: 0,
                    composePopulateMs: 0,
                    composeInvariantMs: 0,
                    composeWallSectionsMs: 0,
                    composeWallSectionsGroups: 0,
                    composeWallSectionsRebuilt: 0,
                    composeUnaccountedMs: 0,
                    composeInvariantSkipped: 0,
                    visibleNodes: getMetric("visibleNodes"),
                    visibleNodesWrapped: getMetric("visibleNodesWrapped"),
                    visibleNodesFallback: getMetric("visibleNodesFallback"),
                    visibleNodeFilterSkipped: getMetric("visibleNodeFilterSkipped"),
                    visibleNodeFallbackUsed: getMetric("visibleNodeFallbackUsed"),
                    visibleObjectNodeRefs: getMetric("visibleObjectNodeRefs"),
                    visibleObjectVisibilityRefs: getMetric("visibleObjectVisibilityRefs"),
                    visibleObjectDuplicateRefsSkipped: getMetric("visibleObjectDuplicateRefsSkipped"),
                    visibleAnimalsAdded: getMetric("visibleAnimalsAdded"),
                    visibleAnimalsSkippedOffscreen: getMetric("visibleAnimalsSkippedOffscreen"),
                    onscreenCacheObjects: getMetric("onscreenCacheObjects"),
                    onscreenCacheRoofs: getMetric("onscreenCacheRoofs"),
                    losCandidates: getMetric("losCandidates"),
                    losBuildMs: getMetric("losBuildMs"),
                    losTraceMs: getMetric("losTraceMs"),
                    losTotalMs: getMetric("losTotalMs"),
                    losRecomputed: getMetric("losRecomputed"),
                    losVisibleObjects: getMetric("losVisibleObjects"),
                    wallLosMs: getMetric("wallLosMs"),
                    wallLosResetSections: getMetric("wallLosResetSections"),
                    wallLosIlluminatedBins: getMetric("wallLosIlluminatedBins"),
                    wallLosRangedSections: getMetric("wallLosRangedSections"),
                    wallLosEndpointLookups: getMetric("wallLosEndpointLookups"),
                    wallLosEndpointOwnersResolved: getMetric("wallLosEndpointOwnersResolved"),
                    mazeModeMaskWorldPoints: getMetric("mazeModeMaskWorldPoints"),
                    mazeModeMaskActive: getMetric("mazeModeMaskActive"),
                    roadsVisible: getMetric("roadsVisible"),
                    roadsCached: getMetric("roadsCached"),
                    roadsCreated: getMetric("roadsCreated"),
                    roadsAttached: getMetric("roadsAttached"),
                    roadsTextureRefreshes: getMetric("roadsTextureRefreshes"),
                    roadsTextureAssignments: getMetric("roadsTextureAssignments"),
                    roadsHidden: getMetric("roadsHidden"),
                    roadsDestroyed: getMetric("roadsDestroyed"),
                    roadsEvicted: getMetric("roadsEvicted"),
                    roadsMs: getMetric("roadsMs"),
                    depthCandidates: getMetric("depthCandidates"),
                    depthMissingMountedSection: getMetric("depthMissingMountedSection"),
                    depthHiddenByScript: getMetric("depthHiddenByScript"),
                    depthDoorBottomOutlineOnly: getMetric("depthDoorBottomOutlineOnly"),
                    groundObjectSpritesRendered: getMetric("groundObjectSpritesRendered"),
                    objects3dLosBuildMs: getMetric("objects3dLosBuildMs"),
                    objects3dLosVisibleSetSize: getMetric("objects3dLosVisibleSetSize"),
                    objects3dLosVisibleWalls: getMetric("objects3dLosVisibleWalls"),
                    objects3dFilterMs: getMetric("objects3dFilterMs"),
                    objects3dTransformMs: getMetric("objects3dTransformMs"),
                    objects3dDepthMs: getMetric("objects3dDepthMs"),
                    objects3dGroundMs: getMetric("objects3dGroundMs"),
                    objects3dDisplayMs: getMetric("objects3dDisplayMs"),
                    objects3dAnimalLosHidden: getMetric("objects3dAnimalLosHidden"),
                    objects3dMazeHidden: getMetric("objects3dMazeHidden"),
                    objects3dMazeHiddenWalls: getMetric("objects3dMazeHiddenWalls"),
                    objects3dMapItems: getMetric("objects3dMapItems"),
                    objects3dRoofItems: getMetric("objects3dRoofItems"),
                    objects3dRenderItems: getMetric("objects3dRenderItems"),
                    objects3dDepthRendered: getMetric("objects3dDepthRendered"),
                    objects3dGroundRendered: getMetric("objects3dGroundRendered"),
                    objects3dDisplayObjects: getMetric("objects3dDisplayObjects"),
                    objects3dVisibleAnimals: getMetric("objects3dVisibleAnimals"),
                    objects3dVisibleTrees: getMetric("objects3dVisibleTrees"),
                    mapItems: visibleObjectsCount,
                    onscreen: (typeof global.onscreenObjects !== "undefined" && global.onscreenObjects && Number.isFinite(global.onscreenObjects.size))
                        ? Number(global.onscreenObjects.size)
                        : visibleObjectsCount,
                    groundCached: this.groundSpriteByNodeKey instanceof Map
                        ? this.groundSpriteByNodeKey.size
                        : 0,
                    groundVisible: this.groundVisibleNodeKeys instanceof Set
                        ? this.groundVisibleNodeKeys.size
                        : 0,
                    groundPool: Array.isArray(this.groundSpritePool)
                        ? this.groundSpritePool.length
                        : 0,
                    roadCached: this.roadSpriteByObject instanceof Map
                        ? this.roadSpriteByObject.size
                        : 0,
                    depthMeshes: this.activeDepthBillboardMeshes instanceof Set
                        ? this.activeDepthBillboardMeshes.size
                        : 0,
                    objectDisplays: this.activeObjectDisplayObjects instanceof Set
                        ? this.activeObjectDisplayObjects.size
                        : 0,
                    groundLayerChildren: this.layers && this.layers.ground && Array.isArray(this.layers.ground.children)
                        ? this.layers.ground.children.length
                        : 0,
                    roadsLayerChildren: this.layers && this.layers.roadsFloor && Array.isArray(this.layers.roadsFloor.children)
                        ? this.layers.roadsFloor.children.length
                        : 0,
                    objectsLayerChildren: this.layers && this.layers.objects3d && Array.isArray(this.layers.objects3d.children)
                        ? this.layers.objects3d.children.length
                        : 0,
                    hydratedRoads,
                    hydratedTrees
                };
                globalThis.renderingFrameMetrics = { ...metrics };
            } else if (typeof globalThis !== "undefined") {
                globalThis.drawPerfBreakdown = null;
                globalThis.renderingFrameMetrics = null;
            }
            if (this.drawPassProfiler && !this.drawPassProfiler.printed) {
                this.drawPassProfiler.frameCount += 1;
                this.drawPassProfiler.totalFrameMs += frameElapsedMs;
                if (frameElapsedMs > this.drawPassProfiler.maxFrameMs) {
                    this.drawPassProfiler.maxFrameMs = frameElapsedMs;
                }
            }
            this.maybePrintDrawPassProfileSummary(ctx);
            this.profileDrawPassSection("drawNodeInspectorOverlay", () => {
                if (typeof drawNodeInspectorOverlay === "function") {
                    drawNodeInspectorOverlay(this.layers.ui, this.camera);
                }
            });
            return true;
        }
    }

    let singleton = null;

    const renderingApi = {
        renderFrame(ctx) {
            if (!global.RenderingCamera || !global.RenderingLayers || typeof PIXI === "undefined") {
                return false;
            }
            if (!singleton) singleton = new RenderingImpl();
            return singleton.renderFrame(ctx || {});
        },
        isWorldPointTargetable(worldX, worldY, wizardOverride = null, mapOverride = null) {
            const wizardRef = wizardOverride || global.wizard || null;
            if (!wizardRef || !Number.isFinite(worldX) || !Number.isFinite(worldY)) return true;
            if (!singleton) return true;
            const mazeModeEnabled = typeof singleton.isLosMazeModeEnabled === "function"
                ? singleton.isLosMazeModeEnabled()
                : false;
            const omnivisionActive = typeof singleton.isOmnivisionActive === "function"
                ? singleton.isOmnivisionActive(wizardRef)
                : false;
            if (!mazeModeEnabled || omnivisionActive) return true;
            if (typeof singleton.isWorldPointInLosShadow !== "function") return true;
            return !singleton.isWorldPointInLosShadow(worldX, worldY, wizardRef, mapOverride);
        },
        getLayers() {
            return singleton && singleton.layers ? singleton.layers : null;
        },
        disable() {
            if (!singleton) return;
            for (const item of singleton.activeDepthBillboardItems) {
                if (item && item.pixiSprite) {
                    item.pixiSprite.visible = true;
                    if (Object.prototype.hasOwnProperty.call(item.pixiSprite, "renderable")) {
                        item.pixiSprite.renderable = true;
                    }
                }
                if (item && item._renderingDepthMesh) {
                    if (item._renderingDepthMesh.parent) {
                        item._renderingDepthMesh.parent.removeChild(item._renderingDepthMesh);
                    }
                    item._renderingDepthMesh.visible = false;
                    item._renderingDepthMesh = null;
                }
            }
            singleton.activeDepthBillboardItems.clear();
            singleton.activeDepthBillboardMeshes.clear();
            for (const sprite of singleton.activePowerupDisplayObjects) {
                if (!sprite) continue;
                sprite.visible = false;
                if (Object.prototype.hasOwnProperty.call(sprite, "renderable")) {
                    sprite.renderable = false;
                }
            }
            singleton.activePowerupDisplayObjects.clear();
            for (const sprite of singleton.activeProjectileDisplayObjects) {
                if (!sprite) continue;
                sprite.visible = false;
                if (Object.prototype.hasOwnProperty.call(sprite, "renderable")) {
                    sprite.renderable = false;
                }
                if (sprite.parent) {
                    sprite.parent.removeChild(sprite);
                }
            }
            singleton.activeProjectileDisplayObjects.clear();
            singleton.clearPlaceObjectPreview();
            singleton.clearPowerupPlacementPreview();
            singleton.clearWallPlacementPreview();
            singleton.clearRoadPlacementPreview();
            if (singleton.scenePicker && typeof singleton.scenePicker.hideAll === "function") {
                singleton.scenePicker.hideAll();
            }
            if (singleton.scenePicker && singleton.scenePicker.publicApi && global.renderingScenePicker === singleton.scenePicker.publicApi) {
                global.renderingScenePicker = null;
            }
            singleton.layers.root.visible = false;
            singleton.setLegacyLayersVisible(true);
        }
    };
    global.Rendering = renderingApi;
})(typeof globalThis !== "undefined" ? globalThis : window);
