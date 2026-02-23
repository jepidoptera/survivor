(function attachRenderer2(global) {
    const GROUND_TILE_OVERLAP_SCALE = 1.5;
    const TREE_ALPHA_CUTOFF = 0.08;
    const DEPTH_BILLBOARD_VS = `
precision mediump float;
attribute vec3 aWorldPosition;
attribute vec2 aUvs;
uniform vec2 uScreenSize;
uniform vec2 uCameraWorld;
uniform float uViewScale;
uniform float uXyRatio;
uniform vec2 uDepthRange;
varying vec2 vUvs;
void main(void) {
    float camDx = aWorldPosition.x - uCameraWorld.x;
    float camDy = aWorldPosition.y - uCameraWorld.y;
    float camDz = aWorldPosition.z;
    float sx = max(1.0, uScreenSize.x);
    float sy = max(1.0, uScreenSize.y);
    float screenX = camDx * uViewScale;
    float screenY = (camDy - camDz) * uViewScale * uXyRatio;
    float depthMetric = camDy + camDz;
    float farMetric = uDepthRange.x;
    float invSpan = max(1e-6, uDepthRange.y);
    float nd = clamp((farMetric - depthMetric) * invSpan, 0.0, 1.0);
    vec2 clip = vec2(
        (screenX / sx) * 2.0 - 1.0,
        1.0 - (screenY / sy) * 2.0
    );
    gl_Position = vec4(clip, nd * 2.0 - 1.0, 1.0);
    vUvs = aUvs;
}
`;
    const DEPTH_BILLBOARD_FS = `
precision mediump float;
varying vec2 vUvs;
uniform sampler2D uSampler;
uniform vec4 uTint;
uniform float uAlphaCutoff;
void main(void) {
    vec4 tex = texture2D(uSampler, vUvs) * uTint;
    if (tex.a < uAlphaCutoff) discard;
    gl_FragColor = tex;
}
`;

    class Renderer2Impl {
        constructor() {
            this.camera = new global.Renderer2Camera();
            this.layers = new global.Renderer2Layers();
            this.initialized = false;
            this.wizardSprite = null;
            this.wizardShadowGraphics = null;
            this.groundSpriteByNodeKey = new Map();
            this.roadSpriteByObject = new Map();
            this.lastSectionInputItems = [];
            this.activeObjectDisplayObjects = new Set();
            this.activeRoofMeshes = new Set();
            this.depthObjectsState = null;
            this.treeDepthMeshByObject = new Map();
            this.activeTreeDepthMeshes = new Set();
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
                "projectileLayer",
                "hitboxLayer"
            ];
            for (let i = 0; i < names.length; i++) {
                const layer = global[names[i]];
                if (layer && typeof layer.visible === "boolean") layer.visible = visible;
            }
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

        ensureDepthObjectsState() {
            if (this.depthObjectsState) return this.depthObjectsState;
            const state = new PIXI.State();
            state.depthTest = true;
            state.depthMask = true;
            state.blend = false;
            state.culling = false;
            this.depthObjectsState = state;
            return state;
        }

        createTreeDepthMesh(item) {
            const state = this.ensureDepthObjectsState();
            const geometry = new PIXI.Geometry()
                .addAttribute("aWorldPosition", new Float32Array(12), 3)
                .addAttribute("aUvs", new Float32Array([
                    0, 1,
                    1, 1,
                    1, 0,
                    0, 0
                ]), 2)
                .addIndex(new Uint16Array([0, 1, 2, 0, 2, 3]));
            const shader = PIXI.Shader.from(DEPTH_BILLBOARD_VS, DEPTH_BILLBOARD_FS, {
                uScreenSize: new Float32Array([1, 1]),
                uCameraWorld: new Float32Array([0, 0]),
                uViewScale: 1,
                uXyRatio: 1,
                uDepthRange: new Float32Array([0, 1]),
                uTint: new Float32Array([1, 1, 1, 1]),
                uAlphaCutoff: TREE_ALPHA_CUTOFF,
                uSampler: PIXI.Texture.WHITE
            });
            const mesh = new PIXI.Mesh(geometry, shader, state, PIXI.DRAW_MODES.TRIANGLES);
            mesh.name = "renderer2TreeDepth";
            mesh.interactive = false;
            mesh.roundPixels = true;
            mesh.visible = false;
            return {
                item,
                mesh,
                worldPositions: geometry.getBuffer("aWorldPosition").data,
                lastSignature: ""
            };
        }

        ensureTreeDepthMeshRecord(item) {
            let record = this.treeDepthMeshByObject.get(item);
            if (record) return record;
            record = this.createTreeDepthMesh(item);
            this.treeDepthMeshByObject.set(item, record);
            return record;
        }

        updateTreeDepthWorldQuad(item, record) {
            if (!item || !record || !record.mesh) return;
            const sprite = item.pixiSprite;
            if (!sprite) return;
            const viewScale = Math.max(1e-6, Math.abs(this.camera.viewscale) || 1);
            const xyRatio = Math.max(1e-6, Math.abs(this.camera.xyratio) || 1);
            const anchorX = (sprite.anchor && Number.isFinite(sprite.anchor.x)) ? Number(sprite.anchor.x) : 0.5;
            const anchorY = (sprite.anchor && Number.isFinite(sprite.anchor.y)) ? Number(sprite.anchor.y) : 1;
            const worldWidth = Math.max(0.01, Math.abs(Number(sprite.width) || 0) / viewScale);
            const worldHeightZ = Math.max(0.01, Math.abs(Number(sprite.height) || 0) / (viewScale * xyRatio));
            const worldX = Number.isFinite(item.x) ? Number(item.x) : 0;
            const worldY = Number.isFinite(item.y) ? Number(item.y) : 0;
            const worldZ = Number.isFinite(item.z) ? Number(item.z) : 0;
            const leftX = worldX - anchorX * worldWidth;
            const rightX = worldX + (1 - anchorX) * worldWidth;
            const bottomZ = worldZ - (1 - anchorY) * worldHeightZ;
            const topZ = worldZ + anchorY * worldHeightZ;
            const signature = [
                leftX, rightX, worldY, bottomZ, topZ, worldWidth, worldHeightZ
            ].map(v => v.toFixed(4)).join("|");
            if (signature === record.lastSignature) return;

            const positions = record.worldPositions;
            // BL, BR, TR, TL in world coordinates.
            positions[0] = leftX;  positions[1] = worldY; positions[2] = bottomZ;
            positions[3] = rightX; positions[4] = worldY; positions[5] = bottomZ;
            positions[6] = rightX; positions[7] = worldY; positions[8] = topZ;
            positions[9] = leftX;  positions[10] = worldY; positions[11] = topZ;
            record.mesh.geometry.getBuffer("aWorldPosition").update();
            record.lastSignature = signature;
        }

        renderTreeDepthObjects(ctx, renderItems) {
            const container = this.layers.depthObjects;
            if (!container) return new Set();
            const depthRenderedItems = new Set();
            const activeItems = new Set();
            const currentMeshes = new Set();
            const viewportHeight = Number(ctx && ctx.viewport && ctx.viewport.height) || 30;
            const nearMetric = -Math.max(80, viewportHeight * 0.6);
            const farMetric = Math.max(180, viewportHeight * 2.0 + 80);
            const depthSpanInv = 1 / Math.max(1e-6, farMetric - nearMetric);

            for (let i = 0; i < renderItems.length; i++) {
                const item = renderItems[i];
                if (!item || item.type !== "tree" || item.gone || item.vanishing) continue;
                const sprite = item.pixiSprite;
                if (!sprite || !sprite.texture) continue;

                const record = this.ensureTreeDepthMeshRecord(item);
                const mesh = record.mesh;
                this.updateTreeDepthWorldQuad(item, record);

                const uniforms = mesh.shader && mesh.shader.uniforms ? mesh.shader.uniforms : null;
                if (uniforms) {
                    const tint = Number.isFinite(sprite.tint) ? Number(sprite.tint) : 0xFFFFFF;
                    const screenW = (ctx && ctx.app && ctx.app.screen && Number.isFinite(ctx.app.screen.width))
                        ? Number(ctx.app.screen.width)
                        : 1;
                    const screenH = (ctx && ctx.app && ctx.app.screen && Number.isFinite(ctx.app.screen.height))
                        ? Number(ctx.app.screen.height)
                        : 1;
                    uniforms.uScreenSize[0] = Math.max(1, screenW);
                    uniforms.uScreenSize[1] = Math.max(1, screenH);
                    uniforms.uCameraWorld[0] = Number(this.camera.x) || 0;
                    uniforms.uCameraWorld[1] = Number(this.camera.y) || 0;
                    uniforms.uViewScale = Number(this.camera.viewscale) || 1;
                    uniforms.uXyRatio = Number(this.camera.xyratio) || 1;
                    uniforms.uDepthRange[0] = farMetric;
                    uniforms.uDepthRange[1] = depthSpanInv;
                    uniforms.uTint[0] = ((tint >> 16) & 255) / 255;
                    uniforms.uTint[1] = ((tint >> 8) & 255) / 255;
                    uniforms.uTint[2] = (tint & 255) / 255;
                    uniforms.uTint[3] = Number.isFinite(sprite.alpha) ? Number(sprite.alpha) : 1;
                    uniforms.uAlphaCutoff = TREE_ALPHA_CUTOFF;
                    uniforms.uSampler = sprite.texture;
                }

                if (mesh.parent !== container) {
                    container.addChild(mesh);
                }
                mesh.visible = true;
                if (Object.prototype.hasOwnProperty.call(mesh, "renderable")) {
                    mesh.renderable = true;
                }
                currentMeshes.add(mesh);
                activeItems.add(item);
                depthRenderedItems.add(item);

                // Hide legacy sprite when depth mesh is active.
                sprite.visible = false;
                if (Object.prototype.hasOwnProperty.call(sprite, "renderable")) {
                    sprite.renderable = false;
                }
            }

            for (const mesh of this.activeTreeDepthMeshes) {
                if (!currentMeshes.has(mesh) && mesh) {
                    mesh.visible = false;
                }
            }
            this.activeTreeDepthMeshes = currentMeshes;

            for (const [item, record] of this.treeDepthMeshByObject.entries()) {
                if (activeItems.has(item)) continue;
                if (item && item.pixiSprite) {
                    item.pixiSprite.visible = true;
                    if (Object.prototype.hasOwnProperty.call(item.pixiSprite, "renderable")) {
                        item.pixiSprite.renderable = true;
                    }
                }
                if (!item || item.gone) {
                    if (record && record.mesh && typeof record.mesh.destroy === "function") {
                        record.mesh.destroy({ children: false, texture: false, baseTexture: false });
                    }
                    this.treeDepthMeshByObject.delete(item);
                }
            }

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
                    sprite.name = "renderer2GroundTile";
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
                    sprite.name = "renderer2Road";
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

        renderObjects3D(ctx, visibleNodes) {
            const wallSections = global.WallSectionsRenderer;
            const container = this.layers.objects3d;
            if (!container) return;

            const mapItems = this.collectVisibleObjects(visibleNodes, ctx).filter(item =>
                item &&
                item.type !== "road" &&
                item.type !== "roof" &&
                item !== (ctx && ctx.wizard)
            );
            this.lastSectionInputItems = mapItems;

            let hiddenItems = new Set();
            let compositeItems = [];
            if (wallSections && typeof wallSections.buildCompositeRenderItems === "function") {
                wallSections.prepareFrame(this.camera.viewscale, this.camera.xyratio);
                const sectionResult = wallSections.buildCompositeRenderItems({
                    enabled: true,
                    items: mapItems,
                    cachePrefix: "renderer2",
                    camera: ctx.camera || this.camera,
                    map: ctx.map,
                    app: ctx.app,
                    PIXI: (typeof PIXI !== "undefined") ? PIXI : null,
                    viewscale: this.camera.viewscale,
                    xyratio: this.camera.xyratio,
                    isWallMountedPlaceable: (typeof global.isWallMountedPlaceable === "function")
                        ? global.isWallMountedPlaceable
                        : (() => false)
                });
                wallSections.endFrame();
                hiddenItems = (sectionResult && sectionResult.hiddenItems instanceof Set)
                    ? sectionResult.hiddenItems
                    : new Set();
                compositeItems = (sectionResult && Array.isArray(sectionResult.renderItems))
                    ? sectionResult.renderItems
                    : [];
            }

            const renderItems = mapItems
                .filter(item => !hiddenItems.has(item))
                .concat(compositeItems);

            for (let i = 0; i < renderItems.length; i++) {
                const item = renderItems[i];
                if (!item) continue;
                if (item.type !== "wallSectionComposite" && typeof global.applySpriteTransform === "function") {
                    global.applySpriteTransform(item);
                }
            }
            const depthRenderedItems = this.renderTreeDepthObjects(ctx, renderItems);
            const currentDisplayObjects = new Set();

            for (let i = 0; i < renderItems.length; i++) {
                const item = renderItems[i];
                if (!item) continue;
                if (depthRenderedItems.has(item)) continue;
                const displayObj = item.pixiSprite || null;
                if (!displayObj) continue;
                if (displayObj.parent !== container) {
                    container.addChild(displayObj);
                }
                displayObj.visible = true;
                if (Object.prototype.hasOwnProperty.call(displayObj, "renderable")) {
                    displayObj.renderable = true;
                }
                currentDisplayObjects.add(displayObj);
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
                this.wizardShadowGraphics.name = "renderer2WizardShadow";
                e.addChild(this.wizardShadowGraphics);
            }

            if (!this.wizardSprite) {
                const initialTexture = (Array.isArray(ctx.wizardFrames) && ctx.wizardFrames[0])
                    ? ctx.wizardFrames[0]
                    : PIXI.Texture.WHITE;
                this.wizardSprite = new PIXI.Sprite(initialTexture);
                this.wizardSprite.name = "renderer2Wizard";
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
                const speedRatio = (wizard.currentMaxSpeed && wizard.speed)
                    ? (wizard.currentMaxSpeed / wizard.speed)
                    : 1;
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
            const previousJumpHeight = Number.isFinite(wizard.prevJumpHeight)
                ? wizard.prevJumpHeight
                : (Number.isFinite(wizard.jumpHeight) ? wizard.jumpHeight : 0);
            const currentJumpHeight = Number.isFinite(wizard.jumpHeight) ? wizard.jumpHeight : 0;
            const interpolatedJumpHeight = previousJumpHeight + (currentJumpHeight - previousJumpHeight) * alpha;

            const p = this.camera.worldToScreen(wizard.x, wizard.y, Number.isFinite(wizard.z) ? wizard.z : 0);
            const jumpOffsetPx = interpolatedJumpHeight * this.camera.viewscale * this.camera.xyratio;

            this.wizardSprite.x = p.x;
            this.wizardSprite.y = p.y - jumpOffsetPx;
            this.wizardSprite.width = this.camera.viewscale;
            this.wizardSprite.height = this.camera.viewscale;
            this.wizardSprite.visible = true;

            const shadow = this.wizardShadowGraphics;
            const shadowCenterY = p.y + 0.2 * this.camera.viewscale * this.camera.xyratio;
            const shadowRadiusX = 0.2 * this.camera.viewscale;
            const shadowRadiusY = shadowRadiusX * this.camera.xyratio;
            shadow.clear();
            shadow.beginFill(0x000000, 0.3);
            shadow.drawEllipse(p.x, shadowCenterY, shadowRadiusX, shadowRadiusY);
            shadow.endFill();
            shadow.visible = true;

            const hat = wizard.hatGraphics;
            if (hat && typeof hat === "object") {
                if (hat.parent !== e) {
                    e.addChild(hat);
                }
                hat.x = p.x;
                hat.y = p.y - jumpOffsetPx;
                if (hat.scale && typeof hat.scale.set === "function") {
                    hat.scale.set(this.camera.viewscale, this.camera.viewscale);
                }
                hat.visible = true;
                if (hat.parent && hat.parent.children[hat.parent.children.length - 1] !== hat) {
                    hat.parent.setChildIndex(hat, hat.parent.children.length - 1);
                }
            }
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
                xyratio: ctx.xyratio
            });
            const visibleNodes = this.collectVisibleNodes(ctx, 4, 4);
            this.syncOnscreenObjectsCache(ctx, visibleNodes);
            this.renderGroundTiles(ctx, visibleNodes);
            this.renderRoadsAndFloors(ctx, visibleNodes);
            this.renderObjects3D(ctx, visibleNodes);
            this.renderRoofs3D(ctx);
            this.renderWizard(ctx);
            return true;
        }
    }

    let singleton = null;

    global.Renderer2 = {
        renderFrame(ctx) {
            if (!global.Renderer2Camera || !global.Renderer2Layers || typeof PIXI === "undefined") {
                return false;
            }
            if (!singleton) singleton = new Renderer2Impl();
            return singleton.renderFrame(ctx || {});
        },
        disable() {
            if (!singleton) return;
            if (global.WallSectionsRenderer && typeof global.WallSectionsRenderer.restoreRenderable === "function") {
                global.WallSectionsRenderer.restoreRenderable(
                    Array.isArray(singleton.lastSectionInputItems) ? singleton.lastSectionInputItems : [],
                    (typeof global.isWallMountedPlaceable === "function")
                        ? global.isWallMountedPlaceable
                        : (() => false)
                );
            }
            for (const [item, record] of singleton.treeDepthMeshByObject.entries()) {
                if (item && item.pixiSprite) {
                    item.pixiSprite.visible = true;
                    if (Object.prototype.hasOwnProperty.call(item.pixiSprite, "renderable")) {
                        item.pixiSprite.renderable = true;
                    }
                }
                if (record && record.mesh) {
                    record.mesh.visible = false;
                }
            }
            singleton.layers.root.visible = false;
            singleton.setLegacyLayersVisible(true);
        }
    };
})(typeof globalThis !== "undefined" ? globalThis : window);
