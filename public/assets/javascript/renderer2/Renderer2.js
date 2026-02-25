(function attachRenderer2(global) {
    const GROUND_TILE_OVERLAP_SCALE = 1.5;
    const TREE_ALPHA_CUTOFF = 0.08;
    if (typeof global.renderer2ShowPickerScreen !== "boolean") {
        global.renderer2ShowPickerScreen = false;
    }

    class Renderer2Impl {
        constructor() {
            this.camera = new global.Renderer2Camera();
            this.layers = new global.Renderer2Layers();
            this.initialized = false;
            this.wizardSprite = null;
            this.wizardShadowGraphics = null;
            this.placeObjectPreviewSprite = null;
            this.placeObjectPreviewTexturePath = "";
            this.placeObjectPreviewDisplayObject = null;
            this.placeObjectPreviewItem = null;
            this.placeObjectCenterSnapGuideGraphics = null;
            this.groundSpriteByNodeKey = new Map();
            this.roadSpriteByObject = new Map();
            this.lastSectionInputItems = [];
            this.activeObjectDisplayObjects = new Set();
            this.activeRoofMeshes = new Set();
            this.activeDepthBillboardMeshes = new Set();
            this.activeDepthBillboardItems = new Set();
            this.pickRenderItems = [];
            this.scenePicker = (global.Renderer2ScenePicker && typeof global.Renderer2ScenePicker === "function")
                ? new global.Renderer2ScenePicker()
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
            if (item.type === "road" || item.type === "roof" || item.type === "wall" || item.type === "wallSectionComposite") {
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
                const sprite = item.pixiSprite;
                const mesh = item.updateDepthBillboardMesh(ctx, this.camera, { alphaCutoff: TREE_ALPHA_CUTOFF });
                if (!mesh) continue;
                item._renderer2DepthMesh = mesh;

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
                if (item && item._renderer2DepthMesh) {
                    item._renderer2DepthMesh = null;
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
                road._renderer2DisplayObject = sprite;
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
                const sectionItems = mapItems.filter(item => {
                    if (!item) return false;
                    const type = (typeof item.type === "string") ? item.type.trim().toLowerCase() : "";
                    if (type === "window" || type === "door") return false;
                    const category = (typeof item.category === "string") ? item.category.trim().toLowerCase() : "";
                    return !(category === "windows" || category === "doors");
                });
                wallSections.prepareFrame(this.camera.viewscale, this.camera.xyratio, { outputMode: "mesh3d" });
                const sectionResult = wallSections.buildCompositeRenderItems({
                    enabled: true,
                    items: sectionItems,
                    cachePrefix: "renderer2",
                    outputMode: "mesh3d",
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
                const category = (typeof item.category === "string") ? item.category.trim().toLowerCase() : "";
                const isWallMountedSpatial = !!(
                    item.rotationAxis === "spatial" &&
                    (category === "windows" || category === "doors" || item.type === "window" || item.type === "door")
                );
                if (!isWallMountedSpatial && item.type !== "wallSectionComposite" && typeof global.applySpriteTransform === "function") {
                    global.applySpriteTransform(item);
                }
            }
            const depthBillboardRenderedItems = this.renderDepthBillboardObjects(ctx, renderItems);
            const currentDisplayObjects = new Set();

            for (let i = 0; i < renderItems.length; i++) {
                const item = renderItems[i];
                if (!item) continue;
                if (depthBillboardRenderedItems.has(item)) continue;
                const displayObj = item.pixiSprite || null;
                if (!displayObj) continue;
                if (displayObj.parent !== container) {
                    container.addChild(displayObj);
                }
                displayObj.visible = true;
                item._renderer2DisplayObject = displayObj;
                if (item.type === "wallSectionComposite" && Array.isArray(item._sectionMemberWalls)) {
                    for (let w = 0; w < item._sectionMemberWalls.length; w++) {
                        const memberWall = item._sectionMemberWalls[w];
                        if (!memberWall) continue;
                        memberWall._wallSectionCompositeDisplayObject = displayObj;
                    }
                }
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
                const mesh = item._renderer2DepthMesh;
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
            this.addPickRenderItem(wizard, this.wizardSprite, { forceInclude: true });

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
            previewItem.mountedWallLineGroupId = (
                useSnapPlacement &&
                Number.isInteger(snapPlacement.mountedWallLineGroupId)
            ) ? Number(snapPlacement.mountedWallLineGroupId) : (
                useSnapPlacement &&
                snapPlacement.targetWall &&
                Number.isInteger(snapPlacement.targetWall.lineGroupId)
            ) ? Number(snapPlacement.targetWall.lineGroupId) : null;
            previewItem.mountedSectionId = (
                useSnapPlacement &&
                Number.isInteger(snapPlacement.mountedSectionId)
            ) ? Number(snapPlacement.mountedSectionId) : (
                useSnapPlacement &&
                Number.isInteger(snapPlacement.mountedWallLineGroupId)
            ) ? Number(snapPlacement.mountedWallLineGroupId) : null;
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
                this.placeObjectCenterSnapGuideGraphics.name = "renderer2PlaceObjectSnapGuide";
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
                xyratio: ctx.xyratio
            });
            this.resetPickRenderItems();
            if (this.scenePicker && this.scenePicker.publicApi) {
                global.renderer2ScenePicker = this.scenePicker.publicApi;
            }
            const visibleNodes = this.collectVisibleNodes(ctx, 4, 4);
            this.syncOnscreenObjectsCache(ctx, visibleNodes);
            this.renderGroundTiles(ctx, visibleNodes);
            this.renderRoadsAndFloors(ctx, visibleNodes);
            this.renderObjects3D(ctx, visibleNodes);
            this.renderPlaceObjectPreview(ctx);
            this.renderRoofs3D(ctx);
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
                        if (item._renderer2DepthMesh && item._renderer2DepthMesh.visible) return item._renderer2DepthMesh;
                        if (item._wallSectionCompositeDisplayObject && item._wallSectionCompositeDisplayObject.parent) {
                            return item._wallSectionCompositeDisplayObject;
                        }
                        if (item.type === "road") {
                            const roadSprite = this.roadSpriteByObject.get(item);
                            if (roadSprite && roadSprite.parent) return roadSprite;
                        }
                        if (item._renderer2DisplayObject && item._renderer2DisplayObject.parent) {
                            return item._renderer2DisplayObject;
                        }
                        if (item.pixiSprite && item.pixiSprite.parent) return item.pixiSprite;
                        return null;
                    }
                });
            }
            const showPickerScreen = !!global.renderer2ShowPickerScreen;
            this.layers.ground.visible = !showPickerScreen;
            this.layers.roadsFloor.visible = !showPickerScreen;
            this.layers.depthObjects.visible = !showPickerScreen;
            this.layers.objects3d.visible = !showPickerScreen;
            this.layers.entities.visible = !showPickerScreen;
            this.layers.ui.visible = true;
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
            for (const item of singleton.activeDepthBillboardItems) {
                if (item && item.pixiSprite) {
                    item.pixiSprite.visible = true;
                    if (Object.prototype.hasOwnProperty.call(item.pixiSprite, "renderable")) {
                        item.pixiSprite.renderable = true;
                    }
                }
                if (item && item._renderer2DepthMesh) {
                    if (item._renderer2DepthMesh.parent) {
                        item._renderer2DepthMesh.parent.removeChild(item._renderer2DepthMesh);
                    }
                    item._renderer2DepthMesh.visible = false;
                    item._renderer2DepthMesh = null;
                }
            }
            singleton.activeDepthBillboardItems.clear();
            singleton.activeDepthBillboardMeshes.clear();
            singleton.clearPlaceObjectPreview();
            if (singleton.scenePicker && typeof singleton.scenePicker.hideAll === "function") {
                singleton.scenePicker.hideAll();
            }
            if (singleton.scenePicker && singleton.scenePicker.publicApi && global.renderer2ScenePicker === singleton.scenePicker.publicApi) {
                global.renderer2ScenePicker = null;
            }
            singleton.layers.root.visible = false;
            singleton.setLegacyLayersVisible(true);
        }
    };
})(typeof globalThis !== "undefined" ? globalThis : window);
