(function attachRendering(global) {
    const GROUND_TILE_OVERLAP_SCALE = 1.5;
    const TREE_ALPHA_CUTOFF = 0.08;
    const LOS_NEAR_REVEAL_RADIUS = 1.0;
    const LOS_THROTTLE_MS = 33;
    const LOS_BINS = 1800;
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

    class RenderingImpl {
        constructor() {
            const CameraCtor = global.RenderingCamera;
            const LayersCtor = global.RenderingLayers;
            this.camera = new CameraCtor();
            this.layers = new LayersCtor();
            this.initialized = false;
            this.wizardSprite = null;
            this.wizardShadowGraphics = null;
            this.placeObjectPreviewSprite = null;
            this.placeObjectPreviewTexturePath = "";
            this.placeObjectPreviewDisplayObject = null;
            this.placeObjectPreviewItem = null;
            this.placeObjectCenterSnapGuideGraphics = null;
            this.wallPlacementPreviewGraphics = null;
            this.hexGridTexture = null;
            this.hexGridSprites = [];
            this.hexGridContainer = null;
            this.hexGridLastViewscale = 0;
            this.hexGridLastXyratio = 0;
            this.groundSpriteByNodeKey = new Map();
            this.roadSpriteByObject = new Map();
            this.lastSectionInputItems = [];
            this.activeObjectDisplayObjects = new Set();
            this.activeRoofMeshes = new Set();
            this.activeDepthBillboardMeshes = new Set();
            this.activeDepthBillboardItems = new Set();
            this.activePowerupDisplayObjects = new Set();
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
            if (!displayObj.parent) return;
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
                "hitboxLayer"
            ];
            for (let i = 0; i < names.length; i++) {
                const layer = global[names[i]];
                if (layer && typeof layer.visible === "boolean") layer.visible = visible;
            }
        }

        getLosVisualSetting(key, fallback) {
            const settings = (typeof LOSVisualSettings !== "undefined")
                ? LOSVisualSettings
                : (global.LOSVisualSettings || null);
            if (!settings || typeof settings !== "object") return fallback;
            return Object.prototype.hasOwnProperty.call(settings, key) ? settings[key] : fallback;
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

        isLosOccluder(item) {
            if (!item || !item.groundPlaneHitbox) return false;
            if (item.type === "road" || item.type === "firewall" || item.type === "roof") return false;
            const isAnimal = (typeof Animal !== "undefined" && item instanceof Animal);
            if (isAnimal) return false;
            const placedObjectEntity = (typeof global.isPlacedObjectEntity === "function")
                ? global.isPlacedObjectEntity(item)
                : !!(item && (item.isPlacedObject || item.objectType === "placedObject" || item.type === "placedObject"));
            if (
                placedObjectEntity &&
                typeof item.category === "string" &&
                item.category.trim().toLowerCase() === "windows"
            ) {
                return false;
            }
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

        updateLosState(ctx, visibleNodes) {
            const wizard = ctx && ctx.wizard ? ctx.wizard : null;
            const losSystem = (typeof LOSSystem !== "undefined") ? LOSSystem : global.LOSSystem;
            if (!wizard || !losSystem || typeof losSystem.computeState !== "function") {
                this.clearLosStateDebug();
                return;
            }

            const activeAuras = (wizard && Array.isArray(wizard.activeAuras))
                ? wizard.activeAuras
                : ((wizard && typeof wizard.activeAura === "string") ? [wizard.activeAura] : []);
            const omnivisionActive = activeAuras.includes("omnivision");
            if (omnivisionActive) {
                this.clearLosStateDebug();
                return;
            }

            const losBuildStartMs = performance.now();
            const visibleObjects = this.collectVisibleObjects(visibleNodes, ctx);
            const losCandidates = [];
            for (let i = 0; i < visibleObjects.length; i++) {
                const obj = visibleObjects[i];
                if (!obj || obj === wizard || obj.gone || obj.vanishing) continue;
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
                const losForwardFovDegreesRaw = Number(this.getLosVisualSetting("forwardFovDegrees", 200));
                const losForwardFovDegrees = Number.isFinite(losForwardFovDegreesRaw)
                    ? Math.max(0, Math.min(360, losForwardFovDegreesRaw))
                    : 200;
                this.currentLosState = losSystem.computeState(wizard, losCandidates, {
                    bins: LOS_BINS,
                    facingAngle,
                    fovDegrees: losForwardFovDegrees
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

            const shadowEnabled = !!this.getLosVisualSetting("shadowEnabled", true);
            const shadowOpacityRaw = Number(this.getLosVisualSetting("shadowOpacity", 0.4));
            const shadowOpacity = Number.isFinite(shadowOpacityRaw) ? Math.max(0, Math.min(1, shadowOpacityRaw)) : 0.4;
            const wizard = ctx && ctx.wizard ? ctx.wizard : null;
            const state = this.currentLosState;
            if (!shadowEnabled || shadowOpacity <= 0 || !wizard || !state || !state.depth || !Number.isFinite(state.bins)) {
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
                const d0 = Number.isFinite(depth[i]) ? Math.max(LOS_NEAR_REVEAL_RADIUS, depth[i]) : farDist;
                const d1 = Number.isFinite(depth[j]) ? Math.max(LOS_NEAR_REVEAL_RADIUS, depth[j]) : farDist;
                if (d0 >= farDist && d1 >= farDist) continue;

                const t0 = angleForBin(i);
                const t1 = angleForBin(j);
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
            const seen = new Set();
            const out = [];
            for (let n = 0; n < nodes.length; n++) {
                const node = nodes[n];
                if (!node || !Array.isArray(node.objects)) continue;
                for (let i = 0; i < node.objects.length; i++) {
                    const obj = node.objects[i];
                    if (!obj || obj.gone || obj.vanishing) continue;
                    if (seen.has(obj)) continue;
                    seen.add(obj);
                    out.push(obj);
                }
            }
            const animalsList = Array.isArray(ctx && ctx.animals)
                ? ctx.animals
                : (Array.isArray(global.animals) ? global.animals : []);
            for (let i = 0; i < animalsList.length; i++) {
                const animal = animalsList[i];
                if (!animal || animal.gone || animal.vanishing) continue;
                if (!animal.onScreen) continue;
                if (seen.has(animal)) continue;
                seen.add(animal);
                out.push(animal);
            }
            return out;
        }

        collectVisibleNodes(ctx, xPadding = 0, yPadding = 0) {
            const map = ctx.map;
            if (!map || !Array.isArray(map.nodes)) return [];
            const nodes = [];

            // Reuse legacy wrapped viewport sampling to keep layer culling consistent.
            if (typeof global.forEachWrappedNodeInViewport === "function") {
                global.forEachWrappedNodeInViewport(
                    Math.max(0, Number.isFinite(xPadding) ? Math.floor(xPadding) : 0),
                    Math.max(0, Number.isFinite(yPadding) ? Math.floor(yPadding) : 0),
                    (node) => {
                        if (node) nodes.push(node);
                    },
                    ctx.camera
                );
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
                    if (node) nodes.push(node);
                }
            }
            return nodes;
        }

        syncOnscreenObjectsCache(ctx, visibleNodes) {
            const cache = (typeof global.onscreenObjects !== "undefined") ? global.onscreenObjects : null;
            if (!cache || typeof cache.clear !== "function" || typeof cache.add !== "function") return;
            cache.clear();

            const nodes = Array.isArray(visibleNodes) ? visibleNodes : [];
            const seen = new Set();
            for (let n = 0; n < nodes.length; n++) {
                const node = nodes[n];
                if (!node || !Array.isArray(node.objects)) continue;
                for (let i = 0; i < node.objects.length; i++) {
                    const obj = node.objects[i];
                    if (!obj || obj.gone || obj.vanishing) continue;
                    if (seen.has(obj)) continue;
                    seen.add(obj);
                    cache.add(obj);
                }
            }

            const animals = Array.isArray(ctx && ctx.animals)
                ? ctx.animals
                : (Array.isArray(global.animals) ? global.animals : []);
            for (let i = 0; i < animals.length; i++) {
                const animal = animals[i];
                if (!animal || animal.gone || animal.vanishing || animal.dead) continue;
                if (!animal.onScreen) continue;
                cache.add(animal);
            }

            const roofRef = ctx && ctx.roof ? ctx.roof : (global.roof || null);
            if (roofRef && roofRef.placed && roofRef.pixiMesh && roofRef.pixiMesh.visible) {
                cache.add(roofRef);
            }
        }

        shouldUseDepthBillboard(item) {
            if (!item || item.gone || item.vanishing) return false;
            if (item.type === "road" || item.type === "roof" || item.type === "wallSection") {
                return false;
            }
            const category = (typeof item.category === "string") ? item.category.trim().toLowerCase() : "";
            const isWallMountedSpatial = !!(
                item.rotationAxis === "spatial" &&
                (category === "windows" || category === "doors" || item.type === "window" || item.type === "door")
            );
            if (item.rotationAxis === "spatial" && !isWallMountedSpatial) return false;
            if (typeof item.updateDepthBillboardMesh !== "function") return false;
            const sprite = item.pixiSprite;
            if (!isWallMountedSpatial && (!sprite || !sprite.texture)) return false;
            if (isWallMountedSpatial && !sprite && !(typeof item.texturePath === "string" && item.texturePath.length > 0)) return false;
            return true;
        }

        renderDepthBillboardObjects(ctx, renderItems) {
            const container = this.layers.depthObjects;
            if (!container) return new Set();
            const depthRenderedItems = new Set();
            const currentMeshes = new Set();
            const currentItems = new Set();

            for (let i = 0; i < renderItems.length; i++) {
                const item = renderItems[i];
                if (!this.shouldUseDepthBillboard(item)) continue;
                if (typeof item.updateSpriteAnimation === "function") {
                    item.updateSpriteAnimation();
                }
                const sprite = item.pixiSprite;
                const mesh = item.updateDepthBillboardMesh(ctx, this.camera, { alphaCutoff: TREE_ALPHA_CUTOFF });
                if (!mesh) continue;
                item._renderingDepthMesh = mesh;

                if (mesh.parent !== container) {
                    container.addChild(mesh);
                }
                mesh.visible = true;
                if (Object.prototype.hasOwnProperty.call(mesh, "renderable")) {
                    mesh.renderable = true;
                }
                currentMeshes.add(mesh);
                currentItems.add(item);
                depthRenderedItems.add(item);
                const category = (typeof item.category === "string") ? item.category.trim().toLowerCase() : "";
                const useMeshForPicking = !!(
                    item.rotationAxis === "spatial" &&
                    (category === "windows" || category === "doors" || item.type === "window" || item.type === "door")
                );
                this.addPickRenderItem(item, useMeshForPicking ? mesh : sprite, { forceInclude: true });

                // Hide legacy sprite when depth mesh is active.
                sprite.visible = false;
                if (Object.prototype.hasOwnProperty.call(sprite, "renderable")) {
                    sprite.renderable = false;
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
                    item.pixiSprite.visible = true;
                    if (Object.prototype.hasOwnProperty.call(item.pixiSprite, "renderable")) {
                        item.pixiSprite.renderable = true;
                    }
                }
                if (item && item._renderingDepthMesh) {
                    item._renderingDepthMesh = null;
                }
            }
            this.activeDepthBillboardMeshes = currentMeshes;
            this.activeDepthBillboardItems = currentItems;

            return depthRenderedItems;
        }

        renderGroundTiles(ctx, visibleNodes) {
            const map = ctx.map;
            const container = this.layers.ground;
            if (!map || !Array.isArray(map.nodes) || !container) return;

            const cam = this.camera;
            const tileW = (Number.isFinite(map.hexWidth) ? map.hexWidth : (1 / 0.866))
                * cam.viewscale
                * GROUND_TILE_OVERLAP_SCALE;
            const tileH = (Number.isFinite(map.hexHeight) ? map.hexHeight : 1)
                * cam.viewscale
                * cam.xyratio
                * GROUND_TILE_OVERLAP_SCALE;
            const nodes = Array.isArray(visibleNodes) ? visibleNodes : [];
            const visibleNodeKeys = new Set();

            for (let i = 0; i < nodes.length; i++) {
                const node = nodes[i];
                if (!node) continue;
                const key = `${node.xindex},${node.yindex}`;
                visibleNodeKeys.add(key);
                let sprite = this.groundSpriteByNodeKey.get(key);
                if (!sprite) {
                    sprite = new PIXI.Sprite(PIXI.Texture.WHITE);
                    sprite.name = "renderingGroundTile";
                    sprite.anchor.set(0.5, 0.5);
                    this.groundSpriteByNodeKey.set(key, sprite);
                }
                if (sprite.parent !== container) {
                    container.addChild(sprite);
                }

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

                const center = cam.worldToScreen(node.x, node.y, 0);
                sprite.x = center.x;
                sprite.y = center.y;
                sprite.width = tileW;
                sprite.height = tileH;
                sprite.alpha = 1;
                sprite.visible = true;
            }

            for (const [key, sprite] of this.groundSpriteByNodeKey.entries()) {
                if (!visibleNodeKeys.has(key) && sprite) {
                    sprite.visible = false;
                }
            }
        }

        renderRoadsAndFloors(ctx, visibleNodes) {
            const map = ctx.map;
            const cam = this.camera;
            const container = this.layers.roadsFloor;
            if (!map || !Array.isArray(map.nodes) || !container) return;

            const visibleRoadObjects = new Set();
            const nodes = Array.isArray(visibleNodes) ? visibleNodes : [];
            for (let n = 0; n < nodes.length; n++) {
                const node = nodes[n];
                if (!node || !Array.isArray(node.objects)) continue;
                for (let i = 0; i < node.objects.length; i++) {
                    const obj = node.objects[i];
                    if (!obj || obj.gone || obj.type !== "road") continue;
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
                }
                if (sprite.parent !== container) {
                    container.addChild(sprite);
                }

                const sourceTexture = road && road.pixiSprite && road.pixiSprite.texture
                    ? road.pixiSprite.texture
                    : null;
                if (sourceTexture && sourceTexture !== sprite.texture) {
                    sprite.texture = sourceTexture;
                } else if (
                    !sourceTexture &&
                    typeof road.fillTexturePath === "string" &&
                    road.fillTexturePath.length > 0
                ) {
                    sprite.texture = PIXI.Texture.from(road.fillTexturePath);
                }

                const worldX = Number.isFinite(road.x) ? road.x : (road.node && Number.isFinite(road.node.x) ? road.node.x : 0);
                const worldY = Number.isFinite(road.y) ? road.y : (road.node && Number.isFinite(road.node.y) ? road.node.y : 0);
                const p = cam.worldToScreen(worldX, worldY, 0);
                sprite.x = p.x;
                sprite.y = p.y;
                sprite.width = (Number(road.width) || 1) * cam.viewscale * 1.1547;
                sprite.height = (Number(road.height) || 1) * cam.viewscale * cam.xyratio;
                sprite.alpha = Number.isFinite(road.alpha) ? road.alpha : 1;
                sprite.visible = true;
                road._renderingDisplayObject = sprite;
                this.addPickRenderItem(road, sprite);
            }

            for (const [road, sprite] of this.roadSpriteByObject.entries()) {
                if (!road || road.gone) {
                    if (sprite && sprite.parent) {
                        sprite.parent.removeChild(sprite);
                    }
                    this.roadSpriteByObject.delete(road);
                    continue;
                }
                if (!visibleRoadObjects.has(road) && sprite) {
                    sprite.visible = false;
                }
            }
        }

        renderHexGridOverlay(ctx) {
            const layer = this.layers.ground;
            if (!layer) return;

            const gridEnabled = !!(
                (typeof showHexGrid !== "undefined" && showHexGrid) ||
                (typeof debugMode !== "undefined" && debugMode)
            );
            if (!gridEnabled) {
                if (this.hexGridContainer) this.hexGridContainer.visible = false;
                return;
            }

            const appRef = (ctx && ctx.app) || global.app || null;
            const cam = this.camera;
            if (!appRef || !appRef.renderer) return;

            if (!this.hexGridContainer) {
                this.hexGridContainer = new PIXI.Container();
                this.hexGridContainer.name = "renderingHexGridContainer";
                this.hexGridContainer.interactiveChildren = false;
                layer.addChild(this.hexGridContainer);
            } else if (this.hexGridContainer.parent !== layer) {
                layer.addChild(this.hexGridContainer);
            }
            this.hexGridContainer.visible = true;

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
            for (; idx < this.hexGridSprites.length; idx++) {
                if (this.hexGridSprites[idx]) this.hexGridSprites[idx].visible = false;
            }

            // Float the container to the top of the ground layer.
            if (this.hexGridContainer.parent === layer) {
                const lastIdx = layer.children.length - 1;
                if (layer.getChildIndex(this.hexGridContainer) !== lastIdx) {
                    layer.setChildIndex(this.hexGridContainer, lastIdx);
                }
            }
        }

        renderObjects3D(ctx, visibleNodes) {
            const container = this.layers.objects3d;
            if (!container) return;

            const mapItems = this.collectVisibleObjects(visibleNodes, ctx).filter(item =>
                item &&
                item.type !== "road" &&
                item.type !== "roof" &&
                item !== (ctx && ctx.wizard)
            );
            const renderItems = mapItems;

            for (let i = 0; i < renderItems.length; i++) {
                const item = renderItems[i];
                if (!item) continue;
                const category = (typeof item.category === "string") ? item.category.trim().toLowerCase() : "";
                const isWallMountedSpatial = !!(
                    item.rotationAxis === "spatial" &&
                    (category === "windows" || category === "doors" || item.type === "window" || item.type === "door")
                );
                if (!isWallMountedSpatial) {
                    if (item.skipTransform && typeof item.draw === "function") {
                        item.draw();
                    } else if (typeof global.applySpriteTransform === "function") {
                        global.applySpriteTransform(item);
                    }
                }
            }
            const depthBillboardRenderedItems = this.renderDepthBillboardObjects(ctx, renderItems);
            const currentDisplayObjects = new Set();

            for (let i = 0; i < renderItems.length; i++) {
                const item = renderItems[i];
                if (!item) continue;
                if (depthBillboardRenderedItems.has(item)) continue;
                let displayObj = item.pixiSprite || null;
                if (
                    item.type === "wallSection" &&
                    typeof item.getDepthMeshDisplayObject === "function"
                ) {
                    const depthDisplay = item.getDepthMeshDisplayObject({
                        camera: ctx.camera || this.camera,
                        app: ctx.app,
                        viewscale: this.camera.viewscale,
                        xyratio: this.camera.xyratio,
                        tint: item.pixiSprite && Number.isFinite(item.pixiSprite.tint)
                            ? item.pixiSprite.tint
                            : 0xFFFFFF,
                        alpha: item.pixiSprite && Number.isFinite(item.pixiSprite.alpha)
                            ? item.pixiSprite.alpha
                            : 1
                    });
                    if (depthDisplay) {
                        displayObj = depthDisplay;
                    }
                }
                if (!displayObj) continue;
                if (displayObj.parent !== container) {
                    container.addChild(displayObj);
                }
                displayObj.visible = true;
                item._renderingDisplayObject = displayObj;
                if (Object.prototype.hasOwnProperty.call(displayObj, "renderable")) {
                    displayObj.renderable = true;
                }
                currentDisplayObjects.add(displayObj);
                this.addPickRenderItem(item, displayObj);
            }

            // Ensure wall-mounted depth billboards (windows/doors) win picker hits over wall sections.
            // Their visible pixels should be targetable even when coplanar with section meshes.
            for (let i = 0; i < renderItems.length; i++) {
                const item = renderItems[i];
                if (!item || !depthBillboardRenderedItems.has(item)) continue;
                const category = (typeof item.category === "string") ? item.category.trim().toLowerCase() : "";
                const isWallMountedSpatial = !!(
                    item.rotationAxis === "spatial" &&
                    (category === "windows" || category === "doors" || item.type === "window" || item.type === "door")
                );
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
        }

        renderRoofs3D(ctx) {
            const container = this.layers.objects3d;
            if (!container) return;
            const roofRef = ctx.roof || global.roof || null;
            const currentRoofMeshes = new Set();
            if (roofRef) {
                if (typeof global.updateRoofPreview === "function") {
                    global.updateRoofPreview(roofRef);
                }
                if (roofRef.pixiMesh) {
                    if (roofRef.pixiMesh.parent !== container) {
                        container.addChild(roofRef.pixiMesh);
                    }
                    roofRef.pixiMesh.visible = !!roofRef.pixiMesh.visible;
                    if (roofRef.pixiMesh.parent && roofRef.pixiMesh.parent.children.length > 1) {
                        roofRef.pixiMesh.parent.setChildIndex(
                            roofRef.pixiMesh,
                            roofRef.pixiMesh.parent.children.length - 1
                        );
                    }
                    currentRoofMeshes.add(roofRef.pixiMesh);
                }
            }

            for (const mesh of this.activeRoofMeshes) {
                if (!currentRoofMeshes.has(mesh) && mesh) {
                    mesh.visible = false;
                }
            }
            this.activeRoofMeshes = currentRoofMeshes;
        }

        renderWizard(ctx) {
            const e = this.layers.entities;
            const wizard = ctx.wizard;
            if (!wizard || !Number.isFinite(wizard.x) || !Number.isFinite(wizard.y)) return;

            if (!this.wizardShadowGraphics) {
                this.wizardShadowGraphics = new PIXI.Graphics();
                this.wizardShadowGraphics.name = "renderingWizardShadow";
                e.addChild(this.wizardShadowGraphics);
            }

            if (!this.wizardSprite) {
                const initialTexture = (Array.isArray(ctx.wizardFrames) && ctx.wizardFrames[0])
                    ? ctx.wizardFrames[0]
                    : PIXI.Texture.WHITE;
                this.wizardSprite = new PIXI.Sprite(initialTexture);
                this.wizardSprite.name = "renderingWizard";
                this.wizardSprite.anchor.set(0.5, 0.75);
                e.addChild(this.wizardSprite);
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
                this.wizardSprite.texture = ctx.wizardFrames[frameIndex];
            }

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

            this.wizardSprite.x = pGround.x;
            this.wizardSprite.y = pGround.y - jumpOffsetPx;
            this.wizardSprite.width = this.camera.viewscale;
            this.wizardSprite.height = this.camera.viewscale;
            this.wizardSprite.visible = true;
            this.addPickRenderItem(wizard, this.wizardSprite, { forceInclude: true });

            const shadow = this.wizardShadowGraphics;
            const shadowCenterY = pGround.y + 0.2 * this.camera.viewscale * this.camera.xyratio;
            const shadowRadiusX = 0.2 * this.camera.viewscale;
            const shadowRadiusY = shadowRadiusX * this.camera.xyratio;
            shadow.clear();
            shadow.beginFill(0x000000, 0.3);
            shadow.drawEllipse(pGround.x, shadowCenterY, shadowRadiusX, shadowRadiusY);
            shadow.endFill();
            shadow.visible = true;

            const hat = wizard.hatGraphics;
            if (hat && typeof hat === "object") {
                if (hat.parent !== e) {
                    e.addChild(hat);
                }
                hat.x = pGround.x;
                const hatYOffset = (Number.isFinite(wizard.hatRenderYOffsetUnits) ? wizard.hatRenderYOffsetUnits : 0)
                    * this.camera.viewscale * this.camera.xyratio;
                hat.y = pGround.y - jumpOffsetPx - hatYOffset;
                if (hat.scale && typeof hat.scale.set === "function") {
                    const hatRes = Number.isFinite(wizard.hatResolution) ? Math.max(1, wizard.hatResolution) : 1;
                    const hatRenderScale = Number.isFinite(wizard.hatRenderScale) ? Math.max(0.05, wizard.hatRenderScale) : 1;
                    const s = (this.camera.viewscale / hatRes) * hatRenderScale;
                    hat.scale.set(s, s);
                }
                hat.visible = true;
                if (hat.parent && hat.parent.children[hat.parent.children.length - 1] !== hat) {
                    hat.parent.setChildIndex(hat, hat.parent.children.length - 1);
                }
            }
        }

        renderPowerups(ctx) {
            const depthContainer = this.layers.depthObjects;
            if (!depthContainer) return;

            const list = Array.isArray(ctx && ctx.powerups)
                ? ctx.powerups
                : (Array.isArray(global.powerups) ? global.powerups : []);
            const currentDisplayObjects = new Set();

            for (let i = 0; i < list.length; i++) {
                const powerup = list[i];
                if (!powerup || powerup.gone || powerup.collected) continue;
                if (!Number.isFinite(powerup.x) || !Number.isFinite(powerup.y)) continue;
                if (typeof powerup.ensureSprite === "function") {
                    powerup.ensureSprite();
                }
                const sprite = powerup.pixiSprite;
                if (!sprite) continue;
                if (typeof powerup.updateSpriteAnimation === "function") {
                    powerup.updateSpriteAnimation();
                }

                const point = this.camera.worldToScreen(
                    powerup.x,
                    powerup.y,
                    Number.isFinite(powerup.z) ? powerup.z : 0
                );
                const w = Number.isFinite(powerup.width) ? Math.max(0.01, Number(powerup.width)) : 0.8;
                const h = Number.isFinite(powerup.height) ? Math.max(0.01, Number(powerup.height)) : 0.8;
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

                if (depthMesh.parent !== depthContainer) {
                    depthContainer.addChild(depthMesh);
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
                currentDisplayObjects.add(depthMesh);
                this.addPickRenderItem(powerup, depthMesh, { forceInclude: true });
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

        getMousePosRef(ctx) {
            if (ctx && ctx.mousePos) return ctx.mousePos;
            if (typeof mousePos !== "undefined") return mousePos;
            return global.mousePos || null;
        }

        clearPlaceObjectPreview() {
            if (this.placeObjectPreviewItem && this.placeObjectPreviewItem._depthBillboardMesh) {
                const mesh = this.placeObjectPreviewItem._depthBillboardMesh;
                mesh.visible = false;
                if (Object.prototype.hasOwnProperty.call(mesh, "renderable")) {
                    mesh.renderable = false;
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

        clearWallPlacementPreview() {
            if (!this.wallPlacementPreviewGraphics) return;
            this.wallPlacementPreviewGraphics.clear();
            this.wallPlacementPreviewGraphics.visible = false;
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
            if (
                typeof global.WallSectionUnit !== "undefined" &&
                global.WallSectionUnit &&
                typeof global.WallSectionUnit.planPlacementFromWorldPoints === "function"
            ) {
                const plan = global.WallSectionUnit.planPlacementFromWorldPoints(mapRef, startWorld, endWorld);
                if (plan && Array.isArray(plan.segments)) {
                    segments = plan.segments.slice();
                }
            }

            if (segments.length === 0 && typeof mapRef.worldToNode === "function") {
                const startNode = mapRef.worldToNode(startWorld.x, startWorld.y);
                const endNode = mapRef.worldToNode(endWorld.x, endWorld.y);
                if (
                    startNode && endNode &&
                    Number.isFinite(startNode.x) && Number.isFinite(startNode.y) &&
                    Number.isFinite(endNode.x) && Number.isFinite(endNode.y)
                ) {
                    segments.push({ start: startNode, end: endNode });
                }
            }

            if (segments.length === 0) {
                g.visible = false;
                return;
            }

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

        buildPlaceObjectPreviewRenderItem(ctx) {
            const wizard = (ctx && ctx.wizard) || global.wizard || null;
            if (!wizard || wizard.currentSpell !== "placeobject") {
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
            const rotationAxis = (rawAxis === "spatial" || rawAxis === "visual" || rawAxis === "none")
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
            const isWallMountedPlacement = selectedCategory === "windows" || selectedCategory === "doors";
            const spellSystemRef = (typeof SpellSystem !== "undefined")
                ? SpellSystem
                : (global.SpellSystem || null);
            const snapPlacement = (
                isWallMountedPlacement &&
                spellSystemRef &&
                typeof spellSystemRef.getPlaceObjectPlacementCandidate === "function"
            ) ? spellSystemRef.getPlaceObjectPlacementCandidate(wizard, worldX, worldY) : null;
            const useSnapPlacement = !!(snapPlacement && snapPlacement.targetWall);
            if (isWallMountedPlacement) {
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
            const placeableScale = Number.isFinite(wizard.selectedPlaceableScale)
                ? Number(wizard.selectedPlaceableScale)
                : 1;
            const clampedScale = Math.max(0.2, Math.min(5, placeableScale));
            const selectedAnchorY = Number.isFinite(wizard.selectedPlaceableAnchorY)
                ? Number(wizard.selectedPlaceableAnchorY)
                : 1;
            const yScale = Math.max(0.1, Math.abs(Number.isFinite(this.camera.xyratio) ? this.camera.xyratio : 0.66));
            const placementYOffset = (rotationAxis === "spatial")
                ? 0
                : (((selectedAnchorY - 0.5) * clampedScale) / yScale);
            const previewX = useSnapPlacement ? snapPlacement.snappedX : worldX;
            let placedY = useSnapPlacement ? snapPlacement.snappedY : (worldY + placementYOffset);
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
                const staticProto = global.StaticObject && global.StaticObject.prototype
                    ? global.StaticObject.prototype
                    : null;
                if (staticProto && typeof staticProto.ensureDepthBillboardMesh === "function") {
                    this.placeObjectPreviewItem.ensureDepthBillboardMesh = staticProto.ensureDepthBillboardMesh;
                }
                if (staticProto && typeof staticProto.updateDepthBillboardMesh === "function") {
                    this.placeObjectPreviewItem.updateDepthBillboardMesh = staticProto.updateDepthBillboardMesh;
                }
            }
            const previewItem = this.placeObjectPreviewItem;
            previewItem.map = mapRef || previewItem.map || null;
            previewItem.pixiSprite = this.placeObjectPreviewSprite;
            previewItem.x = previewX;
            previewItem.y = useSnapPlacement ? snapPlacement.snappedY : worldY;
            previewItem.z = useSnapPlacement ? Number(snapPlacement.snappedZ) : 0;
            previewItem.width = clampedScale;
            previewItem.height = clampedScale;
            previewItem.renderZ = placedY + renderDepthOffset;
            previewItem.previewAlpha = 0.5;
            previewItem.texturePath = texturePath;
            previewItem.category = selectedCategory;
            previewItem.placeableAnchorX = Number.isFinite(wizard.selectedPlaceableAnchorX)
                ? (useSnapPlacement ? 0.5 : Number(wizard.selectedPlaceableAnchorX))
                : 0.5;
            previewItem.placeableAnchorY = Number.isFinite(wizard.selectedPlaceableAnchorY)
                ? Number(wizard.selectedPlaceableAnchorY)
                : 1;
            previewItem.rotationAxis = useSnapPlacement ? "spatial" : rotationAxis;
            previewItem.placementRotation = useSnapPlacement ? snapPlacement.snappedRotationDeg : effectivePlacementRotation;
            previewItem.mountedSectionId = (
                useSnapPlacement &&
                Number.isInteger(snapPlacement.mountedSectionId)
            ) ? Number(snapPlacement.mountedSectionId) : null;
            previewItem.mountedWallFacingSign = (
                useSnapPlacement &&
                Number.isFinite(snapPlacement.mountedWallFacingSign)
            ) ? Number(snapPlacement.mountedWallFacingSign) : null;
            previewItem.centerSnapGuide = useSnapPlacement
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
            if (
                !guide ||
                !Number.isFinite(guide.placementCenterX) ||
                !Number.isFinite(guide.placementCenterY) ||
                !Number.isFinite(guide.sectionCenterX) ||
                !Number.isFinite(guide.sectionCenterY)
            ) {
                g.visible = false;
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
            let displayObj = null;
            if (
                typeof previewItem.updateDepthBillboardMesh === "function" &&
                previewItem.rotationAxis === "spatial"
            ) {
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
            if (!displayObj && typeof global.applySpriteTransform === "function") {
                global.applySpriteTransform(previewItem);
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
            if (this.placeObjectPreviewDisplayObject && this.placeObjectPreviewDisplayObject !== displayObj) {
                this.placeObjectPreviewDisplayObject.visible = false;
                if (Object.prototype.hasOwnProperty.call(this.placeObjectPreviewDisplayObject, "renderable")) {
                    this.placeObjectPreviewDisplayObject.renderable = false;
                }
            }
            this.placeObjectPreviewDisplayObject = displayObj;
            this.renderPlaceObjectCenterSnapGuide(previewItem);
        }

        renderFrame(ctx) {
            this.init(ctx);
            if (!this.initialized) return false;
            this.setLegacyLayersVisible(false);
            this.layers.root.visible = true;
            this.camera.update({
                camera: ctx.camera,
                wizard: ctx.wizard,
                viewport: ctx.viewport,
                viewscale: ctx.viewscale,
                xyratio: ctx.xyratio,
                map: ctx.map
            });
            this.resetPickRenderItems();
            if (this.scenePicker && this.scenePicker.publicApi) {
                global.renderingScenePicker = this.scenePicker.publicApi;
            }
            const visibleNodes = this.collectVisibleNodes(ctx, 4, 4);
            this.syncOnscreenObjectsCache(ctx, visibleNodes);
            this.updateLosState(ctx, visibleNodes);
            this.renderGroundTiles(ctx, visibleNodes);
            this.renderHexGridOverlay(ctx);
            if (typeof global.drawMapBorder === "function") {
                global.drawMapBorder();
            }
            this.renderRoadsAndFloors(ctx, visibleNodes);
            this.renderLosShadowOverlay(ctx);
            this.renderObjects3D(ctx, visibleNodes);
            this.renderWallPlacementPreview(ctx);
            this.renderPlaceObjectPreview(ctx);
            this.renderRoofs3D(ctx);
            this.renderPowerups(ctx);
            this.renderWizard(ctx);
            if (this.scenePicker && typeof this.scenePicker.renderHoverHighlight === "function") {
                const spellSystemRef = (typeof SpellSystem !== "undefined")
                    ? SpellSystem
                    : (global.SpellSystem || null);
                const mousePosRef = (typeof mousePos !== "undefined")
                    ? mousePos
                    : (global.mousePos || null);
                const frameCountRef = (typeof frameCount !== "undefined")
                    ? frameCount
                    : (global.frameCount || 0);
                this.scenePicker.renderHoverHighlight({
                    app: ctx.app || global.app || null,
                    wizard: ctx.wizard || global.wizard || null,
                    spellSystem: spellSystemRef,
                    mousePos: mousePosRef,
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
            }
            const showPickerScreen = getShowPickerScreenFlag();
            setShowPickerScreenFlag(showPickerScreen);
            this.layers.ground.visible = !showPickerScreen;
            this.layers.roadsFloor.visible = !showPickerScreen;
            this.layers.losShadow.visible = !showPickerScreen;
            this.layers.depthObjects.visible = !showPickerScreen;
            this.layers.objects3d.visible = !showPickerScreen;
            this.layers.entities.visible = !showPickerScreen;
            this.layers.ui.visible = true;
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
            singleton.clearPlaceObjectPreview();
            singleton.clearWallPlacementPreview();
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
